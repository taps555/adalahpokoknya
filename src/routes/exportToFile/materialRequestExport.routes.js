"use strict";

const express = require("express");
const PDFDocument = require("pdfkit");
const prisma = require("../../lib/prisma");

const router = express.Router();

const BORDER = "#000000";
const HEADER_BG = "#e0e0e0";
const MARGIN = 30;

const COLS = [
  { key: "no", title: "NO", width: 30, align: "center" },
  { key: "name", title: "KETERANGAN BARANG", width: 150, align: "left" },
  { key: "vol", title: "VOL", width: 45, align: "right" },
  { key: "unit", title: "SAT", width: 40, align: "center" },
  { key: "status", title: "STATUS", width: 60, align: "center" },
  { key: "job", title: "PEKERJAAN", width: 120, align: "left" },
  { key: "note", title: "KETERANGAN", width: 100, align: "left" },
  { key: "schedule", title: "SCHEDULE", width: 95, align: "center" },
  { key: "update", title: "UPDATE", width: 60, align: "center" },
  { key: "ahsp", title: "HARGA SAT (AHSP)", width: 80, align: "right" },
  { key: "supplier", title: "HARGA SAT (SUP)", width: 80, align: "right" },
  { key: "total", title: "TOTAL", width: 90, align: "right" },
];

