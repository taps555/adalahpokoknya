const STATUSES = new Set(['NOT_STARTED', 'IN_PROGRESS', 'REVIEW', 'REVISION', 'FINAL']);

function isAllowedDriveUrl(value) {
  if (!value || typeof value !== 'string') return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && (
      url.hostname === 'drive.google.com' ||
      url.hostname === 'docs.google.com'
    );
  } catch {
    return false;
  }
}

function normalizeSurvey3dPayload(payload = {}) {
  const status = String(payload.status || '').trim().toUpperCase();
  const gdriveUrl = String(payload.gdriveUrl || '').trim();
  const notes = String(payload.notes || '').trim();

  if (!STATUSES.has(status)) {
    throw new Error('status hasil desain 3D tidak valid');
  }
  if (gdriveUrl && !isAllowedDriveUrl(gdriveUrl)) {
    throw new Error('gdriveUrl harus berupa link Google Drive yang valid');
  }

  return {
    status,
    gdriveUrl: gdriveUrl || null,
    notes: notes || null,
  };
}

module.exports = { STATUSES, isAllowedDriveUrl, normalizeSurvey3dPayload };
