// "use strict";

// const prisma = require("../lib/prisma");

// const ROMAN = [
//   "I",
//   "II",
//   "III",
//   "IV",
//   "V",
//   "VI",
//   "VII",
//   "VIII",
//   "IX",
//   "X",
//   "XI",
//   "XII",
//   "XIII",
//   "XIV",
//   "XV",
// ];

// function fmt(cell) {
//   cell.numFmt = "#,##0";
// }

// function autoFitColumn(ws, colLetter, minWidth = 1, maxWidth = 60) {
//   const col = ws.getColumn(colLetter);
//   let maxLen = minWidth;
//   col.eachCell({ includeEmpty: false }, (cell) => {
//     const len = String(cell.value ?? "").length;
//     if (len > maxLen) maxLen = len;
//   });
//   col.width = Math.min(maxLen + 2, maxWidth);
// }

// // ============================================================
// // HEADER BLOK (logo + info project) — dipakai bareng oleh BV & RAB
// // ============================================================
// function buildHeaderBlock(ws, project, title, lastCol) {
//   ws.mergeCells(`B2:E8`); // area logo

//   ws.mergeCells(`F2:${lastCol}3`); // <- geser dari D ke F
//   ws.getCell("F2").value = title; // <- geser dari D2 ke F2
//   ws.getCell("F2").font = { bold: true, size: 14 };
//   ws.getCell("F2").alignment = { horizontal: "center", vertical: "middle" };

//   const info = [
//     ["Nama Kegiatan", project.activityName || "-"],
//     ["Nama Pekerjaan", project.name],
//     ["Lokasi Pekerjaan", project.location],
//     ["Tahun Anggaran", String(project.hspkPeriod)],
//   ];

//   let r = 5;
//   for (const [label, value] of info) {
//     ws.getCell(`F${r}`).value = label;
//     ws.getCell(`G${r}`).value = ":";
//     ws.mergeCells(`H${r}:${lastCol}${r}`);
//     ws.getCell(`H${r}`).value = value;
//     r++;
//   }

//   // border tebal luar B2:{lastCol}8
//   // border tebal luar B2:{lastCol}8
//   const cols = colRange("B", lastCol);
//   cols.forEach((col) => {
//     ws.getCell(`${col}2`).border = {
//       ...ws.getCell(`${col}2`).border,
//       top: { style: "medium" },
//     };
//     ws.getCell(`${col}8`).border = {
//       ...ws.getCell(`${col}8`).border,
//       bottom: { style: "medium" },
//     };
//   });
//   for (let row = 2; row <= 8; row++) {
//     ws.getCell(`B${row}`).border = {
//       ...ws.getCell(`B${row}`).border,
//       left: { style: "medium" },
//     };
//     ws.getCell(`${lastCol}${row}`).border = {
//       ...ws.getCell(`${lastCol}${row}`).border,
//       right: { style: "medium" },
//     };
//     ws.getCell(`D${row}`).border = {
//       ...ws.getCell(`D${row}`).border,
//       left: { style: "medium" },
//     };
//   }

//   return 10; // baris berikutnya yang bebas dipakai (setelah blok header + 1 baris kosong)
// }

// // helper: generate array kolom dari 'B' sampai 'J' dsb
// function colRange(startCol, endCol) {
//   const cols = [];
//   let c = startCol.charCodeAt(0);
//   const end = endCol.charCodeAt(0);
//   while (c <= end) {
//     cols.push(String.fromCharCode(c));
//     c++;
//   }
//   return cols;
// }

// // ============================================================
// // SHEET RAB
// // ============================================================
// async function buildRabSheet(ws, projectId, project) {
//   const groups = await prisma.rabGroup.findMany({
//     where: { projectId, parentId: null },
//     include: {
//       items: true,
//       children: { include: { items: true } },
//     },
//     orderBy: { order: "asc" },
//   });

//   ws.columns = [
//     { width: 5 },
//     { width: 6 },
//     { width: 40 },
//     { width: 25 },
//     { width: 8 },
//     { width: 8 },
//     { width: 14 },
//     { width: 14 },
//     { width: 14 },
//     { width: 14 },
//   ];

