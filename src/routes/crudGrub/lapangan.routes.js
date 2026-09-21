"use strict";

const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const prisma = require("../../lib/prisma"); // sesuaikan path relatif sama struktur folder lo
const { verifyToken } = require("../../middleware/auth");

const router = express.Router();

const uploadDir = path.join(__dirname, "../../../public/uploads/surat-jalan");
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

// Surat jalan supplier biasanya lebih dari 1 foto — kasih ruang sampai 10.
const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 10 },
});

// FE baru kirim multipart, tapi kalau ada klien kirim JSON biasa
// (mis. foto sudah jadi URL), multer tidak parse body sama sekali.
// Middleware ini hanya jalankan multer saat request-nya multipart.
const maybeUpload = (req, res, next) => {
  if (req.is("multipart/form-data")) {
    return upload.array("fotoBukti", 10)(req, res, next);
  }
  next();
};

/**
 * Helper: hitung ulang status MaterialRequestItem dari total receivedVolume
 * seluruh PurchaseOrderItem miliknya. receivedVolume/status/isCompleted
 * sekarang hidup di level PO item, MR item cuma nyimpen ringkasan.
 */
const syncMrItemStatus = async (mrItemId) => {
  if (!mrItemId) return;
  const mrItem = await prisma.materialRequestItem.findUnique({
    where: { id: mrItemId },
    include: { poItems: true },
  });
  if (!mrItem) return;

  const totalDiterima = mrItem.poItems.reduce(
    (sum, pi) => sum + (pi.receivedVolume || 0),
    0,
  );

  let status = "PENDING";
  let isCompleted = false;
  if (mrItem.estimatedVolume > 0 && totalDiterima >= mrItem.estimatedVolume) {
    status = "COMPLETED";
    isCompleted = true;
  } else if (totalDiterima > 0) {
    status = "PARTIAL";
  }

  await prisma.materialRequestItem.update({
    where: { id: mrItemId },
    data: { status, isCompleted },
  });
};

/**
 * Helper: cari PurchaseOrderItem dari bermacam bentuk ID yang dikirim FE.
 * - poItemId langsung
 * - id PO item langsung
 * - UI key dari GET /finance/projects/:id/material-requests: "<mrItemId>_<poItemId>"
 * - mrItemId (kalau MR item cuma punya 1 PO item)
 */
const resolvePoItem = async (payload) => {
  const candidates = [payload.poItemId, payload.id].filter(Boolean);

  for (const c of candidates) {
    if (typeof c === "string" && c.includes("_")) {
      const found = await prisma.purchaseOrderItem.findUnique({
        where: { id: c.split("_").pop() },
        include: { purchaseOrder: true },
      });
      if (found) return found;
    }
  }

  for (const c of candidates) {
    const found = await prisma.purchaseOrderItem.findUnique({
      where: { id: c },
      include: { purchaseOrder: true },
    });
    if (found) return found;
  }

  if (payload.mrItemId) {
    const list = await prisma.purchaseOrderItem.findMany({
      where: { materialRequestId: payload.mrItemId },
      include: { purchaseOrder: true },
    });
    if (list.length === 1) return list[0];
  }

  return null;
};

/**
 * Kolom lapangan yang boleh diubah lewat form manual.
 * receivedVolume SENGAJA tidak ikut — volume diterima hanya boleh lahir dari
 * Surat Jalan (bukti fisik). Kalau form manual bisa menulisnya, bukti itu
 * kehilangan fungsi (dan kelebihan terima jadi bisa dipalsukan).
 */
const VOLUME_MANUAL_MSG =
  "Volume diterima tidak bisa diisi dari form. Kirim Surat Jalan (foto bukti) supaya volumenya tercatat.";

/** true kalau request mencoba menulis volume diterima lewat form manual. */
const cobaTulisVolume = (body) =>
  body && body.receivedVolume !== undefined && body.receivedVolume !== null && body.receivedVolume !== "";

const buildLapanganData = (body) => {
  const { tanggalOnsite, updateLapangan, catatanRusak } = body;
  const data = {};
  if (tanggalOnsite !== undefined) {
    data.tanggalOnsite = tanggalOnsite ? new Date(tanggalOnsite) : null;
  }
  if (updateLapangan !== undefined) data.updateLapangan = updateLapangan;
  if (catatanRusak !== undefined) data.catatanRusak = catatanRusak;
  return data;
};

/**
 * PUT /api/po-items/:poItemId/lapangan-update
 * Update progress lapangan 1 baris barang.
 * Kolom lapangan (tanggalOnsite, updateLapangan, receivedVolume, catatanRusak)
 * ada di PurchaseOrderItem, bukan MaterialRequestItem.
 */
