"use strict";

const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const PDFDocument = require("pdfkit");
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
        createdBy: { select: { name: true, id: true } },
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
  authorizeRoles("OWNER", "FINANCE"),
  async (req, res) => {
    try {
      const existing = await prisma.pengajuanPembayaran.findUnique({
        where: { id: req.params.id },
      });
      if (!existing) {
        return res
          .status(404)
          .json({ error: "Pengajuan pembayaran tidak ditemukan" });
      }
      if (existing.status === "APPROVED") {
        return res
          .status(400)
          .json({ error: "Pengajuan sudah di-approve atasan, tidak perlu verifikasi lagi." });
      }
      if (existing.status === "APPROVED_FINANCE") {
        return res
          .status(400)
          .json({ error: "Pengajuan sudah diverifikasi Finance. Menunggu approval atasan." });
      }
      if (existing.status === "REJECTED") {
        return res
          .status(400)
          .json({ error: "Pengajuan sudah ditolak, batalkan reject dulu." });
      }
      if (existing.status !== "PENDING") {
        return res
          .status(400)
          .json({ error: `Status pengajuan tidak valid untuk verifikasi (${existing.status})` });
      }

      const pengajuan = await prisma.pengajuanPembayaran.update({
        where: { id: req.params.id },
        data: {
          status: "APPROVED_FINANCE",
          verifiedById: req.user?.userId || null,
          verifiedAt: new Date(),
          rejectReason: null,
        },
      });

      // Sinkronkan status approval di pembayaranSupplier terkait (jika sudah ada)
      try {
        const list = await prisma.pembayaranSupplier.findMany({
          where: {
            OR: [
              { pengajuanId: existing.id },
              ...(existing.poId ? [{ poId: existing.poId }] : []),
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
          meta.approvalStatus = "APPROVED_FINANCE";
          meta.financeVerifiedAt = new Date();
          meta.financeVerifiedBy =
            req.user?.name || req.user?.username || req.user?.userId || "Finance";
          meta.rejectReason = null;
          await prisma.pembayaranSupplier.update({
            where: { id: item.id },
            data: { paymentHistory: meta },
          });
        }
      } catch (syncErr) {
        console.error("Sync pembayaran to APPROVED_FINANCE error:", syncErr);
      }

      return res.json({
        message: "Pengajuan bayar diverifikasi Finance",
        data: pengajuan,
      });
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
 * Sinkronkan status approval pembayaranSupplier setelah pengajuan bayar disetujui Atasan.
 * Hasil sinkron = draft PENDING (belum masuk approval Finance sampai user edit nominal bayar).
 */
const syncPembayaranToPending = async (pengajuanId, poId) => {
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

      // Jangan rollback data yang sudah diposting ke kas/bank
      if (Boolean(meta.isPostedKasBank)) {
        continue;
      }

      meta.entries = entries;
      meta.approvalStatus = "PENDING";
      meta.financeApprovedAt = null;
      meta.financeApprovedBy = null;
      meta.atasanApprovedAt = null;
      meta.atasanApprovedBy = null;
      meta.rejectReason = null;

      await prisma.pembayaranSupplier.update({
        where: { id: item.id },
        data: { paymentHistory: meta },
      });
    }
  } catch (err) {
    console.error("Sync pembayaran to pending error:", err);
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
  authorizeRoles("OWNER", "FINANCE", "ADMIN"),
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
      if (existing.status !== "APPROVED_FINANCE") {
        return res.status(400).json({
          error:
            "Pengajuan belum diverifikasi Finance. Minta Finance verifikasi di halaman Pembayaran Finance terlebih dahulu.",
        });
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
              status: "PENDING",
              noPembayaran: poForPayment.kategoriPO === "JASA" ? null : undefined,
              paymentHistory: {
                entries: [],
                approvalStatus: "PENDING",
                isPostedKasBank: false,
                financeApprovedAt: null,
                financeApprovedBy: null,
                atasanApprovedAt: null,
                atasanApprovedBy: null,
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

      // Sinkronkan status pembayaranSupplier terkait kembali ke draft PENDING
      await syncPembayaranToPending(existing.id, existing.poId);
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
  authorizeRoles("OWNER", "FINANCE", "ADMIN"),
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
  authorizeRoles("OWNER", "FINANCE", "ADMIN"),
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

      // Kalau pengajuan ditolak, PO terkait ditandai REJECTED agar bisa diedit ulang oleh Purchasing
      if (existing.poId) {
        await prisma.purchaseOrder.update({
          where: { id: existing.poId },
          data: {
            status: "REJECTED",
            rejectReason: String(reason).trim(),
            rejectedAt: new Date(),
            rejectedById: req.user?.userId || null,
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
  authorizeRoles("OWNER", "FINANCE", "ADMIN"),
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
                approvalStatus: "PENDING",
                isPostedKasBank: false,
                financeApprovedAt: null,
                financeApprovedBy: null,
                atasanApprovedAt: null,
                atasanApprovedBy: null,
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
        await syncPembayaranToPending(existing.id, existing.poId);
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
  authorizeRoles("OWNER", "FINANCE", "ADMIN"),
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
        // ENFORCE two-step approval: hanya proses yg sudah diverifikasi Finance
        if (existing.status !== "APPROVED_FINANCE") continue;

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
                  approvalStatus: "PENDING",
                  isPostedKasBank: false,
                  financeApprovedAt: null,
                  financeApprovedBy: null,
                  atasanApprovedAt: null,
                  atasanApprovedBy: null,
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
          await syncPembayaranToPending(existing.id, existing.poId);
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
  authorizeRoles("OWNER", "FINANCE", "ADMIN"),
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
              status: "REJECTED",
              rejectReason: reason,
              rejectedAt: new Date(),
              rejectedById: req.user?.userId || null,
              approvedById: null,
              approvedAt: null,
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

const normalizePembayaranApprovalStatus = (status) => {
  const s = String(status || "").toUpperCase();
  if (!s || s === "MENUNGGU_FINANCE") return "PENDING";
  if (s === "APPROVED_ATASAN") return "APPROVED";
  if (["PENDING", "APPROVED_FINANCE", "APPROVED", "REJECTED"].includes(s)) return s;
  return s;
};

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

  let approvalStatus = normalizePembayaranApprovalStatus(phMeta.approvalStatus);
  if (!approvalStatus) {
    if (isPosted) {
      approvalStatus = "APPROVED";
    } else if (pembayaran.pengajuan?.status === "APPROVED") {
      // Pengajuan bayar sudah disetujui Atasan, tetapi pembayaran masih draft
      approvalStatus = "PENDING";
    } else if (pembayaran.pengajuan?.status === "APPROVED_FINANCE") {
      approvalStatus = "APPROVED_FINANCE";
    } else {
      approvalStatus = "PENDING";
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

/**
 * Menghitung progress Join Opname (JO) proyek dan plafon maksimal pembayaran jasa
 */
async function getJoinOpnameProgressForPembayaran(pembayaran) {
  try {
    const po = pembayaran.purchaseOrder;
    const projectId = po?.projectId || pembayaran.pengajuan?.projectId;
    const totalTagihan = Math.max(
      0,
      Number(
        pembayaran.totalTagihan ||
        po?.grandTotal ||
        po?.subTotal ||
        0
      )
    );
    const totalTerbayar = Math.max(0, Number(pembayaran.totalTerbayar || 0));

    if (!projectId) {
      return {
        progressJoPercent: 100,
        totalTagihan,
        maxPlafonBayar: totalTagihan,
        totalTerbayar,
        sisaPlafonBayar: Math.max(0, totalTagihan - totalTerbayar),
      };
    }

    const rabItems = await prisma.rabItem.findMany({
      where: { projectId },
      include: {
        dailyProgress: true,
        bvItem: { select: { id: true, parentBvItemId: true } },
      },
    });

    if (!rabItems || rabItems.length === 0) {
      return {
        progressJoPercent: 100,
        totalTagihan,
        maxPlafonBayar: totalTagihan,
        totalTerbayar,
        sisaPlafonBayar: Math.max(0, totalTagihan - totalTerbayar),
      };
    }

    const parentIds = new Set(
      rabItems.map((it) => it.bvItem?.parentBvItemId).filter(Boolean)
    );

    const leafItems = rabItems.filter((it) => !parentIds.has(it.bvItem?.id));
    const totalContract = leafItems.reduce(
      (sum, it) => sum + Number(it.rapTotalPrice || 0),
      0
    );

    let progressSum = 0;
    leafItems.forEach((it) => {
      const itemRap = Number(it.rapTotalPrice || 0);
      const sumProg = (it.dailyProgress || []).reduce(
        (s, p) => s + Number(p.progressPercent || 0),
        0
      );
      const rekapProgress = Math.min(100, Math.max(0, sumProg));
      if (totalContract > 0) {
        const weight = (itemRap / totalContract) * 100;
        progressSum += weight * (rekapProgress / 100);
      }
    });

    const progressJoPercent = Math.min(100, Math.round(progressSum * 100) / 100);
    const maxPlafonBayar = Math.round((progressJoPercent / 100) * totalTagihan);
    const sisaPlafonBayar = Math.max(0, maxPlafonBayar - totalTerbayar);

    return {
      progressJoPercent,
      totalTagihan,
      maxPlafonBayar,
      totalTerbayar,
      sisaPlafonBayar,
    };
  } catch (err) {
    console.error("Error getJoinOpnameProgressForPembayaran:", err);
    const totalTagihan = Number(pembayaran.totalTagihan || 0);
    const totalTerbayar = Number(pembayaran.totalTerbayar || 0);
    return {
      progressJoPercent: 100,
      totalTagihan,
      maxPlafonBayar: totalTagihan,
      totalTerbayar,
      sisaPlafonBayar: Math.max(0, totalTagihan - totalTerbayar),
    };
  }
}

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
            supplier: { select: { id: true, name: true, type: true } },
            jasa: { select: { id: true, nama: true } },
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

router.get("/pembayaran-supplier/:id/jo-progress", async (req, res) => {
  try {
    const pembayaran = await prisma.pembayaranSupplier.findUnique({
      where: { id: req.params.id },
      include: {
        purchaseOrder: { include: { project: true } },
        pengajuan: true,
      },
    });
    if (!pembayaran) return res.status(404).json({ error: "Pembayaran tidak ditemukan" });
    const joData = await getJoinOpnameProgressForPembayaran(pembayaran);
    res.json(joData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

    const initialApprovalStatus = "PENDING";

    const initialPaymentHistory = {
      entries: paymentHistoryEntries,
      approvalStatus: initialApprovalStatus,
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

    // Deteksi jika user sedang merevisi pengajuan pembayaran yang sebelumnya ditolak
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

    const isRejectedRevision =
      existingMeta.approvalStatus === "REJECTED" ||
      existing.approvalStatus === "REJECTED" ||
      Boolean(req.body.isRevisi);

    let baseTerbayar = existingTerbayar;
    let rejectedEntryIndex = -1;

    if (isRejectedRevision && existingEntries.length > 0) {
      // Cari entry terakhir yang ditolak
      rejectedEntryIndex = existingEntries.map(e => e.approvalStatus).lastIndexOf("REJECTED");
      if (rejectedEntryIndex === -1) rejectedEntryIndex = existingEntries.length - 1;
      const rejectedEntry = existingEntries[rejectedEntryIndex];
      const rejectedNominal = Number(rejectedEntry?.jumlah || 0);
      baseTerbayar = Math.max(0, existingTerbayar - rejectedNominal);
    }

    if (tambahPembayaran) {
      if (jumlahInput <= 0) {
        return res.status(400).json({ error: "Nominal cicilan/pelunasan harus > 0" });
      }
      totalTerbayarBaru = isRejectedRevision
        ? baseTerbayar + jumlahInput
        : existingTerbayar + jumlahInput;
    } else if (jumlahBayar !== undefined && jumlahBayar !== null && jumlahBayar !== "") {
      totalTerbayarBaru = jumlahInput;
    }

    if (totalTagihan > 0 && totalTerbayarBaru > totalTagihan) {
      return res.status(400).json({ error: "Total pembayaran melebihi total tagihan" });
    }

    if (isJasaFlow && (tambahPembayaran || (jumlahBayar !== undefined && jumlahBayar !== null && jumlahBayar !== ""))) {
      const joData = await getJoinOpnameProgressForPembayaran(existing);
      if (joData.progressJoPercent <= 0 && totalTerbayarBaru > 0) {
        return res.status(400).json({
          error: "Progress Join Opname (JO) pekerjaan ini masih 0%. Belum dapat melakukan pembayaran jasa/subkon.",
          progressJo: 0,
        });
      }
      if (totalTerbayarBaru > joData.maxPlafonBayar + 100) {
        return res.status(400).json({
          error: `Total pembayaran (Rp ${totalTerbayarBaru.toLocaleString('id-ID')}) melebihi plafon progress Join Opname (${joData.progressJoPercent}% = Rp ${joData.maxPlafonBayar.toLocaleString('id-ID')}). Maksimal pembayaran saat ini: Rp ${joData.sisaPlafonBayar.toLocaleString('id-ID')}`,
          progressJo: joData.progressJoPercent,
          maxPlafon: joData.maxPlafonBayar,
          sisaPlafon: joData.sisaPlafonBayar,
        });
      }
    }

    const sisaBayarBaru = Math.max(totalTagihan - totalTerbayarBaru, 0);

    let autoStatus = "TEMPO";
    if (isJasaFlow) {
      if (totalTagihan > 0 && totalTerbayarBaru >= totalTagihan) autoStatus = "LUNAS";
      else if (totalTerbayarBaru > 0) autoStatus = "BON";
      else autoStatus = "BELUM_BAYAR";
    } else {
      if (totalTagihan > 0 && totalTerbayarBaru >= totalTagihan) autoStatus = "LUNAS";
      else autoStatus = "TEMPO";
    }

    if (status && ["PENDING", "PARTIAL", "PAID", "BELUM_BAYAR", "BON", "LUNAS", "TEMPO"].includes(status)) {
      autoStatus = status === "PAID" ? "LUNAS" : status === "PARTIAL" ? "TEMPO" : status;
    }

    const nominalJurnal = isRejectedRevision
      ? jumlahInput
      : Math.max(totalTerbayarBaru - existingTerbayar, 0);

    const resolvedTipeAkunKasBank =
      tipeAkunKasBank || existing.tipeAkunKasBank || (rekeningBankId || existing.rekeningBankId ? "BANK" : "KAS");

    const newEntryObj = {
      id: (isRejectedRevision && rejectedEntryIndex >= 0 && existingEntries[rejectedEntryIndex]?.id) || `PMT-${Date.now()}`,
      tanggal: (tanggalBayarFinal || new Date()).toISOString(),
      jumlah: nominalJurnal > 0 ? nominalJurnal : jumlahInput,
      metodeBayar: metodeFinal,
      rekeningBankId: rekeningBankId || existing.rekeningBankId || null,
      tipeAkunKasBank: resolvedTipeAkunKasBank,
      tipeRekeningId: tipeRekeningId || existing.tipeRekeningId || null,
      tipeEntry:
        metodeFinal === "TEMPO"
          ? (sisaBayarBaru <= 0 ? "PELUNASAN_TEMPO" : "CICILAN_TEMPO")
          : "PEMBAYARAN",
      keterangan: keterangan || null,
      createdById: req.user?.userId || req.user?.id || null,
      createdByName: req.user?.name || req.user?.username || "Staf",
      approvalStatus: "PENDING",
      financeApprovedAt: null,
      financeApprovedBy: null,
      atasanApprovedAt: null,
      atasanApprovedBy: null,
      isPostedKasBank: false,
      postedKasBankAt: null,
      postedBy: null,
    };

    if (isRejectedRevision && rejectedEntryIndex >= 0) {
      existingEntries[rejectedEntryIndex] = newEntryObj;
    } else if (nominalJurnal > 0 || (tambahPembayaran && jumlahInput > 0)) {
      existingEntries.push(newEntryObj);
    }

    const currentApprovalStatus = normalizePembayaranApprovalStatus(existingMeta.approvalStatus || "PENDING");
    const isNewAction = nominalJurnal > 0 || isRejectedRevision || (tambahPembayaran && jumlahInput > 0);

    const updatedPaymentHistory = {
      ...existingMeta,
      entries: existingEntries,
      approvalStatus: isNewAction ? "PENDING" : currentApprovalStatus,
      isPostedKasBank: isNewAction ? false : Boolean(existingMeta.isPostedKasBank),
      ...(isNewAction
        ? {
            financeApprovedAt: null,
            financeApprovedBy: null,
            atasanApprovedAt: null,
            atasanApprovedBy: null,
            postedKasBankAt: null,
            postedBy: null,
            rejectReason: null,
            rejectedAt: null,
            rejectedBy: null,
          }
        : {}),
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
  authorizeRoles("OWNER", "FINANCE"),
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

      // Guard: hanya PENDING -> APPROVED_FINANCE
      const currentStatus = normalizePembayaranApprovalStatus(meta.approvalStatus || "PENDING");
      if (!["PENDING"].includes(currentStatus)) {
        return res.status(400).json({
          error:
            currentStatus === "APPROVED"
              ? "Pembayaran sudah disetujui Atasan, tidak perlu approve Finance lagi."
              : currentStatus === "APPROVED_FINANCE"
                ? "Pembayaran sudah disetujui Finance. Tunggu approval Atasan."
                : "Pembayaran sudah ditolak. Batalkan reject terlebih dahulu.",
        });
      }

      meta.entries = entries;
      const pendingEntry = [...meta.entries].reverse().find(e => !e.approvalStatus || e.approvalStatus === "PENDING");
      if (pendingEntry) {
        pendingEntry.approvalStatus = "APPROVED_FINANCE";
        pendingEntry.financeApprovedAt = new Date();
        pendingEntry.financeApprovedBy = req.user?.name || req.user?.username || req.user?.userId || "Finance";
      }
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
  authorizeRoles("OWNER", "FINANCE", "ADMIN"),
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

      // Guard: hanya APPROVED_FINANCE -> APPROVED
      const currentStatus = normalizePembayaranApprovalStatus(meta.approvalStatus || "PENDING");
      if (currentStatus !== "APPROVED_FINANCE") {
        return res.status(400).json({
          error:
            "Pembayaran belum diverifikasi Finance. Minta Finance approve di halaman Pembayaran Finance terlebih dahulu.",
        });
      }

      meta.entries = entries;
      const awaitingEntry = [...meta.entries].reverse().find(e => e.approvalStatus === "APPROVED_FINANCE");
      if (awaitingEntry) {
        awaitingEntry.approvalStatus = "APPROVED";
        awaitingEntry.atasanApprovedAt = new Date();
        awaitingEntry.atasanApprovedBy = req.user?.name || req.user?.username || req.user?.userId || "Atasan";
      }
      meta.approvalStatus = "APPROVED";
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
  authorizeRoles("OWNER", "FINANCE"),
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
      if (enriched.approvalStatus !== "APPROVED" && req.user?.role !== "OWNER") {
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
      const approvedEntry = [...meta.entries].reverse().find(e => e.approvalStatus === "APPROVED" && !e.isPostedKasBank);
      if (approvedEntry) {
        approvedEntry.isPostedKasBank = true;
        approvedEntry.postedKasBankAt = new Date();
        approvedEntry.postedBy = req.user?.name || req.user?.username || req.user?.userId || "Finance";
      }
      meta.approvalStatus = "APPROVED";
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
        finalStatus = sisaBayarBaru <= 0 ? "LUNAS" : "TEMPO";
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
  authorizeRoles("OWNER", "FINANCE", "ADMIN"),
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
  authorizeRoles("OWNER", "ADMIN"),
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
        meta.approvalStatus = "APPROVED";
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
  authorizeRoles("OWNER", "ADMIN"),
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
// 3.1 INVOICE PDF PEMBAYARAN SUPPLIER
// =====================================================================

function fmtDateId(d) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function streamSupplierInvoicePdf(res, {
  pembayaran,
  entry,
  logoPath,
}) {
  const doc = new PDFDocument({ size: "A4", margin: 36, bufferPages: true });
  doc.pipe(res);

  const po = pembayaran.purchaseOrder || {};
  const supplier = pembayaran.supplier || po.supplier || {};
  const project = po.project || {};
  const rekening = pembayaran.rekeningBank || {};

  const isJasa = Boolean(pembayaran.jasa || po.jasa || po.isJasa || (po.poNumber && po.poNumber.startsWith("POJ")));
  const docTitle = isJasa ? "INVOICE JASA / SUBKON" : "INVOICE SUPPLIER";
  const partyHeaderLabel = isJasa ? "INFORMASI MITRA JASA & PROYEK" : "INFORMASI SUPPLIER & PROYEK";
  const partyLabel = isJasa ? "Mitra Jasa" : "Supplier";
  const partyName = isJasa
    ? (pembayaran.jasa?.nama || po.jasa?.nama || "-")
    : (supplier.name || "-");
  const partyContact = isJasa
    ? (pembayaran.jasa?.telepon || pembayaran.jasa?.kontak || "-")
    : (supplier.phone || supplier.contact || "-");
  const itemsSectionTitle = isJasa ? "Rincian Pekerjaan Jasa / SPK" : "Rincian Barang / Material PO";
  const itemsTableHeader = isJasa ? "Nama Pekerjaan / Deskripsi" : "Nama Barang / Deskripsi";

  const noPembayaran = pembayaran.noPembayaran || `INV-${pembayaran.id.slice(0, 8).toUpperCase()}`;
  const tanggalDoc = entry?.tanggal || pembayaran.tanggalBayar || pembayaran.tanggal || new Date();
  const totalTagihan = Number(pembayaran.totalTagihan || po.grandTotal || po.subTotal || 0);
  const totalTerbayar = Number(pembayaran.totalTerbayar || pembayaran.jumlahBayar || 0);
  const sisaBayar = Math.max(0, totalTagihan - totalTerbayar);
  const nominalAction = entry ? Number(entry.jumlah || 0) : Number(pembayaran.jumlahBayar || 0);

  const isLunas = totalTagihan > 0 && totalTerbayar >= totalTagihan;
  const statusBayarLabel = isLunas ? "LUNAS" : (isJasa ? "BON" : "TEMPO");
  const approvalStatusLabel = String(entry?.approvalStatus || pembayaran.approvalStatus || "APPROVED").toUpperCase();

  const financeApprovedBy = entry?.financeApprovedBy || pembayaran.financeApprovedBy || "-";
  const financeApprovedAt = entry?.financeApprovedAt || pembayaran.financeApprovedAt;
  const atasanApprovedBy = entry?.atasanApprovedBy || pembayaran.atasanApprovedBy || "-";
  const atasanApprovedAt = entry?.atasanApprovedAt || pembayaran.atasanApprovedAt;

  // Header Banner
  doc.save();
  doc.rect(0, 0, doc.page.width, 100).fill("#1A1917");
  doc.rect(0, 97, doc.page.width, 3).fill("#D4AF37");

  // Logo
  if (logoPath && fs.existsSync(logoPath)) {
    try {
      doc.image(logoPath, 36, 26, { height: 48, fit: [140, 48] });
    } catch (_) {}
  } else {
    doc.fillColor("#D4AF37").fontSize(18).font("Helvetica-Bold").text("DIVES", 36, 35);
  }

  // Header Title
  doc.fillColor("#D4AF37").fontSize(18).font("Helvetica-Bold").text(docTitle, 300, 26, { align: "right", width: 255 });
  doc.fillColor("#FFFFFF").fontSize(10).font("Helvetica-Bold").text(`No: ${noPembayaran}`, 300, 48, { align: "right", width: 255 });
  doc.fillColor("#A3A3A3").fontSize(9).font("Helvetica").text(`Tanggal: ${fmtDateId(tanggalDoc)}`, 300, 64, { align: "right", width: 255 });
  doc.restore();

  // Status Badges Bar
  let y = 112;
  const badgeWidth = 140;
  const badgeHeight = 22;

  // Badge Status Bayar
  const bayarBg = isLunas ? "#ECFDF5" : "#FFFBEB";
  const bayarStroke = isLunas ? "#10B981" : "#F59E0B";
  const bayarText = isLunas ? "#065F46" : "#92400E";
  doc.roundedRect(36, y, badgeWidth, badgeHeight, 4).fillAndStroke(bayarBg, bayarStroke);
  doc.fillColor(bayarText).font("Helvetica-Bold").fontSize(9).text(`STATUS: ${statusBayarLabel}`, 42, y + 6, { width: badgeWidth - 12, align: "center" });

  // Badge Status Approval
  const appBg = approvalStatusLabel === "APPROVED" ? "#ECFDF5" : "#EFF6FF";
  const appStroke = approvalStatusLabel === "APPROVED" ? "#10B981" : "#3B82F6";
  const appText = approvalStatusLabel === "APPROVED" ? "#065F46" : "#1E40AF";
  doc.roundedRect(186, y, badgeWidth + 30, badgeHeight, 4).fillAndStroke(appBg, appStroke);
  doc.fillColor(appText).font("Helvetica-Bold").fontSize(9).text(`APPROVAL: ${approvalStatusLabel === "APPROVED" ? "APPROVED (ATASAN)" : approvalStatusLabel}`, 192, y + 6, { width: badgeWidth + 18, align: "center" });

  // Two Column Information Cards
  y = 144;
  const cardW = 252;
  const cardH = 92;

  // Left Card: Supplier/Jasa & PO Info
  doc.roundedRect(36, y, cardW, cardH, 6).fillAndStroke("#F9FAFB", "#E5E7EB");
  doc.fillColor("#111827").font("Helvetica-Bold").fontSize(9.5).text(partyHeaderLabel, 46, y + 8);
  doc.font("Helvetica").fontSize(8.5).fillColor("#6B7280");
  doc.text(partyLabel, 46, y + 26);
  doc.text("Proyek", 46, y + 42);
  doc.text(isJasa ? "No SPK/PO" : "No PO", 46, y + 58);
  doc.text("Kontak / HP", 46, y + 74);

  doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#111827");
  doc.text(`: ${partyName}`, 110, y + 26, { width: cardW - 120, lineBreak: false });
  doc.text(`: ${project.name || "-"}`, 110, y + 42, { width: cardW - 120, lineBreak: false });
  doc.text(`: ${po.poNumber || "-"}`, 110, y + 58, { width: cardW - 120, lineBreak: false });
  doc.text(`: ${partyContact}`, 110, y + 74, { width: cardW - 120, lineBreak: false });

  // Right Card: Payment & Approval Info
  const rightX = 302;
  doc.roundedRect(rightX, y, cardW, cardH, 6).fillAndStroke("#F9FAFB", "#E5E7EB");
  doc.fillColor("#111827").font("Helvetica-Bold").fontSize(9.5).text("INFORMASI PEMBAYARAN", rightX + 10, y + 8);
  doc.font("Helvetica").fontSize(8.5).fillColor("#6B7280");
  doc.text("Metode Bayar", rightX + 10, y + 26);
  doc.text("Rekening Bank", rightX + 10, y + 42);
  doc.text("Verif. Finance", rightX + 10, y + 58);
  doc.text("Appr. Atasan", rightX + 10, y + 74);

  const rekLabel = rekening.namaRekening ? `${rekening.namaRekening} - ${rekening.nomorRekening}` : (pembayaran.tipeAkunKasBank || "KAS / BANK");
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#111827");
  doc.text(`: ${entry?.metodeBayar || pembayaran.metodeBayar || "TRANSFER"}`, rightX + 85, y + 26, { width: cardW - 95, lineBreak: false });
  doc.text(`: ${rekLabel}`, rightX + 85, y + 42, { width: cardW - 95, lineBreak: false });
  doc.text(`: ${financeApprovedBy} ${financeApprovedAt ? `(${fmtDateId(financeApprovedAt)})` : ""}`, rightX + 85, y + 58, { width: cardW - 95, lineBreak: false });
  doc.text(`: ${atasanApprovedBy} ${atasanApprovedAt ? `(${fmtDateId(atasanApprovedAt)})` : ""}`, rightX + 85, y + 74, { width: cardW - 95, lineBreak: false });

  // Table of Items
  y = 248;
  doc.fillColor("#111827").font("Helvetica-Bold").fontSize(10).text(itemsSectionTitle, 36, y);

  y += 16;
  const tableX = 36;
  const colWidths = [26, 215, 60, 48, 85, 84]; // sum = 518
  const tableHeaders = ["No", itemsTableHeader, "Qty", "Satuan", "Harga Satuan", "Total (Rp)"];

  doc.rect(tableX, y, 518, 20).fill("#2A2723");
  doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(8);
  let curX = tableX;
  tableHeaders.forEach((th, idx) => {
    const align = (idx === 2 || idx === 4 || idx === 5) ? "right" : (idx === 3 || idx === 0) ? "center" : "left";
    doc.text(th, curX + 4, y + 5, { width: colWidths[idx] - 8, align });
    curX += colWidths[idx];
  });

  y += 20;
  const items = po.items || [];
  const maxDisplayItems = Math.min(items.length, 10);

  doc.font("Helvetica").fontSize(8).fillColor("#1F2937");
  for (let i = 0; i < maxDisplayItems; i++) {
    const it = items[i];
    const itemName = it.description || it.materialRequest?.itemName || it.rabItem?.name || `Item ${i + 1}`;
    const qty = Number(it.qty || 0);
    const unit = it.unit || it.materialRequest?.unit || "-";
    const unitPrice = Number(it.unitPrice || 0);
    const itemTotal = Number(it.total || qty * unitPrice || 0);

    const rowBg = i % 2 === 1 ? "#F9FAFB" : "#FFFFFF";
    doc.rect(tableX, y, 518, 18).fillAndStroke(rowBg, "#F3F4F6");

    doc.fillColor("#374151");
    doc.text(String(i + 1), tableX + 4, y + 5, { width: colWidths[0] - 8, align: "center" });
    doc.text(itemName, tableX + colWidths[0] + 4, y + 5, { width: colWidths[1] - 8, ellipsis: true });
    doc.text(qty.toLocaleString("id-ID", { maximumFractionDigits: 2 }), tableX + colWidths[0] + colWidths[1] + 4, y + 5, { width: colWidths[2] - 8, align: "right" });
    doc.text(unit, tableX + colWidths[0] + colWidths[1] + colWidths[2] + 4, y + 5, { width: colWidths[3] - 8, align: "center" });
    doc.text(fmtRp(unitPrice), tableX + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + 4, y + 5, { width: colWidths[4] - 8, align: "right" });
    doc.font("Helvetica-Bold").text(fmtRp(itemTotal), tableX + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4] + 4, y + 5, { width: colWidths[5] - 8, align: "right" });
    doc.font("Helvetica");

    y += 18;
  }

  if (items.length === 0) {
    doc.rect(tableX, y, 518, 22).fillAndStroke("#FFFFFF", "#E5E7EB");
    doc.fillColor("#9CA3AF").text(isJasa ? "Detail item pekerjaan tercantum pada SPK / Kontrak Jasa resmi." : "Detail item barang tidak tersedia.", tableX, y + 6, { width: 518, align: "center" });
    y += 22;
  } else if (items.length > maxDisplayItems) {
    doc.rect(tableX, y, 518, 16).fillAndStroke("#F3F4F6", "#E5E7EB");
    doc.fillColor("#6B7280").fontSize(7.5).text(`... dan ${items.length - maxDisplayItems} item lainnya tercantum pada dokumen ${isJasa ? "SPK Jasa" : "Purchase Order"} resmi`, tableX, y + 4, { width: 518, align: "center" });
    y += 16;
  }

  // Summary & Notes
  y += 12;
  const summaryBoxW = 240;
  const summaryBoxX = 518 + tableX - summaryBoxW;
  const leftBoxW = 265;

  const entries = (pembayaran.paymentHistory && Array.isArray(pembayaran.paymentHistory))
    ? pembayaran.paymentHistory
    : (pembayaran.paymentHistory?.entries && Array.isArray(pembayaran.paymentHistory.entries))
      ? pembayaran.paymentHistory.entries
      : [];

  if (entries.length > 0) {
    doc.fillColor("#111827").font("Helvetica-Bold").fontSize(9).text("Riwayat Pembayaran / Termin", tableX, y);
    let termY = y + 14;
    doc.rect(tableX, termY, leftBoxW, 16).fill("#374151");
    doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(7.5);
    doc.text("No", tableX + 4, termY + 4, { width: 22, align: "center" });
    doc.text("Tanggal", tableX + 28, termY + 4, { width: 58 });
    doc.text("Metode", tableX + 88, termY + 4, { width: 48 });
    doc.text("Nominal", tableX + 138, termY + 4, { width: 68, align: "right" });
    doc.text("Status", tableX + 208, termY + 4, { width: 52, align: "center" });
    termY += 16;

    const displayEntries = entries.slice(0, 5);
    displayEntries.forEach((ent, idx) => {
      const eBg = idx % 2 === 1 ? "#F9FAFB" : "#FFFFFF";
      doc.rect(tableX, termY, leftBoxW, 14).fillAndStroke(eBg, "#E5E7EB");
      doc.fillColor("#374151").font("Helvetica").fontSize(7.5);
      doc.text(String(idx + 1), tableX + 4, termY + 3, { width: 22, align: "center" });
      doc.text(fmtDateId(ent.tanggal), tableX + 28, termY + 3, { width: 58 });
      doc.text(ent.metodeBayar || "-", tableX + 88, termY + 3, { width: 48 });
      doc.font("Helvetica-Bold").text(fmtRp(ent.jumlah), tableX + 138, termY + 3, { width: 68, align: "right" });
      doc.font("Helvetica");
      const eStat = String(ent.approvalStatus || "APPROVED").toUpperCase();
      doc.text(eStat === "APPROVED" ? "Approved" : eStat, tableX + 208, termY + 3, { width: 52, align: "center" });
      termY += 14;
    });
  } else {
    doc.roundedRect(tableX, y, leftBoxW, 86, 6).fillAndStroke("#F9FAFB", "#E5E7EB");
    doc.fillColor("#111827").font("Helvetica-Bold").fontSize(8.5).text("Catatan & Keterangan", tableX + 10, y + 8);
    doc.fillColor("#4B5563").font("Helvetica").fontSize(8).text(pembayaran.keterangan || "Pembayaran material sesuai PO yang telah diverifikasi Finance dan disetujui Atasan.", tableX + 10, y + 24, { width: leftBoxW - 20, lineGap: 2 });
  }

  const sumY = y;
  doc.roundedRect(summaryBoxX, sumY, summaryBoxW, 86, 6).fillAndStroke("#FFFBEB", "#FDE68A");
  doc.fillColor("#92400E").font("Helvetica-Bold").fontSize(9.5).text("RINGKASAN PEMBAYARAN", summaryBoxX + 12, sumY + 8);

  const drawSumRow = (label, val, rY, bold = false, color = "#111827", fontSize = 8.5) => {
    doc.fillColor("#6B7280").font("Helvetica").fontSize(fontSize).text(label, summaryBoxX + 12, rY);
    doc.fillColor(color).font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(fontSize).text(val, summaryBoxX + 100, rY, { width: summaryBoxW - 114, align: "right" });
  };

  drawSumRow("Total Tagihan PO", fmtRp(totalTagihan), sumY + 26);
  if (nominalAction > 0 && nominalAction !== totalTerbayar) {
    drawSumRow("Pembayaran Aksi Ini", fmtRp(nominalAction), sumY + 40, true, "#1E40AF");
    drawSumRow("Akumulasi Terbayar", fmtRp(totalTerbayar), sumY + 54);
    drawSumRow("Sisa Tagihan", fmtRp(sisaBayar), sumY + 68, true, sisaBayar > 0 ? "#DC2626" : "#059669", 9.5);
  } else {
    drawSumRow("Total Terbayar", fmtRp(totalTerbayar), sumY + 42, true, "#059669");
    drawSumRow("Sisa Tagihan", fmtRp(sisaBayar), sumY + 62, true, sisaBayar > 0 ? "#DC2626" : "#059669", 9.5);
  }

  // Signatures Section
  const sigY = 660;
  doc.rect(36, sigY - 12, 518, 1).fill("#E5E7EB");

  const sigColW = 160;
  const sigGap = (518 - (sigColW * 3)) / 2;

  const s1X = 36;
  doc.fillColor("#6B7280").font("Helvetica").fontSize(8).text("Diajukan / Verifikasi:", s1X, sigY, { width: sigColW, align: "center" });
  doc.fillColor("#111827").font("Helvetica-Bold").fontSize(8.5).text("Finance & Purchasing", s1X, sigY + 12, { width: sigColW, align: "center" });
  doc.rect(s1X + 20, sigY + 64, sigColW - 40, 1).fill("#9CA3AF");
  doc.fillColor("#374151").font("Helvetica-Bold").fontSize(8).text(financeApprovedBy, s1X, sigY + 68, { width: sigColW, align: "center" });

  const s2X = s1X + sigColW + sigGap;
  doc.fillColor("#6B7280").font("Helvetica").fontSize(8).text("Disetujui Oleh:", s2X, sigY, { width: sigColW, align: "center" });
  doc.fillColor("#111827").font("Helvetica-Bold").fontSize(8.5).text("Project Manager / Atasan", s2X, sigY + 12, { width: sigColW, align: "center" });
  doc.rect(s2X + 20, sigY + 64, sigColW - 40, 1).fill("#9CA3AF");
  doc.fillColor("#374151").font("Helvetica-Bold").fontSize(8).text(atasanApprovedBy, s2X, sigY + 68, { width: sigColW, align: "center" });

  const s3X = s2X + sigColW + sigGap;
  doc.fillColor("#6B7280").font("Helvetica").fontSize(8).text("Diterima Oleh:", s3X, sigY, { width: sigColW, align: "center" });
  doc.fillColor("#111827").font("Helvetica-Bold").fontSize(8.5).text("Supplier / Rekanan", s3X, sigY + 12, { width: sigColW, align: "center" });
  doc.rect(s3X + 20, sigY + 64, sigColW - 40, 1).fill("#9CA3AF");
  doc.fillColor("#374151").font("Helvetica-Bold").fontSize(8).text(supplier.name || "(.................................)", s3X, sigY + 68, { width: sigColW, align: "center" });

  doc.fillColor("#9CA3AF").font("Helvetica").fontSize(7.5).text("Dokumen ini dihasilkan secara otomatis oleh DIVES Construction Management System dan merupakan bukti penagihan / pembayaran yang sah.", 36, 785, { width: 518, align: "center" });

  doc.end();
}

/**
 * GET /api/pembayaran-supplier/:id/invoice-pdf
 * Cetak / Download Invoice PDF Pembayaran Supplier
 */
router.get("/pembayaran-supplier/:id/invoice-pdf", async (req, res) => {
  try {
    const pembayaran = await prisma.pembayaranSupplier.findUnique({
      where: { id: req.params.id },
      include: {
        supplier: true,
        jasa: true,
        rekeningBank: { include: { tipeRekening: true } },
        tipeRekening: true,
        purchaseOrder: {
          include: {
            supplier: true,
            project: true,
            items: {
              include: {
                materialRequest: true,
                rabItem: true,
              },
            },
          },
        },
        pengajuan: {
          include: {
            verifiedBy: true,
            approvedBy: true,
          },
        },
      },
    });

    if (!pembayaran) {
      return res.status(404).json({ error: "Data pembayaran supplier tidak ditemukan" });
    }

    const enriched = enrichPembayaranApproval(pembayaran);

    // Guard: Cetak invoice diizinkan jika sudah disetujui Atasan
    const isApproved =
      enriched.approvalStatus === "APPROVED" ||
      enriched.isPostedKasBank ||
      (pembayaran.purchaseOrder?.status === "APPROVED" && enriched.approvalStatus !== "REJECTED");

    if (!isApproved) {
      return res.status(400).json({
        error: "Invoice supplier hanya dapat dicetak setelah disetujui oleh Atasan.",
      });
    }

    let selectedEntry = null;
    const entries = Array.isArray(enriched.paymentHistory) ? enriched.paymentHistory : [];
    if (req.query.entryId) {
      selectedEntry = entries.find((e) => e.id === req.query.entryId) || null;
    } else if (req.query.entryIndex !== undefined && req.query.entryIndex !== "") {
      const idx = parseInt(req.query.entryIndex, 10);
      if (!isNaN(idx) && idx >= 0 && idx < entries.length) {
        selectedEntry = entries[idx];
      }
    }

    const noSafe = String(
      pembayaran.noPembayaran || pembayaran.purchaseOrder?.poNumber || pembayaran.id
    ).replace(/[^a-zA-Z0-9_-]/g, "_");

    const isJasaDoc = Boolean(pembayaran.jasa || pembayaran.purchaseOrder?.jasa || pembayaran.purchaseOrder?.isJasa || (pembayaran.purchaseOrder?.poNumber && pembayaran.purchaseOrder?.poNumber.startsWith("POJ")));
    const filenamePrefix = isJasaDoc ? "Invoice_Jasa" : "Invoice_Supplier";

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filenamePrefix}_${noSafe}.pdf"`);

    const logoPath = path.resolve(__dirname, "../../../public/assets/dives.png");
    return streamSupplierInvoicePdf(res, {
      pembayaran: enriched,
      entry: selectedEntry,
      logoPath,
    });
  } catch (error) {
    console.error("Stream Supplier Invoice PDF Error:", error);
    res.status(500).json({ error: "Gagal membuat invoice PDF supplier" });
  }
});


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
