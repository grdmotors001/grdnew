import os
import sys

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

# Vercel requires the WSGI handler to be a top-level module variable.
# Keep this import direct so Vercel can detect the Flask app during build.
from app import app
