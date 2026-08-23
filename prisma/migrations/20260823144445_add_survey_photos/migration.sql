/*
  Warnings:

  - You are about to drop the column `overhead` on the `RabItem` table. All the data in the column will be lost.
  - You are about to alter the column `rabUnitPrice` on the `RabItem` table. The data in that column could be lost. The data in that column will be cast from `Decimal(18,4)` to `Decimal(14,2)`.
  - You are about to alter the column `rapUnitPrice` on the `RabItem` table. The data in that column could be lost. The data in that column will be cast from `Decimal(18,4)` to `Decimal(14,2)`.

*/
-- AlterTable
ALTER TABLE "BvBreakdown" ADD COLUMN     "isBeratChecked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isKelChecked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isLChecked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isLuasChecked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isPChecked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isTChecked" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "DailyProgress" ADD COLUMN     "photoUrl" TEXT;

-- AlterTable
ALTER TABLE "RabItem" DROP COLUMN "overhead",
ADD COLUMN     "overheadPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
ALTER COLUMN "rabUnitPrice" SET DEFAULT 0,
ALTER COLUMN "rabUnitPrice" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "rapUnitPrice" SET DEFAULT 0,
ALTER COLUMN "rapUnitPrice" SET DATA TYPE DECIMAL(14,2);

-- CreateTable
CREATE TABLE "SurveyReport" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "surveyDate" TIMESTAMP(3) NOT NULL,
    "surveyorName" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SurveyReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyArea" (
    "id" TEXT NOT NULL,
    "surveyReportId" TEXT NOT NULL,
    "areaName" TEXT NOT NULL,
    "analisa" TEXT,
    "penanganan" TEXT,
    "informasiTambahan" TEXT,
    "photoUrl" TEXT,
    "photoCaption" TEXT,

    CONSTRAINT "SurveyArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyPhoto" (
    "id" TEXT NOT NULL,
    "surveyAreaId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SurveyPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveyDimension" (
    "id" TEXT NOT NULL,
    "surveyAreaId" TEXT NOT NULL,
    "panjang" DECIMAL(10,4),
    "lebar" DECIMAL(10,4),
    "tinggi" DECIMAL(10,4),
    "luasan" DECIMAL(10,4),
    "keterangan" TEXT,

    CONSTRAINT "SurveyDimension_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "SurveyReport" ADD CONSTRAINT "SurveyReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyArea" ADD CONSTRAINT "SurveyArea_surveyReportId_fkey" FOREIGN KEY ("surveyReportId") REFERENCES "SurveyReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyPhoto" ADD CONSTRAINT "SurveyPhoto_surveyAreaId_fkey" FOREIGN KEY ("surveyAreaId") REFERENCES "SurveyArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyDimension" ADD CONSTRAINT "SurveyDimension_surveyAreaId_fkey" FOREIGN KEY ("surveyAreaId") REFERENCES "SurveyArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;
