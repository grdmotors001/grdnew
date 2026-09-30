ALTER TABLE dealer ADD COLUMN IF NOT EXISTS sub_group_name text;
UPDATE dealer SET sub_group_name='Primary' WHERE COALESCE(BTRIM(sub_group_name),'')='';
