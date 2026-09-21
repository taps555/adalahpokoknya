const express = require("express");
const router = express.Router();
const prisma = require("../../lib/prisma"); // Sesuaikan path menuju file prisma Anda
const { verifyToken, authorizeRoles } = require("../../middleware/auth"); // Sesuaikan path middleware auth Anda
const { getKeteranganVolumeHarga } = require("../../lib/keteranganVolumeHarga.js");

/**
 * Hitung ulang status penerimaan satu MaterialRequestItem dari total receivedVolume
 * semua PurchaseOrderItem miliknya. Dipakai endpoint /receive.
 */
async function syncStatusPenerimaan(materialRequestId) {
  if (!materialRequestId) return;
  try {
    const mrItem = await prisma.materialRequestItem.findUnique({
      where: { id: materialRequestId },
      include: { poItems: true },
    });
    if (!mrItem) return;

    const totalDiterima = (mrItem.poItems || []).reduce(
      (s, p) => s + Number(p.receivedVolume || 0),
      0,
    );
    const status =
      totalDiterima >= Number(mrItem.estimatedVolume)
        ? "COMPLETED"
        : totalDiterima > 0
          ? "PARTIAL"
          : "PENDING";

    await prisma.materialRequestItem.update({
      where: { id: materialRequestId },
      data: {
        orderedVolume: totalDiterima,
        status,
        isCompleted: status === "COMPLETED",
      },
    });
  } catch (e) {
    console.error("syncStatusPenerimaan gagal:", e.message);
  }
}

// =====================================================================
// FASE 1: PERMINTAAN PEMBELIAN (DARI RAB)
// =====================================================================

/**
 * GET /api/finance/material-requests
 * Mengambil semua daftar permintaan barang untuk Dasbor Finance
 */
