-- Drop the ProjectWorkCategory row trigger.
--
-- It blocked a benign side effect: projects.js rewrites project category
-- configuration (deleteMany + createMany) on every project edit, so renaming
-- a project whose BV/RAB is under review returned 409 for no real reason.
--
-- The harmful path is already covered: workCategories.js DELETE clears
-- workCategoryId directly on "BvItem"/"RabItem", and those row-level triggers
-- from migration 20260927190000 still reject such writes while locked.
DROP TRIGGER IF EXISTS "ProjectWorkCategory_approval_lock" ON "ProjectWorkCategory";
