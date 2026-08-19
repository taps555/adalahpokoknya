"use strict";

const express = require("express");
const prisma = require("../../lib/prisma");
const { calculateJobPrice } = require("../../services/calculateService");

const router = express.Router();

// function calcBreakdownSubtotal({
//   panjang,
//   lebar,
//   tinggi,
//   luas,
//   keliling,
//   diameter,
//   berat,
//   jumlahSisi,
//   jumlahBh,
//   waste,
// }) {
//   const w = waste != null && waste !== "" ? Number(waste) / 100 : 0;

//   const s = jumlahSisi != null && jumlahSisi !== "" ? Number(jumlahSisi) : 1;
//   const b = jumlahBh != null && jumlahBh !== "" ? Number(jumlahBh) : 1;
//   const totalJumlah = s * b;

//   const p = panjang != null && panjang !== "" ? Number(panjang) : 1;
//   const t = tinggi != null && tinggi !== "" ? Number(tinggi) : 1;

//   if (berat != null && berat !== "") {
//     return p * t * Number(berat) * totalJumlah * (1 + w);
//   }

//   if (luas != null && luas !== "") return Number(luas) * totalJumlah * (1 + w);
//   if (keliling != null && keliling !== "")
//     return Number(keliling) * totalJumlah * (1 + w);
//   if (diameter != null && diameter !== "")
//     return Number(diameter) * totalJumlah * (1 + w);

//   const l = lebar != null && lebar !== "" ? Number(lebar) : 1;

//   return p * l * t * totalJumlah * (1 + w);
// }

function calcBreakdownSubtotal(b) {
  // 1. Tarik nilai angkanya (kalau kosong jadikan 0)
  const p = b.panjang != null && b.panjang !== "" ? Number(b.panjang) : 0;
  const l = b.lebar != null && b.lebar !== "" ? Number(b.lebar) : 0;
  const t = b.tinggi != null && b.tinggi !== "" ? Number(b.tinggi) : 0;
  const luas = b.luas != null && b.luas !== "" ? Number(b.luas) : 0;
  const keliling =
    b.keliling != null && b.keliling !== "" ? Number(b.keliling) : 0;
  const berat = b.berat != null && b.berat !== "" ? Number(b.berat) : 0;

  // 2. Kita mulai baseVolume dari angka 1 (karena ini perkalian)
  let baseVolume = 1;
  let adaYangDicentang = false;

  // 3. Kalikan HANYA JIKA dicentang (isXChecked = true)
  if (b.isPChecked) {
    baseVolume *= p;
    adaYangDicentang = true;
  }
  if (b.isLChecked) {
    baseVolume *= l;
    adaYangDicentang = true;
  }
  if (b.isTChecked) {
    baseVolume *= t;
    adaYangDicentang = true;
  }
  if (b.isLuasChecked) {
    baseVolume *= luas;
    adaYangDicentang = true;
  }
  if (b.isKelChecked) {
    baseVolume *= keliling;
    adaYangDicentang = true;
  }
  if (b.isBeratChecked) {
    baseVolume *= berat;
    adaYangDicentang = true;
  }

  // Jika user sama sekali tidak mencentang apa-apa (misal borongan/ls), volume tetap 1
  if (!adaYangDicentang) {
    baseVolume = 1;
  }

  // 4. Hitung Sisi, Buah, dan Waste (Ini selalu dikalikan)
  const s =
    b.jumlahSisi != null && b.jumlahSisi !== "" ? Number(b.jumlahSisi) : 1;
  const bh = b.jumlahBh != null && b.jumlahBh !== "" ? Number(b.jumlahBh) : 1;
  const totalJumlah = s * bh;

  const w = b.waste != null && b.waste !== "" ? Number(b.waste) / 100 : 0;
  const wasteMultiplier = 1 + w;

  return baseVolume * totalJumlah * wasteMultiplier;
}

