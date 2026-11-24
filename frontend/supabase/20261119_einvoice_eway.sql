-- E-Invoice (IRN) + E-Way Bill columns on tax_invoice. Safe to re-run.
ALTER TABLE tax_invoice ADD COLUMN IF NOT EXISTS irn text;
ALTER TABLE tax_invoice ADD COLUMN IF NOT EXISTS ack_no text;
ALTER TABLE tax_invoice ADD COLUMN IF NOT EXISTS ack_date text;
ALTER TABLE tax_invoice ADD COLUMN IF NOT EXISTS signed_qr_code text;
ALTER TABLE tax_invoice ADD COLUMN IF NOT EXISTS irn_status text;      -- null / generated / failed / cancelled
ALTER TABLE tax_invoice ADD COLUMN IF NOT EXISTS irn_error text;
ALTER TABLE tax_invoice ADD COLUMN IF NOT EXISTS ewb_no text;
ALTER TABLE tax_invoice ADD COLUMN IF NOT EXISTS ewb_date text;
ALTER TABLE tax_invoice ADD COLUMN IF NOT EXISTS ewb_valid_till text;
ALTER TABLE tax_invoice ADD COLUMN IF NOT EXISTS ewb_status text;      -- null / generated / failed / cancelled
ALTER TABLE tax_invoice ADD COLUMN IF NOT EXISTS ewb_error text;
CREATE UNIQUE INDEX IF NOT EXISTS tax_invoice_irn_uniq ON tax_invoice(irn) WHERE irn IS NOT NULL;
