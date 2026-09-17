"use strict";
const express = require("express");
const router = express.Router();
const ExcelJS = require("exceljs");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

router.get("/:projectId/join-opname/export/excel", async (req, res) => {
  try {
    const { projectId } = req.params;
    
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return res.status(404).send("Project not found");

    const allGroups = await prisma.rabGroup.findMany({
      where: { projectId, parentId: null },
      include: {
        items: { include: { dailyProgress: true, bvItem: { select: { id: true, parentBvItemId: true } } }, orderBy: { order: "asc" } },
        children: {
          include: {
            items: { include: { dailyProgress: true, bvItem: { select: { id: true, parentBvItemId: true } } }, orderBy: { order: "asc" } }
          },
          orderBy: { order: "asc" }
        }
      },
      orderBy: { order: "asc" }
    });

    const allUngroupedItems = await prisma.rabItem.findMany({
      where: { projectId, groupId: null },
      include: { dailyProgress: true, bvItem: { select: { id: true, parentBvItemId: true } } },
      orderBy: { order: "asc" },
    });

    const wb = new ExcelJS.Workbook();
    
    const disciplines = ["General", "Sipil", "Interior"];
    
    for (const discipline of disciplines) {
        const filterItems = (items) => {
            if (discipline === "General") return items;
            const target = discipline.toLowerCase();
            return items.filter(it => {
                if ((it.discipline || "").toLowerCase() === target) return true;
                const children = items.filter(child => child.bvItem?.parentBvItemId === it.bvItem?.id);
                if (children.length > 0 && children.some(c => (c.discipline || "").toLowerCase() === target)) return true;
                return false;
            });
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

        if (rabItems.length === 0) continue;

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

        const totalContract = rabItems.reduce((sum, it) => {
          if (parentIds.has(it.bvItem?.id)) return sum;
          return sum + Number(it.rapTotalPrice);
        }, 0);

        let minDate = null;
        if (discipline !== "General") {
            rabItems.forEach(it => {
              if (it.startDate) {
                if (!minDate || new Date(it.startDate) < minDate) minDate = new Date(it.startDate);
              }
            });
        } else {
            rabItems.forEach(it => {
              if (it.startDate) {
                if (!minDate || new Date(it.startDate) < minDate) minDate = new Date(it.startDate);
              }
            });
            if (project.startDate && (!minDate || new Date(project.startDate) < minDate)) {
              minDate = new Date(project.startDate);
            }
        }
        if (!minDate) minDate = new Date();
        minDate.setHours(0,0,0,0);

        const dateSet = new Set();
        rabItems.forEach(it => {
           it.dailyProgress.forEach(dp => {
               const pd = new Date(dp.date).setHours(0,0,0,0);
               if (pd >= minDate.getTime() && Number(dp.progressPercent) > 0) {
                   dateSet.add(pd);
               }
           });
        });
        
        const days = Array.from(dateSet).sort((a,b) => a - b).map(t => new Date(t));

        const ws = wb.addWorksheet(discipline);

        const totalCols = 8 + (days.length * 3);
        ws.mergeCells(1, 1, 2, Math.max(8, totalCols));
        const titleCell = ws.getCell(1, 1);
        titleCell.value = "LAPORAN KESELURUHAN - JOIN OPNAME " + discipline.toUpperCase();
        titleCell.font = { bold: true, size: 14 };
        titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
        titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4CCCC' } };
        titleCell.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };

        const colLabels = ["NO", "ITEM PEKERJAAN", "SPESIFIKASI RINGKAS", "SAT.", "VOL.", "HARGA SATUAN", "TOTAL HARGA", "BOBOT (%)"];
        colLabels.forEach((label, i) => {
          const col = i + 1;
          ws.mergeCells(4, col, 6, col);
          const cell = ws.getCell(4, col);
          cell.value = label;
          cell.font = { bold: true, size: 9 };
          cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
          cell.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
        });

        const setBorderAndAlign = (cell, color, bold = false) => {
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
          cell.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
          if (color) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
          if (bold) cell.font = { bold: true, size: 8 };
          else cell.font = { size: 8 };
        };

        

        const colors = ['FFCFE2F3', 'FFFCE5CD', 'FFD9EAD3'];

        let colIndex = 9;
        days.forEach((d, i) => {
          const color = colors[i % 3];
          
          ws.mergeCells(4, colIndex, 4, colIndex + 2); 
          
          const dayNumber = Math.floor((d.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
          ws.getCell(4, colIndex).value = "HARI KE " + dayNumber;
          
          ws.mergeCells(5, colIndex, 5, colIndex + 2); 
          const dStr = d.toLocaleString('id-ID', {weekday:'long'}) + ', ' + d.getDate() + ' ' + d.toLocaleString('id-ID', {month:'long'}) + ' ' + d.getFullYear();
          ws.getCell(5, colIndex).value = dStr;
          
          for(let r=4; r<=5; r++) {
             [colIndex, colIndex+1, colIndex+2].forEach(c => setBorderAndAlign(ws.getCell(r, c), color, true));
          }
          
          ws.getCell(6, colIndex).value = "PROGRESS (%)"; setBorderAndAlign(ws.getCell(6, colIndex), color, true);
          ws.getCell(6, colIndex + 1).value = "BOBOT (%)"; setBorderAndAlign(ws.getCell(6, colIndex + 1), color, true);
          ws.getCell(6, colIndex + 2).value = "VOLUME"; setBorderAndAlign(ws.getCell(6, colIndex + 2), color, true);
          
          colIndex += 3;
        });

        let currentRow = 7;
        let globalItemIndex = 1;

        const getRoman = (num) => {
          const roman = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX"];
          return roman[num - 1] || String(num);
        };

        const drawRow = (isGroup, dataArray, isChild = false) => {
           const row = ws.getRow(currentRow++);
           dataArray.forEach((val, idx) => {
              const cell = row.getCell(idx + 1);
              cell.value = val;
              cell.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
              cell.font = isGroup ? { bold: true, size: 9 } : { size: 9 };
              if (idx === 1 && !isGroup) {
                  cell.alignment = { horizontal: 'left', vertical: 'middle' };
                  if (isChild) cell.alignment.indent = 2;
              }
              else if (idx > 1) cell.alignment = { horizontal: 'center', vertical: 'middle' };
           });
           if (isGroup) {
               row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
           }
        };

        let groupCounter = 1;
        groups.forEach(group => {
           const hasGroupItems = group.items.length > 0 || (group.children && group.children.some(c => c.items.length > 0));
           if (!hasGroupItems) return;

           drawRow(true, [getRoman(groupCounter++), group.name.toUpperCase()]);

           group.items.forEach(it => {
              const hasChildren = parentIds.has(it.bvItem?.id);
              const isChild = it.bvItem?.parentBvItemId != null;
              
              const actualRapTotal = hasChildren ? parentRapSum[it.bvItem?.id] || 0 : Number(it.rapTotalPrice);
              const weight = !hasChildren && totalContract > 0 ? (actualRapTotal / totalContract) * 100 : 0;
              const unitPrice = Number(it.rapTotalPrice) / (Number(it.volume) || 1);

              

              const rowData = [
                hasChildren ? "" : globalItemIndex++,
                it.name, "", it.paymentUnit || "-",
                hasChildren ? "" : it.volume,
                hasChildren ? "" : unitPrice,
                actualRapTotal,
                hasChildren ? "" : weight / 100
              ];

              

              days.forEach(d => {
                if (hasChildren) {
                  rowData.push("", "", "");
                } else {
                  const dateStr = d.toISOString().slice(0, 10);
                  const p = it.dailyProgress.find(dp => new Date(dp.date).toISOString().slice(0,10) === dateStr);
                  const progNow = p ? Number(p.progressPercent) : 0;
                  rowData.push(progNow / 100, (progNow / 100) * weight / 100, (progNow / 100) * Number(it.volume));
                }
              });

              drawRow(hasChildren, rowData, isChild);
           });
           
           (group.children || []).forEach(sub => {
              if (sub.items.length === 0) return;
              drawRow(true, ["", sub.name]);
              sub.items.forEach(it => {
                 const hasChildren = parentIds.has(it.bvItem?.id);
                 const isChild = it.bvItem?.parentBvItemId != null;
                 
                 const actualRapTotal = hasChildren ? parentRapSum[it.bvItem?.id] || 0 : Number(it.rapTotalPrice);
                 const weight = !hasChildren && totalContract > 0 ? (actualRapTotal / totalContract) * 100 : 0;
                 const unitPrice = Number(it.rapTotalPrice) / (Number(it.volume) || 1);
                 
                 

                 const rowData = [
                   hasChildren ? "" : globalItemIndex++,
                   it.name, "", it.paymentUnit || "-",
                   hasChildren ? "" : it.volume,
                   hasChildren ? "" : unitPrice,
                   actualRapTotal,
                   hasChildren ? "" : weight / 100
                 ];

                 

                 days.forEach(d => {
                   if (hasChildren) {
                     rowData.push("", "", "");
                   } else {
                     const dateStr = d.toISOString().slice(0, 10);
                     const p = it.dailyProgress.find(dp => new Date(dp.date).toISOString().slice(0,10) === dateStr);
                     const progNow = p ? Number(p.progressPercent) : 0;
                     rowData.push(progNow / 100, (progNow / 100) * weight / 100, (progNow / 100) * Number(it.volume));
                   }
                 });

                 drawRow(hasChildren, rowData, isChild);
              });
           });
        });

        if (ungroupedItems.length > 0) {
           drawRow(true, ["", "Tanpa Group"]);
           ungroupedItems.forEach(it => {
              const hasChildren = parentIds.has(it.bvItem?.id);
              const isChild = it.bvItem?.parentBvItemId != null;
              
              const actualRapTotal = hasChildren ? parentRapSum[it.bvItem?.id] || 0 : Number(it.rapTotalPrice);
              const weight = !hasChildren && totalContract > 0 ? (actualRapTotal / totalContract) * 100 : 0;
              const unitPrice = Number(it.rapTotalPrice) / (Number(it.volume) || 1);
              
              

              const rowData = [
                hasChildren ? "" : globalItemIndex++,
                it.name, "", it.paymentUnit || "-",
                hasChildren ? "" : it.volume,
                hasChildren ? "" : unitPrice,
                actualRapTotal,
                hasChildren ? "" : weight / 100
              ];

              

              days.forEach(d => {
                if (hasChildren) {
                  rowData.push("", "", "");
                } else {
                  const dateStr = d.toISOString().slice(0, 10);
                  const p = it.dailyProgress.find(dp => new Date(dp.date).toISOString().slice(0,10) === dateStr);
                  const progNow = p ? Number(p.progressPercent) : 0;
                  rowData.push(progNow / 100, (progNow / 100) * weight / 100, (progNow / 100) * Number(it.volume));
                }
              });

              drawRow(hasChildren, rowData, isChild);
           });
        }

        ws.getColumn(1).width = 5;
        ws.getColumn(2).width = 40;
        ws.getColumn(3).width = 25;
        ws.getColumn(4).width = 8;
        ws.getColumn(5).width = 10;
        ws.getColumn(6).width = 18;
        ws.getColumn(7).width = 20;
        ws.getColumn(8).width = 10;
        
        ws.getColumn(8).numFmt = '0.00%';
        ws.getColumn(5).numFmt = '#,##0.00';
        ws.getColumn(6).numFmt = '#,##0.00';
        ws.getColumn(7).numFmt = '#,##0.00';
        
        for(let r = 7; r < currentRow; r++) {
           let cIdx = 9;
           days.forEach(d => {
             ws.getCell(r, cIdx).numFmt = '0.00%';
             ws.getCell(r, cIdx+1).numFmt = '0.00%';
             ws.getCell(r, cIdx+2).numFmt = '#,##0.00';
             cIdx += 3;
           });
        }

        let colI = 9;
        days.forEach(d => {
          ws.getColumn(colI++).width = 10; ws.getColumn(colI++).width = 10; ws.getColumn(colI++).width = 10;
        });
    }

    if (wb.worksheets.length === 0) {
        const ws = wb.addWorksheet("Kosong");
        ws.addRow(["Tidak ada data progress"]);
    }

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=\"Join_Opname_" + project.name + "_Lengkap.xlsx\"");

    await wb.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.status(500).json({ error: error.message });
  }
});

module.exports = router;
