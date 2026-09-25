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

// GET /api/hspk/grades?period=2026&discipline=INTERIOR
// GET /api/hspk/grades?period=2026&workCategoryId=xxx
// Daftar grade yang tersedia untuk periode dan disiplin/kategori tertentu.
router.get('/grades', async (req, res, next) => {
  try {
    const { period, discipline, workCategoryId } = req.query;
    if (!period) return res.status(400).json({ error: 'period wajib diisi' });
    if (!discipline && !workCategoryId)
      return res.status(400).json({ error: 'discipline atau workCategoryId wajib diisi' });

    const rows = await prisma.jobType.findMany({
      where: {
        period: Number(period),
        grade: { not: null },
        ...(workCategoryId
          ? { workCategoryId }
          : { discipline }),
      },
      distinct: ['grade'],
      select: { grade: true },
      orderBy: { grade: 'asc' },
    });
    res.json(rows.map(r => r.grade));
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
    const { period, search, category, discipline, grade, workCategoryId } = req.query;
    if (!period) return res.status(400).json({ error: 'period wajib diisi' });

    const jobTypes = await prisma.jobType.findMany({
      where: {
        period: Number(period),
        ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
        ...(category ? { category } : {}),
        ...(workCategoryId ? { workCategoryId } : discipline ? { discipline } : {}),
        ...(grade ? { grade } : {}),
      },
      select: {
        id: true,
        name: true,
        paymentUnit: true,
        category: true,
        reference: true,
        needsReview: true,
        discipline: true,
        workCategoryId: true,
        workCategory: { select: { id: true, code: true, name: true } },
        grade: true,
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
/** Termasuk kategori dinamis (workCategoryId), bukan hanya discipline legacy */
router.get("/available-combos", async (req, res, next) => {
  try {
    // Legacy discipline combos (SIPIL/INTERIOR)
    const legacyRows = await prisma.jobType.findMany({
      where: { discipline: { not: null }, workCategoryId: null },
      distinct: ["period", "discipline", "grade"],
      select: { period: true, discipline: true, grade: true },
      orderBy: [{ period: "desc" }, { discipline: "asc" }, { grade: "asc" }],
    });

    // Dynamic category combos (MEP, dll)
    const dynamicRows = await prisma.jobType.findMany({
      where: { workCategoryId: { not: null } },
      distinct: ["period", "workCategoryId", "grade"],
      select: {
        period: true,
        workCategoryId: true,
        grade: true,
        workCategory: { select: { code: true, name: true } },
      },
      orderBy: [{ period: "desc" }, { grade: "asc" }],
    });

    res.json([
      ...legacyRows,
      ...dynamicRows.map((r) => ({
        period: r.period,
        discipline: r.workCategory?.code || r.workCategoryId,
        grade: r.grade,
        workCategoryId: r.workCategoryId,
        workCategory: r.workCategory,
      })),
    ]);
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
