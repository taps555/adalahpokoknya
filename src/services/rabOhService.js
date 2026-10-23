"use strict";

const MAX_PERCENT = 1000;
const MAX_COMPONENTS = 10;
const DEFAULT_COMPONENT_IDS = Object.freeze(["operational", "waste", "profit"]);

function finitePercent(value, field) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0 || number > MAX_PERCENT) {
    throw new TypeError(`${field} harus berupa angka valid antara 0 dan ${MAX_PERCENT}.`);
  }
  return number;
}

function defaultComponents(operationalPercent = 0, wastePercent = 0, profitPercent = 0) {
  return [
    { id: "operational", name: "Operasional", percent: operationalPercent, kind: "OPERATIONAL" },
    { id: "waste", name: "Waste Anggaran", percent: wastePercent, kind: "WASTE" },
    { id: "profit", name: "Laba Rencana", percent: profitPercent, kind: "PROFIT" },
  ];
}

function normalizeComponents(rawComponents, fallback) {
  if (!Array.isArray(rawComponents) || rawComponents.length === 0) return null;
  if (rawComponents.length > MAX_COMPONENTS) {
    throw new TypeError(`Komponen OH maksimal ${MAX_COMPONENTS}.`);
  }
  const seen = new Set();
  const normalized = rawComponents.map((component, index) => {
    const id = String(component?.id || `component-${index + 1}`).trim();
    if (seen.has(id)) throw new TypeError(`ID komponen OH ganda: ${id}.`);
    seen.add(id);
    const name = String(component?.name || "").trim();
    if (!name) throw new TypeError(`Nama komponen OH ke-${index + 1} wajib diisi.`);
    if (name.length > 60) throw new TypeError(`Nama komponen OH ke-${index + 1} maksimal 60 karakter.`);
    const declaredKind = String(component?.kind || "").toUpperCase();
    const kind = ["OPERATIONAL", "WASTE", "PROFIT", "CUSTOM"].includes(declaredKind)
      ? declaredKind
      : DEFAULT_COMPONENT_IDS.includes(id) ? id.toUpperCase() : "CUSTOM";
    return { id, name, kind, percent: finitePercent(component?.percent, `Komponen OH "${name}"`) };
  });
  // Tiga komponen default selalu tersedia agar pembaca lama tetap menemukan nilainya.
  for (const id of DEFAULT_COMPONENT_IDS) {
    if (!seen.has(id)) {
      normalized.push({
        id,
        name: fallback?.[id]?.name || defaultComponents()[DEFAULT_COMPONENT_IDS.indexOf(id)].name,
        kind: id.toUpperCase(),
        percent: finitePercent(fallback?.[id]?.percent, `Komponen OH ${id}`),
      });
    }
  }
  return normalized;
}

function sumComponents(components = []) {
  return components.reduce((sum, component) => sum + finitePercent(component.percent, "Komponen OH"), 0);
}

function componentTotal(components, kind) {
  return components
    .filter((component) => component.kind === kind)
    .reduce((sum, component) => sum + component.percent, 0);
}

function resolveOhBreakdown(input = {}, existing = {}) {
  const existingComponents = Array.isArray(existing.ohComponents) ? existing.ohComponents : null;
  const rawComponents = input.ohComponents !== undefined ? input.ohComponents : existingComponents;

  if (Array.isArray(rawComponents) && rawComponents.length > 0) {
    const existingName = (id) => existingComponents?.find((component) => component.id === id)?.name;
    const ohComponents = normalizeComponents(rawComponents, {
      operational: { name: existingName("operational"), percent: existing.operationalPercent },
      waste: { name: existingName("waste"), percent: existing.wastePercent },
      profit: { name: existingName("profit"), percent: existing.profitPercent },
    });
    return {
      operationalPercent: componentTotal(ohComponents, "OPERATIONAL"),
      wastePercent: componentTotal(ohComponents, "WASTE"),
      profitPercent: componentTotal(ohComponents, "PROFIT"),
      overheadPercent: sumComponents(ohComponents),
      ohComponents,
    };
  }

  const hasBreakdown = ["operationalPercent", "wastePercent", "profitPercent"]
    .some((key) => input[key] !== undefined);

  if (!hasBreakdown && input.overheadPercent !== undefined) {
    const operationalPercent = finitePercent(input.overheadPercent, "Operasional (%)");
    return {
      operationalPercent,
      wastePercent: 0,
      profitPercent: 0,
      overheadPercent: operationalPercent,
      ohComponents: defaultComponents(operationalPercent, 0, 0),
    };
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
    ohComponents: defaultComponents(operationalPercent, wastePercent, profitPercent),
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
  const customNominal = (oh.ohComponents || [])
    .filter((component) => !["OPERATIONAL", "WASTE", "PROFIT"].includes(component.kind))
    .reduce((sum, component) => sum + rap * (component.percent / 100), 0);
  const rabUnitPrice = rap + operationalNominal + wasteNominal + profitNominal + customNominal;
  return {
    ...oh,
    operationalNominal,
    wasteNominal,
    profitNominal,
    customNominal,
    rabUnitPrice,
    rapTotalPrice: rap * vol,
    rabTotalPrice: rabUnitPrice * vol,
  };
}

module.exports = {
  resolveOhBreakdown,
  calculateRabOh,
  defaultComponents,
  MAX_COMPONENTS,
  DEFAULT_COMPONENT_IDS,
};
