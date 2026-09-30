-- Contra voucher (Bank->Bank, Cash->Bank, Bank->Cash). API bhi table auto-create kar leti hai; ye file sirf record/manual run ke liye.
CREATE TABLE IF NOT EXISTS contra_voucher (
  id bigserial PRIMARY KEY,
  vr_no integer,
  date date NOT NULL DEFAULT CURRENT_DATE,
  from_type text NOT NULL, from_bank_id integer, from_bank_name text,
  to_type text NOT NULL, to_bank_id integer, to_bank_name text,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  ref_no text, narration text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contra_voucher_date_idx ON contra_voucher(date DESC);
