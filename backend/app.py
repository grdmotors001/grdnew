"""
eBill JSON API — Step 1 of the conversion brief's recommended priority
order: "get the JSON API layer working against the *existing* modules
first, since that logic is already proven."

This replaces app.py's Jinja2/HTML routes with a REST/JSON API, reusing
models.py and menu_config.py UNCHANGED, and replicating every piece of
business logic called out in CONVERSION_BRIEF.md Section 4 exactly:
  1. GST split (CGST+SGST vs IGST)
  2. Chassis pipeline stage transitions
  3. BOM auto-consumption on Production Voucher
  4. Stock computed live, never stored
  5. (Print-document generation is left to the frontend/PDF layer — see
     README "What's NOT done yet")

Auth: token-based (see auth.py) instead of session cookies, since a
separate Next.js frontend (and, later, mobile) can't share a session
cookie with this API by default.
"""
import os
import re
import difflib
import uuid
import urllib.request
import urllib.error
import json as _json
import hmac
from datetime import date, datetime as dt, timedelta
from flask import Flask, request, jsonify, g
from flask_cors import CORS
from sqlalchemy.orm import joinedload
from sqlalchemy import or_

# Load backend/.env if present (local dev convenience — e.g. DATABASE_URL,
# SECRET_KEY). No-op in production/Vercel, where real env vars are set
# directly and this file won't exist.
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
except ImportError:
    pass

from models import (db, Company, SimpleMaster, Dealer, Customer, Product, Vehicle, User,
                     ChassisMonthCode, ChassisYearCode, ChassisRule,
                     ProductionFormula, ProductionVoucher, ProductionVoucherItem, LoanWorkflow, LoanWorkflowLog,
                     DeliveryChallan, TaxInvoice, PurchaseBill, PurchaseBillItem,
                     OldRickshaw, BatteryDeliveryChallan, JournalStock, DayBook, ExpensePaymentVoucher)
from menu_config import MENU, find_item, all_items
from auth import issue_token, issue_dealer_token, require_auth, require_dealer_auth, require_super_user
from hr_attendance import hr_bp

BASE_DIR = os.path.abspath(os.path.dirname(__file__))

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret-change-me")

db_url = os.environ.get("DATABASE_URL", f"sqlite:///{os.path.join(BASE_DIR, 'ebill.db')}")
if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql+psycopg2://", 1)
if db_url.startswith("postgresql") and "supabase" in db_url and "sslmode=" not in db_url:
    db_url += ("&" if "?" in db_url else "?") + "sslmode=require"

app.config["SQLALCHEMY_DATABASE_URI"] = db_url
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {"pool_pre_ping": True, "pool_recycle": 300}

db.init_app(app)
from dealer_cashbook import dealer_cashbook_bp
app.register_blueprint(dealer_cashbook_bp, url_prefix="/api/dealer")
app.register_blueprint(hr_bp, url_prefix="/api/hr")
CORS(app, resources={r"/api/*": {"origins": os.environ.get("FRONTEND_ORIGIN", "*")}})


# ---------------------------------------------------------------------------
# CHFPL master-data bridge
# ---------------------------------------------------------------------------
@app.get("/api/integration/masters")
def integration_masters():
    """Return GRD dealer/product masters to the trusted CHFPL integration."""
    supplied = request.headers.get("X-GRD-BRIDGE-SECRET") or ""
    expected = os.environ.get("CHFPL_GRD_BRIDGE_SECRET") or ""
    if not expected or not supplied or not hmac.compare_digest(supplied, expected):
        return _err("Invalid integration secret", 401)

    dealers = (Dealer.query
               .filter(Dealer.blocked.is_(False))
               .order_by(Dealer.name.asc())
               .all())
    products = (Product.query
                .filter(Product.fro == "F")
                .order_by(Product.name.asc())
                .all())
    return jsonify({
        "success": True,
        "dealers": [
            {"id": d.id, "code": d.code, "name": d.name, "mobile": d.mobile,
             "state": d.state, "state_code": d.state_code}
            for d in dealers
        ],
        "models": [
            {"id": p.id, "code": p.code, "name": p.name,
             "fuel_type": p.fuel_type, "gst_rate": p.gst_rate}
            for p in products
        ],
        "financers": [
            {"id": f.id, "code": f.code, "name": f.name, "mobile": f.mobile,
             "account_no": f.account_no, "ifsc": f.ifsc}
            for f in SimpleMaster.query.filter_by(kind="financer").order_by(SimpleMaster.name.asc()).all()
        ],
    })


# ---------------------------------------------------------------------------
# Dealer-facing GRD masters for the dealer loan form
# ---------------------------------------------------------------------------
@app.get("/api/dealer/loan-masters")
@require_dealer_auth
def dealer_loan_masters():
    products = (Product.query
                .filter(Product.fro == "F")
                .order_by(Product.name.asc())
                .all())
    financers = (SimpleMaster.query
                 .filter_by(kind="financer")
                 .order_by(SimpleMaster.name.asc())
                 .all())
    return jsonify({
        "success": True,
        "models": [
            {"id": p.id, "code": p.code, "name": p.name,
             "fuel_type": p.fuel_type, "gst_rate": p.gst_rate}
            for p in products
        ],
        "financers": [
            {"id": f.id, "code": f.code, "name": f.name,
             "mobile": f.mobile, "account_no": f.account_no, "ifsc": f.ifsc}
            for f in financers
        ],
        "loan_types": [
            {"id": "NEW", "name": "NEW MODEL"},
            {"id": "OLD", "name": "OLD MODEL"},
        ],
    })


# ---------------------------------------------------------------------------
# Dealer customer + CHFPL loan bridge
# ---------------------------------------------------------------------------
def _ensure_customer_table():
    """Create the new customer table on first use without requiring a manual migration."""
    from sqlalchemy import inspect
    if not inspect(db.engine).has_table("customer"):
        Customer.__table__.create(db.engine, checkfirst=True)


def ser_customer(c):
    return {
        "id": c.id, "full_name": c.full_name, "phone": c.phone, "email": c.email,
        "dob": _iso(c.dob), "gender": c.gender, "pan": c.pan,
        "aadhaar_masked": c.aadhaar_masked, "occupation": c.occupation,
        "monthly_income": c.monthly_income, "pincode": c.pincode,
        "city": c.city, "state": c.state, "address": c.address,
    }


@app.get("/api/dealer/customers")
@require_dealer_auth
def dealer_customers():
    _ensure_customer_table()
    q = (request.args.get("search") or "").strip()
    query = Customer.query.filter_by(dealer_id=g.current_dealer_id)
    if q:
        like = f"%{q}%"
        query = query.filter(or_(Customer.full_name.ilike(like), Customer.phone.ilike(like), Customer.pan.ilike(like)))
    rows = query.order_by(Customer.full_name.asc()).limit(30).all()
    return jsonify({"customers": [ser_customer(c) for c in rows]})


@app.post("/api/dealer/submit-loan")
@require_dealer_auth
def dealer_submit_loan():
    """Create/update the GRD customer and forward the complete loan package to CHFPL."""
    _ensure_customer_table()
    data = request.get_json(silent=True) or {}
    borrower = data.get("borrower") or {}
    guarantor = data.get("guarantor") or {}
    co_borrower = data.get("co_borrower") or {}
    vehicle_loan = data.get("vehicle_loan") or {}
    customer_id = data.get("customer_id")
    dealer = Dealer.query.get(g.current_dealer_id)
    if not dealer:
        return _err("Dealer not found", 404)
    if not borrower.get("full_name") or not borrower.get("phone"):
        return _err("Borrower name and phone are required")
    if not re.fullmatch(r"\d{12}", str(borrower.get("aadhaar") or "")):
        return _err("12-digit Aadhaar is required")
    photo = data.get("customer_photo") or {}
    documents = data.get("documents") or []
    if not photo.get("data_url"):
        return _err("Customer photo is mandatory")
    if not isinstance(documents, list) or not documents:
        return _err("At least one customer document is mandatory")

    created_customer = False
    try:
        customer = Customer.query.filter_by(id=customer_id, dealer_id=dealer.id).first() if customer_id else None
        if not customer:
            customer = Customer(dealer_id=dealer.id)
            created_customer = True
        for field in ("full_name","phone","email","gender","pan","occupation","pincode","city","state","address"):
            if field in borrower: setattr(customer, field, borrower.get(field) or None)
        customer.dob = _parse_date(borrower.get("dob"))
        customer.monthly_income = _f(borrower.get("monthly_income"), 0) or None
        aadhaar = str(borrower.get("aadhaar") or "")
        customer.aadhaar_masked = f"XXXX-XXXX-{aadhaar[-4:]}" if len(aadhaar) >= 4 else None
        db.session.add(customer)
        db.session.flush()

        chfpl_url = (os.environ.get("CHFPL_API_URL") or "").rstrip("/")
        secret = os.environ.get("CHFPL_GRD_BRIDGE_SECRET") or ""
        if not chfpl_url or not secret:
            raise RuntimeError("CHFPL_API_URL / CHFPL_GRD_BRIDGE_SECRET is not configured")
        payload = {
            "grd_customer_id": customer.id,
            "grd_submission_ref": f"GRD-{dealer.id}-{uuid.uuid4().hex}",
            "dealer": {"code": dealer.code, "name": dealer.name, "mobile": dealer.mobile, "login_id": dealer.login_id},
            "borrower": borrower,
            "guarantor": guarantor,
            "co_borrower": co_borrower,
            "vehicle_loan": vehicle_loan,
            "loan_type": str(data.get("loan_type") or "").strip().upper() or None,
            "dealer_register_page_no": str(data.get("dealer_register_page_no") or "").strip() or None,
        }
        body = _json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            f"{chfpl_url}/api/dealer/grd-submit-loan", data=body,
            headers={"Content-Type":"application/json", "X-GRD-BRIDGE-SECRET":secret}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                result = _json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"CHFPL rejected the loan: {detail[:500]}")

        db.session.commit()
        return jsonify({"success": True, "customer": ser_customer(customer), **result})
    except Exception as exc:
        db.session.rollback()
        return _err(str(exc), 502)




# ---------------------------------------------------------------------------
# Head Office Expense Payment Voucher
# ---------------------------------------------------------------------------
EXPENSE_TYPES = [
    {"id":"office_exp","name":"Office Expense"},{"id":"misc_exp","name":"Misc Expense"},
    {"id":"stationery","name":"Stationery"},{"id":"printer","name":"Printer"},
    {"id":"computer_repair","name":"Computer Repair"},{"id":"cleaning","name":"Cleaning"},
    {"id":"passing_exp","name":"Passing Expense"},{"id":"incentive","name":"Incentive"},
    {"id":"other","name":"Other"},
]

def _expense_voucher_dict(v):
    return {"id":v.id,"voucher_no":v.voucher_no,"date":_iso(v.date),
            "pay_to_type":v.pay_to_type,"pay_to_name":v.pay_to_name,"dealer_id":v.dealer_id,
            "staff_name":v.staff_name,"expense_type":v.expense_type,
            "expense_type_name":next((x["name"] for x in EXPENSE_TYPES if x["id"]==v.expense_type),v.expense_type),
            "vehicle_id":v.vehicle_id,"chassis_no":v.chassis_no,"payment_mode":v.payment_mode,
            "amount":v.amount,"bill_no":v.bill_no,"attachment_url":v.attachment_url,
            "remarks":v.remarks,"status":v.status,"created_by":v.created_by,
            "approved_by":v.approved_by,"approved_at":_iso(v.approved_at.date()) if v.approved_at else None,
            "rejection_reason":v.rejection_reason,"paid_at":_iso(v.paid_at.date()) if v.paid_at else None}

@app.get("/api/expense-payment-voucher/masters")
@require_auth
def expense_payment_voucher_masters():
    dealers=Dealer.query.filter(Dealer.blocked.is_(False)).order_by(Dealer.name.asc()).all()
    staff=sorted({(d.salesman or "").strip() for d in dealers if (d.salesman or "").strip()},key=str.lower)
    return jsonify({"expense_types":EXPENSE_TYPES,
        "pay_to_types":[{"id":"dealer","name":"Dealer"},{"id":"staff","name":"Staff / Salesman"},{"id":"other","name":"Other"}],
        "dealers":[{"id":d.id,"code":d.code,"name":d.name,"salesman":d.salesman} for d in dealers],
        "staff":[{"name":n} for n in staff]})

@app.get("/api/expense-payment-voucher/rickshaws")
@require_auth
def expense_payment_voucher_rickshaws():
    dealer_id=request.args.get("dealer_id",type=int)
    staff_name=(request.args.get("staff_name") or "").strip()
    q=DeliveryChallan.query.options(joinedload(DeliveryChallan.dealer)).filter(DeliveryChallan.cancelled.is_(False)).order_by(
        DeliveryChallan.date.desc(),DeliveryChallan.id.desc())
    if dealer_id: q=q.filter(DeliveryChallan.dealer_id==dealer_id)
    elif staff_name:
        ids=[d.id for d in Dealer.query.filter(Dealer.salesman.ilike(staff_name),Dealer.blocked.is_(False)).all()]
        if not ids: return jsonify({"rickshaws":[]})
        q=q.filter(DeliveryChallan.dealer_id.in_(ids))
    else: return jsonify({"rickshaws":[]})
    rows=q.limit(500).all()
    return jsonify({"rickshaws":[{"vehicle_id":r.vehicle_id,"chassis_no":r.chassis_no,
        "model_name":r.product_name,"dealer_id":r.dealer_id,
        "dealer_name":r.dealer.name if r.dealer else None,"date":_iso(r.date)}
        for r in rows if r.vehicle_id]})

@app.route("/api/expense-payment-voucher",methods=["GET","POST"])
@require_auth
def expense_payment_voucher():
    if request.method=="GET":
        fd,td=_date_bounds()
        q=ExpensePaymentVoucher.query.order_by(ExpensePaymentVoucher.date.desc(),ExpensePaymentVoucher.id.desc())
        if fd:q=q.filter(ExpensePaymentVoucher.date>=fd)
        if td:q=q.filter(ExpensePaymentVoucher.date<=td)
        rows=q.limit(500).all()
        return jsonify({"vouchers":[_expense_voucher_dict(x) for x in rows],"total":sum(float(x.amount or 0) for x in rows)})
    d=request.get_json(silent=True) or {}
    pt=(d.get("pay_to_type") or "").strip().lower(); pn=(d.get("pay_to_name") or "").strip()
    et=(d.get("expense_type") or "").strip().lower(); amount=_f(d.get("amount"),0)
    pm=(d.get("payment_mode") or "cash").strip().lower()
    if pt not in {"dealer","staff","other"}: return _err("Valid Pay To is required")
    if not pn:return _err("Pay To Name is required")
    if et not in {x["id"] for x in EXPENSE_TYPES}:return _err("Valid Expense Type is required")
    if pm not in {"cash","bank","upi","cheque"}:return _err("Valid Payment Mode is required")
    if amount<=0:return _err("Amount must be greater than zero")
    vid=d.get("vehicle_id"); did=d.get("dealer_id"); staff=(d.get("staff_name") or "").strip() or None; chassis=None
    if vid:
        try:vid=int(vid)
        except (TypeError,ValueError):return _err("Invalid rickshaw")
        dc=DeliveryChallan.query.filter_by(vehicle_id=vid,cancelled=False).order_by(DeliveryChallan.id.desc()).first()
        if not dc:return _err("Selected rickshaw was not found")
        if did and int(did)!=int(dc.dealer_id or 0):return _err("Rickshaw does not belong to selected dealer")
        did=dc.dealer_id; chassis=dc.chassis_no
    if et in {"passing_exp","incentive"} and not vid:return _err("Select a rickshaw for Passing Expense / Incentive")
    voucher=ExpensePaymentVoucher(date=_parse_date(d.get("date")) or dt.utcnow().date(),
        pay_to_type=pt,pay_to_name=pn,dealer_id=int(did) if did else None,staff_name=staff,
        expense_type=et,vehicle_id=vid,chassis_no=chassis,payment_mode=pm,amount=round(amount,2),
        bill_no=(d.get("bill_no") or "").strip() or None,
        attachment_url=(d.get("attachment_url") or "").strip() or None,
        remarks=(d.get("remarks") or "").strip() or None,
        status="pending",created_by=(getattr(g,"current_user_payload",{}) or {}).get("username"))
    db.session.add(voucher); db.session.flush(); voucher.voucher_no=f"EXP-{voucher.id:06d}"
    db.session.commit()
    return jsonify({"success":True,"voucher":_expense_voucher_dict(voucher)}),201

@app.route("/api/expense-payment-voucher/<int:voucher_id>/approval",methods=["POST"])
@require_auth
@require_super_user
def expense_payment_voucher_approval(voucher_id):
    voucher=ExpensePaymentVoucher.query.get(voucher_id)
    if not voucher:return _err("Voucher not found",404)
    d=request.get_json(silent=True) or {}
    action=(d.get("action") or "").strip().lower()
    if action not in {"approve","reject"}:return _err("Action must be approve or reject")
    if voucher.status!="pending":return _err("Only pending vouchers can be approved or rejected")
    if action=="reject" and not (d.get("reason") or "").strip():return _err("Rejection reason is required")
    voucher.status="approved" if action=="approve" else "rejected"
    voucher.approved_by=(getattr(g,"current_user_payload",{}) or {}).get("username")
    voucher.approved_at=dt.utcnow()
    voucher.rejection_reason=(d.get("reason") or "").strip() or None
    db.session.commit()
    return jsonify({"success":True,"voucher":_expense_voucher_dict(voucher)})
# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _parse_date(value):
    if not value:
        return None
    try:
        return dt.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return None


def _iso(d):
    return d.isoformat() if d else None


