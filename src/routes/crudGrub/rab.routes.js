"use strict";

const express = require("express");
// Naik dua tingkat (keluar dari CRUDRAB, lalu keluar dari routes)
const prisma = require("../../lib/prisma");
const { calculateJobPrice } = require("../../services/calculateService");
const { verifyToken, authorizeRoles } = require("../../middleware/auth");
const { redactSellingFields, validateJobTypeForProject, buildWorkCategoryItemWhere } = require("../../services/bvCalculationService");
const { normalizeAhspOverhead } = require("../../services/ahspPricingService");
const { recordChange } = require("../../services/bvRabAuditService");
const { assertProjectEditable } = require("../../services/bvRabApprovalService");

const redactSellingResponse = (req, res, next) => {
  if (req.user?.role === "SUPER_ADMIN") return next();
  const originalJson = res.json.bind(res);
  res.json = (body) => originalJson(redactSellingFields(body));
  next();
};
const protectSelling = (req, res, next) => {
  const isSellingWrite = ["rabUnitPrice", "rabTotalPrice"].some((key) => Object.prototype.hasOwnProperty.call(req.body || {}, key));
  // Harga jual (RAB) kini selalu dihitung dari RAP + Overhead, sehingga tidak ada
  // satu pun peran yang boleh menulis harga jual secara manual.
  if (isSellingWrite) {
    return res.status(403).json({
      error: "Harga jual RAB dihitung otomatis dari RAP + Overhead dan tidak dapat diubah manual.",
    });
  }
  next();
};

const OVERHEAD_ONLY_ERROR = "SUPER_ADMIN hanya boleh mengubah Overhead (%).";
const FORBIDDEN_SUPER_ADMIN_FIELDS = [
  "rapUnitPrice",
  "rapTotalPrice",
  "rabUnitPrice",
  "rabTotalPrice",
  "components",
  "volume",
  "groupId",
  "isByOwner",
  "isStip",
];

const protectRapWrite = (req, res, next) => {
  if (req.user?.role === "SUPER_ADMIN") {
    const body = req.body || {};
    const keys = Object.keys(body);
    // SUPER_ADMIN hanya mengatur margin lewat Overhead. RAP berasal dari AHSP
    // daerah/perencana dan tidak boleh ditimpa, begitu pula override harga jual.
    const onlyOverhead = keys.length === 1 && keys[0] === "overheadPercent";
    if (!onlyOverhead) {
      const touchedForbidden = keys.filter((key) =>
        FORBIDDEN_SUPER_ADMIN_FIELDS.includes(key),
      );
      const message = touchedForbidden.length
        ? `SUPER_ADMIN tidak boleh mengubah ${touchedForbidden.join(", ")}. Hanya Overhead (%) yang dapat diubah.`
        : OVERHEAD_ONLY_ERROR;
      return res.status(403).json({ error: message });
    }
    const value = Number(body.overheadPercent);
    if (!Number.isFinite(value) || value < 0) {
      return res.status(400).json({ error: "Overhead (%) harus berupa angka valid (>= 0)." });
    }
    req.body.overheadPercent = value;
    return next();
  }
  if (!["PROJECT_MANAGER", "PERENCANA"].includes(req.user?.role)) {
    return res.status(403).json({ error: "Tidak memiliki akses mengubah RAP." });
  }
  next();
};

const router = express.Router();

async function assertRabItemsEditable(items, requestedIds) {
  const uniqueIds = [...new Set(requestedIds || [])];
  if (items.length !== uniqueIds.length) {
    const error = new Error("Sebagian item RAB tidak ditemukan.");
    error.statusCode = 404;
    throw error;
  }
  const projectIds = [...new Set(items.map((item) => item.projectId))];
  if (projectIds.length !== 1) {
    const error = new Error("Operasi massal hanya boleh untuk satu project.");
    error.statusCode = 400;
    throw error;
  }
  await assertProjectEditable(prisma, projectIds[0]);
  return projectIds[0];
}

router.use(
  ["/projects/:projectId/rab-items", "/rab-items"],
  verifyToken,
  protectSelling,
  (req, res, next) => {
    if (req.path.includes("/progress")) return next();
    if (req.method === "GET") return redactSellingResponse(req, res, next);
    redactSellingResponse(req, res, () => protectRapWrite(req, res, next));
  },
);

