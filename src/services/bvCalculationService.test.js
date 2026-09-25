"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  calcBreakdownSubtotal,
  sumBreakdownSubtotals,
  buildBreakdownRows,
  redactSellingFields,
  validateJobTypeForProject,
  gradeForBv,
  disciplineForRab,
  normalizeWorkCategoryCode,
  normalizeProjectWorkCategoryConfigs,
  normalizeRequiredProjectWorkCategoryConfigs,
  buildWorkCategoryItemWhere,
} = require("./bvCalculationService");
const { deleteUploadBatchData } = require("./importService");
const { computeAhspPricing, normalizeAhspOverhead } = require("./ahspPricingService");

test("menghitung desimal koma dari data BV sipil tanpa NaN", () => {
  const subtotal = calcBreakdownSubtotal({
    panjang: "6,5",
    tinggi: "3",
    isPChecked: true,
    isTChecked: true,
    jumlahSisi: 1,
    jumlahBh: 1,
    waste: 0,
  });

  assert.equal(subtotal, 19.5);
  assert.equal(Number.isFinite(subtotal), true);
});

test("tanda strip dan nilai kosong dinormalisasi tanpa NaN", () => {
  const [row] = buildBreakdownRows([
    {
      panjang: "-",
      isPChecked: true,
      jumlahSisi: "-",
      jumlahBh: "",
      waste: "-",
    },
  ]);

  assert.equal(row.panjang, null);
  assert.equal(row.jumlahSisi, 1);
  assert.equal(row.jumlahBh, 1);
  assert.equal(row.waste, 0);
  assert.equal(row.subTotal, 0);
  assert.equal(Number.isFinite(row.subTotal), true);
});

test("menolak teks dimensi yang bukan angka", () => {
  assert.throws(
    () => calcBreakdownSubtotal({
      panjang: "abc",
      isPChecked: true,
      jumlahSisi: 1,
      jumlahBh: 1,
      waste: 0,
    }),
    /Panjang harus berupa angka/,
  );
});

test("menolak subtotal non-finite", () => {
  assert.throws(
    () => calcBreakdownSubtotal({
      panjang: 1e308,
      lebar: 1e308,
      isPChecked: true,
      isLChecked: true,
    }),
    /Panjang melebihi batas maksimum|Subtotal BV terlalu besar atau tidak valid/,
  );
});

test("menolak checkbox string dan angka negatif", () => {
  assert.throws(
    () => calcBreakdownSubtotal({ panjang: 2, isPChecked: "false" }),
    /isPChecked harus berupa boolean/,
  );
  assert.throws(
    () => calcBreakdownSubtotal({ panjang: -2, isPChecked: true }),
    /Panjang tidak boleh negatif/,
  );
  assert.throws(
    () => calcBreakdownSubtotal({ jumlahSisi: 1, jumlahBh: 1, waste: -100 }),
    /Waste tidak boleh negatif/,
  );
});
test("menolak batas numeric BV", () => {
  assert.throws(
    () => calcBreakdownSubtotal({ panjang: 1000000, isPChecked: true }),
    /Panjang melebihi batas maksimum/,
  );
  assert.throws(
    () => calcBreakdownSubtotal({ panjang: 1, isPChecked: true, waste: 100 }),
    /Waste melebihi batas maksimum/,
  );
});

test("menolak total volume non-finite", () => {
  assert.throws(
    () => sumBreakdownSubtotals([{ subTotal: Number.MAX_VALUE }, { subTotal: Number.MAX_VALUE }]),
    /Total volume BV terlalu besar atau tidak valid/,
  );
});

test("mempertahankan diameter saat breakdown dibentuk ulang", () => {
  const [row] = buildBreakdownRows([{
    diameter: "1,25",
    panjang: 2,
    isPChecked: true,
  }]);
  assert.equal(row.diameter, 1.25);
});

test("menolak pricing AHSP non-finite", async () => {
  await assert.rejects(
    () => computeAhspPricing({
      customComponents: [{ name: "X", coefficient: "abc", unitPrice: 10 }],
      overheadOverride: 10,
    }),
    /Koefisien harus berupa angka/,
  );
  await assert.rejects(
    () => computeAhspPricing({
      customComponents: [{ name: "X", coefficient: 1, unitPrice: 10 }],
      overheadOverride: "Infinity",
    }),
    /Overhead harus berupa angka/,
  );
});

