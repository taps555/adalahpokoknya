"use strict";

const express = require("express");
const router = express.Router();
const prisma = require("../../lib/prisma");
const { verifyToken, authorizeRoles } = require("../../middleware/auth");

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
        purchaseOrder: { select: { poNumber: true, id: true } },
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
        purchaseOrder: { include: { supplier: true } },
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
        purchaseOrder: { select: { poNumber: true, id: true } },
        approvedBy: { select: { name: true, id: true } },
        verifiedBy: { select: { name: true, id: true } },
        pembayaran: true,
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(pengajuan);
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
        purchaseOrder: {
          include: {
            supplier: { select: { id: true, name: true } },
            project: { select: { id: true, name: true } },
            items: { orderBy: { id: "asc" } },
          },
        },
        verifiedBy: { select: { name: true, id: true } },
        pembayaran: true,
      },
      orderBy: { verifiedAt: "asc" },
    });
    res.json(data);
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
        purchaseOrder: {
          include: {
            supplier: { select: { id: true, name: true } },
            project: { select: { id: true, name: true } },
            items: { orderBy: { id: "asc" } },
          },
        },
        pembayaran: true,
      },
      orderBy: { createdAt: "asc" },
    });
    res.json(data);
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
        purchaseOrder: {
          include: {
            supplier: true,
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
      poId,
      projectId,
      tanggal,
      totalTagihan,
      catatan,
      items,
    } = req.body;

    if (!supplierId && !poId) {
      return res.status(400).json({ error: "Supplier wajib diisi" });
    }

    // projectId & supplierId ikut PO kalau tidak dikirim FE
    let finalProjectId = projectId || null;
    let finalSupplierId = supplierId || null;
    if ((!finalProjectId || !finalSupplierId) && poId) {
      const po = await prisma.purchaseOrder.findUnique({
        where: { id: poId },
        select: { projectId: true, supplierId: true },
      });
      finalProjectId = finalProjectId || po?.projectId || null;
      finalSupplierId = finalSupplierId || po?.supplierId || null;
    }
    if (!finalSupplierId) {
      return res.status(400).json({ error: "Supplier wajib diisi" });
    }

    // Kalau pengajuan terkait PO yang sudah final (APPROVED), langsung finalkan
    // pengajuan bayarnya karena finance sudah approve PO dan atasan sudah approve PO.
    let initialStatus = "PENDING";
    let verifiedById = null;
    let verifiedAt = null;
    let approvedById = null;
    let approvedAt = null;

    if (poId) {
      const po = await prisma.purchaseOrder.findUnique({
        where: { id: poId },
        select: { status: true, verifiedById: true, verifiedAt: true, approvedById: true, approvedAt: true },
      });
      if (po?.status === "APPROVED") {
        initialStatus = "APPROVED";
        verifiedById = po.verifiedById;
        verifiedAt = po.verifiedAt;
        approvedById = po.approvedById;
        approvedAt = po.approvedAt;
      }
    }

    const created = await prisma.pengajuanPembayaran.create({
      data: {
        supplierId: finalSupplierId,
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
        supplierId: supplierId || undefined,
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

// =====================================================================
// 3. PEMBAYARAN SUPPLIER
// =====================================================================

/**
 * GET /api/pembayaran-supplier
 */
router.get("/pembayaran-supplier", async (req, res) => {
  try {
    const pembayaran = await prisma.pembayaranSupplier.findMany({
      include: {
        supplier: { select: { name: true, id: true } },
        pengajuan: { select: { noPengajuan: true, id: true } },
        purchaseOrder: { select: { poNumber: true, id: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(pembayaran);
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
        pengajuan: true,
        purchaseOrder: { include: { supplier: true } },
      },
    });
    if (!pembayaran)
      return res
        .status(404)
        .json({ error: "Pembayaran tidak ditemukan" });
    res.json(pembayaran);
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
      pengajuanId,
      poId,
      tanggal,
      bankAccount,
      keterangan,
      buktiBayarUrl,
    } = req.body;

    // FIX: frontend mengirim `jumlah` + `metode`; kontrak DB memakai
    // `jumlahBayar` + `metodeBayar`. Dulu nilai FE hilang -> tersimpan 0.
    const jumlahBayar = req.body.jumlahBayar ?? req.body.jumlah ?? 0;
    const metodeBayar = req.body.metodeBayar ?? req.body.metode ?? "TRANSFER";

    if (!supplierId) {
      return res.status(400).json({ error: "Supplier wajib diisi" });
    }

    const created = await prisma.pembayaranSupplier.create({
      data: {
        supplierId,
        pengajuanId: pengajuanId || null,
        poId: poId || null,
        tanggal: new Date(tanggal),
        jumlahBayar: Number(jumlahBayar || 0),
        metodeBayar: metodeBayar || "TRANSFER",
        bankAccount,
        keterangan,
        buktiBayarUrl,
      },
    });

    // Generate noPembayaran: PBY/bulan/tahun/seq
    const now = new Date(tanggal);
    const bulan = String(now.getMonth() + 1).padStart(2, "0");
    const tahun = now.getFullYear();
    const urutan = String(created.seq).padStart(3, "0");
    const noPembayaran = `PBY/${bulan}/${tahun}/${urutan}`;

    const pembayaran = await prisma.pembayaranSupplier.update({
      where: { id: created.id },
      data: { noPembayaran },
    });

    res.json({
      message: "Pembayaran supplier berhasil dibuat",
      data: pembayaran,
    });
  } catch (error) {
    console.error("Create Pembayaran Supplier Error:", error);
    res.status(500).json({ error: "Gagal membuat pembayaran supplier" });
  }
});

/**
 * PUT /api/pembayaran-supplier/:id
 */
router.put("/pembayaran-supplier/:id", verifyToken, async (req, res) => {
  try {
    const {
      supplierId,
      pengajuanId,
      poId,
      tanggal,
      jumlahBayar,
      metodeBayar,
      bankAccount,
      keterangan,
      buktiBayarUrl,
      status,
    } = req.body;

    const pembayaran = await prisma.pembayaranSupplier.update({
      where: { id: req.params.id },
      data: {
        supplierId: supplierId || undefined,
        pengajuanId: pengajuanId !== undefined ? pengajuanId : undefined,
        poId: poId !== undefined ? poId : undefined,
        tanggal: tanggal ? new Date(tanggal) : undefined,
        jumlahBayar: Number(jumlahBayar || 0),
        metodeBayar: metodeBayar || undefined,
        bankAccount,
        keterangan,
        buktiBayarUrl,
        status: status || undefined,
      },
    });

    res.json({ message: "Pembayaran diupdate", data: pembayaran });
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
        purchaseOrder: { include: { supplier: true } },
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
