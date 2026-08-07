"use strict";

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

function fmt2(cell) {
  cell.numFmt = "#,##0.00";
}
function fmtRp(cell) {
  cell.numFmt = "#,##0";
}
function fmtPct(cell) {
  cell.numFmt = "0.00\\%";
}

function colLetter(n) {
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
// kolom minggu ke-w (w=1,2,3,...) mulai dari J (kolom ke-10)
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

function fmtDate(d) {
  if (!d) return "";
  const dt = new Date(d);
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const yy = dt.getFullYear();
  return `${dd}/${mm}/${yy}`;
}

function fillSolid(cell, argb) {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
}

const medium = { style: "medium" };
const thin = { style: "thin" };

async function buildTimeScheduleSheet(ws, projectId, project, prisma) {
  const groups = await prisma.rabGroup.findMany({
    where: { projectId, parentId: null },
    include: {
      items: {
        orderBy: { order: "asc" },
        include: {
          timeSchedule: true,
          bvItem: { select: { id: true, parentBvItemId: true } }, // TAMBAH
        },
      },
      children: {
        include: {
          items: {
            orderBy: { order: "asc" },
            include: {
              timeSchedule: true,
              bvItem: { select: { id: true, parentBvItemId: true } }, // TAMBAH
            },
          },
        },
      },
    },
    orderBy: { order: "asc" },
  });

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

  const lastWeekCol = weekCol(maxWeek || 1);

  // ---- KOLOM ----
  ws.columns = [
    { width: 5 }, // A
    { width: 6 }, // B NO
    { width: 32 }, // C ITEM PEKERJAAN
    { width: 20 }, // D SPESIFIKASI RINGKAS
    { width: 7 }, // E SAT.
    { width: 8 }, // F VOL.
    { width: 13 }, // G HARGA SATUAN
    { width: 13 }, // H TOTAL HARGA
    { width: 9 }, // I BOBOT (%)
    ...Array(maxWeek || 1).fill({ width: 9 }), // J.. minggu
  ];

  // ---- HEADER PROJECT INFO (baris 2-9) ----
  ws.mergeCells("B2:C9");
  ws.getCell("B2").value = "logo";
  ws.getCell("B2").alignment = {
    horizontal: "center",
    vertical: "middle",
    wrapText: true,
  };
  ws.getCell("B2").font = { bold: true };
  ws.getCell("B2").border = {
    top: medium,
    bottom: medium,
    left: medium,
    right: medium,
  };

  ws.mergeCells("D2:I3");
  ws.getCell("D2").value = "PROJECT TIME SCHEDULE";
  ws.getCell("D2").font = { bold: true, size: 15 };
  ws.getCell("D2").alignment = { horizontal: "center", vertical: "middle" };
  fillSolid(ws.getCell("D2"), "FFD9D9D9");
  ws.getCell("D3").border = {
    top: medium,
    bottom: medium,
    left: medium,
    right: medium,
  };

  ws.mergeCells(`J2:${lastWeekCol}3`);
  ws.getCell("J2").value = "TIME LINE";
  ws.getCell("J2").font = { bold: true, size: 15 };
  ws.getCell("J2").alignment = { horizontal: "center", vertical: "middle" };
  fillSolid(ws.getCell("J2"), "FFD9D9D9");
  ws.getCell(`${lastWeekCol}3`).border = {
    top: medium,
    bottom: medium,
    left: medium,
    right: medium,
  };

  const info = [
    ["Nama Kegiatan", project?.name || "-"],
    ["Nama Pekerjaan", project?.client?.name || "-"],
    ["Lokasi Pekerjaan", project?.location || "-"],
    ["Tahun Anggaran", String(project?.hspkPeriod || "-")],
  ];
  let r = 5;
  for (const [label, value] of info) {
    ws.getCell(`D${r}`).value = label;
    ws.getCell(`E${r}`).value = ":";
    ws.getCell(`E${r}`).alignment = { horizontal: "center" };
    ws.mergeCells(`F${r}:I${r}`);
    ws.getCell(`F${r}`).value = value;
    r++;
  }

  colRange("B", lastWeekCol).forEach((col) => {
    ws.getCell(`${col}9`).border = {
      ...ws.getCell(`${col}9`).border,
      bottom: medium,
    };
  });
  for (let row = 2; row <= 9; row++) {
    ws.getCell(`B${row}`).border = {
      ...ws.getCell(`B${row}`).border,
      left: medium,
    };
    ws.getCell(`${lastWeekCol}${row}`).border = {
      ...ws.getCell(`${lastWeekCol}${row}`).border,
      right: medium,
    };
  }
  for (let row = 3; row <= 9; row++) {
    ws.getCell(`I${row}`).border = {
      ...ws.getCell(`I${row}`).border,
      right: medium,
    };
  }

  // ---- HEADER TABEL (baris 11-12) ----
  r = 11;
  const hr = r;
  const mainCols = [
    ["B", "NO"],
    ["C", "ITEM PEKERJAAN"],
    ["D", "SPESIFIKASI RINGKAS"],
    ["E", "SAT."],
    ["F", "VOL."],
    ["G", "HARGA SATUAN"],
    ["H", "TOTAL HARGA"],
    ["I", "BOBOT\n(%)"],
  ];
  mainCols.forEach(([col, label]) => {
    ws.mergeCells(`${col}${hr}:${col}${hr + 1}`);
    ws.getCell(`${col}${hr}`).value = label;
  });

  for (let w = 1; w <= maxWeek; w++) {
    const col = weekCol(w);
    const wd = weekDates.find((x) => x.week === w);

    // 1. SET LEBAR KOLOM DI SINI
    // Ubah angka 12 sesuai selera (default Excel biasanya 8.43, angka 11-13 sangat ideal untuk format tanggal)
    ws.getColumn(col).width = 12;

    ws.getCell(`${col}${hr}`).value = {
      richText: [
        { font: { bold: true }, text: `M${w}\n` },
        { text: `${fmtDate(wd?.start)}\n${fmtDate(wd?.end)}` },
      ],
    };
    ws.mergeCells(`${col}${hr}:${col}${hr + 1}`);
  }

  ws.getRow(hr).height = 42;
  for (let row = hr; row <= hr + 1; row++) {
    ws.getRow(row).eachCell({ includeEmpty: true }, (cell, col) => {
      if (col >= 2) {
        cell.font = cell.font?.bold ? cell.font : { bold: true };
        cell.alignment = {
          horizontal: "center",
          vertical: "middle",
          wrapText: true,
        };
        fillSolid(cell, "FFD9D9D9");
        cell.border = {
          top: row === hr ? medium : thin,
          bottom: medium,
          left: col === 2 ? medium : thin,
          right: thin,
        };
      }
    });
  }

  r = hr + 2;

  // ---- ITEM ROWS ----
  // ---- ITEM ROWS ----
  function writeItem(it, num, hasChildren) {
    const isChild = !!it.bvItem?.parentBvItemId;
    const weight = weightOf(it);
    const weekly = weeklyWeightOf(it);

    // 1. Tulis Nomor & Nama Item
    ws.getCell(`B${r}`).value = num;
    ws.getCell(`B${r}`).alignment = { horizontal: "center" };
    ws.getCell(`C${r}`).value = (isChild ? "- " : "") + (it.name || "");

    // 2. Kondisi "By Owner"
    if (it.isByOwner) {
      // A. Beri background warna kuning untuk baris "By Owner"
      const lastWeekCol = weekCol(maxWeek);
      // colRange("B", lastWeekCol).forEach((col) => {
      //   ws.getCell(`${col}${r}`).fill = {
      //     type: "pattern",
      //     pattern: "solid",
      //     fgColor: { argb: "FFFFE985" },
      //   };
      // });

      // B. Isi Unit & Volume
      ws.getCell(`E${r}`).value = it.paymentUnit || "";
      ws.getCell(`E${r}`).alignment = { horizontal: "center" };
      ws.getCell(`F${r}`).value = Number(it.volume);
      fmt2(ws.getCell(`F${r}`));

      // C. Set teks "By Owner" pada kolom G, H, I
      ["G", "H"].forEach((col) => {
        const cell = ws.getCell(`${col}${r}`);
        cell.value = "By Owner";
        cell.alignment = { horizontal: "center" };
      });

      // D. Set teks "By Owner" pada seluruh kolom mingguan
      // ["G", "H", "I"].forEach((col) => {
      //   const cell = ws.getCell(`${col(w)}${r}`);
      //   cell.value = "By Owner";
      //   cell.alignment = { horizontal: "center" };
      // });

      // 3. Kondisi Parent (Memiliki Anak)
    } else if (hasChildren) {
      ["E", "F", "G", "H", "I"].forEach((col) => {
        ws.getCell(`${col}${r}`).value = "";
      });

      for (let w = 1; w <= maxWeek; w++) {
        ws.getCell(`${weekCol(w)}${r}`).value = "";
      }

      // 4. Kondisi Item Normal (Child / Leaf)
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

      for (let w = 1; w <= maxWeek; w++) {
        if (weekly[w] != null) {
          const cell = ws.getCell(`${weekCol(w)}${r}`);
          cell.value = weekly[w];
          fmt2(cell);
        }
      }
    }

    r++;
  }

  groups.forEach((group, idx) => {
    ws.getCell(`B${r}`).value = ROMAN[idx] || String(idx + 1);
    colRange("B", lastWeekCol).forEach((col) =>
      fillSolid(ws.getCell(`${col}${r}`), "FFD9D9D9"),
    );
    ws.getCell(`C${r}`).value = group.name.toUpperCase();
    ws.getRow(r).font = { bold: true };
    r++;

    // kumpulkan parentIds (item yang punya anak) di group ini
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
      writeItem(it, isChild ? "" : n++, hasChildren);
      if (!hasChildren) groupTotal += Number(it.rabTotalPrice);

      const nextItem = group.items[i + 1];
      const nextIsChild = nextItem ? !!nextItem.bvItem?.parentBvItemId : false;
      if (isChild && !nextIsChild) r++; // lompat 1 baris setelah rentetan child
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
        const nextIsChild = nextItem
          ? !!nextItem.bvItem?.parentBvItemId
          : false;
        if (isChild && !nextIsChild) r++;
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

  // ---- GRAND TOTAL ----
  // 1. Catat baris akhir untuk data item (sebelum Grand Total dibuat)
  const lastItemRow = r;

  // ---- GRAND TOTAL ----
  ws.getCell(`C${r}`).value = "GRAND TOTAL";
  ws.mergeCells(`C${r}:G${r}`);
  colRange("C", lastWeekCol).forEach((col) =>
    fillSolid(ws.getCell(`${col}${r}`), "FFFFCCCC"),
  );

  // Mengisi nilai total contract di kolom H
  ws.getCell(`H${r}`).value = totalContract;
  fmtRp(ws.getCell(`H${r}`));

  // Menyimpan baris total saat ini
  const total = r;

  // Mengisi rumus persentase di kolom I (hasilnya pasti 100)
  ws.getCell(`I${r}`).value = {
    formula: `H${total}/$H$${total}*100`, // Contoh output di Excel: =H126/$H$126*100
  };
  fmtPct(ws.getCell(`I${r}`));
  ws.getRow(r).font = { bold: true };
  r++;

  // ---- SUMMARY ROWS (BOBOT, AKUMULASI, DEVIASI) ----
  const summaryRows = [
    ["BOBOT RENCANA", (w) => weeklyTotal[w], "FFFFE599"],
    ["AKUMULASI BOBOT RENCANA", (w) => cumulativeTotal[w], "FF9FC5E8"],
    ["BOBOT REALISASI", () => 0, "FFB6D7A8"],
    ["AKUMULASI BOBOT REALISASI", () => 0, "FFF9CB9C"],
    ["DEVIASI", (w) => 0 - cumulativeTotal[w], "FFFFFFFF"],
  ];

  summaryRows.forEach(([label, valueFn, argb]) => {
    ws.getCell(`C${r}`).value = label;
    ws.getRow(r).font = { bold: true };

    ["C", "D", "E", "F", "G", "H", "I"].forEach((col) =>
      fillSolid(ws.getCell(`${col}${r}`), argb),
    );
    ws.mergeCells(`C${r}:I${r}`);

    for (let w = 1; w <= maxWeek; w++) {
      const cell = ws.getCell(`${weekCol(w)}${r}`);
      cell.value = valueFn(w);
      fmt2(cell);
      fillSolid(cell, argb);
    }
    r++;
  });

  // ==========================================
  // ---- 1. BORDER UNTUK DATA ITEM (BARIS hr+2 SAMPAI lastItemRow) ----
  // ==========================================
  for (let row = hr + 2; row < lastItemRow; row++) {
    colRange("B", lastWeekCol).forEach((col) => {
      ws.getCell(`${col}${row}`).border = {
        bottom: { style: "dotted" },
        left: { style: "thin" },
        right: { style: "thin" },
      };
    });

    // Border samping medium untuk tabel data item
    ws.getCell(`B${row}`).border = {
      ...ws.getCell(`B${row}`).border,
      left: { style: "medium" },
    };
    ws.getCell(`I${row}`).border = {
      ...ws.getCell(`I${row}`).border,
      right: { style: "medium" },
    };
    ws.getCell(`${lastWeekCol}${row}`).border = {
      ...ws.getCell(`${lastWeekCol}${row}`).border,
      right: { style: "medium" },
    };
  }

  // ==========================================
  // ---- 2. BORDER MEDIUM KHUSUS GRAND TOTAL & SUMMARY ----
  // ==========================================
  for (let row = lastItemRow; row < r; row++) {
    colRange("B", lastWeekCol).forEach((col) => {
      ws.getCell(`${col}${row}`).border = {
        top: { style: "medium" },
        bottom: { style: "medium" },
        left: col === "B" ? { style: "medium" } : { style: "thin" },
        right:
          col === "I" || col === lastWeekCol
            ? { style: "medium" }
            : { style: "thin" },
      };
    });
  }

  ws.getRow(hr).height = 42;

  for (let row = hr; row <= hr + 1; row++) {
    colRange("B", lastWeekCol).forEach((col) => {
      const cell = ws.getCell(`${col}${row}`);

      // Style Font, Alignment, dan Fill Background
      cell.font = cell.font?.bold ? cell.font : { bold: true };
      cell.alignment = {
        horizontal: "center",
        vertical: "middle",
        wrapText: true,
      };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFD9D9D9" },
      };

      // Border: Bingkai Luar Medium, Dalam Thin
      cell.border = {
        top: row === hr ? { style: "medium" } : { style: "thin" },
        bottom: row === hr + 1 ? { style: "medium" } : { style: "thin" },
        left: col === "B" ? { style: "medium" } : { style: "thin" },
        right:
          col === "I" || col === lastWeekCol
            ? { style: "medium" }
            : { style: "thin" },
      };
    });
  }

  // Paksa kunci lagi khusus garis paling atas baris 11 agar tidak kalah dengan baris 10
  colRange("B", lastWeekCol).forEach((col) => {
    ws.getCell(`${col}${hr}`).border = {
      ...ws.getCell(`${col}${hr}`).border,
      top: { style: "medium" },
    };
  });

  ["C", "D"].forEach((col) => autoFitColumn(ws, col));
  ws.eachRow({ includeEmpty: true }, (row) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { ...cell.font, name: "Arial Narrow" };
    });
  });
}

module.exports = { buildTimeScheduleSheet };
