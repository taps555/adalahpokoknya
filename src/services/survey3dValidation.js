const STATUSES = new Set(['NOT_STARTED', 'IN_PROGRESS', 'REVIEW', 'REVISION', 'FINAL']);
const RESOURCE_TYPES = new Set(['GOOGLE_DRIVE', 'MODEL_3D', 'DOCUMENT', 'OTHER_LINK']);
const MAX_RESOURCES_3D = 20;

function parseHttpsUrl(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function isAllowedDriveUrl(value) {
  const url = parseHttpsUrl(value);
  return Boolean(url && (
    url.hostname === 'drive.google.com' ||
    url.hostname === 'docs.google.com'
  ));
}

function isAllowedResourceUrl(value) {
  return Boolean(parseHttpsUrl(value));
}

function normalizeResource(resource, order) {
  const type = String(resource?.type || '').trim().toUpperCase();
  const title = String(resource?.title || '').trim();
  const url = String(resource?.url || '').trim();

  // The UI sends the default type even when a newly added row is untouched.
  // Treat rows with neither a title nor URL as blank; partially filled rows
  // still fail validation so typos are not silently discarded.
  if (!title && !url) return null;
  if (!RESOURCE_TYPES.has(type)) {
    throw new Error(`jenis data pendukung ke-${order + 1} tidak valid`);
  }
  if (!title) {
    throw new Error(`judul data pendukung ke-${order + 1} wajib diisi`);
  }
  if (title.length > 150) {
    throw new Error(`judul data pendukung ke-${order + 1} maksimal 150 karakter`);
  }
  if (!isAllowedResourceUrl(url)) {
    throw new Error(`URL data pendukung ke-${order + 1} harus menggunakan HTTPS`);
  }
  if (type === 'GOOGLE_DRIVE' && !isAllowedDriveUrl(url)) {
    throw new Error(`URL Google Drive ke-${order + 1} harus berasal dari drive.google.com atau docs.google.com`);
  }

  return { type, title, url, order };
}

function normalizeSurvey3dPayload(payload = {}) {
  const status = String(payload.status || '').trim().toUpperCase();
  const notes = String(payload.notes || '').trim();
  const legacyDriveUrl = String(payload.gdriveUrl || '').trim();

  if (!STATUSES.has(status)) {
    throw new Error('status hasil desain 3D tidak valid');
  }

  const hasResources = Object.prototype.hasOwnProperty.call(payload, 'resources');
  if (hasResources && !Array.isArray(payload.resources)) {
    throw new Error('resources hasil desain 3D harus berupa array');
  }

  const rawResources = hasResources
    ? payload.resources
    : legacyDriveUrl
      ? [{
          type: 'GOOGLE_DRIVE',
          title: 'Model 3D - Google Drive',
          url: legacyDriveUrl,
        }]
      : [];

  if (rawResources.length > MAX_RESOURCES_3D) {
    throw new Error(`Maksimal ${MAX_RESOURCES_3D} data pendukung untuk satu hasil desain 3D`);
  }

  const resources = rawResources
    .map((resource, index) => normalizeResource(resource, index))
    .filter(Boolean)
    .map((resource, order) => ({ ...resource, order }));

  const resourceUrls = new Set();
  for (const resource of resources) {
    const key = resource.url.toLowerCase();
    if (resourceUrls.has(key)) {
      throw new Error(`URL data pendukung tidak boleh duplikat: ${resource.url}`);
    }
    resourceUrls.add(key);
  }

  const primaryDrive = resources.find((resource) => resource.type === 'GOOGLE_DRIVE');

  return {
    status,
    // Mirror link Drive pertama dipertahankan agar client lama tidak rusak.
    gdriveUrl: primaryDrive?.url || null,
    notes: notes || null,
    resources,
  };
}

module.exports = {
  STATUSES,
  RESOURCE_TYPES,
  MAX_RESOURCES_3D,
  isAllowedDriveUrl,
  isAllowedResourceUrl,
  normalizeSurvey3dPayload,
};