function buildBreakdownRows(breakdowns) {
  // Tidak butuh lagi paymentUnit untuk hitung rumus
  return breakdowns.map((b) => {
    const subTotal = calcBreakdownSubtotal(b);
    return {
      keterangan: b.keterangan || null,

      panjang: b.panjang ?? null,
      isPChecked: !!b.isPChecked, // Simpan status centang ke database

      lebar: b.lebar ?? null,
      isLChecked: !!b.isLChecked,

      tinggi: b.tinggi ?? null,
      isTChecked: !!b.isTChecked,

      luas: b.luas ?? null,
      isLuasChecked: !!b.isLuasChecked,

      keliling: b.keliling ?? null,
      isKelChecked: !!b.isKelChecked,

      berat: b.berat ?? null,
      isBeratChecked: !!b.isBeratChecked,

      diameter: b.diameter ?? null, // Diameter ga ikut dikali, cuma dicatat
      jumlahSisi: b.jumlahSisi ?? null,
      jumlahBh: b.jumlahBh ?? null,
      waste: b.waste ?? null,

      subTotal,
    };
  });
}

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

    function withStatus(it) {
      let status = "BELUM_DILINK";
      if (it.linkedRabItem) {
        const same =
          Number(it.totalVolume) === Number(it.linkedRabItem.volume) &&
          it.name === it.linkedRabItem.name &&
          it.paymentUnit === it.linkedRabItem.paymentUnit;
        status = same ? "SUDAH_SINKRON" : "BELUM_SINKRON";
      }
      return {
        ...it,
        linkStatus: it.isHeaderOnly ? null : status,
        children: (it.children || []).map(withStatus),
      };
    }

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

/**
 * POST /bv-items/:id/link-to-rab
 * Mode HSPK (sourceJobTypeId ada): RAP otomatis dihitung dari JobType, user cuma isi rabUnitPrice.
 * Mode Custom: user isi components manual + rabUnitPrice.
 */
// router.post("/bv-items/:id/link-to-rab", async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { rabUnitPrice, groupId, category, reference, overhead, components } =
//       req.body;

//     const bvItem = await prisma.bvItem.findUnique({ where: { id } });
//     if (!bvItem)
//       return res.status(404).json({ error: "Item BV tidak ditemukan." });
//     if (bvItem.linkedRabItemId) {
//       return res.status(400).json({
//         error:
//           "Item BV ini sudah pernah di-link ke RAB. Hapus link lama dulu kalau mau link ulang.",
//       });
//     }

//     const vol = Number(bvItem.totalVolume);
//     let rapUnitPrice, componentRows, finalCategory, finalReference, overheadPct;

//     if (bvItem.sourceJobTypeId) {
//       const calc = await calculateJobPrice(bvItem.sourceJobTypeId);
//       if (!calc)
//         return res.status(404).json({
//           error: "Jenis pekerjaan (master) sumber BV ini tidak ditemukan.",
//         });

//       rapUnitPrice = calc.total;
//       overheadPct = calc.jobType.overhead;
//       finalCategory = category || calc.jobType.category;
//       finalReference = reference || calc.jobType.reference;
//       componentRows = Object.entries(calc.breakdown).flatMap(
//         ([section, items]) =>
//           items.map((item) => ({
//             name: item.name,
//             unit: item.unit,
//             section,
//             coefficient: item.coefficient,
//             unitPrice: item.unitPrice,
//             lineTotal: item.lineTotal,
//           })),
//       );
//     } else {
//       if (!Array.isArray(components) || components.length === 0) {
//         return res.status(400).json({
//           error:
//             "Minimal harus ada 1 komponen (bahan/upah/alat) untuk item BV custom.",
//         });
//       }
//       overheadPct = overhead != null ? Number(overhead) : 0.1;
//       let baseTotal = 0;
//       componentRows = components.map((c) => {
//         const lineTotal = Number(c.coefficient) * Number(c.unitPrice);
//         baseTotal += lineTotal;
//         return {
//           name: c.name,
//           unit: c.unit,
//           section: c.section,
//           coefficient: c.coefficient,
//           unitPrice: c.unitPrice,
//           lineTotal,
//         };
//       });
//       rapUnitPrice = baseTotal + baseTotal * overheadPct;
//       finalCategory = category || null;
//       finalReference = reference || null;
//     }

