"use strict";

const fs = require("fs");
const path = require("path");
const express = require("express");
const prisma = require("../../lib/prisma");
const { verifyToken } = require("../../middleware/auth");
const { buildWorkCategoryItemWhere } = require("../../services/bvCalculationService");
const { normalizeRabExportMode } = require("../../services/rabExportHelper");

const router = express.Router();

function escapeHtml(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}

function fmtRp(n) {
  return (
    "Rp " + Number(n).toLocaleString("id-ID", { maximumFractionDigits: 0 })
  );
}

function divesLogoHtml() {
  const logoPath = path.resolve(__dirname, "../../../public/assets/dives.png");
  if (!fs.existsSync(logoPath)) return "";
  const dataUri = `data:image/png;base64,${fs.readFileSync(logoPath).toString("base64")}`;
  return `<img src="${dataUri}" alt="DIVES">`;
}

const ROMAN = [
  "I",
  "II",
  "III",
  "IV",
  "V",
  "VI",
  "VII",
  "VIII",
  "IX",
  "X",
  "XI",
  "XII",
  "XIII",
  "XIV",
  "XV",
];

function sumRecursive(group) {
  let rap = 0,
    rab = 0;
  for (const it of group.items || []) {
    rap += Number(it.rapTotalPrice);
    rab += Number(it.rabTotalPrice);
  }
  for (const child of group.children || []) {
    const s = sumRecursive(child);
    rap += s.rap;
    rab += s.rab;
  }
  return { rap, rab };
}

