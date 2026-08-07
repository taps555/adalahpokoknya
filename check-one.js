// // check-bv-order.js
// const { PrismaClient } = require("@prisma/client");
// const prisma = new PrismaClient();

// async function main() {
//   const items = await prisma.bvItem.findMany({
//     where: { groupId: "cmscswv6z00013r2rpeqowbgb" },
//     select: {
//       id: true,
//       name: true,
//       parentBvItemId: true,
//       createdAt: true,
//       linkedRabItemId: true,
//     },
//     orderBy: { createdAt: "asc" },
//   });
//   items.forEach((it) => {
//     console.log(
//       `${it.parentBvItemId ? "  └─" : ""} ${it.name} | created=${it.createdAt} | linked=${!!it.linkedRabItemId}`,
//     );
//   });
// }
// main().finally(() => prisma.$disconnect());

// check-rab-order.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const items = await prisma.rabItem.findMany({
    where: { groupId: "cmscswv6z00013r2rpeqowbgb" },
    select: { id: true, name: true, order: true },
    orderBy: { order: "asc" },
  });
  items.forEach((it) => console.log(`order=${it.order} | ${it.name}`));
}
main().finally(() => prisma.$disconnect());
