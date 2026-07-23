-- AlterTable
ALTER TABLE "RabItem" ADD COLUMN     "groupId" TEXT;

-- CreateTable
CREATE TABLE "RabGroup" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reference" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RabGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RabGroup_projectId_idx" ON "RabGroup"("projectId");

-- CreateIndex
CREATE INDEX "RabGroup_parentId_idx" ON "RabGroup"("parentId");

-- AddForeignKey
ALTER TABLE "RabItem" ADD CONSTRAINT "RabItem_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "RabGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RabGroup" ADD CONSTRAINT "RabGroup_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RabGroup" ADD CONSTRAINT "RabGroup_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "RabGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
