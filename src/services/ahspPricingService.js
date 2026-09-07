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
async function computeAhspPricing({
  sourceJobTypeId,
  customComponents,
  defaultRapUnitPrice = 0,
  defaultOverheadPct = 0,
  overheadOverride,
}) {
  let componentRows = null;
  let rapUnitPrice = defaultRapUnitPrice;
  let overheadPct =
    overheadOverride != null ? overheadOverride : defaultOverheadPct;
  let jobType = null;

  if (sourceJobTypeId) {
    const calc = await calculateJobPrice(sourceJobTypeId);
    if (!calc) return null;

    jobType = calc.jobType;
    overheadPct = calc.jobType.overhead
      ? Number(calc.jobType.overhead)
      : overheadPct;

    componentRows = Object.entries(calc.breakdown).flatMap(([section, items]) =>
      items.map((item) => ({
        name: item.name,
        unit: item.unit,
        section,
        coefficient: item.coefficient,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
      })),
    );

    rapUnitPrice = componentRows.reduce(
      (sum, comp) => sum + Number(comp.lineTotal),
      0,
    );
  } else if (Array.isArray(customComponents) && customComponents.length > 0) {
    let baseTotal = 0;
    componentRows = customComponents.map((c) => {
      const lineTotal = Number(c.coefficient || 0) * Number(c.unitPrice || 0);
      baseTotal += lineTotal;
      return {
        name: c.name,
        unit: c.unit,
        section: c.section,
        coefficient: c.coefficient,
        unitPrice: c.unitPrice,
        lineTotal,
      };
    });
    rapUnitPrice = baseTotal;
  }

  const rabUnitPrice = rapUnitPrice + rapUnitPrice * (overheadPct / 100);

  return { jobType, componentRows, rapUnitPrice, overheadPct, rabUnitPrice };
}

module.exports = { computeAhspPricing };
