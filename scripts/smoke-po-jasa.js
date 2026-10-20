'use strict';
/**
 * Smoke test E2E — PO Jasa flow 2-tahap approval.
 *
 * Skenario:
 *   1. Login (SUPER_ADMIN atau Finance+PM).
 *   2. Approve PO Jasa (status -> APPROVED).
 *   3. Buat Pengajuan Bayar (PENDING).
 *   4. Verifikasi Finance (PENDING -> APPROVED_FINANCE).
 *      - Pastikan atasan belum bisa approve sebelum ini.
 *   5. Approve Atasan (APPROVED_FINANCE -> APPROVED).
 *   6. Bayar BON (parsial, status BON).
 *   7. Bayar LUNAS (sisa, status LUNAS).
 *
 * Cara jalan:
 *   node scripts/smoke-po-jasa.js \
 *     --base http://localhost:4000 \
 *     --user admin --pass admin123 \
 *     --po   <PO_JASA_ID>            (opsional, kalau tdk ada akan dicari)
 *
 * ENV override:
 *   BASE_URL, SMOKE_USER, SMOKE_PASS, SMOKE_PO_ID
 *
 * NOTE:
 * - Butuh PO Jasa yang sudah terbuat (status PENDING/MENUNGGU_ATASAN atau APPROVED).
 * - Tidak membuat RAP/PO baru supaya skrip tidak merusak data planning.
 */

const args = process.argv.slice(2);
function argv(key, fallback) {
  const idx = args.findIndex((a) => a === `--${key}`);
  return idx >= 0 ? args[idx + 1] : fallback;
}

const BASE_URL = argv('base', process.env.BASE_URL || 'http://localhost:4000');
const SMOKE_USER = argv('user', process.env.SMOKE_USER || 'admin');
const SMOKE_PASS = argv('pass', process.env.SMOKE_PASS || 'admin123');
const SMOKE_PO_ID = argv('po', process.env.SMOKE_PO_ID || null);

const steps = [];
function logStep(name, ok, extra = {}) {
  steps.push({ name, ok, ...extra });
  const tag = ok ? '✅' : '❌';
  console.log(`${tag} ${name}${extra.msg ? ' — ' + extra.msg : ''}`);
}

