"use strict";

const ROMAN = ["I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII","XIII","XIV","XV"];
const ITEM_COLORS = ["FFFFE6E6", "FFE6F3FF", "FFE6FFE6", "FFFFF2E6", "FFF2E6FF", "FFE6FFFF", "FFFFF9E6", "FFFFE6F9"];

function fmt2(cell) { cell.numFmt = "#,##0.00"; }
function fmtRp(cell) { cell.numFmt = "#,##0"; }
function fmtPct(cell) { cell.numFmt = "0.00\\%"; }

function colLetter(n) {
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
const weekCol = (w) => colLetter(9 + w);

function colRange(startCol, endCol) {
  const cols = [];
  let c = startCol.charCodeAt(0);
  const end = endCol.charCodeAt(0);
  while (c <= end) {
    cols.push(String.fromCharCode(c));
    c++;
  }
  return cols;
}

function autoFitColumn(ws, colLetter, minWidth = 1, maxWidth = 60) {
  const col = ws.getColumn(colLetter);
  let maxLen = minWidth;
  col.eachCell({ includeEmpty: false }, (cell) => {
    const len = String(cell.value ?? "").length;
    if (len > maxLen) maxLen = len;
  });
  col.width = Math.min(maxLen + 2, maxWidth);
}

function fillSolid(cell, argb) {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
}

const medium = { style: "medium" };
const thin = { style: "thin" };

function filterGroupsByDiscipline(groups, disc) {
  if (disc === 'GENERAL') return groups;
  return groups.map(g => {
    const items = g.items.filter(i => (i.discipline || 'GENERAL') === 'GENERAL' || i.discipline === disc);
    const children = (g.children || []).map(c => {
      const cItems = c.items.filter(i => (i.discipline || 'GENERAL') === 'GENERAL' || i.discipline === disc);
      if (cItems.length === 0) return null;
      return { ...c, items: cItems };
    }).filter(Boolean);

    if (items.length === 0 && children.length === 0) return null;
    return { ...g, items, children };
  }).filter(Boolean);
}

function drawTable(ws, title, groups, project, periods, startRow, themeColor = "FFD9D9D9") {
  const allItems = [];
  groups.forEach((g) => {
    allItems.push(...g.items);
    (g.children || []).forEach((sg) => allItems.push(...sg.items));
  });

  const totalContract = allItems.reduce((sum, it) => {
    const isParent = allItems.some(child => child.bvItem?.parentBvItemId === it.bvItem?.id);
    return isParent ? sum : sum + Number(it.rabTotalPrice || 0);
  }, 0);

  function weightOf(it) {
    return totalContract > 0 ? (Number(it.rabTotalPrice) / totalContract) * 100 : 0;
  }
  
  function periodWeightOf(it) {
    const weight = weightOf(it);
    const out = {};
    const hasChildren = allItems.some(child => child.bvItem?.parentBvItemId === it.bvItem?.id);
    if (it.timeSchedule && !hasChildren && weight > 0) {
      const iStart = new Date(it.timeSchedule.startDate).setHours(0,0,0,0);
      const iEnd = new Date(it.timeSchedule.endDate).setHours(23,59,59,999);
      
      const activePeriods = [];
      periods.forEach(p => {
        const pStart = p.start.getTime();
        const pEnd = p.end.getTime();
        if (Math.max(iStart, pStart) <= Math.min(iEnd, pEnd)) {
          activePeriods.push(p.index);
        }
      });
      
      if (activePeriods.length > 0) {
        const perWeek = weight / activePeriods.length;
        activePeriods.forEach(idx => out[idx] = perWeek);
      }
    }
    return out;
  }

  const periodTotal = {};
  periods.forEach(p => {
    periodTotal[p.index] = allItems.reduce((sum, it) => sum + (periodWeightOf(it)[p.index] || 0), 0);
  });
  
  let cum = 0;
  const cumulativeTotal = {};
  periods.forEach(p => {
    cum += periodTotal[p.index];
    cumulativeTotal[p.index] = cum;
  });

  const lastPeriodCol = weekCol(periods.length || 1);

  // ---- HEADER PROJECT INFO ----
  ws.mergeCells(`B${startRow}:C${startRow + 7}`);
  ws.getCell(`B${startRow}`).value = "logo";
  ws.getCell(`B${startRow}`).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  ws.getCell(`B${startRow}`).font = { bold: true };
  ws.getCell(`B${startRow}`).border = { top: medium, bottom: medium, left: medium, right: medium };

  ws.mergeCells(`D${startRow}:I${startRow + 1}`);
  ws.getCell(`D${startRow}`).value = title;
  ws.getCell(`D${startRow}`).font = { bold: true, size: 15 };
  ws.getCell(`D${startRow}`).alignment = { horizontal: "center", vertical: "middle" };
  fillSolid(ws.getCell(`D${startRow}`), themeColor);
  ws.getCell(`D${startRow + 1}`).border = { top: medium, bottom: medium, left: medium, right: medium };

  ws.mergeCells(`J${startRow}:${lastPeriodCol}${startRow + 1}`);
  ws.getCell(`J${startRow}`).value = "TIME LINE";
  ws.getCell(`J${startRow}`).font = { bold: true, size: 15 };
  ws.getCell(`J${startRow}`).alignment = { horizontal: "center", vertical: "middle" };
  fillSolid(ws.getCell(`J${startRow}`), themeColor);
  ws.getCell(`${lastPeriodCol}${startRow + 1}`).border = { top: medium, bottom: medium, left: medium, right: medium };

  const info = [
    ["Nama Kegiatan", project?.name || "-"],
    ["Nama Pekerjaan", project?.client?.name || "-"],
    ["Lokasi Pekerjaan", project?.location || "-"],
    ["Tahun Anggaran", String(project?.hspkPeriod || "-")],
  ];
  let r = startRow + 3;
  for (const [label, value] of info) {
    ws.getCell(`D${r}`).value = label;
    ws.getCell(`E${r}`).value = ":";
    ws.getCell(`E${r}`).alignment = { horizontal: "center" };
    ws.mergeCells(`F${r}:I${r}`);
    ws.getCell(`F${r}`).value = value;
    r++;
  }

  colRange("B", lastPeriodCol).forEach((col) => {
    ws.getCell(`${col}${startRow + 7}`).border = { ...ws.getCell(`${col}${startRow + 7}`).border, bottom: medium };
  });
  for (let row = startRow; row <= startRow + 7; row++) {
    ws.getCell(`B${row}`).border = { ...ws.getCell(`B${row}`).border, left: medium };
    ws.getCell(`${lastPeriodCol}${row}`).border = { ...ws.getCell(`${lastPeriodCol}${row}`).border, right: medium };
  }
  for (let row = startRow + 1; row <= startRow + 7; row++) {
    ws.getCell(`I${row}`).border = { ...ws.getCell(`I${row}`).border, right: medium };
  }

  // ---- HEADER TABEL ----
  r = startRow + 9;
  const hr = r;
  const mainCols = [
    ["B", "NO"], ["C", "ITEM PEKERJAAN"], ["D", "SPESIFIKASI RINGKAS"], ["E", "SAT."],
    ["F", "VOL."], ["G", "HARGA SATUAN"], ["H", "TOTAL HARGA"], ["I", "BOBOT\n(%)"]
  ];
  mainCols.forEach(([col, label]) => {
    ws.mergeCells(`${col}${hr}:${col}${hr + 2}`);
    ws.getCell(`${col}${hr}`).value = label;
  });

  periods.forEach((p) => {
    const col = weekCol(p.index);
    ws.getCell(`${col}${hr}`).value = `M${p.index}`;
    ws.getCell(`${col}${hr + 1}`).value = p.start;
    ws.getCell(`${col}${hr + 1}`).numFmt = "dd/mm/yyyy";
    ws.getCell(`${col}${hr + 2}`).value = p.end;
    ws.getCell(`${col}${hr + 2}`).numFmt = "dd/mm/yyyy";
  });

  for (let row = hr; row <= hr + 2; row++) {
    ws.getRow(row).height = 20;
    ws.getRow(row).eachCell({ includeEmpty: true }, (cell, col) => {
      if (col >= 2) {
        cell.font = cell.font?.bold ? cell.font : { bold: true };
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        fillSolid(cell, themeColor);
        cell.border = { top: row === hr ? medium : thin, bottom: row === hr + 2 ? medium : thin, left: col === 2 ? medium : thin, right: thin };
      }
    });
  }

  r = hr + 3;
  let colorIndex = 0;

  const writeItem = (it, num, hasChildren) => {
    const isChild = !!it.bvItem?.parentBvItemId;
    const weight = weightOf(it);
    const pWeight = periodWeightOf(it);

    ws.getCell(`B${r}`).value = num;
    ws.getCell(`B${r}`).alignment = { horizontal: "center" };
    ws.getCell(`C${r}`).value = (isChild ? "- " : "") + (it.name || "");

    if (it.isByOwner) {
      ws.getCell(`E${r}`).value = it.paymentUnit || "";
      ws.getCell(`E${r}`).alignment = { horizontal: "center" };
      ws.getCell(`F${r}`).value = Number(it.volume);
      fmt2(ws.getCell(`F${r}`));
      ["G", "H"].forEach((col) => {
        ws.getCell(`${col}${r}`).value = "By Owner";
        ws.getCell(`${col}${r}`).alignment = { horizontal: "center" };
      });
    } else if (hasChildren) {
      // Empty cells
    } else {
      ws.getCell(`E${r}`).value = it.paymentUnit || "";
      ws.getCell(`E${r}`).alignment = { horizontal: "center" };
      ws.getCell(`F${r}`).value = Number(it.volume);
      fmt2(ws.getCell(`F${r}`));
      ws.getCell(`G${r}`).value = Number(it.rabUnitPrice);
      fmtRp(ws.getCell(`G${r}`));
      ws.getCell(`H${r}`).value = Number(it.rabTotalPrice);
      fmtRp(ws.getCell(`H${r}`));
      ws.getCell(`I${r}`).value = weight;
      fmtPct(ws.getCell(`I${r}`));

      periods.forEach((p) => {
        if (pWeight[p.index] != null) {
          const cell = ws.getCell(`${weekCol(p.index)}${r}`);
          cell.value = pWeight[p.index];
          fmt2(cell);
          fillSolid(cell, ITEM_COLORS[colorIndex % ITEM_COLORS.length]);
        }
      });
    }
    
    if (!hasChildren) colorIndex++;
    r++;
  };

  groups.forEach((group, idx) => {
    ws.getCell(`B${r}`).value = ROMAN[idx] || String(idx + 1);
    colRange("B", lastPeriodCol).forEach((col) => fillSolid(ws.getCell(`${col}${r}`), themeColor));
    ws.getCell(`C${r}`).value = group.name.toUpperCase();
    ws.getRow(r).font = { bold: true };
    r++;

    const allItemsInGroup = [...group.items, ...(group.children || []).flatMap((sub) => sub.items)];
    const parentIds = new Set(allItemsInGroup.map((it) => it.bvItem?.parentBvItemId).filter(Boolean));

    let n = 1;
    let groupTotal = 0;

    for (let i = 0; i < group.items.length; i++) {
      const it = group.items[i];
      const isChild = !!it.bvItem?.parentBvItemId;
      const hasChildren = parentIds.has(it.bvItem?.id);
      writeItem(it, isChild ? "" : n++, hasChildren);
      if (!hasChildren) groupTotal += Number(it.rabTotalPrice);
      const nextItem = group.items[i + 1];
      if (isChild && (!nextItem || !nextItem.bvItem?.parentBvItemId)) r++; 
    }

    for (const sub of group.children || []) {
      ws.getCell(`B${r}`).value = "";
      ws.getCell(`C${r}`).value = sub.name;
      ws.getRow(r).font = { bold: true };
      r++;
      for (let i = 0; i < sub.items.length; i++) {
        const it = sub.items[i];
        const isChild = !!it.bvItem?.parentBvItemId;
        const hasChildren = parentIds.has(it.bvItem?.id);
        writeItem(it, isChild ? "" : n++, hasChildren);
        if (!hasChildren) groupTotal += Number(it.rabTotalPrice);
        const nextItem = sub.items[i + 1];
        if (isChild && (!nextItem || !nextItem.bvItem?.parentBvItemId)) r++; 
      }
    }
    r++;
    ws.getCell(`G${r}`).value = "Sub Total";
    ws.getCell(`G${r}`).font = { italic: true };
    ws.getCell(`H${r}`).value = groupTotal;
    fmtRp(ws.getCell(`H${r}`));
    ws.getRow(r).font = { ...ws.getRow(r).font, bold: true };
    r++;
  });

  const lastItemRow = r;

  ws.getCell(`C${r}`).value = "GRAND TOTAL";
  ws.mergeCells(`C${r}:G${r}`);
  colRange("C", lastPeriodCol).forEach((col) => fillSolid(ws.getCell(`${col}${r}`), "FFFFCCCC"));
  ws.getCell(`H${r}`).value = totalContract;
  fmtRp(ws.getCell(`H${r}`));
  
  // Hardcoded 100 on Grand Total
  ws.getCell(`I${r}`).value = 100;
  fmtPct(ws.getCell(`I${r}`));
  
  ws.getRow(r).font = { bold: true };
  r++;

  const summaryRows = [
    ["BOBOT RENCANA", (p) => periodTotal[p.index], "FFFFE599"],
    ["AKUMULASI BOBOT RENCANA", (p) => cumulativeTotal[p.index], "FF9FC5E8"],
    ["BOBOT REALISASI", () => 0, "FFB6D7A8"],
    ["AKUMULASI BOBOT REALISASI", () => 0, "FFF9CB9C"],
    ["DEVIASI", (p) => 0 - cumulativeTotal[p.index], "FFFFFFFF"],
  ];

  summaryRows.forEach(([label, valueFn, argb]) => {
    ws.getCell(`C${r}`).value = label;
    ws.getRow(r).font = { bold: true };
    ["C", "D", "E", "F", "G", "H", "I"].forEach((col) => fillSolid(ws.getCell(`${col}${r}`), argb));
    ws.mergeCells(`C${r}:I${r}`);
    periods.forEach((p) => {
      const cell = ws.getCell(`${weekCol(p.index)}${r}`);
      cell.value = valueFn(p);
      fmt2(cell);
      fillSolid(cell, argb);
    });
    r++;
  });

  for (let row = hr + 3; row < lastItemRow; row++) {
    colRange("B", lastPeriodCol).forEach((col) => {
      ws.getCell(`${col}${row}`).border = { bottom: { style: "dotted" }, left: { style: "thin" }, right: { style: "thin" } };
    });
    ws.getCell(`B${row}`).border = { ...ws.getCell(`B${row}`).border, left: { style: "medium" } };
    ws.getCell(`I${row}`).border = { ...ws.getCell(`I${row}`).border, right: { style: "medium" } };
    ws.getCell(`${lastPeriodCol}${row}`).border = { ...ws.getCell(`${lastPeriodCol}${row}`).border, right: { style: "medium" } };
  }

  for (let row = lastItemRow; row < r; row++) {
    colRange("B", lastPeriodCol).forEach((col) => {
      ws.getCell(`${col}${row}`).border = {
        top: { style: "medium" }, bottom: { style: "medium" },
        left: col === "B" ? { style: "medium" } : { style: "thin" },
        right: col === "I" || col === lastPeriodCol ? { style: "medium" } : { style: "thin" },
      };
    });
  }

  colRange("B", lastPeriodCol).forEach((col) => {
    ws.getCell(`${col}${hr}`).border = { ...ws.getCell(`${col}${hr}`).border, top: { style: "medium" } };
  });

  return r; // return next available row
}

async function buildTimeScheduleSheet(ws, projectId, project, prisma, viewMode = 'week') {
  const allGroupsRaw = await prisma.rabGroup.findMany({
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

  // Calculate global periods across all items
  const allItems = [];
  allGroupsRaw.forEach(g => {
    allItems.push(...g.items);
    (g.children || []).forEach(sg => allItems.push(...sg.items));
  });

  let minDate = project.startDate ? new Date(project.startDate) : null;
  let maxDate = minDate ? new Date(minDate) : null;
  allItems.forEach(it => {
    if (it.timeSchedule) {
       const s = new Date(it.timeSchedule.startDate);
       const e = new Date(it.timeSchedule.endDate);
       if (!minDate || s < minDate) minDate = new Date(s);
       if (!maxDate || e > maxDate) maxDate = new Date(e);
    }
  });

  if (!minDate) {
    minDate = new Date();
    minDate.setHours(0,0,0,0);
  }
  if (!maxDate) {
    maxDate = new Date(minDate);
    maxDate.setDate(maxDate.getDate() + 30);
  }
  minDate.setHours(0,0,0,0);
  maxDate.setHours(23,59,59,999);

  const periods = [];
  let curr = new Date(minDate);
  let i = 1;
  while (curr <= maxDate) {
    const start = new Date(curr);
    start.setHours(0,0,0,0);
    const end = new Date(curr);
    end.setDate(end.getDate() + 6);
    end.setHours(23,59,59,999);
    periods.push({ index: i, label: `M${i}`, start, end });
    curr.setDate(curr.getDate() + 7);
    i++;
  }

  // Draw Tables
  let nextRow = 2;

  // 1. GENERAL
  const generalGroups = filterGroupsByDiscipline(allGroupsRaw, 'GENERAL');
  if (generalGroups.length > 0) {
    nextRow = drawTable(ws, "PROJECT TIME SCHEDULE - GENERAL", generalGroups, project, periods, nextRow, "FFD9D9D9");
    nextRow += 5; // Spacing 4 blank rows
  }

  // 2. SIPIL
  const sipilGroups = filterGroupsByDiscipline(allGroupsRaw, 'SIPIL');
  if (sipilGroups.length > 0) {
    nextRow = drawTable(ws, "PROJECT TIME SCHEDULE - SIPIL", sipilGroups, project, periods, nextRow, "FFCCE5FF"); // Light Blue
    nextRow += 5;
  }

  // 3. INTERIOR
  const interiorGroups = filterGroupsByDiscipline(allGroupsRaw, 'INTERIOR');
  if (interiorGroups.length > 0) {
    nextRow = drawTable(ws, "PROJECT TIME SCHEDULE - INTERIOR", interiorGroups, project, periods, nextRow, "FFFFE5CC"); // Light Orange
  }

  // Set Columns Width
  ws.columns = [
    { width: 5 }, { width: 6 }, { width: 32 }, { width: 20 }, { width: 7 },
    { width: 8 }, { width: 13 }, { width: 13 }, { width: 9 },
    ...Array(periods.length || 1).fill({ width: 13 }),
  ];

  ["C", "D"].forEach((col) => autoFitColumn(ws, col));
  ws.eachRow({ includeEmpty: true }, (row) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { ...cell.font, name: "Arial Narrow" };
    });
  });
}

module.exports = { buildTimeScheduleSheet };
