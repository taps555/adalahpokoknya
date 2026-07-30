// const ExcelJS = require("exceljs");
// const express = require("express");
// const router = express.Router();

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

// router.get("/projects/:projectId/rab-items/export", async (req, res) => {
//   try {
//     const { projectId } = req.params;
//     const project = await prisma.project.findUnique({
//       where: { id: projectId },
//     });
//     if (!project)
//       return res.status(404).json({ error: "Project tidak ditemukan." });

//     const groups = await prisma.rabGroup.findMany({
//       where: { projectId, parentId: null },
//       include: {
//         items: true,
//         children: { include: { items: true } },
//       },
//       orderBy: { order: "asc" },
//     });

//     const wb = new ExcelJS.Workbook();
//     const ws = wb.addWorksheet("RAB");

//     ws.columns = [
//       { width: 5 },
//       { width: 6 },
//       { width: 40 },
//       { width: 25 },
//       { width: 8 },
//       { width: 8 },
//       { width: 14 },
//       { width: 14 },
//       { width: 14 },
//       { width: 14 },
//     ];

//     ws.mergeCells("D2:J3");
//     ws.getCell("D2").value = "RENCANA ANGGARAN BIAYA";
//     ws.getCell("D2").font = { bold: true, size: 14 };
//     ws.getCell("D2").alignment = { horizontal: "center", vertical: "middle" };

//     const info = [
//       ["Nama Pekerjaan", project.name],
//       ["Lokasi Pekerjaan", project.location],
//       ["Tahun Anggaran", String(project.hspkPeriod)],
//     ];

//     // 2. BARU tambahin ini di bawahnya (border luar tebal)
//     // merge area logo B2:C8
//     ws.mergeCells("B2:C8");

//     // border tebal (update mencakup area B2:C8 + D2:J8)
//     ["B", "C", "D", "E", "F", "G", "H", "I", "J"].forEach((col) => {
//       ws.getCell(`${col}2`).border = {
//         ...ws.getCell(`${col}2`).border,
//         top: { style: "medium" },
//       };
//       ws.getCell(`${col}8`).border = {
//         ...ws.getCell(`${col}8`).border,
//         bottom: { style: "medium" },
//       };
//     });
//     for (let row = 2; row <= 8; row++) {
//       ws.getCell(`B${row}`).border = {
//         ...ws.getCell(`B${row}`).border,
//         left: { style: "medium" },
//       };
//       ws.getCell(`J${row}`).border = {
//         ...ws.getCell(`J${row}`).border,
//         right: { style: "medium" },
//       };
//     }

//     for (let row = 5; row <= 7; row++) {
//       ws.getCell(`K${row}`).border = {
//         ...ws.getCell(`K${row}`).border,
//         left: { style: "medium" },
//       };
//     }

//     // garis pemisah tengah antara area logo (B:C) dan info project (D:J)
//     ws.getCell("D2").border = {
//       ...ws.getCell("D2").border,
//       left: { style: "medium" },
//     };
//     for (let row = 2; row <= 8; row++) {
//       ws.getCell(`D${row}`).border = {
//         ...ws.getCell(`D${row}`).border,
//         left: { style: "medium" },
//       };
//     }

//     let r = 5;
//     for (const [label, value] of info) {
//       ws.getCell(`D${r}`).value = label;
//       ws.getCell(`E${r}`).value = ":";
//       ws.mergeCells(`F${r}:J${r}`);
//       ws.getCell(`F${r}`).value = value;
//       r++;
//     }

//     r += 1;
//     const hr = r;
//     ws.mergeCells(`B${hr}:B${hr + 1}`);
//     ws.getCell(`B${hr}`).value = "NO";
//     ws.mergeCells(`C${hr}:C${hr + 1}`);
//     ws.getCell(`C${hr}`).value = "ITEM PEKERJAAN";
//     ws.mergeCells(`D${hr}:D${hr + 1}`);
//     ws.getCell(`D${hr}`).value = "SPESIFIKASI RINGKAS";
//     ws.mergeCells(`E${hr}:E${hr + 1}`);
//     ws.getCell(`E${hr}`).value = "SAT.";
//     ws.mergeCells(`F${hr}:F${hr + 1}`);
//     ws.getCell(`F${hr}`).value = "VOL.";
//     ws.mergeCells(`G${hr}:H${hr}`);
//     ws.getCell(`G${hr}`).value = "RAP";
//     ws.mergeCells(`I${hr}:J${hr}`);
//     ws.getCell(`I${hr}`).value = "RAB";
//     ws.getCell(`G${hr + 1}`).value = "HARGA SATUAN";
//     ws.getCell(`H${hr + 1}`).value = "TOTAL HARGA";
//     ws.getCell(`I${hr + 1}`).value = "HARGA SATUAN";
//     ws.getCell(`J${hr + 1}`).value = "TOTAL HARGA";

