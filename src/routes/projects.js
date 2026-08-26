"use strict";

const express = require("express");
const router = express.Router();
const prisma = require("../lib/prisma");

// POST /api/projects
// body: { name, location, hspkPeriod, clientId? , clientName? }
// - clientId dipakai kalau user pilih client yang sudah ada
// - clientName dipakai kalau user pilih "Client Baru"
router.post("/", async (req, res, next) => {
  try {
    const {
      name,
      location,
      hspkPeriod,
      discipline,
      grade,
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
    if (!discipline) {
      return res.status(400).json({ error: "Disiplin wajib dipilih" });
    }

    // pastikan periode+disiplin+grade yang dipilih memang punya data di DB
    const periodExists = await prisma.jobType.findFirst({
      where: {
        period: Number(hspkPeriod),
        discipline,
        ...(grade ? { grade } : {}),
      },
    });
    if (!periodExists) {
      return res.status(400).json({
        error: `Data HSPK/AHSP untuk periode ${hspkPeriod} - ${discipline}${grade ? " - " + grade : ""} tidak ditemukan di database`,
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
        hspkPeriod: Number(hspkPeriod),
        discipline,
        grade: grade || null,
        clientId: finalClientId,
      },
      include: { client: true },
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
      include: { client: true, pairedProject: true },
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
      include: { client: true },
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

    const finalDiscipline =
      discipline !== undefined ? discipline : existing.discipline;
    const finalPeriod =
      hspkPeriod !== undefined ? Number(hspkPeriod) : existing.hspkPeriod;
    const finalGrade = grade !== undefined ? grade || null : existing.grade;

    // validasi ulang cuma kalau period/discipline/grade berubah
    if (
      hspkPeriod !== undefined ||
      discipline !== undefined ||
      grade !== undefined
    ) {
      const periodExists = await prisma.jobType.findFirst({
        where: {
          period: finalPeriod,
          discipline: finalDiscipline,
          ...(finalGrade ? { grade: finalGrade } : {}),
        },
      });
      if (!periodExists) {
        return res.status(400).json({
          error: `Data HSPK/AHSP untuk periode ${finalPeriod} - ${finalDiscipline}${finalGrade ? " - " + finalGrade : ""} tidak ditemukan di database`,
        });
      }
      data.hspkPeriod = finalPeriod;
      data.discipline = finalDiscipline;
      data.grade = finalGrade;
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

// DELETE /api/projects/:id
router.delete("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
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
