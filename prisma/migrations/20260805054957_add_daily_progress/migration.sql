-- CreateTable
CREATE TABLE "DailyProgress" (
    "id" TEXT NOT NULL,
    "rabItemId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "progressPercent" DECIMAL(6,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyProgress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyProgress_rabItemId_idx" ON "DailyProgress"("rabItemId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyProgress_rabItemId_date_key" ON "DailyProgress"("rabItemId", "date");

-- AddForeignKey
ALTER TABLE "DailyProgress" ADD CONSTRAINT "DailyProgress_rabItemId_fkey" FOREIGN KEY ("rabItemId") REFERENCES "RabItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
