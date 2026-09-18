from flask import Blueprint, request, jsonify
from datetime import datetime, date, timedelta
from calendar import monthrange
from sqlalchemy import func
from models_hr import db, Employee, AttendancePunch, AttendanceDay, SalaryRun
from auth import require_auth

hr_bp = Blueprint("hr", __name__)

def _date(v):
    try: return datetime.strptime(v, "%Y-%m-%d").date() if v else None
    except ValueError: return None

def _dt(v):
    try: return datetime.fromisoformat(v.replace("Z", "+00:00")).replace(tzinfo=None) if v else None
    except ValueError: return None

def emp_json(e):
    return {"id":e.id,"employee_code":e.employee_code,"name":e.name,"department":e.department,"designation":e.designation,"mobile":e.mobile,"photo_url":e.photo_url,"joining_date":e.joining_date.isoformat() if e.joining_date else None,"machine_user_id":e.machine_user_id,"basic_salary":e.basic_salary,"hra":e.hra,"other_allowance":e.other_allowance,"overtime_rate":e.overtime_rate,"active":e.active}

def day_json(x):
    return {"id":x.id,"work_date":x.work_date.isoformat(),"employee_id":x.employee_id,"employee_name":x.employee.name if x.employee else "","first_in":x.first_in.isoformat(sep=" ") if x.first_in else None,"last_out":x.last_out.isoformat(sep=" ") if x.last_out else None,"status":x.status,"work_hours":round(x.work_hours or 0,2),"overtime_hours":round(x.overtime_hours or 0,2),"late_minutes":int(x.late_minutes or 0),"remarks":x.remarks}

def salary_json(x):
    return {"id":x.id,"employee_id":x.employee_id,"employee_name":x.employee.name if x.employee else "","salary_month":x.salary_month,"working_days":x.working_days,"present_days":x.present_days,"paid_leave_days":x.paid_leave_days,"overtime_hours":x.overtime_hours,"basic_earned":x.basic_earned,"allowances":x.allowances,"overtime_amount":x.overtime_amount,"deductions":x.deductions,"advance":x.advance,"net_salary":x.net_salary,"status":x.status}

@hr_bp.get("/employees")
@require_auth
def employees():
    return jsonify({"employees":[emp_json(e) for e in Employee.query.order_by(Employee.active.desc(),Employee.name.asc()).all()]})

@hr_bp.post("/employees")
@require_auth
def add_employee():
    d=request.get_json(silent=True) or {}
    code=(d.get("employee_code") or "").strip(); name=(d.get("name") or "").strip()
    if not code or not name: return jsonify({"error":"Employee Code and Name are required"}),400
    if Employee.query.filter_by(employee_code=code).first(): return jsonify({"error":"Employee Code already exists"}),409
    e=Employee(employee_code=code,name=name,department=(d.get("department") or "HR").strip(),designation=d.get("designation"),mobile=d.get("mobile"),photo_url=(d.get("photo_url") or "").strip() or None,joining_date=_date(d.get("joining_date")),machine_user_id=(d.get("machine_user_id") or None),basic_salary=float(d.get("basic_salary") or 0),hra=float(d.get("hra") or 0),other_allowance=float(d.get("other_allowance") or 0),overtime_rate=float(d.get("overtime_rate") or 0))
    db.session.add(e)
    try: db.session.commit()
    except Exception as ex: db.session.rollback(); return jsonify({"error":str(ex)}),400
    return jsonify({"employee":emp_json(e)}),201

@hr_bp.post("/punches")
@require_auth
def add_punch():
    d=request.get_json(silent=True) or {}; e=Employee.query.get(d.get("employee_id")); t=_dt(d.get("punch_time"))
    if not e or not t: return jsonify({"error":"Employee and valid punch time are required"}),400
    event=(d.get("device_event_id") or "").strip() or None
    if event and AttendancePunch.query.filter_by(device_event_id=event).first(): return jsonify({"success":True,"duplicate":True})
    p=AttendancePunch(employee_id=e.id,punch_time=t,punch_type=(d.get("punch_type") or "auto"),device_ip=d.get("device_ip"),device_event_id=event,source=d.get("source") or "manual")
    db.session.add(p)
    day=t.date(); punches=AttendancePunch.query.filter(AttendancePunch.employee_id==e.id,func.date(AttendancePunch.punch_time)==day).order_by(AttendancePunch.punch_time.asc()).all()
    first=punches[0].punch_time; last=punches[-1].punch_time
    hours=max(0,(last-first).total_seconds()/3600) if len(punches)>1 else 0
    status="Present" if len(punches)>0 else "Absent"
    ot=max(0,hours-8)
    row=AttendanceDay.query.filter_by(employee_id=e.id,work_date=day).first() or AttendanceDay(employee_id=e.id,work_date=day)
    row.first_in=first; row.last_out=last if len(punches)>1 else None; row.work_hours=round(hours,2); row.overtime_hours=round(ot,2)
    row.late_minutes=max(0, int((first.replace(tzinfo=None)-datetime.combine(day, datetime.min.time()).replace(hour=10)).total_seconds()/60)) if first and first.time().hour >= 10 else 0
    row.status=status
    db.session.add(row); db.session.commit()
    return jsonify({"success":True,"punch":{"id":p.id,"employee_id":e.id,"punch_time":t.isoformat()},"attendance":day_json(row)}),201

