"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveOhBreakdown, calculateRabOh } = require("./rabOhService");

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
  const result = resolveOhBreakdown({ overheadPercent: 12 });
  assert.equal(result.operationalPercent, 12);
  assert.equal(result.wastePercent, 0);
  assert.equal(result.profitPercent, 0);
  assert.equal(result.overheadPercent, 12);
});

test("partial breakdown update preserves other buckets", () => {
  const result = resolveOhBreakdown({ wastePercent: 4 }, { operationalPercent: 5, wastePercent: 2, profitPercent: 10 });
  assert.equal(result.operationalPercent, 5);
  assert.equal(result.wastePercent, 4);
  assert.equal(result.profitPercent, 10);
  assert.equal(result.overheadPercent, 19);
});

test("komponen OH dinamis ikut dijumlahkan ke total dan result", () => {
  const result = calculateRabOh(100000, 1, {
    operationalPercent: 5,
    wastePercent: 3,
    profitPercent: 10,
    ohComponents: [
      { id: "operational", name: "Operasional", percent: 5, kind: "OPERATIONAL" },
      { id: "waste", name: "Waste Anggaran", percent: 3, kind: "WASTE" },
      { id: "profit", name: "Laba Rencana", percent: 10, kind: "PROFIT" },
      { id: "custom-1", name: "Overhead Kantor", percent: 2, kind: "CUSTOM" },
    ],
  });
  assert.equal(result.overheadPercent, 20);
  assert.equal(result.rabUnitPrice, 120000);
  assert.equal(result.ohComponents.length, 4);
  assert.equal(result.ohComponents[3].name, "Overhead Kantor");
});

test("komponen dinamis tanpa 3 default tetap menghitung total dari komponen", () => {
  const result = resolveOhBreakdown({
    ohComponents: [
      { id: "a", name: "Operasional", percent: 6, kind: "OPERATIONAL" },
      { id: "b", name: "Custom", percent: 4, kind: "CUSTOM" },
    ],
  });
  assert.equal(result.overheadPercent, 10);
  assert.equal(result.operationalPercent, 6);
});

test("nama komponen default boleh diubah tanpa mengubah kind", () => {
  const result = resolveOhBreakdown({
    ohComponents: [
      { id: "operational", name: "Biaya Operasional Proyek", percent: 5, kind: "OPERATIONAL" },
      { id: "waste", name: "Cadangan", percent: 2, kind: "WASTE" },
      { id: "profit", name: "Laba", percent: 8, kind: "PROFIT" },
    ],
  });
  assert.equal(result.operationalPercent, 5);
  assert.equal(result.ohComponents[0].name, "Biaya Operasional Proyek");
  assert.equal(result.overheadPercent, 15);
});

test("legacy call tanpa komponen tetap kompatibel", () => {
  const result = resolveOhBreakdown({ operationalPercent: 5, wastePercent: 3, profitPercent: 10 });
  assert.equal(result.overheadPercent, 18);
  assert.equal(result.ohComponents.length, 3);
});
