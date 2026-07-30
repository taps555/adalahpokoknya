"use strict";

const express = require("express");
const prisma = require("../../lib/prisma");

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

function renderRabHtml(project, groups) {
  let grandRap = 0,
    grandRab = 0;
  let rowsHtml = "";

  groups.forEach((group, idx) => {
    rowsHtml += `
      <tr class="group-row">
        <td>${ROMAN[idx] || idx + 1}</td>
        <td colspan="7">${escapeHtml(group.name.toUpperCase())}</td>
      </tr>
    `;

    let n = 1;
    const writeItem = (item, indent) => {
      rowsHtml += `
        <tr>
          <td>${n++}</td>
          <td class="left">${indent ? "&nbsp;&nbsp;- " : ""}${escapeHtml(item.name)}</td>
          <td>${escapeHtml(item.paymentUnit)}</td>
          <td class="num">${Number(item.volume)}</td>
          <td class="num">${fmtRp(item.rapUnitPrice)}</td>
          <td class="num">${fmtRp(item.rapTotalPrice)}</td>
          <td class="num">${fmtRp(item.rabUnitPrice)}</td>
          <td class="num">${fmtRp(item.rabTotalPrice)}</td>
        </tr>
      `;
    };

    for (const item of group.items) writeItem(item, false);
    for (const sub of group.children || []) {
      rowsHtml += `
        <tr class="subgroup-row">
          <td>${n++}</td>
          <td colspan="7">${escapeHtml(sub.name)}</td>
        </tr>
      `;
      for (const item of sub.items) writeItem(item, true);
    }

    const { rap, rab } = sumRecursive(group);
    grandRap += rap;
    grandRab += rab;

    rowsHtml += `
      <tr class="subtotal-row">
        <td colspan="5"></td>
        <td class="num">${fmtRp(rap)}</td>
        <td></td>
        <td class="num">${fmtRp(rab)}</td>
      </tr>
    `;
  });

  return `
<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<title>RAB — ${escapeHtml(project.name)}</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; margin: 30px; color: #1a2332; font-size: 13px; }
  .header { display: flex; border: 2px solid #1a2332; margin-bottom: 20px; }
  .header .logo { width: 300px; border-right: 2px solid #1a2332; display: flex; align-items: center; justify-content: center; font-weight: bold; }
  .header .info { flex: 1; padding: 10px 16px; }
  .header .info h1 { text-align: center; font-size: 16px; margin: 0 0 10px; text-transform: uppercase; }
  .header .info table td { padding: 2px 6px; font-size: 12.5px; }
  table.rab { width: 100%; border-collapse: collapse; }
  table.rab th, table.rab td { border: 1px solid #999; padding: 5px 8px; font-size: 12px; }
  table.rab th { background: #d9d9d9; text-align: center; }
  table.rab td.left { text-align: left; }
  table.rab td.num { text-align: right; font-family: monospace; }
  .group-row { background: #eaf1f7; font-weight: bold; }
  .subgroup-row { font-weight: 600; }
  .subtotal-row { background: #f0f0f0; font-style: italic; font-weight: bold; }
  .grand-row { background: #fff3cd; font-weight: bold; }
  @media print {
    body { margin: 10px; }
    button { display: none; }
  }
</style>
</head>
<body>

<button onclick="window.print()" style="margin-bottom:12px; padding:8px 14px;">🖨 Print / Save as PDF</button>

<div class="header">
  <div class="logo"><img src="/image.png" alt="IVES Interior Contractor" style="max-width:280px; max-height:140px;"></div>
  <div class="info">
    <h1>Rencana Anggaran Biaya</h1>
    <table>
      <tr><td>Nama Kegiatan</td><td>:</td><td>${escapeHtml(project.activityName || "-")}</td></tr>
      <tr><td>Nama Pekerjaan</td><td>:</td><td>${escapeHtml(project.name)}</td></tr>
      <tr><td>Lokasi Pekerjaan</td><td>:</td><td>${escapeHtml(project.location)}</td></tr>
      <tr><td>Tahun Anggaran</td><td>:</td><td>${escapeHtml(String(project.hspkPeriod))}</td></tr>
    </table>
  </div>
</div>

<table class="rab">
  <thead>
    <tr>
      <th rowspan="2">NO</th>
      <th rowspan="2">Item Pekerjaan</th>
      <th rowspan="2">Sat.</th>
      <th rowspan="2">Vol.</th>
      <th colspan="2">RAP</th>
      <th colspan="2">RAB</th>
    </tr>
    <tr>
      <th>Harga Satuan</th><th>Total Harga</th>
      <th>Harga Satuan</th><th>Total Harga</th>
    </tr>
  </thead>
  <tbody>
    ${rowsHtml}
    <tr class="grand-row">
      <td colspan="5">GRAND TOTAL</td>
      <td class="num">${fmtRp(grandRap)}</td>
      <td></td>
      <td class="num">${fmtRp(grandRab)}</td>
    </tr>
  </tbody>
</table>

</body>
</html>
  `;
}

router.get("/projects/:projectId/rab-items/view", async (req, res) => {
  try {
    const { projectId } = req.params;
    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) return res.status(404).send("Project tidak ditemukan.");

    const groups = await prisma.rabGroup.findMany({
      where: { projectId, parentId: null },
      include: { items: true, children: { include: { items: true } } },
      orderBy: { order: "asc" },
    });

    const html = renderRabHtml(project, groups);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err) {
    console.error("Error View RAB:", err);
    res.status(500).send("Gagal menampilkan RAB: " + err.message);
  }
});

module.exports = router;