function renderBudgetHtml(project, groups, mode, categoryCode, isInvoice = false) {
  const unitKey = mode === "RAB" ? "rabUnitPrice" : "rapUnitPrice";
  const totalKey = mode === "RAB" ? "rabTotalPrice" : "rapTotalPrice";
  let grandTotal = 0;
  let rowsHtml = "";

  groups.forEach((group, idx) => {
    rowsHtml += `<tr class="group-row"><td>${ROMAN[idx] || idx + 1}</td><td colspan="5">${escapeHtml(String(group.name || "").toUpperCase())}</td></tr>`;
    let n = 1;
    const writeItem = (item, indent) => {
      rowsHtml += `<tr${item.isByOwner ? ' class="owner-row"' : ""}>
        <td>${n++}</td>
        <td class="left">${indent ? "&nbsp;&nbsp;- " : ""}${escapeHtml(item.name)}</td>
        <td>${escapeHtml(item.paymentUnit)}</td>
        <td class="num">${Number(item.volume || 0).toLocaleString("id-ID", { maximumFractionDigits: 2 })}</td>
        <td class="num">${item.isByOwner ? "By Owner" : fmtRp(item[unitKey])}</td>
        <td class="num">${item.isByOwner ? "By Owner" : fmtRp(item[totalKey])}</td>
      </tr>`;
    };
    const writeGroup = (current, depth) => {
      for (const item of current.items || []) writeItem(item, depth > 0);
      for (const child of current.children || []) {
        rowsHtml += `<tr class="subgroup-row"><td>${n++}</td><td colspan="5">${"&nbsp;&nbsp;".repeat(depth + 1)}${escapeHtml(child.name)}</td></tr>`;
        writeGroup(child, depth + 1);
      }
    };
    writeGroup(group, 0);
    const totals = sumRecursive(group);
    const subtotal = mode === "RAB" ? totals.rab : totals.rap;
    grandTotal += subtotal;
    rowsHtml += `<tr class="subtotal-row"><td colspan="5">Sub Total ${mode}</td><td class="num">${fmtRp(subtotal)}</td></tr>`;
  });

  const documentTitle = isInvoice ? "INVOICE" : `RENCANA ANGGARAN BIAYA ${mode}`;
  const clientLine = isInvoice
    ? `<p><strong>Kepada:</strong> ${escapeHtml(project.client?.name || "Client")}</p>`
    : "";
  const approval = isInvoice
    ? `<h2 class="approval-title">PERSETUJUAN DAN TANDA TANGAN</h2>
       <section class="signature-grid">
         <div class="signature-box"><strong>Diajukan oleh</strong><span class="signature-line">DIVES</span></div>
         <div class="signature-box"><strong>Diperiksa oleh</strong><span class="signature-line">Project Manager</span></div>
         <div class="signature-box"><strong>Disetujui oleh</strong><span class="signature-line">${escapeHtml(project.client?.name || "Client")}</span></div>
       </section>`
    : "";

  return `<!DOCTYPE html>
<html lang="id"><head><meta charset="UTF-8"><title>${documentTitle} — ${escapeHtml(project.name)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 18px; color: #172033; background: #fff; font-family: 'Arial Narrow', Arial, sans-serif; font-size: 12px; }
  .screen-actions { margin-bottom: 12px; }
  .print-button { border: 1px solid #172033; border-radius: 6px; background: #fff; padding: 8px 14px; cursor: pointer; }
  .sheet { max-width: 1120px; margin: 0 auto; background: #fff; }
  .header { display: grid; grid-template-columns: 220px 1fr; border: 2px solid #172033; margin-bottom: 12px; min-height: 118px; }
  .logo { display: flex; align-items: center; justify-content: center; border-right: 2px solid #172033; padding: 12px; }
  .logo img { max-width: 185px; max-height: 86px; object-fit: contain; }
  .info { padding: 10px 16px; }
  .info h1 { margin: 0 0 8px; text-align: center; font-size: 19px; letter-spacing: .04em; }
  .info table { width: 100%; border-collapse: collapse; }
  .info td { padding: 2px 5px; }
  .category { margin: 0 0 8px; font-weight: 700; }
  table.rab { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.rab th, table.rab td { border: 1px solid #6b7280; padding: 5px 7px; vertical-align: middle; }
  table.rab th { background: #d9d9d9; text-align: center; }
  table.rab th:nth-child(1) { width: 6%; }
  table.rab th:nth-child(2) { width: 39%; }
  table.rab th:nth-child(3) { width: 8%; }
  table.rab th:nth-child(4) { width: 9%; }
  table.rab th:nth-child(5), table.rab th:nth-child(6) { width: 19%; }
  .left { text-align: left; }
  .num { text-align: right; white-space: nowrap; }
  .group-row { background: #eaf1f7; font-weight: bold; }
  .subgroup-row { font-weight: 600; }
  .subtotal-row { background: #f0f0f0; font-style: italic; font-weight: bold; }
  .grand-row { background: #ffcc66; font-weight: bold; }
  .owner-row { background: #ffe985; }
  .approval-title { margin: 26px 0 0; font-size: 13px; letter-spacing: .05em; }
  .signature-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 48px; margin-top: 32px; text-align: center; page-break-inside: avoid; }
  .signature-box { min-height: 108px; display: flex; flex-direction: column; justify-content: space-between; }
  .signature-line { border-top: 1px solid #172033; padding-top: 5px; }
  @media print { body { padding: 0; } .screen-actions { display: none; } .sheet { max-width: none; } tr { page-break-inside: avoid; } }
</style></head><body>
<div class="screen-actions"><button class="print-button" onclick="window.print()">Print / Save as PDF</button></div>
<main class="sheet">
  <div class="header">
    <div class="logo">${divesLogoHtml()}</div>
    <div class="info"><h1>${documentTitle}</h1><table>
      <tr><td>Nama Kegiatan</td><td>:</td><td>${escapeHtml(project.activityName || project.name)}</td></tr>
      <tr><td>Nama Pekerjaan</td><td>:</td><td>${escapeHtml(project.name)}</td></tr>
      <tr><td>Lokasi Pekerjaan</td><td>:</td><td>${escapeHtml(project.location)}</td></tr>
      <tr><td>Tahun Anggaran</td><td>:</td><td>${escapeHtml(project.hspkPeriod)}</td></tr>
    </table></div>
  </div>
  ${clientLine}<p class="category">Kategori: ${escapeHtml(categoryCode)}</p>
  <table class="rab"><thead><tr><th>NO</th><th>${isInvoice ? "URAIAN PEKERJAAN" : "ITEM PEKERJAAN"}</th><th>SAT.</th><th>VOL.</th><th>HARGA SATUAN${isInvoice ? "" : ` ${mode}`}</th><th>${isInvoice ? "JUMLAH" : `TOTAL HARGA ${mode}`}</th></tr></thead>
  <tbody>${rowsHtml}<tr class="grand-row"><td colspan="5">${isInvoice ? "TOTAL INVOICE" : `GRAND TOTAL ${mode}`}</td><td class="num">${fmtRp(grandTotal)}</td></tr></tbody></table>
  ${approval}
</main></body></html>`;
}

