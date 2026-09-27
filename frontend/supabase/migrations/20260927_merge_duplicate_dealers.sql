-- Merge exact duplicate dealer master rows without changing the displayed dealer name.
-- Keeps the lowest dealer.id as the canonical row, repoints every FK that references
-- dealer.id, then removes only the duplicate dealer master rows.
-- Run in Supabase SQL Editor after reviewing the dry-run query below.

-- DRY RUN: see duplicate dealer names and their ids before applying the merge.
-- SELECT lower(trim(name)) AS normalized_name, array_agg(id ORDER BY id) AS dealer_ids, count(*)
-- FROM dealer
-- WHERE coalesce(trim(name), '') <> ''
-- GROUP BY lower(trim(name))
-- HAVING count(*) > 1
-- ORDER BY normalized_name;

BEGIN;

CREATE TEMP TABLE _dealer_merge_map (old_id bigint PRIMARY KEY, keep_id bigint NOT NULL) ON COMMIT DROP;
INSERT INTO _dealer_merge_map(old_id, keep_id)
SELECT d.id, MIN(d2.id)
FROM dealer d
JOIN dealer d2
  ON lower(trim(coalesce(d2.name,''))) = lower(trim(coalesce(d.name,'')))
 AND d2.id <= d.id
WHERE trim(coalesce(d.name,'')) <> ''
GROUP BY d.id
HAVING MIN(d2.id) <> d.id;

-- Repoint every FK column whose constraint references dealer(id).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT tc.table_schema, tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name
     AND kcu.constraint_schema = tc.constraint_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
     AND ccu.constraint_schema = tc.constraint_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_schema = 'public'
      AND ccu.table_name = 'dealer'
      AND ccu.column_name = 'id'
  LOOP
    EXECUTE format(
      'UPDATE %I.%I t SET %I = m.keep_id FROM _dealer_merge_map m WHERE t.%I = m.old_id',
      r.table_schema, r.table_name, r.column_name, r.column_name
    );
  END LOOP;
END $$;

-- Remove only the now-unreferenced duplicate master rows.
DELETE FROM dealer d
USING _dealer_merge_map m
WHERE d.id = m.old_id;

COMMIT;
