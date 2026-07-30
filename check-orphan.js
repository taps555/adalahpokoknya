// delete-nogroup.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const PROJECT_ID = "cmrzt62rz0josya422uu4roy9";

async function main() {
  const items = await prisma.rabItem.findMany({
    where: { projectId: PROJECT_ID, groupId: null },
    include: { bvItem: true },
  });

  console.log(`Akan menghapus ${items.length} item...`);
  for (const it of items) {
    if (it.bvItem) {
      await prisma.bvItem.delete({ where: { id: it.bvItem.id } });
    }
    await prisma.rabItem.delete({ where: { id: it.id } });
    console.log(`Hapus "${it.name}"`);
  }
  console.log("Selesai.");
}

main().finally(() => prisma.$disconnect());
