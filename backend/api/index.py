import os
import sys
import importlib.util

# Vercel executes this file as the Python function entrypoint. Make the
# backend directory importable before loading app.py and its local modules.
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

APP_PATH = os.path.join(BASE_DIR, "app.py")
spec = importlib.util.spec_from_file_location("grd_backend_app", APP_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError(f"Could not load backend app from {APP_PATH}")

module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
app = module.app
