"use strict";
const express = require("express");
const router = express.Router();
const { PrismaClient } = require("@prisma/client");
const PDFDocument = require("pdfkit");
const path = require("path");
const fs = require("fs");

const prisma = new PrismaClient();

// ==========================================
// KONSTANTA STYLE
// ==========================================
const BORDER = "#000000";
const GREY_TEXT = "#000000";
const GREY_HEADER_BG = "#e0e0e0";
const PINK_LIGHT = "#fce4ec";

const MARGIN = 20;
const MIN_ROW_H = 30;

const PHOTO_W = 60;
const PHOTO_H = 80;
const PHOTO_GAP = 6;
const PHOTO_COLS = 2; 

function buildColumns(contentWidth) {
  const no = 30;
  const vol = 50;
  const bobot = 50;
  const progNow = 60;
  const progRekap = 60;
  const status = 60;
  const foto = PHOTO_COLS * PHOTO_W + (PHOTO_COLS + 1) * PHOTO_GAP;
  const pekerjan = contentWidth - (no + vol + bobot + progNow + progRekap + status + foto);
  return { no, pekerjan, foto, vol, bobot, progNow, progRekap, status };
}

function colX(COL) {
  const x0 = MARGIN;
  const x1 = x0 + COL.no;
  const x2 = x1 + COL.pekerjan;
  const x3 = x2 + COL.foto;
  const x4 = x3 + COL.vol;
  const x5 = x4 + COL.bobot;
  const x6 = x5 + COL.progNow;
  const x7 = x6 + COL.progRekap;
  const xEnd = x7 + COL.status;
  return { x0, x1, x2, x3, x4, x5, x6, x7, xEnd };
}

function formatPercent(num) {
  return Number(num || 0).toFixed(2);
}

function formatNumber(num) {
  return Number(num || 0).toLocaleString("id-ID");
}

function fmtDate(d) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function drawHeader(doc, project, contentWidth, targetDate, titleText) {
  const x0 = MARGIN;
  const headerH = 70;
  let y = MARGIN;

  doc.rect(x0, y, contentWidth, headerH).stroke(BORDER);

  try {
    const logoPath = path.join(process.cwd(), "public/assets/dives.png");
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, x0 + 10, y + 10, { fit: [140, 50] });
    } else {
      throw new Error("Logo not found");
    }
  } catch (err) {
    doc.font("Helvetica-Bold").fontSize(20).fillColor("#111111").text("IVES", x0 + 14, y + 16);
    doc.font("Helvetica").fontSize(9).fillColor(GREY_TEXT).text("INTERIOR CONTRACTOR", x0 + 14, y + 42);
  }

  // Draw vertical line separator for info
  doc.moveTo(x0 + 180, y).lineTo(x0 + 180, y + headerH).stroke(BORDER);

  const infoX = x0 + 190;
  const labelW = 100;
  const valueX = infoX + labelW;
  const rowGap = 20;

  doc.font("Helvetica-Bold").fontSize(8).fillColor(GREY_TEXT);
  doc.text("NAMA PROJECT", infoX, y + 12);
  doc.text(":", infoX + labelW - 8, y + 12);
  doc.text("LOKASI PROYEK", infoX, y + 12 + rowGap);
  doc.text(":", infoX + labelW - 8, y + 12 + rowGap);
  doc.text("TANGGAL OPNAME", infoX, y + 12 + rowGap * 2);
  doc.text(":", infoX + labelW - 8, y + 12 + rowGap * 2);

  doc.font("Helvetica").fontSize(9).fillColor("#111111");
  doc.text(project?.name || "-", valueX, y + 12, { width: contentWidth - (valueX - x0) - 10 });
  doc.text(project?.location || "-", valueX, y + 12 + rowGap, { width: contentWidth - (valueX - x0) - 10 });
  doc.text(fmtDate(targetDate), valueX, y + 12 + rowGap * 2, { width: contentWidth - (valueX - x0) - 10 });

  y += headerH;

  doc.rect(x0, y, contentWidth, 20).fillAndStroke(GREY_HEADER_BG, BORDER);
  doc.fillColor("#111111").font("Helvetica-Bold").fontSize(12).text(titleText, x0, y + 5, { width: contentWidth, align: "center" });

  return y + 20;
}

