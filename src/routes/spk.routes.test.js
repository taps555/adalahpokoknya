'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

const contract = {
  id: 'spk-client-1', type: 'CLIENT', status: 'DRAFT', spkNumber: null,
  createdAt: new Date('2026-10-08T00:00:00.000Z'), issuedAt: null,
  contractValue: 1000000, contractValueWords: 'Satu Juta Rupiah',
  retentionPercent: 0, retentionAmount: 0, bankData: {},
  workDurationDays: 10, startDate: new Date('2026-10-10T00:00:00.000Z'), endDate: new Date('2026-10-20T00:00:00.000Z'),
  partyData: {
    firstParty: { name: 'Internal Rep', position: 'Direktur', companyName: 'PT. DJP', address: 'Surabaya' },
    secondParty: { name: 'Client Snapshot', position: 'Pemberi Tugas', address: 'Lokasi Snapshot' },
  },
  snapshot: {
    projectName: 'Project / Tidak Aman?', projectLocation: 'Lokasi Snapshot', contractValue: 1000000,
    partyData: {
      firstParty: { name: 'Internal Rep', position: 'Direktur', companyName: 'PT. DJP', address: 'Surabaya' },
      secondParty: { name: 'Client Snapshot', position: 'Pemberi Tugas', address: 'Lokasi Snapshot' },
    },
    workScope: [{ name: 'Pekerjaan Test', volume: 1, unit: 'ls', totalPrice: 1000000 }],
  },
  terms: [{ label: 'Lunas', percent: 100, amount: 1000000, order: 0 }],
};

function loadRouterWithPrisma(mockPrisma) {
  const prismaPath = require.resolve('../lib/prisma');
  const routePath = require.resolve('../routes/crudGrub/spk.routes');
  const oldPrisma = require.cache[prismaPath];
  const oldRoute = require.cache[routePath];
  require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: mockPrisma };
  delete require.cache[routePath];
  const router = require(routePath);
  return {
    router,
    restore() {
      delete require.cache[routePath];
      if (oldRoute) require.cache[routePath] = oldRoute;
      if (oldPrisma) require.cache[prismaPath] = oldPrisma;
      else delete require.cache[prismaPath];
    },
  };
}

