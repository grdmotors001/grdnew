-- Production Voucher / stock check tez karne ke liye (Supabase SQL Editor me ek baar chalayein).
-- journal_stock me item_name par lower(btrim()) se search hota hai, index na hone se har baar poori table scan hoti thi.
CREATE INDEX IF NOT EXISTS journal_stock_item_lower_idx ON journal_stock (lower(btrim(item_name)));
CREATE INDEX IF NOT EXISTS journal_stock_batch_ref_idx ON journal_stock (batch_ref);
CREATE INDEX IF NOT EXISTS product_name_lower_idx ON product (lower(btrim(name)));
