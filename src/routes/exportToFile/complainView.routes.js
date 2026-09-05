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

// UBAH DUA NILAI INI MENJADI LEBIH BESAR
const PHOTO_W = 210; // Lebarkan agar mengisi ruang kanan (sesuaikan jika kolom lebih lebar)
const PHOTO_H = 280; // Tinggikan drastis karena foto Anda berbentuk portrait (berdiri)

const PHOTO_GAP = 6;
const PHOTO_COLS = 2; // Jika ingin 2 foto bersebelahan, nilai W 210 sudah cukup besar

// ==========================================
// LEBAR KOLOM (proporsional, dihitung ulang tiap render sesuai CONTENT_WIDTH)
// ==========================================
function buildColumns(contentWidth) {
  const no = 35;
  const defect = 140;
  const repairDate = 85;
  const status = 60;
  const foto = PHOTO_COLS * PHOTO_W + (PHOTO_COLS + 1) * PHOTO_GAP;
  const report = contentWidth - (no + defect + foto + repairDate + status);
  return { no, defect, foto, repairDate, status, report };
}

function colX(COL) {
  const x0 = MARGIN;
  const x1 = x0 + COL.no;
  const x2 = x1 + COL.defect;
  const x3 = x2 + COL.foto;
  const x4 = x3 + COL.repairDate;
  const x5 = x4 + COL.status;
  const xEnd = x5 + COL.report;
  return { x0, x1, x2, x3, x4, x5, xEnd };
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

  // Kolom kiri: nama perusahaan (placeholder teks, ganti doc.image() kalau ada file logo)
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
    // fallback teks kalau file logo gak ketemu
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

  // Kolom kanan: NAMA PROYEK / LOKASI PROYEK / PERIODE
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

  // Bar judul form
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
// HEADER TABEL (NO / DEFECT LIST / FOTO / REPAIR DATE / STATUS / REPAIR REPORT)
// Dipanggil ulang tiap ganti halaman biar tetep kebaca.
// ==========================================
function drawTableHeader(doc, y, COL, X) {
  const rowH = 22;

  doc.rect(X.x0, y, X.xEnd - X.x0, rowH).fill(GREY_HEADER_BG);

  doc.fillColor("#000000").font("Helvetica-Bold").fontSize(10);
  doc.text("NO", X.x0, y + rowH / 2 - 4, { width: COL.no, align: "center" });
  doc.text("DEFECT LIST", X.x1 + 4, y + rowH / 2 - 4, {
    width: COL.defect - 8,
  });
  doc.text("PHOTO DOKUMENTASI", X.x2, y + rowH / 2 - 4, {
    width: COL.foto,
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
  [X.x0, X.x1, X.x2, X.x3, X.x4, X.x5, X.xEnd].forEach((x) => {
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

// Hitung tinggi grid foto sesuai jumlah foto (2 kolom, nambah baris otomatis)
function photoGridHeight(photoCount) {
  if (!photoCount) return PHOTO_H + PHOTO_GAP * 2;
  const rows = Math.ceil(photoCount / PHOTO_COLS);
  return rows * (PHOTO_H + PHOTO_GAP) + PHOTO_GAP;
}

// Hitung tinggi row total: max antara grid foto, text defect, text report, minimum row
function computeRowHeight(doc, item, COL) {
  const defectH = doc.heightOfString(item.defectList || "-", {
    width: COL.defect - 8,
    fontSize: 8,
  });
  const reportH = doc.heightOfString(item.repairDefectReport || "-", {
    width: COL.report - 8,
    fontSize: 8,
  });
  const fotoH = photoGridHeight(
    (item.photos || []).filter((p) => p.type === "BEFORE").length,
  );
  return Math.max(MIN_ROW_H, defectH + 10, reportH + 10, fotoH);
}

// ==========================================
// GAMBAR 1 ROW ITEM
// ==========================================
function drawItemRow(doc, y, rowH, item, no, COL, X) {
  // border sel
  doc.strokeColor(BORDER).lineWidth(0.5);
  [X.x0, X.x1, X.x2, X.x3, X.x4, X.x5, X.xEnd].forEach((x) => {
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

  // FOTO (HANYA BEFORE)
  const photos = (item.photos || []).filter((p) => p.type === "BEFORE");
  if (photos.length === 0) {
    doc
      .fontSize(10)
      .fillColor("#999999")
      .text("Tidak ada foto", X.x2, y + rowH / 2 - 4, {
        width: COL.foto,
        align: "center",
      });
  } else {
    photos.forEach((photo, i) => {
      const col = i % PHOTO_COLS;
      const row = Math.floor(i / PHOTO_COLS);
      const px = X.x2 + PHOTO_GAP + col * (PHOTO_W + PHOTO_GAP);
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
          .fontSize(10)
          .fillColor("#999999")
          .text("Foto tidak ditemukan", px, py + PHOTO_H / 2 - 4, {
            width: PHOTO_W,
            align: "center",
          });
      }
    });
  }

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
function streamComplaintPdf(complaint, res) {
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
    // kalau bar kategori bakal kepotong, pindah halaman dulu
    if (y + 18 > pageBottom) {
      doc.addPage();
      y = MARGIN;
      y = drawTableHeader(doc, y, COL, X);
    }
    y = drawCategoryBar(doc, y, category.name, X);

    (category.items || []).forEach((item, idx) => {
      const rowH = computeRowHeight(doc, item, COL);

      // kalau row gak muat sisa halaman, pindah halaman & ulang header tabel
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

module.exports = { streamComplaintPdf };
