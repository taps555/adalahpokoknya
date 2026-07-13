'use strict';

const prisma = require('../lib/prisma');

const LABOR_KEYWORDS = ['mandor', 'pekerja', 'tukang', 'kepala tukang', 'pembantu tukang'];
const EQUIPMENT_KEYWORDS = [
  'sewa',
  'excavator',
  'crane',
  'dump truk',
  'vibrator',
  'mixer',
  'grader',
  'roller',
  'stemper',
  'theodolite',
  'welding set',
  'tire roller',
];

/**
 * Baris di daftar "HARGA SATUAN BAHAN, UPAH DAN ALAT" tidak selalu eksplisit
 * bertipe bahan — ada juga upah harian (Mandor/OH) dan sewa alat. Kita tebak
 * tipenya dari nama/satuan. Untuk item AHSP (di dalam section A/B/C) tipenya
 * sudah pasti dari section-nya, jadi heuristik ini hanya dipakai untuk
 * daftar harga dasar yang berdiri sendiri.
 */
function classifyResourceType(name, unit) {
  const n = name.toLowerCase();
  const u = (unit || '').toLowerCase();
  if (u === 'oh' || u === 'orang/hari' || LABOR_KEYWORDS.some((k) => n.includes(k))) {
    return 'UPAH';
  }
  if (EQUIPMENT_KEYWORDS.some((k) => n.includes(k))) {
    return 'ALAT';
  }
  return 'BAHAN';
}

function priceItemKey(type, name, unit) {
  return `${type}|${name.trim().toLowerCase()}|${unit.trim().toLowerCase()}`;
}

const SECTION_TYPE = { labor: 'UPAH', material: 'BAHAN', equipment: 'ALAT' };

/**
 * Upsert satu PriceItem, dan taruh id-nya ke dalam `cache` (Map) supaya
 * dipakai lagi saat menyusun JobComponent tanpa query ulang.
 */
async function upsertPriceItem(cache, { type, name, unit, price, period, filename, batchId }) {
  const key = priceItemKey(type, name, unit);
  if (cache.has(key)) return cache.get(key);

  const rec = await prisma.priceItem.upsert({
    where: { uniq_price_item: { type, name, unit, period } },
    update: { price, source: filename, batchId },
    create: { type, name, unit, price, period, source: filename, batchId },
  });
  cache.set(key, rec.id);
  return rec.id;
}

/**
 * @param {object} params
 * @param {{materials:Array, jobs:Array, issues:Array}} params.parsed hasil dari parser
 * @param {number} params.period tahun berlaku HSPK, mis. 2026
 * @param {string} params.filename nama file asal (untuk audit)
 * @param {'PDF'|'XLSX'|'CSV'} params.fileKind
 */
async function importParsedData({ parsed, period, filename, fileKind }) {
  const batch = await prisma.uploadBatch.create({
    data: { filename, fileKind, period, status: 'PROCESSING' },
  });

  const priceItemCache = new Map();

  try {
    // 1) upsert semua item di daftar harga dasar (bahan/upah/alat)
    for (const m of parsed.materials) {
      if (m.price == null) continue; // sudah tercatat sbg issue oleh parser
      const type = classifyResourceType(m.name, m.unit);
      await upsertPriceItem(priceItemCache, {
        type,
        name: m.name,
        unit: m.unit,
        price: m.price,
        period,
        filename,
        batchId: batch.id,
      });
    }

    // 2) upsert PriceItem yang muncul di dalam AHSP tapi belum ada di daftar
    //    harga dasar (dokumen sumber kadang menyebut harga langsung di baris AHSP)
    for (const job of parsed.jobs) {
      for (const sectionKey of Object.keys(SECTION_TYPE)) {
        const type = SECTION_TYPE[sectionKey];
        for (const item of job[sectionKey]) {
          if (item.price == null) continue;
          await upsertPriceItem(priceItemCache, {
            type,
            name: item.name,
            unit: item.unit,
            price: item.price,
            period,
            filename,
            batchId: batch.id,
          });
        }
      }
    }

    // 3) upsert JobType (AHSP) + ganti seluruh JobComponent miliknya
    // 3) upsert JobType (AHSP) + ganti seluruh JobComponent miliknya
    let jobTypeCount = 0;
    for (const job of parsed.jobs) {
      
      // PERBAIKAN 1: Cek apakah pekerjaan ini memiliki komponen. 
      // Jika kosong (seperti baris judul 1.4 atau 1.4.1), maka lewati (skip)
      const hasComponents = job.labor.length > 0 || job.material.length > 0 || job.equipment.length > 0;
      if (!hasComponents) continue;
        // Tambahkan ini di atas baris 123 (upsert)
     
      
      

      const jt = await prisma.jobType.upsert({
        where: {
          uniq_job_type: { name: job.name, paymentUnit: job.paymentUnit, period },
        },
        update: {
          category: job.category || undefined,
          reference: job.reference || undefined,
          source: filename,
          batch: { connect: { id: batch.id } }, // <-- PERBAIKAN DI SINI
          needsReview: !!job.needsReview,
          overhead: job.overhead, 
        },
        create: {
          name: job.name,
          paymentUnit: job.paymentUnit,
          category: job.category,
          reference: job.reference,
          period,
          source: filename,
          batch: { connect: { id: batch.id } }, // <-- PERBAIKAN DI SINI
          needsReview: !!job.needsReview,
          overhead: job.overhead, 
        },
      });
  

      // hapus komponen lama supaya re-upload tahun yang sama tidak menumpuk duplikat
      await prisma.jobComponent.deleteMany({ where: { jobTypeId: jt.id } });

      const componentRows = [];
      for (const sectionKey of Object.keys(SECTION_TYPE)) {
        const type = SECTION_TYPE[sectionKey];
        for (const item of job[sectionKey]) {
          if (item.price == null || item.coefficient == null) continue;
          const priceItemId = priceItemCache.get(priceItemKey(type, item.name, item.unit));
          if (!priceItemId) continue;
          componentRows.push({
            jobTypeId: jt.id,
            priceItemId,
            section: type,
            coefficient: item.coefficient,
          });
        }
      }
     if (componentRows.length > 0) {
        await prisma.jobComponent.createMany({ data: componentRows });
      }
      jobTypeCount++;
  
    }

    // 4) simpan baris-baris yang gagal di-parse otomatis, untuk ditinjau manual
    if (parsed.issues.length > 0) {
      await prisma.uploadIssue.createMany({
        data: parsed.issues.map((i) => ({
          batchId: batch.id,
          context: i.context,
          rawLine: i.rawLine.slice(0, 2000),
          reason: i.reason,
        })),
      });
    }

    const status = parsed.issues.length > 0 ? 'PARTIAL' : 'SUCCESS';

    await prisma.uploadBatch.update({
      where: { id: batch.id },
      data: {
        status,
        priceItemCount: priceItemCache.size,
        jobTypeCount,
        finishedAt: new Date(),
      },
    });

    return {
      batchId: batch.id,
      status,
      priceItemCount: priceItemCache.size,
      jobTypeCount,
      issueCount: parsed.issues.length,
    };
  } catch (err) {
    await prisma.uploadBatch.update({
      where: { id: batch.id },
      data: { status: 'FAILED', errorMessage: String(err.message || err), finishedAt: new Date() },
    });
    throw err;
  }

}



module.exports = { importParsedData, classifyResourceType };
