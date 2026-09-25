"use strict";

const express = require("express");
const router = express.Router();
const prisma = require("../lib/prisma");
const { verifyToken, authorizeRoles } = require("../middleware/auth");
const { normalizeWorkCategoryCode } = require("../services/bvCalculationService");

const CATEGORY_ROLES = ["SUPER_ADMIN", "PROJECT_MANAGER", "PERENCANA"];

// GET /api/work-categories
router.get("/", verifyToken, async (req, res) => {
  try {
    const categories = await prisma.workCategory.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    res.json(categories);
  } catch (err) {
    console.error("Error List WorkCategory:", err);
    res.status(500).json({ error: err.message || "Terjadi kesalahan." });
  }
});

// POST /api/work-categories
router.post("/", verifyToken, authorizeRoles(...CATEGORY_ROLES), async (req, res) => {
  try {
    const { code, name, sortOrder } = req.body;
    const normalizedCode = normalizeWorkCategoryCode(code);
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Nama kategori wajib diisi." });
    }
    const category = await prisma.workCategory.create({
      data: {
        code: normalizedCode,
        name: name.trim(),
        sortOrder: Number.isInteger(sortOrder) ? sortOrder : 0,
      },
    });
    res.status(201).json({ message: "Kategori berhasil dibuat.", data: category });
  } catch (err) {
    if (err.code === "P2002") {
      return res.status(409).json({ error: "Kode kategori sudah ada." });
    }
    if (err instanceof TypeError) {
      return res.status(400).json({ error: err.message });
    }
    console.error("Error Create WorkCategory:", err);
    res.status(500).json({ error: err.message || "Terjadi kesalahan." });
  }
});

// PUT /api/work-categories/:id
router.put("/:id", verifyToken, authorizeRoles(...CATEGORY_ROLES), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, code, sortOrder, isActive } = req.body;
    const existing = await prisma.workCategory.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Kategori tidak ditemukan." });

    const data = {};
    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ error: "Nama tidak boleh kosong." });
      data.name = name.trim();
    }
    if (code !== undefined) {
      data.code = normalizeWorkCategoryCode(code);
    }
    if (sortOrder !== undefined) data.sortOrder = Number(sortOrder);
    if (isActive !== undefined) data.isActive = !!isActive;

    const updated = await prisma.workCategory.update({ where: { id }, data });
    res.json({ message: "Kategori berhasil diperbarui.", data: updated });
  } catch (err) {
    if (err.code === "P2002") {
      return res.status(409).json({ error: "Kode kategori sudah ada." });
    }
    if (err instanceof TypeError) {
      return res.status(400).json({ error: err.message });
    }
    console.error("Error Update WorkCategory:", err);
    res.status(500).json({ error: err.message || "Terjadi kesalahan." });
  }
});

// DELETE /api/work-categories/:id
router.delete("/:id", verifyToken, authorizeRoles(...CATEGORY_ROLES), async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.workCategory.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Kategori tidak ditemukan." });

    // Cek apakah sudah direferensikan
    const refCount = await prisma.projectWorkCategory.count({
      where: { workCategoryId: id },
    });
    if (refCount > 0) {
      // Hanya nonaktifkan, bukan hard delete
      await prisma.workCategory.update({ where: { id }, data: { isActive: false } });
      return res.json({
        message: "Kategori sudah dipakai proyek; dinonaktifkan (bukan dihapus).",
      });
    }

    await prisma.workCategory.delete({ where: { id } });
    res.json({ message: "Kategori berhasil dihapus." });
  } catch (err) {
    console.error("Error Delete WorkCategory:", err);
    res.status(500).json({ error: err.message || "Terjadi kesalahan." });
  }
});

module.exports = router;
