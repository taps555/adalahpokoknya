-- OH breakdown: operational, budget waste, planned profit.
ALTER TABLE "RabItem"
  ADD COLUMN "operationalPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN "wastePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN "profitPercent" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- Preserve existing prices: historical OH remains operational OH.
UPDATE "RabItem"
SET "operationalPercent" = "overheadPercent",
    "wastePercent" = 0,
    "profitPercent" = 0;
