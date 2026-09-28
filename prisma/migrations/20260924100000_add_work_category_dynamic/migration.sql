-- CreateEnum
CREATE TYPE "PricingMode" AS ENUM ('HSPK', 'CUSTOM');

-- CreateTable
CREATE TABLE "WorkCategory" (
    "id"        TEXT     NOT NULL,
    "code"      TEXT     NOT NULL,
    "name"      TEXT     NOT NULL,
    "isActive"  BOOLEAN  NOT NULL DEFAULT true,
    "sortOrder" INTEGER  NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkCategory_code_key" ON "WorkCategory"("code");
CREATE INDEX "WorkCategory_isActive_sortOrder_idx" ON "WorkCategory"("isActive", "sortOrder");

-- CreateTable
CREATE TABLE "ProjectWorkCategory" (
    "id"             TEXT        NOT NULL,
    "projectId"      TEXT        NOT NULL,
    "workCategoryId" TEXT        NOT NULL,
    "pricingMode"    "PricingMode" NOT NULL DEFAULT 'CUSTOM',
    "grade"          TEXT,
    "isActive"       BOOLEAN     NOT NULL DEFAULT true,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectWorkCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectWorkCategory_projectId_workCategoryId_key"
    ON "ProjectWorkCategory"("projectId", "workCategoryId");
CREATE INDEX "ProjectWorkCategory_projectId_isActive_idx"
    ON "ProjectWorkCategory"("projectId", "isActive");
CREATE INDEX "ProjectWorkCategory_workCategoryId_idx"
    ON "ProjectWorkCategory"("workCategoryId");

-- AddColumn: nullable FK workCategoryId
ALTER TABLE "PriceItem" ADD COLUMN "workCategoryId" TEXT;
ALTER TABLE "JobType"   ADD COLUMN "workCategoryId" TEXT;
ALTER TABLE "RabItem"   ADD COLUMN "workCategoryId" TEXT;
ALTER TABLE "BvItem"    ADD COLUMN "workCategoryId" TEXT;
ALTER TABLE "UploadBatch" ADD COLUMN "workCategoryId" TEXT;

-- AddForeignKey
ALTER TABLE "ProjectWorkCategory"
    ADD CONSTRAINT "ProjectWorkCategory_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectWorkCategory"
    ADD CONSTRAINT "ProjectWorkCategory_workCategoryId_fkey"
    FOREIGN KEY ("workCategoryId") REFERENCES "WorkCategory"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- FK nullable (SetNull)
ALTER TABLE "PriceItem"   ADD CONSTRAINT "PriceItem_workCategoryId_fkey"
    FOREIGN KEY ("workCategoryId") REFERENCES "WorkCategory"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "JobType"   ADD CONSTRAINT "JobType_workCategoryId_fkey"
    FOREIGN KEY ("workCategoryId") REFERENCES "WorkCategory"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RabItem"   ADD CONSTRAINT "RabItem_workCategoryId_fkey"
    FOREIGN KEY ("workCategoryId") REFERENCES "WorkCategory"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BvItem"    ADD CONSTRAINT "BvItem_workCategoryId_fkey"
    FOREIGN KEY ("workCategoryId") REFERENCES "WorkCategory"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "UploadBatch" ADD CONSTRAINT "UploadBatch_workCategoryId_fkey"
    FOREIGN KEY ("workCategoryId") REFERENCES "WorkCategory"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex: unique price item by work category
CREATE UNIQUE INDEX "PriceItem_type_name_unit_period_workCategoryId_grade_key"
    ON "PriceItem"("type", "name", "unit", "period", "workCategoryId", "grade");
CREATE UNIQUE INDEX "JobType_name_paymentUnit_period_workCategoryId_grade_key"
    ON "JobType"("name", "paymentUnit", "period", "workCategoryId", "grade");

-- CreateIndex: FK index
CREATE INDEX "PriceItem_workCategoryId_idx"     ON "PriceItem"("workCategoryId");
CREATE INDEX "JobType_workCategoryId_idx"       ON "JobType"("workCategoryId");
CREATE INDEX "RabItem_workCategoryId_idx"       ON "RabItem"("workCategoryId");
CREATE INDEX "BvItem_workCategoryId_idx"        ON "BvItem"("workCategoryId");
CREATE INDEX "UploadBatch_workCategoryId_idx"   ON "UploadBatch"("workCategoryId");
