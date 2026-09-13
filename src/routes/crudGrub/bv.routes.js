"use strict";

const express = require("express");
const prisma = require("../../lib/prisma");
const { calculateJobPrice } = require("../../services/calculateService");
const {
  buildBreakdownRows,
  withStatus,
} = require("../../services/bvCalculationService");
const { computeAhspPricing } = require("../../services/ahspPricingService");

const router = express.Router();

/**
 * POST /projects/:projectId/bv-items
 * Mode HSPK: sourceJobTypeId diisi, name/paymentUnit diambil otomatis dari JobType.
 * Mode Custom: sourceJobTypeId kosong, name/paymentUnit wajib diketik manual.
 */
router.post("/projects/:projectId/bv-items", async (req, res) => {
  try {
    const { projectId } = req.params;
    const {
      sourceJobTypeId,
      name,
      keterangan,
      paymentUnit,
      groupId,
      ecommerceLink,
      nameEcommerceLink,
      breakdowns,
      parentBvItemId,
      isHeaderOnly,
    } = req.body;

    if (
      !isHeaderOnly &&
      (!Array.isArray(breakdowns) || breakdowns.length === 0)
    ) {
      return res.status(400).json({
        error: "Minimal harus ada 1 baris breakdown dimensi (kecuali header).",
      });
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project)
      return res.status(404).json({ error: "Project tidak ditemukan." });

    if (groupId) {
      const group = await prisma.rabGroup.findUnique({
        where: { id: groupId },
      });
      if (!group)
        return res
          .status(404)
          .json({ error: "Group/Sub-Group tidak ditemukan." });
      if (group.projectId !== projectId)
        return res
          .status(400)
          .json({ error: "Group bukan milik project ini." });
    }

    let finalGroupId = groupId || null;
    let parent = null;

    if (parentBvItemId) {
      parent = await prisma.bvItem.findUnique({
        where: { id: parentBvItemId },
      });
      if (!parent)
        return res.status(404).json({ error: "Item induk tidak ditemukan." });

      if (!groupId) {
        finalGroupId = parent.groupId;
      }
    }

    let finalName = name;
    let finalUnit = paymentUnit;

    if (sourceJobTypeId) {
      const jobType = await prisma.jobType.findUnique({
        where: { id: sourceJobTypeId },
      });
      if (!jobType)
        return res
          .status(404)
          .json({ error: "Jenis pekerjaan (master) tidak ditemukan." });
      finalName = jobType.name;
      finalUnit = jobType.paymentUnit;
    } else if (!isHeaderOnly) {
      if (!name || !paymentUnit) {
        return res.status(400).json({
          error:
            'Field "name" dan "paymentUnit" wajib diisi untuk item custom.',
        });
      }
    } else if (!name) {
      return res
        .status(400)
        .json({ error: 'Field "name" wajib diisi untuk header.' });
    }

    const breakdownRows = isHeaderOnly ? [] : buildBreakdownRows(breakdowns);

    const totalVolume = breakdownRows.reduce((sum, b) => sum + b.subTotal, 0);

    const bvItem = await prisma.bvItem.create({
      data: {
        projectId,
        groupId: finalGroupId,
        parentBvItemId: parentBvItemId || null,
        isHeaderOnly: !!isHeaderOnly,
        sourceJobTypeId: sourceJobTypeId || null,
        name: finalName,
        keterangan: keterangan || null,
        paymentUnit: isHeaderOnly ? finalUnit || null : finalUnit,
        ecommerceLink: ecommerceLink || null,
        nameEcommerceLink: nameEcommerceLink || null,
        totalVolume,
        breakdowns: { create: breakdownRows },
      },
      include: {
        breakdowns: true,
        sourceJobType: true,
        children: { include: { breakdowns: true } },
      },
    });

    res
      .status(201)
      .json({ message: "Item BV berhasil ditambahkan", data: bvItem });
  } catch (error) {
    console.error("Error Create BvItem:", error);
    res
      .status(500)
      .json({ error: error.message || "Terjadi kesalahan pada server." });
  }
});
/** GET /projects/:projectId/bv-items */
router.get("/projects/:projectId/bv-items", async (req, res) => {
  try {
    const { projectId } = req.params;
    const items = await prisma.bvItem.findMany({
      where: { projectId, parentBvItemId: null },
      include: {
        breakdowns: true,
        linkedRabItem: true,
        sourceJobType: true,
        children: {
          include: {
            breakdowns: true,
            linkedRabItem: true,
            sourceJobType: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    res.json(items.map(withStatus));
  } catch (error) {
    console.error("Error List BvItem:", error);
    res.status(500).json({ error: "Terjadi kesalahan pada server." });
  }
});

/** PUT /bv-items/:id — edit dimensi/breakdown (jalur SATU-SATUNYA untuk ubah volume) */
router.put("/bv-items/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      sourceJobTypeId,
      name,
      keterangan,
      paymentUnit,
      groupId,
      ecommerceLink,
      nameEcommerceLink,
      breakdowns,
      parentBvItemId,
      isHeaderOnly,
    } = req.body;

    const existing = await prisma.bvItem.findUnique({ where: { id } });
    if (!existing)
      return res.status(404).json({ error: "Item BV tidak ditemukan." });

    const finalIsHeaderOnly =
      isHeaderOnly !== undefined ? !!isHeaderOnly : existing.isHeaderOnly;

    // validasi groupId, samain pola POST
    if (groupId) {
      const group = await prisma.rabGroup.findUnique({
        where: { id: groupId },
      });
      if (!group)
        return res
          .status(404)
          .json({ error: "Group/Sub-Group tidak ditemukan." });
      if (group.projectId !== existing.projectId)
        return res
          .status(400)
          .json({ error: "Group bukan milik project ini." });
    }

    // validasi parentBvItemId, samain pola POST
    let finalGroupId = groupId !== undefined ? groupId || null : undefined;
    if (parentBvItemId) {
      const parent = await prisma.bvItem.findUnique({
        where: { id: parentBvItemId },
      });
      if (!parent)
        return res.status(404).json({ error: "Item induk tidak ditemukan." });

      if (groupId === undefined) {
        finalGroupId = parent.groupId;
      }
    }

    let finalName = existing.name;
    let finalUnit = existing.paymentUnit;
    let finalSourceId = existing.sourceJobTypeId;

    if (sourceJobTypeId !== undefined) {
      if (sourceJobTypeId) {
        const jobType = await prisma.jobType.findUnique({
          where: { id: sourceJobTypeId },
        });
        if (!jobType)
          return res
            .status(404)
            .json({ error: "Jenis pekerjaan (master) tidak ditemukan." });
        finalName = jobType.name;
        finalUnit = jobType.paymentUnit;
        finalSourceId = sourceJobTypeId;
      } else {
        finalSourceId = null;
        if (name) finalName = name;
        if (paymentUnit) finalUnit = paymentUnit;
      }
    } else if (!existing.sourceJobTypeId) {
      if (name !== undefined) finalName = name;
      if (paymentUnit !== undefined) finalUnit = paymentUnit;
    }

    // validasi name wajib buat header custom, samain pola POST
    if (finalIsHeaderOnly && !finalSourceId && !finalName) {
      return res
        .status(400)
        .json({ error: 'Field "name" wajib diisi untuk header.' });
    }

    let totalVolume = Number(existing.totalVolume);
    let breakdownUpdate;

    if (Array.isArray(breakdowns)) {
      if (!finalIsHeaderOnly && breakdowns.length === 0) {
        return res.status(400).json({
          error:
            "Minimal harus ada 1 baris breakdown dimensi (kecuali header).",
        });
      }

      // UBAH BARIS INI: Tambahkan finalUnit ke dalam pemanggilan fungsi
      const rows = finalIsHeaderOnly
        ? []
        : buildBreakdownRows(breakdowns, finalUnit);

      totalVolume = rows.reduce((sum, b) => sum + b.subTotal, 0);
      breakdownUpdate = { deleteMany: {}, create: rows };
    }

    const updated = await prisma.bvItem.update({
      where: { id },
      data: {
        name: finalName,
        paymentUnit: finalIsHeaderOnly ? finalUnit || null : finalUnit,
        sourceJobTypeId: finalSourceId,
        ...(keterangan !== undefined ? { keterangan } : {}),
        ...(parentBvItemId !== undefined
          ? { parentBvItemId: parentBvItemId || null }
          : {}),
        ...(isHeaderOnly !== undefined
          ? { isHeaderOnly: finalIsHeaderOnly }
          : {}),
        ...(finalGroupId !== undefined ? { groupId: finalGroupId } : {}),
        ...(ecommerceLink !== undefined ? { ecommerceLink } : {}),
        ...(nameEcommerceLink !== undefined ? { nameEcommerceLink } : {}),
        totalVolume,
        ...(breakdownUpdate ? { breakdowns: breakdownUpdate } : {}),
      },
      include: { breakdowns: true, sourceJobType: true },
    });

    res.json({ message: "Item BV berhasil diperbarui", data: updated });
  } catch (error) {
    console.error("Error Update BvItem:", error);
    res
      .status(500)
      .json({ error: error.message || "Terjadi kesalahan pada server." });
  }
});

/** DELETE /bv-items/:id */
router.delete("/bv-items/:id", async (req, res) => {
  try {
    await prisma.bvItem.delete({ where: { id: req.params.id } });
    res.json({ message: "Item BV berhasil dihapus." });
  } catch (error) {
    if (error.code === "P2025")
      return res.status(404).json({ error: "Item BV tidak ditemukan." });
    console.error("Error Delete BvItem:", error);
    res.status(500).json({ error: "Terjadi kesalahan pada server." });
  }
});

router.delete("/bv-items-bulk", async (req, res) => {
  try {
    // Menangkap array ID dari frontend
    const { itemIds } = req.body;

    if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
      return res
        .status(400)
        .json({ error: "Tidak ada item yang dipilih untuk dihapus." });
    }

    // Eksekusi hapus massal (Prisma akan menghapus semua ID yang ada di dalam array)
    const deleted = await prisma.bvItem.deleteMany({
      where: {
        id: { in: itemIds },
      },
    });

    res.json({
      message: `${deleted.count} Item BV berhasil dihapus secara massal.`,
    });
  } catch (error) {
    console.error("Error Bulk Delete BV:", error);
    res
      .status(500)
      .json({ error: error.message || "Gagal menghapus data massal." });
  }
});

// ===========================================================================
// HELPER STRUKTUR — dipakai endpoint link & sync (single maupun massal)
//
// Masalah yang ditutup di sini:
//  1. Anak BV yang induknya belum ter-link dulu selalu jadi baris yatim di
//     RAB ( parentId null ) -> tampil lepas, tidak di bawah headernya.
//  2. Reposisi anak memakai rumus parent.order + 1 untuk SEMUA anak, jadi
//     kalau satu induk punya >1 anak, order-nya bentrok dan urutannya acak.
// ===========================================================================

/**
 * Pastikan seluruh garis induk (ancestor) sebuah item BV sudah punya pasangan
 * RAB. Induk yang belum terlink dibuatkan "cangkang header" lebih dulu (harga
 * 0, isHeaderOnly true) supaya anak tidak pernah kehilangan headernya.
 * Mengembalikan id RAB milik induk langsung.
 */
async function pastikanIndukTerlink(tx, bvItem) {
  if (!bvItem.parentBvItemId) return null;

  const parent = await tx.bvItem.findUnique({
    where: { id: bvItem.parentBvItemId },
  });
  if (!parent) return null;
  if (parent.linkedRabItemId) return parent.linkedRabItemId;

  // naik dulu ke atas: kakek harus ada sebelum bapak dibuat
  const grandParentRabId = await pastikanIndukTerlink(tx, parent);

  const last = await tx.rabItem.findFirst({
    where: { projectId: parent.projectId, groupId: parent.groupId ?? null },
    orderBy: { order: "desc" },
    select: { order: true },
  });
  const proj = await tx.project.findUnique({
    where: { id: parent.projectId },
    select: { discipline: true, grade: true },
  });

  const shell = await tx.rabItem.create({
    data: {
      projectId: parent.projectId,
      groupId: parent.groupId ?? null,
      parentId: grandParentRabId,
      name: parent.name,
      paymentUnit: parent.paymentUnit || "-",
      volume: Number(parent.totalVolume) || 0,
      isHeaderOnly: true,
      discipline: proj?.discipline || null,
      grade: proj?.grade || null,
      overheadPercent: 0,
      rapUnitPrice: 0,
      rapTotalPrice: 0,
      rabUnitPrice: 0,
      rabTotalPrice: 0,
      sourceJobTypeId: parent.sourceJobTypeId || null,
      order: last ? last.order + 1 : 0,
    },
  });

  await tx.bvItem.update({
    where: { id: parent.id },
    data: { linkedRabItemId: shell.id, isHeaderOnly: true },
  });

  if (grandParentRabId) {
    const gpBv = await tx.bvItem.findUnique({
      where: { id: parent.parentBvItemId },
      select: { id: true },
    });
    if (gpBv) await rapikanAnak(tx, gpBv.id);
  }

  return shell.id;
}

/**
 * Susun ulang SEMUA anak terlink dari satu induk BV: tempel parentId-nya ke
 * header RAB induk, lalu beri order berurutan tepat di bawah header
 * (parent.order + 1, +2, +3 ...) sesuai urutan dibuat. Induk otomatis jadi
 * header. Dipakai setelah link/sync supaya posisi anak selalu ikut headernya.
 */
async function rapikanAnak(tx, indukBvId) {
  const induk = await tx.bvItem.findUnique({
    where: { id: indukBvId },
    select: { linkedRabItemId: true, id: true },
  });
  if (!induk?.linkedRabItemId) return;

  const header = await tx.rabItem.findUnique({
    where: { id: induk.linkedRabItemId },
    select: { id: true, order: true, groupId: true, projectId: true },
  });
  if (!header) return;

  const anak = await tx.bvItem.findMany({
    where: { parentBvItemId: induk.id, linkedRabItemId: { not: null } },
    select: { linkedRabItemId: true },
    orderBy: { createdAt: "asc" },
  });
  if (anak.length === 0) return;

  const idAnak = anak.map((a) => a.linkedRabItemId).filter(Boolean);

  // tandai header supaya barisnya jadi induk, bukan item ber-harga
  await tx.rabItem.update({
    where: { id: header.id },
    data: { isHeaderOnly: true },
  });

  // parkir dulu anak-anaknya biar tidak dihitung saat menggeser
  await tx.rabItem.updateMany({
    where: { id: { in: idAnak } },
    data: { parentId: header.id, order: -1 },
  });

  // ruang kosongkan di bawah header sebanyak jumlah anak
  await tx.rabItem.updateMany({
    where: {
      projectId: header.projectId,
      groupId: header.groupId ?? null,
      order: { gte: header.order + 1 },
      id: { notIn: [header.id, ...idAnak] },
    },
    data: { order: { increment: idAnak.length } },
  });

  // tempatkan berurutan: header+1, header+2, dst
  for (let i = 0; i < idAnak.length; i++) {
    await tx.rabItem.update({
      where: { id: idAnak[i] },
      data: { order: header.order + 1 + i },
    });
  }
}

/** POST /bv-items/:id/sync — update volume RAB sesuai BV terbaru */
router.post("/bv-items/:id/link-to-rab", async (req, res) => {
  try {
    const { id } = req.params;
    // Tambahkan includeChildren dari req.body
    const {
      rabUnitPrice,
      groupId,
      category,
      reference,
      overhead,
      components,
      includeChildren,
    } = req.body;

    const bvItem = await prisma.bvItem.findUnique({ where: { id } });
    if (!bvItem)
      return res.status(404).json({ error: "Item BV tidak ditemukan." });

    if (bvItem.linkedRabItemId) {
      return res.status(400).json({
        error:
          "Item BV ini sudah pernah di-link ke RAB. Hapus link lama dulu kalau mau link ulang.",
      });
    }

    const vol = Number(bvItem.totalVolume);
    let finalCategory = category || null;
    let finalReference = reference || null;

    const pricing = await computeAhspPricing({
      sourceJobTypeId: bvItem.sourceJobTypeId,
      customComponents: components,
      overheadOverride:
        overhead != null && overhead !== "" ? Number(overhead) : undefined,
    });

    if (bvItem.sourceJobTypeId && !pricing) {
      return res
        .status(404)
        .json({ error: "Jenis pekerjaan (master) tidak ditemukan." });
    }

    const rapUnitPrice = pricing.rapUnitPrice;
    const overheadPct = pricing.overheadPct;
    const calculatedRabPrice = pricing.rabUnitPrice;
    const componentRows = pricing.componentRows || [];

    if (bvItem.sourceJobTypeId) {
      finalCategory = category || pricing.jobType.category;
      finalReference = reference || pricing.jobType.reference;
    }

    // ==========================================
    // 3. TENTUKAN HARGA FINAL JUAL & SIMPAN
    // ==========================================
    const finalRabSatuan =
      rabUnitPrice != null && rabUnitPrice !== ""
        ? Number(rabUnitPrice)
        : calculatedRabPrice;

    const result = await prisma.$transaction(async (tx) => {
      const finalGroupId = groupId || bvItem.groupId || null;
      let insertOrder;
      let rabParentId = null;

      // --- LOGIKA ORDERING ---
      // Anak tidak boleh jadi yatim: kalau induknya belum ter-link,
      // buat cangkang header RAB untuk induk (dan leluhurnya) lebih dulu.
      if (bvItem.parentBvItemId) {
        rabParentId = await pastikanIndukTerlink(tx, bvItem);

        if (rabParentId) {
          const parentRab = await tx.rabItem.findUnique({
            where: { id: rabParentId },
            select: { order: true, groupId: true },
          });

          // anak menempel di akhir barisan saudara yang sudah ada
          const maxSiblingOrder = await tx.bvItem.findMany({
            where: {
              parentBvItemId: bvItem.parentBvItemId,
              linkedRabItemId: { not: null },
            },
            include: { linkedRabItem: { select: { order: true } } },
          });
          const batas = maxSiblingOrder.length
            ? Math.max(
                ...maxSiblingOrder
                  .map((s) => s.linkedRabItem?.order ?? -1)
                  .filter((o) => o >= 0),
              )
            : parentRab.order;

          insertOrder = Math.max(batas, parentRab.order) + 1;

          await tx.rabItem.updateMany({
            where: {
              projectId: bvItem.projectId,
              groupId: finalGroupId,
              order: { gte: insertOrder },
            },
            data: { order: { increment: 1 } },
          });
        }
      }

      if (insertOrder === undefined) {
        const lastItem = await tx.rabItem.findFirst({
          where: { projectId: bvItem.projectId, groupId: finalGroupId },
          orderBy: { order: "desc" },
          select: { order: true },
        });
        insertOrder = lastItem ? lastItem.order + 1 : 0;
      }

      // --- CREATE PARENT DI TABEL RAB ---
      // FIX: discipline dulu tidak pernah diisi (selalu null) walau project punya
      // discipline. Diwarisi dari project supaya filter per-disiplin di FE bekerja.
      const bvProject = await tx.project.findUnique({
        where: { id: bvItem.projectId },
        select: { discipline: true, grade: true },
      });

      const rabItem = await tx.rabItem.create({
        data: {
          projectId: bvItem.projectId,
          groupId: finalGroupId,
          parentId: rabParentId, // <-- Pastikan terhubung ke parent jika ada
          name: bvItem.name,
          paymentUnit: bvItem.paymentUnit || "-",
          category: finalCategory,
          reference: finalReference,
          overheadPercent: overheadPct, // <-- Pastikan overheadPercent
          volume: vol,
          isHeaderOnly: bvItem.isHeaderOnly || false,
          discipline: bvProject?.discipline || null,
          grade: bvProject?.grade || null,

          rapUnitPrice: rapUnitPrice,
          rapTotalPrice: rapUnitPrice * vol,
          rabUnitPrice: finalRabSatuan,
          rabTotalPrice: finalRabSatuan * vol,
          sourceJobTypeId: bvItem.sourceJobTypeId || null,
          order: insertOrder,
          components: { create: componentRows },
        },
      });

      // =================================================================
      // 🔥 FITUR BARU: AUTO LINK CHILDREN JIKA DIA PUNYA ANAK 🔥
      // =================================================================
      if (includeChildren) {
        // Cari anak-anak BV yang BELUM di-link
        const unlinkedChildren = await tx.bvItem.findMany({
          where: { parentBvItemId: id, linkedRabItemId: null },
          orderBy: { createdAt: "asc" },
        });

        for (const childBv of unlinkedChildren) {
          let childRapSatuan = 0;
          let childComponents = [];
          let childOverhead = 10;
          let childCategory = finalCategory; // Ikut dari parent

          // Jika si anak punya referensi AHSP, kita ambil rinciannya
          if (childBv.sourceJobTypeId) {
            const calc = await calculateJobPrice(childBv.sourceJobTypeId);
            if (calc) {
              childOverhead = calc.jobType.overhead
                ? Number(calc.jobType.overhead)
                : 10;
              childCategory = calc.jobType.category || childCategory;

              childComponents = Object.entries(calc.breakdown).flatMap(
                ([section, items]) =>
                  items.map((item) => ({
                    name: item.name,
                    unit: item.unit,
                    section,
                    coefficient: item.coefficient,
                    unitPrice: item.unitPrice,
                    lineTotal: item.lineTotal,
                  })),
              );
              childRapSatuan = childComponents.reduce(
                (sum, comp) => sum + Number(comp.lineTotal),
                0,
              );
            }
          }

          const childVol = Number(childBv.totalVolume);
          const childRabSatuan =
            childRapSatuan + childRapSatuan * (childOverhead / 100);

          // Buat item RAB untuk anak
          const childRab = await tx.rabItem.create({
            data: {
              projectId: childBv.projectId,
              groupId: finalGroupId,
              parentId: rabItem.id, // <-- PENTING: Sambungkan ke Parent RAB yg baru dibuat!
              name: childBv.name,
              paymentUnit: childBv.paymentUnit || "-",
              category: childCategory,
              overheadPercent: childOverhead,
              volume: childVol,
              // FIX: warisi discipline project (dulu selalu null)
              discipline: bvProject?.discipline || null,
              grade: bvProject?.grade || null,
              rapUnitPrice: childRapSatuan,
              rapTotalPrice: childRapSatuan * childVol,
              rabUnitPrice: childRabSatuan,
              rabTotalPrice: childRabSatuan * childVol,
              sourceJobTypeId: childBv.sourceJobTypeId || null,
              order: -1, // Set -1 dulu sementara, blok di bawah yang akan mengurutkan
              components: { create: childComponents },
            },
          });

          // Tandai BV anak sudah di-link
          await tx.bvItem.update({
            where: { id: childBv.id },
            data: { linkedRabItemId: childRab.id },
          });
        }
      }
      // =================================================================

      // --- UPDATE URUTAN DAN PARENT ID UNTUK SEMUA ANAK ---
      // (Termasuk anak yang lama dan anak yang baru saja dibuat di atas)
      // Pakai helper supaya order anak berurutan (header+1, +2, +3), bukan
      // semuanya rebutan di header+1 saat induk punya lebih dari satu anak.
      await rapikanAnak(tx, id);

      // --- UPDATE PARENT BV ITEM ---
      const updatedBv = await tx.bvItem.update({
        where: { id },
        data: { linkedRabItemId: rabItem.id },
      });

      return { rabItem, bvItem: updatedBv };
    });

    res
      .status(201)
      .json({ message: "Item BV berhasil di-link ke RAB", data: result });
  } catch (error) {
    console.error("Error Link BvItem to Rab:", error);
    res
      .status(500)
      .json({ error: error.message || "Terjadi kesalahan pada server." });
  }
});

// ==========================================
// BULK ACTION: LINK TO RAB MASSAL
// ==========================================
router.post("/bv-items-bulk/link-to-rab", async (req, res) => {
  try {
    const { itemIds } = req.body;

    if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
      return res
        .status(400)
        .json({ error: "Tidak ada item yang dipilih untuk di-link." });
    }

    const results = await prisma.$transaction(async (tx) => {
      let linkedCount = 0;
      const indukTersentuh = new Set();

      // 1. Ambil semua data BV yang diceklis sekaligus
      const bvItemsRaw = await tx.bvItem.findMany({
        where: { id: { in: itemIds } },
        orderBy: { createdAt: "asc" }, // Amankan urutan aslinya berdasarkan waktu pembuatan
      });

      // 2. Trik Jitu: Pisahkan Induk dan Anak!
      // Kita wajib membuat Induknya lebih dulu, supaya saat Anak dibuat, Induknya sudah siap di RAB.
      const parents = bvItemsRaw.filter((b) => !b.parentBvItemId);
      const children = bvItemsRaw.filter((b) => !!b.parentBvItemId);
      const sortedBvItems = [...parents, ...children];

      for (const bvItem of sortedBvItems) {
        // Lewati jika sudah pernah di-link
        if (bvItem.linkedRabItemId) continue;

        // 3. Tentukan Urutan (Taruh di posisi paling bawah pada grupnya)
        const lastItem = await tx.rabItem.findFirst({
          where: {
            projectId: bvItem.projectId,
            groupId: bvItem.groupId,
          },
          orderBy: { order: "desc" },
        });
        const insertOrder = lastItem ? lastItem.order + 1 : 0;

        // 4. Siapa "Bapaknya" di tabel RAB — kalau induknya belum ter-link
        // (tidak ikut dicentang), buatkan cangkang header dulu supaya anak
        // tidak jadi baris yatim tanpa header di RAB.
        let rabParentId = null;
        if (bvItem.parentBvItemId) {
          rabParentId = await pastikanIndukTerlink(tx, bvItem);
          if (rabParentId) {
            // induk ini akan dapat anak -> didaftarkan untuk dirapikan di
            // akhir, supaya anak berbaris URUT di bawah header, bukan
            // rebutan satu slot yang sama (order induk)
            indukTersentuh.add(bvItem.parentBvItemId);
          }
        } else {
          // item ini sendiri mungkin induk dari anak yang ikut dicentang
          indukTersentuh.add(bvItem.id);
        }

        // 5. Buat kembarannya di tabel RAB dengan struktur yang utuh
        const bulkProject = await tx.project.findUnique({
          where: { id: bvItem.projectId },
          select: { discipline: true, grade: true },
        });

        const newRab = await tx.rabItem.create({
          data: {
            projectId: bvItem.projectId,
            groupId: bvItem.groupId,

            // ==========================================
            // 🔥 INI KUNCI AGAR STRUKTUR TIDAK HANCUR 🔥
            // ==========================================
            parentId: rabParentId, // Memastikan Anak menempel tepat di bawah Induknya
            order: insertOrder, // Memastikan posisinya urut ke bawah, bukan rebutan di atas
            // ==========================================

            name: bvItem.name,
            paymentUnit: bvItem.paymentUnit || "-",
            volume: Number(bvItem.totalVolume) || 0,
            isHeaderOnly: bvItem.isHeaderOnly || false,
            // FIX: warisi discipline project (dulu selalu null)
            discipline: bulkProject?.discipline || null,
            grade: bulkProject?.grade || null,

            overheadPercent: 0,
            rapUnitPrice: 0,
            rabUnitPrice: 0,
            rapTotalPrice: 0,
            rabTotalPrice: 0,
          },
        });

        // 6. Tandai item BV bahwa dia sudah di-link
        await tx.bvItem.update({
          where: { id: bvItem.id },
          data: { linkedRabItemId: newRab.id },
        });

        linkedCount++;
      }

      // Perapian akhir: semua anak menempel header + berbaris urut
      // (header.order+1, +2, +3). Tanpa ini, beberapa anak bisa punya
      // order SAMA dengan induknya.
      for (const indukId of indukTersentuh) {
        await rapikanAnak(tx, indukId);
      }

      return linkedCount;
    });

    res.json({
      message: `${results} Item BV berhasil di-link ke RAB dengan struktur yang rapi!`,
    });
  } catch (error) {
    console.error("Error Bulk Link to RAB:", error);
    res
      .status(500)
      .json({ error: error.message || "Gagal melakukan Link ke RAB massal." });
  }
});

