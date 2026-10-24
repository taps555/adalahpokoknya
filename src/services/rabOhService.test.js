"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveOhBreakdown, calculateRabOh, normalizeOhDefinitions, alignOhComponents } = require("./rabOhService");

test("OH total is operational plus budget waste plus planned profit", () => {
  const result = calculateRabOh(100000, 2, {
    operationalPercent: 5,
    wastePercent: 3,
    profitPercent: 10,
  });
  assert.equal(result.overheadPercent, 18);
  assert.equal(result.operationalNominal, 5000);
  assert.equal(result.wasteNominal, 3000);
  assert.equal(result.profitNominal, 10000);
  assert.equal(result.rabUnitPrice, 118000);
  assert.equal(result.rabTotalPrice, 236000);
});

test("legacy overhead migrates to operational without changing RAB", () => {
  assert.deepEqual(resolveOhBreakdown({ overheadPercent: 12 }), {
    operationalPercent: 12,
    wastePercent: 0,
    profitPercent: 0,
    overheadPercent: 12,
  });
});

test("dynamic OH rows calculate total, scalar subtotals, custom nominal, and RAB", () => {
  const result = calculateRabOh(100000, 2, {
    ohComponents: [
      { id: "operational", name: "Biaya Operasional", percent: 5, kind: "OPERATIONAL" },
      { id: "waste", name: "Waste Anggaran", percent: 3, kind: "WASTE" },
      { id: "profit", name: "Laba Rencana", percent: 10, kind: "PROFIT" },
      { id: "custom-ppn", name: "PPN", percent: 2, kind: "CUSTOM" },
    ],
  });
  assert.equal(result.overheadPercent, 20);
  assert.equal(result.operationalPercent, 5);
  assert.equal(result.wastePercent, 3);
  assert.equal(result.profitPercent, 10);
  assert.equal(result.customNominal, 2000);
  assert.equal(result.rabUnitPrice, 120000);
  assert.equal(result.rabTotalPrice, 240000);
  assert.equal(result.ohComponents.length, 4);
});

test("explicitly deleted default OH components stay deleted", () => {
  const result = resolveOhBreakdown({
    ohComponents: [
      { id: "custom-ppn", name: "PPN", percent: 11, kind: "CUSTOM" },
    ],
  });
  assert.deepEqual(result.ohComponents, [
    { id: "custom-ppn", name: "PPN", percent: 11, kind: "CUSTOM" },
  ]);
  assert.equal(result.operationalPercent, 0);
  assert.equal(result.wastePercent, 0);
  assert.equal(result.profitPercent, 0);
  assert.equal(result.overheadPercent, 11);
});

test("explicit empty OH list resets total to zero", () => {
  const result = resolveOhBreakdown({ ohComponents: [] }, {
    operationalPercent: 5, wastePercent: 3, profitPercent: 10,
    ohComponents: [{ id: "x", name: "X", percent: 18, kind: "CUSTOM" }],
  });
  assert.deepEqual(result.ohComponents, []);
  assert.equal(result.overheadPercent, 0);
  assert.equal(result.operationalPercent, 0);
});

test("project OH definitions align every item and seed missing values with zero", () => {
  const definitions = normalizeOhDefinitions([
    { id: "operational", name: "Ops", kind: "OPERATIONAL" },
    { id: "waste", name: "Waste", kind: "WASTE" },
    { id: "profit", name: "Laba", kind: "PROFIT" },
    { id: "custom-ppn", name: "PPN", kind: "CUSTOM" },
  ]);
  assert.deepEqual(alignOhComponents([
    { id: "operational", name: "Operasional lama", percent: 5, kind: "OPERATIONAL" },
  ], definitions), [
    { id: "operational", name: "Ops", percent: 5, kind: "OPERATIONAL" },
    { id: "waste", name: "Waste", percent: 0, kind: "WASTE" },
    { id: "profit", name: "Laba", percent: 0, kind: "PROFIT" },
    { id: "custom-ppn", name: "PPN", percent: 0, kind: "CUSTOM" },
  ]);
});

test("explicit empty project definition removes every project OH column", () => {
  assert.deepEqual(normalizeOhDefinitions([]), []);
  assert.deepEqual(alignOhComponents([
    { id: "custom-ppn", name: "PPN", percent: 11, kind: "CUSTOM" },
  ], []), []);
});

test("legacy item without components keeps its scalar OH after project alignment", () => {
  const definitions = normalizeOhDefinitions(null);
  assert.deepEqual(alignOhComponents(null, definitions, {
    operationalPercent: 5,
    wastePercent: 3,
    profitPercent: 10,
    overheadPercent: 18,
  }), [
    { id: "operational", name: "Ops", percent: 5, kind: "OPERATIONAL" },
    { id: "waste", name: "Waste", percent: 3, kind: "WASTE" },
    { id: "profit", name: "Laba", percent: 10, kind: "PROFIT" },
  ]);
});

test("dynamic OH rejects duplicate ids, blank names, invalid percent, and more than ten", () => {
  const valid = (id, name = id) => ({ id, name, percent: 1, kind: "CUSTOM" });
  assert.throws(() => resolveOhBreakdown({ ohComponents: [valid("x"), valid("x", "two")] }), /ganda/);
  assert.throws(() => resolveOhBreakdown({ ohComponents: [valid("x", "  ")] }), /wajib diisi/);
  assert.throws(() => resolveOhBreakdown({ ohComponents: [{ ...valid("x"), percent: -1 }] }), /angka valid/);
  assert.throws(() => resolveOhBreakdown({ ohComponents: Array.from({ length: 11 }, (_, i) => valid(`x${i}`)) }), /maksimal 10/);
});
