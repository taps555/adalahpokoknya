"use strict";
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

const PINK = "#e91e8c";
const PINK_LIGHT = "#f6c6e0";
const GREY_TEXT = "#222222";
const RED_INFO = "#c0117a"; // warna "informasi tambahan" di contoh (magenta/merah)
const BORDER = "#999999";

const PAGE_MARGIN = 30;
const PAGE_WIDTH = 841.89; // A4 LANDSCAPE (tabelnya lebar banget di contoh -> landscape lebih pas)
const PAGE_HEIGHT = 595.28;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;

// Lebar kolom (total harus = CONTENT_WIDTH)
const COL = {
  no: 24,
  keterangan: 90,
  foto: 190,
  ukuran: 110, // dibagi 3: T, L, V
  analisa: 0, // diisi belakangan (sisa)
};
COL.analisa = CONTENT_WIDTH - COL.no - COL.keterangan - COL.foto - COL.ukuran;

function colX() {
  const x0 = PAGE_MARGIN;
  const x1 = x0 + COL.no;
  const x2 = x1 + COL.keterangan;
  const x3 = x2 + COL.foto;
  const x4 = x3 + COL.ukuran;
  return { x0, x1, x2, x3, x4, xEnd: x4 + COL.analisa };
}

function fmtNum(n) {
  if (n === null || n === undefined) return "-";
  return Number(n).toLocaleString("id-ID", { maximumFractionDigits: 4 });
}

function fmtDate(d) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function resolvePhotoPath(url) {
  if (!url) return null;
  const filePath = path.join(process.cwd(), "public", url);
  return fs.existsSync(filePath) ? filePath : null;
}

// ==========================================
// HEADER TABEL (2 baris: judul kolom + sub-kolom T/L/V), dipanggil ulang tiap halaman baru
// ==========================================
function drawTableHeader(doc, y) {
  const { x0, x1, x2, x3, x4, xEnd } = colX();
  const rowH1 = 16;
  const rowH2 = 13;
  const totalH = rowH1 + rowH2;

  // Background pink penuh row 1
  doc.rect(x0, y, CONTENT_WIDTH, rowH1).fill(PINK);
  // Kolom yang merge 2 baris (NO, KETERANGAN, FOTO, ANALISA) - lanjutin pink ke row2
  doc.rect(x0, y + rowH1, COL.no, rowH2).fill(PINK);
  doc.rect(x1, y + rowH1, COL.keterangan, rowH2).fill(PINK);
  doc.rect(x2, y + rowH1, COL.foto, rowH2).fill(PINK);
  doc.rect(x4, y + rowH1, COL.analisa, rowH2).fill(PINK);
  // Sub-header T/L/V - pink lebih muda
  doc.rect(x3, y + rowH1, COL.ukuran, rowH2).fill(PINK_LIGHT);

  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(8);
  doc.text("NO", x0, y + totalH / 2 - 4, { width: COL.no, align: "center" });
  doc.text("KETERANGAN", x1 + 4, y + totalH / 2 - 4, {
    width: COL.keterangan - 8,
  });
  doc.text("FOTO LAPANGAN", x2, y + totalH / 2 - 4, {
    width: COL.foto,
    align: "center",
  });
  doc.text("UKURAN (Meter)", x3, y + 4, { width: COL.ukuran, align: "center" });
  doc.text("ANALISA", x4 + 4, y + totalH / 2 - 4, { width: COL.analisa - 8 });

  doc.fillColor(GREY_TEXT).fontSize(7.5);
  const subW = COL.ukuran / 3;
  ["T", "L", "V"].forEach((lab, i) => {
    doc.text(lab, x3 + i * subW, y + rowH1 + 3, {
      width: subW,
      align: "center",
    });
  });

  // Border grid
  doc.strokeColor(BORDER).lineWidth(0.5);
  [x0, x1, x2, x3, x3 + subW, x3 + subW * 2, x4, xEnd].forEach((x) => {
    doc
      .moveTo(x, y)
      .lineTo(x, y + totalH)
      .stroke();
  });
  doc.moveTo(x0, y).lineTo(xEnd, y).stroke();
  doc
    .moveTo(x3, y + rowH1)
    .lineTo(x4, y + rowH1)
    .stroke(); // pemisah UKURAN vs sub T/L/V
  doc
    .moveTo(x0, y + totalH)
    .lineTo(xEnd, y + totalH)
    .stroke();

  doc.font("Helvetica").fillColor(GREY_TEXT);
  return y + totalH;
}

