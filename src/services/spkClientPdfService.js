'use strict';

const PDFDocument = require('pdfkit');
const { normalizeStoredSpkParties } = require('./spkService');
const { terbilangRupiah } = require('../lib/terbilang');

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
  return `Rekening resmi PIHAK PERTAMA: ${[bank, accountNumber, accountName].filter(Boolean).join(' — ')}.`;
}

function ensureSpace(doc, height = 70) {
  if (doc.y + height > doc.page.height - 65) doc.addPage();
}

function drawHeader(doc) {
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  doc.save();
  doc.font('Helvetica-Bold').fontSize(12).text(COMPANY.name, left, 35, { align: 'center', width });
  doc.font('Helvetica').fontSize(8).text(COMPANY.address, { align: 'center', width });
  doc.text(COMPANY.contact, { align: 'center', width });
  doc.moveTo(left, 75).lineTo(left + width, 75).lineWidth(1.2).stroke();
  doc.restore();
  doc.y = 88;
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
  doc.font(options.bold ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize(options.size || 9)
    .fillColor('#111111')
    .text(String(text), { align: options.align || 'justify', lineGap: 2, ...options.text });
  doc.moveDown(options.gap ?? 0.55);
}

function clause(doc, title, body) {
  ensureSpace(doc, 95);
  doc.font('Helvetica-Bold').fontSize(10).text(title.toUpperCase(), { align: 'center' });
  doc.moveDown(0.25);
  paragraph(doc, body, { minHeight: 45 });
}

function identity(doc, label, party, definition) {
  ensureSpace(doc, 115);
  doc.font('Helvetica-Bold').fontSize(9).text(`${label} — ${definition}`);
  const entries = [
    ['Nama', party.name || '-'],
    ['Jabatan', party.position || '-'],
    ['Perusahaan', party.companyName || '-'],
    ['Alamat', party.address || '-'],
  ];
  for (const [key, value] of entries) {
    const y = doc.y;
    doc.font('Helvetica').fontSize(9).text(key, doc.page.margins.left + 10, y, { width: 75 });
    doc.text(`: ${value}`, doc.page.margins.left + 88, y, { width: 390 });
    doc.y = Math.max(doc.y, y + 13);
  }
  doc.moveDown(0.4);
}

function drawScope(doc, scope) {
  const items = Array.isArray(scope) ? scope : [];
  const lines = items.length
    ? items.map((item, index) => `${index + 1}. ${item.name || '-'} — ${asNumber(item.volume)} ${item.unit || ''} (${rupiah(item.totalPrice)})`)
    : ['Lingkup pekerjaan sesuai lampiran yang telah disepakati PARA PIHAK.'];
  paragraph(doc, lines.join('\n'), { align: 'left' });
}

function drawTerms(doc, terms, retentionPercent, retentionAmount) {
  const rows = [...(terms || [])].sort((a, b) => asNumber(a.order) - asNumber(b.order));
  if (!rows.length) {
    paragraph(doc, 'Jadwal pembayaran mengikuti kesepakatan tertulis PARA PIHAK.', { align: 'left' });
  } else {
    rows.forEach((term, index) => {
      const detail = [term.dueDescription, term.milestone].filter(Boolean).join('; ');
      paragraph(doc, `${index + 1}. ${term.label}: ${asNumber(term.percent)}% atau ${rupiah(term.amount)}${detail ? ` — ${detail}` : ''}`, { align: 'left', minHeight: 25, gap: 0.15 });
    });
  }
  if (asNumber(retentionPercent) > 0) {
    paragraph(doc, `Retensi: ${asNumber(retentionPercent)}% atau ${rupiah(retentionAmount)}.`, { align: 'left', minHeight: 25 });
  }
}

function signatureBlocks(doc, parties, issueDate) {
  ensureSpace(doc, 175);
  const left = doc.page.margins.left;
  const gap = 25;
  const width = (doc.page.width - left - doc.page.margins.right - gap) / 2;
  doc.font('Helvetica').fontSize(9).text(`Surabaya, ${dateId(issueDate)}`, left, doc.y, { align: 'center', width: width * 2 + gap });
  doc.moveDown(1);
  const y = doc.y;
  const blocks = [
    { x: left, label: 'PIHAK PERTAMA\nPELAKSANA JASA', party: parties.firstParty },
    { x: left + width + gap, label: 'PIHAK KEDUA\nPEMBERI TUGAS', party: parties.secondParty },
  ];
  for (const block of blocks) {
    doc.font('Helvetica-Bold').text(block.label, block.x, y, { width, align: 'center' });
    doc.font('Helvetica').fontSize(8).text('\n\n\n\n\n', block.x, doc.y, { width, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(9).text(block.party.name || '-', block.x, y + 100, { width, align: 'center', underline: true });
    doc.font('Helvetica').fontSize(8).text(block.party.position || '-', block.x, y + 115, { width, align: 'center' });
  }
  doc.y = y + 140;
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

    doc.font('Helvetica-Bold').fontSize(13).text('SURAT PERJANJIAN KONTRAK KERJASAMA', { align: 'center', underline: true });
    doc.fontSize(10).text(`Nomor: ${number}`, { align: 'center' });
    doc.moveDown(0.8);
    paragraph(doc, `Perihal: Perjanjian Kerjasama ${snapshot.projectName || 'Pekerjaan Proyek'}`, { align: 'left' });
    paragraph(doc, `Pada tanggal ${dateId(issueDate)}, para pihak yang bertanda tangan di bawah ini sepakat mengikatkan diri dalam Surat Perjanjian Kontrak Kerjasama ini:`);

    identity(doc, 'PIHAK PERTAMA', parties.firstParty, 'Pelaksana Jasa');
    identity(doc, 'PIHAK KEDUA', parties.secondParty, 'Client / Pemberi Tugas');

    paragraph(doc, `PIHAK PERTAMA dan PIHAK KEDUA selanjutnya disebut PARA PIHAK. Sehubungan dengan proyek ${snapshot.projectName || '-'} yang berlokasi di ${snapshot.projectLocation || parties.secondParty.address || '-'}, PARA PIHAK sepakat pada ketentuan berikut.`);

    clause(doc, 'PASAL 1 — LINGKUP PEKERJAAN', 'PIHAK KEDUA memberikan pekerjaan kepada PIHAK PERTAMA dan PIHAK PERTAMA menerima serta melaksanakan pekerjaan sesuai spesifikasi, mutu, dan lingkup yang disepakati:');
    drawScope(doc, snapshot.workScope);

    clause(doc, 'PASAL 2 — NILAI KONTRAK', `Nilai kontrak pekerjaan disepakati sebesar ${rupiah(value)} (${words}). Nilai tersebut bersumber dari item RAB terpilih yang menjadi bagian tidak terpisahkan dari perjanjian ini.`);

    clause(doc, 'PASAL 3 — CARA PEMBAYARAN', `PIHAK KEDUA melakukan pembayaran kepada PIHAK PERTAMA sesuai termin berikut. ${getBankDetails(bankData)} Keterlambatan pembayaran: apabila sampai tanggal jatuh tempo pembayaran belum diterima, PIHAK PERTAMA berhak menerbitkan surat penagihan resmi dan menghentikan sementara pekerjaan tanpa dianggap wanprestasi sampai pembayaran diterima.`);
    drawTerms(doc, terms, retentionPercent, retentionAmount);
    paragraph(doc, 'Dokumen penagihan termin wajib disampaikan sebelum tanggal jatuh tempo agar tersedia waktu untuk proses administrasi dan pencairan.');

    const duration = durationDays ? `${durationDays} hari kerja` : 'sesuai jadwal yang disepakati';
    clause(doc, 'PASAL 4 — JANGKA WAKTU PELAKSANAAN', `Pekerjaan dilaksanakan selama ${duration}, mulai ${dateId(startDate)} sampai ${dateId(endDate)}. Perubahan jadwal wajib disepakati tertulis oleh PARA PIHAK.`);

    clause(doc, 'PASAL 5 — JAMINAN DAN GARANSI', `PIHAK PERTAMA menjamin pelaksanaan sesuai spesifikasi yang disetujui, menjaga keamanan dan ketertiban area kerja. Garansi atas kerusakan pekerjaan berlaku selama 3 (tiga) bulan. Kerusakan akibat faktor alam, kecelakaan, atau kelalaian PIHAK KEDUA yang bukan disebabkan PIHAK PERTAMA tidak termasuk garansi. Material, perlengkapan, dan/atau bagian pekerjaan yang belum dilunasi sepenuhnya tetap menjadi hak milik PIHAK PERTAMA dan tidak boleh dipindahkan, digunakan, atau diklaim PIHAK KEDUA sebelum pembayaran diselesaikan.${notes ? ` Catatan: ${notes}` : ''}`);

    clause(doc, 'PASAL 6 — FORCE MAJEURE', 'Force majeure adalah keadaan di luar kemampuan PARA PIHAK, termasuk bencana alam, kebakaran, huru-hara, perang, pandemi, atau kebijakan pemerintah yang menghalangi pekerjaan. Pihak terdampak wajib memberitahukan secara tertulis paling lambat 7 (tujuh) hari kalender, kemudian PARA PIHAK bermusyawarah mengenai penyesuaian waktu dan kewajiban. Pembersihan area kerja dan serah terima pekerjaan hanya dilaksanakan setelah seluruh kewajiban pembayaran dilunasi PIHAK KEDUA. Pekerjaan yang belum dapat diselesaikan akibat belum terpenuhinya kewajiban pembayaran bukan merupakan kegagalan atau kelalaian PIHAK PERTAMA; pekerjaan dilanjutkan setelah pembayaran diterima.');

    clause(doc, 'PASAL 7 — PEKERJAAN TAMBAH/KURANG', 'Pekerjaan tambah atau kurang hanya dilaksanakan setelah persetujuan tertulis PARA PIHAK. Nilainya dihitung berdasarkan volume, harga satuan, spesifikasi, dan kesepakatan baru. Perbedaan kondisi lapangan diselesaikan secara adil dan proporsional melalui musyawarah.');

    clause(doc, 'PASAL 8 — DOMISILI HUKUM DAN PENYELESAIAN PERSELISIHAN', 'Perselisihan terlebih dahulu diselesaikan secara musyawarah untuk mufakat. Apabila tidak tercapai, PARA PIHAK memilih domisili hukum tetap di Pengadilan Negeri Surabaya. Kewajiban pembayaran yang belum terselesaikan dituangkan dalam dokumen tertulis yang disepakati PARA PIHAK.');

    clause(doc, 'PASAL 9 — PENUTUP', 'Perjanjian ini dibuat dan ditandatangani PARA PIHAK dalam 2 (dua) rangkap, masing-masing bermeterai secukupnya dan berkekuatan hukum yang sama. Lampiran lingkup pekerjaan, RAB terpilih, dan kesepakatan tertulis lainnya merupakan bagian tidak terpisahkan dari perjanjian ini.');

    signatureBlocks(doc, parties, issueDate);

    const range = doc.bufferedPageRange();
    for (let index = range.start; index < range.start + range.count; index += 1) {
      doc.switchToPage(index);
      if (contract.status === 'DRAFT') drawDraftWatermark(doc);
      doc.font('Helvetica').fontSize(7).fillColor('#666666').text(
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
