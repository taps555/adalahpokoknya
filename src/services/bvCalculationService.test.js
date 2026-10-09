"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
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
  resolveBvClassification,
  resolveRabSwitchJobClassification,
  linkedRabClassificationPatch,
  collectBvSubtreeIds,
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

test("konfigurasi proyek menerima kategori dinamis tanpa mewajibkan SIPIL atau INTERIOR", () => {
  const categories = [
    { id: "cat-konstruksi", code: "KONSTRUKSI", name: "Konstruksi", isActive: true },
    { id: "cat-canopy", code: "CANOPY", name: "Canopy", isActive: true },
  ];

  assert.deepEqual(
    normalizeRequiredProjectWorkCategoryConfigs([
      { workCategoryId: "cat-canopy", pricingMode: "HSPK", grade: "B", isActive: true },
    ], categories),
    [
      { workCategoryId: "cat-canopy", pricingMode: "HSPK", grade: "B", isActive: true },
    ],
  );
});

test("validates BV header child standalone and legacy edit classification invariants", async () => {
  const db = {
    workSubCategory: {
      findUnique: async ({ where }) => ({
        id: where.id,
        categoryId: where.id === "sub-other" ? "cat-2" : "cat-1",
        isActive: where.id !== "sub-inactive",
      }),
    },
  };

  assert.deepEqual(await resolveBvClassification(db, {
    isHeaderOnly: true,
    workCategoryId: "cat-1",
    workSubCategoryId: "sub-1",
  }), { workCategoryId: "cat-1", workSubCategoryId: null });

  await assert.rejects(
    () => resolveBvClassification(db, {
      isHeaderOnly: false,
      parent: { id: "parent", isHeaderOnly: false, workCategoryId: "cat-1" },
      workSubCategoryId: "sub-1",
    }),
    /induk.*header/i,
  );
  assert.deepEqual(await resolveBvClassification(db, {
    isHeaderOnly: false,
    parent: { id: "parent", isHeaderOnly: true, workCategoryId: "cat-1" },
    workCategoryId: "cat-2",
    workSubCategoryId: "sub-1",
  }), { workCategoryId: "cat-1", workSubCategoryId: "sub-1" });

  await assert.rejects(
    () => resolveBvClassification(db, { isHeaderOnly: false, workCategoryId: "cat-1" }),
    /subkategori/i,
  );
  await assert.rejects(
    () => resolveBvClassification(db, {
      isHeaderOnly: false, workCategoryId: "cat-1", workSubCategoryId: "sub-other",
    }),
    /bukan milik kategori/i,
  );
  await assert.rejects(
    () => resolveBvClassification(db, {
      isHeaderOnly: false, workCategoryId: "cat-1", workSubCategoryId: "sub-inactive",
    }),
    /tidak aktif/i,
  );

  // Unrelated edits on legacy discipline-only rows must NOT be blocked during
  // transition: the stored (in)complete classification is preserved as-is.
  assert.deepEqual(await resolveBvClassification(db, {
    isHeaderOnly: false,
    existing: { workCategoryId: null, workSubCategoryId: null },
    isEdit: true,
    classificationTouched: false,
  }), { workCategoryId: null, workSubCategoryId: null });
  await assert.rejects(
    () => resolveBvClassification(db, {
      isHeaderOnly: false,
      existing: { workCategoryId: null, workSubCategoryId: null },
      isEdit: true,
      classificationTouched: true,
    }),
    /kategori pekerjaan/i,
  );
});

test("legacy edit keeps category-configured rows with null subcategory readable and untouched", async () => {
  const db = {
    workSubCategory: { findUnique: async ({ where }) => ({ id: where.id, categoryId: "cat-1", isActive: true }) },
  };
  // Existing leaf with a category but a null subcategory: an unrelated edit
  // (volume/name/breakdown only) must resolve without requiring a subcategory.
  assert.deepEqual(await resolveBvClassification(db, {
    isHeaderOnly: false,
    existing: { workCategoryId: "cat-1", workSubCategoryId: null },
    isEdit: true,
    classificationTouched: false,
  }), { workCategoryId: "cat-1", workSubCategoryId: null });
  // But once classification is touched, a valid active subcategory is required.
  await assert.rejects(
    () => resolveBvClassification(db, {
      isHeaderOnly: false,
      existing: { workCategoryId: "cat-1", workSubCategoryId: null },
      workCategoryId: "cat-1",
      isEdit: true,
      classificationTouched: true,
    }),
    /subkategori/i,
  );
  // When classification is touched and a fresh valid subcategory arrives, it resolves.
  assert.deepEqual(await resolveBvClassification(db, {
    isHeaderOnly: false,
    existing: { workCategoryId: "cat-1", workSubCategoryId: null },
    workCategoryId: "cat-1",
    workSubCategoryId: "sub-1",
    isEdit: true,
    classificationTouched: true,
  }), { workCategoryId: "cat-1", workSubCategoryId: "sub-1" });
});

