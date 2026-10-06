"use strict";

const express = require("express");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
const prisma = require("../../lib/prisma");

const router = express.Router();

/* ------------------------------------------------------------------ */
/* Konstanta                                                          */
/* ------------------------------------------------------------------ */

const ASSET_DIR = path.join(
  __dirname,
  "../../../public/templates/design-quotation",
);
const FONT_DIR = path.join(__dirname, "../../../fonts");

const A4 = { w: 595.28, h: 841.89 };
const LETTER = { w: 612, h: 792 }; // Halaman rincian di template DOCX = US Letter

const COLORS = {
  ink: "#000000",
  muted: "#665747",
  cream: "#F5F0E8",
  taupe: "#DBDBDB",
  line: "#000000",
};

const COMPANY = {
  name: "PT. DIVES JAYA PERKASA",
  signer: "JIMMY CHRISTIAN, S.Ds.",
  signerTitle: "Direktur Utama",
  phone: "0818-813-134",
  email: "@djp.incon@gmail.com",
  about:
    "Jasa desain interior dan perencanaan ruang melalui Design 3D serta DED (Gambar 2D).",
};

// [key, nama terdaftar, file, fallback bawaan PDFKit]
const FONT_DEFS = [
  ["regular", "Arial", "arial.ttf", "Helvetica"],
  ["bold", "Arial-Bold", "arialbd.ttf", "Helvetica-Bold"],
];

// Geometri tabel halaman rincian
const TABLE = {
  x: 50.75,
  y: 145,
  cols: [35.7, 112, 128.8, 36.4, 36.4, 78.4, 78.4],
  align: ["center", "left", "left", "center", "center", "right", "right"],
  headerH: 16.5,
  rowH: 9,
  spacerH: 9.05,
  summaryH: 9,
  outerWidth: 2.25,
  dashWidth: 0.75,
};

const TERMS = [
  "- Revisi Desain Maximal 2x (Perubahan Konsep, Layout, dll) yang bersifat perubahan besar.",
  "- Revisi Ringan (Penyesuaian Warna, Material, Aksen dan Aksesoris) bebas dan sewajarnya.",
  "- Lama waktu perencanaan design layout adalah 7 hari kerja.",
  "- Lama waktu pengerjaan desain visual 3D adalah 45 hari kerja (untuk asistensi pertama).",
  "- Lama waktu pengerjaan gambar detail 2D adalah 4-6 hari kerja setelah gambar 3D disetujui.",
  "- File gambar 3D berupa JPG, PDF, dan SKP (SketchUp); file gambar 2D berupa PDF.",
];

const PAYMENT_TERMS = [
  "- Pembayaran Full Payment di awal sebagai tanda jadi.",
  `- Apabila pekerjaan dilanjutkan oleh ${COMPANY.name}, pembayaran terhitung sebagai uang masuk pekerjaan.`,
  "- Biaya perjalanan dan tempat tinggal selama survey ditanggung klien.",
];

/* ------------------------------------------------------------------ */
/* Helper umum                                                        */
/* ------------------------------------------------------------------ */

const sum = (arr) => arr.reduce((a, b) => a + b, 0);

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function money(value) {
  return `Rp ${Math.round(toNumber(value)).toLocaleString("id-ID")}`;
}

