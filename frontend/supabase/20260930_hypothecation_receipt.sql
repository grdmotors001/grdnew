-- Financer (hypothecation) receipts: bank money received from financers, linked to a Tax Invoice via chassis/vehicle no.
CREATE TABLE IF NOT EXISTS hypothecation_receipt (
  id bigserial PRIMARY KEY,
  receipt_date date NOT NULL DEFAULT CURRENT_DATE,
  financer_name text NOT NULL DEFAULT '',
  amount numeric(14,2) NOT NULL DEFAULT 0,
  cheque_no text NOT NULL DEFAULT '',
  tax_invoice_id bigint NOT NULL,
  chassis_no text, vehicle_no text, bill_no text, buyer_name text, remarks text, created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hyp_receipt_invoice_idx ON hypothecation_receipt(tax_invoice_id);
CREATE INDEX IF NOT EXISTS hyp_receipt_date_idx ON hypothecation_receipt(receipt_date DESC);
CREATE INDEX IF NOT EXISTS hyp_receipt_cheque_idx ON hypothecation_receipt(lower(btrim(cheque_no)));
ALTER TABLE tax_invoice ADD COLUMN IF NOT EXISTS vehicle_reg_no text;
ALTER TABLE hypothecation_receipt ADD COLUMN IF NOT EXISTS pay_mode text NOT NULL DEFAULT 'CASH';
ALTER TABLE hypothecation_receipt ADD COLUMN IF NOT EXISTS bank_name text;
ALTER TABLE hypothecation_receipt ADD COLUMN IF NOT EXISTS day_book_id bigint;
ALTER TABLE hypothecation_receipt ADD COLUMN IF NOT EXISTS bank_ledger_id bigint;
