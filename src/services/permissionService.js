'use strict';

const ROLE_ORDER = ['OWNER', 'ADMIN', 'FINANCE', 'PURCHASING', 'PERENCANA', 'PELAKSANA'];

const MODULES = [
  { key: 'project', label: 'Project', hint: 'Data dasar dan identitas proyek' },
  { key: 'survey', label: 'Survey', hint: 'Survey lapangan dan hasil 3D' },
  { key: 'design', label: 'Penawaran Desain', hint: 'Penawaran dan persetujuan desain' },
  { key: 'bv', label: 'BV', hint: 'Back Up Volume dan sinkronisasi RAB' },
  { key: 'rab', label: 'RAB Budgeting', hint: 'RAP, OVH, harga jual, export' },
  { key: 'spk_client', label: 'SPK Client', hint: 'Kontrak client' },
  { key: 'spk_subcon', label: 'SPK Subcon', hint: 'Kontrak subcon' },
  { key: 'finance', label: 'Finance', hint: 'Transaksi dan laporan keuangan' },
  { key: 'purchasing', label: 'Purchasing', hint: 'Pengadaan dan permintaan' },
  { key: 'setting', label: 'Setting', hint: 'Profil, user, dan keamanan' },
  { key: 'audit', label: 'Activity Log', hint: 'Jejak aktivitas dan arsip log' },
];

const ACCESS_LEVELS = ['NONE', 'READ', 'MANAGE'];

const SENSITIVE_ACTIONS = {
  bv: ['Bv.EditVolume', 'Bv.LinkRab', 'Bv.Sync', 'Bv.Approve'],
  rab: ['Rab.EditRap', 'Rab.EditOh', 'Rab.SellPrice', 'Rab.Export', 'Rab.Approve'],
  finance: ['Finance.Create', 'Finance.Edit', 'Finance.Approve', 'Finance.Export'],
  purchasing: ['Purchasing.Create', 'Purchasing.Edit', 'Purchasing.Approve'],
  spk_client: ['SpkClient.Create', 'SpkClient.Approve'],
  spk_subcon: ['SpkSubcon.Create', 'SpkSubcon.Approve'],
  setting: ['Setting.ManageUser', 'Setting.ManageRole', 'Setting.Security'],
  audit: ['Audit.View', 'Audit.Archive'],
};

const DEFAULT_TEMPLATE = {
  OWNER: { project: 'MANAGE', survey: 'MANAGE', design: 'MANAGE', bv: 'MANAGE', rab: 'MANAGE', spk_client: 'MANAGE', spk_subcon: 'MANAGE', finance: 'MANAGE', purchasing: 'MANAGE', setting: 'MANAGE', audit: 'MANAGE' },
  ADMIN: { project: 'MANAGE', survey: 'MANAGE', design: 'MANAGE', bv: 'MANAGE', rab: 'MANAGE', spk_client: 'MANAGE', spk_subcon: 'MANAGE', finance: 'READ', purchasing: 'MANAGE', setting: 'READ', audit: 'READ' },
  FINANCE: { project: 'READ', survey: 'NONE', design: 'READ', bv: 'READ', rab: 'READ', spk_client: 'READ', spk_subcon: 'READ', finance: 'MANAGE', purchasing: 'READ', setting: 'READ', audit: 'READ' },
  PURCHASING: { project: 'READ', survey: 'NONE', design: 'NONE', bv: 'READ', rab: 'READ', spk_client: 'NONE', spk_subcon: 'READ', finance: 'READ', purchasing: 'MANAGE', setting: 'READ', audit: 'READ' },
  PERENCANA: { project: 'MANAGE', survey: 'MANAGE', design: 'MANAGE', bv: 'MANAGE', rab: 'MANAGE', spk_client: 'READ', spk_subcon: 'READ', finance: 'NONE', purchasing: 'READ', setting: 'READ', audit: 'READ' },
  PELAKSANA: { project: 'READ', survey: 'READ', design: 'READ', bv: 'MANAGE', rab: 'READ', spk_client: 'READ', spk_subcon: 'READ', finance: 'NONE', purchasing: 'READ', setting: 'READ', audit: 'NONE' },
};

