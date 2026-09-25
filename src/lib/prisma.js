'use strict';

// Force reload Prisma Client supaya versi baru (dengan workCategoryId) ter-load
delete require.cache[require.resolve('@prisma/client')];

const { PrismaClient } = require('@prisma/client');

// Singleton supaya tidak buka banyak koneksi
const globalForPrisma = globalThis;

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

module.exports = prisma;