router.get("/projects/:projectId/rab-items", async (req, res) => {
  try {
    const { projectId } = req.params;
    const { discipline, workCategoryId } = req.query;
    let itemWhere = {};
    if (workCategoryId) {
      const config = await prisma.projectWorkCategory.findUnique({
        where: { projectId_workCategoryId: { projectId, workCategoryId } },
        include: { workCategory: true },
      });
      if (!config || !config.isActive || !config.workCategory?.isActive) {
        return res.status(400).json({ error: "Kategori pekerjaan tidak aktif pada project." });
      }
      itemWhere = buildWorkCategoryItemWhere({ workCategoryId, categoryCode: config.workCategory.code });
    } else if (discipline) {
      itemWhere = buildWorkCategoryItemWhere({ categoryCode: discipline });
    }
    const items = await prisma.rabItem.findMany({
      where: { projectId, ...itemWhere },
      include: { components: true, workCategory: true },
      orderBy: [{ order: "asc" }],
    });
    res.json(items);
  } catch (error) {
    console.error("Error List RabItem:", error);
    res.status(500).json({ error: "Terjadi kesalahan pada server." });
  }
});

/** PUT /rab-items/:id — edit item RAB (volume, harga custom, dll), isolated dari master */
router.put("/rab-items/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    if (["bulk-price", "bulk-switch-job"].includes(id)) return next("route");

    const {
      rapUnitPrice,
      rabUnitPrice,
      overheadPercent,
      components,
      groupId,
      isByOwner,
      isStip,
    } = req.body;

    const existing = await prisma.rabItem.findUnique({
      where: { id },
      include: { components: true },
    });
    if (!existing)
      return res.status(404).json({ error: "Item RAB tidak ditemukan." });

    // Approval state is authoritative for every RAB edit.
    await assertProjectEditable(prisma, existing.projectId);

    // ==========================================
    // 🚨 KODE SATPAM: CEK APAKAH DIA INDUK? 🚨
    // ==========================================
    const childCount = await prisma.rabItem.count({ where: { parentId: id } });
    const isInduk = childCount > 0;

    if (isInduk) {
      // JIKA INDUK: Paksa harga dan volume jadi null (Karena dia cuma Judul)
      // Abaikan komponen atau harga yang mungkin dikirim dari Frontend
      const updatedInduk = await prisma.$transaction(async (tx) => {
        const updated = await tx.rabItem.update({
          where: { id },
          data: {
            volume: 0,
            rapUnitPrice: 0,
            rapTotalPrice: 0,
            rabUnitPrice: 0,
            rabTotalPrice: 0,
            ...(groupId !== undefined ? { groupId: groupId || null } : {}),
            ...(isByOwner !== undefined ? { isByOwner } : {}),
            ...(isStip !== undefined ? { isStip } : {}),
          },
          include: { components: true, workCategory: true },
        });
        await tx.rabItemComponent.deleteMany({ where: { rabItemId: id } });
        await recordChange(tx, {
          entityType: "RAB_ITEM",
          entityId: id,
          projectId: existing.projectId,
          itemName: updated.name,
          beforeData: existing,
          afterData: { ...updated, components: [] },
          req,
        });
        return updated;
      });

      return res.json({
        message: "Item berhasil diperbarui (Disimpan sebagai Judul/Induk).",
        data: updatedInduk,
      });
    }

    // ==========================================
    // KODE DI BAWAH INI HANYA JALAN UNTUK ITEM MANDIRI / ANAK
    // ==========================================
    const vol = Number(existing.volume); // Volume mutlak dari BV
    let rapSatuan = Number(existing.rapUnitPrice);
    let componentUpdate;

    // 1. TENTUKAN HARGA SATUAN RAP (MODAL)
    if (Array.isArray(components)) {
      let baseTotal = 0;
      const rows = components.map((c) => {
        const lineTotal = Number(c.coefficient) * Number(c.unitPrice);
        baseTotal += lineTotal;
        return {
          name: c.name,
          unit: c.unit,
          section: c.section,
          coefficient: c.coefficient,
          unitPrice: c.unitPrice,
          lineTotal,
        };
      });

      rapSatuan = baseTotal;
      componentUpdate = { deleteMany: {}, create: rows };
    } else if (rapUnitPrice !== undefined && rapUnitPrice !== null) {
      rapSatuan = Number(rapUnitPrice);

      const existingComponentCount = await prisma.rabItemComponent.count({
        where: { rabItemId: id },
      });
      if (existingComponentCount > 0) {
        componentUpdate = { deleteMany: {} };
      }
    }

    // 2. RUMUS INTINYA (HITUNG RAB & TOTAL)
    const overhead =
      overheadPercent !== undefined
        ? Number(overheadPercent)
        : Number(existing.overheadPercent || existing.overhead);

    const nilaiOverhead = rapSatuan * (overhead / 100);

    // FIX: rabUnitPrice boleh dikirim eksplisit dari frontend.
    // Diperlukan untuk item jasa/jual yang RAP (modal) = 0 tapi harga jual RAB > 0,
    // mis. Loose Furniture & Instalasi Armature di BV. Tanpa ini harga jual hilang jadi 0.
    const rabSatuan =
      rabUnitPrice !== undefined && rabUnitPrice !== null && rabUnitPrice !== ""
        ? Number(rabUnitPrice)
        : rapSatuan + nilaiOverhead;

    const rapTotal = rapSatuan * vol;
    const rabTotal = rabSatuan * vol;

    // 3. SIMPAN KE DATABASE
    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.rabItem.update({
        where: { id },
        data: {
          rapUnitPrice: rapSatuan,
          rapTotalPrice: rapTotal,
          overheadPercent: overhead,
          rabUnitPrice: rabSatuan,
          rabTotalPrice: rabTotal,
          ...(componentUpdate ? { components: componentUpdate } : {}),
          ...(groupId !== undefined ? { groupId: groupId || null } : {}),
          ...(isByOwner !== undefined ? { isByOwner } : {}),
          ...(isStip !== undefined ? { isStip } : {}),
        },
        include: { components: true, workCategory: true },
      });
      await recordChange(tx, {
        entityType: "RAB_ITEM",
        entityId: id,
        projectId: existing.projectId,
        itemName: saved.name,
        beforeData: existing,
        afterData: saved,
        req,
      });
      return saved;
    });

    res.json({ message: "Item RAB berhasil diperbarui", data: updated });
  } catch (error) {
    console.error("Error Update RabItem:", error);
    res
      .status(error.statusCode || 500)
      .json({ error: error.message || "Terjadi kesalahan pada server." });
  }
});
/** DELETE /rab-items/:id */
router.delete("/rab-items/:id", async (req, res) => {
  try {
    const existing = await prisma.rabItem.findUnique({ where: { id: req.params.id }, select: { id: true, projectId: true } });
    if (!existing) return res.status(404).json({ error: "Item RAB tidak ditemukan." });
    await assertProjectEditable(prisma, existing.projectId);
    await prisma.rabItem.delete({ where: { id: req.params.id } });
    res.json({ message: "Item RAB berhasil dihapus." });
  } catch (error) {
    if (error.code === "P2025") {
      return res.status(404).json({ error: "Item RAB tidak ditemukan." });
    }
    console.error("Error Delete RabItem:", error);
    res.status(error.statusCode || 500).json({ error: error.message || "Terjadi kesalahan pada server." });
  }
});

