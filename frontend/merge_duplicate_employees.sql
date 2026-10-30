-- Import se bane duplicate employees (jaise "factory-2") ko purane employee (code "2") me merge karta hai.
-- Attendance purane employee par shift ho jati hai, Location purane employee par lag jati hai,
-- phir duplicate employee delete ho jata hai. Chalane se pehle DATABASE BACKUP le lein.

-- ========== STEP 1: PREVIEW (sirf dikhata hai, kuch badalta nahi) ==========
SELECT o.id AS purana_id, o.employee_code AS purana_code, o.name AS purana_name,
       n.id AS duplicate_id, n.employee_code AS duplicate_code, n.location,
       (SELECT count(*) FROM hr_attendance a WHERE a.employee_id = n.id) AS duplicate_attendance_din,
       (SELECT count(*) FROM hr_salary s WHERE s.employee_id = n.id)     AS duplicate_salary_rows
FROM hr_employee n
JOIN hr_employee o
  ON o.id <> n.id
 AND btrim(o.machine_user_id) = btrim(n.machine_user_id)
 AND COALESCE(btrim(o.location), '') = ''
WHERE COALESCE(btrim(n.location), '') <> ''
  AND n.employee_code = n.location || '-' || n.machine_user_id
ORDER BY o.id;
-- Agar duplicate_salary_rows 0 se zyada ho to pehle mujhe batayein (wo rows delete ho jayengi).

-- ========== STEP 2: MERGE (Step 1 ka result sahi lage tabhi chalayein) ==========
BEGIN;

CREATE TEMP TABLE dup_map AS
SELECT DISTINCT ON (n.id) o.id AS old_id, n.id AS new_id, n.location AS loc
FROM hr_employee n
JOIN hr_employee o
  ON o.id <> n.id
 AND btrim(o.machine_user_id) = btrim(n.machine_user_id)
 AND COALESCE(btrim(o.location), '') = ''
WHERE COALESCE(btrim(n.location), '') <> ''
  AND n.employee_code = n.location || '-' || n.machine_user_id
ORDER BY n.id, o.id;

-- attendance purane employee par (jo din purane ke paas pehle se hai wo chhod kar)
UPDATE hr_attendance a
SET employee_id = m.old_id
FROM dup_map m
WHERE a.employee_id = m.new_id
  AND NOT EXISTS (SELECT 1 FROM hr_attendance b WHERE b.employee_id = m.old_id AND b.work_date = a.work_date);

-- location purane employee par
UPDATE hr_employee o
SET location = m.loc
FROM dup_map m
WHERE o.id = m.old_id AND COALESCE(btrim(o.location), '') = '';

-- duplicate delete (bachi hui attendance/salary cascade se hat jati hai)
DELETE FROM hr_employee WHERE id IN (SELECT new_id FROM dup_map);

COMMIT;
