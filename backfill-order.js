const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const groups = await prisma.rabItem.groupBy({
    by: ["projectId", "groupId"],
  });

  for (const g of groups) {
    const items = await prisma.rabItem.findMany({
      where: { projectId: g.projectId, groupId: g.groupId },
      orderBy: { createdAt: "asc" },
    });
    for (let i = 0; i < items.length; i++) {
      await prisma.rabItem.update({
        where: { id: items[i].id },
        data: { order: i },
      });
    }
  }
  console.log("Backfill order selesai");
}

main().finally(() => prisma.$disconnect());