//atas no revisi

/** PUT /rab-items/:id/switch-job — ganti sumber JobType master, tarik rincian AHSP */
router.put("/rab-items/:id/switch-job", verifyToken, authorizeRoles("PROJECT_MANAGER", "PERENCANA"), async (req, res) => {
  try {
    const { id } = req.params;
    const { newJobTypeId, customOverhead, ahspDiscipline, workCategoryId } = req.body;

    if (!newJobTypeId)
      return res
        .status(400)
        .json({ error: 'Field "newJobTypeId" wajib diisi.' });

    const existing = await prisma.rabItem.findUnique({
      where: { id },
      include: { components: true },
    });
    if (!existing)
      return res.status(404).json({ error: "Item RAB tidak ditemukan." });

    await assertProjectEditable(prisma, existing.projectId);

    const calc = await calculateJobPrice(newJobTypeId);
    if (!calc)
      return res
        .status(404)
        .json({ error: "Jenis pekerjaan (master) tidak ditemukan." });

    const rabItem = await prisma.rabItem.findUnique({
      where: { id },
      include: { project: { include: { workCategories: { include: { workCategory: true } } } } },
    });
    if (!rabItem) return res.status(404).json({ error: "Item RAB tidak ditemukan." });

    const scopeError = validateJobTypeForProject(
      calc.jobType,
      rabItem.project,
      rabItem.discipline || "GENERAL",
      ahspDiscipline,
      workCategoryId || rabItem.workCategoryId,
    );
    if (scopeError) return res.status(400).json({ error: scopeError });

    const vol = Number(existing.volume);

    // ==========================================
    // RUMUS BARU SAAT SWITCH JOB DARI MASTER (FIX DOUBLE OVERHEAD)
    // ==========================================

    // 1. Kumpulkan semua rincian komponen (Pekerja, Bahan, Alat) menjadi satu array
    const newComponents = Object.entries(calc.breakdown).flatMap(
      ([section, items]) =>
        items.map((item) => ({
          name: item.name,
          unit: item.unit,
          section,
          coefficient: item.coefficient,
          unitPrice: item.unitPrice,
          lineTotal: item.lineTotal,
        })),
    );

    // 2. Hitung Harga Modal (RAP Murni) dari total harga komponen saja (A+B+C)
    const rapSatuan = newComponents.reduce(
      (sum, comp) => sum + Number(comp.lineTotal),
      0,
    );

    // ===== [TAMBAHAN 2]: Logika Prioritas Penentuan Overhead =====
    // Prioritas: 1. Ketikan Pak Jim (customOverhead) -> 2. Bawaan Master AHSP -> 3. Bawaan Existing DB
    let overhead = 0;
    if (
      customOverhead !== undefined &&
      customOverhead !== null &&
      customOverhead !== ""
    ) {
      overhead = Number(customOverhead);
    } else if (calc.jobType.overhead != null) {
      overhead = normalizeAhspOverhead(calc.jobType.overhead);
    } else {
      overhead = Number(existing.overhead || 0);
    }

    // 4. Hitung Harga Jual (RAB) = Modal Murni + Untung Overhead
    const nilaiOverhead = rapSatuan * (overhead / 100);
    const rabSatuan = rapSatuan + nilaiOverhead;

    const rapTotal = rapSatuan * vol;
    const rabTotal = rabSatuan * vol;

    // ==========================================
    // SIMPAN KE DATABASE
    // ==========================================
    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.rabItem.update({
        where: { id },
        data: {
          category: calc.jobType.category,
          reference: calc.jobType.reference,
          discipline: calc.jobType.discipline,
          workCategoryId: workCategoryId || calc.jobType.workCategoryId || rabItem.workCategoryId,
          grade: calc.jobType.grade,
          overheadPercent: overhead,
          rapUnitPrice: rapSatuan,
          rapTotalPrice: rapTotal,
          rabUnitPrice: rabSatuan,
          rabTotalPrice: rabTotal,
          sourceJobTypeId: calc.jobType.id,
          components: { deleteMany: {}, create: newComponents },
        },
        include: { components: true, workCategory: true },
      });
      await recordChange(tx, {
        entityType: "RAB_ITEM",
        entityId: id,
        projectId: existing.projectId,
        itemName: saved.name,
        action: "SWITCH_JOB",
        beforeData: existing,
        afterData: saved,
        req,
      });
      return saved;
    });

    res.json({
      message: "Suntik harga AHSP berhasil dan akurat!",
      data: updated,
    });
  } catch (error) {
    console.error("Error Switch Job:", error);
    res
      .status(error.statusCode || 500)
      .json({ error: error.message || "Terjadi kesalahan pada server." });
  }
});

