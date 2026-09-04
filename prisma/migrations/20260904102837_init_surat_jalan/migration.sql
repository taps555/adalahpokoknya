-- CreateTable
CREATE TABLE "DeliveryReceipt" (
    "id" TEXT NOT NULL,
    "poItemId" TEXT NOT NULL,
    "tanggal" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nomorSJ" TEXT NOT NULL,
    "volumeDiterima" DOUBLE PRECISION NOT NULL,
    "catatan" TEXT,
    "fotoUrls" TEXT,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryReceipt_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "DeliveryReceipt" ADD CONSTRAINT "DeliveryReceipt_poItemId_fkey" FOREIGN KEY ("poItemId") REFERENCES "PurchaseOrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
