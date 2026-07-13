-- CreateEnum
CREATE TYPE "ResourceType" AS ENUM ('BAHAN', 'UPAH', 'ALAT');

-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('PROCESSING', 'SUCCESS', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "FileKind" AS ENUM ('PDF', 'XLSX', 'CSV');

-- CreateTable
CREATE TABLE "PriceItem" (
    "id" TEXT NOT NULL,
    "type" "ResourceType" NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "price" DECIMAL(18,4) NOT NULL,
    "period" INTEGER NOT NULL,
    "source" TEXT,
    "batchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "paymentUnit" TEXT NOT NULL,
    "category" TEXT,
    "reference" TEXT,
    "period" INTEGER NOT NULL,
    "source" TEXT,
    "batchId" TEXT,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobComponent" (
    "id" TEXT NOT NULL,
    "jobTypeId" TEXT NOT NULL,
    "priceItemId" TEXT NOT NULL,
    "section" "ResourceType" NOT NULL,
    "coefficient" DECIMAL(14,6) NOT NULL,

    CONSTRAINT "JobComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadBatch" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "fileKind" "FileKind" NOT NULL,
    "period" INTEGER NOT NULL,
    "status" "UploadStatus" NOT NULL DEFAULT 'PROCESSING',
    "priceItemCount" INTEGER NOT NULL DEFAULT 0,
    "jobTypeCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "UploadBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadIssue" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "context" TEXT,
    "rawLine" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UploadIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PriceItem_period_idx" ON "PriceItem"("period");

-- CreateIndex
CREATE INDEX "PriceItem_name_idx" ON "PriceItem"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PriceItem_type_name_unit_period_key" ON "PriceItem"("type", "name", "unit", "period");

-- CreateIndex
CREATE INDEX "JobType_period_idx" ON "JobType"("period");

-- CreateIndex
CREATE INDEX "JobType_category_idx" ON "JobType"("category");

-- CreateIndex
CREATE UNIQUE INDEX "JobType_name_paymentUnit_period_key" ON "JobType"("name", "paymentUnit", "period");

-- CreateIndex
CREATE INDEX "JobComponent_jobTypeId_idx" ON "JobComponent"("jobTypeId");

-- CreateIndex
CREATE INDEX "JobComponent_priceItemId_idx" ON "JobComponent"("priceItemId");

-- AddForeignKey
ALTER TABLE "PriceItem" ADD CONSTRAINT "PriceItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "UploadBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobType" ADD CONSTRAINT "JobType_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "UploadBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobComponent" ADD CONSTRAINT "JobComponent_jobTypeId_fkey" FOREIGN KEY ("jobTypeId") REFERENCES "JobType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobComponent" ADD CONSTRAINT "JobComponent_priceItemId_fkey" FOREIGN KEY ("priceItemId") REFERENCES "PriceItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadIssue" ADD CONSTRAINT "UploadIssue_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "UploadBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
