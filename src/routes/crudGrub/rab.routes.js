"use strict";

const express = require("express");
// Naik dua tingkat (keluar dari CRUDRAB, lalu keluar dari routes)
const prisma = require("../../lib/prisma");
const { calculateJobPrice } = require("../../services/calculateService");

const router = express.Router();

/**
 * POST /projects/:projectId/rab-items
 *
 * Dua mode:
 * 1) Dari master JobType (snapshot):
 *    { "sourceJobTypeId": "xxx", "volume": 12.5 }
 *
 * 2) Custom langsung (tanpa master):
 *    {
 *      "name": "...", "paymentUnit": "m2", "category": "...", "reference": "...",
 *      "overhead": 0.1, "volume": 12.5,
 *      "components": [
 *        { "name": "Pekerja", "unit": "OH", "section": "UPAH", "coefficient": 0.3, "unitPrice": 130000 }
 *      ]
 *    }
 */

router.post("/projects/:projectId/rab-items", async (req, res) => {
  return res.status(400).json({
    error:
      "RAB item hanya bisa dibuat lewat BV. Gunakan POST /bv-items/:id/link-to-rab.",
  });
});
// router.post('/projects/:projectId/rab-items', async (req, res) => {
//   try {
//     const { projectId } = req.params;
//     const { sourceJobTypeId, volume, name, paymentUnit, category, reference, overhead, components, groupId } = req.body;

//     if (volume == null || Number(volume) <= 0) {
//       return res.status(400).json({ error: 'Field "volume" wajib diisi dan harus > 0.' });
//     }

//     const project = await prisma.project.findUnique({ where: { id: projectId } });
//     if (!project) return res.status(404).json({ error: 'Project tidak ditemukan.' });

//     if (groupId) {
//       const group = await prisma.rabGroup.findUnique({ where: { id: groupId } });
//       if (!group) return res.status(404).json({ error: 'Group/Sub-Group tidak ditemukan.' });
//       if (group.projectId !== projectId) {
//         return res.status(400).json({ error: 'Group bukan milik project ini.' });
//       }
//     }

//     let rabItemData;

//     if (sourceJobTypeId) {
//       // ---- MODE 1: snapshot dari master JobType ----
//       const calc = await calculateJobPrice(sourceJobTypeId);
//       if (!calc) return res.status(404).json({ error: 'Jenis pekerjaan (master) tidak ditemukan.' });

//       const vol = Number(volume);
//       const rapUnitPrice = calc.total;
//       const rabUnitPrice = req.body.rabUnitPrice != null ? Number(req.body.rabUnitPrice) : rapUnitPrice;

//       rabItemData = {
//         projectId,
//         groupId: groupId || null,
//         name: calc.jobType.name,
//         paymentUnit: calc.jobType.paymentUnit,
//         category: calc.jobType.category,
//         reference: calc.jobType.reference,
//         discipline: calc.jobType.discipline,   // <-- TAMBAH
//         grade: calc.jobType.grade,             // <-- TAMBAH
//         overhead: calc.jobType.overhead,
//         volume: vol,
//         rapUnitPrice,
//         rapTotalPrice: rapUnitPrice * vol,
//         rabUnitPrice,
//         rabTotalPrice: rabUnitPrice * vol,
//         sourceJobTypeId: calc.jobType.id,
//         components: {
//           create: Object.entries(calc.breakdown).flatMap(([section, items]) =>
//             items.map((item) => ({
//               name: item.name,
//               unit: item.unit,
//               section,
//               coefficient: item.coefficient,
//               unitPrice: item.unitPrice,
//               lineTotal: item.lineTotal,
//             }))
//           ),
//         },
//       };
//     } else {
//       // ---- MODE 2: custom, tanpa master ----
//       if (!name || !paymentUnit) {
//         return res.status(400).json({ error: 'Field "name" dan "paymentUnit" wajib diisi untuk item custom.' });
//       }
//       if (!Array.isArray(components) || components.length === 0) {
//         return res.status(400).json({ error: 'Minimal harus ada 1 komponen (bahan/upah/alat).' });
//       }

//       const overheadPct = overhead != null ? Number(overhead) : 0.1;
//       let baseTotal = 0;
//       const componentRows = components.map((c) => {
//         if (!c.name || !c.unit || !c.section || c.coefficient == null || c.unitPrice == null) {
//           throw new Error(`Komponen custom tidak lengkap: ${JSON.stringify(c)}`);
//         }
//         const lineTotal = Number(c.coefficient) * Number(c.unitPrice);
//         baseTotal += lineTotal;
//         return {
//           name: c.name,
//           unit: c.unit,
//           section: c.section,
//           coefficient: c.coefficient,
//           unitPrice: c.unitPrice,
//           lineTotal,
//         };
//       });

