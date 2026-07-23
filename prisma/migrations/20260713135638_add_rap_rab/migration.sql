/*
  Warnings:

  - You are about to drop the column `totalPrice` on the `RabItem` table. All the data in the column will be lost.
  - You are about to drop the column `unitPrice` on the `RabItem` table. All the data in the column will be lost.
  - Added the required column `rabTotalPrice` to the `RabItem` table without a default value. This is not possible if the table is not empty.
  - Added the required column `rabUnitPrice` to the `RabItem` table without a default value. This is not possible if the table is not empty.
  - Added the required column `rapTotalPrice` to the `RabItem` table without a default value. This is not possible if the table is not empty.
  - Added the required column `rapUnitPrice` to the `RabItem` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "RabItem" DROP COLUMN "totalPrice",
DROP COLUMN "unitPrice",
ADD COLUMN     "rabTotalPrice" DECIMAL(18,4) NOT NULL,
ADD COLUMN     "rabUnitPrice" DECIMAL(18,4) NOT NULL,
ADD COLUMN     "rapTotalPrice" DECIMAL(18,4) NOT NULL,
ADD COLUMN     "rapUnitPrice" DECIMAL(18,4) NOT NULL;
