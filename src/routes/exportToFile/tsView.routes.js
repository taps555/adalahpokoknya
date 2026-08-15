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

function fmt2(n) {
  if (n === null || n === undefined || n === "") return "";
  return Number(n).toLocaleString("id-ID", { maximumFractionDigits: 2 });
}
function fmtRp(n) {
  if (n === null || n === undefined || n === "") return "";
  return Number(n).toLocaleString("id-ID", { maximumFractionDigits: 0 });
}
function fmtPct(n) {
  if (n === null || n === undefined || n === "") return "";
  return Number(n).toLocaleString("id-ID", { maximumFractionDigits: 2 }) + "%";
}
function fmtDate(d) {
  if (!d) return "";
  const dt = new Date(d);
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const yy = dt.getFullYear();
  return `${dd}/${mm}/${yy}`;
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

const SUMMARY_ROW_STYLES = {
  "BOBOT RENCANA": "#ffe599",
  "AKUMULASI BOBOT RENCANA": "#9fc5e8",
  "BOBOT REALISASI": "#b6d7a8",
  "AKUMULASI BOBOT REALISASI": "#f9cb9c",
  DEVIASI: "#ffffff",
};

// mirrors buildTimeScheduleSheet's data prep: weight per item, weekly spread,
// weekly/cumulative totals
function computeScheduleData(groups) {
  const allItems = [];
  groups.forEach((g) => {
    allItems.push(...g.items);
    (g.children || []).forEach((sg) => allItems.push(...sg.items));
  });

  const totalContract = allItems.reduce(
    (sum, it) => sum + Number(it.rabTotalPrice),
    0,
  );

  const maxWeek = allItems.reduce((max, it) => {
    if (!it.timeSchedule) return max;
    return Math.max(max, it.timeSchedule.endWeek);
  }, 0);

  function weightOf(it) {
    return totalContract > 0
      ? (Number(it.rabTotalPrice) / totalContract) * 100
      : 0;
  }
  function weeklyWeightOf(it) {
    const weight = weightOf(it);
    const out = {};
    if (it.timeSchedule) {
      const { startWeek, endWeek } = it.timeSchedule;
      const span = endWeek - startWeek + 1;
      const perWeek = weight / span;
      for (let w = startWeek; w <= endWeek; w++) out[w] = perWeek;
    }
    return out;
  }

  const weeklyTotal = {};
  for (let w = 1; w <= maxWeek; w++) {
    weeklyTotal[w] = allItems.reduce(
      (sum, it) => sum + (weeklyWeightOf(it)[w] || 0),
      0,
    );
  }
  let cum = 0;
  const cumulativeTotal = {};
  for (let w = 1; w <= maxWeek; w++) {
    cum += weeklyTotal[w];
    cumulativeTotal[w] = cum;
  }

  return {
    maxWeek,
    totalContract,
    weightOf,
    weeklyWeightOf,
    weeklyTotal,
    cumulativeTotal,
  };
}

function renderItemRow(it, num, hasChildren, ctx) {
  const isChild = !!it.bvItem?.parentBvItemId;
  const weight = ctx.weightOf(it);
  const weekly = ctx.weeklyWeightOf(it);
  const name = (isChild ? "\u00a0\u00a0- " : "") + escapeHtml(it.name || "");

  let sat = "",
    vol = "",
    hargaSatuan = "",
    totalHarga = "",
    bobot = "";
  const weekCells = [];

  if (it.isByOwner) {
    sat = escapeHtml(it.paymentUnit || "");
    vol = fmt2(it.volume);
    hargaSatuan = "By Owner";
    totalHarga = "By Owner";
    for (let w = 1; w <= ctx.maxWeek; w++) weekCells.push("");
  } else if (hasChildren) {
    for (let w = 1; w <= ctx.maxWeek; w++) weekCells.push("");
  } else {
    sat = escapeHtml(it.paymentUnit || "");
    vol = fmt2(it.volume);
    hargaSatuan = fmtRp(it.rabUnitPrice);
    totalHarga = fmtRp(it.rabTotalPrice);
    bobot = fmtPct(weight);
    for (let w = 1; w <= ctx.maxWeek; w++) {
      weekCells.push(weekly[w] != null ? fmt2(weekly[w]) : "");
    }
  }

  const weekTds = weekCells.map((v) => `<td class="num">${v}</td>`).join("");

  return `
    <tr>
      <td>${num}</td>
      <td class="left">${name}</td>
      <td class="left"></td>
      <td class="num">${sat}</td>
      <td class="num">${vol}</td>
      <td class="num">${escapeHtml(hargaSatuan)}</td>
      <td class="num">${escapeHtml(totalHarga)}</td>
      <td class="num">${bobot}</td>
      ${weekTds}
    </tr>
  `;
}

function blankRow(maxWeek) {
  const cols = 8 + maxWeek;
  return `<tr class="spacer-row">${"<td></td>".repeat(cols)}</tr>`;
}

function subTotalRow(groupTotal, maxWeek) {
  const weekTds = "<td></td>".repeat(maxWeek);
  return `
    <tr class="subtotal-row">
      <td></td><td></td><td></td><td></td><td></td>
      <td class="left italic">Sub Total</td>
      <td class="num">${fmtRp(groupTotal)}</td>
      <td></td>
      ${weekTds}
    </tr>
  `;
}

function renderScheduleHtml(project, groups) {
  const ctx = computeScheduleData(groups);
  const { maxWeek, totalContract, weeklyTotal, cumulativeTotal } = ctx;

  const weekDates = [];
  for (let w = 1; w <= maxWeek; w++) {
    let start = null,
      end = null;
    if (project.startDate) {
      start = new Date(project.startDate);
      start.setDate(start.getDate() + (w - 1) * 7);
      end = new Date(start);
      end.setDate(end.getDate() + 6);
    }
    weekDates.push({ week: w, start, end });
  }

  const weekHeaderTh = weekDates
    .map(
      (wd) => `
      <th>
        <div><strong>M${wd.week}</strong></div>
        <div>${fmtDate(wd.start)}</div>
        <div>${fmtDate(wd.end)}</div>
      </th>
    `,
    )
    .join("");

  let bodyHtml = "";

  groups.forEach((group, idx) => {
    bodyHtml += `
      <tr class="group-row">
        <td>${ROMAN[idx] || idx + 1}</td>
        <td colspan="${7 + maxWeek}">${escapeHtml(group.name.toUpperCase())}</td>
      </tr>
    `;

    const allItemsInGroup = [
      ...group.items,
      ...(group.children || []).flatMap((sub) => sub.items),
    ];
    const parentIds = new Set(
      allItemsInGroup.map((it) => it.bvItem?.parentBvItemId).filter(Boolean),
    );

    let n = 1;
    let groupTotal = 0;

    for (let i = 0; i < group.items.length; i++) {
      const it = group.items[i];
      const isChild = !!it.bvItem?.parentBvItemId;
      const hasChildren = parentIds.has(it.bvItem?.id);
      bodyHtml += renderItemRow(it, isChild ? "" : n++, hasChildren, ctx);
      if (!hasChildren) groupTotal += Number(it.rabTotalPrice);

      const nextItem = group.items[i + 1];
      const nextIsChild = nextItem ? !!nextItem.bvItem?.parentBvItemId : false;
      if (isChild && !nextIsChild) bodyHtml += blankRow(maxWeek);
    }

    for (const sub of group.children || []) {
      bodyHtml += `
        <tr class="subgroup-row">
          <td></td>
          <td colspan="${7 + maxWeek}">${escapeHtml(sub.name)}</td>
        </tr>
      `;

      for (let i = 0; i < sub.items.length; i++) {
        const it = sub.items[i];
        const isChild = !!it.bvItem?.parentBvItemId;
        const hasChildren = parentIds.has(it.bvItem?.id);
        bodyHtml += renderItemRow(it, isChild ? "" : n++, hasChildren, ctx);
        if (!hasChildren) groupTotal += Number(it.rabTotalPrice);

        const nextItem = sub.items[i + 1];
        const nextIsChild = nextItem
          ? !!nextItem.bvItem?.parentBvItemId
          : false;
        if (isChild && !nextIsChild) bodyHtml += blankRow(maxWeek);
      }
    }

    bodyHtml += subTotalRow(groupTotal, maxWeek);
  });

  bodyHtml += `
    <tr class="grand-row">
      <td colspan="6">GRAND TOTAL</td>
      <td class="num">${fmtRp(totalContract)}</td>
      <td class="num">100.00%</td>
      ${"<td></td>".repeat(maxWeek)}
    </tr>
  `;

  const summaryRows = [
    ["BOBOT RENCANA", (w) => weeklyTotal[w]],
    ["AKUMULASI BOBOT RENCANA", (w) => cumulativeTotal[w]],
    ["BOBOT REALISASI", () => 0],
    ["AKUMULASI BOBOT REALISASI", () => 0],
    ["DEVIASI", (w) => 0 - cumulativeTotal[w]],
  ];
  summaryRows.forEach(([label, valueFn]) => {
    const color = SUMMARY_ROW_STYLES[label];
    const weekTds = weekDates
      .map(
        (wd) =>
          `<td class="num" style="background:${color}">${fmt2(valueFn(wd.week))}</td>`,
      )
      .join("");
    bodyHtml += `
      <tr>
        <td colspan="8" class="left" style="background:${color}; font-weight:bold;">${escapeHtml(label)}</td>
        ${weekTds}
      </tr>
    `;
  });

  return `
<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<title>Time Schedule — ${escapeHtml(project.name)}</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; margin: 30px; color: #1a2332; font-size: 12px; }
  .header { display: flex; border: 2px solid #1a2332; margin-bottom: 20px; }
  .header .logo { width: 200px; border-right: 2px solid #1a2332; display: flex; align-items: center; justify-content: center; font-weight: bold; }
  .header .info { flex: 1; padding: 10px 16px; }
  .header .timeline { flex: 1; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 15px; background: #d9d9d9; border-left: 2px solid #1a2332; }
  .header .info h1 { text-align: center; font-size: 15px; margin: 0 0 10px; text-transform: uppercase; }
  .header .info table td { padding: 2px 6px; font-size: 12px; }
  .scroll-wrap { overflow-x: auto; }
  table.ts { border-collapse: collapse; min-width: 100%; }
  table.ts th, table.ts td { border: 1px solid #999; padding: 4px 6px; font-size: 11px; white-space: nowrap; }
  table.ts th { background: #d9d9d9; text-align: center; }
  table.ts td.left { text-align: left; white-space: normal; }
  table.ts td.num { text-align: right; font-family: monospace; }
  table.ts td.italic { font-style: italic; }
  .group-row { background: #d9d9d9; font-weight: bold; }
  .subgroup-row { font-weight: 600; background: #f0f0f0; }
  .spacer-row td { border: none; height: 6px; }
  .subtotal-row { font-weight: bold; }
  .grand-row { background: #ffcccc; font-weight: bold; text-align: center; }
  @media print {
    body { margin: 10px; }
    button { display: none; }
  }
</style>
</head>
<body>

<button onclick="window.print()" style="margin-bottom:12px; padding:8px 14px;">🖨 Print / Save as PDF</button>

<div class="header">
  <div class="logo"><img src="/image.png" alt="IVES Interior Contractor" style="max-width:180px; max-height:120px;"></div>
  <div class="info">
    <h1>Project Time Schedule</h1>
    <table>
      <tr><td>Nama Kegiatan</td><td>:</td><td>${escapeHtml(project?.name || "-")}</td></tr>
      <tr><td>Nama Pekerjaan</td><td>:</td><td>${escapeHtml(project?.client?.name || "-")}</td></tr>
      <tr><td>Lokasi Pekerjaan</td><td>:</td><td>${escapeHtml(project?.location || "-")}</td></tr>
      <tr><td>Tahun Anggaran</td><td>:</td><td>${escapeHtml(String(project?.hspkPeriod || "-"))}</td></tr>
    </table>
  </div>
  <div class="timeline">TIME LINE</div>
</div>

<div class="scroll-wrap">
<table class="ts">
  <thead>
    <tr>
      <th>NO</th>
      <th>ITEM PEKERJAAN</th>
      <th>SPESIFIKASI RINGKAS</th>
      <th>SAT.</th>
      <th>VOL.</th>
      <th>HARGA SATUAN</th>
      <th>TOTAL HARGA</th>
      <th>BOBOT<br>(%)</th>
      ${weekHeaderTh}
    </tr>
  </thead>
  <tbody>
    ${bodyHtml}
  </tbody>
</table>
</div>

</body>
</html>
  `;
}

router.get("/projects/:projectId/time-schedule/view", async (req, res) => {
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
        items: {
          orderBy: { order: "asc" },
          include: {
            timeSchedule: true,
            bvItem: { select: { id: true, parentBvItemId: true } },
          },
        },
        children: {
          include: {
            items: {
              orderBy: { order: "asc" },
              include: {
                timeSchedule: true,
                bvItem: { select: { id: true, parentBvItemId: true } },
              },
            },
          },
        },
      },
      orderBy: { order: "asc" },
    });

    const html = renderScheduleHtml(project, groups);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err) {
    console.error("Error View Time Schedule:", err);
    res.status(500).send("Gagal menampilkan Time Schedule: " + err.message);
  }
});

module.exports = router;
