from datetime import date, datetime
from flask import Blueprint, request, jsonify, g
from sqlalchemy import inspect, text
from models import db, Dealer
from auth import require_dealer_auth

dealer_cashbook_bp = Blueprint("dealer_cashbook", __name__)

EXPENSE_CATEGORIES = {
    "tea_customer": "Tea for Customer", "tea_staff": "Tea for Staff",
    "water": "Water Expense", "rent": "Rent Expense",
    "repairing": "Repairing Expense", "makhi_commission": "Makhi / Commission Expense",
    "other": "Other Expense",
}
PAYMENT_MODES = {"cash": "Cash", "upi": "UPI", "bank": "Bank", "cheque": "Cheque", "other": "Other"}

class DealerCashReceipt(db.Model):
    __tablename__ = "dealer_cash_receipt"
    id = db.Column(db.Integer, primary_key=True)
    dealer_id = db.Column(db.Integer, db.ForeignKey("dealer.id"), nullable=False, index=True)
    dealer_user_id = db.Column(db.Integer, nullable=True, index=True)
    receipt_no = db.Column(db.String(40), unique=True, nullable=False, index=True)
    receipt_date = db.Column(db.Date, nullable=False, default=date.today, index=True)
    customer_name = db.Column(db.String(200), nullable=False)
    customer_phone = db.Column(db.String(30))
    application_no = db.Column(db.String(40))
    dealer_register_page_no = db.Column(db.String(40))
    booking_for = db.Column(db.String(200))
    amount = db.Column(db.Float, nullable=False)
    payment_mode = db.Column(db.String(20), nullable=False, default="cash")
    reference_no = db.Column(db.String(80))
    remarks = db.Column(db.String(500))
    customer_id = db.Column(db.Integer, db.ForeignKey("dealer_cash_customer.id"), nullable=True, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class DealerCashCustomer(db.Model):
    """Showroom customer register created/updated from booking receipts."""
    __tablename__ = "dealer_cash_customer"
    id = db.Column(db.Integer, primary_key=True)
    dealer_id = db.Column(db.Integer, db.ForeignKey("dealer.id"), nullable=False, index=True)
    page_no = db.Column(db.String(40), index=True)
    full_name = db.Column(db.String(200), nullable=False)
    phone = db.Column(db.String(30), index=True)
    financer = db.Column(db.String(200))
    vehicle_no = db.Column(db.String(60))
    sale_amount = db.Column(db.Float, default=0)
    loan_amount = db.Column(db.Float, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class DealerCustomerDelivery(db.Model):
    """Showroom customer delivery register. One customer can be delivered once."""
    __tablename__ = "dealer_customer_delivery"
    id = db.Column(db.Integer, primary_key=True)
    dealer_id = db.Column(db.Integer, db.ForeignKey("dealer.id"), nullable=False, index=True)
    customer_id = db.Column(db.Integer, db.ForeignKey("dealer_cash_customer.id"), nullable=False, index=True)
    delivery_no = db.Column(db.String(40), unique=True, nullable=False, index=True)
    delivery_date = db.Column(db.Date, nullable=False, default=date.today, index=True)
    delivery_type = db.Column(db.String(20), nullable=False)  # new / old / battery
    vehicle_id = db.Column(db.Integer, db.ForeignKey("vehicle.id"), nullable=True, index=True)
    old_rickshaw_id = db.Column(db.Integer, db.ForeignKey("old_rickshaw.id"), nullable=True, index=True)
    battery_no = db.Column(db.String(60))
    battery_qty = db.Column(db.Integer, default=0)
    sale_amount = db.Column(db.Float, default=0)
    loan_amount = db.Column(db.Float, default=0)
    down_payment = db.Column(db.Float, default=0)
    do_no = db.Column(db.String(60), index=True)
    do_selected_by = db.Column(db.String(20))
    do_selected_at = db.Column(db.DateTime)
    remarks = db.Column(db.String(300))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class DealerCashExpense(db.Model):
    __tablename__ = "dealer_cash_expense"
    id = db.Column(db.Integer, primary_key=True)
    dealer_id = db.Column(db.Integer, db.ForeignKey("dealer.id"), nullable=False, index=True)
    dealer_user_id = db.Column(db.Integer, nullable=True, index=True)
    expense_no = db.Column(db.String(40), unique=True, nullable=False, index=True)
    expense_date = db.Column(db.Date, nullable=False, default=date.today, index=True)
    category = db.Column(db.String(40), nullable=False)
    amount = db.Column(db.Float, nullable=False)
    paid_to = db.Column(db.String(200))
    remarks = db.Column(db.String(500))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class DealerCashHandover(db.Model):
    __tablename__ = "dealer_cash_handover"
    id = db.Column(db.Integer, primary_key=True)
    dealer_id = db.Column(db.Integer, db.ForeignKey("dealer.id"), nullable=False, index=True)
    dealer_user_id = db.Column(db.Integer, nullable=True, index=True)
    handover_no = db.Column(db.String(40), unique=True, nullable=False, index=True)
    handover_date = db.Column(db.Date, nullable=False, default=date.today, index=True)
    amount = db.Column(db.Float, nullable=False)
    sent_to = db.Column(db.String(200))
    remarks = db.Column(db.String(500))
    status = db.Column(db.String(20), nullable=False, default="sent")
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

@dealer_cashbook_bp.before_request
def _ensure_cashbook_schema():
    """Ensure the showroom cash/customer tables exist before ORM queries run.

    Older production databases predate the customer register columns.  Keep
    this migration deliberately small and independent so a failure in another
    table's create_all() cannot leave dealer_cash_receipt unusable.
    """
    try:
        # Create the new customer table first because dealer_cash_receipt has
        # a string-based FK to it.
        DealerCashCustomer.__table__.create(db.engine, checkfirst=True)
        DealerCashReceipt.__table__.create(db.engine, checkfirst=True)
        DealerCashExpense.__table__.create(db.engine, checkfirst=True)
        DealerCashHandover.__table__.create(db.engine, checkfirst=True)
        DealerCustomerDelivery.__table__.create(db.engine, checkfirst=True)
    except Exception as exc:
        print(f"[cash-book] table ensure failed: {exc}")

    try:
        cols = {c["name"] for c in inspect(db.engine).get_columns("dealer_cash_receipt")}
        if "dealer_register_page_no" not in cols:
            with db.engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE dealer_cash_receipt ADD COLUMN dealer_register_page_no VARCHAR(40)"
                ))
    except Exception as exc:
        print(f"[cash-book] page column migration failed: {exc}")

    try:
        cols = {c["name"] for c in inspect(db.engine).get_columns("dealer_cash_receipt")}
        if "customer_id" not in cols:
            with db.engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE dealer_cash_receipt ADD COLUMN customer_id INTEGER"
                ))
    except Exception as exc:
        print(f"[cash-book] customer link migration failed: {exc}")

    try:
        dcols = {c["name"] for c in inspect(db.engine).get_columns("dealer_customer_delivery")}
        with db.engine.begin() as conn:
            for col, sql in [("do_no","VARCHAR(60)"),("do_selected_by","VARCHAR(20)"),("do_selected_at","TIMESTAMP")]:
                if col not in dcols:
                    conn.execute(text(f"ALTER TABLE dealer_customer_delivery ADD COLUMN {col} {sql}"))
    except Exception as exc:
        print(f"[cash-book] delivery DO migration failed: {exc}")
