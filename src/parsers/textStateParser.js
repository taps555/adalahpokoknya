'use strict';

const { parsePriceLine, parseCoefficientLine } = require('./lineParser');

// ---- pola-pola baris penanda struktur dokumen ---------------------------
const RE_JOB_HEADER = /^Jenis Pekerjaan\s*=\s*(.*)$/i;
const RE_PAYMENT_UNIT = /^Satuan Pembayaran\s*=\s*(.*)$/i;
const RE_JOB_END = /^Jumlah Harga (Satuan|Persatuan) Pekerjaan/i;
const RE_TABLE_HEADER = /^NO\s+URAIAN\s+SATUAN\s+KOEFISIEN/i;
// sisa header tabel yang kepotong baris (mis. "(RP)" sendirian) — noise, bukan error
const RE_NOISE = /^\(RP\)$/i;

// Section marker di dalam satu blok AHSP, mis. "A. TENAGA KERJA", "B. BAHAN."
const RE_SECTION_LABOR = /^A\.?\s*(TENAGA\s*KERJA)?\.?\s*$|^A\.\s*TENAGA KERJA/i;
const RE_SECTION_MATERIAL = /^B\.?\s*(BAHAN)?\.?\s*$|^B\.\s*BAHAN/i;
const RE_SECTION_EQUIPMENT = /^C\.?\s*(PERALATAN)?\.?\s*$|^C\.\s*PERALATAN/i;

// Kategori besar di luar blok job, mis. "D. PEKERJAAN BETON"
const RE_CATEGORY_HEADER = /^[A-Z]\.\s*PEKERJAAN\s+[A-ZÀ-Ú].*/;

// Referensi standar, mis. "SNI 7394:2008 (6.10)" atau "Lamp Permen PUPR 2016 hal 623"
const RE_REFERENCE = /(SNI\s?[\d:]+.*|Lamp\s?Permen.*|Permen\s?PUPR.*|PEKERJAAN\s.*SNI.*)/i;

function classifySectionLine(line) {
  if (RE_SECTION_LABOR.test(line) && /TENAGA/i.test(line)) return 'UPAH';
  if (RE_SECTION_MATERIAL.test(line) && /BAHAN/i.test(line)) return 'BAHAN';
  if (RE_SECTION_EQUIPMENT.test(line) && /PERALATAN/i.test(line)) return 'ALAT';
  // baris pendek "A." / "B." / "C." polos juga dianggap penanda section
  // kalau kita sedang dalam blok job (ditangani di caller lewat state).
  if (/^A\.?$/.test(line)) return 'UPAH';
  if (/^B\.?$/.test(line)) return 'BAHAN';
  if (/^C\.?$/.test(line)) return 'ALAT';
  return null;
}

/**
 * Pra-pemrosesan: dokumen PDF 2-kolom sering membuat 2 baris item nyatu jadi
 * 1 baris panjang karena urutan ekstraksi teks per-baris-visual. Ciri paling
 * gampang: ada lebih dari satu "Rp" dalam satu baris. Kita pecah baris itu
 * jadi beberapa baris berdasarkan posisi tepat setelah setiap "Rp".
 */
function splitMultiItemLines(rawLines) {
  const out = [];
  for (const line of rawLines) {
    const rpCount = (line.match(/Rp/g) || []).length;
    if (rpCount <= 1) {
      out.push(line);
      continue;
    }
    // pecah tepat setelah setiap kemunculan "Rp"
    const parts = line.split(/(?<=Rp)/g).map((s) => s.trim()).filter(Boolean);
    out.push(...parts);
  }
  return out;
}

/**
 * Parse teks lengkap (hasil ekstraksi PDF, atau baris-baris dari Excel yang
 * digabung jadi teks) menjadi struktur:
 *   {
 *     materials: [{name, unit, price}],
 *     jobs: [{
 *       name, paymentUnit, category, reference,
 *       labor: [{name, unit, coefficient, price}],
 *       material: [...],
 *       equipment: [...],
 *     }],
 *     issues: [{context, rawLine, reason}],
 *   }
 */
