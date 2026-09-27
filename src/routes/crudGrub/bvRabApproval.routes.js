"use strict";

const express = require("express");
const prisma = require("../../lib/prisma");
const { verifyToken, authorizeRoles } = require("../../middleware/auth");
const {
  transitionApproval,
  loadBaselineSnapshot,
  hashBaselineSnapshot,
  diffBaselineSnapshots,
  lockApprovalProject,
  getCurrentApproval,
  getLatestApprovedApproval,
} = require("../../services/bvRabApprovalService");

const router = express.Router();
const APPROVAL_ROLES = ["SUPER_ADMIN", "PROJECT_MANAGER", "PERENCANA"];
const REVIEWER_ROLES = ["SUPER_ADMIN", "PROJECT_MANAGER"];
const SUBMITTER_ROLES = ["SUPER_ADMIN", "PROJECT_MANAGER", "PERENCANA"];

function publicApprovalShape(row, role) {
  if (!row) return null;
  const base = {
    id: row.id,
    projectId: row.projectId,
    revision: row.revision,
    status: row.status,
    version: row.version,
    submittedById: row.submittedById,
    submittedByName: row.submittedByName,
    submittedAt: row.submittedAt,
    reviewedById: row.reviewedById,
    reviewedByName: row.reviewedByName,
    reviewedAt: row.reviewedAt,
    reviewComment: row.reviewComment,
    baselineAvailable: Boolean(row.baselineSnapshot),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  return base;
}

/** GET /api/projects/:projectId/bv-rab-approval */
router.get(
  "/projects/:projectId/bv-rab-approval",
  verifyToken,
  authorizeRoles(...APPROVAL_ROLES),
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const project = await prisma.project.findUnique({ where: { id: projectId } });
      if (!project) return res.status(404).json({ error: "Project tidak ditemukan." });

      const approval = await getCurrentApproval(prisma, projectId);
      const histories = await prisma.bvRabApprovalRevision.findMany({
        where: { projectId },
        orderBy: { revision: "desc" },
        take: 20,
      });
      res.json({
        current: publicApprovalShape(approval, req.user?.role),
        history: histories.map((row) => publicApprovalShape(row, req.user?.role)),
      });
    } catch (error) {
      console.error("Error Get BvRabApproval:", error);
      res.status(500).json({ error: error.message || "Terjadi kesalahan pada server." });
    }
  },
);

/** POST /api/projects/:projectId/bv-rab-approval/submit */
router.post(
  "/projects/:projectId/bv-rab-approval/submit",
  verifyToken,
  authorizeRoles(...SUBMITTER_ROLES),
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const expectedVersion = Number(req.body?.expectedVersion);
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
        return res.status(400).json({ error: "expectedVersion wajib berupa bilangan bulat >= 1." });
      }
      const project = await prisma.project.findUnique({ where: { id: projectId } });
      if (!project) return res.status(404).json({ error: "Project tidak ditemukan." });

      const result = await prisma.$transaction(async (tx) => {
        await lockApprovalProject(tx, projectId);
        const current = await getCurrentApproval(tx, projectId);
        if (current && current.version !== expectedVersion) {
          const error = new Error("Data BV/RAB telah berubah sejak halaman dibuka. Muat ulang lalu coba lagi.");
          error.statusCode = 409;
          throw error;
        }
        const next = transitionApproval(current, "SUBMIT");
        const data = {
          projectId,
          revision: next.revision,
          status: next.status,
          version: (current?.version || 0) + 1,
          submittedById: req.user?.userId || req.user?.id || null,
          submittedByName: req.user?.name || req.user?.role || null,
          submittedAt: new Date(),
          reviewedById: null,
          reviewedByName: null,
          reviewedAt: null,
          reviewComment: null,
          baselineSnapshot: null,
          baselineHash: null,
        };
        return current
          ? tx.bvRabApprovalRevision.update({ where: { id: current.id }, data })
          : tx.bvRabApprovalRevision.create({ data });
      });

      res.json({ message: "BV/RAB dikirim untuk review.", data: publicApprovalShape(result, req.user?.role) });
    } catch (error) {
      console.error("Error Submit BvRabApproval:", error);
      res.status(error.statusCode || 500).json({ error: error.message || "Terjadi kesalahan pada server." });
    }
  },
);

