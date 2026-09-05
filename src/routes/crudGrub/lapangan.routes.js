"use strict";

const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const prisma = require("../../lib/prisma"); // sesuaikan path relatif sama struktur folder lo
const { verifyToken } = require("../../middleware/auth");

const router = express.Router();

const uploadDir = path.join(__dirname, "./public/uploads/surat-jalan");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// 2. SETTING MULTER (Penamaan File & Lokasi)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir); // Simpan ke public/uploads/surat-jalan
  },
  filename: function (req, file, cb) {
    // Bikin nama unik ala gambarmu: sj-1788520588261-652574187.png
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, "sj-" + uniqueSuffix + ext);
  },
});

// Izinkan maksimal 5 foto sekali upload
const upload = multer({ storage: storage });

/** PUT /material-request-items/:id/lapangan-update
 * Update progress lapangan 1 item (tanggalOnsite, updateLapangan)
 * DEPENDENT: hanya bisa diupdate kalau status Finance minimal PARTIAL
 * (barang harus sudah mulai dibeli sebelum lapangan bisa lapor progres)
 */
router.put(
  "/material-request-items/:id/lapangan-update",

  async (req, res) => {
    try {
      const { id } = req.params;
      const { tanggalOnsite, updateLapangan, receivedVolume, catatanRusak } =
        req.body;

      const existing = await prisma.materialRequestItem.findUnique({
        where: { id },
      });
      if (!existing)
        return res.status(404).json({ error: "Item tidak ditemukan." });

      if (!existing.orderedVolume || existing.orderedVolume <= 0) {
        return res.status(400).json({
          error:
            "Barang belum di-PO oleh Finance. Update lapangan belum bisa dilakukan.",
        });
      }

      // hitung status baru dari receivedVolume, kalau field ini dikirim
      let statusData = {};
      if (receivedVolume !== undefined) {
        const rv = Number(receivedVolume);
        let newStatus = "PENDING";
        let isCompleted = false;
        if (rv >= existing.estimatedVolume) {
          newStatus = "COMPLETED";
          isCompleted = true;
        } else if (rv > 0) {
          newStatus = "PARTIAL";
        }
        statusData = { receivedVolume: rv, status: newStatus, isCompleted };
      }

      const updated = await prisma.materialRequestItem.update({
        where: { id },
        data: {
          ...(tanggalOnsite !== undefined
            ? { tanggalOnsite: tanggalOnsite ? new Date(tanggalOnsite) : null }
            : {}),
          ...(updateLapangan !== undefined ? { updateLapangan } : {}),
          ...(catatanRusak !== undefined ? { catatanRusak } : {}),
          ...statusData,
        },
      });

      res.json({ message: "Update lapangan berhasil.", data: updated });
    } catch (error) {
      console.error("Error Lapangan Update:", error);
      res
        .status(500)
        .json({ error: error.message || "Terjadi kesalahan pada server." });
    }
  },
);

/** PUT /material-request-items/lapangan-update-bulk
 * Update progress lapangan banyak item sekaligus
 * body: { items: [{ id, tanggalOnsite, updateLapangan }, ...] }
 * DEPENDENT: item dengan status PENDING otomatis dilewati (masuk skipped)
 */
router.put(
  "/material-request-items/lapangan-update-bulk",

  async (req, res) => {
    try {
      const { items } = req.body;

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

        if (!existing.orderedVolume || existing.orderedVolume <= 0) {
          skipped.push({
            id: item.id,
            reason:
              "Barang belum di-PO oleh Finance, belum bisa update lapangan.",
          });
          continue;
        }

        let statusData = {};
        if (item.receivedVolume !== undefined) {
          const rv = Number(item.receivedVolume);
          let newStatus = "PENDING";
          let isCompleted = false;
          if (rv >= existing.estimatedVolume) {
            newStatus = "COMPLETED";
            isCompleted = true;
          } else if (rv > 0) {
            newStatus = "PARTIAL";
          }
          statusData = { receivedVolume: rv, status: newStatus, isCompleted };
        }

        const updated = await prisma.materialRequestItem.update({
          where: { id: item.id },
          data: {
            ...(item.tanggalOnsite !== undefined
              ? {
                  tanggalOnsite: item.tanggalOnsite
                    ? new Date(item.tanggalOnsite)
                    : null,
                }
              : {}),
            ...(item.updateLapangan !== undefined
              ? { updateLapangan: item.updateLapangan }
              : {}),
            ...(item.catatanRusak !== undefined
              ? { catatanRusak: item.catatanRusak }
              : {}),
            ...statusData,
          },
        });

        results.push(updated);
      }

      res.json({
        message: `Berhasil update lapangan ${results.length} item. Dilewati ${skipped.length} item.`,
        data: results,
        skipped,
      });
    } catch (error) {
      console.error("Error Lapangan Update Bulk:", error);
      res
        .status(500)
        .json({ error: error.message || "Terjadi kesalahan pada server." });
    }
  },
);

