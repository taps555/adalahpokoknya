const express = require("express");
const router = express.Router();
const prisma = require("../../lib/prisma");
const { verifyToken, authorizeRoles } = require("../../middleware/auth");
const ExcelJS = require("exceljs");

const normalizeText = (v) => String(v || "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * GET /api/gl-bank/transaksi
 * Query params:
 *   tipeAkun=KAS|BANK
 *   namaAkun=...
 *   dari=YYYY-MM-DD
 *   sampai=YYYY-MM-DD
 *   search=...
 *   cursor=<id>&limit=100
 */
router.get("/transaksi", verifyToken, async (req, res) => {
  try {
    const {
      tipeAkun,
      namaAkun,
      dari,
      sampai,
      search,
      projectId,
      tipeRekeningId,
      rekeningBankId,
      cursor,
      limit = "100",
    } = req.query;

    const where = {};
    if (tipeAkun) where.tipeAkun = tipeAkun;
    if (namaAkun) where.namaAkun = { contains: namaAkun, mode: "insensitive" };
    if (rekeningBankId) where.rekeningBankId = rekeningBankId;
    if (tipeRekeningId) where.tipeRekeningId = tipeRekeningId;
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

    const include = {
      createdBy: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
      akunBukuBesar: { select: { id: true, kodeAkun: true, namaAkun: true, tipeAkun: true } },
      rekeningBank: { select: { id: true, namaRekening: true, namaBank: true, nomorRekening: true, tipeRekeningId: true, tipeRekening: { select: { id: true, namaTipe: true } } } },
      tipeRekening: { select: { id: true, namaTipe: true } },
      purchaseOrder: {
        select: {
          id: true,
          poNumber: true,
          projectId: true,
          project: { select: { id: true, name: true } },
        },
      },
      pengajuan: { select: { id: true, noPengajuan: true } },
      pembayaran: {
        select: {
          id: true,
          noPembayaran: true,
          purchaseOrder: {
            select: {
              id: true,
              projectId: true,
              project: { select: { id: true, name: true } },
            },
          },
        },
      },
    };

    if (projectId) {
      const allRows = await prisma.bukuBesarTransaksi.findMany({
        where,
        orderBy: [{ tanggal: "desc" }, { createdAt: "desc" }],
        include,
      });

      const filtered = allRows.filter((r) => {
        const directProjectId = r.projectId || null;
        const poProjectId = r.purchaseOrder?.projectId || null;
        const payProjectId = r.pembayaran?.purchaseOrder?.projectId || null;
        return directProjectId === projectId || poProjectId === projectId || payProjectId === projectId;
      });

      let startIndex = 0;
      if (cursor) {
        const idx = filtered.findIndex((r) => r.id === cursor);
        if (idx < 0) {
          return res.status(400).json({ error: "Cursor tidak valid." });
        }
        startIndex = idx + 1;
      }

      const slice = filtered.slice(startIndex, startIndex + take + 1);
      const hasNextPage = slice.length > take;
      const rows = hasNextPage ? slice.slice(0, take) : slice;
      const total = filtered.length;
      const nextCursor = hasNextPage && rows.length ? rows[rows.length - 1].id : null;
      return res.json({ data: rows, total, hasNextPage, nextCursor });
    }

    const cursorRow = cursor
      ? await prisma.bukuBesarTransaksi.findUnique({ where: { id: cursor }, select: { tanggal: true, createdAt: true } })
      : null;
    if (cursor && !cursorRow) {
      return res.status(400).json({ error: "Cursor tidak valid." });
    }

    const cursorCondition = cursorRow
      ? {
          OR: [
            { tanggal: { lt: cursorRow.tanggal } },
            {
              tanggal: cursorRow.tanggal,
              createdAt: { lt: cursorRow.createdAt },
            },
          ],
        }
      : null;

    const whereWithCursor = cursorCondition ? { AND: [where, cursorCondition] } : where;

    const [rows, total] = await Promise.all([
      prisma.bukuBesarTransaksi.findMany({
        where: whereWithCursor,
        orderBy: [{ tanggal: "desc" }, { createdAt: "desc" }],
        include,
        take: take + 1,
      }),
      prisma.bukuBesarTransaksi.count({ where }),
    ]);

    const hasNextPage = rows.length > take;
    const data = hasNextPage ? rows.slice(0, take) : rows;
    const nextCursor = hasNextPage && data.length ? data[data.length - 1].id : null;
    res.json({ data, total, hasNextPage, nextCursor });
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
    const rows = await prisma.masterRekeningBank.findMany({
      where: { isActive: true },
      include: { tipeRekening: { select: { id: true, namaTipe: true } } },
      orderBy: [{ namaRekening: "asc" }],
    });

    const mapped = rows.map((r) => ({
      id: r.id,
      namaAkun: `${r.namaRekening}${r.nomorRekening ? ` - ${r.nomorRekening}` : ""}`,
      tipeAkun: "BANK",
      keterangan: r.namaBank || null,
      isActive: r.isActive,
      tipeRekeningId: r.tipeRekeningId || null,
      tipeRekening: r.tipeRekening || null,
    }));

    res.json({ data: mapped });
  } catch (e) {
    console.error("GET /gl-bank/akun/master error:", e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * ==============================
 * MASTER REKENING BANK
 * ==============================
 */
router.get("/rekening-bank", verifyToken, async (req, res) => {
  try {
    const { search, activeOnly, tipeRekeningId } = req.query;
    const where = {};
    if (activeOnly === "1" || activeOnly === "true") where.isActive = true;
    if (tipeRekeningId) where.tipeRekeningId = tipeRekeningId;
    if (search) {
      where.OR = [
        { namaRekening: { contains: search, mode: "insensitive" } },
        { nomorRekening: { contains: search, mode: "insensitive" } },
        { namaBank: { contains: search, mode: "insensitive" } },
      ];
    }
    const rows = await prisma.masterRekeningBank.findMany({
      where,
      include: {
        tipeRekening: { select: { id: true, namaTipe: true } },
      },
      orderBy: [{ isDefault: "desc" }, { namaRekening: "asc" }],
    });
    res.json({ data: rows });
  } catch (e) {
    console.error("GET /gl-bank/rekening-bank error:", e);
    res.status(500).json({ error: e.message });
  }
});

router.post("/rekening-bank", verifyToken, async (req, res) => {
  try {
    const {
      namaRekening,
      tipeRekeningId,
      mataUang = "IDR",
      namaBank,
      nomorRekening,
      isDefault = false,
      isActive = true,
    } = req.body;

    if (!namaRekening || !nomorRekening) {
      return res.status(400).json({ error: "Nama rekening dan nomor rekening wajib diisi." });
    }

    const created = await prisma.$transaction(async (tx) => {
      if (isDefault) {
        await tx.masterRekeningBank.updateMany({ data: { isDefault: false } });
      }
      return tx.masterRekeningBank.create({
        data: {
          namaRekening: namaRekening.trim(),
          tipeRekeningId: tipeRekeningId || null,
          mataUang: mataUang || "IDR",
          namaBank: namaBank || null,
          nomorRekening: nomorRekening.trim(),
          isDefault: Boolean(isDefault),
          isActive: Boolean(isActive),
        },
      });
    });

    res.json(created);
  } catch (e) {
    console.error("POST /gl-bank/rekening-bank error:", e);
    if (e.code === "P2002") {
      return res.status(400).json({ error: "Nomor rekening sudah terdaftar." });
    }
    res.status(500).json({ error: e.message });
  }
});

router.put("/rekening-bank/:id", verifyToken, async (req, res) => {
  try {
    const {
      namaRekening,
      tipeRekeningId,
      mataUang,
      namaBank,
      nomorRekening,
      isDefault,
      isActive,
    } = req.body;

    const updated = await prisma.$transaction(async (tx) => {
      if (isDefault === true) {
        await tx.masterRekeningBank.updateMany({ data: { isDefault: false } });
      }
      return tx.masterRekeningBank.update({
        where: { id: req.params.id },
        data: {
          namaRekening: namaRekening !== undefined ? (namaRekening || "").trim() : undefined,
          tipeRekeningId: tipeRekeningId !== undefined ? tipeRekeningId || null : undefined,
          mataUang: mataUang !== undefined ? mataUang || "IDR" : undefined,
          namaBank: namaBank !== undefined ? namaBank || null : undefined,
          nomorRekening: nomorRekening !== undefined ? nomorRekening.trim() : undefined,
          isDefault: isDefault !== undefined ? Boolean(isDefault) : undefined,
          isActive: isActive !== undefined ? Boolean(isActive) : undefined,
        },
      });
    });

    res.json(updated);
  } catch (e) {
    console.error("PUT /gl-bank/rekening-bank/:id error:", e);
    if (e.code === "P2002") return res.status(400).json({ error: "Nomor rekening sudah terdaftar." });
    if (e.code === "P2025") return res.status(404).json({ error: "Rekening bank tidak ditemukan." });
    res.status(500).json({ error: e.message });
  }
});

router.delete("/rekening-bank/:id", verifyToken, async (req, res) => {
  try {
    await prisma.masterRekeningBank.delete({ where: { id: req.params.id } });
    res.json({ message: "Rekening bank dihapus." });
  } catch (e) {
    console.error("DELETE /gl-bank/rekening-bank/:id error:", e);
    if (e.code === "P2025") return res.status(404).json({ error: "Rekening bank tidak ditemukan." });
    res.status(500).json({ error: e.message });
  }
});

router.get("/tipe-rekening", verifyToken, async (req, res) => {
  try {
    const { search, isActive } = req.query;
    const where = {};
    if (isActive === "1" || isActive === "true") where.isActive = true;
    if (isActive === "0" || isActive === "false") where.isActive = false;
    if (search) where.namaTipe = { contains: search, mode: "insensitive" };
    const rows = await prisma.masterTipeRekening.findMany({
      where,
      orderBy: [{ namaTipe: "asc" }],
    });
    res.json({ data: rows });
  } catch (e) {
    console.error("GET /gl-bank/tipe-rekening error:", e);
    res.status(500).json({ error: e.message });
  }
});

router.post("/tipe-rekening", verifyToken, async (req, res) => {
  try {
    const { namaTipe, isActive = true } = req.body;
    if (!namaTipe || !String(namaTipe).trim()) {
      return res.status(400).json({ error: "Nama tipe rekening wajib diisi." });
    }
    const created = await prisma.masterTipeRekening.create({
      data: {
        namaTipe: String(namaTipe).trim(),
        isActive: Boolean(isActive),
      },
    });
    res.json(created);
  } catch (e) {
    console.error("POST /gl-bank/tipe-rekening error:", e);
    if (e.code === "P2002") return res.status(400).json({ error: "Nama tipe rekening sudah ada." });
    res.status(500).json({ error: e.message });
  }
});

router.put("/tipe-rekening/:id", verifyToken, async (req, res) => {
  try {
    const { namaTipe, isActive } = req.body;
    const updated = await prisma.masterTipeRekening.update({
      where: { id: req.params.id },
      data: {
        namaTipe: namaTipe !== undefined ? String(namaTipe || "").trim() : undefined,
        isActive: isActive !== undefined ? Boolean(isActive) : undefined,
      },
    });
    res.json(updated);
  } catch (e) {
    console.error("PUT /gl-bank/tipe-rekening/:id error:", e);
    if (e.code === "P2002") return res.status(400).json({ error: "Nama tipe rekening sudah ada." });
    if (e.code === "P2025") return res.status(404).json({ error: "Tipe rekening tidak ditemukan." });
    res.status(500).json({ error: e.message });
  }
});

router.delete("/tipe-rekening/:id", verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    const usedRekening = await prisma.masterRekeningBank.count({ where: { tipeRekeningId: id } });
    const usedPembayaran = await prisma.pembayaranSupplier.count({ where: { tipeRekeningId: id } });
    const usedBB = await prisma.bukuBesarTransaksi.count({ where: { tipeRekeningId: id } });
    if (usedRekening > 0 || usedPembayaran > 0 || usedBB > 0) {
      return res.status(400).json({ error: "Tipe rekening masih dipakai, tidak bisa dihapus." });
    }
    await prisma.masterTipeRekening.delete({ where: { id } });
    res.json({ message: "Tipe rekening dihapus." });
  } catch (e) {
    console.error("DELETE /gl-bank/tipe-rekening/:id error:", e);
    if (e.code === "P2025") return res.status(404).json({ error: "Tipe rekening tidak ditemukan." });
    res.status(500).json({ error: e.message });
  }
});

/**
 * Ringkasan RAP vs Pengeluaran untuk Buku Besar (general + per project)
 */
router.get("/summary", verifyToken, async (req, res) => {
  try {
    const { projectId } = req.query;

    const mrItems = await prisma.materialRequestItem.findMany({
      where: projectId ? { header: { projectId } } : {},
      select: {
        itemName: true,
        estimatedVolume: true,
        pricePerUnit: true,
        groupName: true,
        jobName: true,
        header: {
          select: {
            projectId: true,
            project: { select: { name: true } },
          },
        },
      },
    });

    const rapByProject = new Map();
    const rapByItem = new Map();

    for (const row of mrItems) {
      const pid = row.header?.projectId;
      if (!pid) continue;
      const pName = row.header?.project?.name || "Tanpa Project";
      const rapNominal = Number(row.estimatedVolume || 0) * Number(row.pricePerUnit || 0);

      if (!rapByProject.has(pid)) rapByProject.set(pid, { projectId: pid, projectName: pName, rap: 0 });
      rapByProject.get(pid).rap += rapNominal;

      const itemKey = `${pid}__${normalizeText(row.itemName)}`;
      if (!rapByItem.has(itemKey)) {
        rapByItem.set(itemKey, {
          projectId: pid,
          projectName: pName,
          itemName: row.itemName || "-",
          bagian: row.jobName || row.groupName || "Lainnya",
          rapNominal: 0,
        });
      }
      rapByItem.get(itemKey).rapNominal += rapNominal;
    }

    const poItems = await prisma.purchaseOrderItem.findMany({
      where: projectId ? { purchaseOrder: { projectId } } : {},
      select: {
        description: true,
        qty: true,
        unitPrice: true,
        purchaseOrder: {
          select: {
            projectId: true,
            project: { select: { name: true } },
          },
        },
      },
    });

    const realByItem = new Map();
    for (const row of poItems) {
      const pid = row.purchaseOrder?.projectId;
      if (!pid) continue;
      const pName = row.purchaseOrder?.project?.name || "Tanpa Project";
      const key = `${pid}__${normalizeText(row.description)}`;
      if (!realByItem.has(key)) {
        realByItem.set(key, {
          projectId: pid,
          projectName: pName,
          itemName: row.description || "-",
          realNominal: 0,
        });
      }
      realByItem.get(key).realNominal += Number(row.qty || 0) * Number(row.unitPrice || 0);
    }

    const whereTrx = {
      jenis: "KELUAR",
      ...(projectId
        ? {
            OR: [
              { projectId },
              { purchaseOrder: { projectId } },
              { pembayaran: { purchaseOrder: { projectId } } },
            ],
          }
        : {}),
    };

    const pengeluaranRows = await prisma.bukuBesarTransaksi.findMany({
      where: whereTrx,
      select: {
        nominal: true,
        projectId: true,
        project: { select: { name: true } },
        purchaseOrder: { select: { projectId: true, project: { select: { name: true } } } },
        pembayaran: {
          select: {
            purchaseOrder: {
              select: {
                projectId: true,
                project: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    const pengeluaranByProject = new Map();
    for (const row of pengeluaranRows) {
      const pid = row.projectId || row.purchaseOrder?.projectId || row.pembayaran?.purchaseOrder?.projectId;
      const pName = row.project?.name || row.purchaseOrder?.project?.name || row.pembayaran?.purchaseOrder?.project?.name || "Tanpa Project";
      if (!pid) continue;
      if (!pengeluaranByProject.has(pid)) pengeluaranByProject.set(pid, { projectId: pid, projectName: pName, pengeluaran: 0 });
      pengeluaranByProject.get(pid).pengeluaran += Number(row.nominal || 0);
    }

    const projectIds = new Set([
      ...Array.from(rapByProject.keys()),
      ...Array.from(pengeluaranByProject.keys()),
    ]);

    const projectSummaries = Array.from(projectIds).map((pid) => {
      const rap = Number(rapByProject.get(pid)?.rap || 0);
      const pengeluaran = Number(pengeluaranByProject.get(pid)?.pengeluaran || 0);
      const projectName = rapByProject.get(pid)?.projectName || pengeluaranByProject.get(pid)?.projectName || "Tanpa Project";
      return {
        projectId: pid,
        projectName,
        rap,
        pengeluaran,
        selisih: pengeluaran - rap,
      };
    }).sort((a, b) => b.selisih - a.selisih);

    const overrunByBagian = [];
    const allItemKeys = new Set([...Array.from(rapByItem.keys()), ...Array.from(realByItem.keys())]);
    for (const key of allItemKeys) {
      const rapItem = rapByItem.get(key);
      const realItem = realByItem.get(key);
      const rapNominal = Number(rapItem?.rapNominal || 0);
      const realNominal = Number(realItem?.realNominal || 0);
      const selisih = realNominal - rapNominal;
      if (selisih > 0) {
        overrunByBagian.push({
          projectId: rapItem?.projectId || realItem?.projectId,
          projectName: rapItem?.projectName || realItem?.projectName || "Tanpa Project",
          itemName: rapItem?.itemName || realItem?.itemName || "-",
          bagian: rapItem?.bagian || "Lainnya",
          rap: rapNominal,
          realisasi: realNominal,
          selisih,
        });
      }
    }
    overrunByBagian.sort((a, b) => b.selisih - a.selisih);

    const rapTotal = projectSummaries.reduce((s, p) => s + Number(p.rap || 0), 0);
    const pengeluaranTotal = projectSummaries.reduce((s, p) => s + Number(p.pengeluaran || 0), 0);

    res.json({
      summary: {
        rapTotal,
        pengeluaranTotal,
        selisih: pengeluaranTotal - rapTotal,
      },
      projectSummaries,
      overrunByBagian: overrunByBagian.slice(0, 20),
    });
  } catch (e) {
    console.error("GET /gl-bank/summary error:", e);
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/gl-bank/akun/master
 */
router.post("/akun/master", verifyToken, async (req, res) => {
  return res.status(410).json({
    error: "Master Akun Buku Besar sudah tidak digunakan. Gunakan Master Rekening Bank.",
  });
});

/**
 * PUT /api/gl-bank/akun/master/:id
 */
router.put("/akun/master/:id", verifyToken, async (req, res) => {
  return res.status(410).json({
    error: "Master Akun Buku Besar sudah tidak digunakan. Gunakan Master Rekening Bank.",
  });
});

/**
 * DELETE /api/gl-bank/akun/master/:id
 */
router.delete("/akun/master/:id", verifyToken, async (req, res) => {
  return res.status(410).json({
    error: "Master Akun Buku Besar sudah tidak digunakan. Gunakan Master Rekening Bank.",
  });
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

      const [trxRows, rekeningRows] = await Promise.all([
          prisma.bukuBesarTransaksi.findMany({
            where,
            select: { tipeAkun: true, namaAkun: true },
            distinct: ["tipeAkun", "namaAkun"],
            orderBy: { namaAkun: "asc" },
          }),
          prisma.masterRekeningBank.findMany({
            where: { isActive: true },
            select: { namaRekening: true, nomorRekening: true },
            orderBy: { namaRekening: "asc" },
          }),
        ]);
        const merged = new Map();
        for (const r of trxRows) {
          merged.set(`${r.tipeAkun}_${r.namaAkun}`, r);
        }
        for (const r of rekeningRows) {
          const namaAkun = [r.namaRekening, r.nomorRekening].filter(Boolean).join(" - ");
          merged.set(`BANK_${namaAkun}`, { tipeAkun: "BANK", namaAkun });
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

    const rekeningRows = await prisma.masterRekeningBank.findMany({
      where: { isActive: true },
      include: { tipeRekening: { select: { id: true, namaTipe: true } } },
      orderBy: [{ namaRekening: "asc" }],
    });

    const masterSaldo = await Promise.all(rekeningRows.map(async (r) => {
      const namaAkun = [r.namaRekening, r.nomorRekening].filter(Boolean).join(" - ");
      
      const lastTx = await prisma.bukuBesarTransaksi.findFirst({
        where: { OR: [{ rekeningBankId: r.id }, { tipeAkun: "BANK", namaAkun }] },
        orderBy: [{ tanggal: "desc" }, { createdAt: "desc" }],
      });
      
      return {
        key: r.id,
        tipeAkun: "BANK",
        namaAkun,
        rekeningBankId: r.id,
        rekeningBank: {
          id: r.id,
          namaRekening: r.namaRekening,
          namaBank: r.namaBank,
          nomorRekening: r.nomorRekening,
          tipeRekening: r.tipeRekening || null,
        },
        saldo: lastTx ? lastTx.saldoBerjalan : 0,
        updatedAt: lastTx ? lastTx.createdAt : null,
      };
    }));

    const kasRows = await prisma.bukuBesarTransaksi.findMany({
      where: { tipeAkun: "KAS", ...where },
      distinct: ["namaAkun"],
      select: { namaAkun: true },
    });
    
    const kasSaldo = await Promise.all(kasRows.map(async (r) => {
      const lastTx = await prisma.bukuBesarTransaksi.findFirst({
        where: { tipeAkun: "KAS", namaAkun: r.namaAkun },
        orderBy: [{ tanggal: "desc" }, { createdAt: "desc" }],
      });
      return {
        key: `KAS_${r.namaAkun}`,
        tipeAkun: "KAS",
        namaAkun: r.namaAkun,
        rekeningBankId: null,
        rekeningBank: null,
        saldo: lastTx ? lastTx.saldoBerjalan : 0,
        updatedAt: lastTx ? lastTx.createdAt : null,
      };
    }));

    res.json({ saldo: [...masterSaldo, ...kasSaldo] });
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
  tipeRekeningId,
  projectId,
  rekeningBankId,
  sumberTransaksi,
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
      projectId: projectId || null,
      akunBukuBesarId: null,
      rekeningBankId: rekeningBankId || null,
      tipeRekeningId: tipeRekeningId || null,
      sumberTransaksi: sumberTransaksi || "SISTEM",
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
 * Body: { tanggal, tipeAkun, namaAkun?, jenis, nominal, noReferensi?, pihak?, keterangan?, projectId?, rekeningBankId?, tipeRekeningId?, sumberTransaksi? }
 */
router.post("/transaksi", verifyToken, async (req, res) => {
  try {
    const {
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
      projectId,
      rekeningBankId,
      tipeRekeningId,
      sumberTransaksi,
      poId,
      pengajuanId,
      pembayaranId,
    } = req.body;

    if (!tanggal || !tipeAkun || !jenis || nominal === undefined || nominal === null) {
      return res.status(400).json({ error: "Field tanggal, tipeAkun, jenis, nominal wajib diisi." });
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

    // Validasi rekening bank untuk tipe BANK
    let rekeningBank = null;
    if (tipeAkun === "BANK") {
      if (!rekeningBankId) {
        return res.status(400).json({ error: "Rekening bank wajib dipilih untuk tipe akun BANK." });
      }
      rekeningBank = await prisma.masterRekeningBank.findUnique({ where: { id: rekeningBankId } });
      if (!rekeningBank || !rekeningBank.isActive) {
        return res.status(400).json({ error: "Rekening bank tidak valid / tidak aktif." });
      }
    }

    // Validasi project optional
    let project = null;
    if (projectId) {
      project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
      if (!project) return res.status(400).json({ error: "Project tidak ditemukan." });
    }

    let tipeRekening = null;
    if (tipeRekeningId) {
      tipeRekening = await prisma.masterTipeRekening.findUnique({ where: { id: tipeRekeningId } });
      if (!tipeRekening || !tipeRekening.isActive) {
        return res.status(400).json({ error: "Tipe rekening tidak valid / tidak aktif." });
      }
    }

    const finalNamaAkun = tipeAkun === "BANK"
      ? [rekeningBank?.namaRekening, rekeningBank?.nomorRekening].filter(Boolean).join(" - ")
      : String(namaAkun || "Kas").trim();

    const newRow = await prisma.bukuBesarTransaksi.create({
      data: {
        tanggal: new Date(tanggal),
        tipeAkun,
        namaAkun: finalNamaAkun,
        jenis,
        nominal: n,
        noReferensi: noReferensi || null,
        pihak: pihak || null,
        keterangan: keterangan || null,
        keteranganVolume: keteranganVolume || null,
        keteranganHarga: keteranganHarga || null,
        projectId: projectId || null,
        akunBukuBesarId: null,
        rekeningBankId: rekeningBankId || null,
        tipeRekeningId: tipeRekeningId || null,
        sumberTransaksi: sumberTransaksi || "MANUAL",
        poId: poId || null,
        pengajuanId: pengajuanId || null,
        pembayaranId: pembayaranId || null,
        createdById: req.user?.userId || req.user?.id || null,
        saldoBerjalan: 0,
      },
    });

    await recalcSaldo(tipeAkun, finalNamaAkun);
    const finalRow = await prisma.bukuBesarTransaksi.findUnique({
      where: { id: newRow.id },
      include: {
        createdBy: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
        akunBukuBesar: { select: { id: true, kodeAkun: true, namaAkun: true, tipeAkun: true } },
        rekeningBank: { select: { id: true, namaRekening: true, namaBank: true, nomorRekening: true, tipeRekeningId: true, tipeRekening: { select: { id: true, namaTipe: true } } } },
        tipeRekening: { select: { id: true, namaTipe: true } },
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

    const {
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
      projectId,
      rekeningBankId,
      tipeRekeningId,
      sumberTransaksi,
      poId,
      pengajuanId,
      pembayaranId,
    } = req.body;

    const newTipe = tipeAkun || existing.tipeAkun;
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

    const finalRekeningId = rekeningBankId !== undefined ? (rekeningBankId || null) : existing.rekeningBankId;

    let rekeningBank = null;
    if (newTipe === "BANK") {
      if (!finalRekeningId) {
        return res.status(400).json({ error: "Rekening bank wajib dipilih untuk tipe akun BANK." });
      }
      rekeningBank = await prisma.masterRekeningBank.findUnique({ where: { id: finalRekeningId } });
      if (!rekeningBank || !rekeningBank.isActive) {
        return res.status(400).json({ error: "Rekening bank tidak valid / tidak aktif." });
      }
    }

    const finalProjectId = projectId !== undefined ? (projectId || null) : existing.projectId;
    if (finalProjectId) {
      const project = await prisma.project.findUnique({ where: { id: finalProjectId }, select: { id: true } });
      if (!project) return res.status(400).json({ error: "Project tidak ditemukan." });
    }

    const finalTipeRekeningId = tipeRekeningId !== undefined ? (tipeRekeningId || null) : existing.tipeRekeningId;
    if (finalTipeRekeningId) {
      const tipeRekening = await prisma.masterTipeRekening.findUnique({ where: { id: finalTipeRekeningId } });
      if (!tipeRekening || !tipeRekening.isActive) {
        return res.status(400).json({ error: "Tipe rekening tidak valid / tidak aktif." });
      }
    }

    const finalNamaAkun = newTipe === "BANK"
      ? [rekeningBank?.namaRekening, rekeningBank?.nomorRekening].filter(Boolean).join(" - ")
      : String(namaAkun || existing.namaAkun || "Kas").trim();

    await prisma.bukuBesarTransaksi.update({
      where: { id },
      data: {
        tanggal: tanggal ? new Date(tanggal) : existing.tanggal,
        tipeAkun: newTipe,
        namaAkun: finalNamaAkun,
        jenis: newJenis,
        nominal: newNominal,
        noReferensi: noReferensi !== undefined ? (noReferensi || null) : existing.noReferensi,
        pihak: pihak !== undefined ? (pihak || null) : existing.pihak,
        keterangan: keterangan !== undefined ? (keterangan || null) : existing.keterangan,
        keteranganVolume: keteranganVolume !== undefined ? (keteranganVolume || null) : existing.keteranganVolume,
        keteranganHarga: keteranganHarga !== undefined ? (keteranganHarga || null) : existing.keteranganHarga,
        projectId: projectId !== undefined ? (projectId || null) : existing.projectId,
        akunBukuBesarId: null,
        rekeningBankId: rekeningBankId !== undefined ? (rekeningBankId || null) : existing.rekeningBankId,
        tipeRekeningId: tipeRekeningId !== undefined ? (tipeRekeningId || null) : existing.tipeRekeningId,
        sumberTransaksi: sumberTransaksi !== undefined ? (sumberTransaksi || null) : existing.sumberTransaksi,
        poId: poId !== undefined ? (poId || null) : existing.poId,
        pengajuanId: pengajuanId !== undefined ? (pengajuanId || null) : existing.pengajuanId,
        pembayaranId: pembayaranId !== undefined ? (pembayaranId || null) : existing.pembayaranId,
      },
    });

    // Recalc old + new account if changed
    await recalcSaldo(existing.tipeAkun, existing.namaAkun);
    if (newTipe !== existing.tipeAkun || finalNamaAkun !== existing.namaAkun) {
      await recalcSaldo(newTipe, finalNamaAkun);
    }

    const finalRow = await prisma.bukuBesarTransaksi.findUnique({
      where: { id },
      include: {
        createdBy: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
        akunBukuBesar: { select: { id: true, kodeAkun: true, namaAkun: true, tipeAkun: true } },
        rekeningBank: { select: { id: true, namaRekening: true, namaBank: true, nomorRekening: true, tipeRekeningId: true, tipeRekening: { select: { id: true, namaTipe: true } } } },
        tipeRekening: { select: { id: true, namaTipe: true } },
      },
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

// ============================================================
// TRANSFER ANTAR BANK
// ============================================================

/**
 * POST /api/gl-bank/transfer-bank
 * Body: { rekeningAsalId, rekeningTujuanId, tanggal, nominal, keterangan }
 */
router.post("/transfer-bank", verifyToken, async (req, res) => {
  try {
    const { rekeningAsalId, rekeningTujuanId, tanggal, nominal, keterangan } = req.body;

    if (!rekeningAsalId || !rekeningTujuanId) {
      return res.status(400).json({ error: "Rekening asal dan rekening tujuan wajib dipilih." });
    }
    if (rekeningAsalId === rekeningTujuanId) {
      return res.status(400).json({ error: "Rekening asal dan rekening tujuan tidak boleh sama." });
    }
    const nom = Number(nominal);
    if (!nom || nom <= 0) {
      return res.status(400).json({ error: "Nominal transfer harus lebih besar dari 0." });
    }

    const [rekAsal, rekTujuan] = await Promise.all([
      prisma.masterRekeningBank.findUnique({
        where: { id: String(rekeningAsalId) },
        include: { tipeRekening: true },
      }),
      prisma.masterRekeningBank.findUnique({
        where: { id: String(rekeningTujuanId) },
        include: { tipeRekening: true },
      }),
    ]);

    if (!rekAsal) return res.status(404).json({ error: "Rekening asal tidak ditemukan." });
    if (!rekTujuan) return res.status(404).json({ error: "Rekening tujuan tidak ditemukan." });

    const tgl = tanggal ? new Date(tanggal) : new Date();
    const yyyy = tgl.getFullYear();
    const mm = String(tgl.getMonth() + 1).padStart(2, "0");
    const dd = String(tgl.getDate()).padStart(2, "0");

    const startOfDay = new Date(tgl);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(tgl);
    endOfDay.setHours(23, 59, 59, 999);

    const countToday = await prisma.bukuBesarTransaksi.count({
      where: {
        sumberTransaksi: "TRANSFER_BANK",
        tanggal: { gte: startOfDay, lte: endOfDay },
        jenis: "KELUAR",
      },
    });
    const seq = String(countToday + 1).padStart(3, "0");
    const noReferensi = `TRF/${yyyy}${mm}${dd}/${seq}`;

    const namaAkunAsal = [rekAsal.namaRekening, rekAsal.nomorRekening].filter(Boolean).join(" - ");
    const namaAkunTujuan = [rekTujuan.namaRekening, rekTujuan.nomorRekening].filter(Boolean).join(" - ");

    const [trxKeluar, trxMasuk] = await prisma.$transaction([
      prisma.bukuBesarTransaksi.create({
        data: {
          tanggal: tgl,
          tipeAkun: "BANK",
          namaAkun: namaAkunAsal,
          jenis: "KELUAR",
          nominal: nom,
          noReferensi,
          pihak: [rekTujuan.namaBank, rekTujuan.namaRekening].filter(Boolean).join(" - "),
          keterangan: keterangan
            ? `Transfer ke ${rekTujuan.namaBank || "Bank"} (${rekTujuan.nomorRekening || "-"}) - ${keterangan}`
            : `Transfer ke ${rekTujuan.namaBank || "Bank"} (${rekTujuan.nomorRekening || "-"}) a.n. ${rekTujuan.namaRekening}`,
          projectId: null,
          rekeningBankId: rekAsal.id,
          tipeRekeningId: rekAsal.tipeRekeningId || null,
          sumberTransaksi: "TRANSFER_BANK",
          createdById: req.user?.userId || req.user?.id || null,
          saldoBerjalan: 0,
        },
      }),
      prisma.bukuBesarTransaksi.create({
        data: {
          tanggal: tgl,
          tipeAkun: "BANK",
          namaAkun: namaAkunTujuan,
          jenis: "MASUK",
          nominal: nom,
          noReferensi,
          pihak: [rekAsal.namaBank, rekAsal.namaRekening].filter(Boolean).join(" - "),
          keterangan: keterangan
            ? `Transfer dari ${rekAsal.namaBank || "Bank"} (${rekAsal.nomorRekening || "-"}) - ${keterangan}`
            : `Transfer dari ${rekAsal.namaBank || "Bank"} (${rekAsal.nomorRekening || "-"}) a.n. ${rekAsal.namaRekening}`,
          projectId: null,
          rekeningBankId: rekTujuan.id,
          tipeRekeningId: rekTujuan.tipeRekeningId || null,
          sumberTransaksi: "TRANSFER_BANK",
          createdById: req.user?.userId || req.user?.id || null,
          saldoBerjalan: 0,
        },
      }),
    ]);

    await recalcSaldo("BANK", namaAkunAsal);
    await recalcSaldo("BANK", namaAkunTujuan);

    res.status(201).json({
      message: "Transfer antar bank berhasil diposting.",
      noReferensi,
      trxKeluar,
      trxMasuk,
    });
  } catch (e) {
    console.error("POST /gl-bank/transfer-bank error:", e);
    res.status(500).json({ error: e.message || "Gagal melakukan transfer antar bank." });
  }
});

/**
 * GET /api/gl-bank/transfer-bank
 * Mengambil riwayat transfer antar bank
 */
router.get("/transfer-bank", verifyToken, async (req, res) => {
  try {
    const { dari, sampai, search } = req.query;
    const where = { sumberTransaksi: "TRANSFER_BANK" };

    if (dari || sampai) {
      where.tanggal = {};
      if (dari) where.tanggal.gte = new Date(dari);
      if (sampai) where.tanggal.lte = new Date(sampai);
    }
    if (search) {
      where.OR = [
        { noReferensi: { contains: search, mode: "insensitive" } },
        { keterangan: { contains: search, mode: "insensitive" } },
        { namaAkun: { contains: search, mode: "insensitive" } },
      ];
    }

    const rows = await prisma.bukuBesarTransaksi.findMany({
      where,
      orderBy: [{ tanggal: "desc" }, { createdAt: "desc" }],
      include: {
        createdBy: { select: { id: true, name: true } },
        rekeningBank: {
          select: { id: true, namaRekening: true, namaBank: true, nomorRekening: true },
        },
      },
      take: 200,
    });

    const groupMap = new Map();
    for (const r of rows) {
      const ref = r.noReferensi || r.id;
      if (!groupMap.has(ref)) {
        groupMap.set(ref, {
          noReferensi: ref,
          tanggal: r.tanggal,
          nominal: r.nominal,
          keterangan: r.keterangan,
          createdBy: r.createdBy?.name || "-",
          rekeningAsal: null,
          rekeningTujuan: null,
          createdAt: r.createdAt,
        });
      }
      const entry = groupMap.get(ref);
      if (r.jenis === "KELUAR") {
        entry.rekeningAsal = r.rekeningBank
          ? `${r.rekeningBank.namaBank} - ${r.rekeningBank.namaRekening} (${r.rekeningBank.nomorRekening})`
          : r.namaAkun;
        entry.nominal = r.nominal;
      } else if (r.jenis === "MASUK") {
        entry.rekeningTujuan = r.rekeningBank
          ? `${r.rekeningBank.namaBank} - ${r.rekeningBank.namaRekening} (${r.rekeningBank.nomorRekening})`
          : r.namaAkun;
      }
    }

    res.json({ data: Array.from(groupMap.values()), raw: rows });
  } catch (e) {
    console.error("GET /gl-bank/transfer-bank error:", e);
    res.status(500).json({ error: e.message || "Gagal mengambil riwayat transfer bank." });
  }
});

// ============================================================
// LAPORAN LABA RUGI PROYEK
// ============================================================

async function getLabaRugiData({ projectId, dari, sampai }) {
  const where = {};
  if (dari || sampai) {
    where.tanggal = {};
    if (dari) where.tanggal.gte = new Date(dari);
    if (sampai) where.tanggal.lte = new Date(sampai);
  }

  const allRows = await prisma.bukuBesarTransaksi.findMany({
    where,
    orderBy: [{ tanggal: "asc" }, { createdAt: "asc" }],
    include: {
      project: { select: { id: true, name: true, client: { select: { id: true, name: true } } } },
      purchaseOrder: {
        select: {
          id: true,
          poNumber: true,
          kategoriPO: true,
          projectId: true,
          project: { select: { id: true, name: true, client: { select: { id: true, name: true } } } },
          supplier: { select: { id: true, name: true } },
          jasa: { select: { id: true, nama: true } },
          items: {
            select: {
              id: true,
              description: true,
              qty: true,
              unit: true,
              unitPrice: true,
              total: true,
            },
          },
        },
      },
      pembayaran: {
        select: {
          id: true,
          noPembayaran: true,
          purchaseOrder: {
            select: {
              id: true,
              poNumber: true,
              kategoriPO: true,
              projectId: true,
              project: { select: { id: true, name: true, client: { select: { id: true, name: true } } } },
              supplier: { select: { id: true, name: true } },
              jasa: { select: { id: true, nama: true } },
            },
          },
        },
      },
      invoicePenjualanDesain: { select: { id: true, noInvoice: true } },
      invoicePenjualanKlien: { select: { id: true, noInvoice: true, termLabel: true } },
      invoiceOperasional: { select: { id: true, noInvoice: true, jenisBiaya: true } },
    },
  });

  const resolveProjectId = (r) =>
    r.projectId || r.purchaseOrder?.projectId || r.pembayaran?.purchaseOrder?.projectId || null;

  // Filter out bank-to-bank internal transfers
  const nonTransferRows = allRows.filter((r) => r.sumberTransaksi !== "TRANSFER_BANK");

  if (projectId) {
    const project = await prisma.project.findUnique({
      where: { id: String(projectId) },
      include: { client: { select: { id: true, name: true } } },
    });
    if (!project) return null;

    const projectRows = nonTransferRows.filter((r) => resolveProjectId(r) === projectId);

    const pendapatan = {
      desain: [],
      klien: [],
      lainnya: [],
      subtotalDesain: 0,
      subtotalKlien: 0,
      subtotalLainnya: 0,
      totalPendapatan: 0,
    };

    const pengeluaran = {
      materialAlat: [],
      jasa: [],
      operasional: [],
      lainnya: [],
      subtotalMaterialAlat: 0,
      subtotalJasa: 0,
      subtotalOperasional: 0,
      subtotalLainnya: 0,
      totalPengeluaran: 0,
    };

    for (const r of projectRows) {
      const nom = Number(r.nominal || 0);
      const ket = String(r.keterangan || "");
      const noRef = String(r.noReferensi || "");

      if (r.jenis === "MASUK") {
        const isDesain =
          (r.invoicePenjualanDesain && r.invoicePenjualanDesain.length > 0) ||
          noRef.startsWith("INV/DSN") ||
          /desain|design/i.test(ket);

        const isKlien =
          (r.invoicePenjualanKlien && r.invoicePenjualanKlien.length > 0) ||
          noRef.startsWith("INV/KLN") ||
          /klien|client|termin|spk/i.test(ket);

        if (isDesain) {
          pendapatan.desain.push(r);
          pendapatan.subtotalDesain += nom;
        } else if (isKlien) {
          pendapatan.klien.push(r);
          pendapatan.subtotalKlien += nom;
        } else {
          pendapatan.lainnya.push(r);
          pendapatan.subtotalLainnya += nom;
        }
        pendapatan.totalPendapatan += nom;
      } else if (r.jenis === "KELUAR") {
        const isJasa =
          r.purchaseOrder?.kategoriPO === "JASA" ||
          r.pembayaran?.purchaseOrder?.kategoriPO === "JASA" ||
          /jasa|mandor|borongan|subkon|tukang/i.test(ket);

        const isOperasional =
          (r.invoiceOperasional && r.invoiceOperasional.length > 0) ||
          noRef.startsWith("INV/OPS") ||
          /operasional/i.test(ket) ||
          r.sumberTransaksi === "OPERASIONAL";

        const isMaterialAlat =
          r.purchaseOrder ||
          r.poId ||
          r.pembayaran?.purchaseOrder ||
          /material|bahan|alat|sewa/i.test(ket);

        if (isJasa) {
          pengeluaran.jasa.push(r);
          pengeluaran.subtotalJasa += nom;
        } else if (isOperasional) {
          pengeluaran.operasional.push(r);
          pengeluaran.subtotalOperasional += nom;
        } else if (isMaterialAlat) {
          pengeluaran.materialAlat.push(r);
          pengeluaran.subtotalMaterialAlat += nom;
        } else {
          pengeluaran.lainnya.push(r);
          pengeluaran.subtotalLainnya += nom;
        }
        pengeluaran.totalPengeluaran += nom;
      }
    }

    const labaRugi = pendapatan.totalPendapatan - pengeluaran.totalPengeluaran;
    const profitMargin =
      pendapatan.totalPendapatan > 0
        ? Math.round((labaRugi / pendapatan.totalPendapatan) * 10000) / 100
        : 0;

    return {
      project,
      filter: { dari, sampai },
      summary: {
        totalPendapatan: pendapatan.totalPendapatan,
        totalPengeluaran: pengeluaran.totalPengeluaran,
        labaRugi,
        profitMargin,
      },
      pendapatan,
      pengeluaran,
    };
  }

  // Ringkasan per proyek untuk semua proyek
  const allProjects = await prisma.project.findMany({
    include: { client: { select: { id: true, name: true } } },
    orderBy: { name: "asc" },
  });

  const projectMap = new Map();
  for (const p of allProjects) {
    projectMap.set(p.id, {
      id: p.id,
      name: p.name,
      client: p.client,
      totalPendapatan: 0,
      totalPengeluaran: 0,
      labaRugi: 0,
      profitMargin: 0,
    });
  }

  let totalSemuaMasuk = 0;
  let totalSemuaKeluar = 0;

  for (const r of nonTransferRows) {
    const pId = resolveProjectId(r);
    if (!pId || !projectMap.has(pId)) continue;
    const pEntry = projectMap.get(pId);
    const nom = Number(r.nominal || 0);

    if (r.jenis === "MASUK") {
      pEntry.totalPendapatan += nom;
      totalSemuaMasuk += nom;
    } else if (r.jenis === "KELUAR") {
      pEntry.totalPengeluaran += nom;
      totalSemuaKeluar += nom;
    }
  }

  const projectList = Array.from(projectMap.values()).map((p) => {
    const labaRugi = p.totalPendapatan - p.totalPengeluaran;
    const profitMargin =
      p.totalPendapatan > 0 ? Math.round((labaRugi / p.totalPendapatan) * 10000) / 100 : 0;
    return { ...p, labaRugi, profitMargin };
  });

  const overallLaba = totalSemuaMasuk - totalSemuaKeluar;
  const overallMargin =
    totalSemuaMasuk > 0 ? Math.round((overallLaba / totalSemuaMasuk) * 10000) / 100 : 0;

  return {
    projects: projectList,
    overall: {
      totalPendapatan: totalSemuaMasuk,
      totalPengeluaran: totalSemuaKeluar,
      labaRugi: overallLaba,
      profitMargin: overallMargin,
    },
    filter: { dari, sampai },
  };
}

/**
 * GET /api/gl-bank/laporan-laba
 */
router.get("/laporan-laba", verifyToken, async (req, res) => {
  try {
    const { projectId, dari, sampai } = req.query;
    const data = await getLabaRugiData({ projectId, dari, sampai });
    if (!data) return res.status(404).json({ error: "Project tidak ditemukan." });
    res.json(data);
  } catch (e) {
    console.error("GET /gl-bank/laporan-laba error:", e);
    res.status(500).json({ error: e.message || "Gagal mengambil laporan laba rugi." });
  }
});

/**
 * GET /api/gl-bank/laporan-laba/export-excel
 * Menghasilkan file Excel (.xlsx) 1 Sheet
 */
router.get("/laporan-laba/export-excel", verifyToken, async (req, res) => {
  try {
    const { projectId, dari, sampai } = req.query;
    const data = await getLabaRugiData({ projectId, dari, sampai });
    if (!data) return res.status(404).json({ error: "Data laporan tidak ditemukan." });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "DIVES Management";
    workbook.lastModifiedBy = req.user?.name || "Finance DIVES";
    workbook.created = new Date();

    const fmtTglId = (d) =>
      d
        ? new Date(d).toLocaleDateString("id-ID", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })
        : "-";

    const borderThin = {
      top: { style: "thin", color: { argb: "FFE0E0E0" } },
      bottom: { style: "thin", color: { argb: "FFE0E0E0" } },
      left: { style: "thin", color: { argb: "FFE0E0E0" } },
      right: { style: "thin", color: { argb: "FFE0E0E0" } },
    };

    const borderDoubleBottom = {
      top: { style: "thin", color: { argb: "FF333333" } },
      bottom: { style: "double", color: { argb: "FF111111" } },
      left: { style: "thin", color: { argb: "FFE0E0E0" } },
      right: { style: "thin", color: { argb: "FFE0E0E0" } },
    };

    // JIKA PER PROYEK
    if (data.project) {
      const sheetName = "Laba Rugi - " + String(data.project.name || "Proyek").slice(0, 20).replace(/[/\\?*[\]]/g, "");
      const ws = workbook.addWorksheet(sheetName, {
        views: [{ showGridLines: true }],
      });

      // Set column widths
      ws.columns = [
        { key: "no", width: 6 },
        { key: "tgl", width: 14 },
        { key: "noRef", width: 22 },
        { key: "pihak", width: 26 },
        { key: "keterangan", width: 42 },
        { key: "vol", width: 18 },
        { key: "nominal", width: 22 },
      ];

      let currentRow = 1;

      // Header Brand
      ws.mergeCells(`A${currentRow}:G${currentRow}`);
      ws.getCell(`A${currentRow}`).value = "DIVES CORP / PT DIVES MANAGEMENT";
      ws.getCell(`A${currentRow}`).font = { name: "Arial", size: 14, bold: true, color: { argb: "FF1A1A1A" } };
      ws.getCell(`A${currentRow}`).alignment = { horizontal: "center", vertical: "middle" };
      ws.getRow(currentRow).height = 24;
      currentRow++;

      // Document Title
      ws.mergeCells(`A${currentRow}:G${currentRow}`);
      ws.getCell(`A${currentRow}`).value = "LAPORAN LABA RUGI PROYEK";
      ws.getCell(`A${currentRow}`).font = { name: "Arial", size: 12, bold: true, color: { argb: "FF856404" } };
      ws.getCell(`A${currentRow}`).alignment = { horizontal: "center", vertical: "middle" };
      ws.getRow(currentRow).height = 20;
      currentRow += 2;

      // Metadata Info Box
      const meta = [
        ["Nama Proyek", `: ${data.project.name}`],
        ["Klien", `: ${data.project.client?.name || "-"}`],
        ["Periode", `: ${dari && sampai ? `${fmtTglId(dari)} s/d ${fmtTglId(sampai)}` : "Semua Periode Transaksi"}`],
        ["Tanggal Cetak", `: ${fmtTglId(new Date())}`],
      ];
      meta.forEach(([k, v]) => {
        ws.getCell(`A${currentRow}`).value = k;
        ws.getCell(`A${currentRow}`).font = { name: "Arial", size: 10, bold: true, color: { argb: "FF555555" } };
        ws.mergeCells(`B${currentRow}:G${currentRow}`);
        ws.getCell(`B${currentRow}`).value = v;
        ws.getCell(`B${currentRow}`).font = { name: "Arial", size: 10, color: { argb: "FF222222" } };
        currentRow++;
      });
      currentRow++;

      // ==========================================
      // SECTION I: PENDAPATAN (UANG MASUK)
      // ==========================================
      ws.mergeCells(`A${currentRow}:G${currentRow}`);
      ws.getCell(`A${currentRow}`).value = "I. PENDAPATAN (TOTAL UANG MASUK PROYEK)";
      ws.getCell(`A${currentRow}`).font = { name: "Arial", size: 11, bold: true, color: { argb: "FF155724" } };
      ws.getCell(`A${currentRow}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD4EDDA" } };
      ws.getRow(currentRow).height = 22;
      currentRow++;

      const addTableHeader = (colTitles) => {
        const row = ws.getRow(currentRow);
        colTitles.forEach((t, i) => {
          const colLetter = String.fromCharCode(65 + i);
          const cell = ws.getCell(`${colLetter}${currentRow}`);
          cell.value = t;
          cell.font = { name: "Arial", size: 9, bold: true, color: { argb: "FFFFFFFF" } };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2C3E50" } };
          cell.alignment = { horizontal: i === 6 ? "right" : i === 0 ? "center" : "left", vertical: "middle" };
          cell.border = borderThin;
        });
        row.height = 20;
        currentRow++;
      };

      const addSubgroup = (title, items, isIncome = true) => {
        // Subgroup Header
        ws.mergeCells(`A${currentRow}:G${currentRow}`);
        ws.getCell(`A${currentRow}`).value = `▶ ${title} (${items.length} Transaksi)`;
        ws.getCell(`A${currentRow}`).font = { name: "Arial", size: 9, bold: true, color: { argb: "FF333333" } };
        ws.getCell(`A${currentRow}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F4F8" } };
        currentRow++;

        if (items.length === 0) {
          ws.mergeCells(`A${currentRow}:F${currentRow}`);
          ws.getCell(`A${currentRow}`).value = "Tidak ada transaksi";
          ws.getCell(`A${currentRow}`).font = { name: "Arial", size: 9, italic: true, color: { argb: "FF888888" } };
          ws.getCell(`G${currentRow}`).value = 0;
          ws.getCell(`G${currentRow}`).numFmt = "#,##0";
          ws.getCell(`G${currentRow}`).alignment = { horizontal: "right" };
          currentRow++;
          return;
        }

        addTableHeader(["No", "Tanggal", "No. Dokumen/Ref", "Pihak Terkait", "Keterangan", "Vol / Satuan", "Nominal (Rp)"]);

        let subtotal = 0;
        items.forEach((item, idx) => {
          const row = ws.getRow(currentRow);
          const nom = Number(item.nominal || 0);
          subtotal += nom;

          ws.getCell(`A${currentRow}`).value = idx + 1;
          ws.getCell(`A${currentRow}`).alignment = { horizontal: "center" };
          ws.getCell(`B${currentRow}`).value = fmtTglId(item.tanggal);
          ws.getCell(`C${currentRow}`).value = item.noReferensi || "-";
          ws.getCell(`D${currentRow}`).value = item.pihak || item.purchaseOrder?.supplier?.name || item.project?.name || "-";
          ws.getCell(`E${currentRow}`).value = item.keterangan || "-";
          ws.getCell(`F${currentRow}`).value = item.keteranganVolume || item.purchaseOrder?.items?.map(it => `${it.qty} ${it.unit || ''}`).join(", ") || "-";
          ws.getCell(`G${currentRow}`).value = nom;
          ws.getCell(`G${currentRow}`).numFmt = "#,##0";
          ws.getCell(`G${currentRow}`).font = { name: "Arial", size: 9, bold: true };

          for (let c = 1; c <= 7; c++) {
            ws.getCell(currentRow, c).border = borderThin;
            ws.getCell(currentRow, c).font = ws.getCell(currentRow, c).font || { name: "Arial", size: 9 };
          }
          currentRow++;
        });

        // Subtotal row
        ws.mergeCells(`A${currentRow}:F${currentRow}`);
        ws.getCell(`A${currentRow}`).value = `Subtotal ${title}`;
        ws.getCell(`A${currentRow}`).alignment = { horizontal: "right" };
        ws.getCell(`A${currentRow}`).font = { name: "Arial", size: 9, bold: true };
        ws.getCell(`G${currentRow}`).value = subtotal;
        ws.getCell(`G${currentRow}`).numFmt = "#,##0";
        ws.getCell(`G${currentRow}`).font = { name: "Arial", size: 9, bold: true, color: { argb: isIncome ? "FF155724" : "FF721C24" } };
        for (let c = 1; c <= 7; c++) ws.getCell(currentRow, c).border = borderThin;
        currentRow += 2;
      };

      // 1. Penjualan Desain
      addSubgroup("Penjualan Desain (Design Quotation)", data.pendapatan.desain, true);
      // 2. Penjualan Klien / Termin
      addSubgroup("Penjualan Klien / Termin Proyek (SPK Client)", data.pendapatan.klien, true);
      // 3. Pendapatan Lain-lain jika ada
      if (data.pendapatan.lainnya.length > 0) {
        addSubgroup("Pendapatan Proyek Lainnya", data.pendapatan.lainnya, true);
      }

      // Total Pendapatan Row
      ws.mergeCells(`A${currentRow}:F${currentRow}`);
      ws.getCell(`A${currentRow}`).value = "TOTAL PENDAPATAN (TOTAL UANG MASUK)";
      ws.getCell(`A${currentRow}`).alignment = { horizontal: "right", vertical: "middle" };
      ws.getCell(`A${currentRow}`).font = { name: "Arial", size: 10, bold: true, color: { argb: "FF155724" } };
      ws.getCell(`G${currentRow}`).value = data.pendapatan.totalPendapatan;
      ws.getCell(`G${currentRow}`).numFmt = "#,##0";
      ws.getCell(`G${currentRow}`).font = { name: "Arial", size: 11, bold: true, color: { argb: "FF155724" } };
      ws.getCell(`G${currentRow}`).alignment = { horizontal: "right", vertical: "middle" };
      for (let c = 1; c <= 7; c++) {
        ws.getCell(currentRow, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD4EDDA" } };
        ws.getCell(currentRow, c).border = borderDoubleBottom;
      }
      ws.getRow(currentRow).height = 22;
      currentRow += 2;

      // ==========================================
      // SECTION II: PENGELUARAN / BEBAN BIAYA
      // ==========================================
      ws.mergeCells(`A${currentRow}:G${currentRow}`);
      ws.getCell(`A${currentRow}`).value = "II. PENGELUARAN / BEBAN BIAYA PROYEK (TOTAL UANG KELUAR)";
      ws.getCell(`A${currentRow}`).font = { name: "Arial", size: 11, bold: true, color: { argb: "FF721C24" } };
      ws.getCell(`A${currentRow}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8D7DA" } };
      ws.getRow(currentRow).height = 22;
      currentRow++;

      // 1. PO Material & Alat
      addSubgroup("PO Material & Pembelian/Sewa Alat", data.pengeluaran.materialAlat, false);
      // 2. PO Jasa & Mandor
      addSubgroup("PO Jasa & Mandor (Subkontraktor / Upah)", data.pengeluaran.jasa, false);
      // 3. Biaya Operasional Proyek
      addSubgroup("Biaya Operasional Proyek", data.pengeluaran.operasional, false);
      // 4. Pengeluaran Lainnya
      if (data.pengeluaran.lainnya.length > 0) {
        addSubgroup("Pengeluaran Proyek Lainnya", data.pengeluaran.lainnya, false);
      }

      // Total Pengeluaran Row
      ws.mergeCells(`A${currentRow}:F${currentRow}`);
      ws.getCell(`A${currentRow}`).value = "TOTAL PENGELUARAN (TOTAL UANG KELUAR)";
      ws.getCell(`A${currentRow}`).alignment = { horizontal: "right", vertical: "middle" };
      ws.getCell(`A${currentRow}`).font = { name: "Arial", size: 10, bold: true, color: { argb: "FF721C24" } };
      ws.getCell(`G${currentRow}`).value = data.pengeluaran.totalPengeluaran;
      ws.getCell(`G${currentRow}`).numFmt = "#,##0";
      ws.getCell(`G${currentRow}`).font = { name: "Arial", size: 11, bold: true, color: { argb: "FF721C24" } };
      ws.getCell(`G${currentRow}`).alignment = { horizontal: "right", vertical: "middle" };
      for (let c = 1; c <= 7; c++) {
        ws.getCell(currentRow, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8D7DA" } };
        ws.getCell(currentRow, c).border = borderDoubleBottom;
      }
      ws.getRow(currentRow).height = 22;
      currentRow += 2;

      // ==========================================
      // SECTION III: RINGKASAN AKHIR & LABA/RUGI
      // ==========================================
      ws.mergeCells(`A${currentRow}:G${currentRow}`);
      ws.getCell(`A${currentRow}`).value = "III. RINGKASAN EKSEKUTIF LABA / RUGI BERSIH";
      ws.getCell(`A${currentRow}`).font = { name: "Arial", size: 11, bold: true, color: { argb: "FF1A1A1A" } };
      ws.getCell(`A${currentRow}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9ECEF" } };
      ws.getRow(currentRow).height = 20;
      currentRow++;

      const isProfit = data.summary.labaRugi >= 0;

      // Summary lines
      const summaryItems = [
        ["Total Pendapatan (Uang Masuk)", data.summary.totalPendapatan, false, "#,##0"],
        ["Total Pengeluaran (Uang Keluar)", data.summary.totalPengeluaran, false, "#,##0"],
        [isProfit ? "LABA BERSIH PROYEK (SURPLUS)" : "RUGI BERSIH PROYEK (DEFISIT)", data.summary.labaRugi, true, "#,##0"],
        ["PROFIT MARGIN (%)", `${data.summary.profitMargin} %`, true, "@"],
      ];

      summaryItems.forEach(([lbl, val, isHighlight, numFmt]) => {
        ws.mergeCells(`A${currentRow}:F${currentRow}`);
        ws.getCell(`A${currentRow}`).value = lbl;
        ws.getCell(`A${currentRow}`).font = {
          name: "Arial",
          size: isHighlight ? 11 : 10,
          bold: isHighlight,
          color: { argb: isHighlight ? (isProfit ? "FF155724" : "FF721C24") : "FF333333" },
        };
        ws.getCell(`A${currentRow}`).alignment = { horizontal: "right", vertical: "middle" };

        ws.getCell(`G${currentRow}`).value = val;
        ws.getCell(`G${currentRow}`).font = {
          name: "Arial",
          size: isHighlight ? 12 : 10,
          bold: isHighlight,
          color: { argb: isHighlight ? (isProfit ? "FF155724" : "FF721C24") : "FF222222" },
        };
        ws.getCell(`G${currentRow}`).alignment = { horizontal: "right", vertical: "middle" };
        if (numFmt !== "@") ws.getCell(`G${currentRow}`).numFmt = numFmt;

        for (let c = 1; c <= 7; c++) {
          ws.getCell(currentRow, c).border = isHighlight ? borderDoubleBottom : borderThin;
          if (isHighlight) {
            ws.getCell(currentRow, c).fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: isProfit ? "FFD4EDDA" : "FFF8D7DA" },
            };
          }
        }
        ws.getRow(currentRow).height = isHighlight ? 24 : 20;
        currentRow++;
      });
      currentRow += 2;

      // Signatures
      ws.mergeCells(`A${currentRow}:C${currentRow}`);
      ws.getCell(`A${currentRow}`).value = "Dibuat Oleh:";
      ws.getCell(`A${currentRow}`).alignment = { horizontal: "center" };
      ws.getCell(`A${currentRow}`).font = { name: "Arial", size: 9, bold: true };

      ws.mergeCells(`D${currentRow}:E${currentRow}`);
      ws.getCell(`D${currentRow}`).value = "Diketahui Oleh:";
      ws.getCell(`D${currentRow}`).alignment = { horizontal: "center" };
      ws.getCell(`D${currentRow}`).font = { name: "Arial", size: 9, bold: true };

      ws.mergeCells(`F${currentRow}:G${currentRow}`);
      ws.getCell(`F${currentRow}`).value = "Disetujui Oleh:";
      ws.getCell(`F${currentRow}`).alignment = { horizontal: "center" };
      ws.getCell(`F${currentRow}`).font = { name: "Arial", size: 9, bold: true };
      currentRow += 4;

      ws.mergeCells(`A${currentRow}:C${currentRow}`);
      ws.getCell(`A${currentRow}`).value = "( Finance & Kasir )";
      ws.getCell(`A${currentRow}`).alignment = { horizontal: "center" };

      ws.mergeCells(`D${currentRow}:E${currentRow}`);
      ws.getCell(`D${currentRow}`).value = "( Project Manager )";
      ws.getCell(`D${currentRow}`).alignment = { horizontal: "center" };

      ws.mergeCells(`F${currentRow}:G${currentRow}`);
      ws.getCell(`F${currentRow}`).value = "( Direktur Utama )";
      ws.getCell(`F${currentRow}`).alignment = { horizontal: "center" };

      const safeFilename = `Laporan-Laba-Rugi-${String(data.project.name || "Project").replace(/[^a-zA-Z0-9_-]/g, "_")}.xlsx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${safeFilename}"`);
      await workbook.xlsx.write(res);
      return res.end();
    }

    // JIKA REKAP SEMUA PROYEK
    const ws = workbook.addWorksheet("Rekap Laba Rugi Semua Proyek", {
      views: [{ showGridLines: true }],
    });

    ws.columns = [
      { key: "no", width: 6 },
      { key: "proyek", width: 32 },
      { key: "klien", width: 28 },
      { key: "masuk", width: 24 },
      { key: "keluar", width: 24 },
      { key: "laba", width: 24 },
      { key: "margin", width: 16 },
    ];

    let currentRow = 1;
    ws.mergeCells(`A${currentRow}:G${currentRow}`);
    ws.getCell(`A${currentRow}`).value = "REKAPITULASI LABA RUGI PROYEK - DIVES CORP";
    ws.getCell(`A${currentRow}`).font = { name: "Arial", size: 14, bold: true };
    ws.getCell(`A${currentRow}`).alignment = { horizontal: "center", vertical: "middle" };
    ws.getRow(currentRow).height = 24;
    currentRow += 2;

    const headers = ["No", "Nama Proyek", "Klien", "Total Uang Masuk (Rp)", "Total Uang Keluar (Rp)", "Laba / (Rugi) Bersih (Rp)", "Margin (%)"];
    headers.forEach((h, i) => {
      const colLetter = String.fromCharCode(65 + i);
      const cell = ws.getCell(`${colLetter}${currentRow}`);
      cell.value = h;
      cell.font = { name: "Arial", size: 9, bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2C3E50" } };
      cell.alignment = { horizontal: i >= 3 ? "right" : i === 0 ? "center" : "left", vertical: "middle" };
      cell.border = borderThin;
    });
    currentRow++;

    (data.projects || []).forEach((p, idx) => {
      ws.getCell(`A${currentRow}`).value = idx + 1;
      ws.getCell(`A${currentRow}`).alignment = { horizontal: "center" };
      ws.getCell(`B${currentRow}`).value = p.name;
      ws.getCell(`C${currentRow}`).value = p.client?.name || "-";
      ws.getCell(`D${currentRow}`).value = p.totalPendapatan;
      ws.getCell(`D${currentRow}`).numFmt = "#,##0";
      ws.getCell(`E${currentRow}`).value = p.totalPengeluaran;
      ws.getCell(`E${currentRow}`).numFmt = "#,##0";
      ws.getCell(`F${currentRow}`).value = p.labaRugi;
      ws.getCell(`F${currentRow}`).numFmt = "#,##0";
      ws.getCell(`F${currentRow}`).font = { name: "Arial", size: 9, bold: true, color: { argb: p.labaRugi >= 0 ? "FF155724" : "FF721C24" } };
      ws.getCell(`G${currentRow}`).value = `${p.profitMargin} %`;
      ws.getCell(`G${currentRow}`).alignment = { horizontal: "right" };

      for (let c = 1; c <= 7; c++) ws.getCell(currentRow, c).border = borderThin;
      currentRow++;
    });

    // Total Overall
    ws.mergeCells(`A${currentRow}:C${currentRow}`);
    ws.getCell(`A${currentRow}`).value = "TOTAL KESELURUHAN PROYEK";
    ws.getCell(`A${currentRow}`).font = { name: "Arial", size: 10, bold: true };
    ws.getCell(`A${currentRow}`).alignment = { horizontal: "right" };
    ws.getCell(`D${currentRow}`).value = data.overall.totalPendapatan;
    ws.getCell(`D${currentRow}`).numFmt = "#,##0";
    ws.getCell(`D${currentRow}`).font = { name: "Arial", size: 10, bold: true };
    ws.getCell(`E${currentRow}`).value = data.overall.totalPengeluaran;
    ws.getCell(`E${currentRow}`).numFmt = "#,##0";
    ws.getCell(`E${currentRow}`).font = { name: "Arial", size: 10, bold: true };
    ws.getCell(`F${currentRow}`).value = data.overall.labaRugi;
    ws.getCell(`F${currentRow}`).numFmt = "#,##0";
    ws.getCell(`F${currentRow}`).font = { name: "Arial", size: 10, bold: true, color: { argb: data.overall.labaRugi >= 0 ? "FF155724" : "FF721C24" } };
    ws.getCell(`G${currentRow}`).value = `${data.overall.profitMargin} %`;
    ws.getCell(`G${currentRow}`).alignment = { horizontal: "right" };
    ws.getCell(`G${currentRow}`).font = { name: "Arial", size: 10, bold: true };

    for (let c = 1; c <= 7; c++) {
      ws.getCell(currentRow, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9ECEF" } };
      ws.getCell(currentRow, c).border = borderDoubleBottom;
    }

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="Rekap-Laba-Rugi-Semua-Proyek.xlsx"`);
    await workbook.xlsx.write(res);
    return res.end();
  } catch (e) {
    console.error("GET /gl-bank/laporan-laba/export-excel error:", e);
    res.status(500).json({ error: e.message || "Gagal mengexport excel laporan laba rugi." });
  }
});

module.exports = router;
module.exports.createTransaksiBukuBesar = createTransaksiBukuBesar;
