'use client';
import { useEffect, useState } from 'react';
import { get, post } from '../lib/api';

const emptyEmployee = { employee_code:'', name:'', department:'HR', designation:'', mobile:'', photo_url:'', joining_date:'', machine_user_id:'', basic_salary:'', hra:'', other_allowance:'', overtime_rate:'' };

export function HRAttendancePage() {
  const [tab,setTab]=useState('employees');
  const [employees,setEmployees]=useState([]);
  const [attendance,setAttendance]=useState([]);
  const [salaries,setSalaries]=useState([]);
  const [month,setMonth]=useState(new Date().toISOString().slice(0,7));
  const [form,setForm]=useState(emptyEmployee);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');

  const load=async()=>{
    setError('');
    try {
      const e=await get('/hr/employees'); setEmployees(e.employees||[]);
      if(tab==='attendance'){ const a=await get('/hr/attendance?month='+month); setAttendance(a.attendance||[]); }
      if(tab==='salary'){ const s=await get('/hr/salary?month='+month); setSalaries(s.salaries||[]); }
    } catch(err){ setError(err.message); }
  };
  useEffect(()=>{ load(); },[tab,month]);

  const saveEmployee=async(e)=>{
    e.preventDefault(); setBusy(true); setError('');
    try { await post('/hr/employees', {...form,basic_salary:Number(form.basic_salary||0),hra:Number(form.hra||0),other_allowance:Number(form.other_allowance||0),overtime_rate:Number(form.overtime_rate||0)}); setForm(emptyEmployee); await load(); }
    catch(err){setError(err.message);} finally{setBusy(false);}
  };
  const processSalary=async()=>{
    setBusy(true); setError('');
    try { const r=await post('/hr/salary/process',{month}); setSalaries(r.salaries||[]); }
    catch(err){setError(err.message);} finally{setBusy(false);}
  };

  return <div className="page">
    <div className="pageHeader"><div><h2>HR • Attendance & Salary</h2><p className="muted">Employees, attendance punches and monthly salary processing.</p></div></div>
    {error && <div className="error" style={{marginBottom:12}}>{error}</div>}
    <div className="tabs" style={{marginBottom:16}}>
      {['employees','attendance','salary'].map(x=><button key={x} className={'btn'+(tab===x?' primary':'')} onClick={()=>setTab(x)}>{x==='employees'?'Employees':x==='attendance'?'Attendance':'Salary'}</button>)}
    </div>
    {tab==='employees' && <>
      <form className="card" onSubmit={saveEmployee}>
        <h3>Add Employee</h3>
        <div className="formgrid">
          {[['employee_code','Employee Code',true],['name','Name',true],['photo_url','Photo URL',false],['department','Department',false],['designation','Designation',false],['mobile','Mobile',false],['joining_date','Joining Date',false,'date'],['machine_user_id','Punch Machine User ID',false],['basic_salary','Basic Salary',false,'number'],['hra','HRA',false,'number'],['other_allowance','Other Allowance',false,'number'],['overtime_rate','Overtime Rate / Hr',false,'number']].map(([k,l,req,type])=><div className="field" key={k}><label>{l}</label><input type={type||'text'} value={form[k]} required={req} onChange={e=>setForm({...form,[k]:e.target.value})}/></div>)}
        </div>
        <div className="actions" style={{marginTop:16}}><button className="btn primary" disabled={busy}>{busy?'Saving…':'Add Employee'}</button></div>
      </form>
      <div className="card tableWrap" style={{marginTop:16}}><table className="reportTable"><thead><tr><th>Code</th><th>Name</th><th>Department</th><th>Designation</th><th>Machine ID</th><th>Joining Date</th><th>Photo</th><th>Basic</th><th>Status</th></tr></thead><tbody>
        {employees.map(e=><tr key={e.id}><td>{e.employee_code}</td><td>{e.name}</td><td>{e.department}</td><td>{e.designation||'-'}</td><td>{e.machine_user_id||'-'}</td><td>{e.joining_date||'-'}</td><td>{e.photo_url?<img src={e.photo_url} alt="Staff" style={{width:36,height:36,borderRadius:8,objectFit:'cover'}}/>:'-'}</td><td>{Number(e.basic_salary||0).toFixed(2)}</td><td>{e.active?'Active':'Inactive'}</td></tr>)}
        {!employees.length&&<tr><td colSpan="9" className="muted">No employees found.</td></tr>}
      </tbody></table></div>
    </>}
    {tab==='attendance' && <div className="card tableWrap"><div className="toolbar"><div className="field"><label>Month</label><input type="month" value={month} onChange={e=>setMonth(e.target.value)}/></div><button className="btn" onClick={load}>Refresh</button></div><table className="reportTable"><thead><tr><th>Date</th><th>Employee</th><th>First In</th><th>Last Out</th><th>Status</th><th>Hours</th><th>OT</th></tr></thead><tbody>{attendance.map(x=><tr key={x.id}><td>{x.work_date}</td><td>{x.employee_name}</td><td>{x.first_in||'-'}</td><td>{x.last_out||'-'}</td><td>{x.status}</td><td>{x.work_hours}</td><td>{x.overtime_hours}</td></tr>)}{!attendance.length&&<tr><td colSpan="7" className="muted">No attendance records for this month.</td></tr>}</tbody></table></div>}
    {tab==='salary' && <div className="card tableWrap"><div className="toolbar"><div className="field"><label>Salary Month</label><input type="month" value={month} onChange={e=>setMonth(e.target.value)}/></div><button className="btn primary" onClick={processSalary} disabled={busy}>{busy?'Processing…':'Process Salary'}</button></div><table className="reportTable"><thead><tr><th>Employee</th><th>Working</th><th>Present</th><th>OT Hrs</th><th>Basic Earned</th><th>Allowances</th><th>OT Amount</th><th>Net Salary</th><th>Status</th></tr></thead><tbody>{salaries.map(x=><tr key={x.id}><td>{x.employee_name}</td><td>{x.working_days}</td><td>{x.present_days}</td><td>{x.overtime_hours}</td><td>{Number(x.basic_earned||0).toFixed(2)}</td><td>{Number(x.allowances||0).toFixed(2)}</td><td>{Number(x.overtime_amount||0).toFixed(2)}</td><td><strong>{Number(x.net_salary||0).toFixed(2)}</strong></td><td>{x.status}</td></tr>)}{!salaries.length&&<tr><td colSpan="9" className="muted">No salary run for this month.</td></tr>}</tbody></table></div>}
  </div>;
}