//       const overheadValue = baseTotal * overheadPct;
//       const rapUnitPrice = baseTotal + overheadValue;
//       const vol = Number(volume);
//       const rabUnitPrice = req.body.rabUnitPrice != null ? Number(req.body.rabUnitPrice) : rapUnitPrice;

//       rabItemData = {
//         projectId,
//         groupId: groupId || null,
//         name,
//         paymentUnit,
//         category: category || null,
//         reference: reference || null,
//         overhead: overheadPct,
//         volume: vol,
//         rapUnitPrice,
//         rapTotalPrice: rapUnitPrice * vol,
//         rabUnitPrice,
//         rabTotalPrice: rabUnitPrice * vol,
//         sourceJobTypeId: null,
//         components: { create: componentRows },
//       };
//     }

//     const rabItem = await prisma.rabItem.create({
//       data: rabItemData,
//       include: { components: true },
//     });

//     res.status(201).json({ message: 'Item RAB berhasil ditambahkan', data: rabItem });
//   } catch (error) {
//     console.error('Error Create RabItem:', error);
//     res.status(500).json({ error: error.message || 'Terjadi kesalahan pada server.' });
//   }
// });

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
        overhead: overhead,
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

/** PUT /rab-items/:id/switch-job — ganti sumber JobType master, re-snapshot semua field */
// router.put("/rab-items/:id/switch-job", async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { newJobTypeId } = req.body;
//     if (!newJobTypeId)
//       return res
//         .status(400)
//         .json({ error: 'Field "newJobTypeId" wajib diisi.' });

//     const existing = await prisma.rabItem.findUnique({ where: { id } });
//     if (!existing)
//       return res.status(404).json({ error: "Item RAB tidak ditemukan." });

//     const calc = await calculateJobPrice(newJobTypeId);
//     if (!calc)
//       return res
//         .status(404)
//         .json({ error: "Jenis pekerjaan (master) tidak ditemukan." });

//     const vol = Number(existing.volume);

//     // ==========================================
//     // RUMUS INTINYA SAAT SWITCH JOB DARI MASTER
//     // ==========================================
//     const rapSatuan = calc.total; // calc.total adalah modal murni dari master

//     // Ambil overhead dari master (jika ada), jika tidak pakai yang existing
//     const overhead = calc.jobType.overhead
//       ? Number(calc.jobType.overhead)
//       : Number(existing.overheadPercent);

//     const nilaiOverhead = rapSatuan * (overhead / 100);
//     const rabSatuan = rapSatuan + nilaiOverhead;

//     const rapTotal = rapSatuan * vol;
//     const rabTotal = rabSatuan * vol;

//     const updated = await prisma.rabItem.update({
//       where: { id },
//       data: {
//         name: calc.jobType.name,
//         paymentUnit: calc.jobType.paymentUnit,
//         category: calc.jobType.category,
//         reference: calc.jobType.reference,
//         discipline: calc.jobType.discipline,
//         grade: calc.jobType.grade,

//         overhead: overhead, // <-- Field diperbarui sesuai skema baru
//         rapUnitPrice: rapSatuan,
//         rapTotalPrice: rapTotal,
//         rabUnitPrice: rabSatuan, // <-- Sudah auto + Overhead
//         rabTotalPrice: rabTotal,

//         sourceJobTypeId: calc.jobType.id,
//         components: {
//           deleteMany: {},
//           create: Object.entries(calc.breakdown).flatMap(([section, items]) =>
//             items.map((item) => ({
//               name: item.name,
//               unit: item.unit,
//               section,
//               coefficient: item.coefficient,
//               unitPrice: item.unitPrice,
//               lineTotal: item.lineTotal,
//             })),
//           ),
//         },
//       },
//       include: { components: true },
//     });

//     res.json({ message: "Jenis pekerjaan berhasil diganti", data: updated });
//   } catch (error) {
//     console.error("Error Switch Job:", error);
//     res
//       .status(500)
//       .json({ error: error.message || "Terjadi kesalahan pada server." });
//   }
// });

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

        overhead: overhead,
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

