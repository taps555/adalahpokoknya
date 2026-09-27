'use strict';

// Force reload Prisma Client supaya versi baru (dengan workCategoryId) ter-load
delete require.cache[require.resolve('@prisma/client')];

const { PrismaClient } = require('@prisma/client');

// Singleton supaya tidak buka banyak koneksi
const globalForPrisma = globalThis;

const basePrisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

const APPROVAL_LOCK_MARKER = 'BV_RAB_APPROVAL_LOCKED';

function mapApprovalLockError(error) {
  if (!String(error?.message || '').includes(APPROVAL_LOCK_MARKER)) return error;
  const locked = new Error(
    'BV/RAB sedang dikunci oleh proses approval. Tunggu keputusan reviewer atau buat revisi baru sebelum mengubah data.',
  );
  locked.statusCode = 409;
  locked.code = APPROVAL_LOCK_MARKER;
  return locked;
}

// Trigger PostgreSQL menjadi otoritas terakhir untuk write BV/RAB. Extension
// ini hanya menerjemahkan marker trigger tersebut ke kontrak HTTP 409 yang
// sudah digunakan seluruh route BV/RAB; error Prisma lain tetap diteruskan.
const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      $allOperations({ args, query }) {
        return query(args).catch((error) => {
          throw mapApprovalLockError(error);
        });
      },
    },
    $queryRaw({ args, query }) {
      return query(args).catch((error) => {
        throw mapApprovalLockError(error);
      });
    },
    $queryRawUnsafe({ args, query }) {
      return query(args).catch((error) => {
        throw mapApprovalLockError(error);
      });
    },
    $executeRaw({ args, query }) {
      return query(args).catch((error) => {
        throw mapApprovalLockError(error);
      });
    },
    $executeRawUnsafe({ args, query }) {
      return query(args).catch((error) => {
        throw mapApprovalLockError(error);
      });
    },
  },
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

module.exports = prisma;
