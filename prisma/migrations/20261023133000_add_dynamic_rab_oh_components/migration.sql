-- Komponen OH dinamis: master kolom per project, nilai persen per item.
ALTER TABLE "Project"
  ADD COLUMN IF NOT EXISTS "ohDefinitions" JSONB;

ALTER TABLE "RabItem"
  ADD COLUMN IF NOT EXISTS "ohComponents" JSONB DEFAULT '[]'::jsonb;

-- Migrasikan breakdown lama ke nilai per item agar harga historis tidak berubah.
UPDATE "RabItem"
SET "ohComponents" = jsonb_build_array(
  jsonb_build_object('id', 'operational', 'name', 'Ops', 'percent', "operationalPercent", 'kind', 'OPERATIONAL'),
  jsonb_build_object('id', 'waste', 'name', 'Waste', 'percent', "wastePercent", 'kind', 'WASTE'),
  jsonb_build_object('id', 'profit', 'name', 'Laba', 'percent', "profitPercent", 'kind', 'PROFIT')
)
WHERE "ohComponents" IS NULL OR "ohComponents" = '[]'::jsonb;

-- Project lama memperoleh tiga kolom utama. Project baru memakai fallback yang sama.
UPDATE "Project"
SET "ohDefinitions" = '[
  {"id":"operational","name":"Ops","kind":"OPERATIONAL"},
  {"id":"waste","name":"Waste","kind":"WASTE"},
  {"id":"profit","name":"Laba","kind":"PROFIT"}
]'::jsonb
WHERE "ohDefinitions" IS NULL;
