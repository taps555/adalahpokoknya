-- Serialize all baseline-affecting writes against approval decisions.
-- Approval transactions lock the Project row before taking the advisory lock.
-- Triggers use the same lock order, so an in-flight writer either finishes
-- before the approved snapshot is captured, or is rejected after approval.
CREATE OR REPLACE FUNCTION enforce_bv_rab_approval_lock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_project_id TEXT;
  new_project_id TEXT;
  project_id_to_check TEXT;
  latest_status "BvRabApprovalStatus";
  project_ids TEXT[];
BEGIN
  IF TG_TABLE_NAME = 'Project' THEN
    IF TG_OP <> 'INSERT' THEN old_project_id := OLD.id; END IF;
    IF TG_OP <> 'DELETE' THEN new_project_id := NEW.id; END IF;
  ELSIF TG_TABLE_NAME = 'BvBreakdown' THEN
    IF TG_OP <> 'INSERT' THEN
      SELECT "projectId" INTO old_project_id FROM "BvItem" WHERE id = OLD."bvItemId";
    END IF;
    IF TG_OP <> 'DELETE' THEN
      SELECT "projectId" INTO new_project_id FROM "BvItem" WHERE id = NEW."bvItemId";
    END IF;
  ELSIF TG_TABLE_NAME = 'RabItemComponent' THEN
    IF TG_OP <> 'INSERT' THEN
      SELECT "projectId" INTO old_project_id FROM "RabItem" WHERE id = OLD."rabItemId";
    END IF;
    IF TG_OP <> 'DELETE' THEN
      SELECT "projectId" INTO new_project_id FROM "RabItem" WHERE id = NEW."rabItemId";
    END IF;
  ELSE
    IF TG_OP <> 'INSERT' THEN old_project_id := OLD."projectId"; END IF;
    IF TG_OP <> 'DELETE' THEN new_project_id := NEW."projectId"; END IF;
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT candidate
    FROM unnest(ARRAY[old_project_id, new_project_id]) AS candidate
    WHERE candidate IS NOT NULL
    ORDER BY candidate
  ) INTO project_ids;

  FOREACH project_id_to_check IN ARRAY project_ids LOOP
    PERFORM 1 FROM "Project" WHERE id = project_id_to_check FOR UPDATE;
    PERFORM pg_advisory_xact_lock(hashtext('bv-rab-approval:' || project_id_to_check));

    SELECT status INTO latest_status
    FROM "BvRabApprovalRevision"
    WHERE "projectId" = project_id_to_check
    ORDER BY revision DESC, "createdAt" DESC
    LIMIT 1;

    IF latest_status IN ('PENDING_REVIEW', 'APPROVED') THEN
      RAISE EXCEPTION 'BV_RAB_APPROVAL_LOCKED:%', project_id_to_check
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- Project pricing inputs feed generated BV/RAB values.
DROP TRIGGER IF EXISTS "Project_bv_rab_approval_lock" ON "Project";
CREATE TRIGGER "Project_bv_rab_approval_lock"
BEFORE UPDATE OF "hspkPeriod", "discipline", "interiorGrade", "sipilGrade"
ON "Project"
FOR EACH ROW EXECUTE FUNCTION enforce_bv_rab_approval_lock();

-- Category configuration affects project-scoped BV/RAB categorization/pricing.
DROP TRIGGER IF EXISTS "ProjectWorkCategory_approval_lock" ON "ProjectWorkCategory";
CREATE TRIGGER "ProjectWorkCategory_approval_lock"
BEFORE INSERT OR UPDATE OR DELETE ON "ProjectWorkCategory"
FOR EACH ROW EXECUTE FUNCTION enforce_bv_rab_approval_lock();