def _date(v):
    if not v: return date.today()
    try: return datetime.strptime(str(v), "%Y-%m-%d").date()
    except ValueError: return None

def _amt(v):
    try: return round(float(v), 2)
    except (TypeError, ValueError): return 0.0

def _no(model, prefix):
    last = model.query.order_by(model.id.desc()).first()
    return f"{prefix}-{date.today():%Y%m%d}-{(last.id + 1 if last else 1):05d}"

def _receipt(r):
    return {"id":r.id,"receipt_no":r.receipt_no,"date":r.receipt_date.isoformat(),
            "customer_id":r.customer_id,"customer_name":r.customer_name,"customer_phone":r.customer_phone,
            "application_no":r.application_no,"dealer_register_page_no":r.dealer_register_page_no,"booking_for":r.booking_for,"amount":r.amount,
            "payment_mode":r.payment_mode,"payment_mode_label":PAYMENT_MODES.get(r.payment_mode,r.payment_mode),
            "reference_no":r.reference_no,"remarks":r.remarks}

def _customer(c):
    paid = db.session.query(db.func.coalesce(db.func.sum(DealerCashReceipt.amount), 0)).filter(
        DealerCashReceipt.dealer_id == c.dealer_id,
        DealerCashReceipt.customer_id == c.id,
    ).scalar() or 0
    balance = round(float(c.sale_amount or 0) - float(c.loan_amount or 0) - float(paid), 2)
    return {"id":c.id,"page_no":c.page_no,"name":c.full_name,"phone":c.phone,
            "financer":c.financer,"vehicle_no":c.vehicle_no,
            "sale_amount":round(float(c.sale_amount or 0),2),"loan_amount":round(float(c.loan_amount or 0),2),
            "paid_amount":round(float(paid),2),"balance":balance}

