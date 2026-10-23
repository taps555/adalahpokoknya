'use strict';

const jwt = require('jsonwebtoken');
const prisma = require('../src/lib/prisma');

const BASE = 'http://localhost:4000/api';
const PREFIX = `E2E-SCOPE-${Date.now()}`;
const created = { projectId: null, clientId: null, surveyId: null, quotationId: null, bvItemId: null, rabItemId: null };
const checks = [];

function ok(name, condition, detail = '') {
  if (!condition) throw new Error(`${name}: ${detail || 'assertion gagal'}`);
  checks.push({ name, detail });
  console.log(`PASS ${checks.length}: ${name}${detail ? ` — ${detail}` : ''}`);
}

async function api(path, { method = 'GET', body, form, token } = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: form || (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer());
  if (!response.ok) {
    const msg = Buffer.isBuffer(data) ? data.toString().slice(0, 200) : JSON.stringify(data);
    throw new Error(`${method} ${path} -> ${response.status}: ${msg}`);
  }
  return { status: response.status, data, headers: response.headers };
}

async function cleanup() {
  if (created.projectId) {
    try {
      // Urutan penting: SurveyReport punya FK Restrict ke Project, jadi harus
      // dihapus lebih dulu sebelum project. Sisanya mengikuti cascade.
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
      } else {
        console.error(`CLEANUP client dilewati: masih dipakai ${stillUsed} project`);
      }
    } catch (error) {
      console.error(`CLEANUP client gagal: ${error.message}`);
    }
  }
}