test("legacy projects without configured work categories keep the discipline fallback", async () => {
  const db = { workSubCategory: { findUnique: async () => null } };
  // Create on a project with zero ProjectWorkCategory rows: null category must
  // NOT be an unconditional new-classification error.
  assert.deepEqual(await resolveBvClassification(db, {
    isHeaderOnly: true,
    workCategoryId: null,
    projectHasCategories: false,
  }), { workCategoryId: null, workSubCategoryId: null });
  assert.deepEqual(await resolveBvClassification(db, {
    isHeaderOnly: false,
    workCategoryId: null,
    workSubCategoryId: null,
    projectHasCategories: false,
  }), { workCategoryId: null, workSubCategoryId: null });
  // Update of an existing legacy row likewise passes when untouched or touched
  // without introducing a category.
  assert.deepEqual(await resolveBvClassification(db, {
    isHeaderOnly: false,
    existing: { workCategoryId: null, workSubCategoryId: null },
    isEdit: true,
    classificationTouched: true,
    projectHasCategories: false,
  }), { workCategoryId: null, workSubCategoryId: null });
  // On a configured project the same writes are rejected.
  await assert.rejects(
    () => resolveBvClassification(db, {
      isHeaderOnly: true,
      workCategoryId: null,
      projectHasCategories: true,
    }),
    /header/i,
  );
  await assert.rejects(
    () => resolveBvClassification(db, {
      isHeaderOnly: false,
      workCategoryId: null,
      projectHasCategories: true,
    }),
    /kategori/i,
  );
});

test("linked RAB classification patch follows leaf changes only", () => {
  const linkedLeaf = {
    isHeaderOnly: false, linkedRabItemId: "rab-1",
    workCategoryId: "cat-1", workSubCategoryId: "sub-1",
  };
  // Subcategory update on a linked leaf propagates both FKs to the RAB row.
  assert.deepEqual(
    linkedRabClassificationPatch(linkedLeaf, { workCategoryId: "cat-1", workSubCategoryId: "sub-2" }),
    { id: "rab-1", workCategoryId: "cat-1", workSubCategoryId: "sub-2", discipline: null },
  );
  // Category update propagates both values as well.
  assert.deepEqual(
    linkedRabClassificationPatch(linkedLeaf, { workCategoryId: "cat-2", workSubCategoryId: "sub-9" }),
    { id: "rab-1", workCategoryId: "cat-2", workSubCategoryId: "sub-9", discipline: null },
  );
  // Same category/subcategory still emits a repair when linked RAB retains a
  // stale legacy discipline alongside a dynamic category.
  assert.deepEqual(
    linkedRabClassificationPatch({
      ...linkedLeaf,
      linkedRabItem: { discipline: "SIPIL" },
    }, { workCategoryId: "cat-1", workSubCategoryId: "sub-1" }),
    { id: "rab-1", workCategoryId: "cat-1", workSubCategoryId: "sub-1", discipline: null },
  );
  // No classification change and no stale discipline -> no linked-row write.
  assert.equal(
    linkedRabClassificationPatch(linkedLeaf, { workCategoryId: "cat-1", workSubCategoryId: "sub-1" }),
    null,
  );
  // Headers are handled by the subtree cascade, never by the leaf patch.
  assert.equal(
    linkedRabClassificationPatch(
      { isHeaderOnly: true, linkedRabItemId: "rab-2", workCategoryId: "cat-1", workSubCategoryId: null },
      { workCategoryId: "cat-2", workSubCategoryId: null },
    ),
    null,
  );
  // Unlinked rows have nothing to sync.
  assert.equal(
    linkedRabClassificationPatch(
      { isHeaderOnly: false, linkedRabItemId: null, workCategoryId: "cat-1", workSubCategoryId: "sub-1" },
      { workCategoryId: "cat-1", workSubCategoryId: "sub-2" },
    ),
    null,
  );
  // Legacy leaf that stays unclassified during transition: no write.
  assert.equal(
    linkedRabClassificationPatch(
      { isHeaderOnly: false, linkedRabItemId: "rab-3", workCategoryId: null, workSubCategoryId: null },
      { workCategoryId: null, workSubCategoryId: null },
    ),
    null,
  );
});

