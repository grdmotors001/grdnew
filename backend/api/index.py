# Vercel Python entrypoint. Vercel's @vercel/python builder looks for a
# WSGI `app` object here; the real Flask app lives in backend/app.py.
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from app import app  # noqa: F401
