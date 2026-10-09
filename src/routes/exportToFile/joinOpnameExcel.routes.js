"use strict";
const express = require("express");
const router = express.Router();
const ExcelJS = require("exceljs");
const { PrismaClient } = require("@prisma/client");
const path = require("path");
const prisma = new PrismaClient();

function parseDateUtc(dateInput) {
  if (!dateInput) {
    const now = new Date();
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  }
  if (typeof dateInput === "string") {
    const parts = dateInput.slice(0, 10).split("-").map(Number);
    if (parts.length === 3) {
      return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    }
  }
  const d = new Date(dateInput);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function formatDateIso(d) {
  return d.toISOString().slice(0, 10);
}

function formatDateId(d) {
  return d.toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatDateShortId(d) {
  return d.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function makeSafeSheetName(rawName, existingSheetNames) {
  let clean = String(rawName || "Sheet")
    .replace(/[\\/?*\[\]:]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) clean = "Sheet";

  let baseName = clean.substring(0, 31);
  let finalName = baseName;
  let counter = 2;

  while (existingSheetNames.has(finalName.toLowerCase())) {
    const suffix = ` (${counter++})`;
    const maxBaseLen = 31 - suffix.length;
    finalName = `${clean.substring(0, maxBaseLen)}${suffix}`;
  }

  existingSheetNames.add(finalName.toLowerCase());
  return finalName;
}

router.get("/:projectId/join-opname/export/excel", async (req, res) => {
  try {
    const { projectId } = req.params;
    const { type = "daily", date, month } = req.query;
    
    const project = await prisma.project.findUnique({ 
      where: { id: projectId },
      include: {
        client: true,
        workCategories: {
          include: {
            workCategory: {
              include: {
                subCategories: {
                  where: { isActive: true },
                  orderBy: { sortOrder: "asc" },
                },
              },
            },
          },
        },
      },
    });
    if (!project) return res.status(404).send("Project not found");

    const allGroups = await prisma.rabGroup.findMany({
      where: { projectId, parentId: null },
      include: {
        items: {
          include: {
            dailyProgress: true,
            bvItem: { select: { id: true, parentBvItemId: true } },
            workCategory: true,
            workSubCategory: true,
          },
          orderBy: { order: "asc" },
        },
        children: {
          include: {
            items: {
              include: {
                dailyProgress: true,
                bvItem: { select: { id: true, parentBvItemId: true } },
                workCategory: true,
                workSubCategory: true,
              },
              orderBy: { order: "asc" },
            },
          },
          orderBy: { order: "asc" },
        },
      },
      orderBy: { order: "asc" },
    });

    const allUngroupedItems = await prisma.rabItem.findMany({
      where: { projectId, groupId: null },
      include: {
        dailyProgress: true,
        bvItem: { select: { id: true, parentBvItemId: true } },
        workCategory: true,
        workSubCategory: true,
      },
      orderBy: { order: "asc" },
    });

    const wb = new ExcelJS.Workbook();
    const existingSheetNames = new Set();
    
    const activeCategories = (project.workCategories || [])
      .filter((c) => c.isActive && c.workCategory?.isActive)
      .map((c) => c.workCategory)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

    const usedSubCategories = await prisma.workSubCategory.findMany({
      where: {
        rabItems: { some: { projectId } },
      },
      include: { category: true },
    });

    const exportTargets = [
      { name: "General", type: "GENERAL", label: "GENERAL" },
    ];

    for (const cat of activeCategories) {
      const code = cat.code.toUpperCase();
      exportTargets.push({
        name: code,
        type: "CATEGORY",
        categoryCode: code,
        label: code,
      });

      const subCategoryMap = new Map();
      (cat.subCategories || []).forEach((sub) => {
        if (sub.isActive !== false) {
          subCategoryMap.set(sub.id, sub);
        }
      });
      usedSubCategories.forEach((sub) => {
        if (sub.categoryId === cat.id || (sub.category && sub.category.code.toUpperCase() === code)) {
          if (!subCategoryMap.has(sub.id)) {
            subCategoryMap.set(sub.id, sub);
          }
        }
      });

      const subCategoriesToExport = Array.from(subCategoryMap.values())
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

      for (const sub of subCategoriesToExport) {
        const subCode = (sub.code || sub.name || "SUB").toUpperCase();
        exportTargets.push({
          name: `${code} - ${subCode}`,
          type: "SUBCATEGORY",
          categoryCode: code,
          subCategoryId: sub.id,
          subCode,
          label: `${code} (${subCode})`,
        });
      }
    }

    // Tentukan tanggal target opname & tanggal mulai proyek dengan UTC murni
    const targetDate = parseDateUtc(date);
    const projectStartDate = parseDateUtc(project.startDate || targetDate);

    const diffTime = targetDate.getTime() - projectStartDate.getTime();
    const targetDayNumber = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1);

    // Bangun daftar periode dinamis (periods) berdasarkan type
    const periods = [];
    let titleType = "HARIAN";

    if (type === "daily") {
      titleType = "HARIAN";
      const dStr = formatDateId(targetDate);
      const targetIso = formatDateIso(targetDate);
      periods.push({
        titleTop: `HARI KE ${targetDayNumber}`,
        titleBottom: dStr,
        startDate: targetDate,
        endDate: targetDate,
        startIso: targetIso,
        endIso: targetIso,
      });
    } else if (type === "weekly") {
      titleType = "MINGGUAN";
      const weekNum = Math.ceil(targetDayNumber / 7);
      const startDay = (weekNum - 1) * 7;
      for (let i = 0; i < 7; i++) {
        const curD = new Date(projectStartDate);
        curD.setUTCDate(curD.getUTCDate() + startDay + i);
        const dStr = formatDateId(curD);
        const iso = formatDateIso(curD);
        periods.push({
          titleTop: `HARI KE ${startDay + i + 1}`,
          titleBottom: dStr,
          startDate: curD,
          endDate: curD,
          startIso: iso,
          endIso: iso,
        });
      }
    } else if (type === "monthly") {
      titleType = "BULANAN";
      let y = targetDate.getUTCFullYear();
      let m = targetDate.getUTCMonth();
      if (month && month.includes("-")) {
        const [my, mm] = month.split("-").map(Number);
        y = my;
        m = mm - 1;
      }
      const numDays = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      for (let i = 1; i <= numDays; i++) {
        const curD = new Date(Date.UTC(y, m, i));
        const dStr = formatDateId(curD);
        const iso = formatDateIso(curD);
        periods.push({
          titleTop: `HARI KE ${i}`,
          titleBottom: dStr,
          startDate: curD,
          endDate: curD,
          startIso: iso,
          endIso: iso,
        });
      }
    } else if (type === "overall") {
      titleType = "KESELURUHAN";
      let maxDate = new Date(projectStartDate);
      const checkMaxDate = (items) => {
        items.forEach((it) => {
          (it.dailyProgress || []).forEach((p) => {
            const pd = parseDateUtc(p.date);
            if (pd > maxDate) maxDate = pd;
          });
        });
      };
      allGroups.forEach((g) => {
        checkMaxDate(g.items);
        (g.children || []).forEach((c) => checkMaxDate(c.items));
      });
      checkMaxDate(allUngroupedItems);

      const totalDays = Math.max(1, Math.ceil((maxDate.getTime() - projectStartDate.getTime()) / (1000 * 60 * 60 * 24)) + 1);
      const totalWeeks = Math.max(1, Math.ceil(totalDays / 7));

      for (let i = 0; i < totalWeeks; i++) {
        const startOfWeek = new Date(projectStartDate);
        startOfWeek.setUTCDate(startOfWeek.getUTCDate() + i * 7);

        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setUTCDate(endOfWeek.getUTCDate() + 6);

        const sStr = formatDateShortId(startOfWeek);
        const eStr = formatDateShortId(endOfWeek);

        periods.push({
          titleTop: `MINGGU KE ${i + 1}`,
          titleBottom: `${sStr} - ${eStr}`,
          startDate: startOfWeek,
          endDate: endOfWeek,
          startIso: formatDateIso(startOfWeek),
          endIso: formatDateIso(endOfWeek),
        });
      }
    }
    
    for (const target of exportTargets) {
        const filterItems = (items) => {
            if (target.type === "GENERAL") return items;
            if (target.type === "CATEGORY") {
                const catCode = target.categoryCode.toLowerCase();
                return items.filter(it => {
                    const code = (it.workCategory?.code || it.discipline || "").toLowerCase();
                    if (code === catCode) return true;
                    const children = items.filter(child => child.bvItem?.parentBvItemId === it.bvItem?.id);
                    if (children.length > 0 && children.some(c => (c.workCategory?.code || c.discipline || "").toLowerCase() === catCode)) return true;
                    return false;
                });
            }
            if (target.type === "SUBCATEGORY") {
                const subId = target.subCategoryId;
                return items.filter(it => {
                    if (it.workSubCategoryId === subId) return true;
                    const children = items.filter(child => child.bvItem?.parentBvItemId === it.bvItem?.id);
                    if (children.length > 0 && children.some(c => c.workSubCategoryId === subId)) return true;
                    return false;
                });
            }
            return items;
        };
        
        const groups = allGroups.map(g => ({
           ...g,
           items: filterItems(g.items),
           children: g.children.map(c => ({ ...c, items: filterItems(c.items) }))
        })).filter(g => g.items.length > 0 || g.children.some(c => c.items.length > 0));
        
        const ungroupedItems = filterItems(allUngroupedItems);
        
        const rabItems = [];
        groups.forEach((group) => {
          rabItems.push(...group.items);
          (group.children || []).forEach((sub) => { rabItems.push(...sub.items); });
        });
        rabItems.push(...ungroupedItems);

        // Jika subkategori tidak memiliki item sama sekali, lewati pembuatannya agar file rapi
        if (rabItems.length === 0 && target.type !== "GENERAL") continue;
        if (rabItems.length === 0 && target.type === "GENERAL" && exportTargets.length > 1) continue;

        const parentIds = new Set();
        rabItems.forEach((it) => {
          if (it.bvItem?.parentBvItemId) parentIds.add(it.bvItem.parentBvItemId);
        });

        const parentRapSum = {};
        rabItems.forEach((it) => {
          if (it.bvItem?.parentBvItemId) {
            const pId = it.bvItem.parentBvItemId;
            parentRapSum[pId] = (parentRapSum[pId] || 0) + Number(it.rapTotalPrice || 0);
          }
        });

        // Total kontrak hanya menghitung item daun (non-parent)
        const totalContract = rabItems.reduce((sum, it) => {
          if (parentIds.has(it.bvItem?.id)) return sum;
          return sum + Number(it.rapTotalPrice);
        }, 0);

        // Hitung total akumulasi bobot rekap terlaksana (untuk grand total rekap)
        let overallTotalBobot = 0;
        rabItems.forEach((it) => {
          if (!parentIds.has(it.bvItem?.id) && totalContract > 0) {
            const w = Number(it.rapTotalPrice) / totalContract;
            let m = 0;
            (it.dailyProgress || []).forEach((dp) => {
              const val = Number(dp.progressPercent);
              if (val > m) m = val;
            });
            overallTotalBobot += w * (m / 100);
          }
        });

        // Hitung parentRekapSum untuk baris parent
        const parentRekapSum = {};
        rabItems.forEach((it) => {
          if (!parentIds.has(it.bvItem?.id) && it.bvItem?.parentBvItemId) {
            const pId = it.bvItem.parentBvItemId;
            const actualTotal = Number(it.rapTotalPrice);
            let itemMaxProg = 0;
            (it.dailyProgress || []).forEach((dp) => {
              const pVal = Number(dp.progressPercent);
              if (pVal > itemMaxProg) itemMaxProg = pVal;
            });
            parentRekapSum[pId] = (parentRekapSum[pId] || 0) + actualTotal * (itemMaxProg / 100);
          }
        });

        let safeSheetName = makeSafeSheetName(target.name, existingSheetNames);
        const ws = wb.addWorksheet(safeSheetName);

        // ---- HEADER PROJECT INFO ----
        const startRow = 1;
        ws.mergeCells(`B${startRow}:C${startRow + 7}`);
        ws.getCell(`B${startRow}`).value = "";
        ws.getCell(`B${startRow}`).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        ws.getCell(`B${startRow}`).border = { top: {style:'medium'}, bottom: {style:'medium'}, left: {style:'medium'}, right: {style:'medium'} };
        try {
          const logoPath = path.join(__dirname, "../../../public/assets/dives.png");
          const logoId = ws.workbook.addImage({ filename: logoPath, extension: "png" });
          ws.addImage(logoId, { 
             tl: { col: 1, row: startRow - 1 }, 
             ext: { width: 230, height: 130 },
             editAs: "absolute" 
          });
        } catch (err) { }

        const totalCols = 8 + (periods.length * 3) + 2; // +2 untuk Rekap Progres dan Status
        const lastPeriodCol = ws.getColumn(Math.max(8, totalCols + 1)).letter;
        
        ws.mergeCells(`D${startRow}:I${startRow + 1}`);
        const themeColor = "FFFFCCCC";
        ws.getCell(`D${startRow}`).value = `LAPORAN ${titleType} - JOIN OPNAME ${target.label}`;
        ws.getCell(`D${startRow}`).font = { bold: true, size: 14 };
        ws.getCell(`D${startRow}`).alignment = { horizontal: "center", vertical: "middle" };
        ws.getCell(`D${startRow}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: themeColor } };
        ws.getCell(`D${startRow + 1}`).border = { top: {style:'medium'}, bottom: {style:'medium'}, left: {style:'medium'}, right: {style:'medium'} };

        ws.mergeCells(`J${startRow}:${lastPeriodCol}${startRow + 1}`);
        ws.getCell(`J${startRow}`).value = "";
        ws.getCell(`J${startRow}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: themeColor } };
        ws.getCell(`${lastPeriodCol}${startRow + 1}`).border = { top: {style:'medium'}, bottom: {style:'medium'}, left: {style:'medium'}, right: {style:'medium'} };

        const info = [
          ["Nama Kegiatan", project?.name || "-"],
          ["Nama Pekerjaan", project?.client?.name || "-"],
          ["Lokasi Pekerjaan", project?.location || "-"],
          ["Tahun Anggaran", String(project?.hspkPeriod || "-")],
        ];
        let rInfo = startRow + 3;
        for (const [label, value] of info) {
          ws.getCell(`D${rInfo}`).value = label;
          ws.getCell(`E${rInfo}`).value = ":";
          ws.getCell(`E${rInfo}`).alignment = { horizontal: "center" };
          ws.mergeCells(`F${rInfo}:I${rInfo}`);
          ws.getCell(`F${rInfo}`).value = value;
          rInfo++;
        }

        const medium = { style: "medium" };
        const colsLetters = [];
        for(let c=2; c<=Math.max(8, totalCols + 1); c++) colsLetters.push(ws.getColumn(c).letter);
        colsLetters.forEach((col) => {
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
        let hr = startRow + 8;
        const mainCols = [
          ["B", "NO"], ["C", "ITEM PEKERJAAN"], ["D", "SPESIFIKASI RINGKAS"], ["E", "SAT."],
          ["F", "VOL."], ["G", "HARGA SATUAN"], ["H", "TOTAL HARGA"], ["I", "BOBOT\n(%)"]
        ];
        
        mainCols.forEach(([col, label]) => {
          ws.mergeCells(`${col}${hr}:${col}${hr + 2}`);
          const cell = ws.getCell(`${col}${hr}`);
          cell.value = label;
          cell.font = { bold: true, size: 9 };
          cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
          const color = (col === "G" || col === "H") ? 'FFCCCCCC' : 'FFD0CECE';
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
          cell.border = { top: {style:'medium'}, left: {style:'thin'}, bottom: {style:'medium'}, right: {style:'thin'} };
        });

        const subColors = ["FFFABF8F", "FFB6DDE8", "FFC2D69B"]; // Orange, Blue, Green
        let colIndex = 10; // J
        periods.forEach((period) => {
          ws.mergeCells(hr, colIndex, hr, colIndex + 2); 
          const cell1 = ws.getCell(hr, colIndex);
          cell1.value = period.titleTop;
          cell1.font = { bold: true, size: 8 };
          cell1.alignment = { vertical: 'middle', horizontal: 'center' };
          cell1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFCCCC' } };
          cell1.border = { top: {style:'medium'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
          
          ws.mergeCells(hr + 1, colIndex, hr + 1, colIndex + 2); 
          const cell2 = ws.getCell(hr + 1, colIndex);
          cell2.value = period.titleBottom;
          cell2.font = { bold: true, size: 8 };
          cell2.alignment = { vertical: 'middle', horizontal: 'center' };
          cell2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD8D8D8' } };
          cell2.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
          
          const subLabels = ["PROGRESS (%)", "BOBOT (%)", "VOLUME"];
          subLabels.forEach((label, subIdx) => {
             const cell = ws.getCell(hr + 2, colIndex + subIdx);
             cell.value = label;
             cell.font = { bold: true, size: 8 };
             cell.alignment = { vertical: 'middle', horizontal: 'center' };
             cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: subColors[subIdx] } };
             cell.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'medium'}, right: {style:'thin'} };
          });
          
          colIndex += 3;
        });

        // Tambahkan header REKAP PROGRES dan STATUS
        const finalCols = [
          { c: colIndex, label: "REKAP\nPROGRES" },
          { c: colIndex + 1, label: "STATUS" }
        ];
        finalCols.forEach(fc => {
          const colLetter = ws.getColumn(fc.c).letter;
          ws.mergeCells(`${colLetter}${hr}:${colLetter}${hr + 2}`);
          const cell = ws.getCell(`${colLetter}${hr}`);
          cell.value = fc.label;
          cell.font = { bold: true, size: 9 };
          cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD0CECE' } };
          cell.border = { top: {style:'medium'}, left: {style:'thin'}, bottom: {style:'medium'}, right: {style:'thin'} };
        });

        ws.getCell(`B${hr}`).border = { ...ws.getCell(`B${hr}`).border, left: { style: 'medium' } };
        ws.getCell(`J${hr}`).border = { ...ws.getCell(`J${hr}`).border, left: { style: 'medium' } };
        ws.getCell(`${lastPeriodCol}${hr}`).border = { ...ws.getCell(`${lastPeriodCol}${hr}`).border, right: { style: 'medium' } };

        let currentRow = hr + 3;
        let globalItemIndex = 1;
        let dailyBobotSums = new Array(periods.length).fill(0);

        const getRoman = (num) => {
          const roman = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX"];
          return roman[num - 1] || String(num);
        };

        const drawRow = (isGroup, dataArray, isChild = false) => {
           const row = ws.getRow(currentRow++);
           dataArray.forEach((val, idx) => {
              const cell = row.getCell(idx + 2); // Mulai dari B (col 2)
              cell.value = val;
              cell.border = { top: {style:'dotted'}, left: {style:'thin'}, bottom: {style:'dotted'}, right: {style:'thin'} };
              cell.font = isGroup ? { bold: true, size: 9, name: "Arial Narrow" } : { size: 9, name: "Arial Narrow" };
              
              let align = 'center';
              if (idx === 1 || idx === 2) align = 'left'; // ITEM PEKERJAAN & SPESIFIKASI
              else if (idx === 4 || idx === 5 || idx === 6) align = 'right'; // VOL, HARGA SATUAN, TOTAL HARGA

              cell.alignment = { horizontal: align, vertical: 'middle', wrapText: true };
              if (idx === 1 && !isGroup && isChild) cell.alignment.indent = 2;
              
              // Warna subkolom periode
              if (idx >= 8 && idx < 8 + periods.length * 3) {
                  const subColors = ["FFFABF8F", "FFB6DDE8", "FFC2D69B"];
                  const colorIdx = (idx - 8) % 3;
                  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: subColors[colorIdx] } };
              }
           });
           row.getCell(2).border = { ...row.getCell(2).border, left: { style: 'medium' } }; 
           row.getCell(9).border = { ...row.getCell(9).border, right: { style: 'medium' } }; 
           row.getCell(totalCols + 1).border = { ...row.getCell(totalCols + 1).border, right: { style: 'medium' } };
        };

        const buildItemRowData = (it, hasChildren, isChild) => {
            const actualRapTotal = hasChildren ? parentRapSum[it.bvItem?.id] || 0 : Number(it.rapTotalPrice);
            const weight = !hasChildren && totalContract > 0 ? (actualRapTotal / totalContract) * 100 : 0;
            const unitPrice = Number(it.rapTotalPrice) / (Number(it.volume) || 1);

            const rowData = [
              hasChildren ? "" : globalItemIndex++,
              (isChild ? "- " : "") + it.name, "", it.paymentUnit || "-",
              hasChildren ? "" : Number(it.volume),
              hasChildren ? "" : unitPrice,
              actualRapTotal,
              hasChildren ? "" : weight / 100
            ];

            let maxProgressSoFar = 0;
            if (!hasChildren) {
              (it.dailyProgress || []).forEach(dp => {
                const val = Number(dp.progressPercent);
                if (val > maxProgressSoFar) maxProgressSoFar = val;
              });
            }

            // Hitung data untuk setiap periode
            periods.forEach((period, pIndex) => {
              if (hasChildren) {
                rowData.push("", "", "");
              } else {
                let progNow = 0;
                (it.dailyProgress || []).forEach(dp => {
                  const pDateStr = formatDateIso(parseDateUtc(dp.date));
                  if (pDateStr >= period.startIso && pDateStr <= period.endIso) {
                    const pVal = Number(dp.progressPercent);
                    if (pVal > progNow) progNow = pVal;
                  }
                });

                if (progNow === 0) {
                  rowData.push("", "", "");
                } else {
                  const progVal = progNow / 100;
                  const bobotVal = progVal * (weight / 100);
                  const volVal = progVal * Number(it.volume);
                  rowData.push(progVal, bobotVal, volVal);
                  dailyBobotSums[pIndex] += bobotVal;
                }
              }
            });

            if (hasChildren) {
              const pId = it.bvItem?.id;
              const parentTotal = parentRapSum[pId] || 0;
              const parentProgress = parentTotal > 0 ? (parentRekapSum[pId] || 0) / parentTotal : 0;
              rowData.push(parentProgress);
              let status = "Belum Mulai";
              if (parentProgress >= 1) status = "Selesai";
              else if (parentProgress >= 0.95) status = "Quality Check";
              else if (parentProgress > 0) status = "On Progress";
              rowData.push(status);
            } else {
              rowData.push(maxProgressSoFar / 100);
              let status = "Belum Mulai";
              if (maxProgressSoFar >= 100) status = "Selesai";
              else if (maxProgressSoFar >= 95) status = "Quality Check";
              else if (maxProgressSoFar > 0) status = "On Progress";
              rowData.push(status);
            }

            return rowData;
        };

        let groupCounter = 1;
        groups.forEach(group => {
           const hasGroupItems = group.items.length > 0 || (group.children && group.children.some(c => c.items.length > 0));
           if (!hasGroupItems) return;

           const rowData = [getRoman(groupCounter++), group.name.toUpperCase(), "", "", "", "", "", ""];
           periods.forEach(() => rowData.push("", "", ""));
           rowData.push("", ""); // REKAP PROGRES & STATUS
           drawRow(true, rowData);

           group.items.forEach(it => {
              const hasChildren = parentIds.has(it.bvItem?.id);
              const isChild = it.bvItem?.parentBvItemId != null;
              drawRow(hasChildren, buildItemRowData(it, hasChildren, isChild), isChild);
           });
           
           (group.children || []).forEach(sub => {
              if (sub.items.length === 0) return;
              const subRowData = ["", sub.name, "", "", "", "", "", ""];
              periods.forEach(() => rowData.push("", "", ""));
              subRowData.push("", "");
              drawRow(true, subRowData);

              sub.items.forEach(it => {
                 const hasChildren = parentIds.has(it.bvItem?.id);
                 const isChild = it.bvItem?.parentBvItemId != null;
                 drawRow(hasChildren, buildItemRowData(it, hasChildren, isChild), isChild);
              });
           });
        });

        if (ungroupedItems.length > 0) {
           const rowData = ["", "Tanpa Group", "", "", "", "", "", ""];
           periods.forEach(() => rowData.push("", "", ""));
           rowData.push("", "");
           drawRow(true, rowData);

           ungroupedItems.forEach(it => {
              const hasChildren = parentIds.has(it.bvItem?.id);
              const isChild = it.bvItem?.parentBvItemId != null;
              drawRow(hasChildren, buildItemRowData(it, hasChildren, isChild), isChild);
           });
        }
        
        // Final bottom border before Grand Total
        const lastDataRow = ws.getRow(currentRow - 1);
        for (let c = 2; c <= totalCols + 1; c++) {
           lastDataRow.getCell(c).border = { ...lastDataRow.getCell(c).border, bottom: { style: 'medium' } };
        }

        // GRAND TOTAL
        const grandTotalRow = ws.getRow(currentRow++);
        for (let c = 2; c <= totalCols + 1; c++) {
           grandTotalRow.getCell(c).border = { top: {style:'medium'}, bottom: {style:'medium'}, left: {style:'thin'}, right: {style:'thin'} };
           grandTotalRow.getCell(c).font = { bold: true, size: 9, name: "Arial Narrow" };
           grandTotalRow.getCell(c).alignment = { horizontal: 'center', vertical: 'middle' };
           
           if (c >= 10 && c < 10 + periods.length * 3) {
              const subColors = ["FFFABF8F", "FFB6DDE8", "FFC2D69B"];
              const colorIdx = (c - 10) % 3;
              grandTotalRow.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: subColors[colorIdx] } };
           }
        }
        ws.mergeCells(`C${currentRow - 1}:G${currentRow - 1}`);
        grandTotalRow.getCell(3).value = "GRAND TOTAL";
        grandTotalRow.getCell(3).alignment = { horizontal: 'right', vertical: 'middle' };
        grandTotalRow.getCell(8).value = totalContract;
        grandTotalRow.getCell(8).alignment = { horizontal: 'right', vertical: 'middle' };
        grandTotalRow.getCell(2).border = { ...grandTotalRow.getCell(2).border, left: { style: 'medium' } };
        grandTotalRow.getCell(9).border = { ...grandTotalRow.getCell(9).border, right: { style: 'medium' } };
        grandTotalRow.getCell(totalCols + 1).border = { ...grandTotalRow.getCell(totalCols + 1).border, right: { style: 'medium' } };

        // TOTAL PROGRESS
        const totalProgressRow = ws.getRow(currentRow++);
        for (let c = 2; c <= totalCols + 1; c++) {
           totalProgressRow.getCell(c).border = { top: {style:'medium'}, bottom: {style:'medium'}, left: {style:'thin'}, right: {style:'thin'} };
           totalProgressRow.getCell(c).font = { bold: true, size: 9, name: "Arial Narrow" };
           totalProgressRow.getCell(c).alignment = { horizontal: 'center', vertical: 'middle' };
           
           if (c >= 10 && c < 10 + periods.length * 3) {
              const subColors = ["FFFABF8F", "FFB6DDE8", "FFC2D69B"];
              const colorIdx = (c - 10) % 3;
              totalProgressRow.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: subColors[colorIdx] } };
           }
        }
        ws.mergeCells(`C${currentRow - 1}:H${currentRow - 1}`);
        totalProgressRow.getCell(3).value = "TOTAL PROGRESS";
        totalProgressRow.getCell(3).alignment = { horizontal: 'right', vertical: 'middle' };
        
        dailyBobotSums.forEach((sum, idx) => {
            if (sum > 0) {
              totalProgressRow.getCell(10 + (idx * 3) + 1).value = sum; // Subkolom BOBOT
            }
        });
        totalProgressRow.getCell(9).value = 1; // 100%
        totalProgressRow.getCell(totalCols).value = overallTotalBobot; // Overall Rekap Progres

        totalProgressRow.getCell(2).border = { ...totalProgressRow.getCell(2).border, left: { style: 'medium' } };
        totalProgressRow.getCell(9).border = { ...totalProgressRow.getCell(9).border, right: { style: 'medium' } };
        totalProgressRow.getCell(totalCols + 1).border = { ...totalProgressRow.getCell(totalCols + 1).border, right: { style: 'medium' } };

        ws.getColumn(2).width = 5;
        ws.getColumn(3).width = 35;
        ws.getColumn(4).width = 25;
        ws.getColumn(5).width = 7.5;
        ws.getColumn(6).width = 8;
        ws.getColumn(7).width = 14;
        ws.getColumn(8).width = 14;
        ws.getColumn(9).width = 10;
        
        ws.getColumn(9).numFmt = '0.00%';
        ws.getColumn(6).numFmt = '#,##0.00';
        ws.getColumn(7).numFmt = '#,##0.00';
        ws.getColumn(8).numFmt = '#,##0';
        
        for(let r = hr + 3; r < currentRow; r++) {
           let cIdx = 10;
           periods.forEach(() => {
             ws.getCell(r, cIdx).numFmt = '0.00%';
             ws.getCell(r, cIdx+1).numFmt = '0.00%';
             ws.getCell(r, cIdx+2).numFmt = '#,##0.00';
             cIdx += 3;
           });
           ws.getCell(r, totalCols).numFmt = '0.00%'; // Rekap progres
        }

        let colI = 10;
        periods.forEach(() => {
          ws.getColumn(colI++).width = 9.5; 
          ws.getColumn(colI++).width = 9.5; 
          ws.getColumn(colI++).width = 9.5;
        });
        ws.getColumn(totalCols).width = 12; // REKAP PROGRES
        ws.getColumn(totalCols + 1).width = 15; // STATUS
        
        ws.eachRow({ includeEmpty: true }, (row) => {
          row.eachCell({ includeEmpty: true }, (cell) => {
            cell.font = { ...cell.font, name: "Arial Narrow" };
          });
        });
    }

    if (wb.worksheets.length === 0) {
        const ws = wb.addWorksheet("Kosong");
        ws.addRow(["Tidak ada data progress"]);
    }

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const safeProjectName = project.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const dateFormatted = formatDateIso(targetDate);
    res.setHeader("Content-Disposition", `attachment; filename="Join_Opname_${safeProjectName}_${titleType}_${dateFormatted}.xlsx"`);

    await wb.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.status(500).json({ error: error.message });
  }
});

module.exports = router;