function fmtMoney(n) {
  if (n == null || Number.isNaN(n)) return "-";
  return Number(n).toLocaleString("id-ID", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function fmtVol(n) {
  if (n == null || Number.isNaN(n)) return "-";
  return Number(n).toLocaleString("id-ID", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

function deriveStatus(item) {
  const est = Number(item.estimatedVolume || 0);
  const rec = Number(item.receivedVolume || 0);
  if (item.isCompleted || rec >= est) return "COMPLETED";
  if (rec > 0) return "PARTIAL";
  return "PENDING";
}

function deriveUpdate(item) {
  const status = deriveStatus(item);
  if (status === "COMPLETED") return "ON SITE";
  if (status === "PARTIAL") return "PARTIAL";
  return "WAITING LIST";
}

function buildColumns(doc) {
  const contentW = doc.page.width - MARGIN * 2;
  let w = 0;
  const cols = COLS.map((c) => {
    const col = { ...c, x: MARGIN + w };
    w += c.width;
    return col;
  });
  const scale = contentW / w;
  return cols.map((c) => ({
    ...c,
    x: MARGIN + (c.x - MARGIN) * scale,
    width: c.width * scale,
  }));
}

function drawHeader(doc, project, y, contentW) {
  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .text("PT. DIVES JAYA PERKASA", MARGIN, y, { align: "left" });
  doc
    .font("Helvetica")
    .fontSize(8)
    .text("Jl. Bulak Rukem Timur I No. 160 Surabaya", MARGIN, y + 12);
  doc.fontSize(8).text("0818-813-134", MARGIN, y + 22);

  doc
    .font("Helvetica-Bold")
    .fontSize(14)
    .text("DAFTAR KEBUTUHAN MATERIAL", MARGIN, y, {
      align: "right",
      width: contentW,
    });

  y += 45;
  doc.moveTo(MARGIN, y).lineTo(MARGIN + contentW, y).lineWidth(1).stroke();

  y += 8;
  doc.font("Helvetica-Bold").fontSize(9);
  doc.text("NAMA PROYEK", MARGIN, y);
  doc.text(`: ${project.name || "-"}`, MARGIN + 80, y);

  doc.text("LOKASI", MARGIN + contentW / 2, y);
  doc.text(`: ${project.location || "-"}`, MARGIN + contentW / 2 + 60, y);

  y += 14;
  doc.text("KLIEN", MARGIN, y);
  doc.text(`: ${project.client?.name || "-"}`, MARGIN + 80, y);

  doc.text("DISIPLIN", MARGIN + contentW / 2, y);
  doc.text(`: ${project.discipline || "-"}`, MARGIN + contentW / 2 + 60, y);

  return y + 22;
}

function drawTableHeader(doc, cols, y) {
  const rowH = 28;
  doc
    .rect(cols[0].x, y, cols[cols.length - 1].x + cols[cols.length - 1].width - cols[0].x, rowH)
    .fill(HEADER_BG)
    .stroke(BORDER);

  doc.fillColor("black").font("Helvetica-Bold").fontSize(7);
  for (const col of cols) {
    doc.text(col.title, col.x + 2, y + 2, {
      width: col.width - 4,
      height: rowH - 4,
      align: col.align === "right" ? "right" : col.align,
    });
  }
  return rowH;
}

function drawRow(doc, cols, y, rowH, item, idx) {
  doc
    .rect(cols[0].x, y, cols[cols.length - 1].x + cols[cols.length - 1].width - cols[0].x, rowH)
    .stroke(BORDER);

  for (let i = 0; i < cols.length; i++) {
    const col = cols[i];
    doc
      .moveTo(col.x, y)
      .lineTo(col.x, y + rowH)
      .lineWidth(0.5)
      .stroke(BORDER);
  }

  const values = {
    no: String(idx + 1),
    name: item.itemName || "-",
    vol: fmtVol(item.estimatedVolume),
    unit: item.unit || "-",
    status: deriveStatus(item),
    job: item.groupName || "-",
    note: item.catatanPerencana || "",
    schedule: item.scheduleRange || "-",
    update: deriveUpdate(item),
    ahsp: fmtMoney(item.pricePerUnit),
    supplier: fmtMoney(item.supplierPrice),
    total: fmtMoney(item.totalPrice),
  };

  doc.font("Helvetica").fontSize(7).fillColor("black");
  for (const col of cols) {
    const text = values[col.key];
    const opts = {
      width: col.width - 4,
      height: rowH - 4,
      align: col.align,
    };
    // Multi-line wrapping for text columns
    if (col.align === "left") {
      opts.lineBreak = true;
      doc.text(text, col.x + 2, y + 2, opts);
    } else {
      doc.text(text, col.x + 2, y + 2, opts);
    }
  }
}

function groupByDiscipline(items) {
  const groups = {};
  for (const item of items) {
    const d = item.discipline || "LAINNYA";
    if (!groups[d]) groups[d] = [];
    groups[d].push(item);
  }
  return groups;
}

function fetchSupplierPrices(items) {
  return Promise.all(
    items.map(async (item) => {
      const mapping = await prisma.ahspItemMapping.findUnique({
        where: { itemName: (item.itemName || "").trim().toLowerCase() },
        include: { supplierItem: true },
      });
      return {
        ...item,
        supplierPrice: mapping ? Number(mapping.supplierItem.currentPrice) : null,
      };
    }),
  );
}

router.get("/projects/:projectId/material-requests/export-pdf", async (req, res) => {
  try {
    const { projectId } = req.params;
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { client: true },
    });
    if (!project) return res.status(404).json({ error: "Project tidak ditemukan." });

    const request = await prisma.materialRequest.findFirst({
      where: { projectId },
      include: { items: true },
    });
    const items = request?.items || [];
    if (items.length === 0) {
      return res.status(404).json({ error: "Belum ada data kebutuhan material." });
    }

    const itemsWithPrice = await fetchSupplierPrices(items);
    const grouped = groupByDiscipline(itemsWithPrice);

    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: MARGIN });
    doc.pipe(res);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="Kebutuhan_Material_${project.name.replace(/\s+/g, "_")}.pdf"`,
    );

    const cols = buildColumns(doc);
    const contentW = doc.page.width - MARGIN * 2;

    let y = drawHeader(doc, project, MARGIN, contentW);
    let headerY = y;

    for (const discipline of Object.keys(grouped).sort()) {
      const groupItems = grouped[discipline];

      // Group header (discipline)
      if (y + 20 > doc.page.height - MARGIN - 30) {
        doc.addPage();
        y = MARGIN;
        headerY = y;
        y = drawHeader(doc, project, MARGIN, contentW);
      }

      doc
        .font("Helvetica-Bold")
        .fontSize(9)
        .text(discipline, MARGIN, y);
      y += 16;

      // Table header
      if (y + 28 > doc.page.height - MARGIN - 30) {
        doc.addPage();
        y = MARGIN;
        headerY = y;
        y = drawHeader(doc, project, MARGIN, contentW);
      }
      const headerH = drawTableHeader(doc, cols, y);
      y += headerH;

      let groupTotal = 0;
      for (let i = 0; i < groupItems.length; i++) {
        const item = groupItems[i];
        groupTotal += Number(item.totalPrice || 0);

        const rowH = 22;
        if (y + rowH > doc.page.height - MARGIN - 30) {
          doc.addPage();
          y = MARGIN;
          headerY = y;
          y = drawHeader(doc, project, MARGIN, contentW);
          const h = drawTableHeader(doc, cols, y);
          y += h;
        }

        drawRow(doc, cols, y, rowH, item, i);
        y += rowH;
      }

      // Subtotal row
      const subH = 20;
      if (y + subH > doc.page.height - MARGIN - 30) {
        doc.addPage();
        y = MARGIN;
        headerY = y;
        y = drawHeader(doc, project, MARGIN, contentW);
      }
      doc
        .rect(cols[0].x, y, cols[cols.length - 1].x + cols[cols.length - 1].width - cols[0].x, subH)
        .fill("#f5f5f5")
        .stroke(BORDER);
      doc.fillColor("black").font("Helvetica-Bold").fontSize(8);
      doc.text(`SUBTOTAL ${discipline}`, cols[0].x + 2, y + 4, { width: cols[9].x - cols[0].x - 4 });
      doc.text(fmtMoney(groupTotal), cols[11].x + 2, y + 4, {
        width: cols[11].width - 4,
        align: "right",
      });
      y += subH + 10;
    }

    doc.end();
  } catch (err) {
    console.error("Error Export Material Request PDF:", err);
    res.status(500).json({ error: err.message || "Gagal export PDF." });
  }
});

module.exports = router;