/** POST /rab-items/bulk-delete — Hapus massal berdasarkan kumpulan ID */
router.post(
  "/rab-items/bulk-delete",
  verifyToken,
  authorizeRoles("PROJECT_MANAGER", "PERENCANA"),
  async (req, res) => {
    try {
      const { ids } = req.body;

      // Cegat kalau datanya kosong
      if (!Array.isArray(ids) || ids.length === 0) {
        return res
          .status(400)
          .json({ error: "Tidak ada ID yang dikirim untuk dihapus." });
      }

      const existingItems = await prisma.rabItem.findMany({
        where: { id: { in: ids } },
        select: { id: true, projectId: true },
      });
      await assertRabItemsEditable(existingItems, ids);

      // SAPU JAGAT DELETE: Prisma langsung menghapus semua ID yang ada di dalam array
      const deleted = await prisma.rabItem.deleteMany({
        where: {
          id: { in: ids },
        },
      });

      res.json({ message: `Berhasil menghapus ${deleted.count} item RAB.` });
    } catch (error) {
      console.error("Error Bulk Delete RabItems:", error);
      res.status(error.statusCode || 500).json({
        error: error.message || "Terjadi kesalahan pada server saat menghapus massal.",
      });
    }
  },
);

/**
 * PUT /projects/:projectId/rab-items/bulk-price-by-name
 * (Sihir Sapu Jagat: Update harga massal berdasarkan NAMA item)
 */

