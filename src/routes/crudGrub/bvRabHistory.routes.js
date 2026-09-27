"use strict";

const express = require("express");
const prisma = require("../../lib/prisma");
const { verifyToken, authorizeRoles } = require("../../middleware/auth");
const {
  assertUndoable,
  assertUndoActor,
  fetchEntitySnapshot,
  restoreSnapshot,
  projectAuditSnapshot,
  snapshotsEqual,
  actorFromRequest,
  appendUndoRecord,
  redactHistoryEntry,
} = require("../../services/bvRabAuditService");

const router = express.Router();
const HISTORY_ROLES = ["SUPER_ADMIN", "PROJECT_MANAGER", "PERENCANA"];

router.get(
  "/projects/:projectId/bv-rab-history",
  verifyToken,
  authorizeRoles(...HISTORY_ROLES),
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const moduleFilter = String(req.query.module || "ALL").toUpperCase();
      if (!["ALL", "BV", "RAB"].includes(moduleFilter)) {
        return res.status(400).json({ error: "Filter modul riwayat tidak valid." });
      }
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
      const where = { projectId };
      if (moduleFilter === "BV") where.entityType = "BV_ITEM";
      if (moduleFilter === "RAB") where.entityType = "RAB_ITEM";

      const entries = await prisma.bvRabChangeHistory.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
      });
      res.json(entries.map((entry) => redactHistoryEntry(entry, req.user?.role)));
    } catch (error) {
      console.error("Error List BV/RAB History:", error);
      res.status(500).json({ error: "Gagal mengambil riwayat perubahan BV/RAB." });
    }
  },
);

router.post(
  "/bv-rab-history/:id/undo",
  verifyToken,
  authorizeRoles(...HISTORY_ROLES),
  async (req, res) => {
    try {
      const history = await prisma.bvRabChangeHistory.findUnique({
        where: { id: req.params.id },
      });
      if (!history) return res.status(404).json({ error: "Riwayat perubahan tidak ditemukan." });

      const result = await prisma.$transaction(async (tx) => {
        await tx.$queryRawUnsafe(
          'SELECT pg_advisory_xact_lock(hashtext($1))::text AS locked',
          `${history.entityType}:${history.entityId}`,
        );
        const latestApplied = await tx.bvRabChangeHistory.findFirst({
          where: {
            projectId: history.projectId,
            entityType: history.entityType,
            entityId: history.entityId,
            status: "APPLIED",
            action: { not: "UNDO" },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { id: true },
        });
        assertUndoable(history, { latestAppliedId: latestApplied?.id || null });
        assertUndoActor(history, req.user?.userId || req.user?.id || null);

        const claimed = await tx.bvRabChangeHistory.updateMany({
          where: { id: history.id, status: "APPLIED" },
          data: {
            status: "UNDONE",
            undoneAt: new Date(),
            undoneById: actorFromRequest(req).actorId,
            undoneByName: actorFromRequest(req).actorName,
          },
        });
        if (claimed.count !== 1) {
          const error = new Error("Perubahan ini sudah dibatalkan atau tidak aktif.");
          error.statusCode = 409;
          throw error;
        }

        const current = await fetchEntitySnapshot(tx, history.entityType, history.entityId);
        if (!current) {
          const error = new Error("Item sudah tidak tersedia untuk dibatalkan.");
          error.statusCode = 409;
          throw error;
        }
        if (!snapshotsEqual(projectAuditSnapshot(current, history.entityType), history.afterData)) {
          const error = new Error("Data item sudah berubah setelah riwayat ini dibuat. Muat ulang riwayat sebelum membatalkan.");
          error.statusCode = 409;
          throw error;
        }

        const restored = await restoreSnapshot(
          tx,
          history.entityType,
          history.beforeData,
          history.changes.map((change) => change.field),
          req.user?.role,
        );
        await appendUndoRecord(tx, history, current, restored, req);
        return restored;
      });

      res.json({ message: "Perubahan berhasil dibatalkan.", itemId: result.id });
    } catch (error) {
      console.error("Error Undo BV/RAB History:", error);
      const clientError = /tidak dapat dibatalkan|sudah dibatalkan|perubahan terbaru|Snapshot perubahan|Data item sudah berubah/i.test(error.message || "");
      res.status(error.statusCode || (clientError ? 409 : 500)).json({
        error: error.statusCode || clientError ? error.message : "Gagal membatalkan perubahan BV/RAB.",
      });
    }
  },
);

module.exports = router;
