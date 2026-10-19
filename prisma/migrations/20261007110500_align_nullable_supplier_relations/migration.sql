-- Match nullable supplier relations in schema.prisma.
-- Replacing these constraints changes only delete behavior; existing rows are preserved.
DO $$
BEGIN
  IF to_regclass('"Supplier"') IS NOT NULL AND to_regclass('"SupplierItem"') IS NOT NULL THEN
    ALTER TABLE "SupplierItem"
      DROP CONSTRAINT IF EXISTS "SupplierItem_supplierId_fkey";
    ALTER TABLE "SupplierItem"
      ADD CONSTRAINT "SupplierItem_supplierId_fkey"
      FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF to_regclass('"Supplier"') IS NOT NULL AND to_regclass('"PurchaseOrder"') IS NOT NULL THEN
    ALTER TABLE "PurchaseOrder"
      DROP CONSTRAINT IF EXISTS "PurchaseOrder_supplierId_fkey";
    ALTER TABLE "PurchaseOrder"
      ADD CONSTRAINT "PurchaseOrder_supplierId_fkey"
      FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF to_regclass('"Supplier"') IS NOT NULL AND to_regclass('"PengajuanPembayaran"') IS NOT NULL THEN
    ALTER TABLE "PengajuanPembayaran"
      DROP CONSTRAINT IF EXISTS "PengajuanPembayaran_supplierId_fkey";
    ALTER TABLE "PengajuanPembayaran"
      ADD CONSTRAINT "PengajuanPembayaran_supplierId_fkey"
      FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF to_regclass('"Supplier"') IS NOT NULL AND to_regclass('"PembayaranSupplier"') IS NOT NULL THEN
    ALTER TABLE "PembayaranSupplier"
      DROP CONSTRAINT IF EXISTS "PembayaranSupplier_supplierId_fkey";
    ALTER TABLE "PembayaranSupplier"
      ADD CONSTRAINT "PembayaranSupplier_supplierId_fkey"
      FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
