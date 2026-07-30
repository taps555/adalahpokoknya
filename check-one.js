// check-one.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const item = await prisma.rabItem.findUnique({
    where: { id: "cms5jwm8m000m3ukg9iagkany" },
  });
  console.log(item);
}
main().finally(() => prisma.$disconnect());
