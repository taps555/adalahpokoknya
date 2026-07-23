'use strict';

const express = require('express');
const prisma = require('../lib/prisma');
const { calculateJobPrice } = require('../services/calculateService');

const router = express.Router();

/** GET /api/jobs?period=2026&q=beton&category=... */
router.get('/jobs', async (req, res) => {
  const { period, q, category, discipline, grade } = req.query;
  const where = {};
  if (period) where.period = parseInt(period, 10);
  if (category) where.category = { contains: category, mode: 'insensitive' };
  if (q) where.name = { contains: q, mode: 'insensitive' };
  if (discipline) where.discipline = discipline;
  if (grade) where.grade = grade;

  const jobs = await prisma.jobType.findMany({
    where,
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
    select: {
      id: true, name: true, paymentUnit: true, category: true,
      period: true, needsReview: true, reference: true, discipline: true, grade: true,
    },
  });
  res.json(jobs);
});

/** GET /api/jobs/:id — detail AHSP lengkap dengan harga total terhitung */
router.get('/jobs/:id', async (req, res) => {
  const result = await calculateJobPrice(req.params.id);
  if (!result) return res.status(404).json({ error: 'Jenis pekerjaan tidak ditemukan.' });
  res.json(result);
});

/** GET /api/price-items?period=2026&type=BAHAN&q=semen */
router.get('/price-items', async (req, res) => {
  const { period, type, q } = req.query;
  const where = {};
  if (period) where.period = parseInt(period, 10);
  if (type) where.type = type;
  if (q) where.name = { contains: q, mode: 'insensitive' };

  const items = await prisma.priceItem.findMany({
    where,
    orderBy: { name: 'asc' },
    take: 500,
  });
  res.json(items);
});




/** PUT /jobs/:id — Update Pekerjaan dan Replace Komponennya */
router.put('/jobs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, paymentUnit, category, reference, period, components } = req.body;

    // Pastikan data eksis terlebih dahulu
    const existingJob = await prisma.jobType.findUnique({ where: { id } });
    if (!existingJob) return res.status(404).json({ error: 'Jenis pekerjaan tidak ditemukan.' });

    // Prisma Nested Update: Hapus semua komponen lama, lalu masukkan komponen baru.
    // Ini mencegah error "data tertinggal" jika user menghapus suatu bahan saat edit.
    const updatedJob = await prisma.jobType.update({
      where: { id },
      data: {
        name,
        paymentUnit,
        category,
        reference,
        period: parseInt(period, 10),
        components: {
          deleteMany: {}, // Hapus komponen lama
          create: components?.map(comp => ({ // Insert ulang berdasarkan form
            priceItemId: comp.priceItemId,
            section: comp.section,
            coefficient: comp.coefficient
          })) || []
        }
      }
    });

    res.json({ message: 'Pekerjaan berhasil diperbarui', data: updatedJob });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'Konflik! Kombinasi nama, satuan, dan tahun bentrok dengan pekerjaan lain.' });
    }
    console.error('Error Update Job:', error);
    res.status(500).json({ error: 'Terjadi kesalahan pada server saat memperbarui data.' });
  }
});

// ==========================================
// 4. DELETE (DELETE)
// ==========================================

/** DELETE /jobs/:id — Hapus Jenis Pekerjaan beserta komponennya */
router.delete('/jobs/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Karena skema Prisma kamu menggunakan relasi onDelete: Cascade pada JobComponent,
    // menghapus JobType otomatis akan membersihkan isi JobComponent tanpa sisa.
    await prisma.jobType.delete({
      where: { id }
    });

    res.json({ message: 'Pekerjaan beserta rinciannya berhasil dihapus.' });
  } catch (error) {
    // P2025: Record to delete does not exist
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Gagal menghapus: Pekerjaan tidak ditemukan.' });
    }
    console.error('Error Delete Job:', error);
    res.status(500).json({ error: 'Terjadi kesalahan pada server saat menghapus data.' });
  }
});

module.exports = router;

