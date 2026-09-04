-- AlterTable
ALTER TABLE "MaterialRequestItem" ADD COLUMN     "catatanRusak" TEXT,
ADD COLUMN     "receivedVolume" DOUBLE PRECISION NOT NULL DEFAULT 0;
