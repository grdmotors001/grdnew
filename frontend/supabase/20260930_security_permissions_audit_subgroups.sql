-- GRD Security / Permissions / Audit / Product Sub Group
-- Safe to run multiple times. Runtime API also ensures these objects for deployments
-- where migrations are not automatically applied.
CREATE TABLE IF NOT EXISTS user_action_permission (
  id bigserial PRIMARY KEY, user_id bigint NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  module_key text NOT NULL, can_view boolean NOT NULL DEFAULT false, can_create boolean NOT NULL DEFAULT false,
  can_edit boolean NOT NULL DEFAULT false, can_delete boolean NOT NULL DEFAULT false, can_approve boolean NOT NULL DEFAULT false,
  UNIQUE(user_id,module_key)
);
CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY, user_id bigint, username text, department text, module_key text, action text NOT NULL,
  record_id text, record_ref text, old_value jsonb, new_value jsonb, dealer_id bigint, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_user_idx ON audit_log(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_module_idx ON audit_log(module_key,created_at DESC);
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS assigned_dealer_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE TABLE IF NOT EXISTS product_sub_group (id bigserial PRIMARY KEY, name text NOT NULL UNIQUE, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now());
INSERT INTO product_sub_group(name) VALUES('Primary') ON CONFLICT(name) DO NOTHING;
ALTER TABLE product ADD COLUMN IF NOT EXISTS sub_group_id bigint;
ALTER TABLE product ADD COLUMN IF NOT EXISTS sub_group_name text;
UPDATE product SET sub_group_name='Primary' WHERE COALESCE(BTRIM(sub_group_name),'')='';
