// Public warranty page (QR scan). Login nahi chahiye -> sirf non-sensitive info dikhao.
import { pool } from "../../../lib/server/common";

export const dynamic = "force-dynamic";
export const metadata = { title: "Warranty Verification", robots: { index: false, follow: false } };

function addMonths(iso: string, n: number) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(d, last));
  return dt;
}
const fmt = (d: Date | string) =>
  (typeof d === "string" ? new Date(d.slice(0, 10) + "T00:00:00Z") : d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

const card: React.CSSProperties = { background: "#fff", border: "1px solid #dfe3ea", borderRadius: 12, padding: 16, marginBottom: 12 };
const row: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 0", borderBottom: "1px dashed #e6e9ef", fontSize: 14 };

export default async function Page({ params }: { params: Promise<{ chassis: string }> }) {
  const raw = decodeURIComponent((await params).chassis || "").trim();
  const chassis = /^[A-Za-z0-9-]{5,40}$/.test(raw) ? raw : "";

  let veh: any = null, sale: string | null = null, ctrl = "";
  if (chassis) {
    veh = (await pool.query("SELECT model_name, chassis_no, motor_no, battery_maker, battery_no1, battery_no2, battery_no3, battery_no4 FROM vehicle WHERE lower(btrim(chassis_no))=lower($1) LIMIT 1", [chassis]).catch(() => ({ rows: [] as any[] }))).rows[0] || null;
    sale = (await pool.query("SELECT ti.date::text AS d FROM tax_invoice ti WHERE COALESCE(ti.cancelled,false)=false AND lower(btrim(ti.chassis_no))=lower($1) ORDER BY ti.date DESC, ti.id DESC LIMIT 1", [chassis]).catch(() => ({ rows: [] as any[] }))).rows[0]?.d || null;
    ctrl = (await pool.query("SELECT controller_no FROM delivery_challan WHERE lower(btrim(chassis_no))=lower($1) AND COALESCE(btrim(controller_no),'')<>'' ORDER BY id DESC LIMIT 1", [chassis]).catch(() => ({ rows: [] as any[] }))).rows[0]?.controller_no || "";
  }
  const batt = veh ? [veh.battery_no1, veh.battery_no2, veh.battery_no3, veh.battery_no4].filter((x: any) => x && String(x).trim()) : [];

  return (
    <main style={{ maxWidth: 520, margin: "0 auto", padding: 16, fontFamily: "system-ui, sans-serif", background: "#f4f6fa", minHeight: "100vh" }}>
      <div style={{ ...card, background: "#14284b", color: "#fff", textAlign: "center" }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>G.R.D. MOTORS</div>
        <div style={{ fontSize: 13, opacity: 0.85 }}>Warranty Verification</div>
      </div>

      {!veh ? (
        <div style={card}>Record not found. Please check the QR code.</div>
      ) : (
        <>
          <div style={card}>
            <div style={row}><span>Model</span><b>{veh.model_name || "-"}</b></div>
            <div style={row}><span>Chassis No.</span><b>{veh.chassis_no}</b></div>
            <div style={row}><span>Motor No.</span><b>{veh.motor_no || "-"}</b></div>
            {ctrl ? <div style={row}><span>Controller No.</span><b>{ctrl}</b></div> : null}
            <div style={{ ...row, borderBottom: "none" }}><span>Date of Sale</span><b>{sale ? fmt(sale) : "Not yet sold / billed"}</b></div>
          </div>

          {sale ? (
            <>
              <div style={card}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Motor &amp; Controller Warranty</div>
                <div style={row}><span>If 6 months warranty</span><b>Valid till {fmt(addMonths(sale, 6))}</b></div>
                <div style={{ ...row, borderBottom: "none" }}><span>If 12 months warranty</span><b>Valid till {fmt(addMonths(sale, 12))}</b></div>
              </div>
              <div style={card}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Battery</div>
                <div style={row}><span>Make</span><b>{veh.battery_maker || "-"}</b></div>
                {batt.length ? <div style={row}><span>Battery No.</span><b style={{ textAlign: "right" }}>{batt.join(", ")}</b></div> : null}
                <div style={{ fontSize: 12, color: "#5b6577", marginTop: 8 }}>Battery warranty is provided by the battery company, counted from the date of sale ({fmt(sale)}).</div>
              </div>
            </>
          ) : null}
        </>
      )}
      <div style={{ fontSize: 11, color: "#7a8497", textAlign: "center", marginTop: 8 }}>Warranty as per T&amp;C of Principal Company only.</div>
    </main>
  );
}
