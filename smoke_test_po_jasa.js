require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');

const prisma = new PrismaClient();
const SECRET_KEY = process.env.JWT_SECRET || 'rahasia_super_aman_123';
const BASE_URL = 'http://localhost:4000/api';

async function run() {
  console.log('--- E2E Smoke Test: PO Jasa -> Pengajuan -> Lunas ---');
  
  // 1. Setup Admin Token
  let admin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } });
  const token = jwt.sign({ userId: admin.id, role: admin.role, name: admin.name }, SECRET_KEY, { expiresIn: '1h' });
  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
  
  // 2. Setup Project & Jasa
  let project = await prisma.project.findFirst();
  
  let jasa = await prisma.jasa.findFirst();
  if (!jasa) {
    jasa = await prisma.jasa.create({ data: { nama: 'Vendor Jasa Asli' } });
  }
  
  const rabItem = await prisma.rabItem.findFirst();

  console.log(`[Setup] Project ID: ${project.id}, Jasa ID: ${jasa.id}`);
  
  // 3. Create PO Jasa
  const poData = {
    projectId: project.id,
    jasaId: jasa.id,
    isJasa: true,
    kategoriPO: 'JASA',
    tanggal: new Date().toISOString(),
    subTotal: 500000,
    grandTotal: 500000,
    items: [
      {
        rabItemId: rabItem?.id || null,
        description: 'Jasa Pemasangan',
        qty: 1,
        unit: 'ls',
        unitPrice: 500000,
        total: 500000
      }
    ]
  };
  
  const createPoRes = await fetch(`${BASE_URL}/finance/po`, { method: 'POST', headers, body: JSON.stringify(poData) });
  const createPoJson = await createPoRes.json();
  if (!createPoRes.ok) throw new Error(`PO Create Failed: ${JSON.stringify(createPoJson)}`);
  
  const poId = createPoJson.data ? createPoJson.data.id : createPoJson.id;
  console.log(`[PO Created] ID: ${poId}`);
  
  // 4. Verify & Approve PO
  const verifyPoRes = await fetch(`${BASE_URL}/finance/po/${poId}/verify`, { method: 'PUT', headers, body: JSON.stringify({ verified: true }) });
  if (!verifyPoRes.ok) throw new Error(`PO Verify Failed`);
  console.log(`[PO Verified] Finance verified PO.`);
  
  const approvePoRes = await fetch(`${BASE_URL}/finance/po/${poId}/approve`, { method: 'PUT', headers, body: JSON.stringify({ approved: true }) });
  if (!approvePoRes.ok) throw new Error(`PO Approve Failed`);
  console.log(`[PO Approved] Atasan approved PO.`);
  
  // 5. Create Pengajuan Pembayaran
  const pengajuanData = {
    projectId: project.id,
    jasaId: jasa.id,
    poId: poId,
    noTagihan: `INV-JASA-${Date.now()}`,
    tanggalTagihan: new Date().toISOString(),
    jatuhTempo: new Date().toISOString(),
    totalTagihan: 500000,
    keterangan: 'E2E Test Pengajuan Jasa'
  };
  const createPengajuanRes = await fetch(`${BASE_URL}/pengajuan-bayar`, { method: 'POST', headers, body: JSON.stringify(pengajuanData) });
  const createPengajuanJson = await createPengajuanRes.json();
  if (!createPengajuanRes.ok) throw new Error(`Pengajuan Create Failed: ${JSON.stringify(createPengajuanJson)}`);
  
  const pengajuanId = createPengajuanJson.data ? createPengajuanJson.data.id : createPengajuanJson.id;
  console.log(`[Pengajuan Created] ID: ${pengajuanId}`);
  
  // 6. Verify & Approve Pengajuan
  // Pengajuan Jasa skips verify and goes straight to approve!
  const approvePengRes = await fetch(`${BASE_URL}/pengajuan-bayar/${pengajuanId}/approve`, { method: 'PUT', headers, body: JSON.stringify({ notes: 'Approved E2E' }) });
  if (!approvePengRes.ok) throw new Error(`Pengajuan Approve Failed: ${await approvePengRes.text()}`);
  console.log(`[Pengajuan Approved] Atasan approved Pengajuan.`);
  
  // 7. Bayar BON -> LUNAS
  // Find PembayaranSupplier created for this PO/Pengajuan
  const pembayarans = await prisma.pembayaranSupplier.findMany({ where: { poId: poId } });
  if (pembayarans.length === 0) throw new Error(`PembayaranSupplier not auto-generated!`);
  const pembayaranId = pembayarans[0].id;
  
  const bayarData = {
    tanggalBayar: new Date().toISOString(),
    jumlahBayar: 500000,
    metodeBayar: 'TRANSFER',
    bankAccount: 'BCA E2E',
    keterangan: 'Lunas dari E2E',
    status: 'LUNAS'
  };
  
  const bayarRes = await fetch(`${BASE_URL}/pembayaran-supplier/${pembayaranId}`, { method: 'PUT', headers, body: JSON.stringify(bayarData) });
  const bayarJson = await bayarRes.json();
  if (!bayarRes.ok) throw new Error(`Bayar BON Failed: ${JSON.stringify(bayarJson)}`);
  
  console.log(`[BON Dibayar] Pembayaran ID: ${bayarJson.id} | Status: ${bayarJson.status}`);
  console.log('--- ALL TESTS PASSED SUCCESSFULLY ---');
  
  process.exit(0);
}

run().catch(err => {
  console.error('[ERROR]', err);
  process.exit(1);
});
