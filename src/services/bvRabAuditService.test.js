"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeAuditSnapshot,
  projectAuditSnapshot,
  buildFieldChanges,
  assertUndoable,
  assertUndoActor,
  appendUndoRecord,
  recordBulkChanges,
  redactHistoryEntry,
  restoreSnapshot,
} = require("./bvRabAuditService");

test("normalizes Prisma-style values into JSON-safe audit snapshots", () => {
  const snapshot = normalizeAuditSnapshot({
    id: "rab-1",
    overheadPercent: { toJSON: () => "12.50" },
    updatedAt: new Date("2026-09-26T12:00:00.000Z"),
    components: [{ coefficient: { toJSON: () => "1.250000" } }],
  });

  assert.deepEqual(snapshot, {
    id: "rab-1",
    overheadPercent: "12.50",
    components: [{ coefficient: "1.250000" }],
  });
});

test("projects snapshots to reversible BV/RAB fields only", () => {
  assert.deepEqual(
    projectAuditSnapshot({
      id: "bv-1",
      projectId: "project-1",
      name: "Dinding",
      groupId: "group-current",
      linkedRabItemId: "rab-1",
      totalVolume: { toJSON: () => "8.0000" },
      breakdowns: [],
    }, "BV_ITEM"),
    {
      id: "bv-1",
      projectId: "project-1",
      name: "Dinding",
      keterangan: null,
      paymentUnit: null,
      sourceJobTypeId: null,
      isHeaderOnly: null,
      groupId: "group-current",
      parentBvItemId: null,
      totalVolume: "8.0000",
      ecommerceLink: null,
      nameEcommerceLink: null,
      breakdowns: [],
    },
  );
});

test("builds readable field changes and ignores technical timestamps", () => {
  assert.deepEqual(
    buildFieldChanges(
      {
        totalVolume: "10.0000",
        parentBvItemId: null,
        updatedAt: "before",
        breakdowns: [{ id: "a", subTotal: "10.0000" }],
      },
      {
        totalVolume: "15.0000",
        parentBvItemId: "parent-1",
        updatedAt: "after",
        breakdowns: [{ id: "b", subTotal: "15.0000" }],
      },
    ),
    [
      { field: "breakdowns", before: [{ id: "a", subTotal: "10.0000" }], after: [{ id: "b", subTotal: "15.0000" }] },
      { field: "parentBvItemId", before: null, after: "parent-1" },
      { field: "totalVolume", before: "10.0000", after: "15.0000" },
    ],
  );
});

test("allows only latest successful reversible history entry to be undone", () => {
  assert.doesNotThrow(() => assertUndoable({
    action: "UPDATE",
    status: "APPLIED",
    beforeData: { id: "bv-1" },
    afterData: { id: "bv-1", totalVolume: "12" },
    id: "history-latest",
  }, { latestAppliedId: "history-latest" }));

  assert.throws(
    () => assertUndoable({ action: "UPDATE", status: "UNDONE", beforeData: { id: "bv-1" }, afterData: { id: "bv-1" }, id: "h1" }, { latestAppliedId: "h1" }),
    /sudah dibatalkan/i,
  );
  assert.throws(
    () => assertUndoable({ action: "UPDATE", status: "APPLIED", beforeData: { id: "bv-1" }, afterData: { id: "bv-1" }, id: "older" }, { latestAppliedId: "latest" }),
    /perubahan terbaru/i,
  );
  assert.throws(
    () => assertUndoable({ action: "SYNC", status: "APPLIED", beforeData: null, id: "h2" }, { latestAppliedId: "h2" }),
    /tidak dapat dibatalkan/i,
  );
});

test("allows Undo only when a recorded actor exactly matches the requester", () => {
  const entry = { actorId: "user-1" };
  assert.doesNotThrow(() => assertUndoActor(entry, "user-1"));
  assert.throws(() => assertUndoActor(entry, "user-2"), /pembuat perubahan/i);
  assert.throws(() => assertUndoActor({ actorId: null }, "user-1"), /tanpa identitas pembuat/i);
  assert.throws(() => assertUndoActor(entry, null), /pembuat perubahan/i);
});

