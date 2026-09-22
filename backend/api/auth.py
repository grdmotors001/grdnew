import os
from flask import Flask, request, jsonify
from flask_cors import CORS
from sqlalchemy import inspect, text

BASE_DIR=os.path.abspath(os.path.join(os.path.dirname(__file__),".."))
import sys
if BASE_DIR not in sys.path:
    sys.path.insert(0,BASE_DIR)

from models import db, User, Dealer
from auth import issue_token, issue_pending_token, issue_dealer_token, _serializer

app=Flask(__name__)
app.config["SECRET_KEY"]=os.environ.get("SECRET_KEY","dev-secret-change-me")
db_url=os.environ.get("DATABASE_URL",f"sqlite:///{os.path.join(BASE_DIR,'ebill.db')}")
if db_url.startswith("postgres://"):
    db_url=db_url.replace("postgres://","postgresql+psycopg2://",1)
if db_url.startswith("postgresql") and "supabase" in db_url and "sslmode=" not in db_url:
    db_url += ("&" if "?" in db_url else "?")+"sslmode=require"
app.config["SQLALCHEMY_DATABASE_URI"]=db_url
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"]=False
app.config["SQLALCHEMY_ENGINE_OPTIONS"]={"pool_pre_ping":True,"pool_recycle":300}
db.init_app(app)
CORS(app,resources={r"/api/auth/*":{"origins":os.environ.get("FRONTEND_ORIGIN","*")}})

def ensure_columns(table, additions):
    try:
        with db.engine.begin() as conn:
            inspector=inspect(conn)
            if not inspector.has_table(table):
                return None
            columns={c["name"] for c in inspector.get_columns(table)}
            for name,(sql_type,default_sql) in additions.items():
                if name in columns: continue
                if db.engine.dialect.name=="postgresql":
                    ddl=f'ALTER TABLE "{table}" ADD COLUMN IF NOT EXISTS {name} {sql_type}'
                else:
                    ddl=f'ALTER TABLE "{table}" ADD COLUMN {name} {sql_type}'
                if default_sql!="NULL": ddl += f" DEFAULT {default_sql}"
                conn.execute(text(ddl))
    except Exception as exc:
        db.session.rollback()
        return str(exc)
    return None

def ensure_user_columns():
    return ensure_columns("user",{
        "password_hash":("VARCHAR(255)","NULL"),
        "is_super_user":("BOOLEAN","FALSE"),
        "permissions":("VARCHAR(50)","NULL"),
        "allowed_modules":("TEXT","NULL"),
        "department":("VARCHAR(30)","'Admin'"),
        "assigned_dealer_ids":("TEXT","NULL"),
        "mobile":("VARCHAR(30)","NULL"),
    })

def ensure_dealer_columns():
    return ensure_columns("dealer",{
        "address1":("VARCHAR(200)","NULL"),"address2":("VARCHAR(200)","NULL"),
        "mobile":("VARCHAR(30)","NULL"),"gst_no":("VARCHAR(30)","NULL"),
        "registration_type":("VARCHAR(20)","'registered'"),"dealer_category":("VARCHAR(20)","'dealer'"),
        "portal_modules":("TEXT","''"),"state":("VARCHAR(100)","NULL"),
        "state_code":("VARCHAR(10)","NULL"),"pan":("VARCHAR(20)","NULL"),
        "bank_name":("VARCHAR(120)","NULL"),"bank_account_no":("VARCHAR(50)","NULL"),
        "bank_ifsc":("VARCHAR(50)","NULL"),"salesman":("VARCHAR(100)","NULL"),
        "blocked":("BOOLEAN","FALSE"),"purchase_access":("BOOLEAN","FALSE"),
        "login_id":("VARCHAR(50)","NULL"),"password_hash":("VARCHAR(255)","NULL"),
        "created_at":("TIMESTAMP","NULL"),
    })

def user_json(u):
    return {
        "id":u.id,"username":u.username,"mobile":u.mobile,
        "is_super_user":bool(u.is_super_user),"department":u.department or "Admin",
        "allowed_modules":(u.allowed_modules or "").split(",") if u.allowed_modules else [],
        "dealer_ids":u.get_assigned_dealer_ids(),
    }

def dealer_json(d):
    return {
        "id":d.id,"code":d.code,"name":d.name,"login_id":d.login_id,
        "dealer_category":getattr(d,"dealer_category","dealer") or "dealer",
        "purchase_access":bool(d.purchase_access),
        "portal_modules":[x for x in (d.portal_modules or "").split(",") if x],
    }

@app.post("/api/auth/login")
def login():
    try:
        err=ensure_user_columns()
        if err: return jsonify({"error":f"Staff login database setup failed: {err}"}),500
        data=request.get_json(silent=True) or {}
        userid=(data.get("userid") or "").strip()
        password=data.get("password") or ""
        user=User.query.filter_by(username=userid).first()
        if not user: user=User.query.filter_by(mobile=userid).first()
        if not user or not user.check_password(password):
            return jsonify({"error":"Invalid Username/Mobile or Password."}),401
        return jsonify({"otp_required":True,"otp_token":issue_pending_token(user),"user":user_json(user)})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"error":f"Staff login failed: {type(exc).__name__}: {exc}"}),500

@app.post("/api/auth/verify-otp")
def verify_otp():
    data=request.get_json(silent=True) or {}
    try: payload=_serializer.loads(data.get("otp_token") or "",max_age=600)
    except Exception: return jsonify({"error":"OTP session expired. Please login again."}),401
    if payload.get("scope")!="otp_pending" or str(data.get("otp") or "").strip()!="1234":
        return jsonify({"error":"Invalid OTP."}),401
    user=User.query.get(payload.get("uid"))
    if not user: return jsonify({"error":"User not found."}),404
    return jsonify({"token":issue_token(user),"user":user_json(user)})

@app.post("/api/auth/dealer-login")
def dealer_login():
    try:
        err=ensure_dealer_columns()
        if err: return jsonify({"error":f"Dealer login database setup failed: {err}"}),500
        data=request.get_json(silent=True) or {}
        login_id=(data.get("userid") or "").strip()
        password=data.get("password") or ""
        dealer=Dealer.query.filter_by(login_id=login_id).first()
        if not dealer or dealer.blocked: return jsonify({"error":"Dealer login is blocked or not found."}),401
        if not dealer.check_password(password): return jsonify({"error":"Invalid Dealer ID or Password."}),401
        return jsonify({"token":issue_dealer_token(dealer),"dealer":dealer_json(dealer)})
    except Exception as exc:
        db.session.rollback()
        return jsonify({"error":f"Dealer login failed: {type(exc).__name__}: {exc}"}),500

@app.get("/api/auth/health")
def health():
    return jsonify({"status":"ok","service":"auth"})

if __name__=="__main__":
    app.run(host="0.0.0.0",port=5000)
