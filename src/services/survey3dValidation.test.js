const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeSurvey3dPayload,
  isAllowedDriveUrl,
  isAllowedResourceUrl,
} = require('./survey3dValidation');

test('normalizes one 3D result with multiple supporting resources', () => {
  assert.deepEqual(
    normalizeSurvey3dPayload({
      status: ' in_progress ',
      notes: ' Revisi pertama ',
      resources: [
        {
          type: ' google_drive ',
          title: ' Model utama ',
          url: ' https://drive.google.com/file/d/model/view ',
        },
        {
          type: 'document',
          title: ' Brief desain ',
          url: ' https://example.com/brief.pdf ',
        },
      ],
    }),
    {
      status: 'IN_PROGRESS',
      gdriveUrl: 'https://drive.google.com/file/d/model/view',
      notes: 'Revisi pertama',
      resources: [
        {
          type: 'GOOGLE_DRIVE',
          title: 'Model utama',
          url: 'https://drive.google.com/file/d/model/view',
          order: 0,
        },
        {
          type: 'DOCUMENT',
          title: 'Brief desain',
          url: 'https://example.com/brief.pdf',
          order: 1,
        },
      ],
    },
  );
});

test('converts the legacy single Drive field into one resource', () => {
  assert.deepEqual(
    normalizeSurvey3dPayload({
      status: 'FINAL',
      gdriveUrl: ' https://docs.google.com/file/d/legacy/view ',
      notes: '',
    }),
    {
      status: 'FINAL',
      gdriveUrl: 'https://docs.google.com/file/d/legacy/view',
      notes: null,
      resources: [{
        type: 'GOOGLE_DRIVE',
        title: 'Model 3D - Google Drive',
        url: 'https://docs.google.com/file/d/legacy/view',
        order: 0,
      }],
    },
  );
});

test('allows Drive/Docs links and secure supporting-resource URLs', () => {
  assert.equal(isAllowedDriveUrl('https://drive.google.com/file/d/abc/view'), true);
  assert.equal(isAllowedDriveUrl('https://docs.google.com/file/d/abc/view'), true);
  assert.equal(isAllowedDriveUrl('https://example.com/model'), false);
  assert.equal(isAllowedResourceUrl('https://example.com/model.glb'), true);
  assert.equal(isAllowedResourceUrl('http://example.com/model.glb'), false);
});

test('rejects unsupported status, invalid resources, and partial rows', () => {
  assert.throws(
    () => normalizeSurvey3dPayload({ status: 'DONE', resources: [] }),
    /status/i,
  );
  assert.throws(
    () => normalizeSurvey3dPayload({
      status: 'FINAL',
      resources: [{ type: 'GOOGLE_DRIVE', title: 'Model', url: 'https://example.com/model' }],
    }),
    /Google Drive/i,
  );
  assert.throws(
    () => normalizeSurvey3dPayload({
      status: 'FINAL',
      resources: [{ type: 'DOCUMENT', title: '', url: 'https://example.com/brief.pdf' }],
    }),
    /judul/i,
  );
});

test('ignores untouched UI resource rows while still rejecting partially filled rows', () => {
  assert.deepEqual(
    normalizeSurvey3dPayload({
      status: 'IN_PROGRESS',
      notes: 'Catatan tetap boleh disimpan',
      resources: [{ type: 'GOOGLE_DRIVE', title: ' ', url: ' ' }],
    }),
    {
      status: 'IN_PROGRESS',
      gdriveUrl: null,
      notes: 'Catatan tetap boleh disimpan',
      resources: [],
    },
  );

  assert.throws(
    () => normalizeSurvey3dPayload({
      status: 'FINAL',
      resources: [{ type: 'GOOGLE_DRIVE', title: '', url: 'https://drive.google.com/file/d/model/view' }],
    }),
    /judul/i,
  );
});

test('allows an empty resource list and rejects more than 20 resources', () => {
  assert.deepEqual(
    normalizeSurvey3dPayload({ status: 'NOT_STARTED', notes: ' ', resources: [] }),
    { status: 'NOT_STARTED', gdriveUrl: null, notes: null, resources: [] },
  );
  assert.throws(
    () => normalizeSurvey3dPayload({
      status: 'FINAL',
      resources: Array.from({ length: 21 }, (_, index) => ({
        type: 'OTHER_LINK',
        title: `Data ${index + 1}`,
        url: `https://example.com/${index + 1}`,
      })),
    }),
    /maksimal 20/i,
  );
});
