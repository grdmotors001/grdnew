from datetime import date, datetime
from flask import Blueprint, request, jsonify, g
from sqlalchemy import inspect, text, or_
from models import db, Dealer, Vehicle, OldRickshaw, LoanWorkflow, DeliveryChallan, TaxInvoice
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

class DealerDealCancellation(db.Model):
    """Auditable dealer-side booking cancellation and customer refund."""
    __tablename__ = "dealer_deal_cancellation"
    id = db.Column(db.Integer, primary_key=True)
    dealer_id = db.Column(db.Integer, db.ForeignKey("dealer.id"), nullable=False, index=True)
    customer_id = db.Column(db.Integer, db.ForeignKey("dealer_cash_customer.id"), nullable=False, unique=True, index=True)
    cancellation_no = db.Column(db.String(40), unique=True, nullable=False, index=True)
    cancelled_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, index=True)
    reason = db.Column(db.String(500), nullable=False)
    refund_amount = db.Column(db.Float, nullable=False, default=0)
    refund_date = db.Column(db.Date, nullable=False, default=date.today)
    refund_mode = db.Column(db.String(20), nullable=False, default="cash")
    refund_reference = db.Column(db.String(80))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

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
    file_charge = db.Column(db.Float, default=0)
    misc_charge = db.Column(db.Float, default=0)
    loan_workflow_id = db.Column(db.Integer, db.ForeignKey("loan_workflow.id"), nullable=True, index=True)
    do_no = db.Column(db.String(60), index=True)
    do_selected_by = db.Column(db.String(20))
    do_selected_at = db.Column(db.DateTime)
    billing_status = db.Column(db.String(20), default="PENDING_BILL", index=True)
    remarks = db.Column(db.String(300))
    approved_by = db.Column(db.String(120))
    approved_at = db.Column(db.DateTime)
    verified_by = db.Column(db.String(120))
    verified_at = db.Column(db.DateTime)
    dealer = db.relationship("Dealer")
    customer = db.relationship("DealerCashCustomer")
    vehicle = db.relationship("Vehicle")
    old_rickshaw = db.relationship("OldRickshaw")
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
    # The customer register is already present in production. Avoid running
    # information_schema/table-existence checks on every customer-list read.
    if request.endpoint == "dealer_cashbook.cash_customers":
        return

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
        DealerDealCancellation.__table__.create(db.engine, checkfirst=True)
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
            for col, sql in [("do_no","VARCHAR(60)"),("do_selected_by","VARCHAR(20)"),("do_selected_at","TIMESTAMP"),("billing_status","VARCHAR(20) DEFAULT 'PENDING_BILL'"),("approved_by","VARCHAR(120)"),("approved_at","TIMESTAMP"),("verified_by","VARCHAR(120)"),("verified_at","TIMESTAMP"),("file_charge","DOUBLE PRECISION DEFAULT 0"),("misc_charge","DOUBLE PRECISION DEFAULT 0"),("loan_workflow_id","INTEGER")]:
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

def _has_active_tax_invoice(c):
    """Tax Invoice is the source of truth for the Billed bucket.

    This helper is kept for single-customer operations such as cancellation.
    The customer-list endpoint uses _customer_rows() below to avoid N+1 queries.
    """
    invoices = (db.session.query(TaxInvoice)
                .join(DeliveryChallan, TaxInvoice.delivery_challan_id == DeliveryChallan.id)
                .filter(DeliveryChallan.dealer_id == c.dealer_id,
                        DeliveryChallan.cancelled.is_(False),
                        TaxInvoice.cancelled.is_(False))
                .all())
    name = str(c.full_name or "").strip().casefold()
    phone = str(c.phone or "").strip()
    vehicle_no = str(c.vehicle_no or "").strip().casefold()
    for ti in invoices:
        ti_name = str(ti.buyer_name or "").strip().casefold()
        ti_phone = str(ti.buyer_mobile or "").strip()
        ti_vehicle = str(getattr(ti, "vehicle_reg_no", None) or getattr(ti, "vehicle_no", None) or "").strip().casefold()
        if phone and ti_phone and phone == ti_phone and name == ti_name:
            return ti
        if not phone and name == ti_name and vehicle_no and ti_vehicle and vehicle_no == ti_vehicle:
            return ti
        if not phone and not vehicle_no and name and name == ti_name:
            return ti
    return None

