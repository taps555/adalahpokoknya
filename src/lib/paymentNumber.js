const prisma = require("./prisma");

const getYearBounds = (dateInput) => {
  const base = dateInput ? new Date(dateInput) : new Date();
  const year = base.getFullYear();
  const month = String(base.getMonth() + 1).padStart(2, "0");
  const start = new Date(year, 0, 1, 0, 0, 0, 0);
  const end = new Date(year + 1, 0, 1, 0, 0, 0, 0);
  return { base, year, month, start, end };
};

/**
 * Format: PBY/MM/YYYY/NNN
 * - nomor urut reset per tahun
 * - urutan mengikuti seq di tahun berjalan (stabil)
 */
async function buildNoPembayaran({ pembayaranId, tanggal }) {
  const { base, year, month, start, end } = getYearBounds(tanggal);

  const yearlyRows = await prisma.pembayaranSupplier.findMany({
    where: {
      tanggal: {
        gte: start,
        lt: end,
      },
    },
    orderBy: [{ seq: "asc" }],
    select: { id: true },
  });

  let urut = yearlyRows.length + 1;
  if (pembayaranId) {
    const idx = yearlyRows.findIndex((row) => row.id === pembayaranId);
    if (idx >= 0) urut = idx + 1;
  }

  const nnn = String(urut).padStart(3, "0");
  return `PBY/${month}/${year}/${nnn}`;
}

module.exports = {
  buildNoPembayaran,
};
