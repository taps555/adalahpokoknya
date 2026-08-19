"use strict";
const express = require("express");
const router = express.Router();
const prisma = require("../../lib/prisma"); // Pastikan letak path folder prisma Anda benar
const multer = require("multer");
const path = require("path");
const fs = require("fs");

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
// Kita gunakan .any() karena Frontend akan mengirim field foto secara dinamis
// (misal: photo_0, photo_1, photo_2 tergantung jumlah area)
const uploadSurvey = multer({ storage: surveyStorage });

// ==========================================
// POST: CREATE SURVEY REPORT (Data + Foto)
// ==========================================
router.post(
  "/projects/:projectId/surveys",
  uploadSurvey.any(),
  async (req, res) => {
    try {
      const { projectId } = req.params;

      // Frontend harus mengirim data teks (JSON string) di dalam field bernama "surveyData"
      if (!req.body.surveyData) {
        return res
          .status(400)
          .json({ error: "Field surveyData (JSON) tidak ditemukan." });
      }

      // Parse JSON string kembali menjadi Object
      const parsedData = JSON.parse(req.body.surveyData);
      const { surveyDate, surveyorName, notes, areas } = parsedData;

      // Pastikan project ada
      const project = await prisma.project.findUnique({
        where: { id: projectId },
      });
      if (!project)
        return res.status(404).json({ error: "Project tidak ditemukan." });

      // Siapkan data Areas untuk Prisma Nested Create
      const areasToCreate = (areas || []).map((area, index) => {
        // Cari apakah ada file foto yang diupload untuk index area ini (misal fieldname: "photo_0")
        const uploadedPhoto = req.files.find(
          (f) => f.fieldname === `photo_${index}`,
        );
        const photoUrl = uploadedPhoto
          ? `/uploads/surveys/${uploadedPhoto.filename}`
          : null;

        // Siapkan dimensi (jika ada)
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
          photoUrl: photoUrl, // Masukkan URL foto jika ada
          dimensions: {
            create: dimensionsToCreate, // Insert ke tabel SurveyDimension
          },
        };
      });

      // Simpan semuanya sekaligus (Report -> Areas -> Dimensions)
      const newSurvey = await prisma.surveyReport.create({
        data: {
          projectId,
          surveyDate: new Date(surveyDate),
          surveyorName,
          notes: notes || null,
          areas: {
            create: areasToCreate, // Insert ke tabel SurveyArea
          },
        },
        include: {
          areas: {
            include: { dimensions: true },
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
          include: { dimensions: true },
        },
      },
    });

    res.json(surveys);
  } catch (error) {
    console.error("Error Get Surveys:", error);
    res.status(500).json({ error: "Gagal mengambil data survey." });
  }
});
module.exports = router;
