'use strict';

const express = require('express');
const prisma = require('../../lib/prisma');
const { verifyToken } = require('../../middleware/auth');
const {
  createSpkNumber,
  normalizeSpkTerms,
  buildSpkSnapshot,
  buildSpkParties,
  normalizeStoredSpkParties,
  buildSpkDraftUpdate,
  getSpkItemTotal,
  validateClientSchedule,
  buildSpkDocumentSnapshot,
} = require('../../services/spkService');
const { renderSpkClientPdf, safeSpkPdfFilename } = require('../../services/spkClientPdfService');
const { terbilangRupiah } = require('../../lib/terbilang');

const router = express.Router();
const CURRENT_YEAR = new Date().getFullYear();

function parseType(value) {
  const type = String(value || '').trim().toUpperCase();
  if (!['CLIENT', 'SUBCON'].includes(type)) throw new Error('Tipe SPK harus CLIENT atau SUBCON.');
  return type;
}

function parseDate(value, fallback = new Date()) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Tanggal tidak valid.');
  return date;
}

function clientScheduleInput(body, existing = {}) {
  return {
    workDurationDays: body.workDurationDays !== undefined ? body.workDurationDays : existing.workDurationDays,
    startDate: body.startDate !== undefined ? body.startDate : existing.startDate,
    endDate: body.endDate !== undefined ? body.endDate : existing.endDate,
  };
}

function validateScheduleForType(type, body, existing = {}) {
  if (type !== 'CLIENT') return null;
  return validateClientSchedule(clientScheduleInput(body, existing));
}

function serializeContract(contract) {
  const partyData = contract.type === 'CLIENT'
    ? normalizeStoredSpkParties(contract.type, contract.partyData, contract.snapshot)
    : contract.partyData;
  return {
    ...contract,
    partyData,
    contractValue: Number(contract.contractValue),
    retentionPercent: Number(contract.retentionPercent),
    retentionAmount: Number(contract.retentionAmount),
    contractValueWords: contract.contractValueWords,
    terms: (contract.terms || []).map((term) => ({
      ...term,
      percent: Number(term.percent),
      amount: Number(term.amount),
    })),
  };
}

router.use(verifyToken);

// Daftar kontrak SPK dan sumber RAB untuk project.
router.get('/projects/:projectId/spk-contracts', async (req, res) => {
  try {
    const { projectId } = req.params;
    const [contracts, project] = await Promise.all([
      prisma.spkContract.findMany({
        where: { projectId },
        include: { terms: { orderBy: { order: 'asc' } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true, name: true, location: true, client: { select: { id: true, name: true } } },
      }),
    ]);
    if (!project) return res.status(404).json({ error: 'Project tidak ditemukan.' });
    res.json({ project, contracts: contracts.map(serializeContract) });
  } catch (error) {
    console.error('List SPK error:', error);
    res.status(500).json({ error: 'Gagal mengambil data SPK.' });
  }
});

router.get('/projects/:projectId/spk-contracts/rab-source', async (req, res) => {
  try {
    const { projectId } = req.params;
    const items = await prisma.rabItem.findMany({
      where: { projectId, isHeaderOnly: false },
      select: { id: true, name: true, paymentUnit: true, volume: true, rapUnitPrice: true, rapTotalPrice: true, rabUnitPrice: true, rabTotalPrice: true, workCategoryId: true },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    const total = items.reduce((sum, item) => sum + getSpkItemTotal(item), 0);
    res.json({ sourceType: 'RAB', projectId, totalContractValue: Math.round(total), totalContractValueWords: terbilangRupiah(total), items });
  } catch (error) {
    console.error('SPK RAB source error:', error);
    res.status(500).json({ error: 'Gagal mengambil sumber nilai RAB.' });
  }
});

router.post('/projects/:projectId/spk-contracts', async (req, res) => {
  try {
    const { projectId } = req.params;
    const type = parseType(req.body.type);
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, location: true, client: { select: { id: true, name: true } } },
    });
    if (!project) return res.status(404).json({ error: 'Project tidak ditemukan.' });
    const schedule = validateScheduleForType(type, req.body);

    const partyInput = req.body.partyData || req.body.parties || {};
    const partyName = String(req.body.partyName || partyInput.contractorName || partyInput.name || '').trim();
    const partySnapshot = buildSpkParties(type, {
      project,
      firstParty: req.body.firstParty || partyInput.firstParty,
      secondParty: req.body.secondParty || partyInput.secondParty,
      partyName,
      partyData: partyInput,
    });

    const itemIds = Array.isArray(req.body.rabItemIds) ? [...new Set(req.body.rabItemIds.filter(Boolean))] : [];
    const items = await prisma.rabItem.findMany({
      where: { projectId, id: { in: itemIds.length ? itemIds : ['__none__'] }, isHeaderOnly: false },
      select: { id: true, name: true, paymentUnit: true, volume: true, rapUnitPrice: true, rapTotalPrice: true, rabUnitPrice: true, rabTotalPrice: true },
      orderBy: { order: 'asc' },
    });
    if (items.length !== itemIds.length) return res.status(400).json({ error: 'Sebagian item RAB tidak ditemukan.' });
    if (!items.length) return res.status(400).json({ error: 'Pilih minimal satu item RAB sebagai sumber kontrak.' });

    const snapshot = buildSpkSnapshot(project, { id: projectId }, items, type);
    const totalContractValue = snapshot.contractValue;
    if (req.body.contractValue !== undefined && req.body.contractValue !== null && req.body.contractValue !== '') {
      const incomingValue = Number(req.body.contractValue);
      if (Number.isFinite(incomingValue) && Math.abs(Math.round(incomingValue) - snapshot.contractValue) > 1) {
        return res.status(400).json({ error: 'Nilai kontrak harus berasal dari snapshot RAB yang dipilih.' });
      }
    }
    const termData = normalizeSpkTerms(req.body.terms, totalContractValue, req.body.retentionPercent || 0, false);
    const contract = await prisma.spkContract.create({
      data: {
        projectId,
        type,
        status: 'DRAFT',
        sourceType: 'RAB',
        sourceId: projectId,
        contractValue: totalContractValue,
        contractValueWords: terbilangRupiah(totalContractValue),
        snapshot: { ...snapshot, party: partySnapshot, parties: partySnapshot, partyData: partySnapshot },
        partyData: partySnapshot,
        workDurationDays: schedule?.workDurationDays ?? (req.body.workDurationDays ? Number(req.body.workDurationDays) : null),
        startDate: schedule?.startDate ?? (req.body.startDate ? parseDate(req.body.startDate) : null),
        endDate: schedule?.endDate ?? (req.body.endDate ? parseDate(req.body.endDate) : null),
        bankData: req.body.bankData || {},
        notes: req.body.notes || null,
        retentionPercent: termData.retentionPercent,
        retentionAmount: termData.retentionAmount,
        terms: { create: termData.terms.map((term) => ({ ...term, status: 'PENDING' })) },
      },
      include: { terms: { orderBy: { order: 'asc' } } },
    });
    res.status(201).json(serializeContract(contract));
  } catch (error) {
    console.error('Create SPK error:', error);
    res.status(400).json({ error: error.message || 'Gagal membuat draft SPK.' });
  }
});

