-- Run this once in Supabase's SQL Editor (Project > SQL Editor > New query).
--
-- WHY: models.py had `bill_no = db.Column(db.String(30), unique=True)` on
-- TaxInvoice. Several real entries (e.g. "GRD/1000") only remove a chassis
-- from stock and never get a real bill cut against them, so more than one
-- such row legitimately shares the same bill_no. When importing from
-- MDB -> DB -> Supabase, the first row with a given placeholder bill_no
-- (e.g. "GRD/1000") inserted fine, but Postgres silently rejected every
-- later row that reused the same bill_no because of this UNIQUE constraint
-- -- so those rows never made it into Supabase at all. This isn't limited
-- to one date; wherever the same placeholder bill_no was reused anywhere
-- across the ~17,000+ invoices, the same rows would have been dropped.
--
-- This script removes that UNIQUE constraint/index (whichever form it
-- actually took when the table was created), so future imports/inserts
-- with a repeated bill_no succeed. It does NOT recover rows already lost
-- from a *previous* import — see the note at the end for that.

DO $$
DECLARE
    conname text;
BEGIN
    -- Case 1: created as a table-level UNIQUE CONSTRAINT (the common case
    -- for SQLAlchemy's Column(unique=True) via db.create_all()).
    SELECT tc.constraint_name INTO conname
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
    WHERE tc.table_name = 'tax_invoice'
      AND tc.constraint_type = 'UNIQUE'
      AND ccu.column_name = 'bill_no'
    LIMIT 1;

    IF conname IS NOT NULL THEN
        EXECUTE format('ALTER TABLE tax_invoice DROP CONSTRAINT %I', conname);
        RAISE NOTICE 'Dropped unique constraint: %', conname;
    ELSE
        RAISE NOTICE 'No table-level unique constraint found on tax_invoice.bill_no (checking for a unique index next).';
    END IF;
END $$;

-- Case 2: created as a standalone UNIQUE INDEX instead of a table
-- constraint. Harmless no-op if it doesn't exist.
DROP INDEX IF EXISTS tax_invoice_bill_no_key;
DROP INDEX IF EXISTS ix_tax_invoice_bill_no;

-- Sanity check -- should return 0 rows once the constraint/index is gone.
-- (Run this any time to confirm nothing still blocks a duplicate bill_no.)
SELECT conname, contype
FROM pg_constraint
WHERE conrelid = 'tax_invoice'::regclass AND contype = 'u';

-- ---------------------------------------------------------------------
-- RECOVERING ROWS ALREADY LOST FROM A PAST IMPORT:
-- This script only fixes the schema going forward. Any "GRD/1000"-style
-- rows that were already silently dropped during a previous MDB import
-- are NOT in Supabase and can't be recovered by this script -- they need
-- to be re-imported from the original MDB now that the constraint is gone.
-- If your import script can be re-run safely (i.e. it won't create fresh
-- duplicates of rows that DID import successfully the first time), re-run
-- it after this fix and the previously-skipped rows should go in cleanly.
-- ---------------------------------------------------------------------