//   let r = buildHeaderBlock(ws, project, "RENCANA ANGGARAN BIAYA", "J");

//   const hr = r;
//   ws.mergeCells(`B${hr}:B${hr + 1}`);
//   ws.getCell(`B${hr}`).value = "NO";
//   ws.mergeCells(`C${hr}:C${hr + 1}`);
//   ws.getCell(`C${hr}`).value = "ITEM PEKERJAAN";
//   ws.mergeCells(`D${hr}:D${hr + 1}`);
//   ws.getCell(`D${hr}`).value = "SPESIFIKASI RINGKAS";
//   ws.mergeCells(`E${hr}:E${hr + 1}`);
//   ws.getCell(`E${hr}`).value = "SAT.";
//   ws.mergeCells(`F${hr}:F${hr + 1}`);
//   ws.getCell(`F${hr}`).value = "VOL.";
//   ws.mergeCells(`G${hr}:H${hr}`);
//   ws.getCell(`G${hr}`).value = "RAP";
//   ws.mergeCells(`I${hr}:J${hr}`);
//   ws.getCell(`I${hr}`).value = "RAB";
//   ws.getCell(`G${hr + 1}`).value = "HARGA SATUAN";
//   ws.getCell(`H${hr + 1}`).value = "TOTAL HARGA";
//   ws.getCell(`I${hr + 1}`).value = "HARGA SATUAN";
//   ws.getCell(`J${hr + 1}`).value = "TOTAL HARGA";

//   for (let row = hr; row <= hr + 1; row++) {
//     ws.getRow(row).eachCell({ includeEmpty: true }, (cell, col) => {
//       if (col >= 2) {
//         cell.font = { bold: true };
//         cell.alignment = {
//           horizontal: "center",
//           vertical: "middle",
//           wrapText: false,
//         };
//         cell.fill = {
//           type: "pattern",
//           pattern: "solid",
//           fgColor: { argb: "FFD9D9D9" },
//         };
//         cell.border = {
//           top: { style: "thin" },
//           bottom: { style: "thin" },
//           left: { style: "thin" },
//           right: { style: "thin" },
//         };
//       }
//     });
//   }
//   ["G", "H"].forEach((col) => {
//     ws.getCell(`${col}${hr}`).fill = {
//       type: "pattern",
//       pattern: "solid",
//       fgColor: { argb: "FFFFC0CB" },
//     };
//     ws.getCell(`${col}${hr + 1}`).fill = {
//       type: "pattern",
//       pattern: "solid",
//       fgColor: { argb: "FFFFC0CB" },
//     };
//   });

//   r = hr + 2;
//   let grandRap = 0,
//     grandRab = 0;

//   function writeItem(item, num, indent) {
//     ws.getCell(`B${r}`).value = num;
//     ws.getCell(`C${r}`).value = (indent ? "- " : "") + item.name;
//     ws.getCell(`E${r}`).value = item.paymentUnit;
//     ws.getCell(`F${r}`).value = Number(item.volume);
//     ws.getCell(`G${r}`).value = Number(item.rapUnitPrice);
//     ws.getCell(`H${r}`).value = Number(item.rapTotalPrice);
//     ws.getCell(`I${r}`).value = Number(item.rabUnitPrice);
//     ws.getCell(`J${r}`).value = Number(item.rabTotalPrice);
//     ["G", "H", "I", "J"].forEach((c) => fmt(ws.getCell(`${c}${r}`)));
//     r++;
//   }

//   function sumRecursive(group) {
//     let rap = 0,
//       rab = 0;
//     for (const it of group.items || []) {
//       rap += Number(it.rapTotalPrice);
//       rab += Number(it.rabTotalPrice);
//     }
//     for (const child of group.children || []) {
//       const s = sumRecursive(child);
//       rap += s.rap;
//       rab += s.rab;
//     }
//     return { rap, rab };
//   }

//   groups.forEach((group, idx) => {
//     ws.getCell(`B${r}`).value = ROMAN[idx] || String(idx + 1);
//     ws.getCell(`C${r}`).value = group.name.toUpperCase();
//     ws.getRow(r).font = { bold: true };
//     r++;

