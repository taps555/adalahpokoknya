"use strict";
const express = require("express");
const router = express.Router();
const prisma = require("../../lib/prisma");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// 👇 Ambil fungsi stream alat gambar PDF
const { streamBastPdf } = require("../exportToFile/bast.routes");

const MAX_PHOTOS_PER_ITEM = 50; // Karena BAST maksimal 50 foto

// ==========================================
// KONFIGURASI MULTER UNTUK FOTO BAST
// ==========================================
const bastStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = "./public/uploads/bast";
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "bast-" + uniqueSuffix + path.extname(file.originalname));
  },
});

// Middleware Multer untuk tangkap array foto dari form-data
const uploadBast = multer({ storage: bastStorage });

// ==========================================
// HELPER: HAPUS FILE FOTO FISIK DARI DISK
// ==========================================
function deletePhotoFiles(photoUrls) {
  for (const url of photoUrls) {
    const filePath = path.join("./public", url);
    fs.unlink(filePath, (err) => {
      if (err && err.code !== "ENOENT") {
        console.error("Gagal hapus file foto BAST:", filePath, err.message);
      }
    });
  }
}

// ==========================================
// HELPER: AMBIL DATA BAST UNTUK PDF
// ==========================================
async function getBastForPdf(id) {
  return await prisma.bast.findUnique({
    where: { id },
    include: {
      project: { include: { client: true } },
      photos: { orderBy: { order: "asc" } },
    },
  });
}
/**
 * GET /projects/:projectId/bast
 * Ambil data BAST gabungan: Data otomatis dari Project/Client + Data inputan BAST
 */
router.get("/projects/:projectId/bast", async (req, res) => {
  try {
    const { projectId } = req.params;

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { client: true },
    });

    if (!project) {
      return res.status(404).json({ error: "Project tidak ditemukan." });
    }

    const basts = await prisma.bast.findMany({
      where: { projectId },
      include: { photos: { orderBy: { order: "asc" } } },
      orderBy: { createdAt: "desc" },
    });

    // Gabung data DB dengan input BAST
    const responseData = basts.map((bast) => ({
      ...bast,
      namaProyek: project.name,
      alamatProyek: project.location,
      namaClient: project.client.name,
    }));

    res.json({ data: responseData });
  } catch (error) {
    console.error("Error Get BAST List:", error);
    res.status(500).json({ error: "Terjadi kesalahan pada server." });
  }
});

/**
 * POST /projects/:projectId/bast
 * Buat BAST baru + Foto
 */ router.post(
  "/projects/:projectId/bast",
  uploadBast.array("photos", MAX_PHOTOS_PER_ITEM),
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const {
        bastNumber,
        spkNumber,
        handoverDate,
        pihakPertamaName,
        pihakKeduaName,
        statusText,
      } = req.body;

      // Cek Project
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: { client: true },
      });
      if (!project)
        return res.status(404).json({ error: "Project tidak ditemukan." });

      // Siapkan array foto dari file yang ditangkap Multer
      const photosData = req.files
        ? req.files.map((file, index) => ({
            url: `/uploads/bast/${file.filename}`, // Path disesuaikan dengan folder public
            order: index,
          }))
        : [];

      const newBast = await prisma.bast.create({
        data: {
          projectId,
          bastNumber,
          spkNumber,
          handoverDate: new Date(handoverDate),
          pihakPertamaName: pihakPertamaName || project.client.name,
          pihakKeduaName: pihakKeduaName || "JIMMY CHRISTIAN, S.Ds.",
          statusText:
            statusText || "SELESAI DIKERJAKAN 100% dan DITERIMA DENGAN BAIK",
          photos: {
            create: photosData,
          },
        },
        include: { photos: true },
      });

      res.status(201).json({ message: "BAST berhasil dibuat.", data: newBast });
    } catch (error) {
      console.error("Error Create BAST:", error);
      res.status(500).json({ error: "Terjadi kesalahan pada server." });
    }
  },
);

/**
 * PUT /bast/:id
 * Update BAST (Termasuk hapus file foto lama yang tidak di-keep)
 */