def _expense(e):
    return {"id":e.id,"expense_no":e.expense_no,"date":e.expense_date.isoformat(),
            "category":e.category,"category_label":EXPENSE_CATEGORIES.get(e.category,e.category),
            "amount":e.amount,"paid_to":e.paid_to,"remarks":e.remarks}

def _handover(h):
    return {"id":h.id,"handover_no":h.handover_no,"date":h.handover_date.isoformat(),
            "amount":h.amount,"sent_to":h.sent_to,"remarks":h.remarks,"status":h.status}


@dealer_cashbook_bp.route("/cash-book/customers", methods=["GET"])
@require_dealer_auth
def cash_customers():
    dealer = Dealer.query.get(g.current_dealer_id)
    if not dealer or (getattr(dealer, "dealer_category", "dealer") or "dealer").lower() != "showroom":
        return jsonify({"error":"Customer Register is available only for showroom/branch accounts."}),403
    # Backfill customer records from older receipts created before the register existed.
    legacy = DealerCashReceipt.query.filter_by(dealer_id=g.current_dealer_id, customer_id=None).order_by(DealerCashReceipt.id.asc()).all()
    for r in legacy:
        customer = None
        if r.customer_phone:
            customer = DealerCashCustomer.query.filter_by(dealer_id=g.current_dealer_id, phone=r.customer_phone).first()
        if not customer:
            customer = DealerCashCustomer(dealer_id=g.current_dealer_id, full_name=r.customer_name, phone=r.customer_phone, page_no=r.dealer_register_page_no)
            db.session.add(customer)
            db.session.flush()
        elif r.dealer_register_page_no and not customer.page_no:
            customer.page_no = r.dealer_register_page_no
        r.customer_id = customer.id
    if legacy:
        db.session.commit()
    q = str(request.args.get("q") or "").strip().lower()
    rows = DealerCashCustomer.query.filter_by(dealer_id=g.current_dealer_id).order_by(DealerCashCustomer.id.desc()).all()
    if q:
        rows = [x for x in rows if q in " ".join([str(x.page_no or ''),str(x.full_name or ''),str(x.phone or ''),str(x.vehicle_no or '')]).lower()]
    return jsonify({"success":True,"customers":[_customer(x) for x in rows]})

@dealer_cashbook_bp.route("/cash-book/customers/<int:customer_id>", methods=["PUT"])
@require_dealer_auth
def update_cash_customer(customer_id):
    c = DealerCashCustomer.query.filter_by(id=customer_id, dealer_id=g.current_dealer_id).first()
    if not c: return jsonify({"error":"Customer not found."}),404
    d=request.get_json(silent=True) or {}
    c.page_no=str(d.get("page_no") or "").strip() or None
    c.full_name=str(d.get("name") or c.full_name or "").strip()
    c.phone=str(d.get("phone") or "").strip() or None
    c.financer=str(d.get("financer") or "").strip() or None
    c.vehicle_no=str(d.get("vehicle_no") or "").strip() or None
    c.sale_amount=_amt(d.get("sale_amount"))
    c.loan_amount=_amt(d.get("loan_amount"))
    if not c.full_name: return jsonify({"error":"Customer name is required."}),400
    db.session.commit()
    return jsonify({"success":True,"customer":_customer(c)})

@dealer_cashbook_bp.route("/cash-book/all-receipts", methods=["GET"])
@require_dealer_auth
def all_cash_receipts():
    dealer = Dealer.query.get(g.current_dealer_id)
    if not dealer or (getattr(dealer, "dealer_category", "dealer") or "dealer").lower() != "showroom":
        return jsonify({"error":"Receipt Register is available only for showroom/branch accounts."}),403
    rows = DealerCashReceipt.query.filter_by(dealer_id=g.current_dealer_id).order_by(DealerCashReceipt.receipt_date.desc(),DealerCashReceipt.id.desc()).all()
    return jsonify({"success":True,"receipts":[_receipt(x) for x in rows]})