function ensureSpace(doc, y, needed, onNewPage) {
  const bottomLimit = PAGE_HEIGHT - PAGE_MARGIN;
  if (y + needed > bottomLimit) {
    doc.addPage({ size: "A4", layout: "landscape", margin: PAGE_MARGIN });
    let ny = PAGE_MARGIN;
    if (onNewPage) ny = onNewPage(doc, ny);
    return ny;
  }
  return y;
}

// ==========================================
// Grid foto 2x2 + caption
// ==========================================
function drawPhotoGrid(doc, area, x, y, width) {
  const photos = (
    area.photos && area.photos.length
      ? area.photos
      : area.photoUrl
        ? [{ url: area.photoUrl }]
        : []
  ).slice(0, 4);

  const pad = 4;
  const gap = 3;
  const cellW = (width - pad * 2 - gap) / 2;
  const cellH = 50;

  for (let i = 0; i < 4; i++) {
    const row = Math.floor(i / 2);
    const col = i % 2;
    const cx = x + pad + col * (cellW + gap);
    const cy = y + row * (cellH + gap);
    const photo = photos[i];
    const filePath = photo ? resolvePhotoPath(photo.url) : null;

    if (filePath) {
      doc.image(filePath, cx, cy, {
        width: cellW,
        height: cellH,
        fit: [cellW, cellH],
      });
      doc.rect(cx, cy, cellW, cellH).stroke("#cccccc");
    } else {
      doc.rect(cx, cy, cellW, cellH).fillAndStroke("#f2f2f2", "#cccccc");
      doc
        .fillColor("#aaaaaa")
        .fontSize(6.5)
        .font("Helvetica-Oblique")
        .text(photo ? "Gagal muat foto" : "-", cx, cy + cellH / 2 - 4, {
          width: cellW,
          align: "center",
        });
      doc.fillColor(GREY_TEXT).font("Helvetica");
    }
  }

  let gridBottom = y + cellH * 2 + gap;

  if (area.photoCaption) {
    doc.font("Helvetica-Bold").fontSize(7).fillColor(GREY_TEXT);
    const capH = doc.heightOfString(area.photoCaption.toUpperCase(), {
      width: width - pad * 2,
      align: "center",
    });
    doc.text(area.photoCaption.toUpperCase(), x + pad, gridBottom + 4, {
      width: width - pad * 2,
      align: "center",
    });
    doc.font("Helvetica");
    gridBottom = gridBottom + 4 + capH;
  }

  return gridBottom;
}

function photoGridHeight(area, width) {
  const pad = 4;
  const gap = 3;
  const cellH = 50;
  let h = cellH * 2 + gap;
  if (area.photoCaption) {
    // estimasi tinggi caption (dihitung ulang presisi pas drawing via doc, ini cuma perkiraan buat sizing row)
    h += 4 + Math.ceil(area.photoCaption.length / 40) * 9 + 4;
  }
  return h + 8;
}

// ==========================================
// Kolom UKURAN: per dimensi -> label "LUASAN" (pink) + baris angka T/L/V
// ==========================================
function drawUkuranColumn(doc, dims, x, y, width) {
  const subW = width / 3;
  const labelH = 12;
  const valueH = 14;

  if (!dims || dims.length === 0) {
    doc.rect(x, y, width, valueH).stroke(BORDER);
    doc.fontSize(7.5).text("-", x, y + 4, { width, align: "center" });
    return y + valueH;
  }

  let cy = y;
  dims.forEach((d) => {
    // label LUASAN
    doc.rect(x, cy, width, labelH).fill(PINK);
    doc
      .fillColor("#fff")
      .font("Helvetica-Bold")
      .fontSize(6.5)
      .text("LUASAN", x, cy + 3, { width, align: "center" });
    cy += labelH;

    // baris angka T | L | V
    const vals = [fmtNum(d.tinggi), fmtNum(d.lebar), fmtNum(d.luasan)];
    doc.font("Helvetica").fontSize(7.5).fillColor(GREY_TEXT);
    vals.forEach((v, i) => {
      doc.rect(x + i * subW, cy, subW, valueH).stroke(BORDER);
      doc.text(v, x + i * subW, cy + 4, { width: subW, align: "center" });
    });
    cy += valueH;
  });

  return cy;
}

