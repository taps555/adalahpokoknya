-- Align Finance/Purchasing schema with the models already defined in schema.prisma.
-- All new relationship columns are nullable so existing material transactions remain valid.

-- Required enums.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TipeAkunBukuBesar') THEN
    CREATE TYPE "TipeAkunBukuBesar" AS ENUM ('KAS', 'BANK');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'JenisTransaksiBukuBesar') THEN
    CREATE TYPE "JenisTransaksiBukuBesar" AS ENUM ('MASUK', 'KELUAR');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'KategoriItem') THEN
    CREATE TYPE "KategoriItem" AS ENUM ('BAHAN', 'ALAT');
  END IF;
END $$;

ALTER TYPE "KategoriPO" ADD VALUE IF NOT EXISTS 'JASA';
ALTER TYPE "MetodeBayar" ADD VALUE IF NOT EXISTS 'GIRO';
ALTER TYPE "MetodeBayar" ADD VALUE IF NOT EXISTS 'TEMPO';
ALTER TYPE "PembayaranStatus" ADD VALUE IF NOT EXISTS 'PARTIAL';
ALTER TYPE "PembayaranStatus" ADD VALUE IF NOT EXISTS 'BELUM_BAYAR';
ALTER TYPE "PembayaranStatus" ADD VALUE IF NOT EXISTS 'BON';
ALTER TYPE "PembayaranStatus" ADD VALUE IF NOT EXISTS 'LUNAS';
ALTER TYPE "SupplierType" ADD VALUE IF NOT EXISTS 'ALAT';
ALTER TYPE "SupplierType" ADD VALUE IF NOT EXISTS 'BAHAN_ALAT';

