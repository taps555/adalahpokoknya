-- Guard the Project pricing trigger so a benign, unrelated edit (rename,
-- location, dates) does not trip the approval lock just because the update
-- payload re-sends the same pricing values.
--
-- Before: BEFORE UPDATE OF "hspkPeriod", "discipline", "interiorGrade", "sipilGrade"
--         fired on any UPDATE statement that merely listed those columns.
-- After:  fires only when at least one pricing value actually changes.
--
-- The BV/RAB tables keep the unconditional trigger from
-- 20260927190000/20260927200000: every row write there touches the baseline.

DROP TRIGGER IF EXISTS "Project_bv_rab_approval_lock" ON "Project";

CREATE TRIGGER "Project_bv_rab_approval_lock"
BEFORE UPDATE OF "hspkPeriod", "discipline", "interiorGrade", "sipilGrade"
ON "Project"
FOR EACH ROW
WHEN (
  OLD."hspkPeriod"      IS DISTINCT FROM NEW."hspkPeriod"
  OR OLD."discipline"   IS DISTINCT FROM NEW."discipline"
  OR OLD."interiorGrade" IS DISTINCT FROM NEW."interiorGrade"
  OR OLD."sipilGrade"   IS DISTINCT FROM NEW."sipilGrade"
)
EXECUTE FUNCTION enforce_bv_rab_approval_lock();