router.post("/bv-items-bulk/sync", async (req, res) => {
  try {
    const { itemIds } = req.body;

    if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
      return res
        .status(400)
        .json({ error: "Tidak ada item yang dipilih untuk disinkronkan." });
    }

    const results = await prisma.$transaction(async (tx) => {
      let syncedCount = 0;
      const indukTersentuh = new Set();

      // Ambil hanya item BV yang sudah pernah di-link
      const bvItems = await tx.bvItem.findMany({
        where: {
          id: { in: itemIds },
          linkedRabItemId: { not: null },
        },
        include: { linkedRabItem: true },
        orderBy: { createdAt: "asc" },
      });

      for (const bvItem of bvItems) {
        const vol = Number(bvItem.totalVolume) || 0;
        let rapUnitPrice = Number(bvItem.linkedRabItem.rapUnitPrice || 0);
        let overheadPct = Number(
          bvItem.linkedRabItem.overheadPercent ||
            bvItem.linkedRabItem.overhead ||
            0,
        );
        let componentUpdate;

        // Proses AHSP jika item menggunakan master
        if (bvItem.sourceJobTypeId) {
          const calc = await calculateJobPrice(bvItem.sourceJobTypeId);
          if (calc) {
            overheadPct = calc.jobType.overhead
              ? Number(calc.jobType.overhead)
              : overheadPct;

            const componentRows = Object.entries(calc.breakdown).flatMap(
              ([section, items]) =>
                items.map((item) => ({
                  name: item.name,
                  unit: item.unit,
                  section,
                  coefficient: item.coefficient,
                  unitPrice: item.unitPrice,
                  lineTotal: item.lineTotal,
                })),
            );

            rapUnitPrice = componentRows.reduce(
              (sum, comp) => sum + Number(comp.lineTotal),
              0,
            );
            componentUpdate = { deleteMany: {}, create: componentRows };
          }
        }

        // Kalkulasi Total
        const nilaiOverhead = rapUnitPrice * (overheadPct / 100);
        const rabUnitPrice = rapUnitPrice + nilaiOverhead;

        // Reposisi Parent/Child: pastikan induk ter-link (bikin header kalau
        // belum) lalu tempel parentId anak ke header itu. Perapian urutan
        // dilakukan sekali di akhir loop lewat rapikanAnak.
        if (bvItem.parentBvItemId) {
          const rabParentId = await pastikanIndukTerlink(tx, bvItem);
          if (rabParentId && bvItem.linkedRabItem.parentId !== rabParentId) {
            await tx.rabItem.update({
              where: { id: bvItem.linkedRabItemId },
              data: { parentId: rabParentId },
            });
            indukTersentuh.add(bvItem.parentBvItemId);
          } else if (rabParentId) {
            indukTersentuh.add(bvItem.parentBvItemId);
          }
        }

        // Eksekusi Update ke Database
        await tx.rabItem.update({
          where: { id: bvItem.linkedRabItemId },
          data: {
            name: bvItem.name,
            paymentUnit: bvItem.paymentUnit || "-",
            overheadPercent: overheadPct,
            volume: vol,
            rapUnitPrice: rapUnitPrice,
            rapTotalPrice: rapUnitPrice * vol,
            rabUnitPrice: rabUnitPrice,
            rabTotalPrice: rabUnitPrice * vol,
            ...(componentUpdate ? { components: componentUpdate } : {}),
          },
        });

        syncedCount++;
      }

      // Sekali perapian per induk yang tersentuh: anak-anak berbaris urut
      // tepat di bawah header-nya (dulu tiap anak dihitung parent.order+1
      // -> saling bentrok kalau induk punya >1 anak).
      for (const indukId of indukTersentuh) {
        await rapikanAnak(tx, indukId);
      }

      return syncedCount;
    });

    res.json({
      message: `Sukses! ${results} item BV berhasil disinkronkan kembali ke RAB.`,
    });
  } catch (error) {
    console.error("Error Bulk Sync BV to RAB:", error);
    res.status(500).json({
      error: error.message || "Gagal melakukan sinkronisasi massal.",
    });
  }
});

