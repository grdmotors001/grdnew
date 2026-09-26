'use client';
import { useRef, useState } from 'react';
import { downloadText, post } from '../lib/api';

export function BackupRestorePage({ user }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [results, setResults] = useState(null);
  const fileRef = useRef(null);

  const isAdmin = !!user?.is_super_user || String(user?.department || '').trim().toLowerCase() === 'admin';

  const runBackup = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const filename = \`grd-backup-\${new Date().toISOString().slice(0, 10)}.json\`;
      await downloadText('/backup', filename);
      setMessage({ type: 'ok', text: 'Backup downloaded: ' + filename });
    } catch (e) {
      setMessage({ type: 'error', text: e.message || 'Backup failed.' });
    } finally {
      setBusy(false);
    }
  };

  const pickFile = () => fileRef.current?.click();

  const runRestore = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!window.confirm(
      'This will insert/update rows from the backup file into the live database ' +
      '(existing rows with matching IDs get overwritten). Continue?'
    )) return;

    setBusy(true);
    setMessage(null);
    setResults(null);
    try {
      const text = await file.text();
      let parsed;
      try { parsed = JSON.parse(text); }
      catch { throw new Error('That file is not valid JSON.'); }
      const res = await post('/backup', parsed);
      setResults(res.results || null);
      setMessage({ type: 'ok', text: 'Restore complete.' });
    } catch (e) {
      setMessage({ type: 'error', text: e.message || 'Restore failed.' });
    } finally {
      setBusy(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="panel">
        <h3>Backup / Restore</h3>
        <p>This section is available to admin users only.</p>
      </div>
    );
  }

  return (
    <div className="panel">
      <h3>Backup / Restore</h3>
      <p style={{ opacity: 0.8, marginBottom: 16 }}>
        Download a full backup of the database as a JSON file, or restore from
        a previously downloaded backup file.
      </p>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <button className="btn primary" disabled={busy} onClick={runBackup}>
          {busy ? 'Working…' : 'Download Backup'}
        </button>
        <button className="btn" disabled={busy} onClick={pickFile}>
          {busy ? 'Working…' : 'Restore from Backup File'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={runRestore}
        />
      </div>

      {message && (
        <div style={{ color: message.type === 'error' ? '#c0392b' : '#2e7d32', marginBottom: 12 }}>
          {message.text}
        </div>
      )}

      {results && (
        <table className="table" style={{ maxWidth: 520 }}>
          <thead>
            <tr><th>Table</th><th>Rows restored</th><th>Note</th></tr>
          </thead>
          <tbody>
            {Object.entries(results).map(([name, r]) => (
              <tr key={name}>
                <td>{name}</td>
                <td>{r.restored}</td>
                <td style={{ color: r.error ? '#c0392b' : 'inherit' }}>{r.error || r.skipped || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
