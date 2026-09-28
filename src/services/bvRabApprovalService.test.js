"use strict";

// Uji perilaku approval tetap dijalankan dengan fitur diaktifkan secara eksplisit.
// Di aplikasi, fitur ini dimatikan default (lihat BV_RAB_APPROVAL_ENABLED).
process.env.BV_RAB_APPROVAL_ENABLED = "true";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  transitionApproval,
  buildBaselineSnapshot,
  hashBaselineSnapshot,
  redactBaselineSnapshot,
  diffBaselineSnapshots,
  assertProjectEditable,
} = require("./bvRabApprovalService");

const sampleSnapshotInput = () => ({
  bvGroups: [{ id: "bg-2", parentId: null, name: "Finishing", order: 2 }, { id: "bg-1", parentId: null, name: "Persiapan", order: 1 }],
  bvItems: [{ id: "bv-1", projectId: "p-1", name: "Dinding", totalVolume: "10.0000", breakdowns: [{ id: "bd-1", keterangan: "A", subTotal: "10.0000" }] }],
  rabGroups: [{ id: "rg-1", parentId: null, name: "Pekerjaan", order: 1 }],
  rabItems: [{ id: "r-1", projectId: "p-1", name: "Dinding", rapUnitPrice: "100.00", rabUnitPrice: "120.00", rabTotalPrice: "1200.00", components: [{ id: "c-1", section: "BAHAN", name: "Semen", coefficient: "1.000000", unitPrice: "100.00", lineTotal: "100.00" }] }],
});

test("permits only the approval workflow transitions and creates monotonically increasing revisions", () => {
  assert.equal(transitionApproval(null, "SUBMIT").status, "PENDING_REVIEW");
  assert.equal(transitionApproval({ status: "DRAFT", revision: 1 }, "SUBMIT").status, "PENDING_REVIEW");
  assert.equal(transitionApproval({ status: "CHANGES_REQUESTED", revision: 2 }, "SUBMIT").status, "PENDING_REVIEW");
  assert.equal(transitionApproval({ status: "PENDING_REVIEW", revision: 1 }, "APPROVE").status, "APPROVED");
  assert.equal(transitionApproval({ status: "PENDING_REVIEW", revision: 1 }, "REQUEST_CHANGES").status, "CHANGES_REQUESTED");
  assert.deepEqual(transitionApproval({ status: "APPROVED", revision: 4 }, "NEW_REVISION"), { status: "DRAFT", revision: 5 });
  assert.throws(() => transitionApproval({ status: "APPROVED", revision: 4 }, "SUBMIT"), /status/i);
  assert.throws(() => transitionApproval({ status: "DRAFT", revision: 1 }, "APPROVE"), /status/i);
});

test("allows edits unless the approval is locked, which returns 409", async () => {
  for (const status of [null, "DRAFT", "CHANGES_REQUESTED"]) {
    const db = { bvRabApprovalRevision: { findFirst: async () => status ? { status } : null } };
    await assert.doesNotReject(() => assertProjectEditable(db, "project-1"));
  }

  for (const status of ["PENDING_REVIEW", "APPROVED"]) {
    const db = { bvRabApprovalRevision: { findFirst: async () => ({ status }) } };
    await assert.rejects(
      () => assertProjectEditable(db, "project-1"),
      (error) => error.statusCode === 409 && /dikunci|Buat revisi baru/i.test(error.message),
    );
  }
});

test("builds a deterministic project-wide baseline with normalized decimal and dates", () => {
  const first = buildBaselineSnapshot(sampleSnapshotInput());
  const second = buildBaselineSnapshot({ ...sampleSnapshotInput(), bvGroups: sampleSnapshotInput().bvGroups.reverse() });
  assert.deepEqual(first, second);
  assert.deepEqual(first.bvGroups.map((group) => group.id), ["bg-1", "bg-2"]);
  assert.equal(first.bvItems[0].totalVolume, "10.0000");
  assert.equal(first.rabItems[0].components[0].coefficient, "1.000000");
  assert.equal(first.bvItems[0].createdAt, undefined);
});

test("hashes the same logical baseline consistently", () => {
  const baseline = buildBaselineSnapshot(sampleSnapshotInput());
  assert.equal(hashBaselineSnapshot(baseline), hashBaselineSnapshot(structuredClone(baseline)));
  assert.match(hashBaselineSnapshot(baseline), /^[a-f0-9]{64}$/);
});

test("redacts every RAB selling field from nested baseline rows outside SUPER_ADMIN", () => {
  const baseline = buildBaselineSnapshot(sampleSnapshotInput());
  const visible = redactBaselineSnapshot(baseline, "PERENCANA");
  assert.equal(visible.rabItems[0].rabUnitPrice, undefined);
  assert.equal(visible.rabItems[0].rabTotalPrice, undefined);
  assert.equal(redactBaselineSnapshot(baseline, "SUPER_ADMIN").rabItems[0].rabUnitPrice, "120.00");
});

test("diffs BV/RAB rows against baseline and redacts selling values from non-admin output", () => {
  const baseline = buildBaselineSnapshot(sampleSnapshotInput());
  const current = buildBaselineSnapshot({
    ...sampleSnapshotInput(),
    bvItems: [{ id: "bv-1", projectId: "p-1", name: "Dinding baru", totalVolume: "12.0000", breakdowns: [] }, { id: "bv-2", projectId: "p-1", name: "Tambahan", totalVolume: "2.0000", breakdowns: [] }],
    rabItems: [{ id: "r-1", projectId: "p-1", name: "Dinding", rapUnitPrice: "110.00", rabUnitPrice: "132.00", rabTotalPrice: "1584.00", components: [] }],
  });
  const diff = diffBaselineSnapshots(baseline, current, "PERENCANA");
  assert.equal(diff.bv.added.length, 1);
  assert.equal(diff.bv.changed.length, 1);
  assert.equal(diff.bv.removed.length, 0);
  assert.equal(diff.rab.changed.length, 1);
  assert.ok(diff.rab.changed[0].changes.every((change) => !["rabUnitPrice", "rabTotalPrice"].includes(change.field)));
  assert.equal(diffBaselineSnapshots(baseline, current, "SUPER_ADMIN").rab.changed[0].changes.some((change) => change.field === "rabUnitPrice"), true);
});