//     let n = 1;
//     for (const item of group.items) writeItem(item, String(n++), 0);
//     for (const sub of group.children || []) {
//       ws.getCell(`B${r}`).value = String(n++);
//       ws.getCell(`C${r}`).value = sub.name;
//       ws.getRow(r).font = { bold: true };
//       r++;
//       for (const item of sub.items) writeItem(item, "", 1);
//     }

//     r++;
//     const { rap, rab } = sumRecursive(group);
//     grandRap += rap;
//     grandRab += rab;

//     ws.getCell(`G${r}`).value = "Sub Total";
//     ws.getCell(`G${r}`).font = { italic: true, bold: true };
//     ws.getCell(`H${r}`).value = rap;
//     fmt(ws.getCell(`H${r}`));
//     ws.getCell(`H${r}`).font = { bold: true };
//     ws.getCell(`I${r}`).value = "Sub Total";
//     ws.getCell(`I${r}`).font = { italic: true, bold: true };
//     ws.getCell(`J${r}`).value = rab;
//     fmt(ws.getCell(`J${r}`));
//     ws.getCell(`J${r}`).font = { bold: true };
//     ["B", "C", "D", "E", "F", "G", "H", "I", "J"].forEach((col) => {
//       ws.getCell(`${col}${r}`).fill = {
//         type: "pattern",
//         pattern: "solid",
//         fgColor: { argb: "FFD9D9D9" },
//       };
//     });
//     r += 2;
//   });

//   // border sepanjang isi tabel
//   for (let row = hr + 2; row <= r; row++) {
//     ["B", "C", "D", "E", "F", "G", "H", "I", "J"].forEach((col) => {
//       ws.getCell(`${col}${row}`).border = {
//         top: { style: "thin" },
//         bottom: { style: "thin" },
//         left: { style: "thin" },
//         right: { style: "thin" },
//       };
//     });
//     ws.getCell(`B${row}`).border = {
//       ...ws.getCell(`B${row}`).border,
//       left: { style: "medium" },
//     };
//     ws.getCell(`J${row}`).border = {
//       ...ws.getCell(`J${row}`).border,
//       right: { style: "medium" },
//     };
//   }

//   ["C", "G", "H", "I", "J"].forEach((col) => autoFitColumn(ws, col));

//   ws.getCell(`G${r}`).value = "GRAND TOTAL RAP";
//   ws.getCell(`G${r}`).font = { bold: true };
//   ws.getCell(`H${r}`).value = grandRap;
//   fmt(ws.getCell(`H${r}`));
//   ws.getCell(`H${r}`).font = { bold: true };
//   ws.getCell(`I${r}`).value = "GRAND TOTAL RAB";
//   ws.getCell(`I${r}`).font = { bold: true };
//   ws.getCell(`J${r}`).value = grandRab;
//   fmt(ws.getCell(`J${r}`));
//   ws.getCell(`J${r}`).font = { bold: true };
//   ["B", "C", "D", "E", "F", "G", "H", "I", "J"].forEach((col) => {
//     ws.getCell(`${col}${r}`).fill = {
//       type: "pattern",
//       pattern: "solid",
//       fgColor: { argb: "FFFFC0CB" },
//     };
//   });
//   ["G", "H"].forEach((col) => {
//     ws.getCell(`${col}${r}`).fill = {
//       type: "pattern",
//       pattern: "solid",
//       fgColor: { argb: "FFCC66" },
//     };
//   });
// }

// // ============================================================
// // SHEET BV — sesuai kolom: NO / URAIAN / VOLUME(Sat,Vol) / KETERANGAN /
// // Panjang / Lebar / Tinggi / Luas / Keliling / Dia / Berat / Jumlah(Sisi,Bh) /
// // Waste / TOTAL(Vol,Sat) / LINK E-COMMERCE
// // ============================================================
// async function buildBvSheet(ws, projectId, project) {
//   const groups = await prisma.rabGroup.findMany({
//     where: { projectId, parentId: null },
//     include: {
//       bvItems: { include: { breakdowns: true, sourceJobType: true } },
//       children: {
//         include: {
//           bvItems: { include: { breakdowns: true, sourceJobType: true } },
//         },
//       },
//     },
//     orderBy: { order: "asc" },
//   });

