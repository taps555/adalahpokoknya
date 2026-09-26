CREATE TYPE "Survey3DStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'REVIEW', 'REVISION', 'FINAL');

CREATE TABLE "Survey3DResult" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" "Survey3DStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "gdriveUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Survey3DResult_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Survey3DImage" (
    "id" TEXT NOT NULL,
    "survey3DResultId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "caption" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Survey3DImage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Survey3DResult_projectId_key" ON "Survey3DResult"("projectId");
CREATE INDEX "Survey3DImage_survey3DResultId_order_idx" ON "Survey3DImage"("survey3DResultId", "order");

ALTER TABLE "Survey3DResult"
  ADD CONSTRAINT "Survey3DResult_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Survey3DImage"
  ADD CONSTRAINT "Survey3DImage_survey3DResultId_fkey"
  FOREIGN KEY ("survey3DResultId") REFERENCES "Survey3DResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;
