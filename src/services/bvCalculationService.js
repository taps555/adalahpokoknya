"use strict";

function normalizeBvNumber(value, { field, defaultValue = null } = {}) {
  if (value === null || value === undefined) return defaultValue;

  const raw = typeof value === "string" ? value.trim() : String(value).trim();
  if (raw === "" || raw === "-") return defaultValue;

  const normalized = raw.replace(",", ".");
  const number = Number(normalized);
  if (!Number.isFinite(number)) {
    throw new TypeError(`${field || "Nilai"} harus berupa angka.`);
  }
  return number;
}

function normalizeBvBoolean(value, field) {
  if (typeof value !== "boolean") {
    throw new TypeError(`${field} harus berupa boolean.`);
  }
  return value;
}

const BV_LIMITS = Object.freeze({
  dimension: 999999.9999,
  waste: 99.9999,
  volume: 9999999999.9999,
});

function ensureInRange(value, field, max) {
  if (value < 0) throw new TypeError(`${field} tidak boleh negatif.`);
  if (value > max) throw new TypeError(`${field} melebihi batas maksimum ${max}.`);
  return value;
}

function roundBvNumber(value) {
  const rounded = Math.round((value + Number.EPSILON) * 10000) / 10000;
  if (!Number.isFinite(rounded)) {
    throw new TypeError("Nilai BV terlalu besar atau tidak valid.");
  }
  return rounded;
}

/**
 * Hitung subTotal volume satu baris breakdown (P x L x T x luas x keliling x berat,
 * cuma yang dicentang yang dikaliin, dikali jumlah sisi/buah, dikali waste%).
 */
function calcBreakdownSubtotal(b) {
  const p = ensureInRange(normalizeBvNumber(b.panjang, { field: "Panjang", defaultValue: 0 }), "Panjang", BV_LIMITS.dimension);
  const l = ensureInRange(normalizeBvNumber(b.lebar, { field: "Lebar", defaultValue: 0 }), "Lebar", BV_LIMITS.dimension);
  const t = ensureInRange(normalizeBvNumber(b.tinggi, { field: "Tinggi", defaultValue: 0 }), "Tinggi", BV_LIMITS.dimension);
  const luas = ensureInRange(normalizeBvNumber(b.luas, { field: "Luas", defaultValue: 0 }), "Luas", BV_LIMITS.dimension);
  const keliling = ensureInRange(normalizeBvNumber(b.keliling, { field: "Keliling", defaultValue: 0 }), "Keliling", BV_LIMITS.dimension);
  const berat = ensureInRange(normalizeBvNumber(b.berat, { field: "Berat", defaultValue: 0 }), "Berat", BV_LIMITS.dimension);

  const isPChecked = normalizeBvBoolean(b.isPChecked ?? false, "isPChecked");
  const isLChecked = normalizeBvBoolean(b.isLChecked ?? false, "isLChecked");
  const isTChecked = normalizeBvBoolean(b.isTChecked ?? false, "isTChecked");
  const isLuasChecked = normalizeBvBoolean(b.isLuasChecked ?? false, "isLuasChecked");
  const isKelChecked = normalizeBvBoolean(b.isKelChecked ?? false, "isKelChecked");
  const isBeratChecked = normalizeBvBoolean(b.isBeratChecked ?? false, "isBeratChecked");

  let baseVolume = 1;
  let adaYangDicentang = false;

  if (isPChecked) {
    baseVolume *= p;
    adaYangDicentang = true;
  }
  if (isLChecked) {
    baseVolume *= l;
    adaYangDicentang = true;
  }
  if (isTChecked) {
    baseVolume *= t;
    adaYangDicentang = true;
  }
  if (isLuasChecked) {
    baseVolume *= luas;
    adaYangDicentang = true;
  }
  if (isKelChecked) {
    baseVolume *= keliling;
    adaYangDicentang = true;
  }
  if (isBeratChecked) {
    baseVolume *= berat;
    adaYangDicentang = true;
  }

  if (!adaYangDicentang) baseVolume = 1;

  const s = ensureInRange(normalizeBvNumber(b.jumlahSisi, { field: "Jumlah sisi", defaultValue: 1 }), "Jumlah sisi", BV_LIMITS.dimension);
  const bh = ensureInRange(normalizeBvNumber(b.jumlahBh, { field: "Jumlah buah", defaultValue: 1 }), "Jumlah buah", BV_LIMITS.dimension);
  const waste = ensureInRange(normalizeBvNumber(b.waste, { field: "Waste", defaultValue: 0 }), "Waste", BV_LIMITS.waste);
  const subtotal = baseVolume * s * bh * (1 + waste / 100);
  if (!Number.isFinite(subtotal) || subtotal > BV_LIMITS.volume) {
    throw new TypeError("Subtotal BV terlalu besar atau tidak valid.");
  }

  return roundBvNumber(subtotal);
}

