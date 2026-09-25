"use strict";

const express = require("express");
const fs = require("fs");
const path = require("path");
const prisma = require("../../lib/prisma");
const { verifyToken, authorizeRoles } = require("../../middleware/auth");

const router = express.Router();
const divesLogoPath = path.join(__dirname, "../../../public/assets/dives.png");
const DIVES_LOGO_DATA_URI = `data:image/png;base64,${fs.readFileSync(divesLogoPath).toString("base64")}`;

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
  const value = Number(n);
  if (!Number.isFinite(value)) return "";
  return value.toLocaleString("id-ID", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function safeHttpUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(String(value));
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function activityName(project) {
  if (project?.discipline === "INTERIOR") return "Pekerjaan Interior";
  if (project?.discipline === "SIPIL") return "Pekerjaan Civil";
  return "Pekerjaan Civil & Interior";
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

// Finite recursive include for BV items. Current project data reaches depth 2
// (root -> child -> grandchild), so all descendants are loaded for the View.
const bvItemLeafInclude = {
  breakdowns: true,
  sourceJobType: true,
  workCategory: true,
};

const bvItemIncludeLevel2 = {
  ...bvItemLeafInclude,
  children: {
    include: bvItemLeafInclude,
    orderBy: { createdAt: "asc" },
  },
};

const bvItemInclude = {
  ...bvItemLeafInclude,
  children: {
    include: bvItemIncludeLevel2,
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
    linkUrl: "",
    breakdownRed: false,
  };
}

// Builds the flat row array using the same row-cursor logic as buildBvSheet's
// writeItem (including the r-- reuse that merges the first breakdown line
// into the item's own row instead of starting a new one).
function stripGroupPrefix(name, reference) {
  const value = String(name || "").trim();
  const ref = String(reference || "").trim();
  if (!ref) return value;
  const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value.replace(new RegExp(`^${escaped}\\s*[.\\-)]?\\s*`, "i"), "");
}

function normalizeViewDiscipline(value) {
  const label = String(value || "GENERAL").trim().toUpperCase();
  if (label === "INTERIOR") return "INTERIOR";
  if (label === "SIPIL" || label === "CIVIL") return "SIPIL";
  return "GENERAL";
}

function filterItemsByCategory(items, { workCategoryId = null, legacyDiscipline = "GENERAL" } = {}) {
  return (items || []).flatMap((item) => {
    const children = filterItemsByCategory(item.children, { workCategoryId, legacyDiscipline });
    const itemDiscipline = normalizeViewDiscipline(item.disciplineLabel);
    const matches = workCategoryId
      ? item.workCategoryId === workCategoryId
        || (!item.workCategoryId && legacyDiscipline && itemDiscipline === legacyDiscipline)
      : legacyDiscipline === "GENERAL" || itemDiscipline === legacyDiscipline;
    if (!matches && children.length === 0) return [];
    return [{ ...item, children }];
  });
}

function filterGroupsByCategory(groups, filter) {
  return (groups || []).flatMap((group) => {
    const bvItems = filterItemsByCategory(group.bvItems, filter);
    const children = filterGroupsByCategory(group.children, filter);
    if (bvItems.length === 0 && children.length === 0) return [];
    return [{ ...group, bvItems, children }];
  });
}

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
      row.link = it.nameEcommerceLink || (it.ecommerceLink ? "Buka Link" : "");
      row.linkUrl = safeHttpUrl(it.ecommerceLink);
      row.totalVol = it.totalVolume != null ? Number(it.totalVolume) : null;
      row.totalSat = it.paymentUnit || "";
    }

    if (!isHeader && !hasChildren && hasBreakdown) {
      r++;
      let lastKeterangan = null;
      let isFirstBreakdown = true;

      breakdownList.forEach((b) => {
        const ketText = (b.keterangan || "").trim();
        const showKet = ketText !== lastKeterangan;
        lastKeterangan = ketText;

        // Sheet BV CV menempatkan rincian pertama di baris item untuk item
        // utama. Child dengan keterangan memulai rincian di baris berikutnya.
        if (isFirstBreakdown && (!isChild || !ketText)) r--;
        isFirstBreakdown = false;

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

  function writeSubGroups(group, counter) {
    for (const sub of group.children || []) {
      const subRow = getRow(r);
      subRow.no = sub.reference || String(counter.n++);
      subRow.uraian = stripGroupPrefix(sub.name, sub.reference);
      subRow.subGroupHeader = true;
      r++;

      const subCounter = { n: 1 };
      for (const it of sub.bvItems || []) writeItem(it, subCounter);
      writeSubGroups(sub, subCounter);
    }
  }

  groups.forEach((group, idx) => {
    if (idx > 0) r++;
    const groupRow = getRow(r);
    const groupReference = ROMAN[idx] || String(idx + 1);
    groupRow.no = groupReference;
    groupRow.uraian = stripGroupPrefix(
      group.name,
      group.reference || groupReference,
    ).toUpperCase();
    groupRow.groupHeader = true;
    r++;

    const counter = { n: 1 };
    for (const it of group.bvItems || []) writeItem(it, counter);
    writeSubGroups(group, counter);
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
  const linkHtml = row.linkUrl
    ? `<a href="${escapeHtml(row.linkUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(row.link)}</a>`
    : escapeHtml(row.link);

  return `
    <tr class="${row.bold ? "bv-header-row" : ""}">
      <td class="center">${escapeHtml(row.no)}</td>
      <td class="left">${escapeHtml(row.uraian)}</td>
      <td class="center">${escapeHtml(row.sat)}</td>
      <td class="number ${vb}">${fmtNum(row.vol)}</td>
      <td class="left ${bd}">${escapeHtml(row.ket)}</td>
      <td class="number ${bd}">${fmtNum(row.panjang)}</td>
      <td class="number ${bd}">${fmtNum(row.lebar)}</td>
      <td class="number ${bd}">${fmtNum(row.tinggi)}</td>
      <td class="number ${bd}">${fmtNum(row.luas)}</td>
      <td class="number ${bd}">${fmtNum(row.keliling)}</td>
      <td class="number ${bd}">${fmtNum(row.dia)}</td>
      <td class="number ${bd}">${fmtNum(row.berat)}</td>
      <td class="number ${bd}">${fmtNum(row.sisi)}</td>
      <td class="number ${bd}">${fmtNum(row.bh)}</td>
      <td class="number ${bd}">${fmtNum(row.waste)}</td>
      <td class="number total ${vb}">${fmtNum(row.totalVol)}</td>
      <td class="center total ${vb}">${escapeHtml(row.totalSat)}</td>
      <td class="center link-cell">${linkHtml}</td>
    </tr>
  `;
}

function renderBvHtml(project, groups, categoryTitle) {
  const rows = buildRows(groups);
  const rowsHtml = rows.map(renderRowHtml).join("");
  const disciplineTitle = categoryTitle || "GENERAL";

  return `
<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Back Up Volume ${escapeHtml(disciplineTitle)} — ${escapeHtml(project.name)}</title>
<style>
  :root {
    --grid: #7f7f7f;
    --grid-soft: #b7b7b7;
    --header: #d0cece;
    --section: #d8d8d8;
    --ink: #111;
    --accent: #c00000;
  }
  * { box-sizing: border-box; }
  html { background: #e9edf2; }
  body {
    margin: 0;
    color: var(--ink);
    font-family: "Arial Narrow", Arial, sans-serif;
    font-size: 11px;
  }
  .toolbar {
    position: sticky;
    top: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 10px 18px;
    color: #fff;
    background: #20262e;
    box-shadow: 0 2px 8px rgba(0,0,0,.2);
  }
  .toolbar strong { font-size: 13px; }
  .toolbar button {
    border: 1px solid #fff;
    border-radius: 4px;
    padding: 7px 13px;
    color: #111;
    background: #fff;
    cursor: pointer;
    font: 600 12px Arial, sans-serif;
  }
  .sheet-shell { overflow: auto; padding: 20px; }
  .sheet {
    width: 1584px;
    min-height: 1120px;
    margin: 0 auto;
    padding: 26px 28px 36px;
    background: #fff;
    box-shadow: 0 3px 18px rgba(26,35,50,.16);
  }
  .document-title {
    width: 72%;
    margin: 0 0 10px auto;
    padding: 8px 12px;
    border: 1px solid var(--grid);
    background: var(--header);
    text-align: center;
    font-size: 15px;
    font-weight: 700;
    letter-spacing: .2px;
  }
  .document-head {
    display: grid;
    grid-template-columns: 330px 1fr;
    align-items: center;
    min-height: 108px;
    margin-bottom: 14px;
  }
  .brand {
    display: flex;
    align-items: center;
    padding-left: 28px;
  }
  .brand-logo {
    display: block;
    width: 210px;
    height: auto;
    object-fit: contain;
  }
  .project-info {
    border-collapse: collapse;
    font-size: 12px;
  }
  .project-info td { border: 0; padding: 3px 5px; vertical-align: top; }
  .project-info .label { width: 145px; }
  .project-info .colon { width: 18px; text-align: center; font-weight: 700; }
  table.bv {
    width: 100%;
    table-layout: fixed;
    border-collapse: collapse;
    border: 2px solid #222;
    font-size: 12px;
  }
  table.bv th,
  table.bv td {
    height: 23px;
    padding: 3px 4px;
    border-left: 1px solid var(--grid);
    border-right: 1px solid var(--grid);
    border-top: 1px dotted var(--grid-soft);
    border-bottom: 1px dotted var(--grid-soft);
    vertical-align: middle;
  }
  table.bv thead th {
    height: 28px;
    padding: 3px;
    border: 1px solid #222;
    background: var(--header);
    text-align: center;
    font-size: 12px;
    font-weight: 700;
    line-height: 1.15;
    overflow-wrap: anywhere;
  }
  table.bv thead tr:first-child th { border-top-width: 2px; }
  table.bv thead th:first-child,
  table.bv tbody td:first-child { border-left-width: 2px; border-left-color: #222; }
  table.bv thead th:last-child,
  table.bv tbody td:last-child { border-right-width: 2px; border-right-color: #222; }
  table.bv tbody tr:last-child td { border-bottom: 2px solid #222; }
  .left { text-align: left; }
  .center { text-align: center; }
  .number { text-align: right; font-variant-numeric: tabular-nums; }
  .group-row { background: var(--section); font-weight: 700; text-transform: uppercase; }
  .group-row td { border-top: 1px solid #777; border-bottom: 1px solid #777; }
  .subgroup-row { background: #f0f0f0; font-weight: 700; }
  .bv-header-row { font-weight: 700; }
  .bd { color: var(--accent); }
  .b, .total { font-weight: 700; }
  .link-cell { overflow-wrap: anywhere; }
  .link-cell a { color: #0563c1; text-decoration: underline; }
  .empty-note { padding: 24px; text-align: center; color: #666; }
  @page { size: A3 landscape; margin: 8mm; }
  @media print {
    html, body { background: #fff; }
    .toolbar { display: none; }
    .sheet-shell { overflow: visible; padding: 0; }
    .sheet { width: 100%; min-height: 0; margin: 0; padding: 0; box-shadow: none; }
    .document-title { margin-top: 0; }
    table.bv { font-size: 12px; }
    table.bv th, table.bv td { height: 21px; padding: 2px 3px; }
    table.bv thead th { font-size: 12px; }
    table.bv thead { display: table-header-group; }
    table.bv tr { break-inside: avoid; }
    .link-cell { font-size: 10px; }
  }
</style>
</head>
<body>
  <div class="toolbar">
    <strong>Preview BV ${escapeHtml(disciplineTitle)} — ${escapeHtml(project.name)}</strong>
    <button type="button" onclick="window.print()">Print / Simpan PDF</button>
  </div>

  <main class="sheet-shell">
    <section class="sheet">
      <div class="document-title">BACK UP VOLUME — ${escapeHtml(disciplineTitle)}</div>
      <div class="document-head">
        <div class="brand">
          <img class="brand-logo" src="${DIVES_LOGO_DATA_URI}" alt="IVES Interior Contractor">
        </div>
        <table class="project-info" aria-label="Informasi proyek">
          <tr><td class="label">Nama Kegiatan</td><td class="colon">:</td><td>${escapeHtml(activityName(project))}</td></tr>
          <tr><td class="label">Nama Pekerjaan</td><td class="colon">:</td><td>${escapeHtml(project?.name || "-")}</td></tr>
          <tr><td class="label">Lokasi Pekerjaan</td><td class="colon">:</td><td>${escapeHtml(project?.location || "-")}</td></tr>
          <tr><td class="label">Tahun Anggaran</td><td class="colon">:</td><td>${escapeHtml(project?.hspkPeriod ?? "-")}</td></tr>
        </table>
      </div>

      <table class="bv">
        <colgroup>
          <col style="width:40px"><col style="width:280px"><col style="width:48px"><col style="width:70px">
          <col style="width:220px"><col style="width:60px"><col style="width:60px"><col style="width:60px">
          <col style="width:65px"><col style="width:65px"><col style="width:65px"><col style="width:65px">
          <col style="width:55px"><col style="width:55px"><col style="width:55px"><col style="width:75px">
          <col style="width:45px"><col style="width:120px">
        </colgroup>
        <thead>
          <tr>
            <th>NO</th>
            <th>URAIAN PEKERJAAN</th>
            <th colspan="2">VOLUME</th>
            <th>KETERANGAN</th>
            <th>Panjang</th>
            <th>Lebar</th>
            <th>Tinggi</th>
            <th>Luas</th>
            <th>Keliling</th>
            <th>Dia</th>
            <th>Berat</th>
            <th colspan="2">Jumlah</th>
            <th>Waste</th>
            <th colspan="2">TOTAL</th>
            <th>LINK</th>
          </tr>
          <tr>
            <th></th><th></th><th></th><th></th><th></th>
            <th>(m)</th><th>(m)</th><th>(m)</th><th>(m2)</th><th>(m1)</th><th>(m2)</th><th>(Kg)</th>
            <th>(Sisi)</th><th>(Bh)</th><th>(%)</th><th>Vol.</th><th>Sat.</th><th>E-COMMERCE INFO</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml || `<tr><td colspan="18" class="empty-note">Belum ada data Back Up Volume.</td></tr>`}
        </tbody>
      </table>
    </section>
  </main>
</body>
</html>
  `;
}

// Prisma requires a finite relation depth. Three nested group levels cover the
// BV hierarchy used by the application while keeping a single query.
const groupIncludeLevel3 = {
  bvItems: {
    where: { parentBvItemId: null },
    include: bvItemInclude,
    orderBy: { createdAt: "asc" },
  },
};

const groupIncludeLevel2 = {
  ...groupIncludeLevel3,
  children: {
    include: groupIncludeLevel3,
    orderBy: { order: "asc" },
  },
};

const groupIncludeLevel1 = {
  ...groupIncludeLevel3,
  children: {
    include: groupIncludeLevel2,
    orderBy: { order: "asc" },
  },
};

router.get(
  "/projects/:projectId/bv-items/view",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "PROJECT_MANAGER", "PERENCANA"),
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const project = await prisma.project.findUnique({
        where: { id: projectId },
      });
      if (!project) return res.status(404).send("Project tidak ditemukan.");

      const groups = await prisma.rabGroup.findMany({
        where: { projectId, parentId: null },
        include: groupIncludeLevel1,
        orderBy: { order: "asc" },
      });

      const workCategoryId = String(req.query.workCategoryId || "").trim() || null;
      let categoryTitle = "GENERAL";
      let legacyDiscipline = "GENERAL";

      if (workCategoryId) {
        const projectCategory = await prisma.projectWorkCategory.findUnique({
          where: {
            projectId_workCategoryId: { projectId, workCategoryId },
          },
          include: { workCategory: true },
        });
        if (!projectCategory?.isActive || !projectCategory.workCategory?.isActive) {
          return res.status(400).send("Kategori View BV tidak aktif pada proyek ini.");
        }
        const category = projectCategory.workCategory;
        categoryTitle = category.name || category.code;
        const categoryCode = String(category.code || "").toUpperCase();
        legacyDiscipline = ["SIPIL", "CIVIL", "INTERIOR"].includes(categoryCode)
          ? normalizeViewDiscipline(categoryCode)
          : null;
      } else {
        const requestedDiscipline = String(req.query.discipline || "GENERAL")
          .trim()
          .toUpperCase();
        if (!["GENERAL", "INTERIOR", "SIPIL", "CIVIL"].includes(requestedDiscipline)) {
          return res.status(400).send("Kategori View BV tidak valid.");
        }
        legacyDiscipline = normalizeViewDiscipline(requestedDiscipline);
        categoryTitle = legacyDiscipline === "SIPIL" ? "CIVIL / SIPIL" : legacyDiscipline;
      }

      const filteredGroups = filterGroupsByCategory(groups, { workCategoryId, legacyDiscipline });
      const html = renderBvHtml(project, filteredGroups, categoryTitle);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'");
      res.send(html);
    } catch (err) {
      console.error("Error View BV:", err);
      res.status(500).send("Gagal menampilkan Back Up Volume: " + err.message);
    }
  },
);

module.exports = router;
