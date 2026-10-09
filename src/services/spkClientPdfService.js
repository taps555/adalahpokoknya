"use strict";

const fs = require("node:fs");
const path = require("node:path");
const PDFDocument = require("pdfkit");
const { normalizeStoredSpkParties } = require("./spkService");
const { terbilangRupiah } = require("../lib/terbilang");

/* ------------------------------------------------------------------ */
/* Konstanta style (mengikuti SPK Word)                                */
/* ------------------------------------------------------------------ */

const LOGO_PATH = path.join(__dirname, "../assets/spk-client-logo.png");

// Body = Times New Roman. Judul, heading pasal, kop, tanda tangan = sans bold.
// Aptos tidak tersedia di pdfkit, Helvetica jadi pengganti terdekat.
const SERIF = {
  normal: "Times-Roman",
  bold: "Times-Bold",
  italic: "Times-Italic",
  boldItalic: "Times-BoldItalic",
};
const SANS = { normal: "Helvetica", bold: "Helvetica-Bold" };

const INK = "#111111";
const BODY_SIZE = 12;
const LIST_INDENT = 22; // lebar hanging indent "1."

const COMPANY = {
  name: "PT. DIVES JAYA PERKASA",
  address: "Jl. Bulak Rukem Timur I No. 160 Surabaya",
  phone: "0818-813-134",
  email: "djp.incon@gmail.com",
};

// Satu-satunya tempat peran pihak ditentukan.
// Di Word: PIHAK PERTAMA = klien (pemberi tugas), PIHAK KEDUA = PT Dives.
// Mau dibalik lagi: tukar isi label kedua entri ini, semua pasal ikut berubah.
const ROLE = {
  client: {
    label: "PIHAK PERTAMA",
    term: "pengguna jasa",
    signAs: "PEMBERI TUGAS",
  },
  vendor: {
    label: "PIHAK KEDUA",
    term: "penerima pengerjaan jasa",
    signAs: "PENERIMA TUGAS",
  },
};

/* ------------------------------------------------------------------ */
/* Util data                                                           */
/* ------------------------------------------------------------------ */

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

// Dipakai modul lain (export), format tidak diubah.
function rupiah(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(asNumber(value));
}

// Format dokumen: "Rp. 61.348.000" (sama dengan Word).
function rp(value) {
  const digits = new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: 0,
  }).format(asNumber(value));
  // NBSP supaya "Rp." tidak terpisah dari angkanya saat ganti baris.
  return `Rp.\u00A0${digits}`;
}

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateId(value) {
  const date = toDate(value);
  if (!date) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  }).format(date);
}

// "Senin, 31 Agustus 2026" untuk kalimat pembuka.
function dateWithDayId(value) {
  const date = toDate(value);
  if (!date) return "-";
  const day = new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    timeZone: "Asia/Jakarta",
  }).format(date);
  return `${day}, ${dateId(date)}`;
}

// Buang penanda ** dari data user supaya tidak merusak teks tebal.
function clean(value) {
  return String(value ?? "").replace(/\\/g, "");
}