router.put("/rab-items/bulk-price", async (req, res) => {
  try {
    const { ids, rapUnitPrice, overheadPercent } = req.body;

    // SUPER_ADMIN hanya boleh mengatur Overhead (%) — RAP tetap wewenang
    // perencana. Cegah tembus lewat endpoint bulk ini.
    if (req.user?.role === "SUPER_ADMIN" && rapUnitPrice !== undefined && rapUnitPrice !== null) {
      return res.status(403).json({
        error: "SUPER_ADMIN tidak boleh mengubah RAP Satuan. Hanya Overhead (%) yang dapat diubah.",
      });
    }

    if (!Array.isArray(ids) || ids.length === 0)
      return res
        .status(400)
        .json({ error: 'Field "ids" wajib diisi (array).' });

    if (rapUnitPrice === undefined && overheadPercent === undefined)
      return res.status(400).json({
        error: "Isi minimal salah satu: rapUnitPrice atau overheadPercent.",
      });

    const items = await prisma.rabItem.findMany({
      where: { id: { in: ids } },
      include: { components: true, workCategory: true },
    });
    await assertRabItemsEditable(items, ids);

    const results = [];
    const skipped = [];
    const clearedComponents = [];

    for (const existing of items) {
      const childCount = await prisma.rabItem.count({
        where: { parentId: existing.id },
      });
      if (childCount > 0) {
        skipped.push({ id: existing.id, reason: "Item Induk, dilewati." });
        continue;
      }

      const vol = Number(existing.volume);
      const hadComponents = existing.components.length > 0;

      const rapSatuan =
        rapUnitPrice !== undefined && rapUnitPrice !== null
          ? Number(rapUnitPrice)
          : Number(existing.rapUnitPrice);

      const overhead =
        overheadPercent !== undefined && overheadPercent !== null
          ? Number(overheadPercent)
          : Number(existing.overheadPercent || existing.overhead);

      const nilaiOverhead = rapSatuan * (overhead / 100);
      const rabSatuan = rapSatuan + nilaiOverhead;

      const rapTotal = rapSatuan * vol;
      const rabTotal = rabSatuan * vol;

      // Kalau harga di-override manual & item sebelumnya punya rincian AHSP,
      // hapus rincian biar gak nyangkut/gak sinkron
      const shouldClearComponents = hadComponents && rapUnitPrice !== undefined;

      const updated = await prisma.$transaction(async (tx) => {
        const saved = await tx.rabItem.update({
          where: { id: existing.id },
          data: {
            rapUnitPrice: rapSatuan,
            rapTotalPrice: rapTotal,
            overheadPercent: overhead,
            rabUnitPrice: rabSatuan,
            rabTotalPrice: rabTotal,
            ...(shouldClearComponents ? { components: { deleteMany: {} } } : {}),
          },
          include: { components: true },
        });
        await recordChange(tx, {
          entityType: "RAB_ITEM",
          entityId: existing.id,
          projectId: existing.projectId,
          itemName: saved.name,
          action: "BULK_UPDATE",
          beforeData: existing,
          afterData: saved,
          req,
        });
        return saved;
      });

      if (shouldClearComponents) clearedComponents.push(existing.id);
      results.push(updated);
    }

    res.json({
      message: `Berhasil update ${results.length} item. Dilewati ${skipped.length} item Induk.`,
      data: results,
      skipped,
      warning:
        clearedComponents.length > 0
          ? `${clearedComponents.length} item sebelumnya punya rincian AHSP, rincian dihapus karena harga di-override manual: ${clearedComponents.join(", ")}`
          : undefined,
    });
  } catch (error) {
    console.error("Error Bulk Update RabItem:", error);
    res
      .status(error.statusCode || 500)
      .json({ error: error.message || "Terjadi kesalahan pada server." });
  }
});

router.put("/rab-items/bulk-switch-job", verifyToken, authorizeRoles("PROJECT_MANAGER", "PERENCANA"), async (req, res) => {
  try {
    const { ids, newJobTypeId, customOverhead, ahspDiscipline, workCategoryId } = req.body;

    if (!Array.isArray(ids) || ids.length === 0)
      return res
        .status(400)
        .json({ error: 'Field "ids" wajib diisi (array).' });

    if (!newJobTypeId)
      return res
        .status(400)
        .json({ error: 'Field "newJobTypeId" wajib diisi.' });

    const calc = await calculateJobPrice(newJobTypeId);
    if (!calc)
      return res
        .status(404)
        .json({ error: "Jenis pekerjaan (master) tidak ditemukan." });

    const items = await prisma.rabItem.findMany({
      where: { id: { in: ids } },
      include: {
        project: { include: { workCategories: { include: { workCategory: true } } } },
        components: true,
      },
    });
    await assertRabItemsEditable(items, ids);

    const results = [];
    const skipped = [];

    for (const existing of items) {
      const childCount = await prisma.rabItem.count({
        where: { parentId: existing.id },
      });
      if (childCount > 0) {
        skipped.push({ id: existing.id, reason: "Item Induk, dilewati." });
        continue;
      }

      const scopeError = validateJobTypeForProject(
        calc.jobType,
        existing.project,
        existing.discipline || "GENERAL",
        ahspDiscipline,
        workCategoryId || existing.workCategoryId,
      );
      if (scopeError) {
        skipped.push({ id: existing.id, reason: scopeError });
        continue;
      }

      const vol = Number(existing.volume);

      const newComponents = Object.entries(calc.breakdown).flatMap(
        ([section, componentItems]) =>
          componentItems.map((item) => ({
            name: item.name,
            unit: item.unit,
            section,
            coefficient: item.coefficient,
            unitPrice: item.unitPrice,
            lineTotal: item.lineTotal,
          })),
      );

      const rapSatuan = newComponents.reduce(
        (sum, comp) => sum + Number(comp.lineTotal),
        0,
      );

      let overhead = 0;
      if (
        customOverhead !== undefined &&
        customOverhead !== null &&
        customOverhead !== ""
      ) {
        overhead = Number(customOverhead);
      } else if (calc.jobType.overhead != null) {
        overhead = normalizeAhspOverhead(calc.jobType.overhead);
      } else {
        overhead = Number(existing.overhead || 0);
      }

      const nilaiOverhead = rapSatuan * (overhead / 100);
      const rabSatuan = rapSatuan + nilaiOverhead;

      const rapTotal = rapSatuan * vol;
      const rabTotal = rabSatuan * vol;

      const updated = await prisma.$transaction(async (tx) => {
        const saved = await tx.rabItem.update({
          where: { id: existing.id },
          data: {
            category: calc.jobType.category,
            reference: calc.jobType.reference,
            discipline: calc.jobType.discipline,
            workCategoryId: workCategoryId || calc.jobType.workCategoryId || existing.workCategoryId,
            grade: calc.jobType.grade,
            overheadPercent: overhead,
            rapUnitPrice: rapSatuan,
            rapTotalPrice: rapTotal,
            rabUnitPrice: rabSatuan,
            rabTotalPrice: rabTotal,
            sourceJobTypeId: calc.jobType.id,
            components: {
              deleteMany: {},
              create: newComponents,
            },
          },
          include: { components: true },
        });
        await recordChange(tx, {
          entityType: "RAB_ITEM",
          entityId: existing.id,
          projectId: existing.projectId,
          itemName: saved.name,
          action: "SWITCH_JOB",
          beforeData: existing,
          afterData: saved,
          req,
        });
        return saved;
      });

      results.push(updated);
    }

    res.json({
      message: `Berhasil suntik AHSP ke ${results.length} item. Dilewati ${skipped.length} item Induk.`,
      data: results,
      skipped,
    });
  } catch (error) {
    console.error("Error Bulk Switch Job:", error);
    res
      .status(error.statusCode || 500)
      .json({ error: error.message || "Terjadi kesalahan pada server." });
  }
});