async function main() {
  const token = jwt.sign(
    { userId: 'e2e-scope', role: 'SUPER_ADMIN' },
    process.env.JWT_SECRET || 'rahasia_super_aman_123',
  );

  const categories = await prisma.workCategory.findMany({
    where: { isActive: true },
    select: { id: true, code: true, name: true },
    orderBy: { sortOrder: 'asc' },
  });
  const chosenCategory = categories[0];
  ok('Kategori aktif tersedia', Boolean(chosenCategory), chosenCategory?.code);

  const sub = await prisma.workSubCategory.findFirst({
    where: { categoryId: chosenCategory.id, isActive: true },
    select: { id: true, code: true, name: true },
    orderBy: { sortOrder: 'asc' },
  });
  ok('Subkategori aktif tersedia', Boolean(sub), sub?.code);

  const projectRes = await api('/projects', {
    method: 'POST', token,
    body: {
      name: PREFIX,
      location: 'Surabaya E2E',
      hspkPeriod: 2026,
      clientName: `${PREFIX}-CLIENT`,
      categories: [{ workCategoryId: chosenCategory.id, pricingMode: 'CUSTOM', grade: null, isActive: true }],
    },
  });
  created.projectId = projectRes.data.id;
  created.clientId = projectRes.data.clientId;
  ok('Create project', projectRes.status === 201, `${created.projectId} / ${chosenCategory.code}`);
  ok('Project dinamis tanpa discipline legacy', projectRes.data.discipline === null && projectRes.data.workCategories?.length === 1);

  const getProject = await api(`/projects/${created.projectId}`, { token });
  ok('Read project', getProject.data.id === created.projectId && getProject.data.location === 'Surabaya E2E');

  const surveyForm = new FormData();
  surveyForm.append('surveyData', JSON.stringify({
    surveyDate: '2026-10-20',
    surveyorName: 'E2E Surveyor',
    notes: PREFIX,
    areas: [{
      areaName: 'Ruang E2E',
      analisa: 'Kondisi E2E',
      penanganan: 'Penanganan E2E',
      informasiTambahan: 'Scope test',
      dimensions: [{ keterangan: 'Lantai', panjang: 5, lebar: 4, tinggi: 3 }],
    }],
  }));
  const surveyRes = await api(`/projects/${created.projectId}/surveys`, { method: 'POST', form: surveyForm, token });
  created.surveyId = surveyRes.data.data.id;
  ok('Create survey', surveyRes.status === 201, created.surveyId);
  ok('Luasan survey dihitung', Number(surveyRes.data.data.areas[0].dimensions[0].luasan) === 20, '5 × 4 = 20 m²');

  const surveyList = await api(`/projects/${created.projectId}/surveys`, { token });
  ok('Read survey', surveyList.data.length === 1 && surveyList.data[0].id === created.surveyId);

  const surveyPdf = await api(`/surveys/${created.surveyId}/pdf/view`, { token });
  ok('PDF survey', surveyPdf.data.subarray(0, 4).toString() === '%PDF', `${surveyPdf.data.length} bytes`);

  const threeDForm = new FormData();
  threeDForm.append('survey3dData', JSON.stringify({
    status: 'FINAL',
    gdriveUrl: 'https://drive.google.com/example-e2e',
    notes: PREFIX,
    existingImages: [],
    resources: [
      { type: 'GOOGLE_DRIVE', title: 'Folder Render E2E', url: 'https://drive.google.com/example-e2e', order: 0 },
      { type: 'OTHER_LINK', title: 'Model E2E', url: 'https://example.com/model-e2e', order: 1 },
    ],
  }));
  const threeD = await api(`/projects/${created.projectId}/survey-3d`, { method: 'PUT', form: threeDForm, token });
  ok('Simpan arsip desain 3D', threeD.data.status === 'FINAL' && threeD.data.resources.length === 2);
  const threeDRead = await api(`/projects/${created.projectId}/survey-3d`, { token });
  ok('Read arsip desain 3D', threeDRead.data.resources.length === 2 && threeDRead.data.gdriveUrl.includes('drive.google.com'));

  const quotation = await api(`/projects/${created.projectId}/design-quotations`, {
    method: 'POST', token,
    body: { surveyReportId: created.surveyId, quotationDate: '2026-10-20', item3dPrice: 150000, item2dPrice: 100000, discount: 500000 },
  });
  created.quotationId = quotation.data.id;
  ok('Create penawaran desain', quotation.status === 201, created.quotationId);
  ok('Volume penawaran dari survey', Number(quotation.data.item3dVolume) === 20 && Number(quotation.data.item2dVolume) === 20, '20 m²');
  const quoteList = await api(`/projects/${created.projectId}/design-quotations`, { token });
  ok('Read penawaran desain', quoteList.data.some((row) => row.id === created.quotationId));
  const quotePdf = await api(`/design-quotations/${created.quotationId}/pdf/view`, { token });
  ok('PDF penawaran desain', quotePdf.data.subarray(0, 4).toString() === '%PDF', `${quotePdf.data.length} bytes`);

  const bv = await api(`/projects/${created.projectId}/bv-items`, {
    method: 'POST', token,
    body: {
      sourceJobTypeId: null,
      name: 'Pekerjaan E2E',
      keterangan: 'BV ke RAB E2E',
      paymentUnit: 'm2',
      groupId: null,
      breakdowns: [{ uraian: 'Lantai', panjang: 5, isPChecked: true, lebar: 4, isLChecked: true, tinggi: 1, isTChecked: false, jumlahSisi: 1, jumlahBh: 1, waste: 0 }],
      parentBvItemId: null,
      isHeaderOnly: false,
      disciplineLabel: null,
      workCategoryId: chosenCategory.id,
      workSubCategoryId: sub.id,
    },
  });
  created.bvItemId = bv.data.data.id;
  ok('Create BV leaf', bv.status === 201, created.bvItemId);
  ok('BV volume & klasifikasi', Number(bv.data.data.totalVolume) === 20 && bv.data.data.workCategoryId === chosenCategory.id && bv.data.data.workSubCategoryId === sub.id, '20 m²');

  const bvList = await api(`/projects/${created.projectId}/bv-items?workCategoryId=${encodeURIComponent(chosenCategory.id)}`, { token });
  const foundBv = Array.isArray(bvList.data) ? bvList.data.find((row) => row.id === created.bvItemId) : null;
  ok('Read BV kategori', Boolean(foundBv));

  // Export BV: XLSX harus berupa ZIP/OOXML valid; view harus berupa HTML.
  const bvExcel = await api(`/projects/${created.projectId}/bv-items/export?workCategoryId=${encodeURIComponent(chosenCategory.id)}`, { token });
  ok('Export BV Excel', bvExcel.data.subarray(0, 2).toString() === 'PK', `${bvExcel.data.length} bytes`);
  const bvView = await api(`/projects/${created.projectId}/bv-items/view?workCategoryId=${encodeURIComponent(chosenCategory.id)}`, { token });
  ok('Export/View BV HTML', /text\/html/.test(bvView.headers.get('content-type') || '') && bvView.data.toString().includes(PREFIX), `${bvView.data.length} bytes`);

  const linked = await api(`/bv-items/${created.bvItemId}/link-to-rab`, {
    method: 'POST', token,
    body: {
      includeChildren: false,
      overhead: 18,
      category: 'E2E',
      reference: 'E2E-01',
      components: [
        { section: 'BAHAN', name: 'Material E2E', unit: 'm2', coefficient: 1, unitPrice: 100000 },
        { section: 'UPAH', name: 'Upah E2E', unit: 'OH', coefficient: 1, unitPrice: 50000 },
      ],
    },
  });
  created.rabItemId = linked.data?.rabItem?.id || linked.data?.data?.rabItem?.id || linked.data?.data?.id || linked.data?.id || linked.data?.linkedRabItemId;
  ok('Link BV ke RAB', Boolean(created.rabItemId), created.rabItemId);

  const rabItems = await api(`/projects/${created.projectId}/rab-items?workCategoryId=${encodeURIComponent(chosenCategory.id)}`, { token });
  const rabArray = Array.isArray(rabItems.data) ? rabItems.data : (rabItems.data.items || rabItems.data.data || []);
  const rab = rabArray.find((row) => row.id === created.rabItemId);
  ok('Read RAB kategori', Boolean(rab));
  ok('Klasifikasi BV → RAB tersalin', rab.workCategoryId === chosenCategory.id && rab.workSubCategoryId === sub.id);
  ok('RAB harga terhitung', Number(rab.rapUnitPrice) > 0 && Number(rab.rabUnitPrice) >= Number(rab.rapUnitPrice), `RAP ${rab.rapUnitPrice}, RAB ${rab.rabUnitPrice}`);

  // Export RAB: Excel mode RAP/RAB/COMBINED, view HTML mode RAP & RAB.
  for (const mode of ['RAP', 'RAB', 'COMBINED']) {
    const excel = await api(`/projects/${created.projectId}/rab-items/export?mode=${mode}&workCategoryId=${encodeURIComponent(chosenCategory.id)}`, { token });
    ok(`Export RAB Excel mode ${mode}`, excel.data.subarray(0, 2).toString() === 'PK', `${excel.data.length} bytes`);
  }
  for (const mode of ['RAP', 'RAB']) {
    const view = await api(`/projects/${created.projectId}/rab-items/view?mode=${mode}&workCategoryId=${encodeURIComponent(chosenCategory.id)}`, { token });
    const html = view.data.toString();
    ok(`View RAB HTML mode ${mode}`, /text\/html/.test(view.headers.get('content-type') || '') && html.includes(PREFIX), `${view.data.length} bytes`);
  }

  console.log(`\nE2E_SCOPE_RESULT ${checks.length}/${checks.length} PASS`);
}

main()
  .then(cleanup)
  .catch(async (error) => {
    console.error(`\nE2E_SCOPE_FAIL: ${error.message}`);
    await cleanup();
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
