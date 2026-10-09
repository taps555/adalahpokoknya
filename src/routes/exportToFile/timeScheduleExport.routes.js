"use strict";

const express = require("express");
const ExcelJS = require("exceljs");
const prisma = require("../../lib/prisma");
const {
  buildTimeScheduleSheet,
} = require("../../services/timeScheduleExportHelper");

const router = express.Router();

function makeSafeSheetName(rawName, existingSheetNames) {
  let clean = String(rawName || "Sheet")
    .replace(/[\\/?*\[\]:]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) clean = "Sheet";

  let baseName = clean.substring(0, 31);
  let finalName = baseName;
  let counter = 2;

  while (existingSheetNames.has(finalName.toLowerCase())) {
    const suffix = ` (${counter++})`;
    const maxBaseLen = 31 - suffix.length;
    finalName = `${clean.substring(0, maxBaseLen)}${suffix}`;
  }

  existingSheetNames.add(finalName.toLowerCase());
  return finalName;
}

router.get("/projects/:projectId/time-schedule/export", async (req, res) => {
  try {
    const { projectId } = req.params;
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        client: true,
        workCategories: {
          include: {
            workCategory: {
              include: {
                subCategories: {
                  where: { isActive: true },
                  orderBy: { sortOrder: "asc" },
                },
              },
            },
          },
        },
      },
    });
    if (!project)
      return res.status(404).json({ error: "Project tidak ditemukan." });

    const wb = new ExcelJS.Workbook();
    const existingSheetNames = new Set();
    
    const generalSheetName = makeSafeSheetName("General", existingSheetNames);
    const wsGeneral = wb.addWorksheet(generalSheetName);
    await buildTimeScheduleSheet(wsGeneral, projectId, project, prisma, req.query.viewMode || 'week', 'GENERAL');

    const activeCategories = (project.workCategories || [])
      .filter((c) => c.isActive && c.workCategory?.isActive)
      .map((c) => c.workCategory)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

    // Ambil semua subkategori yang dipakai item pada project ini
    const usedSubCategories = await prisma.workSubCategory.findMany({
      where: {
        rabItems: {
          some: { projectId },
        },
      },
      include: { category: true },
    });

    for (const cat of activeCategories) {
      const code = cat.code.toUpperCase();
      const catSheetName = makeSafeSheetName(code, existingSheetNames);
      const wsCat = wb.addWorksheet(catSheetName);
      await buildTimeScheduleSheet(wsCat, projectId, project, prisma, req.query.viewMode || 'week', code);

      // Subkategori di bawah kategori ini (aktif atau yang memiliki item)
      const subCategoryMap = new Map();
      (cat.subCategories || []).forEach((sub) => {
        if (sub.isActive !== false) {
          subCategoryMap.set(sub.id, sub);
        }
      });
      usedSubCategories.forEach((sub) => {
        if (sub.categoryId === cat.id || (sub.category && sub.category.code.toUpperCase() === code)) {
          if (!subCategoryMap.has(sub.id)) {
            subCategoryMap.set(sub.id, sub);
          }
        }
      });

      const subCategoriesToExport = Array.from(subCategoryMap.values())
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

      for (const sub of subCategoriesToExport) {
        const subCode = (sub.code || sub.name || "SUB").toUpperCase();
        const rawSheetName = `${code} - ${subCode}`;
        const subSheetName = makeSafeSheetName(rawSheetName, existingSheetNames);

        const wsSub = wb.addWorksheet(subSheetName);
        await buildTimeScheduleSheet(
          wsSub,
          projectId,
          project,
          prisma,
          req.query.viewMode || 'week',
          code,
          sub.id,
          subCode
        );
      }
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
