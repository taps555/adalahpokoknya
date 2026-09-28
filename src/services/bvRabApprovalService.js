"use strict";

const crypto = require("crypto");
const { normalizeAuditSnapshot, buildFieldChanges } = require("./bvRabAuditService");

const LOCKED_APPROVAL_STATUSES = new Set(["PENDING_REVIEW", "APPROVED"]);
const SELLING_FIELDS = new Set(["rabUnitPrice", "rabTotalPrice"]);
const ACTION_TRANSITIONS = Object.freeze({
  SUBMIT: { from: new Set(["DRAFT", "CHANGES_REQUESTED"]), to: "PENDING_REVIEW" },
  APPROVE: { from: new Set(["PENDING_REVIEW"]), to: "APPROVED" },
  REQUEST_CHANGES: { from: new Set(["PENDING_REVIEW"]), to: "CHANGES_REQUESTED" },
});

const GROUP_FIELDS = ["id", "projectId", "name", "reference", "order", "parentId"];
const BV_FIELDS = [
  "id", "projectId", "workCategoryId", "groupId", "parentBvItemId", "isHeaderOnly",
  "sourceJobTypeId", "name", "keterangan", "paymentUnit", "disciplineLabel", "totalVolume",
  "ecommerceLink", "nameEcommerceLink", "linkedRabItemId", "linkedGroupId", "breakdowns",
];
const RAB_FIELDS = [
  "id", "projectId", "workCategoryId", "name", "paymentUnit", "category", "reference",
  "overheadPercent", "discipline", "grade", "volume", "rapUnitPrice", "rapTotalPrice",
  "rabUnitPrice", "rabTotalPrice", "sourceJobTypeId", "groupId", "isByOwner", "isStip",
  "isHeaderOnly", "order", "parentId", "components",
];

function projectFields(value, fields) {
  return normalizeAuditSnapshot(Object.fromEntries(fields.map((field) => [field, value?.[field] ?? null])));
}

function sortSnapshotRows(rows = []) {
  return [...rows].sort((left, right) =>
    Number(left.order || 0) - Number(right.order || 0)
    || String(left.id || "").localeCompare(String(right.id || "")),
  );
}

function buildBaselineSnapshot({ groups = [], bvGroups = [], rabGroups = [], bvItems = [], rabItems = [] } = {}) {
  const allGroups = groups.length > 0 ? groups : [...bvGroups, ...rabGroups];
  const uniqueGroups = new Map(allGroups.map((group) => [group.id, group]));
  return {
    groups: sortSnapshotRows([...uniqueGroups.values()].map((group) => projectFields(group, GROUP_FIELDS))),
    bvGroups: sortSnapshotRows(bvGroups.map((group) => projectFields(group, GROUP_FIELDS))),
    rabGroups: sortSnapshotRows(rabGroups.map((group) => projectFields(group, GROUP_FIELDS))),
    bvItems: sortSnapshotRows(bvItems.map((item) => projectFields(item, BV_FIELDS))),
    rabItems: sortSnapshotRows(rabItems.map((item) => projectFields(item, RAB_FIELDS))),
  };
}

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
}

function hashBaselineSnapshot(snapshot) {
  return crypto.createHash("sha256").update(stableSerialize(snapshot)).digest("hex");
}

function transitionApproval(current, action) {
  if (action === "NEW_REVISION") {
    if (current?.status !== "APPROVED") throw new Error("Revisi baru hanya dapat dibuat dari status APPROVED.");
    return { status: "DRAFT", revision: Number(current.revision || 0) + 1 };
  }
  const transition = ACTION_TRANSITIONS[action];
  const currentStatus = current?.status || "DRAFT";
  if (!transition || !transition.from.has(currentStatus)) {
    throw new Error(`Transisi status ${currentStatus} melalui ${action} tidak diizinkan.`);
  }
  return { status: transition.to, revision: Number(current?.revision || 1) };
}