@dealer_cashbook_bp.route("/delivery/options", methods=["GET"])
@require_dealer_auth
def showroom_delivery_options():
    dealer = Dealer.query.get(g.current_dealer_id)
    if not dealer or (getattr(dealer, "dealer_category", "dealer") or "dealer").lower() != "showroom":
        return jsonify({"error":"Delivery is available only for showroom/branch accounts."}),403

    # Only customers who have not received any vehicle yet.
    delivered_ids = {int(x[0]) for x in db.session.query(DealerCustomerDelivery.customer_id)
                     .filter_by(dealer_id=g.current_dealer_id).all()}
    customers = (DealerCashCustomer.query.filter_by(dealer_id=g.current_dealer_id)
                 .order_by(DealerCashCustomer.full_name.asc(), DealerCashCustomer.id.asc()).all())
    customer_rows = [_customer(c) for c in customers if c.id not in delivered_ids]

    # New rickshaw stock: showroom stock already assigned to this dealer,
    # excluding chassis already used in this delivery register.
    delivered_vehicle_ids = {int(x[0]) for x in db.session.query(DealerCustomerDelivery.vehicle_id)
                             .filter(DealerCustomerDelivery.dealer_id == g.current_dealer_id,
                                     DealerCustomerDelivery.vehicle_id.isnot(None)).all()}
    new_rows = (Vehicle.query
                .filter(Vehicle.stage == "Delivery Challan")
                .filter(db.func.lower(db.func.trim(Vehicle.dealer_name)) ==
                        db.func.lower(db.func.trim(dealer.name)))
                .order_by(Vehicle.chassis_no.asc()).all())
    new_stock = [{"id":v.id,"chassis_no":v.chassis_no,"model_name":v.model_name,
                  "date":v.date.isoformat() if v.date else None}
                 for v in new_rows if v.id not in delivered_vehicle_ids]

    delivered_old_ids = {int(x[0]) for x in db.session.query(DealerCustomerDelivery.old_rickshaw_id)
                         .filter(DealerCustomerDelivery.dealer_id == g.current_dealer_id,
                                 DealerCustomerDelivery.old_rickshaw_id.isnot(None)).all()}
    old_rows = (OldRickshaw.query
                .filter(OldRickshaw.sale_dealer_id == g.current_dealer_id,
                        OldRickshaw.status == "sold")
                .order_by(OldRickshaw.vehicle_reg_no.asc()).all())
    old_stock = [{"id":r.id,"vehicle_no":r.vehicle_reg_no,"model_name":r.model_name,
                  "date":r.sale_date.isoformat() if r.sale_date else None}
                 for r in old_rows if r.id not in delivered_old_ids]

    return jsonify({"success":True,"customers":customer_rows,"new_stock":new_stock,"old_stock":old_stock,
                    "battery_stock":[]})


@dealer_cashbook_bp.route("/delivery/<int:delivery_id>", methods=["PUT"])
@require_dealer_auth
def edit_showroom_delivery(delivery_id):
    row = DealerCustomerDelivery.query.filter_by(id=delivery_id, dealer_id=g.current_dealer_id).first_or_404()
    d = request.get_json(silent=True) or {}
    do_no = str(d.get("do_no") or "").strip() or None
    if do_no:
        conflict = DealerCustomerDelivery.query.filter(
            DealerCustomerDelivery.dealer_id == g.current_dealer_id,
            DealerCustomerDelivery.id != row.id,
            db.func.lower(DealerCustomerDelivery.do_no) == do_no.lower()
        ).first()
        if conflict: return jsonify({"error":"This DO No. is already used on another delivery."}),409
    row.do_no = do_no
    row.do_selected_by = "dealer" if do_no else None
    row.do_selected_at = datetime.utcnow() if do_no else None
    if "remarks" in d: row.remarks = str(d.get("remarks") or "").strip() or None
    db.session.commit()
    return jsonify({"success":True,"delivery":{"id":row.id,"delivery_no":row.delivery_no,"do_no":row.do_no,"do_selected_by":row.do_selected_by}})

