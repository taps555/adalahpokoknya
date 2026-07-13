# HSPK/AHSP Importer — Setup

Panduan setup project ini di laptop/environment baru.

## 1. Install dependencies

```bash
npm install
```

## 2. Setup environment variable

Buat file `.env` di root project:

```
DATABASE_URL="postgresql://user:password@localhost:5432/nama_db"
```

Sesuaikan `user`, `password`, dan `nama_db` dengan PostgreSQL yang terpasang di laptop ini.

## 3. Pastikan PostgreSQL jalan & database sudah dibuat

```bash
psql -U postgres -c "CREATE DATABASE nama_db;"
```

## 4. Generate Prisma Client

```bash
npx prisma generate
```

Wajib dijalankan setiap kali `node_modules` baru (fresh install) atau setelah pindah environment.

## 5. Sync schema ke database

Pilih salah satu sesuai kondisi:

**A. Kalau folder `prisma/migrations` sudah ada (ikut ter-commit di git):**

```bash
npx prisma migrate deploy
```

**B. Kalau belum ada migration history / mau langsung push schema apa adanya:**

```bash
npx prisma db push
```



## 6. Jalankan server

```bash
node server.js
```

atau, kalau ada script dev (nodemon):

```bash
npm run dev
```

Server akan jalan di `http://localhost:4000`.

## 7. Kalau ada perubahan schema baru (mis. menambah model `RabItem`)

Setelah edit `schema.prisma`:

```bash
npx prisma migrate dev --name nama_perubahan
```

Ini akan generate migration baru sekaligus apply ke database secara otomatis.

## Troubleshooting singkat

| Masalah | Kemungkinan penyebab |
|---|---|
| `Environment variable not found: DATABASE_URL` | File `.env` belum dibuat / salah lokasi (harus di root project) |
| `Can't reach database server` | PostgreSQL belum jalan, atau host/port di `DATABASE_URL` salah |
| `Prisma Client not generated` / error import `@prisma/client` | Lupa jalankan `npx prisma generate` |
| Tabel tidak ditemukan / kolom tidak sesuai | Schema belum di-sync — jalankan `npx prisma db push` atau `migrate deploy` |
