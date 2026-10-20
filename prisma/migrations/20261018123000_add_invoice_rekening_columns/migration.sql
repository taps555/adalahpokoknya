-- Add missing rekening/tipe rekening columns for invoice tables
-- This aligns DB schema with prisma/schema.prisma and fixes P2022 on invoice list endpoints.

ALTER TABLE "InvoicePenjualanDesain"
  ADD COLUMN IF NOT EXISTS "rekeningBankId" TEXT,
  ADD COLUMN IF NOT EXISTS "tipeRekeningId" TEXT;

ALTER TABLE "InvoicePenjualanKlien"
  ADD COLUMN IF NOT EXISTS "rekeningBankId" TEXT,
  ADD COLUMN IF NOT EXISTS "tipeRekeningId" TEXT;

ALTER TABLE "InvoiceOperasional"
  ADD COLUMN IF NOT EXISTS "rekeningBankId" TEXT,
  ADD COLUMN IF NOT EXISTS "tipeRekeningId" TEXT;

CREATE INDEX IF NOT EXISTS "InvoicePenjualanDesain_rekeningBankId_idx"
  ON "InvoicePenjualanDesain"("rekeningBankId");
CREATE INDEX IF NOT EXISTS "InvoicePenjualanDesain_tipeRekeningId_idx"
  ON "InvoicePenjualanDesain"("tipeRekeningId");

CREATE INDEX IF NOT EXISTS "InvoicePenjualanKlien_rekeningBankId_idx"
  ON "InvoicePenjualanKlien"("rekeningBankId");
CREATE INDEX IF NOT EXISTS "InvoicePenjualanKlien_tipeRekeningId_idx"
  ON "InvoicePenjualanKlien"("tipeRekeningId");

CREATE INDEX IF NOT EXISTS "InvoiceOperasional_rekeningBankId_idx"
  ON "InvoiceOperasional"("rekeningBankId");
CREATE INDEX IF NOT EXISTS "InvoiceOperasional_tipeRekeningId_idx"
  ON "InvoiceOperasional"("tipeRekeningId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'InvoicePenjualanDesain_rekeningBankId_fkey'
  ) THEN
    ALTER TABLE "InvoicePenjualanDesain"
      ADD CONSTRAINT "InvoicePenjualanDesain_rekeningBankId_fkey"
      FOREIGN KEY ("rekeningBankId") REFERENCES "MasterRekeningBank"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'InvoicePenjualanDesain_tipeRekeningId_fkey'
  ) THEN
    ALTER TABLE "InvoicePenjualanDesain"
      ADD CONSTRAINT "InvoicePenjualanDesain_tipeRekeningId_fkey"
      FOREIGN KEY ("tipeRekeningId") REFERENCES "MasterTipeRekening"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'InvoicePenjualanKlien_rekeningBankId_fkey'
  ) THEN
    ALTER TABLE "InvoicePenjualanKlien"
      ADD CONSTRAINT "InvoicePenjualanKlien_rekeningBankId_fkey"
      FOREIGN KEY ("rekeningBankId") REFERENCES "MasterRekeningBank"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'InvoicePenjualanKlien_tipeRekeningId_fkey'
  ) THEN
    ALTER TABLE "InvoicePenjualanKlien"
      ADD CONSTRAINT "InvoicePenjualanKlien_tipeRekeningId_fkey"
      FOREIGN KEY ("tipeRekeningId") REFERENCES "MasterTipeRekening"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'InvoiceOperasional_rekeningBankId_fkey'
  ) THEN
    ALTER TABLE "InvoiceOperasional"
      ADD CONSTRAINT "InvoiceOperasional_rekeningBankId_fkey"
      FOREIGN KEY ("rekeningBankId") REFERENCES "MasterRekeningBank"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'InvoiceOperasional_tipeRekeningId_fkey'
  ) THEN
    ALTER TABLE "InvoiceOperasional"
      ADD CONSTRAINT "InvoiceOperasional_tipeRekeningId_fkey"
      FOREIGN KEY ("tipeRekeningId") REFERENCES "MasterTipeRekening"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
