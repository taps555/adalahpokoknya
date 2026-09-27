-- CreateEnum
CREATE TYPE "BvRabApprovalStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'CHANGES_REQUESTED');

-- CreateTable
CREATE TABLE "BvRabApprovalRevision" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "status" "BvRabApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "submittedById" TEXT,
    "submittedByName" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewedByName" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewComment" TEXT,
    "baselineSnapshot" JSONB,
    "baselineHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BvRabApprovalRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BvRabApprovalRevision_projectId_revision_key" ON "BvRabApprovalRevision"("projectId", "revision");

-- CreateIndex
CREATE INDEX "BvRabApprovalRevision_projectId_status_revision_idx" ON "BvRabApprovalRevision"("projectId", "status", "revision");

-- AddForeignKey
ALTER TABLE "BvRabApprovalRevision" ADD CONSTRAINT "BvRabApprovalRevision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;