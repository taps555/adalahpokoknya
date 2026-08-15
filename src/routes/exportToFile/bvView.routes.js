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

function fmtNum(n) {
  if (n === null || n === undefined || n === "") return "";
  return Number(n).toLocaleString("id-ID", { maximumFractionDigits: 2 });
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

// same include shape as buildBvSheet's bvItemInclude
const bvItemInclude = {
  breakdowns: true,
  sourceJobType: true,
  children: {
    include: {
      breakdowns: true,
      sourceJobType: true,
    },
    orderBy: { createdAt: "asc" },
  },
};

// row-cell model, mirrors ws.getCell(`${col}${r}`) access in buildBvSheet
function newRow() {
  return {
    no: "",
    uraian: "",
    bold: false,
    groupHeader: false,
    subGroupHeader: false,
    sat: "",
    vol: null,
    boldVol: false,
    ket: "",
    panjang: null,
    lebar: null,
    tinggi: null,
    luas: null,
    keliling: null,
    dia: null,
    berat: null,
    sisi: null,
    bh: null,
    waste: null,
    totalVol: null,
    totalSat: "",
    link: "",
    breakdownRed: false,
  };
}

// Builds the flat row array using the same row-cursor logic as buildBvSheet's
// writeItem (including the r-- reuse that merges the first breakdown line
// into the item's own row instead of starting a new one).
function buildRows(groups) {
  const rows = [];
  let r = 0;

  function getRow(idx) {
    while (rows.length <= idx) rows.push(newRow());
    return rows[idx];
  }

  function writeItem(it, counterObj) {
    const isHeader = !!it.isHeaderOnly;
    const isChild = !!it.parentBvItemId;
    const no = isHeader ? counterObj.n++ : isChild ? "" : counterObj.n++;
    const namePrefix = isChild ? "\u00a0\u00a0- " : "";

    const row = getRow(r);
    row.no = no;
    row.uraian = namePrefix + (it.name || "");
    if (isHeader) row.bold = true;

    const hasChildren = (it.children || []).length > 0;
    const breakdownList = it.breakdowns || [];
    const hasBreakdown = breakdownList.length > 0;

    if (!isHeader && !hasChildren) {
      row.sat = it.paymentUnit || "";
      row.vol = it.totalVolume != null ? Number(it.totalVolume) : null;
      row.boldVol = true;
      row.totalVol = it.totalVolume != null ? Number(it.totalVolume) : null;
      row.totalSat = it.paymentUnit || "";
      row.link = it.ecommerceLink || "";
    }

    if (!isHeader && !hasChildren && hasBreakdown) {
      r++;
      let lastKeterangan = null;
      breakdownList.forEach((b) => {
        const ketText = (b.keterangan || "").trim();
        const showKet = ketText !== lastKeterangan;
        lastKeterangan = ketText;

        if (!isChild || !ketText) r--;

        const bRow = getRow(r);
        bRow.ket = showKet ? ketText : "";
        bRow.panjang = b.panjang != null ? Number(b.panjang) : null;
        bRow.lebar = b.lebar != null ? Number(b.lebar) : null;
        bRow.tinggi = b.tinggi != null ? Number(b.tinggi) : null;
        bRow.luas = b.luas != null ? Number(b.luas) : null;
        bRow.keliling = b.keliling != null ? Number(b.keliling) : null;
        bRow.dia = b.diameter != null ? Number(b.diameter) : null;
        bRow.berat = b.berat != null ? Number(b.berat) : null;
        bRow.sisi = b.jumlahSisi != null ? Number(b.jumlahSisi) : null;
        bRow.bh = b.jumlahBh != null ? Number(b.jumlahBh) : null;
        bRow.waste =
          b.waste != null && Number(b.waste) !== 0 ? Number(b.waste) : null;
        if (b.subTotal != null) bRow.totalVol = Number(b.subTotal);
        bRow.breakdownRed = true;

        r++;
      });
    } else {
      r++;
    }

    (it.children || []).forEach((child) => writeItem(child, counterObj));
  }

  groups.forEach((group, idx) => {
    if (idx > 0) r++;
    const groupRow = getRow(r);
    groupRow.no = ROMAN[idx] || String(idx + 1);
    groupRow.uraian = group.name.toUpperCase();
    groupRow.groupHeader = true;
    r++;

    const counter = { n: 1 };
    for (const it of group.bvItems) writeItem(it, counter);

    for (const sub of group.children || []) {
      const subRow = getRow(r);
      subRow.no = String(counter.n++);
      subRow.uraian = sub.name;
      subRow.subGroupHeader = true;
      r++;
      const subCounter = { n: 1 };
      for (const it of sub.bvItems) writeItem(it, subCounter);
    }
  });

  return rows;
}

function renderRowHtml(row) {
  if (row.groupHeader) {
    return `<tr class="group-row"><td>${escapeHtml(row.no)}</td><td colspan="17">${escapeHtml(row.uraian)}</td></tr>`;
  }
  if (row.subGroupHeader) {
    return `<tr class="subgroup-row"><td>${escapeHtml(row.no)}</td><td colspan="17">${escapeHtml(row.uraian)}</td></tr>`;
  }

  const bd = row.breakdownRed ? "bd" : "";
  const vb = row.boldVol ? "b" : "";

  return `
    <tr class="${row.bold ? "bv-header-row" : ""}">
      <td>${row.no}</td>
      <td class="left">${escapeHtml(row.uraian)}</td>
      <td class="num">${escapeHtml(row.sat)}</td>
      <td class="num ${vb}">${fmtNum(row.vol)}</td>
      <td class="left">${escapeHtml(row.ket)}</td>
      <td class="num ${bd}">${fmtNum(row.panjang)}</td>
      <td class="num ${bd}">${fmtNum(row.lebar)}</td>
      <td class="num ${bd}">${fmtNum(row.tinggi)}</td>
      <td class="num ${bd}">${fmtNum(row.luas)}</td>
      <td class="num ${bd}">${fmtNum(row.keliling)}</td>
      <td class="num ${bd}">${fmtNum(row.dia)}</td>
      <td class="num ${bd}">${fmtNum(row.berat)}</td>
      <td class="num ${bd}">${fmtNum(row.sisi)}</td>
      <td class="num ${bd}">${fmtNum(row.bh)}</td>
      <td class="num ${bd}">${fmtNum(row.waste)}</td>
      <td class="num ${vb}">${fmtNum(row.totalVol)}</td>
      <td class="num">${escapeHtml(row.totalSat)}</td>
      <td>${row.link ? `<a href="${escapeHtml(row.link)}" target="_blank" rel="noopener">${escapeHtml(row.link)}</a>` : ""}</td>
    </tr>
  `;
}

function renderBvHtml(project, groups) {
  const rows = buildRows(groups);
  const rowsHtml = rows.map(renderRowHtml).join("");

  return `
<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<title>Back Up Volume — ${escapeHtml(project.name)}</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; margin: 30px; color: #1a2332; font-size: 12.5px; }
  .header { display: flex; border: 2px solid #1a2332; margin-bottom: 20px; }
  .header .logo { width: 260px; border-right: 2px solid #1a2332; display: flex; align-items: center; justify-content: center; font-weight: bold; }
  .header .info { flex: 1; padding: 10px 16px; }
  .header .info h1 { text-align: center; font-size: 16px; margin: 0 0 10px; text-transform: uppercase; }
  .header .info table td { padding: 2px 6px; font-size: 12.5px; }
  table.bv { width: 100%; border-collapse: collapse; }
  table.bv th, table.bv td { border: 1px solid #999; padding: 4px 6px; font-size: 11.5px; }
  table.bv th { background: #d9d9d9; text-align: center; }
  table.bv td.left { text-align: left; }
  table.bv td.num { text-align: right; font-family: monospace; }
  .group-row { background: #d9d9d9; font-weight: bold; }
  .subgroup-row { font-weight: 600; background: #f0f0f0; }
  .bv-header-row { font-weight: bold; }
  td.bd { color: #cc0000; font-family: monospace; }
  td.b { font-weight: bold; }
  @media print {
    body { margin: 10px; }
    button { display: none; }
  }
</style>
</head>
<body>

<button onclick="window.print()" style="margin-bottom:12px; padding:8px 14px;">🖨 Print / Save as PDF</button>

<div class="header">
  <div class="logo"><img src="/image.png" alt="IVES Interior Contractor" style="max-width:240px; max-height:140px;"></div>
  <div class="info">
    <h1>Back Up Volume</h1>
    <table>
      <tr><td>Nama Kegiatan</td><td>:</td><td>${escapeHtml(project?.name || "-")}</td></tr>
      <tr><td>Nama Pekerjaan</td><td>:</td><td>${escapeHtml(project?.client?.name || "-")}</td></tr>
      <tr><td>Lokasi Pekerjaan</td><td>:</td><td>${escapeHtml(project.location)}</td></tr>
      <tr><td>Tahun Anggaran</td><td>:</td><td>${escapeHtml(String(project.hspkPeriod))}</td></tr>
    </table>
  </div>
</div>

<table class="bv">
  <thead>
    <tr>
      <th rowspan="2">NO</th>
      <th rowspan="2">URAIAN PEKERJAAN</th>
      <th colspan="2">VOLUME</th>
      <th rowspan="2">KETERANGAN</th>
      <th rowspan="2">Panjang<br>(m)</th>
      <th rowspan="2">Lebar<br>(m)</th>
      <th rowspan="2">Tinggi<br>(m)</th>
      <th rowspan="2">Luas<br>(m2)</th>
      <th rowspan="2">Keliling<br>(m1)</th>
      <th rowspan="2">Dia<br>(m2)</th>
      <th rowspan="2">Berat<br>(Kg)</th>
      <th colspan="2">Jumlah</th>
      <th rowspan="2">Waste<br>(%)</th>
      <th colspan="2">TOTAL</th>
      <th rowspan="2">LINK</th>
    </tr>
    <tr>
      <th>Sat.</th><th>Vol.</th>
      <th>(Sisi)</th><th>(Bh)</th>
      <th>Vol.</th><th>Sat.</th>
    </tr>
  </thead>
  <tbody>
    ${rowsHtml}
  </tbody>
</table>

</body>
</html>
  `;
}

router.get("/projects/:projectId/bv-items/view", async (req, res) => {
  try {
    const { projectId } = req.params;
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { client: true },
    });
    if (!project) return res.status(404).send("Project tidak ditemukan.");

    const groups = await prisma.rabGroup.findMany({
      where: { projectId, parentId: null },
      include: {
        bvItems: {
          where: { parentBvItemId: null },
          include: bvItemInclude,
          orderBy: { createdAt: "asc" },
        },
        children: {
          include: {
            bvItems: {
              where: { parentBvItemId: null },
              include: bvItemInclude,
              orderBy: { createdAt: "asc" },
            },
          },
        },
      },
      orderBy: { order: "asc" },
    });

    const html = renderBvHtml(project, groups);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err) {
    console.error("Error View BV:", err);
    res.status(500).send("Gagal menampilkan Back Up Volume: " + err.message);
  }
});

module.exports = router;