//     const rabPrice = rabUnitPrice != null ? Number(rabUnitPrice) : rapUnitPrice;

//     const result = await prisma.$transaction(async (tx) => {
//       const finalGroupId = groupId || bvItem.groupId || null;

//       let insertOrder;

//       if (bvItem.parentBvItemId) {
//         const parentBv = await tx.bvItem.findUnique({
//           where: { id: bvItem.parentBvItemId },
//           select: { linkedRabItemId: true },
//         });

//         if (parentBv?.linkedRabItemId) {
//           const parentRab = await tx.rabItem.findUnique({
//             where: { id: parentBv.linkedRabItemId },
//             select: { order: true },
//           });

//           // cari sibling (anak lain dari parent yg sama) yg udah linked duluan
//           const linkedSiblings = await tx.bvItem.findMany({
//             where: {
//               parentBvItemId: bvItem.parentBvItemId,
//               linkedRabItemId: { not: null },
//             },
//             include: { linkedRabItem: { select: { order: true } } },
//           });

//           const maxSiblingOrder = linkedSiblings.length
//             ? Math.max(...linkedSiblings.map((s) => s.linkedRabItem.order))
//             : parentRab.order;

//           insertOrder = maxSiblingOrder + 1;

//           await tx.rabItem.updateMany({
//             where: {
//               projectId: bvItem.projectId,
//               groupId: finalGroupId,
//               order: { gte: insertOrder },
//             },
//             data: { order: { increment: 1 } },
//           });
//         }
//       }

//       if (insertOrder === undefined) {
//         // bukan child, atau parent belum linked -> taro di belakang, pakai max(order)+1 (bukan count)
//         const lastItem = await tx.rabItem.findFirst({
//           where: { projectId: bvItem.projectId, groupId: finalGroupId },
//           orderBy: { order: "desc" },
//           select: { order: true },
//         });
//         insertOrder = lastItem ? lastItem.order + 1 : 0;
//       }

//       const rabItem = await tx.rabItem.create({
//         data: {
//           projectId: bvItem.projectId,
//           groupId: finalGroupId,
//           name: bvItem.name,
//           paymentUnit: bvItem.paymentUnit,
//           category: finalCategory,
//           reference: finalReference,
//           overhead: overheadPct,
//           volume: vol,
//           rapUnitPrice,
//           rapTotalPrice: rapUnitPrice * vol,
//           rabUnitPrice: rabPrice,
//           rabTotalPrice: rabPrice * vol,
//           sourceJobTypeId: bvItem.sourceJobTypeId || null,
//           order: insertOrder,
//           components: { create: componentRows },
//         },
//       });

//       const linkedChildren = await tx.bvItem.findMany({
//         where: { parentBvItemId: id, linkedRabItemId: { not: null } },
//         select: { linkedRabItemId: true },
//         orderBy: { createdAt: "asc" },
//       });

//       if (linkedChildren.length > 0) {
//         const childRabIds = linkedChildren.map((c) => c.linkedRabItemId);

//         await tx.rabItem.updateMany({
//           where: { id: { in: childRabIds } },
//           data: { order: -1 },
//         });

//         await tx.rabItem.updateMany({
//           where: {
//             projectId: bvItem.projectId,
//             groupId: finalGroupId,
//             order: { gt: rabItem.order },
//           },
//           data: { order: { increment: childRabIds.length } },
//         });

//         for (let i = 0; i < childRabIds.length; i++) {
//           await tx.rabItem.update({
//             where: { id: childRabIds[i] },
//             data: { order: rabItem.order + 1 + i },
//           });
//         }
//       }
//       const updatedBv = await tx.bvItem.update({
//         where: { id },
//         data: { linkedRabItemId: rabItem.id },
//       });

//       return { rabItem, bvItem: updatedBv };
//     });

