"use strict";

const fs = require("fs");
const path = require("path");
const prisma = require("../lib/prisma");
const { buildWorkCategoryItemWhere } = require("./bvCalculationService");

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

function fmt(cell) {
  cell.numFmt = "#,##0;(#,##0);-";
}

function fmtVol(cell) {
  cell.numFmt = "#,##0.00;(#,##0.00);-";
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

function normalizeRabExportMode(mode) {
  const value = String(mode || "COMBINED").trim().toUpperCase();
  if (["RAP", "COSTING"].includes(value)) return "RAP";
  if (["RAB", "SELLING"].includes(value)) return "RAB";
  if (["COMBINED", "BOTH", "GABUNGAN", "RAP_RAB"].includes(value)) return "COMBINED";
  return null;
}

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

function cloneCell(source, target) {
  target.value = source.value;
  target.style = JSON.parse(JSON.stringify(source.style || {}));
  target.numFmt = source.numFmt;
}

function safeUnmerge(ws, range) {
  try {
    ws.unMergeCells(range);
  } catch (_) {
    // The range may not be merged by an older workbook path.
  }
}

function addDivesLogo(ws) {
  const logoPath = path.resolve(__dirname, "../../public/assets/dives.png");
  if (!fs.existsSync(logoPath)) return;
  const imageId = ws.workbook.addImage({ filename: logoPath, extension: "png" });
  ws.addImage(imageId, {
    tl: { col: 1.15, row: 2.15 },
    ext: { width: 145, height: 70 },
  });
}

function finalizeRabSheet(ws, mode, categoryTitle = "") {
  // Clear legacy merges before shifting rows; ExcelJS otherwise retains stale merge ranges.
  Object.keys(ws._merges || {}).forEach((range) => safeUnmerge(ws, range));
  // The reference BQ workbook starts its visual block on row 3.
  ws.insertRow(2, []);
  ["B2:C9", "B3:C10", "D2:J3", "D3:J4"].forEach((range) => safeUnmerge(ws, range));

  const combinedTitleRange = "D3:J4";
  const singleTitleRange = "D3:H4";

  // Legacy helper uses K only to paint an outside border; remove the empty column.
  ws.spliceColumns(11, 1);

  if (mode !== "COMBINED") {
    if (mode === "RAB") {
      for (let row = 11; row <= ws.rowCount; row++) {
        cloneCell(ws.getCell(`I${row}`), ws.getCell(`G${row}`));
        cloneCell(ws.getCell(`J${row}`), ws.getCell(`H${row}`));
      }
    }
    ws.spliceColumns(9, 2);
  }

  // Rebuild only the canonical BQ merges after all row/column shifts.
  ws.mergeCells(mode === "COMBINED" ? combinedTitleRange : singleTitleRange);
  ws.mergeCells("C11:C12");
  ws.mergeCells("G11:H11");
  if (mode === "COMBINED") ws.mergeCells("I11:J11");

  ws.getCell("D3").value = "RENCANA ANGGARAN BIAYA";
  ws.getCell("G11").value = mode === "COMBINED" ? "RAP" : mode;
  if (mode === "COMBINED") ws.getCell("I11").value = "RAB";

  // Match the canonical BQ dimensions. Interior uses the narrower item column.
  const isInterior = String(categoryTitle).trim().toUpperCase() === "INTERIOR";
  const widths = {
    A: 2.5703125,
    B: 5.5703125,
    C: isInterior ? 50.5703125 : 55.5703125,
    D: 13,
    E: 8.5703125,
    F: 13,
    G: 15.5703125,
    H: 13,
    I: 13,
    J: 13,
  };
  Object.entries(widths).forEach(([column, width]) => {
    if (mode === "COMBINED" || column < "I") ws.getColumn(column).width = width;
  });
  ws.properties.defaultRowHeight = 15;

  ws.eachRow({ includeEmpty: true }, (row) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { ...cell.font, name: "Arial", size: cell.font?.size || 10 };
    });
    if (row.values.some((value) => String(value || "").startsWith("GRAND TOTAL"))) {
      row.height = 30;
    }
  });

  const titleCell = ws.getCell("D3");
  titleCell.font = { ...titleCell.font, name: "Arial Narrow", size: 15, bold: true };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  titleCell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFD0CECE" },
  };

  addDivesLogo(ws);
  const lastCol = mode === "COMBINED" ? "J" : "H";
  ws.pageSetup = {
    orientation: "landscape",
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    printArea: `B3:${lastCol}${ws.rowCount}`,
    printTitlesRow: "11:12",
    margins: {
      left: 0.4330708661,
      right: 0.1968503937,
      top: 0.7480314961,
      bottom: 0.7480314961,
      header: 0,
      footer: 0,
    },
  };
  ws.views = [{ state: "frozen", ySplit: 12 }];
  ws.headerFooter.oddHeader = "";
  ws.headerFooter.oddFooter = "";
}

