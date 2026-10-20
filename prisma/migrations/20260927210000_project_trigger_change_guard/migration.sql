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

DO $$
DECLARE
  cols TEXT[];
  trigger_columns TEXT;
  when_clause TEXT;
BEGIN
  SELECT array_agg(col)
  INTO cols
  FROM unnest(ARRAY['hspkPeriod', 'discipline', 'interiorGrade', 'sipilGrade']) AS col
  WHERE EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'Project'
      AND c.column_name = col
  );

  IF cols IS NULL OR array_length(cols, 1) = 0 THEN
    cols := ARRAY['updatedAt'];
  END IF;

  SELECT string_agg(format('"%s"', c), ', ')
  INTO trigger_columns
  FROM unnest(cols) AS c;

  SELECT string_agg(format('OLD."%1$s" IS DISTINCT FROM NEW."%1$s"', c), ' OR ')
  INTO when_clause
  FROM unnest(cols) AS c;

  EXECUTE format(
    'CREATE TRIGGER "Project_bv_rab_approval_lock"
BEFORE UPDATE OF %s
ON "Project"
FOR EACH ROW
WHEN (%s)
EXECUTE FUNCTION enforce_bv_rab_approval_lock();',
    trigger_columns,
    when_clause
  );
END
$$;