/**
 * PUT /api/lapangan/po-items/:poItemId/receive
 * Orang lapangan menerima barang berdasarkan Surat Jalan dari Toko
 */
router.put(
  "/po-items/:poItemId/receive",
  // verifyToken, // nyalakan auth-nya jika sudah siap
  async (req, res) => {
    try {
      const { poItemId } = req.params;
      const { tanggalOnsite, updateLapangan, receivedVolume, catatanRusak } =
        req.body;

      // 1. Cek Surat Jalan (PO Item)
      const poItem = await prisma.purchaseOrderItem.findUnique({
        where: { id: poItemId },
        include: { materialRequest: true }, // Ambil data RAB induknya sekalian
      });

      if (!poItem) {
        return res
          .status(404)
          .json({ error: "Item Surat Jalan/PO tidak ditemukan." });
      }

      const updatedRv =
        receivedVolume !== undefined
          ? Number(receivedVolume)
          : poItem.receivedVolume;

      // 2. Update Data Penerimaan di Surat Jalan ini
      const updatedPoItem = await prisma.purchaseOrderItem.update({
        where: { id: poItemId },
        data: {
          tanggalOnsite: tanggalOnsite
            ? new Date(tanggalOnsite)
            : poItem.tanggalOnsite,
          updateLapangan:
            updateLapangan !== undefined
              ? updateLapangan
              : poItem.updateLapangan,
          receivedVolume: updatedRv,
          catatanRusak:
            catatanRusak !== undefined ? catatanRusak : poItem.catatanRusak,
        },
      });

      // ========================================================
      // 3. SIHIR SINKRONISASI KE RAB INDUK (MaterialRequestItem)
      // ========================================================
      if (poItem.materialRequestId) {
        const mrId = poItem.materialRequestId;
        const mrItem = poItem.materialRequest;

        // Hitung total penerimaan DARI SEMUA TOKO untuk item RAB ini
        const allPoItems = await prisma.purchaseOrderItem.findMany({
          where: { materialRequestId: mrId },
        });

        const totalReceivedGlobal = allPoItems.reduce(
          (sum, item) => sum + (item.receivedVolume || 0),
          0,
        );

        // Tentukan status global RAB
        let globalStatus = "PENDING";
        let isCompleted = false;

        if (totalReceivedGlobal >= mrItem.estimatedVolume) {
          globalStatus = "COMPLETED";
          isCompleted = true;
        } else if (totalReceivedGlobal > 0) {
          globalStatus = "PARTIAL";
        }

        // Update Induknya
        await prisma.materialRequestItem.update({
          where: { id: mrId },
          data: {
            status: globalStatus,
            isCompleted: isCompleted,
          },
        });
      }

      res.json({
        message: "Penerimaan barang dari toko berhasil dicatat!",
        data: updatedPoItem,
      });
    } catch (error) {
      console.error("Error Lapangan Update:", error);
      res.status(500).json({ error: "Gagal memproses penerimaan lapangan." });
    }
  },
);

