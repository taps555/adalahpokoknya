"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  listWorkSubCategories,
  createWorkSubCategory,
  updateWorkSubCategory,
  getWorkSubCategoryReferences,
  deleteWorkSubCategory,
} = require("./workSubCategoryService");

function fakeDb(overrides = {}) {
  const db = {
    workCategory: {
      findUnique: async () => ({ id: "cat-1", isActive: true }),
      ...(overrides.workCategory || {}),
    },
    workSubCategory: {
      findMany: async () => [],
      findUnique: async () => null,
      create: async ({ data }) => ({ id: "sub-new", ...data }),
      update: async ({ data }) => ({ id: "sub-1", categoryId: "cat-1", ...data }),
      delete: async () => ({ id: "sub-1" }),
      ...(overrides.workSubCategory || {}),
    },
    bvItem: { count: async () => 0, ...(overrides.bvItem || {}) },
    rabItem: { count: async () => 0, ...(overrides.rabItem || {}) },
    $transaction: async (callback) => callback(db),
  };
  return db;
}

test("work category router exposes nested subcategory references for the frontend contract", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "../routes/workCategories.js"), "utf8");
  assert.match(source, /router\.get\("\/:categoryId\/subcategories\/:id\/references"/);
  assert.match(source, /getWorkSubCategoryReferences\(/);
  assert.match(source, /res\.json\(\{ references \}\)/);
});

test("lists only subcategories owned by the requested category in stable order", async () => {
  let query;
  const db = fakeDb({ workSubCategory: { findMany: async (args) => (query = args, []) } });
  await listWorkSubCategories(db, "cat-1", { activeOnly: true });
  assert.deepEqual(query, {
    where: { categoryId: "cat-1", isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
});

test("creates a normalized subcategory only under an active existing category", async () => {
  const created = await createWorkSubCategory(fakeDb(), "cat-1", {
    code: "  ceiling works ", name: " Ceiling Works ", sortOrder: 2,
  });
  assert.deepEqual(created, {
    id: "sub-new", categoryId: "cat-1", code: "CEILING_WORKS",
    name: "Ceiling Works", sortOrder: 2, isActive: true,
  });
  await assert.rejects(
    () => createWorkSubCategory(fakeDb({ workCategory: { findUnique: async () => null } }), "missing", { code: "A", name: "A" }),
    (error) => error.statusCode === 404,
  );
  await assert.rejects(
    () => createWorkSubCategory(fakeDb({ workCategory: { findUnique: async () => ({ id: "cat-1", isActive: false }) } }), "cat-1", { code: "A", name: "A" }),
    /tidak aktif/i,
  );
  await assert.rejects(
    () => createWorkSubCategory(fakeDb(), "cat-1", { code: "A", name: "A", isActive: "false" }),
    /boolean/i,
  );
});

test("maps category-scoped duplicate codes to conflict", async () => {
  const duplicate = Object.assign(new Error("duplicate"), { code: "P2002" });
  const db = fakeDb({ workSubCategory: { create: async () => { throw duplicate; } } });
  await assert.rejects(
    () => createWorkSubCategory(db, "cat-1", { code: "CEILING", name: "Ceiling" }),
    (error) => error.statusCode === 409,
  );
});

test("updates only a subcategory owned by the route category and supports active state", async () => {
  const db = fakeDb({
    workSubCategory: { findUnique: async () => ({ id: "sub-1", categoryId: "cat-1" }) },
  });
  const updated = await updateWorkSubCategory(db, "cat-1", "sub-1", {
    code: "wall finish", name: " Wall Finish ", isActive: false, sortOrder: 7,
  });
  assert.deepEqual(updated, {
    id: "sub-1", categoryId: "cat-1", code: "WALL_FINISH",
    name: "Wall Finish", isActive: false, sortOrder: 7,
  });

  const wrongOwner = fakeDb({
    workSubCategory: { findUnique: async () => ({ id: "sub-1", categoryId: "cat-2" }) },
  });
  await assert.rejects(
    () => updateWorkSubCategory(wrongOwner, "cat-1", "sub-1", { name: "X" }),
    (error) => error.statusCode === 404,
  );
});

test("reports subcategory references scoped to the owning category", async () => {
  const db = fakeDb({
    workSubCategory: { findUnique: async () => ({ id: "sub-1", categoryId: "cat-1" }) },
    bvItem: { count: async () => 3 },
    rabItem: { count: async () => 2 },
  });
  assert.deepEqual(await getWorkSubCategoryReferences(db, "cat-1", "sub-1"), {
    bvItems: 3, rabItems: 2,
  });

  const wrongOwner = fakeDb({
    workSubCategory: { findUnique: async () => ({ id: "sub-1", categoryId: "cat-2" }) },
  });
  await assert.rejects(
    () => getWorkSubCategoryReferences(wrongOwner, "cat-1", "sub-1"),
    (error) => error.statusCode === 404,
  );
  const missing = fakeDb({ workSubCategory: { findUnique: async () => null } });
  await assert.rejects(
    () => getWorkSubCategoryReferences(missing, "cat-1", "sub-1"),
    (error) => error.statusCode === 404,
  );
});

test("refuses deletion while BV or RAB references exist and deletes an unreferenced owned row", async () => {
  const referenced = fakeDb({
    workSubCategory: { findUnique: async () => ({ id: "sub-1", categoryId: "cat-1" }) },
    bvItem: { count: async () => 2 },
    rabItem: { count: async () => 1 },
  });
  await assert.rejects(
    () => deleteWorkSubCategory(referenced, "cat-1", "sub-1"),
    (error) => error.statusCode === 409
      && error.references.bvItems === 2
      && error.references.rabItems === 1,
  );

  let deletedWhere;
  const unreferenced = fakeDb({
    workSubCategory: {
      findUnique: async () => ({ id: "sub-1", categoryId: "cat-1" }),
      delete: async ({ where }) => (deletedWhere = where, { id: "sub-1" }),
    },
  });
  assert.deepEqual(await deleteWorkSubCategory(unreferenced, "cat-1", "sub-1"), { id: "sub-1" });
  assert.deepEqual(deletedWhere, { id: "sub-1" });
});

test("maps a delete foreign-key race (P2003) to conflict and a vanished row to 404", async () => {
  const raced = fakeDb({
    workSubCategory: {
      findUnique: async () => ({ id: "sub-1", categoryId: "cat-1" }),
      delete: async () => {
        throw Object.assign(new Error("fk"), { code: "P2003" });
      },
    },
  });
  await assert.rejects(
    () => deleteWorkSubCategory(raced, "cat-1", "sub-1"),
    (error) => error.statusCode === 409,
  );

  const vanished = fakeDb({
    workSubCategory: {
      findUnique: async () => ({ id: "sub-1", categoryId: "cat-1" }),
      delete: async () => {
        throw Object.assign(new Error("gone"), { code: "P2025" });
      },
    },
  });
  await assert.rejects(
    () => deleteWorkSubCategory(vanished, "cat-1", "sub-1"),
    (error) => error.statusCode === 404,
  );
});
