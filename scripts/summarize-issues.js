const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const batchId = 'cmrhoc3on0000wdcowrt0guih'; // ganti sesuai batch terakhir
  
  const issues = await prisma.UploadIssue.findMany({ // ganti nama model sesuai schema.prisma kamu
    where: { batchId },
  });

  const summary = issues.reduce((acc, i) => {
    acc[i.reason] = (acc[i.reason] || 0) + 1;
    return acc;
  }, {});

  console.log(JSON.stringify(summary, null, 2));
  await prisma.$disconnect();
}

main();