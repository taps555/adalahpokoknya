-- CreateTable
CREATE TABLE "BvItem" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "groupId" TEXT,
    "name" TEXT NOT NULL,
    "keterangan" TEXT,
    "paymentUnit" TEXT NOT NULL,
    "panjang" DECIMAL(10,4),
    "lebar" DECIMAL(10,4),
    "tinggi" DECIMAL(10,4),
    "jumlah" DECIMAL(10,4),
    "waste" DECIMAL(6,4) DEFAULT 0,
    "formulaType" TEXT NOT NULL,
    "totalVolume" DECIMAL(14,4) NOT NULL,
    "ecommerceLink" TEXT,
    "linkedRabItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BvItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BvItem_linkedRabItemId_key" ON "BvItem"("linkedRabItemId");

-- CreateIndex
CREATE INDEX "BvItem_projectId_idx" ON "BvItem"("projectId");

-- CreateIndex
CREATE INDEX "BvItem_groupId_idx" ON "BvItem"("groupId");

-- AddForeignKey
ALTER TABLE "BvItem" ADD CONSTRAINT "BvItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BvItem" ADD CONSTRAINT "BvItem_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "RabGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BvItem" ADD CONSTRAINT "BvItem_linkedRabItemId_fkey" FOREIGN KEY ("linkedRabItemId") REFERENCES "RabItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
