/*
  Warnings:

  - You are about to drop the column `catatanRusak` on the `MaterialRequestItem` table. All the data in the column will be lost.
  - You are about to drop the column `receivedVolume` on the `MaterialRequestItem` table. All the data in the column will be lost.
  - You are about to drop the column `tanggalOnsite` on the `MaterialRequestItem` table. All the data in the column will be lost.
  - You are about to drop the column `updateLapangan` on the `MaterialRequestItem` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "MaterialRequestItem" DROP COLUMN "catatanRusak",
DROP COLUMN "receivedVolume",
DROP COLUMN "tanggalOnsite",
DROP COLUMN "updateLapangan";

-- AlterTable
ALTER TABLE "PurchaseOrderItem" ADD COLUMN     "catatanRusak" TEXT,
ADD COLUMN     "receivedVolume" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "tanggalOnsite" TIMESTAMP(3),
ADD COLUMN     "updateLapangan" TEXT;
