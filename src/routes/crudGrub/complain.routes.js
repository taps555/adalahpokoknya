"use strict";
const express = require("express");
const router = express.Router();
const prisma = require("../../lib/prisma");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { streamComplaintPdf } = require("../exportToFile/complainView.routes");

const MAX_PHOTOS_PER_TYPE = 20;

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

      // Validasi jumlah foto before & after per item
      // Validasi jumlah foto before & after per item
      for (const {
        item,
        globalIndex,
        categoryIndex,
        itemIndexInCategory,
      } of flatItems) {
        const countBefore = req.files.filter((f) =>
          f.fieldname.startsWith(`photoBefore_${globalIndex}_`),
        ).length;
        const countAfter = req.files.filter((f) =>
          f.fieldname.startsWith(`photoAfter_${globalIndex}_`),
        ).length;

        if (
          countBefore > MAX_PHOTOS_PER_TYPE ||
          countAfter > MAX_PHOTOS_PER_TYPE
        ) {
          return res.status(400).json({
            error: `Kategori ke-${categoryIndex + 1} item ke-${
              itemIndexInCategory + 1
            } (${item.defectList || "-"}) melebihi batas maksimal ${MAX_PHOTOS_PER_TYPE} foto per tipe (before/after).`,
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

              // 1. Proses Foto Before
              const itemPhotoBeforeFiles = req.files
                .filter((f) =>
                  f.fieldname.startsWith(`photoBefore_${globalIndex}_`),
                )
                .sort(
                  (a, b) =>
                    Number(a.fieldname.split("_")[2] || 0) -
                    Number(b.fieldname.split("_")[2] || 0),
                )
                .map((f) => ({
                  url: `/uploads/complaints/${f.filename}`,
                  type: "BEFORE",
                }));

              // 2. Proses Foto After
              const itemPhotoAfterFiles = req.files
                .filter((f) =>
                  f.fieldname.startsWith(`photoAfter_${globalIndex}_`),
                )
                .sort(
                  (a, b) =>
                    Number(a.fieldname.split("_")[2] || 0) -
                    Number(b.fieldname.split("_")[2] || 0),
                )
                .map((f) => ({
                  url: `/uploads/complaints/${f.filename}`,
                  type: "AFTER",
                }));

              // Gabungkan dan berikan urutan (order)
              const photosToCreate = [
                ...itemPhotoBeforeFiles,
                ...itemPhotoAfterFiles,
              ].map((p, i) => ({ url: p.url, type: p.type, order: i }));

              return {
                order: itemIndexInCategory,
                defectList: item.defectList,
                repairDate: item.repairDate ? new Date(item.repairDate) : null,
                status: !!item.status, // Boolean
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
// GET: DETAIL 1 COMPLAINT
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
// PUT: UPDATE COMPLAINT REPORT
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
    const { categories } = parsedData;

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

    // Validasi jumlah foto before & after per item
    // Validasi jumlah foto before & after per item
    // Validasi jumlah foto before & after per item
    // Validasi jumlah foto before & after per item
    for (const {
      item,
      globalIndex,
      categoryIndex,
      itemIndexInCategory,
    } of flatItems) {
      const newCountBefore = req.files.filter((f) =>
        f.fieldname.startsWith(`photoBefore_${globalIndex}_`),
      ).length;
      const keepCountBefore = (item.existingPhotoBeforeUrls || []).length;

      const newCountAfter = req.files.filter((f) =>
        f.fieldname.startsWith(`photoAfter_${globalIndex}_`),
      ).length;
      const keepCountAfter = (item.existingPhotoAfterUrls || []).length;

      if (
        newCountBefore + keepCountBefore > MAX_PHOTOS_PER_TYPE ||
        newCountAfter + keepCountAfter > MAX_PHOTOS_PER_TYPE
      ) {
        return res.status(400).json({
          error: `Kategori ke-${categoryIndex + 1} item ke-${itemIndexInCategory + 1} (${
            item.defectList || "-"
          }) melebihi batas maksimal ${MAX_PHOTOS_PER_TYPE} foto per tipe (before/after).`,
        });
      }
    }

    // Kumpulkan foto yang tidak dikirim lagi (untuk dihapus dari disk)
    const urlsToDelete = [];
    for (const oldCategory of existingComplaint.categories) {
      for (const oldItem of oldCategory.items) {
        const matchingNewItem = flatItems.find(
          (f) => f.item.id && f.item.id === oldItem.id,
        );
        const keepUrlsBefore =
          matchingNewItem?.item.existingPhotoBeforeUrls || [];
        const keepUrlsAfter =
          matchingNewItem?.item.existingPhotoAfterUrls || [];

        // Gabungkan semua URL yang ingin dipertahankan untuk dicek
        const allKeepUrls = [...keepUrlsBefore, ...keepUrlsAfter];

        for (const oldPhoto of oldItem.photos) {
          if (!allKeepUrls.includes(oldPhoto.url)) {
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

            // 1. Proses Foto Before (File baru & yang dipertahankan)
            const newItemPhotoBeforeFiles = req.files
              .filter((f) =>
                f.fieldname.startsWith(`photoBefore_${globalIndex}_`),
              )
              .sort(
                (a, b) =>
                  Number(a.fieldname.split("_")[2] || 0) -
                  Number(b.fieldname.split("_")[2] || 0),
              )
              .map((f) => ({
                url: `/uploads/complaints/${f.filename}`,
                type: "BEFORE",
              }));

            const keptPhotosBefore = (item.existingPhotoBeforeUrls || []).map(
              (url) => ({
                url,
                type: "BEFORE",
              }),
            );

            // 2. Proses Foto After (File baru & yang dipertahankan)
            const newItemPhotoAfterFiles = req.files
              .filter((f) =>
                f.fieldname.startsWith(`photoAfter_${globalIndex}_`),
              )
              .sort(
                (a, b) =>
                  Number(a.fieldname.split("_")[2] || 0) -
                  Number(b.fieldname.split("_")[2] || 0),
              )
              .map((f) => ({
                url: `/uploads/complaints/${f.filename}`,
                type: "AFTER",
              }));

            const keptPhotosAfter = (item.existingPhotoAfterUrls || []).map(
              (url) => ({
                url,
                type: "AFTER",
              }),
            );

            // Gabungkan semua foto dan setel order
            const photosToCreate = [
              ...keptPhotosBefore,
              ...newItemPhotoBeforeFiles,
              ...keptPhotosAfter,
              ...newItemPhotoAfterFiles,
            ].map((p, i) => ({ url: p.url, type: p.type, order: i }));

            return {
              order: itemIndexInCategory,
              defectList: item.defectList,
              repairDate: item.repairDate ? new Date(item.repairDate) : null,
              status: !!item.status, // Boolean
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

// ==========================================
// FUNGSI PDF (GET & STREAM)
// ==========================================
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
