"use strict";

const MAX_PERCENT = 1000;

function finitePercent(value, field) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0 || number > MAX_PERCENT) {
    throw new TypeError(`${field} harus berupa angka valid antara 0 dan ${MAX_PERCENT}.`);
  }
  return number;
}

function resolveOhBreakdown(input = {}, existing = {}) {
  const hasBreakdown = ["operationalPercent", "wastePercent", "profitPercent"]
    .some((key) => input[key] !== undefined);

  if (!hasBreakdown && input.overheadPercent !== undefined) {
    const operationalPercent = finitePercent(input.overheadPercent, "Operasional (%)");
    return { operationalPercent, wastePercent: 0, profitPercent: 0, overheadPercent: operationalPercent };
  }

  const operationalPercent = finitePercent(
    input.operationalPercent !== undefined ? input.operationalPercent : existing.operationalPercent,
    "Operasional (%)",
  );
  const wastePercent = finitePercent(
    input.wastePercent !== undefined ? input.wastePercent : existing.wastePercent,
    "Waste anggaran (%)",
  );
  const profitPercent = finitePercent(
    input.profitPercent !== undefined ? input.profitPercent : existing.profitPercent,
    "Laba/Profit (%)",
  );
  return {
    operationalPercent,
    wastePercent,
    profitPercent,
    overheadPercent: operationalPercent + wastePercent + profitPercent,
  };
}

function calculateRabOh(rapUnitPrice, volume, breakdown) {
  const rap = Number(rapUnitPrice || 0);
  const vol = Number(volume || 0);
  if (!Number.isFinite(rap) || !Number.isFinite(vol)) {
    throw new TypeError("Harga RAP atau volume tidak valid.");
  }
  const oh = resolveOhBreakdown(breakdown);
  const operationalNominal = rap * (oh.operationalPercent / 100);
  const wasteNominal = rap * (oh.wastePercent / 100);
  const profitNominal = rap * (oh.profitPercent / 100);
  const rabUnitPrice = rap + operationalNominal + wasteNominal + profitNominal;
  return {
    ...oh,
    operationalNominal,
    wasteNominal,
    profitNominal,
    rabUnitPrice,
    rapTotalPrice: rap * vol,
    rabTotalPrice: rabUnitPrice * vol,
  };
}

module.exports = { resolveOhBreakdown, calculateRabOh };
