'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

function loadBastRouterWithPrisma(mockPrisma) {
  const prismaPath = require.resolve('../lib/prisma');
  const routePath = require.resolve('./crudGrub/bast.routes');
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

function loadBast2RouterWithPrisma(mockPrisma) {
  const prismaPath = require.resolve('../lib/prisma');
  const routePath = require.resolve('./crudGrub/bast2.routes');
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

test('GET /projects/:projectId/bast returns clientSpks and hasIssuedClientSpk', async () => {
  const mockPrisma = {
    project: {
      findUnique: async () => ({ id: 'p1', name: 'Project 1', location: 'Surabaya', client: { name: 'Client A' } }),
    },
    bast: {
      findMany: async () => [],
    },
    spkContract: {
      findMany: async () => [
        { id: 'spk-1', spkNumber: '001/SPK/DJP/2026', status: 'TERBIT', partyData: { firstParty: { name: 'Client A' } } },
      ],
    },
  };

  const loaded = loadBastRouterWithPrisma(mockPrisma);
  try {
    await withServer(loaded.router, async (origin) => {
      const res = await fetch(`${origin}/api/projects/p1/bast`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.hasIssuedClientSpk, true);
      assert.equal(data.clientSpks.length, 1);
      assert.equal(data.clientSpks[0].spkNumber, '001/SPK/DJP/2026');
    });
  } finally {
    loaded.restore();
  }
});

test('POST /projects/:projectId/bast rejects when no issued SPK Client exists', async () => {
  const mockPrisma = {
    project: {
      findUnique: async () => ({ id: 'p1', name: 'Project 1', location: 'Surabaya', client: { name: 'Client A' } }),
    },
    spkContract: {
      findMany: async () => [],
    },
  };

  const loaded = loadBastRouterWithPrisma(mockPrisma);
  try {
    await withServer(loaded.router, async (origin) => {
      const res = await fetch(`${origin}/api/projects/p1/bast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bastNumber: 'BAST-01', spkNumber: 'SPK-999', handoverDate: '2026-10-10' }),
      });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.match(data.error, /belum memiliki SPK Client/);
    });
  } finally {
    loaded.restore();
  }
});

test('POST /projects/:projectId/bast creates BAST when valid SPK Client is provided', async () => {
  let createdData = null;
  const mockPrisma = {
    project: {
      findUnique: async () => ({ id: 'p1', name: 'Project 1', location: 'Surabaya', client: { name: 'Client A' } }),
    },
    spkContract: {
      findMany: async () => [
        { id: 'spk-1', spkNumber: '001/SPK/DJP/2026', status: 'TERBIT' },
      ],
    },
    bast: {
      create: async ({ data }) => {
        createdData = data;
        return { id: 'bast-1', ...data, photos: [] };
      },
    },
  };

  const loaded = loadBastRouterWithPrisma(mockPrisma);
  try {
    await withServer(loaded.router, async (origin) => {
      const res = await fetch(`${origin}/api/projects/p1/bast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bastNumber: '001/BAST/2026',
          spkNumber: '001/SPK/DJP/2026',
          handoverDate: '2026-10-10',
        }),
      });
      assert.equal(res.status, 201);
      assert.equal(createdData.spkNumber, '001/SPK/DJP/2026');
    });
  } finally {
    loaded.restore();
  }
});

test('POST /projects/:projectId/bast2 rejects when no issued SPK Client exists', async () => {
  const mockPrisma = {
    project: {
      findUnique: async () => ({ id: 'p1', name: 'Project 1', location: 'Surabaya', client: { name: 'Client A' } }),
    },
    spkContract: {
      findMany: async () => [],
    },
  };

  const loaded = loadBast2RouterWithPrisma(mockPrisma);
  try {
    await withServer(loaded.router, async (origin) => {
      const res = await fetch(`${origin}/api/projects/p1/bast2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bastNumber: 'BAST2-01', spkNumber: 'SPK-999', handoverDate: '2026-10-10' }),
      });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.match(data.error, /belum memiliki SPK Client/);
    });
  } finally {
    loaded.restore();
  }
});

test('POST /projects/:projectId/bast2 creates BAST 2 when valid SPK Client is provided', async () => {
  let createdData = null;
  const mockPrisma = {
    project: {
      findUnique: async () => ({ id: 'p1', name: 'Project 1', location: 'Surabaya', client: { name: 'Client A' } }),
    },
    spkContract: {
      findMany: async () => [
        { id: 'spk-1', spkNumber: '001/SPK/DJP/2026', status: 'TERBIT' },
      ],
    },
    bast2: {
      create: async ({ data }) => {
        createdData = data;
        return { id: 'bast2-1', ...data };
      },
    },
  };

  const loaded = loadBast2RouterWithPrisma(mockPrisma);
  try {
    await withServer(loaded.router, async (origin) => {
      const res = await fetch(`${origin}/api/projects/p1/bast2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bastNumber: '002/BAST2/2026',
          spkNumber: '001/SPK/DJP/2026',
          handoverDate: '2026-10-10',
        }),
      });
      assert.equal(res.status, 201);
      assert.equal(createdData.spkNumber, '001/SPK/DJP/2026');
    });
  } finally {
    loaded.restore();
  }
});