function sumBreakdownSubtotals(rows) {
  const total = rows.reduce((sum, row) => sum + row.subTotal, 0);
  if (!Number.isFinite(total) || total > BV_LIMITS.volume) {
    throw new TypeError("Total volume BV terlalu besar atau tidak valid.");
  }
  const rounded = roundBvNumber(total);
  if (!Number.isFinite(rounded)) {
    throw new TypeError("Total volume BV terlalu besar atau tidak valid.");
  }
  return rounded;
}

/**
 * Bentuk array breakdown mentah dari request jadi row siap simpan ke Prisma,
 * sekalian hitung subTotal tiap baris. Dipindah persis dari bv.routes.js.
 */
function buildBreakdownRows(breakdowns) {
  return breakdowns.map((b) => {
    const subTotal = calcBreakdownSubtotal(b);
    return {
      keterangan: b.keterangan || null,

      panjang: ensureInRange(normalizeBvNumber(b.panjang, { field: "Panjang", defaultValue: 0 }), "Panjang", BV_LIMITS.dimension) || null,
      isPChecked: normalizeBvBoolean(b.isPChecked ?? false, "isPChecked"),

      lebar: ensureInRange(normalizeBvNumber(b.lebar, { field: "Lebar", defaultValue: 0 }), "Lebar", BV_LIMITS.dimension) || null,
      isLChecked: normalizeBvBoolean(b.isLChecked ?? false, "isLChecked"),

      tinggi: ensureInRange(normalizeBvNumber(b.tinggi, { field: "Tinggi", defaultValue: 0 }), "Tinggi", BV_LIMITS.dimension) || null,
      isTChecked: normalizeBvBoolean(b.isTChecked ?? false, "isTChecked"),

      luas: ensureInRange(normalizeBvNumber(b.luas, { field: "Luas", defaultValue: 0 }), "Luas", BV_LIMITS.dimension) || null,
      isLuasChecked: normalizeBvBoolean(b.isLuasChecked ?? false, "isLuasChecked"),

      keliling: ensureInRange(normalizeBvNumber(b.keliling, { field: "Keliling", defaultValue: 0 }), "Keliling", BV_LIMITS.dimension) || null,
      isKelChecked: normalizeBvBoolean(b.isKelChecked ?? false, "isKelChecked"),

      berat: ensureInRange(normalizeBvNumber(b.berat, { field: "Berat", defaultValue: 0 }), "Berat", BV_LIMITS.dimension) || null,
      isBeratChecked: normalizeBvBoolean(b.isBeratChecked ?? false, "isBeratChecked"),

      diameter: ensureInRange(normalizeBvNumber(b.diameter, { field: "Diameter", defaultValue: 0 }), "Diameter", BV_LIMITS.dimension) || null,
      jumlahSisi: ensureInRange(normalizeBvNumber(b.jumlahSisi, { field: "Jumlah sisi", defaultValue: 1 }), "Jumlah sisi", BV_LIMITS.dimension),
      jumlahBh: ensureInRange(normalizeBvNumber(b.jumlahBh, { field: "Jumlah buah", defaultValue: 1 }), "Jumlah buah", BV_LIMITS.dimension),
      waste: ensureInRange(normalizeBvNumber(b.waste, { field: "Waste", defaultValue: 0 }), "Waste", BV_LIMITS.waste),

      subTotal,
    };
  });
}

/**
 * Tandai satu BvItem (dan children-nya, rekursif) dengan linkStatus:
 * BELUM_DILINK / SUDAH_DILINK / BELUM_SINKRON.
 * Dipindah persis dari fungsi withStatus() lokal di GET /projects/:projectId/bv-items.
 */
