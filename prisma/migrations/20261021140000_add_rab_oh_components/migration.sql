-- Komponen OH dinamis per item RAB.
-- Backend tetap memakai nama OH; web hanya menampilkan label OVH.
ALTER TABLE "RabItem"
  ADD COLUMN IF NOT EXISTS "ohComponents" JSONB DEFAULT '[]'::jsonb;