function flattenRabItems(group) {
  const items = [...(group.items || [])];
  for (const child of group.children || []) {
    items.push(...flattenRabItems(child));
  }
  return items;
}

function buildRabParentItemIds(group) {
  const items = flattenRabItems(group);
  const rabItemIds = new Set(items.map((item) => item.id).filter(Boolean));
  const rabItemIdByBvItemId = new Map(
    items
      .filter((item) => item.id && item.bvItem?.id)
      .map((item) => [item.bvItem.id, item.id]),
  );
  const parentIds = new Set();

  for (const item of items) {
    if (item.parentId && rabItemIds.has(item.parentId)) {
      parentIds.add(item.parentId);
    }
    const parentIdFromBv = rabItemIdByBvItemId.get(item.bvItem?.parentBvItemId);
    if (parentIdFromBv) parentIds.add(parentIdFromBv);
  }

  return parentIds;
}

function sumRabLeafTotals(group, parentIds = buildRabParentItemIds(group)) {
  let rap = 0;
  let rab = 0;

  for (const item of flattenRabItems(group)) {
    if (item.isHeaderOnly || parentIds.has(item.id)) continue;
    rap += Number(item.rapTotalPrice);
    rab += Number(item.rabTotalPrice);
  }

  return { rap, rab };
}