test("mengonversi overhead AHSP fraction menjadi percentage points", () => {
  assert.equal(normalizeAhspOverhead(0.1), 10);
  assert.equal(normalizeAhspOverhead(0.15), 15);
});

test("redaksi RAB selling mempertahankan Prisma Decimal RAP", () => {
  const decimalLike = Object.create({ toJSON: () => "12500.50" });
  decimalLike.s = 1;
  decimalLike.e = 4;
  decimalLike.d = [12500, 5000000];

  const result = redactSellingFields({
    rapUnitPrice: decimalLike,
    rapTotalPrice: decimalLike,
    rabUnitPrice: decimalLike,
    rabTotalPrice: decimalLike,
    nested: { rabUnitPrice: decimalLike, rapTotalPrice: decimalLike },
  });

  assert.equal(result.rapUnitPrice, decimalLike);
  assert.equal(result.rapTotalPrice, decimalLike);
  assert.equal(result.rabUnitPrice, undefined);
  assert.equal(result.rabTotalPrice, undefined);
  assert.equal(result.nested.rabUnitPrice, undefined);
  assert.equal(result.nested.rapTotalPrice, decimalLike);
});

test("validasi AHSP wajib cocok dengan period discipline dan grade project", () => {
  const project = {
    hspkPeriod: 2026,
    grade: "A",
    sipilGrade: "B",
    interiorGrade: "C",
  };

  assert.equal(validateJobTypeForProject(
    { period: 2026, discipline: "SIPIL", grade: "B" },
    project,
    "SIPIL",
  ), null);
  assert.match(validateJobTypeForProject(
    { period: 2025, discipline: "SIPIL", grade: "B" },
    project,
    "SIPIL",
  ), /periode/);
  assert.match(validateJobTypeForProject(
    { period: 2026, discipline: "INTERIOR", grade: "C" },
    project,
    "SIPIL",
  ), /disiplin/);
  assert.match(validateJobTypeForProject(
    { period: 2026, discipline: "SIPIL", grade: "A" },
    project,
    "SIPIL",
  ), /grade/);
});

test("GENERAL wajib memilih disiplin AHSP sebelum validasi scope", () => {
  const project = {
    hspkPeriod: 2026,
    grade: "A",
    sipilGrade: "B",
    interiorGrade: "C",
  };

  assert.match(validateJobTypeForProject(
    { period: 2026, discipline: "SIPIL", grade: "B" },
    project,
    "GENERAL",
  ), /pilih disiplin AHSP/i);
  assert.equal(validateJobTypeForProject(
    { period: 2026, discipline: "SIPIL", grade: "B" },
    project,
    "GENERAL",
    "SIPIL",
  ), null);
  assert.equal(validateJobTypeForProject(
    { period: 2026, discipline: "INTERIOR", grade: "C" },
    project,
    "GENERAL",
    "INTERIOR",
  ), null);
  assert.match(validateJobTypeForProject(
    { period: 2026, discipline: "INTERIOR", grade: "C" },
    project,
    "GENERAL",
    "SIPIL",
  ), /disiplin/);
  assert.equal(gradeForBv({ disciplineLabel: "GENERAL" }, project, "SIPIL"), "B");
  assert.equal(gradeForBv({ disciplineLabel: "GENERAL" }, project, "INTERIOR"), "C");
  assert.equal(gradeForBv({ disciplineLabel: "INTERIOR" }, project, "SIPIL"), "C");
  assert.equal(disciplineForRab({ disciplineLabel: "SIPIL" }, null), "SIPIL");
  assert.equal(disciplineForRab({ disciplineLabel: "GENERAL" }, "INTERIOR"), "INTERIOR");
  assert.equal(disciplineForRab({ disciplineLabel: "GENERAL" }, null), null);
  assert.equal(gradeForBv({ disciplineLabel: "GENERAL" }, project, "INTERIOR"), "C");
});