//   // Kolom: B=NO C=URAIAN D=VOL.Sat E=VOL.Vol F=KETERANGAN
//   // G=Panjang H=Lebar I=Tinggi J=Luas K=Keliling L=Dia M=Berat
//   // N=Sisi O=Bh P=Waste Q=TOTAL.Vol R=TOTAL.Sat S=LINK
//   ws.columns = [
//     { width: 5 },
//     { width: 6 },
//     { width: 32 },
//     { width: 7 },
//     { width: 8 },
//     { width: 20 },
//     { width: 9 },
//     { width: 9 },
//     { width: 9 },
//     { width: 9 },
//     { width: 9 },
//     { width: 9 },
//     { width: 9 },
//     { width: 8 },
//     { width: 8 },
//     { width: 9 },
//     { width: 10 },
//     { width: 8 },
//     { width: 18 },
//   ];

//   let r = buildHeaderBlock(ws, project, "BACK UP VOLUME", "S");

//   const hr = r;
//   ws.mergeCells(`B${hr}:B${hr + 1}`);
//   ws.getCell(`B${hr}`).value = "NO";
//   ws.mergeCells(`C${hr}:C${hr + 1}`);
//   ws.getCell(`C${hr}`).value = "URAIAN PEKERJAAN";
//   ws.mergeCells(`D${hr}:E${hr}`);
//   ws.getCell(`D${hr}`).value = "VOLUME";
//   ws.mergeCells(`F${hr}:F${hr + 1}`);
//   ws.getCell(`F${hr}`).value = "KETERANGAN";
//   ws.mergeCells(`G${hr}:G${hr + 1}`);
//   ws.getCell(`G${hr}`).value = "Panjang";
//   ws.mergeCells(`H${hr}:H${hr + 1}`);
//   ws.getCell(`H${hr}`).value = "Lebar";
//   ws.mergeCells(`I${hr}:I${hr + 1}`);
//   ws.getCell(`I${hr}`).value = "Tinggi";
//   ws.mergeCells(`J${hr}:J${hr + 1}`);
//   ws.getCell(`J${hr}`).value = "Luas";
//   ws.mergeCells(`K${hr}:K${hr + 1}`);
//   ws.getCell(`K${hr}`).value = "Keliling";
//   ws.mergeCells(`L${hr}:L${hr + 1}`);
//   ws.getCell(`L${hr}`).value = "Dia";
//   ws.mergeCells(`M${hr}:M${hr + 1}`);
//   ws.getCell(`M${hr}`).value = "Berat";
//   ws.mergeCells(`N${hr}:O${hr}`);
//   ws.getCell(`N${hr}`).value = "Jumlah";
//   ws.mergeCells(`P${hr}:P${hr + 1}`);
//   ws.getCell(`P${hr}`).value = "Waste";
//   ws.mergeCells(`Q${hr}:R${hr}`);
//   ws.getCell(`Q${hr}`).value = "TOTAL";
//   ws.mergeCells(`S${hr}:S${hr + 1}`);
//   ws.getCell(`S${hr}`).value = "LINK";

//   ws.getCell(`D${hr + 1}`).value = "Sat.";
//   ws.getCell(`E${hr + 1}`).value = "Vol.";
//   ws.getCell(`G${hr + 1}`).value = "(m)";
//   ws.getCell(`H${hr + 1}`).value = "(m)";
//   ws.getCell(`I${hr + 1}`).value = "(m)";
//   ws.getCell(`J${hr + 1}`).value = "(m2)";
//   ws.getCell(`K${hr + 1}`).value = "(m1)";
//   ws.getCell(`L${hr + 1}`).value = "(m2)";
//   ws.getCell(`M${hr + 1}`).value = "(Kg)";
//   ws.getCell(`N${hr + 1}`).value = "(Sisi)";
//   ws.getCell(`O${hr + 1}`).value = "(Bh)";
//   ws.getCell(`P${hr + 1}`).value = "(%)";
//   ws.getCell(`Q${hr + 1}`).value = "Vol.";
//   ws.getCell(`R${hr + 1}`).value = "Sat.";
//   ws.getCell(`S${hr + 1}`).value = "E-COMMERCE INFO";

