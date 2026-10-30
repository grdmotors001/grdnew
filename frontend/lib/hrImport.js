// Smart Office "Monthly Detailed Attendance Report" (.xls/.xlsx) parser.
// Har employee ka block: "Employee Code:-" row, phir Days / Shift / In Time / Out Time / Late By / Early By / Total OT / Duration / T Duration / Status rows.
// Browser me (xlsx library) aur Node me dono jagah chalta hai.
import * as XLSX from 'xlsx';

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const txt = (v) => (v === undefined || v === null ? '' : String(v).trim());
const pad = (n) => String(n).padStart(2, '0');

// Excel kabhi time ko fraction-of-day number bana deta hai; use HH:MM:SS me badlo.
function cellToTimeText(v) {
  if (typeof v === 'number' && v >= 0 && v < 1) {
    const s = Math.round(v * 86400);
    return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  }
  return txt(v);
}

// "19:11:04" / "19:12:04(SE)" -> { time:'19:11:04', single:true/false } ; "00:00" ya khali -> time:''
function parsePunch(v) {
  const s = cellToTimeText(v);
  const single = /\(SE\)/i.test(s);
  const m = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return { time: '', single };
  const t = `${pad(m[1])}:${m[2]}:${m[3] || '00'}`;
  if (t === '00:00:00') return { time: '', single };
  return { time: t, single };
}

// "07:55" -> 7.9167 (hours)
function hhmmToHours(v) {
  const m = cellToTimeText(v).match(/(\d{1,3}):(\d{2})/);
  return m ? Number(m[1]) + Number(m[2]) / 60 : 0;
}

export function parseSmartOfficeReport(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: false });
  // Smart Office kabhi har employee ki alag sheet banata hai (Sheet1, Sheet2 ...),
  // kabhi sab ek hi sheet par. Isliye saari sheets padho.
  const grids = wb.SheetNames.map((n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }));

  // Report ki period: "01-Sep-2026 To 30-Sep-2026"
  let year = 0, month = 0, period = '';
  for (const grid of grids) {
    for (let r = 0; r < Math.min(grid.length, 20) && !year; r++) {
      for (const c of grid[r]) {
        const m = txt(c).match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})\s*To\s*(\d{1,2})-([A-Za-z]{3})-(\d{4})/i);
        if (m) { year = Number(m[3]); month = MONTHS[m[2].toLowerCase()] || 0; period = txt(c); break; }
      }
    }
    if (year) break;
  }
  if (!year || !month) throw new Error('Report ki date range ("01-Sep-2026 To 30-Sep-2026") nahi mili. Smart Office ki Monthly Detailed Report upload karein.');

  const employees = [];
  let blocks = 0;
  for (const grid of grids) {
  const starts = [];
  grid.forEach((row, i) => { if (/^Employee Code/i.test(txt(row[1]))) starts.push(i); });
  blocks += starts.length;
  starts.forEach((s, idx) => {
    const end = idx + 1 < starts.length ? starts[idx + 1] : grid.length;
    const head = grid[s];
    // Code / Name: label ke baad pehla bhara hua cell
    const after = (label) => {
      const at = head.findIndex((c) => new RegExp(label, 'i').test(txt(c)));
      if (at < 0) return '';
      for (let k = at + 1; k < head.length; k++) if (txt(head[k]) !== '') return txt(head[k]);
      return '';
    };
    const code = after('^Employee Code');
    const name = after('^Employee Name');

    // block ke rows label (col B) se pehchano
    const rowOf = {};
    for (let r = s + 1; r < end; r++) {
      const label = txt(grid[r][1]);
      if (label && !(label in rowOf)) rowOf[label] = r;
    }
    // Din wali row ("1-Sat", "2-Sun" ...): kabhi col B me "Days" label hota hai, kabhi
    // (jaise is report me) label khali hota hai — isliye label par nahi, cells dekh kar pehchano.
    let dayRow = null;
    for (let r = s + 1; r < end && !dayRow; r++) {
      const hits = grid[r].filter((c) => /^\d{1,2}-[A-Za-z]{3}$/.test(txt(c))).length;
      if (hits >= 5) dayRow = grid[r];
    }
    if (!dayRow) return;
    const days = [];
    dayRow.forEach((c, col) => {
      const m = txt(c).match(/^(\d{1,2})-([A-Za-z]{3})$/);
      if (m) days.push({ col, day: Number(m[1]), mon: MONTHS[m[2].toLowerCase()] });
    });
    const get = (label, col) => (rowOf[label] !== undefined ? grid[rowOf[label]][col] : '');

    const rows = [];
    for (const d of days) {
      const status = txt(get('Status', d.col)).toUpperCase();
      const present = /^P/.test(status);
      const inP = parsePunch(get('In Time', d.col));
      const outP = parsePunch(get('Out Time', d.col));
      const single = outP.single || (present && !!inP.time && !outP.time);
      rows.push({
        work_date: `${year}-${pad(d.mon || month)}-${pad(d.day)}`,
        status: present ? 'Present' : 'Absent',
        first_in: inP.time,
        // (SE) = us din sirf ek punch hua; purana app Out ko In+1 min bana deta hai, wo asli Out nahi hai.
        last_out: single ? '' : outP.time,
        single_punch: single,
        work_hours: single ? 0 : hhmmToHours(get('T Duration', d.col)),
        overtime_hours: hhmmToHours(get('Total OT', d.col)),
      });
    }
    employees.push({ code, name, rows });
  });
  }
  if (!blocks) throw new Error('Is file me "Employee Code" wale blocks nahi mile. Monthly Detailed Report (.xls) upload karein.');

  const presentDays = employees.reduce((n, e) => n + e.rows.filter((r) => r.status === 'Present').length, 0);
  return { year, month, period, employees, presentDays };
}
