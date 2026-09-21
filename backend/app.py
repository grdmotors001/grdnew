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
import io
import zipfile
from datetime import date, datetime as dt, timedelta
from flask import Flask, request, jsonify, g
from flask_cors import CORS
from sqlalchemy.orm import joinedload
from sqlalchemy import or_, text, inspect

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
                     DeliveryChallan, TaxInvoice, CreditNote, PurchaseBill, PurchaseBillItem,
                     OldRickshaw, BatteryDeliveryChallan, BatteryStockMovement, BatterySwapVoucher, JournalStock, DayBook, ExpensePaymentVoucher, ManualPendingBill, ChfplBillingQueue, RepairServiceVoucher, RepairServiceItem, RepairServicePaymentReceipt)
from menu_config import MENU, find_item, all_items
from auth import issue_token, issue_pending_token, issue_dealer_token, require_auth, require_dealer_auth, require_super_user, _serializer
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

@app.before_request
def _ensure_live_schema_additions():
    # Lightweight compatibility migration for deployments that already have
    # the dealer table but predate the Showroom/Dealer category column.
    try:
        if request.path.startswith("/api/"):
            cols={c["name"] for c in inspect(db.engine).get_columns("dealer")}
            if "dealer_category" not in cols:
                with db.engine.begin() as conn:
                    conn.execute(text("ALTER TABLE dealer ADD COLUMN dealer_category VARCHAR(20) DEFAULT 'dealer'"))
            # Existing deployments: add the insurance bill-vs-charge field without requiring a manual migration.
            ep_cols={c["name"] for c in inspect(db.engine).get_columns("expense_payment_voucher")}
            if "bill_amount" not in ep_cols:
                with db.engine.begin() as conn:
                    conn.execute(text("ALTER TABLE expense_payment_voucher ADD COLUMN bill_amount FLOAT DEFAULT 0"))
    except Exception as exc:
        print(f"[schema] dealer category check failed: {exc}")

from dealer_cashbook import dealer_cashbook_bp, DealerCashReceipt, DealerCashExpense, DealerCashHandover
app.register_blueprint(dealer_cashbook_bp, url_prefix="/api/dealer")
app.register_blueprint(hr_bp, url_prefix="/api/hr")
CORS(app, resources={r"/api/*": {"origins": os.environ.get("FRONTEND_ORIGIN", "*")}})


@app.route("/api/cashier/dealer-cash-receipts", methods=["GET", "POST"])
@require_auth
def cashier_dealer_cash_receipts():
    """Head Office Cashier: accept dealer cash handovers or record direct
    cash received at HO. Every accepted/direct receipt creates a Day Book
    credit against the dealer, so the dealer ledger shows the receipt."""
    user = User.query.get(getattr(g, "current_user_payload", {}).get("uid"))
    if not user or user.is_super_user is False and (user.department or "").strip().lower() != "cashier":
        return _err("Cashier access required.", 403)

    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        dealer_id = _i(data.get("dealer_id"), 0)
        amount = _f(data.get("amount"), 0)
        receipt_date = _parse_date(data.get("date")) or date.today()
        if not dealer_id or amount <= 0:
            return _err("Dealer and valid amount are required.")
        dealer = Dealer.query.get_or_404(dealer_id)
        handover_id = _i(data.get("handover_id"), 0)
        handover = DealerCashHandover.query.get(handover_id) if handover_id else None
        if handover:
            if handover.dealer_id != dealer.id:
                return _err("Handover dealer does not match selected dealer.", 400)
            if handover.status == "accepted":
                return _err("This cash handover has already been accepted.", 409)
            if handover.status == "rejected":
                return _err("Rejected handover cannot be accepted.", 409)
            amount = float(handover.amount or 0)
            receipt_date = handover.handover_date or receipt_date
            handover.status = "accepted"
            source = f"Cash handover {handover.handover_no}"
        else:
            source = "Direct cash received at Head Office"
        vr_no = DayBook.next_vr_no()
        received_by = (data.get("received_by") or user.username or "").strip()
        narration = (data.get("remarks") or "").strip()
        narration = f"{source}; Received by {received_by}" + (f"; {narration}" if narration else "")
        row = DayBook(vr_no=vr_no, date=receipt_date, dealer_name=dealer.name,
                      credit_received=amount, debit_paid=0,
                      bank_id=data.get("bank_id") or None, narration=narration)
        db.session.add(row)
        db.session.commit()
        return jsonify({
            "success": True, "receipt_no": f"GRD-RCPT-{vr_no:05d}",
            "vr_no": vr_no, "dealer_id": dealer.id, "dealer_name": dealer.name,
            "date": receipt_date.isoformat(), "amount": amount,
            "received_by": received_by, "source": source,
        }), 201

    pending = (DealerCashHandover.query
               .filter(DealerCashHandover.status == "sent")
               .order_by(DealerCashHandover.handover_date.desc(), DealerCashHandover.id.desc())
               .limit(500).all())
    return jsonify({
        "pending_handovers": [{
            "id": h.id, "handover_no": h.handover_no,
            "dealer_id": h.dealer_id, "dealer_name": Dealer.query.get(h.dealer_id).name if Dealer.query.get(h.dealer_id) else "",
            "date": _iso(h.handover_date), "amount": h.amount,
            "sent_to": h.sent_to, "remarks": h.remarks
        } for h in pending],
        "dealers": [ser_dealer(d) for d in Dealer.query.filter(Dealer.blocked.is_(False)).order_by(Dealer.name).all()]
    })


@app.get("/api/reports/cash-at-dealer")
@require_auth
def cash_at_dealer_report():
    start=_parse_date(request.args.get("from")) or date(dt.utcnow().year,1,1)
    end=_parse_date(request.args.get("to")) or dt.utcnow().date()
    if start>end:return _err("From date cannot be after To date")
    dealer_id=request.args.get("dealer_id",type=int)
    dealers_q=Dealer.query.order_by(Dealer.name.asc())
    if dealer_id:dealers_q=dealers_q.filter(Dealer.id==dealer_id)
    dealers=dealers_q.all()
    result=[]; total=0
    for d in dealers:
        receipts=sum(float(x.amount or 0) for x in DealerCashReceipt.query.filter(
            DealerCashReceipt.dealer_id==d.id,DealerCashReceipt.receipt_date.between(start,end),
            DealerCashReceipt.payment_mode=="cash").all())
        expenses=sum(float(x.amount or 0) for x in DealerCashExpense.query.filter(
            DealerCashExpense.dealer_id==d.id,DealerCashExpense.expense_date.between(start,end)).all())
        handover=sum(float(x.amount or 0) for x in DealerCashHandover.query.filter(
            DealerCashHandover.dealer_id==d.id,DealerCashHandover.handover_date.between(start,end),
            DealerCashHandover.status!="rejected").all())
        balance=round(receipts-expenses-handover,2); total+=balance
        result.append({"dealer_id":d.id,"dealer_code":d.code,"dealer_name":d.name,
                       "cash_received":round(receipts,2),"expenses":round(expenses,2),
                       "ho_handover":round(handover,2),"cash_at_dealer":balance})
    return jsonify({"from":start.isoformat(),"to":end.isoformat(),"rows":result,
                    "total_cash_at_dealer":round(total,2)})

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

        chfpl_url = (os.environ.get("CHFPL_API_URL") or "https://login.chfpl.com").rstrip("/")
        # CHFPL_API_URL is the API host, not the browser login page. Normalize
        # the legacy public hostname to the live CAPITALHIND production host.
        if chfpl_url.endswith("/login"):
            chfpl_url = chfpl_url[:-len("/login")].rstrip("/")
        if chfpl_url.lower() in ("https://www.chfpl.com", "https://chfpl.com"):
            chfpl_url = "https://login.chfpl.com"
        selected_model_id = _i(vehicle_loan.get("vehicle_model_id"), 0)
        # The dealer dropdown is already populated from Product Master with
        # fro="F". At submit time, resolve by the immutable Product ID only;
        # do not re-apply the fro filter because legacy Product rows can have
        # inconsistent/null fro values even though they are exposed by the
        # dealer master endpoint.
        grd_model = (Product.query
                     .filter(Product.id == selected_model_id)
                     .first()) if selected_model_id else None
        if not grd_model:
            raise RuntimeError(
                f"Selected GRD vehicle model ID {selected_model_id} was not found in Product Master"
            )

        secret = os.environ.get("CHFPL_GRD_BRIDGE_SECRET") or ""
        if not chfpl_url or not secret:
            raise RuntimeError("CHFPL_API_URL / CHFPL_GRD_BRIDGE_SECRET is not configured")
        payload = {
            "grd_customer_id": customer.id,
            "grd_submission_ref": f"GRD-{dealer.id}-{uuid.uuid4().hex}",
            "dealer": {"grd_dealer_id": dealer.id, "code": dealer.code, "name": dealer.name, "mobile": dealer.mobile, "login_id": dealer.login_id},
            "borrower": borrower,
            "guarantor": guarantor,
            "co_borrower": co_borrower,
            "vehicle_loan": {
                **vehicle_loan,
                # GRD Product Master is the source of truth for model identity.
                # Resolve by the selected Product ID on the server; do not trust
                # client-supplied model name/code for master identity.
                "grd_model_id": grd_model.id,
                "grd_model_code": grd_model.code,
                "grd_model_name": grd_model.name,
            },
            "loan_type": str(data.get("loan_type") or "").strip().upper() or None,
            "dealer_register_page_no": str(data.get("dealer_register_page_no") or "").strip() or None,
            "sale_details": data.get("sale_details") or {},
        }
        body = _json.dumps(payload).encode("utf-8")
        # CHFPL has existed with both route shapes during the integration rollout.
        # Try the current top-level route first, then the older dealer-prefixed
        # route only when the first route is genuinely missing (HTTP 404).
        route_candidates = [
            f"{chfpl_url}/api/grd-submit-loan",
            f"{chfpl_url}/api/dealer/grd-submit-loan",
        ]
        result = None
        last_404_detail = None
        for target_url in route_candidates:
            print(f"[CHFPL bridge] POST {target_url}")
            req = urllib.request.Request(
                target_url, data=body,
                headers={"Content-Type":"application/json", "X-GRD-BRIDGE-SECRET":secret}, method="POST")
            try:
                with urllib.request.urlopen(req, timeout=15) as resp:
                    result = _json.loads(resp.read().decode("utf-8"))
                    break
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode("utf-8", errors="replace")
                if exc.code == 404:
                    last_404_detail = detail[:500]
                    continue
                raise RuntimeError(f"CHFPL rejected the loan: {detail[:500]}")
        if result is None:
            raise RuntimeError(
                "CHFPL GRD loan API route was not found. "
                f"Tried both bridge routes. Last response: {last_404_detail or '404 NOT_FOUND'}"
            )

        _ensure_loan_workflow_tables()
        application_no = str(result.get("application_no") or result.get("application", {}).get("application_no") or "").strip()
        if not application_no:
            application_no = f"GRD-LOAN-{dt.utcnow().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:4].upper()}"
        workflow = LoanWorkflow.query.filter_by(application_no=application_no).first()
        if not workflow:
            workflow = LoanWorkflow(application_no=application_no, dealer_id=dealer.id, customer_id=customer.id, status="DO_PENDING",
                customer_photo=_json.dumps(photo), customer_documents=_json.dumps(documents))
            db.session.add(workflow)
            db.session.flush()
            db.session.add(LoanWorkflowLog(application_id=workflow.id, action="SUBMITTED",
                to_status="DO_PENDING", details="Dealer loan submitted"))
        db.session.commit()
        return jsonify({"success": True, "customer": ser_customer(customer), "workflow": _ser_workflow(workflow), **result})
    except Exception as exc:
        db.session.rollback()
        return _err(str(exc), 502)




# ---------------------------------------------------------------------------
# Factory Repair & Service Voucher
# ---------------------------------------------------------------------------
def _repair_service_access():
    payload = getattr(g, "current_user_payload", {}) or {}
    if payload.get("is_super_user"):
        return None
    allowed = set((payload.get("allowed_modules") or "").split(","))
    if "repair-service-voucher" not in allowed:
        return _err("Repair & Service Voucher permission required", 403)
    return None

def _ensure_repair_service_tables():
    RepairServiceVoucher.__table__.create(db.engine, checkfirst=True)
    RepairServiceItem.__table__.create(db.engine, checkfirst=True)
    RepairServicePaymentReceipt.__table__.create(db.engine, checkfirst=True)
    # Existing databases may already have the repair item table without item_code.
    cols={c["name"] for c in inspect(db.engine).get_columns("repair_service_item")}
    if "item_code" not in cols:
        with db.engine.begin() as conn:
            conn.execute(text("ALTER TABLE repair_service_item ADD COLUMN item_code VARCHAR(20)"))

def _ser_repair_service(v):
    return {
        "id": v.id, "voucher_no": v.voucher_no, "date": _iso(v.date),
        "customer_name": v.customer_name, "customer_mobile": v.customer_mobile,
        "vehicle_no": v.vehicle_no, "chassis_no": v.chassis_no,
        "subtotal": round(float(v.subtotal or 0), 2), "gst_amount": 0,
        "total_amount": round(float(v.total_amount or 0), 2),
        "paid_amount": round(float(v.paid_amount or 0), 2),
        "balance_amount": round(float(v.total_amount or 0) - float(v.paid_amount or 0), 2),
        "payment_status": v.payment_status, "status": v.status,
        "remarks": v.remarks, "created_by": v.created_by,
        "items": [{"id": x.id, "item_name": x.item_name, "qty": x.qty,
                   "rate": x.rate, "amount": x.amount, "unit": x.unit} for x in v.items],
    }

def _ser_repair_receipt(r):
    return {
        "id": r.id, "receipt_no": r.receipt_no, "date": _iso(r.date),
        "voucher_id": r.voucher_id, "voucher_no": r.voucher.voucher_no if r.voucher else None,
        "customer_name": r.customer_name, "customer_mobile": r.customer_mobile,
        "amount": r.amount, "payment_mode": r.payment_mode,
        "reference_no": r.reference_no, "remarks": r.remarks, "created_by": r.created_by,
    }

@app.route("/api/repair-service-vouchers", methods=["GET", "POST"])
@require_auth
def repair_service_vouchers():
    _ensure_repair_service_tables()
    denied = _repair_service_access()
    if denied: return denied
    if request.method == "GET":
        status = (request.args.get("status") or "").strip().lower()
        q = RepairServiceVoucher.query.order_by(RepairServiceVoucher.date.desc(), RepairServiceVoucher.id.desc())
        if status == "paid":
            q = q.filter(RepairServiceVoucher.paid_amount >= RepairServiceVoucher.total_amount)
        elif status == "unpaid":
            q = q.filter(RepairServiceVoucher.paid_amount < RepairServiceVoucher.total_amount)
        rows = q.limit(500).all()
        return jsonify({"vouchers": [_ser_repair_service(x) for x in rows]})

    d = request.get_json(silent=True) or {}
    customer = (d.get("customer_name") or "").strip()
    if not customer: return _err("Customer Name is required")
    mobile = (d.get("customer_mobile") or "").strip()
    vehicle_no = (d.get("vehicle_no") or "").strip() or None
    chassis_no = (d.get("chassis_no") or "").strip() or None
    raw_items = d.get("items") if isinstance(d.get("items"), list) else []
    if not raw_items: return _err("At least one item/service line is required")
    lines = []
    subtotal = 0
    for raw in raw_items:
        name = (raw.get("item_name") or "").strip()
        qty = _f(raw.get("qty"), 0)
        rate = _f(raw.get("rate"), 0)
        if not name or qty <= 0 or rate < 0: return _err("Each item needs name, valid Qty and Rate")
        amount = round(qty * rate, 2)
        subtotal += amount
        lines.append((name, qty, rate, amount, (raw.get("unit") or "PCS").strip() or "PCS"))
    subtotal = round(subtotal, 2)
    row = RepairServiceVoucher(
        date=_parse_date(d.get("date")) or dt.utcnow().date(),
        customer_name=customer, customer_mobile=mobile or None,
        vehicle_no=vehicle_no, chassis_no=chassis_no,
        subtotal=subtotal, gst_amount=0, total_amount=subtotal, paid_amount=0,
        payment_status="unpaid", status="open",
        remarks=(d.get("remarks") or "").strip() or None,
        created_by=(getattr(g, "current_user_payload", {}) or {}).get("username")
    )
    db.session.add(row); db.session.flush()
    row.voucher_no = f"RS-{row.id:06d}"
    for name, qty, rate, amount, unit in lines:
        db.session.add(RepairServiceItem(voucher_id=row.id, item_name=name, qty=qty,
                                         rate=rate, amount=amount, unit=unit))
    db.session.commit()
    return jsonify({"success": True, "voucher": _ser_repair_service(row)}), 201

@app.route("/api/repair-service-vouchers/<int:voucher_id>/receipt", methods=["POST"])
@require_auth
def repair_service_receipt(voucher_id):
    _ensure_repair_service_tables()
    denied = _repair_service_access()
    if denied: return denied
    voucher = RepairServiceVoucher.query.get_or_404(voucher_id)
    d = request.get_json(silent=True) or {}
    amount = _f(d.get("amount"), 0)
    if amount <= 0: return _err("Receipt amount must be greater than zero")
    balance = round(float(voucher.total_amount or 0) - float(voucher.paid_amount or 0), 2)
    if amount > balance: return _err("Receipt cannot be greater than outstanding balance")
    mode = (d.get("payment_mode") or "cash").strip().lower()
    if mode not in {"cash", "bank", "upi", "cheque"}: return _err("Valid Payment Mode is required")
    receipt = RepairServicePaymentReceipt(
        date=_parse_date(d.get("date")) or dt.utcnow().date(),
        voucher_id=voucher.id, customer_name=voucher.customer_name,
        customer_mobile=voucher.customer_mobile, amount=round(amount,2),
        payment_mode=mode, reference_no=(d.get("reference_no") or "").strip() or None,
        remarks=(d.get("remarks") or "").strip() or None,
        created_by=(getattr(g, "current_user_payload", {}) or {}).get("username")
    )
    db.session.add(receipt); db.session.flush()
    receipt.receipt_no = f"RCPT-RS-{receipt.id:06d}"
    voucher.paid_amount = round(float(voucher.paid_amount or 0) + amount, 2)
    voucher.payment_status = "paid" if voucher.paid_amount >= voucher.total_amount else "partial"
    if voucher.payment_status == "paid": voucher.status = "closed"
    db.session.commit()
    return jsonify({"success": True, "voucher": _ser_repair_service(voucher),
                    "receipt": _ser_repair_receipt(receipt)}), 201

@app.get("/api/repair-service-receipts")
@require_auth
def repair_service_receipts():
    _ensure_repair_service_tables()
    denied = _repair_service_access()
    if denied: return denied
    rows = RepairServicePaymentReceipt.query.order_by(
        RepairServicePaymentReceipt.date.desc(), RepairServicePaymentReceipt.id.desc()).limit(500).all()
    return jsonify({"receipts": [_ser_repair_receipt(x) for x in rows]})


# ---------------------------------------------------------------------------
# Head Office Expense Payment Voucher
# ---------------------------------------------------------------------------
EXPENSE_TYPES = [
    {"id":"office_exp","name":"Office Expense"},{"id":"misc_exp","name":"Misc Expense"},
    {"id":"stationery","name":"Stationery"},{"id":"printer","name":"Printer"},
    {"id":"computer_repair","name":"Computer Repair"},{"id":"cleaning","name":"Cleaning"},
    {"id":"passing_exp","name":"Passing Expense"},{"id":"incentive","name":"Incentive"},{"id":"insurance","name":"Insurance"},{"id":"rto_expense","name":"RTO Expense"},
    {"id":"fabrication","name":"Fabrication Work"},{"id":"assembly","name":"Assembly Work"},
    {"id":"other","name":"Other"},
]