//     for (let row = hr; row <= hr + 1; row++) {
//       ws.getRow(row).eachCell({ includeEmpty: true }, (cell, col) => {
//         if (col >= 2) {
//           cell.font = { bold: true };
//           cell.alignment = {
//             horizontal: "center",
//             vertical: "middle",
//             wrapText: false,
//           };
//           cell.fill = {
//             type: "pattern",
//             pattern: "solid",
//             fgColor: { argb: "FFD9D9D9" },
//           };
//           cell.border = {
//             top: { style: "thin" },
//             bottom: { style: "thin" },
//             left: { style: "thin" },
//             right: { style: "thin" },
//           };
//         }
//       });
//     }
//         ws.getCell(`G${hr}`).fill = {
//       type: "pattern",
//       pattern: "solid",
//       fgColor: { argb: "FFFFC0CB" },
//     };

//         ["G", "H"].forEach((col) => {
//       ws.getCell(`${col}${hr + 1}`).fill = {
//         type: "pattern",
//         pattern: "solid",
//         fgColor: { argb: "FFFFC0CB" },
//       };
//     });

//     ["B", "C", "D", "E", "F", "G", "H", "I", "J"].forEach((col) => {
//       ws.getCell(`${col}9`).border = {
//         ...ws.getCell(`${col}9`).border,
//         top: { style: "medium" },
//       };
//       ws.getCell(`${col}10`).border = {
//         ...ws.getCell(`${col}10`).border,
//         bottom: { style: "medium" },
//       };
//     });
//     for (let row = 9; row <= 10; row++) {
//       ws.getCell(`B${row}`).border = {
//         ...ws.getCell(`J${row}`).border,
//         left: { style: "medium" },
//       };
//       ws.getCell(`J${row}`).border = {
//         ...ws.getCell(`J${row}`).border,
//         right: { style: "medium" },
//       };
//       ws.getCell(`I${row}`).border = {
//         ...ws.getCell(`I${row}`).border,
//         left: { style: "medium" },
//       };
//       ws.getCell(`G${row}`).border = {
//         ...ws.getCell(`G${row}`).border,
//         left: { style: "medium" },
//       };
//     }

//     //  Bikin kotak border di area B2:J8
//     // 1. Loop border tipis dulu (yang sebelumnya)

//     r = hr + 2;
//     let grandRap = 0,
//       grandRab = 0;
//     const fmt = (cell) => {
//       cell.numFmt = "#,##0";
//     };

//     // ["G", "H"].forEach((col) => {
//     //   [9, 10].forEach((row) => {
//     //     ws.getCell(`${col}${row}`).fill = {
//     //       type: "pattern",
//     //       pattern: "solid",
//     //       fgColor: { argb: "FFCCCCCC" },
//     //     };
//     //   });
//     // });

//     function writeItem(item, num, indent) {
//       ws.getCell(`B${r}`).value = num;
//       ws.getCell(`C${r}`).value = (indent ? "- " : "") + item.name;
//       ws.getCell(`E${r}`).value = item.paymentUnit;
//       ws.getCell(`F${r}`).value = Number(item.volume);
//       ws.getCell(`G${r}`).value = Number(item.rapUnitPrice);
//       ws.getCell(`H${r}`).value = Number(item.rapTotalPrice);
//       ws.getCell(`I${r}`).value = Number(item.rabUnitPrice);
//       ws.getCell(`J${r}`).value = Number(item.rabTotalPrice);
//       ["G", "H", "I", "J"].forEach((c) => fmt(ws.getCell(`${c}${r}`)));
//       r++;
//     }

//     function sumRecursive(group) {
//       let rap = 0,
//         rab = 0;
//       for (const it of group.items || []) {
//         rap += Number(it.rapTotalPrice);
//         rab += Number(it.rabTotalPrice);
//       }
//       for (const child of group.children || []) {
//         const s = sumRecursive(child);
//         rap += s.rap;
//         rab += s.rab;
//       }
//       return { rap, rab };
//     }

//     groups.forEach((group, idx) => {
//       ws.getCell(`B${r}`).value = ROMAN[idx] || String(idx + 1);
//       ws.getCell(`C${r}`).value = group.name.toUpperCase();
//       ws.getRow(r).font = { bold: true };
//       r++;

//       let n = 1;
//       for (const item of group.items) writeItem(item, String(n++), 0);
//       for (const sub of group.children || []) {
//         ws.getCell(`B${r}`).value = String(n++);
//         ws.getCell(`C${r}`).value = sub.name;
//         ws.getRow(r).font = { bold: true };
//         r++;
//         for (const item of sub.items) writeItem(item, "", 1);
//       }

//       r++;
//       const { rap, rab } = sumRecursive(group);
//       grandRap += rap;
//       grandRab += rab;

