CREATE TABLE "DesignQuotation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "surveyReportId" TEXT,
    "quotationDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "discount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "item3dVolume" DECIMAL(14,4) NOT NULL,
    "item3dPrice" DECIMAL(18,2) NOT NULL,
    "item2dVolume" DECIMAL(14,4) NOT NULL,
    "item2dPrice" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DesignQuotation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DesignQuotation_projectId_idx"
ON "DesignQuotation"("projectId");

ALTER TABLE "DesignQuotation"
ADD CONSTRAINT "DesignQuotation_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DesignQuotation"
ADD CONSTRAINT "DesignQuotation_surveyReportId_fkey"
FOREIGN KEY ("surveyReportId") REFERENCES "SurveyReport"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
