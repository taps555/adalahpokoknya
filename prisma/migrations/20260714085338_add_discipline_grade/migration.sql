/*
  Warnings:

  - A unique constraint covering the columns `[name,paymentUnit,period,discipline,grade]` on the table `JobType` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[type,name,unit,period,discipline,grade]` on the table `PriceItem` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "Discipline" AS ENUM ('SIPIL', 'INTERIOR');

-- DropIndex
DROP INDEX "JobType_name_paymentUnit_period_key";

-- DropIndex
DROP INDEX "PriceItem_type_name_unit_period_key";

-- AlterTable
ALTER TABLE "JobType" ADD COLUMN     "discipline" "Discipline",
ADD COLUMN     "grade" TEXT;

-- AlterTable
ALTER TABLE "PriceItem" ADD COLUMN     "discipline" "Discipline",
ADD COLUMN     "grade" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "JobType_name_paymentUnit_period_discipline_grade_key" ON "JobType"("name", "paymentUnit", "period", "discipline", "grade");

-- CreateIndex
CREATE UNIQUE INDEX "PriceItem_type_name_unit_period_discipline_grade_key" ON "PriceItem"("type", "name", "unit", "period", "discipline", "grade");