function permissionKey(moduleKey, level) {
  return `${moduleKey}.${String(level || 'NONE').toUpperCase()}`;
}

function accessFromPermissions(moduleKey, grantedKeys) {
  if (grantedKeys.has(permissionKey(moduleKey, 'MANAGE'))) return 'MANAGE';
  if (grantedKeys.has(permissionKey(moduleKey, 'READ'))) return 'READ';
  return 'NONE';
}

function assertRole(value) {
  const role = String(value || '').toUpperCase();
  if (!ROLE_ORDER.includes(role)) {
    const error = new TypeError('Role tidak dikenal.');
    error.statusCode = 400;
    throw error;
  }
  return role;
}

function normalizeTemplate(input = {}) {
  const result = {};
  for (const role of ROLE_ORDER) {
    const row = input[role] || DEFAULT_TEMPLATE[role] || {};
    result[role] = {};
    for (const module of MODULES) {
      const level = String(row[module.key] || 'NONE').toUpperCase();
      result[role][module.key] = ACCESS_LEVELS.includes(level) ? level : 'NONE';
    }
    // Owner wajib penuh: mencegah lockout pemilik sistem.
    if (role === 'OWNER') result[role] = { ...result[role], ...Object.fromEntries(MODULES.map((m) => [m.key, 'MANAGE'])) };
  }
  return result;
}

async function loadTemplate(prisma) {
  const rows = await prisma.rolePermission.findMany({
    include: { permission: true },
    orderBy: { role: 'asc' },
  });
  if (rows.length === 0) return normalizeTemplate(DEFAULT_TEMPLATE);
  const byRole = {};
  for (const row of rows) {
    if (!row.allowed) continue;
    byRole[row.role] = byRole[row.role] || new Set();
    byRole[row.role].add(row.permission.key);
  }
  const template = {};
  for (const role of ROLE_ORDER) {
    template[role] = {};
    for (const module of MODULES) {
      template[role][module.key] = accessFromPermissions(module.key, byRole[role] || new Set());
    }
  }
  return normalizeTemplate(template);
}

async function saveTemplate(prisma, input) {
  const template = normalizeTemplate(input);
  const permissions = await prisma.permission.findMany();
  const byKey = new Map(permissions.map((row) => [row.key, row]));

  await prisma.$transaction(async (tx) => {
    for (const role of ROLE_ORDER) {
      for (const module of MODULES) {
        const level = template[role][module.key];
        for (const candidate of ACCESS_LEVELS) {
          const key = permissionKey(module.key, candidate);
          const permission = byKey.get(key);
          if (!permission) continue;
          await tx.rolePermission.upsert({
            where: { role_permissionId: { role, permissionId: permission.id } },
            create: { role, permissionId: permission.id, allowed: candidate === level },
            update: { allowed: candidate === level },
          });
        }
      }
    }
  });
  return template;
}

async function seedPermissions(prisma) {
  const rows = [];
  for (const module of MODULES) {
    for (const level of ACCESS_LEVELS) {
      rows.push({ key: permissionKey(module.key, level), module: module.key, action: level });
    }
  }
  await prisma.$transaction(rows.map((row) => prisma.permission.upsert({
    where: { key: row.key }, create: row, update: {},
  })));
}

function canManageRole(actorRole, targetRole) {
  if (actorRole === 'OWNER') return true;
  if (actorRole !== 'ADMIN') return false;
  return !['OWNER', 'ADMIN'].includes(targetRole);
}

module.exports = {
  ROLE_ORDER,
  MODULES,
  ACCESS_LEVELS,
  SENSITIVE_ACTIONS,
  DEFAULT_TEMPLATE,
  permissionKey,
  normalizeTemplate,
  loadTemplate,
  saveTemplate,
  seedPermissions,
  canManageRole,
  assertRole,
};