router.put(
  "/bast/:id",
  uploadBast.array("photos", MAX_PHOTOS_PER_ITEM),
  async (req, res) => {
    try {
      const { id } = req.params;
      const {
        bastNumber,
        spkNumber,
        handoverDate,
        pihakPertamaName,
        pihakKeduaName,
        statusText,
      } = req.body;

      const existingBast = await prisma.bast.findUnique({
        where: { id },
        include: { photos: true },
      });

      if (!existingBast) {
        return res.status(404).json({ error: "BAST tidak ditemukan." });
      }

      // existingPhotosToKeep dikirim dari Frontend (Bisa undefined, string tunggal, atau array)
      let keepIds = req.body.existingPhotosToKeep || [];
      if (!Array.isArray(keepIds)) {
        keepIds = [keepIds]; // Ubah ke array kalau cuma 1 id (string)
      }

      // Cari tahu foto mana yang harus dibuang dari Hard Disk
      const photosToDelete = existingBast.photos.filter(
        (p) => !keepIds.includes(p.id),
      );
      const urlsToDelete = photosToDelete.map((p) => p.url);

      // ALAT DIPAKAI DI SINI! Hapus file fisik dari folder!
      if (urlsToDelete.length > 0) {
        deletePhotoFiles(urlsToDelete);
      }

      // File baru yang ditangkap Multer
      const newPhotosData = req.files
        ? req.files.map((file, index) => ({
            url: `/uploads/bast/${file.filename}`,
            // Set order di ujung
            order: existingBast.photos.length + index,
          }))
        : [];

      const updatedBast = await prisma.bast.update({
        where: { id },
        data: {
          ...(bastNumber && { bastNumber }),
          ...(spkNumber && { spkNumber }),
          ...(handoverDate && { handoverDate: new Date(handoverDate) }),
          ...(pihakPertamaName && { pihakPertamaName }),
          ...(pihakKeduaName && { pihakKeduaName }),
          ...(statusText && { statusText }),
          photos: {
            deleteMany: { id: { in: photosToDelete.map((p) => p.id) } }, // Hapus dari DB
            create: newPhotosData, // Masukkan foto baru ke DB
          },
        },
        include: { photos: true },
      });

      res.json({ message: "BAST berhasil diupdate.", data: updatedBast });
    } catch (error) {
      console.error("Error Update BAST:", error);
      res.status(500).json({ error: "Terjadi kesalahan pada server." });
    }
  },
);

/**
 * DELETE /bast/:id
 * Hancurkan BAST beserta semua file fotonya!
 */
router.delete("/bast/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const existingBast = await prisma.bast.findUnique({
      where: { id },
      include: { photos: true },
    });

    if (!existingBast) {
      return res.status(404).json({ error: "BAST tidak ditemukan." });
    }

    // ALAT DIPAKAI DI SINI LAGI! Hapus SEMUA file fisik foto!
    const allUrls = existingBast.photos.map((p) => p.url);
    if (allUrls.length > 0) {
      deletePhotoFiles(allUrls);
    }

    await prisma.bast.delete({ where: { id } });
    res.json({ message: "BAST beserta fotonya berhasil dihancurkan." });
  } catch (error) {
    console.error("Error Delete BAST:", error);
    res.status(500).json({ error: "Terjadi kesalahan pada server." });
  }
});
router.get("/bast/:id/pdf/view", async (req, res) => {
  try {
    const bast = await getBastForPdf(req.params.id);
    if (!bast) {
      return res.status(404).json({ error: "BAST tidak ditemukan." });
    }

    const fileName = `BAST_${bast.bastNumber.replace(/[\/\\]/g, "_")}.pdf`;

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${fileName}"`,
    });

    // Lempar data ke alat gambar
    streamBastPdf(bast, res);
  } catch (error) {
    console.error("Error View BAST PDF:", error);
    res.status(500).json({ error: "Gagal membuat PDF BAST." });
  }
});

/** GET DOWNLOAD PDF */
router.get("/bast/:id/pdf/download", async (req, res) => {
  try {
    const bast = await getBastForPdf(req.params.id);
    if (!bast) {
      return res.status(404).json({ error: "BAST tidak ditemukan." });
    }

    const fileName = `BAST_${bast.bastNumber.replace(/[\/\\]/g, "_")}.pdf`;

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    });

    // Lempar data ke alat gambar
    streamBastPdf(bast, res);
  } catch (error) {
    console.error("Error Download BAST PDF:", error);
    res.status(500).json({ error: "Gagal membuat PDF BAST." });
  }
});

module.exports = router;

module.exports = router;
