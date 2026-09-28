-- Make project deletion deterministic while BV/RAB is under review or approved.
-- A BEFORE DELETE trigger runs before referential cascades, so the approval row
-- is still available for the status check and the entire delete is rejected.
DROP TRIGGER IF EXISTS "Project_bv_rab_delete_lock" ON "Project";

CREATE TRIGGER "Project_bv_rab_delete_lock"
BEFORE DELETE ON "Project"
FOR EACH ROW EXECUTE FUNCTION enforce_bv_rab_approval_lock();
