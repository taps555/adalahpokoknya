-- CreateEnum
CREATE TYPE "SpkType" AS ENUM ('CLIENT', 'SUBCON');

-- CreateEnum
CREATE TYPE "SpkStatus" AS ENUM ('DRAFT', 'TERBIT', 'DITANDATANGANI', 'BERJALAN', 'SELESAI', 'DIBATALKAN');

-- CreateEnum
CREATE TYPE "SpkSourceType" AS ENUM ('RAB', 'DESIGN_QUOTATION');

-- CreateEnum
CREATE TYPE "SpkTermPaymentStatus" AS ENUM ('PENDING', 'AVAILABLE', 'PROCESSED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SpkTermKind" AS ENUM ('PAYMENT', 'RETENTION');

-- CreateTable
CREATE TABLE "SpkContract" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" "SpkType" NOT NULL,
    "status" "SpkStatus" NOT NULL DEFAULT 'DRAFT',
    "spkNumber" TEXT,
    "sourceType" "SpkSourceType" NOT NULL DEFAULT 'RAB',
    "sourceId" TEXT NOT NULL,
    "contractValue" DECIMAL(18,2) NOT NULL,
    "contractValueWords" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "partyData" JSONB NOT NULL,
    "workDurationDays" INTEGER,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "bankData" JSONB NOT NULL,
    "notes" TEXT,
    "retentionPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "retentionAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "issuedAt" TIMESTAMP(3),
    "issuedById" TEXT,
    "signedAt" TIMESTAMP(3),
    "signedDocumentUrl" TEXT,
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpkContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpkTerm" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "kind" "SpkTermKind" NOT NULL DEFAULT 'PAYMENT',
    "label" TEXT NOT NULL,
    "percent" DECIMAL(5,2) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "dueDescription" TEXT,
    "milestone" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "status" "SpkTermPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "financeReferenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpkTerm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpkNumberCounter" (
    "id" TEXT NOT NULL,
    "type" "SpkType" NOT NULL,
    "year" INTEGER NOT NULL,
    "lastNumber" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpkNumberCounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SpkContract_spkNumber_key" ON "SpkContract"("spkNumber");

-- CreateIndex
CREATE INDEX "SpkContract_projectId_status_idx" ON "SpkContract"("projectId", "status");

-- CreateIndex
CREATE INDEX "SpkContract_type_status_idx" ON "SpkContract"("type", "status");

-- CreateIndex
CREATE INDEX "SpkContract_sourceType_sourceId_idx" ON "SpkContract"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "SpkTerm_contractId_order_idx" ON "SpkTerm"("contractId", "order");

-- CreateIndex
CREATE INDEX "SpkTerm_status_idx" ON "SpkTerm"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SpkNumberCounter_type_year_key" ON "SpkNumberCounter"("type", "year");

-- AddForeignKey
ALTER TABLE "SpkContract" ADD CONSTRAINT "SpkContract_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpkTerm" ADD CONSTRAINT "SpkTerm_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "SpkContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