router.get("/projects/:projectId/rab-items/view", verifyToken, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { workCategoryId, discipline } = req.query;
    const isInvoice = String(req.query.format || "").toLowerCase() === "invoice";
    const mode = isInvoice ? "RAB" : normalizeRabExportMode(req.query.mode || "RAP");
    if (!mode || mode === "COMBINED") {
      return res.status(400).send("Mode view harus RAP atau RAB.");
    }
    if ((mode === "RAB" || isInvoice) && req.user?.role !== "SUPER_ADMIN") {
      return res.status(403).send("Akses RAB Selling hanya untuk SUPER_ADMIN.");
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        client: true,
        workCategories: { include: { workCategory: true } },
      },
    });
    if (!project) return res.status(404).send("Project tidak ditemukan.");

    let itemWhere = {};
    let categoryTitle = "GENERAL";
    if (workCategoryId) {
      const config = await prisma.projectWorkCategory.findUnique({
        where: { projectId_workCategoryId: { projectId, workCategoryId } },
        include: { workCategory: true },
      });
      if (!config || !config.isActive || !config.workCategory?.isActive) {
        return res.status(400).send("Kategori pekerjaan tidak aktif pada project.");
      }
      categoryTitle = config.workCategory.code;
      itemWhere = buildWorkCategoryItemWhere({ workCategoryId, categoryCode: config.workCategory.code });
    } else if (discipline) {
      const code = String(discipline).trim().toUpperCase();
      const activeCategories = (project.workCategories || []).filter(
        (entry) => entry.isActive && entry.workCategory?.isActive,
      );
      const config = activeCategories.find(
        (entry) => String(entry.workCategory.code || "").trim().toUpperCase() === code,
      );
      if (config) {
        categoryTitle = config.workCategory.code;
        itemWhere = buildWorkCategoryItemWhere({
          workCategoryId: config.workCategoryId,
          categoryCode: config.workCategory.code,
        });
      } else if (activeCategories.length === 0 && ["SIPIL", "INTERIOR"].includes(code)) {
        categoryTitle = code;
        itemWhere = buildWorkCategoryItemWhere({ categoryCode: code });
      } else {
        return res.status(400).send("Kategori pekerjaan tidak ditemukan/aktif pada project.");
      }
    }

    const allGroups = await prisma.rabGroup.findMany({
      where: { projectId },
      include: { items: { where: itemWhere } },
      orderBy: { order: "asc" },
    });
    const byId = new Map(allGroups.map((group) => [group.id, { ...group, children: [] }]));
    const groups = [];
    for (const group of byId.values()) {
      if (group.parentId && byId.has(group.parentId)) {
        byId.get(group.parentId).children.push(group);
      } else {
        groups.push(group);
      }
    }

    const html = renderBudgetHtml(project, groups, mode, categoryTitle, isInvoice);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'",
    );
    res.send(html);
  } catch (err) {
    console.error("Error View RAB:", err);
    res.status(500).send("Gagal menampilkan RAB: " + err.message);
  }
});

module.exports = router;
