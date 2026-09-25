// Verifikasi skema Survey3D tersedia di Prisma Client + DB.
// Jalankan: node scripts/verify-survey3d-schema.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const resultCount = await prisma.survey3DResult.count();
  const imageCount = await prisma.survey3DImage.count();
  console.log("Survey3DResult rows:", resultCount);
  console.log("Survey3DImage rows:", imageCount);
  console.log("OK: skema survey 3D tersedia.");
}

main()
  .catch((error) => {
    console.error("FAIL:", error.message.slice(0, 300));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
