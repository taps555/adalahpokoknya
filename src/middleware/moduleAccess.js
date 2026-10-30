'use strict';

const prisma = require('../lib/prisma');
const { DEFAULT_TEMPLATE } = require('../services/permissionService');

const ACCESS_RANK = { NONE: 0, READ: 1, MANAGE: 2 };

function resolveModule(pathname) {
  const path = String(pathname || '').toLowerCase();
  // Exempt: keamanan & auth punya guard sendiri.
  if (path.startsWith('/api/security') || path.startsWith('/api/auth')) return null;
  if (path.startsWith('/api/hspk') || path.startsWith('/api/work-categories') || path.startsWith('/api/upload') || path.startsWith('/api/jobs')) return null;
  if (path.includes('/rab-items') || path.startsWith('/api/rab')) return 'rab';
  if (path.includes('/bv-items') || path.startsWith('/api/bv')) return 'bv';
  if (path.includes('/survey') || path.startsWith('/api/surveys')) return 'survey';
  if (path.startsWith('/api/finance') || path.startsWith('/api/gl-bank') || path.includes('/material-requests') || path.startsWith('/api/po')) return 'finance';
  if (path.startsWith('/api/purchase') || path.startsWith('/api/retur') || path.includes('/pengajuan-bayar')) return 'purchasing';
  if (path.startsWith('/api/spk')) return 'spk_client';
  if (path.startsWith('/api/clients')) return 'project';
  if (path.startsWith('/api/projects')) return 'project';

  return null;
}

function isWrite(req) {
  const method = (req.method || 'GET').toUpperCase();
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
}

function accessFromKeys(module, grantedKeys) {
  if (grantedKeys.has(`${module}.MANAGE`)) return 'MANAGE';
  if (grantedKeys.has(`${module}.READ`)) return 'READ';
  return 'NONE';
}

/**
 * Global enforcement RolePermission.
 * - OWNER selalu lolos.
 * - Template belum di-seed untuk role ini -> fail-open (guard lama per-route tetap jalan).
 * - Template terisi -> READ untuk GET, MANAGE untuk mutasi.
 */
function moduleAccessGuard() {
  return async (req, res, next) => {
    try {
      if (!req.user) return next();
      if (req.user.role === 'OWNER') return next();

      const module = resolveModule(req.originalUrl || req.url || '');
      if (!module) return next();

      const rows = await prisma.rolePermission.findMany({
        where: { role: req.user.role, allowed: true },
        select: { permission: { select: { key: true } } },
      });
      const grantedKeys = new Set(rows.map((row) => row.permission.key));
      if (grantedKeys.size === 0) {
        // Template belum di-seed untuk role ini -> pakai default, jangan fail-open diam-diam.
        const defaults = DEFAULT_TEMPLATE[req.user.role] || {};
        for (const [moduleKey, level] of Object.entries(defaults)) {
          if (level !== 'NONE') grantedKeys.add(`${moduleKey}.${level}`);
        }
        if (grantedKeys.size === 0) return next();
      }

      const projectId = req.params?.projectId || req.query?.projectId || req.body?.projectId;
      if (req.projectScope && projectId && !req.projectScope.includes(String(projectId))) {
        return res.status(403).json({ error: 'Anda bukan anggota project ini.' });
      }

      const access = accessFromKeys(module, grantedKeys);
      if (access === 'NONE') {
        return res.status(403).json({ error: `Akses halaman ${module} ditolak untuk role ${req.user.role}.` });
      }
      if (isWrite(req) && access !== 'MANAGE') {
        return res.status(403).json({ error: `Perubahan data ${module} butuh akses Kelola. Role ${req.user.role} hanya Lihat.` });
      }
      return next();
    } catch (error) {
      console.error('moduleAccessGuard error:', error.message);
      return res.status(503).json({ error: 'Pemeriksaan akses sedang gagal. Coba lagi.' });
    }
  };
}

/**
 * Cek membership project.
 * OWNER/ADMIN global -> lolos. User tanpa ProjectMember -> lolos (belum dibatasi).
 * User dengan ProjectMember -> hanya project anggotanya.
 */
async function canAccessProject(user, projectId) {
  if (!user) return false;
  if (user.role === 'OWNER' || user.role === 'ADMIN') return true;
  const membershipCount = await prisma.projectMember.count({ where: { userId: user.id } });
  if (membershipCount === 0) return true;
  if (!projectId) return true;
  const member = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId: String(projectId), userId: user.id } },
  });
  return Boolean(member);
}

/**
 * Attach req.projectScope = array id project (null = semua).
 */
async function attachProjectScope(req, res, next) {
  try {
    if (!req.user) return next();
    if (req.user.role === 'OWNER' || req.user.role === 'ADMIN') {
      req.projectScope = null;
      return next();
    }
    const count = await prisma.projectMember.count({ where: { userId: req.user.id } });
    if (count === 0) {
      req.projectScope = null;
      return next();
    }
    const memberships = await prisma.projectMember.findMany({ where: { userId: req.user.id }, select: { projectId: true } });
    req.projectScope = memberships.map((m) => m.projectId);
    return next();
  } catch (error) {
    console.error('attachProjectScope error:', error.message);
    return res.status(503).json({ error: 'Pemeriksaan membership project sedang gagal. Coba lagi.' });
  }
}

module.exports = {
  ACCESS_RANK,
  moduleAccessGuard,
  resolveModule,
  accessFromKeys,
  canAccessProject,
  attachProjectScope,
};