function ukuranColumnHeight(dims) {
  const labelH = 12;
  const valueH = 14;
  if (!dims || dims.length === 0) return valueH;
  return dims.length * (labelH + valueH);
}

// ==========================================
// Kolom ANALISA: DATA LOKASI / PENANGANAN / info tambahan (merah)
// ==========================================
function drawAnalisaColumn(doc, area, x, y, width) {
  const sections = [
    { label: "DATA LOKASI", text: area.analisa, color: GREY_TEXT },
    { label: "PENANGANAN", text: area.penanganan, color: GREY_TEXT },
    {
      label: "informasi tambahan:",
      text: area.informasiTambahan,
      color: RED_INFO,
      plainLabel: true,
    },
  ];

  let cy = y;
  sections.forEach((s) => {
    if (!s.text) return;
    if (s.plainLabel) {
      doc
        .font("Helvetica-Bold")
        .fontSize(7)
        .fillColor(GREY_TEXT)
        .text(s.label, x + 4, cy);
      cy = doc.y + 1;
    } else {
      doc.rect(x, cy, width, 12).fill(PINK_LIGHT);
      doc
        .font("Helvetica-Bold")
        .fontSize(7)
        .fillColor(GREY_TEXT)
        .text(s.label, x + 4, cy + 3);
      cy += 12 + 2;
    }
    doc.font("Helvetica").fontSize(7.5).fillColor(s.color);
    const h = doc.heightOfString(s.text, { width: width - 8 });
    doc.text(s.text, x + 4, cy, { width: width - 8 });
    cy += h + 6;
  });

  doc.fillColor(GREY_TEXT).font("Helvetica");
  return cy;
}

function analisaColumnHeight(doc, area, width) {
  const sections = [
    { text: area.analisa, plainLabel: false },
    { text: area.penanganan, plainLabel: false },
    { text: area.informasiTambahan, plainLabel: true },
  ];
  let h = 0;
  doc.font("Helvetica").fontSize(7.5);
  sections.forEach((s) => {
    if (!s.text) return;
    h += s.plainLabel ? 11 : 14;
    h += doc.heightOfString(s.text, { width: width - 8 }) + 6;
  });
  return h;
}

// ==========================================
// 1 baris area penuh (NO | KETERANGAN | FOTO | UKURAN | ANALISA)
// ==========================================
function drawAreaRow(doc, area, index, y) {
  const { x0, x1, x2, x3, x4, xEnd } = colX();

  const fotoH = photoGridHeight(area, COL.foto);
  const ukuranH = ukuranColumnHeight(area.dimensions);
  const analisaH = analisaColumnHeight(doc, area, COL.analisa);
  const ketH = doc.heightOfString(area.areaName || "-", {
    width: COL.keterangan - 8,
  });

  const rowH = Math.max(fotoH, ukuranH, analisaH, ketH) + 10;

  y = ensureSpace(doc, y, rowH + 40, (d, ny) => drawTableHeader(d, ny));

  // NO
  doc.font("Helvetica-Bold").fontSize(8).fillColor(GREY_TEXT);
  doc.text(String(index + 1), x0, y + 5, { width: COL.no, align: "center" });

  // KETERANGAN
  doc
    .font("Helvetica-Bold")
    .fontSize(7.5)
    .text(area.areaName || "-", x1 + 4, y + 5, { width: COL.keterangan - 8 });

  // FOTO
  drawPhotoGrid(doc, area, x2, y + 4, COL.foto);

  // UKURAN
  drawUkuranColumn(doc, area.dimensions, x3, y + 4, COL.ukuran);

  // ANALISA
  drawAnalisaColumn(doc, area, x4, y + 4, COL.analisa);

  // Border luar row + garis vertikal antar kolom
  doc.strokeColor(BORDER).lineWidth(0.5);
  const subW = COL.ukuran / 3;
  [x0, x1, x2, x3, x3 + subW, x3 + subW * 2, x4, xEnd].forEach((x) => {
    doc
      .moveTo(x, y)
      .lineTo(x, y + rowH)
      .stroke();
  });
  doc.moveTo(x0, y).lineTo(xEnd, y).stroke();
  doc
    .moveTo(x0, y + rowH)
    .lineTo(xEnd, y + rowH)
    .stroke();

  doc.fillColor(GREY_TEXT).font("Helvetica");
  return y + rowH;
}