@dealer_cashbook_bp.route("/delivery", methods=["POST"])
@require_dealer_auth
def create_showroom_delivery():
    dealer = Dealer.query.get(g.current_dealer_id)
    if not dealer or (getattr(dealer, "dealer_category", "dealer") or "dealer").lower() != "showroom":
        return jsonify({"error":"Delivery is available only for showroom/branch accounts."}),403

    d = request.get_json(silent=True) or {}
    customer_id = d.get("customer_id")
    delivery_type = str(d.get("delivery_type") or "").strip().lower()
    if not str(customer_id or "").isdigit():
        return jsonify({"error":"Customer is required."}),400
    if delivery_type not in {"new","old","battery"}:
        return jsonify({"error":"Invalid delivery type."}),400

    customer = DealerCashCustomer.query.filter_by(
        id=int(customer_id), dealer_id=g.current_dealer_id
    ).first()
    if not customer:
        return jsonify({"error":"Customer not found."}),404

    if DealerCustomerDelivery.query.filter_by(
        dealer_id=g.current_dealer_id, customer_id=customer.id
    ).first():
        return jsonify({"error":"This customer already has a delivery record."}),409

    sale_amount = _amt(customer.sale_amount)
    loan_amount = _amt(customer.loan_amount)
    paid_amount = db.session.query(
        db.func.coalesce(db.func.sum(DealerCashReceipt.amount), 0)
    ).filter(
        DealerCashReceipt.dealer_id == g.current_dealer_id,
        DealerCashReceipt.customer_id == customer.id,
    ).scalar() or 0
    down_payment = _amt(paid_amount)

    vehicle_id = None
    old_rickshaw_id = None
    battery_no = None
    battery_qty = 0

    if delivery_type == "new":
        vehicle_id = int(d.get("vehicle_id") or 0)
        vehicle = Vehicle.query.filter_by(id=vehicle_id).first()
        if not vehicle:
            return jsonify({"error":"New rickshaw stock not found."}),404
        if vehicle.stage != "Delivery Challan" or (vehicle.dealer_name or "").strip().lower() != (dealer.name or "").strip().lower():
            return jsonify({"error":"Selected chassis is not in this showroom's stock."}),409
        if DealerCustomerDelivery.query.filter_by(dealer_id=g.current_dealer_id, vehicle_id=vehicle.id).first():
            return jsonify({"error":"This chassis is already delivered."}),409

    elif delivery_type == "old":
        old_rickshaw_id = int(d.get("old_rickshaw_id") or 0)
        old = OldRickshaw.query.filter_by(
            id=old_rickshaw_id, sale_dealer_id=g.current_dealer_id, status="sold"
        ).first()
        if not old:
            return jsonify({"error":"Old rickshaw stock not found."}),404
        if DealerCustomerDelivery.query.filter_by(dealer_id=g.current_dealer_id, old_rickshaw_id=old.id).first():
            return jsonify({"error":"This old rickshaw is already delivered."}),409

    else:
        battery_no = str(d.get("battery_no") or "").strip() or None
        battery_qty = max(0, int(d.get("battery_qty") or 0))
        if not battery_no or battery_qty <= 0:
            return jsonify({"error":"Battery number and quantity are required."}),400
        return jsonify({"error":"Battery delivery will be enabled in the next step."}),400

    row = DealerCustomerDelivery(
        dealer_id=g.current_dealer_id, customer_id=customer.id,
        delivery_no=_no(DealerCustomerDelivery, "DEL"),
        delivery_date=_date(d.get("date")) or date.today(),
        delivery_type=delivery_type, vehicle_id=vehicle_id,
        old_rickshaw_id=old_rickshaw_id, battery_no=battery_no,
        battery_qty=battery_qty, sale_amount=sale_amount,
        loan_amount=loan_amount, down_payment=down_payment,
        remarks=str(d.get("remarks") or "").strip() or None,
    )
    db.session.add(row)
    db.session.commit()
    return jsonify({"success":True,"delivery":{
        "id":row.id,"delivery_no":row.delivery_no,"date":row.delivery_date.isoformat(),
        "customer_id":row.customer_id,"delivery_type":row.delivery_type,
        "sale_amount":row.sale_amount,"loan_amount":row.loan_amount,
        "down_payment":row.down_payment,
        "do_no":row.do_no,
        "do_selected_by":row.do_selected_by,
    }}),201


