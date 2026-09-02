const express = require("express");
const router = express.Router();
const prisma = require("../../lib/prisma"); // Sesuaikan path menuju file prisma Anda
const { verifyToken, authorizeRoles } = require("../../middleware/auth"); // Sesuaikan path middleware auth Anda

// =====================================================================
// FASE 1: PERMINTAAN PEMBELIAN (DARI RAB)
// =====================================================================

/**
 * GET /api/finance/material-requests
 * Mengambil semua daftar permintaan barang untuk Dasbor Finance
 */
router.get(
  "/material-requests",
  // verifyToken,
  // authorizeRoles("SUPER_ADMIN", "FINANCE", "PURCHASING", "PROJECT_MANAGER"),
  async (req, res) => {
    try {
      const requests = await prisma.materialRequest.findMany({
        include: {
          project: { select: { name: true, location: true } },
          items: {
            orderBy: { id: "asc" },
          },
        },
        orderBy: { createdAt: "desc" },
      });
      res.json(requests);
    } catch (error) {
      console.error("Get Finance Data Error:", error);
      res
        .status(500)
        .json({ error: "Terjadi kesalahan saat mengambil data Finance." });
    }
  },
);

/**
 * PUT /api/finance/material-requests/items/:id
 * Auto-Save: Mengupdate status PO, volume, dan catatan dari Dasbor Finance
 */
router.put(
  "/material-requests/items/:id",
  // verifyToken, // Tambahkan auth jika diperlukan
  async (req, res) => {
    try {
      const { id } = req.params;
      const { isCompleted, orderedVolume, catatanFinance } = req.body;

      const updatedItem = await prisma.materialRequestItem.update({
        where: { id: id },
        data: {
          isCompleted: isCompleted !== undefined ? isCompleted : undefined,
          orderedVolume:
            orderedVolume !== undefined ? Number(orderedVolume) : undefined,
          catatanFinance:
            catatanFinance !== undefined ? catatanFinance : undefined,
        },
      });

      res.json({ message: "Data berhasil disimpan!", data: updatedItem });
    } catch (error) {
      console.error("Update Item Error:", error);
      res.status(500).json({ error: "Gagal memperbarui data barang." });
    }
  },
);

// =====================================================================
// FASE 2: MODUL PURCHASE ORDER (PO) & MASTER SUPPLIER
// =====================================================================

/**
 * GET /api/finance/suppliers
 * Ambil semua daftar supplier untuk Dropdown di frontend
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
 * POST /api/finance/suppliers
 * Tambah supplier (Toko) baru
 */
router.post("/suppliers", async (req, res) => {
  try {
    const { name, address, phone, contactName } = req.body;
    const newSupplier = await prisma.supplier.create({
      data: { name, address, phone, contactName },
    });
    res.json(newSupplier);
  } catch (error) {
    console.error("Create Supplier Error:", error);
    res.status(500).json({ error: "Gagal menambah supplier baru" });
  }
});

/**
 * POST /api/finance/po
 * Bikin Surat PO Baru (Dan update volume RAB otomatis)
 */
