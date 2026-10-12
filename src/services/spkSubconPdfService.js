"use strict";

const fs = require("node:fs");
const path = require("node:path");
const PDFDocument = require("pdfkit");
const { normalizeStoredSpkParties } = require("./spkService");
const { terbilangRupiah } = require("../lib/terbilang");

/* ------------------------------------------------------------------ */
/* Konstanta style (sama dengan spkClientPdfService)                   */
/* ------------------------------------------------------------------ */

const LOGO_PATH = path.join(__dirname, "../assets/spk-client-logo.png");

// Body = Times New Roman. Judul, heading pasal, kop, tanda tangan = sans bold.
const SERIF = {
  normal: "Times-Roman",
  bold: "Times-Bold",
  italic: "Times-Italic",
  boldItalic: "Times-BoldItalic",
};
const SANS = { normal: "Helvetica", bold: "Helvetica-Bold" };

const INK = "#111111";
const BODY_SIZE = 12;
const LIST_INDENT = 22;

const COMPANY = {
  name: "PT. DIVES JAYA PERKASA",
  address: "Jl. Bulak Rukem Timur I No. 160 Surabaya",
  phone: "0818-813-134",
  email: "djp.incon@gmail.com",
};

// SPK Subcon: peran dibalik dari SPK Client.
// PIHAK PERTAMA = PT Dives (pemberi tugas), PIHAK KEDUA = subcon (penerima tugas).
const ROLE = {
  client: {
    label: "PIHAK PERTAMA",
    term: "PEMBERI TUGAS",
    signAs: "PEMBERI TUGAS",
  },
  vendor: {
    label: "PIHAK KEDUA",
    term: "PENYEDIA JASA / PENERIMA TUGAS",
    signAs: "PENERIMA TUGAS",
  },
};

// Lampiran Pasal 1, persis seperti contoh dokumen Subcon.
const SCOPE_DOCUMENTS = [
  "Surat Perjanjian Kontrak Kerja",
  "Dokumen Teknis (Gambar Kerja 2D dan 3D)",
  "Data Spesifikasi Teknis Pengerjaan dan Material",
  "RAB (Rincian Anggaran Biaya)/Rincian persetujuan tergantung harga/jasa dari tiap pekerja.",
  "Checklist",
  "Time Schedule.",
];

// Jam kerja Pasal 2: ketentuan operasional lokasi proyek (tetap, sesuai contoh).
const WORK_HOURS = [
  ["Hari Kerja", "Senin - Minggu (Lembur sertakan harinya). Apabila waktu yang diberikan sedikit."],
  ["Jam Istirahat", "12.00 - 13.00 (Durasi 1 jam)"],
  ["Jam Lembur", "18.00 - 00.00 & 00.01 - 07.00 (Waktu Indonesia Setempat)"],
];

/* ------------------------------------------------------------------ */
/* Util data                                                           */
/* ------------------------------------------------------------------ */

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function rupiah(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(asNumber(value));
}

function rp(value) {
  const digits = new Intl.NumberFormat("id-ID", {
    maximumFractionDigits: 0,
  }).format(asNumber(value));
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

function dateWithDayId(value) {
  const date = toDate(value);
  if (!date) return "-";
  const day = new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    timeZone: "Asia/Jakarta",
  }).format(date);
  return `${day} Tanggal ${dateId(date)}`;
}

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

function safeSpkSubconPdfFilename(contract) {
  const number = safePart(contract.spkNumber || "DRAFT");
  const source = getDocumentSource(contract);
  const project = safePart(source.projectName || "SPK-Subcon");
  return `SPK-Subcon-${number || "DRAFT"}-${project || "Subcon"}.pdf`;
}

function getDocumentSource(contract) {
  const immutable =
    contract.snapshot?.documentSnapshot || contract.documentSnapshot;
  if (immutable && contract.status !== "DRAFT") return immutable;
  const base = contract.snapshot || {};
  const parties = normalizeStoredSpkParties(
    "SUBCON",
    contract.partyData,
    base,
  );
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
  if (source.parties && (source.parties.firstParty || source.parties.secondParty)) {
    return source.parties;
  }
  return normalizeStoredSpkParties("SUBCON", contract.partyData, source);
}

