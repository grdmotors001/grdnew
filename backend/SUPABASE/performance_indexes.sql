-- GRD Motors performance indexes for Supabase/PostgreSQL.
-- Safe to run repeatedly. These indexes target the large tables used by
-- Closing Stock, Stock Ledger, Dashboard and register/report screens.

CREATE INDEX IF NOT EXISTS idx_pvi_voucher_id ON production_voucher_item (voucher_id);
CREATE INDEX IF NOT EXISTS idx_pbi_bill_id ON purchase_bill_item (bill_id);
CREATE INDEX IF NOT EXISTS idx_dc_dealer_id ON delivery_challan (dealer_id);
CREATE INDEX IF NOT EXISTS idx_ti_delivery_challan_id ON tax_invoice (delivery_challan_id);
CREATE INDEX IF NOT EXISTS idx_dc_vehicle_id ON delivery_challan (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_ti_vehicle_id ON tax_invoice (vehicle_id);

CREATE INDEX IF NOT EXISTS idx_pv_date ON production_voucher (date);
CREATE INDEX IF NOT EXISTS idx_pb_date ON purchase_bill (date);
CREATE INDEX IF NOT EXISTS idx_dc_date ON delivery_challan (date);
CREATE INDEX IF NOT EXISTS idx_ti_date ON tax_invoice (date);
CREATE INDEX IF NOT EXISTS idx_js_date ON journal_stock (date);
CREATE INDEX IF NOT EXISTS idx_db_date ON day_book (date);
CREATE INDEX IF NOT EXISTS idx_or_date ON old_rickshaw (date);
CREATE INDEX IF NOT EXISTS idx_bdc_date ON battery_delivery_challan (date);

CREATE INDEX IF NOT EXISTS idx_v_chassis_no ON vehicle (chassis_no);
CREATE INDEX IF NOT EXISTS idx_pv_chassis_no ON production_voucher (chassis_no);
CREATE INDEX IF NOT EXISTS idx_dc_chassis_no ON delivery_challan (chassis_no);
CREATE INDEX IF NOT EXISTS idx_ti_chassis_no ON tax_invoice (chassis_no);

CREATE INDEX IF NOT EXISTS idx_vehicle_stage_date_id ON vehicle (stage, date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_pv_date_id ON production_voucher (date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_dc_date_id ON delivery_challan (date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_ti_date_id ON tax_invoice (date DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_pvi_item_name_trim ON production_voucher_item ((trim(item_name)));
CREATE INDEX IF NOT EXISTS idx_pbi_item_name_trim ON purchase_bill_item ((trim(item_name)));
CREATE INDEX IF NOT EXISTS idx_js_item_name_trim ON journal_stock ((trim(item_name)));

ANALYZE production_voucher_item;
ANALYZE purchase_bill_item;
ANALYZE production_voucher;
ANALYZE delivery_challan;
ANALYZE tax_invoice;
ANALYZE vehicle;
