/*
  Warnings:

  - A unique constraint covering the columns `[pairedProjectId]` on the table `Project` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "pairedProjectId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Project_pairedProjectId_key" ON "Project"("pairedProjectId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_pairedProjectId_fkey" FOREIGN KEY ("pairedProjectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