async function withServer(router, run) {
  const app = express();
  app.use(express.json());
  app.use('/api', router);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const { port } = server.address();
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('authenticated PDF view/download render without allocating a number or mutating contract', async () => {
  const calls = [];
  const prisma = {
    spkContract: {
      findUnique: async (query) => { calls.push(['findUnique', query]); return contract; },
      update: async () => { calls.push(['update']); throw new Error('must not mutate'); },
    },
  };
  const loaded = loadRouterWithPrisma(prisma);
  const token = jwt.sign({ userId: 'user-1' }, process.env.JWT_SECRET || 'rahasia_super_aman_123');
  try {
    await withServer(loaded.router, async (baseUrl) => {
      const view = await fetch(`${baseUrl}/api/spk-contracts/${contract.id}/pdf/view`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(view.status, 200);
      assert.match(view.headers.get('content-type'), /^application\/pdf/);
      assert.match(view.headers.get('content-disposition'), /^inline;/);
      assert.equal(Buffer.from(await view.arrayBuffer()).subarray(0, 4).toString(), '%PDF');

      const download = await fetch(`${baseUrl}/api/spk-contracts/${contract.id}/pdf/download`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(download.status, 200);
      assert.match(download.headers.get('content-disposition'), /^attachment; filename="SPK-DRAFT-Project-Tidak-Aman\.pdf"$/);
      assert.equal(Buffer.from(await download.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
    });
    assert.deepEqual(calls.map(([method]) => method), ['findUnique', 'findUnique']);
  } finally {
    loaded.restore();
  }
});

test('issue stores complete doc snapshot and preserves existing snapshot fields', async () => {
  const calls = [];
  const original = {
    ...contract,
    status: 'DRAFT',
    createdAt: new Date('2026-10-08T00:00:00.000Z'),
    snapshot: { marker: 'keep-me', projectName: 'Snapshot Project', projectLocation: 'Snapshot Location', workScope: [{ name: 'Snapshot Work' }] },
    contractValue: 1000000,
    contractValueWords: 'Satu Juta Rupiah',
    workDurationDays: 10,
    startDate: new Date('2026-10-10T00:00:00.000Z'),
    endDate: new Date('2026-10-20T00:00:00.000Z'),
    terms: [{ label: 'Lunas', percent: 100, amount: 1000000, order: 0 }],
    bankData: { bankName: 'Bank', accountNumber: '123' },
  };
  let counter = { id: 'counter-1', lastNumber: 19 };
  const prisma = {
    $transaction: async (callback) => callback({
      spkContract: {
        findUnique: async () => original,
        update: async ({ data }) => {
          calls.push(data);
          return { ...original, ...data };
        },
      },
      spkNumberCounter: {
        upsert: async () => {},
        findUnique: async () => counter,
        update: async ({ data }) => { counter = { ...counter, ...data }; },
      },
    }),
  };
  const loaded = loadRouterWithPrisma(prisma);
  const token = jwt.sign({ userId: 'user-1' }, process.env.JWT_SECRET || 'rahasia_super_aman_123');
  try {
    await withServer(loaded.router, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/spk-contracts/${original.id}/issue`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(response.status, 200);
      const issued = await response.json();
      assert.match(issued.spkNumber, /\/SPK\//);
      assert.equal(issued.snapshot.marker, 'keep-me');
      assert.equal(issued.snapshot.documentSnapshot.contractValueWords, 'Satu Juta Rupiah');
      assert.equal(issued.snapshot.documentSnapshot.bankData.accountNumber, '123');
      assert.equal(counter.lastNumber, 20);
    });
  } finally {
    loaded.restore();
  }
  assert.equal(calls.length, 1);
});
test('PDF endpoints require authentication', async () => {
  const loaded = loadRouterWithPrisma({ spkContract: { findUnique: async () => contract } });
  try {
    await withServer(loaded.router, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/spk-contracts/${contract.id}/pdf/view`);
      assert.equal(response.status, 401);
    });
  } finally {
    loaded.restore();
  }
});

test('POST spk-contracts tolerates decimal floating point from frontend and uses rounded snapshot value', async () => {
  let createdPayload = null;
  const mockPrisma = {
    project: {
      findUnique: async () => ({
        id: 'proj-1',
        name: 'Project Tes',
        location: 'Surabaya',
        client: { id: 'client-1', name: 'Pak Budi' },
      }),
    },
    rabItem: {
      findMany: async () => [
        {
          id: 'item-1',
          name: 'Item Pecahan',
          paymentUnit: 'ls',
          volume: 1,
          rabUnitPrice: 29335.1893,
          rabTotalPrice: 29335.1893,
          rapUnitPrice: 29335.1893,
          rapTotalPrice: 29335.1893,
        },
      ],
    },
    spkContract: {
      create: async ({ data }) => {
        createdPayload = data;
        return {
          id: 'spk-new-1',
          ...data,
          createdAt: new Date(),
          terms: [{ id: 't1', ...data.terms.create[0] }],
        };
      },
    },
  };

  const loaded = loadRouterWithPrisma(mockPrisma);
  const token = jwt.sign({ userId: 'user-1' }, process.env.JWT_SECRET || 'rahasia_super_aman_123');

  try {
    await withServer(loaded.router, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/projects/proj-1/spk-contracts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          type: 'CLIENT',
          rabItemIds: ['item-1'],
          contractValue: 29335.1893, // unrounded value sent by frontend
          firstParty: { name: 'Direktur DJP', position: 'Direktur' },
          secondParty: { name: 'Pak Budi', position: 'Owner' },
          workDurationDays: 14,
          startDate: '2026-10-10',
          endDate: '2026-10-24',
          terms: [{ label: 'Termin 1', percent: 100, amount: 29335 }],
        }),
      });

      assert.equal(response.status, 201);
      const json = await response.json();
      assert.equal(json.contractValue, 29335);
      assert.equal(createdPayload.contractValue, 29335);
    });
  } finally {
    loaded.restore();
  }
});