def _customer_payload(c, paid, cancellation=None, invoice=None):
    status = "DEALER_CANCEL" if cancellation else ("BILLED" if invoice else "VEHICLE_PENDING")
    balance = round(float(c.sale_amount or 0) - float(c.loan_amount or 0) - float(paid or 0), 2)
    return {"id":c.id,"page_no":c.page_no,"name":c.full_name,"phone":c.phone,
            "financer":c.financer,"vehicle_no":c.vehicle_no,
            "sale_amount":round(float(c.sale_amount or 0),2),"loan_amount":round(float(c.loan_amount or 0),2),
            "paid_amount":round(float(paid or 0),2),"balance":balance,
            "status":status,
            "status_label":{"VEHICLE_PENDING":"Vehicle Pending","BILLED":"Billed","DEALER_CANCEL":"Dealer Cancel"}[status],
            "cancelled_at":cancellation.cancelled_at.isoformat() if cancellation else None,
            "cancel_reason":cancellation.reason if cancellation else None,
            "refund_amount":round(float(cancellation.refund_amount or 0),2) if cancellation else 0,
            "refund_date":cancellation.refund_date.isoformat() if cancellation else None}

def _customer(c):
    paid = db.session.query(db.func.coalesce(db.func.sum(DealerCashReceipt.amount), 0)).filter(
        DealerCashReceipt.dealer_id == c.dealer_id,
        DealerCashReceipt.customer_id == c.id,
    ).scalar() or 0
    cancellation = DealerDealCancellation.query.filter_by(
        dealer_id=c.dealer_id, customer_id=c.id
    ).first()
    invoice = None if cancellation else _has_active_tax_invoice(c)
    return _customer_payload(c, paid, cancellation, invoice)

