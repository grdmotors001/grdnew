-- User Rights / Department support.
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "department" VARCHAR(30) DEFAULT 'Admin';
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "assigned_dealer_ids" TEXT;
CREATE INDEX IF NOT EXISTS idx_user_department ON "user" (department);

UPDATE "user" SET department = 'Admin' WHERE department IS NULL OR trim(department) = '';
