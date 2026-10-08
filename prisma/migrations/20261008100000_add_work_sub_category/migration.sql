-- CreateTable
CREATE TABLE "WorkSubCategory" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkSubCategory_pkey" PRIMARY KEY ("id")
);

-- AddColumn
ALTER TABLE "BvItem" ADD COLUMN "workSubCategoryId" TEXT;
ALTER TABLE "RabItem" ADD COLUMN "workSubCategoryId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "WorkSubCategory_categoryId_code_key"
    ON "WorkSubCategory"("categoryId", "code");
CREATE INDEX "WorkSubCategory_categoryId_isActive_sortOrder_idx"
    ON "WorkSubCategory"("categoryId", "isActive", "sortOrder");
CREATE INDEX "BvItem_workSubCategoryId_idx" ON "BvItem"("workSubCategoryId");
CREATE INDEX "RabItem_workSubCategoryId_idx" ON "RabItem"("workSubCategoryId");

-- AddForeignKey
ALTER TABLE "WorkSubCategory"
    ADD CONSTRAINT "WorkSubCategory_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "WorkCategory"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BvItem"
    ADD CONSTRAINT "BvItem_workSubCategoryId_fkey"
    FOREIGN KEY ("workSubCategoryId") REFERENCES "WorkSubCategory"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RabItem"
    ADD CONSTRAINT "RabItem_workSubCategoryId_fkey"
    FOREIGN KEY ("workSubCategoryId") REFERENCES "WorkSubCategory"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
