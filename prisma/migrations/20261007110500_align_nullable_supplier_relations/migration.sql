-- Match nullable supplier relations in schema.prisma.
-- Replacing these constraints changes only delete behavior; existing rows are preserved.
ALTER TABLE "SupplierItem"
  DROP CONSTRAINT IF EXISTS "SupplierItem_supplierId_fkey";
ALTER TABLE "SupplierItem"
  ADD CONSTRAINT "SupplierItem_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PurchaseOrder"
  DROP CONSTRAINT IF EXISTS "PurchaseOrder_supplierId_fkey";
ALTER TABLE "PurchaseOrder"
  ADD CONSTRAINT "PurchaseOrder_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PengajuanPembayaran"
  DROP CONSTRAINT IF EXISTS "PengajuanPembayaran_supplierId_fkey";
ALTER TABLE "PengajuanPembayaran"
  ADD CONSTRAINT "PengajuanPembayaran_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PembayaranSupplier"
  DROP CONSTRAINT IF EXISTS "PembayaranSupplier_supplierId_fkey";
ALTER TABLE "PembayaranSupplier"
  ADD CONSTRAINT "PembayaranSupplier_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
