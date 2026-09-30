-- Insurance Register: New + Old insurance records.
CREATE TABLE IF NOT EXISTS insurance_register (
  id bigserial PRIMARY KEY,
  insurance_type text NOT NULL CHECK (insurance_type IN ('NEW','OLD')),
  date date NOT NULL DEFAULT CURRENT_DATE,
  customer_name text NOT NULL DEFAULT '',
  total_premium numeric(14,2) NOT NULL DEFAULT 0,
  net_premium numeric(14,2) NOT NULL DEFAULT 0,
  discount_rate numeric(8,4) NOT NULL DEFAULT 0,
  payable_amount numeric(14,2) NOT NULL DEFAULT 0,
  insurer text NOT NULL DEFAULT '',
  chassis_no text,
  bill_no text,
  sp_no text,
  vehicle text,
  dealer_id bigint,
  remarks text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS insurance_register_type_idx ON insurance_register(insurance_type);
CREATE INDEX IF NOT EXISTS insurance_register_chassis_idx ON insurance_register(lower(btrim(chassis_no)));
CREATE INDEX IF NOT EXISTS insurance_register_bill_idx ON insurance_register(lower(btrim(bill_no)));
CREATE INDEX IF NOT EXISTS insurance_register_sp_idx ON insurance_register(lower(btrim(sp_no)));
CREATE INDEX IF NOT EXISTS insurance_register_insurer_idx ON insurance_register(lower(btrim(insurer)));
