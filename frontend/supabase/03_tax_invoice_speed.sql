-- Tax Invoice list speed. Safe to run more than once. Run in Supabase SQL Editor.
-- List = ORDER BY date DESC, id DESC LIMIT 50 over 16k+ rows.
CREATE INDEX IF NOT EXISTS tax_invoice_date_id_idx ON tax_invoice (date DESC, id DESC);
-- "un-invoiced challans" query: NOT EXISTS (tax_invoice by delivery_challan_id).
CREATE INDEX IF NOT EXISTS tax_invoice_challan_idx ON tax_invoice (delivery_challan_id);
CREATE INDEX IF NOT EXISTS delivery_challan_date_idx ON delivery_challan (date DESC, id DESC);
CREATE INDEX IF NOT EXISTS tax_invoice_chassis_idx ON tax_invoice (chassis_no);
ANALYZE tax_invoice;
ANALYZE delivery_challan;
