# Vercel Python entrypoint. Keep import failures visible instead of returning
# an opaque FUNCTION_INVOCATION_FAILED while the backend is being deployed.
import os, sys, traceback
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

try:
    from app import app  # noqa: F401
except Exception as exc:
    # Temporary diagnostic app: this lets the frontend receive the real
    # import exception so a broken serverless deployment can be fixed quickly.
    from flask import Flask, jsonify
    app = Flask(__name__)
    _error = str(exc)
    _trace = traceback.format_exc()
    print(_trace)

    @app.route("/api/<path:_path>", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
    def import_failure(_path):
        return jsonify({
            "error": "Backend import failed",
            "detail": _error,
            "traceback": _trace,
        }), 500
