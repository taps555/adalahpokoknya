const prisma = require('./src/lib/prisma');
(async () => {
  const p = await prisma.project.findMany({ select: { id: true, name: true, clientId: true } });
  const c = await prisma.client.findMany({ select: { id: true, name: true } });
  const u = await prisma.user.findMany({ select: { id: true, name: true, role: true } });
  const dq = await prisma.designQuotation.findMany({
    select: { id: true, projectId: true, item3dVolume: true, item3dPrice: true, item2dVolume: true, item2dPrice: true, discount: true, quotationDate: true },
  });
  const spk = await prisma.spkContract.findMany({
    select: { id: true, projectId: true, type: true, contractValue: true, terms: { select: { id: true, label: true, amount: true } } },
  });
  console.log(JSON.stringify({ p, c, u, dq, spk }, null, 1));
  await prisma.$disconnect();
})();
