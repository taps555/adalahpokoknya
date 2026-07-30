// delete-nogroup.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const PROJECT_ID = "cmrzt62rz0josya422uu4roy9";

async function main() {
  const rabItems = await prisma.rabItem.findMany({
    where: { projectId: PROJECT_ID, groupId: null },
  });
  const bvItems = await prisma.bvItem.findMany({
    where: { projectId: PROJECT_ID, groupId: null },
  });

  console.log(
    `Akan menghapus ${rabItems.length} RabItem dan ${bvItems.length} BvItem tanpa group...`,
  );

  for (const it of rabItems) {
    try {
      await prisma.rabItem.delete({ where: { id: it.id } });
      console.log(`Hapus RAB: "${it.name}"`);
    } catch (err) {
      console.log(`Skip RAB "${it.name}" (sudah terhapus/tidak ditemukan)`);
    }
  }

  for (const it of bvItems) {
    try {
      await prisma.bvItem.delete({ where: { id: it.id } });
      console.log(`Hapus BV: "${it.name}"`);
    } catch (err) {
      console.log(`Skip BV "${it.name}" (sudah terhapus via cascade)`);
    }
  }

  console.log("Selesai.");
}

main().finally(() => prisma.$disconnect());