function withStatus(it) {
  let status = "BELUM_DILINK";

  if (it.linkedRabItem) {
    let same = false;
    const linkedParentId = it.linkedRabItem.parentId || null;
    const linkedGroupId = it.linkedRabItem.groupId || null;
    const sameStructure =
      linkedParentId === (it.parentBvItem?.linkedRabItemId || null) &&
      linkedGroupId === (it.groupId || null);

    const sameMetadata =
      Boolean(it.isHeaderOnly) === Boolean(it.linkedRabItem.isHeaderOnly) &&
      (it.sourceJobTypeId || null) === (it.linkedRabItem.sourceJobTypeId || null) &&
      ((it.disciplineLabel === "GENERAL" ? null : it.disciplineLabel) || null) ===
        (it.linkedRabItem.discipline || null);

    if (it.isHeaderOnly) {
      same = it.name === it.linkedRabItem.name && sameStructure && sameMetadata;
    } else {
      same =
        Number(it.totalVolume) === Number(it.linkedRabItem.volume) &&
        it.name === it.linkedRabItem.name &&
        it.paymentUnit === it.linkedRabItem.paymentUnit &&
        sameStructure &&
        sameMetadata;
    }

    status = same ? "SUDAH_DILINK" : "BELUM_SINKRON";
  }

  return {
    ...it,
    linkStatus: status,
    children: (it.children || []).map(withStatus),
  };
}

function normalizeAhspDiscipline(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return ["SIPIL", "INTERIOR"].includes(normalized) ? normalized : null;
}

function gradeForBv(bvItem, project, requestedDiscipline = null) {
  if (!project) return null;

  const dynamicConfig = (project.workCategories || []).find((config) =>
    config.workCategoryId === bvItem?.workCategoryId
    || config.workCategory?.id === bvItem?.workCategoryId,
  );
  if (dynamicConfig) return dynamicConfig.grade || null;

  const itemLabel = String(bvItem?.disciplineLabel || "GENERAL").trim().toUpperCase();
  const label = itemLabel === "GENERAL"
    ? normalizeAhspDiscipline(requestedDiscipline) || "GENERAL"
    : itemLabel;
  if (label === "SIPIL") return project.sipilGrade || project.grade || null;
  if (label === "INTERIOR") return project.interiorGrade || project.grade || null;
  return project.grade || null;
}

function redactSellingFields(value) {
  if (Array.isArray(value)) return value.map(redactSellingFields);
  if (!value || typeof value !== "object") return value;
  if (Object.getPrototypeOf(value) !== Object.prototype) return value;
  const result = { ...value };
  delete result.rabUnitPrice;
  delete result.rabTotalPrice;
  return Object.fromEntries(
    Object.entries(result).map(([key, child]) => [key, redactSellingFields(child)]),
  );
}

function validateJobTypeForProject(
  jobType,
  project,
  disciplineLabel,
  requestedDiscipline = null,
  workCategoryId = null,
) {
  if (!jobType || !project) return "Master AHSP atau project tidak ditemukan.";
  if (Number(jobType.period) !== Number(project.hspkPeriod)) {
    return "Periode master AHSP tidak sesuai dengan periode HSPK project.";
  }

  if (workCategoryId) {
    const config = (project.workCategories || []).find((entry) =>
      entry.workCategoryId === workCategoryId || entry.workCategory?.id === workCategoryId,
    );
    if (!config || !config.isActive) {
      return "Kategori pekerjaan tidak aktif pada project.";
    }
    if (config.pricingMode !== "HSPK") {
      return "Kategori project memakai mode CUSTOM; AHSP tidak dapat dipilih.";
    }
    const categoryCode = String(config.workCategory?.code || "").toUpperCase();
    const isLegacySipilInterior = ["SIPIL", "INTERIOR"].includes(categoryCode);

    if (isLegacySipilInterior) {
      // Kategori SIPIL/INTERIOR menerima data legacy (workCategoryId null,
      // masih memakai discipline) maupun data baru yang sudah punya workCategoryId.
      const jobDiscipline = normalizeAhspDiscipline(jobType.discipline);
      const matchesNew = jobType.workCategoryId === workCategoryId;
      const matchesLegacy = jobDiscipline === categoryCode;
      if (!matchesNew && !matchesLegacy) {
        return `Kategori master AHSP tidak sesuai dengan kategori ${categoryCode}.`;
      }
    } else if (jobType.workCategoryId !== workCategoryId) {
      return "Kategori master AHSP tidak sesuai dengan kategori BV.";
    }

    if (config.grade && jobType.grade !== config.grade) {
      return "Grade master AHSP tidak sesuai dengan grade kategori project.";
    }
    return null;
  }

  const itemLabel = String(disciplineLabel || "GENERAL").trim().toUpperCase();
  const requested = normalizeAhspDiscipline(requestedDiscipline);
  if (itemLabel === "GENERAL" && !requested) {
    return "Pilih disiplin AHSP SIPIL atau INTERIOR untuk item GENERAL.";
  }
  const label = itemLabel === "GENERAL" ? requested : itemLabel;
  const jobDiscipline = normalizeAhspDiscipline(jobType.discipline);
  if (jobDiscipline !== label) {
    return "Disiplin master AHSP tidak sesuai dengan label disiplin BV.";
  }

  const expectedGrade = gradeForBv(
    { disciplineLabel: itemLabel },
    project,
    requested,
  );
  if (expectedGrade && jobType.grade !== expectedGrade) {
    return "Grade master AHSP tidak sesuai dengan grade project.";
  }
  return null;
}

