"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const schemaPath = path.join(__dirname, "../../prisma/schema.prisma");
const migrationPath = path.join(
  __dirname,
  "../../prisma/migrations/20261008100000_add_work_sub_category/migration.sql",
);

test("WorkSubCategory is a global WorkCategory child and BV/RAB classification uses restrictive nullable FKs", () => {
  const schema = fs.readFileSync(schemaPath, "utf8");

  assert.match(schema, /model WorkSubCategory\s*{[\s\S]*categoryId\s+String[\s\S]*code\s+String[\s\S]*name\s+String[\s\S]*isActive\s+Boolean\s+@default\(true\)[\s\S]*sortOrder\s+Int\s+@default\(0\)[\s\S]*@@unique\(\[categoryId, code\]\)/);
  assert.match(schema, /workSubCategoryId\s+String\?[\s\S]*workSubCategory\s+WorkSubCategory\?\s+@relation\(fields: \[workSubCategoryId\], references: \[id\], onDelete: Restrict\)/);
  assert.equal((schema.match(/workSubCategoryId\s+String\?/g) || []).length, 2);

  const migration = fs.readFileSync(migrationPath, "utf8");
  assert.match(migration, /CREATE TABLE "WorkSubCategory"/);
  assert.match(migration, /ALTER TABLE "BvItem" ADD COLUMN "workSubCategoryId" TEXT/);
  assert.match(migration, /ALTER TABLE "RabItem" ADD COLUMN "workSubCategoryId" TEXT/);
  assert.equal((migration.match(/ON DELETE RESTRICT ON UPDATE CASCADE/g) || []).length, 3);
  assert.doesNotMatch(migration, /INSERT|UPDATE\s+"(?:BvItem|RabItem|WorkCategory)"|DELETE\s+FROM/i);
});
