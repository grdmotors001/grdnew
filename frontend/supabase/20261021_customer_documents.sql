-- Customer documents (Aadhaar/PAN/Photo/Record/DL/PCC + admin papers). App ye table khud bana leta hai; ye file sirf reference ke liye hai.
CREATE TABLE IF NOT EXISTS customer_document (
  id bigserial PRIMARY KEY,
  dealer_id integer,
  customer_id bigint,   -- dealer_cash_customer.id
  invoice_id bigint,    -- tax_invoice.id
  doc_type text NOT NULL,
  file_name text NOT NULL,
  mime text NOT NULL,
  size integer NOT NULL DEFAULT 0,
  data bytea NOT NULL,
  uploaded_by text,
  uploaded_scope text,  -- 'dealer' | 'staff'
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_document_customer_idx ON customer_document(customer_id);
CREATE INDEX IF NOT EXISTS customer_document_invoice_idx ON customer_document(invoice_id);
