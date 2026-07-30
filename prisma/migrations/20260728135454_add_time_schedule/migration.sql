-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "startDate" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "TimeSchedule" (
    "id" TEXT NOT NULL,
    "rabItemId" TEXT NOT NULL,
    "startWeek" INTEGER NOT NULL,
    "endWeek" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TimeSchedule_rabItemId_key" ON "TimeSchedule"("rabItemId");

-- AddForeignKey
ALTER TABLE "TimeSchedule" ADD CONSTRAINT "TimeSchedule_rabItemId_fkey" FOREIGN KEY ("rabItemId") REFERENCES "RabItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