//     res
//       .status(201)
//       .json({ message: "Item BV berhasil di-link ke RAB", data: result });
//   } catch (error) {
//     console.error("Error Link BvItem to Rab:", error);
//     res
//       .status(500)
//       .json({ error: error.message || "Terjadi kesalahan pada server." });
//   }
// });
/** POST /bv-items/:id/sync — update volume RAB sesuai BV terbaru */
router.post("/bv-items/:id/link-to-rab", async (req, res) => {
  try {
    const { id } = req.params;
    const { rabUnitPrice, groupId, category, reference, overhead, components } =
      req.body;

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
    let rapUnitPrice = 0; // Set default 0 biar aman kalau kosongan
    let componentRows = [];
    let finalCategory = category || null;
    let finalReference = reference || null;
    let overheadPct =
      overhead != null && overhead !== "" ? Number(overhead) : 10;
    let calculatedRabPrice = 0;

    // ==========================================
    // 1. JALUR MASTER AHSP
    // ==========================================
    if (bvItem.sourceJobTypeId) {
      const calc = await calculateJobPrice(bvItem.sourceJobTypeId);
      if (!calc)
        return res
          .status(404)
          .json({ error: "Jenis pekerjaan (master) tidak ditemukan." });

      overheadPct = calc.jobType.overhead
        ? Number(calc.jobType.overhead)
        : overheadPct;
      finalCategory = category || calc.jobType.category;
      finalReference = reference || calc.jobType.reference;

      componentRows = Object.entries(calc.breakdown).flatMap(
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
      calculatedRabPrice = rapUnitPrice + rapUnitPrice * (overheadPct / 100);
    }

    // ==========================================
    // 2. JALUR CUSTOM (SUDAH DIBIKIN HALAL KOSONGAN!)
    // ==========================================
    else {
      let baseTotal = 0;

      // Hanya proses kalau user kebetulan ngisi komponen
      if (Array.isArray(components) && components.length > 0) {
        componentRows = components.map((c) => {
          const lineTotal =
            Number(c.coefficient || 0) * Number(c.unitPrice || 0);
          baseTotal += lineTotal;
          return {
            name: c.name,
            unit: c.unit,
            section: c.section,
            coefficient: c.coefficient,
            unitPrice: c.unitPrice,
            lineTotal,
          };
        });
      }

      rapUnitPrice = baseTotal;
      calculatedRabPrice = rapUnitPrice + rapUnitPrice * (overheadPct / 100);
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

      // Logika Ordering (Tidak Diubah)
      if (bvItem.parentBvItemId) {
        const parentBv = await tx.bvItem.findUnique({
          where: { id: bvItem.parentBvItemId },
          select: { linkedRabItemId: true },
        });

        if (parentBv?.linkedRabItemId) {
          const parentRab = await tx.rabItem.findUnique({
            where: { id: parentBv.linkedRabItemId },
            select: { order: true },
          });

          const linkedSiblings = await tx.bvItem.findMany({
            where: {
              parentBvItemId: bvItem.parentBvItemId,
              linkedRabItemId: { not: null },
            },
            include: { linkedRabItem: { select: { order: true } } },
          });

          const maxSiblingOrder = linkedSiblings.length
            ? Math.max(...linkedSiblings.map((s) => s.linkedRabItem.order))
            : parentRab.order;

          insertOrder = maxSiblingOrder + 1;

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

      // Create di tabel RAB
      const rabItem = await tx.rabItem.create({
        data: {
          projectId: bvItem.projectId,
          groupId: finalGroupId,
          name: bvItem.name,
          paymentUnit: bvItem.paymentUnit,
          category: finalCategory,
          reference: finalReference,

          overhead: overheadPct,
          volume: vol,

          rapUnitPrice: rapUnitPrice,
          rapTotalPrice: rapUnitPrice * vol,

          rabUnitPrice: finalRabSatuan,
          rabTotalPrice: finalRabSatuan * vol,

          sourceJobTypeId: bvItem.sourceJobTypeId || null,
          order: insertOrder,
          components: { create: componentRows }, // Bisa nembak array kosong [] dengan aman
        },
      });

      // Update urutan Child
      const linkedChildren = await tx.bvItem.findMany({
        where: { parentBvItemId: id, linkedRabItemId: { not: null } },
        select: { linkedRabItemId: true },
        orderBy: { createdAt: "asc" },
      });

      if (linkedChildren.length > 0) {
        const childRabIds = linkedChildren.map((c) => c.linkedRabItemId);
        await tx.rabItem.updateMany({
          where: { id: { in: childRabIds } },
          data: { order: -1 },
        });
        await tx.rabItem.updateMany({
          where: {
            projectId: bvItem.projectId,
            groupId: finalGroupId,
            order: { gt: rabItem.order },
          },
          data: { order: { increment: childRabIds.length } },
        });
        for (let i = 0; i < childRabIds.length; i++) {
          await tx.rabItem.update({
            where: { id: childRabIds[i] },
            data: { order: rabItem.order + 1 + i },
          });
        }
      }

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

    const vol = Number(bvItem.totalVolume);
    let rapUnitPrice = Number(bvItem.linkedRabItem.rapUnitPrice);
    let overheadPct = bvItem.linkedRabItem.overhead;
    let componentUpdate;

    if (bvItem.sourceJobTypeId) {
      const calc = await calculateJobPrice(bvItem.sourceJobTypeId);
      if (calc) {
        rapUnitPrice = calc.total;
        overheadPct = calc.jobType.overhead;
        componentUpdate = {
          deleteMany: {},
          create: Object.entries(calc.breakdown).flatMap(([section, items]) =>
            items.map((item) => ({
              name: item.name,
              unit: item.unit,
              section,
              coefficient: item.coefficient,
              unitPrice: item.unitPrice,
              lineTotal: item.lineTotal,
            })),
          ),
        };
      }
    }

    const rabUnitPrice = Number(bvItem.linkedRabItem.rabUnitPrice);

    const updated = await prisma.$transaction(async (tx) => {
      // reposisi order kalau item ini child dan posisinya sekarang salah
      if (bvItem.parentBvItemId) {
        const parentBv = await tx.bvItem.findUnique({
          where: { id: bvItem.parentBvItemId },
          select: { linkedRabItemId: true },
        });

        if (parentBv?.linkedRabItemId) {
          const parentRab = await tx.rabItem.findUnique({
            where: { id: parentBv.linkedRabItemId },
            select: { order: true, groupId: true, projectId: true },
          });

          const correctOrder = parentRab.order + 1;
          const currentOrder = bvItem.linkedRabItem.order;

          if (currentOrder !== correctOrder) {
            // lepas dulu slot lama biar ga tabrakan pas geser
            await tx.rabItem.update({
              where: { id: bvItem.linkedRabItemId },
              data: { order: -1 },
            });

            if (currentOrder < correctOrder) {
              // pindah maju: item di antara posisi lama & baru mundur 1
              await tx.rabItem.updateMany({
                where: {
                  projectId: parentRab.projectId,
                  groupId: parentRab.groupId,
                  order: { gt: currentOrder, lte: correctOrder },
                },
                data: { order: { decrement: 1 } },
              });
            } else {
              // pindah mundur: item di antara posisi baru & lama maju 1
              await tx.rabItem.updateMany({
                where: {
                  projectId: parentRab.projectId,
                  groupId: parentRab.groupId,
                  order: { gte: correctOrder, lt: currentOrder },
                },
                data: { order: { increment: 1 } },
              });
            }

            await tx.rabItem.update({
              where: { id: bvItem.linkedRabItemId },
              data: { order: correctOrder },
            });
          }
        }
      }

      return tx.rabItem.update({
        where: { id: bvItem.linkedRabItemId },
        data: {
          name: bvItem.name,
          paymentUnit: bvItem.paymentUnit,
          overhead: overheadPct,
          volume: vol,
          rapUnitPrice,
          rapTotalPrice: rapUnitPrice * vol,
          rabTotalPrice: rabUnitPrice * vol,
          ...(componentUpdate ? { components: componentUpdate } : {}),
        },
        include: { components: true },
      });
    });

    res.json({
      message:
        "RAB berhasil disinkronkan dengan BV terbaru (nama, satuan, RAP, volume, posisi)",
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
