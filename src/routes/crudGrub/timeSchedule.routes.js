"use strict";
const express = require("express");
const prisma = require("../../lib/prisma");
const router = express.Router();

/** PUT /rab-items/:id/schedule — assign / update rentang minggu pengerjaan item RAB */
/** PUT /projects/:projectId/start-date — set tanggal mulai proyek (dipakai buat hitung tanggal per minggu TS) */
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

router.put("/rab-items/:id/schedule", async (req, res) => {
  try {
    const { id } = req.params;
    const { startWeek, endWeek } = req.body;

    if (!startWeek || !endWeek || startWeek < 1 || endWeek < startWeek) {
      return res.status(400).json({
        error: "startWeek dan endWeek wajib diisi, endWeek >= startWeek.",
      });
    }

    const rabItem = await prisma.rabItem.findUnique({ where: { id } });
    if (!rabItem)
      return res.status(404).json({ error: "Item RAB tidak ditemukan." });

    const schedule = await prisma.timeSchedule.upsert({
      where: { rabItemId: id },
      update: { startWeek, endWeek },
      create: { rabItemId: id, startWeek, endWeek },
    });

    res.json({ message: "Jadwal berhasil disimpan", data: schedule });
  } catch (error) {
    console.error("Error Set Schedule:", error);
    res
      .status(500)
      .json({ error: error.message || "Terjadi kesalahan pada server." });
  }
});

