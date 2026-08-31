"use strict";
const PDFDocument = require("pdfkit");
const path = require("path");
const fs = require("fs");

function formatDateId(dateObj) {
  if (!dateObj) return "";
  const months = [
    "Januari",
    "Februari",
    "Maret",
    "April",
    "Mei",
    "Juni",
    "Juli",
    "Agustus",
    "September",
    "Oktober",
    "November",
    "Desember",
  ];
  const d = new Date(dateObj);
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function streamBastPdf(bast, res) {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 40, bottom: 40, left: 40, right: 40 },
  });

  doc.pipe(res);

  const margin = 40;
  const contentWidth = doc.page.width - 2 * margin;
  const pageBottom = doc.page.height - margin;
  let y = margin;

  // ==========================================
  // 1. HEADER PERUSAHAAN (KOP SURAT)
  // ==========================================
  try {
    const logoPath = path.join(process.cwd(), "public/assets/dives.png");
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, margin, y, { fit: [100, 40] });
    } else {
      throw new Error("Logo not found");
    }
  } catch (err) {
    doc.font("Times-Bold").fontSize(18).text("IVES", margin, y);
    doc
      .font("Times-Roman")
      .fontSize(8)
      .text("INTERIOR CONTRACTOR", margin, y + 20);
  }

  const companyBoxX = margin + 140;
  const companyBoxWidth = contentWidth - 140 - 160; // stop sebelum kolom telepon/email

  doc
    .font("Times-Bold")
    .fontSize(12)
    .text("PT. DIVES JAYA PERKASA", margin, y, {
      align: "right",
      width: contentWidth,
    });
  doc
    .font("Times-Roman")
    .fontSize(9)
    .text("Jl. Bulak Rukem Timur I No. 160 Surabaya", margin, y + 15, {
      align: "right",
      width: contentWidth,
    });

  doc
    .font("Times-Roman")
    .fontSize(10)
    .text("0818-813-134", margin, y + 27, {
      align: "right",
      width: contentWidth,
    });
  doc.fillColor("blue").text("djp.incon@gmail.com", margin, y + 37, {
    align: "right",
    width: contentWidth,
    underline: true,
  });
  doc.fillColor("black");

  y += 50;
  doc
    .moveTo(margin, y)
    .lineTo(margin + contentWidth, y)
    .lineWidth(2)
    .stroke();
  y += 5;

  // ==========================================
  // 2. JUDUL BERITA ACARA (Dalam Kotak)
  // ==========================================
  const titleBoxHeight = 30;
  doc.rect(margin, y, contentWidth, titleBoxHeight).lineWidth(1.5).stroke();
  doc
    .rect(margin + 2, y + 2, contentWidth - 4, titleBoxHeight - 4)
    .lineWidth(0.5)
    .stroke();

  doc
    .font("Times-Bold")
    .fontSize(12)
    .text("BERITA ACARA SERAH TERIMA PEKERJAAN", margin, y + 10, {
      align: "center",
      width: contentWidth,
    });

  y += titleBoxHeight + 15;

  // ==========================================
  // 3. INFORMASI PROYEK
  // ==========================================
  const col1 = margin;
  const col2 = margin + 120;
  doc.font("Times-Roman").fontSize(9);

  const projectData = [
    ["NO. BAST", ": " + (bast.bastNumber || "-")],
    ["NAMA PROYEK", ": " + (bast.project?.name || "-")],
    ["ALAMAT PROYEK", ": " + (bast.project?.location || "-")],
    ["PEMBERI TUGAS", ": " + (bast.pihakPertamaName || "-")],
    ["KONTRAKTOR", ": " + (bast.pihakKeduaName || "-")],
    ["NO. SPK", ": " + (bast.spkNumber || "-")],
  ];

  projectData.forEach(([label, value]) => {
    doc.text(label, col1, y);
    doc.text(value, col2, y);
    y += 12;
  });

  y += 15;
  doc
    .moveTo(margin, y)
    .lineTo(margin + contentWidth, y)
    .lineWidth(0.5)
    .stroke();
  y += 15;

  // ==========================================
  // 4. PARAGRAF PERNYATAAN
  // ==========================================
  const formattedDate = formatDateId(bast.handoverDate);

  doc.text(`Pada hari ini, ${formattedDate}`, margin, y);
  y += 12;
  doc.text("kami yang bertanda tangan di bawah ini :", margin, y);
  y += 20;

  doc.text(`1.   ${bast.pihakPertamaName || "-"}`, margin, y);
  doc.text(
    `:   Sebagai pihak pertama ( ${bast.pihakPertamaPosition || "Pemberi Tugas"} )`,
    margin + 150,
    y,
  );
  y += 12;
  doc.text(`2.   ${bast.pihakKeduaName || "-"}`, margin, y);
  doc.text(
    `:   Sebagai pihak kedua ( ${bast.pihakKeduaPosition || "Penerima Pekerjaan"} )`,
    margin + 150,
    y,
  );
  y += 25;

  doc.text(
    "Dengan ini telah mengadakan pemeriksaan dan penelitian bersama dan dengan ini menyatakan sepakat bahwa progress ",
    margin,
    y,
    { align: "justify" },
  );

  y = doc.y + 2;

  doc
    .font("Times-Roman")
    .text("pekerjaan telah ", margin, y, { continued: true, align: "left" })
    .font("Times-BoldItalic")
    .text(
      bast.statusText || "SELESAI DIKERJAKAN 100% dan DITERIMA DENGAN BAIK",
      { continued: true },
    )
    .font("Times-Roman")
    .text(".", { continued: false });

  y = doc.y + 2;

  doc.text(
    "Sebagai data pendukung kami menyertakan lampiran berupa foto hasil pekerjaan :",
    margin,
    y,
  );
  y += 15;

  // ==========================================
  // 5. FOTO HASIL PEKERJAAN (grid tinggi dinamis + pagination)
  // ==========================================
  doc.rect(margin, y, contentWidth, 20).fillAndStroke("#e0e0e0", "black");
  doc
    .fillColor("black")
    .font("Times-Bold")
    .text("FOTO HASIL PEKERJAAN", margin, y + 6, {
      align: "center",
      width: contentWidth,
    });

  y += 20;
  const photos = bast.photos || [];

  // 👇 CAVEMAN KECILKAN UKURANNYA DI SINI 👇
  const photoCols = 4; // Asalnya 3, sekarang 4 foto berjejer
  const gap = 8; // Asalnya 10, dirapatkan sedikit
  const innerPad = 8; // Asalnya 10
  const maxPhotoW =
    (contentWidth - 2 * innerPad - gap * (photoCols - 1)) / photoCols;
  const maxPhotoH = 120; // Asalnya 180! Caveman potong drastis biar pendek!
  const rowHeight = maxPhotoH + gap;
  // 👆 =================================== 👆

  // Berapa baris muat di sisa halaman sekarang (minus border+pad atas/bawah)
  function rowsThatFit(startY) {
    const avail = pageBottom - startY - 2 * innerPad;
    return Math.max(1, Math.floor((avail + gap) / rowHeight));
  }

  let photoIndex = 0;
  while (photoIndex < photos.length || photoIndex === 0) {
    const remainingPhotos = photos.length - photoIndex;
    const remainingRows = Math.ceil(remainingPhotos / photoCols) || 1;
    const fitRows = rowsThatFit(y);
    const rowsThisBox =
      photos.length === 0 ? 1 : Math.min(remainingRows, fitRows);
    const boxHeight = rowsThisBox * rowHeight - gap + 2 * innerPad;

    const startPhotoY = y;
    doc
      .rect(margin, startPhotoY, contentWidth, boxHeight)
      .lineWidth(1)
      .stroke();
    doc
      .rect(margin + 2, startPhotoY + 2, contentWidth - 4, boxHeight - 4)
      .lineWidth(2)
      .stroke();

    let currentX = margin + innerPad;
    let currentY = startPhotoY + innerPad;
    let placedInBox = 0;

    while (
      placedInBox < rowsThisBox * photoCols &&
      photoIndex < photos.length
    ) {
      const photo = photos[photoIndex];
      if (placedInBox > 0 && placedInBox % photoCols === 0) {
        currentX = margin + innerPad;
        currentY += rowHeight;
      }
      try {
        const imagePath = path.join(process.cwd(), "public", photo.url);
        if (fs.existsSync(imagePath)) {
          doc.image(imagePath, currentX, currentY, {
            fit: [maxPhotoW, maxPhotoH],
            align: "center",
            valign: "center",
          });
          doc
            .rect(currentX, currentY, maxPhotoW, maxPhotoH)
            .lineWidth(0.5)
            .stroke("#cccccc");
        }
      } catch (e) {
        console.error("Gagal load foto BAST PDF:", e);
      }
      currentX += maxPhotoW + gap;
      placedInBox += 1;
      photoIndex += 1;
    }

    y = startPhotoY + boxHeight + 15;

    if (photoIndex < photos.length) {
      doc.addPage();
      y = margin;
    } else {
      break;
    }
  }
  // ==========================================
  // 6. PENUTUP & TANDA TANGAN
  // ==========================================
  if (y + 100 > pageBottom) {
    doc.addPage();
    y = margin;
  }

  doc.font("Times-Roman").fontSize(9);
  doc.text(
    "Demikian Berita Acara ini dibuat dan ditandatangani dengan sesungguhnya untuk dipergunakan sebagaimana mestinya.",
    margin,
    y,
  );

  y += 20;

  doc.font("Times-Bold");
  doc.text(`Surabaya, ${formattedDate}`, margin, y, {
    align: "center",
    width: contentWidth,
  });

  y += 25;

  doc.text("Kontraktor", margin, y);
  doc.text("PT. DIVES JAYA PERKASA", margin, y + 12);

  doc.text("Pemberi Tugas", margin, y, { align: "right", width: contentWidth });
  doc.text("PROJECT OWNER", margin, y + 12, {
    align: "right",
    width: contentWidth,
  });

  y += 70;

  doc.text(bast.pihakKeduaName || "-", margin, y);
  doc.text(bast.pihakPertamaName || "-", margin, y, {
    align: "right",
    width: contentWidth,
  });

  doc.end();
}

module.exports = { streamBastPdf };
