'use strict';

function createSpkNumber(type, sequence, date = new Date()) {
  if (!['CLIENT', 'SUBCON'].includes(type)) {
    throw new TypeError('Tipe SPK harus CLIENT atau SUBCON.');
  }
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 999) {
    throw new RangeError('Urutan SPK harus bilangan bulat antara 1 dan 999.');
  }
  const pad = String(sequence).padStart(3, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = date.getFullYear();
  return `${pad}/SPK/${month}/${day}/DJP/${year}`;
}

function normalizeParty(party = {}, defaults = {}) {
  return {
    name: String(party.name ?? defaults.name ?? '').trim(),
    position: String(party.position ?? defaults.position ?? '').trim(),
    companyName: String(party.companyName ?? defaults.companyName ?? '').trim(),
    address: String(party.address ?? defaults.address ?? '').trim(),
    signatureUrl: party.signatureUrl || defaults.signatureUrl || null,
  };
}

function buildSpkParties(type, data = {}) {
  if (!['CLIENT', 'SUBCON'].includes(type)) throw new Error('Tipe SPK tidak valid.');
  const project = data.project;
  if (!project?.id) throw new Error('Project SPK tidak ditemukan.');

  if (type === 'CLIENT') {
    const firstParty = normalizeParty(data.firstParty);
    const secondParty = normalizeParty({
      ...data.secondParty,
      name: project.client?.name || '',
      address: project.location || '',
    }, {
      position: 'Client / Pemberi Tugas',
    });
    if (!firstParty.name || !firstParty.position) {
      throw new Error('Nama dan jabatan Pihak Pertama wajib diisi.');
    }
    if (!secondParty.name || !secondParty.position) {
      throw new Error('Nama dan jabatan Pihak Kedua wajib diisi.');
    }
    return { firstParty, secondParty };
  }

  const partyName = String(data.partyName || data.legacyPartyName || data.partyData?.name || '').trim();
  if (!partyName) throw new Error('Nama pihak/kontraktor wajib diisi.');
  return {
    sourceType: type,
    sourceId: project.id,
    name: partyName,
    address: String(data.partyData?.address ?? project.location ?? '').trim(),
  };
}

function normalizeStoredSpkParties(type, partyData = {}, snapshot = {}) {
  const stored = snapshot.partyData || snapshot.parties || partyData || snapshot.party || {};
  if (type !== 'CLIENT') return stored;
  if (stored.firstParty || stored.secondParty) {
    return {
      firstParty: normalizeParty(stored.firstParty),
      secondParty: normalizeParty(stored.secondParty),
    };
  }
  const legacy = normalizeParty(stored, {
    name: snapshot.clientName || '',
    position: 'Client / Pemberi Tugas',
    address: snapshot.projectLocation || '',
  });
  return {
    firstParty: normalizeParty({}, { companyName: 'PT. Dives Jaya Perkasa' }),
    secondParty: legacy,
  };
}

function buildSpkPartySnapshot(type, data = {}) {
  return buildSpkParties(type, data);
}

