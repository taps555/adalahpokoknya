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
      include: { client: true, pairedProject: { include: { client: true } } },
    });
    if (!project)
      return res.status(404).json({ error: "Project tidak ditemukan." });

    const wb = new ExcelJS.Workbook();

    const projects = [project, project.pairedProject]
      .filter(Boolean)
      .sort((a, b) => (a.discipline === "SIPIL" ? -1 : 1));
    // const CV = "SIPIL";
    // const CV = "Civil";
    // const INT = "INT";

    for (const p of projects) {
      const suffix = p.discipline === "SIPIL" ? "CV" : "INT";

      const wsBv = wb.addWorksheet(`BV ${suffix}`);
      await buildBvSheet(wsBv, p.id, p);

      const wsRab = wb.addWorksheet(`BQ ${suffix}`);
      await buildRabSheet(wsRab, p.id, p);

      const wsTimeSchedule = wb.addWorksheet(`TS ${suffix}`);
      await buildTimeScheduleSheet(wsTimeSchedule, p.id, p, prisma);
    }

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

router.get(
  "/projects/:projectId/rab-items/export-combined",
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
          p.discipline === "SIPIL" ? "RAB - Civil" : "RAB - Interior";
        const ws = wb.addWorksheet(sheetName);
        await buildRabSheet(ws, p.id, p);
      }

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="RAB_${project.name.replace(/\s+/g, "_")}.xlsx"`,
      );
      await wb.xlsx.write(res);
      res.end();
    } catch (err) {
      console.error("Error Export RAB Combined:", err);
      res.status(500).json({ error: err.message || "Gagal export." });
    }
  },
);

module.exports = router;
