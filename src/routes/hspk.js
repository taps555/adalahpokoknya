//hspk.js

"use strict";

const express = require("express");
const router = express.Router();
const prisma = require("../lib/prisma");

// GET /api/hspk/periods
// Daftar tahun/periode HSPK-AHSP yang sudah ada datanya di DB.
// Ini yang dipilih user di form input proyek (bukan upload ulang).
router.get("/periods", async (req, res, next) => {
  try {
    const rows = await prisma.jobType.findMany({
      distinct: ["period"],
      select: { period: true },
      orderBy: { period: "desc" },
    });
    res.json(rows.map((r) => r.period));
  } catch (err) {
    next(err);
  }
});

// GET /api/hspk/categories?period=2026
// Daftar kategori pekerjaan ("A. PEKERJAAN PERSIAPAN", dst) untuk filter.
router.get("/categories", async (req, res, next) => {
  try {
    const { period } = req.query;
    if (!period) return res.status(400).json({ error: "period wajib diisi" });

    const rows = await prisma.jobType.findMany({
      where: { period: Number(period), category: { not: null } },
      distinct: ["category"],
      select: { category: true },
      orderBy: { category: "asc" },
    });
    res.json(rows.map((r) => r.category));
  } catch (err) {
    next(err);
  }
});

// GET /api/hspk/jobtypes?period=2026&search=dinding&category=A
// Preview/cari daftar jenis pekerjaan (AHSP) untuk periode tertentu.
// Berguna untuk memastikan data yang dipilih memang lengkap sebelum
// project difinalisasi.
router.get('/jobtypes', async (req, res, next) => {
  try {
    const { period, search, category, discipline, grade } = req.query;
    if (!period) return res.status(400).json({ error: 'period wajib diisi' });

    const jobTypes = await prisma.jobType.findMany({
      where: {
        period: Number(period),
        ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
        ...(category ? { category } : {}),
        ...(discipline ? { discipline } : {}),
        ...(grade ? { grade } : {}),
      },
      select: {
        id: true,
        name: true,
        paymentUnit: true,
        category: true,
        reference: true,
        needsReview: true,
        reference: true,
        discipline: true,   // <-- TAMBAH biar keliatan di list
        grade: true,        // <-- TAMBAH
      },
      orderBy: { name: "asc" },
      take: 100,
    });
    res.json(jobTypes);
  } catch (err) {
    next(err);
  }
});

/** GET /api/hspk/available-grades?period=2026 */
/** GET /api/hspk/available-grades?period=2026 */
/** GET /api/hspk/available-combos */
router.get("/available-combos", async (req, res, next) => {
  try {
    const rows = await prisma.jobType.findMany({
      where: { discipline: { not: null } },
      distinct: ["period", "discipline", "grade"],
      select: { period: true, discipline: true, grade: true },
      orderBy: [{ period: "desc" }, { discipline: "asc" }, { grade: "asc" }],
    });
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get('/discipline-grades', async (req, res, next) => {
  try {
    const { period } = req.query;
    const where = period ? { period: Number(period) } : {};
    const rows = await prisma.jobType.findMany({
      where: { ...where, discipline: { not: null } },
      distinct: ['discipline', 'grade'],
      select: { discipline: true, grade: true },
      orderBy: [{ discipline: 'asc' }, { grade: 'asc' }],
    });
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
