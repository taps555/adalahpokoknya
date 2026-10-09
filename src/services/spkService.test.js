'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSpkParties,
  normalizeStoredSpkParties,
  buildSpkDraftUpdate,
  validateClientSchedule,
  buildSpkDocumentSnapshot,
} = require('./spkService');

const project = {
  id: 'project-1',
  name: 'Renovasi Stamford',
  location: 'Stamford ST11/12 - Surabaya',
  client: { id: 'client-1', name: 'Daniel Somanonasa M.' },
};

const firstParty = {
  name: 'Jimmy Christian S.',
  position: 'Direktur',
  companyName: 'PT. Dives Jaya Perkasa',
  address: 'Jl. Bulak Rukem Timur I No. 160, Surabaya',
};

test('CLIENT requires names and positions for both parties', () => {
  assert.throws(
    () => buildSpkParties('CLIENT', { project, firstParty: { name: 'Jimmy' } }),
    /Nama dan jabatan Pihak Pertama wajib diisi/,
  );
  assert.throws(
    () => buildSpkParties('CLIENT', {
      project: { ...project, client: null },
      firstParty,
      secondParty: { position: 'Pemberi Tugas' },
    }),
    /Nama dan jabatan Pihak Kedua wajib diisi/,
  );
});

test('CLIENT derives second-party identity and address from the selected project', () => {
  const parties = buildSpkParties('CLIENT', {
    project,
    firstParty,
    secondParty: {
      name: 'Nama yang tidak boleh dipakai',
      position: 'Client / Pemberi Tugas',
      address: 'Alamat yang tidak boleh dipakai',
    },
  });
  assert.equal(parties.secondParty.name, project.client.name);
  assert.equal(parties.secondParty.address, project.location);
});

test('SUBCON preserves the legacy single-party shape', () => {
  assert.deepEqual(buildSpkParties('SUBCON', { project, partyName: 'CV. Baja Kuat' }), {
    sourceType: 'SUBCON',
    sourceId: 'project-1',
    name: 'CV. Baja Kuat',
    address: 'Stamford ST11/12 - Surabaya',
  });
});

test('legacy CLIENT party data remains readable as second party', () => {
  const normalized = normalizeStoredSpkParties(
    'CLIENT',
    { name: 'Daniel Lama', address: 'Alamat Lama' },
    { clientName: 'Snapshot Client', projectLocation: 'Snapshot Location' },
  );
  assert.equal(normalized.secondParty.name, 'Daniel Lama');
  assert.equal(normalized.secondParty.position, 'Client / Pemberi Tugas');
  assert.equal(normalized.secondParty.address, 'Alamat Lama');
  assert.equal(normalized.firstParty.companyName, 'PT. Dives Jaya Perkasa');
});

test('draft update writes parties into immutable snapshot and partyData', () => {
  const result = buildSpkDraftUpdate({
    existing: { status: 'DRAFT', partyData: {} },
    project,
    items: [{
      id: 'rab-1', name: 'Canopy', paymentUnit: 'm2', volume: 10,
      rabUnitPrice: 2500000, rabTotalPrice: 25000000,
    }],
    type: 'CLIENT',
    firstParty,
    secondParty: { position: 'Client / Pemberi Tugas' },
    terms: [{ label: 'DP', percent: 50, amount: 12500000 }],
    retentionPercent: 0,
  });
  assert.equal(result.contractValue, 25000000);
  assert.deepEqual(result.snapshot.partyData, result.partyData);
  assert.equal(result.snapshot.partyData.secondParty.name, project.client.name);
});

test('CLIENT schedule requires positive duration and complete valid date range', () => {
  assert.throws(
    () => validateClientSchedule({ workDurationDays: 0, startDate: '2026-10-10', endDate: '2026-10-11' }),
    /Durasi pekerjaan wajib lebih dari 0 hari/,
  );
  assert.throws(
    () => validateClientSchedule({ workDurationDays: 10, startDate: '', endDate: '2026-10-11' }),
    /Tanggal mulai pekerjaan wajib diisi/,
  );
  assert.throws(
    () => validateClientSchedule({ workDurationDays: 10, startDate: '2026-10-12', endDate: '2026-10-11' }),
    /Tanggal selesai tidak boleh sebelum tanggal mulai/,
  );
  assert.deepEqual(validateClientSchedule({ workDurationDays: 10, startDate: '2026-10-10', endDate: '2026-10-11' }), {
    workDurationDays: 10,
    startDate: new Date('2026-10-10T00:00:00.000Z'),
    endDate: new Date('2026-10-11T00:00:00.000Z'),
  });
});

test('issued document snapshot contains all renderer inputs and preserves bank data', () => {
  const snapshot = buildSpkDocumentSnapshot({
    type: 'CLIENT', status: 'DRAFT', contractValue: 25000000,
    contractValueWords: 'Dua Puluh Lima Juta Rupiah',
    workDurationDays: 15, startDate: new Date('2026-10-10'), endDate: new Date('2026-10-25'),
    notes: 'Catatan', bankData: { bankName: 'Bank Test', accountNumber: '123' },
    partyData: { firstParty: { name: 'A' }, secondParty: { name: 'B' } },
    snapshot: { projectName: 'Project', projectLocation: 'Location', workScope: [{ name: 'Scope' }] },
    terms: [{ label: 'DP', percent: 50, amount: 12500000, order: 0 }],
    retentionPercent: 5, retentionAmount: 1250000,
  });
  assert.equal(snapshot.contractValueWords, 'Dua Puluh Lima Juta Rupiah');
  assert.equal(snapshot.workDurationDays, 15);
  assert.equal(snapshot.bankData.accountNumber, '123');
  assert.equal(snapshot.terms[0].label, 'DP');
  assert.equal(snapshot.parties.firstParty.name, 'A');
});
