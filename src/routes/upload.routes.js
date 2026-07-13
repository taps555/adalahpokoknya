'use strict';

const express = require('express');
const path = require('path');
const upload = require('../middleware/upload');
const { parsePdfBuffer } = require('../parsers/pdfParser');
const { parseExcelBuffer } = require('../parsers/excelParser');
const { importParsedData } = require('../services/importService');
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
        error:
          'Tidak ada data harga maupun AHSP yang berhasil dikenali dari file ini. ' +
          'Pastikan formatnya mirip dokumen HSPK/AHSP standar, atau cek endpoint review untuk detail.',
        issuesSample: parsed.issues.slice(0, 20),
      });
    }

    const result = await importParsedData({
      parsed,
      period,
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

/** GET /api/uploads — riwayat semua upload */
router.get('/uploads', async (req, res) => {
  const batches = await prisma.uploadBatch.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  res.json(batches);
});

/** GET /api/uploads/:id/issues — baris yang gagal di-parse otomatis, untuk ditinjau manual */
router.get('/uploads/:id/issues', async (req, res) => {
  const issues = await prisma.uploadIssue.findMany({
    where: { batchId: req.params.id },
    orderBy: { createdAt: 'asc' },
  });
  res.json(issues);
});

// Di dalam upload.routes.js
// Tambahkan ini di backend Anda (misal: routes/upload.routes.js)

router.delete('/del/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Logika hapus data di database (sesuaikan dengan nama model Prisma Anda)
    await prisma.uploadBatch.delete({
      where: { id: id }
    });

    res.status(200).json({ message: 'Data berhasil dihapus' });
  } catch (error) {
    console.error('Gagal menghapus data:', error);
    res.status(500).json({ message: 'Gagal menghapus data di database' });
  }
});
module.exports = router;
