# eBill Next.js / Node.js Frontend

This is the current production frontend for the GRD eBill conversion. It runs on
Next.js/Node.js and uses the existing PostgreSQL/Supabase database. The old
Python/Flask backend has been removed from the current repository.

## What's here

The app contains the implemented GRD modules: Dashboard, Setup/Master screens,
Voucher screens, Stock screens, Reports, User/Option Setting/Password, the
dealer portal, and the Node.js API routes under `app/api/`.

Auth uses bearer tokens. The token is kept in `localStorage` and attached to
API requests; an invalid session is cleared and the app returns to login.

## Run locally

From this directory:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

For production, Vercel builds this directory as a Next.js application. The
database connection is provided through the `DATABASE_URL` environment
variable. No Python runtime or Flask backend is required.

## Architecture

- Next.js App Router with Node.js API routes under `app/api/`.
- PostgreSQL access through the Node.js database layer.
- `lib/api.js` is the browser API client.
- UI components are under `components/`.
- Styling is in `app/globals.css`.
- Existing database/data is retained; the application code was migrated to
  Node.js/Next.js without requiring the old Python backend at runtime.

## Current status

The repository is Node.js/Next.js based. The legacy Python `backend/`
directory and Python files are no longer part of the current `main` tree.
