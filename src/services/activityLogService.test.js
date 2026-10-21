'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyActivity,
  sanitizeActivityData,
  shouldTrackRequest,
} = require('./activityLogService');

test('approval route becomes a human-readable APPROVE activity', () => {
  const result = classifyActivity({
    method: 'PUT',
    path: '/api/finance/po/po-123/approve',
    body: { catatan: 'Disetujui' },
    statusCode: 200,
    responseBody: { id: 'po-123', poNumber: 'POJ-008', status: 'APPROVED', project: { id: 'p1', name: 'Pemasangan Paving' } },
  });

  assert.equal(result.module, 'APPROVAL');
  assert.equal(result.action, 'APPROVE');
  assert.equal(result.entityType, 'PURCHASE_ORDER');
  assert.equal(result.entityId, 'po-123');
  assert.equal(result.entityName, 'POJ-008');
  assert.equal(result.projectId, 'p1');
  assert.equal(result.projectName, 'Pemasangan Paving');
  assert.match(result.summary, /Menyetujui PO Jasa POJ-008/);
  assert.deepEqual(result.changes.status, { before: 'MENUNGGU_ATASAN', after: 'APPROVED' });
});

test('profile update is classified without leaking password fields', () => {
  const sanitized = sanitizeActivityData({
    name: 'Nama Baru',
    currentPassword: 'rahasia-lama',
    password: 'rahasia-baru',
    nested: { token: 'abc', safe: 'ok' },
  });
  assert.deepEqual(sanitized, {
    name: 'Nama Baru',
    currentPassword: '[REDACTED]',
    password: '[REDACTED]',
    nested: { token: '[REDACTED]', safe: 'ok' },
  });

  const result = classifyActivity({
    method: 'PATCH',
    path: '/api/security/me',
    body: { name: 'Nama Baru' },
    statusCode: 200,
    responseBody: { id: 'u1', name: 'Nama Baru' },
  });
  assert.equal(result.module, 'PROFILE');
  assert.equal(result.action, 'UPDATE_PROFILE');
  assert.match(result.summary, /Mengubah profil sendiri/);
});

test('ordinary GET is ignored while exports and mutations are tracked', () => {
  assert.equal(shouldTrackRequest('GET', '/api/projects'), false);
  assert.equal(shouldTrackRequest('POST', '/api/projects'), true);
  assert.equal(shouldTrackRequest('GET', '/api/projects/p1/rab-items/export'), true);
  assert.equal(shouldTrackRequest('GET', '/api/spk-contracts/s1/pdf/download'), true);
  assert.equal(shouldTrackRequest('GET', '/api/spk-contracts/s1/pdf/view'), true);
});