/** GET /projects/:projectId/rab-items — list RAB items milik satu project */
// router.get("/projects/:projectId/rab-items", async (req, res) => {
//   try {
//     const { projectId } = req.params;
//     const { discipline } = req.query;
//     const items = await prisma.rabItem.findMany({
//       where: {
//         projectId,
//         ...(discipline ? { discipline } : {}),
//       },
//       include: { components: true },
//       orderBy: [{ order: "asc" }],
//     });
//     res.json(items);
//   } catch (error) {
//     console.error("Error List RabItem:", error);
//     res.status(500).json({ error: "Terjadi kesalahan pada server." });
//   }
// });

// /** PUT /rab-items/:id — edit item RAB (volume, harga custom, dll), isolated dari master */
// router.put("/rab-items/:id", async (req, res) => {
//   try {
//     const { id } = req.params;
//     const {
//       rabUnitPrice,
//       rapUnitPrice,
//       components,
//       groupId,
//       isByOwner,
//       isStip,
//     } = req.body;

//     const existing = await prisma.rabItem.findUnique({ where: { id } });
//     if (!existing)
//       return res.status(404).json({ error: "Item RAB tidak ditemukan." });

//     let rapUnitPrice_final = Number(existing.rapUnitPrice);
//     let componentUpdate;

//     if (Array.isArray(components)) {
//       let baseTotal = 0;
//       const rows = components.map((c) => {
//         const lineTotal = Number(c.coefficient) * Number(c.unitPrice);
//         baseTotal += lineTotal;
//         return {
//           name: c.name,
//           unit: c.unit,
//           section: c.section,
//           coefficient: c.coefficient,
//           unitPrice: c.unitPrice,
//           lineTotal,
//         };
//       });
//       const overheadPct =
//         existing.overhead != null ? Number(existing.overhead) : 0.1;
//       rapUnitPrice_final = baseTotal + baseTotal * overheadPct;
//       componentUpdate = { deleteMany: {}, create: rows };
//     } else if (rapUnitPrice != null) {
//       rapUnitPrice_final = Number(rapUnitPrice);
//     }

//     const vol = Number(existing.volume); // volume TIDAK bisa diubah di sini, harus lewat BV + Sync
//     const rabPrice =
//       rabUnitPrice != null
//         ? Number(rabUnitPrice)
//         : Number(existing.rabUnitPrice);

//     const updated = await prisma.rabItem.update({
//       where: { id },
//       data: {
//         rapUnitPrice: rapUnitPrice_final,
//         rapTotalPrice: rapUnitPrice_final * vol,
//         rabUnitPrice: rabPrice,
//         rabTotalPrice: rabPrice * vol,
//         ...(componentUpdate ? { components: componentUpdate } : {}),
//         ...(groupId !== undefined ? { groupId: groupId || null } : {}),
//         ...(isByOwner !== undefined ? { isByOwner } : {}),
//         ...(isStip !== undefined ? { isStip } : {}),
//       },
//       include: { components: true },
//     });
//     res.json({ message: "Item RAB berhasil diperbarui", data: updated });
//   } catch (error) {
//     console.error("Error Update RabItem:", error);
//     res
//       .status(500)
//       .json({ error: error.message || "Terjadi kesalahan pada server." });
//   }
// });

// /** PUT /rab-items/:id/switch-job — ganti sumber JobType master, re-snapshot semua field */
// router.put("/rab-items/:id/switch-job", async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { newJobTypeId } = req.body;
//     if (!newJobTypeId)
//       return res
//         .status(400)
//         .json({ error: 'Field "newJobTypeId" wajib diisi.' });

//     const existing = await prisma.rabItem.findUnique({ where: { id } });
//     if (!existing)
//       return res.status(404).json({ error: "Item RAB tidak ditemukan." });

//     const calc = await calculateJobPrice(newJobTypeId);
//     if (!calc)
//       return res
//         .status(404)
//         .json({ error: "Jenis pekerjaan (master) tidak ditemukan." });

//     const vol = Number(existing.volume);
//     const rapUnitPrice = calc.total;

