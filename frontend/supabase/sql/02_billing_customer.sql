-- 02_billing_customer.sql
-- Alag Customer master (dealer_id ke saath) + purane tax invoices se backfill.
-- NOTE: existing `customer` table CHFPL loan workflow ki hai (full_name/phone), isliye
-- ye naya table `billing_customer` naam se bana hai -- dono me takraav nahi hoga.
-- Safe to re-run (duplicate nahi banayega).

BEGIN;

CREATE TABLE IF NOT EXISTS billing_customer (
  id          bigserial PRIMARY KEY,
  dealer_id   integer REFERENCES dealer(id) ON DELETE SET NULL,
  name        text NOT NULL,
  relation    text,
  father_name text,
  address     text,
  mobile      text,
  gst_no      text,
  pan         text,
  aadhar      text,
  dob         date,
  state       text,
  state_code  text,
  license_no  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Ek dealer ke andar same naam + mobile = ek hi customer
CREATE UNIQUE INDEX IF NOT EXISTS billing_customer_uniq
  ON billing_customer (COALESCE(dealer_id,0), lower(btrim(name)), COALESCE(btrim(mobile),''));
CREATE INDEX IF NOT EXISTS billing_customer_dealer_idx ON billing_customer(dealer_id);

ALTER TABLE tax_invoice ADD COLUMN IF NOT EXISTS customer_id bigint;
CREATE INDEX IF NOT EXISTS tax_invoice_customer_idx ON tax_invoice(customer_id);

-- Purane saare bills (GST wale + bina GST wale dono) se customers.
-- Jahan buyer = dealer khud (default bill) wahan customer nahi banega.
-- Har customer ki details uske sabse latest bill se li jati hain.
INSERT INTO billing_customer
  (dealer_id, name, relation, father_name, address, mobile, gst_no, pan, aadhar, dob, state, state_code, license_no)
SELECT DISTINCT ON (COALESCE(ti.dealer_id,0), lower(btrim(ti.buyer_name)), COALESCE(btrim(ti.buyer_mobile),''))
       ti.dealer_id,
       btrim(ti.buyer_name),
       NULLIF(btrim(ti.buyer_relation),''),
       NULLIF(btrim(ti.buyer_father_name),''),
       NULLIF(btrim(ti.buyer_address),''),
       NULLIF(btrim(ti.buyer_mobile),''),
       NULLIF(btrim(ti.buyer_gst_no),''),
       NULLIF(btrim(ti.buyer_pan),''),
       NULLIF(btrim(ti.buyer_aadhar),''),
       ti.buyer_dob,
       NULLIF(btrim(ti.buyer_state),''),
       NULLIF(btrim(ti.buyer_state_code),''),
       NULLIF(btrim(ti.license_no),'')
  FROM tax_invoice ti
  LEFT JOIN dealer d ON d.id = ti.dealer_id
 WHERE btrim(COALESCE(ti.buyer_name,'')) <> ''
   AND lower(btrim(ti.buyer_name)) <> lower(btrim(COALESCE(ti.dealer_name, d.name, '')))
 ORDER BY COALESCE(ti.dealer_id,0), lower(btrim(ti.buyer_name)), COALESCE(btrim(ti.buyer_mobile),''),
          ti.date DESC NULLS LAST, ti.id DESC
ON CONFLICT DO NOTHING;

-- Purane bills me customer_id link
UPDATE tax_invoice ti
   SET customer_id = bc.id
  FROM billing_customer bc
 WHERE ti.customer_id IS NULL
   AND COALESCE(ti.dealer_id,0) = COALESCE(bc.dealer_id,0)
   AND lower(btrim(ti.buyer_name)) = lower(btrim(bc.name))
   AND COALESCE(btrim(ti.buyer_mobile),'') = COALESCE(btrim(bc.mobile),'');

COMMIT;

-- Check:
-- SELECT count(*) AS customers, count(*) FILTER (WHERE gst_no IS NULL) AS without_gst FROM billing_customer;
-- SELECT count(*) AS linked, count(*) FILTER (WHERE customer_id IS NULL) AS unlinked FROM tax_invoice;
-- Same naam, alag mobile wale (shayad ek hi banda -- manual merge ke liye):
-- SELECT dealer_id, lower(btrim(name)) n, count(*) FROM billing_customer GROUP BY 1,2 HAVING count(*)>1 ORDER BY 3 DESC;
