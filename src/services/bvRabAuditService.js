"use strict";

const TECHNICAL_FIELDS = new Set(["createdAt", "updatedAt"]);
const SELLING_FIELDS = new Set(["rabUnitPrice", "rabTotalPrice"]);
const AUDIT_FIELDS = Object.freeze({
  BV_ITEM: [
    "id", "projectId", "name", "keterangan", "paymentUnit", "sourceJobTypeId",
    "isHeaderOnly", "groupId", "parentBvItemId", "workCategoryId", "workSubCategoryId",
    "totalVolume", "ecommerceLink",
    "nameEcommerceLink", "breakdowns",
  ],
  RAB_ITEM: [
    "id", "projectId", "name", "volume", "category", "reference", "discipline", "grade",
    "workCategoryId", "workSubCategoryId", "sourceJobTypeId", "overheadPercent", "rapUnitPrice", "rapTotalPrice",
    "rabUnitPrice", "rabTotalPrice", "isByOwner", "isStip", "components",
  ],
});

function actorFromRequest(req) {
  return {
    actorId: req?.user?.userId || req?.user?.id || null,
    actorName: req?.user?.name || req?.user?.username || null,
    actorRole: req?.user?.role || null,
  };
}

function snapshotInclude(entityType) {
  return entityType === "BV_ITEM" ? { breakdowns: true } : { components: true };
}

function projectAuditSnapshot(value, entityType) {
  if (!value) return value;
  const fields = AUDIT_FIELDS[entityType];
  if (!fields) throw new Error("Jenis entitas riwayat tidak didukung.");
  const selected = Object.fromEntries(fields.map((field) => [field, value[field] ?? null]));
  return normalizeAuditSnapshot(selected);
}

function normalizeAuditSnapshot(value) {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(normalizeAuditSnapshot);
  if (typeof value !== "object") return value;

  if (typeof value.toJSON === "function") {
    return normalizeAuditSnapshot(value.toJSON());
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !TECHNICAL_FIELDS.has(key))
      .map(([key, child]) => [key, normalizeAuditSnapshot(child)]),
  );
}

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
}

function buildFieldChanges(beforeData = {}, afterData = {}) {
  const before = normalizeAuditSnapshot(beforeData) || {};
  const after = normalizeAuditSnapshot(afterData) || {};
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((field) => !TECHNICAL_FIELDS.has(field))
    .sort();

  return fields
    .filter((field) => stableSerialize(before[field]) !== stableSerialize(after[field]))
    .map((field) => ({ field, before: before[field] ?? null, after: after[field] ?? null }));
}

function assertUndoable(entry, { latestAppliedId } = {}) {
  if (!entry || !["UPDATE", "BULK_UPDATE", "SWITCH_JOB"].includes(entry.action)) {
    throw new Error("Jenis perubahan ini tidak dapat dibatalkan.");
  }
  if (entry.status !== "APPLIED") {
    throw new Error("Perubahan ini sudah dibatalkan atau tidak aktif.");
  }
  if (!entry.beforeData || !entry.afterData) {
    throw new Error("Snapshot perubahan tidak lengkap sehingga tidak dapat dibatalkan.");
  }
  if (latestAppliedId && latestAppliedId !== entry.id) {
    throw new Error("Hanya perubahan terbaru pada item ini yang dapat dibatalkan.");
  }
}

function assertUndoActor(entry, actorId) {
  if (!entry?.actorId) {
    const error = new Error("Riwayat tanpa identitas pembuat tidak dapat dibatalkan.");
    error.statusCode = 409;
    throw error;
  }
  if (entry.actorId !== actorId) {
    const error = new Error("Undo hanya dapat dilakukan oleh pembuat perubahan.");
    error.statusCode = 403;
    throw error;
  }
}

function snapshotsEqual(left, right) {
  return stableSerialize(normalizeAuditSnapshot(left)) === stableSerialize(normalizeAuditSnapshot(right));
}

async function fetchEntitySnapshot(db, entityType, entityId) {
  if (entityType === "BV_ITEM") {
    return db.bvItem.findUnique({ where: { id: entityId }, include: snapshotInclude(entityType) });
  }
  if (entityType === "RAB_ITEM") {
    return db.rabItem.findUnique({ where: { id: entityId }, include: snapshotInclude(entityType) });
  }
  throw new Error("Jenis entitas riwayat tidak didukung.");
}

