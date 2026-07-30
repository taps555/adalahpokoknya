-- DropForeignKey
ALTER TABLE "RabItem" DROP CONSTRAINT "RabItem_groupId_fkey";

-- AddForeignKey
ALTER TABLE "RabItem" ADD CONSTRAINT "RabItem_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "RabGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
