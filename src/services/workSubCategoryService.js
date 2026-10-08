"use strict";

const { normalizeWorkCategoryCode } = require("./bvCalculationService");

function httpError(message, statusCode, extra = {}) {
  return Object.assign(new Error(message), { statusCode, ...extra });
}

async function requireCategory(db, categoryId, { active = false } = {}) {
  const category = await db.workCategory.findUnique({ where: { id: categoryId } });
  if (!category) throw httpError("Kategori pekerjaan tidak ditemukan.", 404);
  if (active && !category.isActive) throw httpError("Kategori pekerjaan tidak aktif.", 400);
  return category;
}

async function requireOwnedSubCategory(db, categoryId, id) {
  const subCategory = await db.workSubCategory.findUnique({
    where: { id },
  });
  if (!subCategory || subCategory.categoryId !== categoryId) {
    throw httpError("Subkategori pekerjaan tidak ditemukan.", 404);
  }
  return subCategory;
}

function mapDuplicate(error) {
  if (error?.code !== "P2002") throw error;
  throw httpError("Kode subkategori sudah ada pada kategori ini.", 409);
}

async function listWorkSubCategories(db, categoryId, { activeOnly = false } = {}) {
  await requireCategory(db, categoryId);
  return db.workSubCategory.findMany({
    where: {
      categoryId,
      ...(activeOnly ? { isActive: true } : {}),
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

async function createWorkSubCategory(db, categoryId, input = {}) {
  await requireCategory(db, categoryId, { active: true });
  const name = String(input.name || "").trim();
  if (!name) throw httpError("Nama subkategori wajib diisi.", 400);
  const sortOrder = input.sortOrder === undefined ? 0 : Number(input.sortOrder);
  if (!Number.isInteger(sortOrder)) {
    throw httpError("Urutan subkategori harus berupa bilangan bulat.", 400);
  }
  const isActive = input.isActive === undefined ? true : input.isActive;
  if (typeof isActive !== "boolean") {
    throw httpError("Status aktif subkategori harus berupa boolean.", 400);
  }
  try {
    return await db.workSubCategory.create({
      data: {
        categoryId,
        code: normalizeWorkCategoryCode(input.code),
        name,
        sortOrder,
        isActive,
      },
    });
  } catch (error) {
    return mapDuplicate(error);
  }
}

async function updateWorkSubCategory(db, categoryId, id, input = {}) {
  await requireOwnedSubCategory(db, categoryId, id);
  const data = {};
  if (input.code !== undefined) data.code = normalizeWorkCategoryCode(input.code);
  if (input.name !== undefined) {
    const name = String(input.name || "").trim();
    if (!name) throw httpError("Nama subkategori tidak boleh kosong.", 400);
    data.name = name;
  }
  if (input.sortOrder !== undefined) {
    const sortOrder = Number(input.sortOrder);
    if (!Number.isInteger(sortOrder)) throw httpError("Urutan subkategori harus berupa bilangan bulat.", 400);
    data.sortOrder = sortOrder;
  }
  if (input.isActive !== undefined) {
    if (typeof input.isActive !== "boolean") {
      throw httpError("Status aktif subkategori harus berupa boolean.", 400);
    }
    data.isActive = input.isActive;
  }
  try {
    return await db.workSubCategory.update({ where: { id }, data });
  } catch (error) {
    return mapDuplicate(error);
  }
}

async function getWorkSubCategoryReferences(db, categoryId, id) {
  await requireOwnedSubCategory(db, categoryId, id);
  const [bvItems, rabItems] = await Promise.all([
    db.bvItem.count({ where: { workSubCategoryId: id } }),
    db.rabItem.count({ where: { workSubCategoryId: id } }),
  ]);
  return { bvItems, rabItems };
}

async function deleteWorkSubCategory(db, categoryId, id) {
  await requireOwnedSubCategory(db, categoryId, id);
  const deleteWithGuard = async (tx) => {
    const [bvItems, rabItems] = await Promise.all([
      tx.bvItem.count({ where: { workSubCategoryId: id } }),
      tx.rabItem.count({ where: { workSubCategoryId: id } }),
    ]);
    const references = { bvItems, rabItems };
    if (bvItems > 0 || rabItems > 0) {
      throw httpError(
        "Subkategori masih digunakan oleh item BV/RAB dan tidak dapat dihapus.",
        409,
        { references },
      );
    }
    try {
      return await tx.workSubCategory.delete({ where: { id } });
    } catch (error) {
      if (error?.code === "P2003") {
        throw httpError(
          "Subkategori baru saja digunakan oleh item BV/RAB dan tidak dapat dihapus.",
          409,
          { references: { bvItems: 0, rabItems: 0 } },
        );
      }
      if (error?.code === "P2025") {
        throw httpError("Subkategori pekerjaan tidak ditemukan.", 404);
      }
      throw error;
    }
  };
  return db.$transaction ? db.$transaction(deleteWithGuard) : deleteWithGuard(db);
}

module.exports = {
  listWorkSubCategories,
  createWorkSubCategory,
  updateWorkSubCategory,
  getWorkSubCategoryReferences,
  deleteWorkSubCategory,
};
