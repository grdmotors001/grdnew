'use client';
import { useEffect, useState } from 'react';
import { get, post, put, del } from '../lib/api';
import { Field, Card, ErrorBanner, EmptyState, useAsyncAction } from './ui';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function CodeTable({ title, rows, columns, onAdd, onEdit, onDelete, addLabel }) {
  return (
    <Card title={title} actions={<button className="btn primary" onClick={onAdd}>+ {addLabel}</button>}>
      {!rows.length ? <EmptyState /> : (
        <div className="tablewrap">
          <table className="table">
            <thead><tr>{columns.map(c => <th key={c.key}>{c.label}</th>)}<th style={{width:110}}>Action</th></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.id}>
                {columns.map(c => <td key={c.key}>{r[c.key]}</td>)}
                <td><button className="btn" onClick={() => onEdit(r)}>Edit</button>{' '}<button className="btn danger" onClick={() => onDelete(r.id)}>Delete</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function ChassisMasterPage() {
  const [data, setData] = useState({ months: [], years: [], rule: null });
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const { busy, error, setError, run } = useAsyncAction();

  const load = () => get('/chassis-master').then(setData).catch(e => setError(e.message));
  useEffect(() => { load(); }, []);

  const openMonth = (row) => { setError(''); setModal({ type: 'month', row }); setForm(row ? { month: row.month, code: row.code } : { month: '', code: '' }); };
  const openYear = (row) => { setError(''); setModal({ type: 'year', row }); setForm(row ? { year: row.year, code: row.code } : { year: '', code: '' }); };
  const saveCode = (e) => {
    e.preventDefault();
    run(async () => {
      const base = modal.type === 'month' ? '/chassis-master/months' : '/chassis-master/years';
      if (modal.row) await put(`${base}/${modal.row.id}`, form); else await post(base, form);
      setModal(null); setForm({}); await load();
    });
  };
  const removeCode = (type, id) => {
    if (!confirm('Delete this code?')) return;
    run(async () => { await del(`/chassis-master/${type === 'month' ? 'months' : 'years'}/${id}`); await load(); });
  };
  const saveRules = (e) => {
    e.preventDefault();
    run(async () => { await put('/chassis-master/rule', form); setModal(null); setForm({}); await load(); });
  };

  return (
    <div>
      <div className="actions" style={{ marginBottom: 14 }}>
        <span className="muted">Standalone master only — production/chassis generation will be linked later.</span>
      </div>
      <ErrorBanner message={!modal ? error : ''} />

      <Card title="Chassis / VIN Coding Rules" actions={<button className="btn primary" onClick={() => { setError(''); setForm({ ...(data.rule || {}) }); setModal({ type: 'rules' }); }}>Edit Rules</button>}>
        {data.rule && (
          <div className="formgrid">
            <Field label="Position of Month Code" value={data.rule.month_position} readOnly />
            <Field label="Position of Year Code" value={data.rule.year_position} readOnly />
            <Field label="Height of Chassis Number (VIN)" value={data.rule.chassis_height} readOnly />
            <Field label="Example of Engine / Motor ID / No." value={data.rule.engine_motor_example} readOnly />
            <Field label="Example of Chassis No. (VIN)" value={data.rule.chassis_example} readOnly />
          </div>
        )}
      </Card>

      <div style={{height: 14}} />
      <CodeTable title="Month Code Master" rows={data.months} columns={[{key:'month',label:'Month'},{key:'code',label:'Code'}]} addLabel="Month Code" onAdd={() => openMonth()} onEdit={openMonth} onDelete={(id) => removeCode('month', id)} />
      <div style={{height: 14}} />
      <CodeTable title="Year Code Master" rows={data.years} columns={[{key:'year',label:'Year'},{key:'code',label:'Code'}]} addLabel="Year Code" onAdd={() => openYear()} onEdit={openYear} onDelete={(id) => removeCode('year', id)} />

      {modal && (
        <div className="modal">
          <form className="modalbox" onSubmit={modal.type === 'rules' ? saveRules : saveCode}>
            <h2>{modal.type === 'rules' ? 'Chassis / VIN Coding Rules' : `${modal.row ? 'Edit' : 'Add'} ${modal.type === 'month' ? 'Month Code' : 'Year Code'}`}</h2>
            <ErrorBanner message={error} />
            {modal.type === 'rules' ? (
              <div className="formgrid">
                <Field label="Position of Month Code" value={form.month_position} onChange={v => setForm({...form, month_position:v})} required />
                <Field label="Position of Year Code" value={form.year_position} onChange={v => setForm({...form, year_position:v})} required />
                <Field label="Height of Chassis Number (VIN)" value={form.chassis_height} onChange={v => setForm({...form, chassis_height:v})} required />
                <Field label="Example of Engine / Motor ID / No." value={form.engine_motor_example} onChange={v => setForm({...form, engine_motor_example:v})} />
                <Field label="Example of Chassis No. (VIN)" value={form.chassis_example} onChange={v => setForm({...form, chassis_example:v})} />
              </div>
            ) : modal.type === 'month' ? (
              <div className="formgrid">
                <Field label="Month" type="select" value={form.month} options={MONTHS} onChange={v => setForm({...form, month:v})} required />
                <Field label="Code" value={form.code} onChange={v => setForm({...form, code:v})} required />
              </div>
            ) : (
              <div className="formgrid">
                <Field label="Year" type="number" value={form.year} onChange={v => setForm({...form, year:v})} required />
                <Field label="Code" value={form.code} onChange={v => setForm({...form, code:v})} required />
              </div>
            )}
            <div className="actions" style={{marginTop:18, justifyContent:'flex-end'}}>
              <button type="button" className="btn" onClick={() => { setModal(null); setForm({}); }}>Cancel</button>
              <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
