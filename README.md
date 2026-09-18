# G.R.D. Motors eBill — Conversion (Step 1 + 2 of the brief)

This is the output of `CONVERSION_BRIEF.md`'s recommended priority order:

1. ✅ **JSON API layer against the existing modules** — `backend/`
2. ✅ **React/Next.js web frontend against it** — `frontend/`
3. ⬜ Outlet + dealer-portal features — not started (new scope, brief Section 5)
4. ⬜ Mobile app — not started (brief recommends building this last)

## Quick start

```bash
# Terminal 1
cd backend && pip install -r requirements.txt && python3 app.py

# Terminal 2
cd frontend && npm install && BACKEND_URL=http://localhost:5000 npm run dev
```

Open `http://localhost:3000`, log in as `admin` / `admin1`.

See `backend/README.md` and `frontend/README.md` for full detail —
endpoint map, what's verified working, what's not built yet, and
deployment notes.

## What's been verified end-to-end (not just written — actually run)

- Full stack booted together (Flask + Next.js dev proxy) and exercised
  over HTTP, not just unit-level.
- Login → token issued → protected routes reject without it (401) →
  accepted with it.
- **BOM auto-consumption**: a Production Voucher raised with no item
  lines correctly copies the matching Production Formula.
- **Chassis pipeline**: a chassis moves Manufacturing → Delivery Challan
  → Tax Invoice, and reverts correctly on Delivery Challan cancel and Tax
  Invoice cancel/delete.
- **GST split**: an intra-state Tax Invoice split ₹5,000 tax into
  ₹2,500 CGST + ₹2,500 SGST (not IGST) — matching the brief's rule exactly.
- Existing `ebill.db` (from the original Flask app) loads and migrates
  cleanly against the new API's schema expectations.

## What's genuinely new scope vs. this conversion

Everything in `CONVERSION_BRIEF.md` Section 5 (dealer portal,
multi-outlet, outlet cashbook, mobile app) — none of that existed in the
original Flask app either, and none of it is built here. It needs its
own design pass before implementation, per the brief's own recommendation.

## Print documents — implemented, layout is best-effort

Delivery Challan, Tax Invoice, Affidavit, Undertaking, and Form-22 all
have working print endpoints (backend) and print-ready views (frontend,
with a browser Print button), plus the UMRN upload-code `.TXT` download.
**The original app's actual print templates weren't included** in the
files handed over for this conversion (only `app.py`/`models.py`/
`menu_config.py` were) — so while every field the original routes
gathered is wired through correctly (RTO address substitution, bank
fallback logic, GST split), the visual layout is a reconstruction, not a
pixel-match. Compare a rendered copy against a real original printout
before relying on these for RTO/GST submission.

## Files handed over from the original app, unchanged

`backend/models.py` and `backend/menu_config.py` are copied verbatim —
the database schema and menu structure did not need to change for the
API conversion, only the routes serving them.
