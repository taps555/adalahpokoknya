'use strict';

const XLSX = require('xlsx');
const { parseHspkText } = require('./textStateParser');
const { parseAhspSheet, looksLikeAhspSheet } = require('./ahspSheetParser');

const HEADER_ALIASES = {
  name: ['uraian', 'nama', 'nama bahan', 'nama barang', 'jenis', 'upah - material - alat', 'upah-material-alat'],
  unit: ['satuan', 'sat', 'sat.'],
  price: ['harga', 'harga satuan', 'harga satuan (rp)', 'harga satuan(rp)'],
  coefficient: ['koefisien', 'koef'],
};

// kolom yang meski ke-detect sebagai "mengandung nama", jangan dipakai
// (mis. kolom "Kode" berisi L.01/L.02 yang bisa salah kena alias longgar)
const IGNORED_HEADER_LABELS = new Set(['kode', 'no']);

const SPECIAL_FORMAT_SHEETS = [/biaya operasi alat berat/i];   // <-- TAMBAH INI
function isSpecialFormatSheet(sheetName) {                      // <-- TAMBAH INI
  return SPECIAL_FORMAT_SHEETS.some((p) => p.test(sheetName || '')); // <-- TAMBAH INI
}                                                                 // <-- TAMBAH INI

function normalizeHeader(cell) {
  return String(cell || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
} 

function detectColumnMap(headerRow) {
  const map = {};
  headerRow.forEach((cell, idx) => {
    const norm = normalizeHeader(cell);
    if (IGNORED_HEADER_LABELS.has(norm)) return;
    for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.some((a) => norm === a || norm.includes(a))) {
        if (map[key] === undefined) map[key] = idx;
      }
    }
  });
  return map;
}

function isUsableColumnMap(map) {
  // kalau ada kolom "koefisien" terdeteksi, ini tabel item AHSP, bukan
  // daftar harga dasar -> jangan dipakai sebagai structured price sheet
  if (map.coefficient !== undefined) return false;
  // minimal butuh name + unit + price supaya layak dipakai sebagai fast-path
  return map.name !== undefined && map.unit !== undefined && map.price !== undefined;
}
/**
 * Coba baca satu sheet sebagai tabel harga dasar (bahan/upah/alat) dengan
 * kolom eksplisit. Sheet AHSP (yang punya struktur job per baris) biasanya
 * TIDAK cocok dengan fast-path ini dan akan di-skip di sini.
 */
function tryStructuredPriceSheet(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const map = detectColumnMap(rows[i]);
    if (isUsableColumnMap(map)) {
      const items = [];
      for (let r = i + 1; r < rows.length; r++) {
        const row = rows[r];
        const name = String(row[map.name] || '').trim();
        const unit = String(row[map.unit] || '').trim();
        const priceRaw = row[map.price];
        if (!name || !unit) continue;
        const price = parseFloat(String(priceRaw).replace(/[^\d.-]/g, ''));
        if (!Number.isFinite(price)) continue;
        items.push({ name, unit, price });
      }
      return items;
    }
  }
  return null;
}

/**
 * Ubah seluruh baris sheet jadi teks "per baris" (sel digabung spasi),
 * fallback terakhir untuk sheet yang meniru tata letak dokumen PDF lama
 * (mis. hasil copy-paste dari PDF ke Excel, pakai label "Jenis Pekerjaan =").
 */
function sheetToLines(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  return rows
    .map((row) =>
      row
        .map((c) => String(c ?? '').trim())
        .filter(Boolean)
        .join(' ')
    )
    .filter((line) => line.length > 0);
}

/**
 * @param {Buffer} fileBuffer isi file .xlsx/.xls
 * @returns {{materials, jobs, issues}}
 */
function parseExcelBuffer(fileBuffer) {
  const workbook = XLSX.read(fileBuffer, { type: 'buffer' });

 const materials = [];
  const jobs = [];
  const issues = [];
  const allLines = [];
  const fallbackSheets = new Set();      // <-- TAMBAH
  const specialSheets = [];              // <-- TAMBAH

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];

    if (isSpecialFormatSheet(sheetName)) {   
      specialSheets.push(sheetName);         
      continue;                              
    }                                        

    // 1) PRIORITASKAN AHSP DULU! (Pindahkan blok ini ke atas)
    const _isAhsp = looksLikeAhspSheet(sheet);
    console.log(`[ROUTE] "${sheetName}" -> isAhsp=${_isAhsp}`);
    if (!_isAhsp) {
      const _rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }).slice(0, 15);
      console.log(`[DUMP first 15 rows] "${sheetName}"`, JSON.stringify(_rows));
    }
    if (_isAhsp) {
      const result = parseAhspSheet(sheet, sheetName);
      jobs.push(...result.jobs);
      issues.push(...result.issues);
      continue; // Jika ini AHSP, langsung lanjut ke sheet berikutnya
    }

    // 2) BARU COBA SEBAGAI DAFTAR HARGA DASAR (Bahan/Upah/Alat)
    const structured = tryStructuredPriceSheet(sheet);
    if (structured && structured.length > 0) {
      materials.push(...structured);
      continue;
    }

    // 3) FALLBACK TERAKHIR
    fallbackSheets.add(sheetName);              
    allLines.push(...sheetToLines(sheet));
  }

  console.log('[FALLBACK SHEETS]', [...fallbackSheets]);              // <-- TAMBAH
  console.log('[SPECIAL FORMAT SHEETS - dilewati]', specialSheets);   // <-- TAMBAH
  

  const fallbackResult = allLines.length
    ? parseHspkText(allLines.join('\n'))
    : { materials: [], jobs: [], issues: [] };

  return {
    materials: [...materials, ...fallbackResult.materials],
    jobs: [...jobs, ...fallbackResult.jobs],
    issues: [...issues, ...fallbackResult.issues],
  };
}

module.exports = { parseExcelBuffer };