const prisma = require('./src/lib/prisma');
const num = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v) || 0);
(async () => {
  const dq = await prisma.designQuotation.findMany({
    select: {
      id: true, projectId: true, item3dVolume: true, item3dPrice: true,
      item2dVolume: true, item2dPrice: true, discount: true,
    },
  });
  const rows = dq.map((q) => {
    const p3 = num(q.item3dVolume) * num(q.item3dPrice);
    const p2 = num(q.item2dVolume) * num(q.item2dPrice);
    const d = num(q.discount);
    return { id: q.id, item3dVolume: q.item3dVolume, item3dPrice: q.item3dPrice, part3d: p3, part2d: p2, discount: d, raw: p3 + p2 - d };
  });
  console.log(JSON.stringify(rows, null, 1));
  await prisma.$disconnect();
})();
