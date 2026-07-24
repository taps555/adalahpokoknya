-- AlterTable
ALTER TABLE "BvItem" ADD COLUMN     "sourceJobTypeId" TEXT,
ALTER COLUMN "name" DROP NOT NULL,
ALTER COLUMN "paymentUnit" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "BvItem" ADD CONSTRAINT "BvItem_sourceJobTypeId_fkey" FOREIGN KEY ("sourceJobTypeId") REFERENCES "JobType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
