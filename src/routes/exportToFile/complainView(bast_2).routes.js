"use strict";
const path = require("path");

// ==========================================
// KONSTANTA STYLE
// ==========================================
const PINK = "#ce0d77";
const PINK_LIGHT = "#fce4ec";
const BORDER = "#000000";
const GREY_TEXT = "#000000";
const GREY_HEADER_BG = "#e0e0e0";

const MARGIN = 20;
const MIN_ROW_H = 30;

// Ukuran tiap foto (before & after pakai ukuran sama)
const PHOTO_W = 140;
const PHOTO_H = 200;

const PHOTO_GAP = 6;
const PHOTO_COLS = 1; // 1 kolom foto per grup (before / after), nambah baris kalau foto > 1

// ==========================================
// LEBAR KOLOM (proporsional, dihitung ulang tiap render sesuai CONTENT_WIDTH)
// ==========================================
function buildColumns(contentWidth) {
  const no = 35;
  const defect = 140;
  const repairDate = 85;
  const status = 60;
  const fotoGroupW = PHOTO_COLS * PHOTO_W + (PHOTO_COLS + 1) * PHOTO_GAP;
  const fotoBefore = fotoGroupW;
  const fotoAfter = fotoGroupW;
  const report =
    contentWidth - (no + defect + fotoBefore + fotoAfter + repairDate + status);
  return { no, defect, fotoBefore, fotoAfter, repairDate, status, report };
}

function colX(COL) {
  const x0 = MARGIN;
  const x1 = x0 + COL.no;
  const x2 = x1 + COL.defect;
  const x2b = x2 + COL.fotoBefore; // batas before -> after
  const x3 = x2b + COL.fotoAfter;
  const x4 = x3 + COL.repairDate;
  const x5 = x4 + COL.status;
  const xEnd = x5 + COL.report;
  return { x0, x1, x2, x2b, x3, x4, x5, xEnd };
}