@hr_bp.get("/attendance")
@require_auth
def attendance():
    m=request.args.get("month") or date.today().strftime("%Y-%m")
    try: y,mo=map(int,m.split("-"))
    except ValueError: return jsonify({"error":"Month must be YYYY-MM"}),400
    start=date(y,mo,1); end=date(y,mo,monthrange(y,mo)[1])
    rows=AttendanceDay.query.filter(AttendanceDay.work_date>=start,AttendanceDay.work_date<=end).order_by(AttendanceDay.work_date.desc(),AttendanceDay.employee_id.asc()).all()
    return jsonify({"attendance":[day_json(x) for x in rows]})


@hr_bp.get("/me")
@require_auth
def my_attendance():
    """Return the logged-in staff member's profile and attendance for a month."""
    from models import User
    from flask import g
    user = User.query.get(getattr(g, "current_user_id", None))
    if not user:
        return jsonify({"error":"Logged-in user not found"}),404
    employee = Employee.query.filter(Employee.mobile == user.mobile).first() if user.mobile else None
    if not employee:
        employee = Employee.query.filter(Employee.employee_code == user.username).first()
    if not employee:
        return jsonify({"employee":None,"attendance":[],"message":"Your staff profile is not linked to an HR employee record yet."})
    m=request.args.get("month") or date.today().strftime("%Y-%m")
    try: y,mo=map(int,m.split("-"))
    except ValueError: return jsonify({"error":"Month must be YYYY-MM"}),400
    start=date(y,mo,1); end=date(y,mo,monthrange(y,mo)[1])
    rows=AttendanceDay.query.filter_by(employee_id=employee.id).filter(AttendanceDay.work_date>=start,AttendanceDay.work_date<=end).order_by(AttendanceDay.work_date.desc()).all()
    by_date={x.work_date:x for x in rows}
    days=[]; d=start
    while d<=end:
        if employee.joining_date and d < employee.joining_date:
            d += timedelta(days=1); continue
        x=by_date.get(d)
        if x: days.append(day_json(x))
        elif d.weekday()<6:
            days.append({"id":None,"work_date":d.isoformat(),"employee_id":employee.id,"employee_name":employee.name,"first_in":None,"last_out":None,"status":"Absent","work_hours":0,"overtime_hours":0,"late_minutes":0,"remarks":None})
        d += timedelta(days=1)
    return jsonify({"employee":emp_json(employee),"attendance":days})

@hr_bp.get("/salary")
@require_auth
def salary():
    m=request.args.get("month") or date.today().strftime("%Y-%m")
    return jsonify({"salaries":[salary_json(x) for x in SalaryRun.query.filter_by(salary_month=m).order_by(SalaryRun.employee_id.asc()).all()]})

@hr_bp.post("/salary/process")
@require_auth
def process_salary():
    d=request.get_json(silent=True) or {}; m=d.get("month") or date.today().strftime("%Y-%m")
    try: y,mo=map(int,m.split("-")); start=date(y,mo,1); end=date(y,mo,monthrange(y,mo)[1])
    except ValueError: return jsonify({"error":"Month must be YYYY-MM"}),400
    working=sum(1 for i in range(1,end.day+1) if (start+timedelta(days=i-1)).weekday()<6)
    out=[]
    for e in Employee.query.filter_by(active=True).all():
        days=AttendanceDay.query.filter_by(employee_id=e.id).filter(AttendanceDay.work_date>=start,AttendanceDay.work_date<=end).all()
        present=sum(1 for x in days if x.status in ("Present","Half Day"))
        ot=sum(float(x.overtime_hours or 0) for x in days)
        earned=round(float(e.basic_salary or 0)*present/max(working,1),2)
        allowances=round((float(e.hra or 0)+float(e.other_allowance or 0))*present/max(working,1),2)
        ot_amount=round(ot*float(e.overtime_rate or 0),2)
        deduction=float(d.get("deductions",0) or 0); advance=float(d.get("advance",0) or 0)
        net=round(earned+allowances+ot_amount-deduction-advance,2)
        row=SalaryRun.query.filter_by(employee_id=e.id,salary_month=m).first() or SalaryRun(employee_id=e.id,salary_month=m)
        row.working_days=working; row.present_days=present; row.overtime_hours=round(ot,2); row.basic_earned=earned; row.allowances=allowances; row.overtime_amount=ot_amount; row.deductions=deduction; row.advance=advance; row.net_salary=net; row.status="processed"
        db.session.add(row); out.append(row)
    db.session.commit()
    return jsonify({"success":True,"salaries":[salary_json(x) for x in out]})

@hr_bp.post("/machine/punches")
@require_auth
def machine_punches():
    """Future punching-machine adapter endpoint. Accepts normalized punches so
    the exact device protocol can be added after the factory machine model is known."""
    d=request.get_json(silent=True) or {}; punches=d.get("punches") if isinstance(d.get("punches"),list) else [d]
    created=0; skipped=0
    for p in punches:
        e=Employee.query.filter_by(machine_user_id=str(p.get("machine_user_id") or "").strip()).first(); t=_dt(p.get("punch_time"))
        if not e or not t: skipped+=1; continue
        event=(p.get("device_event_id") or "").strip() or None
        if event and AttendancePunch.query.filter_by(device_event_id=event).first(): skipped+=1; continue
        db.session.add(AttendancePunch(employee_id=e.id,punch_time=t,punch_type=p.get("punch_type") or "auto",device_ip=p.get("device_ip"),device_event_id=event,source="machine")); created+=1
    db.session.commit(); return jsonify({"success":True,"created":created,"skipped":skipped})
