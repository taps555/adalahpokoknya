BEGIN;

LOCK TABLE
  "WorkCategory",
  "WorkSubCategory",
  "ProjectWorkCategory",
  "PriceItem",
  "JobType",
  "UploadBatch",
  "BvItem",
  "RabItem"
IN ACCESS EXCLUSIVE MODE;

-- This controlled global taxonomy replacement intentionally updates approved
-- BV/RAB rows. Disable write guards only inside this transaction; rollback
-- restores both data and triggers if any statement fails.
ALTER TABLE "BvItem" DISABLE TRIGGER "BvItem_approval_lock";
ALTER TABLE "RabItem" DISABLE TRIGGER "RabItem_approval_lock";

-- Snapshot canonical categories before old masters are detached.
CREATE TEMP TABLE "_canonical_work_categories" (
  "id" TEXT PRIMARY KEY,
  "code" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL,
  "sortOrder" INTEGER NOT NULL
) ON COMMIT PRESERVE ROWS;

INSERT INTO "_canonical_work_categories"
  ("id", "code", "name", "isActive", "sortOrder")
VALUES
  ('wc_canonical_struktur',   'STRUKTUR',   'STRUKTUR',   TRUE, 1),
  ('wc_canonical_arsitektur', 'ARSITEKTUR', 'ARSITEKTUR', TRUE, 2),
  ('wc_canonical_mep',        'MEP',        'MEP',        TRUE, 3),
  ('wc_canonical_interior',   'INTERIOR',   'INTERIOR',   TRUE, 4);

-- The user requested permanent removal. Business records are preserved but
-- detached from the old taxonomy so they can be reclassified afterward.
UPDATE "BvItem" SET "workSubCategoryId" = NULL;
UPDATE "RabItem" SET "workSubCategoryId" = NULL;
DELETE FROM "WorkSubCategory";

DELETE FROM "ProjectWorkCategory";
UPDATE "PriceItem" SET "workCategoryId" = NULL;
UPDATE "JobType" SET "workCategoryId" = NULL;
UPDATE "UploadBatch" SET "workCategoryId" = NULL;
UPDATE "BvItem" SET "workCategoryId" = NULL;
UPDATE "RabItem" SET "workCategoryId" = NULL;
DELETE FROM "WorkCategory";

INSERT INTO "WorkCategory"
  ("id", "code", "name", "isActive", "sortOrder", "createdAt", "updatedAt")
SELECT
  "id", "code", "name", "isActive", "sortOrder", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "_canonical_work_categories"
ORDER BY "sortOrder";

-- Canonical subcategory master. Codes are compact and unique per category.
INSERT INTO "WorkSubCategory"
  ("id", "categoryId", "code", "name", "isActive", "sortOrder", "createdAt", "updatedAt")
VALUES
  ('wsc_struktur_tanah',  'wc_canonical_struktur',   'P.TN', 'PEK. Tanah',              TRUE, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('wsc_struktur_baja',   'wc_canonical_struktur',   'P.BS', 'PEK. Baja Struktur',      TRUE, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('wsc_struktur_beton',  'wc_canonical_struktur',   'P.BT', 'PEK. Beton',              TRUE, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('wsc_arsitektur_dp',   'wc_canonical_arsitektur', 'DP',   'Dinding Partisi',          TRUE, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('wsc_arsitektur_pa',   'wc_canonical_arsitektur', 'PA',   'Penutup Atap',             TRUE, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('wsc_arsitektur_pdl',  'wc_canonical_arsitektur', 'PDL',  'Penutup Dinding & Lantai', TRUE, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('wsc_arsitektur_cat',  'wc_canonical_arsitektur', 'CAT',  'Pengecatan',               TRUE, 4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('wsc_arsitektur_pj',   'wc_canonical_arsitektur', 'PJ',   'Pintu & Jendela',          TRUE, 5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('wsc_mep_listrik',     'wc_canonical_mep',        'EL',   'Listrik',                  TRUE, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('wsc_mep_fs',          'wc_canonical_mep',        'FS',   'Fire Safety',              TRUE, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('wsc_mep_cctv',        'wc_canonical_mep',        'CCTV', 'CCTV',                     TRUE, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('wsc_mep_plumbing',    'wc_canonical_mep',        'PLB',  'Plumbing',                 TRUE, 4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('wsc_interior_furn',   'wc_canonical_interior',   'FUR',  'Furniture',                TRUE, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('wsc_interior_carpet', 'wc_canonical_interior',   'CRP',  'Carpet',                   TRUE, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('wsc_interior_floor',  'wc_canonical_interior',   'FLR',  'Flooring',                 TRUE, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('wsc_interior_bw',     'wc_canonical_interior',   'BW',   'BackWall',                 TRUE, 4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

ALTER TABLE "BvItem" ENABLE TRIGGER "BvItem_approval_lock";
ALTER TABLE "RabItem" ENABLE TRIGGER "RabItem_approval_lock";

COMMIT;
