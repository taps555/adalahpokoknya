-- Serialize baseline-affecting BV/RAB table writes with submit/review transactions.
-- The key must match lockApprovalProject() in bvRabApprovalService.js.
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
  IF TG_TABLE_NAME = 'BvBreakdown' THEN
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

CREATE TRIGGER "BvItem_approval_lock"
BEFORE INSERT OR UPDATE OR DELETE ON "BvItem"
FOR EACH ROW EXECUTE FUNCTION enforce_bv_rab_approval_lock();

CREATE TRIGGER "BvBreakdown_approval_lock"
BEFORE INSERT OR UPDATE OR DELETE ON "BvBreakdown"
FOR EACH ROW EXECUTE FUNCTION enforce_bv_rab_approval_lock();

CREATE TRIGGER "RabGroup_approval_lock"
BEFORE INSERT OR UPDATE OR DELETE ON "RabGroup"
FOR EACH ROW EXECUTE FUNCTION enforce_bv_rab_approval_lock();

CREATE TRIGGER "RabItem_approval_lock"
BEFORE INSERT OR UPDATE OR DELETE ON "RabItem"
FOR EACH ROW EXECUTE FUNCTION enforce_bv_rab_approval_lock();

CREATE TRIGGER "RabItemComponent_approval_lock"
BEFORE INSERT OR UPDATE OR DELETE ON "RabItemComponent"
FOR EACH ROW EXECUTE FUNCTION enforce_bv_rab_approval_lock();
