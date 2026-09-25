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

      let finalProgress = Number(progressPercent);
      if (finalProgress > 100) finalProgress = 100;


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

      // Ambil semua progress existing untuk item ini
      const allExisting = await prisma.dailyProgress.findMany({
        where: { rabItemId: id },
      });

      let existingSumExcludingToday = 0;
      let existingProgressForToday = null;

      for (const p of allExisting) {
        if (p.date.getTime() === normalizedDate.getTime()) {
          existingProgressForToday = p;
        } else {
          existingSumExcludingToday += Number(p.progressPercent);
        }
      }

      if (existingSumExcludingToday + finalProgress > 100) {
        return res.status(400).json({ error: `Total akumulasi progress tidak boleh melebihi 100%. (Progress sebelum hari ini: ${existingSumExcludingToday}%)` });
      }

      const existingProgress = existingProgressForToday;

      // Gabung foto lama + foto baru
      const mergedPhotoUrls = [
        ...(existingProgress?.photoUrls || []),
        ...newPhotoUrls,
      ];

      const updateData = { progressPercent: finalProgress };
      if (mergedPhotoUrls.length > 0) {
        updateData.photoUrls = mergedPhotoUrls;
      }

      const createData = {
        rabItemId: id,
        date: normalizedDate,
        progressPercent: finalProgress,
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
          where: discipline && discipline !== "General" ? { discipline } : undefined,
          include: {
            dailyProgress: true,
            timeSchedule: true,
            bvItem: { select: { id: true, parentBvItemId: true } },
          },
          orderBy: { order: "asc" },
        },
        children: {
          include: {
            items: {
              where: discipline && discipline !== "General" ? { discipline } : undefined,
              include: {
                dailyProgress: true,
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
        ...(discipline && discipline !== "General" ? { discipline } : {}),
      },
      include: {
        dailyProgress: true,
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

    // total hari = selisih max endDate dan project.startDate
    const timeSchedulesAgg = await prisma.timeSchedule.aggregate({
      where: { rabItem: { projectId } },
      _max: { endDate: true },
    });
    
    let totalDays = 0;
    const maxEndDate = timeSchedulesAgg._max.endDate;
    if (project.startDate && maxEndDate) {
      const diffMs = maxEndDate.getTime() - project.startDate.getTime();
      totalDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24)) + 1;
      if (totalDays < 0) totalDays = 0;
    }

    const days = [];
    for (let d = 0; d < totalDays; d++) {
      const date = new Date(project.startDate);
      date.setDate(date.getDate() + d);
      days.push({ dayNumber: d + 1, date });
    }

    function statusFor(rekapPercent) {
      if (rekapPercent >= 100) return "SELESAI";
      if (rekapPercent >= 95) return "QUALITY CHECK";
      if (rekapPercent >= 51) return "ON PROGRESS";
      return "BELUM MULAI"; // 0-50%
    }

    const itemsData = rabItems.map(it => {
      const hasChildren = parentIds.has(it.bvItem?.id);
      
      let sumProgress = 0;
      const progressByDate = new Map(
        (it.dailyProgress || []).map((p) => {
          const pVal = Number(p.progressPercent);
          sumProgress += pVal;
          return [
            new Date(p.date).toISOString().slice(0, 10),
            { percent: pVal, photoUrls: p.photoUrls || [] }
          ];
        })
      );
      
      const actualRapTotal = hasChildren
        ? parentRapSum[it.bvItem?.id] || 0
        : Number(it.rapTotalPrice);

      const weight = totalContract > 0
          ? (actualRapTotal / totalContract) * 100
          : 0;

      return {
        it,
        hasChildren,
        actualRapTotal,
        weight,
        progressByDate,
        maxProgressSoFar: sumProgress // keeping property name for compatibility but it's now sum
      };
    });

    const parentProgressSum = {}; 
    itemsData.forEach(data => {
      if (!data.hasChildren && data.it.bvItem?.parentBvItemId) {
        const pId = data.it.bvItem.parentBvItemId;
        const progressValue = data.actualRapTotal * (data.maxProgressSoFar / 100);
        parentProgressSum[pId] = (parentProgressSum[pId] || 0) + progressValue;
      }
    });

    const items = itemsData.map((data) => {
      const { it, hasChildren, actualRapTotal, weight, progressByDate } = data;

      let rekapProgress = data.maxProgressSoFar;
      if (hasChildren) {
         const pId = it.bvItem?.id;
         const sumProgValue = parentProgressSum[pId] || 0;
         rekapProgress = actualRapTotal > 0 ? (sumProgValue / actualRapTotal) * 100 : 0;
      }
      
      const tsStart = it.timeSchedule?.startDate ? new Date(it.timeSchedule.startDate).setHours(0,0,0,0) : null;
      const tsEnd = it.timeSchedule?.endDate ? new Date(it.timeSchedule.endDate).setHours(0,0,0,0) : null;

      const dailyBreakdown = days.map((day) => {
        const key = day.date.toISOString().slice(0, 10);
        const dayTime = new Date(day.date).setHours(0,0,0,0);

        const pData = hasChildren ? null : progressByDate.get(key);
        
        const progress = pData ? pData.percent : 0;
        const photoUrls = pData ? pData.photoUrls : [];

        let inSchedule = true;
        if (tsStart && tsEnd) {
          inSchedule = dayTime >= tsStart && dayTime <= tsEnd;
        }

        return {
          dayNumber: day.dayNumber,
          date: day.date,
          progress,
          photoUrls,
          bobot: weight * (progress / 100),
          volume: (progress / 100) * Number(it.volume),
          inSchedule,
          hasProgress: !!pData
        };
      });

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
        discipline: it.discipline,
        hasChildren,
        dailyBreakdown,
        rekapProgress,
        status: statusFor(rekapProgress),
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
