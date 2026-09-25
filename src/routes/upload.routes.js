'use strict';

const express = require('express');
const path = require('path');
const upload = require('../middleware/upload');
const { parsePdfBuffer } = require('../parsers/pdfParser');
const { parseExcelBuffer } = require('../parsers/excelParser');
const { importParsedData } = require('../services/importService');
const { verifyToken, authorizeRoles } = require('../middleware/auth');
const prisma = require('../lib/prisma');

const router = express.Router();

function detectFileKind(originalName, mimetype) {
  const ext = path.extname(originalName).toLowerCase();
  if (ext === '.pdf' || mimetype === 'application/pdf') return 'PDF';
  if (['.xlsx', '.xls'].includes(ext)) return 'XLSX';
  return null;
}

/**
 * POST /api/upload
 * form-data:
 *   file    : file PDF atau Excel HSPK/AHSP
 *   period  : tahun berlaku data ini, misal 2026 (wajib)
 */
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'File tidak ditemukan. Kirim dengan field name "file".' });
    }
    const period = parseInt(req.body.period, 10);
    if (!Number.isInteger(period) || period < 2000 || period > 2100) {
      return res.status(400).json({ error: 'Field "period" (tahun HSPK) wajib diisi, contoh: 2026.' });
    }

    const { discipline, grade, workCategoryId } = req.body;

    // Jalur dinamis: kategori master dipilih, discipline boleh kosong.
    if (workCategoryId) {
      const category = await prisma.workCategory.findUnique({
        where: { id: workCategoryId },
      });
      if (!category || !category.isActive) {
        return res.status(400).json({ error: 'Kategori pekerjaan tidak ditemukan atau tidak aktif.' });
      }
    } else {
      // Jalur legacy: wajib discipline SIPIL/INTERIOR.
      if (!discipline || !['SIPIL', 'INTERIOR'].includes(discipline)) {
        return res.status(400).json({ error: 'Field "discipline" wajib diisi: SIPIL atau INTERIOR, atau pilih workCategoryId.' });
      }
    }

    if (!grade) {
      return res.status(400).json({ error: 'Field "grade" wajib diisi, contoh: A, B, atau C.' });
    }

    const fileKind = detectFileKind(req.file.originalname, req.file.mimetype);
    if (!fileKind) {
      return res.status(400).json({ error: 'Ekstensi file tidak dikenali. Gunakan .pdf, .xlsx, atau .xls.' });
    }

    const parsed =
      fileKind === 'PDF'
        ? await parsePdfBuffer(req.file.buffer)
        : parseExcelBuffer(req.file.buffer);

    if (parsed.materials.length === 0 && parsed.jobs.length === 0) {
      return res.status(422).json({
        error: 'Tidak ada data harga maupun AHSP yang berhasil dikenali dari file ini.',
        issuesSample: parsed.issues.slice(0, 20),
      });
    }

    const result = await importParsedData({
      parsed,
      period,
      discipline,
      grade,
      workCategoryId,
      filename: req.file.originalname,
      fileKind,
    });

    return res.status(201).json({
      message: 'Import selesai.',
      ...result,
      reviewUrl: `/api/uploads/${result.batchId}/issues`,
    });
  } catch (err) {
    console.error('[upload] gagal:', err);
    return res.status(500).json({ error: err.message || 'Gagal memproses file.' });
  }
});

