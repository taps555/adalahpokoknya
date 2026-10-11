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
  assert.deepEqual(resolveOhBreakdown({ overheadPercent: 12 }), {
    operationalPercent: 12,
    wastePercent: 0,
    profitPercent: 0,
    overheadPercent: 12,
  });
});

test("partial breakdown update preserves other buckets", () => {
  assert.deepEqual(
    resolveOhBreakdown({ wastePercent: 4 }, { operationalPercent: 5, wastePercent: 2, profitPercent: 10 }),
    { operationalPercent: 5, wastePercent: 4, profitPercent: 10, overheadPercent: 19 },
  );
});
