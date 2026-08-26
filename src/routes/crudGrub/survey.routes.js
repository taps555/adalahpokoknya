"use strict";
const express = require("express");
const router = express.Router();
const prisma = require("../../lib/prisma"); // Pastikan letak path folder prisma Anda benar
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { streamSurveyPdf } = require("../exportToFile/surveyView.routes"); // taro 1 folder sama file ini

const MAX_PHOTOS_PER_AREA = 20;

// ==========================================
// KONFIGURASI MULTER UNTUK FOTO SURVEY
// ==========================================
const surveyStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = "./public/uploads/surveys";
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "survey-" + uniqueSuffix + path.extname(file.originalname));
  },
});
// Tiap area bisa kirim BEBERAPA foto sekaligus, maks 20 per area.
// Frontend kirim field per area per slot foto, contoh:
//   area 0: photo_0_0, photo_0_1, ..., photo_0_19  (maks 20 foto per area)
//   area 1: photo_1_0, photo_1_1, dst
// Pola field: `photo_{areaIndex}_{photoIndex}`
const uploadSurvey = multer({ storage: surveyStorage });

// ==========================================
// POST: CREATE SURVEY REPORT (Data + Foto multi per area, maks 20/area)
// ==========================================
router.post(
  "/projects/:projectId/surveys",
  uploadSurvey.any(),
  async (req, res) => {
    try {
      const { projectId } = req.params;

      if (!req.body.surveyData) {
        return res
          .status(400)
          .json({ error: "Field surveyData (JSON) tidak ditemukan." });
      }

      const parsedData = JSON.parse(req.body.surveyData);
      const { surveyDate, surveyorName, notes, areas } = parsedData;

      const project = await prisma.project.findUnique({
        where: { id: projectId },
      });
      if (!project)
        return res.status(404).json({ error: "Project tidak ditemukan." });

      // Validasi jumlah foto per area SEBELUM proses simpan apapun
      for (let areaIndex = 0; areaIndex < (areas || []).length; areaIndex++) {
        const count = req.files.filter((f) =>
          f.fieldname.startsWith(`photo_${areaIndex}_`),
        ).length;
        if (count > MAX_PHOTOS_PER_AREA) {
          return res.status(400).json({
            error: `Area ke-${areaIndex + 1} (${
              areas[areaIndex]?.areaName || "-"
            }) punya ${count} foto, maksimal ${MAX_PHOTOS_PER_AREA} foto per area.`,
          });
        }
      }

      const areasToCreate = (areas || []).map((area, areaIndex) => {
        const areaPhotoFiles = req.files
          .filter((f) => f.fieldname.startsWith(`photo_${areaIndex}_`))
          .sort((a, b) => {
            const orderA = Number(a.fieldname.split("_")[2] || 0);
            const orderB = Number(b.fieldname.split("_")[2] || 0);
            return orderA - orderB;
          });

        const photosToCreate = areaPhotoFiles.map((f, i) => ({
          url: `/uploads/surveys/${f.filename}`,
          order: i,
        }));

        const dimensionsToCreate = (area.dimensions || []).map((dim) => ({
          keterangan: dim.keterangan || null,
          panjang: dim.panjang ? Number(dim.panjang) : null,
          lebar: dim.lebar ? Number(dim.lebar) : null,
          tinggi: dim.tinggi ? Number(dim.tinggi) : null,
          luasan:
            dim.panjang && dim.lebar
              ? Number(dim.panjang) * Number(dim.lebar)
              : null,
        }));

        return {
          areaName: area.areaName,
          analisa: area.analisa || null,
          penanganan: area.penanganan || null,
          informasiTambahan: area.informasiTambahan || null,
          photoCaption: area.photoCaption || null,
          photos: {
            create: photosToCreate,
          },
          dimensions: {
            create: dimensionsToCreate,
          },
        };
      });

      const newSurvey = await prisma.surveyReport.create({
        data: {
          projectId,
          surveyDate: new Date(surveyDate),
          surveyorName,
          notes: notes || null,
          areas: {
            create: areasToCreate,
          },
        },
        include: {
          areas: {
            include: {
              dimensions: true,
              photos: { orderBy: { order: "asc" } },
            },
          },
        },
      });

      res.status(201).json({
        message: "Laporan Survey berhasil disimpan!",
        data: newSurvey,
      });
    } catch (error) {
      console.error("Error Create Survey:", error);
      res.status(500).json({
        error:
          error.message || "Terjadi kesalahan server saat menyimpan survey.",
      });
    }
  },
);

