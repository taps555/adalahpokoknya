// seed-data.js
const API = "http://localhost:4000/api";
const PROJECT_ID = "cmscqsiro0003u8hdh3o0uyxl";

const groupsData = [
  {
    reference: "I",
    name: "PEKERJAAN PERSIAPAN",
    items: [
      { name: "Direksi Kit", paymentUnit: "Ls", volume: 1.0 },
      { name: "Air dan Listrik Kerja", paymentUnit: "Ls", volume: 1.0 },
      {
        name: "Mobilisasi Material Masuk Proyek",
        paymentUnit: "Ls",
        volume: 1.0,
      },
      {
        name: "Mobilisasi Pembuangan Puing Proyek Keluar Proyek",
        paymentUnit: "Ls",
        volume: 1.0,
      },
      {
        name: "Alat dan Perlengkapan Pendukung Pekerjaan",
        paymentUnit: "Ls",
        volume: 1.0,
      },
      { name: "Protector Proyek", paymentUnit: "Ls", volume: 1.0 },
      { name: "Bouplank / Site Marking", paymentUnit: "Ls", volume: 1.0 },
      { name: "Pengiriman Barang Furniture", paymentUnit: "Ls", volume: 1.0 },
    ],
  },
  {
    reference: "II",
    name: "PEKERJAAN AREA SHOP FRONT",
    items: [
      {
        name: "PANEL BULKHEAD SHOP FRONT",
        children: [
          {
            name: "Signage Branding NEUNA BEAUTE Uk 150x50cm",
            paymentUnit: "Unit",
            volume: 1.0,
          },
          {
            name: "Huruf Timbul Nail Arts-Eyelash-Wax-Brow Uk 200x10cm",
            paymentUnit: "Set",
            volume: 1.0,
          },
        ],
      },
    ],
  },
  {
    reference: "III",
    name: "PEKERJAAN GENERAL AREA",
    items: [
      {
        name: "CABINET CASHIER",
        children: [
          { name: "Desk Cabinet", paymentUnit: "m2", volume: 1.2 },
          {
            name: "Ins. Arm. Stop Kontak Terminal",
            paymentUnit: "Unit",
            volume: 1.0,
          },
        ],
      },
      {
        name: "DISPLAY UNIT",
        children: [
          { name: "Ambalan", paymentUnit: "m1", volume: 3.6 },
          { name: "Cabinet Storage", paymentUnit: "m2", volume: 1.19 },
          {
            name: "Ins. Arm. Hidden Lamp LED Strip - 4000K Neutral White",
            paymentUnit: "m1",
            volume: 3.6,
          },
          {
            name: "Ins. Arm. LED Driver 12V 100W",
            paymentUnit: "Unit",
            volume: 1.0,
          },
        ],
      },
      {
        name: "MENICURE TABLE",
        children: [
          { name: "Body Dan Counter Top", paymentUnit: "m2", volume: 0.9 },
          { name: "Storage Cabinet A", paymentUnit: "m1", volume: 0.75 },
          { name: "Storage Cabinet B", paymentUnit: "m1", volume: 0.75 },
          {
            name: "Ins. Arm. Stop Kontak Terminal",
            paymentUnit: "Unit",
            volume: 2.0,
          },
        ],
      },
      {
        name: "CURTAIN PEDICURE",
        children: [
          { name: "Curtain Fabric", paymentUnit: "m2", volume: 15.6 },
          { name: "Rail & Accessories", paymentUnit: "Unit", volume: 3.0 },
        ],
      },
      {
        name: "LOOSE FURNITURE",
        children: [
          {
            name: "Bench Area Tunggu Uk 200x50x45cm",
            paymentUnit: "Unit",
            volume: 1.0,
          },
          { name: "Sofa Reclaining", paymentUnit: "Unit", volume: 4.0 },
          { name: "Kursi Duduk", paymentUnit: "Unit", volume: 5.0 },
          { name: "Sandaran Kaki", paymentUnit: "Unit", volume: 3.0 },
          { name: "Stool", paymentUnit: "Unit", volume: 3.0 },
        ],
      },
    ],
  },
  {
    reference: "IV",
    name: "PEKERJAAN AREA WAX",
    items: [
      {
        name: "BACKWALL WAX ROOM",
        children: [
          { name: "Rangka Backwall", paymentUnit: "m2", volume: 2.26 },
          {
            name: "Penutup Backwall Wall Flutted - Cloth Series",
            paymentUnit: "m2",
            volume: 2.26,
          },
          { name: "List Hitam Top Wallboard", paymentUnit: "m1", volume: 2.15 },
        ],
      },
      {
        name: "CABINET STORAGE WAX ROOM",
        children: [{ name: "Cabinet", paymentUnit: "m2", volume: 1.1 }],
      },
      {
        name: "LOOSE FURNITURE",
        children: [
          {
            name: "Ranjang Treatment Uk 180x60x73cm",
            paymentUnit: "Unit",
            volume: 1.0,
          },
        ],
      },
    ],
  },
  {
    reference: "V",
    name: "PEKERJAAN LAIN - LAIN",
    items: [{ name: "Pembersihan Akhir", paymentUnit: "Ls", volume: 1.0 }],
  },
];

async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Gagal (${res.status})`);
  return data;
}

async function createBvItem(groupId, itemData, parentBvItemId = null) {
  const body = {
    groupId,
    parentBvItemId,
    ecommerceLink: null,
    name: itemData.name,
    paymentUnit: itemData.paymentUnit || null,
    sourceJobTypeId: null,
    breakdowns: itemData.volume ? [{}] : [],
  };

  const createdItem = await api(`/projects/${PROJECT_ID}/bv-items`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  const itemId = createdItem.data.id;

  if (itemData.children && itemData.children.length > 0) {
    for (const child of itemData.children) {
      console.log(`   └─ Sub-item: ${child.name}`);
      await createBvItem(groupId, child, itemId);
    }
  }
}

async function main() {
  console.log("Memulai proses seeding data RAB...\n");

  for (const groupDef of groupsData) {
    console.log(`[Group ${groupDef.reference}] Membuat: ${groupDef.name}...`);
    const group = await api(`/projects/${PROJECT_ID}/rab-groups`, {
      method: "POST",
      body: JSON.stringify({
        name: groupDef.name,
        reference: groupDef.reference,
      }),
    });
    const groupId = group.data.id;

    for (const item of groupDef.items) {
      console.log(` ├─ Item Utama: ${item.name}`);
      await createBvItem(groupId, item, null);
    }
    console.log(`\n`);
  }

  console.log("Selesai! Semua data RAB berhasil dimasukkan.");
}

main().catch((err) => {
  console.error("Gagal:", err.message);
});