def _customer_rows(customers):
    """Build the customer register in bulk without scanning all historical invoices.

    The customer table is the primary register.  For status classification we
    only load active invoices that can match one of the customers currently
    being returned, instead of loading every invoice for the dealer.
    """
    if not customers:
        return []

    dealer_id = customers[0].dealer_id
    customer_ids = [c.id for c in customers]

    paid_rows = (db.session.query(
                    DealerCashReceipt.customer_id,
                    db.func.coalesce(db.func.sum(DealerCashReceipt.amount), 0))
                 .filter(DealerCashReceipt.dealer_id == dealer_id,
                         DealerCashReceipt.customer_id.in_(customer_ids))
                 .group_by(DealerCashReceipt.customer_id).all())
    paid_by_customer = {int(cid): float(amount or 0) for cid, amount in paid_rows}

    cancellation_rows = DealerDealCancellation.query.filter(
        DealerDealCancellation.dealer_id == dealer_id,
        DealerDealCancellation.customer_id.in_(customer_ids)
    ).all()
    cancellation_by_customer = {int(x.customer_id): x for x in cancellation_rows}

    # Only fetch invoices whose buyer phone or buyer name can match one of the
    # current register rows.  Chunk the IN lists so the query stays small even
    # when a showroom has a large customer register.
    phones = sorted({str(c.phone).strip() for c in customers if c.phone})
    names = sorted({str(c.full_name or "").strip().casefold() for c in customers if c.full_name})
    # One database query instead of up to 8 chunked invoice queries.
    # This keeps the register fast when a showroom has hundreds of customers.
    invoice_rows = []
    match_filters = []
    if phones:
        match_filters.append(TaxInvoice.buyer_mobile.in_(phones))
    if names:
        match_filters.append(db.func.lower(TaxInvoice.buyer_name).in_(names))

    if match_filters:
        invoice_rows = (
            db.session.query(TaxInvoice)
            .join(DeliveryChallan, TaxInvoice.delivery_challan_id == DeliveryChallan.id)
            .filter(
                DeliveryChallan.dealer_id == dealer_id,
                DeliveryChallan.cancelled.is_(False),
                TaxInvoice.cancelled.is_(False),
                or_(*match_filters),
            ).all()
        )

    invoice_by_name_phone = {}
    invoice_by_name_vehicle = {}
    invoice_by_name = {}
    seen_invoice_ids = set()
    for ti in invoice_rows:
        if ti.id in seen_invoice_ids:
            continue
        seen_invoice_ids.add(ti.id)
        name = str(ti.buyer_name or "").strip().casefold()
        phone = str(ti.buyer_mobile or "").strip()
        vehicle = str(
            getattr(ti, "vehicle_reg_no", None)
            or getattr(ti, "vehicle_no", None)
            or ""
        ).strip().casefold()
        if not name:
            continue
        if phone:
            invoice_by_name_phone[(name, phone)] = ti
        if vehicle:
            invoice_by_name_vehicle[(name, vehicle)] = ti
        invoice_by_name.setdefault(name, ti)

    result = []
    for c in customers:
        cancellation = cancellation_by_customer.get(c.id)
        invoice = None
        if not cancellation:
            name = str(c.full_name or "").strip().casefold()
            phone = str(c.phone or "").strip()
            vehicle = str(c.vehicle_no or "").strip().casefold()
            if phone and name:
                invoice = invoice_by_name_phone.get((name, phone))
            if not invoice and not phone and name and vehicle:
                invoice = invoice_by_name_vehicle.get((name, vehicle))
            if not invoice and not phone and not vehicle and name:
                invoice = invoice_by_name.get(name)
        result.append(_customer_payload(
            c, paid_by_customer.get(c.id, 0), cancellation, invoice
        ))
    return result
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

    # The customer register is now read-first.  Previously every page load
    # scanned all legacy receipts and all historical Tax Invoices to perform
    # backfill, which could make a large register hit the request timeout.
    # Existing dealer_cash_customer rows are returned immediately.
    rows = (DealerCashCustomer.query
            .filter_by(dealer_id=g.current_dealer_id)
            .order_by(DealerCashCustomer.id.desc()).all())

    # Only perform the legacy bootstrap when this dealer has no customer
    # register rows yet.  Once the register contains data, normal list calls
    # never re-run historical backfill.
    if not rows:
        legacy = (DealerCashReceipt.query
                  .filter_by(dealer_id=g.current_dealer_id, customer_id=None)
                  .order_by(DealerCashReceipt.id.asc()).all())

        existing_customers = []
        by_phone = {}
        for r in legacy:
            customer = by_phone.get(str(r.customer_phone).strip()) if r.customer_phone else None
            if not customer:
                customer = DealerCashCustomer(
                    dealer_id=g.current_dealer_id,
                    full_name=r.customer_name,
                    phone=r.customer_phone,
                    page_no=r.dealer_register_page_no
                )
                db.session.add(customer)
                db.session.flush()
                existing_customers.append(customer)
                if customer.phone:
                    by_phone[str(customer.phone).strip()] = customer
            elif r.dealer_register_page_no and not customer.page_no:
                customer.page_no = r.dealer_register_page_no
            r.customer_id = customer.id

        if legacy:
            db.session.commit()

        # Bootstrap old billed customers only for a genuinely empty register.
        billed = (db.session.query(DeliveryChallan, TaxInvoice)
                  .join(TaxInvoice, TaxInvoice.delivery_challan_id == DeliveryChallan.id)
                  .filter(
                      DeliveryChallan.dealer_id == g.current_dealer_id,
                      DeliveryChallan.cancelled.is_(False),
                      TaxInvoice.cancelled.is_(False),
                  ).all())

        if billed:
            existing_customers = DealerCashCustomer.query.filter_by(
                dealer_id=g.current_dealer_id
            ).all()
            existing_phones = {str(c.phone).strip() for c in existing_customers if c.phone}
            existing_name_vehicle = {
                (str(c.full_name or "").strip(), str(c.vehicle_no or "").strip())
                for c in existing_customers if not c.phone
            }
            created_any = False

            for dc, ti in billed:
                name = (ti.buyer_name or "").strip()
                phone = (ti.buyer_mobile or "").strip() or None
                vehicle_no = str(getattr(ti, "vehicle_reg_no", None) or "").strip() or None
                if not name:
                    continue

                if phone:
                    if phone in existing_phones:
                        continue
                else:
                    key = (name, vehicle_no or "")
                    if key in existing_name_vehicle:
                        continue

                db.session.add(DealerCashCustomer(
                    dealer_id=g.current_dealer_id,
                    full_name=name,
                    phone=phone,
                    vehicle_no=vehicle_no,
                    sale_amount=ti.sale_amount or 0,
                    loan_amount=ti.hypothecation_amount or 0,
                    financer=ti.financer_name,
                ))
                if phone:
                    existing_phones.add(phone)
                else:
                    existing_name_vehicle.add((name, vehicle_no or ""))
                created_any = True

            if created_any:
                db.session.commit()

        rows = (DealerCashCustomer.query
                .filter_by(dealer_id=g.current_dealer_id)
                .order_by(DealerCashCustomer.id.desc()).all())

    q = str(request.args.get("q") or "").strip().lower()
    status_filter = str(request.args.get("status") or "").strip().upper()

    if q:
        rows = [x for x in rows if q in " ".join([
            str(x.page_no or ''), str(x.full_name or ''),
            str(x.phone or ''), str(x.vehicle_no or '')
        ]).lower()]

    customer_rows = _customer_rows(rows)
    if status_filter in {"VEHICLE_PENDING","BILLED","DEALER_CANCEL"}:
        customer_rows = [x for x in customer_rows if x["status"] == status_filter]

    return jsonify({"success":True,"customers":customer_rows})

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

