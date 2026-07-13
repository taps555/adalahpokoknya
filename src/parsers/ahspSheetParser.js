'use strict';

const XLSX = require('xlsx');

// ---- deteksi header kolom tabel item (No/Uraian/Kode/Sat./Koefisien/...) ----
const ITEM_HEADER_ALIASES = {
  name: ['uraian'],
  unit: ['sat', 'sat.', 'satuan'],
  coefficient: ['koefisien', 'koef'],
  price: ['harga satuan', 'harga satuan (rp)', 'harga  satuan', 'harga  satuan (rp)'],
};

// Baris job baru: kolom nomor berpola "2.2.1.1.1" / "2.2.1.1.1a" + ada harga di kolom kanan
const RE_JOB_NUMBER = /^\d+(\.\d+){2,}\.?[a-z]?$/i;

// Baris section: "A" / "B" / "C" di kolom pertama, uraian di kolom kedua
const RE_SECTION_CODE = /^[ABC]\.?$/i;

// Baris penutup job: kolom pertama "F", uraian mengandung "Harga Satuan Pekerjaan"
const RE_CLOSE_CODE = /^F$/i;
const RE_CLOSE_TEXT = /harga satuan pekerjaan/i;

function norm(cell) {
  return String(cell ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function cellStr(cell) {
  return String(cell ?? '').trim();
}

// >>> SISIPKAN PATCH B DI SINI <
function firstNonEmptyIdx(row, maxScan = 6) {
  for (let i = 0; i < Math.min(row.length, maxScan); i++) {
    if (cellStr(row[i]) !== '') return i;
  }
  return -1;
}

function normCode(cell) {
  return cellStr(cell).replace(/\s+/g, '').replace(/,/g, '.').replace(/\.{2,}/g, '.');
}

function extractPaymentUnit(name) {
  if (!name) return null;
  const m = name.match(/\b(?:\d+([.,]\d+)?|per)\s+(m'|m2|m3|m1|m|kg|ls|unit|buah|titik|oh|batang|zak|lembar|liter|ton|set|bh|psg|ttk)\b/i);
  return m ? m[2] : null;
}

function toNumber(cell) {
  if (cell === '' || cell == null) return null;
  const cleaned = String(cell).replace(/[^\d.-]/g, '');
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function detectItemHeaderMap(row) {
  const map = {};
  row.forEach((cell, idx) => {
    const n = norm(cell);
    for (const [key, aliases] of Object.entries(ITEM_HEADER_ALIASES)) {
      if (aliases.includes(n) && map[key] === undefined) map[key] = idx;
    }
  });
  return map.name !== undefined && map.unit !== undefined &&
    map.coefficient !== undefined && map.price !== undefined ? map : null;
}

function sectionFromRow(row) {
  const idx = firstNonEmptyIdx(row);
  if (idx === -1) return null;
  const code = cellStr(row[idx]);
  const label = norm(row[idx + 1]);
  if (!RE_SECTION_CODE.test(code)) return null;
  if (/tenaga/.test(label) || code.toUpperCase() === 'A') return 'UPAH';
  if (/bahan/.test(label) || code.toUpperCase() === 'B') return 'BAHAN';
  if (/peralatan/.test(label) || code.toUpperCase() === 'C') return 'ALAT';
  return null;
}

function isJobHeaderRow(row) {
  const idx = firstNonEmptyIdx(row);
  if (idx === -1) return false;
  const first = normCode(row[idx]);
  if (!RE_JOB_NUMBER.test(first)) return false;
  return row.slice(idx + 1).some((c) => cellStr(c).length > 0);
}

function isCloseRow(row) {
  const idx = firstNonEmptyIdx(row);
  if (idx === -1) return false;
  const first = cellStr(row[idx]);
  const second = cellStr(row[idx + 1]);
  return RE_CLOSE_CODE.test(first) && RE_CLOSE_TEXT.test(second);
}

/**
 * Parse satu sheet AHSP (Beton, Pondasi, Persiapan, dst) yang formatnya:
 *   "2.2.1.1.1 kg penulangan slab ..."      <- baris job, harga total di kolom kanan
 *   No | Uraian | Kode | Sat. | Koefisien | Harga Satuan (Rp) | Jumlah Harga (Rp)
 *   A  | TENAGA KERJA
 *   1  | Pekerja | L.01 | OH | 0.0070 | 130,000.00 | 910.00
 *   ...
 *   F  | Harga Satuan Pekerjaan (D+E) | | | | | 18,801.20
 *
 * @returns {{jobs: Array, issues: Array}}
 */
function parseAhspSheet(sheet, sheetName) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  const jobs = [];
  const issues = [];

  let currentJob = null;
  let currentSection = null;
  let itemHeaderMap = null;

  function pushIssue(reason, row) {
    issues.push({
      context: currentJob ? currentJob.name : `(${sheetName})`,
      rawLine: row.map(cellStr).join(' | '),
      reason,
    });
  }

  function finalizeJob() {
    if (currentJob) jobs.push(currentJob);
    currentJob = null;
    currentSection = null;
  }

  for (const row of rows) {
    if (row.every((c) => cellStr(c) === '')) continue; // baris kosong

    // 1. Deteksi Header Paling Awal
    // 1. Deteksi Header Paling Awal
    const hm = detectItemHeaderMap(row);
    if (hm) {
      itemHeaderMap = hm;
      continue;
    }

    // 1b. Header berulang tapi tidak lengkap (kolom kosong) -> skip, jangan remap
    const _idxH = firstNonEmptyIdx(row);
    if (_idxH !== -1 && norm(row[_idxH]) === 'no' && /uraian/.test(norm(row[_idxH + 1]))) {
      continue;
    }

    // 2. Baris job baru
    if (isJobHeaderRow(row) && !RE_CLOSE_CODE.test(cellStr(row[0]))) {
      finalizeJob();
      
      const idx = firstNonEmptyIdx(row);
      const kodePekerjaan = normCode(row[idx]);
      const namaPekerjaan = cellStr(row[idx + 1]);
      console.log('[JOB ROW DUMP]', JSON.stringify(row));

      currentJob = {
        name: namaPekerjaan || `${sheetName} (perlu ditinjau)`,
        paymentUnit: extractPaymentUnit(namaPekerjaan),
        category: sheetName,
        reference: kodePekerjaan !== '' ? kodePekerjaan : null,
        overhead: 0.1, 
        labor: [],
        material: [],
        equipment: [],
        isSpecialFormat: /analisa biaya operasi alat berat|duktivitas/i.test(namaPekerjaan),
      };
      
      continue; // Lanjut ke baris berikutnya
    }
    if (!currentJob) continue;

    if (currentJob.isSpecialFormat) continue; // blok tabel non-standar, lewati semua isinya

    // 3. Section marker (UPAH / BAHAN / ALAT)
    const sec = sectionFromRow(row);
    if (sec) {
      currentSection = sec;
      continue;
    }

    // 4. Baris penutup job
    if (isCloseRow(row)) {
      finalizeJob();
      continue;
    }

    // 5. Filter baris subtotal / jumlah harga / biaya umum (Agar tidak dianggap error)
    const label = norm(`${row[0] ?? ''} ${row[1] ?? ''}`);
    if (
      label.includes('jumlah harga') || 
      label.includes('jumlah') ||
      label.includes('subtotal') ||
      label.includes('total') ||
      label.includes('biaya umum') ||
      label.includes('keuntungan') ||
      label.includes('pajak')
    ) {
      // Tangkap persentase overhead jika ada di baris biaya umum
      if (/biaya umum/.test(label)) {
        const overheadCell = row.find(c => String(c).includes('%'));
        if (overheadCell) {
          const cleanNumber = parseFloat(String(overheadCell).replace('%', '').trim());
          if (!isNaN(cleanNumber)) {
            currentJob.overhead = cleanNumber / 100;
          }
        }
      }
      continue; // Langsung skip baris ini
    }

    // 6. Baris item (Proses datanya masuk ke UPAH / BAHAN / ALAT)
    if (currentSection && itemHeaderMap) {
      const name = cellStr(row[itemHeaderMap.name]);
      const unit = cellStr(row[itemHeaderMap.unit]);
      const coefficient = toNumber(row[itemHeaderMap.coefficient]);
      const price = toNumber(row[itemHeaderMap.price]);

      // baris placeholder: skip aman
      if (!name && !unit && coefficient == null && price == null) {
        continue;
      }

      if (!name || !unit) {
        pushIssue(`Baris item tidak lengkap pada section ${currentSection}`, row);
        continue;
      }
      if (coefficient == null || price == null) {
        pushIssue(`Nilai kosong/#REF! pada item di section ${currentSection}`, row);
      }
      
      const item = { name, unit, coefficient, price };
      const bucket =
        currentSection === 'UPAH' ? currentJob.labor :
        currentSection === 'BAHAN' ? currentJob.material :
        currentJob.equipment;
      
      bucket.push(item);
      continue;
    }

    const _idx = firstNonEmptyIdx(row);
   if (_idx !== -1 && /^\d+(\.\d+)*\.?$/.test(normCode(row[_idx])) && !row.slice(_idx + 1).some((c) => toNumber(c) !== null && toNumber(c) > 100))  {
      continue; // judul sub-kelompok, bukan error
    }


const NOISE_WORDS = ['revisi', 'baru', 'lama', 'update'];
    if (_idx !== -1 && row.filter((c) => cellStr(c) !== '').length === 1 && NOISE_WORDS.includes(norm(row[_idx]))) {
      continue;
    }

    pushIssue('Baris tidak dikenali di dalam blok pekerjaan', row);
  }

  finalizeJob();

  for (const job of jobs) {
    if (!job.paymentUnit) job.paymentUnit = '-';
  }

  return { jobs, issues };
}

/**
 * Heuristik cepat: apakah sheet ini kemungkinan sheet AHSP (bukan daftar harga)?
 * Cek beberapa baris pertama, cari pola nomor job atau kata "TENAGA KERJA".
 */
function looksLikeAhspSheet(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const row = rows[i];
    if (isJobHeaderRow(row)) return true;
    if (sectionFromRow(row)) return true;
  }
  return false;
}

module.exports = { parseAhspSheet, looksLikeAhspSheet };