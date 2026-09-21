import os
import sys
import traceback

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

try:
    from app import app
except Exception as exc:
    # Keep this handler importable on every Vercel cold start.
    # The JSON fallback exposes the real startup/import error.
    # Keep the Vercel function importable so the real startup/import error
    # is returned as JSON instead of Vercel's generic "could not import api/index.py".
    from flask import Flask, jsonify
    app = Flask(__name__)
    _IMPORT_ERROR = traceback.format_exc()

    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def _startup_error(path):
        return jsonify({
            "success": False,
            "error": "GRD backend startup/import failed",
            "exception": str(exc),
            "traceback": _IMPORT_ERROR,
            "path": path,
        }), 500
