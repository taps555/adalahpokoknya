"use strict";

const express = require("express");
// Naik dua tingkat (keluar dari CRUDRAB, lalu keluar dari routes)
const prisma = require("../../lib/prisma");
const { calculateJobPrice } = require("../../services/calculateService");

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
      await prisma.rabComponent.deleteMany({ where: { rabItemId: id } });

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
router.post("/rab-items/bulk-delete", async (req, res) => {
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
    res
      .status(500)
      .json({ error: "Terjadi kesalahan pada server saat menghapus massal." });
  }
});

/**
 * PUT /projects/:projectId/rab-items/bulk-price-by-name
 * (Sihir Sapu Jagat: Update harga massal berdasarkan NAMA item)
 */
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

module.exports = router;
