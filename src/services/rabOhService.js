"use strict";

const MAX_PERCENT = 1000;
const MAX_COMPONENTS = 10;
const DEFAULT_OH_IDS = Object.freeze(["operational", "waste", "profit"]);
const VALID_OH_KINDS = new Set(["OPERATIONAL", "WASTE", "PROFIT", "CUSTOM"]);
const DEFAULT_OH_DEFINITIONS = Object.freeze([
  Object.freeze({ id: "operational", name: "Ops", kind: "OPERATIONAL" }),
  Object.freeze({ id: "waste", name: "Waste", kind: "WASTE" }),
  Object.freeze({ id: "profit", name: "Laba", kind: "PROFIT" }),
]);

function finitePercent(value, field) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0 || number > MAX_PERCENT) {
    throw new TypeError(`${field} harus berupa angka valid antara 0 dan ${MAX_PERCENT}.`);
  }
  return number;
}

function normalizeOhComponents(raw) {
  if (!Array.isArray(raw)) throw new TypeError("Komponen OH harus berupa daftar.");
  if (raw.length > MAX_COMPONENTS) throw new TypeError(`Komponen OH maksimal ${MAX_COMPONENTS}.`);
  const ids = new Set();
  return raw.map((row, index) => {
    const id = String(row?.id || "").trim();
    const name = String(row?.name || "").trim();
    const kind = String(row?.kind || "CUSTOM").toUpperCase();
    if (!id) throw new TypeError(`ID komponen OH ke-${index + 1} wajib diisi.`);
    if (ids.has(id)) throw new TypeError(`ID komponen OH ganda: ${id}.`);
    ids.add(id);
    if (!name) throw new TypeError(`Nama komponen OH ke-${index + 1} wajib diisi.`);
    if (name.length > 60) throw new TypeError(`Nama komponen OH ke-${index + 1} maksimal 60 karakter.`);
    if (!VALID_OH_KINDS.has(kind)) throw new TypeError(`Jenis komponen OH "${kind}" tidak valid.`);
    return { id, name, kind, percent: finitePercent(row.percent, `Komponen OH "${name}"`) };
  });
}

function normalizeOhDefinitions(raw) {
  const list = Array.isArray(raw) ? raw : DEFAULT_OH_DEFINITIONS;
  if (list.length > MAX_COMPONENTS) throw new TypeError(`Komponen OH maksimal ${MAX_COMPONENTS}.`);
  const ids = new Set();
  return list.map((row, index) => {
    const id = String(row?.id || "").trim();
    const name = String(row?.name || "").trim();
    const kind = String(row?.kind || "CUSTOM").toUpperCase();
    if (!id) throw new TypeError(`ID komponen OH ke-${index + 1} wajib diisi.`);
    if (ids.has(id)) throw new TypeError(`ID komponen OH ganda: ${id}.`);
    ids.add(id);
    if (!name) throw new TypeError(`Nama komponen OH ke-${index + 1} wajib diisi.`);
    if (name.length > 60) throw new TypeError(`Nama komponen OH ke-${index + 1} maksimal 60 karakter.`);
    if (!VALID_OH_KINDS.has(kind)) throw new TypeError(`Jenis komponen OH "${kind}" tidak valid.`);
    return { id, name, kind };
  });
}

// Nilai OH per item tetap ikut definisi project: komponen yang belum ada di
// item dibuat 0, komponen yang sudah tidak terdaftar dibuang.
function alignOhComponents(ohComponents, definitions, existing = {}) {
  const hasStoredRows = Array.isArray(ohComponents) && ohComponents.length > 0;
  const rows = hasStoredRows ? ohComponents : [];
  const byId = new Map(rows.map((row) => [String(row?.id || ""), row]));
  const legacyPercent = (definition) => {
    if (hasStoredRows) return 0;
    if (definition.kind === "OPERATIONAL") return existing.operationalPercent ?? existing.overheadPercent ?? 0;
    if (definition.kind === "WASTE") return existing.wastePercent ?? 0;
    if (definition.kind === "PROFIT") return existing.profitPercent ?? 0;
    return 0;
  };
  return normalizeOhDefinitions(definitions).map((definition) => ({
    id: definition.id,
    name: definition.name,
    kind: definition.kind,
    percent: finitePercent(byId.get(definition.id)?.percent ?? legacyPercent(definition), `Komponen OH "${definition.name}"`),
  }));
}

function resolveOhBreakdown(input = {}, existing = {}) {
  if (Object.prototype.hasOwnProperty.call(input, "ohComponents")) {
    const ohComponents = normalizeOhComponents(input.ohComponents);
    const operationalPercent = ohComponents.filter((c) => c.kind === "OPERATIONAL").reduce((s, c) => s + c.percent, 0);
    const wastePercent = ohComponents.filter((c) => c.kind === "WASTE").reduce((s, c) => s + c.percent, 0);
    const profitPercent = ohComponents.filter((c) => c.kind === "PROFIT").reduce((s, c) => s + c.percent, 0);
    return {
      operationalPercent,
      wastePercent,
      profitPercent,
      overheadPercent: ohComponents.reduce((s, c) => s + c.percent, 0),
      ohComponents,
    };
  }

  if (Array.isArray(existing.ohComponents)) {
    const ohComponents = normalizeOhComponents(existing.ohComponents);
    const operationalPercent = ohComponents.filter((c) => c.kind === "OPERATIONAL").reduce((s, c) => s + c.percent, 0);
    const wastePercent = ohComponents.filter((c) => c.kind === "WASTE").reduce((s, c) => s + c.percent, 0);
    const profitPercent = ohComponents.filter((c) => c.kind === "PROFIT").reduce((s, c) => s + c.percent, 0);
    return { operationalPercent, wastePercent, profitPercent, overheadPercent: ohComponents.reduce((s, c) => s + c.percent, 0), ohComponents };
  }

  const hasBreakdown = ["operationalPercent", "wastePercent", "profitPercent"].some((key) => input[key] !== undefined);
  if (!hasBreakdown && input.overheadPercent !== undefined) {
    const operationalPercent = finitePercent(input.overheadPercent, "Operasional (%)");
    return { operationalPercent, wastePercent: 0, profitPercent: 0, overheadPercent: operationalPercent };
  }
  const operationalPercent = finitePercent(input.operationalPercent !== undefined ? input.operationalPercent : existing.operationalPercent, "Operasional (%)");
  const wastePercent = finitePercent(input.wastePercent !== undefined ? input.wastePercent : existing.wastePercent, "Waste anggaran (%)");
  const profitPercent = finitePercent(input.profitPercent !== undefined ? input.profitPercent : existing.profitPercent, "Laba/Profit (%)");
  return { operationalPercent, wastePercent, profitPercent, overheadPercent: operationalPercent + wastePercent + profitPercent };
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

module.exports = { resolveOhBreakdown, calculateRabOh, normalizeOhDefinitions, alignOhComponents, DEFAULT_OH_DEFINITIONS };