// "BCA 4700157488 ( Lazuardi Iman )"
function getBankLine(bankData) {
  const data = bankData || {};
  const bank = data.bankName || data.namaBank || data.bank;
  const accountNumber =
    data.accountNumber || data.nomorRekening || data.accountNo;
  const accountName =
    data.accountName || data.namaRekening || data.accountHolder;
  if (!bank && !accountNumber && !accountName) return null;
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

function tokenize(text, { bold, italic }) {
  const words = [];
  let pendingSpace = false;
  String(text)
    .split(/(\*\*[^*]+\*\*)/)
    .filter(Boolean)
    .forEach((part) => {
      const isBold = part.startsWith('**') && part.endsWith('**');
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
  doc.text(`PASAL ${number}`, left, doc.y, { width, align: "center" });
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

// Baris "Label : isi" dengan kolom label sejajar.
function fieldRow(doc, label, value, options = {}) {
  const { labelWidth = 110, gap = 2 } = options;
  ensureSpace(doc, 20);
  const { left, width } = contentBox(doc);
  const y = doc.y;
  doc.font(SERIF.normal).fontSize(BODY_SIZE).fillColor(INK);
  doc.text(label, left, y, { width: labelWidth, lineBreak: false });
  doc.text(`: ${value}`, left + labelWidth, y, {
    width: width - labelWidth,
    lineGap: 2,
  });
  doc.x = left;
  doc.y += gap;
}

// Blok identitas pihak: Nama / No. KTP / Alamat, lalu baris peran.
function identity(doc, party, role) {
  const entries = [
    ["Nama", party.name || "-"],
    ["No. KTP", party.nik || party.idNumber || "-"],
    ["Alamat", party.address || "-"],
  ];
  entries.forEach(([key, value]) => fieldRow(doc, key, value));
  doc.y += 2;
  paragraph(doc, `**${role.label}** (Selanjutnya disebut ${role.term}).`, {
    align: "left",
    gap: 10,
    minHeight: 24,
  });
}

// Baris termin: "o  DP        : 50% : Rp. 18.250.000"
function termRow(doc, label, value) {
  ensureSpace(doc, 24);
  const { left, width } = contentBox(doc);
  const markerX = left + LIST_INDENT + 12;
  const labelX = markerX + 16;
  const labelWidth = 90;
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

// Termin dari form + retensi, mengikuti gaya contoh dokumen Subcon.
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
      `${asNumber(term.percent)}% : ${rp(term.amount)}${detail ? ` ${detail}` : ""}`,
    );
  });
  if (asNumber(retentionPercent) > 0) {
    termRow(
      doc,
      "Retensi",
      `${asNumber(retentionPercent)}% : ${rp(retentionAmount)}`,
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
/* Dokumen 2: Surat Perintah Kerja                                     */
/* ------------------------------------------------------------------ */

function renderSuratPerintahKerja(doc, context) {
  const {
    client,
    vendor,
    number,
    issueDate,
    value,
    projectName,
    projectLocation,
    durationDays,
    startDate,
    bankData,
  } = context;

  doc.addPage();
  const { left, width } = contentBox(doc);

  doc
    .font(SANS.bold)
    .fontSize(14)
    .fillColor(INK)
    .text("SURAT PERINTAH KERJA (SPK)", left, doc.y, {
      width,
      align: "center",
      underline: true,
    });
  doc.y += 14;

  fieldRow(doc, "Nomor", number, { labelWidth: 110 });
  fieldRow(doc, "Tanggal", dateId(issueDate), { labelWidth: 110 });
  fieldRow(doc, "Proyek", projectName, { labelWidth: 110 });
  fieldRow(doc, "Lokasi", projectLocation, { labelWidth: 110 });
  doc.y += 8;

  paragraph(doc, "Yang bertanda tangan di bawah ini :", {
    align: "left",
    gap: 6,
  });
  fieldRow(doc, "Nama", client.name || "-", { labelWidth: 110 });
  fieldRow(doc, "Jabatan", client.position || "-", { labelWidth: 110 });
  fieldRow(doc, "Alamat", client.address || "-", { labelWidth: 110 });
  doc.y += 4;
  paragraph(
    doc,
    `Bertindak untuk dan atas nama **${COMPANY.name}** selanjutnya disebut **${ROLE.client.label}** (${ROLE.client.term}) dengan ini telah menunjuk/memberikan pekerjaan kepada :`,
  );
  doc.y += 2;
  fieldRow(
    doc,
    "Nama",
    `${vendor.name || "-"}${vendor.phone ? ` - ( ${vendor.phone} )` : ""}`,
    { labelWidth: 110 },
  );
  fieldRow(doc, "Alamat", vendor.address || "-", { labelWidth: 110 });
  doc.y += 4;
  paragraph(
    doc,
    `Bertindak sebagai **PENYEDIA JASA** selanjutnya disebut **${ROLE.vendor.label}** (${ROLE.vendor.term}).`,
  );
  paragraph(
    doc,
    "Untuk melaksanakan pekerjaan dengan memperhatikan beberapa ketentuan sebagai berikut :",
    { align: "left" },
  );

  fieldRow(doc, "1) Jenis Pekerjaan", projectName, { labelWidth: 140 });
  fieldRow(doc, "2) Harga Kesepakatan", rp(value), { labelWidth: 140 });
  fieldRow(
    doc,
    "3) Cara Pembayaran",
    `By Progress Termin${getBankLine(bankData) ? ` ( ${getBankLine(bankData)} )` : ""}`,
    { labelWidth: 140 },
  );
  fieldRow(doc, "4) Waktu Pelaksanaan", `${durationDays} hari Kalender`, {
    labelWidth: 140,
  });
  fieldRow(doc, "5) Awal Pekerjaan", dateId(startDate), { labelWidth: 140 });
  doc.y += 8;

  paragraph(
    doc,
    "Demikian Surat Perintah Kerja ini dibuat dengan sebenar-benarnya untuk dapat dipergunakan sebagaimana mestinya.",
  );

  doc.y += 12;
  signatureBlocks(doc, { client, vendor }, issueDate);
}

/* ------------------------------------------------------------------ */
/* Render                                                              */
/* ------------------------------------------------------------------ */

function renderSpkSubconPdf(contract) {
  if (!contract || contract.type !== "SUBCON") {
    return Promise.reject(new Error("PDF ini hanya tersedia untuk SPK SUBCON."));
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 104, right: 71, bottom: 62, left: 71 },
      bufferPages: true,
      compress: false,
      info: { Title: "SPK Subcon" },
    });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    const snapshot = getDocumentSource(contract);
    const parties = getDocumentParties(contract, snapshot);
    // firstParty = PT Dives (pemberi tugas), secondParty = subcon.
    const client = parties.firstParty;
    const vendor = parties.secondParty;
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
        "Jadwal SPK SUBCON belum lengkap dan PDF tidak dapat dibuat.",
      );
    }
    const bankData = snapshot.bankData ?? contract.bankData;
    const notes = snapshot.notes ?? contract.notes;

    const projectName = clean(snapshot.projectName || "Pekerjaan Proyek");
    const projectLocation = clean(
      snapshot.projectLocation || vendor.address || "-",
    );
    const valueText = `${rp(value)} (${words})`;

    doc.on("pageAdded", () => drawHeader(doc));
    drawHeader(doc);
    const { left, width } = contentBox(doc);

    /* Judul + nomor */
    doc
      .font(SANS.bold)
      .fontSize(14)
      .fillColor(INK)
      .text("SURAT PERJANJIAN KONTRAK KERJA", left, doc.y, {
        width,
        align: "center",
        underline: true,
      });
    doc
      .font(SANS.bold)
      .fontSize(12)
      .text(String(projectName).toUpperCase(), left, doc.y, {
        width,
        align: "center",
      });
    doc.y += 2;
    doc
      .font(SERIF.normal)
      .fontSize(11)
      .text(number, left, doc.y, { width, align: "center" });
    doc.y += 12;

    /* Pembuka + identitas kedua pihak */
    paragraph(
      doc,
      `Pada hari ini ${dateWithDayId(issueDate)}, bertempat di ${COMPANY.name} yang beralamat di ${COMPANY.address} telah diadakan penandatanganan Surat Perjanjian Kerja, antara :`,
      { align: "left" },
    );
    identity(doc, client, ROLE.client);
    identity(doc, vendor, ROLE.vendor);
    paragraph(
      doc,
      "Dengan ini kedua belah pihak menyatakan untuk saling mengikatkan diri mengadakan perjanjian kerja.",
    );
    paragraph(
      doc,
      "Pelaksanaan pekerjaan untuk selanjutnya diatur dengan syarat dan ketentuan sebagai berikut :",
      { align: "left" },
    );

    /* PASAL 1 */
    clauseHeading(doc, 1, "LINGKUP PEKERJAAN");
    paragraph(
      doc,
      `${C} memberikan tugas kepada ${V} untuk melaksanakan ${projectName} yang berlokasi di ${projectLocation} dengan sebaik-baiknya sesuai dokumen kontrak berikut yang menjadi satu kesatuan tidak terpisahkan :`,
    );
    SCOPE_DOCUMENTS.forEach((item, index) => {
      listItem(doc, `${index + 1}.`, clean(item), { gap: 2 });
    });
    doc.y += 4;
    paragraph(
      doc,
      `${V} wajib memparaf dan menandatangani semua lampiran sebagai tanda setuju. Pekerjaan di luar lampiran dianggap change order dan wajib ada SPK tertulis dari DIREKTUR ${COMPANY.name}.`,
    );

    /* PASAL 2 */
    clauseHeading(doc, 2, "WAKTU PELAKSANAAN PEKERJAAN");
    paragraph(
      doc,
      `Waktu untuk pelaksanaan **${durationDays} hari kalender**, terhitung mulai **${dateId(startDate)}** sampai dengan **${dateId(endDate)}**. Ketentuan waktu operasional yang harus dipatuhi adalah sebagai berikut (Optional Sesuai Jam Kerja Lokasi Proyek) :`,
    );
    WORK_HOURS.forEach(([label, value], index) => {
      listItem(doc, `${index + 1}.`, `**${label}** : ${clean(value)}`, {
        gap: 3,
      });
    });
    doc.y += 4;

    /* PASAL 3 */
    clauseHeading(doc, 3, "PELAKSANAAN PEKERJAAN");
    paragraph(
      doc,
      `${V} wajib mengajukan Request for Information / RFI secara tertulis via WA atau Email jika ada gambar/spek yang ambigu, konflik atau tidak jelas. Pekerjaan yang dikerjakan tanpa approval RFI dari ${C} dianggap risiko ${V} dan wajib dibongkar + ganti bahan tanpa biaya tambahan ke ${COMPANY.name}.`,
    );
    paragraph(
      doc,
      `${V} wajib menyertakan pagi jam 08.00 foto kehadiran dan progress kerja dan sore jam 17.00 foto hasil kerja dan keadaan lapangan via grub WA project sebagai bukti harian.`,
    );
    paragraph(
      doc,
      `${V} tidak diperkenankan untuk memutus kontrak kerja secara sepihak jika tidak ingin mendapatkan sanksi. SANKSI YANG DIKENAKAN BERUPA SANKSI RINGAN, SEDANG, HINGGA SANKSI BERAT.`,
    );
    paragraph(
      doc,
      "Setiap pekerja WAJIB menjaga kebersihan area kerja masing-masing setiap hari selesai bekerja, puing-puing sampah dikumpulkan menjadi satu di setiap tempat yang ditunjuk dan harus dibuang keluar dari lokasi pekerjaan setiap tiga hari sekali agar tidak menciptakan lingkungan yang kotor. Apabila tidak menaati peraturan tersebut pekerja tidak diperbolehkan melanjutkan pekerjaan dan PIHAK PERTAMA berhak memutuskan kontrak tersebut secara sepihak. Pekerja diwajibkan untuk mematuhi protokol keselamatan dan keamanan yang berlaku di lingkungan perusahaan.",
    );
    paragraph(doc, "Foto Awal Kerja dan Akhir Kerja.", { align: "left" });

    /* PASAL 4 */
    clauseHeading(doc, 4, "BIAYA PELAKSANAAN");
    paragraph(
      doc,
      `Biaya pelaksanaan pekerjaan untuk proyek tersebut sebesar **${valueText}**. Nilai kontrak disetujui oleh KEDUA BELAH PIHAK dan mengikat, dapat berubah apabila terdapat adendum yang sudah disetujui dan ADENDUM KONTRAK KERJA tersebut akan diproses.`,
    );

    /* PASAL 5 */
    clauseHeading(doc, 5, "PROSEDUR PENAGIHAN DAN PEMBAYARAN");
    paragraph(
      doc,
      `Prosedur pembayaran ${C} pada ${V} akan dilakukan secara bertahap sesuai dengan termin progress yang disepakati bersama sebagai berikut :`,
    );
    paragraph(doc, "**1. TERMIN BY PROGRESS**", { align: "left", gap: 4 });
    drawTerms(doc, terms, retentionPercent, retentionAmount);
    paragraph(doc, "**2. TERMIN I DAN SETERUSNYA**", {
      align: "left",
      gap: 4,
    });
    numbered(doc, [
      "Termin progress dihitung berdasarkan hasil JOIN OPNAME di lapangan yang telah dicek dan disepakati bersama pada saat opname di lapangan, progress akan dinilai setiap 1 minggu pada hari Sabtu. Dihitung sampai dengan batas masa pelaksanaan kontrak kerja.",
      "Pembayaran dilakukan setiap hari Sabtu.",
      `Setiap item pekerjaan yang telah dikerjakan oleh ${V} wajib dinyatakan selesai dan ditandatangani oleh ${C} melalui Berita Acara Join Opname harian atau mingguan sebelum dapat dihitung sebagai progress pekerjaan. Tanpa tanda tangan + stempel ${C} maka item pekerjaan tersebut tidak dapat diakui progressnya dan tidak dapat ditagihkan.`,
    ]);
    paragraph(doc, "**3. RETENSI**", { align: "left", gap: 4 });
    paragraph(
      doc,
      `Pembayaran retensi ${asNumber(retentionPercent)}% (${rp(retentionAmount)}) dari nilai kontrak ditahan oleh ${C} sebagai jaminan pemeliharaan. Pembayaran retensi dapat diajukan 1 bulan dari tanggal serah terima proyek.`,
    );
    paragraph(doc, "**4. PEMBAYARAN**", { align: "left", gap: 4 });
    paragraph(
      doc,
      "Setiap pembayaran akan dilakukan setiap hari Sabtu dan sesuai progres yang masuk. Terhitung 7 hari setelah laporan joint opname masuk.",
    );
    if (notes) paragraph(doc, `Catatan: ${clean(notes)}`);

    /* PASAL 6 */
    clauseHeading(doc, 6, "FORCE MAJEURE");
    paragraph(
      doc,
      "Yang dimaksud dengan FORCE MAJEURE adalah berbagai keadaan yang mengganggu kelancaran pelaksanaan proyek seperti:",
      { align: "left" },
    );
    numbered(doc, [
      "Bencana alam (gempa bumi, tanah longsor, angin topan, banjir, kebakaran, wabah/keadaan darurat (covid, dll) yang bisa menyebabkan terganggunya jalannya proses konstruksi.",
      `${V} diharuskan memberitahu pada ${C} tentang gangguan yang dimaksud beserta kendala dan akibat yang ditimbulkan paling lambat 2x24 jam terhitung sejak peristiwa tersebut terjadi, jika tidak maka akan dianggap tidak terjadi force majeure.`,
      "Dalam keadaan yang disebutkan dalam pasal 6 poin 1, maka KEDUA BELAH PIHAK bisa bermusyawarah untuk kesepakatan dalam memutuskan keberlanjutan proyek.",
    ]);

    /* PASAL 7 */
    clauseHeading(
      doc,
      7,
      "SISTEM KOMUNIKASI SATU PINTU & LARANGAN TRANSAKSI LANGSUNG",
    );
    paragraph(doc, "**I. JALUR KOMUNIKASI RESMI**", { align: "left", gap: 4 });
    numbered(doc, [
      "Semua instruksi, revisi pekerjaan, perubahan lingkup dan koordinasi teknis hanya sah apabila disampaikan melalui Project Manager / Kontraktor Utama.",
      `${V} dilarang menerima instruksi langsung dari pemilik / pengguna / owner / klien tanpa sepengetahuan dan persetujuan tertulis dari ${C}.`,
    ]);
    paragraph(doc, "**II. LARANGAN TRANSAKSI BELAKANG & SANKSI**", {
      align: "left",
      gap: 4,
    });
    numbered(doc, [
      `Mandor / tukang yang bersangkutan akan di BLACKLIST permanen dari seluruh proyek ${C}.`,
      `${C} berhak tidak membayar sisa pekerjaan yang ada.`,
      `Sisa Retensi akan dipotong / ditahan oleh ${C}.`,
    ]);
    paragraph(doc, "**III. PENJELASAN LINGKUP JASA KONTRAKTOR**", {
      align: "left",
      gap: 4,
    });
    numbered(doc, [
      "Yang dibayarkan klien kepada Kontraktor bukan hanya jasa eksekusi fisik, tetapi meliputi : Manajemen Proyek, Quality Control, Jaminan Mutu, Kepastian Hukum, Perencanaan Waktu dan Tanggung Jawab Risiko.",
      "Dengan adanya pasal ini, kedua belah pihak sepakat untuk mematuhi etika profesional demi kelancaran dan keamanan proyek.",
    ]);

    /* PASAL 8 */
    clauseHeading(doc, 8, "SANKSI - SANKSI");
    paragraph(doc, "**I. DENDA KETERLAMBATAN**", { align: "left", gap: 4 });
    paragraph(
      doc,
      `Apabila ${V} tidak sanggup memenuhi kesepakatan yang tercantum pada pasal 2 yaitu waktu pelaksanaan melebihi waktu yang disepakati bersama, maka ${C} akan memberi sanksi berupa DENDA KETERLAMBATAN sebesar 1% (Satu Persen) dari nilai kontrak untuk setiap hari keterlambatan. Keterlambatan pelaksanaan proyek dapat ditolerir apabila terjadi force majeure sesuai pasal 6.`,
    );
    paragraph(
      doc,
      "**II. MANGKIR KERJA / TIDAK KOOPERATIF / MENINGGALKAN PEKERJAAN**",
      { align: "left", gap: 4 },
    );
    paragraph(
      doc,
      `A. Apabila ${V} tidak melakukan kegiatan pekerjaan lebih dari 2 hari kerja berturut-turut tanpa pemberitahuan tertulis dan persetujuan dari ${C}, maka dianggap mangkir.`,
      { indent: LIST_INDENT, align: "left", gap: 3 },
    );
    paragraph(
      doc,
      "B. Apabila PIHAK KEDUA meninggalkan lokasi pekerjaan sebelum mencapai 100% dan BAST ditandatangani, maka dianggap wanprestasi.",
      { indent: LIST_INDENT, align: "left", gap: 3 },
    );
    paragraph(
      doc,
      "C. Atas kejadian pada ayat I dan II, PIHAK PERTAMA berhak :",
      { indent: LIST_INDENT, align: "left", gap: 3 },
    );
    [
      "Memutuskan SPK ini secara sepihak tanpa perlu surat peringatan terlebih dahulu.",
      "Menunjuk PIHAK KETIGA / Subcon Pengganti untuk menyelesaikan sisa pekerjaan.",
      "Menyita material, peralatan dan perlengkapan PIHAK KEDUA yang ada di lokasi sebagai jaminan penyelesaian.",
    ].forEach((text, index) => {
      listItem(doc, `${String.fromCharCode(97 + index)}.`, text, {
        indent: LIST_INDENT + 14,
        gap: 2,
      });
    });
    paragraph(doc, "**III. KONSEKUENSI KEUANGAN & GUGURNYA HAK TAGIH**", {
      align: "left",
      gap: 4,
    });
    paragraph(
      doc,
      "A. Akibat pemutusan pada ayat 2, PIHAK KEDUA dengan ini melepaskan seluruh haknya untuk menuntut pembayaran termin, sisa pekerjaan, retensi, maupun klaim lainnya.",
      { indent: LIST_INDENT, align: "left", gap: 3 },
    );
    paragraph(
      doc,
      "B. PIHAK PERTAMA hanya akan melakukan perhitungan akhir terhadap pekerjaan yang sudah terbukti selesai 100% dan disetujui.",
      { indent: LIST_INDENT, align: "left", gap: 3 },
    );
    paragraph(
      doc,
      "C. Dari hasil perhitungan PIHAK PERTAMA menunjukkan PIHAK KEDUA masih memiliki kekurangan / kerugian, maka PIHAK KEDUA wajib membayar kekurangan tersebut dalam waktu 3 hari kalender.",
      { indent: LIST_INDENT, align: "left", gap: 3 },
    );
    paragraph(doc, "**IV. SANKSI TAMBAHAN & BLACKLIST**", {
      align: "left",
      gap: 4,
    });
    numbered(doc, [
      "PIHAK KEDUA yang melakukan pelanggaran pada ayat 2 dan 3 dikenakan sanksi BLACKLIST permanen dan tidak akan diikutsertakan dalam tender / proyek PIHAK PERTAMA.",
      "Nama PIHAK KEDUA dan penanggung jawabnya dapat disebarluaskan ke asosiasi / rekanan PIHAK PERTAMA sebagai subcon tidak bonafid.",
    ]);

    /* PASAL 9: selalu satu halaman dengan tanda tangan */
    ensureSpace(doc, 270);
    clauseHeading(doc, 9, "PENUTUP");
    paragraph(
      doc,
      "Surat Perjanjian ini mulai berlaku terhitung sejak ditandatangani oleh kedua belah pihak di Surabaya pada hari, tanggal, bulan, dan tahun seperti tersebut di atas, yang dibuat rangkap 2 (Dua) dan Penawaran terlampir yang berkekuatan hukum yang sama, dimana lembar pertama (asli) dan lembar kedua dibubuhi materai secukupnya.",
    );

    doc.y += 12;
    signatureBlocks(doc, { client, vendor }, issueDate);

    /* Dokumen 2: Surat Perintah Kerja */
    renderSuratPerintahKerja(doc, {
      client,
      vendor,
      number,
      issueDate,
      value,
      projectName,
      projectLocation,
      durationDays,
      startDate,
      bankData,
    });

    /* Footer + watermark di semua halaman */
    const range = doc.bufferedPageRange();
    for (
      let index = range.start;
      index < range.start + range.count;
      index += 1
    ) {
      doc.switchToPage(index);
      if (contract.status === "DRAFT") drawDraftWatermark(doc);
      const savedBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc
        .font(SERIF.normal)
        .fontSize(9)
        .fillColor("#666666")
        .text(
          `SPK Subcon \u2022 ${number} \u2022 Halaman ${index + 1} dari ${range.count}`,
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
  renderSpkSubconPdf,
  safeSpkSubconPdfFilename,
  rupiah,
  dateId,
};
