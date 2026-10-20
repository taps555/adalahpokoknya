const prisma = require('./src/lib/prisma');
(async () => {
  const out = {};
  const t = async (k, fn) => { try { await fn(); out[k] = 'OK'; } catch (e) { out[k] = String(e.message).split('\n').filter(Boolean).slice(-1)[0]; } };
  await t('desain_invalid_select', () => prisma.invoicePenjualanDesain.findMany({ take: 1, select: { tipeRekening: { select: { id: true, kodeRekening: true, namaTipe: true } } } }));
  await t('klien_invalid_select', () => prisma.invoicePenjualanKlien.findMany({ take: 1, select: { tipeRekening: { select: { id: true, kodeRekening: true, namaTipe: true } } } }));
  await t('ops_invalid_select', () => prisma.invoiceOperasional.findMany({ take: 1, select: { tipeRekening: { select: { id: true, kodeRekening: true, namaTipe: true } } } }));
  await t('desain_valid_select', () => prisma.invoicePenjualanDesain.findMany({ take: 1, select: { tipeRekening: { select: { id: true, namaTipe: true } } } }));
  console.log(JSON.stringify(out, null, 1));
  await prisma.$disconnect();
})();