router.patch('/spk-contracts/:id', async (req, res) => {
  try {
    const existing = await prisma.spkContract.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'SPK tidak ditemukan.' });
    if (existing.status !== 'DRAFT') return res.status(400).json({ error: 'Hanya SPK DRAFT yang dapat diubah.' });

    const type = req.body.type ? parseType(req.body.type) : existing.type;
    const project = await prisma.project.findUnique({
      where: { id: existing.projectId },
      select: { id: true, name: true, location: true, client: { select: { id: true, name: true } } },
    });
    if (!project) return res.status(404).json({ error: 'Project tidak ditemukan.' });
    const schedule = validateScheduleForType(type, req.body, existing);

    const itemIds = Array.isArray(req.body.rabItemIds) ? [...new Set(req.body.rabItemIds.filter(Boolean))] : [];
    const items = await prisma.rabItem.findMany({
      where: { projectId: existing.projectId, id: { in: itemIds.length ? itemIds : ['__none__'] }, isHeaderOnly: false },
      select: { id: true, name: true, paymentUnit: true, volume: true, rapUnitPrice: true, rapTotalPrice: true, rabUnitPrice: true, rabTotalPrice: true },
      orderBy: { order: 'asc' },
    });
    if (items.length !== itemIds.length) return res.status(400).json({ error: 'Sebagian item RAB tidak ditemukan.' });
    if (!items.length) return res.status(400).json({ error: 'Pilih minimal satu item RAB sebagai sumber kontrak.' });

    const update = buildSpkDraftUpdate({
      existing,
      project,
      items,
      type,
      partyName: req.body.partyName ?? req.body.partyData?.contractorName ?? req.body.partyData?.name ?? existing.partyData?.name,
      parties: req.body.parties || req.body.partyData,
      firstParty: req.body.firstParty || req.body.partyData?.firstParty,
      secondParty: req.body.secondParty || req.body.partyData?.secondParty,
      terms: req.body.terms || [],
      retentionPercent: req.body.retentionPercent ?? existing.retentionPercent ?? 0,
    });

    const updated = await prisma.$transaction(async (tx) => {
      await tx.spkTerm.deleteMany({ where: { contractId: existing.id } });
      return tx.spkContract.update({
        where: { id: existing.id },
        data: {
          type: update.type,
          contractValue: update.contractValue,
          contractValueWords: terbilangRupiah(update.contractValue),
          snapshot: update.snapshot,
          partyData: update.party,
          workDurationDays: schedule?.workDurationDays ?? (req.body.workDurationDays !== undefined ? (req.body.workDurationDays ? Number(req.body.workDurationDays) : null) : existing.workDurationDays),
          startDate: schedule?.startDate ?? (req.body.startDate !== undefined ? (req.body.startDate ? parseDate(req.body.startDate) : null) : existing.startDate),
          endDate: schedule?.endDate ?? (req.body.endDate !== undefined ? (req.body.endDate ? parseDate(req.body.endDate) : null) : existing.endDate),
          bankData: req.body.bankData !== undefined ? (req.body.bankData || {}) : existing.bankData,
          notes: req.body.notes !== undefined ? (req.body.notes || null) : existing.notes,
          retentionPercent: update.retentionPercent,
          retentionAmount: update.retentionAmount,
          terms: { create: update.terms.map((term) => ({ ...term, status: 'PENDING' })) },
        },
        include: { terms: { orderBy: { order: 'asc' } } },
      });
    });

    res.json(serializeContract(updated));
  } catch (error) {
    console.error('Update SPK error:', error);
    res.status(400).json({ error: error.message || 'Gagal mengubah draft SPK.' });
  }
});

