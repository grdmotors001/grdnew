-- Run in Supabase SQL editor. Safe to re-run.
CREATE TABLE IF NOT EXISTS nav_tab (
  id        SERIAL PRIMARY KEY,
  key       TEXT,
  label     TEXT NOT NULL DEFAULT '',
  icon      TEXT,
  position  INTEGER NOT NULL DEFAULT 0,
  hidden    BOOLEAN NOT NULL DEFAULT false,
  items     TEXT[] NOT NULL DEFAULT '{}'
);
-- In case the table already exists from an older schema with missing columns:
ALTER TABLE nav_tab ADD COLUMN IF NOT EXISTS key      TEXT;
ALTER TABLE nav_tab ADD COLUMN IF NOT EXISTS label    TEXT NOT NULL DEFAULT '';
ALTER TABLE nav_tab ADD COLUMN IF NOT EXISTS icon     TEXT;
ALTER TABLE nav_tab ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0;
ALTER TABLE nav_tab ADD COLUMN IF NOT EXISTS hidden   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE nav_tab ADD COLUMN IF NOT EXISTS items    TEXT[] NOT NULL DEFAULT '{}';
CREATE UNIQUE INDEX IF NOT EXISTS nav_tab_key_uq ON nav_tab (key);
