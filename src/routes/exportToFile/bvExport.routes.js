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

module.exports = router;
