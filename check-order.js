// check-order.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const items = await prisma.rabItem.findMany({
    where: { groupId: "cms470twk0018ay7yyz2sxuah" },
    select: { id: true, name: true, order: true, createdAt: true },
    orderBy: { order: "asc" },
  });
  items.forEach((it) =>
    console.log(`order=${it.order} | ${it.name} | created=${it.createdAt}`),
  );
}
main().finally(() => prisma.$disconnect());
