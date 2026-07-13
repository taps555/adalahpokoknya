# HSPK/AHSP Importer

Import data **HSPK** (Harga Satuan Pokok Kegiatan) & **AHSP** (Analisa Harga
Satuan Pekerjaan) dari file **PDF atau Excel** langsung ke PostgreSQL lewat
Prisma. Dibuat supaya saat harga satuan berubah tiap tahun (seperti pada
dokumen HSPK Surabaya), kamu tinggal **upload file baru** — tidak perlu ubah
kode atau migrasi manual satu-satu.

## Kenapa didesain begini?

Dokumen HSPK/AHSP biasanya berupa PDF/Excel dengan format semi-terstruktur:

```
Jenis Pekerjaan = Pemasangan 1 m2 Dinding Bata Merah
Satuan Pembayaran = m2
A. TENAGA KERJA
Pekerja            OH    0.6    150,000  Rp
Tukang Batu        OH    0.2    150,000  Rp
B. BAHAN
Batu Bata Merah    buah  140    600      Rp
...
```

Ini bukan tabel rapi (kolom PDF sering nyatu jadi teks, ada nilai `#REF!`,
satuan macam-macam, dst). Karena itu importer ini:

1. **Tidak** mengasumsikan struktur kolom Excel yang kaku — Excel & PDF
   diproses lewat parser teks yang sama (state machine), plus fast-path
   kolom untuk sheet Excel yang memang sudah rapi.
2. **Tidak pernah diam-diam membuang** baris yang gagal di-parse — semua
   dicatat di tabel `UploadIssue` supaya bisa ditinjau & dikoreksi manual
   lewat endpoint `/api/uploads/:id/issues`.
3. **Versioning per tahun (`period`)** — setiap `PriceItem` & `JobType`
   unik per `(nama, satuan, tahun)`, jadi data 2025 tidak tertimpa saat kamu
   upload HSPK 2026. Upload ulang tahun yang sama = update (upsert), aman
   dijalankan berkali-kali.
4. **Total harga AHSP dihitung, bukan disimpan mentah** — karena dokumen
   sumber sering tidak mencantumkan angka total ("Jumlah Harga Satuan
   Pekerjaan" ada labelnya tapi kosong nilainya). Dihitung on-the-fly dari
   `Σ (koefisien × harga satuan)` lewat `calculateService.js`.

## Setup

```bash
npm install
cp .env.example .env
# isi DATABASE_URL di .env dengan koneksi PostgreSQL kamu

npx prisma migrate dev --name init
npm run dev
```

Server jalan di `http://localhost:4000`.

## API

### 1. Upload file (PDF atau Excel)

```bash
curl -X POST http://localhost:4000/api/upload \
  -F "file=@hspk-surabaya-2026.pdf" \
  -F "period=2026"
```

Response:
```json
{
  "message": "Import selesai.",
  "batchId": "clx...",
  "status": "PARTIAL",
  "priceItemCount": 214,
  "jobTypeCount": 87,
  "issueCount": 6,
  "reviewUrl": "/api/uploads/clx.../issues"
}
```

`status`:
- `SUCCESS` — semua baris berhasil di-parse.
- `PARTIAL` — sebagian berhasil, ada baris yang perlu ditinjau manual (lihat `reviewUrl`).
- `FAILED` — proses import gagal total (cek `errorMessage` di `/api/uploads`).

### 2. Riwayat upload

```
GET /api/uploads
GET /api/uploads/:id/issues
```

### 3. Data AHSP

```
GET /api/jobs?period=2026&q=dinding&category=PEKERJAAN%20DINDING
GET /api/jobs/:id          # detail + breakdown harga + total terhitung
```

### 4. Daftar harga dasar (bahan/upah/alat)

```
GET /api/price-items?period=2026&type=BAHAN&q=semen
```

## Struktur data (Prisma)

- `PriceItem` — harga satuan bahan/upah/alat, unik per `(type, name, unit, period)`.
- `JobType` — satu jenis pekerjaan AHSP, unik per `(name, paymentUnit, period)`.
- `JobComponent` — baris koefisien yang menghubungkan `JobType` ↔ `PriceItem`.
- `UploadBatch` — riwayat & ringkasan tiap upload.
- `UploadIssue` — baris mentah yang gagal di-parse otomatis, untuk tinjauan manual.

## Batasan & catatan jujur

Parser ini heuristik, bukan OCR/AI, jadi:

- PDF dengan tata letak 2 kolom kadang membuat dua baris item "nyatu" jadi
  satu baris teks. Sudah ditangani sebagian (split di setiap kemunculan
  `Rp`), tapi kasus ekstrem tetap bisa lolos ke `UploadIssue` — cek endpoint
  review setelah tiap upload, terutama untuk file baru yang formatnya belum
  pernah dicoba.
- Baris dengan nilai `#REF!`, `#N/A`, atau kosong (biasanya bekas rumus
  Excel yang rusak) tidak dipaksakan diisi angka — akan tersimpan sebagai
  komponen tanpa harga dan dicatat di `UploadIssue`, supaya kamu koreksi
  manual harga aslinya.
- Kalau format dokumen HSPK tahun depan berubah cukup drastis (kolom baru,
  urutan beda total), sesuaikan pola regex di `src/parsers/textStateParser.js`
  — semua pola dikumpulkan di bagian atas file itu supaya gampang di-tweak
  tanpa bongkar seluruh state machine.
- Untuk file yang sangat besar (>1000 baris item), proses upsert dilakukan
  sekuensial (bukan satu big transaction) supaya tidak kena transaction
  timeout Prisma — trade-off-nya sedikit lebih lambat tapi jauh lebih aman.

## Menambah field baru

Kalau suatu saat butuh field tambahan (mis. kode SNI per komponen, atau
wilayah selain Surabaya), tambahkan kolom di `prisma/schema.prisma`, jalankan
`npx prisma migrate dev`, lalu sesuaikan `importService.js`.
