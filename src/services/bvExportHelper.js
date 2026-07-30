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

// include nested children BvItem (header -> sub-item -> breakdown)
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

async function buildBvSheet(ws, projectId, project) {
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

  // B=NO C=URAIAN D=VOL.Sat E=VOL.Vol F=KETERANGAN
  // G=Panjang H=Lebar I=Tinggi J=Luas K=Keliling L=Dia M=Berat
  // N=Sisi O=Bh P=Waste Q=TOTAL.Vol R=TOTAL.Sat S=LINK
  ws.columns = [
    { width: 5 },
    { width: 6 },
    { width: 32 },
    { width: 7 },
    { width: 8 },
    { width: 20 },
    { width: 9 },
    { width: 9 },
    { width: 9 },
    { width: 9 },
    { width: 9 },
    { width: 9 },
    { width: 9 },
    { width: 8 },
    { width: 8 },
    { width: 9 },
    { width: 10 },
    { width: 8 },
    { width: 18 },
  ];

  // ---- HEADER BLOK (logo B2:E8, judul+info mulai F) ----
  ws.mergeCells("B2:E8");

  ws.mergeCells("F2:R3");
  ws.getCell("F2").value = "BACK UP VOLUME";
  ws.getCell("F2").font = { bold: true, size: 15 };
  const cell = ws.getCell("F2");
  cell.alignment = {
    horizontal: "center",
    vertical: "middle",
  };
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFD9D9D9" },
  };
  cell.border = {
    bottom: { style: "medium" },
  };

  for (let row = 2; row <= 9; row++) {
    ws.getCell(`S ${row}`).border = {
      ...ws.getCell(`S${row}`).border,
      left: { style: "medium" },
    };
  }

  const info = [
    ["Nama Kegiatan", project?.name || "-"],
    ["Nama Pekerjaan", project?.client.name],
    ["Lokasi Pekerjaan", project.location],
    ["Tahun Anggaran", String(project.hspkPeriod)],
  ];

  let r = 5;
  for (const [label, value] of info) {
    ws.getCell(`F${r}`).value = label;
    ws.getCell(`F${r}`).font = { size: 12 };
    ws.getCell(`G${r}`).value = ":";
    ws.getCell(`G${r}`).alignment = { horizontal: "center" };
    ws.getCell(`G${r}`).font = { size: 12 };
    ws.mergeCells(`H${r}:R${r}`);
    ws.getCell(`H${r}`).value = value;
    ws.getCell(`H${r}`).font = { size: 12 };
    r++;
  }

  colRange("B", "S").forEach((col) => {
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
    ws.getCell(`S${row}`).border = {
      ...ws.getCell(`S${row}`).border,
      right: { style: "medium" },
    };
    ws.getCell(`F${row}`).border = {
      ...ws.getCell(`F${row}`).border,
      left: { style: "medium" },
    };
  }

  r = 11;

  // ---- HEADER TABEL ----
  const hr = r;
  ws.mergeCells(`B${hr}:B${hr + 1}`);
  ws.getCell(`B${hr}`).value = "NO";
  ws.mergeCells(`C${hr}:C${hr + 1}`);
  ws.getCell(`C${hr}`).value = "URAIAN PEKERJAAN";
  ws.mergeCells(`D${hr}:E${hr}`);
  ws.getCell(`D${hr}`).value = "VOLUME";
  ws.mergeCells(`F${hr}:F${hr}`);
  ws.getCell(`F${hr}`).value = "KETERANGAN";
  ws.mergeCells(`G${hr}:G${hr}`);
  ws.getCell(`G${hr}`).value = "Panjang";
  ws.mergeCells(`H${hr}:H${hr}`);
  ws.getCell(`H${hr}`).value = "Lebar";
  ws.mergeCells(`I${hr}:I${hr}`);
  ws.getCell(`I${hr}`).value = "Tinggi";
  ws.mergeCells(`J${hr}:J${hr}`);
  ws.getCell(`J${hr}`).value = "Luas";
  ws.mergeCells(`K${hr}:K${hr}`);
  ws.getCell(`K${hr}`).value = "Keliling";
  ws.mergeCells(`L${hr}:L${hr}`);
  ws.getCell(`L${hr}`).value = "Dia";
  ws.mergeCells(`M${hr}:M${hr}`);
  ws.getCell(`M${hr}`).value = "Berat";
  ws.mergeCells(`N${hr}:O${hr}`);
  ws.getCell(`N${hr}`).value = "Jumlah";
  ws.mergeCells(`P${hr}:P${hr}`);
  ws.getCell(`P${hr}`).value = "Waste";
  ws.mergeCells(`Q${hr}:R${hr}`);
  ws.getCell(`Q${hr}`).value = "TOTAL";
  ws.mergeCells(`S${hr}:S${hr + 1}`);
  ws.getCell(`S${hr}`).value = "LINK";

  ws.getCell(`D${hr + 1}`).value = "Sat.";
  ws.getCell(`E${hr + 1}`).value = "Vol.";
  ws.getCell(`G${hr + 1}`).value = "(m)";
  ws.getCell(`H${hr + 1}`).value = "(m)";
  ws.getCell(`I${hr + 1}`).value = "(m)";
  ws.getCell(`J${hr + 1}`).value = "(m2)";
  ws.getCell(`K${hr + 1}`).value = "(m1)";
  ws.getCell(`L${hr + 1}`).value = "(m2)";
  ws.getCell(`M${hr + 1}`).value = "(Kg)";
  ws.getCell(`N${hr + 1}`).value = "(Sisi)";
  ws.getCell(`O${hr + 1}`).value = "(Bh)";
  ws.getCell(`P${hr + 1}`).value = "(%)";
  ws.getCell(`Q${hr + 1}`).value = "Vol.";
  ws.getCell(`R${hr + 1}`).value = "Sat.";
  ws.getCell(`S${hr + 1}`).value = "E-COMMERCE INFO";

  const lastCol = ws.getCell("S11"); // atau tentukan manual, mis. 15

  for (let row = hr; row <= hr + 1; row++) {
    ws.getRow(row).eachCell({ includeEmpty: true }, (cell, col) => {
      if (col >= 2) {
        cell.font = { bold: true };
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
        cell.border = {
          top: { style: row === hr ? "medium" : "thin" },
          bottom: { style: row === hr + 1 ? "medium" : "thin" },
          left: { style: col === 2 ? "medium" : "thin" },
          right: { style: col === lastCol ? "medium" : "thin" },
        };
      }
    });
  }

  const S11 = ws.getCell("S11");
  S11.border = {
    bottom: { style: "medium" },
    left: { style: "medium" },
    right: { style: "medium" },
    top: { style: "medium" },
  };

  const B11 = ws.getCell("B11");
  B11.border = {
    bottom: { style: "medium" },
    left: { style: "medium" },
    right: { style: "medium" },
    top: { style: "medium" },
  };

  const B12 = ws.getCell("C11");
  B12.border = {
    bottom: { style: "medium" },
    left: { style: "medium" },
    right: { style: "medium" },
    top: { style: "medium" },
  };

  // for (let row = hr; row <= hr + 1; row++) {
  //   ws.getRow(row).eachCell({ includeEmpty: true }, (cell, col) => {
  //     if (col >= 2) {
  //       cell.font = { bold: true };
  //       cell.alignment = {
  //         horizontal: "center",
  //         vertical: "middle",
  //         wrapText: true,
  //       };
  //     }
  //   });
  // }

  // ws.getCell(`S${row}`).border = {
  //   ...ws.getCell(`S${row}`).border,
  //   right: { style: "medium" },
  // };
  // ws.getCell(`F${row}`).border = {
  //   ...ws.getCell(`F${row}`).border,
  //   left: { style: "medium" },
  // };

  r = hr + 2;

  // sourceText untuk kolom Keterangan header/sumber (HSPK reference), dipakai sekadar info tambahan di baris item (opsional)
  function writeItem(it, counterObj) {
    const isHeader = !!it.isHeaderOnly;
    const isChild = !!it.parentBvItemId;
    const no = isHeader ? counterObj.n++ : isChild ? "" : counterObj.n++;
    const namePrefix = isChild ? "- " : "";

    ws.getCell(`B${r}`).value = no;
    ws.getCell(`B${r}`).alignment = { horizontal: "center" };
    ws.getCell(`C${r}`).value = namePrefix + (it.name || "");
    if (isChild || !isHeader)
      ws.getRow(r).font = isHeader ? { bold: true } : ws.getRow(r).font;
    if (isHeader) ws.getRow(r).font = { bold: true };

    const hasChildren = (it.children || []).length > 0;
    const breakdownList = it.breakdowns || [];
    const hasBreakdown = breakdownList.length > 0;

    if (!isHeader && !hasChildren) {
      ws.getCell(`D${r}`).value = it.paymentUnit || "";
      ws.getCell(`D${r}`).alignment = { horizontal: "center" };
      ws.getCell(`E${r}`).value = Number(it.totalVolume);
      ws.getCell(`E${r}`).alignment = { horizontal: "center" };
      ws.getCell(`E${r}`).font = { bold: true };
      ws.getCell(`Q${r}`).value = Number(it.totalVolume);
      ws.getCell(`Q${r}`).alignment = { horizontal: "right" };
      ws.getCell(`Q${r}`).font = { bold: true };
      ws.getCell(`R${r}`).value = it.paymentUnit || "";
      ws.getCell(`R${r}`).alignment = { horizontal: "center" };
      ws.getCell(`S${r}`).value = it.ecommerceLink || "";
      ws.getCell(`S${r}`).alignment = { horizontal: "center" };
    }

    if (!isHeader && !hasChildren && hasBreakdown) {
      r++;

      let lastKeterangan = null;
      breakdownList.forEach((b) => {
        const ketText = (b.keterangan || "").trim();
        const showKet = ketText !== lastKeterangan;
        lastKeterangan = ketText;

        if (!isChild || !ketText) r--;

        ws.getCell(`F${r}`).value = showKet ? ketText : "";
        ws.getCell(`G${r}`).value = b.panjang != null ? Number(b.panjang) : "";
        ws.getCell(`H${r}`).value = b.lebar != null ? Number(b.lebar) : "";
        ws.getCell(`I${r}`).value = b.tinggi != null ? Number(b.tinggi) : "";
        ws.getCell(`J${r}`).value = b.luas != null ? Number(b.luas) : "";
        ws.getCell(`K${r}`).value =
          b.keliling != null ? Number(b.keliling) : "";
        ws.getCell(`L${r}`).value =
          b.diameter != null ? Number(b.diameter) : "";
        ws.getCell(`M${r}`).value = b.berat != null ? Number(b.berat) : "";
        ws.getCell(`N${r}`).value =
          b.jumlahSisi != null ? Number(b.jumlahSisi) : "";
        ws.getCell(`O${r}`).value =
          b.jumlahBh != null ? Number(b.jumlahBh) : "";
        ws.getCell(`P${r}`).value =
          b.waste != null && Number(b.waste) !== 0 ? Number(b.waste) : "";
        ws.getCell(`Q${r}`).value =
          b.subTotal != null ? Number(b.subTotal) : "";

        ws.getRow(r).eachCell({ includeEmpty: true }, (cell, col) => {
          if (col >= 7 && col <= 16) {
            cell.alignment = { horizontal: "right" };
            cell.font = { color: { argb: "FFFF0000" } };
          } else if (col == 6) {
            cell.alignment = { horizontal: "left" };
          }
        });

        r++;
      });
    } else {
      r++;
    }

    (it.children || []).forEach((child) => writeItem(child, counterObj));

    // baris kosong pemisah DIHAPUS — item langsung nempel
  }

  groups.forEach((group, idx) => {
    if (idx > 0) r++;
    ws.getCell(`B${r}`).value = ROMAN[idx] || String(idx + 1);
    colRange("B", "S").forEach((idx) => {
      const cells = ws.getCell(`${idx}${r}`);
      cells.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFD9D9D9" },
      };
    });

    ws.getCell(`C${r}`).value = group.name.toUpperCase();
    ws.getRow(r).font = { bold: true };
    r++;

    const counter = { n: 1 };
    for (const it of group.bvItems) writeItem(it, counter);

    for (const sub of group.children || []) {
      ws.getCell(`B${r}`).value = String(counter.n++);
      ws.getCell(`C${r}`).value = sub.name;
      ws.getRow(r).font = { bold: true };
      r++;
      const subCounter = { n: 1 };
      for (const it of sub.bvItems) writeItem(it, subCounter);
    }
  });

  for (let row = hr + 2; row < r; row++) {
    colRange("B", "S").forEach((col) => {
      ws.getCell(`${col}${row}`).border = {
        // Baris pertama tetap thin di atas, baris berikutnya mengikuti dotted sel di atasnya
        top: row === hr + 2 ? { style: "thin" } : { style: "dotted" },
        bottom: { style: "dotted" },
        left: { style: "thin" },
        right: { style: "thin" },
      };
    });

    // Kunci border kiri medium pada kolom B
    ws.getCell(`B${row}`).border = {
      ...ws.getCell(`B${row}`).border,
      left: { style: "medium" },
    };

    // Kunci border kanan medium pada kolom S
    ws.getCell(`S${row}`).border = {
      ...ws.getCell(`S${row}`).border,
      right: { style: "medium" },
    };
  }

  // Memberikan garis tebal (medium) penutup di bagian paling bawah tabel
  colRange("B", "S").forEach((col) => {
    const cell = ws.getCell(`${col}${r - 1}`);
    cell.border = {
      ...cell.border,
      bottom: { style: "medium" },
    };
  });

  ["C", "F"].forEach((col) => autoFitColumn(ws, col));
  ws.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (typeof cell.value === "number" && cell.col !== 2) {
        cell.numFmt = "#,##0.00";
      }
    });
  });
  ws.eachRow({ includeEmpty: true }, (row) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { ...cell.font, name: "Arial Narrow" };
    });
  });
}

module.exports = { buildBvSheet };