-- Master jasa and contract-value history.
CREATE TABLE IF NOT EXISTS "Jasa" (
  "id" TEXT NOT NULL,
  "seq" SERIAL NOT NULL,
  "code" TEXT,
  "nama" TEXT NOT NULL,
  "nilaiKontrak" DOUBLE PRECISION,
  "bank" TEXT,
  "noRekening" TEXT,
  "atasNama" TEXT,
  "kontakPerson" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Jasa_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Jasa_code_key" ON "Jasa"("code");
CREATE INDEX IF NOT EXISTS "Jasa_nama_idx" ON "Jasa"("nama");
CREATE INDEX IF NOT EXISTS "Jasa_isActive_idx" ON "Jasa"("isActive");

CREATE TABLE IF NOT EXISTS "JasaNilaiKontrak" (
  "id" TEXT NOT NULL,
  "jasaId" TEXT NOT NULL,
  "projectId" TEXT,
  "rabItemId" TEXT,
  "tanggal" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "nilaiKontrak" DOUBLE PRECISION NOT NULL,
  "keterangan" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JasaNilaiKontrak_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "JasaNilaiKontrak_jasaId_idx" ON "JasaNilaiKontrak"("jasaId");
CREATE INDEX IF NOT EXISTS "JasaNilaiKontrak_projectId_idx" ON "JasaNilaiKontrak"("projectId");
CREATE INDEX IF NOT EXISTS "JasaNilaiKontrak_tanggal_idx" ON "JasaNilaiKontrak"("tanggal");

-- Finance master tables.
CREATE TABLE IF NOT EXISTS "AkunBukuBesar" (
  "id" TEXT NOT NULL,
  "kodeAkun" TEXT,
  "namaAkun" TEXT NOT NULL,
  "tipeAkun" "TipeAkunBukuBesar" NOT NULL,
  "keterangan" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AkunBukuBesar_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AkunBukuBesar_kodeAkun_key" ON "AkunBukuBesar"("kodeAkun");
CREATE INDEX IF NOT EXISTS "AkunBukuBesar_tipeAkun_idx" ON "AkunBukuBesar"("tipeAkun");
CREATE UNIQUE INDEX IF NOT EXISTS "AkunBukuBesar_namaAkun_tipeAkun_key"
  ON "AkunBukuBesar"("namaAkun", "tipeAkun");

CREATE TABLE IF NOT EXISTS "MasterTipeRekening" (
  "id" TEXT NOT NULL,
  "namaTipe" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MasterTipeRekening_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MasterTipeRekening_namaTipe_key"
  ON "MasterTipeRekening"("namaTipe");
CREATE INDEX IF NOT EXISTS "MasterTipeRekening_isActive_idx"
  ON "MasterTipeRekening"("isActive");

CREATE TABLE IF NOT EXISTS "MasterRekeningBank" (
  "id" TEXT NOT NULL,
  "namaRekening" TEXT NOT NULL,
  "mataUang" TEXT NOT NULL DEFAULT 'IDR',
  "tipeRekeningId" TEXT,
  "namaBank" TEXT,
  "nomorRekening" TEXT NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MasterRekeningBank_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MasterRekeningBank_nomorRekening_key"
  ON "MasterRekeningBank"("nomorRekening");
CREATE INDEX IF NOT EXISTS "MasterRekeningBank_isActive_idx"
  ON "MasterRekeningBank"("isActive");
CREATE INDEX IF NOT EXISTS "MasterRekeningBank_isDefault_idx"
  ON "MasterRekeningBank"("isDefault");
CREATE INDEX IF NOT EXISTS "MasterRekeningBank_tipeRekeningId_idx"
  ON "MasterRekeningBank"("tipeRekeningId");

-- Additive changes to existing Purchasing tables.
ALTER TABLE "PurchaseOrder"
  ADD COLUMN IF NOT EXISTS "globalDiscount2Percent" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "jasaId" TEXT,
  ALTER COLUMN "supplierId" DROP NOT NULL;

ALTER TABLE "PengajuanPembayaran"
  ADD COLUMN IF NOT EXISTS "jasaId" TEXT,
  ALTER COLUMN "supplierId" DROP NOT NULL;

ALTER TABLE "PembayaranSupplier"
  ADD COLUMN IF NOT EXISTS "jasaId" TEXT,
  ADD COLUMN IF NOT EXISTS "jatuhTempo" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "paymentHistory" JSONB,
  ADD COLUMN IF NOT EXISTS "rekeningBankId" TEXT,
  ADD COLUMN IF NOT EXISTS "sisaBayar" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "tanggalBayar" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "tipeAkunKasBank" "TipeAkunBukuBesar" NOT NULL DEFAULT 'KAS',
  ADD COLUMN IF NOT EXISTS "tipeRekeningId" TEXT,
  ADD COLUMN IF NOT EXISTS "totalTagihan" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "totalTerbayar" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ALTER COLUMN "supplierId" DROP NOT NULL;

ALTER TABLE "SupplierItem"
  ADD COLUMN IF NOT EXISTS "kategori" "KategoriItem",
  ALTER COLUMN "supplierId" DROP NOT NULL;

CREATE INDEX IF NOT EXISTS "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");
CREATE INDEX IF NOT EXISTS "PurchaseOrder_jasaId_idx" ON "PurchaseOrder"("jasaId");
CREATE INDEX IF NOT EXISTS "PembayaranSupplier_rekeningBankId_idx"
  ON "PembayaranSupplier"("rekeningBankId");
CREATE INDEX IF NOT EXISTS "PembayaranSupplier_tipeRekeningId_idx"
  ON "PembayaranSupplier"("tipeRekeningId");

-- General-ledger transactions expected by Finance routes.
CREATE TABLE IF NOT EXISTS "BukuBesarTransaksi" (
  "id" TEXT NOT NULL,
  "tanggal" TIMESTAMP(3) NOT NULL,
  "tipeAkun" "TipeAkunBukuBesar" NOT NULL,
  "namaAkun" TEXT NOT NULL,
  "jenis" "JenisTransaksiBukuBesar" NOT NULL,
  "noReferensi" TEXT,
  "pihak" TEXT,
  "nominal" DOUBLE PRECISION NOT NULL,
  "keterangan" TEXT,
  "keteranganVolume" TEXT,
  "keteranganHarga" TEXT,
  "saldoBerjalan" DOUBLE PRECISION NOT NULL,
  "projectId" TEXT,
  "akunBukuBesarId" TEXT,
  "rekeningBankId" TEXT,
  "tipeRekeningId" TEXT,
  "sumberTransaksi" TEXT DEFAULT 'MANUAL',
  "poId" TEXT,
  "pengajuanId" TEXT,
  "pembayaranId" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BukuBesarTransaksi_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BukuBesarTransaksi_tipeAkun_idx" ON "BukuBesarTransaksi"("tipeAkun");
CREATE INDEX IF NOT EXISTS "BukuBesarTransaksi_tanggal_idx" ON "BukuBesarTransaksi"("tanggal");
CREATE INDEX IF NOT EXISTS "BukuBesarTransaksi_poId_idx" ON "BukuBesarTransaksi"("poId");
CREATE INDEX IF NOT EXISTS "BukuBesarTransaksi_pengajuanId_idx" ON "BukuBesarTransaksi"("pengajuanId");
CREATE INDEX IF NOT EXISTS "BukuBesarTransaksi_pembayaranId_idx" ON "BukuBesarTransaksi"("pembayaranId");
CREATE INDEX IF NOT EXISTS "BukuBesarTransaksi_projectId_idx" ON "BukuBesarTransaksi"("projectId");
CREATE INDEX IF NOT EXISTS "BukuBesarTransaksi_akunBukuBesarId_idx" ON "BukuBesarTransaksi"("akunBukuBesarId");
CREATE INDEX IF NOT EXISTS "BukuBesarTransaksi_rekeningBankId_idx" ON "BukuBesarTransaksi"("rekeningBankId");
CREATE INDEX IF NOT EXISTS "BukuBesarTransaksi_tipeRekeningId_idx" ON "BukuBesarTransaksi"("tipeRekeningId");

-- Foreign keys are added conditionally so the migration is safe for databases
-- that were previously synchronized with prisma db push.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JasaNilaiKontrak_jasaId_fkey') THEN
    ALTER TABLE "JasaNilaiKontrak" ADD CONSTRAINT "JasaNilaiKontrak_jasaId_fkey"
      FOREIGN KEY ("jasaId") REFERENCES "Jasa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JasaNilaiKontrak_projectId_fkey') THEN
    ALTER TABLE "JasaNilaiKontrak" ADD CONSTRAINT "JasaNilaiKontrak_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PurchaseOrder_jasaId_fkey') THEN
    ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_jasaId_fkey"
      FOREIGN KEY ("jasaId") REFERENCES "Jasa"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PengajuanPembayaran_jasaId_fkey') THEN
    ALTER TABLE "PengajuanPembayaran" ADD CONSTRAINT "PengajuanPembayaran_jasaId_fkey"
      FOREIGN KEY ("jasaId") REFERENCES "Jasa"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PembayaranSupplier_jasaId_fkey') THEN
    ALTER TABLE "PembayaranSupplier" ADD CONSTRAINT "PembayaranSupplier_jasaId_fkey"
      FOREIGN KEY ("jasaId") REFERENCES "Jasa"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MasterRekeningBank_tipeRekeningId_fkey') THEN
    ALTER TABLE "MasterRekeningBank" ADD CONSTRAINT "MasterRekeningBank_tipeRekeningId_fkey"
      FOREIGN KEY ("tipeRekeningId") REFERENCES "MasterTipeRekening"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PembayaranSupplier_rekeningBankId_fkey') THEN
    ALTER TABLE "PembayaranSupplier" ADD CONSTRAINT "PembayaranSupplier_rekeningBankId_fkey"
      FOREIGN KEY ("rekeningBankId") REFERENCES "MasterRekeningBank"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PembayaranSupplier_tipeRekeningId_fkey') THEN
    ALTER TABLE "PembayaranSupplier" ADD CONSTRAINT "PembayaranSupplier_tipeRekeningId_fkey"
      FOREIGN KEY ("tipeRekeningId") REFERENCES "MasterTipeRekening"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BukuBesarTransaksi_projectId_fkey') THEN
    ALTER TABLE "BukuBesarTransaksi" ADD CONSTRAINT "BukuBesarTransaksi_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BukuBesarTransaksi_akunBukuBesarId_fkey') THEN
    ALTER TABLE "BukuBesarTransaksi" ADD CONSTRAINT "BukuBesarTransaksi_akunBukuBesarId_fkey"
      FOREIGN KEY ("akunBukuBesarId") REFERENCES "AkunBukuBesar"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BukuBesarTransaksi_rekeningBankId_fkey') THEN
    ALTER TABLE "BukuBesarTransaksi" ADD CONSTRAINT "BukuBesarTransaksi_rekeningBankId_fkey"
      FOREIGN KEY ("rekeningBankId") REFERENCES "MasterRekeningBank"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BukuBesarTransaksi_tipeRekeningId_fkey') THEN
    ALTER TABLE "BukuBesarTransaksi" ADD CONSTRAINT "BukuBesarTransaksi_tipeRekeningId_fkey"
      FOREIGN KEY ("tipeRekeningId") REFERENCES "MasterTipeRekening"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BukuBesarTransaksi_poId_fkey') THEN
    ALTER TABLE "BukuBesarTransaksi" ADD CONSTRAINT "BukuBesarTransaksi_poId_fkey"
      FOREIGN KEY ("poId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BukuBesarTransaksi_pengajuanId_fkey') THEN
    ALTER TABLE "BukuBesarTransaksi" ADD CONSTRAINT "BukuBesarTransaksi_pengajuanId_fkey"
      FOREIGN KEY ("pengajuanId") REFERENCES "PengajuanPembayaran"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BukuBesarTransaksi_pembayaranId_fkey') THEN
    ALTER TABLE "BukuBesarTransaksi" ADD CONSTRAINT "BukuBesarTransaksi_pembayaranId_fkey"
      FOREIGN KEY ("pembayaranId") REFERENCES "PembayaranSupplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BukuBesarTransaksi_createdById_fkey') THEN
    ALTER TABLE "BukuBesarTransaksi" ADD CONSTRAINT "BukuBesarTransaksi_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