@dealer_cashbook_bp.route("/cash-book", methods=["GET"])
@require_dealer_auth
def cash_book():
    dealer = Dealer.query.get(g.current_dealer_id)
    if not dealer: return jsonify({"error":"Dealer not found."}),404
    # Only company-owned showroom/branch accounts can operate the booking
    # receipt/cash-book flow. Registered/unregistered external dealers do not.
    if (getattr(dealer, "dealer_category", "dealer") or "dealer").lower() != "showroom":
        return jsonify({"error":"Cash Book / Booking Receipt is not enabled for this dealer."}),403
    start, end = _date(request.args.get("from")), _date(request.args.get("to"))
    if not start or not end: return jsonify({"error":"Invalid date. Use YYYY-MM-DD."}), 400
    if start > end: return jsonify({"error":"From date cannot be after To date."}), 400
    did = g.current_dealer_id
    rs = DealerCashReceipt.query.filter_by(dealer_id=did).filter(DealerCashReceipt.receipt_date.between(start,end)).order_by(DealerCashReceipt.receipt_date.desc(),DealerCashReceipt.id.desc()).all()
    es = DealerCashExpense.query.filter_by(dealer_id=did).filter(DealerCashExpense.expense_date.between(start,end)).order_by(DealerCashExpense.expense_date.desc(),DealerCashExpense.id.desc()).all()
    hs = DealerCashHandover.query.filter_by(dealer_id=did).filter(DealerCashHandover.handover_date.between(start,end),DealerCashHandover.status != "rejected").order_by(DealerCashHandover.handover_date.desc(),DealerCashHandover.id.desc()).all()
    cash = sum(r.amount for r in rs if r.payment_mode == "cash")
    expenses = sum(e.amount for e in es)
    handover = sum(h.amount for h in hs)

    # Opening cash is the previous closing cash: all cash receipts minus
    # expenses and HO handovers strictly before the selected start date.
    prior_receipts = db.session.query(db.func.coalesce(db.func.sum(DealerCashReceipt.amount), 0)).filter(
        DealerCashReceipt.dealer_id == did,
        DealerCashReceipt.receipt_date < start,
        DealerCashReceipt.payment_mode == "cash",
    ).scalar() or 0
    prior_expenses = db.session.query(db.func.coalesce(db.func.sum(DealerCashExpense.amount), 0)).filter(
        DealerCashExpense.dealer_id == did,
        DealerCashExpense.expense_date < start,
    ).scalar() or 0
    prior_handover = db.session.query(db.func.coalesce(db.func.sum(DealerCashHandover.amount), 0)).filter(
        DealerCashHandover.dealer_id == did,
        DealerCashHandover.handover_date < start,
        DealerCashHandover.status != "rejected",
    ).scalar() or 0
    opening_balance = round(float(prior_receipts) - float(prior_expenses) - float(prior_handover), 2)
    net_movement = round(float(cash) - float(expenses) - float(handover), 2)
    closing_balance = round(opening_balance + net_movement, 2)

    return jsonify({"success":True,"from":start.isoformat(),"to":end.isoformat(),
        "receipts":[_receipt(r) for r in rs],"expenses":[_expense(e) for e in es],"handovers":[_handover(h) for h in hs],
        "summary":{"total_receipts":round(sum(r.amount for r in rs),2),"cash_received":round(cash,2),
                    "expenses":round(expenses,2),"ho_handover":round(handover,2),
                    "opening_balance":opening_balance,"net_movement":net_movement,
                    "closing_balance":closing_balance},
        "expense_categories":EXPENSE_CATEGORIES,"payment_modes":PAYMENT_MODES})