function parseRequiredDate(value, label) {
  if (value === null || value === undefined || value === '') {
    throw new Error(`${label} wajib diisi.`);
  }
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} tidak valid.`);
  return date;
}

function validateClientSchedule({ workDurationDays, startDate, endDate } = {}) {
  const duration = Number(workDurationDays);
  if (!Number.isSafeInteger(duration) || duration <= 0) {
    throw new Error('Durasi pekerjaan wajib lebih dari 0 hari.');
  }
  const parsedStart = parseRequiredDate(startDate, 'Tanggal mulai pekerjaan');
  const parsedEnd = parseRequiredDate(endDate, 'Tanggal selesai pekerjaan');
  if (parsedEnd.getTime() < parsedStart.getTime()) {
    throw new Error('Tanggal selesai tidak boleh sebelum tanggal mulai.');
  }
  return { workDurationDays: duration, startDate: parsedStart, endDate: parsedEnd };
}

function cloneJson(value, fallback) {
  if (value === undefined || value === null) return fallback;
  return JSON.parse(JSON.stringify(value));
}

function normalizeDocumentTerms(terms = []) {
  return [...terms]
    .sort((left, right) => Number(left.order || 0) - Number(right.order || 0))
    .map((term, index) => ({
      label: String(term.label || `Termin ${index + 1}`).trim(),
      percent: Number(term.percent),
      amount: Number(term.amount),
      dueDescription: term.dueDescription ? String(term.dueDescription).trim() : null,
      milestone: term.milestone ? String(term.milestone).trim() : null,
      order: Number.isFinite(Number(term.order)) ? Number(term.order) : index,
    }));
}

function buildSpkDocumentSnapshot(contract = {}) {
  const source = contract.snapshot || {};
  const parties = normalizeStoredSpkParties(contract.type, contract.partyData, source);
  return {
    version: 1,
    projectName: String(source.projectName || ''),
    projectLocation: String(source.projectLocation || ''),
    clientName: String(source.clientName || ''),
    workScope: cloneJson(source.workScope, []),
    contractValue: Number(source.contractValue ?? contract.contractValue),
    contractValueWords: String(contract.contractValueWords || ''),
    parties: cloneJson(parties, {}),
    terms: normalizeDocumentTerms(contract.terms || []),
    retentionPercent: Number(contract.retentionPercent || 0),
    retentionAmount: Number(contract.retentionAmount || 0),
    workDurationDays: Number(contract.workDurationDays),
    startDate: contract.startDate instanceof Date ? contract.startDate.toISOString() : String(contract.startDate || ''),
    endDate: contract.endDate instanceof Date ? contract.endDate.toISOString() : String(contract.endDate || ''),
    notes: contract.notes ? String(contract.notes) : null,
    bankData: cloneJson(contract.bankData, {}),
  };
}

function normalizeSpkTerms(terms, totalContractValue, retentionPercent = 0, requireComplete = true) {
  if (!Array.isArray(terms) || terms.length === 0) {
    throw new Error('Minimal harus ada satu termin pembayaran.');
  }
  const total = Number(totalContractValue);
  const retention = Number(retentionPercent);
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error('Nilai kontrak harus lebih besar dari nol.');
  }
  if (!Number.isFinite(retention) || retention < 0 || retention > 100) {
    throw new Error('Retensi harus berupa persentase dari 0 sampai 100.');
  }

  let allocated = 0;
  const normalized = terms.map((term, index) => {
    const percent = Number(term.percent);
    const amount = Number(term.amount);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      throw new Error(`Persentase termin ${index + 1} tidak valid.`);
    }
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error(`Nominal termin ${index + 1} tidak valid.`);
    }
    const expectedAmount = Math.round((total * percent) / 100);
    if (Math.abs(expectedAmount - amount) > 1) {
      throw new Error(`Nominal termin ${index + 1} tidak sesuai persentasenya.`);
    }
    allocated += percent;
    return {
      label: String(term.label || `Termin ${index + 1}`).trim(),
      percent,
      amount: expectedAmount,
      dueDescription: String(term.dueDescription || '').trim() || null,
      milestone: String(term.milestone || '').trim() || null,
      order: index,
    };
  });

  const totalPercent = Math.round((allocated + retention) * 100) / 100;
  if (requireComplete && Math.abs(totalPercent - 100) > 0.01) {
    throw new Error(`Total persentase termin dan retensi harus tepat 100% (termin ${allocated}% + retensi ${retention}% = ${totalPercent}%).`);
  }

  return {
    terms: normalized,
    retentionPercent: retention,
    retentionAmount: Math.round((total * retention) / 100),
  };
}

function getSpkItemTotal(item = {}) {
  const rabTotal = Number(item.rabTotalPrice || 0);
  if (Number.isFinite(rabTotal) && rabTotal > 0) return rabTotal;
  const rapTotal = Number(item.rapTotalPrice || 0);
  return Number.isFinite(rapTotal) ? rapTotal : 0;
}

function buildSpkSnapshot(project, source, items, type) {
  const total = items.reduce((sum, item) => sum + getSpkItemTotal(item), 0);
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error('Total sumber RAB tidak valid atau bernilai nol.');
  }
  return {
    projectId: project.id,
    projectName: project.name,
    projectLocation: project.location,
    clientName: project.client?.name || '',
    sourceId: source.id,
    sourceType: 'RAB',
    contractValue: Math.round(total),
    workScope: items.map((item) => ({
      rabItemId: item.id,
      name: item.name,
      unit: item.paymentUnit,
      volume: Number(item.volume),
      unitPrice: Number(item.rabUnitPrice || item.rapUnitPrice || 0),
      totalPrice: getSpkItemTotal(item),
    })),
    type,
  };
}

function buildSpkDraftUpdate({ existing, project, items, type, partyName, parties, firstParty, secondParty, terms, retentionPercent }) {
  if (!existing || existing.status !== 'DRAFT') {
    throw new Error('Hanya SPK DRAFT yang dapat diubah.');
  }
  const existingParties = normalizeStoredSpkParties(type, existing.partyData, existing.snapshot || {});
  const resolvedParties = buildSpkParties(type, {
    project,
    firstParty: firstParty ?? parties?.firstParty ?? existingParties.firstParty,
    secondParty: secondParty ?? parties?.secondParty ?? existingParties.secondParty,
    partyName,
    partyData: existing.partyData,
  });
  const snapshot = buildSpkSnapshot(project, { id: project.id }, items, type);
  const termData = normalizeSpkTerms(terms, snapshot.contractValue, retentionPercent || 0, false);
  return {
    type,
    contractValue: snapshot.contractValue,
    contractValueWords: null,
    snapshot: { ...snapshot, party: resolvedParties, parties: resolvedParties, partyData: resolvedParties },
    party: resolvedParties,
    partyData: resolvedParties,
    terms: termData.terms,
    retentionPercent: termData.retentionPercent,
    retentionAmount: termData.retentionAmount,
  };
}

module.exports = {
  createSpkNumber,
  normalizeParty,
  buildSpkParties,
  normalizeStoredSpkParties,
  buildSpkPartySnapshot,
  validateClientSchedule,
  buildSpkDocumentSnapshot,
  getSpkItemTotal,
  normalizeSpkTerms,
  buildSpkSnapshot,
  buildSpkDraftUpdate,
};
