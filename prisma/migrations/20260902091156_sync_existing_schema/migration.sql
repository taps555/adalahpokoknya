/*
  Warnings:

  - You are about to drop the column `photoUrl` on the `DailyProgress` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'PERENCANA', 'PELAKSANA', 'FINANCE', 'PURCHASING', 'PROJECT_MANAGER');

-- CreateEnum
CREATE TYPE "RabStatus" AS ENUM ('DRAFT', 'LOCKED', 'REVISION');

-- CreateEnum
CREATE TYPE "ProcurementStatus" AS ENUM ('PENDING', 'PARTIAL', 'COMPLETED');

-- CreateEnum
CREATE TYPE "SupplierType" AS ENUM ('BAHAN', 'JASA');

-- CreateEnum
CREATE TYPE "TaxGroup" AS ENUM ('PPN', 'NON_PPN');

-- CreateEnum
CREATE TYPE "SupplierStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- AlterTable
ALTER TABLE "BvItem" ADD COLUMN     "nameEcommerceLink" TEXT;

-- AlterTable
ALTER TABLE "DailyProgress" DROP COLUMN "photoUrl",
ADD COLUMN     "photoUrls" TEXT[];

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "rabStatus" "RabStatus" NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "RabItem" ADD COLUMN     "isHeaderOnly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "parentId" TEXT;

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'PERENCANA',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplaintReport" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplaintReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplaintCategory" (
    "id" TEXT NOT NULL,
    "complaintReportId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "ComplaintCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplaintItem" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "defectList" TEXT NOT NULL,
    "repairDate" TIMESTAMP(3),
    "status" BOOLEAN NOT NULL DEFAULT false,
    "repairDefectReport" TEXT,

    CONSTRAINT "ComplaintItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplaintPhoto" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'BEFORE',

    CONSTRAINT "ComplaintPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bast" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "bastNumber" TEXT NOT NULL,
    "spkNumber" TEXT NOT NULL,
    "handoverDate" TIMESTAMP(3) NOT NULL,
    "pihakPertamaName" TEXT NOT NULL,
    "pihakPertamaPosition" TEXT NOT NULL DEFAULT 'Pemberi Tugas',
    "pihakKeduaName" TEXT NOT NULL,
    "pihakKeduaPosition" TEXT NOT NULL DEFAULT 'Penerima Pekerjaan',
    "statusText" TEXT NOT NULL DEFAULT 'SELESAI DIKERJAKAN 100% dan DITERIMA DENGAN BAIK',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BastPhoto" (
    "id" TEXT NOT NULL,
    "bastId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BastPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialRequest" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialRequestItem" (
    "id" TEXT NOT NULL,
    "headerId" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "discipline" TEXT,
    "estimatedVolume" DOUBLE PRECISION NOT NULL,
    "pricePerUnit" DOUBLE PRECISION NOT NULL,
    "totalPrice" DOUBLE PRECISION NOT NULL,
    "volumePekerjaan" DOUBLE PRECISION,
    "status" "ProcurementStatus" NOT NULL DEFAULT 'PENDING',
    "scheduleRange" TEXT,
    "groupName" TEXT,
    "jobName" TEXT,
    "catatanPerencana" TEXT,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "orderedVolume" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "catatanFinance" TEXT,
    "tanggalOnsite" TIMESTAMP(3),
    "updateLapangan" TEXT,

    CONSTRAINT "MaterialRequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "type" "SupplierType",
    "address" TEXT,
    "address2" TEXT,
    "phone" TEXT,
    "fax" TEXT,
    "taxGroup" "TaxGroup",
    "npwp" TEXT,
    "email" TEXT,
    "contactName" TEXT,
    "creditLimit" DECIMAL(65,30) DEFAULT 0,
    "bankAccount" TEXT,
    "status" "SupplierStatus" DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "attn" TEXT,
    "projectId" TEXT NOT NULL,
    "kategori" TEXT,
    "tanggal" TIMESTAMP(3) NOT NULL,
    "deliveryDate" TIMESTAMP(3),
    "perusahaan" TEXT DEFAULT 'PT DIVES JAYA PERKASA',
    "status" TEXT NOT NULL DEFAULT 'Belum Approve',
    "subTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "globalDiscount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxNominal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grandTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "penerimaBarang" TEXT,
    "caraPembayaran" TEXT,
    "jadwalPenagihan" TEXT,
    "noTelepon" TEXT,
    "kodePoReferensi" TEXT,
    "keterangan" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderItem" (
    "id" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "materialRequestId" TEXT,
    "code" TEXT,
    "description" TEXT NOT NULL,
    "description2" TEXT,
    "qty" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "disc1Percent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "disc2Nominal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "Bast_projectId_idx" ON "Bast"("projectId");

-- CreateIndex
CREATE INDEX "BastPhoto_bastId_idx" ON "BastPhoto"("bastId");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_code_key" ON "Supplier"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_poNumber_key" ON "PurchaseOrder"("poNumber");

-- CreateIndex
CREATE INDEX "RabItem_parentId_idx" ON "RabItem"("parentId");

-- AddForeignKey
ALTER TABLE "RabItem" ADD CONSTRAINT "RabItem_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "RabItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplaintReport" ADD CONSTRAINT "ComplaintReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplaintCategory" ADD CONSTRAINT "ComplaintCategory_complaintReportId_fkey" FOREIGN KEY ("complaintReportId") REFERENCES "ComplaintReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplaintItem" ADD CONSTRAINT "ComplaintItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ComplaintCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplaintPhoto" ADD CONSTRAINT "ComplaintPhoto_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ComplaintItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bast" ADD CONSTRAINT "Bast_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BastPhoto" ADD CONSTRAINT "BastPhoto_bastId_fkey" FOREIGN KEY ("bastId") REFERENCES "Bast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRequest" ADD CONSTRAINT "MaterialRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRequestItem" ADD CONSTRAINT "MaterialRequestItem_headerId_fkey" FOREIGN KEY ("headerId") REFERENCES "MaterialRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_poId_fkey" FOREIGN KEY ("poId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_materialRequestId_fkey" FOREIGN KEY ("materialRequestId") REFERENCES "MaterialRequestItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
