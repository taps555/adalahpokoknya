"use strict";
const express = require("express");
const router = express.Router();
const prisma = require("../../lib/prisma"); // Pastikan letak path folder prisma Anda benar
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { streamComplaintPdf } = require("../exportToFile/complainView.routes");

const MAX_PHOTOS_PER_ITEM = 20;

// ==========================================
// KONFIGURASI MULTER UNTUK FOTO COMPLAINT
// ==========================================
const complaintStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = "./public/uploads/complaints";
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "complaint-" + uniqueSuffix + path.extname(file.originalname));
  },
});
// Foto per ITEM (baris defect), bukan per kategori.
// Frontend hitung itemIndex GLOBAL (flat, lintas kategori), bukan per-kategori.
// Pola field: `photo_{itemGlobalIndex}_{photoIndex}`, maks 20 foto per item.
const uploadComplaint = multer({ storage: complaintStorage });

// ==========================================
// HELPER: HAPUS FILE FOTO FISIK DARI DISK
// ==========================================
function deletePhotoFiles(photoUrls) {
  for (const url of photoUrls) {
    const filePath = path.join("./public", url);
    fs.unlink(filePath, (err) => {
      if (err && err.code !== "ENOENT") {
        console.error("Gagal hapus file foto:", filePath, err.message);
      }
    });
  }
}

// Ratain semua item dari semua kategori jadi 1 array urut,
// biar dapet index global yang match sama fieldname `photo_{itemGlobalIndex}_{photoIndex}`
// yang dikirim frontend.
function flattenItemsWithGlobalIndex(categories) {
  const flat = [];
  (categories || []).forEach((category, categoryIndex) => {
    (category.items || []).forEach((item, itemIndexInCategory) => {
      flat.push({ category, categoryIndex, item, itemIndexInCategory });
    });
  });
  return flat.map((entry, globalIndex) => ({ ...entry, globalIndex }));
}

async function computePeriode(project) {
  if (!project.startDate) return { startDate: null, endDate: null };

  const result = await prisma.timeSchedule.aggregate({
    where: { rabItem: { projectId: project.id } },
    _max: { endWeek: true },
  });

  const maxEndWeek = result._max.endWeek;
  const endDate = maxEndWeek
    ? new Date(
        project.startDate.getTime() + maxEndWeek * 7 * 24 * 60 * 60 * 1000,
      )
    : null;

  return { startDate: project.startDate, endDate };
}

