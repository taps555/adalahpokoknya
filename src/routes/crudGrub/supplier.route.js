const express = require("express");
const router = express.Router();
const prisma = require("../../lib/prisma"); // Sesuaikan path menuju file prisma Anda
const { verifyToken, authorizeRoles } = require("../../middleware/auth");
const supplierService = require("../../services/supplier");
/**
 * GET /api/finance/suppliers
 * List semua supplier
 */
router.get("/suppliers", async (req, res) => {
  try {
    const suppliers = await prisma.supplier.findMany({
      orderBy: { name: "asc" },
    });
    res.json(suppliers);
  } catch (error) {
    console.error("Get Suppliers Error:", error);
    res.status(500).json({ error: "Gagal mengambil data toko/supplier" });
  }
});
/**
 * GET /api/finance/suppliers/:id
 * Detail satu supplier
 */
router.get("/suppliers/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const supplier = await prisma.supplier.findUnique({ where: { id } });

    if (!supplier) {
      return res.status(404).json({ error: "Supplier tidak ditemukan" });
    }
    res.json(supplier);
  } catch (error) {
    console.error("Get Supplier Detail Error:", error);
    res.status(500).json({ error: "Gagal mengambil detail supplier" });
  }
});

/**
 * ==========================
 * MASTER JASA
 * ==========================
 */
router.get("/jasa", async (req, res) => {
  try {
    const onlyActive = String(req.query.onlyActive || "").toLowerCase() === "true";
    const q = String(req.query.q || "").trim();
    const jasas = await prisma.jasa.findMany({
      where: {
        ...(onlyActive ? { isActive: true } : {}),
        ...(q ? { nama: { contains: q, mode: "insensitive" } } : {}),
      },
      orderBy: { nama: "asc" },
    });
    res.json(jasas);
  } catch (error) {
    console.error("Get Jasa Error:", error);
    res.status(500).json({ error: "Gagal mengambil data jasa" });
  }
});

router.get("/jasa/:id", async (req, res) => {
  try {
    const jasa = await prisma.jasa.findUnique({ where: { id: req.params.id } });
    if (!jasa) return res.status(404).json({ error: "Jasa tidak ditemukan" });
    res.json(jasa);
  } catch (error) {
    console.error("Get Jasa Detail Error:", error);
    res.status(500).json({ error: "Gagal mengambil detail jasa" });
  }
});

router.post("/jasa", verifyToken, async (req, res) => {
  try {
    const {
      nama,
      nilaiKontrak = null,
      bank = null,
      noRekening = null,
      atasNama = null,
      kontakPerson = null,
      isActive = true,
    } = req.body || {};

    if (!nama || !String(nama).trim()) {
      return res.status(400).json({ error: "Nama jasa wajib diisi" });
    }

    const created = await prisma.jasa.create({
      data: {
        nama: String(nama).trim(),
        nilaiKontrak: nilaiKontrak === null || nilaiKontrak === "" ? null : Number(nilaiKontrak),
        bank,
        noRekening,
        atasNama,
        kontakPerson,
        isActive: Boolean(isActive),
      },
    });

    const code = String(created.seq).padStart(5, "0");
    const jasa = await prisma.jasa.update({
      where: { id: created.id },
      data: { code },
    });

    res.json(jasa);
  } catch (error) {
    console.error("Create Jasa Error:", error);
    res.status(500).json({ error: "Gagal menambah jasa" });
  }
});

router.put("/jasa/:id", verifyToken, async (req, res) => {
  try {
    const {
      nama,
      nilaiKontrak,
      bank,
      noRekening,
      atasNama,
      kontakPerson,
      isActive,
    } = req.body || {};

    const jasa = await prisma.jasa.update({
      where: { id: req.params.id },
      data: {
        ...(nama !== undefined ? { nama: String(nama || "").trim() } : {}),
        ...(nilaiKontrak !== undefined
          ? { nilaiKontrak: nilaiKontrak === null || nilaiKontrak === "" ? null : Number(nilaiKontrak) }
          : {}),
        ...(bank !== undefined ? { bank } : {}),
        ...(noRekening !== undefined ? { noRekening } : {}),
        ...(atasNama !== undefined ? { atasNama } : {}),
        ...(kontakPerson !== undefined ? { kontakPerson } : {}),
        ...(isActive !== undefined ? { isActive: Boolean(isActive) } : {}),
      },
    });

    res.json(jasa);
  } catch (error) {
    console.error("Update Jasa Error:", error);
    if (error.code === "P2025") return res.status(404).json({ error: "Jasa tidak ditemukan" });
    res.status(500).json({ error: "Gagal update jasa" });
  }
});