def _expense_voucher_dict(v):
    return {"id":v.id,"voucher_no":v.voucher_no,"date":_iso(v.date),
            "pay_to_type":v.pay_to_type,"pay_to_name":v.pay_to_name,"dealer_id":v.dealer_id,
            "staff_name":v.staff_name,"expense_type":v.expense_type,
            "expense_type_name":next((x["name"] for x in EXPENSE_TYPES if x["id"]==v.expense_type),v.expense_type),
            "vehicle_id":v.vehicle_id,"chassis_no":v.chassis_no,"payment_mode":v.payment_mode,
            "amount":v.amount,"bill_amount":getattr(v,"bill_amount",0) or 0,"bill_no":v.bill_no,"attachment_url":v.attachment_url,
            "remarks":v.remarks,"status":v.status,"created_by":v.created_by,
            "approved_by":v.approved_by,"approved_at":_iso(v.approved_at.date()) if v.approved_at else None,
            "rejection_reason":v.rejection_reason,"paid_at":_iso(v.paid_at.date()) if v.paid_at else None,
            "payment_status":"Paid" if v.paid_at else "Unpaid",
            "work_type":v.work_type,"work_model_name":v.work_model_name,
            "work_qty":v.work_qty,"rate_per_unit":v.rate_per_unit}

@app.get("/api/expense-payment-voucher/incentive-pending")
@require_auth
def expense_incentive_pending():
    dealer_id=request.args.get("dealer_id",type=int)
    search=(request.args.get("search") or "").strip()
    page=max(1,_i(request.args.get("page"),1))
    per_page=min(200,max(20,_i(request.args.get("per_page"),100)))
    paid_vehicle_ids=db.session.query(ExpensePaymentVoucher.vehicle_id).filter(
        ExpensePaymentVoucher.expense_type=="incentive",
        ExpensePaymentVoucher.vehicle_id.isnot(None),
        ExpensePaymentVoucher.status.in_(["pending","approved"])
    ).subquery()
    latest_invoice=db.session.query(
        TaxInvoice.vehicle_id.label("vehicle_id"),
        db.func.max(TaxInvoice.id).label("invoice_id")
    ).filter(TaxInvoice.cancelled.is_(False),TaxInvoice.vehicle_id.isnot(None)).group_by(TaxInvoice.vehicle_id).subquery()
    q=(db.session.query(DeliveryChallan,TaxInvoice)
       .outerjoin(latest_invoice,latest_invoice.c.vehicle_id==DeliveryChallan.vehicle_id)
       .outerjoin(TaxInvoice,TaxInvoice.id==latest_invoice.c.invoice_id)
       .filter(DeliveryChallan.cancelled.is_(False),
               DeliveryChallan.vehicle_id.isnot(None),
               TaxInvoice.id.isnot(None),
               ~DeliveryChallan.vehicle_id.in_(paid_vehicle_ids)))
    if dealer_id:q=q.filter(DeliveryChallan.dealer_id==dealer_id)
    if search:
        like=f"%{search}%"
        q=q.filter(db.or_(DeliveryChallan.chassis_no.ilike(like),
                          DeliveryChallan.product_name.ilike(like),
                          TaxInvoice.bill_no.ilike(like),
                          TaxInvoice.buyer_name.ilike(like),
                          TaxInvoice.buyer_mobile.ilike(like)))
    q=q.order_by(DeliveryChallan.date.desc(),DeliveryChallan.id.desc())
    total=q.count()
    def row_dict(dc,ti):
        return {"vehicle_id":dc.vehicle_id,"date":_iso(ti.date if ti and ti.date else dc.date),
                "dealer_id":dc.dealer_id,"dealer_name":dc.dealer.name if dc.dealer else None,
                "model":dc.product_name,"chassis_no":dc.chassis_no,
                "customer":ti.buyer_name if ti else None,"mobile_no":ti.buyer_mobile if ti else None,
                "bill_no":(ti.bill_no if ti else None) or dc.sale_bill_no,
                "value_amt":(ti.sale_amount if ti and ti.sale_amount is not None else dc.sale_value) or 0,
                "vehicle_no":ti.vehicle_reg_no if ti else None}
    if request.args.get("export")=="csv":
        export_rows=q.all()
        headers=["Date","Dealer","Model","Chassis No.","Customer","Mobile No.","Bill No.","Value Amount"]
        return _csv_response("Incentive_Pending_Register.csv",headers,[
            [row_dict(dc,ti)["date"],row_dict(dc,ti)["dealer_name"],row_dict(dc,ti)["model"],
             row_dict(dc,ti)["chassis_no"],row_dict(dc,ti)["customer"],row_dict(dc,ti)["mobile_no"],
             row_dict(dc,ti)["bill_no"],row_dict(dc,ti)["value_amt"]]
            for dc,ti in export_rows])
    rows=q.offset((page-1)*per_page).limit(per_page).all()
    return jsonify({"rows":[row_dict(dc,ti) for dc,ti in rows],"total":total,"page":page,
                    "per_page":per_page,"total_pages":(total+per_page-1)//per_page if total else 1})

@app.get("/api/expense-payment-voucher/party-pending")
@require_auth
def expense_party_pending():
    expense_type=(request.args.get("expense_type") or "").strip().lower()
    party_name=(request.args.get("party_name") or "").strip()
    status=(request.args.get("status") or "unpaid").strip().lower()
    if expense_type not in {"insurance","rto_expense"}: return _err("Unsupported expense type")
    q=ExpensePaymentVoucher.query.filter(ExpensePaymentVoucher.expense_type==expense_type)
    if party_name:q=q.filter(ExpensePaymentVoucher.pay_to_name==party_name)
    if status=="paid":q=q.filter(ExpensePaymentVoucher.paid_at.isnot(None))
    elif status=="unpaid":q=q.filter(ExpensePaymentVoucher.paid_at.is_(None),ExpensePaymentVoucher.status!="rejected")
    rows=q.order_by(ExpensePaymentVoucher.date.desc(),ExpensePaymentVoucher.id.desc()).limit(1000).all()
    return jsonify({"vouchers":[_expense_voucher_dict(v) for v in rows],
                    "total":round(sum(float(v.amount or 0) for v in rows),2)})

@app.get("/api/expense-payment-voucher/party-rickshaws")
@require_auth
def expense_party_rickshaws():
    expense_type=(request.args.get("expense_type") or "").strip().lower()
    party_name=(request.args.get("party_name") or "").strip()
    if expense_type not in {"insurance","rto_expense"}: return _err("Unsupported expense type")
    if not party_name:return jsonify({"rickshaws":[]})
    used=db.session.query(ExpensePaymentVoucher.vehicle_id).filter(
        ExpensePaymentVoucher.expense_type==expense_type,
        ExpensePaymentVoucher.vehicle_id.isnot(None),
        ExpensePaymentVoucher.pay_to_name==party_name,
        ExpensePaymentVoucher.status!="rejected").subquery()
    q=(DeliveryChallan.query.options(joinedload(DeliveryChallan.dealer))
       .filter(DeliveryChallan.cancelled.is_(False),DeliveryChallan.vehicle_id.isnot(None),
               ~DeliveryChallan.vehicle_id.in_(used))
       .order_by(DeliveryChallan.date.desc(),DeliveryChallan.id.desc()))
    rows=q.limit(1000).all()
    return jsonify({"rickshaws":[{"vehicle_id":r.vehicle_id,"chassis_no":r.chassis_no,
        "model_name":r.product_name,"dealer_id":r.dealer_id,
        "dealer_name":r.dealer.name if r.dealer else None,"date":_iso(r.date)} for r in rows]})

@app.get("/api/expense-payment-voucher/incentive-register")
@require_auth
def expense_incentive_register():
    dealer_id=request.args.get("dealer_id",type=int)
    status=(request.args.get("status") or "all").strip().lower()
    q=ExpensePaymentVoucher.query.filter(ExpensePaymentVoucher.expense_type=="incentive")
    if dealer_id:q=q.filter(ExpensePaymentVoucher.dealer_id==dealer_id)
    if status=="paid":q=q.filter(ExpensePaymentVoucher.paid_at.isnot(None))
    elif status=="unpaid":q=q.filter(ExpensePaymentVoucher.paid_at.is_(None),ExpensePaymentVoucher.status!="rejected")
    rows=q.order_by(ExpensePaymentVoucher.date.desc(),ExpensePaymentVoucher.id.desc()).limit(1000).all()
    return jsonify({"rows":[_expense_voucher_dict(v) for v in rows],
                    "total":round(sum(float(v.amount or 0) for v in rows),2)})

@app.get("/api/expense-payment-voucher/masters")
@require_auth
def expense_payment_voucher_masters():
    dealers=Dealer.query.filter(Dealer.blocked.is_(False)).order_by(Dealer.name.asc()).all()
    staff=sorted({(d.salesman or "").strip() for d in dealers if (d.salesman or "").strip()},key=str.lower)
    mechanics=SimpleMaster.query.filter_by(kind="mechanic").order_by(SimpleMaster.name.asc()).all()
    fabricators=SimpleMaster.query.filter_by(kind="fabricator").order_by(SimpleMaster.name.asc()).all()
    return jsonify({"expense_types":EXPENSE_TYPES,
        "pay_to_types":[{"id":"dealer","name":"Dealer"},{"id":"staff","name":"Staff / Salesman"},{"id":"other","name":"Other"}],
        "dealers":[{"id":d.id,"code":d.code,"name":d.name,"salesman":d.salesman} for d in dealers],
        "staff":[{"name":n} for n in staff],
        "mechanics":[{"id":m.id,"name":m.name} for m in mechanics],
        "fabricators":[{"id":f.id,"name":f.name} for f in fabricators]})

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

@app.get("/api/expense-payment-voucher/work-pending")
@require_auth
def expense_work_pending():
    work_type=(request.args.get("work_type") or "assembly").strip().lower()
    if work_type not in {"assembly"}:
        return _err("Unsupported work type")
    paid_or_pending=db.session.query(ExpensePaymentVoucher.vehicle_id).filter(
        ExpensePaymentVoucher.expense_type=="assembly",
        ExpensePaymentVoucher.vehicle_id.isnot(None),
        ExpensePaymentVoucher.status!="rejected"
    ).subquery()
    q=(DeliveryChallan.query.options(joinedload(DeliveryChallan.dealer))
       .filter(DeliveryChallan.cancelled.is_(False),DeliveryChallan.vehicle_id.isnot(None),
               ~DeliveryChallan.vehicle_id.in_(paid_or_pending))
       .order_by(DeliveryChallan.date.desc(),DeliveryChallan.id.desc()))
    dealer_id=request.args.get("dealer_id",type=int)
    if dealer_id:q=q.filter(DeliveryChallan.dealer_id==dealer_id)
    rows=q.limit(1000).all()
    return jsonify({"rickshaws":[
        {"vehicle_id":r.vehicle_id,"chassis_no":r.chassis_no,"model_name":r.product_name,
         "dealer_id":r.dealer_id,"dealer_name":r.dealer.name if r.dealer else None,"date":_iso(r.date)}
        for r in rows
    ]})

@app.route("/api/expense-payment-voucher",methods=["GET","POST"])
@require_auth
def expense_payment_voucher():
    if request.method=="GET":
        fd,td=_date_bounds()
        status=(request.args.get("status") or "").strip().lower()
        et=(request.args.get("expense_type") or "").strip().lower()
        q=ExpensePaymentVoucher.query.order_by(ExpensePaymentVoucher.date.desc(),ExpensePaymentVoucher.id.desc())
        if fd:q=q.filter(ExpensePaymentVoucher.date>=fd)
        if td:q=q.filter(ExpensePaymentVoucher.date<=td)
        if et:q=q.filter(ExpensePaymentVoucher.expense_type==et)
        if status=="paid":q=q.filter(ExpensePaymentVoucher.paid_at.isnot(None))
        elif status=="unpaid":q=q.filter(ExpensePaymentVoucher.paid_at.is_(None))
        rows=q.limit(500).all()
        return jsonify({"vouchers":[_expense_voucher_dict(x) for x in rows],"total":sum(float(x.amount or 0) for x in rows)})

    d=request.get_json(silent=True) or {}
    pt=(d.get("pay_to_type") or "").strip().lower()
    pn=(d.get("pay_to_name") or "").strip()
    et=(d.get("expense_type") or "").strip().lower()
    pm=(d.get("payment_mode") or "cash").strip().lower()
    if pt not in {"dealer","staff","other"}: return _err("Valid Pay To is required")
    if not pn:return _err("Pay To Name is required")
    if et not in {x["id"] for x in EXPENSE_TYPES}:return _err("Valid Expense Type is required")
    if pm not in {"cash","bank","upi","cheque"}:return _err("Valid Payment Mode is required")

    date_value=_parse_date(d.get("date")) or dt.utcnow().date()
    common_remarks=(d.get("remarks") or "").strip() or None
    created_by=(getattr(g,"current_user_payload",{}) or {}).get("username")

    # Fabrication: one model-wise quantity entry, paid per rickshaw/unit.
    if et=="fabrication":
        work_model=(d.get("work_model_name") or "").strip()
        qty=_f(d.get("work_qty"),0)
        rate=_f(d.get("rate_per_unit"),0)
        if not work_model:return _err("Model is required for Fabrication Work")
        if qty<=0:return _err("Fabrication Qty must be greater than zero")
        if rate<=0:return _err("Rate per rickshaw must be greater than zero")
        amount=round(qty*rate,2)
        voucher=ExpensePaymentVoucher(date=date_value,pay_to_type=pt,pay_to_name=pn,
            dealer_id=None,staff_name=(d.get("staff_name") or "").strip() or None,
            expense_type=et,vehicle_id=None,chassis_no=None,payment_mode=pm,amount=amount,
            bill_no=(d.get("bill_no") or "").strip() or None,
            attachment_url=(d.get("attachment_url") or "").strip() or None,
            remarks=common_remarks,status="pending",created_by=created_by,
            work_type="fabrication",work_model_name=work_model,work_qty=qty,rate_per_unit=rate)
        db.session.add(voucher);db.session.flush();voucher.voucher_no=f"EXP-{voucher.id:06d}";db.session.commit()
        return jsonify({"success":True,"voucher":_expense_voucher_dict(voucher)}),201

    # Assembly: select multiple rickshaws; create one work-payment row per rickshaw
    # so each chassis has its own paid/unpaid state.
    if et=="assembly":
        mechanic=(d.get("staff_name") or "").strip()
        if not mechanic:return _err("Select Assembler / Mechanic")
        rate=_f(d.get("rate_per_unit"),0)
        if rate<=0:return _err("Rate per rickshaw must be greater than zero")
        raw_ids=d.get("vehicle_ids") if isinstance(d.get("vehicle_ids"),list) else []
        if not raw_ids:return _err("Select at least one rickshaw for Assembly Work")
        clean_ids=[]
        for raw_id in raw_ids:
            try:vid=int(raw_id)
            except (TypeError,ValueError):return _err("Invalid rickshaw selection")
            if vid not in clean_ids:clean_ids.append(vid)
        existing={x[0] for x in db.session.query(ExpensePaymentVoucher.vehicle_id).filter(
            ExpensePaymentVoucher.expense_type=="assembly",
            ExpensePaymentVoucher.vehicle_id.in_(clean_ids),
            ExpensePaymentVoucher.status!="rejected").all()}
        if existing:return _err("Some selected rickshaws already have an Assembly payment. Use the unpaid list.")
        created=[]
        for vid in clean_ids:
            dc=DeliveryChallan.query.filter_by(vehicle_id=vid,cancelled=False).order_by(DeliveryChallan.id.desc()).first()
            if not dc:return _err(f"Selected rickshaw {vid} was not found")
            voucher=ExpensePaymentVoucher(date=date_value,pay_to_type="staff",pay_to_name=mechanic,
                dealer_id=dc.dealer_id,staff_name=mechanic,expense_type=et,vehicle_id=vid,
                chassis_no=dc.chassis_no,payment_mode=pm,amount=round(rate,2),
                bill_no=(d.get("bill_no") or "").strip() or None,
                attachment_url=(d.get("attachment_url") or "").strip() or None,
                remarks=common_remarks,status="pending",created_by=created_by,
                work_type="assembly",work_model_name=dc.product_name,work_qty=1,rate_per_unit=rate)
            db.session.add(voucher);db.session.flush();voucher.voucher_no=f"EXP-{voucher.id:06d}";created.append(voucher)
        db.session.commit()
        return jsonify({"success":True,"count":len(created),"vouchers":[_expense_voucher_dict(v) for v in created]}),201

    if et in {"insurance","rto_expense"}:
        party=(pn or "").strip()
        if not party:return _err("Select Insurance Provider / RTO Passing Person")
        raw_ids=d.get("vehicle_ids") if isinstance(d.get("vehicle_ids"),list) else []
        if not raw_ids and d.get("vehicle_id"):raw_ids=[d.get("vehicle_id")]
        if not raw_ids:return _err("Select at least one rickshaw")
        amount=_f(d.get("amount"),0)
        if amount<=0:return _err("Enter amount per rickshaw")
        clean=[]
        for raw_id in raw_ids:
            try:vid=int(raw_id)
            except (TypeError,ValueError):return _err("Invalid rickshaw selection")
            if vid not in clean:clean.append(vid)
        existing={x[0] for x in db.session.query(ExpensePaymentVoucher.vehicle_id).filter(
            ExpensePaymentVoucher.expense_type==et,
            ExpensePaymentVoucher.vehicle_id.in_(clean),
            ExpensePaymentVoucher.pay_to_name==party,
            ExpensePaymentVoucher.status!="rejected").all()}
        if existing:return _err("Some selected rickshaws already have a voucher for this provider/person.")
        created=[]
        for vid in clean:
            dc=DeliveryChallan.query.filter_by(vehicle_id=vid,cancelled=False).order_by(DeliveryChallan.id.desc()).first()
            if not dc:return _err(f"Selected rickshaw {vid} was not found")
            voucher=ExpensePaymentVoucher(date=date_value,pay_to_type="other",pay_to_name=party,
                dealer_id=dc.dealer_id,expense_type=et,vehicle_id=vid,chassis_no=dc.chassis_no,
                payment_mode=pm,amount=round(amount,2),bill_amount=round(_f(d.get("bill_amount"),amount),2),bill_no=(d.get("bill_no") or "").strip() or None,
                attachment_url=(d.get("attachment_url") or "").strip() or None,
                remarks=common_remarks,status="pending",created_by=created_by)
            db.session.add(voucher);db.session.flush();voucher.voucher_no=f"EXP-{voucher.id:06d}";created.append(voucher)
        db.session.commit()
        return jsonify({"success":True,"count":len(created),"vouchers":[_expense_voucher_dict(v) for v in created]}),201

    amount=_f(d.get("amount"),0)
    if amount<=0:return _err("Amount must be greater than zero")
    vehicle_ids=d.get("vehicle_ids") if isinstance(d.get("vehicle_ids"),list) else []
    if et=="incentive" and not vehicle_ids and d.get("vehicle_id"):vehicle_ids=[d.get("vehicle_id")]
    if et=="incentive" and not vehicle_ids:return _err("Select at least one rickshaw for Incentive")
    if et=="incentive":
        clean_ids=[]
        for raw_id in vehicle_ids:
            try:vid=int(raw_id)
            except (TypeError,ValueError):return _err("Invalid rickshaw selection")
            if vid not in clean_ids:clean_ids.append(vid)
        paid_ids={x[0] for x in db.session.query(ExpensePaymentVoucher.vehicle_id).filter(
            ExpensePaymentVoucher.expense_type=="incentive",
            ExpensePaymentVoucher.vehicle_id.in_(clean_ids),
            ExpensePaymentVoucher.status.in_(["pending","approved"])).all()}
        if paid_ids:return _err("Some selected rickshaws already have an incentive voucher. Refresh the list and select unpaid rickshaws only.")
        created=[]
        for vid in clean_ids:
            dc=DeliveryChallan.query.filter_by(vehicle_id=vid,cancelled=False).order_by(DeliveryChallan.id.desc()).first()
            if not dc:return _err(f"Selected rickshaw {vid} was not found")
            if not dc.dealer_id:return _err(f"Dealer is missing for chassis {dc.chassis_no or vid}")
            if pt=="dealer" and d.get("dealer_id") and int(d.get("dealer_id"))!=int(dc.dealer_id):
                return _err(f"Rickshaw {dc.chassis_no} does not belong to selected dealer")
            voucher=ExpensePaymentVoucher(date=date_value,pay_to_type=pt,pay_to_name=pn,dealer_id=dc.dealer_id,
                staff_name=(d.get("staff_name") or "").strip() or None,expense_type=et,vehicle_id=vid,
                chassis_no=dc.chassis_no,payment_mode=pm,amount=round(amount,2),
                bill_no=(d.get("bill_no") or "").strip() or None,
                attachment_url=(d.get("attachment_url") or "").strip() or None,
                remarks=common_remarks,status="pending",created_by=created_by)
            db.session.add(voucher);db.session.flush();voucher.voucher_no=f"EXP-{voucher.id:06d}";created.append(voucher)
        db.session.commit()
        return jsonify({"success":True,"count":len(created),"vouchers":[_expense_voucher_dict(v) for v in created]}),201

    vid=d.get("vehicle_id");did=d.get("dealer_id");staff=(d.get("staff_name") or "").strip() or None;chassis=None
    if vid:
        try:vid=int(vid)
        except (TypeError,ValueError):return _err("Invalid rickshaw")
        dc=DeliveryChallan.query.filter_by(vehicle_id=vid,cancelled=False).order_by(DeliveryChallan.id.desc()).first()
        if not dc:return _err("Selected rickshaw was not found")
        if did and int(did)!=int(dc.dealer_id or 0):return _err("Rickshaw does not belong to selected dealer")
        did=dc.dealer_id;chassis=dc.chassis_no
    if et=="passing_exp" and not vid:return _err("Select a rickshaw for Passing Expense")
    voucher=ExpensePaymentVoucher(date=date_value,pay_to_type=pt,pay_to_name=pn,dealer_id=int(did) if did else None,
        staff_name=staff,expense_type=et,vehicle_id=vid,chassis_no=chassis,payment_mode=pm,amount=round(amount,2),
        bill_no=(d.get("bill_no") or "").strip() or None,attachment_url=(d.get("attachment_url") or "").strip() or None,
        remarks=common_remarks,status="pending",created_by=created_by)
    db.session.add(voucher);db.session.flush();voucher.voucher_no=f"EXP-{voucher.id:06d}";db.session.commit()
    return jsonify({"success":True,"voucher":_expense_voucher_dict(voucher)}),201

@app.post("/api/expense-payment-voucher/<int:voucher_id>/mark-paid")
@require_auth
@require_super_user
def expense_payment_voucher_mark_paid(voucher_id):
    voucher=ExpensePaymentVoucher.query.get(voucher_id)
    if not voucher:return _err("Voucher not found",404)
    if voucher.status!="approved":return _err("Only approved vouchers can be marked Paid")
    voucher.paid_at=dt.utcnow()
    db.session.commit()
    return jsonify({"success":True,"voucher":_expense_voucher_dict(voucher)})

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
            "dealer_category": getattr(d, "dealer_category", "dealer") or "dealer",
            "salesman": d.salesman, "blocked": d.blocked, "purchase_access": bool(d.purchase_access), "login_id": d.login_id}


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
            "is_default": row.is_default, "ifsc": row.ifsc, "extra": row.extra,
            "color_hex": getattr(row, "color_hex", None), "color_hex2": getattr(row, "color_hex2", None),
            "is_double_tone": bool(getattr(row, "is_double_tone", False))}


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
    return {"id": u.id, "username": u.username, "mobile": u.mobile, "is_super_user": u.is_super_user,
            "permissions": u.permissions,
            "department": u.department or "Admin",
            "assigned_dealer_ids": u.get_assigned_dealer_ids(),
            "allowed_modules": (u.allowed_modules or "").split(",") if u.allowed_modules else []}


