"use strict";

const express = require("express");
const router = express.Router();
const prisma = require("../lib/prisma");
const { normalizeProjectWorkCategoryConfigs } = require("../services/bvCalculationService");

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
      normalizedCategories = normalizeProjectWorkCategoryConfigs(
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
      discipline,
      grade,
      interiorGrade,
      sipilGrade,
      clientId,
      clientName,
    } = req.body;

    const existing = await prisma.project.findUnique({ where: { id } });
    if (!existing)
      return res.status(404).json({ error: "Project tidak ditemukan" });

    if (name !== undefined && !name.trim()) {
      return res.status(400).json({ error: "Nama proyek wajib diisi" });
    }
    if (location !== undefined && !location.trim()) {
      return res.status(400).json({ error: "Lokasi wajib diisi" });
    }

    const data = {};
    if (name !== undefined) data.name = name.trim();
    if (location !== undefined) data.location = location.trim();
    if (discipline !== undefined) data.discipline = discipline || null;
    if (grade !== undefined) data.grade = grade || null;
    if (interiorGrade !== undefined) data.interiorGrade = interiorGrade || null;
    if (sipilGrade !== undefined) data.sipilGrade = sipilGrade || null;

    const finalPeriod =
      hspkPeriod !== undefined ? Number(hspkPeriod) : existing.hspkPeriod;
    const finalInterior =
      interiorGrade !== undefined ? interiorGrade || null : existing.interiorGrade;
    const finalSipil =
      sipilGrade !== undefined ? sipilGrade || null : existing.sipilGrade;

    data.hspkPeriod = finalPeriod;

    // validasi data HSPK hanya kalau grade/periode berubah
    if (hspkPeriod !== undefined || interiorGrade !== undefined) {
      const interiorExists = await prisma.jobType.findFirst({
        where: { period: finalPeriod, discipline: "INTERIOR", grade: finalInterior },
      });
      if (!interiorExists && finalInterior) {
        return res.status(400).json({
          error: `Data HSPK Interior periode ${finalPeriod} grade ${finalInterior} tidak ditemukan`,
        });
      }
    }

    if (hspkPeriod !== undefined || sipilGrade !== undefined) {
      const sipilExists = await prisma.jobType.findFirst({
        where: { period: finalPeriod, discipline: "SIPIL", grade: finalSipil },
      });
      if (!sipilExists && finalSipil) {
        return res.status(400).json({
          error: `Data HSPK Sipil periode ${finalPeriod} grade ${finalSipil} tidak ditemukan`,
        });
      }
    }

    if (clientId) {
      data.clientId = clientId;
    } else if (clientName && clientName.trim()) {
      const existingClient = await prisma.client.findFirst({
        where: { name: { equals: clientName.trim(), mode: "insensitive" } },
      });
      data.clientId = existingClient
        ? existingClient.id
        : (await prisma.client.create({ data: { name: clientName.trim() } }))
            .id;
    }

    const project = await prisma.project.update({
      where: { id },
      data,
      include: { client: true },
    });

    res.json(project);
  } catch (err) {
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
    const normalized = normalizeProjectWorkCategoryConfigs(categories, activeCategories);

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