@dealer_cashbook_bp.route("/cash-book/receipt", methods=["POST"])
@require_dealer_auth
def create_receipt():
    dealer = Dealer.query.get(g.current_dealer_id)
    if not dealer or (getattr(dealer, "dealer_category", "dealer") or "dealer").lower() != "showroom":
        return jsonify({"error":"Booking Receipt is available only for showroom/branch accounts."}),403
    d=request.get_json(silent=True) or {}; name=str(d.get("customer_name") or "").strip()
    amount=_amt(d.get("amount")); mode=str(d.get("payment_mode") or "cash").lower().strip(); rd=_date(d.get("date"))
    if not name: return jsonify({"error":"Customer name is required."}),400
    if amount<=0: return jsonify({"error":"Amount must be greater than zero."}),400
    if mode not in PAYMENT_MODES: return jsonify({"error":"Invalid payment mode."}),400
    if not rd: return jsonify({"error":"Invalid receipt date."}),400
    if not Dealer.query.get(g.current_dealer_id): return jsonify({"error":"Dealer not found."}),404
    customer_id = d.get("customer_id")
    customer = DealerCashCustomer.query.filter_by(id=int(customer_id), dealer_id=g.current_dealer_id).first() if str(customer_id or "").isdigit() else None
    phone = str(d.get("customer_phone") or "").strip() or None
    page_no = str(d.get("dealer_register_page_no") or "").strip() or None
    if not customer and phone:
        customer = DealerCashCustomer.query.filter_by(dealer_id=g.current_dealer_id, phone=phone).order_by(DealerCashCustomer.id.desc()).first()
    if not customer:
        customer = DealerCashCustomer(dealer_id=g.current_dealer_id, full_name=name, phone=phone, page_no=page_no)
        db.session.add(customer)
        db.session.flush()
    else:
        customer.full_name = name or customer.full_name
        customer.phone = phone or customer.phone
        if page_no: customer.page_no = page_no
    r=DealerCashReceipt(dealer_id=g.current_dealer_id, customer_id=customer.id, receipt_no=_no(DealerCashReceipt,"DRC"), receipt_date=rd,
       customer_name=name, customer_phone=phone,
       application_no=str(d.get("application_no") or "").strip() or None,
       dealer_register_page_no=str(d.get("dealer_register_page_no") or "").strip() or None,
       booking_for=str(d.get("booking_for") or "").strip() or None, amount=amount, payment_mode=mode,
       reference_no=str(d.get("reference_no") or "").strip() or None, remarks=str(d.get("remarks") or "").strip() or None)
    db.session.add(r); db.session.commit()
    return jsonify({"success":True,"receipt":_receipt(r)}),201

@dealer_cashbook_bp.route("/cash-book/expense", methods=["POST"])
@require_dealer_auth
def create_expense():
    dealer = Dealer.query.get(g.current_dealer_id)
    if not dealer or (getattr(dealer, "dealer_category", "dealer") or "dealer").lower() != "showroom":
        return jsonify({"error":"Cash Book is available only for showroom/branch accounts."}),403
    d=request.get_json(silent=True) or {}; cat=str(d.get("category") or "").strip(); amount=_amt(d.get("amount")); ed=_date(d.get("date"))
    if cat not in EXPENSE_CATEGORIES: return jsonify({"error":"Invalid expense category."}),400
    if amount<=0: return jsonify({"error":"Amount must be greater than zero."}),400
    if not ed: return jsonify({"error":"Invalid expense date."}),400
    e=DealerCashExpense(dealer_id=g.current_dealer_id, expense_no=_no(DealerCashExpense,"DEX"), expense_date=ed,
       category=cat, amount=amount, paid_to=str(d.get("paid_to") or "").strip() or None, remarks=str(d.get("remarks") or "").strip() or None)
    db.session.add(e); db.session.commit()
    return jsonify({"success":True,"expense":_expense(e)}),201

@dealer_cashbook_bp.route("/cash-book/handover", methods=["POST"])
@require_dealer_auth
def create_handover():
    dealer = Dealer.query.get(g.current_dealer_id)
    if not dealer or (getattr(dealer, "dealer_category", "dealer") or "dealer").lower() != "showroom":
        return jsonify({"error":"Cash handover is available only for showroom/branch accounts."}),403
    d=request.get_json(silent=True) or {}; amount=_amt(d.get("amount")); hd=_date(d.get("date"))
    if amount<=0: return jsonify({"error":"Amount must be greater than zero."}),400
    if not hd: return jsonify({"error":"Invalid handover date."}),400
    h=DealerCashHandover(dealer_id=g.current_dealer_id, handover_no=_no(DealerCashHandover,"DHO"), handover_date=hd,
       amount=amount, sent_to=str(d.get("sent_to") or "").strip() or None, remarks=str(d.get("remarks") or "").strip() or None)
    db.session.add(h); db.session.commit()
    return jsonify({"success":True,"handover":_handover(h)}),201