async function appendUndoRecord(tx, historyRow, currentSnapshot, restoredSnapshot, req) {
  const actor = actorFromRequest(req);
  const beforeData = projectAuditSnapshot(currentSnapshot, historyRow.entityType);
  const afterData = projectAuditSnapshot(restoredSnapshot, historyRow.entityType);
  await tx.bvRabChangeHistory.create({
    data: {
      projectId: historyRow.projectId,
      entityType: historyRow.entityType,
      entityId: historyRow.entityId,
      itemName: historyRow.itemName,
      action: "UNDO",
      status: "APPLIED",
      beforeData,
      afterData,
      changes: buildFieldChanges(beforeData, afterData),
      ...actor,
    },
  });
}

async function recordChange(db, {
  entityType,
  entityId,
  projectId,
  itemName,
  action = "UPDATE",
  beforeData,
  afterData,
  req,
}) {
  const normalizedBefore = projectAuditSnapshot(beforeData, entityType);
  const normalizedAfter = projectAuditSnapshot(afterData, entityType);
  const changes = buildFieldChanges(normalizedBefore, normalizedAfter);
  if (changes.length === 0) return null;

  return db.bvRabChangeHistory.create({
    data: {
      projectId,
      entityType,
      entityId,
      itemName: itemName || normalizedAfter?.name || normalizedBefore?.name || null,
      action,
      beforeData: normalizedBefore,
      afterData: normalizedAfter,
      changes,
      ...actorFromRequest(req),
    },
  });
}

async function recordBulkChanges(db, changes) {
  const recorded = [];
  for (const change of changes || []) {
    const entry = await recordChange(db, { ...change, action: change.action || "BULK_UPDATE" });
    if (entry) recorded.push(entry);
  }
  return recorded;
}

function redactHistoryEntry(entry, role) {
  if (role === "SUPER_ADMIN" || entry?.entityType !== "RAB_ITEM") return entry;
  const redactSnapshot = (snapshot) => Object.fromEntries(
    Object.entries(snapshot || {}).filter(([field]) => !SELLING_FIELDS.has(field)),
  );
  return {
    ...entry,
    beforeData: redactSnapshot(entry.beforeData),
    afterData: redactSnapshot(entry.afterData),
    changes: (entry.changes || []).filter((change) => !SELLING_FIELDS.has(change.field)),
  };
}

async function restoreSnapshot(db, entityType, snapshot, changedFields, role) {
  const restrictedFields = role === "SUPER_ADMIN"
    ? new Set()
    : new Set(["rabUnitPrice", "rabTotalPrice"]);
  const fields = new Set((changedFields || []).filter((field) => !restrictedFields.has(field)));
  const scalarData = Object.fromEntries(
    [...fields]
      .filter((field) => field !== "breakdowns" && field !== "components")
      .map((field) => [field, snapshot[field]]),
  );

  if (entityType === "BV_ITEM") {
    const data = { ...scalarData };
    if (fields.has("breakdowns")) {
      data.breakdowns = {
        deleteMany: {},
        create: (snapshot.breakdowns || []).map(({ id, bvItemId, ...row }) => row),
      };
    }
    return db.bvItem.update({
      where: { id: snapshot.id },
      data,
      include: { breakdowns: true },
    });
  }
  if (entityType === "RAB_ITEM") {
    const data = { ...scalarData };
    if (fields.has("components")) {
      data.components = {
        deleteMany: {},
        create: (snapshot.components || []).map(({ id, rabItemId, ...row }) => row),
      };
    }
    if (role !== "SUPER_ADMIN" && (fields.has("rapUnitPrice") || fields.has("overheadPercent"))) {
      const rapUnitPrice = fields.has("rapUnitPrice") ? Number(snapshot.rapUnitPrice) : Number(snapshot.rapUnitPrice);
      const overheadPercent = fields.has("overheadPercent") ? Number(snapshot.overheadPercent) : Number(snapshot.overheadPercent);
      data.rabUnitPrice = rapUnitPrice + rapUnitPrice * (overheadPercent / 100);
      data.rabTotalPrice = data.rabUnitPrice * Number(snapshot.volume || 0);
    }
    return db.rabItem.update({
      where: { id: snapshot.id },
      data,
      include: { components: true },
    });
  }
  throw new Error("Jenis entitas riwayat tidak didukung.");
}

module.exports = {
  normalizeAuditSnapshot,
  projectAuditSnapshot,
  buildFieldChanges,
  assertUndoable,
  assertUndoActor,
  snapshotsEqual,
  actorFromRequest,
  fetchEntitySnapshot,
  appendUndoRecord,
  recordChange,
  recordBulkChanges,
  redactHistoryEntry,
  restoreSnapshot,
};
