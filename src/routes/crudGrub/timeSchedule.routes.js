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

/** PUT /rap-items/:id/schedule — assign / update rentang pengerjaan item RAB */
router.put("/rap-items/:id/schedule", async (req, res) => {
  try {
    const { id } = req.params;
    const { startDate, endDate } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({
        error: "startDate dan endDate wajib diisi.",
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (end < start) {
      return res.status(400).json({ error: "Tanggal selesai tidak boleh kurang dari tanggal mulai." });
    }

    const rabItem = await prisma.rabItem.findUnique({ where: { id } });
    if (!rabItem)
      return res.status(404).json({ error: "Item RAB tidak ditemukan." });

    const schedule = await prisma.timeSchedule.upsert({
      where: { rabItemId: id },
      update: { startDate: start, endDate: end },
      create: { rabItemId: id, startDate: start, endDate: end },
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
    await prisma.timeSchedule.delete({ where: { rabItemId: id } });
    res.json({ message: "Jadwal berhasil dihapus." });
  } catch (error) {
    if (error.code === "P2025") {
      return res.status(404).json({ error: "Jadwal tidak ditemukan." });
    }
    console.error("Error Delete Schedule:", error);
    res.status(500).json({ error: "Terjadi kesalahan pada server." });
  }
});

/** GET /projects/:projectId/rap-time-schedule — generate tabel breakdown + kurva S rencana RAB */
router.get("/projects/:projectId/rap-time-schedule", async (req, res) => {
  try {
    const { projectId } = req.params;
    const { discipline, viewMode = 'week' } = req.query;

    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project)
      return res.status(404).json({ error: "Project tidak ditemukan." });

    const groups = await prisma.rabGroup.findMany({
      where: { projectId, parentId: null },
      include: {
        items: {
          where: discipline ? { discipline } : undefined,
          include: {
            timeSchedule: true,
            bvItem: { select: { id: true, parentBvItemId: true } },
          },
          orderBy: { order: "asc" },
        },
        children: {
          include: {
            items: {
              where: discipline ? { discipline } : undefined,
              include: {
                timeSchedule: true,
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

    const ungroupedItems = await prisma.rabItem.findMany({
      where: {
        projectId,
        groupId: null,
        ...(discipline ? { discipline } : {}),
      },
      include: {
        timeSchedule: true,
        bvItem: { select: { id: true, parentBvItemId: true } },
      },
      orderBy: { order: "asc" },
    });

    const rabItems = [];
    groups.forEach((group) => {
      rabItems.push(
        ...group.items.map((it) => ({
          ...it,
          groupName: group.name.toUpperCase(),
        })),
      );
      (group.children || []).forEach((sub) => {
        rabItems.push(
          ...sub.items.map((it) => ({ ...it, groupName: sub.name })),
        );
      });
    });
    rabItems.push(
      ...ungroupedItems.map((it) => ({ ...it, groupName: "Tanpa Group" })),
    );

    const parentIds = new Set(
      rabItems.map((it) => it.bvItem?.parentBvItemId).filter(Boolean),
    );

    const parentRapSum = {};
    rabItems.forEach((it) => {
      const pId = it.bvItem?.parentBvItemId;
      if (pId) {
        parentRapSum[pId] =
          (parentRapSum[pId] || 0) + Number(it.rapTotalPrice || 0);
      }
    });

    const totalContract = rabItems.reduce((sum, it) => {
      const hasChildren = parentIds.has(it.bvItem?.id);
      if (hasChildren) return sum;
      return sum + Number(it.rapTotalPrice);
    }, 0);

    let minDate = project.startDate ? new Date(project.startDate) : null;
    let maxDate = minDate ? new Date(minDate) : null;

    rabItems.forEach(it => {
      if (it.timeSchedule) {
         const s = new Date(it.timeSchedule.startDate);
         const e = new Date(it.timeSchedule.endDate);
         if (!minDate || s < minDate) minDate = new Date(s);
         if (!maxDate || e > maxDate) maxDate = new Date(e);
      }
    });

    if (!minDate) {
      minDate = new Date();
      minDate.setHours(0,0,0,0);
    }
    if (!maxDate) {
      maxDate = new Date(minDate);
      maxDate.setDate(maxDate.getDate() + 30);
    }
    
    minDate.setHours(0,0,0,0);
    maxDate.setHours(23,59,59,999);

    const periods = [];
    let curr = new Date(minDate);
    const endLimit = new Date(maxDate);

    if (viewMode === 'day') {
      let i = 1;
      while (curr <= endLimit) {
        const d = new Date(curr);
        periods.push({
           index: i,
           label: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth()+1).padStart(2, '0')}`,
           start: new Date(d.setHours(0,0,0,0)),
           end: new Date(d.setHours(23,59,59,999))
        });
        curr.setDate(curr.getDate() + 1);
        i++;
      }
    } else if (viewMode === 'week') {
      let i = 1;
      while (curr <= endLimit) {
        const start = new Date(curr);
        start.setHours(0,0,0,0);
        const end = new Date(curr);
        end.setDate(end.getDate() + 6);
        end.setHours(23,59,59,999);
        periods.push({
           index: i,
           label: `Mg ${i}`,
           start: start,
           end: end
        });
        curr.setDate(curr.getDate() + 7);
        i++;
      }
    } else if (viewMode === 'month') {
      let i = 1;
      curr.setDate(1); 
      while (curr <= endLimit || (curr.getFullYear() === endLimit.getFullYear() && curr.getMonth() === endLimit.getMonth())) {
        const start = new Date(curr);
        start.setHours(0,0,0,0);
        const end = new Date(curr.getFullYear(), curr.getMonth() + 1, 0); 
        end.setHours(23,59,59,999);
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Ags", "Sep", "Okt", "Nov", "Des"];
        periods.push({
           index: i,
           label: `${monthNames[curr.getMonth()]} '${String(curr.getFullYear()).slice(-2)}`,
           start: start,
           end: end
        });
        curr.setMonth(curr.getMonth() + 1);
        curr.setDate(1);
        i++;
      }
    }

    const items = rabItems.map((it) => {
      const isChild = !!it.bvItem?.parentBvItemId;
      const hasChildren = parentIds.has(it.bvItem?.id);

      const actualRapTotal = hasChildren
        ? parentRapSum[it.bvItem?.id] || 0
        : Number(it.rapTotalPrice);

      const weight =
        !hasChildren && totalContract > 0
          ? (actualRapTotal / totalContract) * 100
          : 0;

      const periodWeight = {};
      if (it.timeSchedule && !hasChildren) {
         const iStart = new Date(it.timeSchedule.startDate).getTime();
         const iEnd = new Date(it.timeSchedule.endDate).setHours(23,59,59,999);
         const totalDays = Math.round((iEnd - iStart) / (1000 * 60 * 60 * 24)) || 1;
         const perDay = weight / totalDays;

         periods.forEach(p => {
            const pStart = p.start.getTime();
            const pEnd = p.end.getTime();
            const overlapStart = Math.max(iStart, pStart);
            const overlapEnd = Math.min(iEnd, pEnd);
            
            if (overlapStart <= overlapEnd) {
               let overlapDays = Math.round((overlapEnd - overlapStart) / (1000 * 60 * 60 * 24));
               if (overlapDays < 1) overlapDays = 1;
               periodWeight[p.index] = perDay * overlapDays;
            }
         });
      }

      return {
        rabItemId: it.id,
        name: it.name,
        paymentUnit: it.paymentUnit,
        volume: it.volume,
        rapTotalPrice: actualRapTotal,
        satuanHarga: it.rapUnitPrice,
        weight,

        startDate: it.timeSchedule?.startDate ?? null,
        endDate: it.timeSchedule?.endDate ?? null,
        periodWeight,
        groupId: it.groupId,
        groupName: it.groupName,
        isChild,
        hasChildren,
        isByOwner: it.isByOwner,
        isStip: it.isStip,
        discipline: it.discipline,
      };
    });

    const periodTotal = {};
    periods.forEach(p => {
      periodTotal[p.index] = items.reduce(
        (sum, it) => sum + (it.periodWeight[p.index] || 0),
        0
      );
    });

    let cumulative = 0;
    const cumulativeTotal = {};
    periods.forEach(p => {
      cumulative += periodTotal[p.index];
      cumulativeTotal[p.index] = cumulative;
    });

    res.json({
      projectId,
      startDate: project.startDate,
      viewMode,
      periods,
      items,
      periodTotal,
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