function parseHspkText(fullText) {
  const rawLines = fullText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const lines = splitMultiItemLines(rawLines);

  const materials = [];
  const jobs = [];
  const issues = [];

  let inJobBlock = false;
  let currentJob = null;
  let currentCategory = null;
  let currentSection = null; // 'UPAH' | 'BAHAN' | 'ALAT'
  let pendingReference = null;

  function pushIssue(reason, rawLine) {
    issues.push({
      context: currentJob ? currentJob.name : '(daftar harga)',
      rawLine,
      reason,
    });
  }

  function finalizeJob() {
    if (currentJob) {
      jobs.push(currentJob);
    }
    currentJob = null;
    currentSection = null;
    inJobBlock = false;
  }

  for (const line of lines) {
    // --- header kategori besar, mis "D. PEKERJAAN BETON" (hanya di luar job) ---
    if (!inJobBlock && RE_CATEGORY_HEADER.test(line)) {
      currentCategory = line.replace(/\s+/g, ' ').trim();
      continue;
    }

    // --- mulai blok pekerjaan baru ---
    const jobMatch = line.match(RE_JOB_HEADER);
    if (jobMatch) {
      finalizeJob(); // tutup job sebelumnya kalau ada yang belum ditutup
      const name = jobMatch[1].trim();
      currentJob = {
        name: name || null, // bisa kosong, nanti diisi fallback di bawah
        paymentUnit: null,
        category: currentCategory,
        reference: pendingReference,
        labor: [],
        material: [],
        equipment: [],
      };
      pendingReference = null;
      inJobBlock = true;
      continue;
    }

    if (!inJobBlock) {
      // referensi yang muncul sebelum "Jenis Pekerjaan =" berikutnya,
      // simpan untuk dipasang ke job selanjutnya
      if (RE_REFERENCE.test(line) && line.length < 120) {
        pendingReference = line.trim();
        continue;
      }
      // di luar blok job = daftar harga dasar bahan/upah/alat
      const priceRow = parsePriceLine(line);
      if (priceRow && priceRow.price != null) {
        materials.push(priceRow);
      } else if (!RE_TABLE_HEADER.test(line)) {
        // baris yang bukan header tabel tapi gagal di-parse -> catat utk review
        // (banyak baris judul section semacam "BAHAN MATERIAL Satuan Harga Satuan"
        //  juga akan lolos ke sini, itu wajar & aman diabaikan / direview manual)
        pushIssue('Baris di luar blok pekerjaan tidak cocok pola harga', line);
      }
      continue;
    }

    // --- di dalam blok job ---
    if (RE_PAYMENT_UNIT.test(line)) {
      currentJob.paymentUnit = line.match(RE_PAYMENT_UNIT)[1].trim();
      continue;
    }

    if (RE_REFERENCE.test(line) && line.length < 120) {
      if (!currentJob.reference) currentJob.reference = line.trim();
      continue;
    }

    if (RE_TABLE_HEADER.test(line) || RE_NOISE.test(line)) continue; // header kolom / noise, skip

    const sectionGuess = classifySectionLine(line);
    if (sectionGuess) {
      currentSection = sectionGuess;
      continue;
    }

    if (RE_JOB_END.test(line)) {
      // kalau nama job kosong (kasus "Jenis Pekerjaan = " tanpa isi),
      // fallback pakai kategori + urutan supaya tidak hilang, tapi ditandai review
      if (!currentJob.name) {
        currentJob.name = `${currentCategory || 'Pekerjaan'} (perlu ditinjau)`;
        currentJob.needsReview = true;
      }
      finalizeJob();
      continue;
    }

    // baris item koefisien (tenaga kerja / bahan / alat)
    if (currentSection) {
      const item = parseCoefficientLine(line);
      if (item) {
        if (item.price == null || item.coefficient == null) {
          pushIssue(`Nilai kosong/#REF! pada item di section ${currentSection}`, line);
        }
        const bucket =
          currentSection === 'UPAH'
            ? currentJob.labor
            : currentSection === 'BAHAN'
            ? currentJob.material
            : currentJob.equipment;
        bucket.push(item);
      } else {
        pushIssue(`Gagal parse baris item pada section ${currentSection}`, line);
      }
      continue;
    }

    // baris tidak dikenali di dalam job (mis. judul kategori nyasar, dsb)
    pushIssue('Baris di dalam blok pekerjaan tidak dikenali (belum ada section aktif)', line);
  }

  // tutup job terakhir kalau file tidak diakhiri dengan "Jumlah Harga..."
  finalizeJob();

  // job tanpa nama tetap diberi fallback supaya tidak silently dropped
  for (const job of jobs) {
    if (!job.name) {
      job.name = `${job.category || 'Pekerjaan'} (perlu ditinjau)`;
      job.needsReview = true;
    }
    if (!job.paymentUnit) {
      job.paymentUnit = '-';
      job.needsReview = true;
    }
  }

  return { materials, jobs, issues };
}

module.exports = { parseHspkText, splitMultiItemLines };