/** DELETE /rab-items/:id/schedule — hapus jadwal item (belum dijadwalkan lagi) */
router.delete("/rab-items/:id/schedule", async (req, res) => {
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

/** GET /projects/:projectId/time-schedule — generate tabel breakdown mingguan + kurva S rencana */
// router.get("/projects/:projectId/time-schedule", async (req, res) => {
//   try {
//     const { projectId } = req.params;
//     const { discipline } = req.query;

//     const project = await prisma.project.findUnique({
//       where: { id: projectId },
//     });
//     if (!project)
//       return res.status(404).json({ error: "Project tidak ditemukan." });

//     const rabItems = await prisma.rabItem.findMany({
//       where: {
//         projectId,
//         ...(discipline ? { discipline } : {}),
//       },
//       include: {
//         timeSchedule: true,
//         group: true,
//         bvItem: { select: { id: true, parentBvItemId: true } }, // <-- tambah
//       },
//       orderBy: [{ order: "asc" }],
//     });

//     // kumpulkan id yang jadi parent (punya anak)
//     const parentIds = new Set(
//       rabItems.map((it) => it.bvItem?.parentBvItemId).filter(Boolean),
//     );

//     // total kontrak: item yang punya anak DIKECUALIKAN, biar ga double count
//     const totalContract = rabItems.reduce((sum, it) => {
//       const hasChildren = parentIds.has(it.bvItem?.id);
//       if (hasChildren) return sum;
//       return sum + Number(it.rabTotalPrice);
//     }, 0);

//     const maxWeek = rabItems.reduce((max, it) => {
//       if (!it.timeSchedule) return max;
//       return Math.max(max, it.timeSchedule.endWeek);
//     }, 0);

//     const weekDates = [];
//     for (let w = 1; w <= maxWeek; w++) {
//       let start = null;
//       let end = null;
//       if (project.startDate) {
//         start = new Date(project.startDate);
//         start.setDate(start.getDate() + (w - 1) * 7);
//         end = new Date(start);
//         end.setDate(end.getDate() + 6);
//       }
//       weekDates.push({ week: w, start, end });
//     }

//     const items = rabItems.map((it) => {
//       const isChild = !!it.bvItem?.parentBvItemId;
//       const hasChildren = parentIds.has(it.bvItem?.id);

//       // parent yang punya anak: bobot 0, ga masuk jadwal sendiri
//       const weight =
//         !hasChildren && totalContract > 0
//           ? (Number(it.rabTotalPrice) / totalContract) * 100
//           : 0;

//       const weeklyWeight = {};
//       if (it.timeSchedule && !hasChildren) {
//         const { startWeek, endWeek } = it.timeSchedule;
//         const span = endWeek - startWeek + 1;
//         const perWeek = weight / span;
//         for (let w = startWeek; w <= endWeek; w++) {
//           weeklyWeight[w] = perWeek;
//         }
//       }

//       return {
//         rabItemId: it.id,
//         name: it.name,
//         paymentUnit: it.paymentUnit,
//         volume: it.volume,
//         rabTotalPrice: it.rabTotalPrice,
//         weight,
//         startWeek: it.timeSchedule?.startWeek ?? null,
//         endWeek: it.timeSchedule?.endWeek ?? null,
//         weeklyWeight,
//         groupId: it.groupId,
//         groupName: it.group?.name || "Tanpa Group",
//         isChild, // <-- tambah
//         hasChildren, // <-- tambah
//       };
//     });

//     const weeklyTotal = {};
//     for (let w = 1; w <= maxWeek; w++) {
//       weeklyTotal[w] = items.reduce(
//         (sum, it) => sum + (it.weeklyWeight[w] || 0),
//         0,
//       );
//     }

//     let cumulative = 0;
//     const cumulativeTotal = {};
//     for (let w = 1; w <= maxWeek; w++) {
//       cumulative += weeklyTotal[w];
//       cumulativeTotal[w] = cumulative;
//     }

//     res.json({
//       projectId,
//       startDate: project.startDate,
//       maxWeek,
//       weekDates,
//       items,
//       weeklyTotal,
//       cumulativeTotal,
//     });
//   } catch (error) {
//     console.error("Error Get Time Schedule:", error);
//     res
//       .status(500)
//       .json({ error: error.message || "Terjadi kesalahan pada server." });
//   }
// });

router.get("/projects/:projectId/time-schedule", async (req, res) => {
  try {
    const { projectId } = req.params;
    const { discipline } = req.query;

    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project)
      return res.status(404).json({ error: "Project tidak ditemukan." });

    // query berbasis GROUP dulu, urutannya eksplisit — sama pola kayak export
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

    // item tanpa group (groupId null) diambil terpisah, dipaksa di akhir
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

    // susun rabItems FLAT tapi urutannya sesuai urutan group yang benar
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

    const totalContract = rabItems.reduce((sum, it) => {
      const hasChildren = parentIds.has(it.bvItem?.id);
      if (hasChildren) return sum;
      return sum + Number(it.rabTotalPrice);
    }, 0);

    const maxWeek = rabItems.reduce((max, it) => {
      if (!it.timeSchedule) return max;
      return Math.max(max, it.timeSchedule.endWeek);
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

    const items = rabItems.map((it) => {
      const isChild = !!it.bvItem?.parentBvItemId;
      const hasChildren = parentIds.has(it.bvItem?.id);

      const weight =
        !hasChildren && totalContract > 0
          ? (Number(it.rabTotalPrice) / totalContract) * 100
          : 0;

      const weeklyWeight = {};
      if (it.timeSchedule && !hasChildren) {
        const { startWeek, endWeek } = it.timeSchedule;
        const span = endWeek - startWeek + 1;
        const perWeek = weight / span;
        for (let w = startWeek; w <= endWeek; w++) {
          weeklyWeight[w] = perWeek;
        }
      }

      return {
        rabItemId: it.id,
        name: it.name,
        paymentUnit: it.paymentUnit,
        volume: it.volume,
        rabTotalPrice: it.rabTotalPrice,
        weight,
        startWeek: it.timeSchedule?.startWeek ?? null,
        endWeek: it.timeSchedule?.endWeek ?? null,
        weeklyWeight,
        groupId: it.groupId,
        groupName: it.groupName,
        isChild,
        hasChildren,
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
    console.error("Error Get Time Schedule:", error);
    res
      .status(500)
      .json({ error: error.message || "Terjadi kesalahan pada server." });
  }
});

module.exports = router;