router.put(
  "/projects/:projectId/rab-items/bulk-price-by-name",
  verifyToken,
  authorizeRoles("PROJECT_MANAGER", "PERENCANA"),
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const { name, newUnitPrice } = req.body;

      await assertProjectEditable(prisma, projectId);

      if (!name || newUnitPrice === undefined) {
        return res
          .status(400)
          .json({ error: "Nama item dan harga baru wajib dikirim." });
      }

      // 1. Cari semua item di proyek ini yang namanya SAMA PERSIS
      const items = await prisma.rabItem.findMany({
        where: {
          projectId,
          name,
        },
        include: { components: true },
      });

      const updatedItems = await prisma.$transaction(async (tx) => {
        const savedItems = [];
        for (const item of items) {
          const rapSatuan = Number(newUnitPrice);
          const overhead = Number(item.overheadPercent || 0);
          const rabSatuan = rapSatuan + rapSatuan * (overhead / 100);
          const vol = Number(item.volume || 0);
          const saved = await tx.rabItem.update({
            where: { id: item.id },
            data: {
              rapUnitPrice: rapSatuan,
              rapTotalPrice: rapSatuan * vol,
              rabUnitPrice: rabSatuan,
              rabTotalPrice: rabSatuan * vol,
            },
            include: { components: true },
          });
          await recordChange(tx, {
            entityType: "RAB_ITEM",
            entityId: item.id,
            projectId,
            itemName: saved.name,
            action: "BULK_UPDATE",
            beforeData: item,
            afterData: saved,
            req,
          });
          savedItems.push(saved);
        }
        return savedItems;
      });

      res.json({
        message: `Berhasil update harga untuk ${updatedItems.length} item "${name}"`,
      });
    } catch (error) {
      console.error("Error Bulk Update by Name:", error);
      res.status(500).json({ error: "Terjadi kesalahan pada server." });
    }
  },
);

/**
 * POST /projects/:projectId/sync-finance
 * Fitur Snapshot: Mengunci RAB dan Merekap BOM (Bahan & Alat) ke Finance
 */
/**
 * POST /projects/:projectId/sync-finance
 * Merekap RAB menjadi Purchase Requisition (Daftar Permintaan Barang)
 */
/**
 * POST /projects/:projectId/sync-finance
 * Merekap RAB menjadi PR (Sesuai Urutan Hierarki Pekerjaan, Tanpa Digabung)
 */
function buildPath(node, nameKey = "name") {
  // Jalan ke atas rantai parent, kumpulin nama dari akar sampai node ini sendiri
  const names = [];
  let cur = node;
  while (cur) {
    names.unshift(cur[nameKey]);
    cur = cur.parent || null;
  }
  return names.join(" ▸ ");
}

// Tambahkan helper function ini di atas (sebelum router.post) atau di tempat utilities
const addDays = (date, days) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

// 2. Fungsi formatDate yang baru (DD/MM/YY)
const formatDate = (date) => {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear()).slice(-2);

  return `${day}/${month}/${year}`;
};