def _f(value, default=0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _i(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _date_bounds():
    return _parse_date(request.args.get("from")), _parse_date(request.args.get("to"))


def _date_filter(col, from_date, to_date):
    """SQL-level date-range WHERE conditions for a date column -- use this
    (spread with *) instead of fetching everything and filtering in Python
    with _in_range(), which is what was causing 502s/timeouts on tables
    with tens of thousands of rows."""
    conds = []
    if from_date:
        conds.append(col >= from_date)
    if to_date:
        conds.append(col <= to_date)
    return conds


def _in_range(d, from_date, to_date):
    if from_date and d and d < from_date:
        return False
    if to_date and d and d > to_date:
        return False
    return True


def _norm_name(n):
    """Collapse whitespace and lowercase, so free-text dealer names compare
    equal even with extra spaces or different casing (see W. Ledger)."""
    return re.sub(r"\s+", " ", (n or "").strip()).lower()


def _matches(search, *fields):
    if not search:
        return True
    needle = search.strip().lower()
    return any(needle in str(f).lower() for f in fields if f)


def _err(msg, code=400):
    return jsonify({"error": msg}), code


# AIS-007 (Rev 5) Table 11 month/year-of-manufacture codes — see original
# app.py for the rationale; copied verbatim so generated chassis numbers
# match exactly.
_AIS007_MONTH_CODE = {1: "A", 2: "B", 3: "C", 4: "D", 5: "E", 6: "F",
                       7: "G", 8: "H", 9: "J", 10: "K", 11: "L", 12: "M"}
_AIS007_YEAR_CODE = {2017: "A", 2018: "B", 2019: "C", 2020: "D", 2021: "E", 2022: "F",
                      2023: "G", 2024: "H", 2025: "J", 2026: "K", 2027: "L", 2028: "M",
                      2029: "N", 2030: "P", 2031: "R", 2032: "S", 2033: "T", 2034: "U",
                      2035: "V", 2036: "W", 2037: "X", 2038: "Y", 2039: "Z", 2040: "1",
                      2041: "2", 2042: "3", 2043: "4", 2044: "5", 2045: "6", 2046: "7"}


def _ais007_month_year_code(the_date):
    return _AIS007_MONTH_CODE.get(the_date.month, "?"), _AIS007_YEAR_CODE.get(the_date.year, "?")


# ---------------------------------------------------------------------------
# Serializers
# ---------------------------------------------------------------------------
def ser_dealer(d):
    return {"id": d.id, "code": d.code, "name": d.name, "address1": d.address1,
            "address2": d.address2, "mobile": d.mobile, "gst_no": d.gst_no,
            "state": d.state, "state_code": d.state_code, "pan": d.pan,
            "bank_name": d.bank_name, "bank_account_no": d.bank_account_no, "bank_ifsc": d.bank_ifsc,
            "registration_type": d.registration_type or "registered",
            "salesman": d.salesman, "blocked": d.blocked, "login_id": d.login_id}


def ser_product(p):
    return {"id": p.id, "code": p.code, "name": p.name, "unit": p.unit,
            "gst_rate": p.gst_rate, "hsn_code": p.hsn_code, "fro": p.fro,
            "umrn_code": p.umrn_code, "chassis_item_code": p.chassis_item_code,
            "chassis_first_fix": p.chassis_first_fix,
            "chassis_after_month_year_fix": p.chassis_after_month_year_fix,
            "chassis_length_digits": p.chassis_length_digits,
            "type_approval_no": p.type_approval_no, "fuel_type": p.fuel_type,
            "horn_db": p.horn_db, "pass_by_db": p.pass_by_db}


def ser_simple(row):
    return {"id": row.id, "kind": row.kind, "name": row.name, "code": row.code,
            "address": row.address, "mobile": row.mobile, "account_no": row.account_no,
            "is_default": row.is_default, "ifsc": row.ifsc, "extra": row.extra}


def ser_chassis_month(row):
    return {"id": row.id, "month": row.month, "code": row.code}


def ser_chassis_year(row):
    return {"id": row.id, "year": row.year, "code": row.code}


def ser_chassis_rule(row):
    return {"id": row.id, "month_position": row.month_position,
            "year_position": row.year_position, "chassis_height": row.chassis_height,
            "engine_motor_example": row.engine_motor_example,
            "chassis_example": row.chassis_example}


def ser_user(u):
    return {"id": u.id, "username": u.username, "is_super_user": u.is_super_user,
            "permissions": u.permissions,
            "department": u.department or "Admin",
            "assigned_dealer_ids": u.get_assigned_dealer_ids(),
            "allowed_modules": (u.allowed_modules or "").split(",") if u.allowed_modules else []}


def _staff_dealer_ids():
    payload = getattr(g, "current_user_payload", {}) or {}
    if payload.get("is_super_user"):
        return None
    return payload.get("dealer_ids") or []

def _assert_dealer_scope(dealer_id):
    ids = _staff_dealer_ids()
    if ids is not None and dealer_id not in ids:
        return _err("You are not allowed to access this dealer data.", 403)
    return None

def _scope_vehicle_query(query):
    ids = _staff_dealer_ids()
    if ids is None: return query
    if not ids: return query.filter(db.literal(False))
    names = [d.name for d in Dealer.query.filter(Dealer.id.in_(ids)).all()]
    return query.filter(Vehicle.dealer_name.in_(names))


def ser_formula(f):
    return {"id": f.id, "formula_name": f.formula_name, "product_code": f.product_code,
            "product_name": f.product_name, "raw_item_code": f.raw_item_code,
            "raw_item_name": f.raw_item_name, "qty": f.qty, "unit": f.unit}


def ser_vehicle(v):
    return {"id": v.id, "date": _iso(v.date), "model_name": v.model_name,
            "chassis_no": v.chassis_no, "motor_no": v.motor_no,
            "controller_no": v.controller_no, "differential_no": v.differential_no,
            "colour": v.colour, "colour_code": v.colour_code, "other": v.other,
            "stage": v.stage, "dealer_name": v.dealer_name}


def ser_pv(pv):
    return {"id": pv.id, "vou_no": pv.vou_no, "date": _iso(pv.date),
            "product_name": pv.product_name, "quantity": pv.quantity,
            "chassis_no": pv.chassis_no, "motor_no": pv.motor_no,
            "controller_no": pv.controller_no, "differential_no": pv.differential_no,
            "colour": pv.colour, "colour_code": pv.colour_code, "other": pv.other,
            "battery_maker": pv.battery_maker, "battery_no1": pv.battery_no1,
            "battery_no2": pv.battery_no2, "battery_no3": pv.battery_no3,
            "battery_no4": pv.battery_no4, "toolkit": pv.toolkit, "jack": pv.jack,
            "charger": pv.charger, "mat": pv.mat, "stapney": pv.stapney,
            "front_glass": pv.front_glass, "h_lock": pv.h_lock, "center_lock": pv.center_lock,
            "remarks": pv.remarks, "machnic": pv.machnic,
            "items": [{"id": it.id, "item_code": it.item_code, "item_name": it.item_name,
                       "qty": it.qty, "unit": it.unit} for it in pv.items]}


def ser_pv_list(pv):
    """Same as ser_pv but WITHOUT the items relationship -- for list views,
    where loading every BOM line for every voucher (17k vouchers x ~30
    items each = 500k+ rows) is what was crashing the page. Callers that
    need the actual item lines (edit forms, print views) should fetch the
    single voucher via a detail endpoint instead."""
    d = ser_pv(pv)
    del d["items"]
    return d


def ser_dc(c):
    return {"id": c.id, "challan_no": c.challan_no, "date": _iso(c.date), "cancelled": c.cancelled,
            "dealer_id": c.dealer_id, "dealer_name": c.dealer.name if c.dealer else None,
            "vehicle_id": c.vehicle_id, "destination": c.destination,
            "product_name": c.product_name, "chassis_no": c.chassis_no, "motor_no": c.motor_no,
            "controller_no": c.controller_no, "differential_no": c.differential_no,
            "colour": c.colour, "other": c.other, "battery_maker": c.battery_maker,
            "battery_no1": c.battery_no1, "battery_no2": c.battery_no2,
            "battery_no3": c.battery_no3, "battery_no4": c.battery_no4,
            "toolkit": c.toolkit, "jack": c.jack, "charger": c.charger, "mat": c.mat,
            "stapney": c.stapney, "front_glass": c.front_glass, "center_lock": c.center_lock,
            "h_lock": c.h_lock, "salesman": c.salesman, "sale_bill_no": c.sale_bill_no,
            "sale_value": c.sale_value, "remarks1": c.remarks1, "remarks2": c.remarks2}


def ser_ti(i):
    return {"id": i.id, "bill_no": i.bill_no, "date": _iso(i.date), "cancelled": i.cancelled,
            "delivery_challan_id": i.delivery_challan_id, "vehicle_id": i.vehicle_id,
            "buyer_name": i.buyer_name, "buyer_relation": i.buyer_relation,
            "buyer_father_name": i.buyer_father_name, "buyer_address": i.buyer_address,
            "buyer_gst_no": i.buyer_gst_no, "buyer_pan": i.buyer_pan, "buyer_aadhar": i.buyer_aadhar,
            "buyer_mobile": i.buyer_mobile, "buyer_state": i.buyer_state,
            "buyer_state_code": i.buyer_state_code, "state_type": i.state_type,
            "buyer_dob": _iso(i.buyer_dob), "dealer_name": i.dealer_name,
            "product_name": i.product_name, "chassis_no": i.chassis_no, "motor_no": i.motor_no,
            "controller_no": i.controller_no, "other_desc": i.other_desc, "colour": i.colour,
            "sale_amount": i.sale_amount, "gst_sale_amount": i.gst_sale_amount,
            "discount": i.discount, "gst_rate": i.gst_rate,
            "insurance_amount": i.insurance_amount, "registration_amount": i.registration_amount,
            "financer_name": i.financer_name, "hypothecation_amount": i.hypothecation_amount,
            "amount_received": i.amount_received, "subsidy_amount": i.subsidy_amount,
            "subsidy_status": i.subsidy_status, "rto_name": i.rto_name,
            "vehicle_reg_no": i.vehicle_reg_no, "despatch_through": i.despatch_through,
            "eway_bill_no": i.eway_bill_no, "irn": i.irn, "e_invoice_ack_no": i.e_invoice_ack_no, "e_invoice_ack_date": _iso(i.e_invoice_ack_date), "e_invoice_status": i.e_invoice_status, "e_invoice_qr_code": i.e_invoice_qr_code, "e_invoice_error": i.e_invoice_error, "eway_bill_status": i.eway_bill_status, "eway_bill_date": _iso(i.eway_bill_date), "eway_bill_valid_upto": _iso(i.eway_bill_valid_upto), "eway_bill_error": i.eway_bill_error, "mode_term": i.mode_term, "bank_name": i.bank_name,
            "bank_account_no": i.bank_account_no, "bank_ifsc": i.bank_ifsc, "cvr_no": i.cvr_no,
            "license_no": i.license_no, "cancelled_cheque_no": i.cancelled_cheque_no,
            "remarks": i.remarks, "ledger_no": i.ledger_no, "voucher_no": i.voucher_no,
            "chassis_record_no": i.chassis_record_no,
            # computed, server-derived — never stored (brief Section 4.4/4.1)
            "is_inter_state": i.is_inter_state, "taxable_value": i.taxable_value,
            "igst_amount": i.igst_amount, "cgst_amount": i.cgst_amount, "sgst_amount": i.sgst_amount,
            "tax_amount": i.tax_amount, "bill_total": i.bill_total, "balance_due": i.balance_due,
            "payment_status": i.payment_status}


def ser_pb(b):
    return {"id": b.id, "bill_no": b.bill_no, "date": _iso(b.date), "party_name": b.party_name,
            "party_gst_no": b.party_gst_no, "party_state_code": b.party_state_code,
            "remarks": b.remarks, "is_inter_state": b.is_inter_state,
            "taxable_total": b.taxable_total, "tax_total": b.tax_total, "bill_total": b.bill_total,
            "items": [{"id": it.id, "item_name": it.item_name, "hsn_code": it.hsn_code,
                       "qty": it.qty, "rate": it.rate, "gst_rate": it.gst_rate,
                       "taxable_amt": it.taxable_amt, "cgst_amt": it.cgst_amt,
                       "sgst_amt": it.sgst_amt, "igst_amt": it.igst_amt, "tax_amt": it.tax_amt}
                      for it in b.items]}


def ser_old_rickshaw(r):
    return {"id": r.id, "vou_no": r.vou_no, "date": _iso(r.date), "party_name": r.party_name,
            "vehicle_reg_no": r.vehicle_reg_no, "model_name": r.model_name,
            "owner_name": r.owner_name, "salesman": r.salesman, "sold_amount": r.sold_amount,
            "loan_amount": r.loan_amount, "receipt_amount": r.receipt_amount,
            "receipt_no": r.receipt_no, "ledger": r.ledger, "resale_date": _iso(r.resale_date),
            "resale_ledger": r.resale_ledger, "remarks1": r.remarks1, "remarks2": r.remarks2,
            "balance_amount": r.balance_amount}


def ser_battery_dc(r):
    return {"id": r.id, "challan_no": r.challan_no, "date": _iso(r.date), "dealer_id": r.dealer_id,
            "dealer_name": r.dealer.name if r.dealer else None, "battery_maker": r.battery_maker,
            "battery_no": r.battery_no, "qty": r.qty, "remarks": r.remarks}


def ser_journal(r):
    return {"id": r.id, "vou_no": r.vou_no, "date": _iso(r.date), "item_name": r.item_name,
            "item_type": r.item_type, "qty": r.qty, "reason": r.reason}


def ser_daybook(r):
    return {"id": r.id, "vr_no": r.vr_no, "date": _iso(r.date), "dealer_name": r.dealer_name,
            "bank_id": r.bank_id, "bank_name": (SimpleMaster.query.get(r.bank_id).name if r.bank_id else None),
            "credit_received": r.credit_received, "debit_paid": r.debit_paid,
            "narration": r.narration}


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
@app.route("/api/auth/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    userid = (data.get("userid") or "").strip()
    password = data.get("password") or ""
    user = User.query.filter_by(username=userid).first()
    if not user or not user.check_password(password):
        return _err("Invalid User ID or Password.", 401)
    token = issue_token(user)
    return jsonify({"token": token, "user": ser_user(user)})


@app.route("/api/auth/dealer-login", methods=["POST"])
def dealer_login():
    data = request.get_json(silent=True) or {}
    login_id = (data.get("userid") or "").strip()
    password = data.get("password") or ""
    dealer = Dealer.query.filter_by(login_id=login_id).first()
    if not dealer or dealer.blocked:
        return _err("Dealer login is blocked or not found.", 401)
    if not dealer.check_password(password):
        return _err("Invalid Dealer ID or Password.", 401)
    token = issue_dealer_token(dealer)
    return jsonify({
        "token": token,
        "dealer": {
            "id": dealer.id, "code": dealer.code, "name": dealer.name,
            "login_id": dealer.login_id,
        },
    })


@app.route("/api/dealer/me")
@require_dealer_auth
def dealer_me():
    dealer = Dealer.query.get(g.current_dealer_id)
    if not dealer:
        return _err("Dealer not found", 404)
    return jsonify({
        "id": dealer.id, "code": dealer.code, "name": dealer.name,
        "login_id": dealer.login_id,
    })


@app.route("/api/dealer/stock")
@require_dealer_auth
def dealer_stock():
    dealer_id = g.current_dealer_id
    vehicles = (Vehicle.query
                .filter(Vehicle.stage == "Delivery Challan")
                .filter(db.func.lower(db.func.trim(Vehicle.dealer_name)) ==
                        db.func.lower(db.func.trim(Dealer.query.get_or_404(dealer_id).name)))
                .order_by(Vehicle.date.desc(), Vehicle.id.desc()).all())
    return jsonify({
        "vehicles": [ser_vehicle(v) for v in vehicles],
        "count": len(vehicles),
    })


@app.route("/api/dealer/delivery-challans")
@require_dealer_auth
def dealer_delivery_challans():
    rows = (DeliveryChallan.query
            .filter_by(dealer_id=g.current_dealer_id)
            .order_by(DeliveryChallan.date.desc(), DeliveryChallan.id.desc()).all())
    return jsonify({"challans": [ser_dc(c) for c in rows]})


@app.route("/api/dealer/tax-invoices")
@require_dealer_auth
def dealer_tax_invoices():
    rows = (TaxInvoice.query
            .outerjoin(DeliveryChallan, TaxInvoice.delivery_challan_id == DeliveryChallan.id)
            .filter(TaxInvoice.cancelled.is_(False))
            .filter(db.or_(DeliveryChallan.dealer_id == g.current_dealer_id,
                           TaxInvoice.dealer_name == Dealer.query.get_or_404(g.current_dealer_id).name))
            .order_by(TaxInvoice.date.desc(), TaxInvoice.id.desc()).all())
    return jsonify({"invoices": [ser_ti(i) for i in rows]})


@app.route("/api/auth/me")
@require_auth
def me():
    user = User.query.get(g.current_user_payload["uid"])
    if not user:
        return _err("User not found", 404)
    return jsonify(ser_user(user))


@app.route("/api/menu")
@require_auth
def menu():
    return jsonify(MENU)


# ---------------------------------------------------------------------------
# Dashboard — chassis pipeline (Manufacturing -> Delivery Challan -> Tax Invoice)
# ---------------------------------------------------------------------------
@app.route("/api/dashboard")
@require_auth
def dashboard():
    # Dashboard must NEVER pull the complete Vehicle/TaxInvoice history into
    # the browser. Production installations can have 50k+ raw products and
    # 17k+ manufactured/sold vehicles. Keep the pipeline preview small and
    # calculate chart totals in PostgreSQL with GROUP BY.
    latest_limit = min(100, max(20, _i(request.args.get("limit"), 50)))
    vehicles = (Vehicle.query
                .order_by(Vehicle.date.desc(), Vehicle.id.desc())
                .limit(latest_limit).all())

    stage_rows = (db.session.query(Vehicle.stage, db.func.count(Vehicle.id))
                  .group_by(Vehicle.stage).all())
    stage_counts = {stage or "Unknown": int(count) for stage, count in stage_rows}

    # Monthly pipeline counts. Use a database expression so the 17k+ rows
    # are aggregated by PostgreSQL rather than transferred to Python/JS.
    if db.engine.dialect.name == "postgresql":
        month_expr = db.func.to_char(Vehicle.date, "YYYY-MM")
    else:
        month_expr = db.func.strftime("%Y-%m", Vehicle.date)
    month_rows = (db.session.query(month_expr, Vehicle.stage, db.func.count(Vehicle.id))
                  .filter(Vehicle.date.isnot(None))
                  .group_by(month_expr, Vehicle.stage)
                  .order_by(month_expr).all())
    monthly_map = {}
    for month, stage, count in month_rows:
        if not month:
            continue
        monthly_map.setdefault(str(month), {})[stage or "Unknown"] = int(count)
    months = sorted(monthly_map.keys())[-12:]
    monthly = [{
        "month": m,
        "manufacturing": monthly_map.get(m, {}).get("Manufacturing", 0),
        "delivery_challan": monthly_map.get(m, {}).get("Delivery Challan", 0),
        "tax_invoice": monthly_map.get(m, {}).get("Tax Invoice", 0),
    } for m in months]

    return jsonify({
        "manufacturing": [ser_vehicle(v) for v in vehicles if v.stage == "Manufacturing"],
        "delivery_challan": [ser_vehicle(v) for v in vehicles if v.stage == "Delivery Challan"],
        "tax_invoice": [ser_vehicle(v) for v in vehicles if v.stage == "Tax Invoice"],
        "stage_counts": stage_counts,
        "monthly": monthly,
    })


# ---------------------------------------------------------------------------
# Setup > Chassis Master — coding rules from the supplied reference sheet.
# This master is standalone for now; production/chassis generation is NOT
# linked to it yet, as requested.
# ---------------------------------------------------------------------------
@app.route("/api/chassis-master", methods=["GET"])
@require_auth
def chassis_master():
    months = ChassisMonthCode.query.order_by(ChassisMonthCode.id).all()
    years = ChassisYearCode.query.order_by(ChassisYearCode.year).all()
    rule = ChassisRule.query.order_by(ChassisRule.id).first()
    if rule is None:
        rule = ChassisRule()
        db.session.add(rule)
        db.session.commit()
    return jsonify({
        "months": [ser_chassis_month(x) for x in months],
        "years": [ser_chassis_year(x) for x in years],
        "rule": ser_chassis_rule(rule),
    })


@app.route("/api/chassis-master/months", methods=["POST"])
@require_auth
def chassis_month_create():
    data = request.get_json(silent=True) or {}
    month = (data.get("month") or "").strip()
    code = (data.get("code") or "").strip().upper()
    if not month or not code:
        return _err("Month and Code are required.")
    row = ChassisMonthCode(month=month, code=code)
    db.session.add(row)
    try:
        db.session.commit()
    except Exception:
        db.session.rollback()
        return _err("Month already exists or could not be saved.")
    return jsonify(ser_chassis_month(row)), 201


@app.route("/api/chassis-master/months/<int:row_id>", methods=["PUT", "DELETE"])
@require_auth
def chassis_month_detail(row_id):
    row = ChassisMonthCode.query.get_or_404(row_id)
    if request.method == "DELETE":
        db.session.delete(row)
        db.session.commit()
        return jsonify({"deleted": True})
    data = request.get_json(silent=True) or {}
    row.month = (data.get("month") or row.month).strip()
    row.code = (data.get("code") or row.code).strip().upper()
    db.session.commit()
    return jsonify(ser_chassis_month(row))


@app.route("/api/chassis-master/years", methods=["POST"])
@require_auth
def chassis_year_create():
    data = request.get_json(silent=True) or {}
    try:
        year = int(data.get("year"))
    except (TypeError, ValueError):
        return _err("Valid year is required.")
    code = (data.get("code") or "").strip().upper()
    if not code:
        return _err("Year Code is required.")
    row = ChassisYearCode(year=year, code=code)
    db.session.add(row)
    try:
        db.session.commit()
    except Exception:
        db.session.rollback()
        return _err("Year already exists or could not be saved.")
    return jsonify(ser_chassis_year(row)), 201


@app.route("/api/chassis-master/years/<int:row_id>", methods=["PUT", "DELETE"])
@require_auth
def chassis_year_detail(row_id):
    row = ChassisYearCode.query.get_or_404(row_id)
    if request.method == "DELETE":
        db.session.delete(row)
        db.session.commit()
        return jsonify({"deleted": True})
    data = request.get_json(silent=True) or {}
    try:
        row.year = int(data.get("year", row.year))
    except (TypeError, ValueError):
        return _err("Valid year is required.")
    row.code = (data.get("code") or row.code).strip().upper()
    db.session.commit()
    return jsonify(ser_chassis_year(row))


@app.route("/api/chassis-master/rule", methods=["PUT"])
@require_auth
def chassis_rule_update():
    data = request.get_json(silent=True) or {}
    row = ChassisRule.query.order_by(ChassisRule.id).first()
    if row is None:
        row = ChassisRule()
        db.session.add(row)
    for field in ("month_position", "year_position", "chassis_height",
                  "engine_motor_example", "chassis_example"):
        if field in data:
            setattr(row, field, str(data.get(field) or "").strip())
    db.session.commit()
    return jsonify(ser_chassis_rule(row))


# ---------------------------------------------------------------------------
# Loan workflow: DO -> FE -> DO decision
# ---------------------------------------------------------------------------
def _ensure_loan_workflow_tables():
    LoanWorkflow.__table__.create(db.engine, checkfirst=True)
    LoanWorkflowLog.__table__.create(db.engine, checkfirst=True)


def _workflow_expire(row):
    if row.status == "DO_APPROVED" and row.do_expiry_at and row.do_expiry_at <= dt.utcnow():
        old = row.status
        row.status = "DO_EXPIRED"
        db.session.add(LoanWorkflowLog(application_id=row.id, action="DO_EXPIRED",
            from_status=old, to_status=row.status, details="30-day DO validity completed"))
        db.session.commit()
        return True
    return False


def _ser_workflow(row):
    _workflow_expire(row)
    return {
        "id": row.id, "application_no": row.application_no,
        "dealer_id": row.dealer_id, "dealer_name": row.dealer.name if row.dealer else None,
        "customer_id": row.customer_id, "customer_name": row.customer.full_name if row.customer else None,
        "status": row.status, "do_user_id": row.do_user_id, "fe_user_id": row.fe_user_id,
        "do_remark": row.do_remark, "fe_remark": row.fe_remark,
        "approved_at": _iso(row.approved_at), "do_expiry_at": _iso(row.do_expiry_at),
        "created_at": _iso(row.created_at), "updated_at": _iso(row.updated_at),
    }


def _workflow_user():
    uid = getattr(g, "current_user_id", None)
    return User.query.get(uid) if uid else None


@app.get("/api/loan-workflow")
@require_auth
def loan_workflow_list():
    _ensure_loan_workflow_tables()
    user = _workflow_user()
    rows = LoanWorkflow.query.order_by(LoanWorkflow.id.desc()).limit(500).all()
    result = []
    for row in rows:
        _workflow_expire(row)
        if user and not user.is_super_user:
            dept = (user.department or "").strip().lower()
            if dept == "fe" and row.fe_user_id != user.id:
                continue
        result.append(_ser_workflow(row))
    return jsonify({"success": True, "applications": result})


@app.get("/api/loan-workflow/field-executives")
@require_auth
def loan_workflow_fe_list():
    _ensure_loan_workflow_tables()
    rows = User.query.filter(User.department.ilike("FE")).order_by(User.username.asc()).all()
    return jsonify({"success": True, "field_executives": [
        {"id": u.id, "username": u.username, "department": u.department} for u in rows
    ]})


@app.post("/api/loan-workflow/create")
@require_auth
def loan_workflow_create():
    _ensure_loan_workflow_tables()
    data = request.get_json(silent=True) or {}
    dealer_id = data.get("dealer_id")
    customer_id = data.get("customer_id")
    if not dealer_id or not customer_id:
        return _err("Dealer and customer are required")
    dealer = Dealer.query.get(dealer_id)
    customer = Customer.query.get(customer_id)
    if not dealer or not customer or customer.dealer_id != dealer.id:
        return _err("Dealer/customer mismatch", 422)
    application_no = (data.get("application_no") or "").strip()
    if not application_no:
        application_no = f"GRD-LOAN-{dt.utcnow().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:4].upper()}"
    row = LoanWorkflow(application_no=application_no, dealer_id=dealer.id, customer_id=customer.id, status="DO_PENDING")
    db.session.add(row)
    db.session.flush()
    db.session.add(LoanWorkflowLog(application_id=row.id, action="SUBMITTED", to_status="DO_PENDING",
        user_id=getattr(g, "current_user_id", None), details="Loan application submitted to DO"))
    db.session.commit()
    return jsonify({"success": True, "application": _ser_workflow(row)}), 201


@app.post("/api/loan-workflow/<int:row_id>/assign-fe")
@require_auth
def loan_workflow_assign_fe(row_id):
    _ensure_loan_workflow_tables()
    row = LoanWorkflow.query.get_or_404(row_id)
    data = request.get_json(silent=True) or {}
    fe_id = data.get("fe_user_id")
    fe = User.query.get(fe_id) if fe_id else None
    if not fe or (fe.department or "").strip().lower() != "fe":
        return _err("Valid FE user is required", 422)
    _workflow_expire(row)
    if row.status not in {"DO_PENDING", "FE_ASSIGNED"}:
        return _err("Application cannot be assigned in its current status", 409)
    old = row.status
    row.fe_user_id = fe.id
    row.do_user_id = getattr(g, "current_user_id", None)
    row.status = "FE_ASSIGNED"
    db.session.add(LoanWorkflowLog(application_id=row.id, action="FE_ASSIGNED",
        from_status=old, to_status=row.status, user_id=getattr(g, "current_user_id", None),
        details=f"Assigned FE user {fe.id}"))
    db.session.commit()
    return jsonify({"success": True, "application": _ser_workflow(row)})


@app.post("/api/loan-workflow/<int:row_id>/fe-submit")
@require_auth
def loan_workflow_fe_submit(row_id):
    _ensure_loan_workflow_tables()
    row = LoanWorkflow.query.get_or_404(row_id)
    user = _workflow_user()
    if row.status != "FE_ASSIGNED" or row.fe_user_id != getattr(user, "id", None):
        return _err("This application is not assigned to you", 403)
    data = request.get_json(silent=True) or {}
    photos = data.get("live_photos") or []
    remark = (data.get("remark") or "").strip()
    if not photos:
        return _err("At least one live photo is required", 422)
    if not remark:
        return _err("FE remark is required", 422)
    old = row.status
    row.fe_live_photos = _json.dumps(photos)
    row.fe_remark = remark
    row.status = "FE_SUBMITTED"
    db.session.add(LoanWorkflowLog(application_id=row.id, action="FE_SUBMITTED",
        from_status=old, to_status=row.status, user_id=user.id, remark=remark,
        details=f"{len(photos)} live photo(s) submitted"))
    db.session.commit()
    return jsonify({"success": True, "application": _ser_workflow(row)})


@app.post("/api/loan-workflow/<int:row_id>/decision")
@require_auth
def loan_workflow_decision(row_id):
    _ensure_loan_workflow_tables()
    row = LoanWorkflow.query.get_or_404(row_id)
    if row.status != "FE_SUBMITTED":
        return _err("Only FE-submitted applications can be decided", 409)
    data = request.get_json(silent=True) or {}
    decision = (data.get("decision") or "").strip().upper()
    remark = (data.get("remark") or "").strip()
    if decision not in {"APPROVE", "HOLD", "REJECT"}:
        return _err("Decision must be APPROVE, HOLD or REJECT", 422)
    if not remark:
        return _err("DO remark is required", 422)
    old = row.status
    now = dt.utcnow()
    row.do_user_id = getattr(g, "current_user_id", None)
    row.do_remark = remark
    row.do_decision_at = now
    if decision == "APPROVE":
        row.status = "DO_APPROVED"
        row.approved_at = now
        row.do_expiry_at = now + timedelta(days=30)
    elif decision == "HOLD":
        row.status = "DO_HOLD"
    else:
        row.status = "DO_REJECTED"
    db.session.add(LoanWorkflowLog(application_id=row.id, action=f"DO_{decision}",
        from_status=old, to_status=row.status, user_id=getattr(g, "current_user_id", None),
        remark=remark))
    db.session.commit()
    return jsonify({"success": True, "application": _ser_workflow(row)})


# ---------------------------------------------------------------------------
# Setup > Simple masters (Party, Battery Maker, RTO, Financer, Mechanic,
# Bank, Colour) — one generic CRUD keyed by `kind`, matching SimpleMaster.
# ---------------------------------------------------------------------------
SIMPLE_KINDS = {"party", "battery-maker", "rto", "financer", "mechanic", "bank", "colour"}


def _save_simple_master(kind, data, row_id=None):
    """Shared create/update logic for POST (id in body) and PUT (id in URL)."""
    row_id = row_id if row_id is not None else data.get("id")
    row = SimpleMaster.query.get(row_id) if row_id else SimpleMaster(kind=kind)
    row.kind = kind
    row.name = data.get("name", "")
    row.code = data.get("code")
    row.address = data.get("address")
    row.mobile = data.get("mobile")
    row.account_no = data.get("account_no")
    row.ifsc = data.get("ifsc")
    row.extra = data.get("extra")
    if "is_default" in data:
        row.is_default = bool(data.get("is_default"))
        db.session.add(row)
        db.session.flush()
        if row.is_default:
            # Only one default per kind (e.g. one primary Bank) — brief calls
            # this out explicitly for Bank Details.
            SimpleMaster.query.filter(SimpleMaster.kind == kind,
                                       SimpleMaster.id != row.id).update({"is_default": False})
    else:
        db.session.add(row)
    db.session.commit()
    return row


@app.route("/api/masters/<kind>", methods=["GET", "POST"])
@require_auth
def simple_masters(kind):
    if kind not in SIMPLE_KINDS:
        return _err(f"Unknown master kind '{kind}'", 404)

    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        row = _save_simple_master(kind, data)
        return jsonify(ser_simple(row)), 201

    rows = SimpleMaster.query.filter_by(kind=kind).order_by(SimpleMaster.name).all()
    return jsonify([ser_simple(r) for r in rows])


@app.route("/api/masters/<kind>/<int:row_id>", methods=["PUT", "DELETE"])
@require_auth
def simple_masters_detail(kind, row_id):
    if kind not in SIMPLE_KINDS:
        return _err(f"Unknown master kind '{kind}'", 404)

    if request.method == "PUT":
        data = request.get_json(silent=True) or {}
        row = _save_simple_master(kind, data, row_id=row_id)
        return jsonify(ser_simple(row))

    row = SimpleMaster.query.get_or_404(row_id)
    db.session.delete(row)
    db.session.commit()
    return jsonify({"deleted": True})


# ---------------------------------------------------------------------------
# Setup > Dealer Master
# ---------------------------------------------------------------------------
@app.route("/api/dealers", methods=["GET", "POST"])
@require_auth
def dealers():
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        row_id = data.get("id")
        d = Dealer.query.get(row_id) if row_id else Dealer()
        d.name = data.get("name", "")
        d.address1 = data.get("address1")
        d.address2 = data.get("address2")
        d.mobile = data.get("mobile")
        d.gst_no = data.get("gst_no")
        d.registration_type = (data.get("registration_type") or "registered").strip().lower()
        if d.registration_type not in {"registered", "unregistered"}: d.registration_type = "registered"
        d.state = data.get("state")
        d.state_code = data.get("state_code")
        d.pan = data.get("pan")
        d.bank_name = data.get("bank_name")
        d.bank_account_no = data.get("bank_account_no")
        d.bank_ifsc = data.get("bank_ifsc")
        d.salesman = data.get("salesman")
        d.code = data.get("code") or None
        d.blocked = bool(data.get("blocked"))
        d.login_id = data.get("login_id")
        if data.get("password"):
            d.set_password(data.get("password"))
        db.session.add(d)
        db.session.commit()
        return jsonify(ser_dealer(d)), 201

    dealers_ = Dealer.query.order_by(Dealer.name).all()
    next_code_num = Dealer.query.count() + 1
    return jsonify({"dealers": [ser_dealer(d) for d in dealers_],
                     "suggested_code": f"A-{next_code_num:02d}"})


@app.route("/api/dealers/<int:dealer_id>", methods=["DELETE"])
@require_auth
def dealer_delete(dealer_id):
    d = Dealer.query.get_or_404(dealer_id)
    db.session.delete(d)
    db.session.commit()
    return jsonify({"deleted": True})


# ---------------------------------------------------------------------------
# Dealer portal: registered-dealer purchase/invoice + Cashfree payments
# ---------------------------------------------------------------------------

def _dealer_current():
    did = getattr(g, "current_dealer_id", None)
    return Dealer.query.get(did) if did else None

def _dealer_payment_json(p):
    return {"id":p.id,"order_id":p.order_id,"amount":p.amount,"allocation_type":p.allocation_type,
            "allocation":_json.loads(p.allocation_json or "[]"),"status":p.status,"cf_payment_id":p.cf_payment_id,
            "payment_method":p.payment_method,"created_at":p.created_at.isoformat() if p.created_at else None,
            "paid_at":p.paid_at.isoformat() if p.paid_at else None}

@app.get("/api/dealer/purchases")
@require_dealer_auth
def dealer_purchases():
    d=_dealer_current()
    if not d: return _err("Dealer not found",404)
    if (d.registration_type or "registered") != "registered": return jsonify({"registered":False,"purchases":[]})
    rows=(DeliveryChallan.query.filter_by(dealer_id=d.id,cancelled=False)
          .order_by(DeliveryChallan.date.desc(),DeliveryChallan.id.desc()).limit(500).all())
    return jsonify({"registered":True,"purchases":[ser_dc(x) for x in rows]})

@app.post("/api/dealer/customer-invoice")
@require_dealer_auth
def dealer_customer_invoice():
    d=_dealer_current()
    if not d: return _err("Dealer not found",404)
    if (d.registration_type or "registered") != "registered": return _err("Customer invoice is available only for registered dealers.",403)
    data=request.get_json(silent=True) or {}; challan_id=data.get("challan_id")
    challan=DeliveryChallan.query.filter_by(id=challan_id,dealer_id=d.id,cancelled=False).first()
    if not challan: return _err("Challan not found for this dealer.",404)
    if TaxInvoice.query.filter_by(delivery_challan_id=challan.id).first(): return _err("This purchase already has an invoice.")
    product=Product.query.filter_by(name=challan.product_name).first(); default_gst=product.gst_rate if product else 5
    buyer_name=(data.get("buyer_name") or "").strip()
    if not buyer_name: return _err("Customer name is required.")
    ti=TaxInvoice(bill_no=data.get("bill_no"),date=_parse_date(data.get("date")) or date.today(),delivery_challan_id=challan.id,
      vehicle_id=challan.vehicle_id,buyer_name=buyer_name,buyer_relation=data.get("buyer_relation") or "S/o",buyer_father_name=data.get("buyer_father_name"),
      buyer_address=data.get("buyer_address"),buyer_gst_no=data.get("buyer_gst_no"),buyer_pan=data.get("buyer_pan"),buyer_aadhar=data.get("buyer_aadhar"),
      buyer_mobile=data.get("buyer_mobile"),buyer_state=data.get("buyer_state"),buyer_state_code=data.get("buyer_state_code"),state_type=data.get("state_type") or "I",
      dealer_name=d.name,product_name=challan.product_name,chassis_no=challan.chassis_no,motor_no=challan.motor_no,controller_no=challan.controller_no,
      other_desc=challan.other,colour=challan.colour,sale_amount=_f(data.get("sale_amount"),challan.sale_value or 0),
      gst_sale_amount=_f(data.get("gst_sale_amount"),_f(data.get("sale_amount"),challan.sale_value or 0)),discount=_f(data.get("discount")),gst_rate=_f(data.get("gst_rate"),default_gst or 5),
      insurance_amount=_f(data.get("insurance_amount")),registration_amount=_f(data.get("registration_amount")),amount_received=_f(data.get("amount_received")),
      remarks=data.get("remarks"),mode_term=data.get("mode_term") or "BANK/CASH",
      bank_name=(data.get("bank_name") or d.bank_name),bank_account_no=(data.get("bank_account_no") or d.bank_account_no),bank_ifsc=(data.get("bank_ifsc") or d.bank_ifsc))
    db.session.add(ti)
    if challan.vehicle: challan.vehicle.stage="Tax Invoice"
    db.session.commit(); return jsonify(ser_ti(ti)),201

@app.get("/api/dealer/payments")
@require_dealer_auth
def dealer_payments():
    d=_dealer_current();
    if not d: return _err("Dealer not found",404)
    rows=DealerPayment.query.filter_by(dealer_id=d.id).order_by(DealerPayment.id.desc()).limit(100).all()
    return jsonify({"payments":[_dealer_payment_json(x) for x in rows]})

@app.post("/api/dealer/payment/create")
@require_dealer_auth
def dealer_payment_create():
    d=_dealer_current()
    if not d: return _err("Dealer not found",404)
    data=request.get_json(silent=True) or {}; amount=round(_f(data.get("amount")),2)
    if amount<=0: return _err("Amount must be greater than zero.")
    at=(data.get("allocation_type") or "on_account").strip().lower()
    if at not in {"on_account","single","multiple"}: return _err("Invalid payment allocation.")
    allocation=data.get("allocation") if isinstance(data.get("allocation"),list) else []
    if at!="on_account" and not allocation: return _err("Select at least one rickshaw/invoice.")
    client_id=os.environ.get("CASHFREE_CLIENT_ID") or os.environ.get("CASHFREE_APP_ID")
    secret=os.environ.get("CASHFREE_CLIENT_SECRET") or os.environ.get("CASHFREE_SECRET_KEY")
    if not client_id or not secret: return _err("Cashfree is not configured. Add CASHFREE_CLIENT_ID and CASHFREE_CLIENT_SECRET in backend environment.",503)
    order_id=f"GRD-DP-{d.id}-{uuid.uuid4().hex[:16].upper()}"
    base=(os.environ.get("CASHFREE_BASE_URL") or "https://sandbox.cashfree.com").rstrip("/")
    return_url=os.environ.get("CASHFREE_RETURN_URL") or request.host_url.rstrip("/")+"/api/dealer/payment/return"
    webhook_url=os.environ.get("CASHFREE_WEBHOOK_URL") or request.host_url.rstrip("/")+"/api/dealer/payment/webhook"
    payload={"order_id":order_id,"order_amount":amount,"order_currency":"INR","customer_details":{"customer_id":f"dealer-{d.id}","customer_name":d.name,"customer_phone":d.mobile or "9999999999","customer_email":f"{d.login_id or d.code or d.id}@grdmotors.local"},"order_meta":{"return_url":return_url+"?order_id="+order_id,"notify_url":webhook_url},"order_note":f"GRD Dealer Payment - {d.name}"}
    try:
        body=_json.dumps(payload).encode(); req=urllib.request.Request(base+"/pg/orders",data=body,headers={"Content-Type":"application/json","x-client-id":client_id,"x-client-secret":secret,"x-api-version":"2025-01-01"},method="POST")
        with urllib.request.urlopen(req,timeout=20) as resp: result=_json.loads(resp.read().decode())
    except Exception as exc: return _err(f"Cashfree order creation failed: {exc}",502)
    p=DealerPayment(dealer_id=d.id,order_id=order_id,amount=amount,allocation_type=at,allocation_json=_json.dumps(allocation),status="created"); db.session.add(p); db.session.commit()
    return jsonify({"payment":_dealer_payment_json(p),"payment_session_id":result.get("payment_session_id"),"order_id":order_id})

@app.get("/api/dealer/payment/<order_id>")
@require_dealer_auth
def dealer_payment_status(order_id):
    d=_dealer_current(); p=DealerPayment.query.filter_by(order_id=order_id,dealer_id=d.id if d else 0).first()
    if not p: return _err("Payment not found",404)
    return jsonify({"payment":_dealer_payment_json(p)})

@app.post("/api/dealer/payment/webhook")
def dealer_payment_webhook():
    # Cashfree webhook signature verification must be configured before marking money paid.
    # Raw-body signature verification follows Cashfree's documented x-webhook-signature/timestamp flow.
    signature=request.headers.get("x-webhook-signature") or ""; timestamp=request.headers.get("x-webhook-timestamp") or ""
    secret=os.environ.get("CASHFREE_CLIENT_SECRET") or os.environ.get("CASHFREE_SECRET_KEY") or ""
    raw=request.get_data(cache=True)
    import base64, hashlib
    expected=base64.b64encode(hmac.new(secret.encode(),(timestamp+raw.decode("utf-8")).encode(),hashlib.sha256).digest()).decode() if secret and timestamp else ""
    if not signature or not expected or not hmac.compare_digest(signature,expected): return _err("Invalid Cashfree webhook signature",401)
    data=request.get_json(silent=True) or {}; order_id=((data.get("data") or {}).get("order") or {}).get("order_id") or data.get("order_id")
    p=DealerPayment.query.filter_by(order_id=order_id).first()
    if not p: return _err("Payment order not found",404)
    typ=((data.get("type") or "")).upper(); payment=((data.get("data") or {}).get("payment") or {})
    if "SUCCESS" in typ or str(payment.get("payment_status") or "").upper()=="SUCCESS":
        p.status="paid"; p.cf_payment_id=str(payment.get("cf_payment_id") or ""); p.payment_method=payment.get("payment_group"); p.paid_at=dt.utcnow(); db.session.commit()
    elif "FAILED" in typ: p.status="failed"; db.session.commit()
    return jsonify({"success":True})

# ---------------------------------------------------------------------------
# Setup > Product Master
# ---------------------------------------------------------------------------
@app.route("/api/products", methods=["GET", "POST"])
@require_auth
def products():
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        row_id = data.get("id")
        p = Product.query.get(row_id) if row_id else Product()
        p.name = (data.get("name") or "").strip()
        p.code = data.get("code") or None
        p.unit = data.get("unit") or "PCS"
        p.gst_rate = _f(data.get("gst_rate"))
        p.hsn_code = data.get("hsn_code")
        p.fro = data.get("fro") or "R"
        p.umrn_code = data.get("umrn_code") or None
        # Finished-good chassis configuration. Keep the old chassis_item_code
        # for compatibility; new screens use the explicit three-part fields.
        p.chassis_item_code = data.get("chassis_item_code") or data.get("chassis_first_fix") or None
        p.chassis_first_fix = data.get("chassis_first_fix") or None
        p.chassis_after_month_year_fix = data.get("chassis_after_month_year_fix") or None
        raw_digits = data.get("chassis_length_digits")
        p.chassis_length_digits = _i(raw_digits, 17) if raw_digits not in (None, "") else 17
        p.type_approval_no = data.get("type_approval_no") or None
        p.fuel_type = data.get("fuel_type") or "Battery/Electric"
        p.horn_db = data.get("horn_db") or None
        p.pass_by_db = data.get("pass_by_db") or None
        db.session.add(p)
        db.session.commit()
        return jsonify(ser_product(p)), 201

    # Product Master can contain 50k+ raw-material rows. Support database-side
    # search/filter/pagination so list screens never download the full table.
    # With no query parameters we keep the legacy response for old callers.
    search = (request.args.get("search") or "").strip()
    fro = (request.args.get("fro") or "").strip().upper()
    paged = any(k in request.args for k in ("page", "per_page", "search", "fro"))
    query = Product.query
    if fro in ("F", "R"):
        query = query.filter(Product.fro == fro)
    if search:
        like = f"%{search}%"
        query = query.filter(db.or_(Product.name.ilike(like), Product.code.ilike(like),
                                    Product.hsn_code.ilike(like), Product.chassis_item_code.ilike(like)))
    query = query.order_by(Product.name, Product.id)
    if not paged:
        return jsonify([ser_product(p) for p in query.all()])
    page = max(1, _i(request.args.get("page"), 1))
    per_page = min(200, max(20, _i(request.args.get("per_page"), 50)))
    total = query.count()
    rows = query.offset((page - 1) * per_page).limit(per_page).all()
    return jsonify({"products": [ser_product(p) for p in rows], "total": total,
                    "page": page, "per_page": per_page,
                    "total_pages": (total + per_page - 1) // per_page if total else 1})


@app.route("/api/products/<int:product_id>", methods=["DELETE"])
@require_auth
def product_delete(product_id):
    p = Product.query.get_or_404(product_id)
    db.session.delete(p)
    db.session.commit()
    return jsonify({"deleted": True})


# ---------------------------------------------------------------------------
# Setup > User Master + Option Setting (super-user only, mirrors original)
# ---------------------------------------------------------------------------
@app.route("/api/users", methods=["GET", "POST"])
@require_auth
@require_super_user
def users():
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        row_id = data.get("id")
        u = User.query.get(row_id) if row_id else User()
        u.username = data.get("username", "")
        if data.get("password"):
            u.set_password(data.get("password"))
        elif not row_id:
            return _err("Password is required for a new user.")
        u.is_super_user = bool(data.get("is_super_user"))
        u.permissions = data.get("permissions")
        u.department = (data.get("department") or "Admin").strip()
        dealer_ids = data.get("assigned_dealer_ids") or []
        u.assigned_dealer_ids = ",".join(str(int(x)) for x in dealer_ids if str(x).isdigit())
        db.session.add(u)
        db.session.commit()
        return jsonify(ser_user(u)), 201

    rows = User.query.order_by(User.username).all()
    return jsonify([ser_user(u) for u in rows])


@app.route("/api/users/<int:user_id>", methods=["DELETE"])
@require_auth
@require_super_user
def user_delete(user_id):
    u = User.query.get_or_404(user_id)
    db.session.delete(u)
    db.session.commit()
    return jsonify({"deleted": True})


@app.route("/api/users/<int:user_id>/option-setting", methods=["GET", "POST"])
@require_auth
@require_super_user
def option_setting(user_id):
    u = User.query.get_or_404(user_id)
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        selected = data.get("modules") or []
        u.allowed_modules = ",".join(selected)
        db.session.commit()
    selected_keys = (u.allowed_modules or "").split(",") if u.allowed_modules else []
    return jsonify({"user": ser_user(u), "menu": MENU, "selected_keys": selected_keys})


@app.route("/api/users/<int:user_id>/password", methods=["POST"])
@require_auth
@require_super_user
def reset_password(user_id):
    data = request.get_json(silent=True) or {}
    new_password = data.get("new_password", "")
    confirm_password = data.get("confirm_password", "")
    u = User.query.get_or_404(user_id)
    if not new_password or new_password != confirm_password:
        return _err("Passwords must match and not be blank.")
    u.set_password(new_password)
    db.session.commit()
    return jsonify({"updated": True})


# ---------------------------------------------------------------------------
# Setup > Production Formula (BOM)
# ---------------------------------------------------------------------------
@app.route("/api/production-formulas", methods=["GET", "POST"])
@require_auth
def production_formulas():
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        row_id = data.get("id")
        formula_name = (data.get("formula_name") or "").strip()
        product_name = (data.get("product_name") or "").strip()
        raw_item_name = (data.get("raw_item_name") or "").strip()
        if not product_name or not raw_item_name:
            return _err("Product and Raw Material are both required.")
        if not formula_name:
            formula_name = product_name  # defaults to finished product name

        row = ProductionFormula.query.get(row_id) if row_id else ProductionFormula()
        row.formula_name = formula_name
        row.product_code = data.get("product_code") or None
        row.product_name = product_name
        row.raw_item_code = data.get("raw_item_code") or None
        row.raw_item_name = raw_item_name
        row.qty = _f(data.get("qty"), 1)
        row.unit = data.get("unit") or "PCS"
        db.session.add(row)
        db.session.commit()
        return jsonify(ser_formula(row)), 201

    finished_products = Product.query.filter(
        (Product.fro == "F") | (Product.fro.is_(None))).order_by(Product.name).all()
    raw_materials = Product.query.filter(
        (Product.fro == "R") | (Product.fro.is_(None))).order_by(Product.name).all()
    lines = ProductionFormula.query.order_by(ProductionFormula.formula_name,
                                              ProductionFormula.raw_item_name).all()
    grouped = {}
    for line in lines:
        key = f"{line.formula_name or line.product_name}::{line.product_name}"
        grouped.setdefault(key, {"formula_name": line.formula_name or line.product_name,
                                  "product_name": line.product_name, "lines": []})
        grouped[key]["lines"].append(ser_formula(line))
    return jsonify({
        "finished_products": [ser_product(p) for p in finished_products],
        "raw_materials": [ser_product(p) for p in raw_materials],
        "grouped": list(grouped.values()),
    })


@app.route("/api/production-formulas/<int:row_id>", methods=["DELETE"])
@require_auth
def production_formula_delete(row_id):
    row = ProductionFormula.query.get_or_404(row_id)
    db.session.delete(row)
    db.session.commit()
    return jsonify({"deleted": True})


@app.route("/api/production-formulas/by-product", methods=["DELETE"])
@require_auth
def production_formula_delete_product():
    formula_name = request.args.get("formula_name", "")
    product_name = request.args.get("product_name", "")
    ProductionFormula.query.filter_by(formula_name=formula_name, product_name=product_name).delete()
    db.session.commit()
    return jsonify({"deleted": True})


# ---------------------------------------------------------------------------
# Vouchers > D. Production Voucher
# Creates/updates the matching Vehicle (chassis) -> Dashboard "Manufacturing".
# BOM auto-consumption: if the raw-material grid is left empty, copies the
# Production Formula lines for the chosen product (brief Section 4.3).
# ---------------------------------------------------------------------------
@app.route("/api/production-vouchers/generate-code")
@require_auth
def production_voucher_generate_code():
    product_name = request.args.get("product", "").strip()
    product = (
        Product.query.filter(db.func.lower(Product.name) == product_name.lower(),
                              Product.chassis_item_code.isnot(None),
                              Product.chassis_item_code != "").first()
        or Product.query.filter(db.func.lower(Product.name) == product_name.lower()).first()
    )
    prefix = (product.chassis_item_code if product and product.chassis_item_code else "MD9GRDDE").strip()
    missing_item_code = not (product and product.chassis_item_code)

    voucher_date = _parse_date(request.args.get("date")) or date.today()
    month_code, year_code = _ais007_month_year_code(voucher_date)

    total = Vehicle.query.count()
    cycle = total // 999
    seq_num = (total % 999) + 1
    fixed_block = "245" if cycle % 2 == 0 else "244"
    seq_suffix = f"{seq_num:03d}"

    return jsonify({
        "chassis_no": f"{prefix}{month_code}{year_code}{fixed_block}{seq_suffix}",
        "motor_no": f"KTCM100000{seq_suffix}",
        "controller_no": f"KTCC100000{seq_suffix}",
        "month_code": month_code, "year_code": year_code,
        "missing_item_code": missing_item_code,
    })


@app.route("/api/production-formulas/lines")
@require_auth
def production_formula_lines():
    """AJAX equivalent of the original 'Update From Formula' popup."""
    product_name = request.args.get("product_name", "").strip()
    formula_name = request.args.get("formula_name", "").strip()
    q = ProductionFormula.query.filter_by(product_name=product_name)
    if formula_name:
        q = q.filter_by(formula_name=formula_name)
    return jsonify([ser_formula(f) for f in q.all()])


@app.route("/api/production-vouchers", methods=["GET", "POST"])
@require_auth
def production_vouchers():
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        product_name = (data.get("product_name") or "").strip()
        chassis_no = (data.get("chassis_no") or "").strip()
        vou_no = (data.get("vou_no") or "").strip()
        if not product_name or not chassis_no:
            return _err("Product and Chassis No. are both required.")
        if Vehicle.query.filter_by(chassis_no=chassis_no).first():
            return _err(f"Chassis No. '{chassis_no}' already exists.")
        if vou_no and ProductionVoucher.query.filter_by(vou_no=vou_no).first():
            return _err(f"Vou. No. '{vou_no}' is already in use.")

        pv = ProductionVoucher(
            vou_no=vou_no, date=_parse_date(data.get("date")) or date.today(),
            product_name=product_name, quantity=_i(data.get("quantity"), 1),
            chassis_no=chassis_no, motor_no=data.get("motor_no"),
            controller_no=data.get("controller_no"), differential_no=data.get("differential_no"),
            colour=data.get("colour"), colour_code=data.get("colour_code"), other=data.get("other"),
            battery_maker=data.get("battery_maker"), battery_no1=data.get("battery_no1"),
            battery_no2=data.get("battery_no2"), battery_no3=data.get("battery_no3"),
            battery_no4=data.get("battery_no4"),
            toolkit=bool(data.get("toolkit", True)), jack=bool(data.get("jack", True)),
            charger=bool(data.get("charger", True)), mat=bool(data.get("mat", True)),
            stapney=bool(data.get("stapney", False)), front_glass=bool(data.get("front_glass", False)),
            h_lock=bool(data.get("h_lock", False)), center_lock=bool(data.get("center_lock", False)),
            remarks=data.get("remarks"), machnic=data.get("machnic"),
        )
        db.session.add(pv)

        # Raw-material grid; falls back to copying the BOM if left empty.
        grid = data.get("items") or []
        for row in grid:
            name = (row.get("item_name") or "").strip()
            if not name:
                continue
            pv.items.append(ProductionVoucherItem(
                item_code=row.get("item_code"), item_name=name,
                qty=_f(row.get("qty"), 1), unit=row.get("unit") or "PCS"))
        if not grid:
            formula_name = (data.get("formula_name") or "").strip()
            q = ProductionFormula.query.filter_by(product_name=product_name)
            if formula_name:
                q = q.filter_by(formula_name=formula_name)
            for fl in q.all():
                pv.items.append(ProductionVoucherItem(
                    item_code=fl.raw_item_code, item_name=fl.raw_item_name,
                    qty=fl.qty, unit=fl.unit))

        vehicle = Vehicle(date=pv.date, model_name=product_name, chassis_no=chassis_no,
                           motor_no=pv.motor_no, controller_no=pv.controller_no,
                           differential_no=pv.differential_no, colour=pv.colour,
                           colour_code=pv.colour_code, other=pv.other, stage="Manufacturing")
        db.session.add(vehicle)
        db.session.commit()
        return jsonify(ser_pv(pv)), 201

    # Pagination + a lightweight list serializer -- 17k+ vouchers exist in
    # production, and the old code's ser_pv() also eagerly serialized each
    # voucher's full BOM item list (517k+ rows total, one extra query per
    # voucher too), which is why this was crashing on the full list. The
    # frontend list view only ever displays the item COUNT, not full item
    # detail, so we compute counts with one grouped query instead of
    # loading every item row.
    page = max(1, _i(request.args.get("page"), 1))
    per_page = min(200, max(1, _i(request.args.get("per_page"), 50)))
    search = (request.args.get("search") or "").strip()

    query = ProductionVoucher.query
    if search:
        like = f"%{search}%"
        query = query.filter(db.or_(
            ProductionVoucher.chassis_no.ilike(like),
            ProductionVoucher.vou_no.ilike(like),
        ))
    query = query.order_by(ProductionVoucher.date.desc(), ProductionVoucher.id.desc())

    total = query.count()
    rows = query.offset((page - 1) * per_page).limit(per_page).all()

    page_ids = [pv.id for pv in rows]
    item_counts = dict(
        db.session.query(ProductionVoucherItem.voucher_id, db.func.count(ProductionVoucherItem.id))
        .filter(ProductionVoucherItem.voucher_id.in_(page_ids))
        .group_by(ProductionVoucherItem.voucher_id).all()
    ) if page_ids else {}

    out = []
    for pv in rows:
        row = ser_pv_list(pv)
        row["item_count"] = item_counts.get(pv.id, 0)
        out.append(row)

    return jsonify({
        "vouchers": out,
        "page": page, "per_page": per_page, "total": total,
        "total_pages": (total + per_page - 1) // per_page if total else 1,
    })


@app.route("/api/production-vouchers/<int:voucher_id>", methods=["DELETE"])
@require_auth
def production_voucher_delete(voucher_id):
    pv = ProductionVoucher.query.get_or_404(voucher_id)
    vehicle = Vehicle.query.filter_by(chassis_no=pv.chassis_no).first()
    if vehicle and vehicle.stage == "Manufacturing":
        db.session.delete(vehicle)
    db.session.delete(pv)
    db.session.commit()
    return jsonify({"deleted": True})


# ---------------------------------------------------------------------------
# Vouchers > E. E-Rickshaw Delivery Challan
# ---------------------------------------------------------------------------
@app.route("/api/delivery-challans", methods=["GET", "POST"])
@require_auth
def delivery_challans():
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        vehicle_id = data.get("vehicle_id")
        dealer_id = data.get("dealer_id")
        if not vehicle_id or not dealer_id:
            return _err("Chassis and Dealer are both required.")
        vehicle = Vehicle.query.get_or_404(vehicle_id)
        dealer = Dealer.query.get_or_404(dealer_id)
        if vehicle.stage != "Manufacturing":
            return _err("That chassis has already moved past Manufacturing.")

        dc = DeliveryChallan(
            challan_no=data.get("challan_no"), date=_parse_date(data.get("date")) or date.today(),
            dealer_id=dealer.id, vehicle_id=vehicle.id, destination=data.get("destination"),
            product_name=vehicle.model_name, chassis_no=vehicle.chassis_no,
            motor_no=vehicle.motor_no, controller_no=vehicle.controller_no,
            differential_no=vehicle.differential_no, colour=vehicle.colour, other=vehicle.other,
            battery_maker=data.get("battery_maker"), battery_no1=data.get("battery_no1"),
            battery_no2=data.get("battery_no2"), battery_no3=data.get("battery_no3"),
            battery_no4=data.get("battery_no4"),
            toolkit=bool(data.get("toolkit", True)), jack=bool(data.get("jack", True)),
            charger=bool(data.get("charger", True)), center_lock=bool(data.get("center_lock", False)),
            mat=bool(data.get("mat", True)), stapney=bool(data.get("stapney", False)),
            front_glass=bool(data.get("front_glass", False)), h_lock=bool(data.get("h_lock", False)),
            salesman=data.get("salesman"), sale_bill_no=data.get("sale_bill_no"),
            sale_value=_f(data.get("sale_value")), remarks1=data.get("remarks1"),
            remarks2=data.get("remarks2"),
        )
        db.session.add(dc)
        vehicle.stage = "Delivery Challan"           # pipeline stage transition
        vehicle.dealer_name = dealer.name
        db.session.add(vehicle)
        db.session.commit()
        return jsonify(ser_dc(dc)), 201

    # Pagination -- this table has 17k+ rows in production; returning
    # .all() of them in one JSON response is what was crashing the page
    # (huge payload, huge serialization time, request timeout -> 500).
    # Defaults keep old callers working (page 1, a sane page size) without
    # requiring every caller to pass params.
    page = max(1, _i(request.args.get("page"), 1))
    per_page = min(200, max(1, _i(request.args.get("per_page"), 50)))
    search = (request.args.get("search") or "").strip()

    query = DeliveryChallan.query
    if search:
        like = f"%{search}%"
        query = query.filter(db.or_(
            DeliveryChallan.challan_no.ilike(like),
            DeliveryChallan.chassis_no.ilike(like),
        ))
    query = query.order_by(DeliveryChallan.date.desc(), DeliveryChallan.id.desc())

    total = query.count()
    challans = query.offset((page - 1) * per_page).limit(per_page).all()

    # Only look up invoice/bill numbers for the page we're actually
    # returning, not the whole table.
    page_ids = [c.id for c in challans]
    invoiced_bill_no = {
        ti.delivery_challan_id: ti.bill_no
        for ti in TaxInvoice.query.filter(TaxInvoice.delivery_challan_id.in_(page_ids)).all()
    } if page_ids else {}

    out = []
    for c in challans:
        row = ser_dc(c)
        row["bill_no"] = invoiced_bill_no.get(c.id) or c.sale_bill_no or None
        row["invoiced"] = c.id in invoiced_bill_no
        out.append(row)

    # available_vehicles is inherently small (only vehicles still in the
    # Manufacturing stage, not the whole history) -- fine to send in full.
    available_vehicles = Vehicle.query.filter_by(stage="Manufacturing").order_by(Vehicle.chassis_no).all()
    next_no = (db.session.query(db.func.max(DeliveryChallan.id)).scalar() or 0) + 1
    return jsonify({
        "challans": out,
        "page": page,
        "per_page": per_page,
        "total": total,
        "total_pages": (total + per_page - 1) // per_page if total else 1,
        "available_vehicles": [ser_vehicle(v) for v in available_vehicles],
        "suggested_challan_no": f"DC{next_no + 16500}",
    })


@app.route("/api/delivery-challans/<int:challan_id>", methods=["PUT", "DELETE"])
@require_auth
def delivery_challan_detail(challan_id):
    dc = DeliveryChallan.query.get_or_404(challan_id)

    if request.method == "DELETE":
        if dc.vehicle:
            dc.vehicle.stage = "Manufacturing"
            dc.vehicle.dealer_name = None
        db.session.delete(dc)
        db.session.commit()
        return jsonify({"deleted": True})

    data = request.get_json(silent=True) or {}
    new_dealer_id = data.get("dealer_id")
    new_vehicle_id = data.get("vehicle_id")
    changing_link = bool(new_dealer_id) and bool(new_vehicle_id) and (
        new_dealer_id != dc.dealer_id or new_vehicle_id != dc.vehicle_id)

    if changing_link:
        has_invoice = TaxInvoice.query.filter_by(delivery_challan_id=dc.id).first() is not None
        if has_invoice:
            return _err("Dealer/Chassis can't be changed — a Tax Invoice already exists "
                        "for this Delivery Challan. Cancel and re-create it instead.")
        new_vehicle = Vehicle.query.get_or_404(new_vehicle_id)
        new_dealer = Dealer.query.get_or_404(new_dealer_id)
        if new_vehicle.id != dc.vehicle_id and new_vehicle.stage != "Manufacturing":
            return _err("That chassis has already moved past Manufacturing.")
        if dc.vehicle and dc.vehicle.id != new_vehicle.id:
            dc.vehicle.stage = "Manufacturing"
            dc.vehicle.dealer_name = None
        dc.dealer_id = new_dealer.id
        dc.vehicle_id = new_vehicle.id
        dc.product_name = new_vehicle.model_name
        dc.chassis_no = new_vehicle.chassis_no
        dc.motor_no = new_vehicle.motor_no
        dc.controller_no = new_vehicle.controller_no
        dc.differential_no = new_vehicle.differential_no
        dc.colour = new_vehicle.colour
        dc.other = new_vehicle.other
        new_vehicle.stage = "Delivery Challan"
        new_vehicle.dealer_name = new_dealer.name

    dc.challan_no = data.get("challan_no") or dc.challan_no
    dc.date = _parse_date(data.get("date")) or dc.date
    dc.destination = data.get("destination")
    dc.battery_maker = data.get("battery_maker")
    dc.battery_no1 = data.get("battery_no1")
    dc.battery_no2 = data.get("battery_no2")
    dc.battery_no3 = data.get("battery_no3")
    dc.battery_no4 = data.get("battery_no4")
    dc.toolkit = bool(data.get("toolkit", dc.toolkit))
    dc.jack = bool(data.get("jack", dc.jack))
    dc.charger = bool(data.get("charger", dc.charger))
    dc.center_lock = bool(data.get("center_lock", dc.center_lock))
    dc.mat = bool(data.get("mat", dc.mat))
    dc.stapney = bool(data.get("stapney", dc.stapney))
    dc.front_glass = bool(data.get("front_glass", dc.front_glass))
    dc.h_lock = bool(data.get("h_lock", dc.h_lock))
    dc.salesman = data.get("salesman")
    dc.sale_bill_no = data.get("sale_bill_no")
    dc.sale_value = _f(data.get("sale_value"))
    dc.remarks1 = data.get("remarks1")
    dc.remarks2 = data.get("remarks2")
    db.session.commit()
    return jsonify(ser_dc(dc))


@app.route("/api/delivery-challans/<int:challan_id>/cancel", methods=["POST"])
@require_auth
def delivery_challan_cancel(challan_id):
    dc = DeliveryChallan.query.get_or_404(challan_id)
    dc.cancelled = not dc.cancelled
    if dc.vehicle:
        # cancelling sends the chassis back to Manufacturing (brief Section 4.2)
        dc.vehicle.stage = "Manufacturing" if dc.cancelled else "Delivery Challan"
        dc.vehicle.dealer_name = None if dc.cancelled else dc.vehicle.dealer_name
    db.session.commit()
    return jsonify(ser_dc(dc))


# ---------------------------------------------------------------------------
# Vouchers > F. Tax Invoice — GST split (brief Section 4.1)
# ---------------------------------------------------------------------------
@app.route("/api/tax-invoices", methods=["GET", "POST"])
@require_auth
def tax_invoices():
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        challan_id = data.get("challan_id")
        if not challan_id:
            return _err("Please choose a Delivery Challan to invoice.")
        challan = DeliveryChallan.query.get_or_404(challan_id)
        if TaxInvoice.query.filter_by(delivery_challan_id=challan.id).first():
            return _err("That Delivery Challan already has a Tax Invoice.")

        product = Product.query.filter_by(name=challan.product_name).first()
        default_gst = product.gst_rate if product else 5
        buyer_name = data.get("buyer_name") or (challan.dealer.name if challan.dealer else "")

        bank_name = (data.get("bank_name") or "").strip()
        bank_ifsc_input = (data.get("bank_ifsc") or "").strip()
        bank_master = SimpleMaster.query.filter_by(kind="bank", name=bank_name).first() if bank_name else None
        if not bank_name:
            bank_master = SimpleMaster.query.filter_by(kind="bank", is_default=True).first()
            if bank_master:
                bank_name = bank_master.name
        bank_account_no = bank_master.account_no if bank_master else None
        bank_ifsc = bank_ifsc_input or (bank_master.ifsc if bank_master else None)

        ti = TaxInvoice(
            bill_no=data.get("bill_no"), date=_parse_date(data.get("date")) or date.today(),
            delivery_challan_id=challan.id, vehicle_id=challan.vehicle_id,
            buyer_name=buyer_name, buyer_relation=data.get("buyer_relation") or "S/o",
            buyer_father_name=data.get("buyer_father_name"), buyer_address=data.get("buyer_address"),
            buyer_gst_no=data.get("buyer_gst_no"), buyer_pan=data.get("buyer_pan"),
            buyer_aadhar=data.get("buyer_aadhar"), buyer_mobile=data.get("buyer_mobile"),
            buyer_state=data.get("buyer_state"), buyer_state_code=data.get("buyer_state_code"),
            state_type=data.get("state_type") or "I", buyer_dob=_parse_date(data.get("buyer_dob")),
            dealer_name=challan.dealer.name if challan.dealer else None,
            product_name=challan.product_name, chassis_no=challan.chassis_no,
            motor_no=challan.motor_no, controller_no=challan.controller_no,
            other_desc=challan.other, colour=challan.colour,
            sale_amount=_f(data.get("sale_amount"), challan.sale_value or 0),
            gst_sale_amount=_f(data.get("gst_sale_amount"), _f(data.get("sale_amount"), challan.sale_value or 0)),
            discount=_f(data.get("discount")), gst_rate=_f(data.get("gst_rate"), default_gst or 5),
            insurance_amount=_f(data.get("insurance_amount")),
            registration_amount=_f(data.get("registration_amount")),
            financer_name=data.get("financer_name"),
            hypothecation_amount=_f(data.get("hypothecation_amount")),
            amount_received=_f(data.get("amount_received")),
            subsidy_amount=_f(data.get("subsidy_amount")),
            rto_name=data.get("rto_name"), vehicle_reg_no=data.get("vehicle_reg_no"),
            despatch_through=data.get("despatch_through"), eway_bill_no=data.get("eway_bill_no"),
            mode_term=data.get("mode_term") or "BANK/CASH", bank_name=bank_name,
            bank_account_no=bank_account_no, bank_ifsc=bank_ifsc,
            cvr_no=data.get("cvr_no"), license_no=data.get("license_no"),
            cancelled_cheque_no=data.get("cancelled_cheque_no"), remarks=data.get("remarks"),
            ledger_no=data.get("ledger_no"), voucher_no=data.get("voucher_no"),
            chassis_record_no=data.get("chassis_record_no"),
        )
        db.session.add(ti)
        if challan.vehicle:
            challan.vehicle.stage = "Tax Invoice"    # final pipeline stage
        db.session.commit()
        return jsonify(ser_ti(ti)), 201

    # Pagination -- 16k+ tax invoices exist in production, same crash risk
    # as delivery-challans (see that endpoint for the full explanation).
    page = max(1, _i(request.args.get("page"), 1))
    per_page = min(200, max(1, _i(request.args.get("per_page"), 50)))
    search = (request.args.get("search") or "").strip()

    query = TaxInvoice.query
    if search:
        like = f"%{search}%"
        query = query.filter(db.or_(
            TaxInvoice.bill_no.ilike(like),
            TaxInvoice.chassis_no.ilike(like),
            TaxInvoice.buyer_name.ilike(like),
        ))
    query = query.order_by(TaxInvoice.date.desc(), TaxInvoice.id.desc())

    total = query.count()
    rows = query.offset((page - 1) * per_page).limit(per_page).all()

    # uninvoiced_challans -- the "still needs a Tax Invoice raised" queue.
    # This used to be a `~DeliveryChallan.id.in_(subquery on 16k+ rows)`
    # (NOT IN with a large subquery), which Postgres executes as a slow
    # linear anti-join -- that was the actual cause of the Tax Invoice
    # page hanging on load. A LEFT JOIN + "match is NULL" anti-join does
    # the same filtering but lets Postgres use an index, and is the
    # standard fast way to express "rows in A with no match in B".
    # uninvoiced_challans -- the "still needs a Tax Invoice raised" queue.
    # This used to be a `~DeliveryChallan.id.in_(subquery on 16k+ rows)`
    # (NOT IN with a large subquery), which Postgres executes as a slow
    # linear anti-join -- that was the actual cause of the Tax Invoice
    # page hanging on load. A LEFT JOIN + "match is NULL" anti-join does
    # the same filtering but lets Postgres use an index, and is the
    # standard fast way to express "rows in A with no match in B".
    #
    # joinedload(DeliveryChallan.dealer) matters just as much: ser_dc()
    # reads c.dealer.name, a lazy-loaded relationship -- without eager
    # loading it here, that's one extra round-trip to Supabase PER ROW
    # (up to 1000 of them), which alone accounted for most of this page's
    # ~15s load time. joinedload folds it into the same query instead.
    uninvoiced_challans = (
        db.session.query(DeliveryChallan)
        .options(joinedload(DeliveryChallan.dealer))
        .outerjoin(TaxInvoice, TaxInvoice.delivery_challan_id == DeliveryChallan.id)
        .filter(DeliveryChallan.cancelled.is_(False), TaxInvoice.id.is_(None))
        .order_by(DeliveryChallan.date.desc())
        .limit(1000)
        .all()
    )
    return jsonify({
        "invoices": [ser_ti(i) for i in rows],
        "page": page, "per_page": per_page, "total": total,
        "total_pages": (total + per_page - 1) // per_page if total else 1,
        "uninvoiced_challans": [ser_dc(c) for c in uninvoiced_challans],
    })


@app.route("/api/tax-invoices/<int:invoice_id>/e-invoice", methods=["POST"])
@require_auth
def generate_e_invoice(invoice_id):
    ti = TaxInvoice.query.get_or_404(invoice_id)
    if ti.cancelled:
        return _err("Cancelled invoice cannot generate e-Invoice.", 400)
    if ti.irn:
        return jsonify(ser_ti(ti))
    if not os.environ.get("EINVOICE_API_URL"):
        ti.e_invoice_status = "not_configured"
        ti.e_invoice_error = "E-Invoice API credentials/provider are not configured. Configure EINVOICE_API_URL and approved API credentials first."
        db.session.commit()
        return _err(ti.e_invoice_error, 503)
    # Provider-specific NIC/GSP adapter is intentionally kept behind the
    # configured endpoint; government API onboarding/credentials are required
    # before production generation is possible.
    return _err("E-Invoice provider is configured but the provider adapter is not enabled yet.", 501)


@app.route("/api/tax-invoices/<int:invoice_id>/e-way-bill", methods=["POST"])
@require_auth
def generate_e_way_bill(invoice_id):
    ti = TaxInvoice.query.get_or_404(invoice_id)
    if ti.cancelled:
        return _err("Cancelled invoice cannot generate e-Way Bill.", 400)
    if ti.eway_bill_no:
        return jsonify(ser_ti(ti))
    if not os.environ.get("EWAY_API_URL"):
        ti.eway_bill_status = "not_configured"
        ti.eway_bill_error = "E-Way Bill API credentials/provider are not configured. Configure EWAY_API_URL and approved API credentials first."
        db.session.commit()
        return _err(ti.eway_bill_error, 503)
    return _err("E-Way Bill provider is configured but the provider adapter is not enabled yet.", 501)


@app.route("/api/tax-invoices/<int:invoice_id>", methods=["GET", "PUT", "DELETE"])
@require_auth
def tax_invoice_detail(invoice_id):
    ti = TaxInvoice.query.get_or_404(invoice_id)
    if request.method == "GET":
        return jsonify(ser_ti(ti))
    if request.method == "DELETE":
        if ti.vehicle:
            ti.vehicle.stage = "Delivery Challan"
        db.session.delete(ti)
        db.session.commit()
        return jsonify({"deleted": True})

    data = request.get_json(silent=True) or {}
    for field in ("bill_no", "buyer_name", "buyer_relation", "buyer_father_name", "buyer_address",
                  "buyer_gst_no", "buyer_pan", "buyer_aadhar", "buyer_mobile", "buyer_state",
                  "buyer_state_code", "state_type", "financer_name", "rto_name", "vehicle_reg_no",
                  "despatch_through", "eway_bill_no", "mode_term", "bank_name", "bank_account_no",
                  "bank_ifsc", "cvr_no", "license_no", "cancelled_cheque_no", "remarks",
                  "voucher_no", "chassis_record_no", "ledger_no"):
        if field in data:
            setattr(ti, field, data[field])
    for field in ("sale_amount", "gst_sale_amount", "discount", "gst_rate", "insurance_amount",
                  "registration_amount", "hypothecation_amount", "amount_received", "subsidy_amount"):
        if field in data:
            setattr(ti, field, _f(data[field], getattr(ti, field)))
    if "date" in data:
        ti.date = _parse_date(data["date"]) or ti.date
    db.session.commit()
    return jsonify(ser_ti(ti))


@app.route("/api/tax-invoices/<int:invoice_id>/cancel", methods=["POST"])
@require_auth
def tax_invoice_cancel(invoice_id):
    ti = TaxInvoice.query.get_or_404(invoice_id)
    ti.cancelled = not ti.cancelled
    if ti.vehicle:
        ti.vehicle.stage = "Delivery Challan" if ti.cancelled else "Tax Invoice"
    db.session.commit()
    return jsonify(ser_ti(ti))


@app.route("/api/tax-invoices/<int:invoice_id>/payment", methods=["POST"])
@require_auth
def tax_invoice_update_payment(invoice_id):
    ti = TaxInvoice.query.get_or_404(invoice_id)
    data = request.get_json(silent=True) or {}
    ti.sale_amount = _f(data.get("sale_amount"), ti.sale_amount or 0)
    ti.hypothecation_amount = _f(data.get("hypothecation_amount"))
    ti.amount_received = _f(data.get("amount_received"))
    ti.subsidy_amount = _f(data.get("subsidy_amount"), ti.subsidy_amount or 0)
    ti.subsidy_status = data.get("subsidy_status") or ti.subsidy_status or "Due"
    ti.financer_name = data.get("financer_name") or ti.financer_name
    ti.voucher_no = data.get("voucher_no")
    ti.chassis_record_no = data.get("chassis_record_no")
    ti.ledger_no = data.get("ledger_no")
    ti.cancelled_cheque_no = data.get("cancelled_cheque_no")
    ti.vehicle_reg_no = data.get("vehicle_reg_no")
    db.session.commit()
    return jsonify(ser_ti(ti))


# ---------------------------------------------------------------------------
# Vouchers > C. Purchase Bills — GST split (brief Section 4.1)
# ---------------------------------------------------------------------------
@app.route("/api/purchase-bills", methods=["GET", "POST"])
@require_auth
def purchase_bills():
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        party_name = (data.get("party_name") or "").strip()
        if not party_name:
            return _err("Party Name is required.")
        items = data.get("items") or []
        pb = PurchaseBill(bill_no=data.get("bill_no"), date=_parse_date(data.get("date")) or date.today(),
                           party_name=party_name, party_gst_no=data.get("party_gst_no"),
                           party_state_code=data.get("party_state_code") or "07",
                           remarks=data.get("remarks"))
        added_any = False
        for row in items:
            name = (row.get("item_name") or "").strip()
            if not name:
                continue
            pb.items.append(PurchaseBillItem(
                item_name=name, hsn_code=row.get("hsn_code"), qty=_f(row.get("qty"), 1),
                rate=_f(row.get("rate")), gst_rate=_f(row.get("gst_rate"))))
            added_any = True
        if not added_any:
            return _err("Add at least one item line.")
        db.session.add(pb)
        db.session.commit()
        return jsonify(ser_pb(pb)), 201

    rows = PurchaseBill.query.order_by(PurchaseBill.date.desc(), PurchaseBill.id.desc()).all()
    return jsonify([ser_pb(b) for b in rows])


@app.route("/api/purchase-bills/<int:bill_id>", methods=["PUT", "DELETE"])
@require_auth
def purchase_bill_detail(bill_id):
    pb = PurchaseBill.query.get_or_404(bill_id)
    if request.method == "DELETE":
        db.session.delete(pb)
        db.session.commit()
        return jsonify({"deleted": True})

    data = request.get_json(silent=True) or {}
    party_name = (data.get("party_name") or "").strip()
    if not party_name:
        return _err("Party Name is required.")
    items = data.get("items") or []
    pb.bill_no = data.get("bill_no")
    pb.date = _parse_date(data.get("date")) or pb.date
    pb.party_name = party_name
    pb.party_gst_no = data.get("party_gst_no")
    pb.party_state_code = data.get("party_state_code") or "07"
    pb.remarks = data.get("remarks")
    pb.items.clear()
    added_any = False
    for row in items:
        name = (row.get("item_name") or "").strip()
        if not name:
            continue
        pb.items.append(PurchaseBillItem(
            item_name=name, hsn_code=row.get("hsn_code"), qty=_f(row.get("qty"), 1),
            rate=_f(row.get("rate")), gst_rate=_f(row.get("gst_rate"))))
        added_any = True
    if not added_any:
        return _err("Add at least one item line.")
    db.session.commit()
    return jsonify(ser_pb(pb))


# ---------------------------------------------------------------------------
# Vouchers > G/H/I — Old Rickshaw / Battery Delivery Challan / Journal Stock
# ---------------------------------------------------------------------------
@app.route("/api/old-rickshaws", methods=["GET", "POST"])
@require_auth
def old_rickshaws():
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        vehicle_reg_no = (data.get("vehicle_reg_no") or "").strip()
        if not vehicle_reg_no:
            return _err("Vehicle Reg. No. is required.")
        rec = OldRickshaw(
            vou_no=data.get("vou_no"), date=_parse_date(data.get("date")) or date.today(),
            party_name=data.get("party_name"), vehicle_reg_no=vehicle_reg_no,
            model_name=data.get("model_name"), owner_name=data.get("owner_name"),
            salesman=data.get("salesman"), sold_amount=_f(data.get("sold_amount")),
            loan_amount=_f(data.get("loan_amount")), receipt_amount=_f(data.get("receipt_amount")),
            receipt_no=data.get("receipt_no"), ledger=data.get("ledger"),
            resale_date=_parse_date(data.get("resale_date")), resale_ledger=data.get("resale_ledger"),
            remarks1=data.get("remarks1"), remarks2=data.get("remarks2"))
        db.session.add(rec)
        db.session.commit()
        return jsonify(ser_old_rickshaw(rec)), 201

    rows = OldRickshaw.query.order_by(OldRickshaw.date.desc(), OldRickshaw.id.desc()).all()
    next_no = (db.session.query(db.func.max(OldRickshaw.id)).scalar() or 0) + 1
    return jsonify({"records": [ser_old_rickshaw(r) for r in rows],
                     "suggested_vou_no": str(next_no + 90)})


@app.route("/api/old-rickshaws/<int:record_id>", methods=["DELETE"])
@require_auth
def old_rickshaw_delete(record_id):
    rec = OldRickshaw.query.get_or_404(record_id)
    db.session.delete(rec)
    db.session.commit()
    return jsonify({"deleted": True})


@app.route("/api/battery-delivery-challans", methods=["GET", "POST"])
@require_auth
def battery_delivery_challans():
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        dealer_id = data.get("dealer_id")
        if not dealer_id:
            return _err("Dealer is required.")
        rec = BatteryDeliveryChallan(
            challan_no=data.get("challan_no"), date=_parse_date(data.get("date")) or date.today(),
            dealer_id=dealer_id, battery_maker=data.get("battery_maker"),
            battery_no=data.get("battery_no"), qty=_i(data.get("qty"), 1), remarks=data.get("remarks"))
        db.session.add(rec)
        db.session.commit()
        return jsonify(ser_battery_dc(rec)), 201

    rows = BatteryDeliveryChallan.query.order_by(BatteryDeliveryChallan.date.desc(),
                                                  BatteryDeliveryChallan.id.desc()).all()
    next_no = (db.session.query(db.func.max(BatteryDeliveryChallan.id)).scalar() or 0) + 1
    return jsonify({"records": [ser_battery_dc(r) for r in rows],
                     "suggested_challan_no": f"BDC{next_no + 1000}"})


@app.route("/api/battery-delivery-challans/<int:record_id>", methods=["DELETE"])
@require_auth
def battery_delivery_challan_delete(record_id):
    rec = BatteryDeliveryChallan.query.get_or_404(record_id)
    db.session.delete(rec)
    db.session.commit()
    return jsonify({"deleted": True})


@app.route("/api/journal-stock", methods=["GET", "POST"])
@require_auth
def journal_stock():
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        item_name = (data.get("item_name") or "").strip()
        if not item_name:
            return _err("Item Name is required.")
        rec = JournalStock(vou_no=data.get("vou_no"), date=_parse_date(data.get("date")) or date.today(),
                            item_name=item_name, item_type=data.get("item_type") or "R",
                            qty=_f(data.get("qty")), reason=data.get("reason"))
        db.session.add(rec)
        db.session.commit()
        return jsonify(ser_journal(rec)), 201

    rows = JournalStock.query.order_by(JournalStock.date.desc(), JournalStock.id.desc()).all()
    next_no = (db.session.query(db.func.max(JournalStock.id)).scalar() or 0) + 1
    return jsonify({"records": [ser_journal(r) for r in rows],
                     "suggested_vou_no": f"J-{next_no + 100}"})


@app.route("/api/journal-stock/<int:record_id>", methods=["DELETE"])
@require_auth
def journal_stock_delete(record_id):
    rec = JournalStock.query.get_or_404(record_id)
    db.session.delete(rec)
    db.session.commit()
    return jsonify({"deleted": True})


# ---------------------------------------------------------------------------
# Stock > J/K/L — Closing Stock (computed live, never stored — brief 4.4)
# ---------------------------------------------------------------------------
@app.route("/api/stock/closing-premises")
@require_auth
def closing_stock_premises():
    vehicles = Vehicle.query.filter_by(stage="Manufacturing").order_by(Vehicle.model_name, Vehicle.colour).all()
    summary = {}
    for v in vehicles:
        key = f"{v.model_name or '—'}::{v.colour or '—'}"
        summary[key] = summary.get(key, 0) + 1
    return jsonify({"vehicles": [ser_vehicle(v) for v in vehicles],
                     "summary": [{"model_name": k.split("::")[0], "colour": k.split("::")[1], "qty": v}
                                 for k, v in summary.items()]})


@app.route("/api/stock/closing-dealers")
@require_auth
def closing_stock_dealers():
    vehicles = _scope_vehicle_query(Vehicle.query.filter_by(stage="Delivery Challan")).order_by(Vehicle.dealer_name, Vehicle.model_name).all()
    summary = {}
    for v in vehicles:
        key = f"{v.dealer_name or '—'}::{v.model_name or '—'}"
        summary[key] = summary.get(key, 0) + 1
    return jsonify({"vehicles": [ser_vehicle(v) for v in vehicles],
                     "summary": [{"dealer_name": k.split("::")[0], "model_name": k.split("::")[1], "qty": v}
                                 for k, v in summary.items()]})


@app.route("/api/stock/closing-raw")
@require_auth
def closing_stock_raw():
    from_date, to_date = _date_bounds()

    def stock_totals(before=None, start=None, end=None):
        purchased = {}
        consumed = {}
        journal_in = {}
        journal_out = {}

        q = db.session.query(db.func.trim(PurchaseBillItem.item_name), db.func.sum(PurchaseBillItem.qty))\
            .join(PurchaseBill, PurchaseBillItem.bill_id == PurchaseBill.id)
        if before:
            q = q.filter(PurchaseBill.date < before)
        else:
            q = q.filter(*_date_filter(PurchaseBill.date, start, end))
        for name, qty in q.group_by(db.func.trim(PurchaseBillItem.item_name)).all():
            purchased[name] = float(qty or 0)

        q = db.session.query(db.func.trim(ProductionVoucherItem.item_name), db.func.sum(ProductionVoucherItem.qty))\
            .join(ProductionVoucher, ProductionVoucherItem.voucher_id == ProductionVoucher.id)
        if before:
            q = q.filter(ProductionVoucher.date < before)
        else:
            q = q.filter(*_date_filter(ProductionVoucher.date, start, end))
        for name, qty in q.group_by(db.func.trim(ProductionVoucherItem.item_name)).all():
            consumed[name] = float(qty or 0)

        q = db.session.query(db.func.trim(JournalStock.item_name),
                             db.func.sum(db.case((JournalStock.qty >= 0, JournalStock.qty), else_=0)),
                             db.func.sum(db.case((JournalStock.qty < 0, -JournalStock.qty), else_=0)))\
            .filter(JournalStock.item_type == "R")
        if before:
            q = q.filter(JournalStock.date < before)
        else:
            q = q.filter(*_date_filter(JournalStock.date, start, end))
        for name, added, removed in q.group_by(db.func.trim(JournalStock.item_name)).all():
            journal_in[name] = float(added or 0)
            journal_out[name] = float(removed or 0)

        return purchased, consumed, journal_in, journal_out

    opening_p, opening_c, opening_ji, opening_jo = stock_totals(before=from_date) if from_date else ({},{},{},{})
    period_p, period_c, period_ji, period_jo = stock_totals(start=from_date, end=to_date)

    names = set(opening_p) | set(opening_c) | set(opening_ji) | set(opening_jo) | set(period_p) | set(period_c) | set(period_ji) | set(period_jo)
    hsn_rows = db.session.query(db.func.trim(PurchaseBillItem.item_name), db.func.max(PurchaseBillItem.hsn_code))\
        .join(PurchaseBill, PurchaseBillItem.bill_id == PurchaseBill.id).group_by(db.func.trim(PurchaseBillItem.item_name)).all()
    hsn = {name: code for name, code in hsn_rows}

    rows = []
    for name in sorted(names):
        opening = (opening_p.get(name,0) + opening_ji.get(name,0)
                   - opening_c.get(name,0) - opening_jo.get(name,0))
        purchased = period_p.get(name,0) + period_ji.get(name,0)
        consumed = period_c.get(name,0) + period_jo.get(name,0)
        rows.append({
            "name": name, "hsn": hsn.get(name),
            "opening": round(opening, 2),
            "purchased": round(purchased, 2),
            "consumed": round(consumed, 2),
            "closing": round(opening + purchased - consumed, 2),
        })
    return jsonify(rows)

@app.route("/api/stock/ledger-raw")
@require_auth
def stock_ledger_raw():
    item_name = request.args.get("item_name", "").strip()
    if not item_name:
        return jsonify({"error": "item_name is required"}), 400
    from_date, to_date = _date_bounds()
    events = []

    def add_rows(before=False):
        purchase_q = db.session.query(PurchaseBillItem.qty, PurchaseBill.date, PurchaseBill.bill_no, PurchaseBill.party_name)\
            .join(PurchaseBill, PurchaseBillItem.bill_id == PurchaseBill.id)\
            .filter(db.func.trim(PurchaseBillItem.item_name) == item_name)
        production_q = db.session.query(ProductionVoucherItem.qty, ProductionVoucher.date, ProductionVoucher.vou_no,
                                        ProductionVoucher.chassis_no, ProductionVoucher.product_name)\
            .join(ProductionVoucher, ProductionVoucherItem.voucher_id == ProductionVoucher.id)\
            .filter(db.func.trim(ProductionVoucherItem.item_name) == item_name)
        journal_q = JournalStock.query.filter(JournalStock.item_type == "R",
                                                db.func.trim(JournalStock.item_name) == item_name)
        if before:
            if from_date:
                purchase_q = purchase_q.filter(PurchaseBill.date < from_date)
                production_q = production_q.filter(ProductionVoucher.date < from_date)
                journal_q = journal_q.filter(JournalStock.date < from_date)
            else:
                return
        else:
            purchase_q = purchase_q.filter(*_date_filter(PurchaseBill.date, from_date, to_date))
            production_q = production_q.filter(*_date_filter(ProductionVoucher.date, from_date, to_date))
            journal_q = journal_q.filter(*_date_filter(JournalStock.date, from_date, to_date))
        return purchase_q.all(), production_q.all(), journal_q.all()

    opening = 0.0
    if from_date:
        p, prod, j = add_rows(before=True)
        opening += sum(float(x[0] or 0) for x in p)
        opening -= sum(float(x[0] or 0) for x in prod)
        opening += sum(float(x.qty or 0) for x in j)

    p, prod, j = add_rows(before=False)
    for qty, d, bill_no, party_name in p:
        events.append({"date": _iso(d), "type":"IN", "doc_no":bill_no, "party_name":party_name,
                        "particulars":f"Purchase Bill — {item_name}", "qty":qty or 0, "_sort":d or date.min})
    for qty, d, vou_no, chassis_no, product_name in prod:
        events.append({"date": _iso(d), "type":"OUT", "doc_no":vou_no, "party_name":chassis_no,
                        "particulars":f"Production — {product_name}", "qty":qty or 0, "_sort":d or date.min})
    for j in j:
        events.append({"date":_iso(j.date), "type":"IN" if j.qty >= 0 else "OUT", "doc_no":j.vou_no,
                        "party_name":"","particulars":j.reason or "Journal Stock adjustment",
                        "qty":abs(j.qty or 0), "_sort":j.date or date.min})
    events.sort(key=lambda e:e["_sort"])
    balance = opening
    for e in events:
        balance += e["qty"] if e["type"]=="IN" else -e["qty"]
        e["balance"] = round(balance,2)
        del e["_sort"]
    return jsonify({"opening_balance": round(opening,2), "events": events})

@app.route("/api/stock/ledger-premises")
@require_auth
def stock_ledger_premises():
    from_date, to_date = _date_bounds()
    events = []
    opening = 0
    if from_date:
        opening += sum((r[0] or 1) for r in db.session.query(ProductionVoucher.quantity).filter(ProductionVoucher.date < from_date).all())
        opening -= sum(1 for r in db.session.query(DeliveryChallan.id).filter(DeliveryChallan.date < from_date, DeliveryChallan.cancelled.is_(False)).all())

    pv_rows = db.session.query(ProductionVoucher.date, ProductionVoucher.vou_no, ProductionVoucher.chassis_no,
                               ProductionVoucher.product_name, ProductionVoucher.quantity)\
        .filter(*_date_filter(ProductionVoucher.date, from_date, to_date)).all()
    for d, vou_no, chassis_no, product_name, qty in pv_rows:
        events.append({"date":_iso(d),"type":"IN","doc_no":vou_no,"chassis_no":chassis_no,
                       "particulars":f"Production — {product_name}","qty":qty or 1,"_sort":d or date.min})
    dc_rows = db.session.query(DeliveryChallan.date, DeliveryChallan.challan_no, DeliveryChallan.chassis_no, Dealer.name)\
        .outerjoin(Dealer, DeliveryChallan.dealer_id == Dealer.id)\
        .filter(DeliveryChallan.cancelled.is_(False), *_date_filter(DeliveryChallan.date, from_date, to_date)).all()
    for d, challan_no, chassis_no, dealer_name in dc_rows:
        events.append({"date":_iso(d),"type":"OUT","doc_no":challan_no,"chassis_no":chassis_no,
                       "particulars":f"Delivery Challan to {dealer_name or ''}","qty":1,"_sort":d or date.min})
    events.sort(key=lambda e:e["_sort"])
    balance=opening
    for e in events:
        balance += e["qty"] if e["type"]=="IN" else -e["qty"]
        e["balance"]=balance; del e["_sort"]
    return jsonify({"opening_balance": opening, "events": events})

@app.route("/api/stock/ledger-dealers")
@require_auth
def stock_ledger_dealers():
    dealer_id = request.args.get("dealer_id", type=int)
    from_date, to_date = _date_bounds()
    events=[]
    dc_base = db.session.query(DeliveryChallan.date, DeliveryChallan.challan_no, DeliveryChallan.chassis_no,
                               DeliveryChallan.product_name, Dealer.name, DeliveryChallan.dealer_id)\
        .outerjoin(Dealer, DeliveryChallan.dealer_id == Dealer.id)\
        .filter(DeliveryChallan.cancelled.is_(False))
    ti_base = db.session.query(TaxInvoice.date, TaxInvoice.bill_no, TaxInvoice.chassis_no,
                               TaxInvoice.product_name, TaxInvoice.dealer_name, DeliveryChallan.dealer_id)\
        .outerjoin(DeliveryChallan, TaxInvoice.delivery_challan_id == DeliveryChallan.id)\
        .filter(TaxInvoice.cancelled.is_(False))
    if dealer_id:
        dc_base=dc_base.filter(DeliveryChallan.dealer_id==dealer_id)
        ti_base=ti_base.filter(DeliveryChallan.dealer_id==dealer_id)

    opening={}
    if from_date:
        for d, ch, chassis, product, dealer_name, did in dc_base.filter(DeliveryChallan.date < from_date).all():
            key=did or dealer_name or ""
            opening[key]=opening.get(key,0)+1
        for d, bill, chassis, product, dealer_name, did in ti_base.filter(TaxInvoice.date < from_date).all():
            key=did or dealer_name or ""
            opening[key]=opening.get(key,0)-1

    for d,ch,chassis,product,dealer_name,did in dc_base.filter(*_date_filter(DeliveryChallan.date,from_date,to_date)).all():
        events.append({"date":_iso(d),"type":"IN","doc_no":ch,"chassis_no":chassis,"dealer_name":dealer_name or "",
                       "particulars":f"Delivery Challan — {product}","qty":1,"_key":did or dealer_name or "","_sort":d or date.min})
    for d,bill,chassis,product,dealer_name,did in ti_base.filter(*_date_filter(TaxInvoice.date,from_date,to_date)).all():
        events.append({"date":_iso(d),"type":"OUT","doc_no":bill,"chassis_no":chassis,"dealer_name":dealer_name or "",
                       "particulars":f"Tax Invoice — {product}","qty":1,"_key":did or dealer_name or "","_sort":d or date.min})
    events.sort(key=lambda e:e["_sort"])
    running=dict(opening)
    for e in events:
        key=e.pop("_key")
        running[key]=running.get(key,0)+(e["qty"] if e["type"]=="IN" else -e["qty"])
        e["balance"]=running[key]; del e["_sort"]
    return jsonify({"opening_balances": opening, "events": events})

@app.route("/api/reports/purchase-register")
@require_auth
def purchase_register():
    from_date, to_date = _date_bounds()
    search = request.args.get("search", "").strip()
    rows = []
    purchase_query = PurchaseBill.query.filter(*_date_filter(PurchaseBill.date, from_date, to_date)).order_by(PurchaseBill.date)
    for b in purchase_query.all():
        if not _matches(search, b.party_name, b.bill_no):
            continue
        for it in b.items:
            rows.append({"date": _iso(b.date), "bill_no": b.bill_no or ".", "party_name": b.party_name,
                         "item_name": it.item_name, "hsn": it.hsn_code, "taxable_amt": it.taxable_amt,
                         "gst_rate": it.gst_rate, "is_inter_state": it.is_inter_state,
                         "cgst_amt": it.cgst_amt, "sgst_amt": it.sgst_amt, "igst_amt": it.igst_amt})
    if request.args.get("export") == "csv":
        headers = ["Date", "Bill No.", "Party Name", "Item Name", "HSN", "Taxable Amt", "CGST Amt", "SGST Amt", "IGST Amt"]
        return _csv_response("Purchase_Register.csv", headers,
                              [[r["date"], r["bill_no"], r["party_name"], r["item_name"], r["hsn"] or "",
                                r["taxable_amt"], r["cgst_amt"], r["sgst_amt"], r["igst_amt"]] for r in rows])
    totals = {"taxable": round(sum(r["taxable_amt"] for r in rows), 2),
              "cgst": round(sum(r["cgst_amt"] for r in rows), 2),
              "sgst": round(sum(r["sgst_amt"] for r in rows), 2),
              "igst": round(sum(r["igst_amt"] for r in rows), 2)}
    return jsonify({"rows": rows, "totals": totals})


@app.route("/api/reports/production-register")
@require_auth
def production_register():
    from_date, to_date = _date_bounds()
    search = request.args.get("search", "").strip()
    vouchers = [v for v in ProductionVoucher.query.filter(*_date_filter(ProductionVoucher.date, from_date, to_date)).order_by(ProductionVoucher.date).all()
                if _matches(search, v.product_name, v.chassis_no)]
    if request.args.get("export") == "csv":
        headers = ["Date", "Vou. No.", "Product Name", "Quantity", "Chassis No.", "Motor No.", "Controller No."]
        return _csv_response("Production_Register.csv", headers,
                              [[_iso(v.date), v.vou_no, v.product_name, v.quantity, v.chassis_no,
                                v.motor_no, v.controller_no] for v in vouchers])
    return jsonify([ser_pv(v) for v in vouchers])


@app.route("/api/reports/delivery-challan-register")
@require_auth
def delivery_challan_register():
    # Was loading ALL delivery challans (17k+) with .all() and filtering
    # dates in Python, then triggering a lazy .dealer load per row (up to
    # ~17k extra queries the first time each challan's dealer is touched)
    # via ser_dc()/the search filter/the CSV export. joinedload() fetches
    # dealer in the same query (one JOIN, no N+1), and the date range is
    # now a SQL WHERE clause instead of a Python filter after loading
    # everything.
    from_date, to_date = _date_bounds()
    search = request.args.get("search", "").strip()
    status = request.args.get("status", "all")
    challans = [c for c in DeliveryChallan.query.options(joinedload(DeliveryChallan.dealer))
                .filter(*_date_filter(DeliveryChallan.date, from_date, to_date))
                .order_by(DeliveryChallan.date).all()
                if _matches(search, c.dealer.name if c.dealer else None, c.chassis_no, c.challan_no)]
    invoiced = {
        row.delivery_challan_id: (row.bill_no, row.sale_amount)
        for row in db.session.query(TaxInvoice.delivery_challan_id, TaxInvoice.bill_no, TaxInvoice.sale_amount)
        .filter(TaxInvoice.delivery_challan_id.isnot(None)).all()
    }
    invoiced_bill_no = {cid: bill_no for cid, (bill_no, _amt) in invoiced.items()}
    # "Item Amount" is only meaningful once a challan has actually been
    # billed — it's the Sale Amount entered on that Tax Invoice, not the
    # Delivery Challan's own (separate, earlier) estimated Sale Value.
    item_amount_by_challan = {cid: amt for cid, (_bn, amt) in invoiced.items()}
    bill_no_by_challan = {c.id: (invoiced_bill_no.get(c.id) or c.sale_bill_no or None) for c in challans}
    if status == "sold":
        challans = [c for c in challans if bill_no_by_challan.get(c.id)]
    elif status == "unsold":
        challans = [c for c in challans if not bill_no_by_challan.get(c.id)]
    if request.args.get("export") == "csv":
        headers = ["Date", "Challan No.", "Party Name", "Item Amount", "Chassis No.", "Colour",
                   "Other", "Sale Bill No.", "Sale Value", "Salesman", "Battery Make",
                   "Remarks (1)", "Remarks (2)"]
        return _csv_response("Delivery_Challan_Register.csv", headers,
                              [[_iso(c.date), c.challan_no, c.dealer.name if c.dealer else "",
                                item_amount_by_challan.get(c.id) or 0,
                                c.chassis_no, c.colour, c.other, bill_no_by_challan.get(c.id) or "",
                                c.sale_value or 0, c.salesman, c.battery_maker,
                                c.remarks1, c.remarks2] for c in challans])
    out = []
    for c in challans:
        row = ser_dc(c)
        row["bill_no"] = bill_no_by_challan.get(c.id)
        row["item_amount"] = item_amount_by_challan.get(c.id)
        out.append(row)
    return jsonify(out)


@app.route("/api/reports/sale-register")
@require_auth
def sale_register():
    from_date, to_date = _date_bounds()
    search = request.args.get("search", "").strip()
    invoices = [i for i in TaxInvoice.query.filter(*_date_filter(TaxInvoice.date, from_date, to_date)).order_by(TaxInvoice.date).all()
                if _matches(search, i.buyer_name, i.dealer_name, i.product_name, i.chassis_no, i.bill_no)]
    if request.args.get("export") == "csv":
        headers = ["Date", "Bill No.", "Buyer Name", "Product Name", "Chassis No.", "Taxable Value",
                   "Tax Amount", "Insurance", "Registration", "Bill Total"]
        return _csv_response("Sale_Register.csv", headers,
                              [[_iso(i.date), i.bill_no, i.buyer_name, i.product_name, i.chassis_no,
                                i.taxable_value, i.tax_amount, i.insurance_amount or 0,
                                i.registration_amount or 0, i.bill_total] for i in invoices])
    totals = {"taxable": round(sum(i.taxable_value for i in invoices), 2),
              "tax": round(sum(i.tax_amount for i in invoices), 2),
              "insurance": round(sum(i.insurance_amount or 0 for i in invoices), 2),
              "registration": round(sum(i.registration_amount or 0 for i in invoices), 2),
              "total": round(sum(i.bill_total for i in invoices), 2)}
    return jsonify({"invoices": [ser_ti(i) for i in invoices], "totals": totals})


@app.route("/api/reports/gst-register")
@require_auth
def gst_register():
    from_date, to_date = _date_bounds()
    search = request.args.get("search", "").strip()
    outward = [i for i in TaxInvoice.query.filter(TaxInvoice.cancelled.is_(False), *_date_filter(TaxInvoice.date, from_date, to_date)).order_by(TaxInvoice.date).all()
               if _matches(search, i.buyer_name, i.bill_no)]
    inward = []
    for b in PurchaseBill.query.filter(*_date_filter(PurchaseBill.date, from_date, to_date)).order_by(PurchaseBill.date).all():
        if not _matches(search, b.party_name, b.bill_no):
            continue
        for it in b.items:
            inward.append({"date": _iso(b.date), "doc_no": b.bill_no or ".", "party_name": b.party_name,
                           "taxable": it.taxable_amt, "cgst": it.cgst_amt, "sgst": it.sgst_amt, "igst": it.igst_amt})
    if request.args.get("export") == "csv":
        headers = ["Direction", "Date", "Bill No.", "Party Name", "Taxable Value", "CGST", "SGST", "IGST"]
        rows = [["Outward", _iso(i.date), i.bill_no, i.buyer_name, i.taxable_value,
                 i.cgst_amount, i.sgst_amount, i.igst_amount] for i in outward]
        rows += [["Inward", r["date"], r["doc_no"], r["party_name"], r["taxable"],
                 r["cgst"], r["sgst"], r["igst"]] for r in inward]
        return _csv_response("GST_Register.csv", headers, rows)
    outward_totals = {"taxable": round(sum(i.taxable_value for i in outward), 2),
                       "cgst": round(sum(i.cgst_amount for i in outward), 2),
                       "sgst": round(sum(i.sgst_amount for i in outward), 2),
                       "igst": round(sum(i.igst_amount for i in outward), 2)}
    inward_totals = {"taxable": round(sum(r["taxable"] for r in inward), 2),
                      "cgst": round(sum(r["cgst"] for r in inward), 2),
                      "sgst": round(sum(r["sgst"] for r in inward), 2),
                      "igst": round(sum(r["igst"] for r in inward), 2)}
    return jsonify({"outward": [ser_ti(i) for i in outward], "inward": inward,
                     "outward_totals": outward_totals, "inward_totals": inward_totals})


@app.route("/api/reports/hypothecation-register")
@require_auth
def hypothecation_register():
    from_date, to_date = _date_bounds()
    search = request.args.get("search", "").strip()
    invoices = [i for i in TaxInvoice.query.filter(TaxInvoice.financer_name.isnot(None),
                                                     TaxInvoice.financer_name != "",
                                                     *_date_filter(TaxInvoice.date, from_date, to_date)).order_by(TaxInvoice.date).all()
                if _matches(search, i.buyer_name, i.financer_name, i.bill_no)]
    if request.args.get("export") == "csv":
        headers = ["Date", "Bill No.", "Buyer Name", "Chassis No.", "Financer Name", "Hypothecation Amount"]
        return _csv_response("Hypothecation_Register.csv", headers,
                              [[_iso(i.date), i.bill_no, i.buyer_name, i.chassis_no, i.financer_name,
                                i.hypothecation_amount or 0] for i in invoices])
    total_hyp = round(sum(i.hypothecation_amount or 0 for i in invoices), 2)
    return jsonify({"invoices": [ser_ti(i) for i in invoices], "total_hyp": total_hyp})


@app.route("/api/reports/payment-receivable")
@require_auth
def payment_receivable_report():
    """Redesigned to match the original desktop app's report exactly:
    same columns (Dealer, Model, Chassis, Other, Customer, Mobile,
    Value/Loan/Recd/Balance, Financer, RTO, Chassis Record, Ledger,
    Voucher No., Cheque No., Vehicle No., Salesman) and the same balance
    formula (Value Amt − Loan Amt − Amt. Recd., using the ex-GST
    sale_amount, NOT the GST-inclusive bill_total that the invoice list's
    balance_due uses). Paginated -- this table has 16k+ rows in
    production, same crash risk as delivery-challans/production-vouchers
    had before those were paginated.
    """
    from_date, to_date = _date_bounds()
    search = (request.args.get("search") or "").strip()
    show_all = request.args.get("show_all") == "1"
    page = max(1, _i(request.args.get("page"), 1))
    per_page = min(200, max(1, _i(request.args.get("per_page"), 50)))

    # sale_amount, hypothecation_amount, amount_received are real columns,
    # so the balance can be computed and filtered/summed in SQL directly
    # instead of pulling every row into Python first.
    balance_expr = (db.func.coalesce(TaxInvoice.sale_amount, 0)
                     - db.func.coalesce(TaxInvoice.hypothecation_amount, 0)
                     - db.func.coalesce(TaxInvoice.amount_received, 0))

    base = (db.session.query(TaxInvoice, DeliveryChallan.salesman)
            .outerjoin(DeliveryChallan, TaxInvoice.delivery_challan_id == DeliveryChallan.id)
            .filter(TaxInvoice.cancelled.is_(False)))
    if from_date:
        base = base.filter(TaxInvoice.date >= from_date)
    if to_date:
        base = base.filter(TaxInvoice.date <= to_date)
    if search:
        like = f"%{search}%"
        base = base.filter(db.or_(TaxInvoice.dealer_name.ilike(like),
                                   TaxInvoice.buyer_name.ilike(like),
                                   TaxInvoice.bill_no.ilike(like)))
    if not show_all:
        base = base.filter(balance_expr > 0)

    def _row_dict(ti, salesman):
        balance = round((ti.sale_amount or 0) - (ti.hypothecation_amount or 0) - (ti.amount_received or 0), 2)
        return {"id": ti.id, "date": _iso(ti.date), "dealer_name": ti.dealer_name, "bill_no": ti.bill_no,
                "model": ti.product_name, "chassis_no": ti.chassis_no, "other": ti.other_desc,
                "customer": ti.buyer_name, "mobile_no": ti.buyer_mobile,
                "value_amt": ti.sale_amount or 0, "loan_amt": ti.hypothecation_amount or 0,
                "amt_recd": ti.amount_received or 0, "balance": balance,
                "financer": ti.financer_name, "rto": ti.rto_name,
                "chassis_record": ti.chassis_record_no, "ledger": ti.ledger_no,
                "voucher_no": ti.voucher_no, "cheque_no": ti.cancelled_cheque_no,
                "vehicle_no": ti.vehicle_reg_no, "salesman": salesman}

    if request.args.get("export") == "csv":
        rows = base.order_by(TaxInvoice.date.desc(), TaxInvoice.id.desc()).all()
        headers = ["Date", "Dealer Name", "Bill No.", "Model", "Chassis No.", "Other", "Customer",
                   "Mobile No.", "Value Amt.", "Loan Amt.", "Amt. Recd.", "Balance", "Financer", "RTO",
                   "Chassis Record", "Ledger", "Voucher No.", "Cheque No.", "Vehicle No.", "Salesman"]
        out_rows = [[d["date"], d["dealer_name"], d["bill_no"], d["model"], d["chassis_no"], d["other"],
                     d["customer"], d["mobile_no"], d["value_amt"], d["loan_amt"], d["amt_recd"],
                     d["balance"], d["financer"], d["rto"], d["chassis_record"], d["ledger"],
                     d["voucher_no"], d["cheque_no"], d["vehicle_no"], d["salesman"]]
                    for d in (_row_dict(ti, sm) for ti, sm in rows)]
        return _csv_response("Payment_Receivable_Report.csv", headers, out_rows)

    total = base.count()
    page_rows = (base.order_by(TaxInvoice.date.desc(), TaxInvoice.id.desc())
                 .offset((page - 1) * per_page).limit(per_page).all())
    out = [_row_dict(ti, sm) for ti, sm in page_rows]

    value_sum, loan_sum, recd_sum, balance_sum = base.with_entities(
        db.func.coalesce(db.func.sum(TaxInvoice.sale_amount), 0),
        db.func.coalesce(db.func.sum(TaxInvoice.hypothecation_amount), 0),
        db.func.coalesce(db.func.sum(TaxInvoice.amount_received), 0),
        db.func.coalesce(db.func.sum(balance_expr), 0),
    ).one()
    totals = {"value": round(value_sum, 2), "loan": round(loan_sum, 2),
              "received": round(recd_sum, 2), "balance": round(balance_sum, 2)}

    return jsonify({"rows": out, "total": total, "page": page, "per_page": per_page,
                     "total_pages": (total + per_page - 1) // per_page if total else 1,
                     "totals": totals})


@app.route("/api/reports/subsidy")
@require_auth
def subsidy_report():
    from_date, to_date = _date_bounds()
    search = request.args.get("search", "").strip()
    invoices = [i for i in TaxInvoice.query.filter(TaxInvoice.subsidy_amount > 0, *_date_filter(TaxInvoice.date, from_date, to_date)).order_by(TaxInvoice.date).all()
                if _matches(search, i.buyer_name, i.bill_no)]
    if request.args.get("export") == "csv":
        headers = ["Date", "Bill No.", "Buyer Name", "Chassis No.", "Subsidy Amount"]
        return _csv_response("Subsidy_Report.csv", headers,
                              [[_iso(i.date), i.bill_no, i.buyer_name, i.chassis_no, i.subsidy_amount or 0]
                               for i in invoices])
    total_subsidy = round(sum(i.subsidy_amount or 0 for i in invoices), 2)
    return jsonify({"invoices": [ser_ti(i) for i in invoices], "total_subsidy": total_subsidy})


def _ledger_balances_summary(dealers_, from_date, to_date):
    """Every dealer's closing balance, for the balances-sorted summary list.
    Computed in one pass over TaxInvoice/DayBook instead of once per dealer
    (the previous version re-ran a full DayBook.query.all() for every single
    dealer, which made the summary hang/time out once there were more than
    a handful of dealers and a large Day Book)."""
    balances = {d.id: 0.0 for d in dealers_}

    inv_rows = (
        db.session.query(DeliveryChallan.dealer_id, TaxInvoice)
        .select_from(TaxInvoice)
        .outerjoin(DeliveryChallan, TaxInvoice.delivery_challan_id == DeliveryChallan.id)
        .filter(TaxInvoice.cancelled.is_(False), *_date_filter(TaxInvoice.date, from_date, to_date))
        .all()
    )
    name_to_id = {_norm_name(d.name): d.id for d in dealers_ if d.name}
    for dealer_id, ti in inv_rows:
        if dealer_id not in balances:
            dealer_id = name_to_id.get(_norm_name(ti.dealer_name or ''))
        if dealer_id not in balances:
            continue
        # Net of hypothecation (the financer's portion isn't the dealer's
        # liability) -- matches the Balance shown on the Tax Invoice +
        # Ledger's Edit Sale modal. No credit contribution from
        # hypothecation or Amount Received here: crediting only happens
        # via a manually-created Day Book voucher (picked up below), and
        # Amount Received is tracked separately in Ledger V.
        net_debit = (ti.sale_amount or 0) - (ti.hypothecation_amount or 0)
        balances[dealer_id] -= net_debit

    for vr_no, dealer_name, credit_received, debit_paid, d in \
            db.session.query(DayBook.vr_no, DayBook.dealer_name, DayBook.credit_received,
                              DayBook.debit_paid, DayBook.date)
            .filter(*_date_filter(DayBook.date, from_date, to_date)).all():
        dealer_id = name_to_id.get(_norm_name(dealer_name))
        if dealer_id is None:
            continue
        balances[dealer_id] += (credit_received or 0) - (debit_paid or 0)

    summary = []
    for d in dealers_:
        b = balances.get(d.id, 0.0)
        summary.append({"dealer_id": d.id, "dealer_name": d.name,
                         "balance": round(abs(b), 2), "dc": "Cr" if b >= 0 else "Dr"})
    summary.sort(key=lambda s: -s["balance"])
    return summary


def _ledger_events_for_dealer(dealer, from_date, to_date):
    """Build the running-balance event list for one dealer: sale invoices,
    debited net of hypothecation (the financer's portion isn't the
    dealer's liability), plus Day Book receipts/payments matched by name.
    Amount Received plays no part here -- see Ledger V for that. Shared
    by the single-dealer ledger view, the all-dealers balance summary,
    and CSV export so all three stay in sync."""
    events = []
    # Do not require a Delivery Challan link. Older/imported Tax Invoices can
    # still contain the dealer name snapshot even when the DC relation is
    # missing; those invoices must remain visible in Ledger.
    query = (TaxInvoice.query
        .outerjoin(DeliveryChallan, TaxInvoice.delivery_challan_id == DeliveryChallan.id)
        .filter(TaxInvoice.cancelled.is_(False))
        .filter(db.or_(DeliveryChallan.dealer_id == dealer.id,
                       db.func.lower(db.func.trim(TaxInvoice.dealer_name)) ==
                       db.func.lower(db.func.trim(dealer.name or ''))))
        .filter(*_date_filter(TaxInvoice.date, from_date, to_date)))
    for ti in query.all():
        # Debit is Sale Amount NET of Hypothecation (the financer pays the
        # hypothecated portion directly, so it's not part of what the
        # dealer owes from their own ledger) -- NOT the full Sale Amount,
        # and NOT bill_total (bill_total is the GST-taxable figure and
        # belongs on the Tax Invoice/GST Register, not here).
        #
        # No automatic Credit line is generated for hypothecation or for
        # Amount Received: crediting the dealer's ledger only happens via
        # a manually-created Day Book voucher ("used X rupees from his
        # ledger for this bill on this date") -- that's what the DayBook
        # loop below already picks up. Amount Received is tracked
        # separately in Ledger V, not here.
        net_debit = (ti.sale_amount or 0) - (ti.hypothecation_amount or 0)
        # A hypothecation can occasionally be higher than the internal sale
        # amount. In that case the dealer has a CREDIT (the excess financed
        # amount), not a negative Debit. Keep the sale event visible and put
        # the positive excess in the Credit column.
        sale_debit = max(net_debit, 0)
        loan_excess_credit = max(-net_debit, 0)
        # Always show BOTH source amounts in the Ledger particulars, even
        # when either one is zero/NIL. Amount Received is deliberately not
        # included here; it belongs only to Ledger V.
        lines = [ti.product_name, ti.chassis_no,
                 f"Sale ₹{(ti.sale_amount or 0):,.2f}",
                 f"Loan ₹{(ti.hypothecation_amount or 0):,.2f}"]
        if ti.hypothecation_amount and ti.financer_name:
            lines[-1] += f" — {ti.financer_name}"
        if loan_excess_credit:
            lines.append(f"Loan exceeds Sale by ₹{loan_excess_credit:,.2f}")
        events.append({"date": ti.date, "vr_type": "S", "doc_no": f"BILL NO.{ti.bill_no}",
                        "account": "SALE", "debit": sale_debit, "credit": loan_excess_credit,
                        "lines": lines,
                        "record_type": "sale", "record_id": ti.id})
    if dealer.name:
        # Match dealer name robustly: DayBook.dealer_name is free-text, so it can
        # differ from Dealer.name by leading/trailing spaces, doubled internal
        # spaces, or case — any of which would silently drop the receipt/payment
        # from the ledger under a plain SQL equality check. Normalize both sides
        # (collapse all whitespace runs to a single space, then lowercase) before
        # comparing, so entries aren't lost to formatting differences.
        target_name = _norm_name(dealer.name)
        for row in DayBook.query.filter(*_date_filter(DayBook.date, from_date, to_date)).all():
            if _norm_name(row.dealer_name) != target_name:
                continue
            events.append({"date": row.date, "vr_type": "C", "doc_no": "", "account": "CASH",
                            "debit": row.debit_paid or 0, "credit": row.credit_received or 0,
                            "lines": [row.narration] if row.narration else [],
                            "record_type": "receipt", "record_id": row.id})
    events.sort(key=lambda e: (e["date"] or date.min))
    balance = 0
    for e in events:
        balance += e["credit"] - e["debit"]
        e["balance"] = round(abs(balance), 2)
        e["dc"] = "Cr" if balance >= 0 else "Dr"
        e["date"] = _iso(e["date"])
    return events, balance


@app.route("/api/dealer/ledger")
@require_dealer_auth
def dealer_ledger():
    """Dealer portal ledger: only the currently authenticated dealer's statement."""
    dealer = Dealer.query.get(getattr(g, "current_dealer_id", None))
    if not dealer:
        return _err("Dealer not found.", 404)
    from_date, to_date = _date_bounds()
    events, balance = _ledger_events_for_dealer(dealer, from_date, to_date)
    search = request.args.get("search", "").strip()
    if search:
        events = [e for e in events if _matches(search, e["account"], e["doc_no"], *(e.get("lines") or []))]
    return jsonify({
        "dealer": ser_dealer(dealer),
        "from": _iso(from_date) if from_date else None,
        "to": _iso(to_date) if to_date else None,
        "events": events,
        "closing_balance": round(abs(balance), 2),
        "dc": "Cr" if balance >= 0 else "Dr",
    })


@app.route("/api/reports/ledger")
@require_auth
def ledger():
    """W. Ledger — Account Statement (dealer running balance). Day Book
    Entry has its own endpoints below (was nested here in the original).

    With no dealer_id: returns every dealer's closing balance, sorted by
    balance (largest first), for the "who owes/who's owed the most" summary
    list. With a dealer_id: returns that dealer's full transaction history,
    optionally filtered by a `search` term over the particulars/narration
    text, and can be exported as CSV via `export=csv`."""
    dealer_id = request.args.get("dealer_id", type=int)
    from_date, to_date = _date_bounds()
    dealers_ = Dealer.query.order_by(Dealer.name).all()

    if not dealer_id:
        summary = _ledger_balances_summary(dealers_, from_date, to_date)
        if request.args.get("export") == "csv":
            return _csv_response("Ledger_Summary.csv", ["Dealer", "Balance", "Dr/Cr"],
                                  [[s["dealer_name"], s["balance"], s["dc"]] for s in summary])
        return jsonify({"dealers": [ser_dealer(d) for d in dealers_], "selected_dealer_id": None,
                         "summary": summary})

    selected_dealer = Dealer.query.get(dealer_id)
    events = []
    if selected_dealer:
        events, _balance = _ledger_events_for_dealer(selected_dealer, from_date, to_date)
    search = request.args.get("search", "").strip()
    if search:
        events = [e for e in events if _matches(search, e["account"], e["doc_no"], *(e.get("lines") or []))]
    if request.args.get("export") == "csv":
        headers = ["Date", "Type", "Doc No.", "Account", "Particulars", "Debit", "Credit", "Balance", "Dr/Cr"]
        rows = [[e["date"], e["vr_type"], e["doc_no"], e["account"], ", ".join(e.get("lines") or []),
                 e["debit"] or 0, e["credit"] or 0, e["balance"], e["dc"]] for e in events]
        fname = f"Ledger_{(selected_dealer.name if selected_dealer else 'Dealer').replace(' ', '_')}.csv"
        return _csv_response(fname, headers, rows)
    return jsonify({"dealers": [ser_dealer(d) for d in dealers_], "selected_dealer_id": dealer_id,
                     "events": events})


def _ledger_v_summary(dealers_, from_date, to_date):
    """Every dealer's running total for Ledger V, computed in one pass over
    TaxInvoice/DayBook (same reasoning as _ledger_balances_summary above —
    avoids one query per dealer)."""
    totals = {d.id: 0.0 for d in dealers_}

    inv_rows = (
        db.session.query(DeliveryChallan.dealer_id, TaxInvoice.date, TaxInvoice.amount_received)
        .join(TaxInvoice, TaxInvoice.delivery_challan_id == DeliveryChallan.id)
        .filter(TaxInvoice.cancelled.is_(False), *_date_filter(TaxInvoice.date, from_date, to_date))
        .all()
    )
    for dealer_id, ti_date, amount_received in inv_rows:
        if dealer_id not in totals:
            continue
        totals[dealer_id] += amount_received or 0

    name_to_id = {}
    for d in dealers_:
        if d.name:
            name_to_id.setdefault(_norm_name(d.name), d.id)
    for dealer_name, credit_received, d in \
            db.session.query(DayBook.dealer_name, DayBook.credit_received, DayBook.date)
            .filter(*_date_filter(DayBook.date, from_date, to_date)).all():
        dealer_id = name_to_id.get(_norm_name(dealer_name))
        if dealer_id is None:
            continue
        totals[dealer_id] += credit_received or 0

    summary = [{"dealer_id": d.id, "dealer_name": d.name, "total": round(totals.get(d.id, 0.0), 2)}
               for d in dealers_]
    summary.sort(key=lambda s: -s["total"])
    return summary


def _ledger_v_events_for_dealer(dealer, from_date, to_date):
    """Ledger V — a reconciliation view, NOT the same balance as W. Ledger.
    W. Ledger debits each sale net of hypothecation (what the dealer owes
    from their own funds) and only credits it via manually-created Day
    Book vouchers. Ledger V only shows the two places a dealer's cash
    receipt gets recorded, side by side, so they can be checked against
    each other:
      - the Amount Received field entered directly on each Tax Invoice
        (with that invoice's Voucher No., Bill No., Chassis No. and
        Customer for reference), and
      - Day Book receipts (credit_received) matched to this dealer by name.
    Sale amounts and hypothecation are intentionally left out."""
    events = []
    # Do not require a Delivery Challan link. Older/imported Tax Invoices can
    # still contain the dealer name snapshot even when the DC relation is
    # missing; those invoices must remain visible in Ledger.
    query = (TaxInvoice.query
        .outerjoin(DeliveryChallan, TaxInvoice.delivery_challan_id == DeliveryChallan.id)
        .filter(TaxInvoice.cancelled.is_(False))
        .filter(db.or_(DeliveryChallan.dealer_id == dealer.id,
                       db.func.lower(db.func.trim(TaxInvoice.dealer_name)) ==
                       db.func.lower(db.func.trim(dealer.name or ''))))
        .filter(*_date_filter(TaxInvoice.date, from_date, to_date)))
    for ti in query.all():
        if ti.amount_received:
            # Particulars shows what was sold (product + chassis) rather than
            # repeating the buyer's name, which already has its own Customer
            # column — and Doc No. names the record type instead of repeating
            # the bill number, which already has its own Bill No. column.
            particulars = ", ".join(filter(None, [ti.product_name, ti.chassis_no])) or "Tax Invoice"
            events.append({"date": ti.date, "vr_type": "S", "doc_no": "Tax Invoice",
                            "particulars": particulars,
                            "receipt": 0, "amount_received": ti.amount_received,
                            "voucher_no": ti.voucher_no, "bill_no": ti.bill_no,
                            "chassis_no": ti.chassis_no, "customer": ti.buyer_name,
                            "record_type": "sale", "record_id": ti.id})
    if dealer.name:
        # Same normalized-name matching as W. Ledger, for the same reason:
        # DayBook.dealer_name is free text and can differ from Dealer.name by
        # spacing/case.
        target_name = _norm_name(dealer.name)
        for row in DayBook.query.filter(*_date_filter(DayBook.date, from_date, to_date)).all():
            if _norm_name(row.dealer_name) != target_name:
                continue
            if not row.credit_received:
                continue
            events.append({"date": row.date, "vr_type": "C", "doc_no": "Day Book Receipt",
                            "particulars": row.narration or "",
                            "receipt": row.credit_received or 0, "amount_received": 0,
                            "voucher_no": "", "bill_no": "", "chassis_no": "", "customer": "",
                            "record_type": "receipt", "record_id": row.id})
    events.sort(key=lambda e: (e["date"] or date.min))
    running = 0.0
    for e in events:
        running += (e["receipt"] or 0) + (e["amount_received"] or 0)
        e["balance"] = round(running, 2)
        e["date"] = _iso(e["date"])
    return events, running


@app.route("/api/reports/ledger-v")
@require_auth
def ledger_v():
    """Ledger V — reconciliation of Day Book receipts against the Amount
    Received field entered directly on Tax Invoices, per dealer. Mirrors
    W. Ledger's dealer-summary / dealer-detail / CSV-export shape (see
    /api/reports/ledger above) but with a different, narrower event set —
    see _ledger_v_events_for_dealer for what's included and why."""
    dealer_id = request.args.get("dealer_id", type=int)
    from_date, to_date = _date_bounds()
    dealers_ = Dealer.query.order_by(Dealer.name).all()

    if not dealer_id:
        summary = _ledger_v_summary(dealers_, from_date, to_date)
        if request.args.get("export") == "csv":
            return _csv_response("Ledger_V_Summary.csv", ["Dealer", "Total Received"],
                                  [[s["dealer_name"], s["total"]] for s in summary])
        return jsonify({"dealers": [ser_dealer(d) for d in dealers_], "selected_dealer_id": None,
                         "summary": summary})

    selected_dealer = Dealer.query.get(dealer_id)
    events = []
    if selected_dealer:
        events, _total = _ledger_v_events_for_dealer(selected_dealer, from_date, to_date)
    search = request.args.get("search", "").strip()
    if search:
        events = [e for e in events
                  if _matches(search, e["particulars"], e["doc_no"], e["voucher_no"],
                              e["bill_no"], e["chassis_no"], e["customer"])]
    if request.args.get("export") == "csv":
        headers = ["Date", "Type", "Doc No.", "Particulars", "Receipt (Day Book)",
                   "Amount Received (Invoice)", "Voucher No.", "Bill No.", "Chassis No.",
                   "Customer", "Running Total"]
        rows = [[e["date"], e["vr_type"], e["doc_no"], e["particulars"], e["receipt"] or 0,
                 e["amount_received"] or 0, e["voucher_no"], e["bill_no"], e["chassis_no"],
                 e["customer"], e["balance"]] for e in events]
        fname = f"Ledger_V_{(selected_dealer.name if selected_dealer else 'Dealer').replace(' ', '_')}.csv"
        return _csv_response(fname, headers, rows)
    return jsonify({"dealers": [ser_dealer(d) for d in dealers_], "selected_dealer_id": dealer_id,
                     "events": events})


@app.route("/api/day-book", methods=["GET", "POST"])
@require_auth
def day_book():
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        row_id = data.get("id")
        row = DayBook.query.get(row_id) if row_id else DayBook()
        if not row_id:
            row.vr_no = DayBook.next_vr_no()
        row.date = _parse_date(data.get("date"))
        row.dealer_name = (data.get("dealer_name") or "").strip()
        row.credit_received = _f(data.get("credit_received"))
        row.debit_paid = _f(data.get("debit_paid"))
        row.bank_id = data.get("bank_id") or None
        row.narration = data.get("narration") or None
        if not row.dealer_name:
            return _err("Dealer Name is required.")
        db.session.add(row)
        db.session.commit()
        return jsonify(ser_daybook(row)), 201

    search = request.args.get("search", "").strip()
    query = DayBook.query
    if search:
        query = query.filter(DayBook.dealer_name.ilike(f"%{search}%"))
    entries = query.order_by(DayBook.date.desc(), DayBook.vr_no.desc()).all()
    return jsonify({"entries": [ser_daybook(r) for r in entries], "next_vr_no": DayBook.next_vr_no()})


@app.route("/api/day-book/<int:row_id>", methods=["DELETE"])
@require_auth
def day_book_delete(row_id):
    row = DayBook.query.get_or_404(row_id)
    db.session.delete(row)
    db.session.commit()
    return jsonify({"deleted": True})


@app.route("/api/day-book/auto-match", methods=["POST"])
@require_auth
def day_book_auto_match():
    """One-time repair for old Day Book entries. Dealer Name used to be typed
    freely (before the dropdown was added), so old rows can have a dealer_name
    that doesn't exactly equal any Dealer.name (typo, extra word, spacing) —
    such rows are silently left out of W. Ledger even though they belong to a
    real dealer. Find the closest Dealer by name similarity and, if confident
    enough, rewrite the row to the canonical Dealer.name so it starts showing
    up in the ledger immediately, without opening/re-saving each row by hand.
    Anything not confidently matched is returned for manual review."""
    dealers_ = Dealer.query.all()
    dealer_names = [d.name for d in dealers_ if d.name]
    norm_to_name = {}
    for n in dealer_names:
        norm_to_name.setdefault(_norm_name(n), n)

    fixed, unresolved = [], []
    for row in DayBook.query.all():
        if not row.dealer_name:
            continue
        if _norm_name(row.dealer_name) in norm_to_name:
            continue  # already matches a dealer exactly, nothing to do
        candidates = difflib.get_close_matches(row.dealer_name, dealer_names, n=1, cutoff=0.72)
        if candidates:
            fixed.append({"id": row.id, "vr_no": row.vr_no, "old_name": row.dealer_name, "new_name": candidates[0]})
            row.dealer_name = candidates[0]
        else:
            unresolved.append({"id": row.id, "vr_no": row.vr_no, "dealer_name": row.dealer_name})
    db.session.commit()
    return jsonify({"fixed": fixed, "unresolved": unresolved})


# ---------------------------------------------------------------------------
# Print documents — Delivery Challan / Tax Invoice / Affidavit / Undertaking
# / Form-22, and the UMRN upload-code text file.
#
# NOTE: the original app's actual Jinja2 print templates
# (templates/vouchers/*.html) were not included in the files handed over
# for this conversion — only app.py/models.py/menu_config.py were. These
# endpoints return every field the original routes gathered (RTO address
# substitution, bank fallback-to-default logic, doc-type metadata, UMRN
# code), so the frontend can render the layouts — but the actual visual
# layout on the frontend print pages is a best-effort reconstruction, not
# a pixel-match to the original desktop software's printed forms. Compare
# against a real original printout before relying on these for RTO/GST
# submission, and adjust the frontend print components as needed.
# ---------------------------------------------------------------------------
DOC_TYPES = {
    "invoice":     {"title": "Tax Invoice", "no_label": "Invoice No."},
    "affidavit":   {"title": "Affidavit", "no_label": "Ref No."},
    "undertaking": {"title": "Undertaking", "no_label": "Ref No."},
    "form22":      {"title": "Form 22", "no_label": "Ref No."},
}


def _company_dict(c):
    if not c:
        return None
    return {"name": c.name, "year": c.year, "address1": c.address1, "address2": c.address2,
            "state": c.state, "mobile": c.mobile, "email": c.email, "website": c.website,
            "gst_no": c.gst_no, "bank_name": c.bank_name, "bank_account": c.bank_account,
            "bank_ifsc": c.bank_ifsc, "state_code": c.state_code, "pan": c.pan}


@app.route("/api/delivery-challans/<int:challan_id>/print")
@require_auth
def delivery_challan_print(challan_id):
    # Keep this print endpoint deliberately self-contained. The list endpoint
    # is already working in production; print should not depend on lazy-loading
    # relationships while serialising a single record.
    dc = DeliveryChallan.query.get_or_404(challan_id)
    company = Company.query.first()

    dealer = Dealer.query.get(dc.dealer_id) if dc.dealer_id else None
    product = Product.query.filter_by(name=dc.product_name).first() if dc.product_name else None

    # Build the payload directly from the challan columns instead of calling
    # ser_dc(), which dereferences c.dealer and can trigger a separate lazy
    # relationship query inside a Vercel serverless request.
    payload = {
        "id": dc.id, "challan_no": dc.challan_no, "date": _iso(dc.date),
        "cancelled": dc.cancelled, "dealer_id": dc.dealer_id,
        "dealer_name": dealer.name if dealer else None,
        "dealer_code": dealer.code if dealer else None,
        "dealer_mobile": dealer.mobile if dealer else None,
        "dealer_gst_no": dealer.gst_no if dealer else None,
        "vehicle_id": dc.vehicle_id, "destination": dc.destination,
        "product_name": dc.product_name, "chassis_no": dc.chassis_no,
        "motor_no": dc.motor_no, "controller_no": dc.controller_no,
        "differential_no": dc.differential_no, "colour": dc.colour,
        "other": dc.other, "battery_maker": dc.battery_maker,
        "battery_no1": dc.battery_no1, "battery_no2": dc.battery_no2,
        "battery_no3": dc.battery_no3, "battery_no4": dc.battery_no4,
        "toolkit": dc.toolkit, "jack": dc.jack, "charger": dc.charger,
        "mat": dc.mat, "stapney": dc.stapney, "front_glass": dc.front_glass,
        "center_lock": dc.center_lock, "h_lock": dc.h_lock,
        "salesman": dc.salesman, "sale_bill_no": dc.sale_bill_no,
        "sale_value": dc.sale_value, "remarks1": dc.remarks1,
        "remarks2": dc.remarks2, "umrn_code": product.umrn_code if product else None,
    }
    return jsonify({"challan": payload, "company": _company_dict(company)})


@app.route("/api/tax-invoices/<int:invoice_id>/print")
@require_auth
def tax_invoice_print(invoice_id):
    ti = TaxInvoice.query.get_or_404(invoice_id)
    company = Company.query.first()
    doc = request.args.get("doc", "invoice")
    meta = DOC_TYPES.get(doc, DOC_TYPES["invoice"])

    # Bottom-left of the invoice prints the selected RTO's saved address
    # (Setup > RTO Master) instead of the company address — never the
    # RTO's own name, only its address lines.
    rto_address = None
    if ti.rto_name:
        rto = SimpleMaster.query.filter_by(kind="rto", name=ti.rto_name).first()
        if rto and rto.address:
            rto_address = rto.address

    # Bank details: the invoice's own saved bank first, then whichever
    # Bank is marked Default (covers older invoices saved before this was
    # wired up).
    bank_name, bank_account_no, bank_ifsc = ti.bank_name, ti.bank_account_no, ti.bank_ifsc
    if not bank_name:
        default_bank = SimpleMaster.query.filter_by(kind="bank", is_default=True).first()
        if default_bank:
            bank_name = default_bank.name
            bank_account_no = default_bank.account_no
            bank_ifsc = default_bank.ifsc

    product = Product.query.filter_by(name=ti.product_name).first()

    return jsonify({
        "invoice": ser_ti(ti), "company": _company_dict(company),
        "doc": doc, "doc_title": meta["title"], "doc_no_label": meta["no_label"],
        "rto_address": rto_address,
        "print_bank_name": bank_name, "print_bank_account_no": bank_account_no,
        "print_bank_ifsc": bank_ifsc,
        "product": ser_product(product) if product else None,
    })


@app.route("/api/tax-invoices/<int:invoice_id>/upload-code")
@require_auth
def tax_invoice_upload_code(invoice_id):
    """UMRN upload-code text file: UMRN|Chassis No.|Motor No.|MM/YYYY|R1|Colour Code|NA"""
    from flask import Response
    ti = TaxInvoice.query.get_or_404(invoice_id)
    product = Product.query.filter_by(name=ti.product_name).first()
    umrn = (product.umrn_code if product else None) or ""
    colour_code = (ti.vehicle.colour_code if ti.vehicle else None) or ""
    month_year = ti.date.strftime("%m/%Y") if ti.date else ""
    code = f"{umrn}|{ti.chassis_no or ''}|{ti.motor_no or ''}|{month_year}|R1|{colour_code}|NA"
    filename = f"{(ti.bill_no or 'upload').replace('/', '_')}.TXT"
    return Response(code, mimetype="text/plain",
                     headers={"Content-Disposition": f'attachment; filename="{filename}"'})


# ---------------------------------------------------------------------------
# Company / Bank settings singleton (used to prefill invoice headers)
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Company / Bank settings singleton (used to prefill invoice headers)
# ---------------------------------------------------------------------------
@app.route("/api/company", methods=["GET", "POST"])
@require_auth
def company():
    c = Company.query.first()

    if request.method == "POST":
        # Editing company details (Setup > Company Details) is restricted to
        # super users, same as User Master / Option Setting.
        payload = getattr(g, "current_user_payload", None)
        if not payload or not payload.get("is_super_user"):
            return _err("Super user access required", 403)

        data = request.get_json(silent=True) or {}
        if not c:
            c = Company()
            db.session.add(c)
        # Only touch the fields the Company Details form actually edits —
        # 'year' and the bank_* columns (sourced from Setup > Bank Details)
        # are left alone when their key isn't present in the payload.
        for field in ("name", "gst_no", "address1", "address2", "state", "state_code",
                      "pan", "mobile", "email", "website"):
            if field in data:
                setattr(c, field, data.get(field))
        db.session.commit()
        return jsonify(_company_dict(c)), 201

    if not c:
        return jsonify(None)
    return jsonify({"id": c.id, **_company_dict(c)})


@app.route("/api/health")
def health():
    return jsonify({"status": "ok"})


# ---------------------------------------------------------------------------
# Schema bootstrap — ported from the original app.py's _auto_migrate() /
# _seed_defaults(), unchanged. Lets the existing ebill.db (real data) keep
# working without a manual migration step, and creates a default admin
# login on a brand-new database.
# ---------------------------------------------------------------------------
def _auto_migrate():
    """SQLite-only: add any model columns missing from an existing table via
    ALTER TABLE ADD COLUMN, so existing rows survive a model change. For
    Postgres/MySQL in production, use a real migration tool (Alembic) instead
    — the quoting/type rules here are SQLite-specific."""
    from sqlalchemy import inspect

    inspector = inspect(db.engine)
    existing_tables = set(inspector.get_table_names())

    if db.engine.dialect.name == "sqlite":
        def column_type(col):
            t = str(col.type)
            if "BOOLEAN" in t: return "BOOLEAN"
            if "INTEGER" in t: return "INTEGER"
            if "FLOAT" in t or "NUMERIC" in t: return "FLOAT"
            if "DATE" in t: return "DATE"
            if "DATETIME" in t: return "DATETIME"
            return "TEXT"
    else:
        # Production (Supabase/PostgreSQL): keep schema in sync with mapped
        # columns. New columns are nullable so existing rows remain valid.
        def column_type(col):
            return col.type.compile(dialect=db.engine.dialect)

    with db.engine.begin() as conn:
        for table in db.metadata.sorted_tables:
            if table.name not in existing_tables:
                continue
            existing_cols = {c["name"] for c in inspector.get_columns(table.name)}
            for col in table.columns:
                if col.name in existing_cols:
                    continue
                ddl = f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" {column_type(col)}'
                print(f"[auto-migrate] {ddl}")
                conn.exec_driver_sql(ddl)


def _seed_defaults():
    """Create the schema and safe first-run defaults."""
    dialect = db.engine.dialect.name
    if dialect == "sqlite":
        print(f"[startup] Using LOCAL SQLite database: {app.config['SQLALCHEMY_DATABASE_URI']}")
    else:
        masked = app.config["SQLALCHEMY_DATABASE_URI"]
        if "@" in masked:  # hide the password in the printed URL
            creds, rest = masked.split("@", 1)
            scheme_and_user = creds.rsplit(":", 1)[0]
            masked = f"{scheme_and_user}:****@{rest}"
        print(f"[startup] Using {dialect.upper()} database: {masked}")

    db.create_all()
    _auto_migrate()

    # Seed the standalone Chassis Master from the supplied coding sheet.
    if ChassisMonthCode.query.count() == 0:
        month_codes = [("January", "A"), ("February", "B"), ("March", "C"),
                       ("April", "D"), ("May", "E"), ("June", "F"),
                       ("July", "G"), ("August", "H"), ("September", "J"),
                       ("October", "K"), ("November", "L"), ("December", "M")]
        db.session.add_all([ChassisMonthCode(month=m, code=c) for m, c in month_codes])
    if ChassisYearCode.query.count() == 0:
        year_codes = {2017: "A", 2018: "B", 2019: "C", 2020: "D", 2021: "E",
                      2022: "F", 2023: "G", 2024: "H", 2025: "J", 2026: "K",
                      2027: "L", 2028: "M", 2029: "N", 2030: "P", 2031: "R",
                      2032: "S", 2033: "T", 2034: "U", 2035: "V", 2036: "W",
                      2037: "X", 2038: "Y", 2039: "Z", 2040: "1", 2041: "2",
                      2042: "3", 2043: "4", 2044: "5", 2045: "6", 2046: "7"}
        db.session.add_all([ChassisYearCode(year=y, code=c) for y, c in year_codes.items()])
    if ChassisRule.query.count() == 0:
        db.session.add(ChassisRule(month_position="10th From Left hand side",
                                   year_position="11th From Left hand side",
                                   chassis_height="5mm",
                                   engine_motor_example="KTC M-1000/001",
                                   chassis_example="MD9GPLDE4BJ245001"))
    db.session.commit()
    if Company.query.first() is None:
        db.session.add(Company(name="G.R.D. MOTORS"))
        db.session.commit()
    if User.query.first() is None:
        default_password = os.environ.get("DEFAULT_ADMIN_PASSWORD", "admin1")
        u = User(username="admin", is_super_user=True, permissions="Y Y")
        u.set_password(default_password)
        db.session.add(u)
        db.session.commit()


# Vercel imports this module as a serverless function — initialize once per
# warm instance so the first request can use the tables.
try:
    with app.app_context():
        _seed_defaults()
except Exception as exc:
    print(f"[startup] Database initialization skipped/failed: {exc}")


if __name__ == "__main__":
    app.run(debug=False, host="0.0.0.0", port=5000)
