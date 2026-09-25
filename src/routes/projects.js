"use strict";

const express = require("express");
const router = express.Router();
const prisma = require("../lib/prisma");
const {
  normalizeRequiredProjectWorkCategoryConfigs,
} = require("../services/bvCalculationService");

// POST /api/projects
// body: { name, location, hspkPeriod, interiorGrade, sipilGrade, categories?, clientId?, clientName? }
router.post("/", async (req, res, next) => {
  try {
    const {
      name,
      location,
      hspkPeriod,
      interiorGrade,
      sipilGrade,
      categories,
      clientId,
      clientName,
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Nama proyek wajib diisi" });
    }
    if (!location || !location.trim()) {
      return res.status(400).json({ error: "Lokasi wajib diisi" });
    }
    if (!hspkPeriod) {
      return res
        .status(400)
        .json({ error: "Periode data HSPK/AHSP wajib dipilih" });
    }

    const periodNum = Number(hspkPeriod);

    // Kategori aktif diambil sekali, dipakai untuk validasi grade.
    const activeCategories = await prisma.workCategory.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
    });
    const categoryById = new Map(activeCategories.map((c) => [c.id, c]));
    const categoryByCode = new Map(
      activeCategories.map((c) => [String(c.code).toUpperCase(), c]),
    );

    // Konfigurasi kategori: pakai payload `categories` kalau ada, kalau tidak
    // susun dari field legacy sipilGrade/interiorGrade agar klien lama tetap jalan.
    let requestedConfigs = Array.isArray(categories) ? categories : [];
    if (requestedConfigs.length === 0) {
      requestedConfigs = [];
      if (interiorGrade) {
        const interiorCat = categoryByCode.get("INTERIOR");
        if (interiorCat) {
          requestedConfigs.push({
            workCategoryId: interiorCat.id,
            pricingMode: "HSPK",
            grade: interiorGrade,
            isActive: true,
          });
        }
      }
      if (sipilGrade) {
        const sipilCat = categoryByCode.get("SIPIL");
        if (sipilCat) {
          requestedConfigs.push({
            workCategoryId: sipilCat.id,
            pricingMode: "HSPK",
            grade: sipilGrade,
            isActive: true,
          });
        }
      }
    }

    let normalizedCategories;
    try {
      normalizedCategories = normalizeRequiredProjectWorkCategoryConfigs(
        requestedConfigs,
        activeCategories,
      );
    } catch (err) {
      if (err instanceof TypeError) {
        return res.status(400).json({ error: err.message });
      }
      throw err;
    }

    // Setiap project wajib menyertakan Sipil dan Interior.
    const activeCodes = new Set(
      normalizedCategories
        .filter((cfg) => cfg.isActive)
        .map((cfg) => {
          const category = categoryById.get(cfg.workCategoryId);
          return String(category?.code || "").toUpperCase();
        }),
    );
    for (const requiredCode of ["SIPIL", "INTERIOR"]) {
      if (!activeCodes.has(requiredCode)) {
        const label = requiredCode === "SIPIL" ? "Sipil" : "Interior";
        return res
          .status(400)
          .json({ error: `Kategori ${label} wajib ada di setiap project.` });
      }
    }

    // Validasi ketersediaan data HSPK untuk tiap kategori bermode HSPK.
    for (const cfg of normalizedCategories) {
      if (!cfg.isActive || cfg.pricingMode !== "HSPK") continue;
      const category = categoryById.get(cfg.workCategoryId);
      const code = String(category?.code || "").toUpperCase();

      // Utamakan workCategoryId (jalur upload baru); discipline hanya fallback
      // untuk data legacy yang belum punya kategori.
      const dynamicExists = await prisma.jobType.findFirst({
        where: {
          period: periodNum,
          workCategoryId: cfg.workCategoryId,
          grade: cfg.grade,
        },
        select: { id: true },
      });
      if (dynamicExists) continue;

      if (code === "SIPIL" || code === "INTERIOR") {
        const legacyExists = await prisma.jobType.findFirst({
          where: { period: periodNum, discipline: code, grade: cfg.grade },
          select: { id: true },
        });
        if (legacyExists) continue;
      }

      return res.status(400).json({
        error: `Data HSPK ${category?.name || code} periode ${periodNum} grade ${cfg.grade} tidak ditemukan`,
      });
    }

    let finalClientId = clientId;

    if (!finalClientId) {
      if (!clientName || !clientName.trim()) {
        return res
          .status(400)
          .json({ error: "Client wajib dipilih atau diisi nama baru" });
      }
      const existing = await prisma.client.findFirst({
        where: { name: { equals: clientName.trim(), mode: "insensitive" } },
      });
      finalClientId = existing
        ? existing.id
        : (await prisma.client.create({ data: { name: clientName.trim() } }))
            .id;
    }

    const project = await prisma.project.create({
      data: {
        name: name.trim(),
        location: location.trim(),
        hspkPeriod: periodNum,
        // Proyek bersifat general (campuran); disiplin kosong, grade disimpan terpisah.
        discipline: null,
        grade: null,
        interiorGrade: interiorGrade || null,
        sipilGrade: sipilGrade || null,
        clientId: finalClientId,
        workCategories: {
          create: normalizedCategories.map((cfg) => ({
            workCategory: { connect: { id: cfg.workCategoryId } },
            pricingMode: cfg.pricingMode,
            grade: cfg.grade,
            isActive: cfg.isActive,
          })),
        },
      },
      include: { client: true, workCategories: { include: { workCategory: true } } },
    });

    res.status(201).json(project);
  } catch (err) {
    next(err);
  }
});