router.put("/po-items/:poItemId/lapangan-update", async (req, res) => {
  try {
    const { poItemId } = req.params;

    const poItem = await prisma.purchaseOrderItem.findUnique({
      where: { id: poItemId },
      include: { purchaseOrder: true },
    });
    if (!poItem) {
      return res.status(404).json({ error: "Barang PO tidak ditemukan." });
    }

    // Guard: PO induk harus APPROVED sebelum lapangan boleh lapor progres
    if (poItem.purchaseOrder?.status !== "APPROVED") {
      return res.status(400).json({
        error: `Barang belum bisa diupdate lapangan. PO induk ${poItem.purchaseOrder?.poNumber || poItem.purchaseOrder?.id} belum di-approve.`,
      });
    }

    // Volume hanya boleh lahir dari Surat Jalan, bukan form manual.
    if (cobaTulisVolume(req.body)) {
      return res.status(400).json({ error: VOLUME_MANUAL_MSG });
    }

    const updated = await prisma.purchaseOrderItem.update({
      where: { id: poItemId },
      data: buildLapanganData(req.body),
    });

    await syncMrItemStatus(poItem.materialRequestId);

    res.json({ message: "Update lapangan berhasil.", data: updated });
  } catch (error) {
    console.error("Error Lapangan Update:", error);
    res
      .status(500)
      .json({ error: error.message || "Terjadi kesalahan pada server." });
  }
});

/**
 * PUT /api/po-items/lapangan-update-bulk
 * Update progress lapangan banyak baris sekaligus.
 * body: { items: [{ poItemId | id, mrItemId, tanggalOnsite, updateLapangan, catatanRusak }] }
 * `receivedVolume` sengaja ditolak di sini — volumenya lewat Surat Jalan.
 * Baris sisa yang belum di-PO / PO belum APPROVED masuk ke `skipped`.
 */
