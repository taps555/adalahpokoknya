"use strict";

const prisma = require("../lib/prisma");

const LABOR_KEYWORDS = [
  "mandor",
  "pekerja",
  "tukang",
  "kepala tukang",
  "pembantu tukang",
];
const EQUIPMENT_KEYWORDS = [
  "sewa",
  "excavator",
  "crane",
  "dump truk",
  "dump truck",
  "flat bed truck",
  "flat deck truck",
  "water truck",
  "water tanker",
  "vibrator",
  "mixer",
  "grader",
  "roller",
  "stemper",
  "theodolite",
  "welding set",
  "tire roller",
];

/**
 * Baris di daftar "HARGA SATUAN BAHAN, UPAH DAN ALAT" tidak selalu eksplisit
 * bertipe bahan — ada juga upah harian (Mandor/OH) dan sewa alat. Kita tebak
 * tipenya dari nama/satuan. Untuk item AHSP (di dalam section A/B/C) tipenya
 * sudah pasti dari section-nya, jadi heuristik ini hanya dipakai untuk
 * daftar harga dasar yang berdiri sendiri.
 */
function classifyResourceType(name, unit) {
  const n = name.toLowerCase().replace(/\s+/g, " "); // <- normalize multi-spasi jadi 1
  const u = (unit || "").toLowerCase();
  if (
    u === "oh" ||
    u === "orang/hari" ||
    LABOR_KEYWORDS.some((k) => n.includes(k))
  ) {
    return "UPAH";
  }
  if (EQUIPMENT_KEYWORDS.some((k) => n.includes(k))) {
    return "ALAT";
  }
  return "BAHAN";
}

function priceItemKey(type, name, unit) {
  return `${type}|${name.trim().toLowerCase()}|${unit.trim().toLowerCase()}`;
}

const SECTION_TYPE = { labor: "UPAH", material: "BAHAN", equipment: "ALAT" };

/**
 * Upsert satu PriceItem, dan taruh id-nya ke dalam `cache` (Map) supaya
 * dipakai lagi saat menyusun JobComponent tanpa query ulang.
 */
async function upsertPriceItem(
  cache,
  { type, name, unit, price, period, discipline, grade, filename, batchId },
) {
  const key = priceItemKey(type, name, unit) + `|${discipline}|${grade}`;
  if (cache.has(key)) return cache.get(key);

  const rec = await prisma.priceItem.upsert({
    where: { uniq_price_item: { type, name, unit, period, discipline, grade } },
    update: { price, source: filename, batchId },
    create: {
      type,
      name,
      unit,
      price,
      period,
      discipline,
      grade,
      source: filename,
      batchId,
    },
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
async function importParsedData({
  parsed,
  period,
  discipline,
  grade,
  filename,
  fileKind,
}) {
  const batch = await prisma.uploadBatch.create({
    data: { filename, fileKind, period, status: "PROCESSING" },
  });

  const priceItemCache = new Map();

  try {
    for (const m of parsed.materials) {
      if (m.price == null) continue;
      const type = classifyResourceType(m.name, m.unit);
      await upsertPriceItem(priceItemCache, {
        type,
        name: m.name,
        unit: m.unit,
        price: m.price,
        period,
        discipline,
        grade,
        filename,
        batchId: batch.id,
      });
    }

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
            discipline,
            grade,
            filename,
            batchId: batch.id,
          });
        }
      }
    }

    let jobTypeCount = 0;
    for (const job of parsed.jobs) {
      const hasComponents =
        job.labor.length > 0 ||
        job.material.length > 0 ||
        job.equipment.length > 0;
      if (!hasComponents) continue;

      const jt = await prisma.jobType.upsert({
        where: {
          uniq_job_type: {
            name: job.name,
            paymentUnit: job.paymentUnit,
            period,
            discipline,
            grade,
          },
        },
        update: {
          category: job.category || undefined,
          reference: job.reference || undefined,
          source: filename,
          batch: { connect: { id: batch.id } },
          needsReview: !!job.needsReview,
          overhead: job.overhead,
        },
        create: {
          name: job.name,
          paymentUnit: job.paymentUnit,
          category: job.category,
          reference: job.reference,
          period,
          discipline,
          grade,
          source: filename,
          batch: { connect: { id: batch.id } },
          needsReview: !!job.needsReview,
          overhead: job.overhead,
        },
      });

      await prisma.jobComponent.deleteMany({ where: { jobTypeId: jt.id } });

      const componentRows = [];
      for (const sectionKey of Object.keys(SECTION_TYPE)) {
        const type = SECTION_TYPE[sectionKey];
        for (const item of job[sectionKey]) {
          if (item.price == null || item.coefficient == null) continue;
          const priceItemId = priceItemCache.get(
            priceItemKey(type, item.name, item.unit) +
              `|${discipline}|${grade}`,
          );
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

    const status = parsed.issues.length > 0 ? "PARTIAL" : "SUCCESS";
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
      data: {
        status: "FAILED",
        errorMessage: String(err.message || err),
        finishedAt: new Date(),
      },
    });
    throw err;
  }
}

module.exports = { importParsedData, classifyResourceType };