def _staff_dealer_ids():
    payload = getattr(g, "current_user_payload", {}) or {}
    if payload.get("is_super_user"):
        return None
    # Salesman scope is always derived live from Dealer Master.salesman.
    # Therefore a newly created/changed dealer is visible without editing
    # the salesman user again or waiting for a new login token.
    if (payload.get("department") or "").strip().lower() == "salesman":
        username = (payload.get("username") or "").strip()
        if not username:
            return []
        return [d.id for d in Dealer.query.filter(
            Dealer.salesman.ilike(username),
            Dealer.blocked.is_(False),
        ).all()]
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
            "battery_maker": getattr(v, "battery_maker", None),
            "battery_no1": getattr(v, "battery_no1", None),
            "battery_no2": getattr(v, "battery_no2", None),
            "battery_no3": getattr(v, "battery_no3", None),
            "battery_no4": getattr(v, "battery_no4", None),
            "has_battery": any(getattr(v, f"battery_no{i}", None) for i in range(1,5)),
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
            "sale_value": c.sale_value, "dealer_page_no": getattr(c, "dealer_page_no", None), "remarks1": c.remarks1, "remarks2": c.remarks2}


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


def ser_credit_note(cn):
    return {
        "id": cn.id,
        "credit_note_no": cn.credit_note_no,
        "date": _iso(cn.date),
        "original_invoice_id": cn.original_invoice_id,
        "original_bill_no": cn.original_bill_no,
        "delivery_challan_id": cn.delivery_challan_id,
        "vehicle_id": cn.vehicle_id,
        "dealer_name": cn.dealer_name,
        "buyer_name": cn.buyer_name,
        "product_name": cn.product_name,
        "chassis_no": cn.chassis_no,
        "reason": cn.reason,
        "taxable_amount": cn.taxable_amount,
        "tax_amount": cn.tax_amount,
        "total_amount": cn.total_amount,
        "remarks": cn.remarks,
        "status": cn.status,
        "created_by": cn.created_by,
        "created_at": _iso(cn.created_at),
    }


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
    return {"id": r.id, "record_no": r.record_no, "vou_no": r.vou_no, "date": _iso(r.date),
            "source": r.source, "chfpl_ref_no": r.chfpl_ref_no, "party_name": r.party_name,
            "purchase_ref_no": r.purchase_ref_no, "purchase_amount": r.purchase_amount,
            "file_charge": r.file_charge, "vehicle_reg_no": r.vehicle_reg_no,
            "model_name": r.model_name, "owner_name": r.owner_name, "salesman": r.salesman,
            "chassis_no": r.chassis_no, "ledger_date": _iso(r.ledger_date), "challan_no": r.challan_no,
            "sale_type": r.sale_type, "do_number": r.do_number,
            "battery_maker": r.battery_maker, "battery_no1": r.battery_no1, "battery_no2": r.battery_no2,
            "battery_no3": r.battery_no3, "battery_no4": r.battery_no4,
            "charger": r.charger, "mat": r.mat, "jack": r.jack, "center_lock": r.center_lock,
            "big_mirror": r.big_mirror, "colour": r.colour, "toolkit": r.toolkit, "stepney": r.stepney,
            "out_name": r.out_name,
            "has_battery": any(getattr(r, f"battery_no{i}", None) for i in range(1,5)),
            "status": r.status, "dealer_id": r.dealer_id, "dealer_name": r.dealer.name if r.dealer else None,
            "sale_date": _iso(r.sale_date), "sale_dealer_id": r.sale_dealer_id,
            "sale_dealer_name": r.sale_dealer.name if r.sale_dealer else None,
            "sale_ref_no": r.sale_ref_no, "sale_amount": r.sale_amount,
            "loan_amount": r.loan_amount, "down_payment": r.down_payment, "sold_to": r.sold_to,
            "dealer_page_no": r.dealer_page_no, "sp_no": r.sp_no,
            "sold_amount": r.sold_amount, "receipt_amount": r.receipt_amount,
            "receipt_no": r.receipt_no, "ledger": r.ledger, "resale_date": _iso(r.resale_date),
            "resale_ledger": r.resale_ledger, "remarks1": r.remarks1, "remarks2": r.remarks2,
            "balance_amount": r.balance_amount}


def ser_battery_dc(r):
    return {"id": r.id, "challan_no": r.challan_no, "date": _iso(r.date), "dealer_id": r.dealer_id,
            "dealer_name": r.dealer.name if r.dealer else None, "battery_maker": r.battery_maker,
            "battery_no": r.battery_no, "qty": r.qty, "remarks": r.remarks}


def ser_journal(r):
    return {"id": r.id, "vou_no": r.vou_no, "date": _iso(r.date), "item_name": r.item_name,
            "item_type": r.item_type, "qty": r.qty, "reason": r.reason,
            "model_name": getattr(r, "model_name", None), "work_type": getattr(r, "work_type", None),
            "batch_ref": getattr(r, "batch_ref", None)}


def ser_daybook(r):
    return {"id": r.id, "vr_no": r.vr_no, "date": _iso(r.date), "dealer_name": r.dealer_name,
            "bank_id": r.bank_id, "bank_name": (SimpleMaster.query.get(r.bank_id).name if r.bank_id else None),
            "credit_received": r.credit_received, "debit_paid": r.debit_paid,
            "narration": r.narration}


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
def _ensure_auth_columns():
    """Idempotently add login-related columns before any User ORM query.
    Existing GRD databases may predate newer staff-auth fields."""
    try:
        with db.engine.begin() as conn:
            inspector = inspect(conn)
            if not inspector.has_table("user"):
                return
            columns = {c["name"] for c in inspector.get_columns("user")}
            additions = {
                # These columns were added after the first GRD staff database
                # was created. User ORM queries select the complete row, so a
                # missing one causes PostgreSQL to return a 500 before the
                # username/password check can even run.
                "department": 'VARCHAR(30)',
                "assigned_dealer_ids": 'TEXT',
                "mobile": 'VARCHAR(30)',
                "permissions": 'VARCHAR(50)',
                "allowed_modules": 'TEXT',
            }
            for name, sql_type in additions.items():
                if name not in columns:
                    if db.engine.dialect.name == "postgresql":
                        conn.execute(text(f'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS {name} {sql_type}'))
                    else:
                        conn.execute(text(f'ALTER TABLE "user" ADD COLUMN {name} {sql_type}'))
    except Exception as exc:
        db.session.rollback()
        return str(exc)
    return None


def _ensure_dealer_login_columns():
    """Idempotently add Dealer columns introduced after older databases were created.
    Dealer ORM queries select the whole row, so one missing column can otherwise
    turn a valid dealer login into a production 500."""
    try:
        with db.engine.begin() as conn:
            inspector = inspect(conn)
            if not inspector.has_table("dealer"):
                return
            columns = {c["name"] for c in inspector.get_columns("dealer")}
            # Dealer ORM queries select the complete row. Keep every
            # mapped Dealer column present so older Supabase schemas cannot
            # turn a login into a PostgreSQL "column does not exist" 500.
            additions = {
                "address1": ("VARCHAR(200)", "NULL"),
                "address2": ("VARCHAR(200)", "NULL"),
                "mobile": ("VARCHAR(30)", "NULL"),
                "gst_no": ("VARCHAR(30)", "NULL"),
                "registration_type": ("VARCHAR(20)", "'registered'"),
                "state": ("VARCHAR(100)", "NULL"),
                "state_code": ("VARCHAR(10)", "NULL"),
                "pan": ("VARCHAR(20)", "NULL"),
                "bank_name": ("VARCHAR(120)", "NULL"),
                "bank_account_no": ("VARCHAR(50)", "NULL"),
                "bank_ifsc": ("VARCHAR(50)", "NULL"),
                "salesman": ("VARCHAR(100)", "NULL"),
                "blocked": ("BOOLEAN", "FALSE"),
                "purchase_access": ("BOOLEAN", "FALSE"),
                "login_id": ("VARCHAR(50)", "NULL"),
                "password_hash": ("VARCHAR(255)", "NULL"),
                "created_at": ("TIMESTAMP", "NULL"),
            }
            for name, (sql_type, default_sql) in additions.items():
                if name in columns:
                    continue
                if db.engine.dialect.name == "postgresql":
                    ddl = f'ALTER TABLE "dealer" ADD COLUMN IF NOT EXISTS {name} {sql_type}'
                    if default_sql != "NULL":
                        ddl += f" DEFAULT {default_sql}"
                else:
                    ddl = f'ALTER TABLE "dealer" ADD COLUMN {name} {sql_type}'
                    if default_sql != "NULL":
                        ddl += f" DEFAULT {default_sql}"
                conn.execute(text(ddl))
    except Exception as exc:
        db.session.rollback()
        return str(exc)
    return None

@app.route("/api/auth/login", methods=["POST"])
def login():
    _ensure_auth_columns()
    data = request.get_json(silent=True) or {}
    userid = (data.get("userid") or "").strip()
    password = data.get("password") or ""
    user = User.query.filter_by(username=userid).first()
    if not user:
        user = User.query.filter_by(mobile=userid).first()
    if not user or not user.check_password(password):
        return _err("Invalid Username/Mobile or Password.", 401)
    return jsonify({"otp_required": True, "otp_token": issue_pending_token(user), "user": ser_user(user)})


@app.route("/api/auth/verify-otp", methods=["POST"])
def verify_otp():
    from itsdangerous import BadSignature, SignatureExpired
    data = request.get_json(silent=True) or {}
    pending = data.get("otp_token") or ""
    otp = str(data.get("otp") or "").strip()
    try:
        payload = _serializer.loads(pending, max_age=10*60)
    except Exception:
        return _err("OTP session expired. Please login again.", 401)
    if payload.get("scope") != "otp_pending" or otp != "1234":
        return _err("Invalid OTP.", 401)
    user = User.query.get(payload.get("uid"))
    if not user:
        return _err("User not found.", 404)
    return jsonify({"token": issue_token(user), "user": ser_user(user)})


@app.route("/api/auth/dealer-login", methods=["POST"])
def dealer_login():
    _ensure_dealer_login_columns()
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
            "purchase_access": bool(dealer.purchase_access),
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


def _chfpl_bridge_base():
    chfpl_url = (os.environ.get("CHFPL_API_URL") or "https://login.chfpl.com").rstrip("/")
    if chfpl_url.endswith("/login"):
        chfpl_url = chfpl_url[:-len("/login")].rstrip("/")
    if chfpl_url.lower() in ("https://www.chfpl.com", "https://chfpl.com"):
        chfpl_url = "https://login.chfpl.com"
    return chfpl_url


