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
      include: { client: true, workCategories: { include: { workCategory: true } } },
    });
    if (!project)
      return res.status(404).json({ error: "Project tidak ditemukan." });

    const wb = new ExcelJS.Workbook();
    
    const wsGeneral = wb.addWorksheet("General");
    await buildTimeScheduleSheet(wsGeneral, projectId, project, prisma, req.query.viewMode || 'week', 'GENERAL');

    const activeCategories = (project.workCategories || [])
      .filter(c => c.isActive && c.workCategory?.isActive)
      .map(c => c.workCategory);

    for (const cat of activeCategories) {
      const code = cat.code.toUpperCase();
      // Excel sheet names max length is 31 chars
      let sheetName = code;
      if (sheetName.length > 31) sheetName = sheetName.substring(0, 31);
      
      const ws = wb.addWorksheet(sheetName);
      await buildTimeScheduleSheet(ws, projectId, project, prisma, req.query.viewMode || 'week', code);
    }

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

router.get(
  "/projects/:projectId/time-schedule/export-combined",
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: { client: true, pairedProject: { include: { client: true } } },
      });
      if (!project)
        return res.status(404).json({ error: "Project tidak ditemukan." });

      const wb = new ExcelJS.Workbook();
      const projects = [project, project.pairedProject]
        .filter(Boolean)
        .sort((a, b) => (a.discipline === "SIPIL" ? -1 : 1));

      for (const p of projects) {
        const sheetName =
          p.discipline === "SIPIL" ? "TS - Civil" : "TS - Interior";
        const ws = wb.addWorksheet(sheetName);
        await buildTimeScheduleSheet(ws, p.id, p, prisma, req.query.viewMode || 'week');
      }

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
      console.error("Error Export Time Schedule Combined:", err);
      res.status(500).json({ error: err.message || "Gagal export." });
    }
  },
);

module.exports = router;