async function http(method, path, { token, body } = {}) {
  const url = `${BASE_URL}${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, body: json };
}

async function login(username, password) {
  const r = await http('POST', '/api/auth/login', { body: { username, password } });
  if (r.status !== 200 || !r.body?.token) {
    throw new Error(`Login gagal (${r.status}): ${JSON.stringify(r.body)}`);
  }
  return { token: r.body.token, user: r.body.user };
}

async function pickPoJasa(token) {
  if (SMOKE_PO_ID) return SMOKE_PO_ID;
  const r = await http('GET', '/api/purchasing/po?kategori=JASA', { token });
  const list = Array.isArray(r.body) ? r.body : r.body?.data || [];
  const target =
    list.find((p) => p.status === 'MENUNGGU_ATASAN' || p.status === 'PENDING') ||
    list[0];
  if (!target) throw new Error('Tidak ada PO Jasa untuk diuji. Buat dulu minimal 1.');
  return target.id;
}

(async () => {
  console.log('--- Smoke test PO Jasa 2-tahap approval ---');
  console.log('BASE_URL =', BASE_URL);

  // STEP 0 - login
  let auth;
  try {
    auth = await login(SMOKE_USER, SMOKE_PASS);
    logStep('Login', true, { msg: `role=${auth.user.role}` });
  } catch (e) {
    logStep('Login', false, { msg: e.message });
    process.exit(1);
  }
  const token = auth.token;

  // STEP 1 - cari PO Jasa
  let poId;
  try {
    poId = await pickPoJasa(token);
    logStep('Pilih PO Jasa', true, { msg: `poId=${poId}` });
  } catch (e) {
    logStep('Pilih PO Jasa', false, { msg: e.message });
    process.exit(1);
  }

  // STEP 2 - approve PO (idempotent)
  {
    const r = await http('PUT', `/api/purchasing/po/${poId}/approve`, { token });
    const ok = r.status === 200 || /sudah/i.test(r.body?.error || '');
    logStep('Approve PO Jasa', ok, { msg: r.body?.message || r.body?.error });
    if (!ok) process.exit(1);
  }

  // Ambil detail PO untuk nominal
  const detail = await http('GET', `/api/purchasing/po/${poId}`, { token });
  const po = detail.body?.data || detail.body;
  const totalTagihan = Number(po?.grandTotal || po?.subTotal || 0);
  const projectId = po?.projectId;
  const supplierId = po?.supplierId || null;
  const jasaId = po?.jasaId || null;

  if (!(supplierId || jasaId)) {
    logStep('Validasi PO punya supplier/jasa', false, {
      msg: 'PO tidak punya supplierId/jasaId',
    });
    process.exit(1);
  }
  if (!totalTagihan) {
    logStep('Validasi total tagihan > 0', false, {
      msg: 'grandTotal/subTotal PO 0',
    });
    process.exit(1);
  }

  // STEP 3 - buat pengajuan
  let pengajuanId;
  {
    const r = await http('POST', '/api/purchasing/pengajuan-bayar', {
      token,
      body: {
        poId,
        supplierId,
        jasaId,
        projectId,
        tanggal: new Date().toISOString(),
        totalTagihan,
        catatan: 'SMOKE TEST pengajuan jasa',
      },
    });
    const ok = r.status === 200 && r.body?.data?.id;
    pengajuanId = r.body?.data?.id;
    logStep('Buat pengajuan bayar', ok, {
      msg: r.body?.data?.noPengajuan || r.body?.error,
    });
    if (!ok) process.exit(1);
  }

  // STEP 4 - CEK: atasan tidak boleh bisa approve sebelum finance verify
  {
    const r = await http('PUT', `/api/purchasing/pengajuan-bayar/${pengajuanId}/approve`, {
      token,
    });
    const blocked = r.status === 400 && /verifikasi Finance/i.test(r.body?.error || '');
    logStep('Guard: atasan DI-BLOCK sebelum Finance verify', blocked, {
      msg: r.body?.error || `status=${r.status}`,
    });
    if (!blocked) process.exit(1);
  }

  // STEP 5 - Finance verify
  {
    const r = await http('PUT', `/api/purchasing/pengajuan-bayar/${pengajuanId}/verify`, {
      token,
    });
    const ok = r.status === 200 && r.body?.data?.status === 'APPROVED_FINANCE';
    logStep('Finance verify (PENDING -> APPROVED_FINANCE)', ok, {
      msg: r.body?.message || r.body?.error,
    });
    if (!ok) process.exit(1);
  }

  // STEP 6 - Approve atasan
  {
    const r = await http('PUT', `/api/purchasing/pengajuan-bayar/${pengajuanId}/approve`, {
      token,
    });
    const ok = r.status === 200 && r.body?.data?.status === 'APPROVED';
    logStep('Atasan approve (APPROVED_FINANCE -> APPROVED)', ok, {
      msg: r.body?.message || r.body?.error,
    });
    if (!ok) process.exit(1);
  }

  // Ambil draft pembayaran yang auto-created
  const listPembayaran = await http(
    'GET',
    `/api/purchasing/pembayaran-supplier?poId=${poId}`,
    { token },
  );
  const payments = Array.isArray(listPembayaran.body)
    ? listPembayaran.body
    : listPembayaran.body?.data || [];
  const draft = payments[0];
  if (!draft?.id) {
    logStep('Cek draft pembayaran', false, { msg: 'Tidak ada draft pembayaran' });
    process.exit(1);
  }
  logStep('Cek draft pembayaran', true, {
    msg: `id=${draft.id} status=${draft.status} approval=${draft.approvalStatus}`,
  });

  // STEP 7a - HARD BLOCK: bayar sebelum approval chain selesai harus gagal
  {
    const r = await http('PUT', `/api/purchasing/pembayaran-supplier/${draft.id}`, {
      token,
      body: { jumlahBayar: 1000, tambahPembayaran: true, keterangan: 'SMOKE coba bayar tanpa approval' },
    });
    const blocked = r.status === 400 && /belum|ditolak/i.test(r.body?.error || '');
    logStep('Guard: bayar DI-BLOCK sebelum approval pembayaran', blocked, {
      msg: r.body?.error || `status=${r.status}`,
    });
    if (!blocked) process.exit(1);
  }

  // STEP 7b - Finance approve pembayaran
  {
    const r = await http(
      'PUT',
      `/api/purchasing/pembayaran-supplier/${draft.id}/approve-finance`,
      { token },
    );
    const ok = r.status === 200 && r.body?.data?.approvalStatus === 'APPROVED_FINANCE';
    logStep('Finance approve pembayaran (-> APPROVED_FINANCE)', ok, {
      msg: r.body?.message || r.body?.error,
    });
    if (!ok) process.exit(1);
  }

  // STEP 7c - Atasan approve pembayaran
  {
    const r = await http(
      'PUT',
      `/api/purchasing/pembayaran-supplier/${draft.id}/approve-atasan`,
      { token },
    );
    const ok = r.status === 200 && r.body?.data?.approvalStatus === 'APPROVED_ATASAN';
    logStep('Atasan approve pembayaran (-> APPROVED_ATASAN)', ok, {
      msg: r.body?.message || r.body?.error,
    });
    if (!ok) process.exit(1);
  }

  // STEP 8 - BON (bayar separuh)
  const half = Math.round(totalTagihan / 2);
  {
    const r = await http('PUT', `/api/purchasing/pembayaran-supplier/${draft.id}`, {
      token,
      body: {
        jumlahBayar: half,
        tanggal: new Date().toISOString(),
        keterangan: 'SMOKE TEST pembayaran BON',
        metodeBayar: 'TRANSFER',
      },
    });
    const ok =
      r.status === 200 &&
      (r.body?.data?.status === 'BON' || r.body?.data?.status === 'PARTIAL');
    logStep('Pembayaran BON (parsial)', ok, {
      msg: `status=${r.body?.data?.status} sisa=${r.body?.data?.sisaBayar}`,
    });
    if (!ok) process.exit(1);
  }

  // STEP 8 - LUNAS (bayar sisa)
  {
    const r = await http('PUT', `/api/purchasing/pembayaran-supplier/${draft.id}`, {
      token,
      body: {
        jumlahBayar: totalTagihan - half,
        tanggal: new Date().toISOString(),
        keterangan: 'SMOKE TEST pembayaran LUNAS',
        metodeBayar: 'TRANSFER',
      },
    });
    const ok =
      r.status === 200 &&
      (r.body?.data?.status === 'LUNAS' || r.body?.data?.status === 'PAID');
    logStep('Pembayaran LUNAS (pelunasan)', ok, {
      msg: `status=${r.body?.data?.status} sisa=${r.body?.data?.sisaBayar}`,
    });
    if (!ok) process.exit(1);
  }

  // STEP 9 - verifikasi final: no pembayaran tergenerate
  const final = await http(
    'GET',
    `/api/purchasing/pembayaran-supplier/${draft.id}`,
    { token },
  );
  const noBayar = final.body?.data?.noPembayaran || final.body?.noPembayaran;
  logStep('No pembayaran tergenerate', !!noBayar, { msg: noBayar || '(kosong)' });

  const okAll = steps.every((s) => s.ok);
  console.log('--- RESULT:', okAll ? 'ALL PASS ✅' : 'FAILED ❌', '---');
  process.exit(okAll ? 0 : 1);
})().catch((e) => {
  console.error('smoke fatal:', e);
  process.exit(1);
});
