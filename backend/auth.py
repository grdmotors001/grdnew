"""
Token-based auth for the JSON API — replaces Flask's session-cookie login
so a separate frontend (Next.js) and, later, mobile apps can authenticate
with a bearer token instead of a shared-domain cookie.

Uses itsdangerous (already a Flask dependency) as a lightweight JWT
stand-in: a signed, expiring token carrying the user id and a scope
("staff" for internal User-table logins; "dealer" is reserved for the
future dealer-portal work called out in the conversion brief, Section 5).
"""
import os
from functools import wraps
from flask import request, jsonify, g
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired

SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret-change-me")
TOKEN_MAX_AGE = 60 * 60 * 12  # 12 hours

_serializer = URLSafeTimedSerializer(SECRET_KEY, salt="ebill-api-token")


def issue_pending_token(user):
    return _serializer.dumps({"uid": user.id, "scope": "otp_pending", "otp_verified": False})


def issue_token(user):
    return _serializer.dumps({
        "uid": user.id,
        "username": user.username,
        "is_super_user": bool(user.is_super_user),
        "scope": "staff",
        "department": user.department or "Admin",
        "dealer_ids": user.get_assigned_dealer_ids(),
    })


def _decode(token):
    try:
        return _serializer.loads(token, max_age=TOKEN_MAX_AGE)
    except (BadSignature, SignatureExpired):
        return None


def issue_dealer_token(dealer):
    return _serializer.dumps({
        "uid": dealer.id,
        "username": dealer.login_id,
        "dealer_id": dealer.id,
        "is_super_user": False,
        "scope": "dealer",
    })


def require_dealer_auth(fn):
    """Decorator for dealer-portal API routes. Accepts only dealer-scoped tokens."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        token = auth_header[7:] if auth_header.startswith("Bearer ") else None
        payload = _decode(token) if token else None
        if not payload or payload.get("scope") != "dealer" or not payload.get("dealer_id"):
            return jsonify({"error": "Dealer authentication required"}), 401
        g.current_dealer_id = payload["dealer_id"]
        g.current_user_payload = payload
        return fn(*args, **kwargs)
    return wrapper


def require_auth(fn):
    """Decorator for API routes that need a logged-in user. Populates
    g.current_user_payload (dict from the token) on success."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        token = auth_header[7:] if auth_header.startswith("Bearer ") else None
        payload = _decode(token) if token else None
        if not payload or payload.get("scope") != "staff":
            return jsonify({"error": "Staff authentication required"}), 401
        g.current_user_payload = payload
        return fn(*args, **kwargs)
    return wrapper


def require_super_user(fn):
    """Decorator for routes restricted to super users (e.g. User Master,
    Option Setting) — mirrors is_super_user unrestricted access in the
    original app. Must be stacked under @require_auth."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        payload = getattr(g, "current_user_payload", None)
        if not payload or not payload.get("is_super_user"):
            return jsonify({"error": "Super user access required"}), 403
        return fn(*args, **kwargs)
    return wrapper