// ==========================================
// POST: CREATE COMPLAINT REPORT
// ==========================================
router.post(
  "/projects/:projectId/complaints",
  uploadComplaint.any(),
  async (req, res) => {
    try {
      const { projectId } = req.params;

      if (!req.body.complaintData) {
        return res
          .status(400)
          .json({ error: "Field complaintData (JSON) tidak ditemukan." });
      }

      const parsedData = JSON.parse(req.body.complaintData);
      const { categories } = parsedData;

      const project = await prisma.project.findUnique({
        where: { id: projectId },
      });
      if (!project)
        return res.status(404).json({ error: "Project tidak ditemukan." });

      const flatItems = flattenItemsWithGlobalIndex(categories);

      // Validasi jumlah foto per item SEBELUM proses simpan apapun
      for (const {
        item,
        globalIndex,
        categoryIndex,
        itemIndexInCategory,
      } of flatItems) {
        const count = req.files.filter((f) =>
          f.fieldname.startsWith(`photo_${globalIndex}_`),
        ).length;
        if (count > MAX_PHOTOS_PER_ITEM) {
          return res.status(400).json({
            error: `Kategori ke-${categoryIndex + 1} item ke-${
              itemIndexInCategory + 1
            } (${
              item.defectList || "-"
            }) punya ${count} foto, maksimal ${MAX_PHOTOS_PER_ITEM} foto per item.`,
          });
        }
      }

      const categoriesToCreate = (categories || []).map(
        (category, categoryIndex) => {
          const itemsToCreate = (category.items || []).map(
            (item, itemIndexInCategory) => {
              const flatEntry = flatItems.find(
                (f) =>
                  f.categoryIndex === categoryIndex &&
                  f.itemIndexInCategory === itemIndexInCategory,
              );
              const globalIndex = flatEntry.globalIndex;

              const itemPhotoFiles = req.files
                .filter((f) => f.fieldname.startsWith(`photo_${globalIndex}_`))
                .sort((a, b) => {
                  const orderA = Number(a.fieldname.split("_")[2] || 0);
                  const orderB = Number(b.fieldname.split("_")[2] || 0);
                  return orderA - orderB;
                });

              const photosToCreate = itemPhotoFiles.map((f, i) => ({
                url: `/uploads/complaints/${f.filename}`,
                order: i,
              }));

              return {
                order: itemIndexInCategory,
                defectList: item.defectList,
                repairDate: item.repairDate ? new Date(item.repairDate) : null,
                status: !!item.status,
                repairDefectReport: item.repairDefectReport || null,
                photos: { create: photosToCreate },
              };
            },
          );

          return {
            name: category.name,
            order: categoryIndex,
            items: { create: itemsToCreate },
          };
        },
      );

      const newComplaint = await prisma.complaintReport.create({
        data: {
          projectId,
          categories: { create: categoriesToCreate },
        },
        include: {
          project: true,
          categories: {
            orderBy: { order: "asc" },
            include: {
              items: {
                orderBy: { order: "asc" },
                include: { photos: { orderBy: { order: "asc" } } },
              },
            },
          },
        },
      });

      res.status(201).json({
        message: "Laporan Complaint berhasil disimpan!",
        data: newComplaint,
      });
    } catch (error) {
      console.error("Error Create Complaint:", error);
      res.status(500).json({
        error:
          error.message || "Terjadi kesalahan server saat menyimpan complaint.",
      });
    }
  },
);

// ==========================================
// GET: LIHAT SEMUA COMPLAINT DI PROJECT TERTENTU
// ==========================================
router.get("/projects/:projectId/complaints", async (req, res) => {
  try {
    const { projectId } = req.params;
    const complaints = await prisma.complaintReport.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      include: {
        project: true,
        categories: {
          orderBy: { order: "asc" },
          include: {
            items: {
              orderBy: { order: "asc" },
              include: { photos: { orderBy: { order: "asc" } } },
            },
          },
        },
      },
    });

    const complaintsWithPeriode = await Promise.all(
      complaints.map(async (c) => ({
        ...c,
        periode: await computePeriode(c.project),
      })),
    );

    res.json(complaintsWithPeriode);
  } catch (error) {
    console.error("Error Get Complaints:", error);
    res.status(500).json({ error: "Gagal mengambil data complaint." });
  }
});

// ==========================================
// GET: DETAIL 1 COMPLAINT (buat edit form / view)
// ==========================================
router.get("/complaints/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const complaint = await prisma.complaintReport.findUnique({
      where: { id },
      include: {
        project: true,
        categories: {
          orderBy: { order: "asc" },
          include: {
            items: {
              orderBy: { order: "asc" },
              include: { photos: { orderBy: { order: "asc" } } },
            },
          },
        },
      },
    });
    if (!complaint)
      return res
        .status(404)
        .json({ error: "Laporan complaint tidak ditemukan." });

    const periode = await computePeriode(complaint.project);
    res.json({ ...complaint, periode });
  } catch (error) {
    console.error("Error Get Complaint Detail:", error);
    res.status(500).json({ error: "Gagal mengambil data complaint." });
  }
});

