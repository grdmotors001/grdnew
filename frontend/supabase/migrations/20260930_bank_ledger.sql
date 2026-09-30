CREATE TABLE IF NOT EXISTS bank_ledger_entry (
  id bigserial PRIMARY KEY,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  bank_name text NOT NULL DEFAULT '',
  cheque_no text,
  upi_ref text,
  narration text,
  party_name text,
  entry_type text NOT NULL DEFAULT 'SUSPENSE' CHECK (entry_type IN ('SUSPENSE','RECEIPT','PAYMENT')),
  status text NOT NULL DEFAULT 'SUSPENSE' CHECK (status IN ('SUSPENSE','POSTED','CANCELLED')),
  source text DEFAULT 'EXCEL',
  source_ref text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bank_ledger_date_idx ON bank_ledger_entry(entry_date DESC);
CREATE INDEX IF NOT EXISTS bank_ledger_bank_idx ON bank_ledger_entry(lower(btrim(bank_name)));
CREATE INDEX IF NOT EXISTS bank_ledger_status_idx ON bank_ledger_entry(status);
CREATE INDEX IF NOT EXISTS bank_ledger_ref_idx ON bank_ledger_entry(lower(btrim(cheque_no)), lower(btrim(upi_ref)));
