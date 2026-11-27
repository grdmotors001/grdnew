// Weekly off (department ke hisaab se, default Sunday) aur holiday (sab ya kisi location ke liye) ka hisaab.
export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function offDaysFor(emp, settings) {
  const rows = (settings && settings.weekly_off) || [];
  const dept = String((emp && emp.department) || '').trim().toLowerCase();
  const hit = rows.find(r => String(r.department).trim().toLowerCase() === dept) || rows.find(r => r.department === '*');
  return String(hit ? hit.days : '0').split(',').filter(x => x !== '');
}

// '' (kaam ka din) | 'Weekly Off' | 'Holiday: <naam>'
export function offInfo(emp, dateStr, settings) {
  const d = String(dateStr || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return '';
  const loc = String((emp && emp.location) || '').trim().toLowerCase();
  const hol = ((settings && settings.holidays) || []).find(h => String(h.holiday_date).slice(0, 10) === d && (!String(h.location || '').trim() || String(h.location).trim().toLowerCase() === loc));
  if (hol) return 'Holiday: ' + hol.name;
  const dow = new Date(d + 'T00:00:00Z').getUTCDay();
  return offDaysFor(emp, settings).includes(String(dow)) ? 'Weekly Off' : '';
}
