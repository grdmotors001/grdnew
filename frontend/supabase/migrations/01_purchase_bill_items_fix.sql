-- 01_purchase_bill_items_fix.sql
-- Purchase Bill: value / items nahi aa rahe the.
-- Reason: naya Node code items ko purchase_bill.items (jsonb) me padhta/likhta hai,
-- lekin migrated Supabase schema (models.py) me items alag table purchase_bill_item me the
-- aur purchase_bill.items column tha hi nahi -> insert me items chup-chaap drop ho jate the.
--
-- STEP 0 (sirf check, pehle chalao):
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_name='purchase_bill' AND column_name='items';
-- SELECT count(*) AS bills, (SELECT count(*) FROM purchase_bill_item) AS old_items FROM purchase_bill;
--
-- Safe to re-run.

BEGIN;

ALTER TABLE purchase_bill ADD COLUMN IF NOT EXISTS items jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Purane (migrated) bills ke items purchase_bill_item se jsonb me copy
DO $$
BEGIN
  IF to_regclass('public.purchase_bill_item') IS NOT NULL THEN
    UPDATE purchase_bill pb
       SET items = sub.items
      FROM (
        SELECT bill_id,
               jsonb_agg(jsonb_build_object(
                 'item_name', item_name, 'hsn_code', hsn_code,
                 'qty', COALESCE(qty,0), 'rate', COALESCE(rate,0),
                 'gst_rate', COALESCE(gst_rate,0)) ORDER BY id) AS items
          FROM purchase_bill_item
         GROUP BY bill_id
      ) sub
     WHERE sub.bill_id = pb.id
       AND (pb.items IS NULL OR pb.items = '[]'::jsonb);
  END IF;
END $$;

COMMIT;

-- Verify: kitne bills ke items bhare gaye
-- SELECT count(*) FILTER (WHERE jsonb_array_length(items)>0) AS with_items, count(*) AS total FROM purchase_bill;
