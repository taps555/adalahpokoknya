const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeSurvey3dPayload,
  isAllowedDriveUrl,
} = require('./survey3dValidation');

test('normalizes a valid 3D design payload', () => {
  assert.deepEqual(
    normalizeSurvey3dPayload({
      status: ' in_progress ',
      gdriveUrl: ' https://drive.google.com/file/d/abc/view ',
      notes: ' Revisi pertama ',
    }),
    {
      status: 'IN_PROGRESS',
      gdriveUrl: 'https://drive.google.com/file/d/abc/view',
      notes: 'Revisi pertama',
    },
  );
});

test('allows Drive/Docs links and rejects other hosts', () => {
  assert.equal(isAllowedDriveUrl('https://drive.google.com/file/d/abc/view'), true);
  assert.equal(isAllowedDriveUrl('https://docs.google.com/file/d/abc/view'), true);
  assert.equal(isAllowedDriveUrl('https://example.com/model'), false);
});

test('rejects unsupported status and invalid link', () => {
  assert.throws(
    () => normalizeSurvey3dPayload({ status: 'DONE', gdriveUrl: '' }),
    /status/i,
  );
  assert.throws(
    () => normalizeSurvey3dPayload({ status: 'FINAL', gdriveUrl: 'https://example.com/model' }),
    /Google Drive/i,
  );
});

test('converts blank optional fields to null', () => {
  assert.deepEqual(
    normalizeSurvey3dPayload({ status: 'NOT_STARTED', gdriveUrl: ' ', notes: ' ' }),
    { status: 'NOT_STARTED', gdriveUrl: null, notes: null },
  );
});