// ==========================================
// GET: LIHAT SEMUA SURVEY DI PROJECT TERTENTU
// ==========================================
router.get("/projects/:projectId/surveys", async (req, res) => {
  try {
    const { projectId } = req.params;
    const surveys = await prisma.surveyReport.findMany({
      where: { projectId },
      orderBy: { surveyDate: "desc" },
      include: {
        areas: {
          include: { dimensions: true, photos: { orderBy: { order: "asc" } } },
        },
      },
    });

    res.json(surveys);
  } catch (error) {
    console.error("Error Get Surveys:", error);
    res.status(500).json({ error: "Gagal mengambil data survey." });
  }
});

// ==========================================
// PDF: VIEW & DOWNLOAD LAPORAN SURVEY
// ==========================================

async function getSurveyForPdf(surveyId) {
  const survey = await prisma.surveyReport.findUnique({
    where: { id: surveyId },
    include: {
      project: true,
      areas: {
        include: { dimensions: true, photos: { orderBy: { order: "asc" } } },
      },
    },
  });
  return survey;
}

/**
 * GET /surveys/:id/pdf/view
 */
router.get("/surveys/:id/pdf/view", async (req, res) => {
  try {
    const survey = await getSurveyForPdf(req.params.id);
    if (!survey)
      return res.status(404).json({ error: "Laporan survey tidak ditemukan." });

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="survey-${req.params.id}.pdf"`,
    });
    streamSurveyPdf(survey, res);
  } catch (error) {
    console.error("Error View Survey PDF:", error);
    res.status(500).json({ error: "Gagal membuat PDF survey." });
  }
});

/**
 * GET /surveys/:id/pdf/download
 */
router.get("/surveys/:id/pdf/download", async (req, res) => {
  try {
    const survey = await getSurveyForPdf(req.params.id);
    if (!survey)
      return res.status(404).json({ error: "Laporan survey tidak ditemukan." });

    const fileName = `Survey-${survey.surveyorName || "Report"}-${
      new Date(survey.surveyDate).toISOString().split("T")[0]
    }.pdf`.replace(/\s+/g, "_");

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    });
    streamSurveyPdf(survey, res);
  } catch (error) {
    console.error("Error Download Survey PDF:", error);
    res.status(500).json({ error: "Gagal membuat PDF survey." });
  }
});

// ==========================================
// HELPER: HAPUS FILE FOTO FISIK DARI DISK
// ==========================================
function deletePhotoFiles(photoUrls) {
  for (const url of photoUrls) {
    const filePath = path.join("./public", url);
    fs.unlink(filePath, (err) => {
      if (err && err.code !== "ENOENT") {
        console.error("Gagal hapus file foto:", filePath, err.message);
      }
    });
  }
}

// ==========================================
// PUT: UPDATE SURVEY REPORT (Data + Foto, replace areas lama)
// Frontend kirim tiap area existing dengan field `existingPhotoUrls`
// (array url foto lama yg TETAP dipertahankan). Foto baru tetap lewat
// field `photo_{areaIndex}_{photoIndex}`. Foto lama yg tidak dikirim
// ulang di existingPhotoUrls akan dihapus dari DB + disk.
// ==========================================
router.put("/surveys/:id", uploadSurvey.any(), async (req, res) => {
  try {
    const { id } = req.params;

    if (!req.body.surveyData) {
      return res
        .status(400)
        .json({ error: "Field surveyData (JSON) tidak ditemukan." });
    }

    const parsedData = JSON.parse(req.body.surveyData);
    const { surveyDate, surveyorName, notes, areas } = parsedData;

    const existingSurvey = await prisma.surveyReport.findUnique({
      where: { id },
      include: { areas: { include: { photos: true } } },
    });
    if (!existingSurvey)
      return res.status(404).json({ error: "Laporan survey tidak ditemukan." });

    // Validasi jumlah foto per area (foto lama yg dipertahankan + foto baru)
    for (let areaIndex = 0; areaIndex < (areas || []).length; areaIndex++) {
      const newCount = req.files.filter((f) =>
        f.fieldname.startsWith(`photo_${areaIndex}_`),
      ).length;
      const keepCount = (areas[areaIndex]?.existingPhotoUrls || []).length;
      if (newCount + keepCount > MAX_PHOTOS_PER_AREA) {
        return res.status(400).json({
          error: `Area ke-${areaIndex + 1} (${
            areas[areaIndex]?.areaName || "-"
          }) punya ${newCount + keepCount} foto, maksimal ${MAX_PHOTOS_PER_AREA} foto per area.`,
        });
      }
    }

    // Kumpulkan url foto lama yg TIDAK dipertahankan (buat dihapus dari disk)
    const urlsToDelete = [];
    for (const oldArea of existingSurvey.areas) {
      const matchingNewArea = (areas || []).find((a) => a.id === oldArea.id);
      const keepUrls = matchingNewArea?.existingPhotoUrls || [];
      for (const oldPhoto of oldArea.photos) {
        if (!keepUrls.includes(oldPhoto.url)) {
          urlsToDelete.push(oldPhoto.url);
        }
      }
    }

    const areasToCreate = (areas || []).map((area, areaIndex) => {
      const newAreaPhotoFiles = req.files
        .filter((f) => f.fieldname.startsWith(`photo_${areaIndex}_`))
        .sort((a, b) => {
          const orderA = Number(a.fieldname.split("_")[2] || 0);
          const orderB = Number(b.fieldname.split("_")[2] || 0);
          return orderA - orderB;
        })
        .map((f) => ({ url: `/uploads/surveys/${f.filename}` }));

      const keptPhotos = (area.existingPhotoUrls || []).map((url) => ({ url }));

      const photosToCreate = [...keptPhotos, ...newAreaPhotoFiles].map(
        (p, i) => ({ url: p.url, order: i }),
      );

      const dimensionsToCreate = (area.dimensions || []).map((dim) => ({
        keterangan: dim.keterangan || null,
        panjang: dim.panjang ? Number(dim.panjang) : null,
        lebar: dim.lebar ? Number(dim.lebar) : null,
        tinggi: dim.tinggi ? Number(dim.tinggi) : null,
        luasan:
          dim.panjang && dim.lebar
            ? Number(dim.panjang) * Number(dim.lebar)
            : null,
      }));

      return {
        areaName: area.areaName,
        analisa: area.analisa || null,
        penanganan: area.penanganan || null,
        informasiTambahan: area.informasiTambahan || null,
        photoCaption: area.photoCaption || null,
        photos: { create: photosToCreate },
        dimensions: { create: dimensionsToCreate },
      };
    });

    // Hapus semua area lama (cascade hapus dimensions & photos di DB),
    // lalu buat ulang area baru — dalam 1 transaksi biar atomic.
    const updatedSurvey = await prisma.$transaction(async (tx) => {
      await tx.surveyArea.deleteMany({ where: { surveyReportId: id } });

      return tx.surveyReport.update({
        where: { id },
        data: {
          surveyDate: new Date(surveyDate),
          surveyorName,
          notes: notes || null,
          areas: { create: areasToCreate },
        },
        include: {
          areas: {
            include: {
              dimensions: true,
              photos: { orderBy: { order: "asc" } },
            },
          },
        },
      });
    });

    // Hapus file fisik SETELAH transaksi DB sukses, biar gak orphan
    // kalau ternyata transaksinya gagal di tengah jalan.
    deletePhotoFiles(urlsToDelete);

    res.json({
      message: "Laporan Survey berhasil diperbarui!",
      data: updatedSurvey,
    });
  } catch (error) {
    console.error("Error Update Survey:", error);
    res.status(500).json({
      error:
        error.message || "Terjadi kesalahan server saat memperbarui survey.",
    });
  }
});

// ==========================================
// DELETE: HAPUS SURVEY REPORT
// ==========================================
router.delete("/surveys/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const existingSurvey = await prisma.surveyReport.findUnique({
      where: { id },
      include: { areas: { include: { photos: true } } },
    });
    if (!existingSurvey)
      return res.status(404).json({ error: "Laporan survey tidak ditemukan." });

    const urlsToDelete = existingSurvey.areas.flatMap((area) =>
      area.photos.map((p) => p.url),
    );

    // areas/dimensions/photos ikut kehapus lewat cascade delete di schema Prisma
    await prisma.surveyReport.delete({ where: { id } });

    deletePhotoFiles(urlsToDelete);

    res.json({ message: "Laporan Survey berhasil dihapus." });
  } catch (error) {
    console.error("Error Delete Survey:", error);
    res.status(500).json({
      error: error.message || "Terjadi kesalahan server saat menghapus survey.",
    });
  }
});

module.exports = router;
// cmt5xiwpa13dlffa6hghpeu3o
