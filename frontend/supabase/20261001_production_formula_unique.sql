-- Production formula: ek formula me ek raw material sirf ek baar.
-- Step 1: pehle dekh lein kaun si lines duplicate hain (sirf SELECT).
SELECT lower(btrim(product_name)) AS product, lower(btrim(formula_name)) AS formula,
       lower(btrim(raw_item_name)) AS raw_item, COUNT(*) AS rows, array_agg(id ORDER BY id) AS ids, array_agg(qty ORDER BY id) AS qtys
FROM production_formula
GROUP BY 1,2,3 HAVING COUNT(*) > 1;

-- Step 2: duplicates ko merge karein. Abhi tak ye lines consumption me jud kar katti thi,
-- isliye qty ka SUM sabse purani row me rakha gaya hai (behaviour same rahega). Qty galat ho to baad me formula page se theek karein.
-- Sirf wahi group merge hote hain jinki unit same hai; alag unit wale group ko haath se dekhein.
BEGIN;
WITH d AS (
  SELECT lower(btrim(COALESCE(product_name,''))) p, lower(btrim(COALESCE(formula_name,''))) f, lower(btrim(COALESCE(raw_item_name,''))) r,
         MIN(id) keep_id, SUM(qty) total
  FROM production_formula
  GROUP BY 1,2,3 HAVING COUNT(*) > 1 AND COUNT(DISTINCT lower(btrim(COALESCE(unit,'')))) = 1
)
UPDATE production_formula pf SET qty = d.total FROM d WHERE pf.id = d.keep_id;

DELETE FROM production_formula pf USING (
  SELECT lower(btrim(COALESCE(product_name,''))) p, lower(btrim(COALESCE(formula_name,''))) f, lower(btrim(COALESCE(raw_item_name,''))) r, MIN(id) keep_id
  FROM production_formula
  GROUP BY 1,2,3 HAVING COUNT(*) > 1 AND COUNT(DISTINCT lower(btrim(COALESCE(unit,'')))) = 1
) d
WHERE lower(btrim(COALESCE(pf.product_name,'')))=d.p AND lower(btrim(COALESCE(pf.formula_name,'')))=d.f
  AND lower(btrim(COALESCE(pf.raw_item_name,'')))=d.r AND pf.id<>d.keep_id;
COMMIT;

-- Step 3: unique index (app bhi ye index khud banane ki koshish karta hai, duplicates hon to skip karta hai).
CREATE UNIQUE INDEX IF NOT EXISTS uq_production_formula_line ON production_formula
  (lower(btrim(COALESCE(product_name,''))), lower(btrim(COALESCE(formula_name,''))), lower(btrim(COALESCE(raw_item_name,''))));