function drawTableHeader(doc, y, COL, X) {
  const rowH = 22;
  doc.rect(X.x0, y, X.xEnd - X.x0, rowH).fillAndStroke(GREY_HEADER_BG, BORDER);
  doc.fillColor("#000000").font("Helvetica-Bold").fontSize(8);
  
  doc.text("NO", X.x0, y + 6, { width: COL.no, align: "center" });
  doc.text("PEKERJAAN", X.x1 + 4, y + 6, { width: COL.pekerjan - 8 });
  doc.text("PHOTO DOKUMENTASI", X.x2, y + 6, { width: COL.foto, align: "center" });
  doc.text("VOL AKTUAL", X.x3, y + 6, { width: COL.vol, align: "center" });
  doc.text("BOBOT %", X.x4, y + 6, { width: COL.bobot, align: "center" });
  doc.text("PROG SAAT INI", X.x5, y + 6, { width: COL.progNow, align: "center" });
  doc.text("PROG REKAP", X.x6, y + 6, { width: COL.progRekap, align: "center" });
  doc.text("STATUS", X.x7, y + 6, { width: COL.status, align: "center" });

  const xs = [X.x1, X.x2, X.x3, X.x4, X.x5, X.x6, X.x7];
  xs.forEach((x) => doc.moveTo(x, y).lineTo(x, y + rowH).stroke(BORDER));

  return y + rowH;
}

function drawCategoryBar(doc, y, name, X) {
  const rowH = 18;
  doc.rect(X.x0, y, X.xEnd - X.x0, rowH).fillAndStroke(PINK_LIGHT, BORDER);
  doc.fillColor("#111111").font("Helvetica-Bold").fontSize(10).text((name || "-").toUpperCase(), X.x0, y + 5, { width: X.xEnd - X.x0, align: "center" });
  doc.font("Helvetica").fillColor(GREY_TEXT);
  return y + rowH;
}

function photoGridHeight(photoCount) {
  if (!photoCount) return MIN_ROW_H;
  const rows = Math.ceil(photoCount / PHOTO_COLS);
  return rows * (PHOTO_H + PHOTO_GAP) + PHOTO_GAP;
}

function computeRowHeight(doc, item, COL) {
  if (item.hasChildren) {
    const titleH = doc.heightOfString(item.name || "-", { width: COL.pekerjan + COL.foto - 8, fontSize: 8 });
    return Math.max(MIN_ROW_H, titleH + 10);
  }
  const nameH = doc.heightOfString(item.name || "-", { width: COL.pekerjan - (item.isChild ? 16 : 8), fontSize: 8 });
  const fotoH = photoGridHeight((item.photos || []).length);
  return Math.max(MIN_ROW_H, nameH + 10, fotoH);
}

function drawItemRow(doc, y, rowH, item, no, COL, X) {
  doc.strokeColor(BORDER).lineWidth(0.5);

  if (item.hasChildren) {
    doc.rect(X.x0, y, X.xEnd - X.x0, rowH).fillAndStroke("#dbeafe", BORDER);
    
    [X.x0, X.x1, X.x3, X.x4, X.x5, X.x6, X.x7, X.xEnd].forEach((x) => {
      doc.moveTo(x, y).lineTo(x, y + rowH).stroke(BORDER);
    });
    doc.moveTo(X.x0, y + rowH).lineTo(X.xEnd, y + rowH).stroke(BORDER);

    doc.font("Helvetica-Bold").fontSize(8).fillColor(GREY_TEXT);
    doc.text(String(no), X.x0, y + 6, { width: COL.no, align: "center" });
    doc.text(item.name, X.x1 + 4, y + 6, { width: COL.pekerjan + COL.foto - 8 });
    
    doc.fillColor(GREY_TEXT).font("Helvetica-Bold").fontSize(8);
    doc.text(formatNumber(item.volNow), X.x3, y + 6, { width: COL.vol, align: "center" });
    doc.text(formatPercent(item.weight) + "%", X.x4, y + 6, { width: COL.bobot, align: "center" });
    doc.text(formatPercent(item.progNow) + "%", X.x5, y + 6, { width: COL.progNow, align: "center" });
    doc.text(formatPercent(item.rekapProgress) + "%", X.x6, y + 6, { width: COL.progRekap, align: "center" });
    doc.text(item.status, X.x7, y + 6, { width: COL.status, align: "center" });
    return;
  }

  [X.x0, X.x1, X.x2, X.x3, X.x4, X.x5, X.x6, X.x7, X.xEnd].forEach((x) => {
    doc.moveTo(x, y).lineTo(x, y + rowH).stroke(BORDER);
  });
  doc.moveTo(X.x0, y + rowH).lineTo(X.xEnd, y + rowH).stroke(BORDER);

  doc.font("Helvetica").fontSize(8).fillColor(GREY_TEXT);

  doc.text(String(no), X.x0, y + 6, { width: COL.no, align: "center" });
  
  let indent = item.isChild ? 10 : 4;
  doc.text(item.name, X.x1 + indent, y + 6, { width: COL.pekerjan - indent - 4 });
  
  const photos = item.photos || [];
  if (photos.length === 0) {
    doc.fontSize(8).fillColor("#999999").text("Tidak ada foto", X.x2, y + rowH / 2 - 4, { width: COL.foto, align: "center" });
  } else {
    photos.forEach((photo, i) => {
      const col = i % PHOTO_COLS;
      const row = Math.floor(i / PHOTO_COLS);
      const px = X.x2 + PHOTO_GAP + col * (PHOTO_W + PHOTO_GAP);
      const py = y + PHOTO_GAP + row * (PHOTO_H + PHOTO_GAP);
      try {
        const filePath = path.join(process.cwd(), "public", photo);
        if (fs.existsSync(filePath)) {
           doc.image(filePath, px, py, { width: PHOTO_W, height: PHOTO_H, fit: [PHOTO_W, PHOTO_H] });
        } else {
           throw new Error("Missing");
        }
      } catch (err) {
        doc.rect(px, py, PHOTO_W, PHOTO_H).stroke(BORDER).fontSize(8).fillColor("#999999")
           .text("Foto tidak ditemukan", px, py + PHOTO_H / 2 - 4, { width: PHOTO_W, align: "center" });
      }
    });
  }

  doc.fillColor(GREY_TEXT).font("Helvetica").fontSize(8);
  doc.text(formatNumber(item.volNow), X.x3, y + 6, { width: COL.vol, align: "center" });
  doc.text(formatPercent(item.weight) + "%", X.x4, y + 6, { width: COL.bobot, align: "center" });
  doc.text(formatPercent(item.progNow) + "%", X.x5, y + 6, { width: COL.progNow, align: "center" });
  doc.text(formatPercent(item.rekapProgress) + "%", X.x6, y + 6, { width: COL.progRekap, align: "center" });
  doc.text(item.status, X.x7, y + 6, { width: COL.status, align: "center" });
}