/** POST /api/projects/:projectId/bv-rab-approval/decision */
router.post(
  "/projects/:projectId/bv-rab-approval/decision",
  verifyToken,
  authorizeRoles(...REVIEWER_ROLES),
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const { decision, comment } = req.body || {};
      const expectedVersion = Number(req.body?.expectedVersion);
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
        return res.status(400).json({ error: "expectedVersion wajib berupa bilangan bulat >= 1." });
      }
      const approved = decision === "APPROVED";
      if (!approved && decision !== "CHANGES_REQUESTED") {
        return res.status(400).json({ error: "decision harus APPROVED atau CHANGES_REQUESTED." });
      }
      if (!approved && (!comment || !String(comment).trim())) {
        return res.status(400).json({ error: "Catatan revisi wajib diisi saat meminta perubahan." });
      }
      const project = await prisma.project.findUnique({ where: { id: projectId } });
      if (!project) return res.status(404).json({ error: "Project tidak ditemukan." });

      const result = await prisma.$transaction(async (tx) => {
        await lockApprovalProject(tx, projectId);
        const current = await getCurrentApproval(tx, projectId);
        if (!current || current.status !== "PENDING_REVIEW") {
          const error = new Error("Tidak ada pengajuan menunggu review untuk project ini.");
          error.statusCode = 409;
          throw error;
        }
        if (current.version !== expectedVersion) {
          const error = new Error("Versi data telah berubah. Muat ulang lalu coba lagi.");
          error.statusCode = 409;
          throw error;
        }
        const next = transitionApproval(current, approved ? "APPROVE" : "REQUEST_CHANGES");
        const baseline =
          approved ? await loadBaselineSnapshot(tx, projectId) : current.baselineSnapshot;
        const baselineHash = approved ? hashBaselineSnapshot(baseline) : current.baselineHash;

        return tx.bvRabApprovalRevision.update({
          where: { id: current.id },
          data: {
            status: next.status,
            version: current.version + 1,
            reviewedById: req.user?.userId || req.user?.id || null,
            reviewedByName: req.user?.name || req.user?.role || null,
            reviewedAt: new Date(),
            reviewComment: approved ? null : String(comment || "").trim(),
            baselineSnapshot: baseline,
            baselineHash,
          },
        });
      });

      res.json({ message: approved ? "BV/RAB disetujui. Baseline tersimpan." : "Revisi diminta.", data: publicApprovalShape(result, req.user?.role) });
    } catch (error) {
      console.error("Error Decision BvRabApproval:", error);
      res.status(error.statusCode || 500).json({ error: error.message || "Terjadi kesalahan pada server." });
    }
  },
);

/** POST /api/projects/:projectId/bv-rab-approval/revisions */
router.post(
  "/projects/:projectId/bv-rab-approval/revisions",
  verifyToken,
  authorizeRoles(...SUBMITTER_ROLES),
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const project = await prisma.project.findUnique({ where: { id: projectId } });
      if (!project) return res.status(404).json({ error: "Project tidak ditemukan." });

      const result = await prisma.$transaction(async (tx) => {
        await lockApprovalProject(tx, projectId);
        const current = await getCurrentApproval(tx, projectId);
        if (!current || current.status !== "APPROVED") {
          const error = new Error("Revisi baru hanya dapat dibuat dari status APPROVED.");
          error.statusCode = 409;
          throw error;
        }
        const next = transitionApproval(current, "NEW_REVISION");
        return tx.bvRabApprovalRevision.create({
          data: {
            projectId,
            revision: next.revision,
            status: next.status,
            version: current.version + 1,
          },
        });
      });

      res.status(201).json({ message: "Revisi baru dibuat. Data dapat diubah kembali.", data: publicApprovalShape(result, req.user?.role) });
    } catch (error) {
      console.error("Error Revision BvRabApproval:", error);
      res.status(error.statusCode || 500).json({ error: error.message || "Terjadi kesalahan pada server." });
    }
  },
);

/** GET /api/projects/:projectId/bv-rab-approval/baseline/diff */
router.get(
  "/projects/:projectId/bv-rab-approval/baseline/diff",
  verifyToken,
  authorizeRoles(...APPROVAL_ROLES),
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const project = await prisma.project.findUnique({ where: { id: projectId } });
      if (!project) return res.status(404).json({ error: "Project tidak ditemukan." });

      const current = await getLatestApprovedApproval(prisma, projectId);
      if (!current || !current.baselineSnapshot) {
        return res.status(404).json({ error: "Belum ada baseline yang disetujui." });
      }
      const live = await loadBaselineSnapshot(prisma, projectId);
      const diff = diffBaselineSnapshots(current.baselineSnapshot, live, req.user?.role);
      res.json({ revision: current.revision, approvedAt: current.reviewedAt, diff });
    } catch (error) {
      console.error("Error Diff BvRabApproval:", error);
      res.status(500).json({ error: error.message || "Terjadi kesalahan pada server." });
    }
  },
);

module.exports = router;