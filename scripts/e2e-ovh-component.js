"use strict";

const jwt = require("jsonwebtoken");
const prisma = require("../src/lib/prisma");

const BASE = "http://localhost:4000/api";
const PREFIX = `E2E-OVH-${Date.now()}`;
const created = { projectId: null, clientId: null, surveyId: null, bvItemId: null, rabItemId: null };
const checks = [];

function ok(name, condition, detail = "") {
  if (!condition) throw new Error(`${name}: ${detail || "assertion gagal"}`);
  checks.push({ name, detail });
  console.log(`PASS ${checks.length}: ${name}${detail ? ` — ${detail}` : ""}`);
}

async function api(path, { method = "GET", body, form, token } = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  if (body !== undefined && !form) headers["Content-Type"] = "application/json";
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: form || (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const type = response.headers.get("content-type") || "";
  const data = type.includes("application/json")
    ? await response.json()
    : Buffer.from(await response.arrayBuffer());
  if (!response.ok) {
    const msg = Buffer.isBuffer(data) ? data.toString().slice(0, 200) : JSON.stringify(data);
    throw new Error(`${method} ${path} -> ${response.status}: ${msg}`);
  }
  return { status: response.status, data, headers: response.headers };
}

async function cleanup() {
  if (created.projectId) {
    try {
      await prisma.designQuotation.deleteMany({ where: { projectId: created.projectId } });
      await prisma.survey3DResult.deleteMany({ where: { projectId: created.projectId } });
      await prisma.surveyReport.deleteMany({ where: { projectId: created.projectId } });
      await prisma.spkContract.deleteMany({ where: { projectId: created.projectId } });
      await prisma.project.delete({ where: { id: created.projectId } });
      console.log(`CLEANUP project ${created.projectId}`);
    } catch (error) {
      console.error(`CLEANUP project gagal: ${error.message}`);
    }
  }
  if (created.clientId) {
    try {
      const stillUsed = await prisma.project.count({ where: { clientId: created.clientId } });
      if (stillUsed === 0) {
        await prisma.client.delete({ where: { id: created.clientId } });
        console.log(`CLEANUP client ${created.clientId}`);
      }
    } catch (error) {
      console.error(`CLEANUP client gagal: ${error.message}`);
    }
  }
}

async function main() {
  const token = jwt.sign(
    { userId: "e2e-ovh", role: "SUPER_ADMIN" },
    process.env.JWT_SECRET || "rahasia_super_aman_123",
  );

  const category = await prisma.workCategory.findFirst({
    where: { isActive: true },
    select: { id: true, code: true },
    orderBy: { sortOrder: "asc" },
  });
  ok("kategori aktif tersedia", Boolean(category), category?.code);

  const sub = await prisma.workSubCategory.findFirst({
    where: { categoryId: category.id, isActive: true },
    select: { id: true, code: true },
    orderBy: { sortOrder: "asc" },
  });
  ok("subkategori aktif tersedia", Boolean(sub), sub?.code);

  const { data: project, status: projectStatus } = await api("/projects", {
    method: "POST",
    token,
    body: {
      name: PREFIX,
      location: "Surabaya E2E OVH",
      hspkPeriod: 2026,
      clientName: `${PREFIX}-CLIENT`,
      categories: [{ workCategoryId: category.id, pricingMode: "CUSTOM", grade: null, isActive: true }],
    },
  });
  created.projectId = project.id;
  created.clientId = project.clientId;
  ok("project dibuat", projectStatus === 201, created.projectId);

  const surveyForm = new FormData();
  surveyForm.append("surveyData", JSON.stringify({
    surveyDate: "2026-10-20",
    surveyorName: "E2E Surveyor OVH",
    notes: PREFIX,
    areas: [{
      areaName: "Ruang E2E OVH",
      analisa: "Kondisi E2E",
      penanganan: "Penanganan E2E",
      informasiTambahan: "Uji komponen OVH",
      dimensions: [{ keterangan: "Lantai", panjang: 5, lebar: 4, tinggi: 3 }],
    }],
  }));
  const surveyRes = await api(`/projects/${created.projectId}/surveys`, { method: "POST", form: surveyForm, token });
  created.surveyId = surveyRes.data.data.id;
  ok("survey dibuat", Number(surveyRes.data.data.areas[0].dimensions[0].luasan) === 20, "5 × 4 = 20 m²");

  const bvRes = await api(`/projects/${created.projectId}/bv-items`, {
    method: "POST",
    token,
    body: {
      sourceJobTypeId: null,
      name: `${PREFIX} Pekerjaan`,
      keterangan: `${PREFIX} deskripsi`,
      paymentUnit: "m2",
      groupId: null,
      breakdowns: [
        { uraian: "Lantai", panjang: 5, isPChecked: true, lebar: 4, isLChecked: true, tinggi: 1, isTChecked: false, jumlahSisi: 1, jumlahBh: 1, waste: 0 },
      ],
      parentBvItemId: null,
      isHeaderOnly: false,
      disciplineLabel: null,
      ahspDiscipline: null,
      workCategoryId: category.id,
      workSubCategoryId: sub.id,
    },
  });
  created.bvItemId = bvRes.data.data.id;
  ok("BV dibuat", bvRes.status === 201, created.bvItemId);

  const linked = await api(`/bv-items/${created.bvItemId}/link-to-rab`, {
    method: "POST",
    token,
    body: {
      includeChildren: false,
      overhead: 18,
      category: "E2E",
      reference: "E2E-OVH-01",
      components: [
        { section: "BAHAN", name: "Material E2E", unit: "m2", coefficient: 1, unitPrice: 100000 },
        { section: "UPAH", name: "Upah E2E", unit: "OH", coefficient: 1, unitPrice: 50000 },
      ],
    },
  });
  created.rabItemId = linked.data?.rabItem?.id || linked.data?.data?.rabItem?.id || linked.data?.data?.id || linked.data?.id;
  ok("RAB item dibuat dari BV", Boolean(created.rabItemId), created.rabItemId);

  const beforeList = await api(`/projects/${created.projectId}/rab-items?workCategoryId=${category.id}`, { token });
  const beforeItem = beforeList.data.find((row) => row.id === created.rabItemId) || beforeList.data[0];
  console.log("DEBUG beforeItem:", JSON.stringify({id: beforeItem.id, overheadPercent: beforeItem.overheadPercent, ohComponents: beforeItem.ohComponents}));
  ok("total OVH awal 18", Number(beforeItem.overheadPercent) === 18, `${beforeItem.overheadPercent}%`);
  const beforeComponents = Array.isArray(beforeItem.ohComponents) ? beforeItem.ohComponents : [];
  ok("3 komponen default tersimpan", beforeComponents.length === 3,
    beforeComponents.map((c) => `${c.name}=${c.percent}%`).join(", "));

  // TAMBAH KOMPONEN OVH BARU
  const { data: added } = await api(`/rab-items/${created.rabItemId}`, {
    method: "PUT",
    token,
    body: {
      ohComponents: [
        ...beforeComponents,
        { id: `custom-${Date.now()}`, name: "Overhead Kantor", percent: 2, kind: "CUSTOM" },
      ],
    },
  });
  console.log("DEBUG added:", JSON.stringify(added));
  const addedData = (added?.data ?? added);
  const addedComponents = Array.isArray(addedData.ohComponents) ? addedData.ohComponents : [];
  ok("komponen OVH ditambahkan", addedComponents.length === 4, `${addedComponents.length} komponen`);
  ok("total OVH jadi 20", Number(addedData.overheadPercent) === 20, `${addedData.overheadPercent}%`);
  const customAdded = addedComponents.find((c) => c.kind === "CUSTOM");
  ok("komponen custom bernama benar", Boolean(customAdded) && customAdded.name === "Overhead Kantor" && Number(customAdded.percent) === 2,
    `${customAdded?.name} ${customAdded?.percent}%`);
  ok("RAB satuan ikut naik", Number(addedData.rabUnitPrice) === 180000,
    `RAP 150.000 + OVH 20% = 180.000 (${addedData.rabUnitPrice})`);

  // BACA ULANG DARI DB (persistensi)
  const persistedList = await api(`/projects/${created.projectId}/rab-items?workCategoryId=${category.id}`, { token });
  const persistedItem = persistedList.data.find((row) => row.id === created.rabItemId) || persistedList.data[0];
  const persistedComponents = Array.isArray(persistedItem.ohComponents) ? persistedItem.ohComponents : [];
  ok("komponen OVH persisten di DB", persistedComponents.length === 4, `${persistedComponents.length} komponen`);
  ok("total OVH persisten 20", Number(persistedItem.overheadPercent) === 20, `${persistedItem.overheadPercent}%`);

  // UBAH NAMA KOMPONEN DEFAULT
  const renamed = persistedComponents.map((c) =>
    c.id === "operational" ? { ...c, name: "Biaya Operasional Proyek" } : c);
  const { data: renameResult } = await api(`/rab-items/${created.rabItemId}`, {
    method: "PUT",
    token,
    body: { ohComponents: renamed },
  });
  console.log("DEBUG rename:", JSON.stringify(renameResult));
  const renameData = renameResult?.data ?? renameResult;
  const renameComp = (renameData?.ohComponents || []).find((c) => c.id === "operational");
  ok("nama komponen default bisa diubah", renameComp?.name === "Biaya Operasional Proyek", renameComp?.name);
  ok("total tidak berubah setelah rename", Number(renameData?.overheadPercent) === 20, `${renameData?.overheadPercent}%`);

  // HAPUS KOMPONEN CUSTOM
  const { data: removed } = await api(`/rab-items/${created.rabItemId}`, {
    method: "PUT",
    token,
    body: { ohComponents: (renameData?.ohComponents || []).filter((c) => c.kind !== "CUSTOM") },
  });
  console.log("DEBUG removed:", JSON.stringify(removed));
  const removedData = removed?.data ?? removed;
  const removedComponents = Array.isArray(removedData.ohComponents) ? removedData.ohComponents : [];
  ok("komponen custom dihapus", removedComponents.length === 3, `${removedComponents.length} komponen`);
  ok("total OVH kembali 18", Number(removedData.overheadPercent) === 18, `${removedData.overheadPercent}%`);

  // BATAS MAKSIMAL 10 KOMPONEN
  const eleven = [];
  for (let i = 0; i < 11; i += 1) {
    eleven.push({ id: `bulk-${i}`, name: `Komponen ${i}`, percent: 1, kind: "CUSTOM" });
  }
  let limitRejected = false;
  try {
    await api(`/rab-items/${created.rabItemId}`, { method: "PUT", token, body: { ohComponents: eleven } });
  } catch (error) {
    limitRejected = /10/.test(error.message);
  }
  ok("komponen lebih dari 10 ditolak", limitRejected, "batas maksimal 10");

  console.log(`\nE2E_OVH_RESULT ${checks.length}/${checks.length} PASS`);
  await cleanup();
}

main().catch(async (error) => {
  console.error(`E2E_OVH_RESULT FAIL: ${error.message}`);
  await cleanup();
  process.exit(1);
});