router.delete("/jasa/:id", verifyToken, async (req, res) => {
  try {
    await prisma.jasa.delete({ where: { id: req.params.id } });
    res.json({ message: "Jasa berhasil dihapus" });
  } catch (error) {
    console.error("Delete Jasa Error:", error);
    if (error.code === "P2025") return res.status(404).json({ error: "Jasa tidak ditemukan" });
    if (error.code === "P2003") {
      return res.status(409).json({ error: "Jasa tidak bisa dihapus, masih dipakai di PO/pembayaran" });
    }
    res.status(500).json({ error: "Gagal menghapus jasa" });
  }
});

/**
 * GET /api/jasa/:jasaId/nilai-kontrak
 * Mengambil histori nilai kontrak untuk satu jasa
 */
router.get("/jasa/:jasaId/nilai-kontrak", async (req, res) => {
  try {
    const rows = await prisma.jasaNilaiKontrak.findMany({
      where: { jasaId: req.params.jasaId },
      orderBy: { tanggal: "desc" },
    });
    res.json(rows);
  } catch (error) {
    console.error("Get JasaNilaiKontrak Error:", error);
    res.status(500).json({ error: "Gagal mengambil histori nilai kontrak" });
  }
});

/**
 * POST /api/jasa/:jasaId/nilai-kontrak
 * Tambah entri baru histori nilai kontrak
 */
router.post("/jasa/:jasaId/nilai-kontrak", verifyToken, async (req, res) => {
  try {
    const { nilaiKontrak, keterangan, tanggal } = req.body || {};
    if (!nilaiKontrak || isNaN(Number(nilaiKontrak))) {
      return res.status(400).json({ error: "nilaiKontrak wajib diisi dan harus angka" });
    }
    const created = await prisma.jasaNilaiKontrak.create({
      data: {
        jasaId: req.params.jasaId,
        nilaiKontrak: Number(nilaiKontrak),
        keterangan: keterangan || null,
        tanggal: tanggal ? new Date(tanggal) : new Date(),
      },
    });
    res.json(created);
  } catch (error) {
    console.error("Create JasaNilaiKontrak Error:", error);
    res.status(500).json({ error: "Gagal menambah nilai kontrak" });
  }
});

/**
 * DELETE /api/jasa/nilai-kontrak/:id
 * Hapus entri histori nilai kontrak
 */
router.delete("/jasa/nilai-kontrak/:id", verifyToken, async (req, res) => {
  try {
    await prisma.jasaNilaiKontrak.delete({ where: { id: req.params.id } });
    res.json({ message: "Entri nilai kontrak dihapus" });
  } catch (error) {
    console.error("Delete JasaNilaiKontrak Error:", error);
    if (error.code === "P2025") return res.status(404).json({ error: "Data tidak ditemukan" });
    res.status(500).json({ error: "Gagal menghapus nilai kontrak" });
  }
});

/**
 * GET /api/finance/po
 * Mengambil daftar semua Surat PO untuk ditampilkan di tabel
 */
/**
 * GET /api/finance/po/supplier/:supplierId
 * Mengambil SEMUA PO berdasarkan 1 Supplier untuk Cetak PDF Massal
 */
router.get("/po/supplier/:supplierId", async (req, res) => {
  try {
    const pos = await prisma.purchaseOrder.findMany({
      where: {
        supplierId: req.params.supplierId,
        // status: "APPROVED" // (Opsional) Buka komen ini kalau cuma mau nge-print PO yang udah di-Approve
      },
      include: {
        supplier: true,
        items: {
          orderBy: { id: "asc" },
          include: {
            materialRequest: { select: { groupName: true, jobName: true } },
          },
        },
      },
      orderBy: { tanggal: "asc" }, // Urutkan dari PO tanggal terlama ke terbaru
    });

    if (!pos || pos.length === 0) {
      return res
        .status(404)
        .json({ error: "Tidak ada data PO untuk supplier ini" });
    }

    res.json(pos);
  } catch (error) {
    console.error("Get PO by Supplier Error:", error);
    res.status(500).json({ error: "Gagal mengambil data PO gabungan" });
  }
});

/**
 * POST /api/finance/suppliers
 * Tambah supplier (Toko) baru
 */
