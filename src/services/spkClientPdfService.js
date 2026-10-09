'use strict';

const fs = require('node:fs');
const path = require('node:path');
const PDFDocument = require('pdfkit');
const { normalizeStoredSpkParties } = require('./spkService');
const { terbilangRupiah } = require('../lib/terbilang');

const LOGO_PATH = path.join(__dirname, '../assets/spk-client-logo.png');
const FONT = {
  normal: 'Times-Roman',
  bold: 'Times-Bold',
  italic: 'Times-Italic',
  boldItalic: 'Times-BoldItalic',
};

const COMPANY = {
  name: 'PT. DIVES JAYA PERKASA',
  address: 'Jl. Bulak Rukem Timur I No. 160 Surabaya',
  contact: '0818-813-134  |  djp.incon@gmail.com',
};

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function rupiah(value) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
  }).format(asNumber(value));
}

function dateId(value) {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta',
  }).format(date);
}

function safePart(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function safeSpkPdfFilename(contract) {
  const number = safePart(contract.spkNumber || 'DRAFT');
  const source = getDocumentSource(contract);
  const project = safePart(source.projectName || 'SPK-Client');
  return `SPK-${number || 'DRAFT'}-${project || 'Client'}.pdf`;
}

function getDocumentSource(contract) {
  const immutable = contract.snapshot?.documentSnapshot || contract.documentSnapshot;
  if (immutable && contract.status !== 'DRAFT') return immutable;
  const base = contract.snapshot || {};
  const parties = contract.status === 'DRAFT'
    ? normalizeStoredSpkParties('CLIENT', contract.partyData, {
      clientName: base.clientName,
      projectLocation: base.projectLocation,
    })
    : normalizeStoredSpkParties('CLIENT', contract.partyData, base);
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
  return normalizeStoredSpkParties('CLIENT', contract.partyData, source);
}

function getBankDetails(bankData = {}) {
  const bank = bankData.bankName || bankData.namaBank || bankData.bank;
  const accountNumber = bankData.accountNumber || bankData.nomorRekening || bankData.accountNo;
  const accountName = bankData.accountName || bankData.namaRekening || bankData.accountHolder;
  if (!bank && !accountNumber && !accountName) return 'Detail rekening pembayaran resmi PIHAK PERTAMA belum tersedia.';
  return `Rekening resmi PIHAK PERTAMA: ${[bank, accountNumber, accountName].filter(Boolean).join(' ')}.`;
}

function ensureSpace(doc, height = 70) {
  if (doc.y + height > doc.page.height - 65) doc.addPage();
}

function drawHeader(doc) {
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  doc.save();
  if (fs.existsSync(LOGO_PATH)) {
    doc.image(LOGO_PATH, left, 24, { fit: [145, 50], align: 'left', valign: 'center' });
  }
  doc.fillColor('#111111');
  doc.font(FONT.bold).fontSize(11).text(COMPANY.name, left + 170, 26, { align: 'right', width: width - 170 });
  doc.font(FONT.normal).fontSize(9).text(COMPANY.address, left + 170, 42, { align: 'right', width: width - 170 });
  doc.text(COMPANY.contact, left + 170, 54, { align: 'right', width: width - 170 });
  doc.moveTo(left, 72).lineTo(left + width, 72).lineWidth(1).stroke();
  doc.restore();
  doc.y = 84;
}

function drawDraftWatermark(doc) {
  doc.save();
  doc.opacity(0.11).fillColor('#b91c1c').font('Helvetica-Bold').fontSize(52);
  doc.rotate(-34, { origin: [doc.page.width / 2, doc.page.height / 2] });
  doc.text('DRAFT / BELUM BERNOMOR', 20, doc.page.height / 2 - 35, {
    width: doc.page.width - 40, align: 'center', lineBreak: false,
  });
  doc.restore();
}

function paragraph(doc, text, options = {}) {
  ensureSpace(doc, options.minHeight || 60);
  const font = options.bold && options.italic
    ? FONT.boldItalic
    : options.bold ? FONT.bold : options.italic ? FONT.italic : FONT.normal;
  doc.font(font)
    .fontSize(options.size || 12)
    .fillColor('#111111')
    .text(String(text), { align: options.align || 'justify', lineGap: 2, ...options.text });
  doc.moveDown(options.gap ?? 0.55);
}

function clauseTitle(doc, title) {
  ensureSpace(doc, 50);
  doc.font(FONT.bold).fontSize(12).fillColor('#111111').text(title, { align: 'center' });
  doc.moveDown(0.3);
}

function clause(doc, title, body) {
  clauseTitle(doc, title);
  paragraph(doc, body, { minHeight: 45 });
}

function listItem(doc, text, options = {}) {
  const left = doc.page.margins.left + 18;
  ensureSpace(doc, 26);
  const font = options.bold && options.italic
    ? FONT.boldItalic
    : options.bold ? FONT.bold : options.italic ? FONT.italic : FONT.normal;
  doc.font(font).fontSize(options.size || 12).fillColor('#111111');
  doc.text(String(text), left, doc.y, {
    align: 'justify', lineGap: 2, width: doc.page.width - left - doc.page.margins.right,
  });
  doc.moveDown(options.gap ?? 0.3);
}

function identity(doc, label, party) {
  ensureSpace(doc, 120);
  doc.font(FONT.bold).fontSize(12).fillColor('#111111').text(label);
  const entries = [
    ['Nama', party.name || '-'],
    ['Jabatan', party.position || '-'],
    ['Perusahaan', party.companyName || '-'],
    ['Alamat', party.address || '-'],
  ];
  const left = doc.page.margins.left + 16;
  const labelWidth = 92;
  for (const [key, value] of entries) {
    ensureSpace(doc, 20);
    const y = doc.y;
    doc.font(FONT.normal).fontSize(12);
    doc.text(key, left, y, { width: labelWidth, lineBreak: false });
    doc.text(`: ${value}`, left + labelWidth, y, { width: doc.page.width - left - labelWidth - doc.page.margins.right });
    doc.y = Math.max(doc.y, y + 16);
  }
  doc.moveDown(0.4);
}

function drawScope(doc, scope) {
  const items = Array.isArray(scope) ? scope : [];
  if (!items.length) {
    paragraph(doc, 'Lingkup pekerjaan sesuai lampiran yang telah disepakati PARA PIHAK.', { align: 'left' });
    return;
  }
  items.forEach((item, index) => {
    listItem(doc, `${index + 1}. ${item.name || '-'} — ${asNumber(item.volume)} ${item.unit || ''} (${rupiah(item.totalPrice)})`);
  });
}

function drawTerms(doc, terms, retentionPercent, retentionAmount) {
  const rows = [...(terms || [])].sort((a, b) => asNumber(a.order) - asNumber(b.order));
  if (!rows.length) {
    paragraph(doc, 'Jadwal pembayaran mengikuti kesepakatan tertulis PARA PIHAK.', { align: 'left' });
  } else {
    rows.forEach((term) => {
      const detail = [term.dueDescription, term.milestone].filter(Boolean).join('; ');
      listItem(doc, `${term.label}: Sebesar ${rupiah(term.amount)}${detail ? ` ${detail}` : ''}`, { bold: true, italic: true });
    });
  }
  if (asNumber(retentionPercent) > 0) {
    listItem(doc, `Retensi: ${asNumber(retentionPercent)}% atau ${rupiah(retentionAmount)}.`);
  }
}

function signatureBlocks(doc, parties, issueDate) {
  ensureSpace(doc, 180);
  const left = doc.page.margins.left;
  const gap = 30;
  const width = (doc.page.width - left - doc.page.margins.right - gap) / 2;
  doc.font(FONT.normal).fontSize(12).fillColor('#111111')
    .text(`Surabaya, ${dateId(issueDate)}`, left, doc.y, { align: 'center', width: width * 2 + gap });
  doc.moveDown(1.2);
  const y = doc.y;
  const blocks = [
    { x: left, label: 'PIHAK PERTAMA', sub: 'PELAKSANA JASA', party: parties.firstParty },
    { x: left + width + gap, label: 'PIHAK KEDUA', sub: 'PEMBERI TUGAS', party: parties.secondParty },
  ];
  for (const block of blocks) {
    doc.font(FONT.bold).fontSize(12).text(block.label, block.x, y, { width, align: 'center' });
    doc.text(block.sub, block.x, doc.y, { width, align: 'center' });
    const nameY = y + 90;
    doc.font(FONT.bold).fontSize(12).text(String(block.party.name || '-').toUpperCase(), block.x, nameY, { width, align: 'center', underline: true });
    doc.font(FONT.normal).fontSize(11).text(block.party.position || '-', block.x, nameY + 18, { width, align: 'center' });
  }
  doc.y = y + 150;
}

function renderSpkClientPdf(contract) {
  if (!contract || contract.type !== 'CLIENT') {
    return Promise.reject(new Error('PDF ini hanya tersedia untuk SPK CLIENT.'));
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4', margins: { top: 88, right: 52, bottom: 60, left: 52 },
      bufferPages: true, compress: false, info: { Title: 'SPK Client' },
    });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    const snapshot = getDocumentSource(contract);
    const parties = getDocumentParties(contract, snapshot);
    const value = asNumber(snapshot.contractValue ?? contract.contractValue);
    const words = snapshot.contractValueWords || contract.contractValueWords || terbilangRupiah(value);
    const number = contract.status === 'DRAFT' ? 'DRAFT / BELUM BERNOMOR' : String(contract.spkNumber || 'BELUM BERNOMOR');
    const issueDate = contract.issuedAt || contract.createdAt || new Date();
    const terms = snapshot.terms ?? contract.terms;
    const retentionPercent = snapshot.retentionPercent ?? contract.retentionPercent;
    const retentionAmount = snapshot.retentionAmount ?? contract.retentionAmount;
    const durationDays = snapshot.workDurationDays ?? contract.workDurationDays;
    const startDate = snapshot.startDate ?? contract.startDate;
    const endDate = snapshot.endDate ?? contract.endDate;
    if (!durationDays || !startDate || !endDate) {
      throw new Error('Jadwal SPK CLIENT belum lengkap dan PDF tidak dapat dibuat.');
    }
    const bankData = snapshot.bankData ?? contract.bankData;
    const notes = snapshot.notes ?? contract.notes;

    doc.on('pageAdded', () => drawHeader(doc));
    drawHeader(doc);

    doc.font(FONT.bold).fontSize(14).fillColor('#111111')
      .text('SURAT PERJANJIAN KONTRAK KERJASAMA', { align: 'center', underline: true });
    doc.moveDown(0.35);
    doc.font(FONT.normal).fontSize(12).text(number, { align: 'center' });
    doc.moveDown(0.55);

    const projectName = snapshot.projectName || 'Pekerjaan Proyek';
    const projectLocation = snapshot.projectLocation || parties.secondParty.address || '-';
    const clientName = parties.secondParty.name || snapshot.clientName || '-';
    doc.font(FONT.normal).fontSize(12).fillColor('#111111');
    doc.text(`Perihal : Perjanjian Kerjasama ${projectName}`, { align: 'left' });
    doc.text('Kepada Yth.', { align: 'left' });
    doc.font(FONT.bold).text(clientName, { align: 'left' });
    doc.font(FONT.normal).text(parties.secondParty.address || projectLocation, { align: 'left' });
    doc.moveDown(0.55);

    paragraph(doc, `Pada ${dateId(issueDate)} kami yang bertanda tangan di bawah ini :`, { align: 'left', minHeight: 28 });
    identity(doc, 'PIHAK PERTAMA (Selanjutnya disebut pelaksana jasa).', parties.firstParty);
    identity(doc, 'PIHAK KEDUA (Selanjutnya disebut pemberi tugas / klien).', parties.secondParty);

    paragraph(doc, `PIHAK PERTAMA dan PIHAK KEDUA secara bersama-sama selanjutnya disebut PARA PIHAK. PARA PIHAK dengan ini menerangkan terlebih dahulu bahwa sehubungan dengan Proyek ${projectName} yang berlokasi di ${projectLocation}, PARA PIHAK telah setuju dan sepakat untuk mengikat diri dalam suatu Perjanjian Kerjasama. Selanjutnya disebut PERJANJIAN dengan ketentuan dan syarat-syarat sebagai berikut :`);

    clause(doc, 'PASAL 1 LINGKUP PEKERJAAN', 'PIHAK KEDUA memberikan pekerjaan kepada PIHAK PERTAMA dan PIHAK PERTAMA menerima pekerjaan tersebut dari PIHAK KEDUA yaitu melaksanakan pekerjaan dengan spesifikasi teknis yang diuraikan sesuai dengan yang terlampir dalam Surat Penawaran.');
    drawScope(doc, snapshot.workScope);

    clause(doc, 'PASAL 2 NILAI KONTRAK', `Nilai kontrak yang telah disepakati bersama sebesar ${rupiah(value)} (${words}). Harga yang sudah disepakati merupakan harga borongan atau paket.`);

    clauseTitle(doc, 'PASAL 3 Cara Pembayaran');
    paragraph(doc, `Pembayaran dilakukan oleh PIHAK KEDUA kepada PIHAK PERTAMA sebesar ${rupiah(value)} (${words}) melalui transfer ke rekening resmi PIHAK PERTAMA. ${getBankDetails(bankData)}`);
    paragraph(doc, 'Pembayaran dilakukan dengan sistem termin sebagai berikut:', { align: 'left', minHeight: 30 });
    drawTerms(doc, terms, retentionPercent, retentionAmount);
    paragraph(doc, 'Pengajuan dokumen penagihan termin wajib disampaikan sebelum tanggal jatuh tempo pembayaran, guna memberikan waktu yang cukup bagi PIHAK PERTAMA untuk proses administrasi dan pencairan.');
    paragraph(doc, 'Apabila sampai dengan tanggal jatuh tempo pembayaran PIHAK PERTAMA belum menerima pembayaran, maka PIHAK PERTAMA berhak menerbitkan surat penagihan resmi dan menghentikan pekerjaan sementara, tanpa dianggap sebagai wanprestasi, sampai pembayaran diterima.');

    clauseTitle(doc, 'PASAL 4 Jangka Waktu Pelaksanaan');
    paragraph(doc, `Pelaksanaan pekerjaan dimulai pada ${dateId(startDate)}.`);
    paragraph(doc, `Lama pekerjaan adalah ${durationDays} hari kerja sampai dengan ${dateId(endDate)}, dengan ketentuan:`);
    listItem(doc, 'Hari Minggu dan hari libur nasional tidak dihitung sebagai hari kerja');
    listItem(doc, 'Pekerjaan lembur tidak diperhitungkan sebagai pengurang waktu kontrak');

    clauseTitle(doc, 'PASAL 5 Jaminan dan Garansi');
    paragraph(doc, 'Mutu/kualitas pelaksanaan pekerjaan sesuai dengan standar spesifikasi yang telah ditetapkan dan disetujui oleh PIHAK KEDUA. Gambar 3D yang diberikan ke klien adalah ilustrasi bukan 100% akurasi dari hasil pekerjaan.');
    paragraph(doc, 'PIHAK PERTAMA/pekerja PIHAK PERTAMA ikut menjamin keamanan dan ketertiban lingkungan di sekitarnya.');
    paragraph(doc, 'Garansi Pekerjaan untuk kerusakan pekerjaan tersebut adalah 3 (tiga) bulan. Kerusakan yang disebabkan faktor alam, kecelakaan lainnya, atau kelalaian PIHAK KEDUA yang bukan disebabkan oleh PIHAK PERTAMA tidak termasuk dalam garansi.');
    paragraph(doc, `Material, perlengkapan, dan/atau bagian pekerjaan yang belum dilunasi sepenuhnya tetap menjadi hak milik PIHAK PERTAMA dan tidak diperkenankan untuk dipindahkan, digunakan, atau diklaim oleh PIHAK KEDUA sebelum pembayaran diselesaikan.${notes ? ` Catatan: ${notes}` : ''}`);

    clauseTitle(doc, 'PASAL 6 Force Majeure');
    paragraph(doc, 'Force majeure adalah keadaan di luar kemampuan para pihak seperti bencana alam, kebakaran, huru-hara, perang, pandemi, atau kebijakan pemerintah yang menghalangi pelaksanaan pekerjaan.');
    paragraph(doc, 'Dalam hal terjadi force majeure, pihak yang terdampak wajib memberitahukan secara tertulis paling lambat 7 (tujuh) hari kalender sejak terjadinya keadaan tersebut.');
    paragraph(doc, 'Kedua pihak akan bermusyawarah untuk mencari penyelesaian terbaik, termasuk perpanjangan waktu pekerjaan.');
    paragraph(doc, 'Pembersihan area kerja dan serah terima pekerjaan dilaksanakan setelah seluruh kewajiban pembayaran dinyatakan lunas oleh PIHAK KEDUA.');
    paragraph(doc, 'Apabila terdapat pekerjaan yang belum dapat diselesaikan akibat belum terpenuhinya kewajiban pembayaran, maka kondisi tersebut bukan merupakan kegagalan pekerjaan dan tidak dianggap sebagai kegagalan atau kelalaian PIHAK PERTAMA; penyelesaian akan dilakukan setelah pembayaran diterima sepenuhnya.');

    clauseTitle(doc, 'PASAL 7 Pekerjaan Tambah/Kurang');
    paragraph(doc, 'Pekerjaan tambah atau kurang hanya dapat dilaksanakan setelah ada persetujuan tertulis dari PIHAK KEDUA.');
    paragraph(doc, 'Nilai pekerjaan tambah atau kurang akan dihitung berdasarkan harga satuan dan kesepakatan baru kedua belah pihak.');
    paragraph(doc, 'Apabila dalam pelaksanaan pekerjaan terjadi perbedaan volume atau spesifikasi antara gambar kerja, perencanaan, dan kondisi nyata di lapangan, maka kedua belah pihak sepakat untuk memberikan toleransi secara wajar serta menyelesaikan perbedaan tersebut melalui musyawarah dengan prinsip adil, proporsional, dan tidak merugikan salah satu pihak.');

    clauseTitle(doc, 'PASAL 8 Domisili Hukum dan Penyelesaian Perselisihan');
    paragraph(doc, 'Apabila terjadi perselisihan antara PIHAK PERTAMA dan PIHAK KEDUA, maka terlebih dahulu akan diselesaikan secara musyawarah untuk mufakat.');
    paragraph(doc, 'Apabila penyelesaian secara musyawarah tidak tercapai, maka para pihak sepakat memilih domisili hukum tetap di Pengadilan Negeri Surabaya.');
    paragraph(doc, 'Apabila terjadi permasalahan mengenai pembayaran yang tidak mendapat kesepakatan atau belum dapat dibayarkan, maka akan dibuatkan Surat Pengakuan Hutang yang ditandatangani dan disepakati bersama oleh kedua belah pihak.');

    clauseTitle(doc, 'PASAL 9 Penutup');
    paragraph(doc, 'Surat Perjanjian ini dibuat dan ditandatangani bersama oleh PARA PIHAK pada hari dan tanggal tersebut.');
    paragraph(doc, 'Surat Perjanjian ini dibuat dalam rangkap 2 (dua), masing-masing diberi materai secukupnya dan mempunyai kekuatan hukum yang sama.');

    signatureBlocks(doc, parties, issueDate);

    const range = doc.bufferedPageRange();
    for (let index = range.start; index < range.start + range.count; index += 1) {
      doc.switchToPage(index);
      if (contract.status === 'DRAFT') drawDraftWatermark(doc);
      doc.font(FONT.normal).fontSize(9).fillColor('#666666').text(
        `SPK Client • ${number} • Halaman ${index + 1} dari ${range.count}`,
        doc.page.margins.left,
        doc.page.height - 38,
        { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: 'center', lineBreak: false },
      );
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