function fmtDate(d) {
  if (!d) return "-";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtPeriode(periode) {
  if (!periode || !periode.startDate) return "-";
  const opts = { month: "long", year: "numeric" };
  const start = new Date(periode.startDate).toLocaleDateString("id-ID", opts);
  if (!periode.endDate) return start;
  const end = new Date(periode.endDate).toLocaleDateString("id-ID", opts);
  return `${start} - ${end}`;
}

// ==========================================
// HEADER: LOGO + INFO PROYEK
// ==========================================
function drawHeader(doc, complaint, contentWidth) {
  const x0 = MARGIN;
  const headerH = 70;
  let y = MARGIN;

  doc.rect(x0, y, contentWidth, headerH).stroke(BORDER);

  try {
    doc.image(
      path.join(process.cwd(), "public/assets/dives.png"),
      x0 + 224,
      y + 10,
      {
        fit: [140, 50],
      },
    );
  } catch (err) {
    doc
      .font("Helvetica-Bold")
      .fontSize(20)
      .fillColor("#111111")
      .text("IVES", x0 + 14, y + 16);
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor(GREY_TEXT)
      .text("INTERIOR CONTRACTOR", x0 + 14, y + 42);
  }

  const infoX = x0 + contentWidth * 0.48;
  const labelW = 100;
  const valueX = infoX + labelW;
  const rowGap = 16;

  doc.strokeColor(BORDER).lineWidth(0.5);
  doc
    .moveTo(infoX - 10, y)
    .lineTo(infoX - 10, y + headerH)
    .stroke();

  doc.font("Helvetica-Bold").fontSize(10).fillColor("#111111");
  doc.text("NAMA PROYEK", infoX, y + 12);
  doc.text(":", infoX + labelW - 8, y + 12);
  doc.text("LOKASI PROYEK", infoX, y + 12 + rowGap);
  doc.text(":", infoX + labelW - 8, y + 12 + rowGap);
  doc.text("PERIODE", infoX, y + 12 + rowGap * 2);
  doc.text(":", infoX + labelW - 8, y + 12 + rowGap * 2);

  doc.font("Helvetica").fontSize(10).fillColor("#111111");
  doc.text(complaint.project?.name || "-", valueX, y + 12, {
    width: contentWidth - (valueX - x0) - 10,
  });
  doc.text(complaint.project?.location || "-", valueX, y + 12 + rowGap, {
    width: contentWidth - (valueX - x0) - 10,
  });
  doc.text(fmtPeriode(complaint.periode), valueX, y + 12 + rowGap * 2, {
    width: contentWidth - (valueX - x0) - 10,
  });

  y += headerH;

  doc.rect(x0, y, contentWidth, 20).fill(GREY_HEADER_BG);
  doc.rect(x0, y, contentWidth, 20).stroke(BORDER);
  doc
    .fillColor("#111111")
    .font("Helvetica-BoldOblique")
    .fontSize(12)
    .text("FORM COMPLAINT PEKERJAAN", x0, y + 5, {
      width: contentWidth,
      align: "center",
    });

  return y + 20;
}

// ==========================================
// HEADER TABEL (NO / DEFECT LIST / FOTO BEFORE / FOTO AFTER / REPAIR DATE / STATUS / REPAIR REPORT)
// ==========================================
function drawTableHeader(doc, y, COL, X) {
  const rowH = 22;

  doc.rect(X.x0, y, X.xEnd - X.x0, rowH).fill(GREY_HEADER_BG);

  doc.fillColor("#000000").font("Helvetica-Bold").fontSize(10);
  doc.text("NO", X.x0, y + rowH / 2 - 4, { width: COL.no, align: "center" });
  doc.text("DEFECT LIST", X.x1 + 4, y + rowH / 2 - 4, {
    width: COL.defect - 8,
  });
  doc.text("BEFORE", X.x2, y + rowH / 2 - 4, {
    width: COL.fotoBefore,
    align: "center",
  });
  doc.text("AFTER", X.x2b, y + rowH / 2 - 4, {
    width: COL.fotoAfter,
    align: "center",
  });
  doc.text("REPAIR DATE", X.x3, y + rowH / 2 - 4, {
    width: COL.repairDate,
    align: "center",
  });
  doc.text("STATUS", X.x4, y + rowH / 2 - 4, {
    width: COL.status,
    align: "center",
  });
  doc.text("REPAIR DEFECT REPORT", X.x5 + 4, y + rowH / 2 - 4, {
    width: COL.report - 8,
  });

  doc.strokeColor(BORDER).lineWidth(0.5);
  [X.x0, X.x1, X.x2, X.x2b, X.x3, X.x4, X.x5, X.xEnd].forEach((x) => {
    doc
      .moveTo(x, y)
      .lineTo(x, y + rowH)
      .stroke();
  });
  doc.moveTo(X.x0, y).lineTo(X.xEnd, y).stroke();
  doc
    .moveTo(X.x0, y + rowH)
    .lineTo(X.xEnd, y + rowH)
    .stroke();

  doc.font("Helvetica").fillColor(GREY_TEXT);
  return y + rowH;
}

// ==========================================
// BAR KATEGORI (pink, contoh: "PEKERJAAN KACA")
// ==========================================
function drawCategoryBar(doc, y, name, X) {
  const rowH = 18;
  doc.rect(X.x0, y, X.xEnd - X.x0, rowH).fill(PINK_LIGHT);
  doc
    .fillColor("#111111")
    .font("Helvetica-Bold")
    .fontSize(10)
    .text((name || "-").toUpperCase(), X.x0, y + 5, {
      width: X.xEnd - X.x0,
      align: "center",
    });
  doc.font("Helvetica").fillColor(GREY_TEXT);
  return y + rowH;
}

// Split photos jadi before/after. Fallback: photo tanpa type masuk "before".
function splitPhotos(photos) {
  const before = [];
  const after = [];
  (photos || []).forEach((p) => {
    if ((p.type || "").toUpperCase() === "AFTER") after.push(p);
    else before.push(p);
  });
  return { before, after };
}

// Tinggi grid foto 1 grup (before ATAU after)
function photoGridHeight(photoCount) {
  if (!photoCount) return PHOTO_H + PHOTO_GAP * 2;
  const rows = Math.ceil(photoCount / PHOTO_COLS);
  return rows * (PHOTO_H + PHOTO_GAP) + PHOTO_GAP;
}

// Hitung tinggi row total: max antara grid foto before, grid foto after, text defect, text report, minimum row
function computeRowHeight(doc, item, COL) {
  const defectH = doc.heightOfString(item.defectList || "-", {
    width: COL.defect - 8,
    fontSize: 8,
  });
  const reportH = doc.heightOfString(item.repairDefectReport || "-", {
    width: COL.report - 8,
    fontSize: 8,
  });
  const { before, after } = splitPhotos(item.photos);
  const fotoBeforeH = photoGridHeight(before.length);
  const fotoAfterH = photoGridHeight(after.length);
  return Math.max(
    MIN_ROW_H,
    defectH + 10,
    reportH + 10,
    fotoBeforeH,
    fotoAfterH,
  );
}

// Render 1 grup foto (before atau after) di dalam kolomnya
function drawPhotoGroup(doc, photos, groupX, groupW, y, rowH) {
  if (!photos || photos.length === 0) {
    doc
      .fontSize(9)
      .fillColor("#999999")
      .text("Tidak ada foto", groupX, y + rowH / 2 - 4, {
        width: groupW,
        align: "center",
      });
    return;
  }
  photos.forEach((photo, i) => {
    const col = i % PHOTO_COLS;
    const row = Math.floor(i / PHOTO_COLS);
    const px = groupX + PHOTO_GAP + col * (PHOTO_W + PHOTO_GAP);
    const py = y + PHOTO_GAP + row * (PHOTO_H + PHOTO_GAP);
    try {
      const filePath = path.join(process.cwd(), "public", photo.url);
      doc.image(filePath, px, py, {
        width: PHOTO_W,
        height: PHOTO_H,
        fit: [PHOTO_W, PHOTO_H],
      });
    } catch (err) {
      doc
        .rect(px, py, PHOTO_W, PHOTO_H)
        .stroke(BORDER)
        .fontSize(9)
        .fillColor("#999999")
        .text("Foto tidak ditemukan", px, py + PHOTO_H / 2 - 4, {
          width: PHOTO_W,
          align: "center",
        });
    }
  });
}

// ==========================================
// GAMBAR 1 ROW ITEM
// ==========================================
function drawItemRow(doc, y, rowH, item, no, COL, X) {
  doc.strokeColor(BORDER).lineWidth(0.5);
  [X.x0, X.x1, X.x2, X.x2b, X.x3, X.x4, X.x5, X.xEnd].forEach((x) => {
    doc
      .moveTo(x, y)
      .lineTo(x, y + rowH)
      .stroke();
  });
  doc
    .moveTo(X.x0, y + rowH)
    .lineTo(X.xEnd, y + rowH)
    .stroke();

  doc.font("Helvetica").fontSize(10).fillColor(GREY_TEXT);

  // NO
  doc.text(String(no), X.x0, y + 6, { width: COL.no, align: "center" });

  // DEFECT LIST
  doc.text(item.defectList || "-", X.x1 + 4, y + 6, { width: COL.defect - 8 });

  // FOTO BEFORE / AFTER
  const { before, after } = splitPhotos(item.photos);
  drawPhotoGroup(doc, before, X.x2, COL.fotoBefore, y, rowH);
  drawPhotoGroup(doc, after, X.x2b, COL.fotoAfter, y, rowH);

  // REPAIR DATE
  doc
    .fontSize(10)
    .fillColor(GREY_TEXT)
    .text(fmtDate(item.repairDate), X.x3, y + 6, {
      width: COL.repairDate,
      align: "center",
    });

  // STATUS (checkbox)
  const boxSize = 10;
  const boxX = X.x4 + COL.status / 2 - boxSize / 2;
  const boxY = y + 6;
  doc.rect(boxX, boxY, boxSize, boxSize).stroke(BORDER);
  if (item.status) {
    doc.rect(boxX + 2, boxY + 2, boxSize - 4, boxSize - 4).fill(PINK);
  }

  // REPAIR DEFECT REPORT
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor(GREY_TEXT)
    .text(item.repairDefectReport || "-", X.x5 + 4, y + 6, {
      width: COL.report - 8,
    });
}

// ==========================================
// MAIN: STREAM PDF KE RESPONSE
// ==========================================
function streamComplaintPdff(complaint, res) {
  const PDFDocument = require("pdfkit");
  const doc = new PDFDocument({
    size: "A3",
    layout: "landscape",
    margin: MARGIN,
  });
  doc.pipe(res);

  const contentWidth = doc.page.width - MARGIN * 2;
  const COL = buildColumns(contentWidth);
  const X = colX(COL);
  const pageBottom = doc.page.height - MARGIN;

  let y = drawHeader(doc, complaint, contentWidth);
  y = drawTableHeader(doc, y, COL, X);

  (complaint.categories || []).forEach((category) => {
    if (y + 18 > pageBottom) {
      doc.addPage();
      y = MARGIN;
      y = drawTableHeader(doc, y, COL, X);
    }
    y = drawCategoryBar(doc, y, category.name, X);

    (category.items || []).forEach((item, idx) => {
      const rowH = computeRowHeight(doc, item, COL);

      if (y + rowH > pageBottom) {
        doc.addPage();
        y = MARGIN;
        y = drawTableHeader(doc, y, COL, X);
      }

      drawItemRow(doc, y, rowH, item, idx + 1, COL, X);
      y += rowH;
    });
  });

  doc.end();
}

module.exports = { streamComplaintPdff };
