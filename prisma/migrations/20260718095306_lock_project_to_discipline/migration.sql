/*
  Warnings:

  - Added the required column `discipline` to the `Project` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "discipline" "Discipline" NOT NULL,
ADD COLUMN     "grade" TEXT;
