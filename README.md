# G.R.D. Motors eBill

Current production application: **Next.js + Node.js API routes + PostgreSQL/Supabase**.

The old Flask/Python backend is no longer part of the runtime architecture. The browser
uses the internal API under `frontend/app/api/`; the legacy `/api/backend/*` prefix
is only a compatibility bridge that forwards requests to the local Node.js API.

## Project structure

- `frontend/` — Next.js application and internal Node.js API.
- `frontend/app/api/` — authenticated API routes and PostgreSQL queries.
- `frontend/lib/api.js` — browser API client.
- `frontend/components/` — application screens and UI.
- `frontend/lib/menu.js` — navigation and module registry.

## Local development

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`.

## Required environment variables

Copy `frontend/.env.example` to `frontend/.env.local` and fill in the real values.
Never commit production secrets.

- `DATABASE_URL` — PostgreSQL/Supabase connection string.
- `JWT_SECRET` — secret used to sign/verify application JWTs.
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase anonymous/public key.
- `NEXT_PUBLIC_LIVEKIT_URL` — LiveKit server URL used by calling/chat features.
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` — public VAPID key used by web push.

## Deployment

Deploy the `frontend/` directory as the Next.js application on Vercel.
Configure the environment variables above in the Vercel project settings.

## Notes

The application contains the implemented Dashboard, Masters, Factory, Battery,
Sales & Billing, Expenses, Accounts, Inventory, HR, Reports, System, and dealer
portal areas. Any module explicitly marked as a placeholder in the UI should be
treated as pending feature work rather than as a working production feature.
