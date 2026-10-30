"use strict";

const express = require("express");
const router = express.Router();
const prisma = require("../../lib/prisma");
const { verifyToken } = require("../../middleware/auth");
const { createTransaksiBukuBesar } = require("./glBank.routes.js");
const PDFDocument = require("pdfkit");

const CREATOR_ROLES = ["OWNER", "FINANCE", "ADMIN"];
const FINANCE_VERIFY_ROLES = ["OWNER", "FINANCE"];
const FINAL_APPROVE_ROLES = ["OWNER", "FINANCE", "ADMIN"];

function getUserId(req) {
  return req.user?.userId || req.user?.id || null;
}

function getUserName(req) {
  return req.user?.name || req.user?.username || req.user?.userId || req.user?.id || "SYSTEM";
}

function hasRole(req, allowed) {
  return Boolean(req.user?.role && allowed.includes(req.user.role));
}

function denyRole(res, allowed) {
  return res.status(403).json({
    error: `Akses ditolak. Hanya role ${allowed.join(", ")} yang diizinkan.`,
  });
}

function num(v, fallback = 0) {
  if (v === null || v === undefined || v === "") return Number(fallback || 0);
  const n = Number(v);
  return Number.isFinite(n) ? n : Number(fallback || 0);
}

function parseDate(v, fallback = new Date()) {
  if (!v) return fallback;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

function derivePayment(jumlahTagihan, jumlahDibayar) {
  const tagihan = Math.max(0, num(jumlahTagihan));
  const dibayar = Math.max(0, num(jumlahDibayar));
  const sisaTagihan = Math.max(0, tagihan - dibayar);
  let statusBayar = "UNPAID";
  if (dibayar >= tagihan && tagihan > 0) statusBayar = "PAID";
  else if (dibayar > 0) statusBayar = "PARTIAL";
  return { jumlahTagihan: tagihan, jumlahDibayar: dibayar, sisaTagihan, statusBayar };
}

function normalizeApprovalStatus(row) {
  if (row?.approvalStatus) return row.approvalStatus;
  if (row?.approvedAt || row?.approvedById) return "APPROVED";
  if (row?.verifiedAt || row?.verifiedById) return "APPROVED_FINANCE";
  return "PENDING";
}

function buildRejectNote(keteranganLama, reason) {
  if (!reason) return keteranganLama || null;
  const stamp = `[REJECT ${new Date().toISOString()}] ${String(reason).trim()}`;
  if (!keteranganLama) return stamp;
  if (String(keteranganLama).includes(stamp)) return keteranganLama;
  return `${keteranganLama}\n${stamp}`;
}

function calcDesignQuotationTotal(quotation) {
  if (!quotation) return 0;
  const part3d = Math.round(num(quotation.item3dVolume) * num(quotation.item3dPrice));
  const part2d = Math.round(num(quotation.item2dVolume) * num(quotation.item2dPrice));
  const discount = Math.round(num(quotation.discount));
  return Math.max(0, part3d + part2d - discount);
}

function getYearBounds(dateInput) {
  const base = parseDate(dateInput);
  const year = base.getFullYear();
  const month = String(base.getMonth() + 1).padStart(2, "0");
  const start = new Date(year, 0, 1, 0, 0, 0, 0);
  const end = new Date(year + 1, 0, 1, 0, 0, 0, 0);
  return { base, year, month, start, end };
}

const MODULE_TO_MODEL = {
  DESAIN: "invoicePenjualanDesain",
  KLIEN: "invoicePenjualanKlien",
  OPERASIONAL: "invoiceOperasional",
};

async function buildNoInvoice(moduleType, tanggal) {
  const moduleKey = String(moduleType || "").toUpperCase();
  const modelName = MODULE_TO_MODEL[moduleKey];
  if (!modelName) throw new Error("Tipe module invoice tidak valid.");

  const { year, month, start, end } = getYearBounds(tanggal);
  const model = prisma[modelName];

  const yearlyCount = await model.count({
    where: {
      tanggal: {
        gte: start,
        lt: end,
      },
    },
  });

  let seq = Math.max(1, yearlyCount + 1);
  for (let i = 0; i < 2000; i += 1) {
    const candidate = `PBY/${month}/${year}/${String(seq).padStart(3, "0")}`;
    const exists = await model.findFirst({ where: { noInvoice: candidate }, select: { id: true } });
    if (!exists) return candidate;
    seq += 1;
  }

  throw new Error("Gagal membuat nomor invoice otomatis. Coba ulangi.");
}

function fmtDateId(dateInput) {
  const d = parseDate(dateInput);
  return d.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function fmtRp(v) {
  return `Rp ${Number(v || 0).toLocaleString("id-ID", { maximumFractionDigits: 0 })}`;
}

function streamInvoicePdf(res, {
  filename,
  title,
  subtitle,
  noInvoice,
  tanggal,
  projectName,
  pihakName,
  statusApproval,
  statusBayar,
  rekeningLabel,
  tipeRekeningLabel,
  jumlahTagihan,
  jumlahDibayar,
  sisaTagihan,
  keterangan,
}) {
  const safeName = String(filename || "invoice").replace(/[^a-zA-Z0-9-_]/g, "_");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${safeName}.pdf"`);

  const doc = new PDFDocument({ size: "A4", margin: 40 });
  doc.pipe(res);

  doc.save();
  doc.rect(0, 0, doc.page.width, 115).fill("#111827");
  doc.fillColor("#FBBF24").fontSize(11).text("PENAGIHAN INVOICE", 40, 28);
  doc.fillColor("#FFFFFF").fontSize(24).font("Helvetica-Bold").text(title || "INVOICE", 40, 44);
  doc.fontSize(12).font("Helvetica").fillColor("#D1D5DB").text(subtitle || "", 40, 78);
  doc.restore();

  doc.fillColor("#111827").font("Helvetica-Bold").fontSize(12).text("Informasi Invoice", 40, 132);

  const leftX = 40;
  const rightX = 310;
  let y = 156;
  const rowH = 20;

  const drawLabelValue = (x, yPos, label, value) => {
    doc.font("Helvetica").fontSize(10).fillColor("#6B7280").text(label, x, yPos, { width: 120 });
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#111827").text(value || "-", x + 122, yPos, { width: 170 });
  };

  drawLabelValue(leftX, y, "No Invoice", noInvoice);
  drawLabelValue(rightX, y, "Tanggal", fmtDateId(tanggal));
  y += rowH;
  drawLabelValue(leftX, y, "Project", projectName || "-");
  drawLabelValue(rightX, y, "Pihak", pihakName || "-");
  y += rowH;
  drawLabelValue(leftX, y, "Status Approval", statusApproval || "-");
  drawLabelValue(rightX, y, "Status Bayar", statusBayar || "-");
  y += rowH;
  drawLabelValue(leftX, y, "Rekening", rekeningLabel || "-");
  drawLabelValue(rightX, y, "Tipe Rekening", tipeRekeningLabel || "-");

  const boxY = y + 36;
  doc.roundedRect(40, boxY, 515, 120, 10).fillAndStroke("#FFFBEB", "#E5E7EB");
  doc.fillColor("#111827").font("Helvetica-Bold").fontSize(11).text("Ringkasan Nominal", 56, boxY + 16);

  const moneyLine = (label, value, yPos, emphasize = false) => {
    doc.font("Helvetica").fontSize(10).fillColor("#6B7280").text(label, 56, yPos);
    doc.font(emphasize ? "Helvetica-Bold" : "Helvetica").fontSize(emphasize ? 13 : 11).fillColor("#111827").text(fmtRp(value), 360, yPos - (emphasize ? 2 : 0), { width: 180, align: "right" });
  };

  moneyLine("Jumlah Tagihan", jumlahTagihan, boxY + 42);
  moneyLine("Jumlah Dibayar", jumlahDibayar, boxY + 66);
  moneyLine("Sisa", sisaTagihan, boxY + 90, true);

  const ketY = boxY + 140;
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#111827").text("Keterangan", 40, ketY);
  doc.roundedRect(40, ketY + 18, 515, 78, 8).stroke("#E5E7EB");
  doc.font("Helvetica").fontSize(10).fillColor("#374151").text(keterangan || "-", 50, ketY + 28, { width: 495, lineGap: 2 });

  doc.font("Helvetica").fontSize(9).fillColor("#9CA3AF").text("Dokumen ini dihasilkan otomatis dari sistem dan valid untuk kebutuhan penagihan.", 40, 760, { align: "center", width: 515 });

  doc.end();
}

async function resolveRekeningInfo(rekeningBankId) {
  if (!rekeningBankId) return { rekening: null, namaAkun: null };
  const rekening = await prisma.masterRekeningBank.findUnique({
    where: { id: rekeningBankId },
    select: { id: true, namaRekening: true, nomorRekening: true, tipeRekeningId: true },
  });
  if (!rekening) return { rekening: null, namaAkun: null };
  return {
    rekening,
    namaAkun: `${rekening.namaRekening} - ${rekening.nomorRekening}`,
  };
}

async function postToGl({
  req,
  tanggal,
  tipeAkun,
  rekeningBankId,
  tipeRekeningId,
  jenis,
  nominal,
  noReferensi,
  pihak,
  keterangan,
  projectId,
}) {
  const resolvedNominal = num(nominal);
  if (resolvedNominal <= 0) {
    throw new Error("Nominal posting harus lebih dari 0.");
  }

  const rekeningInfo = await resolveRekeningInfo(rekeningBankId);
  const namaAkun =
    rekeningInfo.namaAkun ||
    (String(tipeAkun || "").toUpperCase() === "BANK" ? "Bank" : "Kas");

  let validCreatedById = null;
  const userId = getUserId(req);
  if (userId) {
    const user = await prisma.user
      .findUnique({ where: { id: userId }, select: { id: true } })
      .catch(() => null);
    if (user) validCreatedById = user.id;
  }

  return createTransaksiBukuBesar({
    tanggal: parseDate(tanggal),
    tipeAkun: String(tipeAkun || "").toUpperCase() === "BANK" || rekeningInfo.rekening ? "BANK" : "KAS",
    namaAkun,
    jenis,
    nominal: resolvedNominal,
    noReferensi,
    pihak,
    keterangan,
    tipeRekeningId: tipeRekeningId || rekeningInfo.rekening?.tipeRekeningId || null,
    projectId: projectId || null,
    rekeningBankId: rekeningInfo.rekening?.id || null,
    sumberTransaksi: "SISTEM",
    createdById: validCreatedById,
  });
}

const includeDesain = {
  project: { select: { id: true, name: true, client: { select: { id: true, name: true } } } },
  designQuotation: true,
  rekeningBank: { select: { id: true, namaRekening: true, nomorRekening: true, namaBank: true, tipeRekeningId: true } },
  tipeRekening: { select: { id: true, namaTipe: true } },
  createdBy: { select: { id: true, name: true, role: true } },
  verifiedBy: { select: { id: true, name: true, role: true } },
  approvedBy: { select: { id: true, name: true, role: true } },
  postedBy: { select: { id: true, name: true, role: true } },
  glTransaksi: true,
};

const includeKlien = {
  project: { select: { id: true, name: true, client: { select: { id: true, name: true } } } },
  client: true,
  spkContract: { include: { terms: { orderBy: { order: "asc" } } } },
  spkTerm: true,
  rekeningBank: { select: { id: true, namaRekening: true, nomorRekening: true, namaBank: true, tipeRekeningId: true } },
  tipeRekening: { select: { id: true, namaTipe: true } },
  createdBy: { select: { id: true, name: true, role: true } },
  verifiedBy: { select: { id: true, name: true, role: true } },
  approvedBy: { select: { id: true, name: true, role: true } },
  postedBy: { select: { id: true, name: true, role: true } },
  glTransaksi: true,
};

const includeOperasional = {
  project: { select: { id: true, name: true, client: { select: { id: true, name: true } } } },
  rekeningBank: { select: { id: true, namaRekening: true, nomorRekening: true, namaBank: true, tipeRekeningId: true } },
  tipeRekening: { select: { id: true, namaTipe: true } },
  createdBy: { select: { id: true, name: true, role: true } },
  verifiedBy: { select: { id: true, name: true, role: true } },
  approvedBy: { select: { id: true, name: true, role: true } },
  postedBy: { select: { id: true, name: true, role: true } },
  glTransaksi: true,
};

router.use(verifyToken);

// ============================================================
// LOOKUP
// ============================================================
router.get("/invoice-penjualan/lookup/projects", async (req, res) => {
  try {
    const projects = await prisma.project.findMany({
      select: { id: true, name: true, clientId: true, client: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json(projects);
  } catch (error) {
    console.error("Lookup projects invoice penjualan error:", error);
    res.status(500).json({ error: "Gagal mengambil daftar proyek." });
  }
});

router.get("/invoice-penjualan/lookup/design-quotations", async (req, res) => {
  try {
    const { projectId } = req.query;
    if (!projectId) return res.status(400).json({ error: "projectId wajib diisi." });

    const rows = await prisma.designQuotation.findMany({
      where: { projectId: String(projectId) },
      orderBy: { quotationDate: "desc" },
      include: {
        project: { select: { id: true, name: true, client: { select: { id: true, name: true } } } },
      },
    });

    const mapped = rows.map((row) => ({
      ...row,
      totalQuotation: calcDesignQuotationTotal(row),
    }));

    res.json(mapped);
  } catch (error) {
    console.error("Lookup design quotation error:", error);
    res.status(500).json({ error: "Gagal mengambil data quotation desain." });
  }
});

router.get("/invoice-penjualan/lookup/spk-contracts", async (req, res) => {
  try {
    const { projectId } = req.query;
    if (!projectId) return res.status(400).json({ error: "projectId wajib diisi." });

    const contracts = await prisma.spkContract.findMany({
      where: { projectId: String(projectId), type: "CLIENT" },
      include: {
        project: { select: { id: true, name: true, client: { select: { id: true, name: true } } } },
        terms: { orderBy: { order: "asc" } },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(
      contracts.map((contract) => ({
        ...contract,
        contractValue: num(contract.contractValue),
        retentionPercent: num(contract.retentionPercent),
        retentionAmount: num(contract.retentionAmount),
        terms: (contract.terms || []).map((term) => ({
          ...term,
          amount: num(term.amount),
          percent: num(term.percent),
        })),
      }))
    );
  } catch (error) {
    console.error("Lookup SPK contract error:", error);
    res.status(500).json({ error: "Gagal mengambil data SPK klien." });
  }
});

router.get("/invoice-penjualan/lookup/next-no-invoice", async (req, res) => {
  try {
    const moduleType = String(req.query.type || "").toUpperCase();
    if (!["DESAIN", "KLIEN", "OPERASIONAL"].includes(moduleType)) {
      return res.status(400).json({ error: "type wajib salah satu: DESAIN, KLIEN, OPERASIONAL." });
    }
    const tanggal = req.query.tanggal ? parseDate(req.query.tanggal) : new Date();
    const noInvoice = await buildNoInvoice(moduleType, tanggal);
    return res.json({ type: moduleType, noInvoice, tanggal });
  } catch (error) {
    console.error("Lookup nomor invoice otomatis error:", error);
    return res.status(500).json({ error: "Gagal generate nomor invoice otomatis." });
  }
});

// ============================================================
// INVOICE PENJUALAN DESAIN
// ============================================================
router.get("/invoice-penjualan/desain", async (req, res) => {
  try {
    const { projectId } = req.query;
    const rows = await prisma.invoicePenjualanDesain.findMany({
      where: projectId ? { projectId: String(projectId) } : undefined,
      include: includeDesain,
      orderBy: { createdAt: "desc" },
    });

    res.json(rows.map((r) => ({ ...r, approvalStatus: normalizeApprovalStatus(r) })));
  } catch (error) {
    console.error("List invoice penjualan desain error:", error);
    res.status(500).json({ error: "Gagal mengambil invoice penjualan desain." });
  }
});

router.get("/invoice-penjualan/desain/:id", async (req, res) => {
  try {
    const row = await prisma.invoicePenjualanDesain.findUnique({
      where: { id: req.params.id },
      include: includeDesain,
    });
    if (!row) return res.status(404).json({ error: "Invoice penjualan desain tidak ditemukan." });
    res.json({ ...row, approvalStatus: normalizeApprovalStatus(row) });
  } catch (error) {
    console.error("Detail invoice penjualan desain error:", error);
    res.status(500).json({ error: "Gagal mengambil detail invoice penjualan desain." });
  }
});

router.get("/invoice-penjualan/desain/:id/print-pdf", async (req, res) => {
  try {
    const row = await prisma.invoicePenjualanDesain.findUnique({
      where: { id: req.params.id },
      include: includeDesain,
    });
    if (!row) return res.status(404).json({ error: "Invoice penjualan desain tidak ditemukan." });

    return streamInvoicePdf(res, {
      filename: `invoice-desain-${row.noInvoice}`,
      title: "INVOICE PENJUALAN DESAIN",
      subtitle: row.project?.name || "Project",
      noInvoice: row.noInvoice,
      tanggal: row.tanggal,
      projectName: row.project?.name,
      pihakName: row.project?.client?.name || "Klien",
      statusApproval: normalizeApprovalStatus(row),
      statusBayar: row.statusBayar,
      rekeningLabel: row.rekeningBank ? `${row.rekeningBank.namaRekening} - ${row.rekeningBank.nomorRekening}` : "-",
      tipeRekeningLabel: row.tipeRekening ? row.tipeRekening.namaTipe : "-",
      jumlahTagihan: row.jumlahTagihan,
      jumlahDibayar: row.jumlahDibayar,
      sisaTagihan: row.sisaTagihan,
      keterangan: row.keterangan,
    });
  } catch (error) {
    console.error("Print PDF invoice penjualan desain error:", error);
    return res.status(500).json({ error: "Gagal mencetak PDF invoice penjualan desain." });
  }
});

router.post("/invoice-penjualan/desain", async (req, res) => {
  try {
    if (!hasRole(req, CREATOR_ROLES)) return denyRole(res, CREATOR_ROLES);

    const { projectId, designQuotationId, tanggal, dpNominal, jumlahDibayar, rekeningBankId, tipeRekeningId, keterangan } = req.body;

    if (!projectId || !designQuotationId) {
      return res.status(400).json({ error: "projectId dan designQuotationId wajib diisi." });
    }

    const project = await prisma.project.findUnique({ where: { id: String(projectId) } });
    if (!project) return res.status(404).json({ error: "Project tidak ditemukan." });

    const quotation = await prisma.designQuotation.findFirst({
      where: { id: String(designQuotationId), projectId: String(projectId) },
    });
    if (!quotation) {
      return res.status(400).json({ error: "Design quotation tidak valid untuk project ini." });
    }

    const tanggalInvoice = parseDate(tanggal);
    const defaultTagihan = calcDesignQuotationTotal(quotation);
    const payment = derivePayment(defaultTagihan, jumlahDibayar !== undefined ? jumlahDibayar : 0);
    const noInvoice = await buildNoInvoice("DESAIN", tanggalInvoice);

    const created = await prisma.invoicePenjualanDesain.create({
      data: {
        projectId: String(projectId),
        designQuotationId: String(designQuotationId),
        tanggal: tanggalInvoice,
        noInvoice,
        dpNominal: num(dpNominal),
        rekeningBankId: rekeningBankId || null,
        tipeRekeningId: tipeRekeningId || null,
        jumlahTagihan: payment.jumlahTagihan,
        jumlahDibayar: payment.jumlahDibayar,
        sisaTagihan: payment.sisaTagihan,
        statusBayar: payment.statusBayar,
        approvalStatus: "PENDING",
        keterangan: keterangan || null,
      },
      include: includeDesain,
    });

    res.status(201).json({ message: "Invoice penjualan desain berhasil dibuat.", data: created });
  } catch (error) {
    console.error("Create invoice penjualan desain error:", error);
    if (error.code === "P2002") {
      return res.status(400).json({ error: "Nomor invoice sudah dipakai. Silakan simpan ulang." });
    }
    res.status(500).json({ error: "Gagal membuat invoice penjualan desain." });
  }
});

router.put("/invoice-penjualan/desain/:id", async (req, res) => {
  try {
    if (!hasRole(req, CREATOR_ROLES)) return denyRole(res, CREATOR_ROLES);

    const existing = await prisma.invoicePenjualanDesain.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Invoice penjualan desain tidak ditemukan." });

    if (existing.postedToGl) {
      return res.status(400).json({ error: "Invoice sudah diposting ke GL dan tidak bisa diubah." });
    }

    const nextProjectId = req.body.projectId !== undefined ? req.body.projectId || null : existing.projectId;
    const nextQuotationId = req.body.designQuotationId !== undefined ? req.body.designQuotationId || null : existing.designQuotationId;
    if (!nextProjectId || !nextQuotationId) {
      return res.status(400).json({ error: "Invoice desain wajib terkait Design Quotation." });
    }

    const quotation = await prisma.designQuotation.findFirst({
      where: { id: String(nextQuotationId), projectId: String(nextProjectId) },
    });
    if (!quotation) {
      return res.status(400).json({ error: "Design quotation tidak valid untuk project ini." });
    }

    const payment = derivePayment(calcDesignQuotationTotal(quotation), req.body.jumlahDibayar !== undefined ? req.body.jumlahDibayar : existing.jumlahDibayar);

    const data = {
      projectId: req.body.projectId !== undefined ? req.body.projectId || null : undefined,
      designQuotationId: req.body.designQuotationId !== undefined ? req.body.designQuotationId || null : undefined,
      tanggal: req.body.tanggal ? parseDate(req.body.tanggal) : undefined,
      dpNominal: req.body.dpNominal !== undefined ? num(req.body.dpNominal) : undefined,
      rekeningBankId: req.body.rekeningBankId !== undefined ? req.body.rekeningBankId || null : undefined,
      tipeRekeningId: req.body.tipeRekeningId !== undefined ? req.body.tipeRekeningId || null : undefined,
      keterangan: req.body.keterangan !== undefined ? req.body.keterangan : undefined,
      jumlahTagihan: payment.jumlahTagihan,
      jumlahDibayar: payment.jumlahDibayar,
      sisaTagihan: payment.sisaTagihan,
      statusBayar: payment.statusBayar,
    };

    const criticalChanged =
      num(payment.jumlahTagihan) !== num(existing.jumlahTagihan) ||
      (req.body.projectId !== undefined && String(req.body.projectId || "") !== String(existing.projectId || "")) ||
      (req.body.designQuotationId !== undefined && String(req.body.designQuotationId || "") !== String(existing.designQuotationId || ""));

    if (criticalChanged && ["APPROVED_FINANCE", "APPROVED"].includes(existing.approvalStatus)) {
      data.approvalStatus = "PENDING";
      data.verifiedById = null;
      data.verifiedAt = null;
      data.approvedById = null;
      data.approvedAt = null;
    }

    const updated = await prisma.invoicePenjualanDesain.update({
      where: { id: req.params.id },
      data,
      include: includeDesain,
    });

    res.json({ message: "Invoice penjualan desain berhasil diupdate.", data: updated });
  } catch (error) {
    console.error("Update invoice penjualan desain error:", error);
    if (error.code === "P2002") {
      return res.status(400).json({ error: "Nomor invoice sudah dipakai." });
    }
    res.status(500).json({ error: "Gagal mengupdate invoice penjualan desain." });
  }
});

router.put("/invoice-penjualan/desain/:id/approve-finance", async (req, res) => {
  try {
    if (!hasRole(req, FINANCE_VERIFY_ROLES)) return denyRole(res, FINANCE_VERIFY_ROLES);

    const existing = await prisma.invoicePenjualanDesain.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Invoice tidak ditemukan." });

    if (existing.approvalStatus !== "PENDING") {
      return res.status(400).json({ error: "Hanya invoice berstatus PENDING yang bisa diverifikasi Finance." });
    }

    const updated = await prisma.invoicePenjualanDesain.update({
      where: { id: req.params.id },
      data: {
        approvalStatus: "APPROVED_FINANCE",
        verifiedById: getUserId(req),
        verifiedAt: new Date(),
      },
      include: includeDesain,
    });

    res.json({ message: "Invoice penjualan desain disetujui Finance.", data: updated });
  } catch (error) {
    console.error("Approve finance invoice penjualan desain error:", error);
    res.status(500).json({ error: "Gagal approve finance invoice penjualan desain." });
  }
});

router.put("/invoice-penjualan/desain/:id/approve", async (req, res) => {
  try {
    if (!hasRole(req, FINAL_APPROVE_ROLES)) return denyRole(res, FINAL_APPROVE_ROLES);

    const existing = await prisma.invoicePenjualanDesain.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Invoice tidak ditemukan." });

    if (existing.approvalStatus !== "APPROVED_FINANCE") {
      return res.status(400).json({ error: "Invoice harus melalui APPROVED_FINANCE sebelum APPROVED." });
    }

    const updated = await prisma.invoicePenjualanDesain.update({
      where: { id: req.params.id },
      data: {
        approvalStatus: "APPROVED",
        approvedById: getUserId(req),
        approvedAt: new Date(),
      },
      include: includeDesain,
    });

    res.json({ message: "Invoice penjualan desain disetujui final.", data: updated });
  } catch (error) {
    console.error("Approve final invoice penjualan desain error:", error);
    res.status(500).json({ error: "Gagal approve final invoice penjualan desain." });
  }
});

router.put("/invoice-penjualan/desain/:id/reject", async (req, res) => {
  try {
    if (!hasRole(req, FINAL_APPROVE_ROLES)) return denyRole(res, FINAL_APPROVE_ROLES);

    const existing = await prisma.invoicePenjualanDesain.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Invoice tidak ditemukan." });
    if (existing.postedToGl) return res.status(400).json({ error: "Invoice sudah diposting ke GL dan tidak bisa ditolak." });

    const updated = await prisma.invoicePenjualanDesain.update({
      where: { id: req.params.id },
      data: {
        approvalStatus: "REJECTED",
        keterangan: buildRejectNote(existing.keterangan, req.body?.reason),
      },
      include: includeDesain,
    });

    res.json({ message: "Invoice penjualan desain ditolak.", data: updated });
  } catch (error) {
    console.error("Reject invoice penjualan desain error:", error);
    res.status(500).json({ error: "Gagal reject invoice penjualan desain." });
  }
});

router.post("/invoice-penjualan/desain/:id/post-gl", async (req, res) => {
  try {
    if (!hasRole(req, FINANCE_VERIFY_ROLES)) return denyRole(res, FINANCE_VERIFY_ROLES);

    const existing = await prisma.invoicePenjualanDesain.findUnique({
      where: { id: req.params.id },
      include: includeDesain,
    });
    if (!existing) return res.status(404).json({ error: "Invoice tidak ditemukan." });
    if (existing.approvalStatus !== "APPROVED") {
      return res.status(400).json({ error: "Invoice harus APPROVED sebelum diposting ke GL." });
    }
    if (existing.postedToGl) return res.status(400).json({ error: "Invoice sudah diposting ke GL." });

    const nominal = num(req.body.nominal, existing.jumlahTagihan);
    const transaksi = await postToGl({
      req,
      tanggal: req.body.tanggal || new Date(),
      tipeAkun: req.body.tipeAkun || (req.body.rekeningBankId || existing.rekeningBankId ? "BANK" : "KAS"),
      rekeningBankId: req.body.rekeningBankId || existing.rekeningBankId || null,
      tipeRekeningId: req.body.tipeRekeningId || existing.tipeRekeningId || null,
      jenis: "MASUK",
      nominal,
      noReferensi: existing.noInvoice,
      pihak: existing.project?.client?.name || existing.project?.name || "Klien",
      keterangan: req.body.keterangan || existing.keterangan || `Posting invoice desain ${existing.noInvoice}`,
      projectId: existing.projectId,
    });

    const payment = derivePayment(existing.jumlahTagihan, Math.max(num(existing.jumlahDibayar), nominal));
    const updated = await prisma.invoicePenjualanDesain.update({
      where: { id: req.params.id },
      data: {
        postedToGl: true,
        postedAt: new Date(),
        postedById: getUserId(req),
        glTransaksiId: transaksi?.id || null,
        jumlahDibayar: payment.jumlahDibayar,
        sisaTagihan: payment.sisaTagihan,
        statusBayar: payment.statusBayar,
      },
      include: includeDesain,
    });

    res.json({ message: "Invoice penjualan desain berhasil diposting ke GL.", data: updated, transaksi });
  } catch (error) {
    console.error("Post GL invoice penjualan desain error:", error);
    res.status(500).json({ error: error.message || "Gagal posting invoice penjualan desain ke GL." });
  }
});

// ============================================================
// INVOICE PENJUALAN KLIEN
// ============================================================
router.get("/invoice-penjualan/klien", async (req, res) => {
  try {
    const { projectId } = req.query;
    const rows = await prisma.invoicePenjualanKlien.findMany({
      where: projectId ? { projectId: String(projectId) } : undefined,
      include: includeKlien,
      orderBy: { createdAt: "desc" },
    });

    res.json(rows.map((r) => ({ ...r, approvalStatus: normalizeApprovalStatus(r) })));
  } catch (error) {
    console.error("List invoice penjualan klien error:", error);
    res.status(500).json({ error: "Gagal mengambil invoice penjualan klien." });
  }
});

router.get("/invoice-penjualan/klien/:id", async (req, res) => {
  try {
    const row = await prisma.invoicePenjualanKlien.findUnique({
      where: { id: req.params.id },
      include: includeKlien,
    });
    if (!row) return res.status(404).json({ error: "Invoice penjualan klien tidak ditemukan." });
    res.json({ ...row, approvalStatus: normalizeApprovalStatus(row) });
  } catch (error) {
    console.error("Detail invoice penjualan klien error:", error);
    res.status(500).json({ error: "Gagal mengambil detail invoice penjualan klien." });
  }
});

router.get("/invoice-penjualan/klien/:id/print-pdf", async (req, res) => {
  try {
    const row = await prisma.invoicePenjualanKlien.findUnique({
      where: { id: req.params.id },
      include: includeKlien,
    });
    if (!row) return res.status(404).json({ error: "Invoice penjualan klien tidak ditemukan." });

    return streamInvoicePdf(res, {
      filename: `invoice-klien-${row.noInvoice}`,
      title: "INVOICE PENJUALAN KLIEN",
      subtitle: row.project?.name || "Project",
      noInvoice: row.noInvoice,
      tanggal: row.tanggal,
      projectName: row.project?.name,
      pihakName: row.client?.name || row.project?.client?.name || "Klien",
      statusApproval: normalizeApprovalStatus(row),
      statusBayar: row.statusBayar,
      rekeningLabel: row.rekeningBank ? `${row.rekeningBank.namaRekening} - ${row.rekeningBank.nomorRekening}` : "-",
      tipeRekeningLabel: row.tipeRekening ? row.tipeRekening.namaTipe : "-",
      jumlahTagihan: row.jumlahTagihan,
      jumlahDibayar: row.jumlahDibayar,
      sisaTagihan: row.sisaTagihan,
      keterangan: row.keterangan,
    });
  } catch (error) {
    console.error("Print PDF invoice penjualan klien error:", error);
    return res.status(500).json({ error: "Gagal mencetak PDF invoice penjualan klien." });
  }
});

router.post("/invoice-penjualan/klien", async (req, res) => {
  try {
    if (!hasRole(req, CREATOR_ROLES)) return denyRole(res, CREATOR_ROLES);

    const {
      projectId,
      clientId,
      spkContractId,
      spkTermId,
      termLabel,
      tanggal,
      dpNominal,
      jumlahDibayar,
      rekeningBankId,
      tipeRekeningId,
      keterangan,
    } = req.body;

    if (!projectId || !spkTermId) {
      return res.status(400).json({ error: "projectId dan spkTermId wajib diisi." });
    }

    const project = await prisma.project.findUnique({
      where: { id: String(projectId) },
      select: { id: true, clientId: true },
    });
    if (!project) return res.status(404).json({ error: "Project tidak ditemukan." });

    const term = await prisma.spkTerm.findFirst({
      where: {
        id: String(spkTermId),
        contract: { projectId: String(projectId) },
      },
      include: { contract: { select: { id: true, type: true } } },
    });
    if (!term) return res.status(400).json({ error: "SPK term tidak valid untuk project ini." });

    const resolvedContractId = spkContractId || term.contract?.id || null;
    if (resolvedContractId) {
      const contract = await prisma.spkContract.findFirst({
        where: { id: String(resolvedContractId), projectId: String(projectId), type: "CLIENT" },
      });
      if (!contract) return res.status(400).json({ error: "SPK contract tidak valid untuk project ini." });
    }

    const tanggalInvoice = parseDate(tanggal);
    const payment = derivePayment(num(term.amount), jumlahDibayar !== undefined ? jumlahDibayar : 0);
    const noInvoice = await buildNoInvoice("KLIEN", tanggalInvoice);

    const created = await prisma.invoicePenjualanKlien.create({
      data: {
        projectId: String(projectId),
        clientId: clientId || project.clientId || null,
        spkContractId: resolvedContractId,
        spkTermId: String(spkTermId),
        termLabel: termLabel || term?.label || null,
        tanggal: tanggalInvoice,
        noInvoice,
        dpNominal: num(dpNominal),
        rekeningBankId: rekeningBankId || null,
        tipeRekeningId: tipeRekeningId || null,
        jumlahTagihan: payment.jumlahTagihan,
        jumlahDibayar: payment.jumlahDibayar,
        sisaTagihan: payment.sisaTagihan,
        statusBayar: payment.statusBayar,
        approvalStatus: "PENDING",
        keterangan: keterangan || null,
      },
      include: includeKlien,
    });

    res.status(201).json({ message: "Invoice penjualan klien berhasil dibuat.", data: created });
  } catch (error) {
    console.error("Create invoice penjualan klien error:", error);
    if (error.code === "P2002") {
      return res.status(400).json({ error: "Nomor invoice sudah dipakai. Silakan simpan ulang." });
    }
    res.status(500).json({ error: "Gagal membuat invoice penjualan klien." });
  }
});

router.put("/invoice-penjualan/klien/:id", async (req, res) => {
  try {
    if (!hasRole(req, CREATOR_ROLES)) return denyRole(res, CREATOR_ROLES);

    const existing = await prisma.invoicePenjualanKlien.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Invoice penjualan klien tidak ditemukan." });

    if (existing.postedToGl) {
      return res.status(400).json({ error: "Invoice sudah diposting ke GL dan tidak bisa diubah." });
    }

    const nextProjectId = req.body.projectId !== undefined ? req.body.projectId || null : existing.projectId;
    const nextTermId = req.body.spkTermId !== undefined ? req.body.spkTermId || null : existing.spkTermId;
    if (!nextProjectId || !nextTermId) {
      return res.status(400).json({ error: "Invoice klien wajib terkait SPK term." });
    }

    const term = await prisma.spkTerm.findFirst({
      where: {
        id: String(nextTermId),
        contract: { projectId: String(nextProjectId) },
      },
      include: { contract: { select: { id: true, type: true } } },
    });
    if (!term) return res.status(400).json({ error: "SPK term tidak valid untuk project ini." });

    const resolvedContractId =
      req.body.spkContractId !== undefined
        ? req.body.spkContractId || null
        : existing.spkContractId || term.contract?.id || null;

    if (resolvedContractId) {
      const contract = await prisma.spkContract.findFirst({
        where: { id: String(resolvedContractId), projectId: String(nextProjectId), type: "CLIENT" },
      });
      if (!contract) return res.status(400).json({ error: "SPK contract tidak valid untuk project ini." });
    }

    const payment = derivePayment(num(term.amount), req.body.jumlahDibayar !== undefined ? req.body.jumlahDibayar : existing.jumlahDibayar);

    const data = {
      projectId: req.body.projectId !== undefined ? req.body.projectId || null : undefined,
      clientId: req.body.clientId !== undefined ? req.body.clientId || null : undefined,
      spkContractId: req.body.spkContractId !== undefined ? req.body.spkContractId || null : undefined,
      spkTermId: req.body.spkTermId !== undefined ? req.body.spkTermId || null : undefined,
      termLabel: req.body.termLabel !== undefined ? req.body.termLabel || null : term?.label,
      tanggal: req.body.tanggal ? parseDate(req.body.tanggal) : undefined,
      dpNominal: req.body.dpNominal !== undefined ? num(req.body.dpNominal) : undefined,
      rekeningBankId: req.body.rekeningBankId !== undefined ? req.body.rekeningBankId || null : undefined,
      tipeRekeningId: req.body.tipeRekeningId !== undefined ? req.body.tipeRekeningId || null : undefined,
      keterangan: req.body.keterangan !== undefined ? req.body.keterangan : undefined,
      jumlahTagihan: payment.jumlahTagihan,
      jumlahDibayar: payment.jumlahDibayar,
      sisaTagihan: payment.sisaTagihan,
      statusBayar: payment.statusBayar,
    };

    const criticalChanged =
      num(payment.jumlahTagihan) !== num(existing.jumlahTagihan) ||
      (req.body.projectId !== undefined && String(req.body.projectId || "") !== String(existing.projectId || "")) ||
      (req.body.spkTermId !== undefined && String(req.body.spkTermId || "") !== String(existing.spkTermId || ""));

    if (criticalChanged && ["APPROVED_FINANCE", "APPROVED"].includes(existing.approvalStatus)) {
      data.approvalStatus = "PENDING";
      data.verifiedById = null;
      data.verifiedAt = null;
      data.approvedById = null;
      data.approvedAt = null;
    }

    const updated = await prisma.invoicePenjualanKlien.update({
      where: { id: req.params.id },
      data,
      include: includeKlien,
    });

    res.json({ message: "Invoice penjualan klien berhasil diupdate.", data: updated });
  } catch (error) {
    console.error("Update invoice penjualan klien error:", error);
    if (error.code === "P2002") {
      return res.status(400).json({ error: "Nomor invoice sudah dipakai." });
    }
    res.status(500).json({ error: "Gagal mengupdate invoice penjualan klien." });
  }
});

router.put("/invoice-penjualan/klien/:id/approve-finance", async (req, res) => {
  try {
    if (!hasRole(req, FINANCE_VERIFY_ROLES)) return denyRole(res, FINANCE_VERIFY_ROLES);

    const existing = await prisma.invoicePenjualanKlien.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Invoice tidak ditemukan." });

    if (existing.approvalStatus !== "PENDING") {
      return res.status(400).json({ error: "Hanya invoice berstatus PENDING yang bisa diverifikasi Finance." });
    }

    const updated = await prisma.invoicePenjualanKlien.update({
      where: { id: req.params.id },
      data: {
        approvalStatus: "APPROVED_FINANCE",
        verifiedById: getUserId(req),
        verifiedAt: new Date(),
      },
      include: includeKlien,
    });

    res.json({ message: "Invoice penjualan klien disetujui Finance.", data: updated });
  } catch (error) {
    console.error("Approve finance invoice penjualan klien error:", error);
    res.status(500).json({ error: "Gagal approve finance invoice penjualan klien." });
  }
});

router.put("/invoice-penjualan/klien/:id/approve", async (req, res) => {
  try {
    if (!hasRole(req, FINAL_APPROVE_ROLES)) return denyRole(res, FINAL_APPROVE_ROLES);

    const existing = await prisma.invoicePenjualanKlien.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Invoice tidak ditemukan." });

    if (existing.approvalStatus !== "APPROVED_FINANCE") {
      return res.status(400).json({ error: "Invoice harus melalui APPROVED_FINANCE sebelum APPROVED." });
    }

    const updated = await prisma.invoicePenjualanKlien.update({
      where: { id: req.params.id },
      data: {
        approvalStatus: "APPROVED",
        approvedById: getUserId(req),
        approvedAt: new Date(),
      },
      include: includeKlien,
    });

    res.json({ message: "Invoice penjualan klien disetujui final.", data: updated });
  } catch (error) {
    console.error("Approve final invoice penjualan klien error:", error);
    res.status(500).json({ error: "Gagal approve final invoice penjualan klien." });
  }
});

router.put("/invoice-penjualan/klien/:id/reject", async (req, res) => {
  try {
    if (!hasRole(req, FINAL_APPROVE_ROLES)) return denyRole(res, FINAL_APPROVE_ROLES);

    const existing = await prisma.invoicePenjualanKlien.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Invoice tidak ditemukan." });
    if (existing.postedToGl) return res.status(400).json({ error: "Invoice sudah diposting ke GL dan tidak bisa ditolak." });

    const updated = await prisma.invoicePenjualanKlien.update({
      where: { id: req.params.id },
      data: {
        approvalStatus: "REJECTED",
        keterangan: buildRejectNote(existing.keterangan, req.body?.reason),
      },
      include: includeKlien,
    });

    res.json({ message: "Invoice penjualan klien ditolak.", data: updated });
  } catch (error) {
    console.error("Reject invoice penjualan klien error:", error);
    res.status(500).json({ error: "Gagal reject invoice penjualan klien." });
  }
});

router.post("/invoice-penjualan/klien/:id/post-gl", async (req, res) => {
  try {
    if (!hasRole(req, FINANCE_VERIFY_ROLES)) return denyRole(res, FINANCE_VERIFY_ROLES);

    const existing = await prisma.invoicePenjualanKlien.findUnique({
      where: { id: req.params.id },
      include: includeKlien,
    });
    if (!existing) return res.status(404).json({ error: "Invoice tidak ditemukan." });
    if (existing.approvalStatus !== "APPROVED") {
      return res.status(400).json({ error: "Invoice harus APPROVED sebelum diposting ke GL." });
    }
    if (existing.postedToGl) return res.status(400).json({ error: "Invoice sudah diposting ke GL." });

    const nominal = num(req.body.nominal, existing.jumlahTagihan);
    const transaksi = await postToGl({
      req,
      tanggal: req.body.tanggal || new Date(),
      tipeAkun: req.body.tipeAkun || (req.body.rekeningBankId || existing.rekeningBankId ? "BANK" : "KAS"),
      rekeningBankId: req.body.rekeningBankId || existing.rekeningBankId || null,
      tipeRekeningId: req.body.tipeRekeningId || existing.tipeRekeningId || null,
      jenis: "MASUK",
      nominal,
      noReferensi: existing.noInvoice,
      pihak: existing.client?.name || existing.project?.client?.name || existing.project?.name || "Klien",
      keterangan: req.body.keterangan || existing.keterangan || `Posting invoice klien ${existing.noInvoice}`,
      projectId: existing.projectId,
    });

    const payment = derivePayment(existing.jumlahTagihan, Math.max(num(existing.jumlahDibayar), nominal));
    const updated = await prisma.invoicePenjualanKlien.update({
      where: { id: req.params.id },
      data: {
        postedToGl: true,
        postedAt: new Date(),
        postedById: getUserId(req),
        glTransaksiId: transaksi?.id || null,
        jumlahDibayar: payment.jumlahDibayar,
        sisaTagihan: payment.sisaTagihan,
        statusBayar: payment.statusBayar,
      },
      include: includeKlien,
    });

    res.json({ message: "Invoice penjualan klien berhasil diposting ke GL.", data: updated, transaksi });
  } catch (error) {
    console.error("Post GL invoice penjualan klien error:", error);
    res.status(500).json({ error: error.message || "Gagal posting invoice penjualan klien ke GL." });
  }
});

// ============================================================
// INVOICE OPERASIONAL
// ============================================================
router.get("/invoice-operasional", async (req, res) => {
  try {
    const { projectId } = req.query;
    const rows = await prisma.invoiceOperasional.findMany({
      where: projectId ? { projectId: String(projectId) } : undefined,
      include: includeOperasional,
      orderBy: { createdAt: "desc" },
    });

    res.json(rows.map((r) => ({ ...r, approvalStatus: normalizeApprovalStatus(r) })));
  } catch (error) {
    console.error("List invoice operasional error:", error);
    res.status(500).json({ error: "Gagal mengambil invoice operasional." });
  }
});

router.get("/invoice-operasional/:id", async (req, res) => {
  try {
    const row = await prisma.invoiceOperasional.findUnique({
      where: { id: req.params.id },
      include: includeOperasional,
    });
    if (!row) return res.status(404).json({ error: "Invoice operasional tidak ditemukan." });
    res.json({ ...row, approvalStatus: normalizeApprovalStatus(row) });
  } catch (error) {
    console.error("Detail invoice operasional error:", error);
    res.status(500).json({ error: "Gagal mengambil detail invoice operasional." });
  }
});

router.get("/invoice-operasional/:id/print-pdf", async (req, res) => {
  try {
    const row = await prisma.invoiceOperasional.findUnique({
      where: { id: req.params.id },
      include: includeOperasional,
    });
    if (!row) return res.status(404).json({ error: "Invoice operasional tidak ditemukan." });

    return streamInvoicePdf(res, {
      filename: `invoice-operasional-${row.noInvoice}`,
      title: "INVOICE OPERASIONAL",
      subtitle: row.project?.name || "Project",
      noInvoice: row.noInvoice,
      tanggal: row.tanggal,
      projectName: row.project?.name,
      pihakName: row.project?.client?.name || row.project?.name || "Operasional",
      statusApproval: normalizeApprovalStatus(row),
      statusBayar: row.statusBayar,
      rekeningLabel: row.rekeningBank ? `${row.rekeningBank.namaRekening} - ${row.rekeningBank.nomorRekening}` : "-",
      tipeRekeningLabel: row.tipeRekening ? row.tipeRekening.namaTipe : "-",
      jumlahTagihan: row.jumlahTagihan,
      jumlahDibayar: row.jumlahDibayar,
      sisaTagihan: row.sisaTagihan,
      keterangan: row.keterangan || row.jenisBiaya,
    });
  } catch (error) {
    console.error("Print PDF invoice operasional error:", error);
    return res.status(500).json({ error: "Gagal mencetak PDF invoice operasional." });
  }
});

router.post("/invoice-operasional", async (req, res) => {
  try {
    if (!hasRole(req, CREATOR_ROLES)) return denyRole(res, CREATOR_ROLES);

    const {
      projectId,
      tanggal,
      jenisBiaya,
      jenisKas,
      dpNominal,
      jumlahDibayar,
      rekeningBankId,
      tipeRekeningId,
      keterangan,
    } = req.body;

    if (!projectId || !jenisBiaya) {
      return res.status(400).json({ error: "projectId dan jenisBiaya wajib diisi." });
    }

    const project = await prisma.project.findUnique({ where: { id: String(projectId) } });
    if (!project) return res.status(404).json({ error: "Project tidak ditemukan." });

    const tanggalInvoice = parseDate(tanggal);
    const nilaiDibayar = Math.max(0, num(jumlahDibayar));
    const payment = derivePayment(nilaiDibayar, nilaiDibayar);
    const noInvoice = await buildNoInvoice("OPERASIONAL", tanggalInvoice);

    const created = await prisma.invoiceOperasional.create({
      data: {
        projectId: String(projectId),
        tanggal: tanggalInvoice,
        noInvoice,
        jenisBiaya: String(jenisBiaya).trim(),
        jenisKas: String(jenisKas || "KELUAR").toUpperCase() === "MASUK" ? "MASUK" : "KELUAR",
        dpNominal: num(dpNominal),
        rekeningBankId: rekeningBankId || null,
        tipeRekeningId: tipeRekeningId || null,
        jumlahTagihan: payment.jumlahTagihan,
        jumlahDibayar: payment.jumlahDibayar,
        sisaTagihan: payment.sisaTagihan,
        statusBayar: payment.statusBayar,
        approvalStatus: "PENDING",
        keterangan: keterangan || null,
      },
      include: includeOperasional,
    });

    res.status(201).json({ message: "Invoice operasional berhasil dibuat.", data: created });
  } catch (error) {
    console.error("Create invoice operasional error:", error);
    if (error.code === "P2002") {
      return res.status(400).json({ error: "Nomor invoice sudah dipakai. Silakan simpan ulang." });
    }
    res.status(500).json({ error: "Gagal membuat invoice operasional." });
  }
});

router.put("/invoice-operasional/:id", async (req, res) => {
  try {
    if (!hasRole(req, CREATOR_ROLES)) return denyRole(res, CREATOR_ROLES);

    const existing = await prisma.invoiceOperasional.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Invoice operasional tidak ditemukan." });

    if (existing.postedToGl) {
      return res.status(400).json({ error: "Invoice sudah diposting ke GL dan tidak bisa diubah." });
    }

    const nilaiDibayar = Math.max(
      0,
      num(req.body.jumlahDibayar !== undefined ? req.body.jumlahDibayar : existing.jumlahDibayar)
    );
    const payment = derivePayment(nilaiDibayar, nilaiDibayar);

    const data = {
      projectId: req.body.projectId !== undefined ? req.body.projectId || null : undefined,
      tanggal: req.body.tanggal ? parseDate(req.body.tanggal) : undefined,
      jenisBiaya: req.body.jenisBiaya !== undefined ? String(req.body.jenisBiaya || "").trim() : undefined,
      jenisKas:
        req.body.jenisKas !== undefined
          ? String(req.body.jenisKas || "").toUpperCase() === "MASUK"
            ? "MASUK"
            : "KELUAR"
          : undefined,
      dpNominal: req.body.dpNominal !== undefined ? num(req.body.dpNominal) : undefined,
      rekeningBankId: req.body.rekeningBankId !== undefined ? req.body.rekeningBankId || null : undefined,
      tipeRekeningId: req.body.tipeRekeningId !== undefined ? req.body.tipeRekeningId || null : undefined,
      keterangan: req.body.keterangan !== undefined ? req.body.keterangan : undefined,
      jumlahTagihan: payment.jumlahTagihan,
      jumlahDibayar: payment.jumlahDibayar,
      sisaTagihan: payment.sisaTagihan,
      statusBayar: payment.statusBayar,
    };

    const criticalChanged =
      num(payment.jumlahDibayar) !== num(existing.jumlahDibayar) ||
      (req.body.projectId !== undefined && String(req.body.projectId || "") !== String(existing.projectId || "")) ||
      (req.body.jenisKas !== undefined && String(req.body.jenisKas || "").toUpperCase() !== String(existing.jenisKas || ""));

    if (criticalChanged && ["APPROVED_FINANCE", "APPROVED"].includes(existing.approvalStatus)) {
      data.approvalStatus = "PENDING";
      data.verifiedById = null;
      data.verifiedAt = null;
      data.approvedById = null;
      data.approvedAt = null;
    }

    const updated = await prisma.invoiceOperasional.update({
      where: { id: req.params.id },
      data,
      include: includeOperasional,
    });

    res.json({ message: "Invoice operasional berhasil diupdate.", data: updated });
  } catch (error) {
    console.error("Update invoice operasional error:", error);
    if (error.code === "P2002") {
      return res.status(400).json({ error: "Nomor invoice sudah dipakai." });
    }
    res.status(500).json({ error: "Gagal mengupdate invoice operasional." });
  }
});

router.put("/invoice-operasional/:id/approve-finance", async (req, res) => {
  try {
    if (!hasRole(req, FINANCE_VERIFY_ROLES)) return denyRole(res, FINANCE_VERIFY_ROLES);

    const existing = await prisma.invoiceOperasional.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Invoice tidak ditemukan." });

    if (existing.approvalStatus !== "PENDING") {
      return res.status(400).json({ error: "Hanya invoice berstatus PENDING yang bisa diverifikasi Finance." });
    }

    const updated = await prisma.invoiceOperasional.update({
      where: { id: req.params.id },
      data: {
        approvalStatus: "APPROVED_FINANCE",
        verifiedById: getUserId(req),
        verifiedAt: new Date(),
      },
      include: includeOperasional,
    });

    res.json({ message: "Invoice operasional disetujui Finance.", data: updated });
  } catch (error) {
    console.error("Approve finance invoice operasional error:", error);
    res.status(500).json({ error: "Gagal approve finance invoice operasional." });
  }
});

router.put("/invoice-operasional/:id/approve", async (req, res) => {
  try {
    if (!hasRole(req, FINAL_APPROVE_ROLES)) return denyRole(res, FINAL_APPROVE_ROLES);

    const existing = await prisma.invoiceOperasional.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Invoice tidak ditemukan." });

    if (existing.approvalStatus !== "APPROVED_FINANCE") {
      return res.status(400).json({ error: "Invoice harus melalui APPROVED_FINANCE sebelum APPROVED." });
    }

    const updated = await prisma.invoiceOperasional.update({
      where: { id: req.params.id },
      data: {
        approvalStatus: "APPROVED",
        approvedById: getUserId(req),
        approvedAt: new Date(),
      },
      include: includeOperasional,
    });

    res.json({ message: "Invoice operasional disetujui final.", data: updated });
  } catch (error) {
    console.error("Approve final invoice operasional error:", error);
    res.status(500).json({ error: "Gagal approve final invoice operasional." });
  }
});

router.put("/invoice-operasional/:id/reject", async (req, res) => {
  try {
    if (!hasRole(req, FINAL_APPROVE_ROLES)) return denyRole(res, FINAL_APPROVE_ROLES);

    const existing = await prisma.invoiceOperasional.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Invoice tidak ditemukan." });
    if (existing.postedToGl) return res.status(400).json({ error: "Invoice sudah diposting ke GL dan tidak bisa ditolak." });

    const updated = await prisma.invoiceOperasional.update({
      where: { id: req.params.id },
      data: {
        approvalStatus: "REJECTED",
        keterangan: buildRejectNote(existing.keterangan, req.body?.reason),
      },
      include: includeOperasional,
    });

    res.json({ message: "Invoice operasional ditolak.", data: updated });
  } catch (error) {
    console.error("Reject invoice operasional error:", error);
    res.status(500).json({ error: "Gagal reject invoice operasional." });
  }
});

router.post("/invoice-operasional/:id/post-gl", async (req, res) => {
  try {
    if (!hasRole(req, FINANCE_VERIFY_ROLES)) return denyRole(res, FINANCE_VERIFY_ROLES);

    const existing = await prisma.invoiceOperasional.findUnique({
      where: { id: req.params.id },
      include: includeOperasional,
    });
    if (!existing) return res.status(404).json({ error: "Invoice tidak ditemukan." });
    if (existing.approvalStatus !== "APPROVED") {
      return res.status(400).json({ error: "Invoice harus APPROVED sebelum diposting ke GL." });
    }
    if (existing.postedToGl) return res.status(400).json({ error: "Invoice sudah diposting ke GL." });

    const nominal = num(req.body.nominal, existing.jumlahDibayar || existing.jumlahTagihan);
    const jenis = existing.jenisKas === "MASUK" ? "MASUK" : "KELUAR";

    const transaksi = await postToGl({
      req,
      tanggal: req.body.tanggal || new Date(),
      tipeAkun: req.body.tipeAkun || (req.body.rekeningBankId || existing.rekeningBankId ? "BANK" : "KAS"),
      rekeningBankId: req.body.rekeningBankId || existing.rekeningBankId || null,
      tipeRekeningId: req.body.tipeRekeningId || existing.tipeRekeningId || null,
      jenis,
      nominal,
      noReferensi: existing.noInvoice,
      pihak: existing.project?.name || "Project",
      keterangan:
        req.body.keterangan ||
        existing.keterangan ||
        `Posting invoice operasional ${existing.noInvoice} (${existing.jenisBiaya})`,
      projectId: existing.projectId,
    });

    const payment = derivePayment(existing.jumlahTagihan, Math.max(num(existing.jumlahDibayar), nominal));
    const updated = await prisma.invoiceOperasional.update({
      where: { id: req.params.id },
      data: {
        postedToGl: true,
        postedAt: new Date(),
        postedById: getUserId(req),
        glTransaksiId: transaksi?.id || null,
        jumlahDibayar: payment.jumlahDibayar,
        sisaTagihan: payment.sisaTagihan,
        statusBayar: payment.statusBayar,
      },
      include: includeOperasional,
    });

    res.json({ message: "Invoice operasional berhasil diposting ke GL.", data: updated, transaksi });
  } catch (error) {
    console.error("Post GL invoice operasional error:", error);
    res.status(500).json({ error: error.message || "Gagal posting invoice operasional ke GL." });
  }
});

module.exports = router;