router.get('/spk-contracts/:id/pdf/:mode(view|download)', async (req, res) => {
  try {
    const contract = await prisma.spkContract.findUnique({
      where: { id: req.params.id },
      include: { terms: { orderBy: { order: 'asc' } } },
    });
    if (!contract) return res.status(404).json({ error: 'SPK tidak ditemukan.' });
    if (contract.type !== 'CLIENT') {
      return res.status(400).json({ error: 'PDF saat ini hanya tersedia untuk SPK CLIENT.' });
    }

    const pdf = await renderSpkClientPdf(contract);
    const filename = safeSpkPdfFilename(contract);
    const disposition = req.params.mode === 'download' ? 'attachment' : 'inline';
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Length': String(pdf.length),
      'Content-Disposition': `${disposition}; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    });
    return res.send(pdf);
  } catch (error) {
    console.error('Render SPK PDF error:', error);
    return res.status(500).json({ error: 'Gagal membuat PDF SPK.' });
  }
});

router.post('/spk-contracts/:id/issue', async (req, res) => {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const contract = await tx.spkContract.findUnique({ where: { id: req.params.id }, include: { terms: true } });
      if (!contract) throw new Error('SPK tidak ditemukan.');
      if (contract.status !== 'DRAFT') throw new Error('Hanya SPK DRAFT yang dapat diterbitkan.');
      normalizeSpkTerms(contract.terms, Number(contract.contractValue), Number(contract.retentionPercent), true);

      const year = contract.createdAt.getFullYear();
  await tx.spkNumberCounter.upsert({
        where: { type_year: { type: contract.type, year } },
        create: { type: contract.type, year, lastNumber: contract.type === 'CLIENT' ? 19 : 70 },
        update: {},
      });
      const counter = await tx.spkNumberCounter.findUnique({ where: { type_year: { type: contract.type, year } } });
      const next = counter.lastNumber + 1;
      const issuedAt = new Date();
      const spkNumber = createSpkNumber(contract.type, next, issuedAt);
      await tx.spkNumberCounter.update({ where: { id: counter.id }, data: { lastNumber: next } });
      return tx.spkContract.update({
        where: { id: contract.id },
        data: {
          status: 'TERBIT',
          spkNumber,
          issuedAt,
          issuedById: req.user?.userId || null,
          snapshot: {
            ...contract.snapshot,
            documentSnapshot: buildSpkDocumentSnapshot(contract),
          },
        },
        include: { terms: { orderBy: { order: 'asc' } } },
      });
    });
    res.json(serializeContract(result));
  } catch (error) {
    console.error('Issue SPK error:', error);
    res.status(400).json({ error: error.message || 'Gagal menerbitkan SPK.' });
  }
});

router.post('/spk-contracts/:id/sign', async (req, res) => {
  try {
    const existing = await prisma.spkContract.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'SPK tidak ditemukan.' });
    if (existing.status !== 'TERBIT') return res.status(400).json({ error: 'SPK harus berstatus TERBIT sebelum ditandatangani.' });
    const updated = await prisma.spkContract.update({
      where: { id: existing.id },
      data: { status: 'DITANDATANGANI', signedAt: parseDate(req.body.signedAt), signedDocumentUrl: req.body.signedDocumentUrl || null },
      include: { terms: { orderBy: { order: 'asc' } } },
    });
    res.json(serializeContract(updated));
  } catch (error) {
    res.status(400).json({ error: error.message || 'Gagal menandai SPK ditandatangani.' });
  }
});

router.post('/spk-contracts/:id/cancel', async (req, res) => {
  try {
    const existing = await prisma.spkContract.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'SPK tidak ditemukan.' });
    if (existing.status === 'DRAFT') {
      const deleted = await prisma.spkContract.delete({ where: { id: existing.id } });
      return res.json({ deleted: true, id: deleted.id });
    }
    if (existing.status === 'SELESAI' || existing.status === 'DIBATALKAN') return res.status(400).json({ error: 'SPK tidak dapat dibatalkan pada status ini.' });
    const cancelled = await prisma.spkContract.update({ where: { id: existing.id }, data: { status: 'DIBATALKAN', cancellationReason: req.body.reason || null }, include: { terms: true } });
    res.json(serializeContract(cancelled));
  } catch (error) {
    res.status(400).json({ error: error.message || 'Gagal membatalkan SPK.' });
  }
});

module.exports = router;
