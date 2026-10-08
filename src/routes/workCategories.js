"use strict";

const express = require("express");
const router = express.Router();
const prisma = require("../lib/prisma");
const { verifyToken, authorizeRoles } = require("../middleware/auth");
const { normalizeWorkCategoryCode } = require("../services/bvCalculationService");
const {
  listWorkSubCategories,
  createWorkSubCategory,
  updateWorkSubCategory,
  getWorkSubCategoryReferences,
  deleteWorkSubCategory,
} = require("../services/workSubCategoryService");
const { nextWorkCategorySortOrder } = require("../services/workCategoryOrderService");

const CATEGORY_ROLES = ["SUPER_ADMIN", "PROJECT_MANAGER", "PERENCANA"];

function sendServiceError(res, error, label) {
  if (error.statusCode) {
    return res.status(error.statusCode).json({
      error: error.message,
      ...(error.references ? { references: error.references } : {}),
    });
  }
  if (error instanceof TypeError) return res.status(400).json({ error: error.message });
  console.error(label, error);
  return res.status(500).json({ error: error.message || "Terjadi kesalahan." });
}

// Nested CRUD: a WorkSubCategory is globally owned by exactly one WorkCategory.
router.get("/:categoryId/subcategories", verifyToken, async (req, res) => {
  try {
    const activeOnly = ["1", "true"].includes(String(req.query.activeOnly || "").toLowerCase());
    res.json(await listWorkSubCategories(prisma, req.params.categoryId, { activeOnly }));
  } catch (error) {
    sendServiceError(res, error, "Error List WorkSubCategory:");
  }
});

router.post("/:categoryId/subcategories", verifyToken, authorizeRoles(...CATEGORY_ROLES), async (req, res) => {
  try {
    const data = await createWorkSubCategory(prisma, req.params.categoryId, req.body);
    res.status(201).json({ message: "Subkategori berhasil dibuat.", data });
  } catch (error) {
    sendServiceError(res, error, "Error Create WorkSubCategory:");
  }
});

router.put("/:categoryId/subcategories/:id", verifyToken, authorizeRoles(...CATEGORY_ROLES), async (req, res) => {
  try {
    const data = await updateWorkSubCategory(prisma, req.params.categoryId, req.params.id, req.body);
    res.json({ message: "Subkategori berhasil diperbarui.", data });
  } catch (error) {
    sendServiceError(res, error, "Error Update WorkSubCategory:");
  }
});

router.delete("/:categoryId/subcategories/:id", verifyToken, authorizeRoles(...CATEGORY_ROLES), async (req, res) => {
  try {
    const data = await deleteWorkSubCategory(prisma, req.params.categoryId, req.params.id);
    res.json({ message: "Subkategori berhasil dihapus.", data });
  } catch (error) {
    sendServiceError(res, error, "Error Delete WorkSubCategory:");
  }
});

// GET /api/work-categories/:categoryId/subcategories/:id/references
// Ringkasan dampak hapus subkategori (dipakai pemilih subkategori di BV/RAB).
router.get("/:categoryId/subcategories/:id/references", verifyToken, async (req, res) => {
  try {
    const references = await getWorkSubCategoryReferences(
      prisma,
      req.params.categoryId,
      req.params.id,
    );
    res.json({ references });
  } catch (error) {
    sendServiceError(res, error, "Error Get WorkSubCategory References:");
  }
});

// GET /api/work-categories
router.get("/", verifyToken, async (req, res) => {
  try {
    const categories = await prisma.workCategory.findMany({
      include: { subCategories: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] } },
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
    const { code, name } = req.body;
    const normalizedCode = normalizeWorkCategoryCode(code);
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Nama kategori wajib diisi." });
    }
    const sortOrder = await nextWorkCategorySortOrder(prisma);
    const category = await prisma.workCategory.create({
      data: {
        code: normalizedCode,
        name: name.trim(),
        sortOrder,
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
    const { name, code, isActive } = req.body;
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

// GET /api/work-categories/:id/references
router.get(
  "/:id/references",
  verifyToken,
  authorizeRoles(...CATEGORY_ROLES),
  async (req, res) => {
    try {
      const category = await prisma.workCategory.findUnique({
        where: { id: req.params.id },
        select: {
          id: true,
          _count: {
            select: {
              projectConfigs: true,
              priceItems: true,
              jobTypes: true,
              uploadBatches: true,
              bvItems: true,
              rabItems: true,
              subCategories: true,
            },
          },
        },
      });

      if (!category) {
        return res.status(404).json({ error: "Kategori tidak ditemukan." });
      }

      res.json({ references: category._count });
    } catch (err) {
      console.error("Error Get WorkCategory References:", err);
      res.status(500).json({ error: err.message || "Terjadi kesalahan." });
    }
  },
);

// DELETE /api/work-categories/:id
router.delete("/:id", verifyToken, authorizeRoles(...CATEGORY_ROLES), async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.workCategory.findUnique({
      where: { id },
      include: { _count: { select: { subCategories: true } } },
    });
    if (!existing) return res.status(404).json({ error: "Kategori tidak ditemukan." });
    if (existing._count.subCategories > 0) {
      return res.status(409).json({
        error: "Kategori masih memiliki subkategori. Hapus subkategori terlebih dahulu.",
        references: { subCategories: existing._count.subCategories },
      });
    }

    const detached = await prisma.$transaction(async (tx) => {
      const projectConfigs = await tx.projectWorkCategory.deleteMany({
        where: { workCategoryId: id },
      });
      const priceItems = await tx.priceItem.updateMany({
        where: { workCategoryId: id },
        data: { workCategoryId: null },
      });
      const jobTypes = await tx.jobType.updateMany({
        where: { workCategoryId: id },
        data: { workCategoryId: null },
      });
      const uploadBatches = await tx.uploadBatch.updateMany({
        where: { workCategoryId: id },
        data: { workCategoryId: null },
      });
      const bvItems = await tx.bvItem.updateMany({
        where: { workCategoryId: id },
        data: { workCategoryId: null },
      });
      const rabItems = await tx.rabItem.updateMany({
        where: { workCategoryId: id },
        data: { workCategoryId: null },
      });
      const deleted = await tx.workCategory
        .delete({ where: { id } })
        .catch((e) => {
          if (e.code === "P2025") return null;
          throw e;
        });

      if (!deleted) {
        const conflict = new Error("Kategori sudah dihapus sebelumnya.");
        conflict.status = 404;
        throw conflict;
      }

      return {
        deleted,
        referencesDetached: {
          projectConfigs: projectConfigs.count,
          priceItems: priceItems.count,
          jobTypes: jobTypes.count,
          uploadBatches: uploadBatches.count,
          bvItems: bvItems.count,
          rabItems: rabItems.count,
        },
      };
    });

    res.json({
      message: "Kategori berhasil dihapus permanen.",
      data: detached.deleted,
      referencesDetached: detached.referencesDetached,
    });
  } catch (err) {
    if (err.status === 404) {
      return res.status(404).json({ error: err.message });
    }
    console.error("Error Delete WorkCategory:", err);
    res.status(500).json({ error: err.message || "Terjadi kesalahan." });
  }
});

module.exports = router;
