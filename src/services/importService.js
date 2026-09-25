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
  { type, name, unit, price, period, discipline, grade, workCategoryId, filename, batchId },
) {
  const key = priceItemKey(type, name, unit) + `|${discipline}|${grade}|${workCategoryId || ""}`;
  if (cache.has(key)) return cache.get(key);

  const where = workCategoryId
    ? { uniq_price_item_work_category: { type, name, unit, period, workCategoryId, grade } }
    : { uniq_price_item: { type, name, unit, period, discipline, grade } };
  const categoryData = workCategoryId
    ? { workCategory: { connect: { id: workCategoryId } } }
    : {};
  const rec = await prisma.priceItem.upsert({
    where,
    update: {
      price,
      source: filename,
      batch: { connect: { id: batchId } },
      ...(workCategoryId
        ? { workCategory: { connect: { id: workCategoryId } } }
        : {}),
    },
    create: {
      type,
      name,
      unit,
      price,
      period,
      discipline,
      grade,
      ...categoryData,
      source: filename,
      batch: { connect: { id: batchId } },
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
  workCategoryId,
  filename,
  fileKind,
}) {
  const batch = await prisma.uploadBatch.create({
    data: {
      filename,
      fileKind,
      period,
      ...(workCategoryId
        ? { workCategory: { connect: { id: workCategoryId } } }
        : {}),
      status: "PROCESSING",
    },
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
        workCategoryId,
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
            workCategoryId,
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
        where: workCategoryId
          ? {
              uniq_job_type_work_category: {
                name: job.name,
                paymentUnit: job.paymentUnit,
                period,
                workCategoryId,
                grade,
              },
            }
          : {
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
          ...(workCategoryId
            ? { workCategory: { connect: { id: workCategoryId } } }
            : {}),
        },
        create: {
          name: job.name,
          paymentUnit: job.paymentUnit,
          category: job.category,
          reference: job.reference,
          period,
          discipline,
          grade,
          ...(workCategoryId
            ? { workCategory: { connect: { id: workCategoryId } } }
            : {}),
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
              `|${discipline}|${grade}|${workCategoryId || ""}`,
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

/**
 * Hapus satu batch upload HSPK BESERTA SELURUH ISINYA, dalam satu transaksi:
 *   1. lepas tautan master AHSP dari item BV/RAB (snapshot harga tetap utuh),
 *   2. hapus JobComponent milik JobType batch ini ATAU yang memakai PriceItem batch ini,
 *   3. hapus JobType batch ini,
 *   4. hapus PriceItem batch ini (harga dasar ikut hilang sesuai kebutuhan UI),
 *   5. hapus UploadIssue,
 *   6. hapus UploadBatch.
 * Dipakai oleh DELETE /api/uploads/:id dan legacy /api/del/:id.
 */
async function deleteUploadBatchData(db, batchId) {
  await db.$transaction(async (tx) => {
    const [jobTypes, priceItems] = await Promise.all([
      tx.jobType.findMany({ where: { batchId }, select: { id: true } }),
      tx.priceItem.findMany({ where: { batchId }, select: { id: true } }),
    ]);
    const jobTypeIds = jobTypes.map((item) => item.id);
    const priceItemIds = priceItems.map((item) => item.id);

    if (jobTypeIds.length > 0) {
      await tx.bvItem.updateMany({
        where: { sourceJobTypeId: { in: jobTypeIds } },
        data: { sourceJobTypeId: null },
      });
      await tx.rabItem.updateMany({
        where: { sourceJobTypeId: { in: jobTypeIds } },
        data: { sourceJobTypeId: null },
      });
    }

    // PriceItem bisa dipakai AHSP dari batch lain karena importer melakukan upsert.
    // Lepas ownership hanya untuk harga yang masih dipakai luar batch; harga yang
    // eksklusif tetap dihapus bersama batch agar tidak meninggalkan data yatim.
    let sharedPriceIds = [];
    if (priceItemIds.length > 0) {
      const sharedComponents = await tx.jobComponent.findMany({
        where: {
          priceItemId: { in: priceItemIds },
          ...(jobTypeIds.length > 0 ? { jobTypeId: { notIn: jobTypeIds } } : {}),
        },
        select: { priceItemId: true },
      });
      sharedPriceIds = [...new Set(sharedComponents.map((component) => component.priceItemId))];
      if (sharedPriceIds.length > 0) {
        await tx.priceItem.updateMany({
          where: { id: { in: sharedPriceIds } },
          data: { batchId: null },
        });
      }
    }

    if (jobTypeIds.length > 0) {
      await tx.jobComponent.deleteMany({
        where: { jobTypeId: { in: jobTypeIds } },
      });
    }
    await tx.jobType.deleteMany({ where: { batchId } });
    await tx.priceItem.deleteMany({
      where: {
        batchId,
        ...(sharedPriceIds.length > 0 ? { id: { notIn: sharedPriceIds } } : {}),
      },
    });
    await tx.uploadIssue.deleteMany({ where: { batchId } });
    await tx.uploadBatch.delete({ where: { id: batchId } });
  });
}

module.exports = { importParsedData, classifyResourceType, deleteUploadBatchData };