router.post("/suppliers", async (req, res) => {
  try {
    const {
      name,
      type,
      address,
      address2,
      phone,
      fax,
      taxGroup,
      npwp,
      email,
      contactName,
      creditLimit,
      bankAccount,
      status,
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Nama supplier wajib diisi" });
    }

    // create dulu tanpa code, biar seq auto-increment kegenerate
    const created = await prisma.supplier.create({
      data: {
        name,
        type,
        address,
        address2,
        phone,
        fax,
        taxGroup,
        npwp,
        email,
        contactName,
        creditLimit,
        bankAccount,
        status,
      },
    });

    const code = String(created.seq).padStart(5, "0");

    const newSupplier = await prisma.supplier.update({
      where: { id: created.id },
      data: { code },
    });

    res.json(newSupplier);
  } catch (error) {
    console.error("Create Supplier Error:", error);
    res.status(500).json({ error: "Gagal menambah supplier baru" });
  }
});

/**
 * PUT /api/finance/suppliers/:id
 * Update supplier
 */
router.put("/suppliers/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      code,
      name,
      type,
      address,
      address2,
      phone,
      fax,
      taxGroup,
      npwp,
      email,
      contactName,
      creditLimit,
      bankAccount,
      status,
    } = req.body;

    const updated = await prisma.supplier.update({
      where: { id },
      data: {
        code,
        name,
        type,
        address,
        address2,
        phone,
        fax,
        taxGroup,
        npwp,
        email,
        contactName,
        creditLimit,
        bankAccount,
        status,
      },
    });
    res.json(updated);
  } catch (error) {
    console.error("Update Supplier Error:", error);
    if (error.code === "P2002") {
      return res.status(409).json({ error: "Kode supplier sudah dipakai" });
    }
    if (error.code === "P2025") {
      return res.status(404).json({ error: "Supplier tidak ditemukan" });
    }
    res.status(500).json({ error: "Gagal update supplier" });
  }
});

/**
 * DELETE /api/finance/suppliers/:id
 * Hapus supplier
 */
router.delete("/suppliers/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.supplier.delete({ where: { id } });
    res.json({ message: "Supplier berhasil dihapus" });
  } catch (error) {
    console.error("Delete Supplier Error:", error);
    if (error.code === "P2025") {
      return res.status(404).json({ error: "Supplier tidak ditemukan" });
    }
    if (error.code === "P2003") {
      return res
        .status(409)
        .json({ error: "Supplier tidak bisa dihapus, masih dipakai di PO" });
    }
    res.status(500).json({ error: "Gagal menghapus supplier" });
  }
});

/**
 * GET /api/finance/supplier-items
 * List semua item supplier, bisa filter by supplierId & search nama
 */
router.get("/supplier-items", async (req, res) => {
  try {
    const { supplierId, search } = req.query;

    const items = await prisma.supplierItem.findMany({
      where: {
        ...(supplierId && { supplierId }),
        ...(search && {
          OR: [
            { itemName: { contains: search, mode: "insensitive" } },
            { variantName: { contains: search, mode: "insensitive" } },
          ],
        }),
      },
      include: { supplier: { select: { id: true, name: true, code: true } } },
      orderBy: { itemName: "asc" },
    });

    res.json(items);
  } catch (error) {
    console.error("Get Supplier Items Error:", error);
    res.status(500).json({ error: "Gagal mengambil data item supplier" });
  }
});

/**
 * GET /api/finance/supplier-items/:id
 * Detail satu item supplier
 */
router.get("/supplier-items/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const item = await prisma.supplierItem.findUnique({
      where: { id },
      include: { supplier: true },
    });

    if (!item) {
      return res.status(404).json({ error: "Item supplier tidak ditemukan" });
    }
    res.json(item);
  } catch (error) {
    console.error("Get Supplier Item Detail Error:", error);
    res.status(500).json({ error: "Gagal mengambil detail item supplier" });
  }
});

/**
 * GET /api/finance/supplier-items/:id/history
 * Riwayat harga satu item supplier
 */
router.get("/supplier-items/:id/history", async (req, res) => {
  try {
    const { id } = req.params;

    const history = await prisma.supplierPriceHistory.findMany({
      where: { supplierItemId: id },
      orderBy: { effectiveDate: "desc" },
    });

    res.json(history);
  } catch (error) {
    console.error("Get Price History Error:", error);
    res.status(500).json({ error: "Gagal mengambil riwayat harga" });
  }
});

/**
 * POST /api/finance/supplier-items
 * Tambah item supplier baru (harga awal langsung tercatat ke histori)
 */