/** GET /api/uploads — daftar batch upload (riwayat AHSP) beserta kategori & grade */
router.get('/uploads', async (req, res, next) => {
  try {
    const batches = await prisma.uploadBatch.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        workCategory: { select: { id: true, code: true, name: true } },
      },
    });

    // Grade per batch (UploadBatch tidak simpan grade; ambil dari JobType-nya)
    const grades = await prisma.jobType.groupBy({
      by: ['batchId', 'grade'],
      where: { batchId: { not: null } },
    });
    const gradeMap = {};
    for (const g of grades) {
      if (!g.batchId) continue;
      gradeMap[g.batchId] = gradeMap[g.batchId] || [];
      if (g.grade) gradeMap[g.batchId].push(g.grade);
    }

    // Discipline legacy (batch lama SIPIL/INTERIOR tanpa workCategoryId)
    const legacyMap = {};
    const legacy = await prisma.jobType.groupBy({
      by: ['batchId', 'discipline'],
      where: { batchId: { not: null }, discipline: { not: null } },
    });
    for (const l of legacy) {
      if (!l.batchId || !l.discipline) continue;
      legacyMap[l.batchId] = l.discipline;
    }

    res.json(
      batches.map((b) => ({
        id: b.id,
        filename: b.filename,
        fileKind: b.fileKind,
        period: b.period,
        status: b.status,
        priceItemCount: b.priceItemCount,
        jobTypeCount: b.jobTypeCount,
        errorMessage: b.errorMessage,
        createdAt: b.createdAt,
        finishedAt: b.finishedAt,
        workCategory: b.workCategory,
        grades: (gradeMap[b.id] || []).sort(),
        discipline: legacyMap[b.id] || null,
      })),
    );
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/uploads/:id — hapus batch upload beserta data AHSP-nya.
 * Urutan hapus: JobComponent -> JobType -> UploadIssue -> UploadBatch.
 * PriceItem TIDAK dihapus: bisa dipakai snapshot RabItemComponent / upload ulang
 * (upsert by unique key, jadi tidak menjadi duplikat).
 * Relasi BvItem/RabItem ke JobType jadi null otomatis (onDelete: SetNull default).
 */
router.delete(
  '/uploads/:id',
  verifyToken,
  authorizeRoles('SUPER_ADMIN', 'PROJECT_MANAGER'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const batch = await prisma.uploadBatch.findUnique({ where: { id } });
      if (!batch) {
        return res.status(404).json({ error: 'Batch upload tidak ditemukan.' });
      }

      // Pecah relasi BV/RAB items yang menunjuk JobType batch ini supaya
      // referensi ke data yang akan dihapus tidak menggantung.
      await prisma.bvItem.updateMany({
        where: { sourceJobType: { batchId: id } },
        data: { sourceJobTypeId: null },
      });
      await prisma.rabItem.updateMany({
        where: { sourceJobType: { batchId: id } },
        data: { sourceJobTypeId: null },
      });

      await prisma.jobComponent.deleteMany({
        where: { jobType: { batchId: id } },
      });
      await prisma.jobType.deleteMany({ where: { batchId: id } });
      await prisma.uploadIssue.deleteMany({ where: { batchId: id } });
      await prisma.uploadBatch.delete({ where: { id } });

      res.json({
        message: `Batch "${batch.filename}" (periode ${batch.period}) beserta data AHSP-nya berhasil dihapus.`,
      });
    } catch (err) {
      next(err);
    }
  },
);

/** Legacy: tetap dipertahankan agar pemanggil lama tidak putus */
router.delete(
  '/del/:id',
  verifyToken,
  authorizeRoles('SUPER_ADMIN', 'PROJECT_MANAGER'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const batch = await prisma.uploadBatch.findUnique({ where: { id } });
      if (!batch) {
        return res.status(404).json({ error: 'Batch upload tidak ditemukan.' });
      }

      await prisma.bvItem.updateMany({
        where: { sourceJobType: { batchId: id } },
        data: { sourceJobTypeId: null },
      });
      await prisma.rabItem.updateMany({
        where: { sourceJobType: { batchId: id } },
        data: { sourceJobTypeId: null },
      });

      await prisma.jobComponent.deleteMany({
        where: { jobType: { batchId: id } },
      });
      await prisma.jobType.deleteMany({ where: { batchId: id } });
      await prisma.uploadIssue.deleteMany({ where: { batchId: id } });
      await prisma.uploadBatch.delete({ where: { id } });

      res.json({ message: 'Data berhasil dihapus' });
    } catch (err) {
      next(err);
    }
  },
);

/** GET /api/uploads/:id/issues — baris yang gagal di-parse otomatis, untuk ditinjau manual */
router.get('/uploads/:id/issues', async (req, res) => {
  const issues = await prisma.uploadIssue.findMany({
    where: { batchId: req.params.id },
    orderBy: { createdAt: 'asc' },
  });
  res.json(issues);
});

module.exports = router;
