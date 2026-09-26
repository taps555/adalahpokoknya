CREATE TABLE "Survey3DResource" (
    "id" TEXT NOT NULL,
    "survey3DResultId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Survey3DResource_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Survey3DResource_survey3DResultId_order_idx"
ON "Survey3DResource"("survey3DResultId", "order");

ALTER TABLE "Survey3DResource"
ADD CONSTRAINT "Survey3DResource_survey3DResultId_fkey"
FOREIGN KEY ("survey3DResultId") REFERENCES "Survey3DResult"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Pertahankan data link tunggal lama sebagai child resource pertama.
INSERT INTO "Survey3DResource" (
    "id",
    "survey3DResultId",
    "type",
    "title",
    "url",
    "order",
    "createdAt",
    "updatedAt"
)
SELECT
    CONCAT('legacy-', MD5("id" || COALESCE("gdriveUrl", ''))),
    "id",
    'GOOGLE_DRIVE',
    'Model 3D - Google Drive',
    "gdriveUrl",
    0,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Survey3DResult"
WHERE "gdriveUrl" IS NOT NULL
  AND BTRIM("gdriveUrl") <> '';
