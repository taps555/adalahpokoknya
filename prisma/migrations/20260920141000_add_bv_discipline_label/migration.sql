-- AlterTable
ALTER TABLE "BvItem"
ADD COLUMN "disciplineLabel" TEXT DEFAULT 'GENERAL';

-- Backfill existing rows before enforcing the default contract.
UPDATE "BvItem"
SET "disciplineLabel" = 'GENERAL'
WHERE "disciplineLabel" IS NULL;