// ==========================================
// META INFO (KATEGORI/JENIS/LOKASI/TANGGAL/SURVEYOR)
// ==========================================
function drawMetaInfo(doc, survey, y) {
  const rows = [
    [
      "KATEGORI PROYEK",
      survey.project?.category || survey.project?.name || "-",
    ],
    ["JENIS PROYEK", survey.project?.type || survey.notes || "-"],
    ["LOKASI PROYEK", survey.project?.location || "-"],
    ["TANGGAL / WAKTU", fmtDate(survey.surveyDate)],
    ["SURVEYOR", survey.surveyorName || "-"],
  ];

  doc.fontSize(8.5);
  rows.forEach(([label, value]) => {
    doc
      .font("Helvetica-Bold")
      .text(label, PAGE_MARGIN, y, { width: 120, continued: true });
    doc.font("Helvetica").text(`: ${value}`);
    y = doc.y + 1;
  });
  return y + 10;
}

/**
 * Entry point utama.
 * @param {object} survey - hasil query prisma dgn include: areas.dimensions, areas.photos, project
 * @param {import('stream').Writable} outStream
 */
function streamSurveyPdf(survey, outStream) {
  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin: PAGE_MARGIN,
    bufferPages: true,
  });
  doc.pipe(outStream);

  let y = PAGE_MARGIN;

  // --- Area logo: DIKOSONGIN DULU, tinggal isi doc.image(path, x, y, {width}) di sini nanti ---
  y += 55; // spasi kosong buat logo, samain tinggi kira2 kayak contoh

  // Header bar pink judul
  doc.rect(PAGE_MARGIN, y, CONTENT_WIDTH, 22).fill(PINK);
  doc
    .fillColor("#fff")
    .font("Helvetica-Bold")
    .fontSize(12)
    .text("DATA SURVEY LAPANGAN", PAGE_MARGIN, y + 6, {
      width: CONTENT_WIDTH,
      align: "center",
    });
  doc.fillColor(GREY_TEXT).font("Helvetica");
  y += 22 + 10;

  y = drawMetaInfo(doc, survey, y);
  y = drawTableHeader(doc, y);

  (survey.areas || []).forEach((area, i) => {
    y = drawAreaRow(doc, area, i, y);
  });

  // Footer tanda tangan
  y = ensureSpace(doc, y, 90, (d, ny) => ny);
  doc
    .fontSize(9)
    .text(
      `${survey.project?.location || "Surabaya"}, ${fmtDate(survey.surveyDate)}`,
      PAGE_MARGIN,
      y + 10,
      { width: CONTENT_WIDTH, align: "right" },
    );
  doc.text("Dibuat Oleh", PAGE_MARGIN, doc.y + 2, {
    width: CONTENT_WIDTH,
    align: "right",
  });
  doc
    .font("Helvetica-Bold")
    .text("SURVEYOR", PAGE_MARGIN, doc.y + 40, {
      width: CONTENT_WIDTH,
      align: "right",
    });
  doc
    .font("Helvetica")
    .text(survey.surveyorName || "-", PAGE_MARGIN, doc.y + 2, {
      width: CONTENT_WIDTH,
      align: "right",
    });

  doc.end();
}

module.exports = { streamSurveyPdf };
