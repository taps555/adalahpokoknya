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

  const pageBottom = doc.page.height;

  // Draw borders on first page
  doc
    .rect(20, 20, doc.page.width - 40, doc.page.height - 40)
    .lineWidth(2)
    .stroke("black");
  doc
    .rect(23, 23, doc.page.width - 46, doc.page.height - 46)
    .lineWidth(0.5)
    .stroke("black");

  // Automatically draw borders on new pages
  doc.on("pageAdded", () => {
    doc
      .rect(20, 20, doc.page.width - 40, doc.page.height - 40)
      .lineWidth(2)
      .stroke("black");
    doc
      .rect(23, 23, doc.page.width - 46, doc.page.height - 46)
      .lineWidth(0.5)
      .stroke("black");
  });

  let y = 35; // Start a bit below the top border

  // ==========================================
  // 1. HEADER PERUSAHAAN (KOP SURAT)
  // ==========================================
  try {
    const logoPath = path.join(process.cwd(), "public/assets/dives.png");
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 35, y, { fit: [150, 60] });
    } else {
      throw new Error("Logo not found");
    }
  } catch (err) {
    doc.font("Times-Bold").fontSize(24).text("IVES", 35, y);
    doc
      .font("Times-Roman")
      .fontSize(9)
      .text("INTERIOR CONTRACTOR", 35, y + 25);
  }

  const contentW = doc.page.width - 70;

  doc
    .font("Times-Bold")
    .fontSize(11)
    .text("PT.DIVES JAYA PERKASA", 35, y, { align: "right", width: contentW });
  doc
    .font("Times-Roman")
    .fontSize(10)
    .text("Jl. Bulak Rukem Timur I No. 160 Surabaya", 35, y + 15, {
      align: "right",
      width: contentW,
    });
  doc
    .font("Times-Roman")
    .fontSize(10)
    .text("0818-813-134", 35, y + 30, { align: "right", width: contentW });
  doc
    .fillColor("blue")
    .text("djp.incon@gmail.com", 35, y + 45, {
      align: "right",
      width: contentW,
      underline: true,
    });
  doc.fillColor("black");

  y += 70;
  // Thick horizontal line below header
  doc
    .moveTo(23, y)
    .lineTo(doc.page.width - 23, y)
    .lineWidth(2)
    .stroke();
  y += 2;

  // ==========================================
  // 2. JUDUL BERITA ACARA (Dalam Kotak Grey)
  // ==========================================
  const titleBoxHeight = 30;
  doc
    .rect(23, y, doc.page.width - 46, titleBoxHeight)
    .fillAndStroke("#cccccc", "black")
    .lineWidth(1);

  doc
    .fillColor("black")
    .font("Times-Bold")
    .fontSize(12)
    .text("BERITA ACARA SERAH TERIMA PEKERJAAN", 23, y + 10, {
      align: "center",
      width: doc.page.width - 46,
    });

  y += titleBoxHeight;

  // Line below title
  doc
    .moveTo(23, y)
    .lineTo(doc.page.width - 23, y)
    .lineWidth(2)
    .stroke();
  y += 2;

  // ==========================================
  // 3. INFORMASI PROYEK
  // ==========================================
  y += 5; // padding top
  const col1 = 35;
  const col2 = 180;
  doc.font("Times-Roman").fontSize(9);

  const projectData = [
    ["NO. BAST", ":  " + (bast.bastNumber || "-")],
    ["NAMA PROYEK", ":  " + (bast.project?.name || "-")],
    ["ALAMAT PROYEK", ":  " + (bast.project?.location || "-")],
    ["PEMBERI TUGAS", ":  " + (bast.pihakPertamaName || "-")],
    ["KONTRAKTOR", ":  PT. DIVES JAYA PERKASA"],
    ["NO. SPK", ":  " + (bast.spkNumber || "-")],
  ];

  projectData.forEach(([label, value]) => {
    doc.text(label, col1, y);
    doc.text(value, col2, y);
    y += 12;
  });

  y += 5;
  // Line below info project
  doc
    .moveTo(23, y)
    .lineTo(doc.page.width - 23, y)
    .lineWidth(2)
    .stroke();
  y += 2;

  // ==========================================
  // 4. PARAGRAF PERNYATAAN
  // ==========================================
  y += 15;
  const formattedDate = formatDateId(bast.handoverDate);
  const leftMargin = 35;

  doc.text(`Pada hari ini, ${formattedDate}`, leftMargin, y);
  y += 12;
  doc.text("kami yang bertanda tangan di bawah ini :", leftMargin, y);
  y += 20;

  doc.text(`1.   ${bast.pihakPertamaName || "-"}`, leftMargin, y);
  doc.text(`:   Sebagai pihak pertama ( Pemberi Tugas )`, leftMargin + 160, y);
  y += 12;
  doc.text(`2.   ${bast.pihakKeduaName || "-"}`, leftMargin, y);
  doc.text(
    `:   Sebagai pihak kedua ( Penerima Pekerjaan )`,
    leftMargin + 160,
    y,
  );
  y += 20;

  doc
    .text(
      "Dengan ini telah mengadakan pemeriksaan dan penelitian bersama dan dengan ini menyatakan sepakat bahwa progress pekerjaan ",
      leftMargin,
      y,
      { continued: true, align: "left", width: contentW },
    )
    .font("Times-BoldItalic")
    .text(
      "telah " +
        (bast.statusText || "SELESAI DIKERJAKAN 100% dan DITERIMA DENGAN BAIK"),
      { continued: false },
    );

  y = doc.y + 10;
  doc
    .font("Times-Roman")
    .text(
      "Sebagai data pendukung kami menyertakan lampiran berupa foto hasil pekerjaan :",
      leftMargin,
      y,
    );
  y += 15;

  // ==========================================
  // 5. FOTO HASIL PEKERJAAN
  // ==========================================
  const startPhotoY = y;
  const photos = bast.photos || [];

  // Grid layout logic
  const photoCols = 3;
  const gap = 10;
  const innerPad = 10;
  const maxPhotoW =
    (contentW - 2 * innerPad - gap * (photoCols - 1)) / photoCols;
  const baseMaxPhotoH = 140;
  const baseRowHeight = baseMaxPhotoH + gap;

  // Let 45 be the bottom margin (to leave a tiny 5px gap before the 40px bottom border)
  let photoIndex = 0;
  while (photoIndex < photos.length || photoIndex === 0) {
    const maxBoxHeight = pageBottom - 45 - y;
    const availPhotoAreaHeight = maxBoxHeight - 20 - 2 * innerPad; // 20 is header height

    // How many rows can fit with the base height?
    const fitRows = Math.max(
      1,
      Math.floor((availPhotoAreaHeight + gap) / baseRowHeight),
    );

    const remainingPhotos = photos.length - photoIndex;
    const remainingRows = Math.ceil(remainingPhotos / photoCols) || 1;

    // If the photos take up the rest of the page (or more), we fill the exact maxBoxHeight
    // to prevent white space at the bottom.
    const isFullPage = remainingRows >= fitRows;
    const rowsThisBox = isFullPage ? fitRows : remainingRows;

    // Dynamically calculate rowHeight and maxPhotoH for this box
    let currentMaxPhotoH = baseMaxPhotoH;
    let currentRowHeight = baseRowHeight;
    let totalBoxHeight;

    if (isFullPage) {
      // Stretch rows to fill the available area exactly
      currentRowHeight = (availPhotoAreaHeight + gap) / rowsThisBox;
      currentMaxPhotoH = currentRowHeight - gap;
      totalBoxHeight = maxBoxHeight;
    } else {
      // Just use the base height for a partial box
      const photoAreaHeight = rowsThisBox * baseRowHeight - gap + 2 * innerPad;
      totalBoxHeight = 20 + photoAreaHeight;
    }

    // Outer thick border for photo box
    doc
      .rect(leftMargin, y, contentW, totalBoxHeight)
      .lineWidth(1.5)
      .stroke("black");
    // Inner thin border for photo box
    doc
      .rect(leftMargin + 2, y + 2, contentW - 4, totalBoxHeight - 4)
      .lineWidth(0.5)
      .stroke("black");

    // Grey title bar for photos
    doc
      .rect(leftMargin + 3, y + 3, contentW - 6, 20)
      .fillAndStroke("#cccccc", "#cccccc");
    doc
      .fillColor("black")
      .font("Times-Bold")
      .fontSize(10)
      .text("FOTO HASIL PEKERJAAN", leftMargin, y + 9, {
        align: "center",
        width: contentW,
      });

    let currentX = leftMargin + innerPad;
    let currentY = y + 20 + innerPad; // Below header
    let placedInBox = 0;

    while (
      placedInBox < rowsThisBox * photoCols &&
      photoIndex < photos.length
    ) {
      const photo = photos[photoIndex];
      if (placedInBox > 0 && placedInBox % photoCols === 0) {
        currentX = leftMargin + innerPad;
        currentY += currentRowHeight;
      }
      try {
        const imagePath = path.join(process.cwd(), "public", photo.url);
        if (fs.existsSync(imagePath)) {
          doc.image(imagePath, currentX, currentY, {
            fit: [maxPhotoW, currentMaxPhotoH],
            align: "center",
            valign: "center",
          });
        }
      } catch (e) {
        console.error("Gagal load foto BAST PDF:", e);
      }
      currentX += maxPhotoW + gap;
      placedInBox += 1;
      photoIndex += 1;
    }

    y = y + totalBoxHeight + 20;

    if (photoIndex < photos.length) {
      doc.addPage();
      y = 45; // start near top, inside outer border
    } else {
      break;
    }
  }

  // ==========================================
  // 6. PENUTUP & TANDA TANGAN
  // ==========================================
  if (y + 130 > pageBottom - 40) {
    doc.addPage();
    y = 40;
  }

  doc.font("Times-Roman").fontSize(9);
  doc.text(
    "Demikian Berita Acara ini dibuat dan ditandatangani dengan sesungguhnya untuk dipergunakan sebagaimana mestinya.",
    leftMargin,
    y,
  );

  y += 20;

  doc.font("Times-Bold");
  doc.text(`Surabaya, ${formattedDate}`, leftMargin, y, {
    align: "center",
    width: contentW,
  });

  y += 20;

  doc.text("Kontraktor", leftMargin, y);
  doc.text("PT. DIVES JAYA PERKASA", leftMargin, y + 12);

  doc.text("Pemberi Tugas", leftMargin, y, { align: "right", width: contentW });
  doc.text("PROJECT OWNER", leftMargin, y + 12, {
    align: "right",
    width: contentW,
  });

  y += 70;

  doc.text(bast.pihakKeduaName || "-", leftMargin, y);
  doc.text(bast.pihakPertamaName || "-", leftMargin, y, {
    align: "right",
    width: contentW,
  });

  doc.end();
}

module.exports = { streamBastPdf };
