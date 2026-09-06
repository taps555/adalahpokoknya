/*
  Warnings:

  - You are about to drop the column `aliases` on the `SupplierItem` table. All the data in the column will be lost.
  - You are about to alter the column `currentPrice` on the `SupplierItem` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(65,30)`.
  - You are about to drop the column `periodMonth` on the `SupplierPriceHistory` table. All the data in the column will be lost.
  - You are about to drop the column `periodYear` on the `SupplierPriceHistory` table. All the data in the column will be lost.
  - You are about to alter the column `price` on the `SupplierPriceHistory` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(65,30)`.
  - You are about to alter the column `promoPrice` on the `SupplierPriceHistory` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(65,30)`.
  - You are about to drop the `SupplierImportTemplate` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "SupplierImportTemplate" DROP CONSTRAINT "SupplierImportTemplate_supplierId_fkey";

-- DropForeignKey
ALTER TABLE "SupplierItem" DROP CONSTRAINT "SupplierItem_supplierId_fkey";

-- DropForeignKey
ALTER TABLE "SupplierPriceHistory" DROP CONSTRAINT "SupplierPriceHistory_supplierItemId_fkey";

-- DropIndex
DROP INDEX "SupplierItem_supplierId_itemName_key";

-- AlterTable
ALTER TABLE "SupplierItem" DROP COLUMN "aliases",
ADD COLUMN     "currentPromoPrice" DECIMAL(65,30),
ALTER COLUMN "currentPrice" DROP DEFAULT,
ALTER COLUMN "currentPrice" SET DATA TYPE DECIMAL(65,30);

-- AlterTable
ALTER TABLE "SupplierPriceHistory" DROP COLUMN "periodMonth",
DROP COLUMN "periodYear",
ADD COLUMN     "effectiveDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "price" SET DATA TYPE DECIMAL(65,30),
ALTER COLUMN "promoPrice" SET DATA TYPE DECIMAL(65,30);

-- DropTable
DROP TABLE "SupplierImportTemplate";

-- CreateIndex
CREATE INDEX "SupplierPriceHistory_supplierItemId_effectiveDate_idx" ON "SupplierPriceHistory"("supplierItemId", "effectiveDate");

-- AddForeignKey
ALTER TABLE "SupplierPriceHistory" ADD CONSTRAINT "SupplierPriceHistory_supplierItemId_fkey" FOREIGN KEY ("supplierItemId") REFERENCES "SupplierItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierItem" ADD CONSTRAINT "SupplierItem_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
