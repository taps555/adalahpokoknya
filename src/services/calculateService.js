'use strict';

const prisma = require('../lib/prisma');

/**
 * Hitung "Jumlah Harga Satuan Pekerjaan" dari sebuah JobType dengan
 * menjumlahkan koefisien x harga satuan untuk semua komponennya.
 * Ditambah perhitungan Biaya Umum dan Keuntungan (Overhead).
 */
async function calculateJobPrice(jobTypeId) {
  const jobType = await prisma.jobType.findUnique({
    where: { id: jobTypeId },
    include: { components: { include: { priceItem: true } } },
  });
  
  if (!jobType) return null;

  const breakdown = { UPAH: [], BAHAN: [], ALAT: [] };
  const subtotal = { UPAH: 0, BAHAN: 0, ALAT: 0 };

  for (const comp of jobType.components) {
    const coefficient = Number(comp.coefficient);
    const unitPrice = Number(comp.priceItem.price);
    const lineTotal = coefficient * unitPrice;
    
    subtotal[comp.section] += lineTotal;
    
    breakdown[comp.section].push({
      name: comp.priceItem.name,
      unit: comp.priceItem.unit,
      coefficient,
      unitPrice,
      lineTotal,
    });
  }

  // 1. Hitung total dasar (Jumlah A + B + C)
  const baseTotal = subtotal.UPAH + subtotal.BAHAN + subtotal.ALAT;

  // 2. Ambil persentase Biaya Umum. Jika tidak ada di DB, fallback ke 10% (0.1)
  const overheadPercentage = jobType.overhead != null ? Number(jobType.overhead) : 0.1;
  
  // 3. Hitung nominal Biaya Umum & Keuntungan
  const overheadValue = baseTotal * overheadPercentage;

  // 4. Hitung Harga Satuan Pekerjaan akhir (Total D + E)
  const total = baseTotal + overheadValue;

  return {
    jobType: {
      id: jobType.id,
      name: jobType.name,
      paymentUnit: jobType.paymentUnit,
      category: jobType.category,
      reference: jobType.reference,
      period: jobType.period,
      needsReview: jobType.needsReview,
      overhead: overheadPercentage, 
      discipline: jobType.discipline,   // <-- TAMBAH
      grade: jobType.grade,             // <-- TAMBAH
    },
    breakdown,
    subtotal,
    baseTotal,      // Jumlah (A+B+C)
    overheadValue,  // Biaya Umum dan Keuntungan 10% - 15% x D
    total,          // Harga Satuan Pekerjaan (D+E)
  };
}

module.exports = { calculateJobPrice };