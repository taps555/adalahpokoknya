const express = require("express");
const router = express.Router();
const prisma = require("../../lib/prisma");
const { verifyToken, authorizeRoles } = require("../../middleware/auth");

/**
 * GET /api/gl-bank/transaksi
 * Query params:
 *   tipeAkun=KAS|BANK
 *   namaAkun=...
 *   dari=YYYY-MM-DD
 *   sampai=YYYY-MM-DD
 *   search=...
 *   page=1&limit=100
 */
router.get("/transaksi", verifyToken, async (req, res) => {
  try {
    const { tipeAkun, namaAkun, dari, sampai, search, page = "1", limit = "100" } = req.query;
    const where = {};
    if (tipeAkun) where.tipeAkun = tipeAkun;
    if (namaAkun) where.namaAkun = { contains: namaAkun, mode: "insensitive" };
    if (dari || sampai) {
      where.tanggal = {};
      if (dari) where.tanggal.gte = new Date(dari);
      if (sampai) where.tanggal.lte = new Date(sampai);
    }
    if (search) {
      where.OR = [
        { noReferensi: { contains: search, mode: "insensitive" } },
        { pihak: { contains: search, mode: "insensitive" } },
        { keterangan: { contains: search, mode: "insensitive" } },
        { namaAkun: { contains: search, mode: "insensitive" } },
      ];
    }

    const take = Math.min(parseInt(limit) || 100, 500);
    const skip = ((parseInt(page) || 1) - 1) * take;

    const [rows, total] = await Promise.all([
      prisma.bukuBesarTransaksi.findMany({
        where,
        orderBy: { tanggal: "asc" },
        include: {
          createdBy: { select: { id: true, name: true } },
          purchaseOrder: { select: { id: true, poNumber: true } },
          pengajuan: { select: { id: true, noPengajuan: true } },
          pembayaran: { select: { id: true, noPembayaran: true } },
        },
        take,
        skip,
      }),
      prisma.bukuBesarTransaksi.count({ where }),
    ]);

    res.json({ data: rows, total, page: parseInt(page) || 1, totalPages: Math.ceil(total / take) });
  } catch (e) {
    console.error("GET /gl-bank/transaksi error:", e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/gl-bank/akun/master
 * Master akun buku besar.
 */
router.get("/akun/master", verifyToken, async (req, res) => {
  try {
    const { tipeAkun, search } = req.query;
    const where = {};
    if (tipeAkun) where.tipeAkun = tipeAkun;
    if (search) {
      where.OR = [
        { namaAkun: { contains: search, mode: "insensitive" } },
        { kodeAkun: { contains: search, mode: "insensitive" } },
      ];
    }
    const rows = await prisma.akunBukuBesar.findMany({
      where,
      orderBy: [{ tipeAkun: "asc" }, { namaAkun: "asc" }],
    });
    res.json({ data: rows });
  } catch (e) {
    console.error("GET /gl-bank/akun/master error:", e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/gl-bank/akun/master
 */
router.post("/akun/master", verifyToken, async (req, res) => {
  try {
    const { kodeAkun, namaAkun, tipeAkun, keterangan } = req.body;
    if (!namaAkun || !tipeAkun) {
      return res.status(400).json({ error: "Nama akun dan tipe akun wajib diisi." });
    }
    if (!["KAS", "BANK"].includes(tipeAkun)) {
      return res.status(400).json({ error: "Tipe akun harus KAS atau BANK." });
    }
    const created = await prisma.akunBukuBesar.create({
      data: {
        kodeAkun: kodeAkun || null,
        namaAkun: namaAkun.trim(),
        tipeAkun,
        keterangan: keterangan || null,
      },
    });
    res.json(created);
  } catch (e) {
    console.error("POST /gl-bank/akun/master error:", e);
    if (e.code === "P2002") {
      return res.status(400).json({ error: "Nama akun sudah ada untuk tipe ini." });
    }
    res.status(500).json({ error: e.message });
  }
});

/**
 * PUT /api/gl-bank/akun/master/:id
 */
router.put("/akun/master/:id", verifyToken, async (req, res) => {
  try {
    const { kodeAkun, namaAkun, tipeAkun, keterangan, isActive } = req.body;
    const data = {};
    if (kodeAkun !== undefined) data.kodeAkun = kodeAkun || null;
    if (namaAkun !== undefined) data.namaAkun = namaAkun.trim();
    if (tipeAkun !== undefined) data.tipeAkun = tipeAkun;
    if (keterangan !== undefined) data.keterangan = keterangan || null;
    if (isActive !== undefined) data.isActive = Boolean(isActive);
    const updated = await prisma.akunBukuBesar.update({ where: { id: req.params.id }, data });
    res.json(updated);
  } catch (e) {
    console.error("PUT /gl-bank/akun/master/:id error:", e);
    if (e.code === "P2002") {
      return res.status(400).json({ error: "Nama akun sudah ada untuk tipe ini." });
    }
    if (e.code === "P2025") {
      return res.status(404).json({ error: "Akun tidak ditemukan." });
    }
    res.status(500).json({ error: e.message });
  }
});

/**
 * DELETE /api/gl-bank/akun/master/:id
 */
router.delete("/akun/master/:id", verifyToken, async (req, res) => {
  try {
    await prisma.akunBukuBesar.delete({ where: { id: req.params.id } });
    res.json({ message: "Akun dihapus." });
  } catch (e) {
    console.error("DELETE /gl-bank/akun/master/:id error:", e);
    if (e.code === "P2025") {
      return res.status(404).json({ error: "Akun tidak ditemukan." });
    }
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/gl-bank/akun
 * Mengembalikan daftar nama akun unik per tipeAkun (dari transaksi + master).
 */
router.get("/akun", verifyToken, async (req, res) => {
  try {
    const { tipeAkun } = req.query;
    const where = {};
    if (tipeAkun) where.tipeAkun = tipeAkun;

    const [trxRows, masterRows] = await Promise.all([
      prisma.bukuBesarTransaksi.findMany({
        where,
        select: { tipeAkun: true, namaAkun: true },
        distinct: ["tipeAkun", "namaAkun"],
        orderBy: { namaAkun: "asc" },
      }),
      prisma.akunBukuBesar.findMany({
        where: tipeAkun ? { tipeAkun, isActive: true } : { isActive: true },
        select: { tipeAkun: true, namaAkun: true },
        orderBy: { namaAkun: "asc" },
      }),
    ]);
    const merged = new Map();
    for (const r of [...masterRows, ...trxRows]) {
      merged.set(`${r.tipeAkun}_${r.namaAkun}`, r);
    }
    res.json({ data: Array.from(merged.values()) });
  } catch (e) {
    console.error("GET /gl-bank/akun error:", e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/gl-bank/saldo
 * Mengembalikan saldo terakhir per tipeAkun dan namaAkun.
 */
router.get("/saldo", verifyToken, async (req, res) => {
  try {
    const { tipeAkun } = req.query;
    const where = {};
    if (tipeAkun) where.tipeAkun = tipeAkun;

    const latest = await prisma.bukuBesarTransaksi.groupBy({
      by: ["tipeAkun", "namaAkun"],
      _max: { createdAt: true },
      where,
    });

    const saldoMap = {};
    for (const g of latest) {
      const row = await prisma.bukuBesarTransaksi.findFirst({
        where: {
          tipeAkun: g.tipeAkun,
          namaAkun: g.namaAkun,
          createdAt: g._max.createdAt,
        },
        orderBy: { id: "desc" },
      });
      if (row) {
        saldoMap[`${g.tipeAkun}_${g.namaAkun}`] = {
          tipeAkun: g.tipeAkun,
          namaAkun: g.namaAkun,
          saldo: row.saldoBerjalan,
          updatedAt: row.createdAt,
        };
      }
    }
    res.json({ saldo: Object.values(saldoMap) });
  } catch (e) {
    console.error("GET /gl-bank/saldo error:", e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * Helper: create transaksi buku besar dari PO / Pembayaran supplier.
 * Digunakan purchasing.routes.js saat pembayaran menjadi PAID.
 */
async function createTransaksiBukuBesar({
  tanggal,
  tipeAkun,
  namaAkun,
  jenis,
  nominal,
  noReferensi,
  pihak,
  keterangan,
  keteranganVolume,
  keteranganHarga,
  poId,
  pengajuanId,
  pembayaranId,
  createdById,
}) {
  if (!tipeAkun || !namaAkun || !jenis || nominal === undefined || nominal === null) {
    throw new Error("Field tipeAkun, namaAkun, jenis, nominal wajib diisi");
  }
  const n = Number(nominal);
  if (Number.isNaN(n) || n < 0) {
    throw new Error("nominal harus angka >= 0");
  }
  const created = await prisma.bukuBesarTransaksi.create({
    data: {
      tanggal: tanggal ? new Date(tanggal) : new Date(),
      tipeAkun,
      namaAkun: namaAkun.trim(),
      jenis,
      nominal: n,
      noReferensi: noReferensi || null,
      pihak: pihak || null,
      keterangan: keterangan || null,
      keteranganVolume: keteranganVolume || null,
      keteranganHarga: keteranganHarga || null,
      poId: poId || null,
      pengajuanId: pengajuanId || null,
      pembayaranId: pembayaranId || null,
      createdById: createdById || null,
      saldoBerjalan: 0,
    },
  });
  await recalcSaldo(tipeAkun, namaAkun);
  return prisma.bukuBesarTransaksi.findUnique({ where: { id: created.id } });
}

/**
 * Helper: hitung ulang saldoBerjalan untuk satu pasangan (tipeAkun, namaAkun)
 * setelah ada insert/update/delete.
 */
async function recalcSaldo(tipeAkun, namaAkun) {
  const rows = await prisma.bukuBesarTransaksi.findMany({
    where: { tipeAkun, namaAkun },
    orderBy: [{ tanggal: "asc" }, { createdAt: "asc" }],
    select: { id: true, jenis: true, nominal: true },
  });
  let saldo = 0;
  for (const r of rows) {
    saldo += r.jenis === "MASUK" ? Number(r.nominal) : -Number(r.nominal);
    await prisma.bukuBesarTransaksi.update({
      where: { id: r.id },
      data: { saldoBerjalan: saldo },
    });
  }
  return saldo;
}

/**
 * POST /api/gl-bank/transaksi
 * Body: { tanggal, tipeAkun, namaAkun, jenis, nominal, noReferensi?, pihak?, keterangan? }
 */
router.post("/transaksi", verifyToken, async (req, res) => {
  try {
    const { tanggal, tipeAkun, namaAkun, jenis, nominal, noReferensi, pihak, keterangan, keteranganVolume, keteranganHarga, poId, pengajuanId, pembayaranId } = req.body;
    if (!tanggal || !tipeAkun || !namaAkun || !jenis || nominal === undefined || nominal === null) {
      return res.status(400).json({ error: "Field tanggal, tipeAkun, namaAkun, jenis, nominal wajib diisi." });
    }
    if (!["KAS", "BANK"].includes(tipeAkun)) {
      return res.status(400).json({ error: "tipeAkun harus KAS atau BANK." });
    }
    if (!["MASUK", "KELUAR"].includes(jenis)) {
      return res.status(400).json({ error: "jenis harus MASUK atau KELUAR." });
    }
    const n = Number(nominal);
    if (Number.isNaN(n) || n < 0) {
      return res.status(400).json({ error: "nominal harus angka >= 0." });
    }

    const newRow = await prisma.bukuBesarTransaksi.create({
      data: {
        tanggal: new Date(tanggal),
        tipeAkun,
        namaAkun: namaAkun.trim(),
        jenis,
        nominal: n,
        noReferensi: noReferensi || null,
        pihak: pihak || null,
        keterangan: keterangan || null,
        keteranganVolume: keteranganVolume || null,
        keteranganHarga: keteranganHarga || null,
        poId: poId || null,
        pengajuanId: pengajuanId || null,
        pembayaranId: pembayaranId || null,
        createdById: req.user?.id || null,
        saldoBerjalan: 0, // akan dihitung ulang
      },
    });

    await recalcSaldo(tipeAkun, namaAkun);
    const finalRow = await prisma.bukuBesarTransaksi.findUnique({
      where: { id: newRow.id },
      include: {
        createdBy: { select: { id: true, name: true } },
      },
    });
    res.json(finalRow);
  } catch (e) {
    console.error("POST /gl-bank/transaksi error:", e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * PUT /api/gl-bank/transaksi/:id
 */
router.put("/transaksi/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.bukuBesarTransaksi.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Transaksi tidak ditemukan." });

    const { tanggal, tipeAkun, namaAkun, jenis, nominal, noReferensi, pihak, keterangan, keteranganVolume, keteranganHarga, poId, pengajuanId, pembayaranId } = req.body;
    const newTipe = tipeAkun || existing.tipeAkun;
    const newNama = (namaAkun || existing.namaAkun).trim();
    const newJenis = jenis || existing.jenis;
    const newNominal = nominal !== undefined && nominal !== null ? Number(nominal) : existing.nominal;

    if (!["KAS", "BANK"].includes(newTipe)) {
      return res.status(400).json({ error: "tipeAkun harus KAS atau BANK." });
    }
    if (!["MASUK", "KELUAR"].includes(newJenis)) {
      return res.status(400).json({ error: "jenis harus MASUK atau KELUAR." });
    }
    if (Number.isNaN(newNominal) || newNominal < 0) {
      return res.status(400).json({ error: "nominal harus angka >= 0." });
    }

    await prisma.bukuBesarTransaksi.update({
      where: { id },
      data: {
        tanggal: tanggal ? new Date(tanggal) : existing.tanggal,
        tipeAkun: newTipe,
        namaAkun: newNama,
        jenis: newJenis,
        nominal: newNominal,
        noReferensi: noReferensi !== undefined ? (noReferensi || null) : existing.noReferensi,
        pihak: pihak !== undefined ? (pihak || null) : existing.pihak,
        keterangan: keterangan !== undefined ? (keterangan || null) : existing.keterangan,
        keteranganVolume: keteranganVolume !== undefined ? (keteranganVolume || null) : existing.keteranganVolume,
        keteranganHarga: keteranganHarga !== undefined ? (keteranganHarga || null) : existing.keteranganHarga,
        poId: poId !== undefined ? (poId || null) : existing.poId,
        pengajuanId: pengajuanId !== undefined ? (pengajuanId || null) : existing.pengajuanId,
        pembayaranId: pembayaranId !== undefined ? (pembayaranId || null) : existing.pembayaranId,
      },
    });

    // Recalc old + new account if changed
    await recalcSaldo(existing.tipeAkun, existing.namaAkun);
    if (newTipe !== existing.tipeAkun || newNama !== existing.namaAkun) {
      await recalcSaldo(newTipe, newNama);
    }

    const finalRow = await prisma.bukuBesarTransaksi.findUnique({
      where: { id },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    res.json(finalRow);
  } catch (e) {
    console.error("PUT /gl-bank/transaksi/:id error:", e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * DELETE /api/gl-bank/transaksi/:id
 */
router.delete("/transaksi/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.bukuBesarTransaksi.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Transaksi tidak ditemukan." });

    await prisma.bukuBesarTransaksi.delete({ where: { id } });
    await recalcSaldo(existing.tipeAkun, existing.namaAkun);
    res.json({ message: "Transaksi dihapus." });
  } catch (e) {
    console.error("DELETE /gl-bank/transaksi/:id error:", e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
module.exports.createTransaksiBukuBesar = createTransaksiBukuBesar;
