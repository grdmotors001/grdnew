"""
add_db_indexes.py
--------------------
The real, durable fix for the repeated slowness/502s/timeouts on Closing
Stock, Stock Ledger, and other reports: the large tables
(production_voucher_item: 517k+ rows, tax_invoice: 16k+, delivery_challan:
17k+, etc.) have NO indexes on the columns we constantly filter/join by --
item_name, voucher_id, bill_id, dealer_id, date. Postgres auto-indexes only
primary keys, so every WHERE/JOIN on these columns forces a full table
scan, no matter how well the query itself is written. This is why even
the rewritten (no-N+1) queries can still be slow or time out.

This script adds indexes for the columns that matter most, safely
(CREATE INDEX IF NOT EXISTS -- won't error or duplicate if run more than
once, and doesn't touch or risk any data).

Note: TRIM(item_name) is used as a filter/group-by in several endpoints
(to work around inconsistent trailing whitespace in the legacy-imported
item names) -- a plain index on item_name can't be used for that, so this
also creates FUNCTIONAL indexes on trim(item_name) specifically.

Usage (run from the backend folder, where .env points at Supabase):

    python add_db_indexes.py

This can take a few minutes the first time (building an index over 500k+
rows), but only needs to be run once -- after that, every query that
filters/joins on these columns gets dramatically faster.
"""
import os
import time
from dotenv import load_dotenv
load_dotenv()

if not os.environ.get("DATABASE_URL"):
    print("ERROR: DATABASE_URL not set in .env -- this must point at Supabase.")
    raise SystemExit(1)

from app import app
from models import db

# (index_name, table, DDL column expression)
INDEXES = [
    # Foreign keys used in JOINs -- Postgres does NOT auto-index these.
    ("idx_pvi_voucher_id", "production_voucher_item", "voucher_id"),
    ("idx_pbi_bill_id", "purchase_bill_item", "bill_id"),
    ("idx_dc_dealer_id", "delivery_challan", "dealer_id"),
    ("idx_ti_delivery_challan_id", "tax_invoice", "delivery_challan_id"),
    ("idx_dc_vehicle_id", "delivery_challan", "vehicle_id"),
    ("idx_ti_vehicle_id", "tax_invoice", "vehicle_id"),

    # Date columns used in every "From/To" range filter and for sorting.
    ("idx_pv_date", "production_voucher", "date"),
    ("idx_pb_date", "purchase_bill", "date"),
    ("idx_dc_date", "delivery_challan", "date"),
    ("idx_ti_date", "tax_invoice", "date"),
    ("idx_js_date", "journal_stock", "date"),
    ("idx_db_date", "day_book", "date"),
    ("idx_or_date", "old_rickshaw", "date"),
    ("idx_bdc_date", "battery_delivery_challan", "date"),

    # Chassis number -- used for search and for the production pipeline
    # lookups (Manufacturing -> Delivery Challan -> Tax Invoice).
    ("idx_v_chassis_no", "vehicle", "chassis_no"),
    ("idx_pv_chassis_no", "production_voucher", "chassis_no"),
    ("idx_dc_chassis_no", "delivery_challan", "chassis_no"),
    ("idx_ti_chassis_no", "tax_invoice", "chassis_no"),

    # Composite indexes for the dashboard and paginated list screens.
    ("idx_vehicle_stage_date_id", "vehicle", "stage, date DESC, id DESC"),
    ("idx_pv_date_id", "production_voucher", "date DESC, id DESC"),
    ("idx_dc_date_id", "delivery_challan", "date DESC, id DESC"),
    ("idx_ti_date_id", "tax_invoice", "date DESC, id DESC"),
    ("idx_product_fro_name", "product", "fro, name"),
]

# Functional indexes for the TRIM(item_name) comparisons used in the
# Closing Stock / Stock Ledger (Raw Material) endpoints.
FUNCTIONAL_INDEXES = [
    ("idx_pvi_item_name_trim", "production_voucher_item", "trim(item_name)"),
    ("idx_pbi_item_name_trim", "purchase_bill_item", "trim(item_name)"),
    ("idx_js_item_name_trim", "journal_stock", "trim(item_name)"),
]


def main():
    with app.app_context():
        if db.engine.dialect.name != "postgresql":
            print(f"This database is '{db.engine.dialect.name}', not postgresql -- "
                  f"indexes aren't the bottleneck for SQLite at this scale, skipping.")
            return

        print(f"Connected to: {db.engine.url.render_as_string(hide_password=True)}\n")

        with db.engine.begin() as conn:
            for name, table, col in INDEXES:
                print(f"  Creating {name} on {table}({col}) ...", end=" ", flush=True)
                t0 = time.time()
                conn.exec_driver_sql(f'CREATE INDEX IF NOT EXISTS {name} ON "{table}" ({col})')
                print(f"done in {time.time() - t0:.1f}s")

            for name, table, expr in FUNCTIONAL_INDEXES:
                print(f"  Creating {name} on {table}({expr}) ...", end=" ", flush=True)
                t0 = time.time()
                conn.exec_driver_sql(f'CREATE INDEX IF NOT EXISTS {name} ON "{table}" ({expr})')
                print(f"done in {time.time() - t0:.1f}s")

        print("\nAll indexes created (or already existed). Restart the backend and retest --")
        print("queries filtering/joining on these columns should now be much faster.")


if __name__ == "__main__":
    main()