// ==========================================
// API PENERIMAAN BARANG (MULTI-SURAT JALAN)
// ==========================================
router.post(
  "/po-items/:poItemId/surat-jalan",
  upload.array("fotoBukti", 5),
  async (req, res) => {
    try {
      const { poItemId } = req.params;
      const { nomorSJ, volumeDiterima, catatan, tanggal } = req.body;

      // 🔥 FORMAT PATH UNTUK DATABASE
      // Ambil semua file yang berhasil di-upload, lalu format path-nya
      let filePaths = [];
      if (req.files && req.files.length > 0) {
        filePaths = req.files.map(
          (file) => `/uploads/surat-jalan/${file.filename}`,
        );
      }

      // Ubah Array jadi String JSON untuk disimpan di Prisma
      const fotoUrlsString = JSON.stringify(filePaths);

      // Cek PO
      const poItem = await prisma.purchaseOrderItem.findUnique({
        where: { id: poItemId },
      });

      if (!poItem) {
        return res
          .status(404)
          .json({ error: "Barang pesanan tidak ditemukan." });
      }

      // Simpan ke DB DeliveryReceipt
      const newSJ = await prisma.deliveryReceipt.create({
        data: {
          poItemId,
          nomorSJ,
          volumeDiterima: parseFloat(volumeDiterima),
          catatan: catatan || "",
          fotoUrls: fotoUrlsString, // 👉 Path tersimpan cantik di sini!
          tanggal: tanggal ? new Date(tanggal) : new Date(),
        },
      });

      // Hitung total agregat
      const agregat = await prisma.deliveryReceipt.aggregate({
        where: { poItemId },
        _sum: { volumeDiterima: true },
      });

      const totalDiterima = agregat._sum.volumeDiterima || 0;

      // Update PO Item induk
      await prisma.purchaseOrderItem.update({
        where: { id: poItemId },
        data: {
          receivedVolume: totalDiterima,
          catatanRusak: catatan,
          tanggalOnsite: newSJ.tanggal,
        },
      });

      res.json({
        message: "Surat Jalan dan Foto berhasil dicatat!",
        data: newSJ,
        totalSekarang: totalDiterima,
      });
    } catch (error) {
      console.error("Error Upload SJ:", error);
      res.status(500).json({ error: "Gagal menyimpan Surat Jalan." });
    }
  },
);

// ==========================================
// API PENERIMAAN BORONGAN (BULK SURAT JALAN)
// ==========================================
router.post("/surat-jalan/bulk", async (req, res) => {
  try {
    const { nomorSJ, fotoUrls, tanggal, items } = req.body;
    // 'items' adalah array dari barang yang dicentang, contoh:
    // [{ poItemId: "123", volumeDiterima: 50, catatan: "aman" }, { poItemId: "124", volumeDiterima: 100, catatan: "" }]

    // Kita gunakan prisma.$transaction agar aman!
    await prisma.$transaction(async (tx) => {
      for (const item of items) {
        // 1. Simpan Riwayat Surat Jalan untuk masing-masing barang
        const newSJ = await tx.deliveryReceipt.create({
          data: {
            poItemId: item.poItemId,
            nomorSJ,
            volumeDiterima: parseFloat(item.volumeDiterima),
            catatan: item.catatan || "",
            fotoUrls: fotoUrls || "",
            tanggal: tanggal ? new Date(tanggal) : new Date(),
          },
        });

        // 2. Hitung total volume yang sudah diterima untuk barang ini
        const agregat = await tx.deliveryReceipt.aggregate({
          where: { poItemId: item.poItemId },
          _sum: { volumeDiterima: true },
        });
        const totalDiterima = agregat._sum.volumeDiterima || 0;

        // 3. Update data Induk (PO Item) untuk Finance
        await tx.purchaseOrderItem.update({
          where: { id: item.poItemId },
          data: {
            receivedVolume: totalDiterima,
            catatanRusak: item.catatan,
            tanggalOnsite: newSJ.tanggal,
          },
        });
      }
    });

    res.json({ message: "Penerimaan borongan berhasil dicatat!" });
  } catch (error) {
    console.error("Error Bulk Surat Jalan:", error);
    res
      .status(500)
      .json({ error: "Gagal menyimpan data borongan Surat Jalan." });
  }
});

// ==========================================
// API AMBIL RIWAYAT SURAT JALAN PER BARANG
// ==========================================
// ==========================================
// API AMBIL RIWAYAT SURAT JALAN PER BARANG
// ==========================================
router.get("/surat-jalan/:poItemId", async (req, res) => {
  try {
    const { poItemId } = req.params;

    // Cek di terminal/console backend kamu, ID apa yang sebenarnya dicari?
    console.log("Mencari Riwayat untuk ID Barang:", poItemId);

    const riwayat = await prisma.deliveryReceipt.findMany({
      // 🔥 Jaga-jaga kalau tipe datanya Int, kita ubah jadi angka
      where: {
        poItemId: isNaN(poItemId) ? poItemId : parseInt(poItemId),
      },
      orderBy: { tanggal: "asc" },
    });

    console.log("Data ditemukan:", riwayat.length, "baris");
    res.json(riwayat);
  } catch (error) {
    console.error("Error get riwayat:", error);
    res.status(500).json({ error: "Gagal mengambil riwayat Surat Jalan" });
  }
});
module.exports = router;
