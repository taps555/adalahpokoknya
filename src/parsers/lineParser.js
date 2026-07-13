'use strict';

/**
 * Utilitas parsing baris teks HSPK/AHSP.
 *
 * Strategi: dokumen sumber (terutama hasil ekstraksi teks dari PDF) sering
 * "berantakan" — angka pakai koma sebagai pemisah ribuan, kadang ada
 * "Rp" di awal kadang di akhir, nama barang kadang mengandung angka
 * (mis. "Kayu Meranti Papan 2/20, 4/10"), dan kadang nilainya kosong
 * (#REF!, #N/A). Karena itu kita parsing dari BELAKANG baris (paling
 * kanan = harga, sebelum itu koefisien, sebelum itu satuan, sisanya nama),
 * bukan dengan satu regex global, supaya angka di dalam nama barang tidak
 * salah tertangkap.
 */

const MISSING_VALUE_TOKENS = new Set(['#REF!', '#N/A', '#DIV/0!', '-', '']);

const NUMERIC_TOKEN_RE = /^-?\d[\d,]*(\.\d+)?$/;

function isNumericToken(tok) {
  return NUMERIC_TOKEN_RE.test(tok);
}

function isMissingValueToken(tok) {
  return MISSING_VALUE_TOKENS.has(tok.toUpperCase());
}

function toNumber(tok) {
  if (tok == null) return null;
  const cleaned = String(tok).replace(/,/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pecah baris jadi token, buang token "Rp" berdiri sendiri, dan lepaskan
 * prefix "Rp" yang menempel di angka (mis. "Rp172,000" -> "172,000").
 */
function tokenize(line) {
  return line
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.replace(/^Rp\.?/i, '').trim())
    .filter((t) => t.length > 0 && t.toLowerCase() !== 'rp');
}

/**
 * Ambil `count` angka dari BELAKANG deretan token (boleh numerik biasa
 * atau token "nilai hilang" seperti #REF!). Berhenti begitu ketemu token
 * yang bukan angka / bukan nilai-hilang.
 *
 * Return: { numbers: (number|null)[], remaining: string[] }
 *   `numbers` selalu berurutan sesuai urutan aslinya di baris (bukan reversed).
 */
function popTrailingNumbers(tokens, count) {
  const t = [...tokens];
  const numbers = [];
  while (numbers.length < count && t.length > 0) {
    const last = t[t.length - 1];
    if (isNumericToken(last)) {
      numbers.unshift(toNumber(last));
      t.pop();
    } else if (isMissingValueToken(last)) {
      numbers.unshift(null);
      t.pop();
    } else {
      break;
    }
  }
  return { numbers, remaining: t };
}

function cleanName(tokens) {
  return tokens
    .join(' ')
    .replace(/,\s*$/, '')
    .replace(/\s+,/g, ',')
    .trim();
}

/**
 * Parsing baris daftar harga dasar (bahan/upah/alat), formatnya:
 *   "<nama> <satuan> <harga> [Rp]"
 * Contoh: "Semen PC 50 Kg zak 72,700.00 Rp"
 */
function parsePriceLine(rawLine) {
  const tokens = tokenize(rawLine);
  if (tokens.length < 2) return null;

  const { numbers, remaining } = popTrailingNumbers(tokens, 1);
  if (numbers.length < 1) return null;
  const [price] = numbers;
  if (remaining.length < 1) return null;

  const unit = remaining.pop();
  const name = cleanName(remaining);
  if (!name || !unit) return null;

  return { name, unit, price };
}

/**
 * Parsing baris item AHSP (baris di dalam section TENAGA KERJA/BAHAN/PERALATAN),
 * formatnya: "<nama> <satuan> <koefisien> <harga satuan> [Rp]"
 * Contoh: "Semen PC 50 Kg Zak 6.18 Rp 72,700"
 * Contoh: "Batu Bata Merah buah 140 600 Rp"
 */
function parseCoefficientLine(rawLine) {
  const tokens = tokenize(rawLine);
  if (tokens.length < 3) return null;

  const { numbers, remaining } = popTrailingNumbers(tokens, 2);
  if (numbers.length < 2) return null;
  const [coefficient, price] = numbers;
  if (remaining.length < 1) return null;

  const unit = remaining.pop();
  const name = cleanName(remaining);
  if (!name || !unit) return null;

  return { name, unit, coefficient, price };
}

module.exports = {
  tokenize,
  popTrailingNumbers,
  isNumericToken,
  isMissingValueToken,
  toNumber,
  parsePriceLine,
  parseCoefficientLine,
};
