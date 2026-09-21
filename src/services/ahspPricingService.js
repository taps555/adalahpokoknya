"use strict";

const { calculateJobPrice } = require("./calculateService");

/**
 * Hitung componentRows, rapUnitPrice, overheadPct, dan rabUnitPrice untuk satu
 * item — entah dari master AHSP (sourceJobTypeId) atau dari custom components.
 * Satuin logic yang sebelumnya diulang persis di 4 tempat di bv.routes.js:
 * link-to-rab (parent), link-to-rab (children), sync tunggal, bulk-sync.
 *
 * Prioritas overheadPct: overhead dari master AHSP (kalau sourceJobTypeId ada
 * dan jobType.overhead terisi) > overheadOverride > defaultOverheadPct.
 * Prioritas rapUnitPrice: hasil hitung AHSP/custom > defaultRapUnitPrice.
 *
 * componentRows dikembalikan `null` kalau gak ada sourceJobTypeId ATAU
 * customComponents kosong — dipakai caller buat mutusin apa perlu update
 * kolom `components` di Prisma atau dibiarkan (lihat pemakaian di sync vs
 * link-to-rab).
 *
 * @returns {Promise<null | { jobType, componentRows, rapUnitPrice, overheadPct, rabUnitPrice }>}
 *   null kalau sourceJobTypeId diisi tapi JobType-nya gak ketemu di DB.
 */
const FINITE_LIMITS = Object.freeze({
  money: 1e15,
  overhead: 1000,
});

function finiteBvPrice(value, field, { min = 0, max = FINITE_LIMITS.money } = {}) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) throw new TypeError(`${field} harus berupa angka.`);
  if (number < min) throw new TypeError(`${field} tidak boleh kurang dari ${min}.`);
  if (number > max) throw new TypeError(`${field} melebihi batas maksimum ${max}.`);
  return number;
}

function normalizeAhspOverhead(value) {
  return finiteBvPrice(Number(value ?? 0) * 100, "Overhead", {
    max: FINITE_LIMITS.overhead,
  });
}

async function computeAhspPricing({
  sourceJobTypeId,
  customComponents,
  defaultRapUnitPrice = 0,
  defaultOverheadPct = 0,
  overheadOverride,
}) {
  let componentRows = null;
  let rapUnitPrice = finiteBvPrice(defaultRapUnitPrice, "RAP harga satuan");
  let overheadPct = finiteBvPrice(
    overheadOverride != null ? overheadOverride : defaultOverheadPct,
    "Overhead",
    { max: FINITE_LIMITS.overhead },
  );
  let jobType = null;

  if (sourceJobTypeId) {
    const calc = await calculateJobPrice(sourceJobTypeId);
    if (!calc) return null;

    jobType = calc.jobType;
    overheadPct = calc.jobType.overhead
      ? normalizeAhspOverhead(calc.jobType.overhead)
      : overheadPct;

    componentRows = Object.entries(calc.breakdown).flatMap(([section, items]) =>
      items.map((item) => {
        const coefficient = finiteBvPrice(item.coefficient, "Koefisien");
        const unitPrice = finiteBvPrice(item.unitPrice, "Harga satuan komponen");
        const lineTotal = finiteBvPrice(item.lineTotal, "Total komponen");
        return {
          name: item.name,
          unit: item.unit,
          section,
          coefficient,
          unitPrice,
          lineTotal,
        };
      }),
    );

    rapUnitPrice = finiteBvPrice(
      componentRows.reduce((sum, comp) => sum + comp.lineTotal, 0),
      "RAP harga satuan",
    );
  } else if (Array.isArray(customComponents) && customComponents.length > 0) {
    let baseTotal = 0;
    componentRows = customComponents.map((c) => {
      const coefficient = finiteBvPrice(c.coefficient, "Koefisien");
      const unitPrice = finiteBvPrice(c.unitPrice, "Harga satuan komponen");
      const lineTotal = finiteBvPrice(coefficient * unitPrice, "Total komponen");
      baseTotal = finiteBvPrice(baseTotal + lineTotal, "RAP harga satuan");
      return {
        name: c.name,
        unit: c.unit,
        section: c.section,
        coefficient,
        unitPrice,
        lineTotal,
      };
    });
    rapUnitPrice = finiteBvPrice(baseTotal, "RAP harga satuan");
  }

  const rabUnitPrice = finiteBvPrice(
    rapUnitPrice + rapUnitPrice * (overheadPct / 100),
    "RAB harga satuan",
  );

  return { jobType, componentRows, rapUnitPrice, overheadPct, rabUnitPrice };
}

module.exports = { computeAhspPricing, normalizeAhspOverhead };
