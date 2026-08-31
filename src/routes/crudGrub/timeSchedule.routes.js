"use strict";
const express = require("express");
const prisma = require("../../lib/prisma");
const router = express.Router();

/** PUT /projects/:projectId/start-date — set tanggal mulai proyek */
router.put("/projects/:projectId/start-date", async (req, res) => {
  try {
    const { projectId } = req.params;
    const { startDate } = req.body;

    if (!startDate) {
      return res.status(400).json({ error: "Field startDate wajib diisi." });
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project)
      return res.status(404).json({ error: "Project tidak ditemukan." });

    const updated = await prisma.project.update({
      where: { id: projectId },
      data: { startDate: new Date(startDate) },
    });

    res.json({
      message: "Tanggal mulai proyek berhasil disimpan",
      data: updated,
    });
  } catch (error) {
    console.error("Error Set Project StartDate:", error);
    res
      .status(500)
      .json({ error: error.message || "Terjadi kesalahan pada server." });
  }
});

/** PUT /rap-items/:id/schedule — assign / update rentang minggu pengerjaan item RAP */
router.put("/rap-items/:id/schedule", async (req, res) => {
  try {
    const { id } = req.params;
    const { startWeek, endWeek } = req.body;

    if (!startWeek || !endWeek || startWeek < 1 || endWeek < startWeek) {
      return res.status(400).json({
        error: "startWeek dan endWeek wajib diisi, endWeek >= startWeek.",
      });
    }

    const rapItem = await prisma.rapItem.findUnique({ where: { id } });
    if (!rapItem)
      return res.status(404).json({ error: "Item RAP tidak ditemukan." });

    const schedule = await prisma.rapTimeSchedule.upsert({
      where: { rapItemId: id },
      update: { startWeek, endWeek },
      create: { rapItemId: id, startWeek, endWeek },
    });

    res.json({ message: "Jadwal berhasil disimpan", data: schedule });
  } catch (error) {
    console.error("Error Set Schedule:", error);
    res
      .status(500)
      .json({ error: error.message || "Terjadi kesalahan pada server." });
  }
});

/** DELETE /rap-items/:id/schedule — hapus jadwal item */
router.delete("/rap-items/:id/schedule", async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.rapTimeSchedule.delete({ where: { rapItemId: id } });
    res.json({ message: "Jadwal berhasil dihapus." });
  } catch (error) {
    if (error.code === "P2025") {
      return res.status(404).json({ error: "Jadwal tidak ditemukan." });
    }
    console.error("Error Delete Schedule:", error);
    res.status(500).json({ error: "Terjadi kesalahan pada server." });
  }
});

/** GET /projects/:projectId/rap-time-schedule — generate tabel breakdown mingguan + kurva S rencana RAP */
router.get("/projects/:projectId/rap-time-schedule", async (req, res) => {
  try {
    const { projectId } = req.params;
    const { discipline } = req.query;

    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project)
      return res.status(404).json({ error: "Project tidak ditemukan." });

    // query berbasis GROUP RAP
    const groups = await prisma.rapGroup.findMany({
      where: { projectId, parentId: null },
      include: {
        items: {
          where: discipline ? { discipline } : undefined,
          include: {
            rapTimeSchedule: true,
            bvItem: { select: { id: true, parentBvItemId: true } },
          },
          orderBy: { order: "asc" },
        },
        children: {
          include: {
            items: {
              where: discipline ? { discipline } : undefined,
              include: {
                rapTimeSchedule: true,
                bvItem: { select: { id: true, parentBvItemId: true } },
              },
              orderBy: { order: "asc" },
            },
          },
          orderBy: { order: "asc" },
        },
      },
      orderBy: { order: "asc" },
    });

    // item tanpa group (groupId null)
    const ungroupedItems = await prisma.rapItem.findMany({
      where: {
        projectId,
        groupId: null,
        ...(discipline ? { discipline } : {}),
      },
      include: {
        rapTimeSchedule: true,
        bvItem: { select: { id: true, parentBvItemId: true } },
      },
      orderBy: { order: "asc" },
    });

    const rapItems = [];
    groups.forEach((group) => {
      rapItems.push(
        ...group.items.map((it) => ({
          ...it,
          groupName: group.name.toUpperCase(),
        })),
      );
      (group.children || []).forEach((sub) => {
        rapItems.push(
          ...sub.items.map((it) => ({ ...it, groupName: sub.name })),
        );
      });
    });
    rapItems.push(
      ...ungroupedItems.map((it) => ({ ...it, groupName: "Tanpa Group" })),
    );

    const parentIds = new Set(
      rapItems.map((it) => it.bvItem?.parentBvItemId).filter(Boolean),
    );

    const totalContract = rapItems.reduce((sum, it) => {
      const hasChildren = parentIds.has(it.bvItem?.id);
      if (hasChildren) return sum;
      return sum + Number(it.rapTotalPrice);
    }, 0);

    const maxWeek = rapItems.reduce((max, it) => {
      if (!it.rapTimeSchedule) return max;
      return Math.max(max, it.rapTimeSchedule.endWeek);
    }, 0);

    const weekDates = [];
    for (let w = 1; w <= maxWeek; w++) {
      let start = null;
      let end = null;
      if (project.startDate) {
        start = new Date(project.startDate);
        start.setDate(start.getDate() + (w - 1) * 7);
        end = new Date(start);
        end.setDate(end.getDate() + 6);
      }
      weekDates.push({ week: w, start, end });
    }

    const items = rapItems.map((it) => {
      const isChild = !!it.bvItem?.parentBvItemId;
      const hasChildren = parentIds.has(it.bvItem?.id);

      const weight =
        !hasChildren && totalContract > 0
          ? (Number(it.rapTotalPrice) / totalContract) * 100
          : 0;

      const weeklyWeight = {};
      if (it.rapTimeSchedule && !hasChildren) {
        const { startWeek, endWeek } = it.rapTimeSchedule;
        const span = endWeek - startWeek + 1;
        const perWeek = weight / span;
        for (let w = startWeek; w <= endWeek; w++) {
          weeklyWeight[w] = perWeek;
        }
      }

      return {
        rapItemId: it.id,
        name: it.name,
        paymentUnit: it.paymentUnit,
        volume: it.volume,
        rapTotalPrice: it.rapTotalPrice,
        satuanHarga: it.rapUnitPrice,
        weight,

        startWeek: it.rapTimeSchedule?.startWeek ?? null,
        endWeek: it.rapTimeSchedule?.endWeek ?? null,
        weeklyWeight,
        groupId: it.groupId,
        groupName: it.groupName,
        isChild,
        hasChildren,
        isByOwner: it.isByOwner,
        isStip: it.isStip,
      };
    });

    const weeklyTotal = {};
    for (let w = 1; w <= maxWeek; w++) {
      weeklyTotal[w] = items.reduce(
        (sum, it) => sum + (it.weeklyWeight[w] || 0),
        0,
      );
    }

    let cumulative = 0;
    const cumulativeTotal = {};
    for (let w = 1; w <= maxWeek; w++) {
      cumulative += weeklyTotal[w];
      cumulativeTotal[w] = cumulative;
    }

    res.json({
      projectId,
      startDate: project.startDate,
      maxWeek,
      weekDates,
      items,
      weeklyTotal,
      cumulativeTotal,
    });
  } catch (error) {
    console.error("Error Get RAP Time Schedule:", error);
    res
      .status(500)
      .json({ error: error.message || "Terjadi kesalahan pada server." });
  }
});

module.exports = router;
