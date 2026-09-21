// Quick data inspection for the test project
const prisma = require("./src/lib/prisma");

(async () => {
  const projectId = "cmtik3nfz0002rrnoqoq4n6id";
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { client: true },
  });
  console.log("=== PROJECT ===");
  console.log({
    id: project.id,
    name: project.name,
    location: project.location,
    hspkPeriod: project.hspkPeriod,
    discipline: project.discipline,
    grade: project.grade,
    interiorGrade: project.interiorGrade,
    sipilGrade: project.sipilGrade,
    clientName: project.client?.name,
  });

  // BV items - count by disciplineLabel
  const bvItems = await prisma.bvItem.findMany({
    where: { projectId },
    select: {
      id: true,
      name: true,
      disciplineLabel: true,
      isHeaderOnly: true,
      parentBvItemId: true,
      groupId: true,
      paymentUnit: true,
      totalVolume: true,
      keterangan: true,
      createdAt: true,
    },
    orderBy: [{ groupId: "asc" }, { createdAt: "asc" }],
  });
  console.log("\n=== BV ITEMS (" + bvItems.length + " total) ===");
  const bvByLabel = {};
  for (const it of bvItems) {
    const label = it.disciplineLabel || "GENERAL";
    if (!bvByLabel[label]) bvByLabel[label] = [];
    bvByLabel[label].push(it);
  }
  for (const [label, items] of Object.entries(bvByLabel)) {
    console.log(`  ${label}: ${items.length} items`);
  }
  // show first 5 of each
  for (const [label, items] of Object.entries(bvByLabel)) {
    console.log(`\n  --- ${label} sample (first 5) ---`);
    for (const it of items.slice(0, 5)) {
      console.log(`    ${it.name} | parent=${it.parentBvItemId ? "yes" : "root"} | header=${it.isHeaderOnly} | vol=${it.totalVolume} | unit=${it.paymentUnit}`);
    }
  }

  // RAB items - count by discipline
  const rabItems = await prisma.rabItem.findMany({
    where: { projectId },
    select: {
      id: true,
      name: true,
      discipline: true,
      isHeaderOnly: true,
      parentId: true,
      groupId: true,
      order: true,
      paymentUnit: true,
      volume: true,
      rabUnitPrice: true,
      rabTotalPrice: true,
      rapUnitPrice: true,
      rapTotalPrice: true,
      isByOwner: true,
      isStip: true,
    },
    orderBy: [{ groupId: "asc" }, { order: "asc" }],
  });
  console.log("\n=== RAB ITEMS (" + rabItems.length + " total) ===");
  const rabByDisc = {};
  for (const it of rabItems) {
    const disc = it.discipline || "null/GENERAL";
    if (!rabByDisc[disc]) rabByDisc[disc] = [];
    rabByDisc[disc].push(it);
  }
  for (const [disc, items] of Object.entries(rabByDisc)) {
    console.log(`  ${disc}: ${items.length} items`);
  }
  for (const [disc, items] of Object.entries(rabByDisc)) {
    console.log(`\n  --- ${disc} sample (first 5) ---`);
    for (const it of items.slice(0, 5)) {
      console.log(`    ${it.name} | parent=${it.parentId ? "yes" : "root"} | header=${it.isHeaderOnly} | vol=${it.volume} | rabTotal=${it.rabTotalPrice} | byOwner=${it.isByOwner}`);
    }
  }

  // RabGroups
  const groups = await prisma.rabGroup.findMany({
    where: { projectId, parentId: null },
    include: {
      items: { select: { id: true, name: true, order: true } },
      children: { include: { items: { select: { id: true, name: true } } } },
    },
    orderBy: { order: "asc" },
  });
  console.log("\n=== RAB GROUPS (top-level " + groups.length + ") ===");
  for (const g of groups) {
    console.log(`  ${g.name} (order=${g.order}) -> ${g.items.length} items, ${g.children.length} subgroups`);
  }

  await prisma.$disconnect();
})().catch((e) => {
  console.error("ERR:", e.message);
  process.exit(1);
});
