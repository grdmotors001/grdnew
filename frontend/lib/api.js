// Talks to the Flask JSON API via the /api/backend/* rewrite in
// next.config.mjs (see BACKEND_URL there). Auth is a bearer token
// (see backend/auth.py) instead of a session cookie, since the API
// is a separate origin in production — the token is kept in
// localStorage and attached to every request.
const base = '/api/backend';
const TOKEN_KEY = 'ebill_token';

export function getToken() {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (typeof window === 'undefined') return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export async function api(path, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };
  const r = await fetch(base + path, { ...options, headers, cache: 'no-store' });
  if (r.status === 401) {
    setToken(null);
    const err = new Error('Session expired — please sign in again.');
    err.authError = true;
    throw err;
  }
  const contentType = r.headers.get('content-type') || '';
  const d = contentType.includes('application/json') ? await r.json().catch(() => ({})) : null;
  if (!r.ok) throw new Error((d && d.error) || `Request failed (${r.status})`);
  return d;
}

export const get = (p) => api(p);
export const post = (p, b) => api(p, { method: 'POST', body: JSON.stringify(b) });
export const put = (p, b) => api(p, { method: 'PUT', body: JSON.stringify(b) });
export const del = (p) => api(p, { method: 'DELETE' });

// Excel export: the backend only knows how to hand back CSV (export=csv),
// so we fetch that same CSV, parse it (PapaParse handles quoted/commaed
// fields correctly) and re-write it as a real .xlsx workbook (SheetJS) —
// giving an actual Excel file instead of a CSV renamed to .xlsx. Both
// libraries are loaded on demand (only when someone actually clicks
// Export) instead of being in every page's bundle.
export async function downloadExcel(path, filename) {
  const token = getToken();
  const sep = path.includes('?') ? '&' : '?';
  const r = await fetch(base + path + sep + 'export=csv', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!r.ok) throw new Error('Export failed');
  const csvText = await r.text();

  const [{ default: Papa }, XLSX] = await Promise.all([import('papaparse'), import('xlsx')]);
  const { data: rows } = Papa.parse(csvText, { skipEmptyLines: true });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');

  const xlsxName = filename.replace(/\.csv$/i, '') + '.xlsx';
  XLSX.writeFile(wb, xlsxName);
}
