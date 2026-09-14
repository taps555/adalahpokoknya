"use strict";

const express = require("express");
const prisma = require("../../lib/prisma");
const { calculateJobPrice } = require("../../services/calculateService");
const {
  buildBreakdownRows,
  withStatus,
} = require("../../services/bvCalculationService");
const { computeAhspPricing } = require("../../services/ahspPricingService");
const ExcelJS = require("exceljs");
const { buildBvSheet } = require("../../services/bvExportHelper");
const { buildRabSheet } = require("../../services/rabExportHelper");

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
      disciplineLabel,
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
        disciplineLabel: disciplineLabel || "GENERAL",
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
      disciplineLabel,
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
        ...(disciplineLabel !== undefined ? { disciplineLabel: disciplineLabel || "GENERAL" } : {}),
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
// =========================================================
// EXPORT BACKUP VOLUME + RAB KE EXCEL (6 SHEET dengan ExcelJS)
// =========================================================
const ROMAN = ["I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII","XIII","XIV","XV"];

function fmtRp(cell) { cell.numFmt = "#,##0"; }
function fmtVol(cell) { cell.numFmt = "#,##0.00"; }

function terbilang(n) {
  n = Math.floor(Math.abs(Number(n) || 0));
  const s = ["","satu","dua","tiga","empat","lima","enam","tujuh","delapan","sembilan","sepuluh","sebelas"];
  if (n < 12) return s[n];
  if (n < 20) return s[n-10] + " belas";
  if (n < 100) { const t = Math.floor(n/10); return (t===1?"se":s[t]+" puluh ") + (n%10 ? s[n%10] : ""); }
  if (n < 200) return "seratus " + terbilang(n-100);
  if (n < 1000) { const t = Math.floor(n/100); return s[t] + " ratus " + terbilang(n%100); }
  if (n < 2000) return "seribu " + terbilang(n-1000);
  if (n < 1000000) { const t = Math.floor(n/1000); return terbilang(t) + " ribu " + terbilang(n%1000); }
  if (n < 1000000000) { const t = Math.floor(n/1000000); return terbilang(t) + " juta " + terbilang(n%1000000); }
  if (n < 1000000000000) { const t = Math.floor(n/1000000000); return terbilang(t) + " miliar " + terbilang(n%1000000000); }
  return terbilang(Math.floor(n/1000000000000)) + " triliun " + terbilang(n%1000000000000);
}
function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

