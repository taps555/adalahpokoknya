-- Align PurchaseOrderItem with Prisma schema and existing Finance queries.
ALTER TABLE "PurchaseOrderItem"
ADD COLUMN IF NOT EXISTS "rabItemId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PurchaseOrderItem_rabItemId_fkey'
  ) THEN
    ALTER TABLE "PurchaseOrderItem"
      ADD CONSTRAINT "PurchaseOrderItem_rabItemId_fkey"
      FOREIGN KEY ("rabItemId") REFERENCES "RabItem"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
