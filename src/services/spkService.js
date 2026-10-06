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

function buildSpkPartySnapshot(type, data = {}) {
  if (!['CLIENT', 'SUBCON'].includes(type)) throw new Error('Tipe SPK tidak valid.');
  const project = data.project;
  const partyName = String(data.partyName || '').trim();
  if (!project?.id) throw new Error('Project SPK tidak ditemukan.');
  if (!partyName) throw new Error('Nama pihak/kontraktor wajib diisi.');
  return {
    sourceType: type,
    sourceId: project.id,
    name: partyName,
    address: project.location || '',
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

function buildSpkDraftUpdate({ existing, project, items, type, partyName, terms, retentionPercent }) {
  if (!existing || existing.status !== 'DRAFT') {
    throw new Error('Hanya SPK DRAFT yang dapat diubah.');
  }
  const partySnapshot = buildSpkPartySnapshot(type, { project, partyName });
  const snapshot = buildSpkSnapshot(project, { id: project.id }, items, type);
  const termData = normalizeSpkTerms(terms, snapshot.contractValue, retentionPercent || 0, false);
  return {
    type,
    contractValue: snapshot.contractValue,
    contractValueWords: null,
    snapshot: { ...snapshot, party: partySnapshot },
    party: partySnapshot,
    terms: termData.terms,
    retentionPercent: termData.retentionPercent,
    retentionAmount: termData.retentionAmount,
  };
}

module.exports = {
  createSpkNumber,
  buildSpkPartySnapshot,
  getSpkItemTotal,
  normalizeSpkTerms,
  buildSpkSnapshot,
  buildSpkDraftUpdate,
};
