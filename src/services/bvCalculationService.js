"use strict";

/**
 * Hitung subTotal volume satu baris breakdown (P x L x T x luas x keliling x berat,
 * cuma yang dicentang yang dikaliin, dikali jumlah sisi/buah, dikali waste%).
 * Dipindah persis dari bv.routes.js — behavior tidak diubah.
 */
function calcBreakdownSubtotal(b) {
  const p = b.panjang != null && b.panjang !== "" ? Number(b.panjang) : 0;
  const l = b.lebar != null && b.lebar !== "" ? Number(b.lebar) : 0;
  const t = b.tinggi != null && b.tinggi !== "" ? Number(b.tinggi) : 0;
  const luas = b.luas != null && b.luas !== "" ? Number(b.luas) : 0;
  const keliling =
    b.keliling != null && b.keliling !== "" ? Number(b.keliling) : 0;
  const berat = b.berat != null && b.berat !== "" ? Number(b.berat) : 0;

  let baseVolume = 1;
  let adaYangDicentang = false;

  if (b.isPChecked) {
    baseVolume *= p;
    adaYangDicentang = true;
  }
  if (b.isLChecked) {
    baseVolume *= l;
    adaYangDicentang = true;
  }
  if (b.isTChecked) {
    baseVolume *= t;
    adaYangDicentang = true;
  }
  if (b.isLuasChecked) {
    baseVolume *= luas;
    adaYangDicentang = true;
  }
  if (b.isKelChecked) {
    baseVolume *= keliling;
    adaYangDicentang = true;
  }
  if (b.isBeratChecked) {
    baseVolume *= berat;
    adaYangDicentang = true;
  }

  if (!adaYangDicentang) {
    baseVolume = 1;
  }

  const s =
    b.jumlahSisi != null && b.jumlahSisi !== "" ? Number(b.jumlahSisi) : 1;
  const bh = b.jumlahBh != null && b.jumlahBh !== "" ? Number(b.jumlahBh) : 1;
  const totalJumlah = s * bh;

  const w = b.waste != null && b.waste !== "" ? Number(b.waste) / 100 : 0;
  const wasteMultiplier = 1 + w;

  return baseVolume * totalJumlah * wasteMultiplier;
}

/**
 * Bentuk array breakdown mentah dari request jadi row siap simpan ke Prisma,
 * sekalian hitung subTotal tiap baris. Dipindah persis dari bv.routes.js.
 */
function buildBreakdownRows(breakdowns) {
  return breakdowns.map((b) => {
    const subTotal = calcBreakdownSubtotal(b);
    return {
      keterangan: b.keterangan || null,

      panjang: b.panjang ?? null,
      isPChecked: !!b.isPChecked,

      lebar: b.lebar ?? null,
      isLChecked: !!b.isLChecked,

      tinggi: b.tinggi ?? null,
      isTChecked: !!b.isTChecked,

      luas: b.luas ?? null,
      isLuasChecked: !!b.isLuasChecked,

      keliling: b.keliling ?? null,
      isKelChecked: !!b.isKelChecked,

      berat: b.berat ?? null,
      isBeratChecked: !!b.isBeratChecked,

      diameter: b.diameter ?? null,
      jumlahSisi: b.jumlahSisi ?? null,
      jumlahBh: b.jumlahBh ?? null,
      waste: b.waste ?? null,

      subTotal,
    };
  });
}

/**
 * Tandai satu BvItem (dan children-nya, rekursif) dengan linkStatus:
 * BELUM_DILINK / SUDAH_DILINK / BELUM_SINKRON.
 * Dipindah persis dari fungsi withStatus() lokal di GET /projects/:projectId/bv-items.
 */
function withStatus(it) {
  let status = "BELUM_DILINK";

  if (it.linkedRabItem) {
    let same = false;

    if (it.isHeaderOnly) {
      same = it.name === it.linkedRabItem.name;
    } else {
      same =
        Number(it.totalVolume) === Number(it.linkedRabItem.volume) &&
        it.name === it.linkedRabItem.name &&
        it.paymentUnit === it.linkedRabItem.paymentUnit;
    }

    status = same ? "SUDAH_DILINK" : "BELUM_SINKRON";
  }

  return {
    ...it,
    linkStatus: status,
    children: (it.children || []).map(withStatus),
  };
}

module.exports = {
  calcBreakdownSubtotal,
  buildBreakdownRows,
  withStatus,
};