//       ws.getCell(`G${r}`).value = "Sub Total";
//       ws.getCell(`G${r}`).font = { italic: true, bold: true };
//       ws.getCell(`H${r}`).value = rap;
//       fmt(ws.getCell(`H${r}`));
//       ws.getCell(`H${r}`).font = { bold: true };
//       ws.getCell(`I${r}`).value = "Sub Total";
//       ws.getCell(`I${r}`).font = { italic: true, bold: true };
//       ws.getCell(`J${r}`).value = rab;
//       fmt(ws.getCell(`J${r}`));
//       ws.getCell(`J${r}`).font = { bold: true };
//       ["B", "C", "D", "E", "F", "G", "H", "I", "J"].forEach((col) => {
//       ws.getCell(`${col}${r}`).fill = {
//         type: "pattern",
//         pattern: "solid",
//         fgColor: { argb: "FFD9D9D9" },
//       };
//     });

//     r += 2;
//     });
//     // abu-abu sepanjang B sampai J

//     for (let row = 11; row <= r; row++) {
//       for (const col of ["B", "C", "D", "E", "F", "G", "H", "I", "J"]) {
//     const cell = ws.getCell(`${col}${row}`);
//     cell.border = {
//       top: { style: "thin" },
//       bottom: { style: "thin" },
//       left: { style: "thin" },
//       right: { style: "thin" },
//     };
//   }

//   const cellB = ws.getCell(`B${row}`);
// cellB.border = { ...cellB.border, left: { style: "medium" } };

// const cellJ = ws.getCell(`J${row}`);
// cellJ.border = { ...cellJ.border, right: { style: "medium" } };

// const cellG = ws.getCell(`G${row}`);
// cellG.border = { ...cellG.border, left: { style: "medium" } };

// const cellH = ws.getCell(`H${row}`);
// cellH.border = { ...cellH.border, right: { style: "medium" } };

// }

//     // taruh helper ini di atas, sebelum bikin worksheet
//     function autoFitColumn(ws, colLetter, minWidth = 1, maxWidth = 60) {
//       const col = ws.getColumn(colLetter);
//       let maxLen = minWidth;
//       col.eachCell({ includeEmpty: false }, (cell) => {
//         const len = String(cell.value ?? "").length;
//         if (len > maxLen) maxLen = len;
//       });
//       col.width = Math.min(maxLen + 2, maxWidth); // +2 padding
//     }

//     ["C", "G", "H", "I", "J"].forEach((col) =>
//       autoFitColumn(ws, col),
//     );
//     ws.getCell(`G${r}`).value = "GRAND TOTAL RAP";
//     ws.getCell(`G${r}`).font = { bold: true };
//     ws.getCell(`H${r}`).value = grandRap;
//     fmt(ws.getCell(`H${r}`));
//     ws.getCell(`H${r}`).font = { bold: true };
//     ws.getCell(`I${r}`).value = "GRAND TOTAL RAB";
//     ws.getCell(`I${r}`).font = { bold: true };
//     ws.getCell(`J${r}`).value = grandRab;
//     fmt(ws.getCell(`J${r}`));
//     ws.getCell(`J${r}`).font = { bold: true };

//     // pink sepanjang B sampai J di baris grand total
//     ["B", "C", "D", "E", "F", "G", "H", "I", "J"].forEach((col) => {
//       ws.getCell(`${col}${r}`).fill = {
//         type: "pattern",
//         pattern: "solid",
//         fgColor: { argb: "FFFFC0CB" },
//       };
//     });

// // kuning khusus di cell angka totalnya (H dan J)
// ["G","H"].forEach((col) => {
//   ws.getCell(`${col}${r}`).fill = {
//     type: "pattern",
//     pattern: "solid",
//     fgColor: { argb: "FFCC66" },
//   };
// });

//     res.setHeader(
//       "Content-Type",
//       "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
//     );
//     res.setHeader(
//       "Content-Disposition",
//       `attachment; filename="RAB_${project.name.replace(/\s+/g, "_")}.xlsx"`,
//     );
//     await wb.xlsx.write(res);
//     res.end();
//   } catch (err) {
//     console.error("Error Export RAB:", err);
//     res.status(500).json({ error: err.message || "Gagal export." });
//   }
// });

// module.exports = router;

"use strict";

const express = require("express");
const ExcelJS = require("exceljs");
const prisma = require("../../lib/prisma");
const { buildRabSheet } = require("../../services/rabExportHelper");

const router = express.Router();

router.get("/projects/:projectId/rab-items/export", async (req, res) => {
  try {
    const { projectId } = req.params;
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { client: true },
    });
    if (!project)
      return res.status(404).json({ error: "Project tidak ditemukan." });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("RAB");
    await buildRabSheet(ws, projectId, project);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="RAB_${project.name.replace(/\s+/g, "_")}.xlsx"`,
    );
    await wb.xlsx.write(res);
    res.end();
    console.log("rab", project);
  } catch (err) {
    console.error("Error Export RAB:", err);
    res.status(500).json({ error: err.message || "Gagal export." });
  }
});

module.exports = router;
