const ExcelJS = require("exceljs");
const prisma = require("../lib/prisma"); // Sesuaikan path menuju instance Prisma Anda

/**
 * 1. PARSER EXCEL BERDASARKAN TEMPLATE
 * Membaca file Excel dan mengekstrak data berdasarkan mapping kolom
 */
async function parseByTemplate(fileBuffer, template) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileBuffer);
  const worksheet = workbook.worksheets[0]; // Ambil sheet pertama

  // Parsing JSON array dari Prisma
  const mappings =
    typeof template.columnMappings === "string"
      ? JSON.parse(template.columnMappings)
      : template.columnMappings;

  const currentCategories = {};
  const parsedItems = [];

  // Helper pembersih angka (buang Rp, titik, koma)
  const parsePrice = (val) => {
    if (!val) return 0;
    if (typeof val === "number") return val;
    if (typeof val === "object") val = val.result || val.text || 0;
    const cleanStr = String(val).replace(/[^0-9]/g, "");
    return Number(cleanStr) || 0;
  };

  // Helper pembersih teks
  const parseText = (val) => {
    if (!val) return "";
    if (typeof val === "object") {
      return String(
        val.result || val.text || val.richText?.[0]?.text || "",
      ).trim();
    }
    return String(val).trim();
  };

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber < template.headerRow) return;

    // Looping setiap grup kolom (misal: blok kiri dan blok kanan)
    mappings.forEach((mapGroup, index) => {
      const catValue = mapGroup.categoryCol
        ? row.getCell(mapGroup.categoryCol).value
        : null;
      const sizeValue = mapGroup.sizeCol
        ? row.getCell(mapGroup.sizeCol).value
        : null;
      const priceValue = mapGroup.priceCol
        ? row.getCell(mapGroup.priceCol).value
        : null;
      const promoValue = mapGroup.promoCol
        ? row.getCell(mapGroup.promoCol).value
        : null;

      // Logika Carry-Forward (menangani merged cell untuk nama kategori)
      const rowCategory = parseText(catValue);
      if (rowCategory) {
        currentCategories[index] = rowCategory;
      }

      if (!sizeValue && !priceValue) return; // Skip baris kosong

      const itemNameRaw = parseText(sizeValue);
      const price = parsePrice(priceValue);
      const promoPrice = parsePrice(promoValue);

      if (price > 0 && itemNameRaw) {
        const category = currentCategories[index] || "";
        const fullName = category
          ? `${category} - ${itemNameRaw}`
          : itemNameRaw;

        parsedItems.push({
          itemName: fullName,
          unit: template.unit || "LUMPSUM",
          price: price,
          promoPrice: promoPrice > 0 ? promoPrice : null,
        });
      }
    });
  });

  return parsedItems;
}

/**
 * 2. BULK IMPORT KE DATABASE
 * Menyimpan data hasil parse/konfirmasi ke SupplierItem dan SupplierPriceHistory
 */
async function bulkImportPrices(supplierId, periodMonth, periodYear, items) {
  let countBaru = 0;
  let countUpdate = 0;

  // Tarik data barang yang sudah ada di supplier ini untuk membedakan Insert vs Update
  const existingItems = await prisma.supplierItem.findMany({
    where: { supplierId: supplierId },
    select: { id: true, itemName: true },
  });

  // Buat Map agar pencarian lebih cepat (O(1))
  const existingMap = new Map();
  existingItems.forEach((item) => {
    existingMap.set(item.itemName.toLowerCase(), item.id);
  });

  // Gunakan Transaction agar proses database aman (jika error 1, batal semua)
  await prisma.$transaction(async (tx) => {
    for (const item of items) {
      const namaUnik = item.itemName.toLowerCase();
      let supplierItemId;

      if (existingMap.has(namaUnik)) {
        // BARANG LAMA -> Update harga saat ini
        supplierItemId = existingMap.get(namaUnik);
        await tx.supplierItem.update({
          where: { id: supplierItemId },
          data: {
            currentPrice: item.price,
            currentPromoPrice: item.promoPrice || null,
            unit: item.unit,
          },
        });
        countUpdate++;
      } else {
        // BARANG BARU -> Create item baru
        const newItem = await tx.supplierItem.create({
          data: {
            supplierId: supplierId,
            itemName: item.itemName,
            unit: item.unit,
            currentPrice: item.price,
            currentPromoPrice: item.promoPrice || null,
          },
        });
        supplierItemId = newItem.id;
        countBaru++;
      }

      // Selalu catat di riwayat harga (Price History) untuk bulan & tahun tersebut
      await tx.supplierPriceHistory.create({
        data: {
          supplierItemId: supplierItemId,
          price: item.price,
          promoPrice: item.promoPrice || null,
          periodMonth: Number(periodMonth),
          periodYear: Number(periodYear),
        },
      });
    }
  });

  return {
    totalProcessed: items.length,
    countBaru,
    countUpdate,
  };
}

module.exports = {
  parseByTemplate,
  bulkImportPrices,
};
