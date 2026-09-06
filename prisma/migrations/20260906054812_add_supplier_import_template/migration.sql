-- AlterTable
ALTER TABLE "SupplierPriceHistory" ADD COLUMN     "promoPrice" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "SupplierImportTemplate" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "headerRow" INTEGER NOT NULL,
    "columnMappings" JSONB NOT NULL,
    "unit" TEXT NOT NULL,

    CONSTRAINT "SupplierImportTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierImportTemplate_supplierId_key" ON "SupplierImportTemplate"("supplierId");

-- AddForeignKey
ALTER TABLE "SupplierImportTemplate" ADD CONSTRAINT "SupplierImportTemplate_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