//   for (let row = hr; row <= hr + 1; row++) {
//     ws.getRow(row).eachCell({ includeEmpty: true }, (cell, col) => {
//       if (col >= 2) {
//         cell.font = { bold: true };
//         cell.alignment = {
//           horizontal: "center",
//           vertical: "middle",
//           wrapText: true,
//         };
//         cell.fill = {
//           type: "pattern",
//           pattern: "solid",
//           fgColor: { argb: "FFD9D9D9" },
//         };
//         cell.border = {
//           top: { style: "thin" },
//           bottom: { style: "thin" },
//           left: { style: "thin" },
//           right: { style: "thin" },
//         };
//       }
//     });
//   }

//   r = hr + 2;

//   function writeItemRow(it, no) {
//     ws.getCell(`B${r}`).value = no;
//     ws.getCell(`C${r}`).value = it.name;
//     ws.getCell(`D${r}`).value = it.paymentUnit;
//     ws.getCell(`E${r}`).value = Number(it.totalVolume);
//     ws.getCell(`Q${r}`).value = Number(it.totalVolume);
//     ws.getCell(`R${r}`).value = it.paymentUnit;
//     ws.getCell(`S${r}`).value = it.ecommerceLink || "";
//     ["E", "Q"].forEach((c) => fmt(ws.getCell(`${c}${r}`)));
//     r++;

//     it.breakdowns.forEach((b) => {
//       ws.getCell(`C${r}`).value = "   " + (b.keterangan || "");
//       ws.getCell(`G${r}`).value = b.panjang != null ? Number(b.panjang) : "";
//       ws.getCell(`H${r}`).value = b.lebar != null ? Number(b.lebar) : "";
//       ws.getCell(`I${r}`).value = b.tinggi != null ? Number(b.tinggi) : "";
//       ws.getCell(`L${r}`).value = b.diameter != null ? Number(b.diameter) : "";
//       ws.getCell(`M${r}`).value = b.berat != null ? Number(b.berat) : "";
//       ws.getCell(`N${r}`).value =
//         b.jumlahSisi != null ? Number(b.jumlahSisi) : "";
//       ws.getCell(`O${r}`).value = b.jumlahBh != null ? Number(b.jumlahBh) : "";
//       ws.getCell(`P${r}`).value = b.waste != null ? Number(b.waste) : 0;
//       r++;
//     });
//     r++; // baris kosong pemisah, sesuai contoh Excel
//   }

//   groups.forEach((group, idx) => {
//     ws.getCell(`B${r}`).value = ROMAN[idx] || String(idx + 1);
//     ws.getCell(`C${r}`).value = group.name.toUpperCase();
//     ws.getRow(r).font = { bold: true };
//     r++;

//     let n = 1;
//     for (const it of group.bvItems) writeItemRow(it, n++);
//     for (const sub of group.children || []) {
//       ws.getCell(`B${r}`).value = String(n++);
//       ws.getCell(`C${r}`).value = sub.name;
//       ws.getRow(r).font = { bold: true };
//       r++;
//       for (const it of sub.bvItems) writeItemRow(it, "");
//     }
//   });

//   // border sepanjang isi tabel
//   for (let row = hr + 2; row < r; row++) {
//     colRange("B", "S").forEach((col) => {
//       ws.getCell(`${col}${row}`).border = {
//         top: { style: "thin" },
//         bottom: { style: "thin" },
//         left: { style: "thin" },
//         right: { style: "thin" },
//       };
//     });
//   }

//   ["C", "F"].forEach((col) => autoFitColumn(ws, col));
// }

// module.exports = { buildRabSheet, buildBvSheet, ROMAN, fmt, autoFitColumn };
