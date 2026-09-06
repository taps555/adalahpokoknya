-- CreateTable
CREATE TABLE "AhspItemMapping" (
    "id" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "supplierItemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AhspItemMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AhspItemMapping_itemName_key" ON "AhspItemMapping"("itemName");

-- AddForeignKey
ALTER TABLE "AhspItemMapping" ADD CONSTRAINT "AhspItemMapping_supplierItemId_fkey" FOREIGN KEY ("supplierItemId") REFERENCES "SupplierItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
