/** PUT /rab-items/:id/progress — input/update progress harian lapangan */
"use strict";
const express = require("express");
const prisma = require("../../lib/prisma");
const router = express.Router();

const multer = require("multer");
const path = require("path");
const fs = require("fs");

// ==========================================
// 2. TAMBAHKAN KONFIGURASI STORAGE DI SINI
// ==========================================
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = "./public/uploads/progress";
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "progress-" + uniqueSuffix + path.extname(file.originalname));
  },
});
const upload = multer({ storage: storage });

// ==========================================
// 3. UBAH BARIS ROUTER.PUT ANDA MENJADI SEPERTI INI
// (Sisipkan upload.single("foto") di tengahnya)
// ==========================================

router.put(
  "/rab-items/:id/progress",
  upload.array("foto", 50),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { date, progressPercent } = req.body;

      if (!date || progressPercent == null) {
        return res
          .status(400)
          .json({ error: "Field date dan progressPercent wajib diisi." });
      }

      const rabItem = await prisma.rabItem.findUnique({ where: { id } });
      if (!rabItem) {
        return res.status(404).json({ error: "Item RAB tidak ditemukan." });
      }

      // Foto baru yang barusan diupload
      const newPhotoUrls =
        req.files && req.files.length > 0
          ? req.files.map((file) => `/uploads/progress/${file.filename}`)
          : [];

      const normalizedDate = new Date(date);
      normalizedDate.setUTCHours(0, 0, 0, 0);

      // Ambil dulu record existing di tanggal ini (kalau ada)
      const existingProgress = await prisma.dailyProgress.findUnique({
        where: {
          rabItemId_date: { rabItemId: id, date: normalizedDate },
        },
      });

      // Gabung foto lama + foto baru
      const mergedPhotoUrls = [
        ...(existingProgress?.photoUrls || []),
        ...newPhotoUrls,
      ];

      const updateData = { progressPercent: Number(progressPercent) };
      if (mergedPhotoUrls.length > 0) {
        updateData.photoUrls = mergedPhotoUrls;
      }

      const createData = {
        rabItemId: id,
        date: normalizedDate,
        progressPercent: Number(progressPercent),
      };
      if (mergedPhotoUrls.length > 0) {
        createData.photoUrls = mergedPhotoUrls;
      }

      const progress = await prisma.dailyProgress.upsert({
        where: {
          rabItemId_date: { rabItemId: id, date: normalizedDate },
        },
        update: updateData,
        create: createData,
      });

      res.status(200).json({
        message: "Progres dan foto-foto berhasil disimpan!",
        data: progress,
      });
    } catch (error) {
      console.error("Error Set Daily Progress:", error);
      res
        .status(500)
        .json({ error: error.message || "Terjadi kesalahan pada server." });
    }
  },
);
module.exports = router;

/** GET /projects/:projectId/join-opname — breakdown progress harian per item */
router.get("/projects/:projectId/join-opname", async (req, res) => {
  try {
    const { projectId } = req.params;
    const { discipline } = req.query;

    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project)
      return res.status(404).json({ error: "Project tidak ditemukan." });

    // reuse pola query yang sama kayak time-schedule (group -> items, + ungrouped)
    const groups = await prisma.rabGroup.findMany({
      where: { projectId, parentId: null },
      include: {
        items: {
          where: discipline ? { discipline } : undefined,
          include: {
            dailyProgress: true,
            bvItem: { select: { id: true, parentBvItemId: true } },
          },
          orderBy: { order: "asc" },
        },
        children: {
          include: {
            items: {
              where: discipline ? { discipline } : undefined,
              include: {
                dailyProgress: true,
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
        dailyProgress: true,
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

    // total hari = maxWeek dari TimeSchedule x 7
    const timeSchedules = await prisma.timeSchedule.findMany({
      where: { rabItem: { projectId } },
      select: { endWeek: true },
    });
    const maxWeek = timeSchedules.reduce(
      (max, ts) => Math.max(max, ts.endWeek),
      0,
    );
    const totalDays = maxWeek * 7;

    const days = [];
    for (let d = 0; d < totalDays; d++) {
      const date = new Date(project.startDate);
      date.setDate(date.getDate() + d);
      days.push({ dayNumber: d + 1, date });
    }

    function statusFor(rekapPercent) {
      if (rekapPercent === 0) return "BELUM MULAI";
      if (rekapPercent === 100) return "SELESAI";
      if (rekapPercent > 100) return "VOLUME OVER";
      if (rekapPercent <= 94) return "ON PROGRESS";
      return "QC CHECK"; // 95-99
    }

    const items = rabItems.map((it) => {
      const hasChildren = parentIds.has(it.bvItem?.id);

      const actualRapTotal = hasChildren
        ? parentRapSum[it.bvItem?.id] || 0
        : Number(it.rapTotalPrice);

      const weight =
        !hasChildren && totalContract > 0
          ? (actualRapTotal / totalContract) * 100
          : 0;

      const progressByDate = new Map(
        (it.dailyProgress || []).map((p) => [
          new Date(p.date).toISOString().slice(0, 10),
          {
            percent: Number(p.progressPercent),
            photoUrls: p.photoUrls || [],
          },
        ]),
      );

      let sumProgress = 0;
      const dailyBreakdown = days.map((day) => {
        const key = day.date.toISOString().slice(0, 10);

        const pData = hasChildren ? null : progressByDate.get(key);
        const progress = pData ? pData.percent : 0;
        const photoUrls = pData ? pData.photoUrls : [];

        sumProgress += progress;
        return {
          dayNumber: day.dayNumber,
          date: day.date,
          progress,
          photoUrls,
          bobot: weight * (progress / 100),
          volume: (progress / 100) * Number(it.volume),
        };
      });

      const rekapProgress = totalDays > 0 ? sumProgress / totalDays : 0;

      return {
        rabItemId: it.id,
        name: it.name,
        paymentUnit: it.paymentUnit,
        volume: it.volume,
        rapTotalPrice: actualRapTotal,
        satuanHarga: it.rapUnitPrice,
        weight,
        groupId: it.groupId,
        groupName: it.groupName,
        hasChildren,
        dailyBreakdown,
        rekapProgress,
        status: statusFor(rekapProgress),

        // --- TAMBAHKAN 2 BARIS INI ---
        isByOwner: it.isByOwner,
        isStip: it.isStip,
      };
    });

    res.json({
      projectId,
      startDate: project.startDate,
      totalDays,
      days,
      items,
    });
  } catch (error) {
    console.error("Error Get Join Opname:", error);
    res
      .status(500)
      .json({ error: error.message || "Terjadi kesalahan pada server." });
  }
});

module.exports = router;