router.get("/material-requests", async (req, res) => {
  try {
    const requests = await prisma.materialRequest.findMany({
      include: {
        project: { select: { name: true, location: true } },
        items: {
          orderBy: { id: "asc" },
          include: {
            poItems: {
              include: {
                purchaseOrder: { include: { supplier: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const transformedRequests = requests.map((request) => {
      let splitItems = [];

      request.items.forEach((item) => {
        let totalPoQty = 0;
        let totalReceivedQty = 0; // Total barang yg udah sampai dari semua toko

        // SKENARIO 1: BARANG SUDAH DI-PO (MUNCUL PER TOKO)
        if (item.poItems && item.poItems.length > 0) {
          item.poItems.forEach((poItem) => {
            const qtyDiToko = poItem.qty || 0;
            totalPoQty += qtyDiToko;
            totalReceivedQty += poItem.receivedVolume || 0;

            splitItems.push({
              ...item,
              id: `${item.id}_${poItem.id}`, // ID unik untuk UI (React/Vue key)
              mrItemId: item.id,
              poItemId: poItem.id, // 👇 ID ini yang dipake Lapangan buat update

              estimatedVolume: qtyDiToko, // Di UI baris ini, targetnya adalah qty PO
              orderedVolume: qtyDiToko,

              // 👇 AMBIL DATA REAL DARI SURAT JALAN / PO INI
              tanggalOnsite: poItem.tanggalOnsite,
              receivedVolume: poItem.receivedVolume,
              catatanRusak: poItem.catatanRusak,
              updateLapangan: poItem.updateLapangan,

              procurementStatus:
                poItem.receivedVolume >= qtyDiToko
                  ? "COMPLETED"
                  : poItem.receivedVolume > 0
                    ? "PARTIAL"
                    : "PENDING",
              supplierName:
                poItem.purchaseOrder?.supplier?.name || "Toko Tidak Diketahui",
              poNumber: poItem.purchaseOrder?.poNumber || "Draft PO",
            });
          });
        }

        // SKENARIO 2: SISA BARANG YANG BELUM DIBELI FINANCE
        const belumDipesan = item.estimatedVolume - totalPoQty;

        if (belumDipesan > 0) {
          splitItems.push({
            ...item,
            id: `${item.id}_sisa`,
            mrItemId: item.id,
            poItemId: null, // Baris sisa ga punya PO, ga bisa diupdate lapangan
            estimatedVolume: belumDipesan,
            orderedVolume: 0,

            // 👇 OVERRIDE AGAR BARIS SISA SELALU BERSIH (FIX BUG GAMBAR 3)
            tanggalOnsite: null,
            receivedVolume: 0,
            catatanRusak: null,
            updateLapangan: null,

            procurementStatus: "PENDING",
            supplierName: "⏳ Belum di-PO",
            poNumber: "-",
          });
        }
      });

      return { ...request, items: splitItems };
    });

    res.json(transformedRequests);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Gagal mengambil data." });
  }
});

router.get("/projects/:projectId/material-requests", async (req, res) => {
  try {
    const { projectId } = req.params;

    const requests = await prisma.materialRequest.findMany({
      where: { projectId: projectId },
      include: {
        project: { select: { name: true, location: true } },
        items: {
          orderBy: { id: "asc" },
          include: {
            poItems: {
              include: { purchaseOrder: { include: { supplier: true } } },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const transformedRequests = requests.map((request) => {
      let splitItems = [];

      request.items.forEach((item) => {
        // 1. Hitung total qty PO & total qty FISIK DITERIMA
        let totalPoQty = 0;
        let totalReceivedQty = 0; // 🔥 KITA TAMBAHKAN INI
        if (item.poItems && item.poItems.length > 0) {
          totalPoQty = item.poItems.reduce((sum, po) => sum + (po.qty || 0), 0);
          totalReceivedQty = item.poItems.reduce(
            (sum, po) => sum + (po.receivedVolume || 0),
            0,
          ); // 🔥 KITA HITUNG BARANG BAGUSNYA
        }

        // 2. Tentukan status Finance Global (Logika Baru)
        let financeStatus = "PENDING";
        if (item.isCompleted) {
          financeStatus = "COMPLETED"; // Paksa selesai (Tutup Pembelian)
        } else if (
          totalPoQty > 0 &&
          Number(totalReceivedQty.toFixed(4)) >=
            Number(item.estimatedVolume.toFixed(4))
        ) {
          // 🔥 HANYA COMPLETED JIKA BARANG FISIK BAGUS SUDAH 100%
          financeStatus = "COMPLETED";
        } else if (totalPoQty > 0) {
          financeStatus = "PARTIAL"; // Ada PO, tapi fisik kurang/rusak
        }

        // ... (KODE KE BAWAHNYA TETAP SAMA SEPERTI SEBELUMNYA)

        // SKENARIO 1: BARANG YANG SUDAH DI-PO
        if (item.poItems && item.poItems.length > 0) {
          item.poItems.forEach((poItem) => {
            const qtyDiToko = poItem.qty || 0;
            splitItems.push({
              ...item,
              id: `${item.id}_${poItem.id}`,
              mrItemId: item.id,
              poItemId: poItem.id,
              estimatedVolume: qtyDiToko,
              orderedVolume: qtyDiToko,
              tanggalOnsite: poItem.tanggalOnsite,
              receivedVolume: poItem.receivedVolume,
              catatanRusak: poItem.catatanRusak,
              updateLapangan: poItem.updateLapangan,

              procurementStatus: financeStatus,
              isForceClosed: item.isCompleted, // 👈 Bawa status ini ke Frontend
              supplierName:
                poItem.purchaseOrder?.supplier?.name || "Toko Tidak Diketahui",
              poNumber: poItem.purchaseOrder?.poNumber || "Draft PO",
            });
          });
        }

        // SKENARIO 2: SISA BARANG
        let belumDipesan = item.estimatedVolume - totalPoQty;
        belumDipesan = Number(belumDipesan.toFixed(4));

        // 🔥 2. HILANGKAN BARIS SISA JIKA SUDAH DI-FORCE CLOSE
        if (belumDipesan > 0 && !item.isCompleted) {
          splitItems.push({
            ...item,
            id: `${item.id}_sisa`,
            mrItemId: item.id,
            poItemId: null,
            estimatedVolume: belumDipesan,
            orderedVolume: 0,
            tanggalOnsite: null,
            receivedVolume: 0,
            catatanRusak: null,
            updateLapangan: null,
            procurementStatus: financeStatus,
            isForceClosed: item.isCompleted,
            supplierName: "⏳ Belum di-PO",
            poNumber: "-",
          });
        }
      });

      return { ...request, items: splitItems };
    });

    res.json(transformedRequests);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Gagal mengambil data." });
  }
});

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

router.put("/material-requests/items/:id/receive", async (req, res) => {
  try {
    const { id } = req.params;
    const { receivedVolume, catatanRusak } = req.body;

    // FIX: kolom "lapangan" (receivedVolume, catatanRusak) hidup di PurchaseOrderItem.
    // Dulu endpoint ini selalu menulis ke MaterialRequestItem yang tidak punya kolom itu,
    // jadi setiap penerimaan barang PASTI 500. Sekarang menerima dua-duanya:
    // kirim poItemId (dari GET /finance/projects/:id/material-requests) atau mrItemId.
    const rvAwal = Number(receivedVolume);

    const poItem = await prisma.purchaseOrderItem.findUnique({ where: { id } });
    if (poItem) {
      const target = Number(poItem.qty) || 0;
      const rv = isNaN(rvAwal) ? 0 : rvAwal;
      const updated = await prisma.purchaseOrderItem.update({
        where: { id },
        data: {
          receivedVolume: rv,
          catatanRusak: catatanRusak ?? poItem.catatanRusak,
        },
      });
      await syncStatusPenerimaan(poItem.materialRequestId);
      return res.json({
        message: "Data penerimaan disimpan",
        data: updated,
        status:
          rv >= target ? "COMPLETED" : rv > 0 ? "PARTIAL" : "PENDING",
      });
    }

    // Fallback: dipanggil dengan MaterialRequestItem.id
    const mrItem = await prisma.materialRequestItem.findUnique({
      where: { id },
    });
    if (!mrItem) return res.status(404).json({ error: "Item tidak ditemukan" });

    // tanpa kolom receivedVolume di MR item, status dihitung dari orderedVolume
    const rv = isNaN(rvAwal) ? 0 : rvAwal;
    const newStatus =
      rv >= mrItem.estimatedVolume
        ? "COMPLETED"
        : rv > 0
          ? "PARTIAL"
          : "PENDING";

    const updated = await prisma.materialRequestItem.update({
      where: { id },
      data: {
        orderedVolume: rv,
        status: newStatus,
        isCompleted: newStatus === "COMPLETED",
      },
    });
    res.json({ message: "Data penerimaan disimpan", data: updated });
  } catch (error) {
    console.error("Update Receive Error:", error);
    res.status(500).json({ error: "Gagal update penerimaan barang" });
  }
});

// =====================================================================
// FASE 2: MODUL PURCHASE ORDER (PO) & MASTER SUPPLIER
// =====================================================================

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
      kategoriPO,
      sumberPo,
      alasanHabisPakai,
      permintaanHabisPakaiId,
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

    // Kumpulkan warning kalau ada item yang melebihi estimasi
    const qtyWarnings = [];
    for (const item of items) {
      if (!item.materialRequestId) continue;
      const mrItem = await prisma.materialRequestItem.findUnique({
        where: { id: item.materialRequestId },
      });
      if (!mrItem) continue;
      const sisa = mrItem.estimatedVolume - (mrItem.receivedVolume || 0);
      if (Number(item.qty) > sisa) {
        qtyWarnings.push(`"${mrItem.itemName}" melebihi sisa kebutuhan (${Number(item.qty).toFixed(2)} > ${sisa.toFixed(2)})`);
      }
    }

    const newPO = await prisma.$transaction(async (tx) => {
      // 0. Sanitasi materialRequestId — filter ID yang tidak valid
      const validMrIds = new Set();
      for (const item of items) {
        let mrId = item.materialRequestId;
        if (!mrId || mrId === "" || mrId === "null" || mrId === "undefined" || String(mrId).startsWith("php_")) {
          item.materialRequestId = null;
          continue;
        }
        // Cek apakah ID benar-benar ada di database
        const exists = await tx.materialRequestItem.findUnique({ where: { id: mrId }, select: { id: true } });
        if (!exists) {
          item.materialRequestId = null; // ID tidak valid, set null
        } else {
          validMrIds.add(mrId);
        }
      }

      // Hitung ulang subTotal & grandTotal dari items jika tidak valid
      const calculatedSubTotal = items.reduce((sum, item) => sum + Number(item.total || 0), 0);
      const finalSubTotal = Number(subTotal || 0) > 0 ? Number(subTotal || 0) : calculatedSubTotal;
      const finalGrandTotal = Number(grandTotal || 0) > 0 ? Number(grandTotal || 0) : finalSubTotal;

      // 1. create dulu tanpa poNumber, biar seq auto-increment kegenerate
      const created = await tx.purchaseOrder.create({
        data: {
          supplierId,
          projectId,
          kategori,
          kategoriPO: kategoriPO || "MATERIAL",
          sumberPo: sumberPo || null,
          alasanHabisPakai: alasanHabisPakai || null,
          tanggal: new Date(tanggal),
          deliveryDate: deliveryDate ? new Date(deliveryDate) : null,
          perusahaan,
          penerimaBarang,
          caraPembayaran,
          jadwalPenagihan,
          keterangan,
          subTotal: finalSubTotal,
          globalDiscount: Number(globalDiscount || 0),
          taxNominal: Number(taxNominal || 0),
          grandTotal: finalGrandTotal,
          items: {
            create: items.map((item) => {
              // 🔥 JURUS PENCUCIAN ID:
              // Kalau ID dari frontend kosong, string kosong, "null", "undefined",
              // atau berupa prefix "php_" (ID buatan frontend untuk habis pakai), paksa jadi null!
              let mrId = item.materialRequestId;
              if (
                !mrId ||
                mrId === "" ||
                mrId === "null" ||
                mrId === "undefined" ||
                String(mrId).startsWith("php_")
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
                disc2Percent: Number(item.disc2Percent || 0),
                disc2Nominal: Number(item.disc2Nominal || 0),
                kategoriItem: item.kategoriItem || null,
                total: Number(item.total || 0),
              };
            }),
          },
        },
        include: { items: true },
      });

      // 2. generate poNumber sesuai kategori PO
      const now = created.tanggal;
      const urutan = String(created.seq).padStart(3, "0");
      const poNumber =
        created.kategoriPO === "HABIS_PAKAI"
          ? `PHB-${urutan}`
          : `PO/GLD/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}/${urutan}`;

      const po = await tx.purchaseOrder.update({
        where: { id: created.id },
        data: { poNumber },
        include: { items: true },
      });

      // 2. SIHIR OTOMATIS: Update Volume & Status di RAB — DINONAKTIFKAN
      //    PO melebihi est volume hanya warning, tidak boleh mengubah RAB.
      //    Penerimaan barang (receive) tetap update orderedVolume/receivedVolume.
      //
      // for (const item of items) {
      //   if (!item.materialRequestId) continue;
      //   const mrItem = await tx.materialRequestItem.findUnique({
      //     where: { id: item.materialRequestId },
      //   });
      //   if (mrItem) {
      //     const newOrderedVolume =
      //       (mrItem.orderedVolume || 0) + Number(item.qty);
      //     await tx.materialRequestItem.update({
      //       where: { id: item.materialRequestId },
      //       data: { orderedVolume: newOrderedVolume },
      //     });
      //   }
      // }

      // 3. Tautkan PO HABIS_PAKAI ke permintaan lapangan (kalau ada)
      if (permintaanHabisPakaiId && (kategoriPO || "MATERIAL") === "HABIS_PAKAI") {
        await tx.permintaanHabisPakai.update({
          where: { id: permintaanHabisPakaiId },
          data: { poHabisPakaiId: po.id, status: "PO_DIBUAT" },
        });
      }

      return po;
    });

    res.json({
      message: "Berhasil! Surat PO tercipta dan status RAB terupdate otomatis.",
      data: newPO,
      warnings: qtyWarnings.length ? qtyWarnings : undefined,
    });
  } catch (error) {
    console.error("Create PO Error:", error);
    if (error.code === "P2002") {
      return res.status(409).json({ error: "Nomor PO sudah dipakai" });
    }
    if (error.code === "P2003") {
      // Foreign key constraint violation
      return res.status(400).json({ error: "Referensi data tidak valid (foreign key). Periksa supplier, project, atau material request ID." });
    }
    res.status(500).json({ error: "Gagal membuat surat PO: " + error.message });
  }
});

router.get("/po", verifyToken, async (req, res) => {
  try {
    const { projectId, status, kategoriPO } = req.query;
    const where = {};
    if (projectId) where.projectId = projectId;
    if (status) where.status = { in: String(status).split(",") };
    if (kategoriPO) where.kategoriPO = kategoriPO;

    const pos = await prisma.purchaseOrder.findMany({
      where,
      include: {
        supplier: true,
        project: { select: { id: true, name: true } },
        verifiedBy: { select: { id: true, name: true, role: true } },
        approvedBy: { select: { id: true, name: true, role: true } },
        permintaanHabisPakai: { select: { id: true, poId: true } },
        items: {
          orderBy: { id: "asc" },
          include: {
            materialRequest: {
              select: { groupName: true, jobName: true, estimatedVolume: true, pricePerUnit: true },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Enrich setiap PO dengan keterangan over/under volume & harga
    const enrichedPos = await Promise.all(
      pos.map(async (po) => {
        const ket = await getKeteranganVolumeHarga(po).catch((e) => {
          console.error("getKeteranganVolumeHarga error:", e);
          return { ketVolume: "-", ketHarga: "-" };
        });
        return { ...po, keteranganVolume: ket.ketVolume, keteranganHarga: ket.ketHarga };
      })
    );
    res.json(enrichedPos);
  } catch (error) {
    console.error("Get PO Error:", error);
    res.status(500).json({ error: "Gagal mengambil data PO" });
  }
});

/**
 * GET /api/finance/po-plan?projectId=xxx
 * Nyiapin draft PO dari data RAB: item MR yang belum terpenuhi dikelompokkan
 * PER SUPPLIER (lewat AhspItemMapping -> SupplierItem -> Supplier).
 * Hasilnya langsung bisa dipakai buat bikin PO per supplier.
 */
router.get("/po-plan", verifyToken, async (req, res) => {
  try {
    const { projectId } = req.query;
    if (!projectId) {
      return res.status(400).json({ error: "projectId wajib diisi" });
    }

    const mrItems = await prisma.materialRequestItem.findMany({
      where: {
        header: { projectId },
        isCompleted: false,
      },
      include: { header: { select: { projectId: true } } },
      orderBy: { itemName: "asc" },
    });

    const mappings = await prisma.ahspItemMapping.findMany({
      include: {
        supplierItem: {
          include: { supplier: { select: { id: true, name: true } } },
        },
      },
    });
    const mapByItemName = new Map(mappings.map((m) => [m.itemName, m]));

    const groups = new Map(); // supplierId -> group
    const belumAdaSupplier = [];

    for (const it of mrItems) {
      const sisa = Math.max(
        0,
        (it.estimatedVolume || 0) - (it.orderedVolume || 0),
      );
      if (sisa <= 0) continue;

      const row = {
        mrItemId: it.id,
        itemName: it.itemName,
        unit: it.unit,
        groupName: it.groupName,
        jobName: it.jobName,
        estimatedVolume: it.estimatedVolume,
        orderedVolume: it.orderedVolume || 0,
        sisa,
        pricePerUnit: it.pricePerUnit,
        estimasiTotal: sisa * (it.pricePerUnit || 0),
      };

      const mapping = mapByItemName.get(it.itemName);
      const supplier = mapping?.supplierItem?.supplier;
      if (!supplier) {
        belumAdaSupplier.push(row);
        continue;
      }

      if (!groups.has(supplier.id)) {
        groups.set(supplier.id, {
          supplierId: supplier.id,
          supplierName: supplier.name,
          items: [],
          subTotal: 0,
        });
      }
      const g = groups.get(supplier.id);
      const harga = Number(mapping.supplierItem.currentPrice || 0) || row.pricePerUnit || 0;
      const total = sisa * harga;
      g.items.push({
        ...row,
        supplierItemId: mapping.supplierItemId,
        variantName: mapping.supplierItem?.variantName || null,
        hargaSupplier: harga,
        estimasiTotal: total,
      });
      g.subTotal += total;
    }

    const result = [...groups.values()].sort((a, b) =>
      a.supplierName.localeCompare(b.supplierName),
    );

    res.json({
      projectId,
      totalItemBelumTerpenuhi: mrItems.length,
      jmlSupplier: result.length,
      suppliers: result,
      belumAdaSupplier,
    });
  } catch (error) {
    console.error("Get PO Plan Error:", error);
    res.status(500).json({ error: "Gagal menyusun rencana PO" });
  }
});

/**
 * GET /api/finance/po/inbox-atasan?projectId=xxx
 * Daftar PO yang sudah di-ACC finance dan nunggu persetujuan atasan (PM).
 */
router.get("/po/inbox-atasan", verifyToken, async (req, res) => {
  try {
    const { projectId } = req.query;
    const where = { status: "MENUNGGU_ATASAN" };
    if (projectId) where.projectId = projectId;

    const pos = await prisma.purchaseOrder.findMany({
      where,
      include: {
        supplier: true,
        project: { select: { id: true, name: true } },
        verifiedBy: { select: { id: true, name: true, role: true } },
        items: { orderBy: { id: "asc" } },
      },
      orderBy: { verifiedAt: "asc" },
    });
    res.json(pos);
  } catch (error) {
    console.error("Get Inbox Atasan Error:", error);
    res.status(500).json({ error: "Gagal mengambil inbox approval atasan" });
  }
});

/**
 * GET /api/finance/po/inbox-finance?projectId=xxx
 * Daftar PO baru yang nunggu verifikasi Finance (tingkat 1).
 */
router.get("/po/inbox-finance", verifyToken, async (req, res) => {
  try {
    const { projectId } = req.query;
    const where = { status: "BELUM_APPROVE" };
    if (projectId) where.projectId = projectId;

    const pos = await prisma.purchaseOrder.findMany({
      where,
      include: {
        supplier: true,
        project: { select: { id: true, name: true } },
        items: { orderBy: { id: "asc" } },
      },
      orderBy: { createdAt: "asc" },
    });
    res.json(pos);
  } catch (error) {
    console.error("Get Inbox Finance Error:", error);
    res.status(500).json({ error: "Gagal mengambil inbox verifikasi finance" });
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
        project: { select: { id: true, name: true } },
        verifiedBy: { select: { id: true, name: true, role: true } },
        approvedBy: { select: { id: true, name: true, role: true } },
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
 * PUT /api/finance/po/:id/verify
 * TINGKAT 1 — Finance verifikasi isi & harga PO.
 * BELUM_APPROVE -> MENUNGGU_ATASAN
 */
router.put(
  "/po/:id/verify",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "FINANCE"),
  async (req, res) => {
    try {
      const { catatanFinance } = req.body || {};

      const existing = await prisma.purchaseOrder.findUnique({
        where: { id: req.params.id },
      });
      if (!existing)
        return res.status(404).json({ error: "PO tidak ditemukan" });
      if (existing.status !== "BELUM_APPROVE") {
        return res.status(400).json({
          error: `Hanya PO status BELUM_APPROVE yang bisa diverifikasi finance. Status sekarang: ${existing.status}`,
        });
      }

      const po = await prisma.purchaseOrder.update({
        where: { id: req.params.id },
        data: {
          status: "MENUNGGU_ATASAN",
          verifiedById: req.user?.userId || null,
          verifiedAt: new Date(),
          catatanFinance: catatanFinance ? String(catatanFinance).trim() : null,
        },
        include: { supplier: true, items: true, project: { select: { id: true, name: true } } },
      });

      // Otomatis buat Pengajuan Pembayaran agar atasan bisa approve
      let pengajuan = null;
      try {
        const existingPengajuan = await prisma.pengajuanPembayaran.findFirst({
          where: { poId: req.params.id, status: { notIn: ["REJECTED", "APPROVED"] } },
        });
        if (!existingPengajuan) {
          const seq = await prisma.pengajuanPembayaran.count({});
          const noPengajuan = `PJB-${String(seq + 1).padStart(5, "0")}`;
          pengajuan = await prisma.pengajuanPembayaran.create({
            data: {
              noPengajuan,
              supplierId: po.supplierId,
              poId: po.id,
              projectId: po.projectId,
              tanggal: new Date(),
              totalTagihan: po.grandTotal || po.subTotal || 0,
              status: "APPROVED_FINANCE",
              catatanFinance: po.catatanFinance,
              verifiedById: req.user?.userId || null,
              verifiedAt: new Date(),
              items: po.items.map((it) => ({
                description: it.description,
                qty: it.qty,
                unit: it.unit,
                unitPrice: it.unitPrice,
                total: it.total,
              })),
            },
          });
        }
      } catch (e) {
        console.error("Gagal membuat Pengajuan Pembayaran otomatis:", e);
      }

      // Update status permintaan habis pakai terkait jika ada
    try {
      const linked = await prisma.permintaanHabisPakai.findFirst({
        where: { poHabisPakaiId: req.params.id },
      });
      if (linked) {
        let nextStatus = "PO_DIBUAT";
        if (po.status === "MENUNGGU_ATASAN") nextStatus = "FINANCE_APPROVED";
        else if (po.status === "APPROVED") nextStatus = "ATASAN_APPROVED";
        else if (po.status === "REJECTED") nextStatus = "REJECTED";
        await prisma.permintaanHabisPakai.update({
          where: { id: linked.id },
          data: { status: nextStatus },
        });
      }
    } catch (e) {
      console.error("Gagal sinkron status permintaan habis pakai:", e);
    }

    res.json({ message: "PO diverifikasi Finance, menunggu persetujuan atasan.", po, pengajuan });
    } catch (error) {
      console.error("Verify PO Error:", error);
      if (error.code === "P2025") {
        return res.status(404).json({ error: "PO tidak ditemukan" });
      }
      res.status(500).json({ error: "Gagal memverifikasi PO" });
    }
  },
);

/**
 * PUT /api/finance/po/:id/approve
 * TINGKAT 2 — Atasan (PROJECT_MANAGER) menyetujui.
 * MENUNGGU_ATASAN -> APPROVED
 * Tetap menerima BELUM_APPROVE untuk kompatibilitas data lama / SUPER_ADMIN.
 */
router.put(
  "/po/:id/approve",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "PROJECT_MANAGER"),
  async (req, res) => {
    try {
      const existing = await prisma.purchaseOrder.findUnique({
        where: { id: req.params.id },
      });
      if (!existing)
        return res.status(404).json({ error: "PO tidak ditemukan" });

      if (existing.status === "APPROVED") {
        return res.status(400).json({ error: "PO ini sudah disetujui." });
      }
      if (existing.status === "REJECTED") {
        return res
          .status(400)
          .json({ error: "PO sudah ditolak, batalkan reject dulu." });
      }

      const po = await prisma.purchaseOrder.update({
        where: { id: req.params.id },
        data: {
          status: "APPROVED",
          approvedAt: new Date(),
          approvedById: req.user?.userId || null,
          rejectReason: null,
          rejectedAt: null,
          rejectedById: null,
        },
        include: { supplier: true },
      });

      // Jika pembayaran cash/transfer, langsung buat Pembayaran Supplier
      let pembayaran = null;
      try {
        const isCash = /cash|transfer/i.test(po.caraPembayaran || "");
        if (isCash) {
          const seq = await prisma.pembayaranSupplier.count({});
          const noPembayaran = `BYR-${String(seq + 1).padStart(5, "0")}`;
          pembayaran = await prisma.pembayaranSupplier.create({
            data: {
              noPembayaran,
              supplierId: po.supplierId,
              poId: po.id,
              tanggal: new Date(),
              jumlahBayar: po.grandTotal || po.subTotal || 0,
              metodeBayar: /cash/i.test(po.caraPembayaran || "") ? "CASH" : "TRANSFER",
              keterangan: `Pembayaran otomatis PO ${po.poNumber || po.id}`,
              status: "PENDING",
            },
          });
        }
      } catch (e) {
        console.error("Gagal membuat Pembayaran Supplier otomatis:", e);
      }

      // Finalkan PengajuanPembayaran yang sudah ada (kalau ada)
      let pengajuan = null;
      try {
        const existingPengajuan = await prisma.pengajuanPembayaran.findFirst({
          where: {
            poId: req.params.id,
            status: { notIn: ["REJECTED", "APPROVED"] },
          },
        });

        if (existingPengajuan) {
          pengajuan = await prisma.pengajuanPembayaran.update({
            where: { id: existingPengajuan.id },
            data: {
              status: "APPROVED",
              approvedById: req.user?.userId || null,
              approvedAt: new Date(),
              verifiedById: po.verifiedById,
              verifiedAt: po.verifiedAt,
              rejectReason: null,
            },
          });
        }
      } catch (e) {
        console.error("Gagal finalkan Pengajuan Pembayaran:", e);
      }

      // Update status permintaan habis pakai terkait jika ada
      try {
        const linked = await prisma.permintaanHabisPakai.findFirst({
          where: { poHabisPakaiId: req.params.id },
        });
        if (linked) {
          let nextStatus = "PO_DIBUAT";
          if (po.status === "MENUNGGU_ATASAN") nextStatus = "FINANCE_APPROVED";
          else if (po.status === "APPROVED") nextStatus = "ATASAN_APPROVED";
          else if (po.status === "REJECTED") nextStatus = "REJECTED";
          await prisma.permintaanHabisPakai.update({
            where: { id: linked.id },
            data: { status: nextStatus },
          });
        }
      } catch (e) {
        console.error("Gagal sinkron status permintaan habis pakai:", e);
      }

      res.json({
        message: "PO berhasil di-Approve!",
        po,
        pengajuan,
        pembayaran,
      });
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
 * PUT /api/finance/po/:id/reject
 * Mengubah status PO menjadi "REJECTED" dengan alasan
 */
router.put(
  "/po/:id/reject",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "FINANCE", "PROJECT_MANAGER"),
  async (req, res) => {
    try {
      const { rejectReason } = req.body;
      if (!rejectReason || String(rejectReason).trim() === "") {
        return res.status(400).json({ error: "Alasan tolak wajib diisi." });
      }

      const existing = await prisma.purchaseOrder.findUnique({
        where: { id: req.params.id },
      });
      if (!existing)
        return res.status(404).json({ error: "PO tidak ditemukan" });
      if (!["BELUM_APPROVE", "MENUNGGU_ATASAN"].includes(existing.status)) {
        return res.status(400).json({
          error: "Hanya PO yang belum final (BELUM_APPROVE / MENUNGGU_ATASAN) yang bisa ditolak.",
        });
      }

      const po = await prisma.purchaseOrder.update({
        where: { id: req.params.id },
        data: {
          status: "REJECTED",
          rejectedAt: new Date(),
          rejectedById: req.user?.userId || null,
          rejectReason: String(rejectReason).trim(),
        },
      });

      // Update status permintaan habis pakai terkait jika ada
      try {
        const linked = await prisma.permintaanHabisPakai.findFirst({
          where: { poHabisPakaiId: req.params.id },
        });
        if (linked) {
          await prisma.permintaanHabisPakai.update({
            where: { id: linked.id },
            data: { status: "REJECTED" },
          });
        }
      } catch (e) {
        console.error("Gagal sinkron status permintaan habis pakai:", e);
      }

      res.json({ message: "PO berhasil ditolak.", po });
    } catch (error) {
      console.error("Reject PO Error:", error);
      res.status(500).json({ error: "Gagal menolak PO." });
    }
  },
);

/**
 * PUT /api/finance/po/:id/cancel-reject
 * Membatalkan penolakan, status kembali ke BELUM_APPROVE
 */
router.put(
  "/po/:id/cancel-reject",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "FINANCE", "PROJECT_MANAGER"),
  async (req, res) => {
    try {
      const existing = await prisma.purchaseOrder.findUnique({
        where: { id: req.params.id },
      });
      if (!existing)
        return res.status(404).json({ error: "PO tidak ditemukan" });
      if (existing.status !== "REJECTED") {
        return res
          .status(400)
          .json({ error: "Hanya PO REJECTED yang bisa cancel reject." });
      }

      const po = await prisma.purchaseOrder.update({
        where: { id: req.params.id },
        data: {
          status: "BELUM_APPROVE",
          rejectedAt: null,
          rejectedById: null,
          rejectReason: null,
        },
      });
      res.json({ message: "Penolakan PO dibatalkan.", po });
    } catch (error) {
      console.error("Cancel Reject PO Error:", error);
      res.status(500).json({ error: "Gagal membatalkan penolakan PO." });
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
        const sisa = mrItem.estimatedVolume - (mrItem.receivedVolume || 0);
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
          // Kalau PO sedang REJECTED dan di-edit, anggap revisi ulang
          status: oldPO.status === "REJECTED" ? "BELUM_APPROVE" : undefined,
          rejectReason: oldPO.status === "REJECTED" ? null : undefined,
          rejectedAt: oldPO.status === "REJECTED" ? null : undefined,
          rejectedById: oldPO.status === "REJECTED" ? null : undefined,
          items: {
            create: items.map((item) => ({
              materialRequestId: item.materialRequestId,
              description: item.description,
              description2: item.description2 || null,
              qty: Number(item.qty),
              unit: item.unit,
              unitPrice: Number(item.unitPrice),
              disc1Percent: Number(item.disc1Percent || 0),
              disc2Percent: Number(item.disc2Percent || 0),
              disc2Nominal: Number(item.disc2Nominal || 0),
              kategoriItem: item.kategoriItem || null,
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

        await tx.materialRequestItem.update({
          where: { id: item.materialRequestId },
          data: { orderedVolume: newOrderedVolume },
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
/**
 * GET /api/finance/ahsp-mapping/suggest?itemName=...
 * Cek apakah item ini sudah pernah di-mapping
 */
router.get("/ahsp-mapping/suggest", async (req, res) => {
  try {
    const raw = req.query.itemName;
    if (!raw) return res.status(400).json({ error: "itemName wajib diisi" });

    const itemName = raw.trim().toLowerCase();
    const mapping = await prisma.ahspItemMapping.findUnique({
      where: { itemName },
      include: { supplierItem: { include: { supplier: true } } },
    });

    res.json(mapping || null);
  } catch (error) {
    console.error("Suggest Mapping Error:", error);
    res.status(500).json({ error: "Gagal mencari mapping" });
  }
});

/**
 * POST /api/finance/ahsp-mapping
 * Simpan/update mapping (upsert by itemName)
 */
router.post("/ahsp-mapping", async (req, res) => {
  try {
    const { itemName: raw, supplierItemId } = req.body;
    if (!raw || !supplierItemId) {
      return res
        .status(400)
        .json({ error: "itemName dan supplierItemId wajib diisi" });
    }
    const itemName = raw.trim().toLowerCase();

    const mapping = await prisma.ahspItemMapping.upsert({
      where: { itemName },
      update: { supplierItemId },
      create: { itemName, supplierItemId },
    });

    res.json(mapping);
  } catch (error) {
    console.error("Save Mapping Error:", error);
    res.status(500).json({ error: "Gagal menyimpan mapping" });
  }
});

/**
 * GET /api/finance/projects/:projectId/price-comparison
 * Bandingkan harga estimasi (RAB) vs harga aktual (supplier) via mapping
 */
router.get("/finance/:projectId/price-comparison", async (req, res) => {
  try {
    const { projectId } = req.params;

    const requests = await prisma.materialRequest.findMany({
      where: { projectId },
      include: { items: true },
    });

    const allItems = requests.flatMap((r) => r.items);

    if (!allItems.length) {
      return res.json([]);
    }

    const results = [];
    for (const item of allItems) {
      const key = item.itemName.trim().toLowerCase();

      const mapping = await prisma.ahspItemMapping.findUnique({
        where: { itemName: key },
        include: { supplierItem: { include: { supplier: true } } },
      });

      const estimasi = item.pricePerUnit;
      const aktual = mapping ? Number(mapping.supplierItem.currentPrice) : null;
      const selisih = aktual !== null ? aktual - estimasi : null;
      const selisihPercent =
        aktual !== null && estimasi
          ? Number(((selisih / estimasi) * 100).toFixed(1))
          : null;

      results.push({
        materialRequestItemId: item.id,
        itemName: item.itemName,
        unit: item.unit,
        estimasi,
        aktual,
        selisih,
        selisihPercent,
        supplierName: mapping?.supplierItem?.supplier?.name ?? null,
        hasMapping: !!mapping,
      });
    }

    res.json(results);
  } catch (error) {
    console.error("Price Comparison Error:", error);
    res.status(500).json({ error: "Gagal membandingkan harga" });
  }
});

module.exports = router;