router.post("/bv-items/:id/sync", async (req, res) => {
  try {
    const { id } = req.params;
    const bvItem = await prisma.bvItem.findUnique({
      where: { id },
      include: { linkedRabItem: true },
    });

    if (!bvItem)
      return res.status(404).json({ error: "Item BV tidak ditemukan." });
    if (!bvItem.linkedRabItem)
      return res
        .status(400)
        .json({ error: "Item BV ini belum di-link ke RAB manapun." });

    const vol = Number(bvItem.totalVolume) || 0;

    // Ambil nilai bawaan dari RAB saat ini
    let rapUnitPrice = Number(bvItem.linkedRabItem.rapUnitPrice || 0);
    let overheadPct = Number(
      bvItem.linkedRabItem.overheadPercent ||
        bvItem.linkedRabItem.overhead ||
        0,
    );
    let componentUpdate;

    // 🔥 PERBAIKAN AHSP: Hitung Modal Murni dari Komponen
    if (bvItem.sourceJobTypeId) {
      const calc = await calculateJobPrice(bvItem.sourceJobTypeId);
      if (calc) {
        overheadPct = calc.jobType.overhead
          ? Number(calc.jobType.overhead)
          : overheadPct;

        const componentRows = Object.entries(calc.breakdown).flatMap(
          ([section, items]) =>
            items.map((item) => ({
              name: item.name,
              unit: item.unit,
              section,
              coefficient: item.coefficient,
              unitPrice: item.unitPrice,
              lineTotal: item.lineTotal,
            })),
        );

        // rapUnitPrice (Modal) hanya dihitung dari jumlah total komponen bahan/alat/upah
        rapUnitPrice = componentRows.reduce(
          (sum, comp) => sum + Number(comp.lineTotal),
          0,
        );

        componentUpdate = {
          deleteMany: {},
          create: componentRows,
        };
      }
    }

    // 🔥 PERBAIKAN HARGA JUAL: Kalkulasi ulang RAB
    const nilaiOverhead = rapUnitPrice * (overheadPct / 100);
    const rabUnitPrice = rapUnitPrice + nilaiOverhead;

    const updated = await prisma.$transaction(async (tx) => {
      // Update Data Utama RAB
      const hasil = await tx.rabItem.update({
        where: { id: bvItem.linkedRabItemId },
        data: {
          name: bvItem.name,
          paymentUnit: bvItem.paymentUnit || "-",
          overheadPercent: overheadPct, // <-- Pastikan pakai field overheadPercent
          volume: vol,
          rapUnitPrice: rapUnitPrice,
          rapTotalPrice: rapUnitPrice * vol,
          rabUnitPrice: rabUnitPrice,
          rabTotalPrice: rabUnitPrice * vol,
          ...(componentUpdate ? { components: componentUpdate } : {}),
        },
        include: { components: true },
      });

      // Reposisi: kalau ini child, tempel ke header induknya (buat header
      // kalau induk belum ter-link) lalu rapikan barisan saudaranya.
      if (bvItem.parentBvItemId) {
        const rabParentId = await pastikanIndukTerlink(tx, bvItem);
        if (rabParentId && hasil.parentId !== rabParentId) {
          await tx.rabItem.update({
            where: { id: hasil.id },
            data: { parentId: rabParentId },
          });
        }
        await rapikanAnak(tx, bvItem.parentBvItemId);
      }

      // Kalau ini induk, anak-anaknya ikut dirapikan ke bawahnya
      await rapikanAnak(tx, id);

      return hasil;
    });

    res.json({
      message:
        "RAB berhasil disinkronkan dengan BV terbaru (nama, satuan, RAP, RAB, volume, posisi)",
      data: updated,
    });
  } catch (error) {
    console.error("Error Sync BvItem:", error);
    res
      .status(500)
      .json({ error: error.message || "Terjadi kesalahan pada server." });
  }
});