router.post(
  "/projects/:projectId/sync-finance",
  verifyToken,
  authorizeRoles("SUPER_ADMIN"),
  async (req, res) => {
  try {
    const { projectId } = req.params;

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        rabItems: {
          orderBy: { order: "asc" },
          include: {
            timeSchedule: true,
            components: true,
            group: { include: { parent: true } },
            parent: { include: { parent: true } },
            children: { select: { id: true } },
          },
        },
      },
    });

    if (!project)
      return res.status(404).json({ error: "Proyek tidak ditemukan" });

    const requestItemsData = [];

    project.rabItems.forEach((rabItem) => {
      // FIX: dulu baris ini `return` saat komponen kosong, sehingga Material Request
      // selalu KOSONG untuk item yang di-link dari BV (BV item tidak punya components).
      // Sekarang item tanpa komponen tetap dikirim sebagai 1 baris material.
      const isHeaderBv =
        rabItem.isHeaderOnly ||
        (Array.isArray(rabItem.children) && rabItem.children.length > 0);
      const itemsBefore = requestItemsData.length;

      // --- GROUP ---
      const groupName = rabItem.group ? buildPath(rabItem.group) : "Lainnya";

      // --- JOB ---
      const jobName = rabItem.parent ? buildPath(rabItem.parent) : rabItem.name;

      const jobDiscipline = project.discipline;
      const jobVolume = Number(rabItem.volume);

      // --- TIME SCHEDULE CALCULATION ---
      // TimeSchedule menyimpan tanggal aktual, bukan nomor minggu.
      const startDate = rabItem.timeSchedule?.startDate
        ? new Date(rabItem.timeSchedule.startDate)
        : null;
      const endDate = rabItem.timeSchedule?.endDate
        ? new Date(rabItem.timeSchedule.endDate)
        : null;
      let scheduleStr = null;

      if (
        startDate &&
        endDate &&
        !Number.isNaN(startDate.getTime()) &&
        !Number.isNaN(endDate.getTime())
      ) {
        scheduleStr =
          startDate.getTime() === endDate.getTime()
            ? formatDate(startDate)
            : `${formatDate(startDate)} - ${formatDate(endDate)}`;
      }

      rabItem.components.forEach((comp) => {
        if (comp.section === "UPAH") return;

        const itemVolume = Number(
          (Number(comp.coefficient) * jobVolume).toFixed(4),
        );
        const pricePerUnit = Number(comp.unitPrice);
        const itemTotal = itemVolume * pricePerUnit;

        requestItemsData.push({
          itemName: comp.name,
          unit: comp.unit,
          discipline: jobDiscipline,
          groupName,
          jobName,
          volumePekerjaan: jobVolume,
          estimatedVolume: itemVolume,
          pricePerUnit: pricePerUnit,
          totalPrice: itemTotal,
          scheduleRange: scheduleStr, // <-- Akan terisi format "DD/MM/YYYY - DD/MM/YYYY"
          catatanPerencana: req.body.catatan || null,
        });
      });

      // FIX lanjutan: kalau komponen kosong / semuanya bertipe UPAH, tetap kirim
      // 1 baris material memakai item RAB itu sendiri, supaya item tidak hilang.
      if (!isHeaderBv && requestItemsData.length === itemsBefore) {
        const volPolos = Number(rabItem.volume);
        const hargaPolos = Number(rabItem.rabUnitPrice);
        requestItemsData.push({
          itemName: rabItem.name,
          unit: rabItem.paymentUnit || "-",
          discipline: jobDiscipline,
          groupName,
          jobName,
          volumePekerjaan: volPolos,
          estimatedVolume: volPolos,
          pricePerUnit: hargaPolos,
          totalPrice: volPolos * hargaPolos,
          scheduleRange: scheduleStr,
          catatanPerencana: req.body.catatan || null,
        });
      }
    });

    const normalizeSyncKey = (value) =>
      String(value || "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();

    const makeSyncBaseKey = (item) => {
      const price = Number(item.pricePerUnit || 0);
      return [
        normalizeSyncKey(item.itemName),
        normalizeSyncKey(item.unit),
        normalizeSyncKey(item.discipline),
        normalizeSyncKey(item.groupName),
        normalizeSyncKey(item.jobName),
        normalizeSyncKey(item.scheduleRange),
        price.toFixed(6),
      ].join("||");
    };

    await prisma.$transaction(async (tx) => {
      const headers = await tx.materialRequest.findMany({
        where: { projectId },
        include: { items: { orderBy: { id: "asc" } } },
        orderBy: { createdAt: "desc" },
      });

      let activeHeader = headers[0] || null;
      if (!activeHeader) {
        activeHeader = await tx.materialRequest.create({
          data: { projectId },
          include: { items: true },
        });
      }

      const existingItems = Array.isArray(activeHeader.items)
        ? activeHeader.items
        : [];

      const existingCounts = new Map();
      const existingByKey = new Map();
      for (const row of existingItems) {
        const base = makeSyncBaseKey(row);
        const seq = (existingCounts.get(base) || 0) + 1;
        existingCounts.set(base, seq);
        const syncKey = `${base}__${seq}`;
        if (!existingByKey.has(syncKey)) {
          existingByKey.set(syncKey, row);
        }
      }

      const generatedCounts = new Map();
      for (const row of requestItemsData) {
        const base = makeSyncBaseKey(row);
        const seq = (generatedCounts.get(base) || 0) + 1;
        generatedCounts.set(base, seq);
        const syncKey = `${base}__${seq}`;

        const payload = {
          itemName: row.itemName,
          unit: row.unit,
          discipline: row.discipline,
          groupName: row.groupName,
          jobName: row.jobName,
          volumePekerjaan: row.volumePekerjaan,
          estimatedVolume: row.estimatedVolume,
          pricePerUnit: row.pricePerUnit,
          totalPrice: row.totalPrice,
          scheduleRange: row.scheduleRange,
          catatanPerencana: row.catatanPerencana,
        };

        const existing = existingByKey.get(syncKey);
        if (existing) {
          await tx.materialRequestItem.update({
            where: { id: existing.id },
            data: payload,
          });
          existingByKey.delete(syncKey);
        } else {
          await tx.materialRequestItem.create({
            data: {
              ...payload,
              headerId: activeHeader.id,
            },
          });
        }
      }

      // Tidak menghapus item lama yang tidak ada di sinkron terbaru.
      // Ini sengaja untuk mencegah reset histori PO saat kirim-ulang finance.

      await tx.project.update({
        where: { id: projectId },
        data: { rabStatus: "LOCKED" },
      });
    });

    res.json({ message: "Berhasil! Data dikirim dengan judul bersih." });
  } catch (error) {
    console.error("Sync Finance Error:", error);
    res.status(500).json({ error: "Gagal mengirim data ke Finance." });
  }
  },
);