// ==========================================
// PUT: UPDATE COMPLAINT REPORT (replace categories lama)
// Frontend kirim tiap item existing dengan field `existingPhotoUrls`
// (array url foto lama yg TETAP dipertahankan). Foto baru tetap lewat
// field `photo_{itemGlobalIndex}_{photoIndex}`. Foto lama yg tidak
// dikirim ulang di existingPhotoUrls akan dihapus dari DB + disk.
// ==========================================
router.put("/complaints/:id", uploadComplaint.any(), async (req, res) => {
  try {
    const { id } = req.params;

    if (!req.body.complaintData) {
      return res
        .status(400)
        .json({ error: "Field complaintData (JSON) tidak ditemukan." });
    }

    const parsedData = JSON.parse(req.body.complaintData);
    const { timeScheduleId, categories } = parsedData;

    const existingComplaint = await prisma.complaintReport.findUnique({
      where: { id },
      include: {
        categories: { include: { items: { include: { photos: true } } } },
      },
    });
    if (!existingComplaint)
      return res
        .status(404)
        .json({ error: "Laporan complaint tidak ditemukan." });

    const flatItems = flattenItemsWithGlobalIndex(categories);

    // Validasi jumlah foto per item (foto lama yg dipertahankan + foto baru)
    for (const {
      item,
      globalIndex,
      categoryIndex,
      itemIndexInCategory,
    } of flatItems) {
      const newCount = req.files.filter((f) =>
        f.fieldname.startsWith(`photo_${globalIndex}_`),
      ).length;
      const keepCount = (item.existingPhotoUrls || []).length;
      if (newCount + keepCount > MAX_PHOTOS_PER_ITEM) {
        return res.status(400).json({
          error: `Kategori ke-${categoryIndex + 1} item ke-${
            itemIndexInCategory + 1
          } (${
            item.defectList || "-"
          }) punya ${newCount + keepCount} foto, maksimal ${MAX_PHOTOS_PER_ITEM} foto per item.`,
        });
      }
    }

    // Kumpulkan url foto lama yg TIDAK dipertahankan (buat dihapus dari disk)
    const urlsToDelete = [];
    for (const oldCategory of existingComplaint.categories) {
      for (const oldItem of oldCategory.items) {
        const matchingNewItem = flatItems.find(
          (f) => f.item.id && f.item.id === oldItem.id,
        );
        const keepUrls = matchingNewItem?.item.existingPhotoUrls || [];
        for (const oldPhoto of oldItem.photos) {
          if (!keepUrls.includes(oldPhoto.url)) {
            urlsToDelete.push(oldPhoto.url);
          }
        }
      }
    }

    const categoriesToCreate = (categories || []).map(
      (category, categoryIndex) => {
        const itemsToCreate = (category.items || []).map(
          (item, itemIndexInCategory) => {
            const flatEntry = flatItems.find(
              (f) =>
                f.categoryIndex === categoryIndex &&
                f.itemIndexInCategory === itemIndexInCategory,
            );
            const globalIndex = flatEntry.globalIndex;

            const newItemPhotoFiles = req.files
              .filter((f) => f.fieldname.startsWith(`photo_${globalIndex}_`))
              .sort((a, b) => {
                const orderA = Number(a.fieldname.split("_")[2] || 0);
                const orderB = Number(b.fieldname.split("_")[2] || 0);
                return orderA - orderB;
              })
              .map((f) => ({ url: `/uploads/complaints/${f.filename}` }));

            const keptPhotos = (item.existingPhotoUrls || []).map((url) => ({
              url,
            }));

            const photosToCreate = [...keptPhotos, ...newItemPhotoFiles].map(
              (p, i) => ({ url: p.url, order: i }),
            );

            return {
              order: itemIndexInCategory,
              defectList: item.defectList,
              repairDate: item.repairDate ? new Date(item.repairDate) : null,
              status: !!item.status,
              repairDefectReport: item.repairDefectReport || null,
              photos: { create: photosToCreate } || null,
            };
          },
        );

        return {
          name: category.name,
          order: categoryIndex,
          items: { create: itemsToCreate },
        };
      },
    );

    // Hapus semua kategori lama (cascade hapus items & photos di DB),
    // lalu buat ulang kategori baru — dalam 1 transaksi biar atomic.
    const updatedComplaint = await prisma.$transaction(async (tx) => {
      await tx.complaintCategory.deleteMany({
        where: { complaintReportId: id },
      });

      return tx.complaintReport.update({
        where: { id },
        data: {
          categories: { create: categoriesToCreate },
        },
        include: {
          project: true,
          categories: {
            orderBy: { order: "asc" },
            include: {
              items: {
                orderBy: { order: "asc" },
                include: { photos: { orderBy: { order: "asc" } } },
              },
            },
          },
        },
      });
    });

    // Hapus file fisik SETELAH transaksi DB sukses, biar gak orphan
    // kalau ternyata transaksinya gagal di tengah jalan.
    deletePhotoFiles(urlsToDelete);

    res.json({
      message: "Laporan Complaint berhasil diperbarui!",
      data: updatedComplaint,
    });
  } catch (error) {
    console.error("Error Update Complaint:", error);
    res.status(500).json({
      error:
        error.message || "Terjadi kesalahan server saat memperbarui complaint.",
    });
  }
});

