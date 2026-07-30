-- AlterTable
ALTER TABLE "BvItem" ADD COLUMN     "linkedGroupId" TEXT;

-- AddForeignKey
ALTER TABLE "BvItem" ADD CONSTRAINT "BvItem_linkedGroupId_fkey" FOREIGN KEY ("linkedGroupId") REFERENCES "RabGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