test("menghitung waste persen dari data BV sipil", () => {
  const subtotal = calcBreakdownSubtotal({
    panjang: 4.2,
    lebar: 2.4,
    isPChecked: true,
    isLChecked: true,
    jumlahSisi: 1,
    jumlahBh: 1,
    waste: 15,
  });

  assert.equal(subtotal, 11.592);
});

test("normalisasi kode kategori master stabil dan menolak sentinel GENERAL", () => {
  assert.equal(normalizeWorkCategoryCode(" Landscape taman "), "LANDSCAPE_TAMAN");
  assert.equal(normalizeWorkCategoryCode("M.E.P"), "M_E_P");
  assert.throws(() => normalizeWorkCategoryCode("GENERAL"), /bukan kategori master/i);
  assert.throws(() => normalizeWorkCategoryCode("Semua"), /bukan kategori master/i);
  assert.throws(() => normalizeWorkCategoryCode("---"), /kode kategori/i);
});

test("konfigurasi kategori proyek membedakan HSPK dan CUSTOM", () => {
  const categories = [
    { id: "cat-sipil", code: "SIPIL", isActive: true },
    { id: "cat-landscape", code: "LANDSCAPE", isActive: true },
    { id: "cat-inactive", code: "ARSIP", isActive: false },
  ];

  assert.deepEqual(normalizeProjectWorkCategoryConfigs([
    { workCategoryId: "cat-sipil", pricingMode: "HSPK", grade: " b " },
    { workCategoryId: "cat-landscape", pricingMode: "CUSTOM", grade: "A" },
  ], categories), [
    { workCategoryId: "cat-sipil", pricingMode: "HSPK", grade: "B", isActive: true },
    { workCategoryId: "cat-landscape", pricingMode: "CUSTOM", grade: null, isActive: true },
  ]);

  assert.throws(
    () => normalizeProjectWorkCategoryConfigs([
      { workCategoryId: "cat-sipil", pricingMode: "HSPK" },
    ], categories),
    /grade.*HSPK/i,
  );
  assert.throws(
    () => normalizeProjectWorkCategoryConfigs([
      { workCategoryId: "cat-inactive", pricingMode: "CUSTOM" },
    ], categories),
    /tidak aktif/i,
  );
  assert.throws(
    () => normalizeProjectWorkCategoryConfigs([
      { workCategoryId: "cat-sipil", pricingMode: "CUSTOM" },
      { workCategoryId: "cat-sipil", pricingMode: "HSPK", grade: "A" },
    ], categories),
    /duplikat/i,
  );
});

test("validasi AHSP kategori dinamis mengikuti konfigurasi proyek", () => {
  const hspkProject = {
    hspkPeriod: 2026,
    workCategories: [{
      workCategoryId: "cat-landscape",
      pricingMode: "HSPK",
      grade: "L2",
      isActive: true,
      workCategory: { id: "cat-landscape", code: "LANDSCAPE" },
    }],
  };
  const jobType = {
    period: 2026,
    workCategoryId: "cat-landscape",
    grade: "L2",
  };

  assert.equal(
    validateJobTypeForProject(jobType, hspkProject, "LANDSCAPE", null, "cat-landscape"),
    null,
  );
  assert.equal(gradeForBv({ workCategoryId: "cat-landscape" }, hspkProject), "L2");

  const customProject = {
    ...hspkProject,
    workCategories: [{
      ...hspkProject.workCategories[0],
      pricingMode: "CUSTOM",
      grade: null,
    }],
  };
  assert.match(
    validateJobTypeForProject(jobType, customProject, "LANDSCAPE", null, "cat-landscape"),
    /mode CUSTOM/i,
  );
  assert.match(
    validateJobTypeForProject({ ...jobType, workCategoryId: "cat-mep" }, hspkProject, "LANDSCAPE", null, "cat-landscape"),
    /kategori/i,
  );
});

test("filter kategori RAB memakai FK dan fallback legacy terbatas", () => {
  assert.deepEqual(
    buildWorkCategoryItemWhere({ workCategoryId: "cat-mep", categoryCode: "MEP" }),
    { workCategoryId: "cat-mep" },
  );
  assert.deepEqual(
    buildWorkCategoryItemWhere({ workCategoryId: "cat-sipil", categoryCode: "SIPIL" }),
    {
      OR: [
        { workCategoryId: "cat-sipil" },
        { workCategoryId: null, discipline: "SIPIL" },
      ],
    },
  );
  assert.deepEqual(
    buildWorkCategoryItemWhere({ categoryCode: "INTERIOR" }),
    { discipline: "INTERIOR" },
  );
  assert.deepEqual(buildWorkCategoryItemWhere({ categoryCode: "GENERAL" }), {});
});

