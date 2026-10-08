"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { nextWorkCategorySortOrder } = require("./workCategoryOrderService");

test("global work category order starts at one and increments from the stored maximum", async () => {
  let args;
  const emptyDb = {
    workCategory: {
      findFirst: async (query) => (args = query, null),
    },
  };
  assert.equal(await nextWorkCategorySortOrder(emptyDb), 1);
  assert.deepEqual(args, {
    orderBy: [{ sortOrder: "desc" }, { createdAt: "desc" }],
    select: { sortOrder: true },
  });

  const populatedDb = {
    workCategory: {
      findFirst: async () => ({ sortOrder: 8 }),
    },
  };
  assert.equal(await nextWorkCategorySortOrder(populatedDb), 9);
});