// ==========================================
// DELETE: HAPUS COMPLAINT REPORT
// ==========================================
router.delete("/complaints/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const existingComplaint = await prisma.complaintReport.findUnique({
      where: { id },
      include: {
        categories: { include: { items: { include: { photos: true } } } },
      },
    });
    if (!existingComplaint)
      return res
        .status(404)
        .json({ error: "Laporan complaint tidak ditemukan." });

    const urlsToDelete = existingComplaint.categories.flatMap((category) =>
      category.items.flatMap((item) => item.photos.map((p) => p.url)),
    );

    // categories/items/photos ikut kehapus lewat cascade delete di schema Prisma
    await prisma.complaintReport.delete({ where: { id } });

    deletePhotoFiles(urlsToDelete);

    res.json({ message: "Laporan Complaint berhasil dihapus." });
  } catch (error) {
    console.error("Error Delete Complaint:", error);
    res.status(500).json({
      error:
        error.message || "Terjadi kesalahan server saat menghapus complaint.",
    });
  }
});

async function getComplaintForPdf(id) {
  const complaint = await prisma.complaintReport.findUnique({
    where: { id },
    include: {
      project: true,
      categories: {
        orderBy: { order: "asc" },
        include: {
          items: {
            orderBy: { order: "asc" },
            include: { photos: { orderBy: { order: "asc" } } },
          },
        },
      },
    },
  });
  if (!complaint) return null;
  complaint.periode = await computePeriode(complaint.project);
  return complaint;
}

router.get("/complaints/:id/pdf/view", async (req, res) => {
  try {
    const complaint = await getComplaintForPdf(req.params.id);
    if (!complaint)
      return res
        .status(404)
        .json({ error: "Laporan complaint tidak ditemukan." });

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="complaint-${req.params.id}.pdf"`,
    });
    streamComplaintPdf(complaint, res);
  } catch (error) {
    console.error("Error View Complaint PDF:", error);
    res.status(500).json({ error: "Gagal membuat PDF complaint." });
  }
});

router.get("/complaints/:id/pdf/download", async (req, res) => {
  try {
    const complaint = await getComplaintForPdf(req.params.id);
    if (!complaint)
      return res
        .status(404)
        .json({ error: "Laporan complaint tidak ditemukan." });

    const fileName =
      `Complaint-${complaint.project?.name || "Report"}.pdf`.replace(
        /\s+/g,
        "_",
      );

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    });
    streamComplaintPdf(complaint, res);
  } catch (error) {
    console.error("Error Download Complaint PDF:", error);
    res.status(500).json({ error: "Gagal membuat PDF complaint." });
  }
});

module.exports = router;
