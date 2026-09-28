# CHFPL → GRD bridge

GRD reads CHFPL/CAPITALHIND as the source of truth for current loan status and repo vehicles.

Set these server-side environment variables in the GRD Vercel project:

- `CHFPL_API_URL`: the deployed CAPITALHIND base URL, without a trailing slash.
- `CHFPL_GRD_BRIDGE_SECRET`: the same secret configured in CAPITALHIND as `CHFPL_GRD_BRIDGE_SECRET` (or `GRD_BRIDGE_SECRET` for the repo bridge).

Endpoints used by GRD:
- `/api/grd-dealer-loans` — current loan application status.
- `/api/grd/repossessed?status=ALL` — repo/seized vehicle register.

The GRD UI does not import CHFPL status history. It displays only the current status returned by CHFPL. Repo vehicles keep the CHFPL resale lifecycle:
`SEIZED` → displayed as **HOLD**,
`AVAILABLE_FOR_SALE`,
`ALLOCATED_TO_GRD`,
`SOLD`.

No GRD-side copy of CHFPL loan/repo history is created by this bridge.
