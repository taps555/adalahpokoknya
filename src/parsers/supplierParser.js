const ExcelJS = require("exceljs");

/**
 * Fungsi untuk mem-parsing file Excel berdasarkan template mapping
 * @param {Buffer} fileBuffer - Buffer dari file excel yang diupload via Multer
 * @param {Object} template - Data SupplierImportTemplate dari database
 * @returns {Array} Array of parsed items
 */
async function parseByTemplate(fileBuffer, template) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileBuffer);

  // Asumsi data selalu ada di Sheet pertama
  const worksheet = workbook.worksheets[0];

  let currentCategory = "Kategori Umum";
  const parsedItems = [];

  // Helper untuk membersihkan format harga (buang "Rp", titik, koma)
  const parsePrice = (val) => {
    if (!val) return 0;
    if (typeof val === "number") return val;
    // Ambil hasil formula jika berupa object
    if (typeof val === "object") val = val.result || val.text || 0;

    const cleanStr = String(val).replace(/[^0-9]/g, "");
    return Number(cleanStr) || 0;
  };

  // Helper untuk membersihkan teks
  const parseText = (val) => {
    if (!val) return "";
    if (typeof val === "object")
      return String(
        val.result || val.text || val.richText?.[0]?.text || "",
      ).trim();
    return String(val).trim();
  };

  worksheet.eachRow((row, rowNumber) => {
    // 1. Skip baris sebelum headerRow
    if (rowNumber < template.headerRow) return;

    // 2. Ambil nilai dari masing-masing kolom sesuai huruf di template
    const catValue = row.getCell(template.categoryCol).value;
    const sizeValue = row.getCell(template.sizeCol).value;
    const priceValue = row.getCell(template.priceCol).value;
    const promoValue = template.promoCol
      ? row.getCell(template.promoCol).value
      : null;

    // 3. LOGIKA CARRY-FORWARD KATEGORI (Handle Merged Cells)
    const rowCategory = parseText(catValue);
    if (rowCategory) {
      currentCategory = rowCategory;
    }

    // 4. Skip kalau tidak ada ukuran/nama dan harga (berarti cuma baris judul kategori)
    if (!sizeValue && !priceValue) return;

    // 5. Eksekusi Baris Barang
    const itemNameRaw = parseText(sizeValue);
    const price = parsePrice(priceValue);
    const promoPrice = parsePrice(promoValue);

    if (price > 0 && itemNameRaw) {
      // Gabungkan Kategori dan Ukuran agar nama barang jadi unik/jelas di DB
      // Contoh: "Besi Beton" + "8 mm" => "Besi Beton 8 mm"
      const fullName = currentCategory
        ? `${currentCategory} - ${itemNameRaw}`
        : itemNameRaw;

      parsedItems.push({
        itemName: fullName,
        unit: template.unit,
        price: price,
        promoPrice: promoPrice > 0 ? promoPrice : null,
      });
    }
  });

  return parsedItems;
}

module.exports = { parseByTemplate };
