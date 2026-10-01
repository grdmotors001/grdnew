-- GRD HR / Attendance / Salary module
CREATE TABLE IF NOT EXISTS employee (id SERIAL PRIMARY KEY, employee_code VARCHAR(40) UNIQUE NOT NULL, name VARCHAR(200) NOT NULL, department VARCHAR(80) DEFAULT 'HR', designation VARCHAR(120), mobile VARCHAR(30), joining_date DATE, machine_user_id VARCHAR(60) UNIQUE, basic_salary DOUBLE PRECISION DEFAULT 0, hra DOUBLE PRECISION DEFAULT 0, other_allowance DOUBLE PRECISION DEFAULT 0, overtime_rate DOUBLE PRECISION DEFAULT 0, active BOOLEAN DEFAULT TRUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS attendance_punch (id SERIAL PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employee(id), punch_time TIMESTAMP NOT NULL, punch_type VARCHAR(20) DEFAULT 'auto', device_ip VARCHAR(60), device_event_id VARCHAR(120) UNIQUE, source VARCHAR(20) DEFAULT 'manual', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS attendance_day (id SERIAL PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employee(id), work_date DATE NOT NULL, first_in TIMESTAMP, last_out TIMESTAMP, status VARCHAR(20) DEFAULT 'Absent', work_hours DOUBLE PRECISION DEFAULT 0, overtime_hours DOUBLE PRECISION DEFAULT 0, remarks VARCHAR(300), CONSTRAINT uq_attendance_day_employee_date UNIQUE(employee_id, work_date));
CREATE TABLE IF NOT EXISTS salary_run (id SERIAL PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employee(id), salary_month VARCHAR(7) NOT NULL, working_days INTEGER DEFAULT 0, present_days DOUBLE PRECISION DEFAULT 0, paid_leave_days DOUBLE PRECISION DEFAULT 0, overtime_hours DOUBLE PRECISION DEFAULT 0, basic_earned DOUBLE PRECISION DEFAULT 0, allowances DOUBLE PRECISION DEFAULT 0, overtime_amount DOUBLE PRECISION DEFAULT 0, deductions DOUBLE PRECISION DEFAULT 0, advance DOUBLE PRECISION DEFAULT 0, net_salary DOUBLE PRECISION DEFAULT 0, status VARCHAR(20) DEFAULT 'processed', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, CONSTRAINT uq_salary_run_employee_month UNIQUE(employee_id, salary_month));
CREATE INDEX IF NOT EXISTS idx_employee_department ON employee(department);
CREATE INDEX IF NOT EXISTS idx_employee_machine_user_id ON employee(machine_user_id);
CREATE INDEX IF NOT EXISTS idx_attendance_punch_employee_time ON attendance_punch(employee_id, punch_time);
CREATE INDEX IF NOT EXISTS idx_attendance_day_date ON attendance_day(work_date);
CREATE INDEX IF NOT EXISTS idx_salary_run_month ON salary_run(salary_month);


-- Dealer registration type + Cashfree dealer payments
ALTER TABLE dealer ADD COLUMN IF NOT EXISTS registration_type VARCHAR(20) DEFAULT 'registered';
CREATE INDEX IF NOT EXISTS idx_dealer_registration_type ON dealer(registration_type);
UPDATE dealer SET registration_type='registered' WHERE registration_type IS NULL OR trim(registration_type)='';

CREATE TABLE IF NOT EXISTS dealer_payment (id SERIAL PRIMARY KEY, dealer_id INTEGER NOT NULL REFERENCES dealer(id), order_id VARCHAR(80) UNIQUE NOT NULL, amount DOUBLE PRECISION NOT NULL, allocation_type VARCHAR(20) DEFAULT 'on_account', allocation_json TEXT, status VARCHAR(20) DEFAULT 'created', cf_payment_id VARCHAR(80), payment_method VARCHAR(50), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, paid_at TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_dealer_payment_dealer ON dealer_payment(dealer_id);
CREATE INDEX IF NOT EXISTS idx_dealer_payment_status ON dealer_payment(status);
