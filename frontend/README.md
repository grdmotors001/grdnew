# eBill Next.js Frontend

Built against `../backend` (the Flask JSON API — see its README for the
full endpoint map and what's verified working).

## What's here

Every module from `CONVERSION_BRIEF.md` Section 3 that's implemented in
the backend has a page here: Dashboard (chassis pipeline), all Setup
masters, all 7 Voucher screens, all 5 Stock screens, all Report screens
(with CSV export + date/search filters), and User/Option Setting/Password.

Auth is bearer-token (not cookie) — see `lib/api.js`. The token is kept in
`localStorage` and attached to every request; a 401 clears it and drops
back to the login screen.

## Run locally

Terminal 1 — backend:
```bash
cd ../backend
pip install -r requirements.txt
python3 app.py          # http://localhost:5000
```

Terminal 2 — frontend:
```bash
npm install
BACKEND_URL=http://localhost:5000 npm run dev
```

Open `http://localhost:3000`. Default login: `admin` / `admin1` (or
whatever `DEFAULT_ADMIN_PASSWORD` was set to on the backend).

`BACKEND_URL` controls where `next.config.mjs`'s `/api/backend/*` rewrite
points — set it to your deployed API URL in production (e.g. on Vercel,
set it as an Environment Variable for the frontend project).

## What's NOT done yet

Same list as the backend README: the dealer self-billing portal,
multi-outlet management, outlet-level cashbook, and the mobile app — all
flagged as new scope in `CONVERSION_BRIEF.md` Section 5, not started here.
Import Old Data (Excel/MDB) also isn't wired up on the frontend yet
(lower priority per the brief).

Print documents (`components/PrintDocs.jsx`) ARE implemented — Delivery
Challan, Tax Invoice, Affidavit, Undertaking, and Form-22 all render as
print-ready overlays with a working "Print" button (browser print dialog)
and the UMRN upload-code download. **The visual layout is a best-effort
reconstruction**, not a pixel-match to the original desktop software's
forms — the original's actual print templates weren't in the files
handed over for this conversion. Compare against a real original
printout before relying on these for RTO/GST submission, and adjust the
layout in `PrintDocs.jsx` as needed (it's plain CSS, easy to restyle).

## Architecture

- Plain fetch-based API client (`lib/api.js`) — no data-fetching library,
  since the app is small enough that `useEffect` + `useState` per page is
  clear and easy to extend. Swap in SWR/React Query later if pages start
  needing shared caching.
- One component file per module group under `components/` (masters,
  each major voucher, stock, reports) rather than one per screen — keeps
  related CRUD logic together without a huge number of tiny files.
- Styling is plain CSS (`app/globals.css`) matching the original scaffold's
  look — no component library, so it's easy to reskin later.
