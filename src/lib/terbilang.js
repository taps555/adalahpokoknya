'use strict';

const SATUAN = [
  '',
  'Satu',
  'Dua',
  'Tiga',
  'Empat',
  'Lima',
  'Enam',
  'Tujuh',
  'Delapan',
  'Sembilan',
  'Sepuluh',
  'Sebelas',
];

function angkaKeKata(n) {
  const num = Math.floor(Math.abs(Number(n) || 0));
  if (num === 0) return '';
  if (num < 12) return SATUAN[num];
  if (num < 20) return `${angkaKeKata(num - 10)} Belas`.trim();
  if (num < 100) {
    const sisa = num % 10;
    return `${angkaKeKata(Math.floor(num / 10))} Puluh ${sisa ? angkaKeKata(sisa) : ''}`.trim();
  }
  if (num < 200) {
    const sisa = num - 100;
    return `Seratus ${sisa ? angkaKeKata(sisa) : ''}`.trim();
  }
  if (num < 1000) {
    const sisa = num % 100;
    return `${angkaKeKata(Math.floor(num / 100))} Ratus ${sisa ? angkaKeKata(sisa) : ''}`.trim();
  }
  if (num < 2000) {
    const sisa = num - 1000;
    return `Seribu ${sisa ? angkaKeKata(sisa) : ''}`.trim();
  }
  if (num < 1000000) {
    const ribu = Math.floor(num / 1000);
    const sisa = num % 1000;
    return `${angkaKeKata(ribu)} Ribu ${sisa ? angkaKeKata(sisa) : ''}`.trim();
  }
  if (num < 1000000000) {
    const juta = Math.floor(num / 1000000);
    const sisa = num % 1000000;
    return `${angkaKeKata(juta)} Juta ${sisa ? angkaKeKata(sisa) : ''}`.trim();
  }
  if (num < 1000000000000) {
    const milyar = Math.floor(num / 1000000000);
    const sisa = num % 1000000000;
    return `${angkaKeKata(milyar)} Milyar ${sisa ? angkaKeKata(sisa) : ''}`.trim();
  }
  const triliun = Math.floor(num / 1000000000000);
  const sisa = num % 1000000000000;
  return `${angkaKeKata(triliun)} Triliun ${sisa ? angkaKeKata(sisa) : ''}`.trim();
}

function terbilangRupiah(amount) {
  const num = Math.round(Number(amount) || 0);
  if (num === 0) return 'Nol Rupiah';
  const kata = angkaKeKata(num);
  return `${kata} Rupiah`.replace(/\s+/g, ' ').trim();
}

module.exports = {
  angkaKeKata,
  terbilangRupiah,
};
