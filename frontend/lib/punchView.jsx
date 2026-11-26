// Punch In / Punch Out cell ka text.
//  - Akela punch 2 baje (14:00 IST) ke baad ka ho  => Punch Out maana jaata hai (Punch In bhoola)
//  - Akela punch subah ka ho                       => Punch In, Out baaki ("1 punch")
//  - 3 ya zyada punch                              => Punch Out ke saath "N punches" dikhta hai
export const SINGLE_PUNCH_OUT_FROM_HOUR = 14;

function istHour(v) {
  const d = new Date(v);
  if (isNaN(d)) return null;
  return Number(d.toLocaleString('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Kolkata' }));
}

// fmt = us component ka apna timeIST function
export function punchCells(x, fmt) {
  const n = Number(x.punch_count) || 0;
  if (x.single_punch) {
    const h = istHour(x.first_in);
    if (h !== null && h >= SINGLE_PUNCH_OUT_FROM_HOUR) {
      return {
        inCell: <span className="muted">Punch In nahi</span>,
        outCell: <>{fmt(x.first_in)} <span className="muted">(sirf Out)</span></>,
      };
    }
    return { inCell: fmt(x.first_in), outCell: <span className="muted">1 punch</span> };
  }
  return {
    inCell: fmt(x.first_in),
    outCell: <>{fmt(x.last_out)}{n > 2 ? <span className="muted"> · {n} punches</span> : null}</>,
  };
}
