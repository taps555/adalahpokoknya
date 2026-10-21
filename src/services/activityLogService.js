'use strict';

const path = require('path');

const SENSITIVE_KEYS = /password|passwd|secret|token|authorization|otp|code/i;

function sanitizeActivityData(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 5) return '[TRUNCATED]';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeActivityData(item, depth + 1));
  if (typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    SENSITIVE_KEYS.test(key) ? '[REDACTED]' : sanitizeActivityData(child, depth + 1),
  ]));
}

function shouldTrackRequest(method, requestPath) {
  const upper = String(method || '').toUpperCase();
  const pathname = String(requestPath || '').split('?')[0];
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(upper)) return true;
  if (upper !== 'GET') return false;
  return /(\/export(?:-|\/|$)|\/download(?:\/|$)|\/pdf\/(?:view|download)(?:\/|$)|\/view(?:\/|$))/i.test(pathname);
}

function idFromPath(requestPath, marker) {
  const pieces = String(requestPath || '').split('/').filter(Boolean);
  const index = pieces.indexOf(marker);
  return index >= 0 ? pieces[index + 1] || null : null;
}

function responseRecord(responseBody = {}) {
  return responseBody?.data?.data || responseBody?.data || responseBody || {};
}

function inferModule(requestPath) {
  const pathname = String(requestPath || '').toLowerCase();
  if (pathname.startsWith('/api/auth') || pathname.startsWith('/api/security')) return 'PROFILE';
  if (pathname.includes('survey-3d')) return 'SURVEY_3D';
  if (pathname.includes('surveys')) return 'SURVEY';
  if (pathname.includes('design-quotation')) return 'DESIGN_QUOTATION';
  if (pathname.includes('bv-rab-approval')) return 'APPROVAL';
  if (pathname.includes('bv-item')) return 'BV';
  if (pathname.includes('rab-item') || pathname.includes('rab-group')) return 'RAB';
  if (pathname.includes('spk-contract')) return pathname.includes('subcon') ? 'SPK_SUBCON' : 'SPK';
  if (pathname.includes('/finance/') || pathname.includes('approve') || pathname.includes('verify') || pathname.includes('reject')) return 'APPROVAL';
  if (pathname.includes('projects')) return 'PROJECT';
  return 'SYSTEM';
}

function genericAction(method, requestPath) {
  const pathname = String(requestPath || '').toLowerCase();
  if (pathname.includes('/approve')) return 'APPROVE';
  if (pathname.includes('/verify')) return 'VERIFY';
  if (pathname.includes('/reject')) return 'REJECT';
  if (pathname.includes('/issue')) return 'ISSUE';
  if (pathname.includes('/sign')) return 'SIGN';
  if (pathname.includes('/cancel')) return 'CANCEL';
  if (pathname.includes('/export') || pathname.includes('/download')) return 'EXPORT';
  if (pathname.includes('/pdf/view') || pathname.endsWith('/view')) return 'VIEW_DOCUMENT';
  const upper = String(method || '').toUpperCase();
  return ({ POST: 'CREATE', PUT: 'UPDATE', PATCH: 'UPDATE', DELETE: 'DELETE' })[upper] || 'VIEW';
}

