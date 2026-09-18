"""
diagnose_tax_invoices.py
---------------------------
Runs the exact same query + serialization logic as the /api/tax-invoices
GET endpoint, directly against Supabase (using .env's DATABASE_URL),
bypassing HTTP and auth entirely. This will print the full Python
traceback of whatever is actually failing on the real production data --
much faster than digging through server logs.

Usage (run from the backend folder, where .env points at Supabase):

    python diagnose_tax_invoices.py
"""
import os
import traceback
from dotenv import load_dotenv
load_dotenv()

if not os.environ.get("DATABASE_URL"):
    print("ERROR: DATABASE_URL not set in .env -- this must point at Supabase.")
    raise SystemExit(1)

from app import app, ser_ti, ser_dc
from models import db, TaxInvoice, DeliveryChallan

with app.app_context():
    print(f"Connected to: {db.engine.url.render_as_string(hide_password=True)}\n")

    print("Step 1: counting rows...")
    try:
        total = TaxInvoice.query.count()
        print(f"  OK -- total TaxInvoice rows: {total}")
    except Exception:
        print("  FAILED at count():")
        traceback.print_exc()
        raise SystemExit(1)

    print("\nStep 2: running the paginated query (page 1, 50 rows)...")
    try:
        query = TaxInvoice.query.order_by(TaxInvoice.date.desc(), TaxInvoice.id.desc())
        rows = query.offset(0).limit(50).all()
        print(f"  OK -- fetched {len(rows)} rows")
    except Exception:
        print("  FAILED fetching rows:")
        traceback.print_exc()
        raise SystemExit(1)

    print("\nStep 3: serializing each row with ser_ti() one at a time "
          "(to find which specific row breaks, if any)...")
    bad_rows = []
    for r in rows:
        try:
            ser_ti(r)
        except Exception as e:
            bad_rows.append((r.id, r.bill_no, r.chassis_no, repr(e)))

    if bad_rows:
        print(f"  FOUND {len(bad_rows)} row(s) that fail to serialize:")
        for rid, bill_no, chassis, err in bad_rows:
            print(f"    id={rid} bill_no={bill_no!r} chassis_no={chassis!r} -> {err}")
        print("\n  Full traceback for the first bad row:")
        bad_id = bad_rows[0][0]
        bad_row = TaxInvoice.query.get(bad_id)
        try:
            ser_ti(bad_row)
        except Exception:
            traceback.print_exc()
    else:
        print("  OK -- all 50 rows serialized fine.")

        print("\nStep 4: fetching + serializing uninvoiced_challans...")
        try:
            uninvoiced = DeliveryChallan.query.filter(
                DeliveryChallan.cancelled.is_(False),
                ~DeliveryChallan.id.in_(db.session.query(TaxInvoice.delivery_challan_id)
                                         .filter(TaxInvoice.delivery_challan_id.isnot(None)))
            ).order_by(DeliveryChallan.date.desc()).all()
            print(f"  OK -- {len(uninvoiced)} uninvoiced challans found")
            bad_dc = []
            for c in uninvoiced:
                try:
                    ser_dc(c)
                except Exception as e:
                    bad_dc.append((c.id, c.challan_no, c.chassis_no, repr(e)))
            if bad_dc:
                print(f"  FOUND {len(bad_dc)} delivery_challan row(s) that fail to serialize:")
                for cid, cno, chassis, err in bad_dc:
                    print(f"    id={cid} challan_no={cno!r} chassis_no={chassis!r} -> {err}")
                print("\n  Full traceback for the first bad row:")
                bad_id = bad_dc[0][0]
                bad_c = DeliveryChallan.query.get(bad_id)
                try:
                    ser_dc(bad_c)
                except Exception:
                    traceback.print_exc()
            else:
                print("  OK -- all uninvoiced_challans serialized fine.")
                print("\nEverything succeeded end-to-end -- couldn't reproduce the 500 here. "
                      "The bug might be page/search-parameter-specific -- tell me what URL "
                      "was actually being requested when it failed.")
        except Exception:
            print("  FAILED at uninvoiced_challans step:")
            traceback.print_exc()
