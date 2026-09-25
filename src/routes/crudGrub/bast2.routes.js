"use strict";
const express = require("express");
const router = express.Router();
const prisma = require("../../lib/prisma");
const { streamBast2Pdf } = require("../exportToFile/bast2.routes");

// Helper function from complain.routes.js to get ComplaintReport for PDF
async function getComplaintForPdf(id) {
  if (!id) return null;
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
  return complaint;
}

// ==========================================
// GET: LIHAT SEMUA BAST 2 DI PROJECT TERTENTU
// ==========================================
router.get("/projects/:projectId/bast2", async (req, res) => {
  try {
    const { projectId } = req.params;
    const basts = await prisma.bast2.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      include: { project: true, complaintReport: true },
    });
    res.json(basts);
  } catch (error) {
    console.error("Error Get BAST 2 List:", error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// POST: CREATE BAST 2
// ==========================================
router.post("/projects/:projectId/bast2", async (req, res) => {
  try {
    const { projectId } = req.params;
    const { 
      complaintReportId, 
      bastNumber, 
      spkNumber, 
      handoverDate, 
      pihakPertamaName, 
      pihakKeduaName, 
      statusText 
    } = req.body;

    const project = await prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) return res.status(404).json({ error: "Project tidak ditemukan." });

    const newBast = await prisma.bast2.create({
      data: {
        projectId,
        complaintReportId,
        bastNumber: bastNumber || "-",
        spkNumber: spkNumber || "-",
        handoverDate: handoverDate ? new Date(handoverDate) : new Date(),
        pihakPertamaName: pihakPertamaName || "-",
        pihakKeduaName: pihakKeduaName || "-",
        statusText: statusText || "-",
      },
    });

    res.status(201).json({
      message: "BAST 2 berhasil disimpan!",
      data: newBast,
    });
  } catch (error) {
    console.error("Error Create BAST 2:", error);
    res.status(500).json({ error: "Terjadi kesalahan server saat menyimpan BAST 2." });
  }
});

// ==========================================
// DELETE: HAPUS BAST 2
// ==========================================
router.delete("/bast2/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.bast2.delete({ where: { id } });
    res.json({ message: "BAST 2 berhasil dihapus." });
  } catch (error) {
    console.error("Error Delete BAST 2:", error);
    res.status(500).json({ error: "Terjadi kesalahan server saat menghapus BAST 2." });
  }
});

// ==========================================
// GET: VIEW BAST 2 PDF
// ==========================================
router.get("/bast2/:id/pdf", async (req, res) => {
  try {
    const bast2 = await prisma.bast2.findUnique({
      where: { id: req.params.id },
      include: { project: true }
    });
    if (!bast2) return res.status(404).json({ error: "BAST 2 tidak ditemukan." });

    const complaint = bast2.complaintReportId 
      ? await getComplaintForPdf(bast2.complaintReportId) 
      : { project: bast2.project, categories: [] }; // Fallback jika complaint dihapus

    const formData = {
      bastNumber: bast2.bastNumber,
      spkNumber: bast2.spkNumber,
      handoverDate: bast2.handoverDate,
      pihakPertamaName: bast2.pihakPertamaName,
      pihakKeduaName: bast2.pihakKeduaName,
      statusText: bast2.statusText,
    };

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="bast2-${req.params.id}.pdf"`,
    });
    
    streamBast2Pdf(complaint, formData, res);
  } catch (error) {
    console.error("Error Generate BAST 2 PDF:", error);
    res.status(500).json({ error: "Gagal membuat PDF BAST 2." });
  }
});

module.exports = router;
