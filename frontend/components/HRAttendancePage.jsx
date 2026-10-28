'use client';
import { useEffect, useState } from 'react';
import { get, post } from '../lib/api';

const emptyEmployee = { employee_code:'', name:'', department:'', designation:'', location:'', mobile:'', photo_url:'', joining_date:'', machine_user_id:'', basic_salary:'', hra:'', other_allowance:'', overtime_rate:'' };
const timeIST = (v) => { if(!v) return '-'; const d=new Date(v); return isNaN(d)?'-':d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Kolkata'}); };
const dateText = (v) => String(v||'').slice(0,10);
const MONTH_DAYS = 30; // per-day = salary / 30 (Excel slip jaisa)
const num = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const money = (v) => num(v).toLocaleString('en-IN',{minimumFractionDigits:0,maximumFractionDigits:2});
const monthEnd = (m) => { if(!/^\d{4}-\d{2}$/.test(m||'')) return ''; const [y,mo]=m.split('-').map(Number); const d=new Date(y,mo,0).getDate(); return `${String(d).padStart(2,'0')}-${String(mo).padStart(2,'0')}-${y}`; };
const dmy = (v) => { const t=String(v||'').slice(0,10); return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t.split('-').reverse().join('-') : ''; };
// Slip ke figures (server ke hr-salary.ts jaisa hi formula)
const slipMath = (r, f) => {
  const perDay = num(r.basic_salary)/MONTH_DAYS;
  const present = num(f.present), extraAmt = perDay*num(f.extra_days), holAmt = perDay*num(f.holiday_days);
  const allow = num(r.hra)+num(r.other_allowance), otAmt = num(r.overtime_hours)*num(r.overtime_rate);
  const net = perDay*present + allow + otAmt + extraAmt - holAmt - num(f.advance) - num(f.pl_loan);
  return { perDay, extraAmt, holAmt, allow, otAmt, net, absent: Math.max(0, MONTH_DAYS-present) };
};
const lateText = (m) => { m=Number(m||0); return m>0 ? (m>=60?Math.floor(m/60)+'h ':'')+(m%60)+'m' : '-'; };

export function HRAttendancePage() {
  const [tab,setTab]=useState('employees');
  const [employees,setEmployees]=useState([]);
  const [attendance,setAttendance]=useState([]);
  const [salaries,setSalaries]=useState([]);
  const [timings,setTimings]=useState([]);
  const [month,setMonth]=useState(new Date().toISOString().slice(0,7));
  const [form,setForm]=useState(emptyEmployee);
  const [showAdd,setShowAdd]=useState(false);
  const [empSearch,setEmpSearch]=useState('');
  const [users,setUsers]=useState([]);
  const [userPick,setUserPick]=useState('');
  const [fromUser,setFromUser]=useState(null); // employee jise user se update karna hai
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  // employee edit
  const [editId,setEditId]=useState(null);
  const [edit,setEdit]=useState({});
  // import
  const [parsed,setParsed]=useState(null);
  const [fileName,setFileName]=useState('');
  const [importLoc,setImportLoc]=useState('');
  const [createMissing,setCreateMissing]=useState(true);
  // salary slip
  const [salSearch,setSalSearch]=useState('');
  const [slip,setSlip]=useState(null);
  const [attView,setAttView]=useState(null); // {employee_id,name,month,rows,loading}
  const [slipForm,setSlipForm]=useState({});
  // department timing
  const [timeEdit,setTimeEdit]=useState({});
  const [newDept,setNewDept]=useState('');

  const locations=[...new Set(employees.map(e=>e.location).filter(Boolean))];

  const load=async()=>{
    setError('');
    try {
      const e=await get('/hr/employees'); setEmployees(e.employees||[]);
      if(tab==='employees'){ try{ const u=await get('/users'); setUsers(u.rows||u.data||u.items||[]); }catch(_){ setUsers([]); } }
      if(tab==='attendance'){ const a=await get('/hr/attendance?month='+month); setAttendance(a.attendance||[]); }
      if(tab==='salary'){ const s=await get('/hr/salary?month='+month); setSalaries(s.salaries||[]); }
      if(tab==='timing'){ const t=await get('/hr/department-timings'); setTimings(t.timings||[]); setTimeEdit({}); }
    } catch(err){ setError(err.message); }
  };
  useEffect(()=>{ load(); },[tab,month]);

  const saveEmployee=async(e)=>{
    e.preventDefault(); setBusy(true); setError('');
    try { await post('/hr/employees', {...form,user_id:userPick||null,basic_salary:Number(form.basic_salary||0),hra:Number(form.hra||0),other_allowance:Number(form.other_allowance||0),overtime_rate:Number(form.overtime_rate||0)}); setForm(emptyEmployee); setUserPick(''); setShowAdd(false); setNotice('Employee add ho gaya.'); await load(); }
    catch(err){setError(err.message);} finally{setBusy(false);}
  };
  const userLabel=(u)=>`${u.full_name||u.salesman_name||u.username}${u.full_name&&u.username?' ('+u.username+')':''}${u.department?' · '+u.department:''}`;
  const findUser=(id)=>users.find(u=>String(u.id)===String(id));
  const pickUserForAdd=(id)=>{ setUserPick(id); const u=findUser(id); if(!u) return;
    setForm(f=>({...f,employee_code:f.employee_code||String(u.username||''),name:u.full_name||u.salesman_name||u.username||f.name,mobile:u.mobile||f.mobile,department:u.department||f.department,joining_date:f.joining_date})); };
  const applyUserToEmployee=async()=>{
    const u=findUser(userPick); if(!u||!fromUser) return; const x=fromUser;
    setBusy(true); setError('');
    try {
      await post('/hr/employees/update',{id:x.id,user_id:u.id,name:u.full_name||u.salesman_name||u.username||x.name,department:u.department||x.department||'',designation:x.designation||'',location:x.location||'',machine_user_id:x.machine_user_id||'',mobile:u.mobile||'',basic_salary:Number(x.basic_salary||0),hra:Number(x.hra||0),other_allowance:Number(x.other_allowance||0),overtime_rate:Number(x.overtime_rate||0),active:x.active!==false});
      setFromUser(null); setUserPick(''); setNotice(`${x.name} ki detail user "${u.username}" se update ho gayi.`); await load();
    } catch(err){ setError(err.message); } finally{ setBusy(false); }
  };
  const startEdit=(x)=>{ setEditId(x.id); setEdit({name:x.name||'',department:x.department||'',designation:x.designation||'',location:x.location||'',machine_user_id:x.machine_user_id||'',basic_salary:x.basic_salary||0,hra:x.hra||0,other_allowance:x.other_allowance||0,overtime_rate:x.overtime_rate||0,active:x.active!==false}); };
  const saveEdit=async()=>{
    setBusy(true); setError('');
    try { await post('/hr/employees/update',{id:editId,...edit,basic_salary:Number(edit.basic_salary||0),hra:Number(edit.hra||0),other_allowance:Number(edit.other_allowance||0),overtime_rate:Number(edit.overtime_rate||0)}); setEditId(null); await load(); }
    catch(err){setError(err.message);} finally{setBusy(false);}
  };
  const processSalary=async()=>{
    setBusy(true); setError('');
    try { const r=await post('/hr/salary/process',{month}); setSalaries(r.salaries||[]); }
    catch(err){setError(err.message);} finally{setBusy(false);}
  };

  // ---- Smart Office report import ----
  const pickFile=async(ev)=>{
    const f=ev.target.files?.[0]; setParsed(null); setNotice(''); setError('');
    if(!f) return;
    setFileName(f.name);
    try {
      const { parseSmartOfficeReport } = await import('../lib/hrImport');
      setParsed(parseSmartOfficeReport(await f.arrayBuffer()));
    } catch(err){ setError(err.message||'File padh nahi paye.'); }
  };
  const runImport=async()=>{
    if(!parsed) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const payload=parsed.employees.map(e=>({code:e.code,name:e.name,rows:e.rows.filter(r=>r.status==='Present')}));
      const r=await post('/hr/attendance/import',{location:importLoc.trim(),create_missing:createMissing,employees:payload},{timeoutMs:120000});
      setNotice(`Import ho gaya: ${r.imported_days} present din, ${r.matched} employee match, ${r.created} naye employee bane, ${r.skipped_no_attendance} employee skip (koi present din nahi).`+(r.created?' Naye employees ka Department/Basic Salary Employees tab me bharna na bhulein.':''));
      setParsed(null); setFileName('');
      if(parsed.year&&parsed.month) setMonth(`${parsed.year}-${String(parsed.month).padStart(2,'0')}`);
      await load();
    } catch(err){ setError(err.message); } finally{ setBusy(false); }
  };

  // ---- department timing ----
  const saveTiming=async(dept)=>{
    const t=timeEdit[dept]||{}; const row=timings.find(x=>x.department===dept)||{};
    const start_time=t.start_time ?? row.start_time ?? ''; const grace_minutes=t.grace_minutes ?? row.grace_minutes ?? 0; const office_hours=t.office_hours ?? row.office_hours ?? 0; const ot_start_after=t.ot_start_after ?? row.ot_start_after ?? 0; const half_day_min=t.half_day_min ?? row.half_day_min ?? 0; const full_day_min=t.full_day_min ?? row.full_day_min ?? 0;
    setBusy(true); setError(''); setNotice('');
    try { await post('/hr/department-timings',{department:dept,start_time,grace_minutes:Number(grace_minutes||0),office_hours:Number(office_hours||0),ot_start_after:Number(ot_start_after||0),half_day_min:Number(half_day_min||0),full_day_min:Number(full_day_min||0)}); setNotice(`${dept}: duty time save ho gaya, late aur OT dobara nikal diya gaya. Salary me naya OT lene ke liye Salary tab me "Process Salary" dobara chalayein.`); await load(); }
    catch(err){ setError(err.message); } finally{ setBusy(false); }
  };
  const addDept=()=>{ const d=newDept.trim(); if(!d||timings.some(x=>x.department.toLowerCase()===d.toLowerCase())) return; setTimings([...timings,{department:d,start_time:'',grace_minutes:0,office_hours:0,ot_start_after:0,half_day_min:0,full_day_min:0}]); setNewDept(''); };
  const recalc=async()=>{
    setBusy(true); setError(''); setNotice('');
    try { await post('/hr/attendance/recalc',{month}); setNotice('Late dobara nikal diya gaya.'); await load(); }
    catch(err){ setError(err.message); } finally{ setBusy(false); }
  };

  const openAttendance=async(x)=>{
    const mth=x.salary_month||month;
    setAttView({employee_id:x.employee_id,name:x.employee_name,code:x.employee_code,month:mth,rows:[],loading:true}); setError('');
    try { const r=await get('/hr/attendance?month='+mth+'&employee_id='+x.employee_id); setAttView(v=>v&&({...v,rows:r.attendance||[],loading:false})); }
    catch(err){ setError(err.message); setAttView(v=>v&&({...v,loading:false})); }
  };
  const openSlip=(r)=>{
    setSlip(r); setNotice(''); setError('');
    setSlipForm({present:num(r.present_days),extra_days:num(r.extra_days),holiday_days:num(r.holiday_days),advance:num(r.advance),pl_loan:num(r.pl_loan),paid_on:String(r.paid_on||'').slice(0,10),manual:r.present_override!==null&&r.present_override!==undefined});
  };
  const saveSlip=async(useAttendance)=>{
    setBusy(true); setError('');
    try {
      const body={employee_id:slip.employee_id,month:slip.salary_month,extra_days:num(slipForm.extra_days),holiday_days:num(slipForm.holiday_days),advance:num(slipForm.advance),pl_loan:num(slipForm.pl_loan),paid_on:slipForm.paid_on||null};
      body.present_override = useAttendance ? null : (slipForm.manual ? num(slipForm.present) : null);
      const r=await post('/hr/salary/adjust',body);
      setSalaries(r.salaries||[]); if(r.salary) openSlip(r.salary); setNotice('Slip save ho gayi.');
    } catch(err){ setError(err.message); } finally{ setBusy(false); }
  };
  const printSlip=()=>{
    const m=slipMath(slip,slipForm); const w=window.open('','_blank','width=760,height=720'); if(!w) return;
    const R=(i,a,x,y,z)=>`<tr class="${i%2?'w':'b'}"><th class="l">${a}</th><td>${x??'-'}</td><td>${y??'-'}</td><td>${z??'-'}</td></tr>`;
    let i=0;
    w.document.write(`<html><head><title>Salary Slip - ${slip.employee_name}</title><style>
      @page{margin:12mm} body{font-family:Arial,Helvetica,sans-serif;padding:16px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      table{border-collapse:collapse;width:100%;border:2px solid #0b3361;font-size:15px}
      th,td{border:1px solid #333;padding:9px 8px;text-align:center;font-weight:700}
      .hd{background:#0b3361;color:#fff;font-weight:800;letter-spacing:.5px}
      .t{font-size:24px;padding:12px 8px}.lab{background:#e3edf9;font-weight:800;font-size:13px}
      th.l{text-align:left;text-transform:uppercase;font-size:13px}
      tr.b th,tr.b td{background:#e3edf9} tr.w th,tr.w td{background:#fff}
      .net th{background:#e2f0d9;font-size:22px;padding:16px 8px}.net .amt{background:#176b1c;color:#fff;font-size:26px;font-weight:800}.net td{background:#e2f0d9}
      .sub{padding:0}.sub div{display:flex}.sub .k{flex:1;background:#e3edf9;font-weight:800;font-size:13px;padding:10px 6px;border-right:1px solid #333;display:flex;align-items:center;justify-content:center}.sub .v{flex:1;padding:10px 6px;font-size:16px}
      .net .sub .k{background:#e2f0d9}
    </style></head><body>
      <table>
      <tr><th class="hd t" colspan="3">CASH SALARIES</th><th class="hd" style="font-size:18px">EXTRA DETAILS</th></tr>
      <tr><th class="lab">EMPLOYEE NAME</th><td colspan="2" style="font-size:17px">${slip.employee_name}</td><td class="sub"><div><span class="k">PAY DATE</span><span class="v">${monthEnd(slip.salary_month)}</span></div></td></tr>
      <tr><th class="hd">DESCRIPTION</th><th class="hd">AMOUNT (₹)</th><th class="hd">PER DAY (₹)</th><th class="hd">DAYS / EXTRA</th></tr>
      ${R(i++,'Salary <span style="font-weight:400;text-transform:none">(Monthly)</span>',money(slip.basic_salary),Math.round(m.perDay),MONTH_DAYS)}
      ${R(i++,'Present Days',num(slipForm.present),'-',num(slipForm.present))}
      ${R(i++,'Present Extra Sundays or Nights',num(slipForm.extra_days),Math.round(m.extraAmt),num(slipForm.extra_days))}
      ${R(i++,'Absent Days',m.absent,'-',m.absent)}
      ${R(i++,'Holiday Deducted',num(slipForm.holiday_days),Math.round(m.holAmt),num(slipForm.holiday_days))}
      ${m.allow>0?R(i++,'Allowances (HRA + Other)',money(m.allow),'-','-'):''}
      ${m.otAmt>0?R(i++,'Overtime ('+num(slip.overtime_hours).toFixed(1)+' hr)',money(m.otAmt),'-','-'):''}
      ${R(i++,'Salary Loan Advances',money(slipForm.advance),'-','-')}
      ${R(i++,'PL Loan',money(slipForm.pl_loan),'-','-')}
      <tr class="net"><th>NET SALARY</th><td class="amt">${money(m.net)}</td><td>-</td><td class="sub"><div><span class="k">RELEASE DATE</span><span class="v">${dmy(slipForm.paid_on)||'-'}</span></div></td></tr>
      </table>
      <script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  };

  const tabName={employees:'Employees',attendance:'Attendance',timing:'Dept Timing',salary:'Salary'};
  const inp=(k,type)=><input type={type||'text'} value={edit[k]} onChange={e=>setEdit({...edit,[k]:e.target.value})} style={{width:type==='number'?80:110}}/>;

  return <div className="page">
    <div className="pageHeader"><div><h2>HR • Attendance & Salary</h2><p className="muted">Employees, attendance, department timing aur monthly salary.</p></div></div>
    {error && <div className="error" style={{marginBottom:12}}>{error}</div>}
    {notice && <div className="card" style={{marginBottom:12}}>{notice}</div>}
    <div className="tabs" style={{marginBottom:16}}>
      {Object.keys(tabName).map(x=><button key={x} className={'btn'+(tab===x?' primary':'')} onClick={()=>{setTab(x);setNotice('');}}>{tabName[x]}</button>)}
    </div>

    {tab==='employees' && <>
      <div className="card toolbar" style={{display:'flex',gap:12,alignItems:'flex-end',flexWrap:'wrap'}}>
        <div className="field" style={{flex:1,minWidth:200}}><label>Employee dhundhein</label><input value={empSearch} onChange={e=>setEmpSearch(e.target.value)} placeholder="naam, code ya department"/></div>
        <button className="btn primary" onClick={()=>{setError('');setNotice('');setUserPick('');setForm(emptyEmployee);setShowAdd(true);}}>+ Add Employee</button>
      </div>
      {showAdd && <div className="modal"><div className="modalbox" style={{maxWidth:760}}>
        <form onSubmit={saveEmployee}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12}}><h3 style={{margin:0}}>Add Employee</h3><button type="button" className="btn" onClick={()=>setShowAdd(false)}>Close</button></div>
          {error && <div className="error">{error}</div>}
          <div className="field" style={{marginTop:12}}><label>User Master se bharein (optional)</label>
            <select value={userPick} onChange={e=>pickUserForAdd(e.target.value)}><option value="">-- User chunein --</option>{users.map(u=><option key={u.id} value={u.id}>{userLabel(u)}</option>)}</select>
            <div className="muted" style={{fontSize:12,marginTop:4}}>User chunne par Code, Name, Mobile aur Department apne aap bhar jayenge; baad me badal sakte hain.</div></div>
          <div className="formgrid" style={{marginTop:12}}>
            {[['employee_code','Employee Code',true],['name','Name',true],['photo_url','Photo URL',false],['department','Department',false],['designation','Designation',false],['location','Location',false],['mobile','Mobile',false],['joining_date','Joining Date',false,'date'],['machine_user_id','Punch Machine User ID',false],['basic_salary','Basic Salary',false,'number'],['hra','HRA',false,'number'],['other_allowance','Other Allowance',false,'number'],['overtime_rate','Overtime Rate / Hr',false,'number']].map(([k,l,req,type])=><div className="field" key={k}><label>{l}</label><input type={type||'text'} value={form[k]} required={req} onChange={e=>setForm({...form,[k]:e.target.value})}/></div>)}
          </div>
          <div className="actions" style={{marginTop:16,display:'flex',gap:8}}><button className="btn primary" disabled={busy}>{busy?'Saving…':'Add Employee'}</button><button type="button" className="btn" onClick={()=>setShowAdd(false)}>Cancel</button></div>
        </form>
      </div></div>}
      {fromUser && <div className="modal"><div className="modalbox" style={{maxWidth:520}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12}}><h3 style={{margin:0}}>User se update: {fromUser.name}</h3><button className="btn" onClick={()=>{setFromUser(null);setUserPick('');}}>Close</button></div>
        {error && <div className="error">{error}</div>}
        <div className="field" style={{marginTop:12}}><label>User chunein</label>
          <select value={userPick} onChange={e=>setUserPick(e.target.value)}><option value="">-- User chunein --</option>{users.map(u=><option key={u.id} value={u.id}>{userLabel(u)}</option>)}</select></div>
        {findUser(userPick) && <div className="muted" style={{marginTop:10}}>Update hoga → Name: <strong>{findUser(userPick).full_name||findUser(userPick).salesman_name||findUser(userPick).username}</strong>, Mobile: <strong>{findUser(userPick).mobile||'-'}</strong>, Department: <strong>{findUser(userPick).department||'-'}</strong>. Salary, code aur baaki detail waisi hi rahegi.</div>}
        <div className="actions" style={{marginTop:16,display:'flex',gap:8}}><button className="btn primary" disabled={busy||!userPick} onClick={applyUserToEmployee}>{busy?'Updating…':'Update'}</button><button className="btn" onClick={()=>{setFromUser(null);setUserPick('');}}>Cancel</button></div>
      </div></div>}
      <div className="card tableWrap" style={{marginTop:16}}><table className="table reportTable"><thead><tr><th>Code</th><th>Name</th><th>Department</th><th>Designation</th><th>Location</th><th>Machine ID</th><th>Basic</th><th>HRA</th><th>Other</th><th>OT/Hr</th><th>Status</th><th></th></tr></thead><tbody>
        {employees.filter(e=>{const q=empSearch.trim().toLowerCase();return !q||[e.name,e.employee_code,e.department,e.location].some(v=>String(v||'').toLowerCase().includes(q));}).map(e=> editId===e.id
          ? <tr key={e.id}><td>{e.employee_code}</td><td>{inp('name')}</td><td>{inp('department')}</td><td>{inp('designation')}</td><td>{inp('location')}</td><td>{inp('machine_user_id')}</td><td>{inp('basic_salary','number')}</td><td>{inp('hra','number')}</td><td>{inp('other_allowance','number')}</td><td>{inp('overtime_rate','number')}</td><td><select value={edit.active?'1':'0'} onChange={ev=>setEdit({...edit,active:ev.target.value==='1'})}><option value="1">Active</option><option value="0">Inactive</option></select></td><td style={{whiteSpace:'nowrap'}}><button className="btn primary" disabled={busy} onClick={saveEdit}>Save</button> <button className="btn" onClick={()=>setEditId(null)}>Cancel</button></td></tr>
          : <tr key={e.id}><td>{e.employee_code}</td><td>{e.name}</td><td>{e.department||'-'}</td><td>{e.designation||'-'}</td><td>{e.location||'-'}</td><td>{e.machine_user_id||'-'}</td><td>{Number(e.basic_salary||0).toFixed(2)}</td><td>{Number(e.hra||0).toFixed(2)}</td><td>{Number(e.other_allowance||0).toFixed(2)}</td><td>{Number(e.overtime_rate||0).toFixed(2)}</td><td>{e.active?'Active':'Inactive'}</td><td><button className="btn" onClick={()=>startEdit(e)}>Edit</button> <button className="btn" onClick={()=>{setError('');setNotice('');setUserPick('');setFromUser(e);}}>User se</button></td></tr>)}
        {!employees.length&&<tr><td colSpan="12" className="muted">No employees found.</td></tr>}
      </tbody></table></div>
    </>}

    {tab==='attendance' && <>
      <div className="card" style={{marginBottom:16}}>
        <h3>Import Attendance (Smart Office report)</h3>
        <p className="muted">Smart Office se <strong>Monthly Detailed Report (.xls)</strong> upload karein. Employee Code = Punch Machine User ID se match hota hai. Dobara import karne par purana data usi din ka update hota hai, duplicate nahi banta.</p>
        <div className="toolbar" style={{flexWrap:'wrap',gap:12}}>
          <div className="field"><label>Report file</label><input type="file" accept=".xls,.xlsx" onChange={pickFile}/></div>
          <div className="field"><label>Location (machine ki jagah)</label><input list="hrLocations" value={importLoc} onChange={e=>setImportLoc(e.target.value)} placeholder="jaise Showroom 1"/><datalist id="hrLocations">{locations.map(l=><option key={l} value={l}/>)}</datalist></div>
          <label style={{display:'flex',gap:6,alignItems:'center'}}><input type="checkbox" checked={createMissing} onChange={e=>setCreateMissing(e.target.checked)}/> Naye employee bana do</label>
        </div>
        {parsed && <div style={{marginTop:12}}>
          <div><strong>{fileName}</strong> — {parsed.period}</div>
          <div className="muted">{parsed.employees.length} employee, {parsed.employees.filter(e=>e.rows.some(r=>r.status==='Present')).length} ka attendance hai, kul {parsed.presentDays} present din. Jin employees ka koi present din nahi unhe skip kiya jayega.</div>
          <div className="actions" style={{marginTop:10}}><button className="btn primary" disabled={busy} onClick={runImport}>{busy?'Importing…':'Import Karein'}</button></div>
        </div>}
      </div>
      <div className="card tableWrap"><div className="toolbar"><div className="field"><label>Month</label><input type="month" value={month} onChange={e=>setMonth(e.target.value)}/></div><button className="btn" onClick={load}>Refresh</button><button className="btn" disabled={busy} onClick={recalc}>Late dobara nikalein</button></div>
        <table className="table reportTable"><thead><tr><th>Date</th><th>Employee</th><th>First In</th><th>Last Out</th><th>Status</th><th>Late</th><th>Hours</th><th>OT</th></tr></thead><tbody>
          {attendance.map(x=><tr key={x.id}><td>{dateText(x.work_date)}</td><td>{x.employee_name}</td><td>{timeIST(x.first_in)}</td><td>{x.single_punch?<span className="muted">1 punch</span>:timeIST(x.last_out)}</td><td>{x.status}</td><td style={Number(x.late_minutes)>0?{color:'#c0392b',fontWeight:600}:undefined}>{lateText(x.late_minutes)}</td><td>{Number(x.work_hours||0).toFixed(2)}</td><td>{Number(x.overtime_hours||0).toFixed(2)}</td></tr>)}
          {!attendance.length&&<tr><td colSpan="8" className="muted">No attendance records for this month.</td></tr>}
        </tbody></table></div>
    </>}

    {tab==='timing' && <div className="card tableWrap">
      <h3>Department Duty Timing</h3>
      <p className="muted">Har department ka duty start, grace, office hours aur OT rule set karein. <strong>Late = pehla punch − (duty start + grace)</strong>; late punch din-wise gine jate hain (Attendance aur Salary me "Late Days"). <strong>Office End = duty start + office hours</strong>; Office End ke baad ka extra time <strong>tabhi OT</strong> jab wo "OT Start After" minutes ya zyada ho (jaise 30 likha to 30 min se kam extra par OT nahi). Office Hours 0 chhodne par OT punch machine ki file se hi aayega. <strong>Half Day / Full Day Min (hr)</strong>: din ke ghante (pehla punch se aakhri punch) <strong>Half Day Min se kam = Absent</strong>, <strong>Full Day Min se kam = Half Day (0.5 din)</strong>, baaki Full Day. Dono 0 ho to ye rule band hai. Save karte hi purana attendance dobara calculate ho jata hai.</p>
      <table className="table reportTable"><thead><tr><th>Department</th><th>Duty Start</th><th>Grace (min)</th><th>Office Hours</th><th>OT Start After (min)</th><th>Office End</th><th>Half Day Min (hr)</th><th>Full Day Min (hr)</th><th></th></tr></thead><tbody>
        {timings.map(t=>{ const e=timeEdit[t.department]||{}; const st=e.start_time ?? t.start_time ?? ''; const oh=num(e.office_hours ?? t.office_hours ?? 0);
          const endText=(()=>{ if(!/^\d{1,2}:\d{2}$/.test(st)||!(oh>0)) return '-'; const [h,m]=st.split(':').map(Number); const tot=Math.round(h*60+m+oh*60); const hh=Math.floor(tot/60)%24, mm=tot%60; return String(hh).padStart(2,'0')+':'+String(mm).padStart(2,'0'); })();
          return <tr key={t.department}><td>{t.department}</td>
          <td><input type="time" value={st} onChange={ev=>setTimeEdit({...timeEdit,[t.department]:{...e,start_time:ev.target.value}})}/></td>
          <td><input type="number" min="0" style={{width:80}} value={e.grace_minutes ?? t.grace_minutes ?? 0} onChange={ev=>setTimeEdit({...timeEdit,[t.department]:{...e,grace_minutes:ev.target.value}})}/></td>
          <td><input type="number" min="0" max="24" step="0.25" style={{width:80}} value={e.office_hours ?? t.office_hours ?? 0} onChange={ev=>setTimeEdit({...timeEdit,[t.department]:{...e,office_hours:ev.target.value}})}/></td>
          <td><input type="number" min="0" style={{width:90}} value={e.ot_start_after ?? t.ot_start_after ?? 0} onChange={ev=>setTimeEdit({...timeEdit,[t.department]:{...e,ot_start_after:ev.target.value}})}/></td>
          <td>{endText}</td>
          <td><input type="number" min="0" max="24" step="0.25" style={{width:80}} value={e.half_day_min ?? t.half_day_min ?? 0} onChange={ev=>setTimeEdit({...timeEdit,[t.department]:{...e,half_day_min:ev.target.value}})}/></td>
          <td><input type="number" min="0" max="24" step="0.25" style={{width:80}} value={e.full_day_min ?? t.full_day_min ?? 0} onChange={ev=>setTimeEdit({...timeEdit,[t.department]:{...e,full_day_min:ev.target.value}})}/></td>
          <td><button className="btn primary" disabled={busy} onClick={()=>saveTiming(t.department)}>Save</button></td></tr>; })}
        {!timings.length&&<tr><td colSpan="9" className="muted">Abhi koi department nahi. Employees me Department bharein ya neeche naya department jodein.</td></tr>}
      </tbody></table>
      <div className="toolbar" style={{marginTop:12}}><div className="field"><label>Naya department</label><input value={newDept} onChange={e=>setNewDept(e.target.value)} placeholder="jaise Sales"/></div><button className="btn" onClick={addDept}>Jodein</button></div>
    </div>}

    {tab==='salary' && <>
      <div className="card tableWrap"><div className="toolbar"><div className="field"><label>Salary Month</label><input type="month" value={month} onChange={e=>setMonth(e.target.value)}/></div><div className="field"><label>Employee dhundhein</label><input value={salSearch} onChange={e=>setSalSearch(e.target.value)} placeholder="naam ya code"/></div><button className="btn primary" onClick={processSalary} disabled={busy}>{busy?'Processing…':'Process Salary'}</button></div>
        <p className="muted" style={{margin:'6px 0'}}>Process Salary ke baad kisi employee ki <strong>Slip</strong> kholein. Slip me Extra Sundays/Nights, Holiday, Advance aur PL Loan bhar sakte hain. Per-day = Salary ÷ {MONTH_DAYS}.</p>
        <table className="table reportTable"><thead><tr><th>Employee</th><th>Present</th><th>Late Days</th><th>OT Hrs</th><th>Basic Earned</th><th>Allowances</th><th>Extra</th><th>Deductions</th><th>Net Salary</th><th></th></tr></thead><tbody>
          {salaries.filter(x=>{const q=salSearch.trim().toLowerCase();return !q||String(x.employee_name||'').toLowerCase().includes(q)||String(x.employee_code||'').toLowerCase().includes(q);}).map(x=>{ const m=slipMath(x,{present:x.present_days,extra_days:x.extra_days,holiday_days:x.holiday_days,advance:x.advance,pl_loan:x.pl_loan}); return <tr key={x.id}><td><a href="#" title="Attendance dekhein" style={{fontWeight:600,textDecoration:'underline'}} onClick={ev=>{ev.preventDefault();openAttendance(x);}}>{x.employee_name}</a></td><td>{x.present_days}</td><td>{x.late_days||'-'}</td><td>{x.overtime_hours}</td><td>{Number(x.basic_earned||0).toFixed(2)}</td><td>{Number(x.allowances||0).toFixed(2)}</td><td>{(m.extraAmt+m.otAmt).toFixed(2)}</td><td>{(m.holAmt+num(x.advance)+num(x.pl_loan)).toFixed(2)}</td><td><strong>{Number(x.net_salary||0).toFixed(2)}</strong></td><td><button className="btn" onClick={()=>openSlip(x)}>Slip</button></td></tr>; })}
          {!salaries.length&&<tr><td colSpan="10" className="muted">Is mahine ki salary abhi nahi nikli. "Process Salary" dabayein.</td></tr>}
        </tbody></table></div>
      {attView && (()=>{ const rows=attView.rows; const days=rows.reduce((a,r)=>a+(r.status==='Present'?1:r.status==='Half Day'?0.5:0),0); const halfDays=rows.filter(r=>r.status==='Half Day').length; const absDays=rows.filter(r=>r.status==='Absent').length; const lateDays=rows.filter(r=>Number(r.late_minutes)>0).length; const hrs=rows.reduce((a,r)=>a+num(r.work_hours),0); const ot=rows.reduce((a,r)=>a+num(r.overtime_hours),0);
        const dow=(d)=>{ const t=new Date(dateText(d)+'T00:00:00'); return isNaN(t)?'':t.toLocaleDateString('en-IN',{weekday:'short'}); };
        return <div className="modal"><div className="modalbox" style={{maxWidth:820}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12}}><div><h2 style={{margin:0}}>{attView.name} · Attendance</h2><div className="muted">{attView.code} · {attView.month}</div></div><button className="btn" onClick={()=>setAttView(null)}>Close</button></div>
          {error && <div className="error" style={{marginTop:10}}>{error}</div>}
          <div className="muted" style={{margin:'10px 0'}}>Present: <strong>{days}</strong> din{halfDays>0&&<> (Half Day: <strong>{halfDays}</strong>)</>}{absDays>0&&<> · Absent (kam ghante): <strong>{absDays}</strong></>} · Late: <strong>{lateDays}</strong> din · Work: <strong>{hrs.toFixed(2)}</strong> hr · OT: <strong>{ot.toFixed(2)}</strong> hr</div>
          <div className="tableWrap" style={{maxHeight:'60vh',overflow:'auto'}}><table className="table reportTable"><thead><tr><th>Date</th><th>Din</th><th>Punch In</th><th>Punch Out</th><th>Status</th><th>Late</th><th>Work Hrs</th><th>OT Hrs</th></tr></thead><tbody>
            {rows.map(x=><tr key={x.id}><td>{dateText(x.work_date)}</td><td>{dow(x.work_date)}</td><td>{timeIST(x.first_in)}</td><td>{x.single_punch?<span className="muted">1 punch</span>:timeIST(x.last_out)}</td><td>{x.status}</td><td style={Number(x.late_minutes)>0?{color:'#c0392b',fontWeight:600}:undefined}>{lateText(x.late_minutes)}</td><td>{num(x.work_hours).toFixed(2)}</td><td>{num(x.overtime_hours).toFixed(2)}</td></tr>)}
            {!rows.length && <tr><td colSpan="8" className="muted">{attView.loading?'Loading…':'Is mahine ki attendance nahi mili.'}</td></tr>}
          </tbody></table></div>
        </div></div>; })()}
      {slip && (()=>{ const m=slipMath(slip,slipForm); const cell={border:'1px solid var(--border,#999)',padding:'10px 12px',textAlign:'center'}; const th={...cell,fontWeight:700,textTransform:'uppercase',fontSize:13}; const hd={...cell,background:'#0b3361',color:'#fff',fontWeight:800,fontSize:14,letterSpacing:.5}; const lab={...cell,background:'#e3edf9',fontWeight:800,fontSize:13}; const val={...cell,fontWeight:700,fontSize:16}; const band=['#e3edf9','#ffffff']; const sin=(k,w)=><input type="number" min="0" step="any" style={{width:w||90,textAlign:'center'}} value={slipForm[k]} onChange={e=>setSlipForm({...slipForm,[k]:e.target.value,...(k==='present'?{manual:true}:{})})}/>;
        return <div className="modal"><div className="modalbox" style={{maxWidth:720}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12}}><div><h2 style={{margin:0}}>Salary Slip</h2><div className="muted">{slip.employee_code} · {slip.department||'-'} · {slip.location||'-'}</div></div><button className="btn" onClick={()=>setSlip(null)}>Close</button></div>
          {error && <div className="error" style={{marginTop:10}}>{error}</div>}{notice && <div className="muted" style={{marginTop:10}}>{notice}</div>}
          <table style={{borderCollapse:'collapse',width:'100%',marginTop:14,border:'2px solid #0b3361',color:'#111'}}><tbody>
            <tr><th style={{...hd,fontSize:22,padding:'12px 8px'}} colSpan="3">CASH SALARIES</th><th style={{...hd,fontSize:18}}>EXTRA DETAILS</th></tr>
            <tr><th style={lab}>EMPLOYEE NAME</th><td style={{...cell,background:'#fff',fontWeight:700,fontSize:17}} colSpan="2">{slip.employee_name}</td><td style={{...cell,background:'#fff',padding:0}}><div style={{display:'flex',alignItems:'stretch'}}><div style={{...lab,border:0,borderRight:'1px solid #333',flex:1,display:'flex',alignItems:'center',justifyContent:'center'}}>PAY DATE</div><div style={{flex:1,fontWeight:700,fontSize:16,padding:'10px 6px',textAlign:'center'}}>{monthEnd(slip.salary_month)}</div></div></td></tr>
            <tr><th style={hd}>DESCRIPTION</th><th style={hd}>AMOUNT (₹)</th><th style={hd}>PER DAY (₹)</th><th style={hd}>DAYS / EXTRA</th></tr>
            <tr><th style={{...lab,background:band[0],textAlign:'left'}}>SALARY <span style={{fontWeight:400,textTransform:'none'}}>(Monthly)</span></th><td style={{...val,background:band[0]}}>{money(slip.basic_salary)}</td><td style={{...val,background:band[0]}}>{Math.round(m.perDay)}</td><td style={{...val,background:band[0]}}>{MONTH_DAYS}</td></tr>
            <tr><th style={{...lab,background:band[1],textAlign:'left'}}>PRESENT DAYS</th><td style={{...val,background:band[1]}}>{sin('present',80)}</td><td style={{...val,background:band[1]}}>-</td><td style={{...val,background:band[1]}}>{num(slipForm.present)}</td></tr>
            <tr><th style={{...lab,background:band[0],textAlign:'left'}}>PRESENT EXTRA SUNDAYS OR NIGHTS</th><td style={{...val,background:band[0]}}>{sin('extra_days',80)}</td><td style={{...val,background:band[0]}}>{Math.round(m.extraAmt)}</td><td style={{...val,background:band[0]}}>{num(slipForm.extra_days)}</td></tr>
            <tr><th style={{...lab,background:band[1],textAlign:'left'}}>ABSENT DAYS</th><td style={{...val,background:band[1]}}>{m.absent}</td><td style={{...val,background:band[1]}}>-</td><td style={{...val,background:band[1]}}>{m.absent}</td></tr>
            <tr><th style={{...lab,background:band[0],textAlign:'left'}}>HOLIDAY DEDUCTED</th><td style={{...val,background:band[0]}}>{sin('holiday_days',80)}</td><td style={{...val,background:band[0]}}>{Math.round(m.holAmt)}</td><td style={{...val,background:band[0]}}>{num(slipForm.holiday_days)}</td></tr>
            {m.allow>0 && <tr><th style={{...lab,background:band[1],textAlign:'left'}}>ALLOWANCES (HRA + OTHER)</th><td style={{...val,background:band[1]}}>{money(m.allow)}</td><td style={{...val,background:band[1]}}>-</td><td style={{...val,background:band[1]}}>-</td></tr>}
            {m.otAmt>0 && <tr><th style={{...lab,background:band[0],textAlign:'left'}}>OVERTIME ({num(slip.overtime_hours).toFixed(1)} HR)</th><td style={{...val,background:band[0]}}>{money(m.otAmt)}</td><td style={{...val,background:band[0]}}>-</td><td style={{...val,background:band[0]}}>-</td></tr>}
            <tr><th style={{...lab,background:band[1],textAlign:'left'}}>SALARY LOAN ADVANCES</th><td style={{...val,background:band[1]}}>{sin('advance')}</td><td style={{...val,background:band[1]}}>-</td><td style={{...val,background:band[1]}}>-</td></tr>
            <tr><th style={{...lab,background:band[0],textAlign:'left'}}>PL LOAN</th><td style={{...val,background:band[0]}}>{sin('pl_loan')}</td><td style={{...val,background:band[0]}}>-</td><td style={{...val,background:band[0]}}>-</td></tr>
            <tr><th style={{...lab,background:'#e2f0d9',fontSize:22,padding:'16px 8px'}}>NET SALARY</th><td style={{...cell,background:'#176b1c',color:'#fff',fontWeight:800,fontSize:26}}>{money(m.net)}</td><td style={{...val,background:'#e2f0d9'}}>-</td><td style={{...cell,background:'#eef6e8',padding:0}}><div style={{display:'flex',alignItems:'stretch'}}><div style={{...lab,border:0,borderRight:'1px solid #333',background:'#e2f0d9',flex:1,display:'flex',alignItems:'center',justifyContent:'center'}}>RELEASE DATE</div><div style={{flex:1,padding:'8px 4px',display:'flex',alignItems:'center',justifyContent:'center'}}><input type="date" value={slipForm.paid_on||''} onChange={e=>setSlipForm({...slipForm,paid_on:e.target.value})}/></div></div></td></tr>
          </tbody></table>
          <p className="muted" style={{marginTop:8}}>Late: {slip.late_days||0} din ({lateText(slip.late_total_minutes)}). Present Days badalne par wo "Manual" ho jata hai; Process Salary dobara chalane par bhi bana rehta hai.</p>
          <div className="actions" style={{marginTop:12,display:'flex',gap:8}}>
            <button className="btn primary" disabled={busy} onClick={()=>saveSlip(false)}>{busy?'Saving…':'Save'}</button>
            <button className="btn" onClick={printSlip}>Print</button>
          </div>
        </div></div>; })()}
    </>}
  </div>;
}
