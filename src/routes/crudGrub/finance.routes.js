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
      // 1. TARIK DATA DARI DATABASE BESERTA RELASINYA (SAMPAI KE NAMA TOKO)
      const requests = await prisma.materialRequest.findMany({
        include: {
          project: { select: { name: true, location: true } },
          items: {
            orderBy: { id: "asc" },
            include: {
              // Nyedot data PO Item untuk melihat barang ini dibeli di PO mana saja
              poItems: {
                include: {
                  po: {
                    include: {
                      supplier: { select: { name: true } }, // Ambil nama tokonya!
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      // 2. PROSES PEMBELAHAN ITEM (SPLIT BERDASARKAN TOKO)
      const transformedRequests = requests.map((request) => {
        let splitItems = []; // Array baru untuk menampung item yang sudah dipecah

        request.items.forEach((item) => {
          let totalPoQty = 0;

          // SKENARIO A: Barang ini sudah pernah di-PO (Bisa dari 1 toko atau lebih)
          if (item.poItems && item.poItems.length > 0) {
            item.poItems.forEach((poItem) => {
              // Asumsi field jumlah barang di PurchaseOrderItem Anda bernama 'qty'
              const qtyDiToko = poItem.qty || 0;
              totalPoQty += qtyDiToko;

              splitItems.push({
                ...item, // Copy sisa data asli (groupName, jobName, dll)
                id: `${item.id}_${poItem.id}`, // Bikin ID unik
                mrItemId: item.id, // ID asli RAB
                estimatedVolume: qtyDiToko, // VOLUME DIPECAH SESUAI PESANAN TOKO
                // TAMBAHAN DATA UNTUK ORANG LAPANGAN:
                supplierName:
                  poItem.po?.supplier?.name || "Toko Tidak Diketahui",
                poNumber: poItem.po?.poNumber || "Draft PO",
              });
            });
          }

          // SKENARIO B: Hitung sisa volume yang BELUM di-PO
          const sisaVolume = item.estimatedVolume - totalPoQty;

          // Jika masih ada sisa (atau belum di-PO sama sekali), buatkan 1 baris khusus
          if (sisaVolume > 0) {
            splitItems.push({
              ...item,
              id: `${item.id}_sisa`,
              mrItemId: item.id,
              estimatedVolume: sisaVolume, // Sisa volume
              supplierName: "⏳ Belum di-PO",
              poNumber: "-",
            });
          }
        });

        // Kembalikan data request, tapi 'items'-nya pakai yang sudah kita pecah
        return {
          ...request,
          items: splitItems,
        };
      });

      // 3. KIRIM KE FRONTEND
      res.json(transformedRequests);
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
 * POST /api/finance/po
 * Bikin Surat PO Baru (Dan update volume RAB otomatis)
 */
router.post("/po", verifyToken, async (req, res) => {
  try {
    const {
      supplierId,
      projectId,
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
    // poNumber dihapus dari destructure — gak diterima dari frontend lagi

    if (!supplierId || !projectId) {
      return res.status(400).json({ error: "Supplier dan Proyek wajib diisi" });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Minimal 1 item PO harus diisi" });
    }

    const newPO = await prisma.$transaction(async (tx) => {
      for (const item of items) {
        if (!item.materialRequestId) continue;
        const mrItem = await tx.materialRequestItem.findUnique({
          where: { id: item.materialRequestId },
        });
        if (!mrItem) continue;
        const sisa = mrItem.estimatedVolume - (mrItem.orderedVolume || 0);
        if (Number(item.qty) > sisa) {
          throw new Error(
            `Qty untuk "${mrItem.itemName}" melebihi sisa kebutuhan (${sisa})`,
          );
        }
      }
      // 1. create dulu tanpa poNumber, biar seq auto-increment kegenerate
      const created = await tx.purchaseOrder.create({
        data: {
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
            create: items.map((item) => {
              // 🔥 JURUS PENCUCIAN ID:
              // Kalau ID dari frontend kosong, string kosong, "null", atau "undefined", paksa jadi null beneran!
              let mrId = item.materialRequestId;
              if (
                !mrId ||
                mrId === "" ||
                mrId === "null" ||
                mrId === "undefined"
              ) {
                mrId = null;
              }

              return {
                materialRequestId: mrId, // <-- Pakai ID yang sudah dicuci
                description: item.description || "Tanpa Deskripsi",
                description2: item.description2 || null,
                qty: Number(item.qty || 0),
                unit: item.unit || "-",
                unitPrice: Number(item.unitPrice || 0),
                disc1Percent: Number(item.disc1Percent || 0),
                disc2Nominal: Number(item.disc2Nominal || 0),
                total: Number(item.total || 0),
              };
            }),
          },
        },
        include: { items: true },
      });

      // 2. generate poNumber dari seq, format PO/GLD/{bulan}/{tahun}/{urutan}
      const now = created.tanggal;
      const bulan = String(now.getMonth() + 1).padStart(2, "0");
      const tahun = now.getFullYear();
      const urutan = String(created.seq).padStart(3, "0");
      const poNumber = `PO/GLD/${bulan}/${tahun}/${urutan}`;

      const po = await tx.purchaseOrder.update({
        where: { id: created.id },
        data: { poNumber },
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
      message: "Berhasil! Surat PO tercipta dan status RAB terupdate otomatis.",
      data: newPO,
    });
  } catch (error) {
    console.error("Create PO Error:", error);
    if (error.code === "P2002") {
      return res.status(409).json({ error: "Nomor PO sudah dipakai" });
    }
    if (error.message?.includes("melebihi sisa kebutuhan")) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: "Gagal membuat surat PO." });
  }
});

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
          orderBy: { id: "asc" },
          include: {
            materialRequest: {
              select: { groupName: true, jobName: true },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
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
          orderBy: { id: "asc" },
          include: {
            materialRequest: { select: { groupName: true, jobName: true } },
          },
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
router.put(
  "/po/:id/approve",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "OWNER"),
  async (req, res) => {
    try {
      const po = await prisma.purchaseOrder.update({
        where: { id: req.params.id },
        data: {
          status: "APPROVED",
          approvedAt: new Date(),
          approvedById: req.user?.id || null, // sesuaikan sama nama field user dari verifyToken
        },
      });
      res.json({ message: "PO berhasil di-Approve!", po });
    } catch (error) {
      console.error("Approve PO Error:", error);
      if (error.code === "P2025") {
        return res.status(404).json({ error: "PO tidak ditemukan" });
      }
      res.status(500).json({ error: "Gagal menyetujui PO" });
    }
  },
);

/**
 * PUT /api/finance/po/:id
 * Edit PO — bisa banyak item sekaligus, auto rollback+reapply volume RAB
 */
router.put("/po/:id", verifyToken, async (req, res) => {
  try {
    const {
      // poNumber dihapus dari destructure — gak diterima dari body, biar gak ke-overwrite
      supplierId,
      projectId,
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

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Minimal 1 item PO harus diisi" });
    }

    const updatedPO = await prisma.$transaction(async (tx) => {
      const oldPO = await tx.purchaseOrder.findUnique({
        where: { id: req.params.id },
        include: { items: true },
      });
      if (!oldPO) throw new Error("PO tidak ditemukan");

      // 2. ROLLBACK: kurangi volume RAB sesuai item lama
      for (const oldItem of oldPO.items) {
        if (!oldItem.materialRequestId) continue;
        const mrItem = await tx.materialRequestItem.findUnique({
          where: { id: oldItem.materialRequestId },
        });
        if (!mrItem) continue;

        const rolledBack = (mrItem.orderedVolume || 0) - Number(oldItem.qty);
        await tx.materialRequestItem.update({
          where: { id: oldItem.materialRequestId },
          data: { orderedVolume: rolledBack < 0 ? 0 : rolledBack },
        });
      }

      for (const item of items) {
        if (!item.materialRequestId) continue;
        const mrItem = await tx.materialRequestItem.findUnique({
          where: { id: item.materialRequestId },
        });
        if (!mrItem) continue;
        const sisa = mrItem.estimatedVolume - (mrItem.orderedVolume || 0);
        if (Number(item.qty) > sisa) {
          throw new Error(
            `Qty untuk "${mrItem.itemName}" melebihi sisa kebutuhan (${sisa})`,
          );
        }
      }

      // 3. Hapus item lama, ganti item baru (paling aman utk qty item berubah)
      await tx.purchaseOrderItem.deleteMany({
        where: { poId: req.params.id },
      });

      // 4. Update header PO + create item baru
      const po = await tx.purchaseOrder.update({
        where: { id: req.params.id },
        data: {
          supplierId: String(supplierId),
          projectId: String(projectId),
          kategori,
          tanggal: tanggal ? new Date(tanggal) : undefined,
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
              materialRequestId: item.materialRequestId,
              description: item.description,
              description2: item.description2 || null,
              qty: Number(item.qty),
              unit: item.unit,
              unitPrice: Number(item.unitPrice),
              disc1Percent: Number(item.disc1Percent || 0),
              disc2Nominal: Number(item.disc2Nominal || 0),
              total: Number(item.total),
            })),
          },
        },
        include: { items: true },
      });

      // 5. REAPPLY: tambah volume RAB sesuai item baru + recalc status
      for (const item of items) {
        if (!item.materialRequestId) continue;
        const mrItem = await tx.materialRequestItem.findUnique({
          where: { id: item.materialRequestId },
        });
        if (!mrItem) continue;

        const newOrderedVolume = (mrItem.orderedVolume || 0) + Number(item.qty);
        let newStatus = "PENDING";
        let isCompleted = false;
        if (newOrderedVolume >= mrItem.estimatedVolume) {
          newStatus = "COMPLETED";
          isCompleted = true;
        } else if (newOrderedVolume > 0) {
          newStatus = "PARTIAL";
        }

        await tx.materialRequestItem.update({
          where: { id: item.materialRequestId },
          data: {
            orderedVolume: newOrderedVolume,
            status: newStatus,
            isCompleted,
          },
        });
      }

      return po;
    });

    res.json({ message: "PO berhasil diupdate!", data: updatedPO });
  } catch (error) {
    console.error("Update PO Error:", error);
    if (error.message === "PO tidak ditemukan") {
      return res.status(404).json({ error: error.message });
    }
    if (error.code === "P2002") {
      return res.status(409).json({ error: "Nomor PO sudah dipakai" });
    }
    if (error.message?.includes("melebihi sisa kebutuhan")) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: "Gagal update PO." });
  }
});

module.exports = router;