def _chfpl_bridge_get(path):
    secret = os.environ.get("CHFPL_GRD_BRIDGE_SECRET") or ""
    if not secret:
        raise RuntimeError("CHFPL_GRD_BRIDGE_SECRET is not configured")
    target = f"{_chfpl_bridge_base()}{path}"
    req = urllib.request.Request(
        target,
        headers={"X-GRD-BRIDGE-SECRET": secret, "Accept": "application/json"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=12) as response:
            return int(response.status or 200), _json.loads(response.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            detail = _json.loads(raw)
        except Exception:
            detail = {"error": raw or f"CHFPL HTTP {exc.code}"}
        return int(exc.code), detail


@app.get("/api/dealer/loan-status")
@require_dealer_auth
def dealer_loan_status():
    dealer = Dealer.query.get(g.current_dealer_id)
    if not dealer:
        return _err("Dealer not found", 404)
    try:
        status, payload = _chfpl_bridge_get(f"/api/grd-dealer-loans?grd_dealer_id={dealer.id}")
    except Exception as exc:
        print(f"[CHFPL loan status] {exc}")
        return _err("Loan status service is temporarily unavailable", 502)
    if status >= 400:
        detail = payload.get("error") if isinstance(payload, dict) else None
        return _err(detail or "Could not load loan status from CHFPL", 502)
    return jsonify(payload if isinstance(payload, dict) else {"applications": []})


@app.get("/api/billing/approved-loans")
@require_auth
def billing_approved_loans():
    _ensure_chfpl_billing_queue_table()
    if not _billing_user_allowed():
        return _err("Billing approval rights required", 403)
    try:
        status, payload = _chfpl_bridge_get("/api/grd-dealer-loans?status=approved,sanctioned,disbursed")
    except Exception as exc:
        print(f"[CHFPL approved loans] {exc}")
        return _err("CHFPL approved loan service is temporarily unavailable", 502)
    if status >= 400:
        detail = payload.get("error") if isinstance(payload, dict) else None
        return _err(detail or "Could not load approved loans from CHFPL", 502)
    applications = payload.get("applications", []) if isinstance(payload, dict) else []
    consumed = {r.application_no for r in ChfplBillingQueue.query.with_entities(ChfplBillingQueue.application_no).all()}
    return jsonify({"success": True, "applications": [r for r in applications if r.get("application_no") not in consumed]})

@app.post("/api/billing/approved-loans/<application_no>/use")
@require_auth
def use_chfpl_approved_loan(application_no):
    _ensure_chfpl_billing_queue_table()
    if not _billing_user_allowed():
        return _err("Billing approval rights required", 403)
    application_no = (application_no or "").strip()
    if not application_no:
        return _err("Application number is required")
    if ChfplBillingQueue.query.filter_by(application_no=application_no).first():
        return _err("This CHFPL loan has already been used in GRD billing.", 409)
    try:
        status, payload = _chfpl_bridge_get(
            f"/api/grd-dealer-loans?status=approved,sanctioned,disbursed"
        )
    except Exception as exc:
        print(f"[CHFPL use loan] {exc}")
        return _err("CHFPL approved loan service is temporarily unavailable", 502)
    if status >= 400:
        detail = payload.get("error") if isinstance(payload, dict) else None
        return _err(detail or "Could not verify approved loan in CHFPL", 502)
    row = next((r for r in (payload.get("applications", []) if isinstance(payload, dict) else [])
                if r.get("application_no") == application_no), None)
    if not row:
        return _err("Approved CHFPL loan not found", 404)
    dealer_id = _i(row.get("grd_dealer_id"), 0)
    dealer = Dealer.query.get(dealer_id) if dealer_id else None
    entry = ChfplBillingQueue(
        application_no=application_no,
        chfpl_id=_i(row.get("id"), 0) or None,
        dealer_id=dealer.id if dealer else None,
        dealer_name=row.get("dealer_name"),
        customer_name=row.get("customer_name"),
        customer_phone=row.get("customer_phone"),
        vehicle_model_name=row.get("vehicle_model_name"),
        loan_amount=_f(row.get("loan_amount_requested"), 0),
        tenure_months=_i(row.get("tenure_months"), 0) or None,
        chfpl_status=row.get("status"),
        used_at=dt.utcnow(),
        used_by=(getattr(g, "current_user_payload", {}) or {}).get("username"),
        billing_status="PENDING_BILL",
    )
    db.session.add(entry)
    try:
        db.session.commit()
    except Exception:
        db.session.rollback()
        return _err("This CHFPL loan was already used in GRD billing.", 409)
    return jsonify({"success": True, "billing": {
        "id": entry.id, "application_no": entry.application_no,
        "billing_status": entry.billing_status
    }}), 201


@app.route("/api/dealer/old-rickshaws")
@require_dealer_auth
def dealer_old_rickshaws():
    rows=(OldRickshaw.query.filter(OldRickshaw.sale_dealer_id==g.current_dealer_id,
                                   OldRickshaw.status=="sold")
          .order_by(OldRickshaw.sale_date.desc(),OldRickshaw.id.desc()).all())
    return jsonify({"rickshaws":[ser_old_rickshaw(r) for r in rows],"count":len(rows)})


@app.route("/api/dealer/battery-stock")
@require_dealer_auth
def dealer_battery_stock():
    rows=(BatteryStockMovement.query.filter_by(dealer_id=g.current_dealer_id,movement_type="withdrawal")
          .order_by(BatteryStockMovement.date.desc(),BatteryStockMovement.id.desc()).all())
    # Battery numbers are unique inventory units; later movement types can be
    # added without changing the dealer-facing response.
    return jsonify({"batteries":[{"id":r.id,"date":_iso(r.date),"battery_maker":r.battery_maker,
        "battery_no":r.battery_no,"qty":r.qty,"reference_no":r.reference_no,"remarks":r.remarks}
        for r in rows],"count":sum(int(r.qty or 0) for r in rows)})


@app.route("/api/dealer/rickshaw-battery-options")
@require_auth
def dealer_rickshaw_battery_options():
    dealer_id=request.args.get("dealer_id",type=int)
    kind=(request.args.get("type") or "new").lower()
    if not dealer_id:return _err("Dealer is required.")
    dealer=Dealer.query.get_or_404(dealer_id)
    out=[]
    if kind=="old":
        rows=OldRickshaw.query.filter_by(sale_dealer_id=dealer.id,status="sold").order_by(OldRickshaw.vehicle_reg_no).all()
        for r in rows:
            nums=_battery_fields(r)
            out.append({"id":r.id,"reg_no":r.vehicle_reg_no,"model_name":r.model_name,
                        "battery_maker":r.battery_maker,"has_battery":any(nums),
                        "battery_numbers":[n for n in nums if n]})
    else:
        rows=(Vehicle.query.filter(Vehicle.stage=="Delivery Challan",
                                   db.func.lower(db.func.trim(Vehicle.dealer_name))==db.func.lower(db.func.trim(dealer.name)))
              .order_by(Vehicle.chassis_no).all())
        # Delivery Challan keeps the historical battery snapshot. Vehicle
        # battery fields can be blank after a swap/legacy update, so use the
        # DC snapshot as the initial/current stock view for this screen.
        dc_by_vehicle={}
        vehicle_ids=[v.id for v in rows]
        if vehicle_ids:
            dcs=(DeliveryChallan.query.filter(DeliveryChallan.vehicle_id.in_(vehicle_ids))
                 .order_by(DeliveryChallan.id.desc()).all())
            for dc in dcs:
                if dc.vehicle_id not in dc_by_vehicle:
                    dc_by_vehicle[dc.vehicle_id]=dc
        for r in rows:
            nums=_battery_fields(r)
            maker=getattr(r,"battery_maker",None)
            dc=dc_by_vehicle.get(r.id)
            dc_nums=[getattr(dc,f"battery_no{i}",None) for i in range(1,5)] if dc else []
            if not any(nums) and any(dc_nums):
                nums=dc_nums
                maker=dc.battery_maker
            out.append({"id":r.id,"chassis_no":r.chassis_no,"model_name":r.model_name,
                        "battery_maker":maker,"has_battery":any(nums),
                        "battery_numbers":[n for n in nums if n]})
    return jsonify({"rickshaws":out})


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
    for _cash_model in (DealerCashReceipt, DealerCashExpense, DealerCashHandover):
        _cash_model.__table__.create(db.engine, checkfirst=True)
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

    # Dashboard billing split is aggregated here so the browser does not make
    # a second GST Register request every time the dashboard month changes.
    if db.engine.dialect.name == "postgresql":
        invoice_month = db.func.to_char(TaxInvoice.date, "YYYY-MM")
    else:
        invoice_month = db.func.strftime("%Y-%m", TaxInvoice.date)
    interstate_cond = db.or_(
        TaxInvoice.state_type == "O",
        db.and_(TaxInvoice.state_type.is_(None), TaxInvoice.buyer_state_code.isnot(None),
                TaxInvoice.buyer_state_code != "07"),
    )
    taxable_expr = (
        db.func.coalesce(TaxInvoice.gst_sale_amount, TaxInvoice.sale_amount, 0)
        - db.func.coalesce(TaxInvoice.discount, 0)
    )
    billed_rows = (db.session.query(
            invoice_month.label("month"),
            db.func.sum(db.case((interstate_cond, 1), else_=0)).label("interstate_count"),
            db.func.sum(db.case((~interstate_cond, 1), else_=0)).label("local_count"),
            db.func.sum(db.case((interstate_cond, taxable_expr), else_=0)).label("interstate_taxable"),
            db.func.sum(db.case((~interstate_cond, taxable_expr), else_=0)).label("local_taxable"),
        )
        .filter(TaxInvoice.cancelled.is_(False), TaxInvoice.date.isnot(None))
        .group_by(invoice_month)
        .order_by(invoice_month)
        .all())
    billed_monthly = [{
        "month": str(month),
        "interstateCount": int(interstate_count or 0),
        "interstateTaxable": round(float(interstate_taxable or 0), 2),
        "localCount": int(local_count or 0),
        "localTaxable": round(float(local_taxable or 0), 2),
    } for month, interstate_count, local_count, interstate_taxable, local_taxable in billed_rows]

    # Current cash physically held at dealers = cash receipts - dealer expenses
    # - cash handed over to HO. Keep this as scalar SQL sums so Dashboard stays fast.
    cash_received = db.session.query(db.func.coalesce(db.func.sum(DealerCashReceipt.amount),0)).filter(
        DealerCashReceipt.payment_mode=="cash").scalar() or 0
    cash_expenses = db.session.query(db.func.coalesce(db.func.sum(DealerCashExpense.amount),0)).scalar() or 0
    cash_handover = db.session.query(db.func.coalesce(db.func.sum(DealerCashHandover.amount),0)).filter(
        DealerCashHandover.status!="rejected").scalar() or 0
    cash_at_dealer = round(float(cash_received)-float(cash_expenses)-float(cash_handover),2)

    return jsonify({
        "manufacturing": [ser_vehicle(v) for v in vehicles if v.stage == "Manufacturing"],
        "delivery_challan": [ser_vehicle(v) for v in vehicles if v.stage == "Delivery Challan"],
        "tax_invoice": [ser_vehicle(v) for v in vehicles if v.stage == "Tax Invoice"],
        "stage_counts": stage_counts,
        "monthly": monthly,
        "billed_monthly": billed_monthly,
        "cash_at_dealer": cash_at_dealer,
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
def _ensure_chfpl_billing_queue_table():
    ChfplBillingQueue.__table__.create(db.engine, checkfirst=True)

def _ensure_loan_workflow_tables():
    LoanWorkflow.__table__.create(db.engine, checkfirst=True)
    LoanWorkflowLog.__table__.create(db.engine, checkfirst=True)
    # Older production databases need the billing workflow columns added
    # before SQLAlchemy selects the full LoanWorkflow row.
    try:
        with db.engine.begin() as conn:
            inspector=inspect(conn)
            if not inspector.has_table("loan_workflow"): return
            columns={x["name"] for x in inspector.get_columns("loan_workflow")}
            additions={
                "billing_status":"VARCHAR(30) DEFAULT 'NOT_REQUESTED'",
                "dealer_description":"TEXT",
                "billing_vehicle_id":"INTEGER",
                "billing_chassis_no":"VARCHAR(60)",
                "billing_sale_amount":"DOUBLE PRECISION DEFAULT 0",
                "billing_requested_at":"TIMESTAMP",
                "billing_approved_by":"VARCHAR(120)",
                "billing_approved_at":"TIMESTAMP",
                "billing_invoice_id":"INTEGER",
            }
            for name,sql_type in additions.items():
                if name not in columns:
                    if db.engine.dialect.name=="postgresql":
                        conn.execute(text(f'ALTER TABLE "loan_workflow" ADD COLUMN IF NOT EXISTS {name} {sql_type}'))
                    else:
                        conn.execute(text(f'ALTER TABLE loan_workflow ADD COLUMN {name} {sql_type}'))
    except Exception as exc:
        db.session.rollback()
        print(f"[loan-workflow] billing schema check failed: {exc}")


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
        "billing_status": getattr(row,"billing_status","NOT_REQUESTED"),
        "dealer_description": getattr(row,"dealer_description",None),
        "billing_vehicle_id": getattr(row,"billing_vehicle_id",None),
        "billing_chassis_no": getattr(row,"billing_chassis_no",None),
        "billing_sale_amount": getattr(row,"billing_sale_amount",0) or 0,
        "billing_requested_at": _iso(getattr(row,"billing_requested_at",None)),
        "billing_approved_by": getattr(row,"billing_approved_by",None),
        "billing_approved_at": _iso(getattr(row,"billing_approved_at",None)),
        "billing_invoice_id": getattr(row,"billing_invoice_id",None),
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


@app.post("/api/integration/loan-status")
def integration_loan_status():
    supplied=request.headers.get("X-GRD-BRIDGE-SECRET") or ""
    expected=os.environ.get("CHFPL_GRD_BRIDGE_SECRET") or ""
    if not expected or not supplied or not hmac.compare_digest(supplied,expected):
        return _err("Invalid integration secret",401)
    _ensure_loan_workflow_tables()
    data=request.get_json(silent=True) or {}
    application_no=(data.get("application_no") or "").strip()
    status=(data.get("status") or "").strip().upper()
    if not application_no:return _err("application_no is required")
    row=LoanWorkflow.query.filter_by(application_no=application_no).first()
    if not row:return _err("Loan application not found",404)
    ref=(data.get("chfpl_reference") or "").strip()
    if ref:row.chfpl_reference=ref
    old=row.status
    if status in {"APPROVED","LOAN_APPROVED","SANCTIONED"}:
        row.status="DO_APPROVED"
        row.approved_at=row.approved_at or dt.utcnow()
        row.do_expiry_at=row.do_expiry_at or (dt.utcnow()+timedelta(days=30))
        row.do_no=row.do_no or f"DO-{dt.utcnow().strftime('%Y%m%d')}-{row.id:06d}"
    elif status in {"REJECTED","DECLINED"}:
        row.status="DO_REJECTED"
    elif status in {"HOLD","PENDING"}:
        row.status="DO_HOLD"
    db.session.add(LoanWorkflowLog(application_id=row.id,action=f"CHFPL_{status or 'STATUS'}",
        from_status=old,to_status=row.status,remark=data.get("remark"),
        details="CHFPL loan status received through GRD bridge"))
    db.session.commit()
    return jsonify({"success":True,"application":_ser_workflow(row)})

@app.get("/api/dealer/pending-sales")
@require_dealer_auth
def dealer_pending_sales():
    _ensure_loan_workflow_tables()
    did=getattr(g,"current_dealer_id",None)
    rows=(LoanWorkflow.query.filter_by(dealer_id=did)
          .filter(LoanWorkflow.status=="DO_APPROVED")
          .order_by(LoanWorkflow.id.desc()).limit(200).all())
    # Dealer can only attach one of its Delivery Challans to a pending sale.
    challans=(DeliveryChallan.query.filter_by(dealer_id=did,cancelled=False)
              .order_by(DeliveryChallan.date.desc(),DeliveryChallan.id.desc()).limit(500).all())
    return jsonify({"applications":[_ser_workflow(x) for x in rows],
                    "vehicles":[{"challan_id":x.id,"vehicle_id":x.vehicle_id,"chassis_no":x.chassis_no,
                                 "model_name":x.product_name,"challan_no":x.challan_no,
                                 "sale_value":x.sale_value or 0,"date":_iso(x.date)}
                                for x in challans if x.vehicle_id]})

@app.post("/api/dealer/pending-sales/<int:row_id>")
@require_dealer_auth
def dealer_pending_sale_create(row_id):
    _ensure_loan_workflow_tables()
    row=LoanWorkflow.query.get_or_404(row_id)
    if row.dealer_id!=getattr(g,"current_dealer_id",None): return _err("Not allowed",403)
    if row.status!="DO_APPROVED": return _err("Only approved CHFPL/DO loans can be moved to Pending Sales",409)
    data=request.get_json(silent=True) or {}
    description=(data.get("dealer_description") or "").strip()
    vehicle_id=data.get("vehicle_id")
    sale_amount=_f(data.get("sale_amount"),0)
    if not description:return _err("Dealer description is required")
    if not vehicle_id:return _err("Select the rickshaw / Delivery Challan")
    challan=DeliveryChallan.query.filter_by(id=vehicle_id,dealer_id=row.dealer_id,cancelled=False).first()
    if not challan:return _err("Selected Delivery Challan is not available for this dealer",404)
    if row.billing_status in {"PENDING_SALE","BILL_APPROVED","BILLED"}: return _err("This loan is already in the billing workflow",409)
    row.dealer_description=description
    row.billing_vehicle_id=challan.vehicle_id
    row.billing_chassis_no=challan.chassis_no
    row.billing_sale_amount=round(sale_amount or challan.sale_value or 0,2)
    row.billing_requested_at=dt.utcnow()
    row.billing_status="PENDING_SALE"
    db.session.add(LoanWorkflowLog(application_id=row.id,action="PENDING_SALE_CREATED",
        from_status=row.status,to_status=row.status,user_id=None,remark=description,
        details=f"Dealer attached chassis {challan.chassis_no} for billing"))
    db.session.commit()
    return jsonify({"success":True,"application":_ser_workflow(row)})

@app.get("/api/loan-workflow/field-executives")
@require_auth
def loan_workflow_fe_list():
    _ensure_loan_workflow_tables()
    rows = User.query.filter(User.department.ilike("FE")).order_by(User.username.asc()).all()
    return jsonify({"success": True, "field_executives": [
        {"id": u.id, "username": u.username, "department": u.department} for u in rows
    ]})


def _billing_user_allowed():
    # Prefer the signed auth token for department/admin checks so billing
    # bridge reads do not depend on a stale or incomplete User lookup.
    payload = getattr(g, "current_user_payload", {}) or {}
    if payload.get("is_super_user"):
        return True
    token_dept = (payload.get("department") or "").strip().lower()
    if token_dept in {"billing","accounts","admin","head office","head-office"}:
        return True

    u=_workflow_user()
    if not u:return False
    if u.is_super_user:return True
    dept=(u.department or "").strip().lower()
    if dept in {"billing","accounts","admin","head office","head-office"}: return True
    return u.has_module_access("billing-pending-sales") or u.has_module_access("vahan-inventory")

@app.get("/api/billing/manual-pending-bills")
@require_auth
def billing_manual_pending_bills():
    if not _billing_user_allowed(): return _err("Billing approval rights required",403)
    _ensure_manual_pending_bill_table()
    rows=ManualPendingBill.query.filter(ManualPendingBill.status.in_(["PENDING_BILL","BILL_APPROVED"])).order_by(ManualPendingBill.date.desc(),ManualPendingBill.id.desc()).limit(500).all()
    return jsonify({"bills":[{
        "id":r.id,"pending_no":r.pending_no,"date":_iso(r.date),"dealer_id":r.dealer_id,
        "dealer_name":r.dealer.name if r.dealer else "","chassis_no":r.chassis_no,
        "product_name":r.product_name,"sale_amount":r.sale_amount,"payment_mode":r.payment_mode,
        "remarks":r.remarks,"status":r.status
    } for r in rows]})

@app.post("/api/billing/manual-pending-bills")
@require_auth
def billing_manual_pending_bill_create():
    if not _billing_user_allowed(): return _err("Billing entry rights required",403)
    _ensure_manual_pending_bill_table()
    data=request.get_json(silent=True) or {}
    dealer=Dealer.query.get(_i(data.get("dealer_id"),0))
    if not dealer:return _err("Dealer is required")
    chassis=(data.get("chassis_no") or "").strip()
    if not chassis:return _err("Chassis No. is required")
    amount=_f(data.get("sale_amount"),0)
    if amount<=0:return _err("Sale Amount must be greater than zero")
    vehicle=Vehicle.query.filter_by(chassis_no=chassis).first()
    if not vehicle:return _err("Chassis not found")
    row=ManualPendingBill(pending_no=f"PB-{dt.utcnow().strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}",
        date=_parse_date(data.get("date")) or date.today(),dealer_id=dealer.id,vehicle_id=vehicle.id,
        chassis_no=chassis,product_name=vehicle.model_name,sale_amount=amount,payment_mode="CASH",
        remarks=(data.get("remarks") or "").strip() or None,
        created_by=(getattr(g,"current_user_payload",{}) or {}).get("username"))
    db.session.add(row);db.session.commit()
    return jsonify({"success":True,"pending_bill":{"id":row.id,"pending_no":row.pending_no,"status":row.status}}),201

@app.post("/api/billing/manual-pending-bills/<int:row_id>/approve")
@require_auth
def billing_manual_pending_bill_approve(row_id):
    if not _billing_user_allowed(): return _err("Billing approval rights required",403)
    _ensure_manual_pending_bill_table()
    row=ManualPendingBill.query.get_or_404(row_id)
    if row.status!="PENDING_BILL":return _err("Only pending bills can be approved",409)
    row.status="BILL_APPROVED";row.approved_by=(getattr(g,"current_user_payload",{}) or {}).get("username");row.approved_at=dt.utcnow()
    db.session.commit()
    return jsonify({"success":True})

@app.get("/api/billing/vehicle-inventory")
@require_auth
def billing_vehicle_inventory():
    if not _billing_user_allowed():
        return _err("Billing approval rights required", 403)
    q=TaxInvoice.query
    from_date=(request.args.get("from_date") or "").strip()
    to_date=(request.args.get("to_date") or "").strip()
    name=(request.args.get("name") or "").strip()
    search=(request.args.get("search") or "").strip()
    if from_date:
        d=_parse_date(from_date)
        if d: q=q.filter(TaxInvoice.date >= d)
    if to_date:
        d=_parse_date(to_date)
        if d: q=q.filter(TaxInvoice.date <= d)
    if name:
        like=f"%{name}%"
        q=q.filter(or_(TaxInvoice.buyer_name.ilike(like),TaxInvoice.product_name.ilike(like)))
    if search:
        like=f"%{search}%"
        q=q.filter(or_(TaxInvoice.chassis_no.ilike(like),TaxInvoice.motor_no.ilike(like),
                       TaxInvoice.buyer_name.ilike(like),TaxInvoice.product_name.ilike(like)))
    rows=q.order_by(TaxInvoice.date.desc(),TaxInvoice.id.desc()).limit(2000).all()

    # Batch-load related masters. The previous implementation executed up to
    # 3 SQL queries per invoice (6,000 queries for 2,000 rows), which could
    # exceed Vercel Hobby serverless execution limits.
    product_names={x.product_name for x in rows if x.product_name}
    vehicle_ids={x.vehicle_id for x in rows if x.vehicle_id}
    chassis_names={x.chassis_no for x in rows if x.chassis_no}
    products={p.name:p for p in Product.query.filter(Product.name.in_(product_names)).all()} if product_names else {}
    vehicles={v.id:v for v in Vehicle.query.filter(Vehicle.id.in_(vehicle_ids)).all()} if vehicle_ids else {}
    productions={}
    if chassis_names:
        pv_rows=(ProductionVoucher.query.filter(ProductionVoucher.chassis_no.in_(chassis_names))
                 .order_by(ProductionVoucher.id.desc()).all())
        for pv in pv_rows:
            productions.setdefault(pv.chassis_no,pv)

    out=[]
    for ti in rows:
        product=products.get(ti.product_name)
        vehicle=vehicles.get(ti.vehicle_id)
        production=productions.get(ti.chassis_no)
        md=(production.date if production and production.date else
            (vehicle.date if vehicle else None))
        umrn=(product.umrn_code if product else None) or ""
        colour_code=(vehicle.colour_code if vehicle else None) or ""
        txt=f"{umrn}|{ti.chassis_no or ''}|{ti.motor_no or ''}|{md.strftime('%m%Y') if md else ''}|R1|{colour_code}|NA"
        safe=re.sub(r"[^A-Za-z0-9]","",ti.chassis_no or "") or re.sub(r"[^A-Za-z0-9]","",ti.bill_no or "") or f"INVOICE{ti.id}"
        out.append({"id":ti.id,"date":_iso(ti.date),"customer_name":ti.buyer_name or "",
                    "model_name":ti.product_name or "","chassis_no":ti.chassis_no or "",
                    "motor_no":ti.motor_no or "","umrn":umrn,
                    "manufacturing_month":md.strftime("%m%Y") if md else "",
                    "colour_code":colour_code,"txt":txt,"filename":safe+".TXT"})
    return jsonify({"vehicles":out})


@app.post("/api/billing/vehicle-inventory/download-txt")
@require_auth
def billing_vehicle_inventory_download_txt():
    if not _billing_user_allowed():
        return _err("Billing approval rights required", 403)
    data=request.get_json(silent=True) or {}
    ids=[_i(x,0) for x in (data.get("invoice_ids") or [])]
    ids=[x for x in ids if x]
    if not ids:return _err("Select at least one vehicle.")
    rows=TaxInvoice.query.filter(TaxInvoice.id.in_(ids)).order_by(TaxInvoice.id.asc()).all()
    if not rows:return _err("Selected vehicles not found.",404)
    product_names={x.product_name for x in rows if x.product_name}
    vehicle_ids={x.vehicle_id for x in rows if x.vehicle_id}
    chassis_names={x.chassis_no for x in rows if x.chassis_no}
    products={p.name:p for p in Product.query.filter(Product.name.in_(product_names)).all()} if product_names else {}
    vehicles={v.id:v for v in Vehicle.query.filter(Vehicle.id.in_(vehicle_ids)).all()} if vehicle_ids else {}
    productions={}
    if chassis_names:
        for pv in (ProductionVoucher.query.filter(ProductionVoucher.chassis_no.in_(chassis_names))
                   .order_by(ProductionVoucher.id.desc()).all()):
            productions.setdefault(pv.chassis_no,pv)
    lines=[]
    for ti in rows:
        product=products.get(ti.product_name)
        vehicle=vehicles.get(ti.vehicle_id)
        production=productions.get(ti.chassis_no)
        md=(production.date if production and production.date else
            (vehicle.date if vehicle else None))
        umrn=(product.umrn_code if product else None) or ""
        colour_code=(vehicle.colour_code if vehicle else None) or ""
        lines.append(f"{umrn}|{ti.chassis_no or ''}|{ti.motor_no or ''}|{md.strftime('%m%Y') if md else ''}|R1|{colour_code}|NA")
    from flask import Response
    content="\r\n".join(lines)+"\r\n"
    return Response(content, mimetype="text/plain; charset=utf-8",
                    headers={"Content-Disposition":'attachment; filename="VahanInventoryTXT.TXT"'})

@app.get("/api/billing/pending-sales")
@require_auth
def billing_pending_sales():
    _ensure_loan_workflow_tables()
    if not _billing_user_allowed(): return _err("Billing approval rights required",403)
    rows=(LoanWorkflow.query.filter(LoanWorkflow.status=="DO_APPROVED",
                                     LoanWorkflow.billing_status.in_(["NOT_REQUESTED","PENDING_SALE","BILL_APPROVED"]))
          .order_by(db.func.coalesce(LoanWorkflow.billing_requested_at, LoanWorkflow.approved_at).desc(),
                    LoanWorkflow.id.desc()).limit(500).all())
    return jsonify({"applications":[_ser_workflow(x) for x in rows]})

@app.post("/api/billing/pending-sales/<int:row_id>/approve")
@require_auth
def billing_pending_sale_approve(row_id):
    _ensure_loan_workflow_tables()
    if not _billing_user_allowed(): return _err("Billing approval rights required",403)
    row=LoanWorkflow.query.get_or_404(row_id)
    if row.status!="DO_APPROVED" or row.billing_status!="PENDING_SALE":
        return _err("Only Pending Sales can be approved",409)
    row.billing_status="BILL_APPROVED"
    row.billing_approved_by=getattr(g,"current_user_payload",{}).get("username") or str(getattr(g,"current_user_id",""))
    row.billing_approved_at=dt.utcnow()
    db.session.add(LoanWorkflowLog(application_id=row.id,action="BILLING_APPROVED",
        from_status=row.status,to_status=row.status,user_id=getattr(g,"current_user_id",None),
        details="Billing approval granted"))
    db.session.commit()
    return jsonify({"success":True,"application":_ser_workflow(row)})

@app.post("/api/billing/pending-sales/<int:row_id>/generate-bill")
@require_auth
def billing_pending_sale_generate_bill(row_id):
    _ensure_loan_workflow_tables()
    if not _billing_user_allowed(): return _err("Billing approval rights required",403)
    row=LoanWorkflow.query.get_or_404(row_id)
    if row.billing_status!="BILL_APPROVED": return _err("Billing approval is required before Bill generation",403)
    if row.billing_invoice_id:
        inv=TaxInvoice.query.get(row.billing_invoice_id)
        return jsonify({"success":True,"invoice":ser_ti(inv),"application":_ser_workflow(row)}) if inv else _err("Linked invoice not found",404)
    if not row.billing_vehicle_id:return _err("No chassis is attached to this Pending Sale")
    challan=DeliveryChallan.query.filter_by(vehicle_id=row.billing_vehicle_id,dealer_id=row.dealer_id,cancelled=False).order_by(DeliveryChallan.id.desc()).first()
    if not challan:return _err("Delivery Challan for selected chassis is required before billing",409)
    if TaxInvoice.query.filter_by(delivery_challan_id=challan.id).first():return _err("This Delivery Challan already has a Tax Invoice",409)
    customer=row.customer
    product=Product.query.filter_by(name=challan.product_name).first()
    sale=round(row.billing_sale_amount or challan.sale_value or 0,2)
    ti=TaxInvoice(bill_no=f"GRD/{TaxInvoice.query.count()+1001}",date=date.today(),
        delivery_challan_id=challan.id,vehicle_id=challan.vehicle_id,
        buyer_name=customer.full_name if customer else None,buyer_mobile=customer.phone if customer else None,
        buyer_address=customer.address if customer else None,buyer_state=customer.state if customer else None,
        dealer_name=challan.dealer.name if challan.dealer else None,product_name=challan.product_name,
        chassis_no=challan.chassis_no,motor_no=challan.motor_no,controller_no=challan.controller_no,
        other_desc=challan.other,colour=challan.colour,sale_amount=sale,gst_sale_amount=sale,
        gst_rate=product.gst_rate if product else 5,amount_received=0,mode_term="CHFPL",
        remarks=row.dealer_description)
    db.session.add(ti)
    if challan.vehicle:challan.vehicle.stage="Tax Invoice"
    db.session.flush()
    row.billing_invoice_id=ti.id
    row.billing_status="BILLED"
    db.session.add(LoanWorkflowLog(application_id=row.id,action="BILL_GENERATED",
        from_status=row.status,to_status=row.status,user_id=getattr(g,"current_user_id",None),
        details=f"Tax Invoice {ti.bill_no} generated"))
    db.session.commit()
    return jsonify({"success":True,"invoice":ser_ti(ti),"application":_ser_workflow(row)})

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
        row.do_no = row.do_no or f"DO-{now.strftime('%Y%m%d')}-{row.id:06d}"
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
def _ensure_simple_master_columns():
    try:
        with db.engine.begin() as conn:
            inspector=inspect(conn)
            if not inspector.has_table("simple_master"): return
            columns={x["name"] for x in inspector.get_columns("simple_master")}
            additions={"color_hex":"VARCHAR(20)","color_hex2":"VARCHAR(20)","is_double_tone":"BOOLEAN DEFAULT FALSE"}
            for name,sql_type in additions.items():
                if name not in columns:
                    if db.engine.dialect.name=="postgresql":
                        conn.execute(text(f'ALTER TABLE "simple_master" ADD COLUMN IF NOT EXISTS {name} {sql_type}'))
                    else:
                        conn.execute(text(f'ALTER TABLE simple_master ADD COLUMN {name} {sql_type}'))
    except Exception as exc:
        db.session.rollback()
        return str(exc)
    return None

SIMPLE_KINDS = {"party", "battery-maker", "rto", "financer", "mechanic", "fabricator", "bank", "colour", "salesman"}

# Representative colour shades for the Colour Master. These are intentionally
# editable in the master later; they are only used to fill currently blank
# HEX values from the colour name so existing manual values are never replaced.
_COLOUR_HEX = {
    "black":"#000000","white":"#FFFFFF","blue":"#0000FF","red":"#FF0000",
    "green":"#008000","yellow":"#FFFF00","orange":"#FFA500","brown":"#8B4513",
    "grey":"#808080","gray":"#808080","silver":"#C0C0C0","gold":"#FFD700",
    "pink":"#FFC0CB","purple":"#800080","violet":"#8F00FF","maroon":"#800000",
    "navy":"#000080","teal":"#008080","aqua":"#00FFFF","cyan":"#00FFFF",
    "lime":"#00FF00","olive":"#808000","cream":"#FFFDD0","beige":"#F5F5DC",
    "magenta":"#FF00FF","mustard":"#FFDB58","peach":"#FFE5B4","coral":"#FF7F50",
    "cherry":"#D2042D","wine":"#722F37","coffee":"#6F4E37","chocolate":"#7B3F00",
    "khaki":"#C3B091","army":"#4B5320","turquoise":"#40E0D0",
    "sky":"#87CEEB","royal":"#4169E1","indigo":"#4B0082","lemon":"#FFF44F",
    "rust":"#B7410E","tan":"#D2B48C","pearl":"#EAE0C8","ivory":"#FFFFF0",
    "bronze":"#CD7F32","copper":"#B87333","mint":"#98FF98","lavender":"#E6E6FA",
    "plum":"#8E4585","burgundy":"#800020","emerald":"#50C878",
    "forest":"#228B22","grass":"#7CFC00","dark":"#333333",
}

def _guess_colour_hex(name):
    """Return a representative HEX from a colour name, or None if unknown."""
    import re
    raw = (name or "").strip().lower()
    if not raw:
        return None, None
    # Normalize punctuation/spaces but keep words for two-tone detection.
    words = re.findall(r"[a-z]+", raw)
    if not words:
        return None, None

    # More specific combinations first.
    combos = {
        ("dark","green"): "#006400", ("dark","orange"): "#FF8C00",
        ("dark","blue"): "#00008B", ("dark","red"): "#8B0000",
        ("dark","brown"): "#654321", ("dark","yellow"): "#B8860B",
        ("light","blue"): "#ADD8E6", ("light","green"): "#90EE90",
        ("light","brown"): "#A0522D", ("light","pink"): "#FFB6C1",
        ("light","grey"): "#D3D3D3", ("light","gray"): "#D3D3D3",
        ("sky","blue"): "#87CEEB", ("royal","blue"): "#4169E1",
        ("navy","blue"): "#000080", ("forest","green"): "#228B22",
        ("army","green"): "#4B5320", ("aqua","green"): "#00A86B",
        ("cornflower","blue"): "#6495ED", ("cherry","red"): "#D2042D",
        ("cherry","black"): "#3B0A0A", ("blue","white"): "#EAF4FF",
        ("blue","black"): "#111A3A", ("brown","black"): "#3B2415",
        ("brown","white"): "#D8C3A5", ("angori","black"): "#3B2F2F",
    }
    for n in range(len(words), 1, -1):
        for start in range(len(words)-n+1):
            key = tuple(words[start:start+n])
            if key in combos:
                primary = combos[key]
                # If another recognized colour follows, use it as a second tone.
                for w in words:
                    if w in _COLOUR_HEX and _COLOUR_HEX[w] != primary:
                        return primary, _COLOUR_HEX[w]
                return primary, None

    primary = None
    second = None
    for w in words:
        if w in _COLOUR_HEX:
            if primary is None:
                primary = _COLOUR_HEX[w]
            elif second is None and _COLOUR_HEX[w] != primary:
                second = _COLOUR_HEX[w]
    # Automotive shade names with no standard dictionary match get a neutral
    # representative rather than being left without a preview.
    if primary is None:
        if "angori" in words:
            primary = "#B89B72"
        elif "aqua" in words:
            primary = "#00FFFF"
        elif "cornflower" in words:
            primary = "#6495ED"
        else:
            primary = "#D9D9D9"
    return primary, second

def _autofill_colour_hexes(rows):
    changed = False
    for row in rows:
        if row.kind != "colour":
            continue
        primary, second = _guess_colour_hex(row.name)
        if primary and not (row.color_hex or "").strip():
            row.color_hex = primary
            changed = True
        # Preserve an existing explicit second tone. Only fill it when the
        # name clearly contains another recognized colour word.
        if second and not (row.color_hex2 or "").strip():
            row.color_hex2 = second
            changed = True
    if changed:
        db.session.commit()




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
    if kind == "colour":
        row.color_hex = (data.get("color_hex") or "").strip() or None
        row.is_double_tone = bool(data.get("is_double_tone"))
        row.color_hex2 = (data.get("color_hex2") or "").strip() or None if row.is_double_tone else None
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
    _ensure_simple_master_columns()
    if kind not in SIMPLE_KINDS:
        return _err(f"Unknown master kind '{kind}'", 404)

    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        row = _save_simple_master(kind, data)
        return jsonify(ser_simple(row)), 201

    # Salesman Master is seeded/synchronised from both sources already
    # present in the database: User Master users whose department is Salesman
    # and Dealer Master salesman values. This preserves all existing data and
    # means a new Salesman user appears in the master automatically without
    # having to update every dealer record.
    if kind == "salesman":
        existing = {
            (r.name or "").strip().lower()
            for r in SimpleMaster.query.filter_by(kind="salesman").all()
            if (r.name or "").strip()
        }
        source_names = set()
        for u in User.query.filter(
            db.func.lower(db.func.trim(User.department)) == "salesman"
        ).all():
            name = (u.username or "").strip()
            if name:
                source_names.add(name)
        for d in Dealer.query.filter(Dealer.salesman.isnot(None)).all():
            name = (d.salesman or "").strip()
            if name:
                source_names.add(name)
        for name in sorted(source_names, key=lambda x: x.lower()):
            if name.lower() in existing:
                continue
            db.session.add(SimpleMaster(kind="salesman", name=name))
        if source_names:
            db.session.commit()

    rows = SimpleMaster.query.filter_by(kind=kind).order_by(SimpleMaster.name).all()
    if kind == "colour":
        _autofill_colour_hexes(rows)
    return jsonify([ser_simple(r) for r in rows])


@app.route("/api/masters/<kind>/<int:row_id>", methods=["PUT", "DELETE"])
@require_auth
def simple_masters_detail(kind, row_id):
    _ensure_simple_master_columns()
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
@app.get("/api/salesmen")
@require_auth
def salesmen():
    _ensure_auth_columns()
    rows = User.query.filter(
        db.func.lower(db.func.trim(User.department)) == "salesman"
    ).order_by(User.username).all()
    return jsonify({"salesmen": [{"id": u.id, "username": u.username} for u in rows]})


@app.route("/api/dealers", methods=["GET", "POST"])
@require_auth
def dealers():
    _ensure_dealer_category_column()
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
        d.dealer_category = (data.get("dealer_category") or "dealer").strip().lower()
        if d.dealer_category not in {"showroom", "dealer"}: d.dealer_category = "dealer"
        d.state = data.get("state")
        d.state_code = data.get("state_code")
        d.pan = data.get("pan")
        d.bank_name = data.get("bank_name")
        d.bank_account_no = data.get("bank_account_no")
        d.bank_ifsc = data.get("bank_ifsc")
        d.salesman = data.get("salesman")
        d.code = data.get("code") or None
        d.blocked = bool(data.get("blocked"))
        d.purchase_access = bool(data.get("purchase_access"))
        d.login_id = data.get("login_id")
        if data.get("password"):
            d.set_password(data.get("password"))
        db.session.add(d)
        db.session.commit()
        return jsonify(ser_dealer(d)), 201

    dealers_ = Dealer.query.order_by(Dealer.name).all()
    next_code_num = Dealer.query.count() + 1
    salesman_users = User.query.filter(
        db.func.lower(db.func.trim(User.department)) == "salesman"
    ).order_by(User.username).all()
    return jsonify({"dealers": [ser_dealer(d) for d in dealers_],
                     "suggested_code": f"A-{next_code_num:02d}",
                     "salesmen": [{"id": u.id, "username": u.username} for u in salesman_users]})


def _ensure_dealer_category_column():
    try:
        cols={c["name"] for c in inspect(db.engine).get_columns("dealer")}
        if "dealer_category" not in cols:
            with db.engine.begin() as conn:
                conn.execute(text("ALTER TABLE dealer ADD COLUMN dealer_category VARCHAR(20) DEFAULT 'dealer'"))
    except Exception as exc:
        print(f"[dealer-category] schema check failed: {exc}")

def _ensure_manual_pending_bill_table():
    try:
        ManualPendingBill.__table__.create(db.engine, checkfirst=True)
    except Exception as exc:
        print(f"[manual-pending-bill] schema check failed: {exc}")

@app.get("/api/dealer-list")
@require_auth
def dealer_list():
    # Lightweight dealer dropdown endpoint. Avoid the full Dealer Master payload
    # and salesman-user query on pages that only need dealer id/code/name.
    rows=(Dealer.query
          .filter(Dealer.blocked.is_(False))
          .order_by(Dealer.name.asc())
          .all())
    return jsonify({"dealers":[{"id":d.id,"code":d.code,"name":d.name,"salesman":d.salesman} for d in rows]})

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
    if not d.purchase_access: return jsonify({"registered":False,"purchase_access":False,"purchases":[]})
    if (d.registration_type or "registered") != "registered": return jsonify({"registered":False,"purchase_access":True,"purchases":[]})
    rows=(DeliveryChallan.query.filter_by(dealer_id=d.id,cancelled=False)
          .order_by(DeliveryChallan.date.desc(),DeliveryChallan.id.desc()).limit(500).all())
    return jsonify({"registered":True,"purchases":[ser_dc(x) for x in rows]})

@app.post("/api/dealer/customer-invoice")
@require_dealer_auth
def dealer_customer_invoice():
    d=_dealer_current()
    if not d: return _err("Dealer not found",404)
    if not d.purchase_access: return _err("Purchase access is not enabled for this dealer.",403)
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
    # Older production databases may not yet have the newer User columns.
    # Ensure them before any User ORM query so User Master / Add User cannot 500.
    _ensure_auth_columns()
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
        # Salesman dealer scope comes from Dealer Master.salesman. Do not
        # persist manual dealer assignments for salesman users.
        dealer_ids = [] if u.department.lower() == "salesman" else (data.get("assigned_dealer_ids") or [])
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
                           colour_code=pv.colour_code, other=pv.other,
                           battery_maker=pv.battery_maker, battery_no1=pv.battery_no1,
                           battery_no2=pv.battery_no2, battery_no3=pv.battery_no3,
                           battery_no4=pv.battery_no4, stage="Manufacturing")
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


@app.route("/api/production-vouchers/<int:voucher_id>", methods=["GET", "PUT", "DELETE"])
@require_auth
def production_voucher_detail(voucher_id):
    pv = ProductionVoucher.query.get_or_404(voucher_id)
    if request.method == "GET":
        return jsonify(ser_pv(pv))
    if request.method == "PUT":
        data = request.get_json(silent=True) or {}
        new_chassis = (data.get("chassis_no") or pv.chassis_no).strip()
        if new_chassis != pv.chassis_no and Vehicle.query.filter(Vehicle.chassis_no == new_chassis, Vehicle.id != getattr(pv.vehicle, "id", -1)).first():
            return _err(f"Chassis No. '{new_chassis}' already exists.")
        for field in ("vou_no","date","product_name","quantity","chassis_no","motor_no","controller_no",
                      "differential_no","colour","colour_code","other","battery_maker","battery_no1",
                      "battery_no2","battery_no3","battery_no4","toolkit","jack","charger","mat",
                      "stapney","front_glass","h_lock","center_lock","remarks","machnic"):
            if field in data:
                value = data.get(field)
                if field == "date": value = _parse_date(value)
                elif field == "quantity": value = _i(value, 1)
                pv.__setattr__(field, value)
        if pv.vou_no and ProductionVoucher.query.filter(ProductionVoucher.vou_no == pv.vou_no, ProductionVoucher.id != pv.id).first():
            return _err(f"Vou. No. '{pv.vou_no}' is already in use.")
        # If a formula was selected in Edit, refresh the voucher's raw-material
        # lines from that finished product's Production Formula.
        formula_name = (data.get("formula_name") or "").strip()
        if formula_name:
            pv.items.clear()
            for fl in ProductionFormula.query.filter_by(
                product_name=pv.product_name, formula_name=formula_name
            ).all():
                pv.items.append(ProductionVoucherItem(
                    item_code=fl.raw_item_code, item_name=fl.raw_item_name,
                    qty=fl.qty, unit=fl.unit
                ))

        vehicle = Vehicle.query.filter_by(chassis_no=pv.chassis_no).first()
        if vehicle:
            vehicle.model_name = pv.product_name
            vehicle.date = pv.date
            vehicle.motor_no = pv.motor_no
            vehicle.controller_no = pv.controller_no
            vehicle.differential_no = pv.differential_no
            vehicle.colour = pv.colour
            vehicle.colour_code = pv.colour_code
            vehicle.other = pv.other
        vehicle = Vehicle.query.filter_by(chassis_no=pv.chassis_no).first()
        if vehicle:
            vehicle.battery_maker=pv.battery_maker
            vehicle.battery_no1=pv.battery_no1
            vehicle.battery_no2=pv.battery_no2
            vehicle.battery_no3=pv.battery_no3
            vehicle.battery_no4=pv.battery_no4
        db.session.commit()
        return jsonify(ser_pv(pv))
    # DELETE
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

        # Snapshot the battery fitted on the vehicle at the moment of delivery.
        # This keeps the Delivery Challan/Register historical even if the vehicle
        # later gets a Battery Swap / Exchange.
        battery_maker = data.get("battery_maker")
        if battery_maker in (None, ""):
            battery_maker = getattr(vehicle, "battery_maker", None)
        battery_nos = [data.get(f"battery_no{i}") for i in range(1, 5)]
        vehicle_battery_nos = [getattr(vehicle, f"battery_no{i}", None) for i in range(1, 5)]
        battery_nos = [
            battery_nos[i] if battery_nos[i] not in (None, "") else vehicle_battery_nos[i]
            for i in range(4)
        ]
        dc = DeliveryChallan(
            challan_no=data.get("challan_no"), date=_parse_date(data.get("date")) or date.today(),
            dealer_id=dealer.id, vehicle_id=vehicle.id,
            destination=data.get("destination") or " ".join(x for x in [dealer.address1, dealer.address2] if x),
            product_name=vehicle.model_name, chassis_no=vehicle.chassis_no,
            motor_no=vehicle.motor_no, controller_no=vehicle.controller_no,
            differential_no=vehicle.differential_no, colour=vehicle.colour, other=vehicle.other,
            battery_maker=battery_maker, battery_no1=battery_nos[0],
            battery_no2=battery_nos[1], battery_no3=battery_nos[2],
            battery_no4=battery_nos[3],
            toolkit=bool(data.get("toolkit", True)), jack=bool(data.get("jack", True)),
            charger=bool(data.get("charger", True)), center_lock=bool(data.get("center_lock", False)),
            mat=bool(data.get("mat", True)), stapney=bool(data.get("stapney", False)),
            front_glass=bool(data.get("front_glass", False)), h_lock=bool(data.get("h_lock", False)),
            salesman=data.get("salesman") or dealer.salesman,
            sale_bill_no=data.get("sale_bill_no"),
            sale_value=_f(data.get("sale_value")),
            dealer_page_no=(data.get("dealer_page_no") or "").strip() or None,
            remarks1=data.get("remarks1"),
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
    available_payload = [ser_vehicle(v) for v in available_vehicles]

    next_no = (db.session.query(db.func.max(DeliveryChallan.id)).scalar() or 0) + 1
    return jsonify({
        "challans": out,
        "page": page,
        "per_page": per_page,
        "total": total,
        "total_pages": (total + per_page - 1) // per_page if total else 1,
        "available_vehicles": available_payload,
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
        dc.battery_maker = getattr(new_vehicle, "battery_maker", None)
        dc.battery_no1 = getattr(new_vehicle, "battery_no1", None)
        dc.battery_no2 = getattr(new_vehicle, "battery_no2", None)
        dc.battery_no3 = getattr(new_vehicle, "battery_no3", None)
        dc.battery_no4 = getattr(new_vehicle, "battery_no4", None)
        new_vehicle.stage = "Delivery Challan"
        new_vehicle.dealer_name = new_dealer.name

    if "challan_no" in data: dc.challan_no = data.get("challan_no") or dc.challan_no
    if "date" in data: dc.date = _parse_date(data.get("date")) or dc.date
    if "destination" in data: dc.destination = data.get("destination")
    # Never erase a historical battery snapshot just because an older client
    # omitted these fields from its PUT payload.
    for field in ("battery_maker", "battery_no1", "battery_no2", "battery_no3", "battery_no4"):
        if field in data: setattr(dc, field, data.get(field))
    for field in ("toolkit", "jack", "charger", "center_lock", "mat", "stapney", "front_glass", "h_lock"):
        if field in data: setattr(dc, field, bool(data.get(field)))
    if "salesman" in data: dc.salesman = data.get("salesman")
    if "sale_bill_no" in data: dc.sale_bill_no = data.get("sale_bill_no")
    if "sale_value" in data: dc.sale_value = _f(data.get("sale_value"), dc.sale_value)
    if "dealer_page_no" in data: dc.dealer_page_no = (data.get("dealer_page_no") or "").strip() or None
    if "remarks1" in data: dc.remarks1 = data.get("remarks1")
    if "remarks2" in data: dc.remarks2 = data.get("remarks2")
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
        if challan.cancelled:
            return _err("Cancelled Delivery Challan cannot be invoiced. Create a new Delivery Challan.")
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
    active_cn = CreditNote.query.filter_by(original_invoice_id=ti.id, status="ACTIVE").first()
    if request.method == "GET":
        return jsonify(ser_ti(ti))
    if request.method == "DELETE":
        if active_cn:
            return _err("This Tax Invoice is linked to an active Credit Note and cannot be deleted.", 400)
        if ti.vehicle:
            ti.vehicle.stage = "Delivery Challan"
        db.session.delete(ti)
        db.session.commit()
        return jsonify({"deleted": True})

    if active_cn:
        return _err("This Tax Invoice has an active Credit Note and cannot be edited.", 400)

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
    active_cn = CreditNote.query.filter_by(original_invoice_id=ti.id, status="ACTIVE").first()
    if active_cn and ti.cancelled:
        return _err("This invoice is already cancelled through Credit Note.", 400)
    if active_cn:
        return _err("This Tax Invoice has an active Credit Note; use the Credit Note workflow.", 400)
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
# Vouchers > Credit Note — formal reversal of a Tax Invoice
# ---------------------------------------------------------------------------
@app.route("/api/credit-notes", methods=["GET", "POST"])
@require_auth
def credit_notes():
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        invoice_id = _i(data.get("invoice_id"), 0)
        if not invoice_id:
            return _err("Please choose the original Tax Invoice.")
        ti = TaxInvoice.query.get_or_404(invoice_id)
        if ti.cancelled:
            return _err("This Tax Invoice is already cancelled.")
        existing = CreditNote.query.filter_by(
            original_invoice_id=ti.id, status="ACTIVE"
        ).first()
        if existing:
            return _err(f"Credit Note {existing.credit_note_no} already exists for this invoice.")

        reason = (data.get("reason") or "").strip()
        if not reason:
            return _err("Credit Note reason is required.")

        cn = CreditNote(
            credit_note_no="TEMP",
            date=_parse_date(data.get("date")) or date.today(),
            original_invoice_id=ti.id,
            original_bill_no=ti.bill_no,
            delivery_challan_id=ti.delivery_challan_id,
            vehicle_id=ti.vehicle_id,
            dealer_name=ti.dealer_name,
            buyer_name=ti.buyer_name,
            product_name=ti.product_name,
            chassis_no=ti.chassis_no,
            reason=reason,
            taxable_amount=ti.taxable_value,
            tax_amount=ti.tax_amount,
            total_amount=ti.bill_total,
            remarks=data.get("remarks"),
            status="ACTIVE",
            created_by=str(getattr(g, "current_user_payload", {}).get("username") or
                           getattr(g, "current_user_payload", {}).get("user_id") or "user"),
        )
        db.session.add(cn)
        db.session.flush()
        cn.credit_note_no = f"CN/{cn.date.strftime('%Y')}/{cn.id:06d}"

        # Keep the original invoice as an immutable historical document.
        # The actual stock movement is deliberately NOT changed here; the
        # operator cancels the Delivery Challan next, then raises a new DC.
        ti.cancelled = True
        db.session.commit()
        return jsonify(ser_credit_note(cn)), 201

    page = max(1, _i(request.args.get("page"), 1))
    per_page = min(200, max(1, _i(request.args.get("per_page"), 50)))
    search = (request.args.get("search") or "").strip()
    q = CreditNote.query.order_by(CreditNote.date.desc(), CreditNote.id.desc())
    if search:
        like = f"%{search}%"
        q = q.filter(db.or_(
            CreditNote.credit_note_no.ilike(like),
            CreditNote.original_bill_no.ilike(like),
            CreditNote.chassis_no.ilike(like),
            CreditNote.buyer_name.ilike(like),
        ))
    total = q.count()
    rows = q.offset((page - 1) * per_page).limit(per_page).all()
    return jsonify({
        "credit_notes": [ser_credit_note(x) for x in rows],
        "page": page, "per_page": per_page, "total": total,
        "total_pages": max(1, (total + per_page - 1) // per_page),
    })


@app.route("/api/credit-notes/legacy-scan")
@require_auth
def credit_notes_legacy_scan():
    """Find imported historical invoices that used the old ...CN convention.

    This is intentionally read-only. It does not rewrite historical invoice
    numbers/chassis values automatically.
    """
    rows = (TaxInvoice.query
            .filter(db.or_(
                TaxInvoice.chassis_no.ilike("%CN"),
                TaxInvoice.bill_no.ilike("%CN"),
            ))
            .order_by(TaxInvoice.date.desc(), TaxInvoice.id.desc())
            .limit(1000).all())
    out = []
    for ti in rows:
        existing = CreditNote.query.filter_by(original_invoice_id=ti.id, status="ACTIVE").first()
        out.append({
            **ser_ti(ti),
            "legacy_cn_detected": True,
            "formal_credit_note_no": existing.credit_note_no if existing else None,
            "legacy_repaired": bool(ti.cancelled or existing),
        })
    return jsonify({"invoices": out, "count": len(out)})


@app.route("/api/credit-notes/legacy-repair/<int:invoice_id>", methods=["POST"])
@require_auth
def credit_note_legacy_repair(invoice_id):
    """Convert one imported ...CN invoice into a clearly-marked legacy reversal.

    We preserve the imported bill/chassis text exactly. If a matching vehicle
    exists and no other active Delivery Challan/Tax Invoice uses it, the
    vehicle is returned to Manufacturing so it can be re-issued correctly.
    """
    ti = TaxInvoice.query.get_or_404(invoice_id)
    if not (str(ti.chassis_no or "").upper().endswith("CN") or
            str(ti.bill_no or "").upper().endswith("CN")):
        return _err("This invoice does not match the legacy CN pattern.")

    existing = CreditNote.query.filter_by(original_invoice_id=ti.id, status="ACTIVE").first()
    if existing:
        return jsonify(ser_credit_note(existing))

    base_chassis = str(ti.chassis_no or "")
    if base_chassis.upper().endswith("CN"):
        base_chassis = base_chassis[:-2].rstrip(" -/")
    vehicle = ti.vehicle
    if not vehicle and base_chassis:
        vehicle = Vehicle.query.filter_by(chassis_no=base_chassis).first()

    # Do not guess the new production/chassis history. Preserve the imported
    # invoice exactly and only repair stock state when there is an unambiguous
    # vehicle match with no later active transaction.
    if vehicle:
        active_dc = DeliveryChallan.query.filter_by(vehicle_id=vehicle.id, cancelled=False).first()
        active_ti = TaxInvoice.query.filter(
            TaxInvoice.vehicle_id == vehicle.id,
            TaxInvoice.id != ti.id,
            TaxInvoice.cancelled == False
        ).first()
        if not active_dc and not active_ti:
            vehicle.stage = "Manufacturing"
            vehicle.dealer_name = None

    cn = CreditNote(
        credit_note_no="TEMP",
        date=ti.date or date.today(),
        original_invoice_id=ti.id,
        original_bill_no=ti.bill_no,
        delivery_challan_id=ti.delivery_challan_id,
        vehicle_id=vehicle.id if vehicle else ti.vehicle_id,
        dealer_name=ti.dealer_name,
        buyer_name=ti.buyer_name,
        product_name=ti.product_name,
        chassis_no=ti.chassis_no,
        reason="Legacy imported CN record — converted from old CN suffix convention",
        taxable_amount=ti.taxable_value,
        tax_amount=ti.tax_amount,
        total_amount=ti.bill_total,
        remarks="Historical import repair. Original bill/chassis text preserved.",
        status="ACTIVE",
        created_by="legacy-import-repair",
    )
    db.session.add(cn)
    db.session.flush()
    cn.credit_note_no = f"CN/LEGACY/{cn.id:06d}"
    ti.cancelled = True
    ti.billing_remarks = ((ti.billing_remarks or "").strip() +
                          " | Legacy CN repaired into formal Credit Note").strip(" |")
    db.session.commit()
    return jsonify(ser_credit_note(cn)), 201


@app.route("/api/credit-notes/<int:credit_note_id>/cancel-challan", methods=["POST"])
@require_auth
def credit_note_cancel_challan(credit_note_id):
    cn = CreditNote.query.get_or_404(credit_note_id)
    if cn.status != "ACTIVE":
        return _err("Only an active Credit Note can cancel its Delivery Challan.")
    if not cn.delivery_challan_id:
        return _err("No Delivery Challan is linked to this Credit Note.")
    dc = DeliveryChallan.query.get_or_404(cn.delivery_challan_id)
    if not dc.cancelled:
        dc.cancelled = True
        if dc.vehicle:
            dc.vehicle.stage = "Manufacturing"
            dc.vehicle.dealer_name = None
        db.session.commit()
    return jsonify(ser_dc(dc))


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

    # Keep the register fast in the serverless API: load only the latest 500 bills\n    # and eager-load their item rows to avoid an N+1 query pattern.\n    try:\n        limit = min(max(int(request.args.get("limit", 500)), 1), 500)\n    except (TypeError, ValueError):\n        limit = 500\n    rows = (PurchaseBill.query\n            .options(joinedload(PurchaseBill.items))\n            .order_by(PurchaseBill.date.desc(), PurchaseBill.id.desc())\n            .limit(limit)\n            .all())\n    return jsonify([ser_pb(b) for b in rows])


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
def _old_rickshaw_record_next():
    return (db.session.query(db.func.max(OldRickshaw.record_no)).scalar() or 0) + 1


def _battery_fields(obj):
    return [getattr(obj, f"battery_no{i}", None) for i in range(1, 5)]


def _battery_has(obj):
    return any(_battery_fields(obj))


def _battery_set(obj, maker, nums):
    obj.battery_maker=maker
    for i in range(1,5):
        setattr(obj, f"battery_no{i}", nums[i-1] if i <= len(nums) else None)


def _old_sale_to_dealer(rec, data):
    dealer_id=data.get("dealer_id")
    if not dealer_id:return _err("Dealer is required for Old Rickshaw sale.")
    dealer=Dealer.query.get(dealer_id)
    if not dealer:return _err("Dealer not found.")
    if rec.status != "available":return _err("Only an available Old Rickshaw can be sold.")
    rec.status="sold"
    rec.sale_date=_parse_date(data.get("sale_date")) or date.today()
    rec.sale_dealer_id=dealer.id
    rec.dealer_id=dealer.id
    rec.sale_ref_no=(data.get("sale_ref_no") or "").strip() or None
    rec.sale_type=(data.get("sale_type") or "").strip().lower() or rec.sale_type
    rec.do_number=(data.get("do_number") or "").strip() or rec.do_number
    rec.out_name=(data.get("out_name") or "").strip() or rec.out_name
    rec.sale_amount=_f(data.get("sale_amount"),0)
    rec.file_charge=_f(data.get("file_charge"),0)
    rec.loan_amount=_f(data.get("loan_amount"),0)
    rec.down_payment=_f(data.get("down_payment"),0)
    rec.sold_to=(data.get("sold_to") or dealer.name).strip()
    rec.dealer_page_no=(data.get("dealer_page_no") or "").strip() or rec.dealer_page_no
    rec.sp_no=(data.get("sp_no") or "").strip() or rec.sp_no
    rec.sold_amount=rec.sale_amount
    if "receipt_amount" in data:
        rec.receipt_amount=_f(data.get("receipt_amount"),0)
    if "receipt_no" in data:
        rec.receipt_no=(data.get("receipt_no") or "").strip() or None
    if "ledger" in data:
        rec.ledger=(data.get("ledger") or "").strip() or None
    if "resale_date" in data:
        rec.resale_date=_parse_date(data.get("resale_date"))
    if "resale_ledger" in data:
        rec.resale_ledger=(data.get("resale_ledger") or "").strip() or None
    return dealer


@app.route("/api/old-rickshaws", methods=["GET", "POST"])
@require_auth
def old_rickshaws():
    if request.method=="POST":
        data=request.get_json(silent=True) or {}
        action=(data.get("action") or "purchase").strip().lower()
        if action=="sale":
            rec=OldRickshaw.query.get(data.get("id"))
            if not rec:return _err("Old Rickshaw record not found.",404)
            _old_sale_to_dealer(rec,data)
            db.session.commit()
            return jsonify(ser_old_rickshaw(rec))
        vehicle_reg_no=(data.get("vehicle_reg_no") or "").strip()
        if not vehicle_reg_no:return _err("Vehicle Reg. No. is required.")
        rec=OldRickshaw(
            record_no=_old_rickshaw_record_next(),
            vou_no=data.get("vou_no"),date=_parse_date(data.get("date")) or date.today(),
            source=(data.get("source") or "manual").strip().lower(),
            chfpl_ref_no=(data.get("chfpl_ref_no") or "").strip() or None,
            party_name=data.get("party_name"),purchase_ref_no=data.get("purchase_ref_no"),
            purchase_amount=_f(data.get("purchase_amount"),0),file_charge=_f(data.get("file_charge"),0),
            vehicle_reg_no=vehicle_reg_no,model_name=data.get("model_name"),
            owner_name=data.get("owner_name"),salesman=data.get("salesman"),
            chassis_no=data.get("chassis_no"),ledger_date=_parse_date(data.get("ledger_date")),
            challan_no=(data.get("challan_no") or "").strip() or None,
            sale_type=(data.get("sale_type") or "").strip().lower() or None,
            do_number=(data.get("do_number") or "").strip() or None,
            battery_maker=data.get("battery_maker"),battery_no1=data.get("battery_no1"),
            battery_no2=data.get("battery_no2"),battery_no3=data.get("battery_no3"),
            battery_no4=data.get("battery_no4"),
            charger=data.get("charger"),mat=data.get("mat"),jack=data.get("jack"),
            center_lock=data.get("centre_lock") or data.get("center_lock"),
            big_mirror=data.get("big_mirror"),colour=data.get("colour"),
            toolkit=data.get("toolkit"),stepney=data.get("stepney"),
            out_name=(data.get("out_name") or "").strip() or None,
            status="available",
            dealer_id=_i(data.get("dealer_id"),0) or None,sp_no=(data.get("sp_no") or "").strip() or None,
            dealer_page_no=(data.get("dealer_page_no") or "").strip() or None,
            remarks1=data.get("remarks1"),remarks2=data.get("remarks2"))
        db.session.add(rec)
        db.session.commit()
        return jsonify(ser_old_rickshaw(rec)),201

    q=OldRickshaw.query
    status=(request.args.get("status") or "").strip().lower()
    source=(request.args.get("source") or "").strip().lower()
    dealer_id=request.args.get("dealer_id",type=int)
    search=(request.args.get("search") or "").strip()
    if status:q=q.filter(OldRickshaw.status==status)
    if source:q=q.filter(OldRickshaw.source==source)
    if dealer_id:q=q.filter(db.or_(OldRickshaw.dealer_id==dealer_id,OldRickshaw.sale_dealer_id==dealer_id))
    if search:
        like=f"%{search}%"
        q=q.filter(db.or_(OldRickshaw.vehicle_reg_no.ilike(like),OldRickshaw.model_name.ilike(like),
                          OldRickshaw.owner_name.ilike(like),OldRickshaw.sp_no.ilike(like),
                          OldRickshaw.chfpl_ref_no.ilike(like)))
    rows=q.order_by(OldRickshaw.date.desc(),OldRickshaw.id.desc()).limit(500).all()
    next_no=_old_rickshaw_record_next()
    return jsonify({"records":[ser_old_rickshaw(r) for r in rows],"suggested_record_no":next_no,
                    "suggested_vou_no":str(next_no+90)})


@app.post("/api/integration/old-rickshaw/available-for-sale")
def chfpl_old_rickshaw_available_for_sale():
    supplied=request.headers.get("X-GRD-BRIDGE-SECRET") or ""
    expected=os.environ.get("CHFPL_GRD_BRIDGE_SECRET") or ""
    if not expected or not supplied or not hmac.compare_digest(supplied,expected):
        return _err("Invalid integration secret",401)
    data=request.get_json(silent=True) or {}
    ref=(data.get("chfpl_ref_no") or data.get("reference_no") or "").strip()
    vehicle_reg_no=(data.get("vehicle_reg_no") or "").strip()
    if not ref:return _err("CHFPL reference no. is required.")
    if not vehicle_reg_no:return _err("Vehicle Reg. No. is required.")
    existing=OldRickshaw.query.filter_by(chfpl_ref_no=ref).first()
    if existing:return jsonify(ser_old_rickshaw(existing))
    rec=OldRickshaw(record_no=_old_rickshaw_record_next(),vou_no=data.get("vou_no"),
        date=_parse_date(data.get("date")) or date.today(),source="chfpl",chfpl_ref_no=ref,
        party_name=data.get("party_name") or "CHFPL",purchase_ref_no=data.get("purchase_ref_no") or ref,
        purchase_amount=_f(data.get("purchase_amount"),0),file_charge=_f(data.get("file_charge"),0),
        vehicle_reg_no=vehicle_reg_no,model_name=data.get("model_name"),owner_name=data.get("owner_name"),
        salesman=data.get("salesman"),battery_maker=data.get("battery_maker"),
        battery_no1=data.get("battery_no1"),battery_no2=data.get("battery_no2"),
        battery_no3=data.get("battery_no3"),battery_no4=data.get("battery_no4"),status="available")
    db.session.add(rec);db.session.commit()
    return jsonify(ser_old_rickshaw(rec)),201


@app.route("/api/old-rickshaws/<int:record_id>", methods=["DELETE"])
@require_auth
def old_rickshaw_delete(record_id):
    rec=OldRickshaw.query.get_or_404(record_id)
    db.session.delete(rec);db.session.commit()
    return jsonify({"deleted":True})


@app.post("/api/old-rickshaws/sale")
@require_auth
def old_rickshaw_sale():
    data=request.get_json(silent=True) or {}
    rec=OldRickshaw.query.get(data.get("id"))
    if not rec:return _err("Old Rickshaw record not found.",404)
    _old_sale_to_dealer(rec,data)
    db.session.commit()
    return jsonify(ser_old_rickshaw(rec))


@app.route("/api/battery-swap-vouchers", methods=["GET","POST","DELETE"])
@require_auth
def battery_swap_vouchers():
    if request.method=="DELETE":
        voucher_id=request.args.get("id",type=int)
        v=BatterySwapVoucher.query.get_or_404(voucher_id)
        # Only allow deleting the latest swap touching either rickshaw, so a
        # later swap cannot be silently corrupted.
        newer=BatterySwapVoucher.query.filter(
            BatterySwapVoucher.id > v.id,
            db.or_(
                db.and_(BatterySwapVoucher.from_type==v.from_type, BatterySwapVoucher.from_id==v.from_id),
                db.and_(BatterySwapVoucher.to_type==v.from_type, BatterySwapVoucher.to_id==v.from_id),
                db.and_(BatterySwapVoucher.from_type==v.to_type, BatterySwapVoucher.from_id==v.to_id),
                db.and_(BatterySwapVoucher.to_type==v.to_type, BatterySwapVoucher.to_id==v.to_id),
            )).first()
        if newer:
            return _err("This swap cannot be deleted because a later battery swap already uses one of these rickshaws.")
        def obj(kind, ident):
            return Vehicle.query.get(ident) if kind=="new" else OldRickshaw.query.get(ident)
        src=obj(v.from_type,v.from_id); dst=obj(v.to_type,v.to_id)
        if not src or not dst:return _err("Rickshaw record not found.")
        sb=_battery_fields(src); tb=_battery_fields(dst)
        if v.mode=="exchange":
            _battery_set(src,getattr(dst,"battery_maker",None),tb)
            _battery_set(dst,getattr(src,"battery_maker",None),sb)
        else:
            # For a normal swap, the destination received the source battery.
            _battery_set(src,getattr(dst,"battery_maker",None),tb)
            _battery_set(dst,None,[None,None,None,None])
        db.session.delete(v); db.session.commit()
        return jsonify({"deleted":True})
    if request.method=="GET":
        rows=BatterySwapVoucher.query.order_by(BatterySwapVoucher.date.desc(),BatterySwapVoucher.id.desc()).limit(300).all()
        def swap_target(kind, ident):
            return Vehicle.query.get(ident) if kind == "new" else OldRickshaw.query.get(ident)

        records = []
        for x in rows:
            src = swap_target(x.from_type, x.from_id)
            dst = swap_target(x.to_type, x.to_id)
            records.append({
                "id": x.id, "voucher_no": x.voucher_no, "date": _iso(x.date),
                "dealer_id": x.dealer_id, "mode": x.mode,
                "from_type": x.from_type, "from_id": x.from_id,
                "from_reg_no": getattr(src, "vehicle_reg_no", None) if x.from_type == "old" else getattr(src, "reg_no", None),
                "from_chassis_no": getattr(src, "chassis_no", None),
                "from_model_name": getattr(src, "model_name", None),
                "from_battery_maker": getattr(src, "battery_maker", None),
                "from_battery_numbers": _battery_fields(src) if src else [],
                "to_type": x.to_type, "to_id": x.to_id,
                "to_reg_no": getattr(dst, "vehicle_reg_no", None) if x.to_type == "old" else getattr(dst, "reg_no", None),
                "to_chassis_no": getattr(dst, "chassis_no", None),
                "to_model_name": getattr(dst, "model_name", None),
                "to_battery_maker": getattr(dst, "battery_maker", None),
                "to_battery_numbers": _battery_fields(dst) if dst else [],
                "remarks": x.remarks,
            })
        return jsonify({"records": records})
    d=request.get_json(silent=True) or {}
    dealer_id=d.get("dealer_id")
    if not dealer_id:return _err("Dealer is required.")
    dealer=Dealer.query.get(dealer_id)
    if not dealer:return _err("Dealer not found.")
    def target(kind,ident):
        obj=(Vehicle.query.get(ident) if kind=="new" else OldRickshaw.query.get(ident)) if kind in {"new","old"} else None
        if not obj:return _err("Rickshaw not found.")
        return obj
    fk=(d.get("from_type") or "").lower();tk=(d.get("to_type") or "").lower()
    if fk not in {"new","old"} or tk not in {"new","old"}:return _err("Valid From/To rickshaw type is required.")
    src=target(fk,d.get("from_id"));dst=target(tk,d.get("to_id"))
    # Legacy/previous Delivery Challans may have the battery snapshot while
    # Vehicle's live battery fields are blank. Restore the live fields from
    # that snapshot before performing the swap, so a real fitted battery is
    # never reported as "no battery".
    for obj, kind in ((src, fk), (dst, tk)):
        if kind == "new" and not any(_battery_fields(obj)):
            dc = (DeliveryChallan.query.filter_by(vehicle_id=obj.id)
                  .order_by(DeliveryChallan.id.desc()).first())
            if dc:
                dc_nums=[getattr(dc,f"battery_no{i}",None) for i in range(1,5)]
                if any(dc_nums):
                    _battery_set(obj, dc.battery_maker, dc_nums)
    if hasattr(src,"dealer_name") and fk=="new":
        if (src.dealer_name or "").strip().lower() != dealer.name.strip().lower():return _err("From rickshaw is not with this dealer.")
    if fk=="old" and src.dealer_id!=dealer.id:return _err("From old rickshaw is not with this dealer.")
    if hasattr(dst,"dealer_name") and tk=="new":
        if (dst.dealer_name or "").strip().lower() != dealer.name.strip().lower():return _err("To rickshaw is not with this dealer.")
    if tk=="old" and dst.dealer_id!=dealer.id:return _err("To old rickshaw is not with this dealer.")
    s=_battery_fields(src);t=_battery_fields(dst)
    if not any(s):return _err("From rickshaw has no battery to move.")
    if any(t):
        mode="exchange"
        _battery_set(src,getattr(dst,"battery_maker",None),t)
        _battery_set(dst,getattr(src,"battery_maker",None),s)
    else:
        mode="swap"
        _battery_set(src,None,[None,None,None,None])
        _battery_set(dst,getattr(src,"battery_maker",None),s)
    v=BatterySwapVoucher(date=_parse_date(d.get("date")) or date.today(),dealer_id=dealer.id,
        from_type=fk,from_id=src.id,to_type=tk,to_id=dst.id,mode=mode,remarks=d.get("remarks"))
    db.session.add(v);db.session.flush();v.voucher_no=f"BS-{v.id:06d}"
    db.session.commit()
    return jsonify({"voucher":v.voucher_no,"mode":mode,"from":ser_old_rickshaw(src) if fk=="old" else ser_vehicle(src),
                    "to":ser_old_rickshaw(dst) if tk=="old" else ser_vehicle(dst)}),201


@app.route("/api/battery-withdrawal", methods=["GET","POST","DELETE"])
@require_auth
def battery_withdrawal():
    if request.method=="DELETE":
        movement_id=request.args.get("id",type=int)
        mov=BatteryStockMovement.query.get_or_404(movement_id)
        if mov.movement_type!="withdrawal": return _err("Only withdrawal records can be deleted here.")
        kind=mov.source_type
        obj=Vehicle.query.get(mov.source_id) if kind=="new" else OldRickshaw.query.get(mov.source_id) if kind=="old" else None
        if not obj:return _err("Original rickshaw record not found.")
        # Do not re-fit a battery if a later swap/withdrawal touched this rickshaw.
        newer=BatteryStockMovement.query.filter(
            BatteryStockMovement.id>mov.id,
            BatteryStockMovement.source_type==kind,
            BatteryStockMovement.source_id==mov.source_id,
            BatteryStockMovement.movement_type=="withdrawal").first()
        if newer:return _err("This withdrawal cannot be deleted because a later withdrawal exists for the same rickshaw.")
        nums=_battery_fields(obj)
        if mov.battery_no in nums:return _err("This battery is already fitted on the rickshaw.")
        slot=next((j for j in range(1,5) if not getattr(obj,f"battery_no{j}",None)),None)
        if not slot:return _err("No empty battery slot is available on the rickshaw.")
        if not getattr(obj,"battery_maker",None): obj.battery_maker=mov.battery_maker
        setattr(obj,f"battery_no{slot}",mov.battery_no)
        db.session.delete(mov);db.session.commit()
        return jsonify({"deleted":True})
    if request.method=="GET":
        dealer_id=request.args.get("dealer_id",type=int)
        q=BatteryStockMovement.query.filter_by(movement_type="withdrawal")
        if dealer_id:q=q.filter_by(dealer_id=dealer_id)
        rows=q.order_by(BatteryStockMovement.date.desc(),BatteryStockMovement.id.desc()).limit(500).all()
        return jsonify({"records":[{"id":x.id,"date":_iso(x.date),"dealer_id":x.dealer_id,
            "dealer_name":x.dealer.name if x.dealer else None,"battery_maker":x.battery_maker,
            "battery_no":x.battery_no,"qty":x.qty,"reference_no":x.reference_no,"remarks":x.remarks} for x in rows]})
    d=request.get_json(silent=True) or {}
    dealer_id=d.get("dealer_id")
    if not dealer_id:return _err("Dealer is required.")
    dealer=Dealer.query.get(dealer_id)
    if not dealer:return _err("Dealer not found.")
    kind=(d.get("rickshaw_type") or "").lower();rid=d.get("rickshaw_id")
    obj=Vehicle.query.get(rid) if kind=="new" else OldRickshaw.query.get(rid) if kind=="old" else None
    if not obj:return _err("Rickshaw not found.")
    if kind=="old" and obj.dealer_id!=dealer.id:return _err("Old rickshaw is not with this dealer.")
    if kind=="new" and (obj.dealer_name or "").strip().lower()!=dealer.name.strip().lower():return _err("New rickshaw is not with this dealer.")
    nums=_battery_fields(obj)
    battery_no=(d.get("battery_no") or "").strip()
    if not battery_no:return _err("Battery No. is required.")
    if battery_no not in nums:return _err("This battery is not fitted on the selected rickshaw.")
    maker=getattr(obj,"battery_maker",None)
    for j in range(1,5):
        if getattr(obj,f"battery_no{j}",None)==battery_no:setattr(obj,f"battery_no{j}",None)
    if not any(_battery_fields(obj)):obj.battery_maker=None
    mov=BatteryStockMovement(date=_parse_date(d.get("date")) or date.today(),dealer_id=dealer.id,
        battery_maker=maker,battery_no=battery_no,qty=1,movement_type="withdrawal",
        source_type=kind,source_id=obj.id,reference_no=d.get("reference_no"),remarks=d.get("remarks"))
    db.session.add(mov);db.session.commit()
    return jsonify({"success":True,"movement_id":mov.id,"battery_no":battery_no}),201


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
                            qty=_f(data.get("qty")), reason=data.get("reason"),
                            model_name=(data.get("model_name") or "").strip() or None,
                            work_type=(data.get("work_type") or "adjustment").strip() or "adjustment")
        db.session.add(rec)
        db.session.commit()
        return jsonify(ser_journal(rec)), 201

    search=(request.args.get("search") or "").strip()
    item_type=(request.args.get("item_type") or "").strip()
    page=max(1,_i(request.args.get("page"),1))
    per_page=min(100,max(25,_i(request.args.get("per_page"),50)))
    q=JournalStock.query.order_by(JournalStock.date.desc(),JournalStock.id.desc())
    if search:
        like=f"%{search}%"
        q=q.filter(db.or_(JournalStock.item_name.ilike(like),JournalStock.vou_no.ilike(like),
                          JournalStock.reason.ilike(like),JournalStock.model_name.ilike(like)))
    if item_type in {"R","F"}: q=q.filter(JournalStock.item_type==item_type)
    rows=q.offset((page-1)*per_page).limit(per_page+1).all()
    has_next=len(rows)>per_page
    rows=rows[:per_page]
    next_no=(db.session.query(db.func.max(JournalStock.id)).scalar() or 0)+1
    return jsonify({"records":[ser_journal(r) for r in rows],"page":page,
                    "per_page":per_page,"has_next":has_next,
                    "suggested_vou_no":f"J-{next_no + 100}"})

@app.post("/api/journal-stock/work")
@require_auth
def journal_stock_work():
    data=request.get_json(silent=True) or {}
    work_type=(data.get("work_type") or "").strip().lower()
    if work_type not in {"fabrication","assembly"}: return _err("Work Type must be Fabrication or Assembly")
    output_item=(data.get("output_item") or "").strip()
    model_name=(data.get("model_name") or "").strip() or None
    output_qty=_f(data.get("output_qty"),0)
    inputs=data.get("inputs") if isinstance(data.get("inputs"),list) else []
    if not output_item:return _err("Output item is required")
    if output_qty<=0:return _err("Output Qty must be greater than zero")
    if not inputs:return _err("At least one input material is required")
    clean=[]
    for row in inputs:
        name=(row.get("item_name") or "").strip()
        per=_f(row.get("qty_per_unit"),0)
        if name and per>0: clean.append((name,per))
    if not clean:return _err("Enter valid input material quantities")
    base_no=(data.get("vou_no") or "").strip()
    if not base_no:
        base_no=f"J-{(db.session.query(db.func.max(JournalStock.id)).scalar() or 0)+101}"
    batch=f"{base_no}-{uuid.uuid4().hex[:8].upper()}"
    reason=(data.get("reason") or "").strip() or (f"{work_type.title()} — {model_name}" if model_name else work_type.title())
    created=[]
    for name,per in clean:
        rec=JournalStock(vou_no=base_no,date=_parse_date(data.get("date")) or date.today(),
                         item_name=name,item_type="R",qty=-round(per*output_qty,4),
                         reason=reason,model_name=model_name,work_type=work_type,batch_ref=batch)
        db.session.add(rec);created.append(rec)
    out=JournalStock(vou_no=base_no,date=_parse_date(data.get("date")) or date.today(),
                    item_name=output_item,item_type="F",qty=output_qty,reason=reason,
                    model_name=model_name,work_type=work_type,batch_ref=batch)
    db.session.add(out);created.append(out)
    db.session.commit()
    return jsonify({"success":True,"batch_ref":batch,"records":[ser_journal(x) for x in created]}),201

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
    vehicles = (db.session.query(Vehicle)
                .outerjoin(ProductionVoucher, ProductionVoucher.chassis_no == Vehicle.chassis_no)
                .filter(Vehicle.stage == "Manufacturing")
                .order_by(db.func.coalesce(db.func.nullif(Vehicle.model_name, ""), ProductionVoucher.product_name),
                          Vehicle.colour, Vehicle.id)
                .all())
    # Older Vehicle rows may not have model_name; resolve it from ProductionVoucher
    # by chassis number so factory stock always shows the model.
    for v in vehicles:
        if not (v.model_name or "").strip():
            pv = (ProductionVoucher.query
                  .filter(ProductionVoucher.chassis_no == v.chassis_no)
                  .with_entities(ProductionVoucher.product_name)
                  .first())
            if pv and pv.product_name:
                v.model_name = pv.product_name
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
                        "chassis_no":chassis_no, "model_name":product_name,
                        "particulars":f"Production — {product_name}", "qty":qty or 0, "_sort":d or date.min})
    for j in j:
        events.append({"date":_iso(j.date), "type":"IN" if j.qty >= 0 else "OUT", "doc_no":j.vou_no,
                        "party_name":"", "model_name":j.model_name,
                        "particulars":j.reason or "Journal Stock adjustment",
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
        events.append({"date":_iso(d),"type":"IN","doc_no":vou_no,"chassis_no":chassis_no,"model_name":product_name,
                       "particulars":f"Production — {product_name}","qty":qty or 1,"_sort":d or date.min})
    dc_rows = db.session.query(DeliveryChallan.date, DeliveryChallan.challan_no, DeliveryChallan.chassis_no, DeliveryChallan.product_name, Dealer.name)\
        .outerjoin(Dealer, DeliveryChallan.dealer_id == Dealer.id)\
        .filter(DeliveryChallan.cancelled.is_(False), *_date_filter(DeliveryChallan.date, from_date, to_date)).all()
    for d, challan_no, chassis_no, product_name, dealer_name in dc_rows:
        events.append({"date":_iso(d),"type":"OUT","doc_no":challan_no,"chassis_no":chassis_no,"model_name":product_name,
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
    is_export = request.args.get("export") == "csv"

    def line_values(b, it):
        taxable = round((it.qty or 0) * (it.rate or 0), 2)
        inter = bool(b.party_state_code) and b.party_state_code != "07"
        igst = round(taxable * (it.gst_rate or 0) / 100, 2) if inter else 0
        cgst = round(taxable * (it.gst_rate or 0) / 200, 2) if not inter else 0
        sgst = cgst if not inter else 0
        return {
            "item_name": it.item_name, "hsn": it.hsn_code, "qty": it.qty, "rate": it.rate,
            "gst_rate": it.gst_rate, "taxable_amt": taxable,
            "cgst_amt": cgst, "sgst_amt": sgst, "igst_amt": igst,
            "tax_amt": round(cgst + sgst + igst, 2),
            "total_amt": round(taxable + cgst + sgst + igst, 2),
        }

    # One register row per purchase bill. Item lines are kept inside the row
    # for the View dialog, so a bill with 5 items is not repeated 5 times.
    query = (PurchaseBill.query
             .options(joinedload(PurchaseBill.items))
             .filter(*_date_filter(PurchaseBill.date, from_date, to_date)))

    if search:
        like = f"%{search}%"
        query = (query.outerjoin(PurchaseBillItem, PurchaseBillItem.bill_id == PurchaseBill.id)
                 .filter(db.or_(PurchaseBill.party_name.ilike(like),
                                PurchaseBill.bill_no.ilike(like),
                                PurchaseBillItem.item_name.ilike(like),
                                PurchaseBillItem.hsn_code.ilike(like)))
                 .distinct())

    query = query.order_by(PurchaseBill.date.desc(), PurchaseBill.id.desc())

    if is_export:
        bills = query.all()
        rows = []
        for b in bills:
            for it in b.items:
                x = line_values(b, it)
                rows.append([_iso(b.date), b.bill_no or ".", b.party_name, x["item_name"], x["hsn"] or "",
                             x["taxable_amt"], x["cgst_amt"], x["sgst_amt"], x["igst_amt"]])
        headers = ["Date", "Bill No.", "Party Name", "Item Name", "HSN", "Taxable Amt", "CGST Amt", "SGST Amt", "IGST Amt"]
        return _csv_response("Purchase_Register.csv", headers, rows)

    page = max(1, _i(request.args.get("page"), 1))
    per_page = min(100, max(25, _i(request.args.get("per_page"), 50)))
    total = query.with_entities(PurchaseBill.id).count()
    bills = query.offset((page - 1) * per_page).limit(per_page).all()

    out = []
    for b in bills:
        items = [line_values(b, it) for it in b.items]
        taxable = round(sum(x["taxable_amt"] for x in items), 2)
        cgst = round(sum(x["cgst_amt"] for x in items), 2)
        sgst = round(sum(x["sgst_amt"] for x in items), 2)
        igst = round(sum(x["igst_amt"] for x in items), 2)
        out.append({
            "id": b.id, "date": _iso(b.date), "bill_no": b.bill_no or ".", "party_name": b.party_name,
            "party_gst_no": b.party_gst_no, "party_state_code": b.party_state_code,
            "remarks": b.remarks, "item_count": len(items),
            "taxable_amt": taxable, "cgst_amt": cgst, "sgst_amt": sgst, "igst_amt": igst,
            "tax_amt": round(cgst + sgst + igst, 2),
            "total_amt": round(taxable + cgst + sgst + igst, 2),
            "items": items,
        })

    totals = {
        "taxable": round(sum(r["taxable_amt"] for r in out), 2),
        "cgst": round(sum(r["cgst_amt"] for r in out), 2),
        "sgst": round(sum(r["sgst_amt"] for r in out), 2),
        "igst": round(sum(r["igst_amt"] for r in out), 2),
    }
    return jsonify({"rows": out, "totals": totals, "page": page, "per_page": per_page,
                    "total": total, "total_pages": (total + per_page - 1) // per_page if total else 1})


@app.route("/api/reports/production-register")
@require_auth
def production_register():
    from_date, to_date = _date_bounds()
    search = request.args.get("search", "").strip()
    status = (request.args.get("status") or "all").lower()
    page = max(1, _i(request.args.get("page"), 1))
    per_page = min(100, max(25, _i(request.args.get("per_page"), 50)))
    # Join Vehicle once and carry its stage with each voucher. The old
    # implementation ran one extra Vehicle query per row (50+ queries on the
    # first page), which could make the register hit the API timeout.
    query = (ProductionVoucher.query
             .outerjoin(Vehicle, Vehicle.chassis_no == ProductionVoucher.chassis_no)
             .filter(*_date_filter(ProductionVoucher.date, from_date, to_date)))
    if search:
        like = f"%{search}%"
        query = query.filter(db.or_(
            ProductionVoucher.product_name.ilike(like),
            ProductionVoucher.chassis_no.ilike(like),
            ProductionVoucher.vou_no.ilike(like),
        ))
    delivered_stages = ["Delivery Challan", "Tax Invoice"]
    if status == "factory":
        query = query.filter(db.or_(Vehicle.id.is_(None), ~Vehicle.stage.in_(delivered_stages)))
    elif status == "delivered":
        query = query.filter(Vehicle.stage.in_(delivered_stages))

    total = query.with_entities(ProductionVoucher.id).count()
    voucher_rows = (query
                    .add_columns(Vehicle.stage)
                    .order_by(ProductionVoucher.date.asc(), ProductionVoucher.id.asc())
                    .offset((page-1)*per_page).limit(per_page).all())
    if request.args.get("export") == "csv":
        voucher_rows = (query
                        .add_columns(Vehicle.stage)
                        .order_by(ProductionVoucher.date.asc(), ProductionVoucher.id.asc()).all())
        headers = ["Date", "Vou. No.", "Product Name", "Quantity", "Chassis No.", "Motor No.", "Controller No."]
        return _csv_response("Production_Register.csv", headers,
                              [[_iso(v.date), v.vou_no, v.product_name, v.quantity, v.chassis_no,
                                v.motor_no, v.controller_no] for v, _stage in voucher_rows])
    out = []
    for v, stage in voucher_rows:
        row = ser_pv_list(v)
        row["stage"] = "Delivered" if stage in delivered_stages else "In Factory Stock"
        out.append(row)
    return jsonify({
        "rows": out, "page": page, "per_page": per_page, "total": total,
        "total_pages": (total + per_page - 1)//per_page if total else 1
    })


@app.route("/api/reports/delivery-challan-register")
@require_auth
def delivery_challan_register():
    # Keep this report scalable: filter/search/pagination happen in SQL.
    # The old implementation loaded every challan (17k+) plus every invoice
    # into Python before returning the page, which made the initial render slow.
    from_date, to_date = _date_bounds()
    search = request.args.get("search", "").strip()
    status = request.args.get("status", "all")
    page = max(1, _i(request.args.get("page"), 1))
    per_page = min(200, max(25, _i(request.args.get("per_page"), 100)))

    query = (DeliveryChallan.query
             .join(Dealer, DeliveryChallan.dealer_id == Dealer.id)
             .options(joinedload(DeliveryChallan.dealer))
             .filter(*_date_filter(DeliveryChallan.date, from_date, to_date)))

    if search:
        like = f"%{search}%"
        query = query.filter(db.or_(
            Dealer.name.ilike(like),
            DeliveryChallan.chassis_no.ilike(like),
            DeliveryChallan.challan_no.ilike(like),
            DeliveryChallan.product_name.ilike(like),
            DeliveryChallan.salesman.ilike(like),
            DeliveryChallan.battery_maker.ilike(like),
        ))

    invoice_ids = db.session.query(TaxInvoice.delivery_challan_id).filter(
        TaxInvoice.delivery_challan_id.isnot(None)
    )
    if status == "sold":
        query = query.filter(DeliveryChallan.id.in_(invoice_ids))
    elif status == "unsold":
        query = query.filter(~DeliveryChallan.id.in_(invoice_ids))

    # Optional report filters are also applied in SQL, so they don't require
    # loading the entire register into the browser.
    for param, column in (
        ("product", DeliveryChallan.product_name),
        ("dealer", Dealer.name),
        ("salesman", DeliveryChallan.salesman),
        ("battery", DeliveryChallan.battery_maker),
    ):
        value = request.args.get(param, "").strip()
        if value and value != "ALL":
            query = query.filter(column == value)

    is_export = request.args.get("export") == "csv"
    total = query.count()
    if is_export:
        challans = query.order_by(DeliveryChallan.date.desc(), DeliveryChallan.id.desc()).all()
    else:
        challans = (query.order_by(DeliveryChallan.date.asc(), DeliveryChallan.id.asc())
                    .offset((page - 1) * per_page).limit(per_page).all())

    page_ids = [c.id for c in challans]
    invoiced = {}
    if page_ids:
        invoiced = {
            row.delivery_challan_id: (row.bill_no, row.sale_amount)
            for row in db.session.query(
                TaxInvoice.delivery_challan_id, TaxInvoice.bill_no, TaxInvoice.sale_amount
            ).filter(TaxInvoice.delivery_challan_id.in_(page_ids)).all()
        }

    bill_no_by_challan = {
        c.id: (invoiced.get(c.id, (None, None))[0] or c.sale_bill_no or None)
        for c in challans
    }
    item_amount_by_challan = {
        c.id: invoiced.get(c.id, (None, None))[1]
        for c in challans
    }

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
        row["sale_value"] = item_amount_by_challan.get(c.id)
        row["sold"] = c.id in invoiced
        out.append(row)

    filter_options = {
        "product": [x[0] for x in db.session.query(DeliveryChallan.product_name).filter(DeliveryChallan.product_name.isnot(None)).distinct().order_by(DeliveryChallan.product_name).all()],
        "dealer": [x[0] for x in db.session.query(Dealer.name).filter(Dealer.name.isnot(None)).distinct().order_by(Dealer.name).all()],
        "salesman": [x[0] for x in db.session.query(DeliveryChallan.salesman).filter(DeliveryChallan.salesman.isnot(None)).distinct().order_by(DeliveryChallan.salesman).all()],
        "battery": [x[0] for x in db.session.query(DeliveryChallan.battery_maker).filter(DeliveryChallan.battery_maker.isnot(None)).distinct().order_by(DeliveryChallan.battery_maker).all()],
    }
    return jsonify({
        "rows": out,
        "page": page,
        "per_page": per_page,
        "total": total,
        "total_pages": (total + per_page - 1) // per_page if total else 1,
        "filters": filter_options,
    })


@app.route("/api/reports/sale-register")
@require_auth
def sale_register():
    from_date, to_date = _date_bounds()
    search = request.args.get("search", "").strip()
    q = TaxInvoice.query.filter(*_date_filter(TaxInvoice.date, from_date, to_date))
    if search:
        like=f"%{search}%"
        q=q.filter(db.or_(TaxInvoice.buyer_name.ilike(like), TaxInvoice.dealer_name.ilike(like),
                          TaxInvoice.product_name.ilike(like), TaxInvoice.chassis_no.ilike(like),
                          TaxInvoice.bill_no.ilike(like)))
    q=q.order_by(TaxInvoice.date.desc(), TaxInvoice.id.desc())
    if request.args.get("export") == "csv":
        headers = ["Date", "Bill No.", "Buyer Name", "Product Name", "Chassis No.", "Taxable Value",
                   "Tax Amount", "Insurance", "Registration", "Bill Total"]
        invoices=q.all()
        return _csv_response("Sale_Register.csv", headers,
                              [[_iso(i.date), i.bill_no, i.buyer_name, i.product_name, i.chassis_no,
                                i.taxable_value, i.tax_amount, i.insurance_amount or 0,
                                i.registration_amount or 0, i.bill_total] for i in invoices])
    page=max(1,_i(request.args.get("page"),1))
    per_page=min(200,max(25,_i(request.args.get("per_page"),50)))
    total=q.count()
    invoices=q.offset((page-1)*per_page).limit(per_page).all()

    taxable_expr=(db.func.coalesce(TaxInvoice.gst_sale_amount,TaxInvoice.sale_amount,0)
                  -db.func.coalesce(TaxInvoice.discount,0))
    interstate=db.or_(TaxInvoice.state_type=="O",
                      db.and_(TaxInvoice.state_type.is_(None),
                              TaxInvoice.buyer_state_code.isnot(None),
                              TaxInvoice.buyer_state_code!="07"))
    tax_expr=db.case((interstate,
                      taxable_expr*db.func.coalesce(TaxInvoice.gst_rate,0)/100),
                     else_=taxable_expr*db.func.coalesce(TaxInvoice.gst_rate,0)/100)
    insurance_expr=db.func.coalesce(TaxInvoice.insurance_amount,0)
    registration_expr=db.func.coalesce(TaxInvoice.registration_amount,0)
    # Total = taxable + total GST + insurance + registration.
    totals_row=q.session.query(
        db.func.coalesce(db.func.sum(taxable_expr),0),
        db.func.coalesce(db.func.sum(tax_expr),0),
        db.func.coalesce(db.func.sum(insurance_expr),0),
        db.func.coalesce(db.func.sum(registration_expr),0),
        db.func.coalesce(db.func.sum(taxable_expr+tax_expr+insurance_expr+registration_expr),0)
    ).one()
    totals={"taxable":round(float(totals_row[0] or 0),2),
            "tax":round(float(totals_row[1] or 0),2),
            "insurance":round(float(totals_row[2] or 0),2),
            "registration":round(float(totals_row[3] or 0),2),
            "total":round(float(totals_row[4] or 0),2)}
    return jsonify({"invoices":[ser_ti(i) for i in invoices],"totals":totals,
                    "total":total,"page":page,"per_page":per_page,
                    "total_pages":(total+per_page-1)//per_page if total else 1})


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
        return {"id": ti.id, "vehicle_id": ti.vehicle_id, "date": _iso(ti.date), "dealer_name": ti.dealer_name, "bill_no": ti.bill_no,
                "model": ti.product_name, "chassis_no": ti.chassis_no, "other": ti.other_desc,
                "customer": ti.buyer_name, "mobile_no": ti.buyer_mobile,
                "value_amt": ti.sale_amount or 0, "loan_amt": ti.hypothecation_amount or 0,
                "amt_recd": ti.amount_received or 0, "balance": balance,
                "financer": ti.financer_name, "rto": ti.rto_name,
                "chassis_record": ti.chassis_record_no, "ledger": ti.ledger_no,
                "voucher_no": ti.voucher_no, "cheque_no": ti.cancelled_cheque_no,
                "vehicle_no": ti.vehicle_reg_no, "salesman": salesman,
                "incentive_amount": 0, "incentive_voucher_no": "", "incentive_date": None}

    def _attach_incentives(out):
        vehicle_ids=[x["vehicle_id"] for x in out if x.get("vehicle_id")]
        if not vehicle_ids:return out
        iv_rows=(ExpensePaymentVoucher.query
                 .filter(ExpensePaymentVoucher.expense_type=="incentive",
                         ExpensePaymentVoucher.vehicle_id.in_(vehicle_ids),
                         ExpensePaymentVoucher.status.in_(["pending","approved"]))
                 .order_by(ExpensePaymentVoucher.id.desc()).all())
        seen=set()
        for iv in iv_rows:
            if iv.vehicle_id in seen:continue
            seen.add(iv.vehicle_id)
            for row in out:
                if row.get("vehicle_id")==iv.vehicle_id:
                    row["incentive_amount"]=iv.amount or 0
                    row["incentive_voucher_no"]=iv.voucher_no or ""
                    row["incentive_date"]=_iso(iv.date)
                    break
        return out

    if request.args.get("export") == "csv":
        rows = base.order_by(TaxInvoice.date.desc(), TaxInvoice.id.desc()).all()
        out = _attach_incentives([_row_dict(ti, sm) for ti, sm in rows])
        headers = ["Date", "Dealer Name", "Bill No.", "Model", "Chassis No.", "Other", "Customer",
                   "Mobile No.", "Value Amt.", "Loan Amt.", "Amt. Recd.", "Balance", "Financer", "RTO",
                   "Chassis Record", "Ledger", "Voucher No.", "Cheque No.", "Vehicle No.", "Salesman",
                   "Incentive Amount", "Incentive Voucher No.", "Incentive Date"]
        out_rows = [[d["date"], d["dealer_name"], d["bill_no"], d["model"], d["chassis_no"], d["other"],
                     d["customer"], d["mobile_no"], d["value_amt"], d["loan_amt"], d["amt_recd"],
                     d["balance"], d["financer"], d["rto"], d["chassis_record"], d["ledger"],
                     d["voucher_no"], d["cheque_no"], d["vehicle_no"], d["salesman"],
                     d["incentive_amount"], d["incentive_voucher_no"], d["incentive_date"]]
                    for d in out]
        return _csv_response("Payment_Receivable_Report.csv", headers, out_rows)

    total = base.count()
    page_rows = (base.order_by(TaxInvoice.date.desc(), TaxInvoice.id.desc())
                 .offset((page - 1) * per_page).limit(per_page).all())
    out = _attach_incentives([_row_dict(ti, sm) for ti, sm in page_rows])

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

    daybook_rows = (db.session.query(
        DayBook.vr_no, DayBook.dealer_name, DayBook.credit_received,
        DayBook.debit_paid, DayBook.date
    ).filter(*_date_filter(DayBook.date, from_date, to_date)).all())
    for vr_no, dealer_name, credit_received, debit_paid, d in daybook_rows:
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
    daybook_rows = (db.session.query(
        DayBook.dealer_name, DayBook.credit_received, DayBook.date
    ).filter(*_date_filter(DayBook.date, from_date, to_date)).all())
    for dealer_name, credit_received, d in daybook_rows:
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
    production = ProductionVoucher.query.filter_by(chassis_no=dc.chassis_no).first() if dc.chassis_no else None

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
        "product_name": dc.product_name, "formula_name": None,
        "chassis_no": dc.chassis_no,
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
    # Manufacturing month/year must come from the vehicle/production record,
    # not the invoice date. Format required by the upload file is MMYYYY.
    production = ProductionVoucher.query.filter_by(chassis_no=ti.chassis_no).order_by(ProductionVoucher.id.desc()).first()
    manufacturing_date = (production.date if production and production.date else
                          (ti.vehicle.date if ti.vehicle else None))
    month_year = manufacturing_date.strftime("%m%Y") if manufacturing_date else ""
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