test("konfigurasi edit proyek menerima SIPIL dan INTERIOR CUSTOM tanpa grade", () => {
  const categories = [
    { id: "cat-sipil", code: "SIPIL", name: "Sipil", isActive: true },
    { id: "cat-interior", code: "INTERIOR", name: "Interior", isActive: true },
    { id: "cat-mep", code: "MEP", name: "MEP", isActive: true },
  ];

  assert.deepEqual(
    normalizeRequiredProjectWorkCategoryConfigs([
      { workCategoryId: "cat-sipil", pricingMode: "CUSTOM", isActive: true },
      { workCategoryId: "cat-interior", pricingMode: "CUSTOM", isActive: true },
      { workCategoryId: "cat-mep", pricingMode: "HSPK", grade: "B", isActive: true },
    ], categories),
    [
      { workCategoryId: "cat-sipil", pricingMode: "CUSTOM", grade: null, isActive: true },
      { workCategoryId: "cat-interior", pricingMode: "CUSTOM", grade: null, isActive: true },
      { workCategoryId: "cat-mep", pricingMode: "HSPK", grade: "B", isActive: true },
    ],
  );

  assert.throws(
    () => normalizeRequiredProjectWorkCategoryConfigs([
      { workCategoryId: "cat-sipil", pricingMode: "CUSTOM", isActive: true },
    ], categories),
    /Interior wajib/i,
  );
});

test("hapus batch HSPK membersihkan seluruh isi dalam satu transaksi", async () => {
  const calls = [];
  const jobTypeIds = ["job-1"];
  const priceItems = [
    { id: "price-1", type: "BAHAN", name: "Semen", unit: "zak", price: 0, discipline: null, grade: "A", period: 2027, source: "f.xlsx", workCategoryId: "cat-1" },
  ];
  const tx = {
    jobType: {
      findMany: async () => [{ id: "job-1" }],
      deleteMany: async (args) => calls.push(["job", args]),
    },
    priceItem: {
      findMany: async () => priceItems,
      updateMany: async (args) => calls.push(["price-detach", args]),
      deleteMany: async (args) => calls.push(["price", args]),
    },
    bvItem: { updateMany: async (args) => calls.push(["bv", args]) },
    rabItem: { updateMany: async (args) => calls.push(["rab", args]) },
    jobComponent: {
      findMany: async () => [
        { id: "comp-shared", jobTypeId: "job-other", priceItemId: "price-1" },
      ],
      update: async ({ where, data }) => calls.push(["comp-update", where.id, data]),
      deleteMany: async (args) => calls.push(["component", args]),
    },
    uploadIssue: { deleteMany: async (args) => calls.push(["issue", args]) },
    uploadBatch: { delete: async (args) => calls.push(["batch", args]) },
  };
  const db = { $transaction: async (callback) => callback(tx) };

  await deleteUploadBatchData(db, "batch-1");

  const names = calls.map((entry) => entry[0]);
  const priceDetach = calls.find(([name]) => name === "price-detach");
  assert.deepEqual(priceDetach[1], {
    where: { id: { in: ["price-1"] } },
    data: { batchId: null },
  });
  const componentDelete = calls.find(([name]) => name === "component");
  assert.deepEqual(componentDelete[1].where, {
    jobTypeId: { in: jobTypeIds },
  });
  const priceDelete = calls.find(([name]) => name === "price");
  assert.deepEqual(priceDelete[1], {
    where: { batchId: "batch-1", id: { notIn: ["price-1"] } },
  });
  const batchDelete = calls.find(([name]) => name === "batch");
  assert.deepEqual(batchDelete[1], { where: { id: "batch-1" } });
  assert.ok(names.indexOf("price-detach") < names.indexOf("component"));
  assert.ok(names.indexOf("component") < names.indexOf("price"));
  assert.ok(names.indexOf("price") < names.indexOf("batch"));
});