test("switch-job classification keeps BV ownership for linked rows and validates free rows", async () => {
  const db = {
    workSubCategory: {
      findUnique: async ({ where }) => ({
        id: where.id,
        categoryId: where.id === "sub-1" ? "cat-1" : "cat-9",
        isActive: where.id !== "sub-inactive",
      }),
    },
  };
  const project = {
    workCategories: [
      { workCategoryId: "cat-1", isActive: true },
      { workCategoryId: "cat-2", isActive: true },
      { workCategoryId: "cat-off", isActive: false },
    ],
  };

  // Linked rows preserve BV classification and refuse explicit drift.
  const linked = {
    workCategoryId: "cat-1", workSubCategoryId: "sub-1", bvItem: { id: "bv-1" },
  };
  assert.deepEqual(await resolveRabSwitchJobClassification(db, {
    existing: linked, project, jobTypeWorkCategoryId: "cat-2",
  }), { workCategoryId: "cat-1", workSubCategoryId: "sub-1" });
  await assert.rejects(
    () => resolveRabSwitchJobClassification(db, {
      existing: linked, project, requestedWorkCategoryId: "cat-2",
    }),
    /mengikuti item BV/i,
  );
  await assert.rejects(
    () => resolveRabSwitchJobClassification(db, {
      existing: linked, project, requestedWorkSubCategoryId: "sub-9",
    }),
    /mengikuti item BV/i,
  );

  // Unlinked rows may adopt a validated payload category; a stale subcategory
  // is cleared when the category actually changes.
  assert.deepEqual(await resolveRabSwitchJobClassification(db, {
    existing: { workCategoryId: "cat-1", workSubCategoryId: "sub-1", bvItem: null },
    project,
    requestedWorkCategoryId: "cat-2",
  }), { workCategoryId: "cat-2", workSubCategoryId: null });
  // Payload subcategory is validated against the owning active category.
  assert.deepEqual(await resolveRabSwitchJobClassification(db, {
    existing: { workCategoryId: "cat-1", workSubCategoryId: "sub-1", bvItem: null },
    project,
    requestedWorkSubCategoryId: "sub-1",
  }), { workCategoryId: "cat-1", workSubCategoryId: "sub-1" });
  await assert.rejects(
    () => resolveRabSwitchJobClassification(db, {
      existing: { workCategoryId: "cat-1", workSubCategoryId: null, bvItem: null },
      project,
      requestedWorkSubCategoryId: "sub-wrong",
    }),
    /bukan milik kategori/i,
  );
  await assert.rejects(
    () => resolveRabSwitchJobClassification(db, {
      existing: { workCategoryId: "cat-1", workSubCategoryId: null, bvItem: null },
      project,
      requestedWorkSubCategoryId: "sub-inactive",
    }),
    /tidak aktif/i,
  );
  // Unknown/inactive payload categories are refused.
  await assert.rejects(
    () => resolveRabSwitchJobClassification(db, {
      existing: { workCategoryId: "cat-1", workSubCategoryId: "sub-1", bvItem: null },
      project,
      requestedWorkCategoryId: "cat-off",
    }),
    /tidak aktif pada project/i,
  );
  await assert.rejects(
    () => resolveRabSwitchJobClassification(db, {
      existing: { workCategoryId: "cat-1", workSubCategoryId: "sub-1", bvItem: null },
      project,
      requestedWorkCategoryId: "cat-ghost",
    }),
    /tidak aktif pada project/i,
  );
  // No payload category keeps the fallback chain: jobType category first.
  assert.deepEqual(await resolveRabSwitchJobClassification(db, {
    existing: { workCategoryId: null, workSubCategoryId: null, bvItem: null },
    project,
    jobTypeWorkCategoryId: "cat-2",
  }), { workCategoryId: "cat-2", workSubCategoryId: null });
  assert.deepEqual(await resolveRabSwitchJobClassification(db, {
    existing: { workCategoryId: "cat-1", workSubCategoryId: "sub-1", bvItem: null },
    project,
    jobTypeWorkCategoryId: null,
  }), { workCategoryId: "cat-1", workSubCategoryId: "sub-1" });
});

