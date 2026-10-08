'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { renderSpkClientPdf, safeSpkPdfFilename } = require('./spkClientPdfService');

function extractPdfText(pdf, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spk-pdf-test-'));
  const pdfPath = path.join(dir, `${name}.pdf`);
  fs.writeFileSync(pdfPath, pdf);
  try {
    return execFileSync('pdftotext', [pdfPath, '-'], { encoding: 'utf8' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const issuedContract = {
  id: 'spk-1',
  type: 'CLIENT',
  status: 'TERBIT',
  spkNumber: '020/SPK/10/08/DJP/2026',
  issuedAt: new Date('2026-10-08T08:00:00.000Z'),
  contractValue: 25000000,
  contractValueWords: 'Dua Puluh Lima Juta Rupiah',
  retentionPercent: 5,
  retentionAmount: 1250000,
  workDurationDays: 15,
  startDate: new Date('2026-10-10T00:00:00.000Z'),
  endDate: new Date('2026-10-25T00:00:00.000Z'),
  notes: 'Garansi pekerjaan tiga bulan.',
  partyData: {
    firstParty: {
      name: 'Jimmy Christian S.', position: 'Direktur',
      companyName: 'PT. Dives Jaya Perkasa',
      address: 'Jl. Bulak Rukem Timur I No. 160, Surabaya',
    },
    secondParty: {
      name: 'Daniel Somanonasa M.', position: 'Client / Pemberi Tugas',
      companyName: '', address: 'Stamford ST11/12 - Surabaya',
    },
  },
  snapshot: {
    projectName: 'Canopy Stamford',
    projectLocation: 'Stamford ST11/12 - Surabaya',
    clientName: 'Daniel Somanonasa M.',
    contractValue: 25000000,
    workScope: [{ name: 'Pekerjaan Canopy', unit: 'm2', volume: 10, unitPrice: 2500000, totalPrice: 25000000 }],
    partyData: {
      firstParty: {
        name: 'Jimmy Christian S.', position: 'Direktur',
        companyName: 'PT. Dives Jaya Perkasa', address: 'Alamat snapshot perusahaan',
      },
      secondParty: {
        name: 'Daniel Snapshot', position: 'Pemberi Tugas',
        companyName: '', address: 'Lokasi snapshot',
      },
    },
  },
  terms: [{ label: 'DP', percent: 50, amount: 12500000, dueDescription: 'Saat kontrak ditandatangani', order: 0 }],
};

test('renders issued CLIENT PDF from snapshot with official number', async () => {
  const pdf = await renderSpkClientPdf(issuedContract);
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  assert.ok(pdf.length > 5000);
  const text = extractPdfText(pdf, 'issued');
  assert.match(text, /020\/SPK\/10\/08\/DJP\/2026/);
  assert.match(text, /Daniel Snapshot/);
  assert.doesNotMatch(text, /Daniel Somanonasa M\./);
});

test('renders DRAFT PDF without allocating or printing an official number', async () => {
  const draft = { ...issuedContract, status: 'DRAFT', spkNumber: null, issuedAt: null };
  const pdf = await renderSpkClientPdf(draft);
  const text = extractPdfText(pdf, 'draft');
  assert.match(text, /DRAFT \/ BELUM BERNOMOR/);
  assert.doesNotMatch(text, /020\/SPK/);
});

test('DRAFT PDF uses current live fields instead of embedded document snapshot', async () => {
  const draft = {
    ...issuedContract,
    status: 'DRAFT', spkNumber: null, issuedAt: null,
    contractValue: 99000000,
    contractValueWords: 'Sembilan Puluh Sembilan Juta Rupiah',
    notes: 'Live draft notes',
    partyData: {
      ...issuedContract.partyData,
      secondParty: { ...issuedContract.partyData.secondParty, name: 'Live Draft Client' },
    },
    snapshot: {
      ...issuedContract.snapshot,
      documentSnapshot: { projectName: 'Frozen issued project', contractValue: 1 },
    },
  };
  const text = extractPdfText(await renderSpkClientPdf(draft), 'draft-live');
  assert.match(text, /Live Draft Client/);
  assert.match(text, /Sembilan Puluh Sembilan Juta Rupiah/);
  assert.match(text, /Live draft notes/);
  assert.doesNotMatch(text, /Frozen issued project/);
});
test('issued PDF retains clause protections and document snapshot after live mutation', async () => {
  const documentSnapshot = {
    projectName: 'Snapshot Project', projectLocation: 'Snapshot Location',
    contractValue: 25000000, contractValueWords: 'Dua Puluh Lima Juta Rupiah',
    workScope: [{ name: 'Snapshot Scope', unit: 'ls', volume: 1, totalPrice: 25000000 }],
    parties: issuedContract.partyData,
    terms: issuedContract.terms, retentionPercent: 5, retentionAmount: 1250000,
    workDurationDays: 15, startDate: '2026-10-10T00:00:00.000Z', endDate: '2026-10-25T00:00:00.000Z',
    notes: 'Snapshot notes', bankData: { bankName: 'BCA', accountNumber: '123456', accountName: 'PT DJP' },
  };
  const contract = { ...issuedContract, snapshot: { ...issuedContract.snapshot, documentSnapshot, bankData: {}, projectName: 'Live Project' }, bankData: {}, contractValue: 1, notes: 'Live notes' };
  const text = extractPdfText(await renderSpkClientPdf(contract), 'protections');
  assert.match(text, /Snapshot Project/);
  assert.doesNotMatch(text, /Live Project/);
  assert.match(text, /3 \(tiga\) bulan/);
  assert.match(text, /hak milik PIHAK PERTAMA/);
  assert.match(text, /menghentikan sementara pekerjaan/);
  assert.match(text, /Rekening resmi PIHAK PERTAMA: BCA/);
  assert.match(text, /bukan merupakan kegagalan/);
  assert.match(text, /Snapshot notes/);
});
test('PDF says bank details are unavailable instead of inventing credentials', async () => {
  const text = extractPdfText(await renderSpkClientPdf({ ...issuedContract, bankData: {} }), 'no-bank');
  assert.match(text, /Detail rekening pembayaran resmi PIHAK PERTAMA belum tersedia/);
  assert.doesNotMatch(text, /1032133333/);
});

test('creates a safe PDF filename', () => {
  assert.equal(
    safeSpkPdfFilename({ ...issuedContract, spkNumber: '020/SPK:Client?*', snapshot: { projectName: '../Canopy Stamford' } }),
    'SPK-020-SPK-Client-Canopy-Stamford.pdf',
  );
});