// GET /api/projects/:id
router.get("/:id", async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: req.params.id },
      include: {
        client: true,
        pairedProject: true,
        rabItems: true,
        purchaseOrders: true,
        workCategories: { include: { workCategory: true } },
      },
    });
    if (!project)
      return res.status(404).json({ error: "Project tidak ditemukan" });
    res.json(project);
  } catch (err) {
    next(err);
  }
});

// GET /api/projects — daftar semua project
router.get("/", async (req, res, next) => {
  try {
    const { clientId, discipline, grade } = req.query;
    const where = {};
    if (clientId) where.clientId = clientId;
    if (discipline) where.discipline = discipline;
    if (grade) where.grade = grade;

    const projects = await prisma.project.findMany({
      where,
      include: { client: true, workCategories: { include: { workCategory: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json(projects);
  } catch (err) {
    next(err);
  }
});

/** PUT /projects/:id/pair — hubungkan 2 project (misal Civil & Interior) sebagai pasangan */
router.put("/:id/pair", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { pairedProjectId } = req.body;

    if (!pairedProjectId) {
      return res
        .status(400)
        .json({ error: "Field pairedProjectId wajib diisi." });
    }
    if (pairedProjectId === id) {
      return res.status(400).json({
        error: "Project tidak boleh dipasangkan dengan dirinya sendiri.",
      });
    }

    const [projectA, projectB] = await Promise.all([
      prisma.project.findUnique({ where: { id } }),
      prisma.project.findUnique({ where: { id: pairedProjectId } }),
    ]);
    if (!projectA)
      return res.status(404).json({ error: "Project tidak ditemukan." });
    if (!projectB)
      return res
        .status(404)
        .json({ error: "Project pasangan tidak ditemukan." });

    // set pairing dua arah dalam 1 transaction
    const [updatedA] = await prisma.$transaction([
      prisma.project.update({ where: { id }, data: { pairedProjectId } }),
      prisma.project.update({
        where: { id: pairedProjectId },
        data: { pairedProjectId: id },
      }),
    ]);

    res.json({ message: "Project berhasil dipasangkan", data: updatedA });
  } catch (err) {
    next(err);
  }
});

// PUT /api/projects/:id
router.put("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      name,
      location,
      hspkPeriod,
      categories,
      clientId,
      clientName,
    } = req.body;

    const existing = await prisma.project.findUnique({
      where: { id },
      include: { workCategories: true },
    });
    if (!existing) {
      return res.status(404).json({ error: "Project tidak ditemukan" });
    }

    if (name !== undefined && !String(name).trim()) {
      return res.status(400).json({ error: "Nama proyek wajib diisi" });
    }
    if (location !== undefined && !String(location).trim()) {
      return res.status(400).json({ error: "Lokasi wajib diisi" });
    }

    const finalPeriod = hspkPeriod !== undefined
      ? Number(hspkPeriod)
      : existing.hspkPeriod;
    if (!Number.isInteger(finalPeriod) || finalPeriod < 2000 || finalPeriod > 2100) {
      return res.status(400).json({ error: "Periode data HSPK/AHSP tidak valid" });
    }

    const activeCategories = await prisma.workCategory.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
    });
    const categoryById = new Map(activeCategories.map((category) => [category.id, category]));
    const categoryByCode = new Map(
      activeCategories.map((category) => [String(category.code).toUpperCase(), category]),
    );

    // Edit memakai konfigurasi dari form yang sama dengan Create. Untuk klien lama
    // yang tidak mengirim `categories`, pertahankan konfigurasi yang sudah tersimpan.
    let requestedConfigs = Array.isArray(categories)
      ? categories
      : existing.workCategories.map((config) => ({
          workCategoryId: config.workCategoryId,
          pricingMode: config.pricingMode,
          grade: config.grade,
          isActive: config.isActive,
        }));

    // Migrasi aman untuk proyek legacy yang belum mempunyai ProjectWorkCategory.
    if (requestedConfigs.length === 0) {
      requestedConfigs = ["SIPIL", "INTERIOR"]
        .map((code) => {
          const category = categoryByCode.get(code);
          if (!category) return null;
          const legacyGrade = code === "SIPIL" ? existing.sipilGrade : existing.interiorGrade;
          return {
            workCategoryId: category.id,
            pricingMode: legacyGrade ? "HSPK" : "CUSTOM",
            grade: legacyGrade || null,
            isActive: true,
          };
        })
        .filter(Boolean);
    }

    let normalizedCategories;
    try {
      normalizedCategories = normalizeRequiredProjectWorkCategoryConfigs(
        requestedConfigs,
        activeCategories,
      );
    } catch (err) {
      if (err instanceof TypeError) {
        return res.status(400).json({ error: err.message });
      }
      throw err;
    }

    // Mode HSPK wajib menunjuk grade yang benar-benar ada pada periode+kategori.
    for (const config of normalizedCategories) {
      if (!config.isActive || config.pricingMode !== "HSPK") continue;
      const category = categoryById.get(config.workCategoryId);
      const code = String(category?.code || "").toUpperCase();

      const dynamicExists = await prisma.jobType.findFirst({
        where: {
          period: finalPeriod,
          workCategoryId: config.workCategoryId,
          grade: config.grade,
        },
        select: { id: true },
      });
      if (dynamicExists) continue;

      if (code === "SIPIL" || code === "INTERIOR") {
        const legacyExists = await prisma.jobType.findFirst({
          where: { period: finalPeriod, discipline: code, grade: config.grade },
          select: { id: true },
        });
        if (legacyExists) continue;
      }

      return res.status(400).json({
        error: `Data HSPK ${category?.name || code} periode ${finalPeriod} grade ${config.grade} tidak ditemukan`,
      });
    }

    const gradeForCode = (code) => {
      const category = categoryByCode.get(code);
      const config = normalizedCategories.find(
        (item) => item.workCategoryId === category?.id && item.isActive,
      );
      return config?.pricingMode === "HSPK" ? config.grade : null;
    };

    const project = await prisma.$transaction(async (tx) => {
      let finalClientId = clientId || existing.clientId;
      if (!clientId && clientName !== undefined) {
        if (!String(clientName).trim()) {
          throw new TypeError("Client wajib diisi");
        }
        const existingClient = await tx.client.findFirst({
          where: { name: { equals: String(clientName).trim(), mode: "insensitive" } },
        });
        finalClientId = existingClient
          ? existingClient.id
          : (await tx.client.create({ data: { name: String(clientName).trim() } })).id;
      }

      await tx.projectWorkCategory.deleteMany({ where: { projectId: id } });
      await tx.projectWorkCategory.createMany({
        data: normalizedCategories.map((config) => ({
          projectId: id,
          workCategoryId: config.workCategoryId,
          pricingMode: config.pricingMode,
          grade: config.grade,
          isActive: config.isActive,
        })),
      });

      return tx.project.update({
        where: { id },
        data: {
          name: name !== undefined ? String(name).trim() : existing.name,
          location: location !== undefined ? String(location).trim() : existing.location,
          hspkPeriod: finalPeriod,
          discipline: null,
          grade: null,
          interiorGrade: gradeForCode("INTERIOR"),
          sipilGrade: gradeForCode("SIPIL"),
          clientId: finalClientId,
        },
        include: {
          client: true,
          workCategories: { include: { workCategory: true } },
        },
      });
    });

    res.json(project);
  } catch (err) {
    if (err instanceof TypeError) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// PUT /api/projects/:id/categories
router.put("/:id/categories", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { categories } = req.body;

    const existing = await prisma.project.findUnique({ where: { id } });
    if (!existing)
      return res.status(404).json({ error: "Project tidak ditemukan" });

    const activeCategories = await prisma.workCategory.findMany({
      where: { isActive: true },
    });
    const normalized = normalizeRequiredProjectWorkCategoryConfigs(
      categories,
      activeCategories,
    );

    await prisma.$transaction(async (tx) => {
      await tx.projectWorkCategory.deleteMany({ where: { projectId: id } });
      await tx.projectWorkCategory.createMany({
        data: normalized.map((cfg) => ({
          projectId: id,
          workCategoryId: cfg.workCategoryId,
          pricingMode: cfg.pricingMode,
          grade: cfg.grade,
          isActive: cfg.isActive,
        })),
      });
    });

    const updated = await prisma.project.findUnique({
      where: { id },
      include: { client: true, workCategories: { include: { workCategory: true } } },
    });
    res.json({ message: "Kategori proyek berhasil disimpan.", data: updated });
  } catch (err) {
    if (err instanceof TypeError) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// DELETE /api/projects/:id
router.delete("/:id", async (req, res, next) => {
  try {
    const existing = await prisma.project.findUnique({ where: { id } });
    if (!existing)
      return res.status(404).json({ error: "Project tidak ditemukan" });

    // lepas pairing dulu, biar pasangan gak nyantol id yang dihapus
    if (existing.pairedProjectId) {
      await prisma.project.update({
        where: { id: existing.pairedProjectId },
        data: { pairedProjectId: null },
      });
    }

    await prisma.project.delete({ where: { id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
module.exports = router;
