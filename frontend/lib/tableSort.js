// Har table ke header par click-to-sort (asc/desc). Table ko opt-out karne ke liye <table data-nosort>.
// Skip: rowSpan wali tables, jin header me input/button ho, ya jahan 2 se kam data rows hon.
const DATE_RE = /^(\d{2})-(\d{2})-(\d{4})/;
const NUM_RE = /^[-+]?[\d,]*\.?\d+/;

function cellValue(td) {
  const t = (td?.textContent || '').replace(/\u20b9|Rs\.?|INR/gi, '').trim();
  if (!t || t === '—' || t === '-' || t === 'NIL') return { k: 'e' };
  const d = t.match(DATE_RE);
  if (d) return { k: 'n', v: Number(d[3] + d[2] + d[1]) };
  const n = t.match(NUM_RE);
  if (n && /^[-+]?[\d,]*\.?\d+\s*(Dr|Cr)?$/i.test(t)) {
    const v = parseFloat(n[0].replace(/,/g, ''));
    if (!Number.isNaN(v)) return { k: 'n', v: /Cr$/i.test(t) ? -v : v };
  }
  return { k: 's', v: t.toLowerCase() };
}

function sortableTable(table) {
  if (!table || table.hasAttribute('data-nosort')) return null;
  const head = table.tHead?.rows?.[0];
  const body = table.tBodies?.[0];
  if (!head || !body || body.rows.length < 2) return null;
  if (body.querySelector('[rowspan]') || head.querySelector('[colspan]')) return null;
  return { head, body };
}

function tag() {
  document.querySelectorAll('table').forEach((table) => {
    const s = sortableTable(table);
    table.querySelectorAll('thead th').forEach((th) => {
      const ok = !!s && !th.querySelector('input,button,select,a') && (th.textContent || '').trim() !== '';
      if (ok) th.setAttribute('data-sortable', '1'); else th.removeAttribute('data-sortable');
    });
  });
}

function onClick(e) {
  const th = e.target.closest && e.target.closest('th[data-sortable]');
  if (!th) return;
  const table = th.closest('table');
  const s = sortableTable(table);
  if (!s) return;
  const idx = th.cellIndex;
  const dir = th.getAttribute('data-sort') === 'asc' ? 'desc' : 'asc';
  s.head.querySelectorAll('th').forEach((x) => x.removeAttribute('data-sort'));
  th.setAttribute('data-sort', dir);
  const rows = Array.from(s.body.rows);
  const data = rows.filter((r) => r.cells.length > idx && !Array.from(r.cells).some((c) => c.colSpan > 1));
  const rest = rows.filter((r) => !data.includes(r));
  const keyed = data.map((r, i) => ({ r, i, c: cellValue(r.cells[idx]) }));
  keyed.sort((a, b) => {
    if (a.c.k === 'e' || b.c.k === 'e') return a.c.k === b.c.k ? a.i - b.i : a.c.k === 'e' ? 1 : -1;
    let x;
    if (a.c.k === 'n' && b.c.k === 'n') x = a.c.v - b.c.v;
    else x = String(a.c.v).localeCompare(String(b.c.v), undefined, { numeric: true });
    if (x === 0) return a.i - b.i;
    return dir === 'asc' ? x : -x;
  });
  keyed.forEach(({ r }) => s.body.appendChild(r));
  rest.forEach((r) => s.body.appendChild(r));
}

export function enableTableSort() {
  if (typeof document === 'undefined') return () => {};
  let raf = 0;
  const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(tag); };
  const mo = new MutationObserver(schedule);
  mo.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('click', onClick);
  schedule();
  return () => { mo.disconnect(); document.removeEventListener('click', onClick); cancelAnimationFrame(raf); };
}