@dealer_cashbook_bp.route("/cash-book/customers/<int:customer_id>/cancel", methods=["POST"])
@require_dealer_auth
def cancel_customer_booking(customer_id):
    dealer = Dealer.query.get(g.current_dealer_id)
    if not dealer or (getattr(dealer, "dealer_category", "dealer") or "dealer").lower() != "showroom":
        return jsonify({"error":"Booking cancellation is available only for showroom/branch accounts."}),403

    customer = DealerCashCustomer.query.filter_by(
        id=customer_id, dealer_id=g.current_dealer_id
    ).first()
    if not customer:
        return jsonify({"error":"Customer not found."}),404

    if DealerDealCancellation.query.filter_by(
        customer_id=customer.id, dealer_id=g.current_dealer_id
    ).first():
        return jsonify({"error":"This booking is already marked as Dealer Cancel."}),409

    if _has_active_tax_invoice(customer):
        return jsonify({"error":"This customer is already Billed. A billed sale cannot be cancelled from the booking screen."}),409

    if DealerCustomerDelivery.query.filter_by(
        customer_id=customer.id, dealer_id=g.current_dealer_id
    ).first():
        return jsonify({"error":"This customer already has a delivery record. Cancel the delivery/billing workflow first."}),409

    d = request.get_json(silent=True) or {}
    reason = str(d.get("reason") or "").strip()
    if not reason:
        return jsonify({"error":"Cancellation reason is required."}),400

    paid = db.session.query(db.func.coalesce(db.func.sum(DealerCashReceipt.amount), 0)).filter(
        DealerCashReceipt.dealer_id == g.current_dealer_id,
        DealerCashReceipt.customer_id == customer.id,
    ).scalar() or 0
    paid = round(float(paid), 2)
    refund_amount = _amt(d.get("refund_amount", paid))
    if refund_amount < 0 or refund_amount > paid:
        return jsonify({"error":f"Refund amount cannot exceed paid amount ₹{paid:,.2f}."}),400

    refund_date = _date(d.get("refund_date")) or date.today()
    refund_mode = str(d.get("refund_mode") or "cash").strip().lower()
    if refund_mode not in PAYMENT_MODES:
        return jsonify({"error":"Invalid refund mode."}),400

    row = DealerDealCancellation(
        dealer_id=g.current_dealer_id,
        customer_id=customer.id,
        cancellation_no=_no(DealerDealCancellation, "DCC"),
        cancelled_at=datetime.utcnow(),
        reason=reason,
        refund_amount=refund_amount,
        refund_date=refund_date,
        refund_mode=refund_mode,
        refund_reference=str(d.get("refund_reference") or "").strip() or None,
    )
    db.session.add(row)
    db.session.commit()
    return jsonify({"success":True,"cancellation":{
        "id":row.id,"cancellation_no":row.cancellation_no,"customer_id":row.customer_id,
        "cancelled_at":row.cancelled_at.isoformat(),"reason":row.reason,
        "refund_amount":row.refund_amount,"refund_date":row.refund_date.isoformat(),
        "refund_mode":row.refund_mode,"refund_reference":row.refund_reference
    },"customer":_customer(customer)}),201