test("writes an UNDO history row without making it reversible", async () => {
  let created;
  const tx = {
    bvRabChangeHistory: {
      create: async ({ data }) => {
        created = data;
        return { id: "undo-1", ...data };
      },
    },
  };
  await appendUndoRecord(
    tx,
    { projectId: "project-1", entityType: "BV_ITEM", entityId: "bv-1", itemName: "Dinding" },
    { id: "bv-1", projectId: "project-1", name: "Dinding", totalVolume: "12", breakdowns: [] },
    { id: "bv-1", projectId: "project-1", name: "Dinding", totalVolume: "10", breakdowns: [] },
    { user: { userId: "user-1", name: "Rina", role: "PERENCANA" } },
  );

  assert.equal(created.action, "UNDO");
  assert.equal(created.status, "APPLIED");
  assert.equal(created.actorId, "user-1");
  assert.throws(
    () => assertUndoable({ ...created, id: "undo-1" }, { latestAppliedId: "undo-1" }),
    /tidak dapat dibatalkan/i,
  );
});

test("restores only changed RAB fields and protects selling values for non-super-admin", async () => {
  let updateArgs;
  const db = {
    rabItem: {
      update: async (args) => {
        updateArgs = args;
        return { ...args.data, id: args.where.id, components: [] };
      },
    },
  };

  await restoreSnapshot(
    db,
    "RAB_ITEM",
    {
      id: "rab-1",
      rapUnitPrice: "100",
      rapTotalPrice: "200",
      rabUnitPrice: "999",
      rabTotalPrice: "1998",
      overheadPercent: "10",
      volume: "2",
      components: [],
    },
    ["rapUnitPrice", "rapTotalPrice", "rabUnitPrice", "rabTotalPrice"],
    "PERENCANA",
  );

  assert.deepEqual(updateArgs.data, {
    rapUnitPrice: "100",
    rapTotalPrice: "200",
    rabUnitPrice: 110,
    rabTotalPrice: 220,
  });
});

test("records every changed item in one bulk transaction", async () => {
  const created = [];
  const db = {
    bvRabChangeHistory: {
      create: async ({ data }) => {
        created.push(data);
        return data;
      },
    },
  };
  const common = { entityType: "RAB_ITEM", projectId: "project-1", req: { user: { userId: "u-1" } } };
  const result = await recordBulkChanges(db, [
    { ...common, entityId: "rab-1", beforeData: { id: "rab-1", projectId: "project-1", rapUnitPrice: "10", components: [] }, afterData: { id: "rab-1", projectId: "project-1", rapUnitPrice: "20", components: [] } },
    { ...common, entityId: "rab-2", beforeData: { id: "rab-2", projectId: "project-1", rapUnitPrice: "30", components: [] }, afterData: { id: "rab-2", projectId: "project-1", rapUnitPrice: "40", components: [] } },
  ]);

  assert.equal(result.length, 2);
  assert.equal(created.length, 2);
  assert.deepEqual(created.map((entry) => entry.entityId), ["rab-1", "rab-2"]);
  assert.ok(created.every((entry) => entry.action === "BULK_UPDATE"));
});

test("redacts RAB selling snapshots and changes outside SUPER_ADMIN", () => {
  const entry = {
    entityType: "RAB_ITEM",
    beforeData: { rapUnitPrice: "100", rabUnitPrice: "120", rabTotalPrice: "240" },
    afterData: { rapUnitPrice: "110", rabUnitPrice: "132", rabTotalPrice: "264" },
    changes: [
      { field: "rapUnitPrice", before: "100", after: "110" },
      { field: "rabUnitPrice", before: "120", after: "132" },
      { field: "rabTotalPrice", before: "240", after: "264" },
    ],
  };

  const redacted = redactHistoryEntry(entry, "PERENCANA");
  assert.deepEqual(redacted.beforeData, { rapUnitPrice: "100" });
  assert.deepEqual(redacted.afterData, { rapUnitPrice: "110" });
  assert.deepEqual(redacted.changes, [{ field: "rapUnitPrice", before: "100", after: "110" }]);
});
