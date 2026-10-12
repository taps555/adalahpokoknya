"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const {
  renderSpkSubconPdf,
  safeSpkSubconPdfFilename,
} = require("./spkSubconPdfService");

function extractPdfText(pdf, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spk-subcon-pdf-test-"));
  const pdfPath = path.join(dir, `${name}.pdf`);
  fs.writeFileSync(pdfPath, pdf);
  try {
    return execFileSync("pdftotext", ["-layout", pdfPath, "-"], { encoding: "utf8" });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const subconContract = {
  id: "spk-subcon-1",
  type: "SUBCON",
  status: "TERBIT",
  spkNumber: "071/SPK/10/12/DJP/2026",
  issuedAt: new Date("2026-10-12T08:00:00.000Z"),
  contractValue: 36500000,
  contractValueWords: "Tiga Puluh Enam Juta Lima Ratus Ribu Rupiah",
  retentionPercent: 10,
  retentionAmount: 3650000,
  workDurationDays: 10,
  startDate: new Date("2026-10-01T00:00:00.000Z"),
  endDate: new Date("2026-10-10T00:00:00.000Z"),
  bankData: { bankName: "BCA", accountNumber: "4700157488", accountName: "Lazuardi Iman" },
  partyData: {
    firstParty: {
      name: "Jimmy Christian Santoso",
      position: "Direktur",
      companyName: "PT. Dives Jaya Perkasa",
      address: "Jl. Bulak Rukem Timur I No. 160, Surabaya",
      nik: "3374021312890001",
    },
    secondParty: {
      name: "Yan Gunture Gunawan Putra",
      position: "Penyedia Jasa",
      address: "Leboagung 4/2 RT 009 RW 002 Kel/Desa Gading Kec Tambaksari",
      nik: "3578101901860003",
      phone: "+62 812-3222-5377",
    },
  },
  snapshot: {
    projectName: "Canopy Stamford",
    projectLocation: "Stamford, Surabaya",
    contractValue: 36500000,
    partyData: {
      firstParty: { name: "Jimmy Christian Santoso", position: "Direktur", address: "Jl. Bulak Rukem Timur I No. 160, Surabaya", nik: "3374021312890001" },
      secondParty: { name: "Yan Gunture Gunawan Putra", position: "Penyedia Jasa", address: "Leboagung 4/2 RT 009 RW 002 Kel/Desa Gading Kec Tambaksari", nik: "3578101901860003", phone: "+62 812-3222-5377" },
    },
  },
  terms: [
    { label: "DP", percent: 50, amount: 18250000, dueDescription: "Saat kontrak ditandatangani", order: 0 },
    { label: "Termin 1", percent: 40, amount: 14600000, dueDescription: "Progress pekerjaan mencapai 100%", order: 1 },
  ],
};

test("renders Subcon agreement and separate SPK page", async () => {
  const pdf = await renderSpkSubconPdf(subconContract);
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
  assert.ok(pdf.length > 5000);
  const text = extractPdfText(pdf, "subcon").replace(/\s+/g, ' ');
  assert.match(text, /SURAT PERJANJIAN KONTRAK KERJA/);
  assert.match(text, /SURAT PERINTAH KERJA \(SPK\)/);
  assert.match(text, /Yan Gunture Gunawan Putra/);
  assert.match(text, /3578101901860003/);
  assert.match(text, /Tiga Puluh Enam Juta Lima Ratus Ribu Rupiah/);
  assert.match(text, /10 hari kalender/);
  assert.match(text, /DP/);
  assert.match(text, /Termin 1/);
});

test("Subcon filename is distinct from Client filename", () => {
  assert.equal(
    safeSpkSubconPdfFilename(subconContract),
    "SPK-Subcon-071-SPK-10-12-DJP-2026-Canopy-Stamford.pdf",
  );
});
