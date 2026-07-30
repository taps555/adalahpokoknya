"use strict";

const express = require("express");
const ExcelJS = require("exceljs");
const prisma = require("../../lib/prisma"); // 🔑 Pastikan prisma di-import
const { buildBvSheet } = require("../../services/bvExportHelper");
const { buildRabSheet } = require("../../services/rabExportHelper");
const {
  buildTimeScheduleSheet,
} = require("../../services/timeScheduleExportHelper");

const router = express.Router();

router.get("/projects/:projectId/export-full", async (req, res) => {
  try {
    const { projectId } = req.params;
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { client: true },
    });
    if (!project)
      return res.status(404).json({ error: "Project tidak ditemukan." });

    const wb = new ExcelJS.Workbook();

    // 1. Sheet BV
    const wsBv = wb.addWorksheet("BV");
    await buildBvSheet(wsBv, projectId, project);

    // 2. Sheet RAB
    const wsRab = wb.addWorksheet("RAB");
    await buildRabSheet(wsRab, projectId, project);

    // 3. Sheet Time Schedule (✅ Kirim 'prisma' sebagai parameter ke-4)
    const wsTimeSchedule = wb.addWorksheet("Time Schedule");
    await buildTimeScheduleSheet(wsTimeSchedule, projectId, project, prisma);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="Project_${project.name.replace(/\s+/g, "_")}.xlsx"`,
    );

    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("Error Export Full:", err);
    res.status(500).json({ error: err.message || "Gagal export." });
  }
});

module.exports = router;