test("collectBvSubtreeIds walks the tree on the supplied db handle", async () => {
  const queries = [];
  const children = {
    "root-1": ["a", "b"],
    "a": ["a1"],
    "b": [],
    "a1": [],
  };
  const db = {
    bvItem: {
      findMany: async ({ where }) => {
        queries.push(where.parentBvItemId.in);
        const frontier = where.parentBvItemId.in;
        return frontier.flatMap((id) => (children[id] || []).map((childId) => ({ id: childId })));
      },
    },
  };
  const ids = await collectBvSubtreeIds(db, ["root-1"]);
  assert.deepEqual(ids.sort(), ["a", "a1", "b", "root-1"].sort());
  // The supplied handle was used, never a global import.
  assert.equal(queries[0][0], "root-1");
  // Seeding duplicated ids does not loop forever or duplicate output.
  const dedup = await collectBvSubtreeIds(db, ["root-1", "root-1"]);
  assert.equal(new Set(dedup).size, dedup.length);
});

test("project create/edit paths never require or auto-infer SIPIL/INTERIOR", () => {
  const projectRoute = fs.readFileSync(path.join(__dirname, "../routes/projects.js"), "utf8");
  assert.doesNotMatch(projectRoute, /requiredCode|Kategori Sipil wajib|Kategori Interior wajib/);
  assert.doesNotMatch(projectRoute, /requestedConfigs = \["SIPIL", "INTERIOR"\]/);
  assert.match(projectRoute, /Kategori wajib dikirim eksplisit/);

  const projectForm = fs.readFileSync(
    path.join(__dirname, "../../../bv-rab-dynamic-fe/src/components/CreateProjectModal.jsx"),
    "utf8",
  );
  assert.doesNotMatch(projectForm, /requiredCodes|Kategori Sipil wajib dipilih/);
  assert.doesNotMatch(projectForm, /code !== "SIPIL" && code !== "INTERIOR"/);
  assert.match(projectForm, /Pilih minimal satu kategori pekerjaan/);
});

test("canonical category migration defines the requested taxonomy and clears category references", () => {
  const sql = fs.readFileSync(
    path.join(__dirname, "../../prisma/migrations/20261009170000_reset_canonical_work_categories/migration.sql"),
    "utf8",
  );
  for (const code of ["STRUKTUR", "ARSITEKTUR", "MEP", "INTERIOR", "P.TN", "P.BS", "P.BT", "DP", "PA", "PDL", "CAT", "PJ", "EL", "FS", "CCTV", "PLB", "FUR", "CRP", "FLR", "BW"]) {
    assert.match(sql, new RegExp(`'${code.replace('.', '\\.')}'`));
  }
  assert.match(sql, /UPDATE "BvItem" SET "workCategoryId" = NULL/);
  assert.match(sql, /UPDATE "RabItem" SET "workCategoryId" = NULL/);
  assert.match(sql, /DELETE FROM "WorkSubCategory"/);
  assert.match(sql, /DELETE FROM "WorkCategory"/);
});

test("BV route keeps subtree reads on the active transaction and mirrors classification", () => {
  const source = fs.readFileSync(path.join(__dirname, "../routes/crudGrub/bv.routes.js"), "utf8");
  assert.match(source, /collectBvSubtreeIds\(tx, \[id\]\)/);
  assert.match(source, /const linkedPatch = linkedRabClassificationPatch\(existing, classification\);[\s\S]*discipline: linkedPatch\.discipline/);
  assert.match(source, /rootCategoryChanged[\s\S]*disciplineLabel: finalWorkCategoryId \? null : finalDisciplineLabel[\s\S]*discipline: null/);
});

test("withStatus detects work category and subcategory drift", () => {
  const item = {
    name: "Ceiling", paymentUnit: "m2", totalVolume: 10,
    isHeaderOnly: false, sourceJobTypeId: null, disciplineLabel: "GENERAL",
    groupId: null, parentBvItem: null,
    workCategoryId: "cat-1", workSubCategoryId: "sub-1",
    linkedRabItem: {
      name: "Ceiling", paymentUnit: "m2", volume: 10,
      isHeaderOnly: false, sourceJobTypeId: null, discipline: null,
      groupId: null, parentId: null,
      workCategoryId: "cat-1", workSubCategoryId: "sub-2",
    },
  };
  assert.equal(require("./bvCalculationService").withStatus(item).linkStatus, "BELUM_SINKRON");
  item.linkedRabItem.workSubCategoryId = "sub-1";
  item.linkedRabItem.workCategoryId = "cat-2";
  assert.equal(require("./bvCalculationService").withStatus(item).linkStatus, "BELUM_SINKRON");
  item.linkedRabItem.workCategoryId = "cat-1";
  assert.equal(require("./bvCalculationService").withStatus(item).linkStatus, "SUDAH_DILINK");
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