router.post(
  "/po",
  // verifyToken,
  // authorizeRoles("SUPER_ADMIN", "PURCHASING", "FINANCE"),
  async (req, res) => {
    try {
      const {
        supplierId,
        projectId,
        poNumber,
        kategori,
        tanggal,
        deliveryDate,
        perusahaan,
        penerimaBarang,
        caraPembayaran,
        jadwalPenagihan,
        keterangan,
        subTotal,
        globalDiscount,
        taxNominal,
        grandTotal,
        items,
      } = req.body;

      // Gunakan Transaction agar data tersimpan serentak dan aman
      const newPO = await prisma.$transaction(async (tx) => {
        // 1. Buat Dokumen PO beserta isinya
        const po = await tx.purchaseOrder.create({
          data: {
            poNumber,
            supplierId,
            projectId,
            kategori,
            tanggal: new Date(tanggal),
            deliveryDate: deliveryDate ? new Date(deliveryDate) : null,
            perusahaan,
            penerimaBarang,
            caraPembayaran,
            jadwalPenagihan,
            keterangan,
            subTotal: Number(subTotal || 0),
            globalDiscount: Number(globalDiscount || 0),
            taxNominal: Number(taxNominal || 0),
            grandTotal: Number(grandTotal || 0),

            items: {
              create: items.map((item) => ({
                materialRequestId: item.materialRequestId, // Relasi ke barang RAB
                description: item.description,
                description2: item.description2 || null,
                qty: Number(item.qty),
                unit: item.unit,
                unitPrice: Number(item.unitPrice), // Harga Deal (Diskon)
                disc1Percent: Number(item.disc1Percent || 0),
                disc2Nominal: Number(item.disc2Nominal || 0),
                total: Number(item.total),
              })),
            },
          },
          include: { items: true },
        });

        // 2. SIHIR OTOMATIS: Update Volume & Status di RAB
        for (const item of items) {
          if (!item.materialRequestId) continue;

          const mrItem = await tx.materialRequestItem.findUnique({
            where: { id: item.materialRequestId },
          });

          if (mrItem) {
            const newOrderedVolume =
              (mrItem.orderedVolume || 0) + Number(item.qty);

            let newStatus = "PENDING";
            let isCompleted = false;

            // Pengecekan otomatis berdasarkan Enum ProcurementStatus
            if (newOrderedVolume >= mrItem.estimatedVolume) {
              newStatus = "COMPLETED";
              isCompleted = true;
            } else if (newOrderedVolume > 0) {
              newStatus = "PARTIAL";
            }

            // Update ke tabel MaterialRequestItem
            await tx.materialRequestItem.update({
              where: { id: item.materialRequestId },
              data: {
                orderedVolume: newOrderedVolume,
                status: newStatus,
                isCompleted: isCompleted,
              },
            });
          }
        }

        return po;
      });

      res.json({
        message:
          "Berhasil! Surat PO tercipta dan status RAB terupdate otomatis.",
        data: newPO,
      });
    } catch (error) {
      console.error("Create PO Error:", error);
      res.status(500).json({ error: "Gagal membuat surat PO." });
    }
  },
);

/**
 * GET /api/finance/po
 * Mengambil daftar semua Surat PO untuk ditampilkan di tabel Halaman Daftar PO
 */
/**
 * GET /api/finance/po
 * Mengambil daftar semua Surat PO untuk ditampilkan di tabel
 */
router.get("/po", verifyToken, async (req, res) => {
  try {
    const pos = await prisma.purchaseOrder.findMany({
      include: {
        supplier: true,
        items: {
          orderBy: { id: "asc" }, // 🔥 TAMBAHKAN INI: Kunci urutan item PO berdasarkan ID
        },
      },
      orderBy: { createdAt: "desc" }, // PO terbaru tetap di atas
    });
    res.json(pos);
  } catch (error) {
    console.error("Get PO Error:", error);
    res.status(500).json({ error: "Gagal mengambil data PO" });
  }
});

/**
 * GET /api/finance/po/:id
 * Mengambil detail 1 PO secara spesifik untuk halaman Cetak PDF
 */
router.get("/po/:id", verifyToken, async (req, res) => {
  try {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: {
        supplier: true,
        items: {
          orderBy: { id: "asc" }, // 🔥 TAMBAHKAN INI JUGA
        },
      },
    });
    if (!po) return res.status(404).json({ error: "PO tidak ditemukan" });
    res.json(po);
  } catch (error) {
    res.status(500).json({ error: "Gagal mengambil data PO" });
  }
});

/**
 * PUT /api/finance/po/:id/approve
 * Mengubah status PO menjadi "Approved"
 */
router.put("/po/:id/approve", verifyToken, async (req, res) => {
  try {
    const po = await prisma.purchaseOrder.update({
      where: { id: req.params.id },
      data: { status: "Approved" }, // Ubah status di database
    });
    res.json({ message: "PO berhasil di-Approve!", po });
  } catch (error) {
    res.status(500).json({ error: "Gagal menyetujui PO" });
  }
});

module.exports = router;
