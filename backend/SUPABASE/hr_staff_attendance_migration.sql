-- GRD HR migration: staff photo + attendance late tracking
alter table if exists employee add column if not exists photo_url varchar(500);
alter table if exists attendance_day add column if not exists late_minutes integer default 0;

create index if not exists ix_attendance_day_employee_date on attendance_day(employee_id, work_date);
