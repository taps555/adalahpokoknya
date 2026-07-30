-- AlterTable
ALTER TABLE "BvItem" ADD COLUMN     "isHeaderOnly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "parentBvItemId" TEXT;

-- CreateIndex
CREATE INDEX "BvItem_parentBvItemId_idx" ON "BvItem"("parentBvItemId");

-- AddForeignKey
ALTER TABLE "BvItem" ADD CONSTRAINT "BvItem_parentBvItemId_fkey" FOREIGN KEY ("parentBvItemId") REFERENCES "BvItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