function number(value, digits = 2) {
  return toNumber(value).toLocaleString("id-ID", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

function dateText(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function safeFileName(value) {
  return String(value || "Design-Quotation")
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 100);
}

function asset(name) {
  const filePath = path.join(ASSET_DIR, name);
  return fs.existsSync(filePath) ? filePath : null;
}

/** Gambar aset kalau file-nya ada; return true bila tergambar. */
function placeImage(doc, name, x, y, options) {
  const file = asset(name);
  if (file) doc.image(file, x, y, options);
  return Boolean(file);
}

function sumSurveyArea(survey) {
  return (survey?.areas ?? [])
    .flatMap((area) => area.dimensions ?? [])
    .reduce((total, dimension) => total + toNumber(dimension.luasan), 0);
}

function quotationTotals(quotation) {
  const item3dTotal =
    toNumber(quotation.item3dVolume) * toNumber(quotation.item3dPrice);
  const item2dTotal =
    toNumber(quotation.item2dVolume) * toNumber(quotation.item2dPrice);
  const subtotal = item3dTotal + item2dTotal;
  const discount = Math.max(0, toNumber(quotation.discount));
  const total = Math.max(0, subtotal - discount);
  return { item3dTotal, item2dTotal, subtotal, discount, total };
}

/* ------------------------------------------------------------------ */
/* Font                                                               */
/* ------------------------------------------------------------------ */

/** Daftarkan Arial sekali per dokumen; fallback ke Helvetica kalau file tidak ada. */
function registerFonts(doc) {
  const fonts = {};
  for (const [key, name, file, fallback] of FONT_DEFS) {
    fonts[key] = fallback;
    const filePath = path.join(FONT_DIR, file);
    if (!fs.existsSync(filePath)) continue;
    try {
      doc.registerFont(name, filePath);
      fonts[key] = name;
    } catch (error) {
      console.warn(
        `Template font ${name} tidak dapat didaftarkan:`,
        error.message,
      );
    }
  }
  return fonts;
}

/* ------------------------------------------------------------------ */
/* Primitif gambar                                                    */
/* ------------------------------------------------------------------ */

function drawCell(
  doc,
  fonts,
  text,
  x,
  y,
  width,
  { bold = false, align = "left" } = {},
) {
  doc
    .fillColor(COLORS.ink)
    .font(bold ? fonts.bold : fonts.regular)
    .fontSize(7.5)
    .text(String(text ?? ""), x + 2, y + 0.5, {
      width: width - 4,
      align,
      lineBreak: false,
      ellipsis: true,
    });
}

function drawDashedLine(doc, x1, y1, x2, y2) {
  doc
    .save()
    .lineWidth(TABLE.dashWidth)
    .strokeColor(COLORS.line)
    .dash(2, { space: 2 });
  doc.moveTo(x1, y1).lineTo(x2, y2).stroke();
  doc.undash().restore();
}

function drawOuterRect(doc, x, y, width, height) {
  doc
    .save()
    .lineWidth(TABLE.outerWidth)
    .strokeColor(COLORS.line)
    .rect(x, y, width, height)
    .stroke()
    .restore();
}

/** Judul bold + daftar baris. Return posisi Y setelah blok. */
function drawTextBlock(doc, fonts, title, lines, x, y, width) {
  doc.fillColor(COLORS.ink).font(fonts.bold).fontSize(7.5).text(title, x, y);
  doc.font(fonts.regular).text(lines.join("\n"), x, y + 10, { width });
  return doc.y;
}

/* ------------------------------------------------------------------ */
/* Halaman 1: Cover                                                   */
/* ------------------------------------------------------------------ */

function drawCover(doc, fonts, quotation) {
  doc.rect(0, 0, A4.w, A4.h).fill(COLORS.cream);

  // Foto arsitektur berbentuk lingkaran
  const photo = asset("image1.png");
  if (photo) {
    doc.save();
    doc.circle(205, 365, 192).clip();
    doc.image(photo, 13, 173, { width: 384, height: 384, fit: [384, 384] });
    doc.restore();
  }

  placeImage(doc, "image2.png", 390, 64, { width: 130, fit: [130, 80] });

  doc
    .fillColor(COLORS.ink)
    .font(fonts.bold)
    .fontSize(48)
    .text("QUOTATION", 55, 92, {
      characterSpacing: 0.5,
    });

  const projectName = String(quotation.project?.name || "-").toUpperCase();
  const projectLocation = String(
    quotation.project?.location || "-",
  ).toUpperCase();
  doc
    .font(fonts.bold)
    .fontSize(12)
    .text(projectName, 58, 155, { width: 280, lineGap: 3 });
  doc
    .font(fonts.regular)
    .fontSize(10)
    .fillColor(COLORS.muted)
    .text(projectLocation, 58, 173, { width: 280 });

  doc
    .fillColor(COLORS.ink)
    .font(fonts.bold)
    .fontSize(17)
    .text("ABOUT US", 58, 590);
  doc
    .font(fonts.regular)
    .fontSize(9.5)
    .fillColor(COLORS.muted)
    .text(COMPANY.about, 58, 617, {
      width: 235,
      lineGap: 3,
    });

  placeImage(doc, "image6.png", 58, 676, {
    width: 12,
    height: 12,
    fit: [12, 12],
  });
  placeImage(doc, "image7.png", 58, 698, {
    width: 12,
    height: 12,
    fit: [12, 12],
  });
  doc.fillColor(COLORS.ink).font(fonts.regular).fontSize(10);
  doc.text(COMPANY.phone, 77, 676);
  doc.text(COMPANY.email, 77, 698);

  placeImage(doc, "image5.png", 390, 730, { width: 120, fit: [120, 80] });
  doc
    .fillColor(COLORS.muted)
    .font(fonts.bold)
    .fontSize(8)
    .text(dateText(quotation.quotationDate), 58, 785);
}

/* ------------------------------------------------------------------ */
/* Halaman 2: Rincian Anggaran Biaya                                  */
/* ------------------------------------------------------------------ */

function drawDetailsPage(doc, fonts, quotation) {
  doc.addPage({ size: [LETTER.w, LETTER.h], margin: 0 });

  const {
    x: tableX,
    y: tableY,
    cols,
    align,
    headerH,
    rowH,
    spacerH,
    summaryH,
  } = TABLE;
  const tableW = sum(cols);
  const colX = cols.map((_, i) => tableX + sum(cols.slice(0, i)));
  const subHeaderY = tableY + headerH / 2;

  const totals = quotationTotals(quotation);
  const projectName = quotation.project?.name || "-";
  const projectLocation = quotation.project?.location || "-";
  const year = new Date(quotation.quotationDate || Date.now()).getFullYear();

  // --- Kop ---
  placeImage(doc, "image8.png", (LETTER.w - 105) / 2, 25, {
    width: 105,
    fit: [105, 34],
  });

  doc
    .fillColor(COLORS.ink)
    .font(fonts.bold)
    .fontSize(10)
    .text("RINCIAN ANGGARAN BIAYA DESIGN", tableX, 76, {
      width: tableW,
      align: "center",
    });

  doc.font(fonts.regular).fontSize(7.5);
  [
    ["Nama Kegiatan", "Jasa Desain 3D dan DED (Gambar 2D)"],
    ["Nama Pekerjaan", projectName],
    ["Lokasi Pekerjaan", projectLocation],
    ["Tahun Anggaran", year],
  ].forEach(([label, value], i) => {
    doc.text(`${label} : ${value}`, tableX, 92 + i * 10, { width: tableW });
  });

  // --- Data tabel ---
  const rows = [
    [
      "1",
      `Desain ${projectName}`,
      "Gambar Visual 3D",
      "m2",
      number(quotation.item3dVolume),
      money(quotation.item3dPrice),
      money(totals.item3dTotal),
    ],
    [
      "",
      "",
      "Gambar Detail Interior 2D",
      "m2",
      number(quotation.item2dVolume),
      money(quotation.item2dPrice),
      money(totals.item2dTotal),
    ],
  ];
  const summary = [
    ["JUMLAH TOTAL", money(totals.subtotal), false],
    ["DISC", totals.discount > 0 ? money(totals.discount) : "Rp -", false],
    ["", "", false],
    ["DIBULATKAN", money(totals.total), true],
  ];

  const dataTop = tableY + headerH;
  const summaryTop = dataTop + rows.length * rowH + spacerH;
  const tableBottom = summaryTop + summary.length * summaryH;

  // --- Header ---
  doc.rect(tableX, tableY, tableW, headerH).fill(COLORS.taupe);
  [
    [0, "NO"],
    [1, "URAIAN"],
    [2, "OUTPUT"],
    [5, "SATUAN HARGA"],
    [6, "TOTAL HARGA"],
  ].forEach(([c, label]) => {
    drawCell(doc, fonts, label, colX[c], tableY, cols[c], {
      bold: true,
      align: "center",
    });
  });
  drawCell(doc, fonts, "QTY", colX[3], tableY, cols[3] + cols[4], {
    bold: true,
    align: "center",
  });
  drawCell(doc, fonts, "SAT", colX[3], subHeaderY, cols[3], {
    bold: true,
    align: "center",
  });
  drawCell(doc, fonts, "VOL", colX[4], subHeaderY, cols[4], {
    bold: true,
    align: "center",
  });

  // --- Baris data ---
  rows.forEach((row, r) => {
    row.forEach((value, c) => {
      drawCell(doc, fonts, value, colX[c], dataTop + r * rowH, cols[c], {
        align: align[c],
      });
    });
  });

  // --- Ringkasan ---
  summary.forEach(([label, value, bold], i) => {
    const y = summaryTop + i * summaryH;
    drawCell(doc, fonts, label, tableX + 3, y, tableW - cols[6] - 6, {
      bold,
      align: "right",
    });
    drawCell(doc, fonts, value, colX[6], y, cols[6], { bold, align: "right" });
  });

  // --- Garis ---
  for (let c = 1; c < cols.length; c += 1) {
    // Garis antara SAT dan VOL mulai di bawah header "QTY"
    drawDashedLine(
      doc,
      colX[c],
      c === 4 ? subHeaderY : tableY,
      colX[c],
      tableBottom,
    );
  }
  drawDashedLine(doc, colX[3], subHeaderY, colX[5], subHeaderY);
  drawDashedLine(doc, tableX, dataTop, tableX + tableW, dataTop);
  drawDashedLine(doc, tableX, dataTop + rowH, tableX + tableW, dataTop + rowH);
  summary.forEach((_, i) => {
    const y = summaryTop + i * summaryH;
    drawDashedLine(doc, tableX, y, tableX + tableW, y);
  });
  drawOuterRect(doc, tableX, tableY, tableW, tableBottom - tableY);

  // --- Term & payment ---
  const textX = tableX + 1;
  const textW = tableW - 2;
  const termsEnd = drawTextBlock(
    doc,
    fonts,
    "Term & Condition",
    TERMS,
    textX,
    tableBottom + 10,
    textW,
  );
  drawTextBlock(
    doc,
    fonts,
    "Payment Method",
    PAYMENT_TERMS,
    textX,
    termsEnd + 4,
    textW,
  );

  // --- Tanda tangan ---
  const sigX = tableX + tableW - 164;
  const sigY = Math.max(doc.y + 4, 645);
  const center = { width: 158, align: "center" };

  doc.font(fonts.regular).fontSize(7.5);
  doc.text(
    `Surabaya, ${dateText(quotation.quotationDate)}`,
    sigX,
    sigY,
    center,
  );
  doc.text("Dibuat Oleh :", sigX, sigY + 11, center);
  placeImage(doc, "image12.png", sigX + 51, sigY + 22, {
    width: 56,
    height: 62,
    fit: [56, 62],
  });
  doc.font(fonts.bold);
  doc.text(COMPANY.name, sigX, sigY + 87, center);
  doc.text(COMPANY.signer, sigX, sigY + 98, center);
  doc.font(fonts.regular).text(COMPANY.signerTitle, sigX, sigY + 109, center);
}

/* ------------------------------------------------------------------ */
/* Halaman 3: Thank You                                               */
/* ------------------------------------------------------------------ */

function drawThankYou(doc, fonts) {
  doc.addPage({ size: "A4", margin: 0 });
  doc.rect(0, 0, A4.w, A4.h).fill(COLORS.cream);

  if (placeImage(doc, "page003.png", 0, 0, { width: A4.w, height: A4.h }))
    return;

  // Fallback bila template raster belum tersedia
  placeImage(doc, "image13.png", 62, 80, {
    width: 470,
    height: 300,
    fit: [470, 300],
  });
  placeImage(doc, "image14.png", 62, 560, {
    width: 470,
    height: 180,
    fit: [470, 180],
  });
  doc.fillColor(COLORS.muted).font(fonts.bold).fontSize(76);
  doc.text("THANK", 66, 430);
  doc.text("YOU", 66, 516);
}

/* ------------------------------------------------------------------ */
/* Rakit PDF                                                          */
/* ------------------------------------------------------------------ */

/** Bangun dokumen (belum di-pipe / di-end) supaya error gambar bisa ditangkap sebelum header terkirim. */
function buildQuotationPdf(quotation) {
  const doc = new PDFDocument({ size: "A4", margin: 0, autoFirstPage: false });
  const fonts = registerFonts(doc);

  doc.addPage({ size: "A4", margin: 0 });
  drawCover(doc, fonts, quotation);
  drawDetailsPage(doc, fonts, quotation);
  drawThankYou(doc, fonts);
  return doc;
}

/* ------------------------------------------------------------------ */
/* Data                                                               */
/* ------------------------------------------------------------------ */

function getQuotation(id) {
  return prisma.designQuotation.findUnique({
    where: { id },
    include: {
      project: true,
      surveyReport: { include: { areas: { include: { dimensions: true } } } },
    },
  });
}

/* ------------------------------------------------------------------ */
/* Routes                                                             */
/* ------------------------------------------------------------------ */

router.get("/projects/:projectId/design-quotations", async (req, res) => {
  try {
    const rows = await prisma.designQuotation.findMany({
      where: { projectId: req.params.projectId },
      orderBy: { quotationDate: "desc" },
      include: {
        surveyReport: {
          select: { id: true, surveyDate: true, surveyorName: true },
        },
      },
    });
    res.json(rows);
  } catch (error) {
    console.error("Error Get Design Quotations:", error);
    res.status(500).json({ error: "Gagal mengambil penawaran desain." });
  }
});

router.post("/projects/:projectId/design-quotations", async (req, res) => {
  try {
    const { projectId } = req.params;
    const { surveyReportId, quotationDate } = req.body;
    const price3d = toNumber(req.body.item3dPrice);
    const price2d = toNumber(req.body.item2dPrice);
    const discount = toNumber(req.body.discount);

    if (Math.min(price3d, price2d, discount) < 0) {
      return res
        .status(400)
        .json({ error: "Harga dan diskon tidak boleh negatif." });
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project)
      return res.status(404).json({ error: "Project tidak ditemukan." });

    let volume;
    if (surveyReportId) {
      const survey = await prisma.surveyReport.findFirst({
        where: { id: surveyReportId, projectId },
        include: { areas: { include: { dimensions: true } } },
      });
      if (!survey)
        return res
          .status(404)
          .json({ error: "Survey tidak ditemukan di project ini." });
      volume = sumSurveyArea(survey);
    } else {
      volume = toNumber(req.body.volume);
    }

    if (volume <= 0) {
      return res
        .status(400)
        .json({
          error: "Pilih survey yang memiliki luasan m² atau isi volume manual.",
        });
    }

    const row = await prisma.designQuotation.create({
      data: {
        projectId,
        surveyReportId: surveyReportId || null,
        quotationDate: quotationDate ? new Date(quotationDate) : new Date(),
        discount,
        item3dVolume: volume,
        item3dPrice: price3d,
        item2dVolume: volume,
        item2dPrice: price2d,
      },
      include: { surveyReport: true },
    });
    res.status(201).json(row);
  } catch (error) {
    console.error("Error Create Design Quotation:", error);
    res
      .status(400)
      .json({ error: error.message || "Gagal membuat penawaran desain." });
  }
});

/** Satu handler untuk view (inline) dan download (attachment). */
function pdfHandler(disposition, errorMessage) {
  return async (req, res) => {
    try {
      const quotation = await getQuotation(req.params.id);
      if (!quotation)
        return res
          .status(404)
          .json({ error: "Penawaran desain tidak ditemukan." });

      // Dibangun dulu; kalau gagal, response masih bersih untuk dikirim 500 JSON.
      const doc = buildQuotationPdf(quotation);

      doc.on("error", (error) => {
        console.error("Error streaming Design Quotation PDF:", error);
        if (!res.writableEnded) res.end();
      });

      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename="Penawaran_Desain_${safeFileName(quotation.project.name)}.pdf"`,
      });
      doc.pipe(res);
      doc.end();
    } catch (error) {
      console.error(`Error ${errorMessage}:`, error);
      if (res.headersSent) return res.end();
      res.status(500).json({ error: "Gagal membuat PDF penawaran desain." });
    }
  };
}

router.get(
  "/design-quotations/:id/pdf/view",
  pdfHandler("inline", "View Design Quotation PDF"),
);
router.get(
  "/design-quotations/:id/pdf/download",
  pdfHandler("attachment", "Download Design Quotation PDF"),
);

module.exports = router;
