"use strict";

const express = require("express");
const router = express.Router();
const prisma = require("../../lib/prisma");
const { verifyToken, authorizeRoles } = require("../../middleware/auth");
const { buildNoPembayaran } = require("../../lib/paymentNumber");

// =====================================================================
// 1. RETUR PEMBELIAN
// =====================================================================

/**
 * GET /api/retur
 * Ambil semua retur pembelian
 */
router.get("/retur", async (req, res) => {
  try {
    const retur = await prisma.returPembelian.findMany({
      include: {
        purchaseOrder: { select: { poNumber: true, id: true, caraPembayaran: true, kategoriPO: true, project: true } },
        supplier: { select: { name: true, id: true } },
        items: { orderBy: { id: "asc" } },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(retur);
  } catch (error) {
    console.error("Get Retur Error:", error);
    res.status(500).json({ error: "Gagal mengambil data retur pembelian" });
  }
});

/**
 * GET /api/retur/:id
 * Ambil detail retur pembelian
 */
router.get("/retur/:id", async (req, res) => {
  try {
    const retur = await prisma.returPembelian.findUnique({
      where: { id: req.params.id },
      include: {
        purchaseOrder: { include: { supplier: true, project: true } },
        supplier: true,
        items: { orderBy: { id: "asc" } },
      },
    });
    if (!retur)
      return res.status(404).json({ error: "Retur tidak ditemukan" });
    res.json(retur);
  } catch (error) {
    console.error("Get Retur Detail Error:", error);
    res.status(500).json({ error: "Gagal mengambil detail retur" });
  }
});

/**
 * POST /api/retur
 * Bikin retur pembelian baru
 */
router.post("/retur", verifyToken, async (req, res) => {
  try {
    const {
      poId,
      supplierId,
      tanggal,
      alasan,
      total,
      items,
    } = req.body;

    // FIX: frontend mengirim `alasan` + `total`; kontrak DB memakai
    // `alasanRetur` + `totalNominal`. Terima dua-duanya supaya tidak tersimpan 0/null.
    const alasanRetur = req.body.alasanRetur ?? alasan ?? null;
    const totalNominal = req.body.totalNominal ?? total ?? 0;

    if (!poId || !supplierId) {
      return res
        .status(400)
        .json({ error: "PO dan Supplier wajib diisi" });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res
        .status(400)
        .json({ error: "Minimal 1 item retur harus diisi" });
    }

    const created = await prisma.returPembelian.create({
      data: {
        poId,
        supplierId,
        tanggal: new Date(tanggal),
        alasanRetur,
        totalNominal: Number(totalNominal || 0),
        items: {
          create: items.map((item) => ({
            poItemId: item.poItemId || null,
            itemName: item.itemName || "",
            qty: Number(item.qty || 0),
            unit: item.unit || "-",
            hargaSatuan: Number(item.hargaSatuan || 0),
            total: Number(item.total || 0),
            catatan: item.catatan || null,
          })),
        },
      },
      include: { items: true },
    });

    // Generate noTransaksi: RET/bulan/tahun/seq
    const now = new Date(tanggal);
    const bulan = String(now.getMonth() + 1).padStart(2, "0");
    const tahun = now.getFullYear();
    const urutan = String(created.seq).padStart(3, "0");
    const noTransaksi = `RET/${bulan}/${tahun}/${urutan}`;

    const retur = await prisma.returPembelian.update({
      where: { id: created.id },
      data: { noTransaksi },
      include: { items: true },
    });

    res.json({
      message: "Retur pembelian berhasil dibuat",
      data: retur,
    });
  } catch (error) {
    console.error("Create Retur Error:", error);
    res.status(500).json({ error: "Gagal membuat retur pembelian" });
  }
});

/**
 * PUT /api/retur/:id
 * Update retur pembelian
 */
router.put("/retur/:id", verifyToken, async (req, res) => {
  try {
    const { poId, supplierId, tanggal, alasanRetur, totalNominal, status, items } =
      req.body;

    const existing = await prisma.returPembelian.findUnique({
      where: { id: req.params.id },
      include: { items: true },
    });
    if (!existing)
      return res.status(404).json({ error: "Retur tidak ditemukan" });

    // Hapus item lama, ganti item baru
    await prisma.returPembelianItem.deleteMany({
      where: { returId: req.params.id },
    });

    const retur = await prisma.returPembelian.update({
      where: { id: req.params.id },
      data: {
        poId: poId || undefined,
        supplierId: supplierId || undefined,
        tanggal: tanggal ? new Date(tanggal) : undefined,
        alasanRetur,
        totalNominal: Number(totalNominal || 0),
        status: status || undefined,
        items: items
          ? {
              create: items.map((item) => ({
                poItemId: item.poItemId || null,
                itemName: item.itemName || "",
                qty: Number(item.qty || 0),
                unit: item.unit || "-",
                hargaSatuan: Number(item.hargaSatuan || 0),
                total: Number(item.total || 0),
                catatan: item.catatan || null,
              })),
            }
          : undefined,
      },
      include: { items: true },
    });

    res.json({ message: "Retur berhasil diupdate", data: retur });
  } catch (error) {
    console.error("Update Retur Error:", error);
    if (error.code === "P2025") {
      return res.status(404).json({ error: "Retur tidak ditemukan" });
    }
    res.status(500).json({ error: "Gagal update retur" });
  }
});

/**
 * DELETE /api/retur/:id
 * Hapus retur pembelian
 */
router.delete("/retur/:id", verifyToken, async (req, res) => {
  try {
    const existing = await prisma.returPembelian.findUnique({
      where: { id: req.params.id },
    });
    if (!existing)
      return res.status(404).json({ error: "Retur tidak ditemukan" });

    await prisma.returPembelian.delete({ where: { id: req.params.id } });
    res.json({ message: "Retur berhasil dihapus" });
  } catch (error) {
    console.error("Delete Retur Error:", error);
    if (error.code === "P2025") {
      return res.status(404).json({ error: "Retur tidak ditemukan" });
    }
    res.status(500).json({ error: "Gagal menghapus retur" });
  }
});

// =====================================================================
// 2. PENGAJUAN PEMBAYARAN
// =====================================================================

const { getKeteranganVolumeHarga } = require("../../lib/keteranganVolumeHarga.js");

// Enrich pengajuan dengan keterangan volume/harga dari PO
const enrichPengajuanWithKeterangan = async (pengajuan) => {
  if (!pengajuan?.purchaseOrder) return pengajuan;
  const ket = await getKeteranganVolumeHarga(pengajuan.purchaseOrder).catch((e) => {
    console.error("getKeteranganVolumeHarga error:", e);
    return { ketVolume: "-", ketHarga: "-" };
  });
  return {
    ...pengajuan,
    purchaseOrder: {
      ...pengajuan.purchaseOrder,
      keteranganVolume: ket.ketVolume,
      keteranganHarga: ket.ketHarga,
    },
  };
};

/**
 * GET /api/pengajuan-bayar/budget-monitoring?projectId=xxx
 * Ringkasan monitoring budget RAP (Material vs Jasa) vs Pemesanan PO aktif
 * Beserta deteksi titik-titik over budget
 */
router.get("/pengajuan-bayar/budget-monitoring", async (req, res) => {
  try {
    const { projectId } = req.query;
    if (!projectId) {
      return res.status(400).json({ error: "projectId wajib diisi" });
    }

    // 1. Ambil data RAP Proyek (RabItem + Components)
    const rabItems = await prisma.rabItem.findMany({
      where: { projectId },
      include: { components: true, workCategory: true },
    });

    let rapMaterial = 0;
    let rapJasa = 0;

    for (const it of rabItems) {
      const vol = Number(it.volume || 0);
      if (it.components && it.components.length > 0) {
        for (const comp of it.components) {
          const compLineTotal =
            Number(comp.coefficient || 0) * Number(comp.unitPrice || 0) * vol;
          if (comp.section === "UPAH") {
            rapJasa += compLineTotal;
          } else {
            // BAHAN dan ALAT dijadikan satu ke Material sesuai permintaan
            rapMaterial += compLineTotal;
          }
        }
      } else {
        const itemTotal = Number(
          it.rapTotalPrice || vol * Number(it.rapUnitPrice || 0),
        );
        if (it.category && /upah|jasa/i.test(it.category)) {
          rapJasa += itemTotal;
        } else {
          rapMaterial += itemTotal;
        }
      }
    }

    const totalRap = rapMaterial + rapJasa;

    // 2. Ambil PO Aktif (APPROVED, MENUNGGU_ATASAN, BELUM_APPROVE)
    const pos = await prisma.purchaseOrder.findMany({
      where: {
        projectId,
        status: { in: ["APPROVED", "MENUNGGU_ATASAN", "BELUM_APPROVE"] },
      },
      include: {
        items: {
          include: {
            materialRequest: {
              select: {
                pricePerUnit: true,
                estimatedVolume: true,
                itemName: true,
              },
            },
            rabItem: {
              select: { rapUnitPrice: true, volume: true, name: true },
            },
          },
        },
        supplier: { select: { id: true, name: true } },
        jasa: { select: { id: true, nama: true } },
      },
    });

    let orderedMaterial = 0;
    let orderedJasa = 0;
    let orderedApproved = 0;
    let orderedPending = 0;

    const overItems = [];
    const overPoIdSet = new Set();

    for (const po of pos) {
      const poTotal = Number(po.grandTotal || po.subTotal || 0);
      const isJasa = po.kategoriPO === "JASA" || Boolean(po.jasaId);

      if (isJasa) {
        orderedJasa += poTotal;
      } else {
        orderedMaterial += poTotal;
      }

      if (po.status === "APPROVED") {
        orderedApproved += poTotal;
      } else {
        orderedPending += poTotal;
      }

      // Deteksi over budget pada level item
      for (const it of po.items) {
        const rapPrice = Number(
          it.materialRequest?.pricePerUnit || it.rabItem?.rapUnitPrice || 0,
        );
        const rapVol = Number(
          it.materialRequest?.estimatedVolume || it.rabItem?.volume || 0,
        );
        const poPrice = Number(it.unitPrice || 0);
        const poQty = Number(it.qty || 0);

        const isOverHarga = rapPrice > 0 && poPrice > rapPrice;
        const isOverVol = rapVol > 0 && poQty > rapVol;

        if (isOverHarga || isOverVol) {
          overPoIdSet.add(po.id);
          const diffHarga = isOverHarga ? poPrice - rapPrice : 0;
          const diffVol = isOverVol ? poQty - rapVol : 0;
          const nominalOver =
            diffHarga * poQty + (isOverVol && !isOverHarga ? diffVol * poPrice : 0);

          overItems.push({
            poId: po.id,
            poNumber: po.poNumber || `PO-${po.id.slice(0, 8)}`,
            kategoriPO: po.kategoriPO,
            supplierOrJasa: isJasa
              ? po.jasa?.nama || "-"
              : po.supplier?.name || "-",
            description: it.description,
            qty: poQty,
            unit: it.unit,
            unitPrice: poPrice,
            rapUnitPrice: rapPrice,
            rapVol,
            diffHarga,
            diffVol,
            nominalOver: Math.max(0, nominalOver),
            isOverHarga,
            isOverVol,
          });
        }
      }
    }

    const totalOrdered = orderedMaterial + orderedJasa;

    // 3. Hitung variance
    const materialDiff = orderedMaterial - rapMaterial;
    const jasaDiff = orderedJasa - rapJasa;
    const totalDiff = totalOrdered - totalRap;

    // Sort overItems dari nominal over terbesar
    overItems.sort((a, b) => b.nominalOver - a.nominalOver);

    res.json({
      rap: {
        material: rapMaterial,
        jasa: rapJasa,
        total: totalRap,
      },
      ordered: {
        material: orderedMaterial,
        jasa: orderedJasa,
        total: totalOrdered,
        approved: orderedApproved,
        pending: orderedPending,
      },
      variance: {
        materialDiff,
        materialIsOver: materialDiff > 0,
        materialPercent:
          rapMaterial > 0 ? (orderedMaterial / rapMaterial) * 100 : 0,
        jasaDiff,
        jasaIsOver: jasaDiff > 0,
        jasaPercent: rapJasa > 0 ? (orderedJasa / rapJasa) * 100 : 0,
        totalDiff,
        totalIsOver: totalDiff > 0,
        totalPercent:
          totalRap > 0 ? (totalOrdered / totalRap) * 100 : 0,
      },
      overPoIds: Array.from(overPoIdSet),
      overItems,
    });
  } catch (error) {
    console.error("Get Budget Monitoring Error:", error);
    res.status(500).json({ error: "Gagal mengambil data monitoring budget" });
  }
});

/**
 * GET /api/pengajuan-bayar
 */
router.get("/pengajuan-bayar", async (req, res) => {
  try {
    const { projectId, status } = req.query;
    const where = {};
    if (projectId) where.projectId = projectId;
    if (status) where.status = { in: String(status).split(",") };

    const pengajuan = await prisma.pengajuanPembayaran.findMany({
      where,
      include: {
        supplier: { select: { name: true, id: true } },
        jasa: { select: { id: true, nama: true } },
        purchaseOrder: {
          include: {
            supplier: { select: { id: true, name: true } },
            jasa: { select: { id: true, nama: true } },
            project: { select: { id: true, name: true } },
            items: {
              orderBy: { id: "asc" },
              include: {
                materialRequest: { select: { estimatedVolume: true, pricePerUnit: true, itemName: true } },
              },
            },
          },
        },
        approvedBy: { select: { name: true, id: true } },
        verifiedBy: { select: { name: true, id: true } },
        pembayaran: true,
      },
      orderBy: { createdAt: "desc" },
    });

    const enriched = await Promise.all(pengajuan.map(enrichPengajuanWithKeterangan));
    res.json(enriched);
  } catch (error) {
    console.error("Get Pengajuan Bayar Error:", error);
    res.status(500).json({ error: "Gagal mengambil data pengajuan bayar" });
  }
});

/**
 * GET /api/pengajuan-bayar/inbox-atasan?projectId=xxx
 * Pengajuan yang sudah di-ACC Finance, nunggu persetujuan atasan (PM).
 * HARUS di atas /:id supaya tidak ketangkap sebagai id.
 */
router.get("/pengajuan-bayar/inbox-atasan", async (req, res) => {
  try {
    const { projectId } = req.query;
    const where = { status: "APPROVED_FINANCE" };
    if (projectId) where.projectId = projectId;

    const data = await prisma.pengajuanPembayaran.findMany({
      where,
      include: {
        supplier: { select: { name: true, id: true } },
        jasa: { select: { id: true, nama: true } },
        purchaseOrder: {
          include: {
            supplier: { select: { id: true, name: true } },
            jasa: { select: { id: true, nama: true } },
            project: { select: { id: true, name: true } },
            items: {
              orderBy: { id: "asc" },
              include: {
                materialRequest: { select: { estimatedVolume: true, pricePerUnit: true, itemName: true } },
              },
            },
          },
        },
        verifiedBy: { select: { name: true, id: true } },
        pembayaran: true,
      },
      orderBy: { verifiedAt: "asc" },
    });
    const enriched = await Promise.all(data.map(enrichPengajuanWithKeterangan));
    res.json(enriched);
  } catch (error) {
    console.error("Get Inbox Atasan Pengajuan Error:", error);
    res.status(500).json({ error: "Gagal mengambil inbox atasan" });
  }
});

/**
 * GET /api/pengajuan-bayar/inbox-finance?projectId=xxx
 */
router.get("/pengajuan-bayar/inbox-finance", async (req, res) => {
  try {
    const { projectId } = req.query;
    const where = { status: "PENDING" };
    if (projectId) where.projectId = projectId;

    const data = await prisma.pengajuanPembayaran.findMany({
      where,
      include: {
        supplier: { select: { name: true, id: true } },
        jasa: { select: { id: true, nama: true } },
        purchaseOrder: {
          include: {
            supplier: { select: { id: true, name: true } },
            jasa: { select: { id: true, nama: true } },
            project: { select: { id: true, name: true } },
            items: { orderBy: { id: "asc" } },
          },
        },
        pembayaran: true,
      },
      orderBy: { createdAt: "asc" },
    });
    const enriched = await Promise.all(data.map(enrichPengajuanWithKeterangan));
    res.json(enriched);
  } catch (error) {
    console.error("Get Inbox Finance Pengajuan Error:", error);
    res.status(500).json({ error: "Gagal mengambil inbox finance" });
  }
});

/**
 * GET /api/pengajuan-bayar/po-siap-ajukan?projectId=xxx
 * PO yang sudah di-approve atasan (APPROVED) dan belum punya pengajuan
 * pembayaran aktif. Ini yang boleh diajukan bayar ke finance.
 * HARUS di atas /pengajuan-bayar/:id supaya tidak ketangkap sebagai id.
 */
router.get("/pengajuan-bayar/po-siap-ajukan", async (req, res) => {
  try {
    const { projectId } = req.query;
    // PO yang sudah di-approve atasan saja yang bisa jadi sumber pengajuan bayar.
    // PO MENUNGGU_ATASAN belum final, jadi tidak muncul di sini.
    const where = { status: "APPROVED" };
    if (projectId) where.projectId = projectId;

    const pos = await prisma.purchaseOrder.findMany({
      where,
      include: {
        supplier: { select: { id: true, name: true } },
        jasa: { select: { id: true, nama: true } },
        project: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
        verifiedBy: { select: { id: true, name: true } },
        items: {
          orderBy: { id: "asc" },
          include: {
            materialRequest: { select: { groupName: true, jobName: true } },
          },
        },
        pengajuanPembayaran: {
          where: { status: { not: "REJECTED" } },
          select: { id: true, noPengajuan: true, status: true },
        },
      },
      orderBy: { approvedAt: "desc" },
    });

    // Yang belum diajukan aja
    const siap = pos.filter((po) => po.pengajuanPembayaran.length === 0);

    res.json(
      siap.map((po) => {
        const { pengajuanPembayaran, ...rest } = po;
        return rest;
      }),
    );
  } catch (error) {
    console.error("Get PO Siap Ajukan Error:", error);
    res.status(500).json({ error: "Gagal mengambil PO siap diajukan" });
  }
});

/**
 * GET /api/pengajuan-bayar/riwayat-pembelian?projectId=xxx
 * Penggabungan PO yang sudah disetujui finance + pengajuan bayarnya.
 * Dipakai panel atasan: cukup lihat PO + item, lalu setujui.
 */
router.get("/pengajuan-bayar/riwayat-pembelian", async (req, res) => {
  try {
    const { projectId } = req.query;
    // Tampilkan semua PO sebagai riwayat pemesanan (kecuali draft internal)
    const where = {};
    if (projectId) where.projectId = projectId;

    const pos = await prisma.purchaseOrder.findMany({
      where,
      include: {
        supplier: { select: { id: true, name: true } },
        jasa: { select: { id: true, nama: true } },
        project: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
        verifiedBy: { select: { id: true, name: true } },
        items: {
          orderBy: { id: "asc" },
          include: {
            materialRequest: { select: { groupName: true, jobName: true } },
          },
        },
        pengajuanPembayaran: {
          include: {
            verifiedBy: { select: { id: true, name: true } },
            approvedBy: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: { approvedAt: "desc" },
    });

    res.json(pos);
  } catch (error) {
    console.error("Get Riwayat Pembelian Error:", error);
    res.status(500).json({ error: "Gagal mengambil riwayat pembelian" });
  }
});

/**
 * GET /api/pengajuan-bayar/po-approved?projectId=xxx
 * PO berstatus APPROVED beserta itemnya + pengajuanPembayaran yang sudah ada
 * (kalau ada). Dipakai frontend untuk tabel "Daftar Pengajuan Bayar" yang
 * menampilkan NOMOR PO sebagai info utama (nomor PPB jadi info sekunder).
 */
router.get("/pengajuan-bayar/po-approved", async (req, res) => {
  try {
    const { projectId } = req.query;
    const where = { status: "APPROVED" };
    if (projectId) where.projectId = projectId;

    const pos = await prisma.purchaseOrder.findMany({
      where,
      include: {
        supplier: { select: { id: true, name: true } },
        jasa: { select: { id: true, nama: true } },
        project: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
        verifiedBy: { select: { id: true, name: true } },
        items: {
          orderBy: { id: "asc" },
          include: {
            materialRequest: { select: { groupName: true, jobName: true, estimatedVolume: true, pricePerUnit: true } },
          },
        },
        pengajuanPembayaran: {
          include: {
            verifiedBy: { select: { id: true, name: true } },
            approvedBy: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: { approvedAt: "desc" },
    });

    res.json(pos);
  } catch (error) {
    console.error("Get PO Approved Error:", error);
    res.status(500).json({ error: "Gagal mengambil PO approved" });
  }
});

/**
 * GET /api/pengajuan-bayar/:id
 */
router.get("/pengajuan-bayar/:id", async (req, res) => {
  try {
    const pengajuan = await prisma.pengajuanPembayaran.findUnique({
      where: { id: req.params.id },
      include: {
        supplier: true,
        jasa: true,
        purchaseOrder: {
          include: {
            supplier: true,
            jasa: true,
            project: { select: { id: true, name: true } },
            items: { orderBy: { id: "asc" } },
          },
        },
        approvedBy: { select: { name: true, id: true } },
        verifiedBy: { select: { name: true, id: true } },
        pembayaran: true,
      },
    });
    if (!pengajuan)
      return res
        .status(404)
        .json({ error: "Pengajuan pembayaran tidak ditemukan" });
    res.json(pengajuan);
  } catch (error) {
    console.error("Get Pengajuan Bayar Detail Error:", error);
    res.status(500).json({ error: "Gagal mengambil detail pengajuan bayar" });
  }
});

/**
 * POST /api/pengajuan-bayar
 */
router.post("/pengajuan-bayar", verifyToken, async (req, res) => {
  try {
    const {
      supplierId,
      jasaId,
      poId,
      projectId,
      tanggal,
      totalTagihan,
      catatan,
      items,
    } = req.body;

    if (!supplierId && !jasaId && !poId) {
      return res.status(400).json({ error: "Supplier/Jasa wajib diisi" });
    }

    // projectId, supplierId & jasaId ikut PO kalau tidak dikirim FE
    let finalProjectId = projectId || null;
    let finalSupplierId = supplierId || null;
    let finalJasaId = jasaId || null;
    if ((!finalProjectId || (!finalSupplierId && !finalJasaId)) && poId) {
      const po = await prisma.purchaseOrder.findUnique({
        where: { id: poId },
        select: { projectId: true, supplierId: true, jasaId: true },
      });
      finalProjectId = finalProjectId || po?.projectId || null;
      finalSupplierId = finalSupplierId || po?.supplierId || null;
      finalJasaId = finalJasaId || po?.jasaId || null;
    }
    if (!finalSupplierId && !finalJasaId) {
      return res.status(400).json({ error: "Supplier/Jasa wajib diisi" });
    }

    let initialStatus = "PENDING";
    let verifiedById = null;
    let verifiedAt = null;
    let approvedById = null;
    let approvedAt = null;

    const created = await prisma.pengajuanPembayaran.create({
      data: {
        supplierId: finalSupplierId,
        jasaId: finalJasaId,
        poId: poId || null,
        projectId: finalProjectId,
        tanggal: new Date(tanggal || Date.now()),
        totalTagihan: Number(totalTagihan || 0),
        catatan,
        items: items || undefined,
        status: initialStatus,
        verifiedById,
        verifiedAt,
        approvedById,
        approvedAt,
      },
    });

    // Generate noPengajuan: PPB/bulan/tahun/seq
    const now = created.tanggal;
    const bulan = String(now.getMonth() + 1).padStart(2, "0");
    const tahun = now.getFullYear();
    const urutan = String(created.seq).padStart(3, "0");
    const noPengajuan = `PPB/${bulan}/${tahun}/${urutan}`;

    const pengajuan = await prisma.pengajuanPembayaran.update({
      where: { id: created.id },
      data: { noPengajuan },
    });

    res.json({
      message: "Pengajuan pembayaran berhasil dibuat",
      data: pengajuan,
    });
  } catch (error) {
    console.error("Create Pengajuan Bayar Error:", error);
    res.status(500).json({ error: "Gagal membuat pengajuan pembayaran" });
  }
});

/**
 * PUT /api/pengajuan-bayar/:id
 */
router.put("/pengajuan-bayar/:id", verifyToken, async (req, res) => {
  try {
    const {
      supplierId,
      jasaId,
      poId,
      projectId,
      tanggal,
      totalTagihan,
      catatan,
      items,
    } = req.body;

    const pengajuan = await prisma.pengajuanPembayaran.update({
      where: { id: req.params.id },
      data: {
        supplierId: supplierId !== undefined ? (supplierId || null) : undefined,
        jasaId: jasaId !== undefined ? (jasaId || null) : undefined,
        poId: poId !== undefined ? poId : undefined,
        projectId: projectId !== undefined ? projectId : undefined,
        tanggal: tanggal ? new Date(tanggal) : undefined,
        totalTagihan: Number(totalTagihan || 0),
        catatan,
        items: items || undefined,
      },
    });

    res.json({ message: "Pengajuan bayar berhasil diupdate", data: pengajuan });
  } catch (error) {
    console.error("Update Pengajuan Bayar Error:", error);
    if (error.code === "P2025") {
      return res
        .status(404)
        .json({ error: "Pengajuan pembayaran tidak ditemukan" });
    }
    res.status(500).json({ error: "Gagal update pengajuan bayar" });
  }
});

/**
 * PUT /api/pengajuan-bayar/:id/verify
 * TINGKAT 1 — Finance memverifikasi tagihan.
 * PENDING -> APPROVED_FINANCE (masuk inbox atasan)
 */
router.put(
  "/pengajuan-bayar/:id/verify",
  verifyToken,
  authorizeRoles("SUPER_ADMIN"),
  async (req, res) => {
    try {
      const existing = await prisma.pengajuanPembayaran.findUnique({
        where: { id: req.params.id },
      });
      return res.status(400).json({ error: "Pengajuan bayar tidak perlu verifikasi Finance. Langsung approve atasan." });
    } catch (error) {
      console.error("Verify Pengajuan Error:", error);
      if (error.code === "P2025") {
        return res
          .status(404)
          .json({ error: "Pengajuan pembayaran tidak ditemukan" });
      }
      res.status(500).json({ error: "Gagal memverifikasi pengajuan bayar" });
    }
  },
);

/**
 * Sinkronkan status approval pembayaranSupplier saat Atasan menyetujui pengajuan bayar
 */
const syncPembayaranToApprovedAtasan = async (pengajuanId, poId, user) => {
  try {
    const list = await prisma.pembayaranSupplier.findMany({
      where: {
        OR: [
          ...(pengajuanId ? [{ pengajuanId }] : []),
          ...(poId ? [{ poId }] : []),
        ],
      },
    });

    for (const item of list) {
      const rawPh = item.paymentHistory;
      let meta = {};
      let entries = [];
      if (Array.isArray(rawPh)) {
        entries = rawPh;
      } else if (rawPh && typeof rawPh === "object") {
        meta = { ...rawPh };
        entries = Array.isArray(rawPh.entries) ? rawPh.entries : [];
      }

      meta.entries = entries;
      meta.approvalStatus = "APPROVED_ATASAN";
      meta.atasanApprovedAt = new Date();
      meta.atasanApprovedBy = user?.name || user?.username || user?.userId || "Atasan";
      meta.rejectReason = null;

      await prisma.pembayaranSupplier.update({
        where: { id: item.id },
        data: { paymentHistory: meta },
      });
    }
  } catch (err) {
    console.error("Sync pembayaran to approved atasan error:", err);
  }
};

/**
 * PUT /api/pengajuan-bayar/:id/approve
 * TINGKAT 2 — Atasan (PROJECT_MANAGER) menyetujui final.
 * APPROVED_FINANCE -> APPROVED
 * Tetap terima PENDING / APPROVED_FINANCE untuk kompatibilitas.
 */
router.put(
  "/pengajuan-bayar/:id/approve",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "PROJECT_MANAGER"),
  async (req, res) => {
    try {
      const existing = await prisma.pengajuanPembayaran.findUnique({
        where: { id: req.params.id },
      });
      if (!existing)
        return res
          .status(404)
          .json({ error: "Pengajuan pembayaran tidak ditemukan" });
      if (existing.status === "APPROVED") {
        return res.status(400).json({ error: "Pengajuan ini sudah disetujui." });
      }
      if (existing.status === "REJECTED") {
        return res
          .status(400)
          .json({ error: "Pengajuan sudah ditolak, batalkan reject dulu." });
      }

    const pengajuan = await prisma.pengajuanPembayaran.update({
      where: { id: req.params.id },
      data: {
        status: "APPROVED",
        approvedById: req.user?.userId || null,
        approvedAt: new Date(),
        rejectReason: null,
      },
    });

    // Sinkronkan status PO terkait menjadi APPROVED jika belum
    if (existing.poId) {
      const poForPayment = await prisma.purchaseOrder.findUnique({
        where: { id: existing.poId },
      });

      await prisma.purchaseOrder.update({
        where: { id: existing.poId },
        data: {
          status: "APPROVED",
          approvedById: req.user?.userId || null,
          approvedAt: new Date(),
          rejectReason: null,
          rejectedAt: null,
          rejectedById: null,
        },
      });

      // Saat pengajuan di-approve, selalu siapkan draft PembayaranSupplier default
      if (poForPayment) {
        const sudahAda = await prisma.pembayaranSupplier.findFirst({
          where: { poId: poForPayment.id },
        });
        if (!sudahAda) {
          const totalTagihan = Number(poForPayment.grandTotal || poForPayment.subTotal || 0);

          const cara = String(poForPayment.caraPembayaran || "").toLowerCase();
          let metodeDefault = "TRANSFER";
          if (cara.includes("cash")) metodeDefault = "CASH";
          else if (cara.includes("cek")) metodeDefault = "CEK";
          else if (cara.includes("giro")) metodeDefault = "GIRO";
          else if (cara.includes("tempo") || cara.includes("cicil") || cara.includes("termin") || cara.includes("kredit")) {
            metodeDefault = "TEMPO";
          }

          const createdPembayaran = await prisma.pembayaranSupplier.create({
            data: {
              supplierId: poForPayment.supplierId,
              jasaId: poForPayment.jasaId || null,
              poId: poForPayment.id,
              tanggal: new Date(),
              totalTagihan,
              jumlahBayar: 0,
              totalTerbayar: 0,
              sisaBayar: totalTagihan,
              metodeBayar: metodeDefault,
              keterangan: `Draft pembayaran PO ${poForPayment.poNumber || poForPayment.id}`,
              status: poForPayment.kategoriPO === "JASA" ? "BELUM_BAYAR" : "PENDING",
              noPembayaran: poForPayment.kategoriPO === "JASA" ? null : undefined,
              paymentHistory: {
                entries: [],
                approvalStatus: "APPROVED_ATASAN",
                isPostedKasBank: false,
                atasanApprovedAt: new Date(),
                atasanApprovedBy: req.user?.name || req.user?.username || "Atasan",
              },
            },
          });

          if (poForPayment.kategoriPO !== "JASA") {
            const noPembayaran = await buildNoPembayaran({
              pembayaranId: createdPembayaran.id,
              tanggal: createdPembayaran.tanggal,
            });

            await prisma.pembayaranSupplier.update({
              where: { id: createdPembayaran.id },
              data: { noPembayaran },
            });
          }
        }
      }

      // Sinkronkan status pembayaranSupplier yang sudah ada ke APPROVED_ATASAN
      await syncPembayaranToApprovedAtasan(existing.id, existing.poId, req.user);
    }

      res.json({ message: "Pengajuan bayar di-approve", data: pengajuan });
    } catch (error) {
      console.error("Approve Pengajuan Bayar Error:", error);
      if (error.code === "P2025") {
        return res
          .status(404)
          .json({ error: "Pengajuan pembayaran tidak ditemukan" });
      }
      res.status(500).json({ error: "Gagal approve pengajuan bayar" });
    }
  },
);

/**
 * PUT /api/pengajuan-bayar/:id/cancel-reject
 */
router.put(
  "/pengajuan-bayar/:id/cancel-reject",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "FINANCE", "PROJECT_MANAGER"),
  async (req, res) => {
    try {
      const existing = await prisma.pengajuanPembayaran.findUnique({
        where: { id: req.params.id },
      });
      if (!existing)
        return res
          .status(404)
          .json({ error: "Pengajuan pembayaran tidak ditemukan" });
      if (existing.status !== "REJECTED") {
        return res
          .status(400)
          .json({ error: "Hanya pengajuan REJECTED yang bisa dibatalkan." });
      }

      const pengajuan = await prisma.pengajuanPembayaran.update({
        where: { id: req.params.id },
        data: {
          status: existing.verifiedById ? "APPROVED_FINANCE" : "PENDING",
          rejectReason: null,
        },
      });
      res.json({ message: "Reject dibatalkan", data: pengajuan });
    } catch (error) {
      console.error("Cancel Reject Pengajuan Error:", error);
      res.status(500).json({ error: "Gagal membatalkan reject" });
    }
  },
);

/**
 * PUT /api/pengajuan-bayar/:id/reject
 */
router.put(
  "/pengajuan-bayar/:id/reject",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "FINANCE", "PROJECT_MANAGER"),
  async (req, res) => {
    try {
      const reason = req.body.reason || req.body.catatan;
      if (!reason || !String(reason).trim()) {
        return res.status(400).json({ error: "Alasan tolak wajib diisi." });
      }

      const existing = await prisma.pengajuanPembayaran.findUnique({
        where: { id: req.params.id },
      });
      if (!existing)
        return res
          .status(404)
          .json({ error: "Pengajuan pembayaran tidak ditemukan" });
      if (!["PENDING", "APPROVED_FINANCE"].includes(existing.status)) {
        return res.status(400).json({
          error: "Hanya pengajuan yang belum final yang bisa ditolak.",
        });
      }

      const pengajuan = await prisma.pengajuanPembayaran.update({
        where: { id: req.params.id },
        data: {
          status: "REJECTED",
          rejectReason: String(reason).trim(),
          catatan: String(reason).trim(),
        },
      });

      // Kalau pengajuan ditolak, PO terkait kembali ke MENUNGGU_ATASAN agar bisa diajukan ulang
      if (existing.poId) {
        await prisma.purchaseOrder.update({
          where: { id: existing.poId },
          data: {
            status: "MENUNGGU_ATASAN",
            approvedById: null,
            approvedAt: null,
          },
        });
      }

      res.json({ message: "Pengajuan bayar ditolak", data: pengajuan });
    } catch (error) {
      console.error("Reject Pengajuan Bayar Error:", error);
      if (error.code === "P2025") {
        return res
          .status(404)
          .json({ error: "Pengajuan pembayaran tidak ditemukan" });
      }
      res.status(500).json({ error: "Gagal reject pengajuan bayar" });
    }
  },
);

/**
 * PUT /api/pengajuan-bayar/:id/item-decision
 * Keputusan Approval / Reject di tingkat item (Opsi B)
 */
router.put(
  "/pengajuan-bayar/:id/item-decision",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "PROJECT_MANAGER"),
  async (req, res) => {
    try {
      const { decisions = [], generalRejectReason = "" } = req.body;
      const existing = await prisma.pengajuanPembayaran.findUnique({
        where: { id: req.params.id },
        include: {
          purchaseOrder: {
            include: { items: true, supplier: true, jasa: true },
          },
        },
      });

      if (!existing) {
        return res
          .status(404)
          .json({ error: "Pengajuan pembayaran tidak ditemukan" });
      }

      if (existing.status === "APPROVED") {
        return res
          .status(400)
          .json({ error: "Pengajuan ini sudah disetujui sebelumnya." });
      }

      const po = existing.purchaseOrder;
      const decisionMap = {};
      decisions.forEach((d) => {
        if (d.itemId) decisionMap[d.itemId] = d;
      });

      const approvedItems = [];
      const rejectedItems = [];

      const poItems = po?.items || [];
      for (const it of poItems) {
        const dec = decisionMap[it.id];
        if (dec && dec.status === "REJECTED") {
          rejectedItems.push({
            id: it.id,
            description: it.description,
            qty: it.qty,
            unit: it.unit,
            unitPrice: it.unitPrice,
            total: it.total,
            status: "REJECTED",
            rejectReason: dec.rejectReason || "Ditolak oleh atasan",
          });
        } else {
          approvedItems.push({
            id: it.id,
            description: it.description,
            qty: it.qty,
            unit: it.unit,
            unitPrice: it.unitPrice,
            total: it.total,
            status: "APPROVED",
          });
        }
      }

      // KASUS 1: Semua item di-reject
      if (approvedItems.length === 0) {
        const reason =
          generalRejectReason || "Semua item ditolak oleh atasan.";
        const updatedPengajuan = await prisma.pengajuanPembayaran.update({
          where: { id: req.params.id },
          data: {
            status: "REJECTED",
            rejectReason: reason,
            items: rejectedItems,
          },
        });

        if (existing.poId) {
          await prisma.purchaseOrder.update({
            where: { id: existing.poId },
            data: {
              status: "REJECTED",
              rejectedById: req.user?.userId || null,
              rejectedAt: new Date(),
              rejectReason: reason,
            },
          });
        }

        return res.json({
          message: "Seluruh item ditolak. Pengajuan ditandai ditolak.",
          data: updatedPengajuan,
          approvedCount: 0,
          rejectedCount: rejectedItems.length,
        });
      }

      // KASUS 2: Sebagian atau seluruh item di-approve
      const approvedTotal = approvedItems.reduce(
        (sum, it) => sum + Number(it.total || 0),
        0,
      );

      // Update pengajuan pembayaran
      const updatedPengajuan = await prisma.pengajuanPembayaran.update({
        where: { id: req.params.id },
        data: {
          status: "APPROVED",
          approvedById: req.user?.userId || null,
          approvedAt: new Date(),
          totalTagihan: approvedTotal,
          rejectReason:
            rejectedItems.length > 0
              ? `${rejectedItems.length} item ditolak`
              : null,
          items: [...approvedItems, ...rejectedItems],
        },
      });

      // Update PO
      if (existing.poId) {
        await prisma.purchaseOrder.update({
          where: { id: existing.poId },
          data: {
            status: "APPROVED",
            approvedById: req.user?.userId || null,
            approvedAt: new Date(),
            subTotal: approvedTotal,
            grandTotal: approvedTotal,
            rejectReason: null,
            rejectedAt: null,
            rejectedById: null,
          },
        });

        // Catat alasan reject pada baris PurchaseOrderItem yang ditolak
        for (const rej of rejectedItems) {
          await prisma.purchaseOrderItem.update({
            where: { id: rej.id },
            data: {
              keteranganHarga: rej.rejectReason
                ? `[Ditolak: ${rej.rejectReason}]`
                : "[Ditolak Atasan]",
            },
          });
        }

        // Siapkan draft PembayaranSupplier default
        const sudahAda = await prisma.pembayaranSupplier.findFirst({
          where: { poId: existing.poId },
        });

        const cara = String(po?.caraPembayaran || "").toLowerCase();
        let metodeDefault = "TRANSFER";
        if (cara.includes("cash")) metodeDefault = "CASH";
        else if (cara.includes("cek")) metodeDefault = "CEK";
        else if (cara.includes("giro")) metodeDefault = "GIRO";
        else if (
          cara.includes("tempo") ||
          cara.includes("cicil") ||
          cara.includes("termin") ||
          cara.includes("kredit")
        ) {
          metodeDefault = "TEMPO";
        }

        if (!sudahAda) {
          const createdPembayaran = await prisma.pembayaranSupplier.create({
            data: {
              supplierId: po?.supplierId || null,
              jasaId: po?.jasaId || null,
              poId: existing.poId,
              pengajuanId: updatedPengajuan.id,
              tanggal: new Date(),
              totalTagihan: approvedTotal,
              jumlahBayar: 0,
              totalTerbayar: 0,
              sisaBayar: approvedTotal,
              metodeBayar: metodeDefault,
              keterangan: `Draft pembayaran PO ${po?.poNumber || po?.id}${rejectedItems.length > 0 ? " (Sebagian disetujui)" : ""}`,
              status: po?.kategoriPO === "JASA" ? "BELUM_BAYAR" : "PENDING",
              noPembayaran: po?.kategoriPO === "JASA" ? null : undefined,
              paymentHistory: {
                entries: [],
                approvalStatus: "APPROVED_ATASAN",
                isPostedKasBank: false,
                atasanApprovedAt: new Date(),
                atasanApprovedBy: req.user?.name || req.user?.username || "Atasan",
              },
            },
          });

          if (po?.kategoriPO !== "JASA") {
            const noPembayaran = await buildNoPembayaran({
              pembayaranId: createdPembayaran.id,
              tanggal: createdPembayaran.tanggal,
            });

            await prisma.pembayaranSupplier.update({
              where: { id: createdPembayaran.id },
              data: { noPembayaran },
            });
          }
        } else {
          // Update total tagihan yang sudah ada jika nominal berubah
          await prisma.pembayaranSupplier.update({
            where: { id: sudahAda.id },
            data: {
              totalTagihan: approvedTotal,
              sisaBayar: Math.max(
                0,
                approvedTotal - Number(sudahAda.totalTerbayar || 0),
              ),
              keterangan: `Draft pembayaran PO ${po?.poNumber || po?.id}${rejectedItems.length > 0 ? " (Sebagian disetujui)" : ""}`,
            },
          });
        }

        // Sinkronkan approval pembayaranSupplier terkait
        await syncPembayaranToApprovedAtasan(existing.id, existing.poId, req.user);
      }

      res.json({
        message: `Keputusan item berhasil diproses (${approvedItems.length} disetujui, ${rejectedItems.length} ditolak)`,
        data: updatedPengajuan,
        approvedCount: approvedItems.length,
        rejectedCount: rejectedItems.length,
      });
    } catch (error) {
      console.error("Item Decision Error:", error);
      res
        .status(500)
        .json({ error: "Gagal memproses keputusan item pengajuan" });
    }
  },
);

/**
 * POST /api/pengajuan-bayar/bulk-approve
 * Menyetujui beberapa pengajuan sekaligus
 */
router.post(
  "/pengajuan-bayar/bulk-approve",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "PROJECT_MANAGER"),
  async (req, res) => {
    try {
      const { ids = [] } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res
          .status(400)
          .json({ error: "Pilih minimal 1 pengajuan untuk disetujui" });
      }

      let successCount = 0;
      for (const id of ids) {
        const existing = await prisma.pengajuanPembayaran.findUnique({
          where: { id },
          include: { purchaseOrder: { include: { items: true } } },
        });
        if (!existing || existing.status === "APPROVED") continue;

        const po = existing.purchaseOrder;
        const totalTagihan = Number(
          existing.totalTagihan || po?.grandTotal || po?.subTotal || 0,
        );

        await prisma.pengajuanPembayaran.update({
          where: { id },
          data: {
            status: "APPROVED",
            approvedById: req.user?.userId || null,
            approvedAt: new Date(),
            rejectReason: null,
          },
        });

        if (existing.poId) {
          await prisma.purchaseOrder.update({
            where: { id: existing.poId },
            data: {
              status: "APPROVED",
              approvedById: req.user?.userId || null,
              approvedAt: new Date(),
              rejectReason: null,
              rejectedAt: null,
              rejectedById: null,
            },
          });

          // Siapkan draft pembayaran jika belum ada
          const sudahAda = await prisma.pembayaranSupplier.findFirst({
            where: { poId: existing.poId },
          });
          if (!sudahAda && po) {
            const cara = String(po.caraPembayaran || "").toLowerCase();
            let metodeDefault = "TRANSFER";
            if (cara.includes("cash")) metodeDefault = "CASH";
            else if (cara.includes("cek")) metodeDefault = "CEK";
            else if (cara.includes("giro")) metodeDefault = "GIRO";
            else if (
              cara.includes("tempo") ||
              cara.includes("cicil") ||
              cara.includes("termin") ||
              cara.includes("kredit")
            ) {
              metodeDefault = "TEMPO";
            }

            const createdPembayaran = await prisma.pembayaranSupplier.create({
              data: {
                supplierId: po.supplierId || null,
                jasaId: po.jasaId || null,
                poId: po.id,
                pengajuanId: existing.id,
                tanggal: new Date(),
                totalTagihan,
                jumlahBayar: 0,
                totalTerbayar: 0,
                sisaBayar: totalTagihan,
                metodeBayar: metodeDefault,
                keterangan: `Draft pembayaran PO ${po.poNumber || po.id}`,
                status: po.kategoriPO === "JASA" ? "BELUM_BAYAR" : "PENDING",
                noPembayaran: po.kategoriPO === "JASA" ? null : undefined,
                paymentHistory: {
                  entries: [],
                  approvalStatus: "APPROVED_ATASAN",
                  isPostedKasBank: false,
                  atasanApprovedAt: new Date(),
                  atasanApprovedBy: req.user?.name || req.user?.username || "Atasan",
                },
              },
            });

            if (po.kategoriPO !== "JASA") {
              const noPembayaran = await buildNoPembayaran({
                pembayaranId: createdPembayaran.id,
                tanggal: createdPembayaran.tanggal,
              });

              await prisma.pembayaranSupplier.update({
                where: { id: createdPembayaran.id },
                data: { noPembayaran },
              });
            }
          }

          // Sinkronkan approval pembayaranSupplier terkait
          await syncPembayaranToApprovedAtasan(existing.id, existing.poId, req.user);
        }
        successCount++;
      }

      res.json({
        message: `${successCount} pengajuan berhasil disetujui`,
        successCount,
      });
    } catch (error) {
      console.error("Bulk Approve Error:", error);
      res
        .status(500)
        .json({ error: "Gagal menyetujui pengajuan secara massal" });
    }
  },
);

/**
 * POST /api/pengajuan-bayar/bulk-reject
 * Menolak beberapa pengajuan sekaligus
 */
router.post(
  "/pengajuan-bayar/bulk-reject",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "PROJECT_MANAGER"),
  async (req, res) => {
    try {
      const { ids = [], reason = "Ditolak oleh atasan" } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res
          .status(400)
          .json({ error: "Pilih minimal 1 pengajuan untuk ditolak" });
      }

      let successCount = 0;
      for (const id of ids) {
        const existing = await prisma.pengajuanPembayaran.findUnique({
          where: { id },
        });
        if (!existing || existing.status === "APPROVED") continue;

        await prisma.pengajuanPembayaran.update({
          where: { id },
          data: {
            status: "REJECTED",
            rejectReason: reason,
          },
        });

        if (existing.poId) {
          await prisma.purchaseOrder.update({
            where: { id: existing.poId },
            data: {
              status: "MENUNGGU_ATASAN",
              rejectReason: reason,
              rejectedAt: new Date(),
              rejectedById: req.user?.userId || null,
            },
          });
        }
        successCount++;
      }

      res.json({
        message: `${successCount} pengajuan berhasil ditolak`,
        successCount,
      });
    } catch (error) {
      console.error("Bulk Reject Error:", error);
      res.status(500).json({ error: "Gagal menolak pengajuan secara massal" });
    }
  },
);

// =====================================================================
// 3. PEMBAYARAN SUPPLIER
// =====================================================================

const enrichPembayaranApproval = (pembayaran) => {
  if (!pembayaran) return null;
  const rawPh = pembayaran.paymentHistory;
  let phMeta = {};
  let historyEntries = [];

  if (Array.isArray(rawPh)) {
    historyEntries = rawPh;
  } else if (rawPh && typeof rawPh === "object") {
    phMeta = rawPh;
    historyEntries = Array.isArray(rawPh.entries) ? rawPh.entries : [];
  }

  const hasBB = pembayaran.bukuBesarTransaksi && pembayaran.bukuBesarTransaksi.length > 0;
  const isOldPaid = pembayaran.status === "LUNAS" || pembayaran.status === "PAID" || Boolean(hasBB);

  const isPosted = phMeta.isPostedKasBank !== undefined
    ? Boolean(phMeta.isPostedKasBank)
    : Boolean(isOldPaid);

  let approvalStatus = phMeta.approvalStatus;
  if (!approvalStatus) {
    if (isPosted) {
      approvalStatus = "APPROVED_ATASAN";
    } else if (pembayaran.pengajuan?.status === "APPROVED") {
      approvalStatus = "APPROVED_ATASAN";
    } else if (pembayaran.pengajuan?.status === "APPROVED_FINANCE") {
      approvalStatus = "APPROVED_FINANCE";
    } else {
      approvalStatus = "MENUNGGU_FINANCE";
    }
  }

  return {
    ...pembayaran,
    paymentHistory: historyEntries,
    approvalStatus,
    isPostedKasBank: isPosted,
    financeApprovedAt: phMeta.financeApprovedAt || pembayaran.pengajuan?.verifiedAt || null,
    atasanApprovedAt: phMeta.atasanApprovedAt || pembayaran.pengajuan?.approvedAt || null,
    financeApprovedBy: phMeta.financeApprovedBy || pembayaran.pengajuan?.verifiedBy?.name || null,
    atasanApprovedBy: phMeta.atasanApprovedBy || pembayaran.pengajuan?.approvedBy?.name || null,
    postedKasBankAt: phMeta.postedKasBankAt || null,
    postedBy: phMeta.postedBy || null,
    rejectReason: phMeta.rejectReason || null,
  };
};

/**
 * GET /api/pembayaran-supplier
 */
router.get("/pembayaran-supplier", async (req, res) => {
  try {
    const pembayaran = await prisma.pembayaranSupplier.findMany({
      include: {
        supplier: { select: { name: true, id: true, type: true } },
        jasa: { select: { id: true, nama: true } },
        pengajuan: {
          select: {
            noPengajuan: true,
            id: true,
            status: true,
            verifiedAt: true,
            approvedAt: true,
            verifiedBy: { select: { name: true } },
            approvedBy: { select: { name: true } },
          },
        },
        rekeningBank: { include: { tipeRekening: true } },
        tipeRekening: true,
        bukuBesarTransaksi: { select: { id: true } },
        purchaseOrder: {
          include: {
            items: {
              include: {
                materialRequest: true,
                rabItem: {
                  select: {
                    id: true,
                    name: true,
                    rabTotalPrice: true,
                    dailyProgress: {
                      select: { id: true, date: true, progressPercent: true },
                      orderBy: { date: "asc" },
                    },
                  },
                },
              },
            },
            project: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    const enriched = pembayaran.map(enrichPembayaranApproval);
    res.json(enriched);

  } catch (error) {
    console.error("Get Pembayaran Supplier Error:", error);
    res.status(500).json({ error: "Gagal mengambil data pembayaran supplier" });
  }
});

/**
 * GET /api/pembayaran-supplier/:id
 */
router.get("/pembayaran-supplier/:id", async (req, res) => {
  try {
    const pembayaran = await prisma.pembayaranSupplier.findUnique({
      where: { id: req.params.id },
      include: {
        supplier: true,
        jasa: true,
        pengajuan: {
          select: {
            noPengajuan: true,
            id: true,
            status: true,
            verifiedAt: true,
            approvedAt: true,
            verifiedBy: { select: { name: true } },
            approvedBy: { select: { name: true } },
          },
        },
        rekeningBank: { include: { tipeRekening: true } },
        tipeRekening: true,
        bukuBesarTransaksi: { select: { id: true } },
        purchaseOrder: {
          include: {
            supplier: true,
            jasa: true,
            project: true,
            items: {
              include: {
                materialRequest: true,
                rabItem: {
                  select: {
                    id: true,
                    name: true,
                    rabTotalPrice: true,
                    dailyProgress: {
                      select: { id: true, date: true, progressPercent: true },
                      orderBy: { date: "asc" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!pembayaran)
      return res
        .status(404)
        .json({ error: "Pembayaran tidak ditemukan" });
    res.json(enrichPembayaranApproval(pembayaran));
  } catch (error) {
    console.error("Get Pembayaran Supplier Detail Error:", error);
    res.status(500).json({ error: "Gagal mengambil detail pembayaran" });
  }
});

/**
 * POST /api/pembayaran-supplier
 */
router.post("/pembayaran-supplier", verifyToken, async (req, res) => {
  try {
    const {
      supplierId,
      jasaId,
      pengajuanId,
      poId,
      tanggal,
      bankAccount,
      rekeningBankId,
      tipeRekeningId,
      keterangan,
      buktiBayarUrl,
      tipeAkunKasBank,
      status,
    } = req.body;

    const jumlahBayarInput = Number(req.body.jumlahBayar ?? req.body.jumlah ?? 0);
    const metodeBayar = req.body.metodeBayar ?? req.body.metode ?? "TRANSFER";
    const totalTagihanInput = Number(req.body.totalTagihan ?? 0);
    const tanggalForm = tanggal ? new Date(tanggal) : new Date();
    const tanggalBayarInput = req.body.tanggalBayar ? new Date(req.body.tanggalBayar) : null;

    if (!supplierId && !jasaId) {
      return res.status(400).json({ error: "Supplier/Jasa wajib diisi" });
    }
    if (Number.isNaN(jumlahBayarInput) || jumlahBayarInput < 0) {
      return res.status(400).json({ error: "Jumlah bayar harus angka >= 0" });
    }

    const po = poId
      ? await prisma.purchaseOrder.findUnique({
          where: { id: poId },
          include: {
            items: { include: { materialRequest: true, rabItem: true } },
            project: { select: { id: true, name: true } },
            permintaanHabisPakai: { select: { id: true, poId: true } },
          },
        })
      : null;

    const isJasaFlow = (po?.kategoriPO === "JASA") || !!jasaId;

    const totalTagihan = Math.max(
      0,
      totalTagihanInput || Number(po?.grandTotal || po?.subTotal || 0),
    );

    let maxByProgress = totalTagihan;
    if (isJasaFlow && po?.projectId) {
      const poRabItemIds = (po.items || []).map((it) => it.rabItemId).filter(Boolean);
      if (poRabItemIds.length > 0) {
        const rabRows = await prisma.rabItem.findMany({
          where: { id: { in: poRabItemIds }, projectId: po.projectId },
          include: { dailyProgress: true },
        });

        const progressCap = rabRows.reduce((sum, r) => {
          const accum = (r.dailyProgress || []).reduce((s, dp) => s + Number(dp.progressPercent || 0), 0);
          const pct = Math.max(0, Math.min(100, accum));
          return sum + (Number(r.rabTotalPrice || 0) * (pct / 100));
        }, 0);

        maxByProgress = Math.min(totalTagihan, progressCap);
      }
    }

    if (jumlahBayarInput > 0 && jumlahBayarInput > maxByProgress) {
      return res.status(400).json({
        error: isJasaFlow
          ? `Nominal bayar melebihi batas progress JO saat ini (${fmtRp(maxByProgress)}).`
          : "Jumlah bayar tidak boleh melebihi total tagihan",
      });
    }

    if (!isJasaFlow && totalTagihan > 0 && jumlahBayarInput > totalTagihan) {
      return res.status(400).json({ error: "Jumlah bayar tidak boleh melebihi total tagihan" });
    }

    const totalTerbayar = jumlahBayarInput;
    const sisaBayar = Math.max(totalTagihan - totalTerbayar, 0);

    const resolvedTipeAkunKasBank =
      tipeAkunKasBank || (rekeningBankId ? "BANK" : "KAS");

    let autoStatus = "PENDING";
    if (isJasaFlow) {
      if (totalTagihan > 0 && totalTerbayar >= totalTagihan) autoStatus = "LUNAS";
      else if (totalTerbayar > 0) autoStatus = "BON";
      else autoStatus = "BELUM_BAYAR";
    } else {
      if (totalTagihan > 0 && totalTerbayar >= totalTagihan) autoStatus = "PAID";
      else if (totalTerbayar > 0) autoStatus = "PARTIAL";
    }

    if (status && ["PENDING", "PARTIAL", "PAID", "BELUM_BAYAR", "BON", "LUNAS"].includes(status)) {
      autoStatus = status;
    }

    const paymentHistoryEntries = [];
    if (jumlahBayarInput > 0) {
      paymentHistoryEntries.push({
        id: `PMT-${Date.now()}`,
        tanggal: (tanggalBayarInput || tanggalForm).toISOString(),
        jumlah: jumlahBayarInput,
        metodeBayar,
        rekeningBankId: rekeningBankId || null,
        tipeAkunKasBank: resolvedTipeAkunKasBank,
        tipeRekeningId: tipeRekeningId || null,
        tipeEntry:
          metodeBayar === "TEMPO"
            ? (sisaBayar <= 0 ? "PELUNASAN_TEMPO" : "CICILAN_TEMPO")
            : "PEMBAYARAN",
        keterangan: keterangan || null,
      });
    }

    const initialPaymentHistory = {
      entries: paymentHistoryEntries,
      approvalStatus: "MENUNGGU_FINANCE",
      isPostedKasBank: false,
      financeApprovedAt: null,
      financeApprovedBy: null,
      atasanApprovedAt: null,
      atasanApprovedBy: null,
      postedKasBankAt: null,
    };

    const created = await prisma.pembayaranSupplier.create({
      data: {
        supplierId: supplierId || null,
        jasaId: jasaId || po?.jasaId || null,
        pengajuanId: pengajuanId || null,
        poId: poId || null,
        tanggal: tanggalForm,
        totalTagihan,
        jumlahBayar: jumlahBayarInput,
        totalTerbayar,
        sisaBayar,
        metodeBayar: metodeBayar || "TRANSFER",
        bankAccount,
        rekeningBankId: rekeningBankId || null,
        tipeAkunKasBank: resolvedTipeAkunKasBank,
        tipeRekeningId: tipeRekeningId || null,
        keterangan,
        paymentHistory: initialPaymentHistory,
        buktiBayarUrl,
        status: autoStatus,
        tanggalBayar: jumlahBayarInput > 0 ? (tanggalBayarInput || tanggalForm) : null,
      },
    });

    const noPembayaran = isJasaFlow
      ? null
      : await buildNoPembayaran({
          pembayaranId: created.id,
          tanggal: created.tanggal,
        });

    const pembayaran = await prisma.pembayaranSupplier.update({
      where: { id: created.id },
      data: { noPembayaran },
      include: {
        supplier: { select: { id: true, name: true } },
        jasa: { select: { id: true, nama: true } },
        rekeningBank: { include: { tipeRekening: true } },
        tipeRekening: true,
        purchaseOrder: {
          include: {
            items: {
              include: {
                materialRequest: true,
                rabItem: {
                  select: {
                    id: true,
                    name: true,
                    rabTotalPrice: true,
                    dailyProgress: {
                      select: { id: true, date: true, progressPercent: true },
                      orderBy: { date: "asc" },
                    },
                  },
                },
              },
            },
            permintaanHabisPakai: { select: { id: true, poId: true } },
          },
        },
      },
    });

    // Posting ke buku besar HANYA jika diminta secara eksplisit (default: tunggu approval Atasan & tombol Kirim ke Kas/Bank)
    if (req.body.isDirectPosting === true && jumlahBayarInput > 0) {
      try {
        const { createTransaksiBukuBesar } = require("./glBank.routes.js");
        const rekening = rekeningBankId
          ? await prisma.masterRekeningBank.findUnique({ where: { id: rekeningBankId } })
          : null;

        const namaAkun = (rekening ? `${rekening.namaRekening} - ${rekening.nomorRekening}` : null)
          || (resolvedTipeAkunKasBank === "BANK" ? "Bank" : "Kas Kecil");

        const { ketVolume: ketVol, ketHarga: ketHrg } = await getKeteranganVolumeHarga(pembayaran.purchaseOrder || po);

        const tipeLabel =
          isJasaFlow
            ? (sisaBayar <= 0 ? "Pelunasan Jasa" : "Pembayaran Jasa")
            : metodeBayar === "TEMPO"
              ? (sisaBayar <= 0 ? "Pelunasan Tempo" : "Pembayaran Tempo (Cicilan)")
              : "Pembayaran Supplier";

        await createTransaksiBukuBesar({
          tanggal: tanggalBayarInput || tanggalForm,
          tipeAkun: resolvedTipeAkunKasBank === "BANK" || rekening ? "BANK" : "KAS",
          namaAkun,
          jenis: "KELUAR",
          nominal: jumlahBayarInput,
          noReferensi: noPembayaran,
          pihak: pembayaran.supplier?.name || pembayaran.jasa?.nama || "Supplier/Jasa",
          keterangan: `${tipeLabel}${keterangan ? ` - ${keterangan}` : ""}`,
          keteranganVolume: ketVol,
          keteranganHarga: ketHrg,
          tipeRekeningId: tipeRekeningId || rekening?.tipeRekeningId || null,
          poId: pembayaran.poId,
          pengajuanId: pembayaran.pengajuanId,
          pembayaranId: pembayaran.id,
          createdById: req.user?.userId || req.user?.id || null,
        });
      } catch (bbErr) {
        console.error("Auto-create buku besar saat create pembayaran error:", bbErr);
      }
    }

    res.json({
      message: "Pembayaran supplier berhasil dibuat",
      data: enrichPembayaranApproval(pembayaran),
    });
  } catch (error) {
    console.error("Create Pembayaran Supplier Error:", error);
    res.status(500).json({ error: "Gagal membuat pembayaran supplier" });
  }
});

const fmtNum = (n) => {
  const num = Number(n || 0);
  return isNaN(num) ? '0' : num.toLocaleString('id-ID', { maximumFractionDigits: 4 });
};
const fmtRp = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID', { maximumFractionDigits: 0 });

/**
 * PUT /api/pembayaran-supplier/:id
 */
router.put("/pembayaran-supplier/:id", verifyToken, async (req, res) => {
  try {
    const {
      supplierId,
      jasaId,
      pengajuanId,
      poId,
      tanggal,
      jumlahBayar,
      metodeBayar,
      jatuhTempo,
      tanggalBayar,
      bankAccount,
      rekeningBankId,
      tipeRekeningId,
      keterangan,
      buktiBayarUrl,
      tipeAkunKasBank,
      status,
      tambahPembayaran = Boolean(req.body.tambahPembayaran),
      totalTagihan: totalTagihanInput,
    } = req.body;

    const existing = await prisma.pembayaranSupplier.findUnique({
      where: { id: req.params.id },
      include: {
        supplier: true,
        jasa: true,
        rekeningBank: { include: { tipeRekening: true } },
        tipeRekening: true,
        purchaseOrder: {
          include: {
            items: { include: { materialRequest: true, rabItem: true } },
            project: { select: { id: true, name: true } },
            permintaanHabisPakai: { select: { id: true, poId: true } },
          },
        },
      },
    });
    if (!existing) return res.status(404).json({ error: "Pembayaran tidak ditemukan" });

    const poFinalId = poId ?? existing.poId;
    const poFinal = poFinalId
      ? await prisma.purchaseOrder.findUnique({
          where: { id: poFinalId },
          include: {
            items: { include: { materialRequest: true, rabItem: true } },
            project: { select: { id: true, name: true } },
            permintaanHabisPakai: { select: { id: true, poId: true } },
          },
        })
      : existing.purchaseOrder;

    const isJasaFlow = (poFinal?.kategoriPO === "JASA") || !!(jasaId || existing.jasaId);

    const metodeFinal = metodeBayar || existing.metodeBayar || "TRANSFER";
    const tanggalFinal = tanggal ? new Date(tanggal) : existing.tanggal;
    const tanggalBayarFinal = tanggalBayar
      ? new Date(tanggalBayar)
      : (existing.tanggalBayar || (tambahPembayaran ? new Date() : null));

    const jumlahInput = Number(jumlahBayar ?? 0);
    if (Number.isNaN(jumlahInput) || jumlahInput < 0) {
      return res.status(400).json({ error: "Jumlah bayar harus angka >= 0" });
    }

    const totalTagihan = Math.max(
      0,
      Number(
        totalTagihanInput
        ?? existing.totalTagihan
        ?? poFinal?.grandTotal
        ?? poFinal?.subTotal
        ?? 0,
      ),
    );

    const existingTerbayar = Number(existing.totalTerbayar ?? existing.jumlahBayar ?? 0);
    let totalTerbayarBaru = existingTerbayar;

    if (tambahPembayaran) {
      if (jumlahInput <= 0) {
        return res.status(400).json({ error: "Nominal cicilan/pelunasan harus > 0" });
      }
      totalTerbayarBaru += jumlahInput;
    } else if (jumlahBayar !== undefined && jumlahBayar !== null && jumlahBayar !== "") {
      totalTerbayarBaru = jumlahInput;
    }

    if (totalTagihan > 0 && totalTerbayarBaru > totalTagihan) {
      return res.status(400).json({ error: "Total pembayaran melebihi total tagihan" });
    }

    const sisaBayarBaru = Math.max(totalTagihan - totalTerbayarBaru, 0);

    let autoStatus = "PENDING";
    if (isJasaFlow) {
      if (totalTagihan > 0 && totalTerbayarBaru >= totalTagihan) autoStatus = "LUNAS";
      else if (totalTerbayarBaru > 0) autoStatus = "BON";
      else autoStatus = "BELUM_BAYAR";
    } else {
      if (totalTagihan > 0 && totalTerbayarBaru >= totalTagihan) autoStatus = "PAID";
      else if (totalTerbayarBaru > 0) autoStatus = "PARTIAL";
    }

    if (status && ["PENDING", "PARTIAL", "PAID", "BELUM_BAYAR", "BON", "LUNAS"].includes(status)) {
      autoStatus = status;
    }

    const nominalJurnal = Math.max(totalTerbayarBaru - existingTerbayar, 0);

    const resolvedTipeAkunKasBank =
      tipeAkunKasBank || existing.tipeAkunKasBank || (rekeningBankId || existing.rekeningBankId ? "BANK" : "KAS");

    let existingEntries = [];
    let existingMeta = {};
    if (Array.isArray(existing.paymentHistory)) {
      existingEntries = [...existing.paymentHistory];
    } else if (existing.paymentHistory && typeof existing.paymentHistory === "object") {
      existingMeta = { ...existing.paymentHistory };
      existingEntries = Array.isArray(existing.paymentHistory.entries)
        ? [...existing.paymentHistory.entries]
        : [];
    }

    if (nominalJurnal > 0) {
      existingEntries.push({
        id: `PMT-${Date.now()}`,
        tanggal: (tanggalBayarFinal || new Date()).toISOString(),
        jumlah: nominalJurnal,
        metodeBayar: metodeFinal,
        rekeningBankId: rekeningBankId || existing.rekeningBankId || null,
        tipeAkunKasBank: resolvedTipeAkunKasBank,
        tipeRekeningId: tipeRekeningId || existing.tipeRekeningId || null,
        tipeEntry:
          metodeFinal === "TEMPO"
            ? (sisaBayarBaru <= 0 ? "PELUNASAN_TEMPO" : "CICILAN_TEMPO")
            : "PEMBAYARAN",
        keterangan: keterangan || null,
      });
    }

    const updatedPaymentHistory = {
      ...existingMeta,
      entries: existingEntries,
      approvalStatus: existingMeta.isPostedKasBank
        ? (existingMeta.approvalStatus || "APPROVED_ATASAN")
        : (existingMeta.approvalStatus || "MENUNGGU_FINANCE"),
      isPostedKasBank: Boolean(existingMeta.isPostedKasBank),
    };

    const pembayaran = await prisma.pembayaranSupplier.update({
      where: { id: req.params.id },
      data: {
        supplierId: supplierId !== undefined ? (supplierId || null) : undefined,
        jasaId: jasaId !== undefined ? (jasaId || null) : undefined,
        pengajuanId: pengajuanId !== undefined ? pengajuanId : undefined,
        poId: poId !== undefined ? poId : undefined,
        tanggal: tanggalFinal,
        totalTagihan,
        jumlahBayar: nominalJurnal > 0 ? nominalJurnal : Number(existing.jumlahBayar || 0),
        totalTerbayar: totalTerbayarBaru,
        sisaBayar: sisaBayarBaru,
        metodeBayar: metodeFinal,
        jatuhTempo: jatuhTempo ? new Date(jatuhTempo) : existing.jatuhTempo,
        tanggalBayar: nominalJurnal > 0 ? tanggalBayarFinal : existing.tanggalBayar,
        bankAccount,
        rekeningBankId: rekeningBankId || existing.rekeningBankId || null,
        tipeAkunKasBank: resolvedTipeAkunKasBank,
        tipeRekeningId: tipeRekeningId || existing.tipeRekeningId || null,
        keterangan,
        paymentHistory: updatedPaymentHistory,
        buktiBayarUrl,
        status: autoStatus,
      },
      include: {
        supplier: { select: { id: true, name: true } },
        jasa: { select: { id: true, nama: true } },
        rekeningBank: { include: { tipeRekening: true } },
        tipeRekening: true,
        purchaseOrder: {
          include: {
            items: {
              include: {
                materialRequest: true,
                rabItem: {
                  select: {
                    id: true,
                    name: true,
                    rabTotalPrice: true,
                    dailyProgress: {
                      select: { id: true, date: true, progressPercent: true },
                      orderBy: { date: "asc" },
                    },
                  },
                },
              },
            },
            permintaanHabisPakai: { select: { id: true, poId: true } },
            project: { select: { id: true, name: true } },
          },
        },
      },
    });

    // Posting otomatis HANYA jika diminta langsung (default: ditunda sampai Atasan approve & tombol Kirim ke Kas/Bank ditekan)
    if (req.body.isDirectPosting === true && nominalJurnal > 0) {
      const { createTransaksiBukuBesar } = require("./glBank.routes.js");
      try {
        const rekening = rekeningBankId
          ? await prisma.masterRekeningBank.findUnique({ where: { id: rekeningBankId } })
          : existing.rekeningBank;
        const namaAkun = (rekening ? `${rekening.namaRekening} - ${rekening.nomorRekening}` : null)
          || (resolvedTipeAkunKasBank === "BANK" ? "Bank" : "Kas Kecil");

        const po = pembayaran.purchaseOrder || existing.purchaseOrder;
        const { ketVolume: ketVol, ketHarga: ketHrg } = await getKeteranganVolumeHarga(po);

        const tipeLabel =
          isJasaFlow
            ? (sisaBayarBaru <= 0 ? "Pelunasan Jasa" : "Pembayaran Jasa")
            : metodeFinal === "TEMPO"
              ? (sisaBayarBaru <= 0 ? "Pelunasan Tempo" : "Pembayaran Tempo (Cicilan)")
              : "Pembayaran Supplier";

        if (isJasaFlow && !existing.noPembayaran && !pembayaran.noPembayaran) {
          const generatedNo = await buildNoPembayaran({
            pembayaranId: pembayaran.id,
            tanggal: pembayaran.tanggal || new Date(),
          });
          await prisma.pembayaranSupplier.update({
            where: { id: pembayaran.id },
            data: { noPembayaran: generatedNo },
          });
          pembayaran.noPembayaran = generatedNo;
        }

        await createTransaksiBukuBesar({
          tanggal: tanggalBayarFinal || pembayaran.tanggal || new Date(),
          tipeAkun: resolvedTipeAkunKasBank === "BANK" || rekening ? "BANK" : "KAS",
          namaAkun,
          jenis: "KELUAR",
          nominal: nominalJurnal,
          noReferensi: pembayaran.noPembayaran || existing.noPembayaran || req.params.id,
          pihak: pembayaran.supplier?.name || pembayaran.jasa?.nama || existing.supplier?.name || existing.jasa?.nama || "Supplier/Jasa",
          keterangan: `${tipeLabel}${keterangan ? ` - ${keterangan}` : ""}`,
          keteranganVolume: ketVol,
          keteranganHarga: ketHrg,
          tipeRekeningId: tipeRekeningId || rekening?.tipeRekeningId || existing.tipeRekeningId || null,
          poId: po?.id || pembayaran.poId || existing.poId,
          pengajuanId: pembayaran.pengajuanId || existing.pengajuanId,
          pembayaranId: pembayaran.id,
          createdById: req.user?.userId || req.user?.id || null,
        });
      } catch (bbErr) {
        console.error("Auto-create buku besar error:", bbErr);
      }
    }

    res.json({ message: "Pembayaran diupdate", data: enrichPembayaranApproval(pembayaran) });
  } catch (error) {
    console.error("Update Pembayaran Supplier Error:", error);
    if (error.code === "P2025") {
      return res
        .status(404)
        .json({ error: "Pembayaran tidak ditemukan" });
    }
    res.status(500).json({ error: "Gagal update pembayaran" });
  }
});

/**
 * PUT /api/pembayaran-supplier/:id/approve-finance
 * Tingkat 1: Finance memeriksa dan menyetujui tagihan pembayaran.
 */
router.put(
  "/pembayaran-supplier/:id/approve-finance",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "FINANCE"),
  async (req, res) => {
    try {
      const existing = await prisma.pembayaranSupplier.findUnique({
        where: { id: req.params.id },
        include: { pengajuan: true, bukuBesarTransaksi: true },
      });
      if (!existing) {
        return res.status(404).json({ error: "Pembayaran tidak ditemukan" });
      }

      const rawPh = existing.paymentHistory;
      let meta = {};
      let entries = [];
      if (Array.isArray(rawPh)) {
        entries = rawPh;
      } else if (rawPh && typeof rawPh === "object") {
        meta = { ...rawPh };
        entries = Array.isArray(rawPh.entries) ? rawPh.entries : [];
      }

      meta.entries = entries;
      meta.approvalStatus = "APPROVED_FINANCE";
      meta.financeApprovedAt = new Date();
      meta.financeApprovedBy = req.user?.name || req.user?.username || req.user?.userId || "Finance";
      meta.rejectReason = null;

      const updated = await prisma.pembayaranSupplier.update({
        where: { id: req.params.id },
        data: { paymentHistory: meta },
        include: {
          supplier: true,
          jasa: true,
          rekeningBank: { include: { tipeRekening: true } },
          tipeRekening: true,
          bukuBesarTransaksi: true,
          purchaseOrder: true,
          pengajuan: true,
        },
      });

      // Jika linked ke pengajuan, sinkronkan statusnya
      if (existing.pengajuanId) {
        await prisma.pengajuanPembayaran.update({
          where: { id: existing.pengajuanId },
          data: {
            status: "APPROVED_FINANCE",
            verifiedById: req.user?.userId || null,
            verifiedAt: new Date(),
          },
        }).catch(() => {});
      }

      res.json({
        message: "Pembayaran berhasil disetujui oleh Finance (Menunggu Approval Atasan)",
        data: enrichPembayaranApproval(updated),
      });
    } catch (error) {
      console.error("Approve Finance Error:", error);
      res.status(500).json({ error: "Gagal approve pembayaran oleh Finance" });
    }
  }
);

/**
 * PUT /api/pembayaran-supplier/:id/approve-atasan
 * Tingkat 2: Atasan menyetujui pembayaran.
 */
router.put(
  "/pembayaran-supplier/:id/approve-atasan",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "PROJECT_MANAGER"),
  async (req, res) => {
    try {
      const existing = await prisma.pembayaranSupplier.findUnique({
        where: { id: req.params.id },
        include: { pengajuan: true, bukuBesarTransaksi: true },
      });
      if (!existing) {
        return res.status(404).json({ error: "Pembayaran tidak ditemukan" });
      }

      const rawPh = existing.paymentHistory;
      let meta = {};
      let entries = [];
      if (Array.isArray(rawPh)) {
        entries = rawPh;
      } else if (rawPh && typeof rawPh === "object") {
        meta = { ...rawPh };
        entries = Array.isArray(rawPh.entries) ? rawPh.entries : [];
      }

      meta.entries = entries;
      meta.approvalStatus = "APPROVED_ATASAN";
      meta.atasanApprovedAt = new Date();
      meta.atasanApprovedBy = req.user?.name || req.user?.username || req.user?.userId || "Atasan";
      meta.rejectReason = null;

      const updated = await prisma.pembayaranSupplier.update({
        where: { id: req.params.id },
        data: { paymentHistory: meta },
        include: {
          supplier: true,
          jasa: true,
          rekeningBank: { include: { tipeRekening: true } },
          tipeRekening: true,
          bukuBesarTransaksi: true,
          purchaseOrder: true,
          pengajuan: true,
        },
      });

      res.json({
        message: "Pembayaran berhasil disetujui Atasan (Siap Kirim ke Kas/Bank)",
        data: enrichPembayaranApproval(updated),
      });
    } catch (error) {
      console.error("Approve Atasan Error:", error);
      res.status(500).json({ error: "Gagal approve pembayaran oleh Atasan" });
    }
  }
);

/**
 * POST /api/pembayaran-supplier/:id/kirim-kas-bank
 * Aksi Kirim ke Buku Kas/Bank oleh Finance setelah disetujui Atasan.
 */
router.post(
  "/pembayaran-supplier/:id/kirim-kas-bank",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "FINANCE"),
  async (req, res) => {
    try {
      const existing = await prisma.pembayaranSupplier.findUnique({
        where: { id: req.params.id },
        include: {
          supplier: true,
          jasa: true,
          rekeningBank: { include: { tipeRekening: true } },
          tipeRekening: true,
          bukuBesarTransaksi: true,
          purchaseOrder: {
            include: {
              items: { include: { materialRequest: true, rabItem: true } },
              project: { select: { id: true, name: true } },
            },
          },
          pengajuan: true,
        },
      });

      if (!existing) {
        return res.status(404).json({ error: "Pembayaran tidak ditemukan" });
      }

      const enriched = enrichPembayaranApproval(existing);
      if (enriched.approvalStatus !== "APPROVED_ATASAN" && req.user?.role !== "SUPER_ADMIN") {
        return res.status(400).json({
          error: "Pembayaran belum disetujui oleh Atasan. Harus menunggu approval Atasan di menu Permintaan Bayar.",
        });
      }

      if (enriched.isPostedKasBank) {
        return res.status(400).json({
          error: "Pembayaran ini sudah pernah dikirim/diposting ke Buku Kas/Bank.",
        });
      }

      const rawPh = existing.paymentHistory;
      let meta = {};
      let entries = [];
      if (Array.isArray(rawPh)) {
        entries = rawPh;
      } else if (rawPh && typeof rawPh === "object") {
        meta = { ...rawPh };
        entries = Array.isArray(rawPh.entries) ? rawPh.entries : [];
      }

      const nominalPosting = Number(
        req.body.nominal ??
        existing.jumlahBayar ??
        existing.totalTerbayar ??
        existing.totalTagihan ??
        0
      );

      if (nominalPosting <= 0) {
        return res.status(400).json({ error: "Nominal bayar harus > 0 untuk dikirim ke Kas/Bank" });
      }

      const tanggalBayarFinal = req.body.tanggalBayar ? new Date(req.body.tanggalBayar) : (existing.tanggalBayar || new Date());
      const rekeningBankIdFinal = req.body.rekeningBankId || existing.rekeningBankId || null;
      const tipeRekeningIdFinal = req.body.tipeRekeningId || existing.tipeRekeningId || null;
      const resolvedTipeAkunKasBank = req.body.tipeAkunKasBank || existing.tipeAkunKasBank || (rekeningBankIdFinal ? "BANK" : "KAS");

      // Generate nomor pembayaran jika belum ada
      let noPembayaranFinal = existing.noPembayaran;
      if (!noPembayaranFinal) {
        noPembayaranFinal = await buildNoPembayaran({
          pembayaranId: existing.id,
          tanggal: tanggalBayarFinal,
        });
      }

      // 1. Posting ke Buku Besar Kas/Bank
      const { createTransaksiBukuBesar } = require("./glBank.routes.js");
      const rekening = rekeningBankIdFinal
        ? await prisma.masterRekeningBank.findUnique({ where: { id: rekeningBankIdFinal } })
        : existing.rekeningBank;
      const namaAkun = (rekening ? `${rekening.namaRekening} - ${rekening.nomorRekening}` : null)
        || (resolvedTipeAkunKasBank === "BANK" ? "Bank" : "Kas Kecil");

      const po = existing.purchaseOrder;
      const { ketVolume: ketVol, ketHarga: ketHrg } = await getKeteranganVolumeHarga(po);

      const isJasaFlow = (po?.kategoriPO === "JASA") || Boolean(existing.jasaId);
      const tipeLabel =
        isJasaFlow
          ? (Number(existing.sisaBayar || 0) <= 0 ? "Pelunasan Jasa" : "Pembayaran Jasa")
          : existing.metodeBayar === "TEMPO"
            ? (Number(existing.sisaBayar || 0) <= 0 ? "Pelunasan Tempo" : "Pembayaran Tempo (Cicilan)")
            : "Pembayaran Supplier";

      let validCreatedById = null;
      const candidateUserId = req.user?.userId || req.user?.id;
      if (candidateUserId) {
        const u = await prisma.user.findUnique({
          where: { id: candidateUserId },
          select: { id: true },
        }).catch(() => null);
        if (u) validCreatedById = u.id;
      }

      const bukuBesarRes = await createTransaksiBukuBesar({
        tanggal: tanggalBayarFinal,
        tipeAkun: resolvedTipeAkunKasBank === "BANK" || rekening ? "BANK" : "KAS",
        namaAkun,
        jenis: "KELUAR",
        nominal: nominalPosting,
        noReferensi: noPembayaranFinal || req.params.id,
        pihak: existing.supplier?.name || existing.jasa?.nama || "Supplier/Jasa",
        keterangan: `${tipeLabel}${req.body.keterangan || existing.keterangan ? ` - ${req.body.keterangan || existing.keterangan}` : ""}`,
        keteranganVolume: ketVol,
        keteranganHarga: ketHrg,
        tipeRekeningId: tipeRekeningIdFinal || rekening?.tipeRekeningId || null,
        poId: po?.id || existing.poId,
        pengajuanId: existing.pengajuanId,
        pembayaranId: existing.id,
        createdById: validCreatedById,
      });

      // 2. Tandai metadata pembayaran
      meta.entries = entries;
      meta.approvalStatus = "APPROVED_ATASAN";
      meta.isPostedKasBank = true;
      meta.postedKasBankAt = new Date();
      meta.postedBy = req.user?.name || req.user?.username || req.user?.userId || "Finance";
      meta.bukuBesarId = bukuBesarRes?.id || null;

      const totalTagihan = Number(existing.totalTagihan || 0);
      const totalTerbayarBaru = Math.max(Number(existing.totalTerbayar || 0), nominalPosting);
      const sisaBayarBaru = Math.max(0, totalTagihan - totalTerbayarBaru);

      let finalStatus = existing.status;
      if (isJasaFlow) {
        finalStatus = sisaBayarBaru <= 0 ? "LUNAS" : "BON";
      } else {
        finalStatus = sisaBayarBaru <= 0 ? "PAID" : "PARTIAL";
      }

      const updated = await prisma.pembayaranSupplier.update({
        where: { id: req.params.id },
        data: {
          noPembayaran: noPembayaranFinal,
          paymentHistory: meta,
          tanggalBayar: tanggalBayarFinal,
          rekeningBankId: rekeningBankIdFinal,
          tipeRekeningId: tipeRekeningIdFinal,
          tipeAkunKasBank: resolvedTipeAkunKasBank,
          totalTerbayar: totalTerbayarBaru,
          sisaBayar: sisaBayarBaru,
          status: finalStatus,
        },
        include: {
          supplier: true,
          jasa: true,
          rekeningBank: { include: { tipeRekening: true } },
          tipeRekening: true,
          bukuBesarTransaksi: true,
          purchaseOrder: true,
          pengajuan: true,
        },
      });

      res.json({
        message: "Pembayaran berhasil dikirim dan diposting ke Buku Kas/Bank",
        data: enrichPembayaranApproval(updated),
      });
    } catch (error) {
      console.error("Kirim Kas/Bank Error:", error);
      res.status(500).json({ error: error.message || "Gagal mengirim ke Buku Kas/Bank" });
    }
  }
);

/**
 * PUT /api/pembayaran-supplier/:id/reject
 * Menolak pembayaran supplier / jasa
 */
router.put(
  "/pembayaran-supplier/:id/reject",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "FINANCE", "PROJECT_MANAGER"),
  async (req, res) => {
    try {
      const { reason = "Ditolak" } = req.body;
      const existing = await prisma.pembayaranSupplier.findUnique({
        where: { id: req.params.id },
      });
      if (!existing) {
        return res.status(404).json({ error: "Pembayaran tidak ditemukan" });
      }

      const rawPh = existing.paymentHistory;
      let meta = {};
      let entries = [];
      if (Array.isArray(rawPh)) {
        entries = rawPh;
      } else if (rawPh && typeof rawPh === "object") {
        meta = { ...rawPh };
        entries = Array.isArray(rawPh.entries) ? rawPh.entries : [];
      }

      meta.entries = entries;
      meta.approvalStatus = "REJECTED";
      meta.rejectReason = reason;
      meta.rejectedAt = new Date();
      meta.rejectedBy = req.user?.name || req.user?.username || req.user?.userId || "User";

      const updated = await prisma.pembayaranSupplier.update({
        where: { id: req.params.id },
        data: { paymentHistory: meta },
      });

      res.json({
        message: "Pembayaran berhasil ditolak",
        data: enrichPembayaranApproval(updated),
      });
    } catch (error) {
      console.error("Reject Pembayaran Error:", error);
      res.status(500).json({ error: "Gagal menolak pembayaran" });
    }
  }
);

/**
 * POST /api/pembayaran-supplier/bulk-approve-atasan
 * Atasan menyetujui beberapa permintaan bayar sekaligus di menu Permintaan Bayar
 */
router.post(
  "/pembayaran-supplier/bulk-approve-atasan",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "PROJECT_MANAGER"),
  async (req, res) => {
    try {
      const { ids = [] } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "Pilih minimal 1 pembayaran untuk disetujui" });
      }

      let successCount = 0;
      for (const id of ids) {
        const existing = await prisma.pembayaranSupplier.findUnique({
          where: { id },
        });
        if (!existing) continue;

        const rawPh = existing.paymentHistory;
        let meta = {};
        let entries = [];
        if (Array.isArray(rawPh)) {
          entries = rawPh;
        } else if (rawPh && typeof rawPh === "object") {
          meta = { ...rawPh };
          entries = Array.isArray(rawPh.entries) ? rawPh.entries : [];
        }

        meta.entries = entries;
        meta.approvalStatus = "APPROVED_ATASAN";
        meta.atasanApprovedAt = new Date();
        meta.atasanApprovedBy = req.user?.name || req.user?.username || req.user?.userId || "Atasan";
        meta.rejectReason = null;

        await prisma.pembayaranSupplier.update({
          where: { id },
          data: { paymentHistory: meta },
        });

        successCount++;
      }

      res.json({
        message: `${successCount} permintaan bayar berhasil disetujui Atasan`,
        successCount,
      });
    } catch (error) {
      console.error("Bulk Approve Atasan Error:", error);
      res.status(500).json({ error: "Gagal menyetujui pembayaran secara massal" });
    }
  }
);

/**
 * POST /api/pembayaran-supplier/bulk-reject
 * Menolak beberapa pembayaran sekaligus
 */
router.post(
  "/pembayaran-supplier/bulk-reject",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "PROJECT_MANAGER"),
  async (req, res) => {
    try {
      const { ids = [], reason = "Ditolak oleh Atasan" } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "Pilih minimal 1 pembayaran untuk ditolak" });
      }

      let successCount = 0;
      for (const id of ids) {
        const existing = await prisma.pembayaranSupplier.findUnique({
          where: { id },
        });
        if (!existing) continue;

        const rawPh = existing.paymentHistory;
        let meta = {};
        let entries = [];
        if (Array.isArray(rawPh)) {
          entries = rawPh;
        } else if (rawPh && typeof rawPh === "object") {
          meta = { ...rawPh };
          entries = Array.isArray(rawPh.entries) ? rawPh.entries : [];
        }

        meta.entries = entries;
        meta.approvalStatus = "REJECTED";
        meta.rejectReason = reason;
        meta.rejectedAt = new Date();
        meta.rejectedBy = req.user?.name || req.user?.username || req.user?.userId || "Atasan";

        await prisma.pembayaranSupplier.update({
          where: { id },
          data: { paymentHistory: meta },
        });

        successCount++;
      }

      res.json({
        message: `${successCount} pembayaran berhasil ditolak`,
        successCount,
      });
    } catch (error) {
      console.error("Bulk Reject Error:", error);
      res.status(500).json({ error: "Gagal menolak pembayaran secara massal" });
    }
  }
);


// =====================================================================
// 4. INVOICE PENAGIHAN
// =====================================================================

/**
 * GET /api/invoice-penagihan
 */
router.get("/invoice-penagihan", async (req, res) => {
  try {
    const invoices = await prisma.invoicePenagihan.findMany({
      include: {
        supplier: { select: { name: true, id: true } },
        purchaseOrder: { select: { poNumber: true, id: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(invoices);
  } catch (error) {
    console.error("Get Invoice Penagihan Error:", error);
    res.status(500).json({ error: "Gagal mengambil data invoice penagihan" });
  }
});

/**
 * GET /api/invoice-penagihan/:id
 */
router.get("/invoice-penagihan/:id", async (req, res) => {
  try {
    const invoice = await prisma.invoicePenagihan.findUnique({
      where: { id: req.params.id },
      include: {
        supplier: true,
        purchaseOrder: { include: { supplier: true, project: true } },
      },
    });
    if (!invoice)
      return res.status(404).json({ error: "Invoice tidak ditemukan" });
    res.json(invoice);
  } catch (error) {
    console.error("Get Invoice Penagihan Detail Error:", error);
    res.status(500).json({ error: "Gagal mengambil detail invoice" });
  }
});

/**
 * POST /api/invoice-penagihan
 */
router.post("/invoice-penagihan", verifyToken, async (req, res) => {
  try {
    const {
      supplierId,
      poId,
      tanggal,
    } = req.body;

    // FIX: frontend mengirim `jumlah` + `jatuhTempo`; backend memakai
    // `jumlahTagihan` + `tanggalJatuhTempo`. Dulu jumlahTagihan tersimpan 0.
    const noInvoice = req.body.noInvoice;
    const jumlahTagihan = req.body.jumlahTagihan ?? req.body.jumlah ?? 0;
    const tglJatuhTempo = req.body.tanggalJatuhTempo ?? req.body.jatuhTempo ?? null;
    const keterangan = req.body.keterangan;

    if (!supplierId || !noInvoice) {
      return res
        .status(400)
        .json({ error: "Supplier dan nomor invoice wajib diisi" });
    }

    const invoice = await prisma.invoicePenagihan.create({
      data: {
        supplierId,
        poId: poId || null,
        tanggal: new Date(tanggal),
        noInvoice,
        tanggalJatuhTempo: tglJatuhTempo
          ? new Date(tglJatuhTempo)
          : null,
        jumlahTagihan: Number(jumlahTagihan || 0),
        sisaTagihan: Number(jumlahTagihan || 0),
        keterangan,
      },
    });

    res.json({
      message: "Invoice penagihan berhasil dibuat",
      data: invoice,
    });
  } catch (error) {
    console.error("Create Invoice Penagihan Error:", error);
    res.status(500).json({ error: "Gagal membuat invoice penagihan" });
  }
});

/**
 * PUT /api/invoice-penagihan/:id
 */
router.put("/invoice-penagihan/:id", verifyToken, async (req, res) => {
  try {
    const {
      supplierId,
      poId,
      tanggal,
      noInvoice,
      tanggalJatuhTempo,
      jumlahTagihan,
      jumlahDibayar,
      statusBayar,
      keterangan,
    } = req.body;

    // Recalculate sisaTagihan & statusBayar if jumlahDibayar berubah
    let sisaTagihan = undefined;
    let newStatusBayar = statusBayar || undefined;
    if (jumlahDibayar !== undefined) {
      const dibayar = Number(jumlahDibayar || 0);
      const tagihan = Number(jumlahTagihan || 0);
      sisaTagihan = tagihan - dibayar;
      if (dibayar >= tagihan && tagihan > 0) {
        newStatusBayar = "PAID";
      } else if (dibayar > 0) {
        newStatusBayar = "PARTIAL";
      } else {
        newStatusBayar = "UNPAID";
      }
    }

    const invoice = await prisma.invoicePenagihan.update({
      where: { id: req.params.id },
      data: {
        supplierId: supplierId || undefined,
        poId: poId !== undefined ? poId : undefined,
        tanggal: tanggal ? new Date(tanggal) : undefined,
        noInvoice: noInvoice || undefined,
        tanggalJatuhTempo:
          tanggalJatuhTempo !== undefined
            ? tanggalJatuhTempo
              ? new Date(tanggalJatuhTempo)
              : null
            : undefined,
        jumlahTagihan: Number(jumlahTagihan || 0),
        jumlahDibayar:
          jumlahDibayar !== undefined ? Number(jumlahDibayar) : undefined,
        sisaTagihan,
        statusBayar: newStatusBayar,
        keterangan,
      },
    });

    res.json({ message: "Invoice diupdate", data: invoice });
  } catch (error) {
    console.error("Update Invoice Penagihan Error:", error);
    if (error.code === "P2025") {
      return res.status(404).json({ error: "Invoice tidak ditemukan" });
    }
    res.status(500).json({ error: "Gagal update invoice" });
  }
});

// =====================================================================
// 5. LAPORAN HARIAN PEMBELIAN
// =====================================================================

/**
 * GET /api/laporan-harian?tanggal=YYYY-MM-DD
 * Aggregate: PO + retur + pembayaran per hari
 */
router.get("/laporan-harian", async (req, res) => {
  try {
    const { tanggal } = req.query;
    if (!tanggal) {
      return res.status(400).json({ error: "Parameter tanggal wajib diisi" });
    }

    const start = new Date(tanggal + "T00:00:00");
    const end = new Date(tanggal + "T23:59:59");

    const [pos, returs, pembayarans] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where: { tanggal: { gte: start, lte: end } },
        include: {
          supplier: { select: { name: true } },
          items: { select: { total: true } },
        },
      }),
      prisma.returPembelian.findMany({
        where: { tanggal: { gte: start, lte: end } },
        include: {
          supplier: { select: { name: true } },
          items: { select: { total: true } },
        },
      }),
      prisma.pembayaranSupplier.findMany({
        where: { tanggal: { gte: start, lte: end } },
        include: {
          supplier: { select: { name: true } },
        },
      }),
    ]);

    const totalPO = pos.reduce(
      (sum, po) => sum + Number(po.grandTotal || 0),
      0,
    );
    const totalRetur = returs.reduce(
      (sum, r) => sum + Number(r.totalNominal || 0),
      0,
    );
    const totalPembayaran = pembayarans.reduce(
      (sum, p) => sum + Number(p.jumlahBayar || 0),
      0,
    );

    res.json({
      tanggal,
      summary: {
        jumlahPO: pos.length,
        totalPO,
        jumlahRetur: returs.length,
        totalRetur,
        jumlahPembayaran: pembayarans.length,
        totalPembayaran,
        netPembelian: totalPO - totalRetur,
      },
      detail: {
        purchaseOrders: pos,
        returPembelian: returs,
        pembayaranSupplier: pembayarans,
      },
    });
  } catch (error) {
    console.error("Get Laporan Harian Error:", error);
    res.status(500).json({ error: "Gagal mengambil laporan harian" });
  }
});

/**
 * GET /api/laporan-harian/range?from=&to=
 * Range laporan
 */
router.get("/laporan-harian/range", async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) {
      return res
        .status(400)
        .json({ error: "Parameter from dan to wajib diisi" });
    }

    const start = new Date(from + "T00:00:00");
    const end = new Date(to + "T23:59:59");

    const [pos, returs, pembayarans] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where: { tanggal: { gte: start, lte: end } },
        include: { supplier: { select: { name: true } } },
        orderBy: { tanggal: "asc" },
      }),
      prisma.returPembelian.findMany({
        where: { tanggal: { gte: start, lte: end } },
        include: { supplier: { select: { name: true } } },
        orderBy: { tanggal: "asc" },
      }),
      prisma.pembayaranSupplier.findMany({
        where: { tanggal: { gte: start, lte: end } },
        include: { supplier: { select: { name: true } } },
        orderBy: { tanggal: "asc" },
      }),
    ]);

    // Group by date
    const grouped = {};
    const allDates = new Set([
      ...pos.map((p) => p.tanggal.toISOString().slice(0, 10)),
      ...returs.map((r) => r.tanggal.toISOString().slice(0, 10)),
      ...pembayarans.map((p) => p.tanggal.toISOString().slice(0, 10)),
    ]);

    for (const date of allDates) {
      const dayPO = pos.filter(
        (p) => p.tanggal.toISOString().slice(0, 10) === date,
      );
      const dayRetur = returs.filter(
        (r) => r.tanggal.toISOString().slice(0, 10) === date,
      );
      const dayPembayaran = pembayarans.filter(
        (p) => p.tanggal.toISOString().slice(0, 10) === date,
      );

      grouped[date] = {
        tanggal: date,
        jumlahPO: dayPO.length,
        totalPO: dayPO.reduce(
          (s, p) => s + Number(p.grandTotal || 0),
          0,
        ),
        jumlahRetur: dayRetur.length,
        totalRetur: dayRetur.reduce(
          (s, r) => s + Number(r.totalNominal || 0),
          0,
        ),
        jumlahPembayaran: dayPembayaran.length,
        totalPembayaran: dayPembayaran.reduce(
          (s, p) => s + Number(p.jumlahBayar || 0),
          0,
        ),
      };
    }

    const sortedKeys = Object.keys(grouped).sort();
    const sortedGrouped = sortedKeys.map((k) => grouped[k]);

    const grandTotalPO = pos.reduce(
      (s, p) => s + Number(p.grandTotal || 0),
      0,
    );
    const grandTotalRetur = returs.reduce(
      (s, r) => s + Number(r.totalNominal || 0),
      0,
    );
    const grandTotalPembayaran = pembayarans.reduce(
      (s, p) => s + Number(p.jumlahBayar || 0),
      0,
    );

    res.json({
      from,
      to,
      summary: {
        totalPO: grandTotalPO,
        totalRetur: grandTotalRetur,
        totalPembayaran: grandTotalPembayaran,
        netPembelian: grandTotalPO - grandTotalRetur,
      },
      detailPerHari: sortedGrouped,
    });
  } catch (error) {
    console.error("Get Laporan Harian Range Error:", error);
    res.status(500).json({ error: "Gagal mengambil laporan range" });
  }
});

module.exports = router;