router.post("/bv-items/:id/unlink", async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Cari item BV dan cek temannya di RAB
    const bvItem = await prisma.bvItem.findUnique({
      where: { id },
      include: { linkedRabItem: true },
    });

    if (!bvItem) {
      return res.status(404).json({ error: "Item BV tidak ditemukan." });
    }

    if (!bvItem.linkedRabItemId || !bvItem.linkedRabItem) {
      return res.status(400).json({ error: "Item ini memang belum di-link." });
    }

    // 2. THE LOCK (GEMBOK PROFESIONAL)
    // Cek apakah Pak Jim sudah mengisi harga di RAB (Total harga > 0)
    // Kita cek rabTotalPrice atau rabUnitPrice
    const isPriced = Number(bvItem.linkedRabItem.rabTotalPrice) > 0;

    if (isPriced) {
      // TOLAK PERMINTAAN UNLINK!
      return res.status(403).json({
        error:
          "UNLINK DITOLAK: Item ini sudah dikerjakan/diberi harga oleh Estimator (Pak Jim). Silakan hubungi Estimator untuk menghapus harga terlebih dahulu jika ingin merevisi struktur.",
      });
    }

    // 3. JIKA BELUM DIBERI HARGA (Rp 0), SILAKAN UNLINK (Aman!)
    await prisma.$transaction(async (tx) => {
      // Hapus cangkang kosong di RAB
      await tx.rabItem.delete({
        where: { id: bvItem.linkedRabItemId },
      });

      // Lepaskan ikatan di BV
      await tx.bvItem.update({
        where: { id },
        data: { linkedRabItemId: null },
      });
    });

    res.json({ message: "Berhasil Unlink! Item dikembalikan ke Modul BV." });
  } catch (error) {
    console.error("Error Unlink:", error);
    res
      .status(500)
      .json({ error: "Terjadi kesalahan pada server saat unlink." });
  }
});
module.exports = router;
