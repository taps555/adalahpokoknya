/*
  Warnings:

  - You are about to drop the column `formulaType` on the `BvItem` table. All the data in the column will be lost.
  - You are about to drop the column `jumlah` on the `BvItem` table. All the data in the column will be lost.
  - You are about to drop the column `lebar` on the `BvItem` table. All the data in the column will be lost.
  - You are about to drop the column `panjang` on the `BvItem` table. All the data in the column will be lost.
  - You are about to drop the column `tinggi` on the `BvItem` table. All the data in the column will be lost.
  - You are about to drop the column `waste` on the `BvItem` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "BvItem" DROP COLUMN "formulaType",
DROP COLUMN "jumlah",
DROP COLUMN "lebar",
DROP COLUMN "panjang",
DROP COLUMN "tinggi",
DROP COLUMN "waste";

-- CreateTable
CREATE TABLE "BvBreakdown" (
    "id" TEXT NOT NULL,
    "bvItemId" TEXT NOT NULL,
    "keterangan" TEXT,
    "panjang" DECIMAL(10,4),
    "lebar" DECIMAL(10,4),
    "tinggi" DECIMAL(10,4),
    "diameter" DECIMAL(10,4),
    "berat" DECIMAL(10,4),
    "jumlahSisi" DECIMAL(10,4),
    "jumlahBh" DECIMAL(10,4),
    "waste" DECIMAL(6,4) DEFAULT 0,
    "subTotal" DECIMAL(14,4) NOT NULL,

    CONSTRAINT "BvBreakdown_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BvBreakdown_bvItemId_idx" ON "BvBreakdown"("bvItemId");

-- AddForeignKey
ALTER TABLE "BvBreakdown" ADD CONSTRAINT "BvBreakdown_bvItemId_fkey" FOREIGN KEY ("bvItemId") REFERENCES "BvItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