function classifyActivity({ method, path: requestPath, body = {}, statusCode = 200, responseBody = {} } = {}) {
  const record = responseRecord(responseBody);
  const pathname = String(requestPath || '').split('?')[0];
  const module = inferModule(pathname);
  const action = genericAction(method, pathname);
  const succeeded = Number(statusCode) < 400;

  if (/^\/api\/finance\/po\/[^/]+\/approve$/i.test(pathname)) {
    const entityId = idFromPath(pathname, 'po') || record.id || null;
    const entityName = record.poNumber || record.nomorPO || entityId || 'PO';
    return {
      module: 'APPROVAL', action: 'APPROVE', entityType: 'PURCHASE_ORDER', entityId, entityName,
      projectId: record.project?.id || record.projectId || null,
      projectName: record.project?.name || null,
      summary: succeeded ? `Menyetujui PO Jasa ${entityName}` : `Percobaan menyetujui PO Jasa ${entityName} gagal`,
      changes: { status: { before: 'MENUNGGU_ATASAN', after: succeeded ? 'APPROVED' : 'GAGAL' } },
    };
  }

  if (/^\/api\/security\/me$/i.test(pathname) && ['PUT', 'PATCH'].includes(String(method).toUpperCase())) {
    return {
      module: 'PROFILE', action: 'UPDATE_PROFILE', entityType: 'USER', entityId: record.id || null,
      entityName: record.name || null, projectId: null, projectName: null,
      summary: succeeded ? 'Mengubah profil sendiri' : 'Percobaan mengubah profil sendiri gagal',
      changes: sanitizeActivityData(body),
    };
  }

  const guessedName = record.name || record.title || record.spKNumber || record.poNumber || null;
  const lower = pathname.toLowerCase();
  const entityType = lower.includes('project') ? 'PROJECT'
    : lower.includes('survey-3d') ? 'SURVEY_3D'
      : lower.includes('survey') ? 'SURVEY'
        : lower.includes('bv-item') ? 'BV_ITEM'
          : lower.includes('rab-item') ? 'RAB_ITEM'
            : lower.includes('spk') ? 'SPK_CONTRACT'
              : 'RECORD';
  const entityId = record.id || idFromPath(pathname, entityType === 'PROJECT' ? 'projects' : 'id') || null;
  const verb = ({ CREATE: 'Menambah', UPDATE: 'Mengubah', DELETE: 'Menghapus', EXPORT: 'Mengunduh', VIEW_DOCUMENT: 'Melihat', APPROVE: 'Menyetujui', VERIFY: 'Memverifikasi', REJECT: 'Menolak', ISSUE: 'Menerbitkan', SIGN: 'Menandatangani', CANCEL: 'Membatalkan' })[action] || 'Mengakses';
  return {
    module, action, entityType, entityId, entityName: guessedName,
    projectId: record.projectId || record.project?.id || body.projectId || null,
    projectName: record.project?.name || null,
    summary: `${verb} ${entityType.replaceAll('_', ' ').toLowerCase()}${guessedName ? ` “${guessedName}”` : ''}${succeeded ? '' : ' gagal'}`,
    changes: sanitizeActivityData(body),
  };
}

function normalizeIp(req) {
  const forwarded = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req?.ip || req?.socket?.remoteAddress || null;
}

async function writeActivityLog(prisma, req, result = {}) {
  if (!prisma?.activityLog?.create) return null;
  const user = req?.user || {};
  const classified = classifyActivity({
    method: req?.method,
    path: req?.originalUrl || req?.url,
    body: req?.body,
    statusCode: result.statusCode,
    responseBody: result.responseBody,
  });
  return prisma.activityLog.create({
    data: {
      userId: user.userId || user.id || null,
      userName: user.name || user.username || null,
      role: user.role || null,
      module: classified.module,
      action: classified.action,
      status: Number(result.statusCode) < 400 ? 'SUCCESS' : 'FAILED',
      entityType: classified.entityType,
      entityId: classified.entityId,
      entityName: classified.entityName,
      projectId: classified.projectId,
      projectName: classified.projectName,
      summary: classified.summary,
      changes: classified.changes || {},
      requestMethod: req?.method || null,
      requestPath: String(req?.originalUrl || req?.url || '').split('?')[0],
      statusCode: Number(result.statusCode) || 0,
      ipAddress: normalizeIp(req),
      userAgent: req?.headers?.['user-agent'] || null,
    },
  });
}

module.exports = {
  sanitizeActivityData,
  shouldTrackRequest,
  classifyActivity,
  writeActivityLog,
  normalizeIp,
};
