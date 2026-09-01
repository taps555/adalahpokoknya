"use strict";

const express = require("express");
// Naik dua tingkat (keluar dari CRUDRAB, lalu keluar dari routes)
const prisma = require("../../lib/prisma");
const { calculateJobPrice } = require("../../services/calculateService");
const { verifyToken, authorizeRoles } = require("../../middleware/auth");

const router = express.Router();

router.post("/projects/:projectId/rab-items", async (req, res) => {
  return res.status(400).json({
    error:
      "RAB item hanya bisa dibuat lewat BV. Gunakan POST /bv-items/:id/link-to-rab.",
  });
});

router.get("/projects/:projectId/rab-items", async (req, res) => {
  try {
    const { projectId } = req.params;
    const { discipline } = req.query;
    const items = await prisma.rabItem.findMany({
      where: {
        projectId,
        ...(discipline ? { discipline } : {}),
      },
      include: { components: true },
      orderBy: [{ order: "asc" }],
    });
    res.json(items);
  } catch (error) {
    console.error("Error List RabItem:", error);
    res.status(500).json({ error: "Terjadi kesalahan pada server." });
  }
});

/** PUT /rab-items/:id — edit item RAB (volume, harga custom, dll), isolated dari master */
router.put("/rab-items/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const {
      rapUnitPrice,
      overheadPercent,
      components,
      groupId,
      isByOwner,
      isStip,
    } = req.body;

    const existing = await prisma.rabItem.findUnique({ where: { id } });
    if (!existing)
      return res.status(404).json({ error: "Item RAB tidak ditemukan." });

    // ==========================================
    // 🚨 KODE SATPAM: CEK APAKAH DIA INDUK? 🚨
    // ==========================================
    const childCount = await prisma.rabItem.count({ where: { parentId: id } });
    const isInduk = childCount > 0;

    if (isInduk) {
      // JIKA INDUK: Paksa harga dan volume jadi null (Karena dia cuma Judul)
      // Abaikan komponen atau harga yang mungkin dikirim dari Frontend
      const updatedInduk = await prisma.rabItem.update({
        where: { id },
        data: {
          volume: null,
          rapUnitPrice: null,
          rapTotalPrice: null,
          rabUnitPrice: null,
          rabTotalPrice: null, // Totalnya dikosongkan (nanti dihitung SUM di Frontend saat render)

          // Tetap izinkan update hal-hal administratif (misal pindah Grup)
          ...(groupId !== undefined ? { groupId: groupId || null } : {}),
          ...(isByOwner !== undefined ? { isByOwner } : {}),
          ...(isStip !== undefined ? { isStip } : {}),
        },
        include: { components: true },
      });

      // Hapus jika ada komponen bahan nyangkut di si Induk
      await prisma.rabItemComponent.deleteMany({ where: { rabItemId: id } });

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
    const rabSatuan = rapSatuan + nilaiOverhead;

    const rapTotal = rapSatuan * vol;
    const rabTotal = rabSatuan * vol;

    // 3. SIMPAN KE DATABASE
    const updated = await prisma.rabItem.update({
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
      include: { components: true },
    });

    res.json({ message: "Item RAB berhasil diperbarui", data: updated });
  } catch (error) {
    console.error("Error Update RabItem:", error);
    res
      .status(500)
      .json({ error: error.message || "Terjadi kesalahan pada server." });
  }
});
/** DELETE /rab-items/:id */
router.delete("/rab-items/:id", async (req, res) => {
  try {
    await prisma.rabItem.delete({ where: { id: req.params.id } });
    res.json({ message: "Item RAB berhasil dihapus." });
  } catch (error) {
    if (error.code === "P2025") {
      return res.status(404).json({ error: "Item RAB tidak ditemukan." });
    }
    console.error("Error Delete RabItem:", error);
    res.status(500).json({ error: "Terjadi kesalahan pada server." });
  }
});

//atas no revisi

