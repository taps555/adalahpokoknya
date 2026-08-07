"use strict";

const express = require("express");
const ExcelJS = require("exceljs");
const prisma = require("../../lib/prisma");
const { buildBvSheet } = require("../../services/bvExportHelper");

const router = express.Router();

router.get("/projects/:projectId/bv-items/export", async (req, res) => {
  try {
    const { projectId } = req.params;
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { client: true },
    });
    if (!project)
      return res.status(404).json({ error: "Project tidak ditemukan." });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("BV");
    await buildBvSheet(ws, projectId, project);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="BV_${project.name.replace(/\s+/g, "_")}.xlsx"`,
    );
    await wb.xlsx.write(res);
    res.end();
    console.log(project);
  } catch (err) {
    console.error("Error Export BV:", err);
    res.status(500).json({ error: err.message || "Gagal export." });
  }
});

router.get(
  "/projects/:projectId/bv-items/export-combined",
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
          p.discipline === "SIPIL" ? "BV - Civil" : "BV - Interior";
        const ws = wb.addWorksheet(sheetName);
        await buildBvSheet(ws, p.id, p);
      }

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="BV_${project.name.replace(/\s+/g, "_")}.xlsx"`,
      );
      await wb.xlsx.write(res);
      res.end();
    } catch (err) {
      console.error("Error Export BV Combined:", err);
      res.status(500).json({ error: err.message || "Gagal export." });
    }
  },
);

module.exports = router;
