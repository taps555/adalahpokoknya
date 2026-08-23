"use strict";
const express = require("express");
const router = express.Router();
const prisma = require("../../lib/prisma"); // Pastikan letak path folder prisma Anda benar
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { streamSurveyPdf } = require("../exportToFile/surveyView.routes"); // taro 1 folder sama file ini

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
// Sekarang tiap area bisa kirim BEBERAPA foto sekaligus.
// Frontend kirim field per area per slot foto, contoh:
//   area 0: photo_0_0, photo_0_1, photo_0_2, photo_0_3  (maks 4 foto per area)
//   area 1: photo_1_0, photo_1_1, dst
// Pola field: `photo_{areaIndex}_{photoIndex}`
const uploadSurvey = multer({ storage: surveyStorage });

// ==========================================
// POST: CREATE SURVEY REPORT (Data + Foto multi per area)
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

      const areasToCreate = (areas || []).map((area, areaIndex) => {
        // Cari semua file foto milik area ini: field `photo_{areaIndex}_{photoIndex}`
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
          luasan: dim.luasan ? Number(dim.luasan) : null,
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

module.exports = router;