router.post("/supplier-items", async (req, res) => {
  try {
    const { supplierId, itemName, variantName, unit, price, promoPrice, kategori } =
      req.body;

    if (!supplierId || !itemName || !unit || price === undefined) {
      return res.status(400).json({
        error: "supplierId, itemName, unit, dan price wajib diisi",
      });
    }

    const created = await prisma.supplierItem.create({
      data: {
        supplierId,
        itemName,
        variantName: variantName || null,
        unit,
        currentPrice: price,
        currentPromoPrice: promoPrice,
        kategori: kategori || null,
      },
    });

    await prisma.supplierPriceHistory.create({
      data: {
        supplierItemId: created.id,
        price,
        promoPrice,
        effectiveDate: new Date(),
      },
    });

    res.json(created);
  } catch (error) {
    console.error("Create Supplier Item Error:", error);
    if (error.code === "P2003") {
      return res.status(400).json({ error: "Supplier tidak ditemukan" });
    }
    res.status(500).json({ error: "Gagal menambah item supplier" });
  }
});
/**
 * POST /api/finance/supplier-items/bulk
 * Tambah banyak varian item sekaligus (mis: Amplas Klassik 80,100,120,...)
 */
router.post("/supplier-items/bulk", async (req, res) => {
  try {
    const { supplierId, itemName, unit, items } = req.body;
    // items: [{ variantName, price, promoPrice }, ...]

    if (
      !supplierId ||
      !itemName ||
      !unit ||
      !Array.isArray(items) ||
      !items.length
    ) {
      return res.status(400).json({
        error: "supplierId, itemName, unit, dan items (array) wajib diisi",
      });
    }

    const results = [];
    for (const it of items) {
      if (it.price === undefined) continue;

      const created = await prisma.supplierItem.create({
        data: {
          supplierId,
          itemName,
          variantName: it.variantName || null,
          unit,
          currentPrice: it.price,
          currentPromoPrice: it.promoPrice || null,
        },
      });

      await prisma.supplierPriceHistory.create({
        data: {
          supplierItemId: created.id,
          price: it.price,
          promoPrice: it.promoPrice || null,
          effectiveDate: new Date(),
        },
      });

      results.push(created);
    }

    res.json({ created: results.length, items: results });
  } catch (error) {
    console.error("Bulk Create Supplier Item Error:", error);
    if (error.code === "P2003") {
      return res.status(400).json({ error: "Supplier tidak ditemukan" });
    }
    res.status(500).json({ error: "Gagal menambah item supplier (bulk)" });
  }
});
/**
 * PUT /api/finance/supplier-items/:id
 * Update data non-harga (itemName, unit) — harga TIDAK diubah di sini
 */
router.put("/supplier-items/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { itemName, unit } = req.body;

    const updated = await prisma.supplierItem.update({
      where: { id },
      data: { itemName, unit },
    });
    res.json(updated);
  } catch (error) {
    console.error("Update Supplier Item Error:", error);
    if (error.code === "P2025") {
      return res.status(404).json({ error: "Item supplier tidak ditemukan" });
    }
    res.status(500).json({ error: "Gagal update item supplier" });
  }
});

/**
 * PATCH /api/finance/supplier-items/:id/price
 * Update harga — otomatis catat ke histori
 */
router.patch("/supplier-items/:id/price", async (req, res) => {
  try {
    const { id } = req.params;
    const { price, promoPrice, effectiveDate } = req.body;

    if (price === undefined) {
      return res.status(400).json({ error: "Harga wajib diisi" });
    }

    const [, updated] = await prisma.$transaction([
      prisma.supplierPriceHistory.create({
        data: {
          supplierItemId: id,
          price,
          promoPrice,
          effectiveDate: effectiveDate ? new Date(effectiveDate) : new Date(),
        },
      }),
      prisma.supplierItem.update({
        where: { id },
        data: { currentPrice: price, currentPromoPrice: promoPrice },
      }),
    ]);

    res.json(updated);
  } catch (error) {
    console.error("Update Supplier Item Price Error:", error);
    if (error.code === "P2025") {
      return res.status(404).json({ error: "Item supplier tidak ditemukan" });
    }
    res.status(500).json({ error: "Gagal update harga item supplier" });
  }
});

/**
 * DELETE /api/finance/supplier-items/:id
 * Hapus item supplier
 */
router.delete("/supplier-items/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.supplierItem.delete({ where: { id } });
    res.json({ message: "Item supplier berhasil dihapus" });
  } catch (error) {
    console.error("Delete Supplier Item Error:", error);
    if (error.code === "P2025") {
      return res.status(404).json({ error: "Item supplier tidak ditemukan" });
    }
    if (error.code === "P2003") {
      return res.status(409).json({
        error: "Item supplier tidak bisa dihapus, masih dipakai di mapping/PO",
      });
    }
    res.status(500).json({ error: "Gagal menghapus item supplier" });
  }
});

module.exports = router;
