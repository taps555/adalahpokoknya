-- Keep the deployed database aligned with Prisma schema.
-- Existing material-request rows remain valid because the new field is nullable.
ALTER TABLE "MaterialRequestItem"
ADD COLUMN IF NOT EXISTS "category" TEXT;
