"use strict";

/**
 * Returns the next display order for a new global work category.
 * Existing records may still have legacy zero values; new records continue
 * from the highest stored value without exposing manual ordering to users.
 */
async function nextWorkCategorySortOrder(db) {
  const latest = await db.workCategory.findFirst({
    orderBy: [{ sortOrder: "desc" }, { createdAt: "desc" }],
    select: { sortOrder: true },
  });
  return Number(latest?.sortOrder || 0) + 1;
}

module.exports = { nextWorkCategorySortOrder };