// --- BV sheet ---
async function buildBvSheetXLSX(ws, projectId, project, labelFilter) {
  const groups = await prisma.rabGroup.findMany({
    where: { projectId, parentId: null },
    include: {
      bvItems: { where: { parentBvItemId: null }, include: { breakdowns: true, children: { include: { breakdowns: true }, orderBy: { createdAt: "asc" } } }, orderBy: { createdAt: "asc" } },
      children: { include: { bvItems: { where: { parentBvItemId: null }, include: { breakdowns: true, children: { include: { breakdowns: true }, orderBy: { createdAt: "asc" } } }, orderBy: { createdAt: "asc" } } } },
    },
    orderBy: { order: "asc" },
  });
  const filterBv = (items) => items.filter(it => (it.disciplineLabel || "GENERAL").toUpperCase() === labelFilter);

  ws.columns = [{width:6},{width:50},{width:10},{width:12},{width:25},{width:14},{width:2}];
  ws.mergeCells("B2:F2");
  ws.getCell("B2").value = "BACK UP VOLUME";
  ws.getCell("B2").font = { bold: true, size: 14, name: "Arial" };
  ws.getCell("B2").alignment = { horizontal: "center", vertical: "middle" };
  ws.getCell("B2").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9D9D9" } };
  const info = [
    ["Nama Kegiatan", project?.name || "-"],
    ["Nama Pekerjaan", project?.client?.name || "-"],
    ["Lokasi Pekerjaan", project?.location || "-"],
    ["Tahun Anggaran", String(project?.hspkPeriod ?? "-")],
  ];
  let r = 4;
  for (const [label, value] of info) {
    ws.getCell(`B${r}`).value = label; ws.getCell(`B${r}`).font = { size: 10, name: "Arial" };
    ws.getCell(`C${r}`).value = ":"; ws.getCell(`C${r}`).alignment = { horizontal: "center" };
    ws.mergeCells(`D${r}:F${r}`); ws.getCell(`D${r}`).value = value; ws.getCell(`D${r}`).font = { size: 10, name: "Arial" };
    r++;
  }
  const hr = 9;
  const hdrs = ["NO","URAIAN PEKERJAAN","SATUAN","VOLUME","KETERANGAN","LABEL DISIPLIN"];
  for (let c = 0; c < 6; c++) {
    const cell = ws.getCell(hr, c+1);
    cell.value = hdrs[c];
    cell.font = { bold: true, size: 10, name: "Arial" };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9D9D9" } };
    cell.border = { top: {style:"medium"}, bottom: {style:"medium"}, left: {style: c===0?"medium":"thin"}, right: {style: c===5?"medium":"thin"} };
  }
  r = hr + 1;
  let gi = 0;
  for (const group of groups) {
    const gBv = filterBv(group.bvItems || []);
    const cBv = (group.children || []).flatMap(sub => filterBv(sub.bvItems || []));
    if (gBv.length === 0 && cBv.length === 0) continue;
    ws.getCell(`A${r}`).value = ROMAN[gi] || String(gi+1);
    ws.getCell(`B${r}`).value = (group.name || "").toUpperCase();
    ws.getRow(r).font = { bold: true, size: 10, name: "Arial" };
    for (let c = 1; c <= 6; c++) ws.getCell(r, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8E8E8" } };
    r++; gi++;
    const walk = (items, depth) => {
      let n = 1;
      for (const it of items) {
        const isChild = depth > 0;
        ws.getCell(`A${r}`).value = isChild ? "" : String(n++);
        ws.getCell(`A${r}`).alignment = { horizontal: "center", vertical: "middle" };
        ws.getCell(`B${r}`).value = (isChild ? "  - " : "") + (it.name || "");
        ws.getCell(`B${r}`).alignment = { vertical: "middle", wrapText: true };
        ws.getCell(`C${r}`).value = it.isHeaderOnly ? "" : (it.paymentUnit || "");
        ws.getCell(`C${r}`).alignment = { horizontal: "center" };
        ws.getCell(`D${r}`).value = it.isHeaderOnly ? "" : Number(it.totalVolume || 0);
        fmtVol(ws.getCell(`D${r}`));
        ws.getCell(`D${r}`).alignment = { horizontal: "right" };
        ws.getCell(`E${r}`).value = it.keterangan || "";
        ws.getCell(`F${r}`).value = it.disciplineLabel || "GENERAL";
        ws.getCell(`F${r}`).alignment = { horizontal: "center" };
        for (let c = 1; c <= 6; c++) {
          ws.getCell(r, c).font = { size: 10, name: "Arial" };
          ws.getCell(r, c).border = { top: {style:"dotted"}, bottom: {style:"dotted"}, left: {style: c===1?"medium":"thin"}, right: {style: c===6?"medium":"thin"} };
        }
        r++;
        if (it.children && it.children.length > 0) { const ch = filterBv(it.children); if (ch.length > 0) walk(ch, depth+1); }
      }
    };
    walk(gBv, 0);
    for (const sub of group.children || []) {
      const si = filterBv(sub.bvItems || []);
      if (si.length === 0) continue;
      ws.getCell(`B${r}`).value = sub.name; ws.getRow(r).font = { bold: true, size: 10, name: "Arial" }; r++;
      walk(si, 0);
    }
    r++;
  }
}

// --- BQ (RAB) sheet — format profesional sama persis dengan gambar referensi ---
async function buildBqSheetXLSX(ws, projectId, project, discFilter) {
  function colRange(startCol, endCol) {
    const cols = []; let c = startCol.charCodeAt(0); const end = endCol.charCodeAt(0);
    while (c <= end) { cols.push(String.fromCharCode(c)); c++; }
    return cols;
  }
  const groups = await prisma.rabGroup.findMany({
    where: { projectId, parentId: null },
    include: {
      items: { include: { bvItem: { select: { id: true, parentBvItemId: true } } }, orderBy: { order: "asc" } },
      children: { include: { items: { include: { bvItem: { select: { id: true, parentBvItemId: true } } }, orderBy: { order: "asc" } } } },
    },
    orderBy: { order: "asc" },
  });
  const filterItems = (items) => items.filter(it => {
    if (discFilter === "GENERAL") return true;
    const d = (it.discipline || "GENERAL").toUpperCase();
    return d === discFilter || d === "GENERAL";
  });

  // Layout kolom B-J (9 kolom + border kiri/kanan medium)
  ws.columns = [
    { width: 2 },   // A — margin
    { width: 5 },   // B — NO
    { width: 45 },  // C — ITEM PEKERJAAN
    { width: 22 },  // D — SPESIFIKASI RINGKAS
    { width: 7 },   // E — SAT
    { width: 9 },   // F — VOL
    { width: 16 },  // G — RAP Harga Satuan
    { width: 18 },  // H — RAP Total Harga
    { width: 16 },  // I — RAB Harga Satuan
    { width: 18 },  // J — RAB Total Harga
    { width: 2 },   // K — margin
  ];

  // Header blok: logo B2:C9, judul D2:J3
  ws.mergeCells("B2:C9");
  ws.mergeCells("D2:J3");
  ws.getCell("D2").value = "RENCANA ANGGARAN BIAYA";
  ws.getCell("D2").font = { bold: true, size: 16, name: "Arial" };
  ws.getCell("D2").alignment = { horizontal: "center", vertical: "middle" };
  ws.getCell("D2").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9D9D9" } };
  ws.getCell("D2").border = { top:{style:"medium"}, bottom:{style:"medium"}, left:{style:"medium"}, right:{style:"medium"} };

  // Info project
  const info = [
    ["Nama Kegiatan", project?.name || "-"],
    ["Nama Pekerjaan", project?.client?.name || "-"],
    ["Lokasi Pekerjaan", project?.location || "-"],
    ["Tahun Anggaran", String(project?.hspkPeriod ?? "-")],
  ];
  let r = 5;
  for (const [label, value] of info) {
    ws.getCell(`D${r}`).value = label; ws.getCell(`D${r}`).font = { size: 11, name: "Arial" };
    ws.getCell(`E${r}`).value = ":"; ws.getCell(`E${r}`).alignment = { horizontal: "center" }; ws.getCell(`E${r}`).font = { size: 11 };
    ws.mergeCells(`F${r}:J${r}`); ws.getCell(`F${r}`).value = value; ws.getCell(`F${r}`).font = { size: 11, name: "Arial" };
    r++;
  }

  // Border header block
  colRange("B", "J").forEach((col) => {
    ws.getCell(`${col}2`).border = { ...ws.getCell(`${col}2`).border, top: { style: "medium" } };
    ws.getCell(`${col}9`).border = { ...ws.getCell(`${col}9`).border, bottom: { style: "medium" } };
  });
  for (let row = 2; row <= 9; row++) {
    ws.getCell(`B${row}`).border = { ...ws.getCell(`B${row}`).border, left: { style: "medium" } };
    ws.getCell(`J${row}`).border = { ...ws.getCell(`J${row}`).border, right: { style: "medium" } };
    ws.getCell(`D${row}`).border = { ...ws.getCell(`D${row}`).border, left: { style: "medium" } };
  }

  // Header tabel (2 baris)
  const hr = 10;
  ws.mergeCells(`B${hr}:B${hr+1}`); ws.getCell(`B${hr}`).value = "NO";
  ws.mergeCells(`C${hr}:C${hr+1}`); ws.getCell(`C${hr}`).value = "ITEM PEKERJAAN";
  ws.mergeCells(`D${hr}:D${hr+1}`); ws.getCell(`D${hr}`).value = "SPESIFIKASI RINGKAS";
  ws.mergeCells(`E${hr}:E${hr+1}`); ws.getCell(`E${hr}`).value = "SAT.";
  ws.mergeCells(`F${hr}:F${hr+1}`); ws.getCell(`F${hr}`).value = "VOL.";
  ws.mergeCells(`G${hr}:H${hr}`); ws.getCell(`G${hr}`).value = "RAP";
  ws.mergeCells(`I${hr}:J${hr}`); ws.getCell(`I${hr}`).value = "RAB";
  ws.getCell(`G${hr+1}`).value = "HARGA SATUAN"; ws.getCell(`H${hr+1}`).value = "TOTAL HARGA";
  ws.getCell(`I${hr+1}`).value = "HARGA SATUAN"; ws.getCell(`J${hr+1}`).value = "TOTAL HARGA";

  // Style header tabel
  for (let row = hr; row <= hr+1; row++) {
    for (let col = 2; col <= 10; col++) {
      const cell = ws.getCell(row, col);
      cell.font = { bold: true, size: 10, name: "Arial" };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9D9D9" } };
      cell.border = {
        top: { style: row === hr ? "medium" : "thin" },
        bottom: { style: row === hr+1 ? "medium" : "thin" },
        left: { style: col === 2 ? "medium" : "thin" },
        right: { style: col === 10 ? "medium" : "thin" },
      };
    }
  }
  // RAP header pink, RAB header biru
  ["G","H"].forEach(col => {
    ws.getCell(`${col}${hr}`).fill = { type:"pattern", pattern:"solid", fgColor:{argb:"FFFFC0CB"} };
    ws.getCell(`${col}${hr+1}`).fill = { type:"pattern", pattern:"solid", fgColor:{argb:"FFFFC0CB"} };
  });
  ["I","J"].forEach(col => {
    ws.getCell(`${col}${hr}`).fill = { type:"pattern", pattern:"solid", fgColor:{argb:"FFB0C4DE"} };
    ws.getCell(`${col}${hr+1}`).fill = { type:"pattern", pattern:"solid", fgColor:{argb:"FFB0C4DE"} };
  });
  // Garis vertikal pemisah antar blok
  ws.getCell(`G${hr}`).border = { ...ws.getCell(`G${hr}`).border, left: { style: "medium" } };
  ws.getCell(`G${hr+1}`).border = { ...ws.getCell(`G${hr+1}`).border, left: { style: "medium" } };
  ws.getCell(`I${hr}`).border = { ...ws.getCell(`I${hr}`).border, left: { style: "medium" } };
  ws.getCell(`I${hr+1}`).border = { ...ws.getCell(`I${hr+1}`).border, left: { style: "medium" } };

  r = hr + 2;
  let grandRap = 0, grandRab = 0;

  const writeItem = (item, num, hasChildren) => {
    const isChild = !!item.bvItem?.parentBvItemId;
    ws.getCell(`B${r}`).value = num; ws.getCell(`B${r}`).alignment = { horizontal: "center", vertical: "middle" };
    ws.getCell(`C${r}`).value = (isChild ? "- " : "") + (item.name || ""); ws.getCell(`C${r}`).alignment = { vertical: "middle", wrapText: true };
    if (item.isByOwner) {
      ["G","H","I","J"].forEach(col => { ws.getCell(`${col}${r}`).value = "By Owner"; ws.getCell(`${col}${r}`).alignment = { horizontal: "center" }; });
      ws.getCell(`E${r}`).value = item.paymentUnit; ws.getCell(`F${r}`).value = Number(item.volume); fmtVol(ws.getCell(`F${r}`));
      for (let col = 2; col <= 10; col++) ws.getCell(r, col).fill = { type:"pattern", pattern:"solid", fgColor:{argb:"FFFFE985"} };
    } else if (hasChildren) {
      ["E","F","G","H","I","J"].forEach(col => { ws.getCell(`${col}${r}`).value = ""; });
    } else {
      ws.getCell(`D${r}`).value = item.reference || ""; ws.getCell(`D${r}`).alignment = { vertical: "middle" };
      ws.getCell(`E${r}`).value = item.paymentUnit; ws.getCell(`E${r}`).alignment = { horizontal: "center", vertical: "middle" };
      ws.getCell(`F${r}`).value = Number(item.volume); fmtVol(ws.getCell(`F${r}`)); ws.getCell(`F${r}`).alignment = { horizontal: "right", vertical: "middle" };
      ws.getCell(`G${r}`).value = Number(item.rapUnitPrice); ws.getCell(`H${r}`).value = Number(item.rapTotalPrice);
      ws.getCell(`I${r}`).value = Number(item.rabUnitPrice); ws.getCell(`J${r}`).value = Number(item.rabTotalPrice);
      ["G","H","I","J"].forEach(col => { fmtRp(ws.getCell(`${col}${r}`)); ws.getCell(`${col}${r}`).alignment = { horizontal: "right", vertical: "middle" }; });
    }
    ws.getRow(r).font = { size: 10, name: "Arial" };
    r++;
  };

  const sumRecursive = (group) => {
    let rap = 0, rab = 0;
    for (const it of filterItems(group.items || [])) { if (!it.isByOwner && !it.isHeaderOnly) { rap += Number(it.rapTotalPrice); rab += Number(it.rabTotalPrice); } }
    for (const child of group.children || []) { const s = sumRecursive(child); rap += s.rap; rab += s.rab; }
    return { rap, rab };
  };

  let gi = 0;
  for (const group of groups) {
    const gItems = filterItems(group.items || []);
    const cGroups = (group.children || []).filter(sub => filterItems(sub.items || []).length > 0);
    if (gItems.length === 0 && cGroups.length === 0) continue;
    // Header kategori (Roman numeral)
    ws.getCell(`B${r}`).value = ROMAN[gi] || String(gi+1);
    ws.getCell(`C${r}`).value = (group.name || "").toUpperCase();
    ws.mergeCells(`C${r}:F${r}`);
    ws.getRow(r).font = { bold: true, size: 10, name: "Arial" };
    for (let col = 2; col <= 10; col++) ws.getCell(r, col).fill = { type:"pattern", pattern:"solid", fgColor:{argb:"FFE8E8E8"} };
    r++; gi++;

    const parentIds = new Set(gItems.map(it => it.bvItem?.parentBvItemId).filter(Boolean));
    let n = 1;
    for (let i = 0; i < gItems.length; i++) {
      const item = gItems[i]; const isChild = !!item.bvItem?.parentBvItemId; const hasChildren = parentIds.has(item.bvItem?.id);
      writeItem(item, isChild ? "" : String(n++), hasChildren);
    }
    for (const sub of group.children || []) {
      const si = filterItems(sub.items || []); if (si.length === 0) continue;
      ws.getCell(`B${r}`).value = String(n++); ws.getCell(`C${r}`).value = sub.name; ws.mergeCells(`C${r}:F${r}`);
      ws.getRow(r).font = { bold: true, size: 10, name: "Arial" }; r++;
      const spIds = new Set(si.map(it => it.bvItem?.parentBvItemId).filter(Boolean));
      let sn = 1;
      for (let i = 0; i < si.length; i++) {
        const item = si[i]; const isChild = !!item.bvItem?.parentBvItemId; const hasChildren = spIds.has(item.bvItem?.id);
        writeItem(item, isChild ? "" : String(sn++), hasChildren);
      }
    }
    r++;
    // Subtotal
    const { rap, rab } = sumRecursive(group); grandRap += rap; grandRab += rab;
    ws.getCell(`G${r}`).value = "Sub Total"; ws.getCell(`G${r}`).font = { italic: true, bold: true, size: 10, name: "Arial" }; ws.getCell(`G${r}`).alignment = { horizontal: "right" };
    ws.getCell(`H${r}`).value = rap; fmtRp(ws.getCell(`H${r}`)); ws.getCell(`H${r}`).font = { bold: true, size: 10, name: "Arial" }; ws.getCell(`H${r}`).alignment = { horizontal: "right" };
    ws.getCell(`I${r}`).value = "Sub Total"; ws.getCell(`I${r}`).font = { italic: true, bold: true, size: 10, name: "Arial" }; ws.getCell(`I${r}`).alignment = { horizontal: "right" };
    ws.getCell(`J${r}`).value = rab; fmtRp(ws.getCell(`J${r}`)); ws.getCell(`J${r}`).font = { bold: true, size: 10, name: "Arial" }; ws.getCell(`J${r}`).alignment = { horizontal: "right" };
    for (let col = 2; col <= 10; col++) ws.getCell(r, col).fill = { type:"pattern", pattern:"solid", fgColor:{argb:"FFD9D9D9"} };
    r++;
  }

  // Border solid thin untuk semua baris data
  for (let row = hr+2; row <= r; row++) {
    for (let col = 2; col <= 10; col++) {
      ws.getCell(row, col).border = {
        top: { style: "thin" },
        bottom: { style: "thin" },
        left: { style: col === 2 ? "medium" : "thin" },
        right: { style: col === 10 ? "medium" : "thin" },
      };
    }
    ws.getCell(row, 7).border = { ...ws.getCell(row, 7).border, left: { style: "medium" } }; // Garis pemisah RAP
    ws.getCell(row, 9).border = { ...ws.getCell(row, 9).border, left: { style: "medium" } }; // Garis pemisah RAB
  }

  // GRAND TOTAL
  ws.getCell(`G${r}`).value = "GRAND TOTAL RAP"; ws.getCell(`G${r}`).font = { bold: true, size: 10, name: "Arial" }; ws.getCell(`G${r}`).alignment = { horizontal: "right" };
  ws.getCell(`H${r}`).value = grandRap; fmtRp(ws.getCell(`H${r}`)); ws.getCell(`H${r}`).font = { bold: true, size: 10, name: "Arial" }; ws.getCell(`H${r}`).alignment = { horizontal: "right" };
  ws.getCell(`I${r}`).value = "GRAND TOTAL RAB"; ws.getCell(`I${r}`).font = { bold: true, size: 10, name: "Arial" }; ws.getCell(`I${r}`).alignment = { horizontal: "right" };
  ws.getCell(`J${r}`).value = grandRab; fmtRp(ws.getCell(`J${r}`)); ws.getCell(`J${r}`).font = { bold: true, size: 10, name: "Arial" }; ws.getCell(`J${r}`).alignment = { horizontal: "right" };
  for (let col = 2; col <= 10; col++) {
    ws.getCell(r, col).fill = { type:"pattern", pattern:"solid", fgColor:{argb:"FFFFC0CB"} };
    ws.getCell(r, col).border = { top:{style:"medium"}, bottom:{style:"thin"}, left:{style: col===2?"medium":"thin"}, right:{style: col===10?"medium":"thin"} };
  }
  r++;
  // DIBULATKAN
  ws.getCell(`I${r}`).value = "DIBULATKAN"; ws.getCell(`I${r}`).font = { bold: true, size: 10, name: "Arial" }; ws.getCell(`I${r}`).alignment = { horizontal: "right" };
  ws.getCell(`J${r}`).value = Math.round(grandRab); fmtRp(ws.getCell(`J${r}`)); ws.getCell(`J${r}`).font = { bold: true, size: 10, name: "Arial" }; ws.getCell(`J${r}`).alignment = { horizontal: "right" };
  for (let col = 2; col <= 10; col++) {
    ws.getCell(r, col).border = { top:{style:"thin"}, bottom:{style:"medium"}, left:{style: col===2?"medium":"thin"}, right:{style: col===10?"medium":"thin"} };
  }
  r += 2;
  // Terbilang
  ws.getCell(`B${r}`).value = "Terbilang :"; ws.getCell(`B${r}`).font = { size: 10, name: "Arial" };
  ws.mergeCells(`C${r}:J${r}`);
  ws.getCell(`C${r}`).value = capitalize(terbilang(Math.round(grandRab))) + " rupiah";
  ws.getCell(`C${r}`).font = { italic: true, size: 10, name: "Arial" };
  r += 2;
  // Tanggal & signature
  const months = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
  const today = new Date();
  ws.mergeCells(`H${r}:J${r}`);
  ws.getCell(`H${r}`).value = `Surabaya, ${today.getDate()} ${months[today.getMonth()]} ${today.getFullYear()}`;
  ws.getCell(`H${r}`).font = { size: 10, name: "Arial" }; ws.getCell(`H${r}`).alignment = { horizontal: "center" };
  r++;
  ws.getCell(`B${r}`).value = "Dibuat Oleh :"; ws.getCell(`B${r}`).font = { size: 10, name: "Arial" };
  r += 2;
  ws.mergeCells(`C${r}:E${r}`);
  ws.getCell(`C${r}`).value = "PT. DIVES JAYA PERKASA"; ws.getCell(`C${r}`).font = { bold: true, size: 10, name: "Arial" }; ws.getCell(`C${r}`).alignment = { horizontal: "center" };
  r += 3;
  ws.mergeCells(`C${r}:E${r}`);
  ws.getCell(`C${r}`).value = "JIMMY CHRISTIAN, S.Ds."; ws.getCell(`C${r}`).font = { bold: true, size: 10, name: "Arial" }; ws.getCell(`C${r}`).alignment = { horizontal: "center" };
  ws.mergeCells(`G${r}:J${r}`);
  ws.getCell(`G${r}`).value = "____________________"; ws.getCell(`G${r}`).font = { size: 10, name: "Arial" }; ws.getCell(`G${r}`).alignment = { horizontal: "center" };
  r++;
  ws.mergeCells(`C${r}:E${r}`);
  ws.getCell(`C${r}`).value = "Direktur Utama"; ws.getCell(`C${r}`).font = { size: 10, name: "Arial" }; ws.getCell(`C${r}`).alignment = { horizontal: "center" };
  ws.mergeCells(`G${r}:J${r}`);
  ws.getCell(`G${r}`).value = "Mengetahui / Menyetujui"; ws.getCell(`G${r}`).font = { size: 10, name: "Arial" }; ws.getCell(`G${r}`).alignment = { horizontal: "center" };

  // Set font semua sel ke Arial
  ws.eachRow({ includeEmpty: true }, (row) => {
    row.eachCell({ includeEmpty: true }, (cell) => { cell.font = { ...cell.font, name: "Arial" }; });
  });
}

// --- BV sheet: pakai bvExportHelper dengan filter disciplineLabel ---
// Karena buildBvSheet mengambil semua groups, kita perlu filter bvItems per disciplineLabel.
// Kita modifikasi approach: gunakan buildBvSheet langsung (ambil semua), tapi perlu filter.
// Untuk simplicity, kita buat versi yang accept filter.
async function buildBvSheetFiltered(wb, projectId, project, labelFilter) {
  const ws = wb.addWorksheet(`BV ${labelFilter.charAt(0) + labelFilter.slice(1).toLowerCase()}`);
  // Patch: sementara ambil semua data, nanti filter di helper
  // Karena helper sudah complex, kita filter groups: hanya yang punya bvItems dengan label sesuai
  const prismaLocal = require("../../lib/prisma");
  const groups = await prismaLocal.rabGroup.findMany({
    where: { projectId, parentId: null },
    include: {
      bvItems: {
        where: { parentBvItemId: null },
        include: {
          breakdowns: true,
          sourceJobType: true,
          children: {
            include: { breakdowns: true, sourceJobType: true },
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { createdAt: "asc" },
      },
      children: {
        include: {
          bvItems: {
            where: { parentBvItemId: null },
            include: {
              breakdowns: true,
              sourceJobType: true,
              children: {
                include: { breakdowns: true, sourceJobType: true },
                orderBy: { createdAt: "asc" },
              },
            },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
    orderBy: { order: "asc" },
  });

  // Filter: hanya groups yang punya bvItems (recursive) dengan label sesuai
  // TAPI: untuk "GENERAL" — tampilkan SEMUA (interior + sipil + tanpa label)
  const hasLabelRecursive = (items, label) => {
    if (label === "GENERAL") return true; // General = semua
    return items.some(it => {
      const lbl = (it.disciplineLabel || "GENERAL").toUpperCase();
      return lbl === label || lbl === "GENERAL" || (it.children && hasLabelRecursive(it.children, label));
    });
  };

  const filterBvItemsRecursive = (items, label) => {
    if (label === "GENERAL") return items; // General = tampilkan semua
    return items.filter(it => {
      const lbl = (it.disciplineLabel || "GENERAL").toUpperCase();
      if (lbl === label || lbl === "GENERAL") {
        // Keep this item, but also filter its children
        if (it.children) it.children = filterBvItemsRecursive(it.children, label);
        return true;
      }
      // Check if any children match
      if (it.children && hasLabelRecursive(it.children, label)) {
        if (it.children) it.children = filterBvItemsRecursive(it.children, label);
        return true;
      }
      return false;
    });
  };

  // Filter groups
  const filteredGroups = groups.map(group => {
    const filteredBv = filterBvItemsRecursive([...(group.bvItems || [])], labelFilter);
    const filteredChildren = (group.children || []).map(sub => {
      const subFiltered = filterBvItemsRecursive([...(sub.bvItems || [])], labelFilter);
      return { ...sub, bvItems: subFiltered };
    }).filter(sub => sub.bvItems.length > 0);
    return { ...group, bvItems: filteredBv, children: filteredChildren };
  }).filter(group => (group.bvItems && group.bvItems.length > 0) || (group.children && group.children.length > 0));

  // Sekarang panggil buildBvSheet tapi dengan data yang sudah difilter
  // buildBvSheet mengambil dari prisma sendiri, jadi kita perlu approach berbeda
  // Kita pakai versi inline yang sama persis formatnya
  await buildBvSheetFromData(ws, filteredGroups, project);
}

// Versi buildBvSheet yang accept data sudah difilter (format sama persis dengan bvExportHelper)
async function buildBvSheetFromData(ws, groups, project) {
  const ROMAN = ["I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII","XIII","XIV","XV"];
  function autoFitColumn(ws, colLetter, minWidth = 1, maxWidth = 60) {
    const col = ws.getColumn(colLetter);
    let maxLen = minWidth;
    col.eachCell({ includeEmpty: false }, (cell) => {
      const len = String(cell.value ?? "").length;
      if (len > maxLen) maxLen = len;
    });
    col.width = Math.min(maxLen + 2, maxWidth);
  }
  function colRange(startCol, endCol) {
    const cols = []; let c = startCol.charCodeAt(0); const end = endCol.charCodeAt(0);
    while (c <= end) { cols.push(String.fromCharCode(c)); c++; }
    return cols;
  }

  ws.columns = [
    {width:5},{width:6},{width:32},{width:7},{width:8},{width:20},
    {width:9},{width:9},{width:9},{width:9},{width:9},{width:9},{width:9},
    {width:8},{width:8},{width:9},{width:10},{width:8},{width:18},
  ];

  // Header block
  ws.mergeCells("B2:E8");
  ws.mergeCells("F2:R3");
  ws.getCell("F2").value = "BACK UP VOLUME";
  ws.getCell("F2").font = { bold: true, size: 15, name: "Arial" };
  ws.getCell("F2").alignment = { horizontal: "center", vertical: "middle" };
  ws.getCell("F2").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9D9D9" } };
  ws.getCell("F2").border = { bottom: { style: "medium" } };

  const info = [
    ["Nama Kegiatan", project?.name || "-"],
    ["Nama Pekerjaan", project?.client?.name || "-"],
    ["Lokasi Pekerjaan", project?.location || "-"],
    ["Tahun Anggaran", String(project?.hspkPeriod ?? "-")],
  ];

  let r = 5;
  for (const [label, value] of info) {
    ws.getCell(`F${r}`).value = label; ws.getCell(`F${r}`).font = { size: 12, name: "Arial" };
    ws.getCell(`G${r}`).value = ":"; ws.getCell(`G${r}`).alignment = { horizontal: "center" }; ws.getCell(`G${r}`).font = { size: 12 };
    ws.mergeCells(`H${r}:R${r}`); ws.getCell(`H${r}`).value = value; ws.getCell(`H${r}`).font = { size: 12, name: "Arial" };
    r++;
  }

  colRange("B", "S").forEach((col) => {
    ws.getCell(`${col}2`).border = { ...ws.getCell(`${col}2`).border, top: { style: "medium" } };
    ws.getCell(`${col}9`).border = { ...ws.getCell(`${col}9`).border, bottom: { style: "medium" } };
  });
  for (let row = 2; row <= 9; row++) {
    ws.getCell(`B${row}`).border = { ...ws.getCell(`B${row}`).border, left: { style: "medium" } };
    ws.getCell(`S${row}`).border = { ...ws.getCell(`S${row}`).border, right: { style: "medium" } };
    ws.getCell(`F${row}`).border = { ...ws.getCell(`F${row}`).border, left: { style: "medium" } };
  }

  r = 11;
  const hr = r;
  // Header tabel — 2 baris
  ws.mergeCells(`B${hr}:B${hr+1}`); ws.getCell(`B${hr}`).value = "NO";
  ws.mergeCells(`C${hr}:C${hr+1}`); ws.getCell(`C${hr}`).value = "URAIAN PEKERJAAN";
  ws.mergeCells(`D${hr}:E${hr}`); ws.getCell(`D${hr}`).value = "VOLUME";
  ws.mergeCells(`F${hr}:F${hr+1}`); ws.getCell(`F${hr}`).value = "KETERANGAN";
  ws.mergeCells(`G${hr}:G${hr+1}`); ws.getCell(`G${hr}`).value = "Panjang";
  ws.mergeCells(`H${hr}:H${hr+1}`); ws.getCell(`H${hr}`).value = "Lebar";
  ws.mergeCells(`I${hr}:I${hr+1}`); ws.getCell(`I${hr}`).value = "Tinggi";
  ws.mergeCells(`J${hr}:J${hr+1}`); ws.getCell(`J${hr}`).value = "Luas";
  ws.mergeCells(`K${hr}:K${hr+1}`); ws.getCell(`K${hr}`).value = "Keliling";
  ws.mergeCells(`L${hr}:L${hr+1}`); ws.getCell(`L${hr}`).value = "Dia";
  ws.mergeCells(`M${hr}:M${hr+1}`); ws.getCell(`M${hr}`).value = "Berat";
  ws.mergeCells(`N${hr}:O${hr}`); ws.getCell(`N${hr}`).value = "Jumlah";
  ws.mergeCells(`P${hr}:P${hr+1}`); ws.getCell(`P${hr}`).value = "Waste";
  ws.mergeCells(`Q${hr}:R${hr}`); ws.getCell(`Q${hr}`).value = "TOTAL";
  ws.mergeCells(`S${hr}:S${hr+1}`); ws.getCell(`S${hr}`).value = "LINK";

  ws.getCell(`D${hr+1}`).value = "Sat.";
  ws.getCell(`E${hr+1}`).value = "Vol.";
  ws.getCell(`G${hr+1}`).value = "(m)";
  ws.getCell(`H${hr+1}`).value = "(m)";
  ws.getCell(`I${hr+1}`).value = "(m)";
  ws.getCell(`J${hr+1}`).value = "(m2)";
  ws.getCell(`K${hr+1}`).value = "(m1)";
  ws.getCell(`L${hr+1}`).value = "(m2)";
  ws.getCell(`M${hr+1}`).value = "(Kg)";
  ws.getCell(`N${hr+1}`).value = "(Sisi)";
  ws.getCell(`O${hr+1}`).value = "(Bh)";
  ws.getCell(`P${hr+1}`).value = "(%)";
  ws.getCell(`Q${hr+1}`).value = "Vol.";
  ws.getCell(`R${hr+1}`).value = "Sat.";
  ws.getCell(`S${hr+1}`).value = "E-COMMERCE INFO";

  // Style header
  for (let row = hr; row <= hr+1; row++) {
    ws.getRow(row).eachCell({ includeEmpty: true }, (cell, col) => {
      if (col >= 2) {
        cell.font = { bold: true, size: 10, name: "Arial" };
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9D9D9" } };
        cell.border = {
          top: { style: row === hr ? "medium" : "thin" },
          bottom: { style: row === hr+1 ? "medium" : "thin" },
          left: { style: col === 2 ? "medium" : "thin" },
          right: { style: col === 19 ? "medium" : "thin" },
        };
      }
    });
  }

  r = hr + 2;

  function writeItem(it, counterObj) {
    const isHeader = !!it.isHeaderOnly;
    const isChild = !!it.parentBvItemId;
    const no = isHeader ? counterObj.n++ : isChild ? "" : counterObj.n++;
    const namePrefix = isChild ? "- " : "";

    ws.getCell(`B${r}`).value = no;
    ws.getCell(`B${r}`).alignment = { horizontal: "center" };
    ws.getCell(`C${r}`).value = namePrefix + (it.name || "");
    if (isHeader) ws.getRow(r).font = { bold: true, name: "Arial" };

    const hasChildren = (it.children || []).length > 0;
    const breakdownList = it.breakdowns || [];
    const hasBreakdown = breakdownList.length > 0;

    if (!isHeader && !hasChildren) {
      ws.getCell(`D${r}`).value = it.paymentUnit || "";
      ws.getCell(`D${r}`).alignment = { horizontal: "center" };
      ws.getCell(`E${r}`).value = Number(it.totalVolume);
      ws.getCell(`E${r}`).alignment = { horizontal: "center" };
      ws.getCell(`E${r}`).font = { bold: true, name: "Arial" };
      ws.getCell(`Q${r}`).value = Number(it.totalVolume);
      ws.getCell(`Q${r}`).alignment = { horizontal: "right" };
      ws.getCell(`Q${r}`).font = { bold: true, name: "Arial" };
      ws.getCell(`R${r}`).value = it.paymentUnit || "";
      ws.getCell(`R${r}`).alignment = { horizontal: "center" };
      ws.getCell(`S${r}`).value = it.ecommerceLink || "";
    }

    if (!isHeader && !hasChildren && hasBreakdown) {
      r++;
      let lastKeterangan = null;
      breakdownList.forEach((b) => {
        const ketText = (b.keterangan || "").trim();
        const showKet = ketText !== lastKeterangan;
        lastKeterangan = ketText;
        if (!isChild || !ketText) r--;
        ws.getCell(`F${r}`).value = showKet ? ketText : "";
        ws.getCell(`G${r}`).value = b.panjang != null ? Number(b.panjang) : "";
        ws.getCell(`H${r}`).value = b.lebar != null ? Number(b.lebar) : "";
        ws.getCell(`I${r}`).value = b.tinggi != null ? Number(b.tinggi) : "";
        ws.getCell(`J${r}`).value = b.luas != null ? Number(b.luas) : "";
        ws.getCell(`K${r}`).value = b.keliling != null ? Number(b.keliling) : "";
        ws.getCell(`L${r}`).value = b.diameter != null ? Number(b.diameter) : "";
        ws.getCell(`M${r}`).value = b.berat != null ? Number(b.berat) : "";
        ws.getCell(`N${r}`).value = b.jumlahSisi != null ? Number(b.jumlahSisi) : "";
        ws.getCell(`O${r}`).value = b.jumlahBh != null ? Number(b.jumlahBh) : "";
        ws.getCell(`P${r}`).value = b.waste != null && Number(b.waste) !== 0 ? Number(b.waste) : "";
        ws.getCell(`Q${r}`).value = b.subTotal != null ? Number(b.subTotal) : "";
        ws.getRow(r).eachCell({ includeEmpty: true }, (cell, col) => {
          if (col >= 7 && col <= 16) { cell.alignment = { horizontal: "right" }; cell.font = { color: { argb: "FFFF0000" }, name: "Arial" }; }
          else if (col === 6) { cell.alignment = { horizontal: "left" }; }
        });
        r++;
      });
    } else { r++; }

    (it.children || []).forEach((child) => writeItem(child, counterObj));
  }

  groups.forEach((group, idx) => {
    if (idx > 0) r++;
    ws.getCell(`B${r}`).value = ROMAN[idx] || String(idx + 1);
    colRange("B", "S").forEach((col) => {
      ws.getCell(`${col}${r}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9D9D9" } };
    });
    ws.getCell(`C${r}`).value = (group.name || "").toUpperCase();
    ws.getRow(r).font = { bold: true, name: "Arial" };
    r++;
    const counter = { n: 1 };
    for (const it of (group.bvItems || [])) writeItem(it, counter);
    for (const sub of (group.children || [])) {
      ws.getCell(`B${r}`).value = String(counter.n++);
      ws.getCell(`C${r}`).value = sub.name;
      ws.getRow(r).font = { bold: true, name: "Arial" };
      r++;
      const subCounter = { n: 1 };
      for (const it of (sub.bvItems || [])) writeItem(it, subCounter);
    }
  });

  for (let row = hr + 2; row < r; row++) {
    colRange("B", "S").forEach((col) => {
      ws.getCell(`${col}${row}`).border = {
        top: row === hr + 2 ? { style: "thin" } : { style: "dotted" },
        bottom: { style: "dotted" },
        left: { style: "thin" },
        right: { style: "thin" },
      };
    });
    ws.getCell(`B${row}`).border = { ...ws.getCell(`B${row}`).border, left: { style: "medium" } };
    ws.getCell(`S${row}`).border = { ...ws.getCell(`S${row}`).border, right: { style: "medium" } };
  }
  colRange("B", "S").forEach((col) => {
    const cell = ws.getCell(`${col}${r - 1}`);
    cell.border = { ...cell.border, bottom: { style: "medium" } };
  });

  ["C", "F"].forEach((col) => autoFitColumn(ws, col));
  ws.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (typeof cell.value === "number" && cell.col !== 2) { cell.numFmt = "#,##0.00"; }
    });
  });
  ws.eachRow({ includeEmpty: true }, (row) => {
    row.eachCell({ includeEmpty: true }, (cell) => { cell.font = { ...cell.font, name: "Arial" }; });
  });
}

// --- BQ sheet: pakai rabExportHelper dengan filter discipline ---
// Sama seperti buildBqSheetXLSX di atas tapi kita sudah punya. Tetap pakai yang sudah ada.

router.get("/projects/:projectId/bv-items/export-excel", async (req, res) => {
  try {
    const { projectId } = req.params;
    const project = await prisma.project.findUnique({ where: { id: projectId }, include: { client: true } });
    if (!project) return res.status(404).json({ error: "Project tidak ditemukan" });
    const wb = new ExcelJS.Workbook();
    wb.creator = "Dives Corp"; wb.created = new Date();

    // BV sheets — format lengkap sama dengan web (19 kolom dengan breakdown)
    await buildBvSheetFiltered(wb, projectId, project, "GENERAL");
    await buildBvSheetFiltered(wb, projectId, project, "SIPIL");
    await buildBvSheetFiltered(wb, projectId, project, "INTERIOR");

    // BQ sheets — format RAB (NO, ITEM, SPESIFIKASI, SAT, VOL, RAP, RAB)
    const bqSheets = [
      ["BQ General", "GENERAL"],
      ["BQ Sipil", "SIPIL"],
      ["BQ Interior", "INTERIOR"],
    ];
    for (const [name, discFilter] of bqSheets) {
      const ws = wb.addWorksheet(name);
      await buildBqSheetXLSX(ws, projectId, project, discFilter);
    }

    const safeName = (project.name || "proyek").replace(/[^a-zA-Z0-9]/g, "_");
    const filename = `BV_${safeName}.xlsx`;
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const buffer = await wb.xlsx.writeBuffer();
    res.send(buffer);
  } catch (error) {
    console.error("Export Excel BV Error:", error);
    res.status(500).json({ error: "Gagal export Excel: " + error.message });
  }
});

module.exports = router;