function disciplineForRab(bvItem, ahspDiscipline = null) {
  const itemLabel = String(bvItem?.disciplineLabel || "GENERAL").trim().toUpperCase();
  if (["SIPIL", "INTERIOR"].includes(itemLabel)) return itemLabel;
  const requested = normalizeAhspDiscipline(ahspDiscipline);
  if (requested) return requested;
  return null;
}

function buildWorkCategoryItemWhere({ workCategoryId = null, categoryCode = null } = {}) {
  const code = String(categoryCode || "").trim().toUpperCase();
  if (workCategoryId) {
    if (["SIPIL", "INTERIOR"].includes(code)) {
      return {
        OR: [
          { workCategoryId },
          { workCategoryId: null, discipline: code },
        ],
      };
    }
    return { workCategoryId };
  }
  if (["SIPIL", "INTERIOR"].includes(code)) return { discipline: code };
  return {};
}

function normalizeWorkCategoryCode(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!normalized || normalized.length > 40) {
    throw new TypeError("Kode kategori wajib berisi huruf/angka dan maksimal 40 karakter.");
  }
  if (["GENERAL", "SEMUA", "ALL"].includes(normalized)) {
    throw new TypeError(`${normalized} bukan kategori master; gunakan sebagai filter gabungan.`);
  }
  return normalized;
}

function normalizeProjectWorkCategoryConfigs(configs, categories) {
  if (!Array.isArray(configs) || configs.length === 0) {
    throw new TypeError("Minimal satu kategori pekerjaan proyek wajib dipilih.");
  }

  const categoryById = new Map((categories || []).map((category) => [category.id, category]));
  const seen = new Set();
  const normalized = configs.map((config) => {
    const workCategoryId = String(config?.workCategoryId || "").trim();
    const category = categoryById.get(workCategoryId);
    if (!category) throw new TypeError("Kategori pekerjaan tidak ditemukan.");
    if (!category.isActive) {
      throw new TypeError(`Kategori ${category.code || category.name} tidak aktif.`);
    }
    if (seen.has(workCategoryId)) {
      throw new TypeError(`Kategori ${category.code || category.name} duplikat.`);
    }
    seen.add(workCategoryId);

    const pricingMode = String(config?.pricingMode || "CUSTOM").trim().toUpperCase();
    if (!["HSPK", "CUSTOM"].includes(pricingMode)) {
      throw new TypeError("Sumber harga kategori harus HSPK atau CUSTOM.");
    }
    const grade = pricingMode === "HSPK"
      ? String(config?.grade || "").trim().toUpperCase()
      : null;
    if (pricingMode === "HSPK" && !grade) {
      throw new TypeError(`Grade wajib dipilih untuk kategori HSPK ${category.code || category.name}.`);
    }

    return {
      workCategoryId,
      pricingMode,
      grade,
      isActive: config?.isActive !== false,
    };
  });

  if (!normalized.some((config) => config.isActive)) {
    throw new TypeError("Minimal satu kategori pekerjaan proyek harus aktif.");
  }
  return normalized;
}

module.exports = {
  normalizeBvNumber,
  calcBreakdownSubtotal,
  sumBreakdownSubtotals,
  buildBreakdownRows,
  withStatus,
  redactSellingFields,
  validateJobTypeForProject,
  gradeForBv,
  normalizeAhspDiscipline,
  disciplineForRab,
  normalizeWorkCategoryCode,
  normalizeProjectWorkCategoryConfigs,
  buildWorkCategoryItemWhere,
};
