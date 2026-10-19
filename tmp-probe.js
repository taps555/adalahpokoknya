const prisma = require('./src/lib/prisma');
(async () => {
  const out = {};
  const t = async (k, fn) => { try { out[k] = await fn(); } catch (e) { out[k] = 'ERR: ' + String(e.message).split('\n')[0]; } };
  await t('desain', async () => (await prisma.invoicePenjualanDesain.findMany({ take: 1 })).length);
  await t('klien', async () => (await prisma.invoicePenjualanKlien.findMany({ take: 1 })).length);
  await t('ops', async () => (await prisma.invoiceOperasional.findMany({ take: 1 })).length);
  await t('dq', async () => (await prisma.designQuotation.findMany({ take: 1 })).length);
  await t('spkTerm', async () => (await prisma.spkTerm.findMany({ take: 1 })).length);
  await t('spkContract', async () => (await prisma.spkContract.findMany({ take: 1 })).length);
  await t('client', async () => (await prisma.client.findMany({ take: 1 })).length);
  await t('project', async () => (await prisma.project.findMany({ take: 1 })).length);
  console.log(JSON.stringify(out, null, 1));
  await prisma.$disconnect();
})();