function redactObjectSelling(value) {
  if (Array.isArray(value)) return value.map(redactObjectSelling);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !SELLING_FIELDS.has(key))
    .map(([key, child]) => [key, redactObjectSelling(child)]));
}

function redactBaselineSnapshot(snapshot, role) {
  return role === "SUPER_ADMIN" ? snapshot : redactObjectSelling(snapshot);
}

function diffRows(beforeRows = [], afterRows = []) {
  const before = new Map(beforeRows.map((row) => [row.id, row]));
  const after = new Map(afterRows.map((row) => [row.id, row]));
  const added = [];
  const removed = [];
  const changed = [];

  for (const [id, row] of after) {
    if (!before.has(id)) added.push(row);
    else {
      const changes = buildFieldChanges(before.get(id), row);
      if (changes.length > 0) changed.push({ id, name: row.name || before.get(id)?.name || null, changes });
    }
  }
  for (const [id, row] of before) if (!after.has(id)) removed.push(row);
  return { added, removed, changed };
}

function diffBaselineSnapshots(baseline, current, role) {
  const safeBefore = redactBaselineSnapshot(baseline || {}, role);
  const safeCurrent = redactBaselineSnapshot(current || {}, role);
  return {
    groups: diffRows(safeBefore.groups, safeCurrent.groups),
    bv: diffRows(safeBefore.bvItems, safeCurrent.bvItems),
    rab: diffRows(safeBefore.rabItems, safeCurrent.rabItems),
  };
}

async function loadBaselineSnapshot(db, projectId) {
  const [groups, bvItems, rabItems] = await Promise.all([
    db.rabGroup.findMany({ where: { projectId }, orderBy: [{ order: "asc" }, { id: "asc" }] }),
    db.bvItem.findMany({ where: { projectId }, include: { breakdowns: true }, orderBy: { id: "asc" } }),
    db.rabItem.findMany({ where: { projectId }, include: { components: true }, orderBy: [{ order: "asc" }, { id: "asc" }] }),
  ]);
  return buildBaselineSnapshot({ groups, bvItems, rabItems });
}

async function lockApprovalProject(tx, projectId) {
  // Project row lock is the serialization point shared with DB triggers.
  // Acquire it before the advisory lock everywhere to keep lock ordering stable.
  await tx.$queryRawUnsafe(
    'SELECT id FROM "Project" WHERE id = $1 FOR UPDATE',
    projectId,
  );
  await tx.$queryRawUnsafe(
    "SELECT pg_advisory_xact_lock(hashtext($1))::text AS locked",
    `bv-rab-approval:${projectId}`,
  );
}

async function getCurrentApproval(db, projectId) {
  return db.bvRabApprovalRevision.findFirst({
    where: { projectId },
    orderBy: [{ revision: "desc" }, { createdAt: "desc" }],
  });
}

async function getLatestApprovedApproval(db, projectId) {
  return db.bvRabApprovalRevision.findFirst({
    where: { projectId, status: "APPROVED" },
    orderBy: [{ revision: "desc" }, { createdAt: "desc" }],
  });
}

async function assertProjectEditable(db, projectId) {
  if (!projectId) throw new Error("Project untuk perubahan BV/RAB tidak ditemukan.");
  const approval = await getCurrentApproval(db, projectId);
  if (approval && LOCKED_APPROVAL_STATUSES.has(approval.status)) {
    const error = new Error(
      approval.status === "PENDING_REVIEW"
        ? "BV/RAB sedang menunggu review dan sementara dikunci."
        : "Baseline BV/RAB sudah disetujui. Buat revisi baru sebelum mengubah data.",
    );
    error.statusCode = 409;
    throw error;
  }
  return approval;
}

module.exports = {
  LOCKED_APPROVAL_STATUSES,
  transitionApproval,
  buildBaselineSnapshot,
  hashBaselineSnapshot,
  redactBaselineSnapshot,
  diffBaselineSnapshots,
  loadBaselineSnapshot,
  lockApprovalProject,
  getCurrentApproval,
  getLatestApprovedApproval,
  assertProjectEditable,
};