//     const updated = await prisma.rabItem.update({
//       where: { id },
//       data: {
//         name: calc.jobType.name,
//         paymentUnit: calc.jobType.paymentUnit,
//         category: calc.jobType.category,
//         reference: calc.jobType.reference,
//         discipline: calc.jobType.discipline, // <-- TAMBAH
//         grade: calc.jobType.grade, // <-- TAMBAH
//         overhead: calc.jobType.overhead,
//         rapUnitPrice,
//         rapTotalPrice: rapUnitPrice * vol,
//         rabUnitPrice: rapUnitPrice, // reset ke RAP, user isi ulang manual kalau perlu beda
//         rabTotalPrice: rapUnitPrice * vol,
//         sourceJobTypeId: calc.jobType.id,
//         components: {
//           deleteMany: {},
//           create: Object.entries(calc.breakdown).flatMap(([section, items]) =>
//             items.map((item) => ({
//               name: item.name,
//               unit: item.unit,
//               section,
//               coefficient: item.coefficient,
//               unitPrice: item.unitPrice,
//               lineTotal: item.lineTotal,
//             })),
//           ),
//         },
//       },
//       include: { components: true },
//     });

//     res.json({ message: "Jenis pekerjaan berhasil diganti", data: updated });
//   } catch (error) {
//     console.error("Error Switch Job:", error);
//     res
//       .status(500)
//       .json({ error: error.message || "Terjadi kesalahan pada server." });
//   }
// });

// /** DELETE /rab-items/:id */
// router.delete("/rab-items/:id", async (req, res) => {
//   try {
//     await prisma.rabItem.delete({ where: { id: req.params.id } });
//     res.json({ message: "Item RAB berhasil dihapus." });
//   } catch (error) {
//     if (error.code === "P2025") {
//       return res.status(404).json({ error: "Item RAB tidak ditemukan." });
//     }
//     console.error("Error Delete RabItem:", error);
//     res.status(500).json({ error: "Terjadi kesalahan pada server." });
//   }
// });

module.exports = router;

// router.put("/rab-items/:id", async (req, res) => {
//   try {
//     const { id } = req.params;
//     const {
//       name,
//       paymentUnit,
//       category,
//       reference,
//       overhead,
//       volume,
//       rabUnitPrice,
//       groupId,
//       components,
//     } = req.body;

//     const existing = await prisma.rabItem.findUnique({ where: { id } });
//     if (!existing)
//       return res.status(404).json({ error: "Item RAB tidak ditemukan." });

//     if (groupId) {
//       const group = await prisma.rabGroup.findUnique({
//         where: { id: groupId },
//       });
//       if (!group)
//         return res
//           .status(404)
//           .json({ error: "Group/Sub-Group tidak ditemukan." });
//       if (group.projectId !== existing.projectId) {
//         return res
//           .status(400)
//           .json({ error: "Group bukan milik project ini." });
//       }
//     }

//     let rapUnitPrice = Number(existing.rapUnitPrice);
//     let componentUpdate;
//     const overheadPct =
//       overhead != null
//         ? Number(overhead)
//         : existing.overhead != null
//           ? Number(existing.overhead)
//           : 0.1;

//     if (Array.isArray(components)) {
//       let baseTotal = 0;
//       const rows = components.map((c) => {
//         const lineTotal = Number(c.coefficient) * Number(c.unitPrice);
//         baseTotal += lineTotal;
//         return {
//           name: c.name,
//           unit: c.unit,
//           section: c.section,
//           coefficient: c.coefficient,
//           unitPrice: c.unitPrice,
//           lineTotal,
//         };
//       });
//       rapUnitPrice = baseTotal + baseTotal * overheadPct;
//       componentUpdate = { deleteMany: {}, create: rows };
//     }

//     const vol = volume != null ? Number(volume) : Number(existing.volume);
//     const rabPrice =
//       rabUnitPrice != null
//         ? Number(rabUnitPrice)
//         : Number(existing.rabUnitPrice);

//     const updated = await prisma.rabItem.update({
//       where: { id },
//       data: {
//         ...(name !== undefined ? { name } : {}),
//         ...(paymentUnit !== undefined ? { paymentUnit } : {}),
//         ...(category !== undefined ? { category } : {}),
//         ...(reference !== undefined ? { reference } : {}),
//         ...(overhead !== undefined ? { overhead: overheadPct } : {}),
//         ...(groupId !== undefined ? { groupId: groupId || null } : {}),
//         volume: vol,
//         rapUnitPrice,
//         rapTotalPrice: rapUnitPrice * vol,
//         rabUnitPrice: rabPrice,
//         rabTotalPrice: rabPrice * vol,
//         ...(componentUpdate ? { components: componentUpdate } : {}),
//       },
//       include: { components: true },
//     });

//     res.json({ message: "Item RAB berhasil diperbarui", data: updated });
//   } catch (error) {
//     console.error("Error Update RabItem:", error);
//     res
//       .status(500)
//       .json({ error: error.message || "Terjadi kesalahan pada server." });
//   }
// });
