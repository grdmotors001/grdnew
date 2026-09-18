"""
postgres_auto_migrate.py
---------------------------
app.py's built-in _auto_migrate() only works for SQLite -- for Postgres it
just prints a warning and does nothing:

    [auto-migrate] Skipped -- using postgresql, not SQLite.

This means whenever a field gets added to models.py after the Supabase
tables were first created (db.create_all() only creates NEW tables, it
never ALTERs existing ones), the live table silently falls behind the
model. Querying that model (which does a SELECT of every mapped column)
then fails in Postgres with "column ... does not exist" -- which is what
was causing the 500 errors on /api/tax-invoices (and will eventually hit
any other table with the same drift).

This script is the Postgres equivalent: for every table in models.py, it
compares the live Supabase columns against the model's declared columns
and adds whatever is missing, using SQLAlchemy's own type compiler so the
generated SQL type always matches what the model expects.

Usage (run from the backend folder, where .env has DATABASE_URL pointing
at Supabase):

    python postgres_auto_migrate.py
"""
import os
from dotenv import load_dotenv
load_dotenv()

if not os.environ.get("DATABASE_URL"):
    print("ERROR: DATABASE_URL not set in .env -- this must point at Supabase.")
    raise SystemExit(1)

from sqlalchemy import inspect

from app import app
from models import db

with app.app_context():
    if db.engine.dialect.name != "postgresql":
        print(f"This database is '{db.engine.dialect.name}', not postgresql -- "
              f"nothing to do (app.py's own auto-migrate already handles SQLite).")
        raise SystemExit(0)

    print(f"Connected to: {db.engine.url.render_as_string(hide_password=True)}\n")

    # Make sure any brand-new tables exist first (safe/no-op for existing ones).
    db.create_all()

    inspector = inspect(db.engine)
    existing_tables = set(inspector.get_table_names())

    added_any = False
    for table in db.metadata.sorted_tables:
        if table.name not in existing_tables:
            print(f"  {table.name}: table doesn't exist yet (should have just been "
                  f"created by create_all() above) -- skipping column check.")
            continue

        existing_cols = {c["name"] for c in inspector.get_columns(table.name)}
        missing = [col for col in table.columns if col.name not in existing_cols]

        if not missing:
            continue

        with db.engine.begin() as conn:
            for col in missing:
                col_type_sql = col.type.compile(dialect=db.engine.dialect)
                # Always added as nullable, even if the model marks it
                # NOT NULL -- existing rows have no value for a brand-new
                # column, so a NOT NULL constraint would fail immediately.
                ddl = f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" {col_type_sql}'
                print(f"  [{table.name}] {ddl}")
                conn.exec_driver_sql(ddl)
                added_any = True

    if added_any:
        print("\nDone -- missing columns added. Restart the backend and retest.")
    else:
        print("No missing columns found -- schema already matches models.py.")
