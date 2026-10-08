-- Align remaining PurchaseOrderItem fields used by Finance with Prisma schema.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'KategoriItem') THEN
    CREATE TYPE "KategoriItem" AS ENUM ('BAHAN', 'ALAT');
  END IF;
END $$;

ALTER TABLE "PurchaseOrderItem"
ADD COLUMN IF NOT EXISTS "disc2Percent" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "kategoriItem" "KategoriItem",
ADD COLUMN IF NOT EXISTS "keteranganVolume" TEXT,
ADD COLUMN IF NOT EXISTS "keteranganHarga" TEXT;