@dealer_cashbook_bp.route("/cash-book/all-receipts", methods=["GET"])
@require_dealer_auth
def all_cash_receipts():
    dealer = Dealer.query.get(g.current_dealer_id)
    if not dealer or (getattr(dealer, "dealer_category", "dealer") or "dealer").lower() != "showroom":
        return jsonify({"error":"Receipt Register is available only for showroom/branch accounts."}),403
    rows = DealerCashReceipt.query.filter_by(dealer_id=g.current_dealer_id).order_by(DealerCashReceipt.receipt_date.desc(),DealerCashReceipt.id.desc()).all()
    return jsonify({"success":True,"receipts":[_receipt(x) for x in rows]})

@dealer_cashbook_bp.route("/delivery/do-options", methods=["GET"])
@require_dealer_auth
def showroom_delivery_do_options():
    rows=(LoanWorkflow.query.filter(LoanWorkflow.dealer_id == g.current_dealer_id, LoanWorkflow.do_no.isnot(None))
          .order_by(LoanWorkflow.id.desc()).limit(500).all())
    return jsonify({"do_numbers":[{"id":r.id,"do_no":r.do_no,"application_no":r.application_no,
        "customer_name":r.customer.full_name if r.customer else ""} for r in rows if r.do_no]})

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

    approved_loans = (LoanWorkflow.query.filter(LoanWorkflow.dealer_id == g.current_dealer_id)
        .filter(LoanWorkflow.status.in_(["APPROVED","approved","SANCTIONED","sanctioned","DISBURSED","disbursed"]))
        .order_by(LoanWorkflow.id.desc()).limit(500).all())
    approved_loan_rows = [{"id":r.id,"application_no":r.application_no,"do_no":r.do_no,
        "customer_name":r.customer.full_name if r.customer else "","customer_id":r.customer_id,"status":r.status}
        for r in approved_loans]
    return jsonify({"success":True,"customers":customer_rows,"new_stock":new_stock,"old_stock":old_stock,
                    "battery_stock":[],"approved_loans":approved_loan_rows})


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

    sale_amount = _amt(d.get("sale_amount"))
    loan_amount = _amt(d.get("loan_amount"))
    if "sale_amount" not in d: sale_amount = _amt(customer.sale_amount)
    if "loan_amount" not in d: loan_amount = _amt(customer.loan_amount)
    file_charge = _amt(d.get("file_charge"))
    misc_charge = _amt(d.get("misc_charge"))
    loan_workflow_id = int(d.get("loan_workflow_id") or 0) or None
    if loan_amount > 0:
        if not loan_workflow_id:
            return jsonify({"error":"Approved loan selection is required when Loan Amount is entered."}),400
        approved_loan = LoanWorkflow.query.filter(LoanWorkflow.id == loan_workflow_id,
            LoanWorkflow.dealer_id == g.current_dealer_id,
            LoanWorkflow.status.in_(["APPROVED","approved","SANCTIONED","sanctioned","DISBURSED","disbursed"])).first()
        if not approved_loan:
            return jsonify({"error":"Selected approved loan was not found for this dealer."}),400
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
        file_charge=file_charge, misc_charge=misc_charge, loan_workflow_id=loan_workflow_id,
        remarks=str(d.get("remarks") or "").strip() or None,
        do_no=str(d.get("do_no") or "").strip() or None,
        do_selected_by="dealer" if str(d.get("do_no") or "").strip() else None,
        do_selected_at=datetime.utcnow() if str(d.get("do_no") or "").strip() else None,
    )
    if row.do_no:
        conflict=DealerCustomerDelivery.query.filter(
            DealerCustomerDelivery.dealer_id == g.current_dealer_id,
            db.func.lower(DealerCustomerDelivery.do_no) == row.do_no.lower()
        ).first()
        if conflict:
            return jsonify({"error":"This DO No. is already used on another delivery."}),409
    db.session.add(row)
    db.session.commit()
    return jsonify({"success":True,"delivery":{
        "id":row.id,"delivery_no":row.delivery_no,"date":row.delivery_date.isoformat(),
        "customer_id":row.customer_id,"delivery_type":row.delivery_type,
        "sale_amount":row.sale_amount,"loan_amount":row.loan_amount,
        "down_payment":row.down_payment,
        "do_no":row.do_no,
        "do_selected_by":row.do_selected_by,
        "billing_status":row.billing_status,
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
    refunds = sum(x.refund_amount for x in DealerDealCancellation.query.filter_by(dealer_id=did).filter(
        DealerDealCancellation.refund_date.between(start,end),
        DealerDealCancellation.refund_mode == "cash"
    ).all())
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
    prior_refunds = db.session.query(db.func.coalesce(db.func.sum(DealerDealCancellation.refund_amount), 0)).filter(
        DealerDealCancellation.dealer_id == did,
        DealerDealCancellation.refund_date < start,
        DealerDealCancellation.refund_mode == "cash",
    ).scalar() or 0
    prior_handover = db.session.query(db.func.coalesce(db.func.sum(DealerCashHandover.amount), 0)).filter(
        DealerCashHandover.dealer_id == did,
        DealerCashHandover.handover_date < start,
        DealerCashHandover.status != "rejected",
    ).scalar() or 0
    opening_balance = round(float(prior_receipts) - float(prior_expenses) - float(prior_handover) - float(prior_refunds), 2)
    net_movement = round(float(cash) - float(expenses) - float(handover) - float(refunds), 2)
    closing_balance = round(opening_balance + net_movement, 2)

    return jsonify({"success":True,"from":start.isoformat(),"to":end.isoformat(),
        "receipts":[_receipt(r) for r in rs],"expenses":[_expense(e) for e in es],"handovers":[_handover(h) for h in hs],
        "summary":{"total_receipts":round(sum(r.amount for r in rs),2),"cash_received":round(cash,2),
                    "expenses":round(expenses,2),"refunds":round(refunds,2),"ho_handover":round(handover,2),
                    "opening_balance":opening_balance,"net_movement":net_movement,
                    "closing_balance":closing_balance},
        "expense_categories":EXPENSE_CATEGORIES,"payment_modes":PAYMENT_MODES})

@dealer_cashbook_bp.route("/cash-book/receipt", methods=["POST"])
@require_dealer_auth
def create_receipt():
    dealer = Dealer.query.get(g.current_dealer_id)
    if not dealer or (getattr(dealer, "dealer_category", "dealer") or "dealer").lower() != "showroom":
        return jsonify({"error":"Booking Receipt is available only for showroom/branch accounts."}),403

    d=request.get_json(silent=True) or {}
    receipt_type=str(d.get("receipt_type") or "new_booking").strip().lower()
    if receipt_type not in {"new_booking","balance_payment"}:
        return jsonify({"error":"Select New Booking or Balance Payment."}),400

    amount=_amt(d.get("amount"))
    # Showroom customer receipts are strictly CASH receipts. Bank/UPI/cheque receipts use separate online-payment flows.
    mode="cash"
    rd=_date(d.get("date"))
    if amount<=0: return jsonify({"error":"Amount must be greater than zero."}),400
    if mode not in PAYMENT_MODES: return jsonify({"error":"Invalid payment mode."}),400
    if not rd: return jsonify({"error":"Invalid receipt date."}),400

    customer=None
    phone=str(d.get("customer_phone") or "").strip() or None
    page_no=str(d.get("dealer_register_page_no") or "").strip() or None

    if receipt_type == "balance_payment":
        customer_id=d.get("customer_id")
        customer=(DealerCashCustomer.query
                  .filter_by(id=int(customer_id), dealer_id=g.current_dealer_id).first()
                  if str(customer_id or "").isdigit() else None)
        if not customer:
            return jsonify({"error":"Please select a previous customer for Balance Payment."}),400
        paid=db.session.query(db.func.coalesce(db.func.sum(DealerCashReceipt.amount),0)).filter(
            DealerCashReceipt.dealer_id==g.current_dealer_id,
            DealerCashReceipt.customer_id==customer.id
        ).scalar() or 0
        balance=round(float(customer.sale_amount or 0)-float(customer.loan_amount or 0)-float(paid),2)
        if balance <= 0:
            return jsonify({"error":"This customer has no outstanding balance."}),400
        if amount > balance:
            return jsonify({"error":f"Receipt amount cannot be greater than outstanding balance ₹{balance:,.2f}."}),400
        name=customer.full_name
        phone=customer.phone
        booking_for=customer.vehicle_no or None
    else:
        name=str(d.get("customer_name") or "").strip()
        booking_for=str(d.get("booking_for") or "").strip().lower()
        if not name: return jsonify({"error":"Customer name is required for New Booking."}),400
        if not phone: return jsonify({"error":"Mobile number is required for New Booking."}),400
        if booking_for not in {"new","old","battery"}:
            return jsonify({"error":"Select New / Old / Battery for the booking."}),400
        sale_amount=_amt(d.get("sale_amount"))
        loan_amount=_amt(d.get("loan_amount"))
        if sale_amount <= 0: return jsonify({"error":"Sale Amount is required for New Booking."}),400
        if loan_amount < 0 or loan_amount > sale_amount:
            return jsonify({"error":"Loan Amount cannot exceed Sale Amount."}),400
        customer=DealerCashCustomer(
            dealer_id=g.current_dealer_id, full_name=name, phone=phone, page_no=page_no,
            vehicle_no=booking_for, sale_amount=sale_amount, loan_amount=loan_amount
        )
        db.session.add(customer); db.session.flush()

    r=DealerCashReceipt(
        dealer_id=g.current_dealer_id, customer_id=customer.id,
        receipt_no=_no(DealerCashReceipt,"DRC"), receipt_date=rd,
        customer_name=name, customer_phone=phone,
        application_no=str(d.get("application_no") or "").strip() or None,
        dealer_register_page_no=page_no or customer.page_no,
        booking_for=(booking_for if receipt_type=="new_booking" else (customer.vehicle_no or None)),
        amount=amount, payment_mode=mode,
        reference_no=str(d.get("reference_no") or "").strip() or None,
        remarks=str(d.get("remarks") or "").strip() or None
    )
    db.session.add(r); db.session.commit()
    return jsonify({"success":True,"receipt":_receipt(r),"customer":_customer(customer)}),201

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