/** PUT /rab-items/:id/switch-job — ganti sumber JobType master, tarik rincian AHSP */
router.put("/rab-items/:id/switch-job", async (req, res) => {
  try {
    const { id } = req.params;
    // ===== [TAMBAHAN 1]: Tangkap customOverhead dari request body =====
    const { newJobTypeId, customOverhead } = req.body;

    if (!newJobTypeId)
      return res
        .status(400)
        .json({ error: 'Field "newJobTypeId" wajib diisi.' });

    const existing = await prisma.rabItem.findUnique({ where: { id } });
    if (!existing)
      return res.status(404).json({ error: "Item RAB tidak ditemukan." });

    const calc = await calculateJobPrice(newJobTypeId);
    if (!calc)
      return res
        .status(404)
        .json({ error: "Jenis pekerjaan (master) tidak ditemukan." });

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
    } else if (calc.jobType.overhead) {
      overhead = Number(calc.jobType.overhead);
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
    const updated = await prisma.rabItem.update({
      where: { id },
      data: {
        // Nama dan paymentUnit sengaja tidak diubah agar teks BV aman
        category: calc.jobType.category,
        reference: calc.jobType.reference,
        discipline: calc.jobType.discipline,
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

    res.json({
      message: "Suntik harga AHSP berhasil dan akurat!",
      data: updated,
    });
  } catch (error) {
    console.error("Error Switch Job:", error);
    res
      .status(500)
      .json({ error: error.message || "Terjadi kesalahan pada server." });
  }
});

/** DELETE /rab-items/:id */
router.delete("/rab-items/:id", async (req, res) => {
  try {
    await prisma.rabItem.delete({ where: { id: req.params.id } });
    res.json({ message: "Item RAB berhasil dihapus." });
  } catch (error) {
    if (error.code === "P2025") {
      return res.status(404).json({ error: "Item RAB tidak ditemukan." });
    }
    console.error("Error Delete RabItem:", error);
    res.status(500).json({ error: "Terjadi kesalahan pada server." });
  }
});

/** POST /rab-items/bulk-delete — Hapus massal berdasarkan kumpulan ID */
router.post(
  "/rab-items/bulk-delete",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "PERENCANA"),
  async (req, res) => {
    try {
      const { ids } = req.body;

      // Cegat kalau datanya kosong
      if (!Array.isArray(ids) || ids.length === 0) {
        return res
          .status(400)
          .json({ error: "Tidak ada ID yang dikirim untuk dihapus." });
      }

      // SAPU JAGAT DELETE: Prisma langsung menghapus semua ID yang ada di dalam array
      const deleted = await prisma.rabItem.deleteMany({
        where: {
          id: { in: ids },
        },
      });

      res.json({ message: `Berhasil menghapus ${deleted.count} item RAB.` });
    } catch (error) {
      console.error("Error Bulk Delete RabItems:", error);
      res.status(500).json({
        error: "Terjadi kesalahan pada server saat menghapus massal.",
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
      include: { components: true },
    });

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

      const updated = await prisma.rabItem.update({
        where: { id: existing.id },
        data: {
          rapUnitPrice: rapSatuan,
          rapTotalPrice: rapTotal,
          overheadPercent: overhead,
          rabUnitPrice: rabSatuan,
          rabTotalPrice: rabTotal,
          ...(shouldClearComponents ? { components: { deleteMany: {} } } : {}),
        },
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
      .status(500)
      .json({ error: error.message || "Terjadi kesalahan pada server." });
  }
});

router.put("/rab-items/bulk-switch-job", async (req, res) => {
  try {
    const { ids, newJobTypeId, customOverhead } = req.body;

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

    const items = await prisma.rabItem.findMany({ where: { id: { in: ids } } });

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
      } else if (calc.jobType.overhead) {
        overhead = Number(calc.jobType.overhead);
      } else {
        overhead = Number(existing.overhead || 0);
      }

      const nilaiOverhead = rapSatuan * (overhead / 100);
      const rabSatuan = rapSatuan + nilaiOverhead;

      const rapTotal = rapSatuan * vol;
      const rabTotal = rabSatuan * vol;

      const updated = await prisma.rabItem.update({
        where: { id: existing.id },
        data: {
          category: calc.jobType.category,
          reference: calc.jobType.reference,
          discipline: calc.jobType.discipline,
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
      .status(500)
      .json({ error: error.message || "Terjadi kesalahan pada server." });
  }
});

router.put(
  "/projects/:projectId/rab-items/bulk-price-by-name",
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const { name, newUnitPrice } = req.body;

      if (!name || newUnitPrice === undefined) {
        return res
          .status(400)
          .json({ error: "Nama item dan harga baru wajib dikirim." });
      }

      // 1. Cari semua item di proyek ini yang namanya SAMA PERSIS
      const items = await prisma.rabItem.findMany({
        where: {
          projectId: projectId,
          name: name,
        },
      });

      // 2. Siapkan hitungan matematika untuk masing-masing baris
      // (Karena volume tiap ruangan kan beda-beda)
      const updatePromises = items.map((item) => {
        const rapSatuan = Number(newUnitPrice);
        const overhead = Number(item.overheadPercent || 0);
        const rabSatuan = rapSatuan + rapSatuan * (overhead / 100);
        const vol = Number(item.volume || 0);

        // Siapkan antrian update untuk Prisma
        return prisma.rabItem.update({
          where: { id: item.id },
          data: {
            rapUnitPrice: rapSatuan,
            rapTotalPrice: rapSatuan * vol,
            rabUnitPrice: rabSatuan,
            rabTotalPrice: rabSatuan * vol,
          },
        });
      });

      // 3. Eksekusi semua antrian sekaligus (Sangat ringan untuk server!)
      await prisma.$transaction(updatePromises);

      res.json({
        message: `Berhasil update harga untuk ${items.length} item "${name}"`,
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

router.post("/projects/:projectId/sync-finance", async (req, res) => {
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
          },
        },
      },
    });

    if (!project)
      return res.status(404).json({ error: "Proyek tidak ditemukan" });

    const requestItemsData = [];

    project.rabItems.forEach((rabItem) => {
      if (!rabItem.components || rabItem.components.length === 0) return;

      // --- GROUP ---
      const groupName = rabItem.group ? buildPath(rabItem.group) : "Lainnya";

      // --- JOB ---
      const jobName = rabItem.parent ? buildPath(rabItem.parent) : rabItem.name;

      const jobDiscipline = project.discipline;
      const jobVolume = Number(rabItem.volume);

      // --- TIME SCHEDULE CALCULATION ---
      const startW = rabItem.timeSchedule?.startWeek || null;
      const endW = rabItem.timeSchedule?.endWeek || null;
      let scheduleStr = null;

      if (startW !== null && endW !== null) {
        if (project.startDate) {
          // Jika proyek punya startDate, konversi Week menjadi Tanggal
          const projectStart = new Date(project.startDate);

          // Mulai minggu ke-N: startDate + ((startWeek - 1) * 7 hari)
          const startTaskDate = addDays(projectStart, (startW - 1) * 7);

          // Akhir minggu ke-N: startDate + (endWeek * 7 hari) - 1 hari
          const endTaskDate = addDays(projectStart, endW * 7 - 1);

          scheduleStr = `${formatDate(startTaskDate)} - ${formatDate(endTaskDate)}`;
        } else {
          // Fallback jika project.startDate belum diisi (masih null)
          scheduleStr =
            startW === endW ? `W${startW}` : `W${startW} - W${endW}`;
        }
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
    });

    await prisma.$transaction(async (tx) => {
      // Bersihkan data lama jika ada
      await tx.materialRequest.deleteMany({
        where: { projectId: projectId },
      });

      // Buat header baru
      const mr = await tx.materialRequest.create({
        data: { projectId: projectId },
      });

      // Simpan rincian barang
      const insertData = requestItemsData.map((item) => ({
        ...item,
        headerId: mr.id,
      }));
      if (insertData.length > 0) {
        await tx.materialRequestItem.createMany({ data: insertData });
      }

      // Kunci proyek
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
});

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

        let status;
        if (newOrderedVolume <= 0) status = "PENDING";
        else if (newOrderedVolume < Number(existing.estimatedVolume))
          status = "PARTIAL";
        else status = "COMPLETED";

        const updated = await prisma.materialRequestItem.update({
          where: { id: item.id },
          data: {
            orderedVolume: newOrderedVolume,
            status,
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
        await tx.materialRequest.deleteMany({
          where: { projectId: projectId },
        });

        await tx.project.update({
          where: { id: projectId },
          data: { rabStatus: "DRAFT" },
        });
      });

      res.json({
        message: "Batal Kirim Berhasil! RAB kembali terbuka (DRAFT).",
      });
    } catch (error) {
      console.error("Cancel Finance Error:", error);
      res
        .status(500)
        .json({ error: "Gagal membatalkan pengiriman ke Finance." });
    }
  },
);

router.get("/projects/:projectId/material-requests", async (req, res) => {
  try {
    const { projectId } = req.params;

    const headers = await prisma.materialRequest.findMany({
      where: { projectId },
      include: { items: true },
      orderBy: { createdAt: "desc" },
    });

    res.json(headers);
  } catch (error) {
    console.error("Error List MaterialRequest:", error);
    res.status(500).json({ error: "Terjadi kesalahan pada server." });
  }
});

module.exports = router;