router.get("/:projectId/join-opname/export/pdf", async (req, res) => {
  try {
    const { projectId } = req.params;
    const { discipline, date, type = "daily" } = req.query;

    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return res.status(404).send("Project not found");

    const targetDate = date ? new Date(date) : new Date();

    const groups = await prisma.rabGroup.findMany({
      where: { projectId, parentId: null },
      include: {
        items: {
          include: { dailyProgress: true, bvItem: { select: { id: true, parentBvItemId: true } } },
          orderBy: { order: "asc" }
        },
        children: {
          include: {
            items: {
              include: { dailyProgress: true, bvItem: { select: { id: true, parentBvItemId: true } } },
              orderBy: { order: "asc" }
            }
          },
          orderBy: { order: "asc" }
        }
      },
      orderBy: { order: "asc" }
    });

    const ungroupedItems = await prisma.rabItem.findMany({
      where: {
        projectId,
        groupId: null,
      },
      include: {
        dailyProgress: true,
        bvItem: { select: { id: true, parentBvItemId: true } },
      },
      orderBy: { order: "asc" },
    });

    let rawRabItems = [];
    groups.forEach((group) => {
      rawRabItems.push(...group.items.map((it) => ({ ...it, groupName: group.name.toUpperCase() })));
      (group.children || []).forEach((sub) => {
        rawRabItems.push(...sub.items.map((it) => ({ ...it, groupName: sub.name })));
      });
    });
    rawRabItems.push(...ungroupedItems.map((it) => ({ ...it, groupName: "Tanpa Group" })));

    let rabItems = rawRabItems;
    if (discipline && discipline !== "General") {
      const target = discipline.toLowerCase();
      rabItems = rawRabItems.filter(it => {
         if ((it.discipline || "").toLowerCase() === target) return true;
         const children = rawRabItems.filter(child => child.bvItem?.parentBvItemId === it.bvItem?.id);
         if (children.length > 0 && children.some(c => (c.discipline || "").toLowerCase() === target)) return true;
         return false;
      });
    }

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

    const projectStartDate = project.startDate ? new Date(project.startDate) : targetDate;
    projectStartDate.setHours(0,0,0,0);
    const targetTime = targetDate.getTime();
    const diffTime = Math.abs(targetTime - projectStartDate.getTime());
    const targetDayNumber = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

    // Build Categories
    const categories = [];

    // Helper to get item data for a specific date range
    const getItemsForDateRange = (startDate, endDate) => {
      const items = [];
      const sStr = new Date(startDate.getTime() - startDate.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
      const eStr = new Date(endDate.getTime() - endDate.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

      const processed = rabItems.map(it => {
        const hasChildren = parentIds.has(it.bvItem?.id);
        const actualRapTotal = hasChildren ? parentRapSum[it.bvItem?.id] || 0 : Number(it.rapTotalPrice);
        const weight = totalContract > 0 ? (actualRapTotal / totalContract) * 100 : 0;
        
        let maxProgressSoFar = 0;
        let progNow = 0;
        let photos = [];
        let hasActivity = false;

        (it.dailyProgress || []).forEach(p => {
          const pStr = new Date(p.date).toISOString().slice(0, 10);
          const pVal = Number(p.progressPercent);
          if (pVal > maxProgressSoFar) maxProgressSoFar = pVal;
          if (pStr >= sStr && pStr <= eStr) {
             hasActivity = true;
             if (pVal > progNow) progNow = pVal;
             if (p.photoUrls && p.photoUrls.length > 0) {
               photos = photos.concat(p.photoUrls);
             }
          }
        });
        
        return { it, hasChildren, actualRapTotal, weight, maxProgressSoFar, progNow, photos, hasActivity };
      });

      const parentRekapSum = {};
      const parentProgNowSum = {};
      processed.forEach(data => {
         if (!data.hasChildren && data.it.bvItem?.parentBvItemId) {
            const pId = data.it.bvItem.parentBvItemId;
            parentRekapSum[pId] = (parentRekapSum[pId] || 0) + (data.actualRapTotal * (data.maxProgressSoFar / 100));
            parentProgNowSum[pId] = (parentProgNowSum[pId] || 0) + (data.actualRapTotal * (data.progNow / 100));
         }
      });

      processed.forEach(data => {
        let rekapProgress = data.maxProgressSoFar;
        let progNow = data.progNow;
        let volNow = (data.progNow / 100) * Number(data.it.volume);
        
        if (data.hasChildren) {
           const pId = data.it.bvItem?.id;
           rekapProgress = data.actualRapTotal > 0 ? ((parentRekapSum[pId] || 0) / data.actualRapTotal) * 100 : 0;
           progNow = data.actualRapTotal > 0 ? ((parentProgNowSum[pId] || 0) / data.actualRapTotal) * 100 : 0;
           volNow = 0; 
        }

        let status = "ON PROGRESS";
        if (rekapProgress === 0) status = "BELUM MULAI";
        else if (rekapProgress >= 100) status = "SELESAI";

        if (data.hasActivity || data.hasChildren) {
          items.push({
            id: data.it.bvItem?.id,
            parentBvItemId: data.it.bvItem?.parentBvItemId,
            name: data.it.name,
            volNow,
            weight: data.weight,
            progNow,
            rekapProgress,
            status,
            photos: data.photos,
            hasChildren: data.hasChildren,
            isChild: data.it.bvItem?.parentBvItemId != null,
            groupName: data.it.groupName
          });
        }
      });

      return items.filter(it => {
         if (!it.hasChildren) return true;
         return items.some(child => child.isChild && child.parentBvItemId === it.id);
      });
    };

    if (type === "daily") {
      const s = new Date(targetDate); s.setHours(0,0,0,0);
      const items = getItemsForDateRange(s, s);
      categories.push({ name: `HARI ${targetDayNumber} - ${fmtDate(s)}`, items });
    } else if (type === "weekly") {
      const weekNum = Math.ceil(targetDayNumber / 7);
      const startDay = (weekNum - 1) * 7;
      for (let i = 0; i < 7; i++) {
        const currentD = new Date(projectStartDate);
        currentD.setDate(currentD.getDate() + startDay + i);
        currentD.setHours(0,0,0,0);
        const items = getItemsForDateRange(currentD, currentD);
        categories.push({ name: `HARI ${startDay + i + 1} - ${fmtDate(currentD)}`, items });
      }
    } else if (type === "monthly") {
      const targetMonth = targetDate.getMonth();
      const targetYear = targetDate.getFullYear();
      let weekCounter = 1;
      let d = new Date(targetYear, targetMonth, 1);
      
      while (d.getMonth() === targetMonth) {
        const startOfWeek = new Date(d);
        const endOfWeek = new Date(d);
        endOfWeek.setDate(endOfWeek.getDate() + 6);
        
        // If endOfWeek overflows to next month, cap it
        if (endOfWeek.getMonth() !== targetMonth) {
           endOfWeek.setDate(new Date(targetYear, targetMonth + 1, 0).getDate());
        }

        const items = getItemsForDateRange(startOfWeek, endOfWeek);
        categories.push({ name: `MINGGU ${weekCounter} (${fmtDate(startOfWeek)} - ${fmtDate(endOfWeek)})`, items });
        
        d.setDate(endOfWeek.getDate() + 1);
        weekCounter++;
      }
    } else if (type === "overall") {
      // Get max end date of the project
      let maxDate = projectStartDate;
      rabItems.forEach(it => {
        (it.dailyProgress || []).forEach(p => {
          const pd = new Date(p.date);
          if (pd > maxDate) maxDate = pd;
        });
      });
      const totalDays = Math.ceil((maxDate.getTime() - projectStartDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      const totalWeeks = Math.ceil(totalDays / 7);
      
      for (let i = 0; i < totalWeeks; i++) {
        const startOfWeek = new Date(projectStartDate);
        startOfWeek.setDate(startOfWeek.getDate() + i * 7);
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(endOfWeek.getDate() + 6);
        
        const items = getItemsForDateRange(startOfWeek, endOfWeek);
        categories.push({ name: `MINGGU ${i + 1} (${fmtDate(startOfWeek)} - ${fmtDate(endOfWeek)})`, items });
      }
    }

    const doc = new PDFDocument({ size: "A4", layout: "portrait", margin: MARGIN });
    const titleType = { "daily": "HARIAN", "weekly": "MINGGUAN", "monthly": "BULANAN", "overall": "KESELURUHAN" }[type];
    const fullTitle = `LAPORAN JOIN OPNAME - ${titleType}${discipline && discipline !== "General" ? " - " + discipline.toUpperCase() : ""}`;
    const fileName = `Join_Opname_${project.name}_${titleType}_${fmtDate(targetDate)}.pdf`;
    res.setHeader("Content-disposition", `inline; filename="${fileName}"`);
    res.setHeader("Content-type", "application/pdf");
    doc.pipe(res);

    const PAGE_W = doc.page.width;
    const contentWidth = PAGE_W - MARGIN * 2;
    const COL = buildColumns(contentWidth);
    const X = colX(COL);
    const pageBottom = doc.page.height - MARGIN;

    let currentY = drawHeader(doc, project, contentWidth, targetDate, fullTitle);
    currentY = drawTableHeader(doc, currentY, COL, X);

    categories.forEach((category) => {
      if (currentY + 18 > pageBottom) {
        doc.addPage();
        currentY = MARGIN;
        currentY = drawTableHeader(doc, currentY, COL, X);
      }
      currentY = drawCategoryBar(doc, currentY, category.name, X);

      if (category.items.length === 0) {
        doc.rect(X.x0, currentY, X.xEnd - X.x0, MIN_ROW_H).stroke(BORDER);
        doc.font("Helvetica").fontSize(9).fillColor(GREY_TEXT)
           .text("Tidak ada aktivitas pada periode ini", X.x0, currentY + 10, { align: "center", width: X.xEnd - X.x0 });
        currentY += MIN_ROW_H;
      } else {
        // Grouping by groupName
        const grouped = new Map();
        category.items.forEach(it => {
          const g = it.groupName || "Tanpa Group";
          if (!grouped.has(g)) grouped.set(g, []);
          grouped.get(g).push(it);
        });

        Array.from(grouped.entries()).forEach(([gName, gItems]) => {
          // Draw Sub-Group Row
          doc.rect(X.x0, currentY, X.xEnd - X.x0, MIN_ROW_H).fillAndStroke("#fef3c7", BORDER);
          doc.font("Helvetica-Bold").fontSize(9).fillColor(GREY_TEXT).text(gName, X.x0 + 5, currentY + 10, { width: X.xEnd - X.x0 });
          currentY += MIN_ROW_H;
          
          let pCounter = 1;
          gItems.forEach((item) => {
            let noToPrint = "-";
            if (item.hasChildren || (!item.hasChildren && !item.isChild)) {
               noToPrint = String(pCounter++);
            }

            const rowH = computeRowHeight(doc, item, COL);
            if (currentY + rowH > pageBottom) {
              doc.addPage();
              currentY = MARGIN;
              currentY = drawTableHeader(doc, currentY, COL, X);
            }
            drawItemRow(doc, currentY, rowH, item, noToPrint, COL, X);
            currentY += rowH;
          });
        });
      }
    });
    
    if (categories.length === 0) {
      doc.font("Helvetica").fontSize(10).fillColor(GREY_TEXT).text("Tidak ada data progress pada periode ini.", X.x0, currentY + 20, { align: "center", width: contentWidth });
    }

    doc.end();
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.status(500).json({ error: error.message });
  }
});

module.exports = router;