router.put("/po-items/lapangan-update-bulk", async (req, res) => {
  try {
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res
        .status(400)
        .json({ error: 'Field "items" wajib diisi (array).' });
    }

    const results = [];
    const skipped = [];
    const touchedMrItems = new Set();

    for (const item of items) {
      const poItem = await resolvePoItem(item);

      if (!poItem) {
        skipped.push({
          id: item.poItemId || item.id,
          reason:
            "Barang PO tidak ditemukan. Baris sisa yang belum di-PO tidak bisa diupdate lapangan.",
        });
        continue;
      }

      if (poItem.purchaseOrder?.status !== "APPROVED") {
        skipped.push({
          id: poItem.id,
          reason: `PO induk ${poItem.purchaseOrder?.poNumber || poItem.purchaseOrder?.id} belum di-approve.`,
        });
        continue;
      }

      if (cobaTulisVolume(item)) {
        skipped.push({ id: poItem.id, reason: VOLUME_MANUAL_MSG });
        continue;
      }

      const updated = await prisma.purchaseOrderItem.update({
        where: { id: poItem.id },
        data: buildLapanganData(item),
      });

      if (poItem.materialRequestId) touchedMrItems.add(poItem.materialRequestId);
      results.push(updated);
    }

    for (const mrItemId of touchedMrItems) {
      await syncMrItemStatus(mrItemId);
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
});

/**
 * ALIAS LAMA: PUT /api/material-request-items/:id/lapangan-update
 * FE versi lama kirim mrItemId. Diteruskan ke baris PO-nya.
 */
router.put("/material-request-items/:id/lapangan-update", async (req, res) => {
  try {
    const list = await prisma.purchaseOrderItem.findMany({
      where: { materialRequestId: req.params.id },
      include: { purchaseOrder: true },
      orderBy: { createdAt: "asc" },
    });

    if (list.length === 0) {
      return res.status(400).json({
        error:
          "Barang belum di-PO, belum ada baris PO yang bisa diupdate lapangan.",
      });
    }
    if (list.length > 1) {
      return res.status(400).json({
        error:
          "Item ini punya beberapa PO. Kirim poItemId ke /api/po-items/:poItemId/lapangan-update.",
      });
    }

    const poItem = list[0];
    if (poItem.purchaseOrder?.status !== "APPROVED") {
      return res.status(400).json({
        error: `Barang belum bisa diupdate lapangan. PO induk ${poItem.purchaseOrder?.poNumber} belum di-approve.`,
      });
    }

    const updated = await prisma.purchaseOrderItem.update({
      where: { id: poItem.id },
      data: buildLapanganData(req.body),
    });

    await syncMrItemStatus(req.params.id);

    res.json({ message: "Update lapangan berhasil.", data: updated });
  } catch (error) {
    console.error("Error Lapangan Update (alias):", error);
    res
      .status(500)
      .json({ error: error.message || "Terjadi kesalahan pada server." });
  }
});

/**
 * ALIAS LAMA: PUT /api/material-request-items/lapangan-update-bulk
 */
router.put(
  "/material-request-items/lapangan-update-bulk",
  async (req, res) => {
    try {
      const { items } = req.body;
      if (!Array.isArray(items) || items.length === 0) {
        return res
          .status(400)
          .json({ error: 'Field "items" wajib diisi (array).' });
      }

      const results = [];
      const skipped = [];
      const touchedMrItems = new Set();

      for (const item of items) {
        const poItem = await resolvePoItem(item);
        if (!poItem) {
          skipped.push({
            id: item.id,
            reason:
              "Barang PO tidak ditemukan (baris sisa belum di-PO).",
          });
          continue;
        }
        if (poItem.purchaseOrder?.status !== "APPROVED") {
          skipped.push({
            id: poItem.id,
            reason: `PO induk ${poItem.purchaseOrder?.poNumber} belum di-approve.`,
          });
          continue;
        }

        const updated = await prisma.purchaseOrderItem.update({
          where: { id: poItem.id },
          data: buildLapanganData(item),
        });
        if (poItem.materialRequestId)
          touchedMrItems.add(poItem.materialRequestId);
        results.push(updated);
      }

      for (const mrItemId of touchedMrItems) await syncMrItemStatus(mrItemId);

      res.json({
        message: `Berhasil update lapangan ${results.length} item. Dilewati ${skipped.length} item.`,
        data: results,
        skipped,
      });
    } catch (error) {
      console.error("Error Lapangan Update Bulk (alias):", error);
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
  maybeUpload,
  async (req, res) => {
    try {
      const { poItemId } = req.params;
      const { tanggalOnsite, updateLapangan, receivedVolume, catatanRusak } =
        req.body;

      // 1. Cek Surat Jalan (PO Item)
      const poItem = await prisma.purchaseOrderItem.findUnique({
        where: { id: poItemId },
        include: { materialRequest: true, purchaseOrder: true }, // Ambil data RAB induknya sekalian
      });

      if (!poItem) {
        return res
          .status(404)
          .json({ error: "Item Surat Jalan/PO tidak ditemukan." });
      }

      if (poItem.purchaseOrder.status !== "APPROVED") {
        return res.status(400).json({
          error: "PO belum di-approve. Barang belum boleh diterima.",
        });
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

      // 4. Jika PO TEMPO & semua item sudah diterima → auto buat PembayaranSupplier
      try {
        const po = poItem.purchaseOrder;
        if (po.status === "APPROVED" && (po.caraPembayaran || "").toUpperCase() === "TEMPO") {
          const poFull = await prisma.purchaseOrder.findUnique({
            where: { id: po.id },
            include: {
              items: { select: { id: true, qty: true, receivedVolume: true } },
            },
          });
          const allReceived = poFull.items.every(
            (it) => Number(it.receivedVolume || 0) >= Number(it.qty || 0) * 0.99
          );
          if (allReceived) {
            const sudahAda = await prisma.pembayaranSupplier.findFirst({
              where: { poId: po.id },
            });
            if (!sudahAda) {
              const nowDate = new Date();
              const created = await prisma.pembayaranSupplier.create({
                data: {
                  supplierId: po.supplierId,
                  poId: po.id,
                  tanggal: nowDate,
                  jumlahBayar: po.grandTotal || po.subTotal || 0,
                  metodeBayar: "TRANSFER",
                  status: "PENDING",
                  keterangan: `Auto TEMPO - semua barang diterima untuk PO ${po.poNumber || po.id}`,
                },
              });
              const urutan = String(created.seq).padStart(3, "0");
              await prisma.pembayaranSupplier.update({
                where: { id: created.id },
                data: { noPembayaran: `PBY/${String(nowDate.getMonth() + 1).padStart(2, "0")}/${nowDate.getFullYear()}/${urutan}` },
              });
            }
          }
        }
      } catch (e) {
        console.error("Gagal auto-create pembayaran tempo:", e);
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
  maybeUpload,
  async (req, res) => {
    try {
      const { poItemId } = req.params;
      const { nomorSJ, volumeDiterima, catatan, tanggal } = req.body;

      // Validasi biar error jelas, bukan 500
      if (!nomorSJ || !String(nomorSJ).trim()) {
        return res.status(400).json({ error: "Nomor Surat Jalan wajib diisi." });
      }
      const vol = Number(volumeDiterima);
      if (
        volumeDiterima === undefined ||
        volumeDiterima === null ||
        volumeDiterima === "" ||
        Number.isNaN(vol) ||
        vol <= 0
      ) {
        return res
          .status(400)
          .json({ error: "Volume diterima wajib diisi dan lebih dari 0." });
      }

      // 🔥 FORMAT PATH UNTUK DATABASE
      // Ambil semua file yang berhasil di-upload, lalu format path-nya
      let filePaths = [];
      if (req.files && req.files.length > 0) {
        filePaths = req.files.map(
          (file) => `/uploads/surat-jalan/${file.filename}`,
        );
      }

      // Surat Jalan = bukti barang nyampe lapangan. Foto wajib, dan biasanya lebih dari 1.
      if (filePaths.length === 0) {
        return res.status(400).json({
          error:
            "Foto Surat Jalan wajib dilampirkan. Surat Jalan adalah bukti barang diterima di lapangan.",
        });
      }

      // Ubah Array jadi String JSON untuk disimpan di Prisma
      const fotoUrlsString = JSON.stringify(filePaths);

      // Cek PO
      const poItem = await prisma.purchaseOrderItem.findUnique({
        where: { id: poItemId },
        include: { purchaseOrder: true },
      });

      if (!poItem) {
        return res
          .status(404)
          .json({ error: "Barang pesanan tidak ditemukan." });
      }

      if (poItem.purchaseOrder.status !== "APPROVED") {
        return res.status(400).json({
          error: "PO belum di-approve. Surat Jalan belum boleh dibuat.",
        });
      }

      // Barang kurang: datang < sisa pesanan → catatan kekurangan wajib.
      const sisa = Math.max(
        0,
        (poItem.qty || 0) - (poItem.receivedVolume || 0),
      );
      if (sisa > 0 && vol < sisa && !String(catatan || "").trim()) {
        return res.status(400).json({
          error: `Barang datang kurang dari pesanan (pesan ${sisa}, datang ${vol}). Catatan kekurangan wajib diisi.`,
        });
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

      // Sinkronkan ringkasan status MaterialRequestItem
      await syncMrItemStatus(poItem.materialRequestId);

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
router.post("/surat-jalan/bulk", maybeUpload, async (req, res) => {
  try {
    const { nomorSJ, fotoUrls, tanggal } = req.body;
    // 'items' adalah array dari barang yang dicentang, contoh:
    // items bisa datang sebagai JSON string (multipart) atau array asli (application/json)
    let items = req.body.items;
    if (typeof items === "string") {
      try {
        items = JSON.parse(items);
      } catch (e) {
        return res.status(400).json({ error: 'Field "items" bukan JSON yang valid.' });
      }
    }

    // Foto: multipart (req.files) atau JSON base64 (fotoUrls)
    let filePaths = [];
    if (req.files && req.files.length > 0) {
      filePaths = req.files.map((f) => `/uploads/surat-jalan/${f.filename}`);
    } else if (Array.isArray(fotoUrls)) {
      // Jalur JSON cuma boleh nunjuk file yang benar-benar ada di uploads.
      filePaths = fotoUrls
        .filter((u) => typeof u === "string" && u.startsWith("/uploads/"))
        .map((u) => {
          try {
            return fs.existsSync(path.join(__dirname, "../../../public", u))
              ? u
              : null;
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    }

    // Surat Jalan = bukti barang nyampe lapangan. Foto wajib ada.
    if (filePaths.length === 0) {
      return res.status(400).json({
        error:
          "Foto Surat Jalan wajib dilampirkan. Surat Jalan adalah bukti barang diterima di lapangan.",
      });
    }

    // Validasi dulu sebelum transaksi — biar error jelas, bukan 500
    if (!Array.isArray(items) || items.length === 0) {
      return res
        .status(400)
        .json({ error: 'Field "items" wajib diisi (array).' });
    }
    if (!nomorSJ || !String(nomorSJ).trim()) {
      return res.status(400).json({ error: "Nomor Surat Jalan wajib diisi." });
    }

    const invalid = [];
    for (const item of items) {
      if (!item.poItemId) {
        invalid.push("ada baris tanpa poItemId (baris sisa belum di-PO)");
        continue;
      }
      const vol = Number(item.volumeDiterima);
      if (
        item.volumeDiterima === undefined ||
        item.volumeDiterima === null ||
        item.volumeDiterima === "" ||
        Number.isNaN(vol) ||
        vol <= 0
      ) {
        invalid.push(`volumeDiterima baris ${item.poItemId} tidak valid`);
      }
    }
    if (invalid.length > 0) {
      return res.status(400).json({
        error: `Data Surat Jalan belum lengkap: ${invalid.join("; ")}.`,
      });
    }

    // Barang kurang: kalau yang datang lebih sedikit dari sisa pesanan,
    // catatan kekurangan wajib diisi. Surat Jalan tetap jadi buktinya.
    const kurangTanpaCatatan = [];
    for (const item of items) {
      const poItem = await prisma.purchaseOrderItem.findUnique({
        where: { id: item.poItemId },
      });
      if (!poItem) continue;
      const sisa = Math.max(0, (poItem.qty || 0) - (poItem.receivedVolume || 0));
      const datang = Number(item.volumeDiterima);
      if (sisa > 0 && datang < sisa && !String(item.catatan || "").trim()) {
        kurangTanpaCatatan.push(
          `${poItem.description || item.poItemId} (pesan ${sisa}, datang ${datang})`,
        );
      }
    }
    if (kurangTanpaCatatan.length > 0) {
      return res.status(400).json({
        error: `Barang datang kurang dari jumlah pesanan, catatan kekurangan wajib diisi: ${kurangTanpaCatatan.join("; ")}.`,
      });
    }

    // Kita gunakan prisma.$transaction agar aman!
    const touchedMrItems = new Set();
    await prisma.$transaction(async (tx) => {
      for (const item of items) {
        // 1. Simpan Riwayat Surat Jalan untuk masing-masing barang
        const poItem = await tx.purchaseOrderItem.findUnique({
          where: { id: item.poItemId },
          include: { purchaseOrder: true },
        });
        if (!poItem) {
          throw new Error(`PO Item ${item.poItemId} tidak ditemukan.`);
        }
        if (poItem.purchaseOrder.status !== "APPROVED") {
          throw new Error(
            `PO ${poItem.purchaseOrder.poNumber || poItem.purchaseOrder.id} belum di-approve.`,
          );
        }

        const newSJ = await tx.deliveryReceipt.create({
          data: {
            poItemId: item.poItemId,
            nomorSJ,
            volumeDiterima: parseFloat(item.volumeDiterima),
            catatan: item.catatan || "",
            fotoUrls: JSON.stringify(filePaths),
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

        // 4. Kumpulkan MR item biar ringkasan status-nya ikut disinkron
        if (poItem.materialRequestId) touchedMrItems.add(poItem.materialRequestId);
      }
    });

    // 5. Sinkronkan status MaterialRequestItem
    for (const mrItemId of touchedMrItems) {
      await syncMrItemStatus(mrItemId);
    }

    // 6. Cek apakah ada PO TEMPO yang semua itemnya sudah diterima
    //    Jika ya, buat PembayaranSupplier otomatis (status PENDING)
    const uniquePoIds = new Set();
    for (const item of items) {
      const pi = await prisma.purchaseOrderItem.findUnique({
        where: { id: item.poItemId },
        select: { poId: true },
      });
      if (pi?.poId) uniquePoIds.add(pi.poId);
    }

    for (const poId of uniquePoIds) {
      const po = await prisma.purchaseOrder.findUnique({
        where: { id: poId },
        include: {
          items: { select: { id: true, qty: true, receivedVolume: true } },
        },
      });

      if (!po || po.status !== "APPROVED") continue;
      if ((po.caraPembayaran || "").toUpperCase() !== "TEMPO") continue;

      // Cek apakah semua item sudah diterima (receivedVolume >= qty)
      const allReceived = po.items.every(
        (it) => Number(it.receivedVolume || 0) >= Number(it.qty || 0) * 0.99
      );
      if (!allReceived) continue;

      // Cek apakah PembayaranSupplier untuk PO ini sudah ada
      const sudahAda = await prisma.pembayaranSupplier.findFirst({
        where: { poId },
      });
      if (sudahAda) continue;

      // Buat entri PembayaranSupplier untuk TEMPO
      const nowDate = new Date();
      const bulan = String(nowDate.getMonth() + 1).padStart(2, "0");
      const tahun = nowDate.getFullYear();

      const created = await prisma.pembayaranSupplier.create({
        data: {
          supplierId: po.supplierId,
          poId,
          tanggal: nowDate,
          jumlahBayar: 0,
          metodeBayar: "TRANSFER",
          status: "PENDING",
          keterangan: `Auto TEMPO - semua barang diterima untuk PO ${po.poNumber || poId}`,
        },
      });

      const urutan = String(created.seq).padStart(3, "0");
      const noPembayaran = `PBY/${bulan}/${tahun}/${urutan}`;
      await prisma.pembayaranSupplier.update({
        where: { id: created.id },
        data: { noPembayaran },
      });
    }

    res.json({ message: "Penerimaan borongan berhasil dicatat!" });

  } catch (error) {
    console.error("Error Bulk Surat Jalan:", error);
    res
      .status(500)
      .json({ error: error.message || "Gagal menyimpan data borongan Surat Jalan." });
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

    const riwayat = await prisma.deliveryReceipt.findMany({
      where: { poItemId },
      orderBy: { tanggal: "asc" },
    });

    // fotoUrls disimpan sebagai string JSON di DB — kirim sebagai array biar FE gampang.
    const parsed = riwayat.map((row) => {
      let fotoUrls = [];
      if (row.fotoUrls) {
        try {
          const p = JSON.parse(row.fotoUrls);
          fotoUrls = Array.isArray(p) ? p : [row.fotoUrls];
        } catch {
          fotoUrls = [row.fotoUrls];
        }
      }
      return { ...row, fotoUrls };
    });

    res.json(parsed);
  } catch (error) {
    console.error("Error get riwayat:", error);
    res.status(500).json({ error: "Gagal mengambil riwayat Surat Jalan" });
  }
});
/**
 * GET /api/riwayat-habis-pakai?projectId=xxx
 * Riwayat pembelian habis pakai:
 *  - permintaan habis pakai dari lapangan + PO hasilnya
 *  - PO berkategori HABIS_PAKAI + surat jalannya
 *  - kelebihan terima (receivedVolume > qty PO) — kandidat habis pakai
 */
router.get("/riwayat-habis-pakai", async (req, res) => {
  try {
    const { projectId } = req.query;
    const wherePO = { kategoriPO: "HABIS_PAKAI" };
    const wherePermintaan = {};
    if (projectId) {
      wherePO.projectId = projectId;
      wherePermintaan.projectId = projectId;
    }

    const [permintaanRaw, poHabisPakai, semuaItemPO] = await Promise.all([
      prisma.permintaanHabisPakai.findMany({
        where: wherePermintaan,
        include: {
          po: { select: { id: true, poNumber: true, status: true } },
          poHabisPakai: { select: { id: true, poNumber: true, status: true } },
          requestedBy: { select: { id: true, name: true } },
          mrItem: { select: { id: true, itemName: true, estimatedVolume: true, pricePerUnit: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.purchaseOrder.findMany({
        where: wherePO,
        include: {
          supplier: { select: { id: true, name: true } },
          project: { select: { id: true, name: true } },
          items: {
            orderBy: { id: "asc" },
            include: {
              materialRequest: { select: { id: true, itemName: true, estimatedVolume: true, pricePerUnit: true } },
              deliveryReceipts: { orderBy: { tanggal: "desc" } },
            },
          },
          // Permintaan yang dituntaskan PO habis pakai ini (poHabisPakaiId)
          permintaanHabisPakai: {
            select: { id: true, nomor: true, itemName: true, alasan: true, qty: true, mrItemId: true },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      // Semua item PO (kategori apa saja) buat deteksi kelebihan terima
      prisma.purchaseOrderItem.findMany({
        where: projectId ? { purchaseOrder: { projectId } } : {},
        include: {
          purchaseOrder: {
            select: {
              id: true,
              poNumber: true,
              kategoriPO: true,
              supplier: { select: { id: true, name: true } },
            },
          },
          materialRequest: { select: { id: true, itemName: true, groupName: true } },
          deliveryReceipts: { select: { id: true, nomorSJ: true, tanggal: true, fotoUrls: true, volumeDiterima: true, catatan: true } },
        },
      }),
    ]);

    // Enrich status permintaan habis pakai berdasarkan PO habis pakai terkait
    const permintaan = permintaanRaw.map((p) => {
      const po = p.poHabisPakai;
      if (!po) return p;
      let status = p.status;
      if (po.status === "BELUM_APPROVE") status = "PO_DIBUAT";
      else if (po.status === "MENUNGGU_ATASAN") status = "FINANCE_APPROVED";
      else if (po.status === "APPROVED") status = "ATASAN_APPROVED";
      else if (po.status === "REJECTED") status = "REJECTED";
      return { ...p, status };
    });

    // Kelebihan: barang datang melebihi jumlah yang dipesan di PO.
    // Bukan dibuatkan permintaan otomatis — cuma ditandai supaya
    // pihak perusahaan tahu ini masuk hitungan habis pakai.
    const kelebihan = semuaItemPO
      .filter((it) => Number(it.receivedVolume || 0) - Number(it.qty || 0) > 0.0001)
      .map((it) => ({
        id: it.id,
        poItemId: it.id,
        description: it.description,
        description2: it.description2,
        unit: it.unit,
        qtyPO: it.qty,
        receivedVolume: it.receivedVolume,
        kelebihan: Number(it.receivedVolume || 0) - Number(it.qty || 0),
        poNumber: it.purchaseOrder?.poNumber,
        poId: it.purchaseOrder?.id,
        kategoriPO: it.purchaseOrder?.kategoriPO,
        supplier: it.purchaseOrder?.supplier || null,
        mrItemId: it.materialRequest?.id || null,
        itemName: it.materialRequest?.itemName || null,
        groupName: it.materialRequest?.groupName || null,
        suratJalan: (it.deliveryReceipts || []).map((r) => ({
          id: r.id,
          nomorSJ: r.nomorSJ,
          tanggal: r.tanggal,
        })),
      }))
      .sort((a, b) => b.kelebihan - a.kelebihan);

    // Ambil data MR terkait untuk akumulasi over qty/harga
    const mrItemIds = permintaan
      .map((p) => p.mrItemId)
      .filter(Boolean);
    const mrMap = new Map();
    if (mrItemIds.length) {
      const mrItems = await prisma.materialRequestItem.findMany({
        where: { id: { in: mrItemIds } },
        select: { id: true, itemName: true, estimatedVolume: true, pricePerUnit: true },
      });
      mrItems.forEach((m) => mrMap.set(m.id, m));
    }

    // Proyeksi RAP per item PO habis pakai dari permintaan yang terkait
    const poHabisPakaiEnriched = poHabisPakai.map((po) => {
      const items = (po.items || []).map((it) => {
        const matching = (po.permintaanHabisPakai || []).find(
          (pm) => pm.itemName === it.description || pm.alasan?.includes(it.description)
        );
        const mr = matching?.mrItemId ? mrMap.get(matching.mrItemId) : null;
        const rapVol = mr?.estimatedVolume || it.materialRequest?.estimatedVolume || 0;
        const rapPrice = mr?.pricePerUnit || it.materialRequest?.pricePerUnit || 0;
        return {
          ...it,
          rapEstVolume: rapVol,
          rapPricePerUnit: rapPrice,
          overQty: Math.max(0, Number(it.qty || 0) - Number(rapVol || 0)),
          overHarga: Math.max(0, Number(it.unitPrice || 0) - Number(rapPrice || 0)),
        };
      });
      return { ...po, items };
    });

    res.json({ permintaan, poHabisPakai: poHabisPakaiEnriched, kelebihan });
  } catch (error) {
    console.error("Get Riwayat Habis Pakai Error:", error);
    res.status(500).json({ error: "Gagal mengambil riwayat habis pakai" });
  }
});

/**
 * GET /api/permintaan-habis-pakai?projectId=&status=
 * Antrean permintaan habis pakai yang diajukan lapangan dari Item Tracking.
 * Purchasing pakai ini buat bikin PO kategori HABIS_PAKAI.
 */
router.get("/permintaan-habis-pakai", async (req, res) => {
  try {
    const { projectId, status } = req.query;
    const where = {};
    if (projectId) where.projectId = projectId;
    if (status) where.status = status;

    const data = await prisma.permintaanHabisPakai.findMany({
      where,
      include: {
        po: { select: { id: true, poNumber: true, status: true } },
        poHabisPakai: { select: { id: true, poNumber: true, status: true } },
        requestedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    // Hitung akumulasi qty yang sudah datang/terbeli per item (semua PO habis pakai proyek)
    const poHabisPakaiForProject = projectId
      ? await prisma.purchaseOrder.findMany({
          where: { projectId, kategoriPO: "HABIS_PAKAI", status: { not: "REJECTED" } },
          include: { items: true },
        })
      : [];
    const akumulasiMap = {};
    for (const po of poHabisPakaiForProject) {
      for (const it of po.items || []) {
        const key = it.description;
        if (!akumulasiMap[key]) akumulasiMap[key] = { qty: 0, received: 0 };
        akumulasiMap[key].qty += Number(it.qty || 0);
        akumulasiMap[key].received += Number(it.receivedVolume || 0);
      }
    }

    // Enrich status tracking berdasarkan PO habis pakai terkait + akumulasi
    const fmtNumBE = (n) => {
      const num = Number(n || 0);
      return isNaN(num) ? '0' : num.toLocaleString('id-ID', { maximumFractionDigits: 4 });
    };
    const enriched = data.map((perm) => {
      const po = perm.poHabisPakai;
      let status = perm.status;
      if (po) {
        if (po.status === "BELUM_APPROVE") status = "PO_DIBUAT";
        else if (po.status === "MENUNGGU_ATASAN") status = "FINANCE_APPROVED";
        else if (po.status === "APPROVED") status = "ATASAN_APPROVED";
        else if (po.status === "REJECTED") status = "REJECTED";
      }
      const acc = akumulasiMap[perm.itemName] || { qty: 0, received: 0 };
      const qtyOver = acc.qty > perm.qty ? acc.qty - perm.qty : 0;
      return {
        ...perm,
        status,
        akumulasiQty: acc.qty,
        akumulasiReceived: acc.received,
        keteranganVolume: perm.keteranganVolume || (qtyOver > 0 ? `Over ${fmtNumBE(qtyOver)} ${perm.unit || ''} (akumulasi terbeli ${fmtNumBE(acc.qty)} ${perm.unit || ''})` : null),
      };
    });

    res.json(enriched);
  } catch (error) {
    console.error("Get Permintaan Habis Pakai Error:", error);
    res.status(500).json({ error: "Gagal mengambil permintaan habis pakai" });
  }
});

/**
 * POST /api/permintaan-habis-pakai
 * Item Tracking mengajukan pembelian habis pakai.
 * HANYA boleh kalau PO induk sudah COMPLETED (barang awal sudah diterima semua).
 * body: { projectId, poId, mrItemId, itemName, unit, qty, alasan, catatan }
 */
router.post("/permintaan-habis-pakai", async (req, res) => {
  try {
    const { projectId, poId, mrItemId, itemName, unit, qty, alasan, catatan, keteranganVolume, keteranganHarga } =
      req.body || {};

    if (!projectId || !itemName || !qty) {
      return res
        .status(400)
        .json({ error: "projectId, itemName, dan qty wajib diisi." });
    }

    if (poId) {
      const po = await prisma.purchaseOrder.findUnique({ where: { id: poId } });
      if (!po) {
        return res.status(404).json({ error: "PO induk tidak ditemukan." });
      }
      if (po.status !== "APPROVED") {
        return res.status(400).json({
          error: `PO induk ${po.poNumber || po.id} belum APPROVED. Pembelian habis pakai baru bisa diajukan setelah PO induk disetujui.`,
        });
      }
    }

    const created = await prisma.permintaanHabisPakai.create({
      data: {
        projectId,
        poId: poId || null,
        mrItemId: mrItemId || null,
        itemName: String(itemName).trim(),
        unit: unit || "-",
        qty: Number(qty),
        alasan: alasan || null,
        catatan: catatan || null,
        keteranganVolume: keteranganVolume || null,
        keteranganHarga: keteranganHarga || null,
        requestedById: req.user?.userId || null,
      },
    });

    const urutan = String(created.seq).padStart(3, "0");
    const nomor = `PHP-${urutan}`;

    const final = await prisma.permintaanHabisPakai.update({
      where: { id: created.id },
      data: { nomor },
      include: {
        po: { select: { id: true, poNumber: true, status: true } },
        requestedBy: { select: { id: true, name: true } },
      },
    });

    res.json({
      message: "Permintaan habis pakai diajukan, menunggu purchasing.",
      data: final,
    });
  } catch (error) {
    console.error("Create Permintaan Habis Pakai Error:", error);
    res.status(500).json({ error: "Gagal mengajukan permintaan habis pakai" });
  }
});

/**
 * PUT /api/permintaan-habis-pakai/:id/link
 * Purchasing menautkan PO HABIS_PAKAI yang baru dibuat ke permintaan ini.
 * body: { poHabisPakaiId }
 */
router.put("/permintaan-habis-pakai/:id/link", async (req, res) => {
  try {
    const { poHabisPakaiId } = req.body || {};
    if (!poHabisPakaiId) {
      return res.status(400).json({ error: "poHabisPakaiId wajib diisi." });
    }

    const po = await prisma.purchaseOrder.findUnique({
      where: { id: poHabisPakaiId },
    });
    if (!po) {
      return res.status(404).json({ error: "PO habis pakai tidak ditemukan." });
    }
    if (po.kategoriPO !== "HABIS_PAKAI") {
      return res
        .status(400)
        .json({ error: "PO tujuan bukan kategori HABIS_PAKAI." });
    }

    const updated = await prisma.permintaanHabisPakai.update({
      where: { id: req.params.id },
      data: { poHabisPakaiId, status: "LINKED" },
      include: {
        po: { select: { id: true, poNumber: true } },
        poHabisPakai: { select: { id: true, poNumber: true, status: true } },
      },
    });
    res.json({ message: "Permintaan ditautkan ke PO habis pakai.", data: updated });
  } catch (error) {
    console.error("Link Permintaan Habis Pakai Error:", error);
    if (error.code === "P2025") {
      return res.status(404).json({ error: "Permintaan tidak ditemukan." });
    }
    res.status(500).json({ error: "Gagal menautkan permintaan" });
  }
});

/**
 * PUT /api/permintaan-habis-pakai/:id/reject
 * body: { alasan }
 */
router.put("/permintaan-habis-pakai/:id/reject", async (req, res) => {
  try {
    const reason = req.body?.alasan || req.body?.catatan;
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ error: "Alasan penolakan wajib diisi." });
    }
    const updated = await prisma.permintaanHabisPakai.update({
      where: { id: req.params.id },
      data: { status: "REJECTED", catatan: String(reason).trim() },
    });
    res.json({ message: "Permintaan habis pakai ditolak.", data: updated });
  } catch (error) {
    console.error("Reject Permintaan Habis Pakai Error:", error);
    if (error.code === "P2025") {
      return res.status(404).json({ error: "Permintaan tidak ditemukan." });
    }
    res.status(500).json({ error: "Gagal menolak permintaan" });
  }
});

module.exports = router;
