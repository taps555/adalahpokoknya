"use strict";
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

const PINK = "#e91e8c";
const PINK_LIGHT = "#f6c6e0";
const GREY_TEXT = "#222222";
const RED_INFO = "#c0117a";
const BORDER = "#999999";

const PAGE_MARGIN = 30;
const PAGE_WIDTH = 841.89; // A4 LANDSCAPE
const PAGE_HEIGHT = 595.28;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;

const COL = {
  no: 24,
  keterangan: 90,
  foto: 250,
  ukuran: 110,
  analisa: 0,
};
COL.analisa = CONTENT_WIDTH - COL.no - COL.keterangan - COL.foto - COL.ukuran;

// Grid foto: 4 kolom, tinggi tiap thumbnail tetap kecil biar muat banyak (maks 20/area)
const PHOTO_GRID_COLS = 2; // Diubah menjadi 2 kolom (kiri dan kanan)
const PHOTO_CELL_H = 75; // Disesuaikan menjadi lebih tinggi (misal 100) karena foto sekarang lebih lebar. Silakan ubah jika kurang pas.
const PHOTO_GRID_PAD = 2;
const PHOTO_GRID_GAP = 3;

// Kolom UKURAN: setiap baris dimensi = 1 label "LUASAN" + 1 baris nilai P/L/T/V
const UKURAN_SUBCOLS = 4; // P, L, T, V
const UKURAN_LABEL_H = 12;
const UKURAN_VALUE_H = 14;

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
// HEADER TABEL
// ==========================================
function drawTableHeader(doc, y) {
  const { x0, x1, x2, x3, x4, xEnd } = colX();
  const rowH1 = 16;
  const rowH2 = 13;
  const totalH = rowH1 + rowH2;
  const ukuranSubW = COL.ukuran / UKURAN_SUBCOLS;

  doc.rect(x0, y, CONTENT_WIDTH, rowH1).fill(PINK);
  doc.rect(x0, y + rowH1, COL.no, rowH2).fill(PINK);
  doc.rect(x1, y + rowH1, COL.keterangan, rowH2).fill(PINK);
  doc.rect(x2, y + rowH1, COL.foto, rowH2).fill(PINK);
  doc.rect(x4, y + rowH1, COL.analisa, rowH2).fill(PINK);
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
  ["P", "L", "T", "V"].forEach((lab, i) => {
    doc.text(lab, x3 + i * ukuranSubW, y + rowH1 + 3, {
      width: ukuranSubW,
      align: "center",
    });
  });

  doc.strokeColor(BORDER).lineWidth(0.5);
  [
    x0,
    x1,
    x2,
    x3,
    x3 + ukuranSubW,
    x3 + ukuranSubW * 2,
    x3 + ukuranSubW * 3,
    x4,
    xEnd,
  ].forEach((x) => {
    doc
      .moveTo(x, y)
      .lineTo(x, y + totalH)
      .stroke();
  });
  doc.moveTo(x0, y).lineTo(xEnd, y).stroke();
  doc
    .moveTo(x3, y + rowH1)
    .lineTo(x4, y + rowH1)
    .stroke();
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
// Grid foto DINAMIS: 4 kolom, N baris (maks 20 foto/area -> 5 baris)
// ==========================================
function getPhotoList(area) {
  if (area.photos && area.photos.length) return area.photos;
  if (area.photoUrl) return [{ url: area.photoUrl }];
  return [];
}
function photoGridHeight(area, width) {
  const photos = getPhotoList(area);
  const count = Math.max(photos.length, 1); // minimal 1 baris walau kosong (nampilin placeholder)
  const rows = Math.ceil(count / PHOTO_GRID_COLS);
  let h =
    rows * PHOTO_CELL_H + (rows - 1) * PHOTO_GRID_GAP + PHOTO_GRID_PAD * 2;

  if (area.photoCaption) {
    h += 4 + Math.ceil(area.photoCaption.length / 40) * 8 + 4;
  }
  return h;
}

function drawPhotoGrid(doc, area, x, y, width) {
  const photos = getPhotoList(area);
  const cellW =
    (width - PHOTO_GRID_PAD * 2 - PHOTO_GRID_GAP * (PHOTO_GRID_COLS - 1)) /
    PHOTO_GRID_COLS;

  if (photos.length === 0) {
    doc
      .rect(x + PHOTO_GRID_PAD, y, width - PHOTO_GRID_PAD * 2, PHOTO_CELL_H)
      .fillAndStroke("#f2f2f2", "#cccccc");
    doc
      .fillColor("#aaaaaa")
      .fontSize(7)
      .font("Helvetica-Oblique")
      .text("Tidak ada foto", x + PHOTO_GRID_PAD, y + PHOTO_CELL_H / 2 - 4, {
        width: width - PHOTO_GRID_PAD * 2,
        align: "center",
      });
    doc.fillColor(GREY_TEXT).font("Helvetica");
    return y + PHOTO_CELL_H + PHOTO_GRID_PAD;
  }

  photos.forEach((photo, i) => {
    // Logika ini otomatis akan membuat foto turun ke bawah setelah 2 kolom terisi
    const row = Math.floor(i / PHOTO_GRID_COLS);
    const col = i % PHOTO_GRID_COLS;
    const cx = x + PHOTO_GRID_PAD + col * (cellW + PHOTO_GRID_GAP);
    const cy = y + row * (PHOTO_CELL_H + PHOTO_GRID_GAP);
    const filePath = resolvePhotoPath(photo.url);

    if (filePath) {
      doc.image(filePath, cx, cy, {
        width: cellW,
        height: PHOTO_CELL_H,
        fit: [cellW, PHOTO_CELL_H],
      });
      doc.rect(cx, cy, cellW, PHOTO_CELL_H).stroke("#cccccc");
    } else {
      doc.rect(cx, cy, cellW, PHOTO_CELL_H).fillAndStroke("#f2f2f2", "#cccccc");
      doc
        .fillColor("#aaaaaa")
        .fontSize(5.5)
        .font("Helvetica-Oblique")
        .text("Gagal muat", cx, cy + PHOTO_CELL_H / 2 - 3, {
          width: cellW,
          align: "center",
        });
      doc.fillColor(GREY_TEXT).font("Helvetica");
    }
  });

  const rows = Math.ceil(photos.length / PHOTO_GRID_COLS);
  let gridBottom = y + rows * PHOTO_CELL_H + (rows - 1) * PHOTO_GRID_GAP;

  if (area.photoCaption) {
    doc.font("Helvetica-Bold").fontSize(7).fillColor(GREY_TEXT);
    const capH = doc.heightOfString(area.photoCaption.toUpperCase(), {
      width: width - PHOTO_GRID_PAD * 2,
      align: "center",
    });
    doc.text(
      area.photoCaption.toUpperCase(),
      x + PHOTO_GRID_PAD,
      gridBottom + 4,
      {
        width: width - PHOTO_GRID_PAD * 2,
        align: "center",
      },
    );
    doc.font("Helvetica");
    gridBottom += 4 + capH;
  }

  return gridBottom;
}

// ==========================================
// Kolom UKURAN
// ==========================================
function drawUkuranColumn(doc, dims, x, y, width) {
  const subW = width / UKURAN_SUBCOLS;

  if (!dims || dims.length === 0) {
    doc.rect(x, y, width, UKURAN_VALUE_H).stroke(BORDER);
    doc.fontSize(7.5).text("-", x, y + 4, { width, align: "center" });
    return y + UKURAN_VALUE_H;
  }

  let cy = y;
  dims.forEach((d) => {
    doc.rect(x, cy, width, UKURAN_LABEL_H).fill(PINK);
    doc
      .fillColor("#fff")
      .font("Helvetica-Bold")
      .fontSize(6.5)
      .text("LUASAN", x, cy + 3, { width, align: "center" });
    cy += UKURAN_LABEL_H;

    const vals = [
      fmtNum(d.panjang),
      fmtNum(d.lebar),
      fmtNum(d.tinggi),
      fmtNum(d.luasan),
    ];
    doc.font("Helvetica").fontSize(7.5).fillColor(GREY_TEXT);
    vals.forEach((v, i) => {
      doc.rect(x + i * subW, cy, subW, UKURAN_VALUE_H).stroke(BORDER);
      doc.text(v, x + i * subW, cy + 4, { width: subW, align: "center" });
    });
    cy += UKURAN_VALUE_H;
  });

  return cy;
}

function ukuranColumnHeight(dims) {
  if (!dims || dims.length === 0) return UKURAN_VALUE_H;
  return dims.length * (UKURAN_LABEL_H + UKURAN_VALUE_H);
}

// ==========================================
// Kolom ANALISA
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
// 1 baris area penuh
// ==========================================
// ==========================================
// Kapasitas 1 halaman (dipakai buat deteksi row yang butuh di-split)
// ==========================================
function tableHeaderHeight() {
  return 16 + 13; // rowH1 + rowH2, harus sama persis kayak di drawTableHeader
}

function maxContentHeightFreshPage() {
  // Tinggi maksimal konten row kalau start dari atas halaman baru,
  // langsung setelah table header, sebelum kena margin bawah.
  return PAGE_HEIGHT - PAGE_MARGIN * 2 - tableHeaderHeight();
}

function computePhotoCapacityPerChunk(maxHeight) {
  const rows = Math.floor(
    (maxHeight - PHOTO_GRID_PAD * 2 + PHOTO_GRID_GAP) /
      (PHOTO_CELL_H + PHOTO_GRID_GAP),
  );
  return Math.max(rows, 1) * PHOTO_GRID_COLS;
}

// ==========================================
// 1 baris area penuh (dispatcher)
// ==========================================
function drawAreaRow(doc, area, index, y) {
  const fotoH = photoGridHeight(area, COL.foto);
  const ukuranH = ukuranColumnHeight(area.dimensions);
  const analisaH = analisaColumnHeight(doc, area, COL.analisa);

  doc.font("Helvetica-Bold").fontSize(7.5);
  const ketH = doc.heightOfString(area.areaName || "-", {
    width: COL.keterangan - 8,
  });

  const rowH = Math.max(fotoH, ukuranH, analisaH, ketH) + 10;
  const maxFresh = maxContentHeightFreshPage() - 10;

  if (rowH <= maxFresh) {
    // Muat di 1 halaman (current atau fresh) -> jalur normal, aman.
    return drawAreaRowSingle(doc, area, index, y, rowH);
  }

  // Row lebih tinggi dari 1 halaman penuh -> WAJIB di-split.
  // NOTE: split ini nge-handle kasus fotonya kebanyakan (kasus paling umum).
  // Kalau suatu saat teks UKURAN atau ANALISA sendirian aja udah lebih
  // tinggi dari 1 halaman (jarang, tapi mungkin), itu belum ke-cover di sini
  // -> perlu split terpisah kalau kejadian, bilang aja nanti.
  return drawAreaRowSplit(doc, area, index, y, {
    ukuranH,
    analisaH,
    ketH,
    maxFresh,
  });
}

// ==========================================
// Jalur normal: row muat di 1 halaman
// (ini isinya sama persis kayak drawAreaRow versi sebelumnya)
// ==========================================
function drawAreaRowSingle(doc, area, index, y, rowH) {
  const { x0, x1, x2, x3, x4, xEnd } = colX();

  y = ensureSpace(doc, y, rowH + 40, (d, ny) => drawTableHeader(d, ny));

  const originalBottomMargin = doc.page.margins.bottom;
  doc.page.margins.bottom = -9999;

  doc.font("Helvetica-Bold").fontSize(8).fillColor(GREY_TEXT);
  doc.text(String(index + 1), x0, y + 5, { width: COL.no, align: "center" });

  doc
    .font("Helvetica-Bold")
    .fontSize(7.5)
    .text(area.areaName || "-", x1 + 4, y + 5, { width: COL.keterangan - 8 });

  drawPhotoGrid(doc, area, x2, y + 4, COL.foto);
  drawUkuranColumn(doc, area.dimensions, x3, y + 4, COL.ukuran);
  drawAnalisaColumn(doc, area, x4, y + 4, COL.analisa);

  doc.strokeColor(BORDER).lineWidth(0.5);
  const ukuranSubW = COL.ukuran / UKURAN_SUBCOLS;
  [
    x0,
    x1,
    x2,
    x3,
    x3 + ukuranSubW,
    x3 + ukuranSubW * 2,
    x3 + ukuranSubW * 3,
    x4,
    xEnd,
  ].forEach((x) => {
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

  doc.page.margins.bottom = originalBottomMargin;
  doc.fillColor(GREY_TEXT).font("Helvetica");
  return y + rowH;
}

// ==========================================
// Jalur split: row lebih tinggi dari 1 halaman -> foto dipecah per chunk
// ==========================================
function maxContentHeightContinuationPage() {
  // Halaman lanjutan gak ada pita header pink, jadi ruangnya lebih lega
  // dibanding halaman pertama yang harus nyisain tempat buat header.
  return PAGE_HEIGHT - PAGE_MARGIN * 2;
}

function drawAreaRowSplit(doc, area, index, y, heights) {
  const { x0, x1, x2, x3, x4, xEnd } = colX();
  const photos = getPhotoList(area);
  const bottomLimit = PAGE_HEIGHT - PAGE_MARGIN;

  // Ruang yang MASIH ADA di halaman sekarang (y ini posisi setelah header
  // yang udah kepasang duluan sama caller / streamSurveyPdf).
  const remainingOnCurrentPage = bottomLimit - y - 10;

  // Tinggi minimal yang WAJIB muat buat chunk pertama: minimal 1 baris
  // foto (kalau ada foto), digabung sama ukuran/analisa/keterangan yang
  // emang harus nampil bareng di chunk pertama (mereka kolom terpisah,
  // jadi gak numpuk tinggi, cuma diambil yang paling tinggi).
  const minPhotoRowH =
    photos.length > 0 ? PHOTO_CELL_H + PHOTO_GRID_PAD * 2 : 0;
  const minFirstChunkH = Math.max(
    minPhotoRowH,
    heights.ukuranH,
    heights.analisaH,
    heights.ketH,
  );

  // Cuma pindah halaman kalau ruang sisa BENERAN gak cukup buat chunk
  // pertama yang berguna. Kalau masih cukup, pakai halaman sekarang,
  // gak usah gambar header baru (headernya udah ada di atas, dari caller).
  const needNewPage = remainingOnCurrentPage < minFirstChunkH;

  if (needNewPage) {
    doc.addPage({ size: "A4", layout: "landscape", margin: PAGE_MARGIN });
    y = drawTableHeader(doc, PAGE_MARGIN);
  }

  const maxFreshFirst = needNewPage ? heights.maxFresh : remainingOnCurrentPage;
  const maxFreshCont = maxContentHeightContinuationPage() - 10;

  const capacityFirstChunk = computePhotoCapacityPerChunk(maxFreshFirst);
  const capacityContChunk = computePhotoCapacityPerChunk(maxFreshCont);

  let photoIdx = 0;
  let firstChunk = true;

  while (photoIdx < photos.length || firstChunk) {
    const capacity = firstChunk ? capacityFirstChunk : capacityContChunk;
    const chunkPhotos = photos.slice(photoIdx, photoIdx + capacity);
    const chunkArea = firstChunk
      ? { ...area, photos: chunkPhotos }
      : { photos: chunkPhotos };

    const chunkFotoH = photoGridHeight(chunkArea, COL.foto);
    const chunkRowH = firstChunk
      ? Math.max(chunkFotoH, heights.ukuranH, heights.analisaH, heights.ketH) +
        10
      : chunkFotoH + 10;

    const originalBottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = -9999;

    doc.font("Helvetica-Bold").fontSize(8).fillColor(GREY_TEXT);
    doc.text(firstChunk ? String(index + 1) : "", x0, y + 5, {
      width: COL.no,
      align: "center",
    });

    doc
      .font("Helvetica-Bold")
      .fontSize(7.5)
      .text(
        firstChunk ? area.areaName || "-" : "(lanjutan foto)",
        x1 + 4,
        y + 5,
        {
          width: COL.keterangan - 8,
        },
      );

    drawPhotoGrid(doc, chunkArea, x2, y + 4, COL.foto);

    if (firstChunk) {
      drawUkuranColumn(doc, area.dimensions, x3, y + 4, COL.ukuran);
      drawAnalisaColumn(doc, area, x4, y + 4, COL.analisa);
    }

    doc.strokeColor(BORDER).lineWidth(0.5);
    const ukuranSubW = COL.ukuran / UKURAN_SUBCOLS;
    [
      x0,
      x1,
      x2,
      x3,
      x3 + ukuranSubW,
      x3 + ukuranSubW * 2,
      x3 + ukuranSubW * 3,
      x4,
      xEnd,
    ].forEach((x) => {
      doc
        .moveTo(x, y)
        .lineTo(x, y + chunkRowH)
        .stroke();
    });
    doc.moveTo(x0, y).lineTo(xEnd, y).stroke();
    doc
      .moveTo(x0, y + chunkRowH)
      .lineTo(xEnd, y + chunkRowH)
      .stroke();

    doc.page.margins.bottom = originalBottomMargin;
    doc.fillColor(GREY_TEXT).font("Helvetica");

    y += chunkRowH;
    photoIdx += capacity;
    firstChunk = false;

    if (photoIdx < photos.length) {
      doc.addPage({ size: "A4", layout: "landscape", margin: PAGE_MARGIN });
      y = PAGE_MARGIN; // lanjutan: tanpa header
    }
  }

  return y;
}
// ==========================================
// META INFO
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

  const LABEL_X = PAGE_MARGIN;
  const COLON_X = PAGE_MARGIN + 110; // atur sesuai lebar label terpanjang
  const VALUE_X = COLON_X + 12;
  const LINE_HEIGHT = 12;

  doc.fontSize(8.5);
  rows.forEach(([label, value], i) => {
    const rowY = y + i * LINE_HEIGHT;
    doc.font("Helvetica-Bold").text(label, LABEL_X, rowY);
    doc.font("Helvetica-Bold").text(":", COLON_X, rowY);
    doc.font("Helvetica").text(String(value), VALUE_X, rowY);
  });

  return y + rows.length * LINE_HEIGHT;
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
  y += 55;

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
  doc.font("Helvetica-Bold").text("SURVEYOR", PAGE_MARGIN, doc.y + 4, {
    width: CONTENT_WIDTH,
    align: "right",
  });
  doc
    .font("Helvetica")
    .text(survey.surveyorName || "-", PAGE_MARGIN, doc.y + 50, {
      width: CONTENT_WIDTH,
      align: "right",
    });

  doc.end();
}

module.exports = { streamSurveyPdf };