function safePart(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function safeSpkPdfFilename(contract) {
  const number = safePart(contract.spkNumber || "DRAFT");
  const source = getDocumentSource(contract);
  const project = safePart(source.projectName || "SPK-Client");
  return `SPK-${number || "DRAFT"}-${project || "Client"}.pdf`;
}

function getDocumentSource(contract) {
  const immutable =
    contract.snapshot?.documentSnapshot || contract.documentSnapshot;
  if (immutable && contract.status !== "DRAFT") return immutable;
  const base = contract.snapshot || {};
  const parties =
    contract.status === "DRAFT"
      ? normalizeStoredSpkParties("CLIENT", contract.partyData, {
          clientName: base.clientName,
          projectLocation: base.projectLocation,
        })
      : normalizeStoredSpkParties("CLIENT", contract.partyData, base);
  return {
    ...base,
    contractValue: contract.contractValue,
    contractValueWords: contract.contractValueWords,
    parties,
    terms: contract.terms,
    retentionPercent: contract.retentionPercent,
    retentionAmount: contract.retentionAmount,
    workDurationDays: contract.workDurationDays,
    startDate: contract.startDate,
    endDate: contract.endDate,
    notes: contract.notes,
    bankData: contract.bankData,
  };
}

function getDocumentParties(contract, source) {
  if (source.parties) return source.parties;
  return normalizeStoredSpkParties("CLIENT", contract.partyData, source);
}

// "BCA 1032133333 ( Ben Irawan Limantara )"
function getBankLine(bankData) {
  const data = bankData || {};
  const bank = data.bankName || data.namaBank || data.bank;
  const accountNumber =
    data.accountNumber || data.nomorRekening || data.accountNo;
  const accountName =
    data.accountName || data.namaRekening || data.accountHolder;
  if (!bank && !accountNumber && !accountName)
    return `Detail rekening pembayaran resmi ${ROLE.vendor.label} belum tersedia.`;
  const main = [bank, accountNumber].filter(Boolean).join(" ");
  return `${main}${accountName ? ` ( ${accountName} )` : ""}`.trim();
}

/* ------------------------------------------------------------------ */
/* Util layout                                                         */
/* ------------------------------------------------------------------ */

function serifFont({ bold = false, italic = false } = {}) {
  if (bold && italic) return SERIF.boldItalic;
  if (bold) return SERIF.bold;
  if (italic) return SERIF.italic;
  return SERIF.normal;
}

function contentBox(doc) {
  const left = doc.page.margins.left;
  return { left, width: doc.page.width - left - doc.page.margins.right };
}

function ensureSpace(doc, height = 70) {
  if (doc.y + height > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }
}

// Pecah teks "biasa *tebal* biasa" jadi kata-kata bergaya.
// spaceBefore = ada spasi sebelum kata (false untuk tanda baca yang menempel).
function tokenize(text, { bold, italic }) {
  const words = [];
  let pendingSpace = false;
  String(text)
    .split(/(\\[^]+\\*)/)
    .filter(Boolean)
    .forEach((part) => {
      const isBold = part.startsWith("*") && part.endsWith("*");
      const content = isBold ? part.slice(2, -2) : part;
      const font = serifFont({ bold: bold || isBold, italic });
      for (const chunk of content.match(/[ \t\r\n]+|[^ \t\r\n]+/g) || []) {
        if (/^[ \t\r\n]+$/.test(chunk)) {
          pendingSpace = true;
        } else {
          words.push({ text: chunk, font, spaceBefore: pendingSpace });
          pendingSpace = false;
        }
      }
    });
  if (words.length) words[0].spaceBefore = false;
  return words;
}

// Teks serif dengan potongan tebal inline. Rata kiri-kanan dihitung manual
// karena justify bawaan pdfkit tidak andal untuk teks campur tebal/biasa.
function writeRich(doc, text, x, y, options = {}) {
  const {
    width,
    align = "justify",
    size = BODY_SIZE,
    bold = false,
    italic = false,
    lineGap = 2,
  } = options;
  const words = tokenize(text, { bold, italic });
  if (!words.length) return;

  doc.fontSize(size).fillColor(INK);
  doc.font(SERIF.normal);
  const spaceWidth = doc.widthOfString(" ");
  for (const word of words) {
    doc.font(word.font);
    word.width = doc.widthOfString(word.text);
  }
  doc.font(SERIF.normal);
  const lineHeight = doc.currentLineHeight() + lineGap;

  // Greedy line breaking.
  const lines = [];
  let line = [];
  let natural = 0;
  for (const word of words) {
    const add = word.width + (line.length && word.spaceBefore ? spaceWidth : 0);
    if (line.length && natural + add > width) {
      lines.push({ words: line, natural });
      line = [word];
      natural = word.width;
    } else {
      line.push(word);
      natural += add;
    }
  }
  if (line.length) lines.push({ words: line, natural });

  let cursorY = y;
  lines.forEach((row, rowIndex) => {
    if (cursorY + lineHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      cursorY = doc.y;
    }
    const gaps = row.words.filter((w, i) => i > 0 && w.spaceBefore).length;
    const isLast = rowIndex === lines.length - 1;
    const stretch =
      align === "justify" && !isLast && gaps > 0
        ? (width - row.natural) / gaps
        : 0;
    let cursorX = x;
    if (align === "center") cursorX = x + (width - row.natural) / 2;
    if (align === "right") cursorX = x + width - row.natural;
    row.words.forEach((word, i) => {
      if (i > 0 && word.spaceBefore) cursorX += spaceWidth + stretch;
      doc
        .font(word.font)
        .fontSize(size)
        .fillColor(INK)
        .text(word.text, cursorX, cursorY, { lineBreak: false });
      cursorX += word.width;
    });
    cursorY += lineHeight;
  });
  doc.x = x;
  doc.y = cursorY;
}

// Paragraf biasa. indent menggeser seluruh blok (untuk lanjutan ayat).
function paragraph(doc, text, options = {}) {
  const { gap = 6, indent = 0, minHeight = 40, ...style } = options;
  ensureSpace(doc, minHeight);
  const { left, width } = contentBox(doc);
  writeRich(doc, text, left + indent, doc.y, {
    ...style,
    width: width - indent,
  });
  doc.x = left;
  doc.y += gap;
}

// Item dengan penanda di kiri dan teks menggantung ("1.", "•").
function listItem(doc, marker, text, options = {}) {
  const { indent = 0, hang = LIST_INDENT, gap = 4, ...style } = options;
  ensureSpace(doc, 30);
  const { left, width } = contentBox(doc);
  const x = left + indent;
  const y = doc.y;
  doc
    .font(SERIF.normal)
    .fontSize(style.size || BODY_SIZE)
    .fillColor(INK)
    .text(marker, x, y, { width: hang, lineBreak: false });
  writeRich(doc, text, x + hang, y, {
    ...style,
    width: width - indent - hang,
  });
  doc.x = left;
  doc.y += gap;
}

// Ayat bernomor. Item: string, atau { text, note, after }.
// note = paragraf lanjutan tanpa nomor, after = callback untuk isi tambahan.
function numbered(doc, items) {
  items.forEach((item, index) => {
    const { text, note, after } =
      typeof item === "string" ? { text: item } : item;
    listItem(doc, `${index + 1}.`, text);
    if (note) {
      paragraph(doc, note, { indent: LIST_INDENT, gap: 4, minHeight: 24 });
    }
    if (after) after();
  });
}

function clauseHeading(doc, number, title) {
  ensureSpace(doc, 80);
  doc.y += 6;
  const { left, width } = contentBox(doc);
  doc.font(SANS.bold).fontSize(BODY_SIZE).fillColor(INK);
  doc.text(`Pasal ${number}`, left, doc.y, { width, align: "center" });
  doc.text(title, left, doc.y, { width, align: "center" });
  doc.x = left;
  doc.y += 5;
}

/* ------------------------------------------------------------------ */
/* Komponen halaman                                                    */
/* ------------------------------------------------------------------ */

function drawHeader(doc) {
  const { left, width } = contentBox(doc);
  const textX = left + 170;
  const textWidth = width - 170;
  doc.save();
  if (fs.existsSync(LOGO_PATH)) {
    doc.image(LOGO_PATH, left, 22, { fit: [150, 54] });
  }
  doc.fillColor(INK);
  const line = (text, y, font) =>
    doc.font(font).fontSize(10).text(text, textX, y, {
      width: textWidth,
      align: "right",
      lineBreak: false,
    });
  line(COMPANY.name, 24, SANS.bold);
  line(COMPANY.address, 37, SANS.normal);
  line(COMPANY.phone, 50, SANS.normal);
  line(COMPANY.email, 63, SANS.normal);
  doc
    .strokeColor(INK)
    .lineWidth(2)
    .moveTo(left, 84)
    .lineTo(left + width, 84)
    .stroke();
  doc.restore();
  doc.x = left;
  doc.y = doc.page.margins.top;
}

function drawDraftWatermark(doc) {
  doc.save();
  doc.opacity(0.11).fillColor("#b91c1c").font("Helvetica-Bold").fontSize(52);
  doc.rotate(-34, { origin: [doc.page.width / 2, doc.page.height / 2] });
  doc.text("DRAFT / BELUM BERNOMOR", 20, doc.page.height / 2 - 35, {
    width: doc.page.width - 40,
    align: "center",
    lineBreak: false,
  });
  doc.restore();
}

// Blok identitas: baris "Label : isi", lalu baris peran di bawahnya.
function identity(doc, party, role) {
  const entries = [
    ["Nama", party.name || "-"],
    ["NIK", party.nik || party.idNumber || "-"],
    party.position ? ["Jabatan", party.position] : null,
    ["Perusahaan", party.companyName || "-"],
    ["Alamat", party.address || "-"],
  ].filter(Boolean);

  ensureSpace(doc, entries.length * 16 + 40);
  const { left, width } = contentBox(doc);
  const labelWidth = 80;
  for (const [key, value] of entries) {
    ensureSpace(doc, 20);
    const y = doc.y;
    doc.font(SERIF.normal).fontSize(BODY_SIZE).fillColor(INK);
    doc.text(key, left, y, { width: labelWidth, lineBreak: false });
    doc.text(`: ${value}`, left + labelWidth, y, {
      width: width - labelWidth,
      lineGap: 2,
    });
    doc.x = left;
  }
  doc.y += 2;
  paragraph(doc, `**${role.label}** (Selanjutnya disebut ${role.term}).`, {
    align: "left",
    gap: 10,
    minHeight: 24,
  });
}

function drawScope(doc, scope) {
  const items = Array.isArray(scope) ? scope : [];
  if (!items.length) return;
  items.forEach((item) => {
    listItem(
      doc,
      "•",
      clean(
        `${item.name || "-"} — ${asNumber(item.volume)} ${item.unit || ""} (${rp(item.totalPrice)})`,
      ),
      { indent: LIST_INDENT, hang: 14, gap: 2 },
    );
  });
  doc.y += 4;
}

// Baris termin: "o  DP        : Sebesar ..." (label tebal miring, kolom lurus).
function termRow(doc, label, value) {
  ensureSpace(doc, 24);
  const { left, width } = contentBox(doc);
  const markerX = left + LIST_INDENT + 12;
  const labelX = markerX + 16;
  const labelWidth = 72;
  const y = doc.y;
  doc
    .font(SERIF.normal)
    .fontSize(BODY_SIZE)
    .fillColor(INK)
    .text("o", markerX, y, { width: 14, lineBreak: false });
  doc
    .font(SERIF.boldItalic)
    .text(String(label), labelX, y, { width: labelWidth, lineBreak: false });
  doc.text(`: ${value}`, labelX + labelWidth, y, {
    width: width - (labelX - left) - labelWidth,
    lineGap: 2,
  });
  doc.x = left;
  doc.y += 3;
}

function drawTerms(doc, terms, retentionPercent, retentionAmount) {
  const rows = [...(terms || [])].sort(
    (a, b) => asNumber(a.order) - asNumber(b.order),
  );
  rows.forEach((term) => {
    const detail = [term.dueDescription, term.milestone]
      .filter(Boolean)
      .join("; ");
    termRow(
      doc,
      term.label,
      `Sebesar ${rp(term.amount)}${detail ? ` ${detail}` : ""}`,
    );
  });
  if (asNumber(retentionPercent) > 0) {
    termRow(
      doc,
      "Retensi",
      `${asNumber(retentionPercent)}% atau ${rp(retentionAmount)}`,
    );
  }
  doc.y += 3;
}

function signatureBlocks(doc, { client, vendor }, issueDate) {
  ensureSpace(doc, 170);
  const { left, width } = contentBox(doc);
  const gap = 30;
  const colWidth = (width - gap) / 2;

  doc
    .font(SERIF.normal)
    .fontSize(BODY_SIZE)
    .fillColor(INK)
    .text(`Surabaya, ${dateId(issueDate)}`, left, doc.y, {
      width,
      align: "center",
    });
  doc.y += 16;

  const y = doc.y;
  const blocks = [
    { x: left, role: ROLE.client, party: client },
    { x: left + colWidth + gap, role: ROLE.vendor, party: vendor },
  ];
  for (const block of blocks) {
    doc.font(SANS.bold).fontSize(BODY_SIZE).fillColor(INK);
    doc.text(block.role.label, block.x, y, {
      width: colWidth,
      align: "center",
    });
    doc.text(block.role.signAs, block.x, doc.y, {
      width: colWidth,
      align: "center",
    });
    doc.text(String(block.party.name || "-").toUpperCase(), block.x, y + 95, {
      width: colWidth,
      align: "center",
      underline: true,
    });
  }
  doc.x = left;
  doc.y = y + 140;
}

/* ------------------------------------------------------------------ */
/* Render                                                              */
/* ------------------------------------------------------------------ */

function renderSpkClientPdf(contract) {
  if (!contract || contract.type !== "CLIENT") {
    return Promise.reject(
      new Error("PDF ini hanya tersedia untuk SPK CLIENT."),
    );
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      // Kiri/kanan 2,5 cm seperti Word. Atas lebih besar untuk kop surat.
      margins: { top: 104, right: 71, bottom: 62, left: 71 },
      bufferPages: true,
      compress: false,
      info: { Title: "SPK Client" },
    });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    const snapshot = getDocumentSource(contract);
    const parties = getDocumentParties(contract, snapshot);
    // firstParty = PT Dives (vendor), secondParty = klien. Peran dokumen
    // ditentukan ROLE di atas, bukan urutan field ini.
    const client = parties.secondParty;
    const vendor = parties.firstParty;
    const C = ROLE.client.label;
    const V = ROLE.vendor.label;

    const value = asNumber(snapshot.contractValue ?? contract.contractValue);
    const words = clean(
      snapshot.contractValueWords ||
        contract.contractValueWords ||
        terbilangRupiah(value),
    );
    const number =
      contract.status === "DRAFT"
        ? "DRAFT / BELUM BERNOMOR"
        : String(contract.spkNumber || "BELUM BERNOMOR");
    const issueDate = contract.issuedAt || contract.createdAt || new Date();
    const terms = snapshot.terms ?? contract.terms;
    const retentionPercent =
      snapshot.retentionPercent ?? contract.retentionPercent;
    const retentionAmount =
      snapshot.retentionAmount ?? contract.retentionAmount;
    const durationDays = snapshot.workDurationDays ?? contract.workDurationDays;
    const startDate = snapshot.startDate ?? contract.startDate;
    const endDate = snapshot.endDate ?? contract.endDate;
    if (!durationDays || !startDate || !endDate) {
      throw new Error(
        "Jadwal SPK CLIENT belum lengkap dan PDF tidak dapat dibuat.",
      );
    }
    const bankData = snapshot.bankData ?? contract.bankData;
    const notes = snapshot.notes ?? contract.notes;

    const projectName = clean(snapshot.projectName || "Pekerjaan Proyek");
    const projectLocation = clean(
      snapshot.projectLocation || client.address || "-",
    );
    const clientName = client.name || snapshot.clientName || "-";
    const valueText = `${rp(value)} (${words})`;

    doc.on("pageAdded", () => drawHeader(doc));
    drawHeader(doc);
    const { left, width } = contentBox(doc);

    /* Judul + nomor */
    doc
      .font(SANS.bold)
      .fontSize(14)
      .fillColor(INK)
      .text("SURAT PERJANJIAN KONTRAK KERJASAMA", left, doc.y, {
        width,
        align: "center",
        underline: true,
      });
    doc.y += 2;
    doc
      .font(SERIF.normal)
      .fontSize(11)
      .text(number, left, doc.y, { width, align: "center" });
    doc.y += 12;

    /* Perihal + alamat tujuan */
    const addressee = [
      `Perihal : Perjanjian Kerjasama ${projectName}`,
      "Kepada Yth.",
      clientName,
      client.address || projectLocation,
    ];
    doc.font(SERIF.normal).fontSize(BODY_SIZE).fillColor(INK);
    addressee.forEach((line, index) => {
      doc.text(String(line), left, doc.y, { width, align: "left" });
      if (index === 0) doc.y += 4;
    });
    doc.x = left;
    doc.y += 12;

    /* Pembuka + identitas */
    paragraph(
      doc,
      `Pada ${dateWithDayId(issueDate)} kami yang bertanda tangan di bawah ini :`,
      { align: "left", minHeight: 30 },
    );
    identity(doc, client, ROLE.client);
    identity(doc, vendor, ROLE.vendor);

    paragraph(
      doc,
      `**${C}** dan **${V}** secara bersama-sama selanjutnya disebut **PARA PIHAK**. **PARA PIHAK** dengan ini menerangkan terlebih dahulu :`,
    );
    paragraph(
      doc,
      `Bahwa sehubungan dengan **Proyek ${projectName}** yang berlokasi di ${projectLocation}, PARA PIHAK telah sepakat harga berdasarkan dengan penawaran ${V} dan PARA PIHAK telah setuju dan sepakat untuk mengikat diri dalam suatu Perjanjian Kerjasama yang akan diatur perjanjian ini.`,
    );
    paragraph(
      doc,
      "Selanjutnya disebut PERJANJIAN dengan ketentuan dan syarat-syarat sebagai berikut :",
      { align: "left" },
    );

    /* Pasal 1 */
    clauseHeading(doc, 1, "Lingkup Pekerjaan");
    paragraph(
      doc,
      `${C} memberikan pekerjaan kepada ${V} dan ${V} menerima pekerjaan tersebut dari ${C} yaitu melaksanakan pekerjaan dengan spesifikasi teknis yang diuraikan sesuai dengan yang terlampir dalam Surat Penawaran.`,
    );
    drawScope(doc, snapshot.workScope);

    /* Pasal 2 */
    clauseHeading(doc, 2, "Nilai Kontrak");
    paragraph(
      doc,
      `Nilai kontrak yang telah disepakati bersama sebesar **${valueText}**. Harga yang sudah disepakati merupakan harga borongan atau paket.`,
    );

    /* Pasal 3 */
    clauseHeading(doc, 3, "Cara Pembayaran");
    numbered(doc, [
      {
        text: `Pembayaran dilakukan oleh ${C} kepada ${V} sebesar **${valueText}** melalui transfer ke rekening resmi ${V}:`,
        after: () =>
          paragraph(doc, clean(getBankLine(bankData)), {
            indent: LIST_INDENT + 12,
            align: "left",
            bold: true,
            italic: true,
            gap: 5,
            minHeight: 24,
          }),
      },
      {
        text: "Pembayaran dilakukan dengan sistem termin sebagai berikut:",
        after: () => drawTerms(doc, terms, retentionPercent, retentionAmount),
      },
      `Pengajuan dokumen penagihan termin wajib disampaikan sebelum tanggal jatuh tempo pembayaran, guna memberikan waktu yang cukup bagi ${C} untuk proses administrasi dan pencairan.`,
      `Apabila sampai dengan tanggal jatuh tempo pembayaran ${V} belum menerima pembayaran, maka ${V} berhak menerbitkan surat penagihan resmi dan menghentikan pekerjaan sementara, tanpa dianggap sebagai wanprestasi, sampai pembayaran diterima.`,
    ]);

    /* Pasal 4 */
    clauseHeading(doc, 4, "Jangka Waktu Pelaksanaan");
    numbered(doc, [
      `Pelaksanaan pekerjaan dimulai pada **${dateId(startDate)}**.`,
      {
        text: `Lama pekerjaan adalah **${durationDays} hari kerja sampai dengan ${dateId(endDate)}**, dengan ketentuan:`,
        after: () => {
          const bullet = { indent: LIST_INDENT + 8, hang: 14, gap: 2 };
          listItem(
            doc,
            "•",
            "Hari Minggu dan hari libur nasional tidak dihitung sebagai hari kerja",
            bullet,
          );
          listItem(
            doc,
            "•",
            "Pekerjaan lembur tidak diperhitungkan sebagai pengurang waktu kontrak",
            bullet,
          );
          doc.y += 4;
        },
      },
    ]);

    /* Pasal 5 */
    clauseHeading(doc, 5, "Jaminan dan Garansi");
    numbered(doc, [
      `Mutu/kualitas pelaksanaan pekerjaan sesuai dengan standar spesifikasi yang telah ditetapkan dan disetujui oleh ${C}. Gambar 3D yang diberikan ke klien adalah ilustrasi bukan 100% akurasi dari hasil pekerjaan.`,
      `${V}/pekerja ${V} ikut menjamin keamanan dan ketertiban lingkungan di sekitarnya.`,
      {
        text: "Garansi Pekerjaan untuk kerusakan pekerjaan tersebut adalah 3 (tiga) bulan.",
        note: `Kerusakan yang disebabkan faktor alam, kecelakaan lainnya, atau kelalaian ${C} yang bukan disebabkan oleh ${V} tidak termasuk dalam garansi.`,
      },
      {
        text: `Material, perlengkapan, dan/atau bagian pekerjaan yang belum dilunasi sepenuhnya tetap menjadi hak milik ${V} dan tidak diperkenankan untuk dipindahkan, digunakan, atau diklaim oleh ${C} sebelum pembayaran diselesaikan.`,
        note: notes ? `Catatan: ${clean(notes)}` : null,
      },
    ]);

    /* Pasal 6 */
    clauseHeading(doc, 6, "Force Majeure");
    numbered(doc, [
      "Force majeure adalah keadaan di luar kemampuan para pihak seperti bencana alam, kebakaran, huru-hara, perang, pandemi, atau kebijakan pemerintah yang menghalangi pelaksanaan pekerjaan.",
      "Dalam hal terjadi force majeure, pihak yang terdampak wajib memberitahukan secara tertulis paling lambat 7 (tujuh) hari kalender sejak terjadinya keadaan tersebut.",
      "Kedua pihak akan bermusyawarah untuk mencari penyelesaian terbaik, termasuk perpanjangan waktu pekerjaan.",
      `Pembersihan area kerja dan serah terima pekerjaan dilaksanakan setelah seluruh kewajiban pembayaran dinyatakan lunas oleh ${C}.`,
      `Apabila terdapat pekerjaan yang belum dapat diselesaikan akibat belum terpenuhinya kewajiban pembayaran, maka kondisi tersebut bukan merupakan kegagalan pekerjaan dan tidak dianggap sebagai kegagalan atau kelalaian ${V}; penyelesaian akan dilakukan setelah pembayaran diterima sepenuhnya.`,
    ]);

    /* Pasal 7 */
    clauseHeading(doc, 7, "Pekerjaan Tambah/Kurang");
    numbered(doc, [
      `Pekerjaan tambah atau kurang hanya dapat dilaksanakan setelah ada persetujuan tertulis dari ${C}.`,
      "Nilai pekerjaan tambah atau kurang akan dihitung berdasarkan harga satuan dan kesepakatan baru kedua belah pihak.",
      "Apabila dalam pelaksanaan pekerjaan terjadi perbedaan volume atau spesifikasi antara gambar kerja, perencanaan, dan kondisi nyata di lapangan, maka kedua belah pihak sepakat untuk memberikan toleransi secara wajar serta menyelesaikan perbedaan tersebut melalui musyawarah dengan prinsip adil, proporsional, dan tidak merugikan salah satu pihak.",
    ]);

    /* Pasal 8 (paragraf tanpa nomor, seperti Word) */
    clauseHeading(doc, 8, "Domisili Hukum dan Penyelesaian Perselisihan");
    paragraph(
      doc,
      `Apabila terjadi perselisihan antara ${C} dan ${V}, maka terlebih dahulu akan diselesaikan secara musyawarah untuk mufakat.`,
    );
    paragraph(
      doc,
      "Apabila penyelesaian secara musyawarah tidak tercapai, maka para pihak sepakat memilih domisili hukum tetap di Pengadilan Negeri Surabaya.",
    );
    paragraph(
      doc,
      "Apabila terjadi permasalahan mengenai pembayaran yang tidak mendapat kesepakatan atau belum dapat dibayarkan, maka akan dibuatkan Surat Pengakuan Hutang yang ditandatangani dan disepakati bersama oleh kedua belah pihak.",
    );

    /* Pasal 9: selalu satu halaman dengan tanda tangan */
    ensureSpace(doc, 270);
    clauseHeading(doc, 9, "Penutup");
    numbered(doc, [
      "Surat Perjanjian ini dibuat dan ditandatangani bersama oleh *PARA PIHAK* pada hari dan tanggal tersebut.",
      "Surat Perjanjian ini dibuat dalam rangkap 2 (dua), masing-masing diberi materai secukupnya dan mempunyai kekuatan hukum yang sama.",
    ]);

    doc.y += 12;
    signatureBlocks(doc, { client, vendor }, issueDate);

    /* Footer + watermark di semua halaman */
    const range = doc.bufferedPageRange();
    for (
      let index = range.start;
      index < range.start + range.count;
      index += 1
    ) {
      doc.switchToPage(index);
      if (contract.status === "DRAFT") drawDraftWatermark(doc);
      // Footer ada di area margin bawah: matikan margin sementara supaya
      // pdfkit tidak menambah halaman baru.
      const savedBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc
        .font(SERIF.normal)
        .fontSize(9)
        .fillColor("#666666")
        .text(
          `SPK Client • ${number} • Halaman ${index + 1} dari ${range.count}`,
          left,
          doc.page.height - 38,
          { width, align: "center", lineBreak: false },
        );
      doc.page.margins.bottom = savedBottom;
    }

    doc.end();
  });
}

module.exports = {
  renderSpkClientPdf,
  safeSpkPdfFilename,
  rupiah,
  dateId,
};