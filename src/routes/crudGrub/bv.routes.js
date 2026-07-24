"use strict";

const express = require("express");
const prisma = require("../../lib/prisma");
const { calculateJobPrice } = require("../../services/calculateService");

const router = express.Router();

function calcBreakdownSubtotal({
  panjang,
  lebar,
  tinggi,
  jumlahSisi,
  jumlahBh,
  waste,
}) {
  const p = panjang != null ? Number(panjang) : 1;
  const l = lebar != null ? Number(lebar) : 1;
  const t = tinggi != null ? Number(tinggi) : 1;
  const j =
    (jumlahSisi != null ? Number(jumlahSisi) : null) ??
    (jumlahBh != null ? Number(jumlahBh) : 1);
  const w = waste != null ? Number(waste) / 100 : 0;
  return p * l * t * j * (1 + w);
}

function buildBreakdownRows(breakdowns) {
  return breakdowns.map((b) => {
    const subTotal = calcBreakdownSubtotal(b);
    return {
      keterangan: b.keterangan || null,
      panjang: b.panjang ?? null,
      lebar: b.lebar ?? null,
      tinggi: b.tinggi ?? null,
      diameter: b.diameter ?? null,
      berat: b.berat ?? null,
      jumlahSisi: b.jumlahSisi ?? null,
      jumlahBh: b.jumlahBh ?? null,
      waste: b.waste ?? 0,
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
    } = req.body;

    if (!Array.isArray(breakdowns) || breakdowns.length === 0) {
      return res
        .status(400)
        .json({ error: "Minimal harus ada 1 baris breakdown dimensi." });
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
      if (group.projectId !== projectId) {
        return res
          .status(400)
          .json({ error: "Group bukan milik project ini." });
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
    } else {
      if (!name || !paymentUnit) {
        return res.status(400).json({
          error:
            'Field "name" dan "paymentUnit" wajib diisi untuk item custom (tanpa sourceJobTypeId).',
        });
      }
    }

    const breakdownRows = buildBreakdownRows(breakdowns);
    const totalVolume = breakdownRows.reduce((sum, b) => sum + b.subTotal, 0);

    const bvItem = await prisma.bvItem.create({
      data: {
        projectId,
        groupId: groupId || null,
        sourceJobTypeId: sourceJobTypeId || null,
        name: finalName,
        keterangan: keterangan || null,
        paymentUnit: finalUnit,
        ecommerceLink: ecommerceLink || null,
        totalVolume,
        breakdowns: { create: breakdownRows },
      },
      include: { breakdowns: true, sourceJobType: true },
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
      where: { projectId },
      include: { breakdowns: true, linkedRabItem: true, sourceJobType: true },
      orderBy: { createdAt: "asc" },
    });

    const result = items.map((it) => {
      let status = "BELUM_DILINK";
      if (it.linkedRabItem) {
        status =
          Number(it.totalVolume) === Number(it.linkedRabItem.volume)
            ? "SUDAH_SINKRON"
            : "BELUM_SINKRON";
      }
      return { ...it, linkStatus: status };
    });

    res.json(result);
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
      name,
      keterangan,
      paymentUnit,
      groupId,
      ecommerceLink,
      breakdowns,
    } = req.body;

    const existing = await prisma.bvItem.findUnique({ where: { id } });
    if (!existing)
      return res.status(404).json({ error: "Item BV tidak ditemukan." });

    // kalau item ini dari HSPK, name/paymentUnit tetap terkunci ke master, gak boleh diketik ulang
    const isFromMaster = !!existing.sourceJobTypeId;

    let totalVolume = Number(existing.totalVolume);
    let breakdownUpdate;

    if (Array.isArray(breakdowns)) {
      if (breakdowns.length === 0) {
        return res
          .status(400)
          .json({ error: "Minimal harus ada 1 baris breakdown dimensi." });
      }
      const rows = buildBreakdownRows(breakdowns);
      totalVolume = rows.reduce((sum, b) => sum + b.subTotal, 0);
      breakdownUpdate = { deleteMany: {}, create: rows };
    }

    const updated = await prisma.bvItem.update({
      where: { id },
      data: {
        ...(!isFromMaster && name !== undefined ? { name } : {}),
        ...(!isFromMaster && paymentUnit !== undefined ? { paymentUnit } : {}),
        ...(keterangan !== undefined ? { keterangan } : {}),
        ...(groupId !== undefined ? { groupId: groupId || null } : {}),
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
    let rapUnitPrice, componentRows, finalCategory, finalReference, overheadPct;

    if (bvItem.sourceJobTypeId) {
      // ---- MODE HSPK: RAP otomatis dari JobType ----
      const calc = await calculateJobPrice(bvItem.sourceJobTypeId);
      if (!calc)
        return res.status(404).json({
          error: "Jenis pekerjaan (master) sumber BV ini tidak ditemukan.",
        });

      rapUnitPrice = calc.total;
      overheadPct = calc.jobType.overhead;
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
    } else {
      // ---- MODE CUSTOM: user isi komponen manual ----
      if (!Array.isArray(components) || components.length === 0) {
        return res.status(400).json({
          error:
            "Minimal harus ada 1 komponen (bahan/upah/alat) untuk item BV custom.",
        });
      }
      overheadPct = overhead != null ? Number(overhead) : 0.1;
      let baseTotal = 0;
      componentRows = components.map((c) => {
        const lineTotal = Number(c.coefficient) * Number(c.unitPrice);
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
      rapUnitPrice = baseTotal + baseTotal * overheadPct;
      finalCategory = category || null;
      finalReference = reference || null;
    }

    const rabPrice = rabUnitPrice != null ? Number(rabUnitPrice) : rapUnitPrice;

    const result = await prisma.$transaction(async (tx) => {
      const rabItem = await tx.rabItem.create({
        data: {
          projectId: bvItem.projectId,
          groupId: groupId || bvItem.groupId || null,
          name: bvItem.name,
          paymentUnit: bvItem.paymentUnit,
          category: finalCategory,
          reference: finalReference,
          overhead: overheadPct,
          volume: vol,
          rapUnitPrice,
          rapTotalPrice: rapUnitPrice * vol,
          rabUnitPrice: rabPrice,
          rabTotalPrice: rabPrice * vol,
          sourceJobTypeId: bvItem.sourceJobTypeId || null,
          components: { create: componentRows },
        },
      });

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

/** POST /bv-items/:id/sync — update volume RAB sesuai BV terbaru */
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
    const rapUnitPrice = Number(bvItem.linkedRabItem.rapUnitPrice);
    const rabUnitPrice = Number(bvItem.linkedRabItem.rabUnitPrice);

    const updated = await prisma.rabItem.update({
      where: { id: bvItem.linkedRabItemId },
      data: {
        volume: vol,
        rapTotalPrice: rapUnitPrice * vol,
        rabTotalPrice: rabUnitPrice * vol,
      },
    });

    res.json({
      message: "Volume RAB berhasil disinkronkan dengan BV terbaru",
      data: updated,
    });
  } catch (error) {
    console.error("Error Sync BvItem:", error);
    res
      .status(500)
      .json({ error: error.message || "Terjadi kesalahan pada server." });
  }
});

module.exports = router;
