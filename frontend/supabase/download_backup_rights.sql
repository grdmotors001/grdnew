-- Optional: the app runs this automatically on first API call, but you can run it manually in Supabase.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_action_permission' AND column_name='can_download') THEN
    ALTER TABLE user_action_permission ADD COLUMN can_download boolean NOT NULL DEFAULT false;
    UPDATE user_action_permission SET can_download = can_view;  -- existing users keep their current export access
  END IF;
END $$;
ALTER TABLE user_action_permission ADD COLUMN IF NOT EXISTS can_backup boolean NOT NULL DEFAULT false;
