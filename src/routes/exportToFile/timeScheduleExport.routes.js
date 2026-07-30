"use strict";

const express = require("express");
const ExcelJS = require("exceljs");
const prisma = require("../../lib/prisma");
const {
  buildTimeScheduleSheet,
} = require("../../services/timeScheduleExportHelper");

const router = express.Router();

router.get("/projects/:projectId/time-schedule/export", async (req, res) => {
  try {
    const { projectId } = req.params;
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { client: true },
    });
    if (!project)
      return res.status(404).json({ error: "Project tidak ditemukan." });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Time Schedule");
    await buildTimeScheduleSheet(ws, projectId, project, prisma);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="TS_${project.name.replace(/\s+/g, "_")}.xlsx"`,
    );
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("Error Export Time Schedule:", err);
    res.status(500).json({ error: err.message || "Gagal export." });
  }
});

module.exports = router;
