// Talks to the Flask JSON API via the /api/backend/* rewrite in
// next.config.mjs (see BACKEND_URL there). Auth is a bearer token
// (see backend/auth.py) instead of session cookies. The token is kept in
// localStorage and attached to every request.

const base = '/api/backend';
const TOKEN_KEY = 'ebill_token';
const PORTAL_KEY = 'ebill_portal';
const DEFAULT_TIMEOUT_MS = 20000;

// Small client-side GET cache + in-flight request deduplication.
// This avoids repeatedly waiting for the same master/report data when
// navigating between screens, while mutations immediately invalidate it.
// Keep the window short so operational data remains fresh.
const GET_CACHE_TTL_MS = 5000;
const getCache = new Map();
const getInFlight = new Map();

export function getToken() {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function getPortalKind() {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(PORTAL_KEY);
}

export function setPortalKind(kind) {
  if (typeof window === 'undefined') return;
  if (kind) window.localStorage.setItem(PORTAL_KEY, kind);
  else window.localStorage.removeItem(PORTAL_KEY);
}

export function setToken(token) {
  if (typeof window === 'undefined') return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else {
    window.localStorage.removeItem(TOKEN_KEY);
    clearGetCache();
  }
}

export function clearGetCache() {
  getCache.clear();
}

function getCacheKey(path, options) {
  return path + '|' + (options?.headers ? JSON.stringify(options.headers) : '');
}

export async function api(path, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };
  const { timeoutMs = DEFAULT_TIMEOUT_MS, preserveAuthOn401 = false, ...fetchOptions } = options;
  const method = String(fetchOptions.method || 'GET').toUpperCase();
  const cacheable = method === 'GET' && !fetchOptions.signal && !fetchOptions.noClientCache;
  const cacheKey = cacheable ? getCacheKey(path, options) : null;

  if (cacheable) {
    const cached = getCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    const existing = getInFlight.get(cacheKey);
    if (existing) return existing;
  }

  const run = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await fetch(base + path, {
        ...fetchOptions,
        headers,
        cache: 'no-store',
        signal: controller.signal,
      });
      if (r.status === 401) {
        if (!preserveAuthOn401) setToken(null);
        const err = new Error('Session expired — please sign in again.');
        err.authError = true;
        throw err;
      }
      const contentType = r.headers.get('content-type') || '';
      const d = contentType.includes('application/json') ? await r.json().catch(() => ({})) : null;
      if (!r.ok) throw new Error((d && d.error) || `Request failed (${r.status})`);
      if (cacheable) getCache.set(cacheKey, { data: d, expiresAt: Date.now() + GET_CACHE_TTL_MS });
      return d;
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('Request timed out. Please try again.');
      if (error instanceof TypeError) throw new Error('Network error. Please check the connection and try again.');
      throw error;
    } finally {
      clearTimeout(timer);
      if (cacheKey) getInFlight.delete(cacheKey);
    }
  })();

  if (cacheable) getInFlight.set(cacheKey, run);
  return run;
}

export const get = (p, options = {}) => api(p, options);

export const post = async (p, b, options = {}) => {
  const result = await api(p, { ...options, method: 'POST', body: JSON.stringify(b), noClientCache: true });
  clearGetCache();
  return result;
};

export const put = async (p, b, options = {}) => {
  const result = await api(p, { ...options, method: 'PUT', body: JSON.stringify(b), noClientCache: true });
  clearGetCache();
  return result;
};

export const del = async (p, options = {}) => {
  const result = await api(p, { ...options, method: 'DELETE', noClientCache: true });
  clearGetCache();
  return result;
};

// Excel export: the backend only knows how to hand back CSV (export=csv),
// so we fetch that same CSV, parse it and re-write it as a real .xlsx
// workbook. Both libraries are loaded on demand only when Export is clicked.
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

export async function downloadText(path, filename) {
  const token = getToken();
  const r = await fetch(base + path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d?.error || 'TXT download failed');
  }
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || 'upload.TXT';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function downloadBlob(path, body, filename) {
  const token = getToken();
  const r = await fetch(base + path, {
    method: 'POST',
    headers: {'Content-Type':'application/json', ...(token ? {Authorization:`Bearer ${token}`} : {})},
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d?.error || 'Download failed');
  }
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href=url; link.download=filename || 'download';
  document.body.appendChild(link); link.click(); link.remove();
  URL.revokeObjectURL(url);
}
