# eBill JSON API (backend)

This is Step 1 of `CONVERSION_BRIEF.md`'s recommended priority order: the
Flask app re-platformed to return JSON instead of server-rendered HTML,
keeping the exact same business logic and database models as the original.

## What changed vs. the original Flask app

- `models.py`, `menu_config.py` — **unchanged**, copied verbatim.
- `app.py` — rewritten from scratch as a JSON API (`/api/...` routes)
  instead of Jinja2 templates. Every route from the original was ported;
  see the module-by-module list below.
- `auth.py` — **new**. Session-cookie login replaced with a signed,
  expiring bearer token (12h) via `itsdangerous`, since a separate
  frontend (and later, mobile) can't share a session cookie with this API
  by default. Swap this for real JWT (PyJWT) or an auth provider later if
  you need refresh tokens, multiple scopes, etc. — the shape (`Authorization:
  Bearer <token>`, `require_auth` / `require_super_user` decorators) is
  meant to make that swap easy.
- Excel export (`openpyxl`) replaced with CSV export (`?export=csv` on
  every report endpoint) to drop a dependency; swap back easily if you'd
  rather ship `.xlsx` files.
- Print documents (Delivery Challan, Tax Invoice, Affidavit, Undertaking,
  Form-22) are **not implemented in this API** — see "What's NOT done yet"
  below. The data these need is already exposed via the regular JSON
  endpoints (`GET /api/tax-invoices`, `GET /api/delivery-challans`).

## Business logic verified against the brief (Section 4)

All four rules from `CONVERSION_BRIEF.md` Section 4 are implemented and
have been smoke-tested end-to-end (create product → BOM → production
voucher → delivery challan → tax invoice → cancel):

1. **GST split** (`is_inter_state` / `cgst_amount` / `sgst_amount` /
   `igst_amount` properties on `TaxInvoice` and `PurchaseBillItem` in
   `models.py`, unchanged) — confirmed CGST+SGST for intra-state,
   would be IGST for inter-state.
2. **Chassis pipeline stage** — confirmed Manufacturing → Delivery
   Challan → Tax Invoice, and reversal on Delivery Challan cancel / Tax
   Invoice cancel / delete.
3. **BOM auto-consumption** — confirmed: a Production Voucher with no
   explicit item lines copies the matching Production Formula automatically.
4. **Stock computed live, never stored** — `/api/stock/*` endpoints
   compute from Production/Delivery/Purchase/Journal Stock records on
   every request, same as the original.

## Endpoint map (Flask route → JSON API route)

| Original page | New endpoint(s) |
|---|---|
| `/login` | `POST /api/auth/login`, `GET /api/auth/me` |
| `/` (dashboard) | `GET /api/dashboard` |
| Setup > Party/Battery Maker/RTO/Financer/Mechanic/Bank/Colour | `GET/POST /api/masters/<kind>`, `DELETE /api/masters/<kind>/<id>` |
| Setup > Dealer Master | `GET/POST /api/dealers`, `DELETE /api/dealers/<id>` |
| Setup > Product Master | `GET/POST /api/products`, `DELETE /api/products/<id>` |
| Setup > User Master | `GET/POST /api/users`, `DELETE /api/users/<id>` (super user only) |
| Setup > Option Setting | `GET/POST /api/users/<id>/option-setting` |
| Setup > Production Formula | `GET/POST /api/production-formulas`, `DELETE .../<id>`, `DELETE .../by-product` |
| Vouchers > Production Voucher | `GET/POST /api/production-vouchers`, `DELETE .../<id>`, `GET .../generate-code` |
| Vouchers > Delivery Challan | `GET/POST /api/delivery-challans`, `PUT/DELETE .../<id>`, `POST .../<id>/cancel` |
| Vouchers > Tax Invoice | `GET/POST /api/tax-invoices`, `PUT/DELETE .../<id>`, `POST .../<id>/cancel`, `POST .../<id>/payment` |
| Vouchers > Purchase Bills | `GET/POST /api/purchase-bills`, `PUT/DELETE .../<id>` |
| Vouchers > Old Rickshaw | `GET/POST /api/old-rickshaws`, `DELETE .../<id>` |
| Vouchers > Battery Delivery Challan | `GET/POST /api/battery-delivery-challans`, `DELETE .../<id>` |
| Vouchers > Journal Stock | `GET/POST /api/journal-stock`, `DELETE .../<id>` |
| Stock > Closing Stock (x3) | `GET /api/stock/closing-premises`, `closing-dealers`, `closing-raw` |
| Stock > Stock Ledger (x2) | `GET /api/stock/ledger-premises`, `ledger-dealers` |
| Reports > all 8 registers | `GET /api/reports/<name>` — every one supports `?export=csv`, `?from=&to=&search=` |
| Reports > Ledger (account statement) | `GET /api/reports/ledger?dealer_id=` |
| Reports > Day Book Entry | `GET/POST /api/day-book`, `DELETE .../<id>` |
| Reports > Password | `POST /api/users/<id>/password` (super user only) |
| Print > Delivery Challan | `GET /api/delivery-challans/<id>/print` |
| Print > Tax Invoice / Affidavit / Undertaking / Form-22 | `GET /api/tax-invoices/<id>/print?doc=invoice\|affidavit\|undertaking\|form22` |
| Print > UMRN upload code | `GET /api/tax-invoices/<id>/upload-code` (downloads a `.TXT`) |

## What's NOT done yet (still needed before this is a full replacement)

- **Print document layout fidelity** — the actual endpoints exist now
  (`GET /api/delivery-challans/<id>/print`, `GET /api/tax-invoices/<id>/print?doc=invoice|affidavit|undertaking|form22`,
  `GET /api/tax-invoices/<id>/upload-code`) and return every field the
  original routes gathered (RTO address substitution, bank
  fallback-to-default logic, UMRN upload code). **But** the original
  Jinja2 print templates (`templates/vouchers/*.html`) were not included
  in the files handed over for this conversion, so the frontend's actual
  visual layout (see `frontend/components/PrintDocs.jsx`) is a
  best-effort reconstruction, not a pixel-match to the original desktop
  software's printed forms. Compare a rendered copy against a real
  original printout before relying on it for RTO/GST submission.
- **Dealer self-billing portal**, **multi-outlet management**,
  **outlet-level cashbook** — flagged in the brief (Section 5) as new
  scope, not yet designed.
- **Mobile app** — brief recommends building this last, once the API is
  stable.
- **Import Old Data (Excel/MDB)** utility — lower priority per the brief.
- Real JWT / refresh tokens / rate limiting — the current bearer-token
  auth is functional but minimal (see `auth.py`).

## Running locally

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # edit as needed; DATABASE_URL is optional (falls back to SQLite)
python3 app.py         # http://localhost:5000, auto-creates ebill.db + admin/admin1 on first run
```

Then log in:
```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"userid":"admin","password":"admin1"}'
```

## Deploying to Vercel

Same pattern as the original `vercel.json` (`api/index.py` imports the
Flask `app` object from `app.py`). Set `DATABASE_URL` (Supabase Postgres),
`SECRET_KEY`, and `FRONTEND_ORIGIN` (your deployed Next.js URL) as
environment variables in the Vercel project settings.