async function buildRabSheet(
  ws,
  projectId,
  project,
  categoryFilter = null,
  options = {},
) {
  const mode = normalizeRabExportMode(options.mode || "COMBINED") || "COMBINED";
  const itemWhere = typeof categoryFilter === "string"
    ? buildWorkCategoryItemWhere({ categoryCode: categoryFilter })
    : buildWorkCategoryItemWhere(categoryFilter || {});

  const rawGroups = await prisma.rabGroup.findMany({
    where: { projectId, parentId: null },
    include: {
      items: {
        where: itemWhere,
        include: { bvItem: { select: { id: true, parentBvItemId: true } } },
        orderBy: { order: "asc" },
      },
      children: {
        include: {
          items: {
            where: itemWhere,
            include: { bvItem: { select: { id: true, parentBvItemId: true } } },
            orderBy: { order: "asc" },
          },
        },
      },
    },
    orderBy: { order: "asc" },
  });

  const groups = rawGroups.map(g => {
    // Filter out sub-groups that have no items
    const children = g.children ? g.children.filter(c => c.items && c.items.length > 0) : [];
    return { ...g, children };
  }).filter(g => {
    // Keep group if it has items directly or has children with items
    return (g.items && g.items.length > 0) || (g.children && g.children.length > 0);
  });

  ws.columns = [
    { width: 5 },
    { width: 6 },
    { width: 40 },
    { width: 25 },
    { width: 8 },
    { width: 8 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
  ];

  // ---- HEADER BLOK (logo B2:C8, judul+info mulai D) ----
  ws.mergeCells("B2:C9");

  ws.mergeCells("D2:J3");
  ws.getCell("D2").value = "RENCANA ANGGARAN BIAYA";
  ws.getCell("D2").font = { bold: true, size: 15 };
  ws.getCell("D2").alignment = { horizontal: "center", vertical: "middle" };
  ws.getCell("D2").border = {
    top: { style: "medium" },
    bottom: { style: "medium" },
    left: { style: "medium" },
    right: { style: "medium" },
  };
  ws.getCell("D2").fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFD9D9D9" },
  };

  const info = [
    ["Nama Kegiatan", project.activityName || project.name || "-"],
    ["Nama Pekerjaan", project.name || "-"],
    ["Lokasi Pekerjaan", project.location || "-"],
    ["Tahun Anggaran", String(project.hspkPeriod || "-")],
  ];

  let r = 5;
  for (const [label, value] of info) {
    ws.getCell(`D${r}`).value = label;
    ws.getCell(`E${r}`).value = ":";
    ws.getCell(`E${r}`).alignment = { horizontal: "center" };
    ws.mergeCells(`F${r}:J${r}`);
    ws.getCell(`F${r}`).value = value;
    r++;
  }

  colRange("B", "J").forEach((col) => {
    ws.getCell(`${col}2`).border = {
      ...ws.getCell(`${col}2`).border,
      top: { style: "medium" },
    };
    ws.getCell(`${col}9`).border = {
      ...ws.getCell(`${col}9`).border,
      bottom: { style: "medium" },
    };
  });
  for (let row = 2; row <= 9; row++) {
    ws.getCell(`B${row}`).border = {
      ...ws.getCell(`B${row}`).border,
      left: { style: "medium" },
    };
    ws.getCell(`J${row}`).border = {
      ...ws.getCell(`J${row}`).border,
      right: { style: "medium" },
    };
    ws.getCell(`D${row}`).border = {
      ...ws.getCell(`D${row}`).border,
      left: { style: "medium" },
    };
  }

  r = 10;

  // ---- HEADER TABEL ----
  const hr = r;
  ws.mergeCells(`B${hr}:B${hr + 1}`);
  ws.getCell(`B${hr}`).value = "NO";
  ws.mergeCells(`C${hr}:C${hr + 1}`);
  ws.getCell(`C${hr}`).value = "ITEM PEKERJAAN";
  ws.mergeCells(`D${hr}:D${hr + 1}`);
  ws.getCell(`D${hr}`).value = "SPESIFIKASI RINGKAS";
  ws.mergeCells(`E${hr}:E${hr + 1}`);
  ws.getCell(`E${hr}`).value = "SAT.";
  ws.mergeCells(`F${hr}:F${hr + 1}`);
  ws.getCell(`F${hr}`).value = "VOL.";
  ws.mergeCells(`G${hr}:H${hr}`);
  ws.getCell(`G${hr}`).value = "RAP";
  ws.mergeCells(`I${hr}:J${hr}`);
  ws.getCell(`I${hr}`).value = "RAB";
  ws.getCell(`G${hr + 1}`).value = "HARGA SATUAN";
  ws.getCell(`H${hr + 1}`).value = "TOTAL HARGA";
  ws.getCell(`I${hr + 1}`).value = "HARGA SATUAN";
  ws.getCell(`J${hr + 1}`).value = "TOTAL HARGA";

  const lastCol = ws.getCell("J10");

  for (let row = hr; row <= hr + 1; row++) {
    ws.getRow(row).eachCell({ includeEmpty: true }, (cell, col) => {
      if (col >= 2) {
        cell.font = { bold: true };
        cell.alignment = {
          horizontal: "center",
          vertical: "middle",
          wrapText: false,
        };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFD9D9D9" },
        };
        cell.border = {
          bottom: { style: row === hr + 1 ? "medium" : "thin" },
          left: { style: col === 2 ? "medium" : "thin" },
          right: { style: col === lastCol ? "medium" : "thin" },
        };
      }
    });
  }

  ["G", "H"].forEach((col) => {
    ws.getCell(`${col}${hr}`).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFFFC0CB" },
    };
    ws.getCell(`${col}${hr + 1}`).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFFFC0CB" },
    };
  });

  ws.getCell(`F${hr}`).border = {
    right: { style: "medium" },
    bottom: { style: "medium" },
  };
  ws.getCell(`I${hr}`).border = {
    right: { style: "medium" },
    left: { style: "medium" },
    bottom: { style: "thin" },
  };
  ws.getCell(`I${hr + 1}`).border = {
    left: { style: "medium" },
    bottom: { style: "medium" },
  };
  ws.getCell(`J${hr + 1}`).border = {
    right: { style: "medium" },
    left: { style: "thin" },
    bottom: { style: "medium" },
  };

  r = hr + 2;
  let grandRap = 0,
    grandRab = 0;

  function writeItem(item, num, hasChildren) {
    const isChild = !!item.bvItem?.parentBvItemId;
    ws.getCell(`B${r}`).value = num;
    ws.getCell(`B${r}`).alignment = { horizontal: "center" };
    ws.getCell(`C${r}`).value = (isChild ? "- " : "") + item.name;

    if (item.isByOwner) {
      colRange("B", "J").forEach((col) => {
        ws.getCell(`${col}${r}`).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFFFE985" },
        };
      });
      ["G", "H", "I", "J"].forEach((col) => {
        ws.getCell(`${col}${r}`).value = "By Owner";
        ws.getCell(`${col}${r}`).alignment = { horizontal: "center" };
      });
      ws.getCell(`E${r}`).value = item.paymentUnit;
      ws.getCell(`F${r}`).value = Number(item.volume);
      fmtVol(ws.getCell(`F${r}`));
    } else if (hasChildren) {
      ["E", "F", "G", "H", "I", "J"].forEach((col) => {
        ws.getCell(`${col}${r}`).value = "";
        ws.getCell(`${col}${r}`).font = { bold: false };
        ws.getCell(`${col}${r}`).alignment = { horizontal: "center" };
      });
    } else {
      ws.getCell(`E${r}`).value = item.paymentUnit;
      ws.getCell(`F${r}`).value = Number(item.volume);
      fmtVol(ws.getCell(`F${r}`));
      ws.getCell(`G${r}`).value = Number(item.rapUnitPrice);
      ws.getCell(`H${r}`).value = Number(item.rapTotalPrice);
      ws.getCell(`I${r}`).value = Number(item.rabUnitPrice);
      ws.getCell(`J${r}`).value = Number(item.rabTotalPrice);
      ["G", "H", "I", "J"].forEach((c) => fmt(ws.getCell(`${c}${r}`)));
    }
    r++;
  }

  groups.forEach((group, idx) => {
    ws.getCell(`B${r}`).value = ROMAN[idx] || String(idx + 1);
    ws.getCell(`C${r}`).value = group.name.toUpperCase();
    ws.getRow(r).font = { bold: true };
    r++;

    // Gunakan relasi RabItem.parentId dan fallback relasi BV untuk mengenali parent.
    const parentIds = buildRabParentItemIds(group);

    let n = 1;
    for (let i = 0; i < group.items.length; i++) {
      const item = group.items[i];
      const isChild = !!item.bvItem?.parentBvItemId;
      const hasChildren = item.isHeaderOnly || parentIds.has(item.id);
      writeItem(item, isChild ? "" : String(n++), hasChildren);

      const nextItem = group.items[i + 1];
      const nextIsChild = nextItem ? !!nextItem.bvItem?.parentBvItemId : false;
      if (isChild && !nextIsChild) r++;
    }

    for (const sub of group.children || []) {
      ws.getCell(`B${r}`).value = String(n++);
      ws.getCell(`C${r}`).value = sub.name;
      ws.getRow(r).font = { bold: true };
      r++;

      for (let i = 0; i < sub.items.length; i++) {
        const item = sub.items[i];
        const isChild = !!item.bvItem?.parentBvItemId;
        const hasChildren = item.isHeaderOnly || parentIds.has(item.id);
        writeItem(item, isChild ? "" : String(n++), hasChildren);

        const nextItem = sub.items[i + 1];
        const nextIsChild = nextItem
          ? !!nextItem.bvItem?.parentBvItemId
          : false;
        if (isChild && !nextIsChild) r++;
      }
    }

    r++;

    //SUB TOTAL (leaf-only; header/parent tidak dihitung dua kali)
    const { rap, rab } = sumRabLeafTotals(group, parentIds);
    grandRap += rap;
    grandRab += rab;

    ws.getCell(`G${r}`).value = "Sub Total";
    ws.getCell(`G${r}`).font = { italic: true, bold: true };
    ws.getCell(`H${r}`).value = rap;
    fmt(ws.getCell(`H${r}`));
    ws.getCell(`H${r}`).font = { bold: true };
    ws.getCell(`I${r}`).value = "Sub Total";
    ws.getCell(`I${r}`).font = { italic: true, bold: true };
    ws.getCell(`J${r}`).value = rab;
    fmt(ws.getCell(`J${r}`));
    ws.getCell(`J${r}`).font = { bold: true };
    ["B", "C", "D", "E", "F", "G", "H", "I", "J"].forEach((col) => {
      ws.getCell(`${col}${r}`).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFD9D9D9" },
      };
    });
    r++;
  });
  for (let row = hr + 2; row <= r; row++) {
    ["B", "C", "D", "E", "F", "G", "H", "I", "J"].forEach((col) => {
      ws.getCell(`${col}${row}`).border = {
        // BQ memakai grid tabel tipis yang konsisten pada seluruh baris isi.
        top: { style: "thin" },
        bottom: { style: "thin" },
        left: { style: "thin" },
        right: { style: "thin" },
      };
    });

    // Kunci garis samping tebal (medium) agar tidak berubah jadi thin/dotted
    ws.getCell(`B${row}`).border = {
      ...ws.getCell(`B${row}`).border,
      left: { style: "medium" },
    };
    ws.getCell(`J${row}`).border = {
      ...ws.getCell(`J${row}`).border,
      right: { style: "medium" },
    };
    ws.getCell(`G${row}`).border = {
      ...ws.getCell(`G${row}`).border,
      left: { style: "medium" },
    };
    ws.getCell(`H${row}`).border = {
      ...ws.getCell(`H${row}`).border,
      right: { style: "medium" },
    };
  }

  ["C", "G", "H", "I", "J"].forEach((col) => autoFitColumn(ws, col));

  ws.getCell(`G${r}`).value = "GRAND TOTAL RAP";
  ws.getCell(`G${r}`).font = { bold: true };
  ws.getCell(`H${r}`).value = grandRap;
  fmt(ws.getCell(`H${r}`));
  ws.getCell(`H${r}`).font = { bold: true };
  ws.getCell(`I${r}`).value = "GRAND TOTAL RAB";
  ws.getCell(`I${r}`).font = { bold: true };
  ws.getCell(`J${r}`).value = grandRab;
  fmt(ws.getCell(`J${r}`));
  ws.getCell(`J${r}`).font = { bold: true };
  ["B", "C", "D", "E", "F", "G", "H", "I", "J"].forEach((col) => {
    ws.getCell(`${col}${r}`).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFFFC0CB" },
    };
    ws.getCell(`${col}${r}`).border = {
      top: { style: "medium" },
      bottom: { style: "medium" },
      left: { style: "thin" },
      right: { style: "thin" },
    };
  });
  ws.getCell(`A${r}`).border = { right: { style: "medium" } };
  ws.getCell(`K${r}`).border = { left: { style: "medium" } };

  const medium = { style: "medium" };
  const thin = { style: "thin" };

  ws.getCell(`G${r}`).border = {
    top: medium,
    bottom: medium,
    left: medium,
    right: thin,
  };
  ws.getCell(`H${r}`).border = {
    top: medium,
    bottom: medium,
    left: thin,
    right: medium,
  };
  ["G", "H"].forEach((col) => {
    ws.getCell(`${col}${r}`).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFCC66" },
    };
  });
  finalizeRabSheet(ws, mode, options.categoryTitle);
  return { mode, grandRap, grandRab, groupCount: groups.length };
}

module.exports = {
  buildRabSheet,
  normalizeRabExportMode,
  buildRabParentItemIds,
  sumRabLeafTotals,
};