/** PUT /material-request-items/finance-update-bulk
 * Finance update banyak item sekaligus (orderedVolume, catatanFinance)
 * Status auto-derive dari orderedVolume vs estimatedVolume
 */
router.put(
  "/material-request-items/finance-update-bulk",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "FINANCE"),
  async (req, res) => {
    try {
      const { items } = req.body; // [{ id, orderedVolume, catatanFinance }, ...]

      if (!Array.isArray(items) || items.length === 0)
        return res
          .status(400)
          .json({ error: 'Field "items" wajib diisi (array).' });

      const ids = items.map((i) => i.id);
      const existingItems = await prisma.materialRequestItem.findMany({
        where: { id: { in: ids } },
      });
      const existingMap = new Map(existingItems.map((e) => [e.id, e]));

      const results = [];
      const skipped = [];

      for (const item of items) {
        const existing = existingMap.get(item.id);
        if (!existing) {
          skipped.push({ id: item.id, reason: "Item tidak ditemukan." });
          continue;
        }

        const newOrderedVolume =
          item.orderedVolume !== undefined
            ? Number(item.orderedVolume)
            : Number(existing.orderedVolume);

        // status DIHAPUS dari sini — sekarang ditentukan dari receivedVolume
        // lewat endpoint /material-requests/items/:id/receive (input lapangan)

        const updated = await prisma.materialRequestItem.update({
          where: { id: item.id },
          data: {
            orderedVolume: newOrderedVolume,
            ...(item.catatanFinance !== undefined
              ? { catatanFinance: item.catatanFinance }
              : {}),
          },
        });

        results.push(updated);
      }

      res.json({
        message: `Berhasil update procurement ${results.length} item. Dilewati ${skipped.length} item.`,
        data: results,
        skipped,
      });
    } catch (error) {
      console.error("Error Finance Update Bulk:", error);
      res
        .status(500)
        .json({ error: error.message || "Terjadi kesalahan pada server." });
    }
  },
);

/**
 * 2. POST /projects/:projectId/cancel-finance
 * Menarik kembali data dari Finance dan membuka kunci RAB (kembali ke DRAFT)
 */
router.post(
  "/projects/:projectId/cancel-finance",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "PERENCANA"),
  async (req, res) => {
    try {
      const { projectId } = req.params;

      const project = await prisma.project.findUnique({
        where: { id: projectId },
      });

      if (!project)
        return res.status(404).json({ error: "Proyek tidak ditemukan" });

      if (project.rabStatus !== "LOCKED") {
        return res.status(400).json({
          error: "RAB belum dikirim ke Finance, tidak ada yang perlu ditarik.",
        });
      }

      await prisma.$transaction(async (tx) => {
        // Jangan hapus Material Request agar histori PO/procurement tidak reset.
        // Cukup buka lock supaya RAB bisa direvisi lalu sinkron ulang parsial.
        await tx.project.update({
          where: { id: projectId },
          data: { rabStatus: "DRAFT" },
        });
      });

      res.json({
        message: "Batal Kirim Berhasil! RAB kembali terbuka (DRAFT) tanpa mereset data procurement.",
      });
    } catch (error) {
      console.error("Cancel Finance Error:", error);
      res
        .status(500)
        .json({ error: "Gagal membatalkan pengiriman ke Finance." });
    }
  },
);

module.exports = router;
