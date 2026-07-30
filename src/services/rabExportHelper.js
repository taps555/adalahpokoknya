"use strict";

const prisma = require("../lib/prisma");

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
  cell.numFmt = "#,##0";
}

function fmtVol(cell) {
  cell.numFmt = "#,##0.00";
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

async function buildRabSheet(ws, projectId, project) {
  const groups = await prisma.rabGroup.findMany({
    where: { projectId, parentId: null },
    include: {
      items: {
        include: { bvItem: { select: { id: true, parentBvItemId: true } } },
        orderBy: { order: "asc" },
      },
      children: {
        include: {
          items: {
            include: { bvItem: { select: { id: true, parentBvItemId: true } } },
            orderBy: { order: "asc" },
          },
        },
      },
    },
    orderBy: { order: "asc" },
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
    ["Nama Kegiatan", project.name || "-"],
    ["Nama Pekerjaan", project?.client.name],
    ["Lokasi Pekerjaan", project.location],
    ["Tahun Anggaran", String(project.hspkPeriod)],
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

  groups.forEach((group, idx) => {
    ws.getCell(`B${r}`).value = ROMAN[idx] || String(idx + 1);
    ws.getCell(`C${r}`).value = group.name.toUpperCase();
    ws.getRow(r).font = { bold: true };
    r++;

    // kumpulkan semua bvItem.id yang jadi parent (punya anak) di group ini
    const allItemsInGroup = [
      ...group.items,
      ...(group.children || []).flatMap((sub) => sub.items),
    ];
    const parentIds = new Set(
      allItemsInGroup.map((it) => it.bvItem?.parentBvItemId).filter(Boolean),
    );

    let n = 1;
    for (let i = 0; i < group.items.length; i++) {
      const item = group.items[i];
      const isChild = !!item.bvItem?.parentBvItemId;
      const hasChildren = parentIds.has(item.bvItem?.id);
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
        const hasChildren = parentIds.has(item.bvItem?.id);
        writeItem(item, isChild ? "" : String(n++), hasChildren);

        const nextItem = sub.items[i + 1];
        const nextIsChild = nextItem
          ? !!nextItem.bvItem?.parentBvItemId
          : false;
        if (isChild && !nextIsChild) r++;
      }
    }

    r++;

    //SUB TOTAL
    const { rap, rab } = sumRecursive(group);
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
        // Baris pertama tetap thin di atas, baris berikutnya mengikuti dotted dari bottom sel di atasnya
        top: row === hr + 2 ? { style: "thin" } : { style: "dotted" },
        bottom: { style: "dotted" },
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
  ws.eachRow({ includeEmpty: true }, (row) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { ...cell.font, name: "Arial Narrow" };
    });
  });
}

module.exports = { buildRabSheet };
