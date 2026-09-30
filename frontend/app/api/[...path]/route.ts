import jwt from "jsonwebtoken";
import { Pool, types } from "pg";
export const dynamic="force-dynamic";
export const runtime="nodejs";
// DATE columns ko plain "YYYY-MM-DD" string rakho (JS Date banne se timezone ke karan 1 din pichhe ho jaata tha: 2026-09-27T18:30:00.000Z).
types.setTypeParser(1082,(v:string)=>v);
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:5});
const secret=process.env.JWT_SECRET||"grd-node-change-this-secret";

function auth(req:Request){
  const h=req.headers.get("authorization")||"";
  const t=h.startsWith("Bearer ")?h.slice(7):"";
  if(!t)return null;
  try{return jwt.verify(t,secret) as any}catch{return null}
}
const _bodyCache=new WeakMap<Request,Promise<any>>();
// Body cache: mutation() reads the body for permission/dealer checks and handlers read it again; an uncached req.json() returned {} the 2nd time.
const json=(req:Request):Promise<any>=>{let p=_bodyCache.get(req);if(!p){p=req.json().catch(()=>({}));_bodyCache.set(req,p);}return p;};
const num=(v:any)=>Number.isFinite(Number(v))?Number(v):0;
// tax_invoice has no stored taxable/GST/total columns (legacy model computes them). Screens, print and the dealer portal read
// taxable_value / cgst_amount / sgst_amount / igst_amount / tax_amount / bill_total, so every tax_invoice read that feeds them adds this (alias: ti).
const TI_TAXABLE="GREATEST(COALESCE(ti.gst_sale_amount,ti.sale_amount,0)-COALESCE(ti.discount,0),0)";
const TI_STATE_INTRA="COALESCE(NULLIF(UPPER(TRIM(ti.state_type)),''),'I')='I'";
const TI_CALC=`${TI_TAXABLE} AS taxable_value,
  CASE WHEN ${TI_STATE_INTRA} THEN ${TI_TAXABLE}*COALESCE(ti.gst_rate,0)/200 ELSE 0 END AS cgst_amount,
  CASE WHEN ${TI_STATE_INTRA} THEN ${TI_TAXABLE}*COALESCE(ti.gst_rate,0)/200 ELSE 0 END AS sgst_amount,
  CASE WHEN ${TI_STATE_INTRA} THEN 0 ELSE ${TI_TAXABLE}*COALESCE(ti.gst_rate,0)/100 END AS igst_amount,
  ${TI_TAXABLE}*COALESCE(ti.gst_rate,0)/100 AS tax_amount,
  ${TI_TAXABLE}+${TI_TAXABLE}*COALESCE(ti.gst_rate,0)/100+COALESCE(ti.insurance_amount,0)+COALESCE(ti.registration_amount,0) AS bill_total`;
const snake=(s:string)=>s.replace(/[A-Z]/g,m=>"_"+m.toLowerCase()).replace(/^_/,"");
const idOf=(v:any)=>{const n=Number(v);return Number.isInteger(n)&&n>0?n:null};
function csvCell(v:any){const s=String(v??"");return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}
function csvResponse(rows:any[],filename:string){
  if(!rows.length)return new Response("",{status:200,headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":"attachment; filename="+filename}});
  const keys=Object.keys(rows[0]); const body=[keys.map(csvCell).join(","),...rows.map(r=>keys.map(k=>csvCell(r[k])).join(","))].join("\n");
  return new Response(body,{status:200,headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":"attachment; filename="+filename}});
}
function dateWhere(alias:string,u:URL,args:any[]){
  const w:string[]=[];
  const from=u.searchParams.get("from"),to=u.searchParams.get("to"),search=u.searchParams.get("search");
  if(from){args.push(from);w.push(alias+".date >= $"+args.length+"::date");}
  if(to){args.push(to);w.push(alias+".date <= $"+args.length+"::date");}
  return {w,search};
}

const TABLES:any={
  "company":"company","dealers":"dealer","dealer-list":"dealer","users":"user","salesmen":"user",
  "products":"product","billing-customers":"billing_customer","tax-invoices":"tax_invoice","purchase-bills":"purchase_bill",
  "delivery-challans":"delivery_challan","credit-notes":"credit_note","debit-notes":"debit_note",
  "production-vouchers":"production_voucher","production-formulas":"production_formula",
  "repair-service-vouchers":"repair_service_voucher","repair-service-receipts":"repair_service_payment_receipt",
  "expense-payment-voucher":"expense_payment_voucher","day-book":"day_book","journal-stock":"journal_stock",
  "old-rickshaws":"old_rickshaw","old-rickshaw-challans":"old_rickshaw_challan",
  "battery-swap-vouchers":"battery_swap_voucher","battery-delivery-challans":"battery_delivery_challan",
  "battery-addition":"battery_stock_movement","battery-withdrawal":"battery_stock_movement",
  "vehicle-inventory":"vehicle","vehicles":"vehicle","dealer/customers":"customer",
  "loan-application-view":"loan_workflow","loan-workflow":"loan_workflow","dealer/loan-status":"loan_workflow",
  "dealer/pending-sales":"loan_workflow","billing/pending-chfpl":"chfpl_billing_queue",
  "billing/manual-pending-bills":"manual_pending_bill","billing/pending-sales":"loan_workflow",
  "billing/vehicle-inventory":"vehicle","billing/old-rickshaw-challans":"old_rickshaw_challan",
  "reports/cash-at-dealer":"day_book","reports/delivery-challan-register":"delivery_challan","reports/gst-register":"tax_invoice",
  "reports/hypothecation-register":"tax_invoice","reports/ledger":"day_book","reports/ledger-v":"day_book",
  "reports/payment-receivable":"day_book","reports/production-register":"production_voucher","reports/purchase-register":"purchase_bill",
  "reports/sale-register":"tax_invoice","reports/subsidy":"tax_invoice","stock/ledger-dealers":"journal_stock",
  "stock/ledger-premises":"journal_stock","stock/ledger-raw":"journal_stock","stock/closing-dealers":"journal_stock",
  "stock/closing-premises":"journal_stock","stock/closing-raw":"journal_stock",
  "dealer/battery-stock":"battery_stock_movement","dealer/stock":"vehicle","dealer/purchases":"purchase_bill",
  "dealer/tax-invoices":"tax_invoice","dealer/delivery-challans":"delivery_challan",
  "dealer/old-rickshaw-challans":"old_rickshaw_challan","dealer/payments":"dealer_payment",
  "expense-payment-voucher/booking-pending":"expense_payment_voucher","expense-payment-voucher/incentive-pending":"expense_payment_voucher",
  "expense-payment-voucher/party-pending":"expense_payment_voucher","expense-payment-voucher/work-pending":"expense_payment_voucher"
};
function tableFor(path:string[]){
  const full=path.join("/");
  if(path[0]==="masters")return "simple_master";
  return TABLES[full]||TABLES[path[0]]||null;
}
// pg returns DATE columns as JS Date objects; String(Date).slice(0,10) gives "Mon Sep 28" (invalid for ::date). Always use ymd().
function todayDate(){return new Date().toISOString().slice(0,10);}
// ---- Import helpers (Excel/CSV) ----
function normKey(k:any){return String(k??'').toLowerCase().replace(/[^a-z0-9]/g,'');}
// Header-insensitive getter: "Chassis No.", "chassis_no", "CHASSIS NO" all match.
function rowGetter(o:any){const m:any={};for(const [k,v] of Object.entries(o||{}))m[normKey(k)]=v;return (keys:string[])=>{for(const k of keys){const v=m[normKey(k)];if(v!==undefined&&v!==null&&String(v).trim()!=='')return v;}return '';};}
// Excel gives serial numbers (45930) or dd/mm/yyyy text; passing those straight to ::date either errors (whole import fails) or swaps day/month.
function importDate(v:any):string|null{
  if(v===''||v==null)return null;
  const ok=(y:number,m:number,d:number)=>{const t=new Date(Date.UTC(y,m-1,d));return t.getUTCFullYear()===y&&t.getUTCMonth()===m-1&&t.getUTCDate()===d?y+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0'):null;};
  if(v instanceof Date)return isNaN(v.getTime())?null:v.toISOString().slice(0,10);
  if(typeof v==='number'||/^\d{5}(\.\d+)?$/.test(String(v).trim())){const n=Number(v);if(n<20000||n>80000)return null;return new Date(Date.UTC(1899,11,30)+Math.floor(n)*86400000).toISOString().slice(0,10);}
  const t=String(v).trim();let m=t.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);if(m)return ok(+m[1],+m[2],+m[3]);
  m=t.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/);if(m){const y=m[3].length===2?2000+ +m[3]:+m[3];return ok(y,+m[2],+m[1]);}
  return null;
}
function importAmount(v:any):number{if(typeof v==='number')return Number.isFinite(v)?v:0;const t=String(v??'').replace(/[₹,\s]/g,'').replace(/\((.*)\)/,'-$1').replace(/(dr|cr)\.?$/i,'');const n=Number(t);return Number.isFinite(n)?n:0;}
function moduleAlias(x:string){return x==='insurance-register'?'insurance-rto':x==='rto-register'?'rto-expense':x==='hypothecation-receipts'?'hypothecation-register':x;}
function ymd(v:any):string{
  if(v instanceof Date){if(isNaN(v.getTime()))return "";return v.getFullYear()+"-"+String(v.getMonth()+1).padStart(2,"0")+"-"+String(v.getDate()).padStart(2,"0");}
  return String(v||"").slice(0,10);
}
async function columns(table:string){
  const r=await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1",[table]);
  return new Set(r.rows.map((x:any)=>x.column_name));
}
let challanShiftSchemaReady:Promise<void>|null=null;
function ensureChallanShiftSchema():Promise<void>{
  if(!challanShiftSchemaReady){
    challanShiftSchemaReady=(async()=>{
      await pool.query(`CREATE TABLE IF NOT EXISTS delivery_challan_shift (
        id bigserial PRIMARY KEY,
        shift_ref text UNIQUE,
        challan_id bigint NOT NULL,
        challan_no text,
        chassis_no text,
        model_name text,
        battery_maker text,
        battery_no1 text,
        battery_no2 text,
        battery_no3 text,
        battery_no4 text,
        shift_from_dealer_id integer,
        shift_from_dealer_name text,
        shift_to_dealer_id integer,
        shift_to_dealer_name text,
        shift_date date NOT NULL DEFAULT CURRENT_DATE,
        remark text,
        shifted_by text,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
      await pool.query("CREATE INDEX IF NOT EXISTS delivery_challan_shift_challan_idx ON delivery_challan_shift(challan_id)");
      await pool.query("CREATE INDEX IF NOT EXISTS delivery_challan_shift_date_idx ON delivery_challan_shift(shift_date)");
    })().catch(e=>{challanShiftSchemaReady=null;throw e});
  }
  return challanShiftSchemaReady;
}
// Billing customer master (per dealer). Upserts by dealer + name + mobile and returns the id.
async function upsertBillingCustomer(b:any):Promise<number|null>{
  const name=String(b.buyer_name||"").trim();
  if(!name)return null;
  if(name.toLowerCase()===String(b.dealer_name||"").trim().toLowerCase())return null;
  const cols=await columns("billing_customer");
  if(!cols.size)return null;
  const did=num(b.dealer_id)||null,mobile=String(b.buyer_mobile||"").trim();
  const t=(v:any)=>{const x=String(v??"").trim();return x?x:null};
  const f:any={relation:t(b.buyer_relation),father_name:t(b.buyer_father_name),address:t(b.buyer_address),gst_no:t(b.buyer_gst_no),pan:t(b.buyer_pan),aadhar:t(b.buyer_aadhar),dob:t(b.buyer_dob),state:t(b.buyer_state),state_code:t(b.buyer_state_code),license_no:t(b.license_no)};
  const ex=await pool.query("SELECT id FROM billing_customer WHERE COALESCE(dealer_id,0)=COALESCE($1::int,0) AND lower(btrim(name))=lower($2) AND COALESCE(btrim(mobile),'')=$3 LIMIT 1",[did,name,mobile]);
  if(ex.rowCount){
    const keys=Object.keys(f).filter(k=>cols.has(k)&&f[k]!==null);
    if(keys.length)await pool.query('UPDATE billing_customer SET '+keys.map((k,i)=>'"'+k+'"=$'+(i+1)).join(",")+',updated_at=now() WHERE id=$'+(keys.length+1),[...keys.map(k=>f[k]),ex.rows[0].id]);
    return Number(ex.rows[0].id);
  }
  const all:any={dealer_id:did,name,mobile:mobile||null,...f},keys=Object.keys(all).filter(k=>cols.has(k));
  const r=await pool.query('INSERT INTO billing_customer ('+keys.map(k=>'"'+k+'"').join(",")+') VALUES ('+keys.map((_,i)=>"$"+(i+1)).join(",")+') RETURNING id',keys.map(k=>all[k]));
  return Number(r.rows[0].id);
}
// Per-bill purchase totals from the items jsonb (used by the GST Register inward side).
function purchaseBillTotals(pb:any){
  const items=parseItems(pb.items),intra=String(pb.party_state_code||"07").trim()==="07";
  let taxable=0,cgst=0,sgst=0,igst=0;
  for(const it of items){
    const qty=num(it.qty??it.quantity),rate=num(it.rate??it.unit_rate??it.price);
    const t=num(it.taxable_amt??it.taxable_amount)||qty*rate;
    const g=num(it.gst_amount??it.tax_amount)||t*num(it.gst_rate??it.gst_percent)/100;
    taxable+=t;
    if(intra){cgst+=num(it.cgst_amt)||g/2;sgst+=num(it.sgst_amt)||g/2}else{igst+=num(it.igst_amt)||g}
  }
  return {taxable,cgst,sgst,igst};
}
async function productLogo(name:string,model:string){
  // UMRN code lives on the PRODUCT master (not on vehicle). Match product by name.
  const r=await pool.query("SELECT to_jsonb(p)->>'umrn_code' AS umrn_code,to_jsonb(p)->>'chassis_item_code' AS chassis_item_code,p.name FROM product p WHERE lower(btrim(p.name)) IN (lower(btrim($1)),lower(btrim($2))) ORDER BY (COALESCE(to_jsonb(p)->>'umrn_code','')<>'') DESC,(p.fro='F') DESC,p.id DESC LIMIT 1",[name||"",model||""]);
  const x=r.rows[0]||{},umrn=String(x.umrn_code||"").trim();
  const keys=[umrn,String(x.chassis_item_code||"").trim(),String(x.name||name||model||"").trim()].filter((k,i,a)=>k&&a.indexOf(k)===i);
  return {umrn_code:umrn,logo_keys:keys};
}
// Schema DDL only needs to run once per server process. Running ~40 CREATE/ALTER
// statements on every request made /billing/pending-sales/options hang for many seconds.
let loanWorkflowBridgeSchemaReady:Promise<void>|null=null;
function ensureLoanWorkflowBridgeSchema():Promise<void>{
  if(!loanWorkflowBridgeSchemaReady){
    loanWorkflowBridgeSchemaReady=ensureLoanWorkflowBridgeSchemaOnce().catch((e:any)=>{loanWorkflowBridgeSchemaReady=null;throw e});
  }
  return loanWorkflowBridgeSchemaReady;
}
async function ensureLoanWorkflowBridgeSchemaOnce(){
  await pool.query("ALTER TABLE loan_workflow ADD COLUMN IF NOT EXISTS chfpl_loan_id bigint");
  await pool.query("ALTER TABLE loan_workflow ADD COLUMN IF NOT EXISTS chfpl_status_updated_at timestamptz");
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS loan_workflow_chfpl_loan_id_uq ON loan_workflow(chfpl_loan_id) WHERE chfpl_loan_id IS NOT NULL");
}
let billingSalesSchemaReady:Promise<void>|null=null;
function ensureBillingSalesSchema():Promise<void>{
  if(!billingSalesSchemaReady){
    billingSalesSchemaReady=ensureBillingSalesSchemaOnce().catch((e:any)=>{billingSalesSchemaReady=null;throw e});
  }
  return billingSalesSchemaReady;
}
async function ensureBillingSalesSchemaOnce(){
  await pool.query(`CREATE TABLE IF NOT EXISTS grd_billing_sale (
    id bigserial PRIMARY KEY,
    application_id integer NOT NULL UNIQUE,
    dealer_id integer,
    customer_id integer,
    vehicle_id integer,
    chassis_no text,
    description text NOT NULL,
    sale_amount numeric NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'PENDING',
    approved_by text,
    approved_at timestamptz,
    invoice_id integer,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await pool.query("CREATE INDEX IF NOT EXISTS grd_billing_sale_status_idx ON grd_billing_sale(status)");
  await pool.query("CREATE INDEX IF NOT EXISTS grd_billing_sale_dealer_idx ON grd_billing_sale(dealer_id)");
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS grd_billing_sale_vehicle_unique ON grd_billing_sale(vehicle_id) WHERE vehicle_id IS NOT NULL AND status IN ('PENDING','APPROVED','BILLED')");
  await pool.query("ALTER TABLE grd_billing_sale ALTER COLUMN application_id DROP NOT NULL");
  const extra:any={
    customer_name:"text",customer_phone:"text",customer_address:"text",customer_state:"text",sale_type:"text",page_no:"text",do_no:"text",internal_sale_details:"text",
    buyer_relation:"text",buyer_father_name:"text",buyer_gst_no:"text",buyer_pan:"text",buyer_aadhar:"text",buyer_dob:"date",buyer_state_code:"text",
    state_type:"text",mode_term:"text",bank_name:"text",bank_account_no:"text",bank_ifsc:"text",rto_name:"text",despatch_through:"text",eway_bill_no:"text",license_no:"text",cvr_no:"text",cancelled_cheque_no:"text",remarks:"text",
    amount_received:"numeric NOT NULL DEFAULT 0",financer_name:"text",hypothecation_amount:"numeric NOT NULL DEFAULT 0",vehicle_reg_no:"text",ledger_no:"text",chassis_record_no:"text",voucher_no:"text",subsidy_amount:"numeric NOT NULL DEFAULT 0",
    gst_sale_amount:"numeric NOT NULL DEFAULT 0",gst_rate:"numeric NOT NULL DEFAULT 5",insurance_amount:"numeric NOT NULL DEFAULT 0",registration_amount:"numeric NOT NULL DEFAULT 0",discount:"numeric NOT NULL DEFAULT 0",dealer_cash_customer_id:"bigint"
  };
  for(const [col,type] of Object.entries(extra)) await pool.query('ALTER TABLE grd_billing_sale ADD COLUMN IF NOT EXISTS "'+col+'" '+type);
}
let grdAssetSchemaReady:Promise<void>|null=null;
function ensureGrdAssetSchema():Promise<void>{
  if(!grdAssetSchemaReady){
    grdAssetSchemaReady=ensureGrdAssetSchemaOnce().catch((e:any)=>{grdAssetSchemaReady=null;throw e});
  }
  return grdAssetSchemaReady;
}
async function ensureGrdAssetSchemaOnce(){
  await pool.query(`CREATE TABLE IF NOT EXISTS grd_asset (
    id bigserial PRIMARY KEY,
    application_id integer NOT NULL UNIQUE,
    dealer_id integer,
    customer_id integer,
    asset_status text NOT NULL DEFAULT 'AVAILABLE',
    source text NOT NULL DEFAULT 'CHFPL',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await pool.query("CREATE INDEX IF NOT EXISTS grd_asset_dealer_idx ON grd_asset(dealer_id)");
  await pool.query("CREATE INDEX IF NOT EXISTS grd_asset_status_idx ON grd_asset(asset_status)");
  await pool.query(`
    CREATE OR REPLACE FUNCTION grd_create_asset_on_loan_approved() RETURNS trigger AS $$
    BEGIN
      IF LOWER(REPLACE(REPLACE(TRIM(COALESCE(NEW.status,'')),'_',' '),'-',' ')) IN ('loan approved','approved')
         AND LOWER(REPLACE(REPLACE(TRIM(COALESCE(OLD.status,'')),'_',' '),'-',' ')) NOT IN ('loan approved','approved') THEN
        INSERT INTO grd_asset(application_id,dealer_id,customer_id,asset_status,source,updated_at)
        VALUES(NEW.id,NEW.dealer_id,NEW.customer_id,'AVAILABLE','CHFPL',NOW())
        ON CONFLICT(application_id) DO UPDATE SET
          dealer_id=EXCLUDED.dealer_id,customer_id=EXCLUDED.customer_id,asset_status='AVAILABLE',updated_at=NOW();
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await pool.query("DROP TRIGGER IF EXISTS grd_asset_on_loan_approved ON loan_workflow");
  await pool.query(`
    CREATE TRIGGER grd_asset_on_loan_approved
    AFTER UPDATE OF status ON loan_workflow
    FOR EACH ROW EXECUTE FUNCTION grd_create_asset_on_loan_approved()
  `);
  // Backfill any already-approved CHFPL loans so existing records also become usable GRD assets.
  await pool.query(`
    INSERT INTO grd_asset(application_id,dealer_id,customer_id,asset_status,source,updated_at)
    SELECT lw.id,lw.dealer_id,lw.customer_id,'AVAILABLE','CHFPL',NOW()
    FROM loan_workflow lw
    WHERE LOWER(REPLACE(REPLACE(TRIM(COALESCE(lw.status,'')),'_',' '),'-',' ')) IN ('loan approved','approved')
    ON CONFLICT(application_id) DO UPDATE SET
      dealer_id=EXCLUDED.dealer_id,customer_id=EXCLUDED.customer_id,asset_status='AVAILABLE',updated_at=NOW()
  `);
}

let securitySchemaReady:Promise<void>|null=null;
function ensureSecuritySchema():Promise<void>{
  if(!securitySchemaReady) securitySchemaReady=(async()=>{
    await pool.query(`CREATE TABLE IF NOT EXISTS user_action_permission (
      id bigserial PRIMARY KEY, user_id bigint NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      module_key text NOT NULL, can_view boolean NOT NULL DEFAULT false, can_create boolean NOT NULL DEFAULT false,
      can_edit boolean NOT NULL DEFAULT false, can_delete boolean NOT NULL DEFAULT false, can_approve boolean NOT NULL DEFAULT false,
      UNIQUE(user_id,module_key)
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS audit_log (
      id bigserial PRIMARY KEY, user_id bigint, username text, department text, module_key text, action text NOT NULL,
      record_id text, record_ref text, old_value jsonb, new_value jsonb, dealer_id bigint, created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await pool.query("CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log(created_at DESC)");
    await pool.query("CREATE INDEX IF NOT EXISTS audit_log_user_idx ON audit_log(user_id,created_at DESC)");
    await pool.query("CREATE INDEX IF NOT EXISTS audit_log_module_idx ON audit_log(module_key,created_at DESC)");
    await pool.query("ALTER TABLE \"user\" ADD COLUMN IF NOT EXISTS assigned_dealer_ids jsonb NOT NULL DEFAULT '[]'::jsonb");
    await pool.query("CREATE TABLE IF NOT EXISTS product_sub_group (id bigserial PRIMARY KEY, name text NOT NULL UNIQUE, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now())");
    await pool.query("INSERT INTO product_sub_group(name) VALUES('Primary') ON CONFLICT(name) DO NOTHING");
    await pool.query("ALTER TABLE product ADD COLUMN IF NOT EXISTS sub_group_id bigint");
    await pool.query("ALTER TABLE product ADD COLUMN IF NOT EXISTS sub_group_name text");
    await pool.query("UPDATE product SET sub_group_name='Primary' WHERE COALESCE(BTRIM(sub_group_name),'')=''");
    await pool.query("ALTER TABLE dealer ADD COLUMN IF NOT EXISTS sub_group_name text");
    await pool.query("UPDATE dealer SET sub_group_name='Primary' WHERE COALESCE(BTRIM(sub_group_name),'')=''");
  })().catch(e=>{securitySchemaReady=null;throw e});
  return securitySchemaReady;
}
function actionFor(method:string){ return method==='GET'?'view':method==='POST'?'create':method==='DELETE'?'delete':'edit'; }
async function audit(a:any,moduleKey:string,action:string,recordId:any,oldValue:any,newValue:any,dealerId:any=null,recordRef:any=null){
  try{ await ensureSecuritySchema(); await pool.query(`INSERT INTO audit_log(user_id,username,department,module_key,action,record_id,record_ref,old_value,new_value,dealer_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10)`,[idOf(a?.sub),a?.username||null,a?.department||a?.role||null,moduleKey,action,recordId==null?null:String(recordId),recordRef==null?null:String(recordRef),JSON.stringify(oldValue??null),JSON.stringify(newValue??null),idOf(dealerId)]); }catch(e){ console.error('[audit-log]',e); }
}
function assignedDealerIds(a:any){
  if(a?.is_super_user || String(a?.department||'').toLowerCase()==='admin') return null;
  const raw=a?.assigned_dealer_ids;
  if(Array.isArray(raw)) return raw.map(idOf).filter(Boolean);
  try{return Array.isArray(JSON.parse(String(raw||'[]')))?JSON.parse(String(raw||'[]')).map(idOf).filter(Boolean):[];}catch{return []}
}
function isSalesman(a:any){return a?.scope==='staff' && String(a?.department||'').trim().toLowerCase()==='salesman' && !a?.is_super_user;}
function dealerScopeWhere(a:any,alias:string,args:any[]){ if(!isSalesman(a)) return ''; const ids=assignedDealerIds(a)||[]; if(!ids.length){args.push(-1);return `${alias}.id=$${args.length}`;} args.push(ids); return `${alias}.id=ANY($${args.length}::bigint[])`; }
async function enforceDealerScope(a:any, table:string, id:any=null, body:any=null){
  if(!isSalesman(a)) return null;
  const ids=assignedDealerIds(a)||[]; if(!ids.length) return Response.json({error:'No dealers assigned to this salesman.'},{status:403});
  const dealerTables=new Set(['dealer','delivery_challan','tax_invoice','billing_customer','customer','vehicle','loan_workflow','old_rickshaw','old_rickshaw_challan','dealer_payment','day_book','purchase_bill','journal_stock']);
  if(!dealerTables.has(table)) return null;
  if(id && table==='dealer' && !ids.includes(Number(id))) return Response.json({error:'Dealer access denied.'},{status:403});
  if(id){
    const cols=await columns(table); if(!cols.has('dealer_id')) return null;
    const r=await pool.query(`SELECT dealer_id FROM "${table}" WHERE id=$1 LIMIT 1`,[id]);
    if(r.rowCount && !ids.includes(Number(r.rows[0].dealer_id))) return Response.json({error:'Dealer access denied.'},{status:403});
  }
  if(body?.dealer_id && !ids.includes(Number(body.dealer_id))) return Response.json({error:'Dealer access denied.'},{status:403});
  if(!id && table!=='dealer' && !body?.dealer_id && (await columns(table)).has('dealer_id')) return Response.json({error:'dealer_id is required for salesman.'},{status:403});
  return null;
}
const DEALER_SCOPED_TABLES=new Set(['dealer','delivery_challan','tax_invoice','billing_customer','customer','vehicle','loan_workflow','old_rickshaw','old_rickshaw_challan','dealer_payment','day_book','purchase_bill','journal_stock','battery_register_entry','credit_note','cash_handover','dealer_cash_receipt']);
// Read-side dealer restriction (salesman): returns {sql,arg} fragment for generic GET so API cannot be used to read other dealers' rows.
async function dealerReadFilter(a:any,table:string,argsLen:number){
  if(!isSalesman(a)||!DEALER_SCOPED_TABLES.has(table)) return null;
  const ids=assignedDealerIds(a)||[]; const cols=await columns(table);
  const col=table==='dealer'?'id':cols.has('dealer_id')?'dealer_id':null; if(!col) return null;
  return {sql:'"'+col+'"=ANY($'+(argsLen+1)+'::bigint[])',arg:ids.length?ids:[-1]};
}
async function actionAllowed(a:any,moduleKey:string,action:string){
  if(a?.scope==='dealer') return true;
  if(a?.is_super_user || String(a?.department||'').toLowerCase()==='admin') return true;
  await ensureSecuritySchema();
  const segs=String(moduleKey||'').split('/').filter(Boolean),clean=segs.filter(x=>!/^\d+$/.test(x));
  const keys=[...new Set([moduleKey,clean.join('/'),clean.slice(0,2).join('/'),clean[0],moduleAlias(String(clean[0]||''))].filter(Boolean))];
  const r=await pool.query('SELECT module_key,can_view,can_create,can_edit,can_delete,can_approve FROM user_action_permission WHERE user_id=$1 AND module_key=ANY($2::text[])',[idOf(a?.sub),keys]);
  if(r.rowCount){const row=keys.map(k=>r.rows.find((x:any)=>x.module_key===k)).find(Boolean); return Boolean(row['can_'+action]);}
  const mods=Array.isArray(a?.allowed_modules)?a.allowed_modules.map((x:any)=>String(x)):String(a?.allowed_modules||'').split(',').map((x:string)=>x.trim()).filter(Boolean);
  const parts=String(moduleKey||'').split('/').filter(Boolean); const candidates=[moduleKey,...parts,...parts.map(moduleAlias),parts.at(-1),String(parts.at(-1)||'').replace(/s$/,'')].filter(Boolean);
  return candidates.some((x:any)=>mods.includes(x));
}

function billingStaff(a:any){
  return a?.scope==="staff" && (Boolean(a?.is_super_user) ||
    ["admin","billing","accounts","head office","head-office"].includes(String(a?.department||"").trim().toLowerCase()));
}
async function ensureDispatchSchema(){
  await pool.query("ALTER TABLE product ADD COLUMN IF NOT EXISTS product_category text");
  await pool.query("ALTER TABLE product ADD COLUMN IF NOT EXISTS show_on_delivery_challan boolean NOT NULL DEFAULT false");
  await pool.query("CREATE TABLE IF NOT EXISTS delivery_challan_item (id bigserial PRIMARY KEY, delivery_challan_id integer NOT NULL REFERENCES delivery_challan(id) ON DELETE CASCADE, product_id integer NOT NULL REFERENCES product(id), product_name text NOT NULL, qty numeric NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(delivery_challan_id, product_id))");
}
async function ensureBatteryRegisterSchema(){
  await pool.query("CREATE TABLE IF NOT EXISTS battery_register_entry (id bigserial PRIMARY KEY, date date NOT NULL DEFAULT CURRENT_DATE, battery_maker text NOT NULL, battery_no text, qty numeric NOT NULL DEFAULT 1, entry_type text NOT NULL, source_type text NOT NULL, source_id integer, source_no text, party_name text, dealer_id integer, vehicle_id integer, remarks text, created_at timestamptz NOT NULL DEFAULT now())");
  for(const [name,type] of [["date","date"],["battery_maker","text"],["battery_no","text"],["qty","numeric NOT NULL DEFAULT 1"],["entry_type","text"],["source_type","text"],["source_id","integer"],["source_no","text"],["party_name","text"],["dealer_id","integer"],["vehicle_id","integer"],["remarks","text"]]) await pool.query('ALTER TABLE battery_register_entry ADD COLUMN IF NOT EXISTS "'+name+'" '+type);
  await pool.query("CREATE INDEX IF NOT EXISTS battery_register_entry_maker_idx ON battery_register_entry (battery_maker)");
  await pool.query("CREATE INDEX IF NOT EXISTS battery_register_entry_no_idx ON battery_register_entry (battery_no)");
  await pool.query("CREATE INDEX IF NOT EXISTS battery_register_entry_source_idx ON battery_register_entry (source_type,source_id)");
}
async function ensureNotificationSchema(){
  await pool.query(`CREATE TABLE IF NOT EXISTS app_notification (
    id bigserial PRIMARY KEY,
    notification_type text NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    dealer_id integer,
    user_id text,
    reference_type text,
    reference_id bigint,
    dedupe_key text UNIQUE,
    is_read boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`);
  await pool.query("CREATE INDEX IF NOT EXISTS app_notification_unread_idx ON app_notification(is_read,created_at DESC)");
  await pool.query("CREATE INDEX IF NOT EXISTS app_notification_dealer_idx ON app_notification(dealer_id,created_at DESC)");
  await pool.query(`CREATE TABLE IF NOT EXISTS dealer_cash_limit (
    dealer_id integer PRIMARY KEY,
    cash_limit numeric NOT NULL DEFAULT 100000,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
}
async function ensureBatteryFitSchema(){
  await ensureBatteryRegisterSchema();
  await pool.query("ALTER TABLE delivery_challan ADD COLUMN IF NOT EXISTS battery_fit_date date");
  await pool.query("ALTER TABLE vehicle ADD COLUMN IF NOT EXISTS battery_fit_date date");
  await pool.query(`CREATE TABLE IF NOT EXISTS battery_fit_log (
    id bigserial PRIMARY KEY,
    fit_date date NOT NULL DEFAULT CURRENT_DATE,
    challan_id bigint NOT NULL,
    challan_no text,
    dealer_id integer,
    dealer_name text,
    vehicle_id bigint,
    chassis_no text,
    model_name text,
    battery_maker text,
    battery_no1 text,
    battery_no2 text,
    battery_no3 text,
    battery_no4 text,
    old_battery_maker text,
    old_battery_no1 text,
    old_battery_no2 text,
    old_battery_no3 text,
    old_battery_no4 text,
    reference_no text,
    remarks text,
    fitted_by text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`);
  await pool.query("CREATE INDEX IF NOT EXISTS battery_fit_log_challan_idx ON battery_fit_log(challan_id)");
  await pool.query("CREATE INDEX IF NOT EXISTS battery_fit_log_date_idx ON battery_fit_log(fit_date)");
}
async function ensureProductionVoucherSchema(){
  await pool.query("ALTER TABLE production_voucher ADD COLUMN IF NOT EXISTS formula_name text");
}
const NORM=(c:string)=>"lower(regexp_replace(btrim(COALESCE("+c+",'')),'\\s+',' ','g'))";
let _pfSchemaDone=false;
// production_formula.formula_name: column guarantee + blank/NULL rows get product name (same as UI rule "khali = product ka naam"),
// so formula name always shows and rename/save can match rows.
async function ensureProductionFormulaSchema(){
  if(_pfSchemaDone)return;
  await ensureProductionVoucherSchema();
  await pool.query("ALTER TABLE production_formula ADD COLUMN IF NOT EXISTS formula_name text");
  // 1) product_name in formula rows -> exact Product Master name (fixes stray spaces / case so Voucher & Checklist lookups match)
  await pool.query("UPDATE production_formula pf SET product_name=p.name FROM (SELECT DISTINCT ON ("+NORM("name")+") name,"+NORM("name")+" AS k FROM product ORDER BY "+NORM("name")+",id) p WHERE "+NORM("pf.product_name")+"=p.k AND pf.product_name<>p.name");
  await pool.query("UPDATE production_voucher pv SET product_name=p.name FROM (SELECT DISTINCT ON ("+NORM("name")+") name,"+NORM("name")+" AS k FROM product ORDER BY "+NORM("name")+",id) p WHERE "+NORM("pv.product_name")+"=p.k AND pv.product_name<>p.name");
  // 2) formula_name: trim; blank -> product name
  await pool.query("UPDATE production_formula SET formula_name=btrim(formula_name) WHERE formula_name IS NOT NULL AND formula_name<>btrim(formula_name)");
  await pool.query("UPDATE production_voucher SET formula_name=btrim(formula_name) WHERE formula_name IS NOT NULL AND formula_name<>btrim(formula_name)");
  await pool.query("UPDATE production_formula SET formula_name=product_name WHERE COALESCE(BTRIM(formula_name),'')='' AND COALESCE(product_name,'')<>''");
  await pool.query("UPDATE production_voucher v SET formula_name=v.product_name WHERE COALESCE(BTRIM(v.formula_name),'')='' AND EXISTS (SELECT 1 FROM production_formula f WHERE f.product_name=v.product_name) AND (SELECT COUNT(DISTINCT f.formula_name) FROM production_formula f WHERE f.product_name=v.product_name)=1");
  _pfSchemaDone=true;
}
async function ensureFactoryCheckSchema(){
  await pool.query("CREATE TABLE IF NOT EXISTS factory_check_report (id bigserial PRIMARY KEY, production_voucher_id integer NOT NULL UNIQUE, date date NOT NULL DEFAULT CURRENT_DATE, product_name text, quantity numeric NOT NULL DEFAULT 1, status text NOT NULL DEFAULT 'PENDING', approved_by text, approved_at timestamptz, remarks text, created_at timestamptz NOT NULL DEFAULT now())");
  await pool.query("CREATE TABLE IF NOT EXISTS factory_check_item (id bigserial PRIMARY KEY, report_id integer NOT NULL REFERENCES factory_check_report(id) ON DELETE CASCADE, raw_item_name text NOT NULL, expected_qty numeric NOT NULL DEFAULT 0, consumed_qty numeric NOT NULL DEFAULT 0, unit text, additional boolean NOT NULL DEFAULT false, status text NOT NULL DEFAULT 'PENDING', approved_by text, approved_at timestamptz, remarks text, created_at timestamptz NOT NULL DEFAULT now())");
  await pool.query("CREATE INDEX IF NOT EXISTS factory_check_item_report_idx ON factory_check_item(report_id)");
}
async function ensureDailyRawMaterialChecklistSchema(){
  await pool.query(`CREATE TABLE IF NOT EXISTS daily_raw_material_checklist (
    id bigserial PRIMARY KEY,
    date date NOT NULL UNIQUE,
    production_qty numeric NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'PENDING',
    verified_by text,
    verified_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS daily_raw_material_checklist_item (
    id bigserial PRIMARY KEY,
    checklist_id bigint NOT NULL REFERENCES daily_raw_material_checklist(id) ON DELETE CASCADE,
    source_key text NOT NULL,
    product_name text NOT NULL,
    formula_name text,
    production_qty numeric NOT NULL DEFAULT 0,
    raw_item_name text NOT NULL,
    formula_qty_per_unit numeric NOT NULL DEFAULT 0,
    required_qty numeric NOT NULL DEFAULT 0,
    issued_qty numeric NOT NULL DEFAULT 0,
    difference numeric NOT NULL DEFAULT 0,
    unit text NOT NULL DEFAULT 'PCS',
    formula_line_id bigint,
    verified boolean NOT NULL DEFAULT false,
    remarks text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS daily_raw_material_checklist_item_key_idx ON daily_raw_material_checklist_item(checklist_id,source_key)");
  await pool.query("CREATE INDEX IF NOT EXISTS daily_raw_material_checklist_date_idx ON daily_raw_material_checklist(date)");
}
async function ensureOldRickshawLegacySchema(){
  await pool.query(`CREATE TABLE IF NOT EXISTS old_rickshaw (
    id bigserial PRIMARY KEY,date date NOT NULL DEFAULT CURRENT_DATE,source text NOT NULL DEFAULT 'manual',
    record_no text,vou_no text,chfpl_ref_no text,party_name text,purchase_ref_no text,vehicle_reg_no text NOT NULL,
    model_name text,owner_name text,salesman text,purchase_amount numeric NOT NULL DEFAULT 0,file_charge numeric NOT NULL DEFAULT 0,
    battery_maker text,battery_no1 text,battery_no2 text,battery_no3 text,battery_no4 text,sp_no text,dealer_page_no text,
    dealer_id integer,dealer_name text,challan_no text,ledger_date date,sale_type text,do_number text,chassis_no text,
    charger text,mat text,jack text,centre_lock text,big_mirror text,colour text,toolkit text,stepney text,out_name text,
    remarks1 text,remarks2 text,status text NOT NULL DEFAULT 'available',customer_name text,sale_amount numeric NOT NULL DEFAULT 0,
    sold_amount numeric NOT NULL DEFAULT 0,loan_amount numeric NOT NULL DEFAULT 0,down_payment numeric NOT NULL DEFAULT 0,
    balance_amount numeric NOT NULL DEFAULT 0,sale_ref_no text,receipt_amount numeric NOT NULL DEFAULT 0,receipt_no text,
    ledger text,resale_date date,resale_ledger text,repo_date date,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  const defs:any={date:"date",source:"text",record_no:"text",vou_no:"text",chfpl_ref_no:"text",party_name:"text",purchase_ref_no:"text",
    vehicle_reg_no:"text",model_name:"text",owner_name:"text",salesman:"text",purchase_amount:"numeric NOT NULL DEFAULT 0",file_charge:"numeric NOT NULL DEFAULT 0",
    battery_maker:"text",battery_no1:"text",battery_no2:"text",battery_no3:"text",battery_no4:"text",sp_no:"text",dealer_page_no:"text",
    dealer_id:"integer",dealer_name:"text",challan_no:"text",ledger_date:"date",sale_type:"text",do_number:"text",chassis_no:"text",charger:"text",mat:"text",
    jack:"text",centre_lock:"text",big_mirror:"text",colour:"text",toolkit:"text",stepney:"text",out_name:"text",remarks1:"text",remarks2:"text",
    status:"text NOT NULL DEFAULT 'available'",customer_name:"text",sale_amount:"numeric NOT NULL DEFAULT 0",sold_amount:"numeric NOT NULL DEFAULT 0",
    loan_amount:"numeric NOT NULL DEFAULT 0",down_payment:"numeric NOT NULL DEFAULT 0",balance_amount:"numeric NOT NULL DEFAULT 0",sale_ref_no:"text",
    receipt_amount:"numeric NOT NULL DEFAULT 0",receipt_no:"text",ledger:"text",resale_date:"date",resale_ledger:"text",repo_date:"date"};
  for(const [col,type] of Object.entries(defs)) await pool.query('ALTER TABLE old_rickshaw ADD COLUMN IF NOT EXISTS "'+col+'" '+type);
}
async function ensureOldRickshawInventorySchema(){
  await pool.query(`CREATE TABLE IF NOT EXISTS old_rickshaw_inventory (
    id bigserial PRIMARY KEY,
    vehicle_no text NOT NULL,
    model_name text,
    battery_maker text,
    repo_date date,
    dealer_id integer,
    dealer_name text,
    status text NOT NULL DEFAULT 'hold',
    available_for_sale boolean NOT NULL DEFAULT false,
    sp_no text,
    challan_no text,
    challan_date date,
    old_rickshaw_id integer,
    customer_name text,
    sale_amount numeric NOT NULL DEFAULT 0,
    loan_amount numeric NOT NULL DEFAULT 0,
    balance_amount numeric NOT NULL DEFAULT 0,
    file_charge numeric NOT NULL DEFAULT 0,
    do_number text,
    ledger_no text,
    source text NOT NULL DEFAULT 'CHFPL',
    source_ref text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  const defs:any={
    vehicle_no:"text",model_name:"text",battery_maker:"text",repo_date:"date",dealer_id:"integer",dealer_name:"text",
    status:"text NOT NULL DEFAULT 'hold'",available_for_sale:"boolean NOT NULL DEFAULT false",sp_no:"text",challan_no:"text",
    challan_date:"date",old_rickshaw_id:"integer",customer_name:"text",sale_amount:"numeric NOT NULL DEFAULT 0",
    loan_amount:"numeric NOT NULL DEFAULT 0",balance_amount:"numeric NOT NULL DEFAULT 0",file_charge:"numeric NOT NULL DEFAULT 0",
    do_number:"text",ledger_no:"text",source:"text NOT NULL DEFAULT 'CHFPL'",source_ref:"text"
  };
  for(const [col,type] of Object.entries(defs)) await pool.query('ALTER TABLE old_rickshaw_inventory ADD COLUMN IF NOT EXISTS "'+col+'" '+type);
  await pool.query("CREATE INDEX IF NOT EXISTS old_rickshaw_inventory_status_idx ON old_rickshaw_inventory(status)");
  await pool.query("CREATE INDEX IF NOT EXISTS old_rickshaw_inventory_dealer_idx ON old_rickshaw_inventory(dealer_id)");
  await pool.query(`CREATE TABLE IF NOT EXISTS old_rickshaw_challan (
    id bigserial PRIMARY KEY,date date NOT NULL DEFAULT CURRENT_DATE,challan_no text UNIQUE,model_name text,vehicle_no text,colour text,toolkit text,
    dealer_id integer,source text NOT NULL DEFAULT 'CHFPL',source_ref text,status text NOT NULL DEFAULT 'ACTIVE',created_at timestamptz NOT NULL DEFAULT now()
  )`);
  const cdefs:any={date:"date",challan_no:"text",model_name:"text",vehicle_no:"text",colour:"text",toolkit:"text",dealer_id:"integer",source:"text NOT NULL DEFAULT 'CHFPL'",source_ref:"text",status:"text NOT NULL DEFAULT 'ACTIVE'"};
  for(const [col,type] of Object.entries(cdefs)) await pool.query('ALTER TABLE old_rickshaw_challan ADD COLUMN IF NOT EXISTS "'+col+'" '+type);
  const odefs:any={
    dealer_id:"integer",dealer_name:"text",challan_no:"text",sp_no:"text",challan_date:"date",customer_name:"text",
    sale_amount:"numeric NOT NULL DEFAULT 0",loan_amount:"numeric NOT NULL DEFAULT 0",balance_amount:"numeric NOT NULL DEFAULT 0",
    file_charge:"numeric NOT NULL DEFAULT 0",do_number:"text",ledger_no:"text",sale_date:"date"
  };
  for(const [col,type] of Object.entries(odefs)) await pool.query('ALTER TABLE old_rickshaw ADD COLUMN IF NOT EXISTS "'+col+'" '+type);
}
async function ensureCreditDebitSchema(){
  await pool.query(`CREATE TABLE IF NOT EXISTS credit_note (id bigserial PRIMARY KEY,date date NOT NULL DEFAULT CURRENT_DATE,credit_note_no text,tax_invoice_id integer,delivery_challan_id integer,original_bill_no text,dealer_name text,buyer_name text,chassis_no text,taxable_amount numeric NOT NULL DEFAULT 0,tax_amount numeric NOT NULL DEFAULT 0,total_amount numeric NOT NULL DEFAULT 0,reason text,remarks text,created_at timestamptz NOT NULL DEFAULT now())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS debit_note (id bigserial PRIMARY KEY,date date NOT NULL DEFAULT CURRENT_DATE,debit_note_no text,party_name text,party_gst_no text,party_state_code text,original_bill_no text,reason text,remarks text,taxable_amount numeric NOT NULL DEFAULT 0,tax_amount numeric NOT NULL DEFAULT 0,total_amount numeric NOT NULL DEFAULT 0,items jsonb NOT NULL DEFAULT '[]'::jsonb,created_at timestamptz NOT NULL DEFAULT now())`);
  const defs:any={credit_note:{credit_note_no:"text",tax_invoice_id:"integer",delivery_challan_id:"integer",original_bill_no:"text",dealer_name:"text",buyer_name:"text",chassis_no:"text",taxable_amount:"numeric NOT NULL DEFAULT 0",tax_amount:"numeric NOT NULL DEFAULT 0",total_amount:"numeric NOT NULL DEFAULT 0",reason:"text",remarks:"text"},debit_note:{debit_note_no:"text",party_name:"text",party_gst_no:"text",party_state_code:"text",original_bill_no:"text",reason:"text",remarks:"text",taxable_amount:"numeric NOT NULL DEFAULT 0",tax_amount:"numeric NOT NULL DEFAULT 0",total_amount:"numeric NOT NULL DEFAULT 0",items:"jsonb NOT NULL DEFAULT '[]'::jsonb"}};
  for(const table of Object.keys(defs)) for(const [col,type] of Object.entries(defs[table])) await pool.query('ALTER TABLE "'+table+'" ADD COLUMN IF NOT EXISTS "'+col+'" '+type);
}
// Dealer customer register helpers.
// - name: old imports keep it in full_name; new receipt bookings may only have it on the receipt.
// - status: nothing ever wrote BILLED on dealer_cash_customer, so it is derived from Tax Invoices
//   (old desktop-app bills) and from grd_billing_sale rows that reached BILLED (new flow).
const normReg=(v:any)=>String(v??"").toUpperCase().replace(/[^A-Z0-9]/g,"");
const normPhone=(v:any)=>String(v??"").replace(/\D/g,"").slice(-10);
async function enrichCashCustomers(rows:any[]):Promise<any[]>{
  if(!rows.length)return rows;
  const ids=rows.map((r:any)=>num(r.id)).filter(Boolean);
  const dealerIds=[...new Set(rows.map((r:any)=>num(r.dealer_id)).filter(Boolean))];
  const dn=await pool.query("SELECT id,lower(btrim(name)) AS n FROM dealer WHERE id = ANY($1::int[])",[dealerIds]);
  const dealerName=new Map<number,string>(dn.rows.map((x:any)=>[Number(x.id),String(x.n||"")]));
  const nameToId=new Map<string,number>(dn.rows.map((x:any)=>[String(x.n||""),Number(x.id)]));
  const [rc,inv,sale]=await Promise.all([
    pool.query("SELECT DISTINCT ON (customer_id) customer_id,customer_name,customer_phone FROM dealer_cash_receipt WHERE customer_id = ANY($1::bigint[]) AND COALESCE(btrim(customer_name),'')<>'' ORDER BY customer_id,id",[ids]),
    pool.query("SELECT ti.dealer_id,lower(btrim(ti.dealer_name)) AS dname,ti.buyer_name,to_jsonb(ti)->>'vehicle_reg_no' AS reg,to_jsonb(ti)->>'dealer_page_no' AS pg,to_jsonb(ti)->>'buyer_mobile' AS mobile FROM tax_invoice ti WHERE COALESCE(ti.cancelled,false)=false AND (ti.dealer_id = ANY($1::int[]) OR lower(btrim(ti.dealer_name)) = ANY($2::text[]))",[dealerIds,[...nameToId.keys()]]),
    pool.query("SELECT DISTINCT dealer_cash_customer_id AS id FROM grd_billing_sale WHERE status='BILLED' AND dealer_cash_customer_id = ANY($1::bigint[])",[ids])
  ]);
  const rcMap=new Map<number,any>(rc.rows.map((x:any)=>[Number(x.customer_id),x]));
  const saleSet=new Set<number>(sale.rows.map((x:any)=>Number(x.id)));
  const regs=new Map<number,Set<string>>(),pgs=new Map<number,Set<string>>(),blankByMobile=new Map<string,number>(),blankByName=new Map<string,number>();
  const normName=(v:any)=>String(v??"").toUpperCase().replace(/[^A-Z0-9 ]/g," ").replace(/\s+/g," ").trim();
  for(const x of inv.rows){
    const d=Number(x.dealer_id)||nameToId.get(String(x.dname||""))||0;
    // Bill made to the dealer itself (registered / out-of-Delhi dealers): not a customer sale, never matched.
    if(normName(x.buyer_name)&&normName(x.buyer_name)===normName(dealerName.get(d)))continue;
    const reg=normReg(x.reg),pg=String(x.pg||"").trim(),mb=normPhone(x.mobile),nm=normName(x.buyer_name);
    if(reg.length>=5){if(!regs.has(d))regs.set(d,new Set());regs.get(d)!.add(reg)}
    else if(mb.length===10){const k=d+"|"+mb;blankByMobile.set(k,(blankByMobile.get(k)||0)+1)} // bill without Vehicle No.
    else if(nm){const k=d+"|"+nm;blankByName.set(k,(blankByName.get(k)||0)+1)} // bill without Vehicle No. and mobile
    if(pg&&mb){if(!pgs.has(d))pgs.set(d,new Set());pgs.get(d)!.add(pg+"|"+mb)}
  }
  // Fallback for old bills that have no Vehicle No.: one such bill marks one (oldest) imported customer
  // of that dealer+mobile as billed. Fresh bookings (vehicle_no 'new'/'old') are never matched this way.
  const fallbackBilled=new Set<number>();
  for(const r of [...rows].sort((x:any,y:any)=>Number(x.id)-Number(y.id))){
    const d=Number(r.dealer_id),reg=normReg(r.vehicle_no),cur=String(r.status||"").toUpperCase();
    if(cur==="DEALER_CANCEL"||saleSet.has(Number(r.id))||reg==="NEW"||reg==="OLD")continue;
    if(reg.length>=5&&regs.get(d)?.has(reg))continue;
    const rr=rcMap.get(Number(r.id));
    const k=d+"|"+normPhone(String(r.phone||r.customer_phone||rr?.customer_phone||""));
    const left=blankByMobile.get(k)||0;
    if(left>0){blankByMobile.set(k,left-1);fallbackBilled.add(Number(r.id));continue}
    // Old sales with neither Vehicle No. nor mobile: register name is 'NAME 1103' (name + serial), the bill has just 'NAME'.
    const full=normName(r.name||r.full_name||rr?.customer_name),stripped=full.replace(/\s+\d+$/,"").trim();
    for(const cand of [full,stripped]){
      const nk=d+"|"+cand,nl=cand?blankByName.get(nk)||0:0;
      if(nl>0){blankByName.set(nk,nl-1);fallbackBilled.add(Number(r.id));break}
    }
  }
  return rows.map((r:any)=>{
    const rr=rcMap.get(Number(r.id));
    const name=String(r.name||"").trim()||String(r.full_name||"").trim()||String(rr?.customer_name||"").trim();
    const phone=String(r.phone||"").trim()||String(r.customer_phone||"").trim()||String(rr?.customer_phone||"").trim();
    const d=Number(r.dealer_id),reg=normReg(r.vehicle_no),pg=String(r.page_no||"").trim();
    const billed=saleSet.has(Number(r.id))||fallbackBilled.has(Number(r.id))||(reg.length>=5&&regs.get(d)?.has(reg))||(pg&&pgs.get(d)?.has(pg+"|"+normPhone(phone)));
    const cur=String(r.status||"").trim().toUpperCase();
    const status=cur==="DEALER_CANCEL"?cur:(billed?"BILLED":(cur||"VEHICLE_PENDING"));
    return {...r,name,phone,status,balance:Math.max(0,Number(r.sale_amount||0)-Number(r.loan_amount||0)-Number(r.paid_amount||0))};
  });
}
let dealerCashSchemaReady:Promise<void>|null=null;
function ensureDealerCashSchema():Promise<void>{
  if(!dealerCashSchemaReady){
    dealerCashSchemaReady=ensureDealerCashSchemaOnce().catch((e:any)=>{dealerCashSchemaReady=null;throw e});
  }
  return dealerCashSchemaReady;
}
// Dealer ke haath me cash = cash receipts - expenses - ACCEPTED handovers. Pending handover abhi dealer ke paas hi maana jata hai.
async function dealerCashPosition(did:number,client:any=pool){
  const r=await client.query("SELECT (SELECT COALESCE(SUM(amount),0) FROM dealer_cash_receipt WHERE dealer_id=$1 AND lower(COALESCE(payment_mode,'cash'))='cash') AS rc,(SELECT COALESCE(SUM(amount),0) FROM dealer_cash_expense WHERE dealer_id=$1) AS ex,(SELECT COALESCE(SUM(amount),0) FROM dealer_cash_handover WHERE dealer_id=$1 AND lower(COALESCE(status,'pending'))='accepted') AS acc,(SELECT COALESCE(SUM(amount),0) FROM dealer_cash_handover WHERE dealer_id=$1 AND lower(COALESCE(status,'pending'))='pending') AS pend",[did]);
  const x=r.rows[0]||{},cash=num(x.rc)-num(x.ex)-num(x.acc),pending=num(x.pend);
  return {cash_received:num(x.rc),expenses:num(x.ex),ho_handover:num(x.acc),pending_handover:pending,cash_at_dealer:cash,available_for_handover:cash-pending};
}
// Showroom / branch ke shop expense dealer ledger me CREDIT ban ke aate hain: dealer ne HO ke hisaab ka cash kharch kiya,
// isliye HO ko dena wala balance utna kam hota hai. Ye sirf ledger view hai - admin Day Book / cash me koi entry nahi banti.
function shopExpenseLedgerEvents(rows:any[]){
  return rows.filter((x:any)=>String(x.status||"ACTIVE").toUpperCase()==="ACTIVE"&&num(x.amount)>0).map((x:any)=>{
    const label=String(x.category_label||x.category||"Shop Expense").trim();
    const narration="Shop Expense - "+label+(x.paid_to?" - "+x.paid_to:"")+(x.remarks?" ("+x.remarks+")":"");
    return {record_type:"shop_expense",record_id:x.id,date:x.date,doc_no:x.expense_no||"",account:"Shop Expense",narration,lines:[narration],debit:0,credit:num(x.amount),vr_type:"E"};
  });
}
async function ensureDealerCashSchemaOnce(){
  await pool.query("CREATE TABLE IF NOT EXISTS dealer_cash_customer (id bigserial PRIMARY KEY,dealer_id integer NOT NULL,name text NOT NULL,phone text,customer_phone text,page_no text,vehicle_no text,sale_amount numeric NOT NULL DEFAULT 0,loan_amount numeric NOT NULL DEFAULT 0,paid_amount numeric NOT NULL DEFAULT 0,status text NOT NULL DEFAULT 'VEHICLE_PENDING',date date NOT NULL DEFAULT CURRENT_DATE,created_at timestamptz NOT NULL DEFAULT now())");
  await pool.query("CREATE TABLE IF NOT EXISTS dealer_cash_receipt (id bigserial PRIMARY KEY,dealer_id integer NOT NULL,customer_id bigint,date date NOT NULL DEFAULT CURRENT_DATE,receipt_type text,payment_mode text NOT NULL DEFAULT 'cash',receipt_no text,customer_name text,customer_phone text,dealer_register_page_no text,sale_amount numeric NOT NULL DEFAULT 0,loan_amount numeric NOT NULL DEFAULT 0,amount numeric NOT NULL DEFAULT 0,reference_no text,remarks text,request_id text,created_at timestamptz NOT NULL DEFAULT now())");
  await pool.query("CREATE TABLE IF NOT EXISTS dealer_cash_expense (id bigserial PRIMARY KEY,dealer_id integer NOT NULL,date date NOT NULL DEFAULT CURRENT_DATE,expense_no text,category text,category_label text,amount numeric NOT NULL DEFAULT 0,paid_to text,remarks text,folio text,status text NOT NULL DEFAULT 'ACTIVE',created_at timestamptz NOT NULL DEFAULT now())");
  await pool.query("CREATE TABLE IF NOT EXISTS dealer_cash_handover (id bigserial PRIMARY KEY,dealer_id integer NOT NULL,date date NOT NULL DEFAULT CURRENT_DATE,handover_no text,amount numeric NOT NULL DEFAULT 0,sent_to text,remarks text,folio text,status text NOT NULL DEFAULT 'pending',created_at timestamptz NOT NULL DEFAULT now())");
  const defs:any={
    // Older DBs already have dealer_cash_customer without these columns (CREATE TABLE IF NOT EXISTS skips them).
    dealer_cash_customer:{dealer_id:"integer",name:"text",full_name:"text",phone:"text",customer_phone:"text",page_no:"text",vehicle_no:"text",sale_amount:"numeric NOT NULL DEFAULT 0",loan_amount:"numeric NOT NULL DEFAULT 0",paid_amount:"numeric NOT NULL DEFAULT 0",status:"text NOT NULL DEFAULT 'VEHICLE_PENDING'",date:"date",created_at:"timestamptz NOT NULL DEFAULT now()"},
    dealer_cash_receipt:{dealer_id:"integer",customer_id:"bigint",date:"date NOT NULL DEFAULT CURRENT_DATE",receipt_date:"date",receipt_type:"text",payment_mode:"text NOT NULL DEFAULT 'cash'",receipt_no:"text",customer_name:"text",customer_phone:"text",dealer_register_page_no:"text",sale_amount:"numeric NOT NULL DEFAULT 0",loan_amount:"numeric NOT NULL DEFAULT 0",amount:"numeric NOT NULL DEFAULT 0",reference_no:"text",remarks:"text",request_id:"text"},
    dealer_cash_expense:{dealer_id:"integer",date:"date",expense_date:"date",expense_no:"text",category:"text",category_label:"text",amount:"numeric NOT NULL DEFAULT 0",paid_to:"text",remarks:"text",folio:"text",status:"text NOT NULL DEFAULT 'ACTIVE'"},
    dealer_cash_handover:{dealer_id:"integer",date:"date",handover_date:"date",handover_no:"text",amount:"numeric NOT NULL DEFAULT 0",sent_to:"text",remarks:"text",folio:"text",status:"text NOT NULL DEFAULT 'pending'",accepted_at:"timestamptz",accepted_by:"text",reject_reason:"text",day_book_id:"bigint"}
  };
  for(const table of Object.keys(defs)) for(const [col,type] of Object.entries(defs[table]))
    await pool.query('ALTER TABLE "'+table+'" ADD COLUMN IF NOT EXISTS "'+col+'" '+type);
  // Backfill once: old imports store the name in full_name; receipt bookings may only have it on the receipt.
  await pool.query("UPDATE dealer_cash_customer SET name=btrim(full_name) WHERE COALESCE(btrim(name),'')='' AND COALESCE(btrim(full_name),'')<>''");
  await pool.query("UPDATE dealer_cash_customer SET phone=btrim(customer_phone) WHERE COALESCE(btrim(phone),'')='' AND COALESCE(btrim(customer_phone),'')<>''");
  await pool.query("UPDATE dealer_cash_customer c SET name=r.customer_name FROM (SELECT DISTINCT ON (customer_id) customer_id,btrim(customer_name) AS customer_name FROM dealer_cash_receipt WHERE customer_id IS NOT NULL AND COALESCE(btrim(customer_name),'')<>'' ORDER BY customer_id,id) r WHERE r.customer_id=c.id AND COALESCE(btrim(c.name),'')=''");
  await pool.query("UPDATE dealer_cash_receipt SET date=COALESCE(receipt_date,date,CURRENT_DATE)");
  await pool.query("UPDATE dealer_cash_receipt SET receipt_date=COALESCE(receipt_date,date,CURRENT_DATE)");
  await pool.query("UPDATE dealer_cash_expense SET date=COALESCE(date,expense_date,CURRENT_DATE) WHERE date IS NULL");
  await pool.query("UPDATE dealer_cash_expense SET expense_date=COALESCE(expense_date,date,CURRENT_DATE) WHERE expense_date IS NULL");
  // Purani DB me handover_date NOT NULL hoti hai; date aur handover_date dono ko sync rakho.
  await pool.query("UPDATE dealer_cash_handover SET date=COALESCE(date,handover_date,CURRENT_DATE) WHERE date IS NULL");
  await pool.query("UPDATE dealer_cash_handover SET handover_date=COALESCE(handover_date,date,CURRENT_DATE) WHERE handover_date IS NULL");
}

async function ensureRepairSchema(){
  await pool.query(`CREATE TABLE IF NOT EXISTS repair_service_voucher (id bigserial PRIMARY KEY,voucher_no text,date date NOT NULL DEFAULT CURRENT_DATE,vehicle_id integer,vehicle_no text,chassis_no text,customer_name text,customer_mobile text,items jsonb NOT NULL DEFAULT '[]'::jsonb,total_amount numeric NOT NULL DEFAULT 0,paid_amount numeric NOT NULL DEFAULT 0,balance_amount numeric NOT NULL DEFAULT 0,gst_amount numeric NOT NULL DEFAULT 0,remarks text,created_at timestamptz NOT NULL DEFAULT now())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS repair_service_payment_receipt (id bigserial PRIMARY KEY,receipt_no text,voucher_id integer REFERENCES repair_service_voucher(id) ON DELETE CASCADE,date date NOT NULL DEFAULT CURRENT_DATE,amount numeric NOT NULL DEFAULT 0,payment_mode text,reference_no text,remarks text,created_at timestamptz NOT NULL DEFAULT now())`);
  const defs:any={repair_service_voucher:{voucher_no:"text",vehicle_id:"integer",vehicle_no:"text",chassis_no:"text",customer_name:"text",customer_mobile:"text",items:"jsonb NOT NULL DEFAULT '[]'::jsonb",total_amount:"numeric NOT NULL DEFAULT 0",paid_amount:"numeric NOT NULL DEFAULT 0",balance_amount:"numeric NOT NULL DEFAULT 0",gst_amount:"numeric NOT NULL DEFAULT 0",remarks:"text",dealer_id:"integer",dealer_name:"text"},repair_service_payment_receipt:{receipt_no:"text",voucher_id:"integer",date:"date",amount:"numeric NOT NULL DEFAULT 0",payment_mode:"text",reference_no:"text",remarks:"text",dealer_id:"integer",dealer_name:"text",cash_receipt_id:"bigint"}};
  for(const table of Object.keys(defs)) for(const [col,type] of Object.entries(defs[table])) await pool.query('ALTER TABLE "'+table+'" ADD COLUMN IF NOT EXISTS "'+col+'" '+type);
}
// ---------------- Repair cash receipt: right dealer-wise (portal_modules me "repair-receipt") ----------------
const REPAIR_RECEIPT_MODULE="repair-receipt";
const MODS_SQL="string_to_array(regexp_replace(COALESCE(portal_modules::text,''),'[{}\" ]','','g'),',')";
async function ensureRepairRightLogSchema(){
  await pool.query("CREATE TABLE IF NOT EXISTS repair_receipt_right_log (id bigserial PRIMARY KEY,dealer_id integer,dealer_name text,action text,changed_by text,changed_at timestamptz NOT NULL DEFAULT now())");
}
// JWT 12h chalta hai, isliye right hamesha DB se check hota hai (revoke turant lagu ho).
async function dealerHasRepairReceiptRight(dealerId:number){
  const r=await pool.query("SELECT 1 FROM dealer WHERE id=$1 AND COALESCE(blocked,false)=false AND $2 = ANY("+MODS_SQL+")",[dealerId,REPAIR_RECEIPT_MODULE]);
  return Boolean(r.rowCount);
}
// Dealer save par: right kitne bhi dealers ko diya ja sakta hai; sirf grant/revoke ka audit log banta hai.
async function guardRepairReceiptRight(a:any,method:string,id:number|null,input:any):Promise<Response|null>{
  if(method==="DELETE"||!input||!Object.prototype.hasOwnProperty.call(input,"portal_modules"))return null;
  const list=(Array.isArray(input.portal_modules)?input.portal_modules:String(input.portal_modules||"").split(",")).map((x:any)=>String(x).trim());
  const want=list.includes(REPAIR_RECEIPT_MODULE);
  let had=false,name:string|null=input.name||null;
  if(id){const r=await pool.query("SELECT name,$2 = ANY("+MODS_SQL+") AS has FROM dealer WHERE id=$1",[id,REPAIR_RECEIPT_MODULE]);had=Boolean(r.rows[0]?.has);name=r.rows[0]?.name||name;}
  if(want===had)return null;
  try{
    await ensureRepairRightLogSchema();
    await pool.query("INSERT INTO repair_receipt_right_log (dealer_id,dealer_name,action,changed_by) VALUES ($1,$2,$3,$4)",[id,name,want?"granted":"revoked",String(a?.username||a?.sub||"")]);
  }catch(e){console.error("[repair right log]",e)}
  return null;
}
// Repair voucher par payment receipt. Cash collector dealer ke cashbook (dealer_cash_receipt) me jata hai, wahi se Head Office handover hota hai.
async function createRepairReceipt(voucherId:number,b:any,branchId:number){
  await ensureRepairSchema();await ensureDealerCashSchema();
  const amount=Number(b.amount||0);if(!voucherId||!(amount>0))throw new Error("Valid voucher and receipt amount are required.");
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const v=await client.query("SELECT * FROM repair_service_voucher WHERE id=$1 FOR UPDATE",[voucherId]);if(!v.rowCount)throw new Error("Repair / Service Voucher not found.");
    const vr=v.rows[0],total=Number(vr.total_amount||0),paid0=Number(vr.paid_amount||0),outstanding=Math.round((total-paid0)*100)/100;
    if(outstanding<=0)throw new Error("Is voucher ka payment pehle hi poora ho chuka hai.");
    if(amount>outstanding+0.005)throw new Error("Receipt amount balance se zyada nahi ho sakta. Outstanding balance: ₹"+outstanding+".");
    const br=await client.query("SELECT id,name FROM dealer WHERE id=$1",[branchId]);if(!br.rowCount)throw new Error("Dealer not found.");
    const paid=paid0+amount,balance=Math.max(0,Math.round((total-paid)*100)/100),no="RCP-"+new Date().toISOString().slice(0,10).replace(/-/g,"")+"-"+String(Date.now()).slice(-5);
    const mode=String(b.payment_mode||"cash").toLowerCase(),date=b.date||null,custName=String(vr.customer_name||"").trim()||"-";
    const rcCols=await columns("dealer_cash_receipt"),cin:any={dealer_id:branchId,date,receipt_date:date,receipt_type:"repair_service",payment_mode:mode,receipt_no:no,customer_name:custName,customer_phone:vr.customer_mobile||null,amount,reference_no:b.reference_no||null,remarks:("Repair/Service "+(vr.voucher_no||"")+" · "+(vr.vehicle_no||"")+(b.remarks?" · "+b.remarks:"")).trim()};
    const ck=Object.keys(cin).filter(k=>rcCols.has(k)&&cin[k]!==undefined);
    const cr=await client.query('INSERT INTO dealer_cash_receipt ('+ck.map(k=>'"'+k+'"').join(",")+') VALUES ('+ck.map((_,i)=>"$"+(i+1)).join(",")+') RETURNING id',ck.map(k=>cin[k]));
    const rpCols=await columns("repair_service_payment_receipt"),rin:any={receipt_no:no,voucher_id:voucherId,date,amount,payment_mode:mode,reference_no:b.reference_no||null,remarks:b.remarks||null,customer_name:custName,customer_mobile:vr.customer_mobile||null,vehicle_no:vr.vehicle_no||null,dealer_id:branchId,dealer_name:br.rows[0].name,cash_receipt_id:cr.rows[0].id};
    const rk=Object.keys(rin).filter(k=>rpCols.has(k));
    const rr=await client.query('INSERT INTO repair_service_payment_receipt ('+rk.map(k=>'"'+k+'"').join(",")+') VALUES ('+rk.map((k,i)=>k==="date"?"COALESCE($"+(i+1)+"::date,CURRENT_DATE)":"$"+(i+1)).join(",")+') RETURNING *',rk.map(k=>rin[k]));
    await client.query("UPDATE repair_service_voucher SET paid_amount=$1,balance_amount=$2 WHERE id=$3",[paid,balance,voucherId]);
    await client.query("COMMIT");return rr.rows[0];
  }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
}
function parseItems(v:any){if(Array.isArray(v))return v;if(typeof v==="string"){try{const x=JSON.parse(v);return Array.isArray(x)?x:[]}catch{return []}}return []}
let purchaseExtraReady:Promise<void>|null=null;
async function ensurePurchaseExtraSchema(){
  if(!purchaseExtraReady)purchaseExtraReady=pool.query("ALTER TABLE purchase_bill ADD COLUMN IF NOT EXISTS extra_charges text").then(()=>{}).catch((e:any)=>{purchaseExtraReady=null;throw e});
  await purchaseExtraReady;
}
function parseExtraCharges(v:any){let x:any=v;if(typeof v==="string"){try{x=JSON.parse(v||"[]")}catch{x=[]}}return Array.isArray(x)?x.map((e:any)=>({account_head:String(e?.account_head||"").trim(),amount:Number(e?.amount)||0,gst_rate:Number(e?.gst_rate)||0})).filter((e:any)=>e.account_head&&e.amount!==0):[]}
function purchaseExtraTotal(v:any){return parseExtraCharges(v).reduce((s:number,e:any)=>s+e.amount+e.amount*e.gst_rate/100,0)}
function purchaseLegacyNum(row:any, patterns:RegExp[], exclude:RegExp[]=[]){
  for(const [k,v] of Object.entries(row||{})){
    const key=String(k).toLowerCase();
    if(exclude.some(rx=>rx.test(key)))continue;
    if(!patterns.some(rx=>rx.test(key)))continue;
    if(v===null||v===undefined||v==='')continue;
    const n0=Number(v);
    if(Number.isFinite(n0)&&n0!==0)return n0;
  }
  return 0;
}

function purchaseBatteryItems(items:any[]){return parseItems(items).filter((x:any)=>Boolean(x?.is_battery)||String(x?.item_type||"").toLowerCase()==="battery"||String(x?.battery_maker||"").trim()!=="").map((x:any)=>({battery_maker:String(x.battery_maker||"").trim(),qty:Math.max(0,Math.trunc(num(x.qty)))})).filter((x:any)=>x.battery_maker&&x.qty>0)}
async function syncBatteryPurchaseBill(client:any,bill:any){
  await ensureBatteryRegisterSchema();await client.query("DELETE FROM battery_register_entry WHERE source_type='PURCHASE' AND source_id=$1",[bill.id]);
  for(const item of purchaseBatteryItems(bill.items)) await client.query("INSERT INTO battery_register_entry (date,battery_maker,battery_no,qty,entry_type,source_type,source_id,source_no,party_name,remarks) VALUES (COALESCE($1::date,CURRENT_DATE),$2,NULL,$3,'IN','PURCHASE',$4,$5,$6,$7)",[bill.date||null,item.battery_maker,item.qty,bill.id,bill.bill_no||null,bill.party_name||null,"Battery Purchase"]);
}
// Purchase Bill ke Raw/Dispatch items ko journal_stock me IN entry banata hai (Closing Stock Raw + Repair/Production stock check isi se chalte hain).
async function syncRawPurchaseStock(client:any,bill:any,remove=false){
  const ref="PB-"+bill.id;
  await client.query("DELETE FROM journal_stock WHERE reason='Purchase' AND batch_ref=$1",[ref]);
  if(remove)return;
  for(const it of parseItems(bill.items)){
    if(Boolean(it?.is_battery)||String(it?.item_type||"").toLowerCase()==="battery")continue;
    const name=String(it?.item_name||"").trim(),qty=num(it?.qty);if(!name||qty<=0)continue;
    const pr=await client.query("SELECT name,product_category,fro FROM product WHERE lower(trim(name))=lower(trim($1)) LIMIT 1",[name]);if(!pr.rowCount)continue;
    const isDispatch=String(pr.rows[0].product_category||"").toUpperCase()==="DISPATCH";
    await client.query("INSERT INTO journal_stock (vou_no,date,item_name,item_type,qty,reason,created_at,work_type,batch_ref) VALUES ($1,COALESCE($2::date,CURRENT_DATE),$3,$4,$5,'Purchase',NOW(),'IN',$6)",[String(bill.bill_no||ref),ymd(bill.date)||null,pr.rows[0].name,isDispatch?"DISPATCH":"RAW",qty,ref]);
  }
}
async function toggleBatteryRegisterForDelivery(client:any,dc:any,cancelled:boolean){
  await ensureBatteryRegisterSchema();const vr=dc.vehicle_id?await client.query("SELECT battery_maker,battery_no1,battery_no2,battery_no3,battery_no4 FROM vehicle WHERE id=$1 FOR UPDATE",[dc.vehicle_id]):{rows:[]};
  const maker=String(vr.rows[0]?.battery_maker||"").trim(),nums=[1,2,3,4].map(i=>String(vr.rows[0]?.["battery_no"+i]||"").trim()).filter(Boolean);if(!maker||!nums.length)return;
  const entryType=cancelled?"IN":"OUT",sourceType=cancelled?"DELIVERY_CHALLAN_CANCEL":"DELIVERY_CHALLAN";
  for(const no of nums) await client.query("INSERT INTO battery_register_entry (date,battery_maker,battery_no,qty,entry_type,source_type,source_id,source_no,party_name,dealer_id,vehicle_id,remarks) VALUES (COALESCE($1::date,CURRENT_DATE),$2,$3,1,$4,$5,$6,$7,$8,$9,$10,$11)",[dc.date||null,maker,no,entryType,sourceType,dc.id,dc.challan_no||null,dc.dealer_name||null,dc.dealer_id||null,dc.vehicle_id||null,cancelled?"Delivery Challan Cancel":"Battery Issue on Delivery Challan"]);
}
async function assertBatterySerialsAvailable(client:any,maker:string,numbers:string[]){
  const clean=numbers.map(x=>String(x||"").trim()).filter(Boolean);if(!clean.length)return;if(new Set(clean.map(x=>x.toUpperCase())).size!==clean.length)throw new Error("Duplicate battery number entered in the same Delivery Challan.");
  await ensureBatteryRegisterSchema();const stock=await client.query("SELECT COALESCE(SUM(CASE WHEN entry_type='IN' THEN qty ELSE -qty END),0) AS balance FROM battery_register_entry WHERE upper(trim(battery_maker))=upper(trim($1))",[maker]);
  // Battery minus allowed (purchase qty may be entered later than challan) - no stock-insufficient block here.
  for(const no of clean){const used=await client.query("SELECT COALESCE(SUM(CASE WHEN entry_type='IN' THEN qty ELSE -qty END),0) AS balance FROM battery_register_entry WHERE upper(trim(battery_maker))=upper(trim($1)) AND upper(trim(COALESCE(battery_no,'')))=upper(trim($2))",[maker,no]);if(Number(used.rows[0]?.balance||0)<0)throw new Error("Battery No. "+no+" is already in use.");}
}

async function ensureHRSchemas(){
  await pool.query("CREATE TABLE IF NOT EXISTS hr_employee (id bigserial PRIMARY KEY, employee_code text NOT NULL UNIQUE, name text NOT NULL, department text, designation text, mobile text, photo_url text, joining_date date, machine_user_id text, basic_salary numeric NOT NULL DEFAULT 0, hra numeric NOT NULL DEFAULT 0, other_allowance numeric NOT NULL DEFAULT 0, overtime_rate numeric NOT NULL DEFAULT 0, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now())");
  await pool.query("CREATE TABLE IF NOT EXISTS hr_attendance (id bigserial PRIMARY KEY, employee_id bigint NOT NULL REFERENCES hr_employee(id) ON DELETE CASCADE, work_date date NOT NULL, first_in timestamptz, last_out timestamptz, status text NOT NULL DEFAULT 'Present', work_hours numeric NOT NULL DEFAULT 0, overtime_hours numeric NOT NULL DEFAULT 0, UNIQUE(employee_id,work_date))");
  await pool.query("CREATE TABLE IF NOT EXISTS hr_salary (id bigserial PRIMARY KEY, employee_id bigint NOT NULL REFERENCES hr_employee(id) ON DELETE CASCADE, salary_month text NOT NULL, working_days numeric NOT NULL DEFAULT 0, present_days numeric NOT NULL DEFAULT 0, overtime_hours numeric NOT NULL DEFAULT 0, basic_earned numeric NOT NULL DEFAULT 0, allowances numeric NOT NULL DEFAULT 0, overtime_amount numeric NOT NULL DEFAULT 0, net_salary numeric NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'PROCESSED', UNIQUE(employee_id,salary_month))");
}
async function genericGet(req:Request,path:string[],table:string){
  const cols=await columns(table);
  if(!cols.size)return Response.json({error:"Table not found",table},{status:404});
  const id=idOf(path[path.length-1]);
  let sql='SELECT * FROM "'+table+'"',args:any[]=[];
  const whereAll:string[]=[];
  if(table==="simple_master" && path[0]==="masters" && path[1]){args.push(path[1]);whereAll.push('kind=$1');}
  else if(id&&/^\d+$/.test(path[path.length-1]||"")){whereAll.push("id=$1");args=[id]}
  else{
    const u=new URL(req.url);
    for(const [k,v] of u.searchParams.entries()){
      const c=snake(k);
      if(cols.has(c)&&c!=="id"){args.push(v);whereAll.push('"'+c+'"=$'+args.length);}
    }
  }
  const drf=await dealerReadFilter(auth(req),table,args.length); if(drf){args.push(drf.arg);whereAll.push(drf.sql);}
  if(whereAll.length)sql+=" WHERE "+whereAll.join(" AND ");

  sql+=table==="day_book"?" ORDER BY date DESC, id DESC LIMIT 20000":" ORDER BY id DESC LIMIT 1000";
  const r=await pool.query(sql,args);
  let dayBookExtra:any={};
  if(table==="day_book"){
    const nums=r.rows.map((x:any)=>Number(x.vr_no)).filter((n:number)=>Number.isFinite(n));
    dayBookExtra={entries:r.rows,next_vr_no:(nums.length?Math.max(...nums):0)+1};
  }
  return Response.json({rows:r.rows,data:r.rows,items:r.rows,count:r.rowCount,...dayBookExtra,
    ...(table==="dealer"?{dealers:r.rows}:{}),
    ...(table==="customer"?{customers:r.rows}:{}),
    ...(table==="loan_workflow"?{applications:r.rows}:{}),
    ...(table==="simple_master"?{masters:r.rows}:{}),
    ...(table==="vehicle"?{vehicles:r.rows}:{}),
    ...(table==="tax_invoice"?{invoices:r.rows}:{} )
  });
}
function isAdmin(a:any){
  return a?.scope==="staff" && (Boolean(a?.is_super_user) || String(a?.department||"").trim().toLowerCase()==="admin");
}
function canRead(a:any,p:string){
  // Dealers may only read their explicitly scoped portal endpoints.
  if(a?.scope==="dealer") return p.startsWith("dealer/") || p==="auth/me" || p==="billing/pending-sales/options" || p==="notifications";
  if(p==="notifications") {
    return a?.scope==="staff" && (Boolean(a?.is_super_user) || ["admin","accounts","finance"].includes(String(a?.department||"").trim().toLowerCase()));
  }
  return true;
}
// Dealer battery portal writes are explicitly gated by the module flags
// carried in the dealer JWT. This restores the legacy portal behaviour without
// opening generic staff/master CRUD to dealer tokens.
const DEALER_WRITE_MODULE:any={
  "battery-swap-vouchers":"battery-swap",
  "battery-withdrawal":"battery-withdrawal",
  "battery-addition":"battery-addition"
};
function canWrite(a:any,p:string){
  // Dealer tokens are never allowed to use generic CRUD against staff/master tables.
  if(a?.scope==="dealer"){
    if(p==="billing/pending-sales/create")return true;
    if(p==="dealer/submit-loan")return true;
    if(p==="dealer/delivery-challans" || p.startsWith("dealer/delivery-challans/"))return true;
    if(p==="dealer/repair-receipts")return true;
    if(p.startsWith("dealer/cash-book/"))return true;
    if(p.startsWith("dealer/pending-sales/"))return true;
    if(/^dealer\/tax-invoices\/\d+$/.test(p))return true;
    const need=DEALER_WRITE_MODULE[p];
    if(!need)return false;
    const mods=Array.isArray(a?.portal_modules)
      ? a.portal_modules.map((x:any)=>String(x))
      : String(a?.portal_modules||"").split(",").map((x:string)=>x.trim()).filter(Boolean);
    return mods.includes(need);
  }
  // Billing staff may operate the Pending Sales approval/invoice workflow.
  if(p.startsWith("billing/pending-sales") && billingStaff(a)) return true;
  // Admins retain full mutation access.
  if(isAdmin(a)) return true;
  // Non-admin staff can mutate only modules explicitly granted in allowed_modules.
  const mods=Array.isArray(a?.allowed_modules)?a.allowed_modules.map((x:any)=>String(x)):String(a?.allowed_modules||"").split(",").map((x:string)=>x.trim()).filter(Boolean);
  const key=p.startsWith("masters/") ? p : p.split("/")[0];
  if(p==="challan-shift")return mods.includes("challan-shift") || mods.includes("delivery-challan");
  if(p==="battery-fit")return mods.includes("battery-fit") || mods.includes("battery-addition") || mods.includes("delivery-challan");
  if(p==="notifications/read" || p==="notifications/cash-limit")return true;
  return mods.includes(p) || mods.includes(key) || mods.includes(moduleAlias(key));
}
// User Master save. Frontend posts /users for BOTH add and edit (edit sends id). The generic writer always INSERTed and dropped
// "password" (column is password_hash), so editing an existing username hit the unique constraint -> 500.
async function saveUserRecord(b:any):Promise<Response>{
  const cols=await columns("user"),t=(v:any)=>String(v??"").trim(),id=idOf(b.id),username=t(b.username);
  if(!username)return Response.json({error:"Login ID / Username is required."},{status:400});
  const dup=await pool.query('SELECT id FROM "user" WHERE lower(btrim(username))=lower($1) AND ($2::int IS NULL OR id<>$2::int) LIMIT 1',[username,id]);
  if(dup.rowCount)return Response.json({error:"Username '"+username+"' already exists."},{status:400});
  const f:any={username};
  if(cols.has("department"))f.department=t(b.department)||"Admin";
  if(cols.has("is_super_user"))f.is_super_user=b.is_super_user===true||b.is_super_user==="true"||b.is_super_user===1;
  if(cols.has("salesman_name")&&b.salesman_name!==undefined)f.salesman_name=t(b.salesman_name)||null;
  if(cols.has("assigned_dealer_ids")&&b.assigned_dealer_ids!==undefined)f.assigned_dealer_ids=JSON.stringify(Array.isArray(b.assigned_dealer_ids)?b.assigned_dealer_ids.map(idOf).filter(Boolean):[]);
  for(const k of ["mobile","full_name","email","address"]){if(cols.has(k)&&b[k]!==undefined)f[k]=t(b[k])||null;}
  if(cols.has("date_of_birth")&&b.date_of_birth!==undefined)f.date_of_birth=t(b.date_of_birth).slice(0,10)||null;
  if(cols.has("allowed_modules")&&b.allowed_modules!==undefined){
    const mods=(Array.isArray(b.allowed_modules)?b.allowed_modules:String(b.allowed_modules||"").split(",")).map((x:any)=>String(x).trim()).filter(Boolean);
    const meta=await pool.query("SELECT data_type FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='user' AND column_name='allowed_modules'");
    f.allowed_modules=String(meta.rows[0]?.data_type||"").toLowerCase()==="array"?mods:mods.join(",");
  }
  const pw=String(b.password||"");
  if(pw){
    const crypto=await import("crypto"),salt=crypto.randomBytes(16).toString("hex");
    f.password_hash="pbkdf2:sha256:260000$"+salt+"$"+crypto.pbkdf2Sync(pw,salt,260000,32,"sha256").toString("hex");
  }else if(!id)return Response.json({error:"Password is required for a new user."},{status:400});
  const keys=Object.keys(f).filter(k=>k==="username"||cols.has(k));
  if(id){
    const r=await pool.query('UPDATE "user" SET '+keys.map((k,i)=>'"'+k+'"=$'+(i+1)).join(",")+' WHERE id=$'+(keys.length+1)+' RETURNING *',[...keys.map(k=>f[k]),id]);
    if(!r.rowCount)return Response.json({error:"User not found."},{status:404});
    const row={...r.rows[0]};delete row.password_hash;
    return Response.json({success:true,row,data:row});
  }
  const r=await pool.query('INSERT INTO "user" ('+keys.map(k=>'"'+k+'"').join(",")+') VALUES ('+keys.map((_,i)=>"$"+(i+1)).join(",")+') RETURNING *',keys.map(k=>f[k]));
  const row={...r.rows[0]};delete row.password_hash;
  return Response.json({success:true,row,data:row},{status:201});
}
let tiVehNoReady:Promise<void>|null=null;
function ensureTaxInvoiceVehicleNoColumn():Promise<void>{
  if(!tiVehNoReady)tiVehNoReady=pool.query("ALTER TABLE tax_invoice ADD COLUMN IF NOT EXISTS vehicle_reg_no text").then(()=>{}).catch(e=>{tiVehNoReady=null;throw e});
  return tiVehNoReady;
}
let chassisReady:Promise<void>|null=null;
function ensureChassisMasterSchema():Promise<void>{
  if(!chassisReady)chassisReady=(async()=>{
    await pool.query(`CREATE TABLE IF NOT EXISTS chassis_month_code (id bigserial PRIMARY KEY,month text NOT NULL,code text NOT NULL)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS chassis_year_code (id bigserial PRIMARY KEY,year integer NOT NULL,code text NOT NULL)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS chassis_rule (id bigserial PRIMARY KEY,month_position text,year_position text,chassis_height text,engine_motor_example text,chassis_example text)`);
  })().catch(e=>{chassisReady=null;throw e});
  return chassisReady;
}
async function chassisMasterWrite(path:string[],method:string,b:any):Promise<Response|null>{
  if(path[0]!=="chassis-master")return null;
  await ensureChassisMasterSchema();
  const sub=path[1],id=idOf(path[2]);
  const t=(v:any)=>String(v??"").trim();
  if(sub==="rule"&&(method==="PUT"||method==="POST")){
    const f=[t(b.month_position),t(b.year_position),t(b.chassis_height),t(b.engine_motor_example),t(b.chassis_example)];
    const ex=await pool.query("SELECT id FROM chassis_rule ORDER BY id DESC LIMIT 1");
    const r=ex.rowCount
      ?await pool.query("UPDATE chassis_rule SET month_position=$1,year_position=$2,chassis_height=$3,engine_motor_example=$4,chassis_example=$5 WHERE id=$6 RETURNING *",[...f,ex.rows[0].id])
      :await pool.query("INSERT INTO chassis_rule(month_position,year_position,chassis_height,engine_motor_example,chassis_example) VALUES($1,$2,$3,$4,$5) RETURNING *",f);
    return Response.json({success:true,rule:r.rows[0]});
  }
  if(sub!=="months"&&sub!=="years")return null;
  const isM=sub==="months",tbl=isM?"chassis_month_code":"chassis_year_code",col=isM?"month":"year";
  if(method==="DELETE"){
    if(!id)return Response.json({error:"Record id required."},{status:400});
    const r=await pool.query(`DELETE FROM ${tbl} WHERE id=$1 RETURNING *`,[id]);
    return Response.json({success:r.rowCount>0,row:r.rows[0]||null});
  }
  const val=isM?t(b.month):Number(b.year),code=t(b.code);
  if(!code||(isM?!val:!Number.isInteger(val)))return Response.json({error:(isM?"Month":"Year")+" and Code are required."},{status:400});
  const dup=await pool.query(`SELECT 1 FROM ${tbl} WHERE ${col}=$1 AND ($2::bigint IS NULL OR id<>$2) LIMIT 1`,[val,id]);
  if(dup.rowCount)return Response.json({error:(isM?"Month":"Year")+" code already exists."},{status:400});
  if(method==="POST"){
    const r=await pool.query(`INSERT INTO ${tbl}(${col},code) VALUES($1,$2) RETURNING *`,[val,code]);
    return Response.json({success:true,row:r.rows[0]});
  }
  if(!id)return Response.json({error:"Record id required."},{status:400});
  const r=await pool.query(`UPDATE ${tbl} SET ${col}=$1,code=$2 WHERE id=$3 RETURNING *`,[val,code,id]);
  return Response.json({success:true,row:r.rows[0]||null});
}

async function genericWrite(req:Request,path:string[],table:string,method:string,parsedBody?:any){
  const cols=await columns(table);
  if(!cols.size)return Response.json({error:"Table not found",table},{status:404});
  const body:any=parsedBody!==undefined?parsedBody:await json(req),input:any={};
  for(const [k,v] of Object.entries(body||{})){
    const c=snake(k);if(cols.has(c)&&c!=="id")input[c]=v;
  }
  if(table==="simple_master" && path[0]==="masters" && path[1] && cols.has("kind"))input.kind=path[1]==="color"?"colour":path[1];
  const id=idOf(path[path.length-1]);
  if(table==="dealer"){const g=await guardRepairReceiptRight(auth(req),method,method==="POST"?null:id,input);if(g)return g;}
  const scopeGuard=await enforceDealerScope(auth(req),table,id,input); if(scopeGuard)return scopeGuard;
  if(method==="POST"){
    const keys=Object.keys(input);
    if(!keys.length)return Response.json({error:"No valid fields supplied."},{status:400});
    const vals=keys.map((_,i)=>"$"+(i+1));
    const sql='INSERT INTO "'+table+'" ('+keys.map(k=>'"'+k+'"').join(",")+') VALUES ('+vals.join(",")+') RETURNING *';
    const r=await pool.query(sql,keys.map(k=>input[k]));
    await audit(auth(req),path.join("/"),"create",r.rows[0]?.id,null,r.rows[0],r.rows[0]?.dealer_id,r.rows[0]?.bill_no||r.rows[0]?.challan_no||r.rows[0]?.code);
    return Response.json({success:true,row:r.rows[0],data:r.rows[0]},{status:201});
  }
  if(!id)return Response.json({error:"Record id required."},{status:400});
  if(method==="DELETE"){
    const oldr=await pool.query('SELECT * FROM "'+table+'" WHERE id=$1',[id]);
    const r=await pool.query('DELETE FROM "'+table+'" WHERE id=$1 RETURNING *',[id]);
    await audit(auth(req),path.join("/"),"delete",id,oldr.rows[0]||null,null,oldr.rows[0]?.dealer_id,oldr.rows[0]?.bill_no||oldr.rows[0]?.challan_no||oldr.rows[0]?.code);
    return Response.json({success:r.rowCount>0,row:r.rows[0]||null});
  }
  const keys=Object.keys(input);
  if(!keys.length)return Response.json({error:"No valid fields supplied."},{status:400});
  const oldr=await pool.query('SELECT * FROM "'+table+'" WHERE id=$1',[id]);
  const sets=keys.map((k,i)=>'"'+k+'"=$'+(i+1));
  const r=await pool.query('UPDATE "'+table+'" SET '+sets.join(",")+' WHERE id=$'+(keys.length+1)+' RETURNING *',[...keys.map(k=>input[k]),id]);
  await audit(auth(req),path.join("/"),"edit",id,oldr.rows[0]||null,r.rows[0]||null,r.rows[0]?.dealer_id||oldr.rows[0]?.dealer_id,r.rows[0]?.bill_no||r.rows[0]?.challan_no||r.rows[0]?.code);
  return Response.json({success:r.rowCount>0,row:r.rows[0]||null,data:r.rows[0]||null});
}

async function chfplBridge(path:string, query:Record<string,string>={}){
  const base=String(process.env.CHFPL_API_URL||'').replace(/\/$/,'');
  const secret=String(process.env.CHFPL_GRD_BRIDGE_SECRET||'');
  if(!base || !secret) throw new Error('CHFPL bridge is not configured. Set CHFPL_API_URL and CHFPL_GRD_BRIDGE_SECRET.');
  const u=new URL(base+path);
  for(const [k,v] of Object.entries(query)) if(v) u.searchParams.set(k,v);
  const r=await fetch(u.toString(),{method:'GET',headers:{'x-grd-bridge-secret':secret,'Accept':'application/json'},cache:'no-store'});
  const d=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(d?.error||'CHFPL bridge request failed');
  return d;
}

// ---- CHFPL loan applications: local cache fed by webhook (no live bridge call on page load) ----
let chfplLoanCacheReady:Promise<void>|null=null;
function ensureChfplLoanCache():Promise<void>{
  if(!chfplLoanCacheReady){
    chfplLoanCacheReady=(async()=>{
      await pool.query("CREATE TABLE IF NOT EXISTS chfpl_loan_cache (chfpl_loan_id bigint PRIMARY KEY,grd_dealer_id integer,dealer_code text,application_no text,status text,data jsonb NOT NULL DEFAULT '{}'::jsonb,updated_at timestamptz NOT NULL DEFAULT now())");
      await pool.query("CREATE INDEX IF NOT EXISTS chfpl_loan_cache_dealer_idx ON chfpl_loan_cache(grd_dealer_id)");
    })().catch((e:any)=>{chfplLoanCacheReady=null;throw e});
  }
  return chfplLoanCacheReady;
}
// Full row (ya sirf status wala partial row) cache me daalo; partial update purana data mita nahi deta (jsonb merge).
async function upsertChfplLoanRows(rows:any[]){
  await ensureChfplLoanCache();
  let n=0;
  for(const row of rows){
    const cid=idOf(row?.id??row?.chfpl_loan_id);if(!cid)continue;
    const data={...row,id:cid};delete (data as any).chfpl_loan_id;
    await pool.query(
      "INSERT INTO chfpl_loan_cache (chfpl_loan_id,grd_dealer_id,dealer_code,application_no,status,data,updated_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,NOW()) ON CONFLICT (chfpl_loan_id) DO UPDATE SET grd_dealer_id=COALESCE(EXCLUDED.grd_dealer_id,chfpl_loan_cache.grd_dealer_id),dealer_code=COALESCE(NULLIF(EXCLUDED.dealer_code,''),chfpl_loan_cache.dealer_code),application_no=COALESCE(NULLIF(EXCLUDED.application_no,''),chfpl_loan_cache.application_no),status=COALESCE(NULLIF(EXCLUDED.status,''),chfpl_loan_cache.status),data=chfpl_loan_cache.data||EXCLUDED.data,updated_at=NOW()",
      [cid,idOf(row?.grd_dealer_id)||null,String(row?.dealer_code||"").trim(),String(row?.application_no||"").trim(),String(row?.status||"").trim(),JSON.stringify(data)]);
    n++;
  }
  return n;
}
let chfplSeedTried=false;

async function chfplSubmitLoan(body:any){
  const base=String(process.env.CHFPL_API_URL||'').replace(/\/$/,'');
  const bridgeSecret=String(process.env.CHFPL_GRD_BRIDGE_SECRET||'').trim();
  if(!base || !bridgeSecret) return {ok:false,error:'CHFPL bridge is not configured.'};
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),30000);
  try{
    const r=await fetch(base+'/api/grd-submit-loan',{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'x-grd-bridge-secret':bridgeSecret,
        'Accept':'application/json'
      },
      body:JSON.stringify(body),
      signal:controller.signal,
      cache:'no-store'
    });
    const d=await r.json().catch(()=>({}));
    if(!r.ok)return {ok:false,error:d?.error||'CHFPL loan submission failed.'};
    return {ok:true,data:d};
  }catch(e:any){
    return {ok:false,error:e?.name==='AbortError'?'CHFPL submission timed out.':(e?.message||'CHFPL submission failed.')};
  }finally{
    clearTimeout(timer);
  }
}

// ---- Portal (dealer / salesman) self-service helpers ----
function pwVerifyHash(crypto:any,hash:string,password:string){
  hash=String(hash||"");
  let m=hash.match(/^pbkdf2:(sha1|sha256|sha512):(\d+)\$([^$]+)\$([^$]+)$/);
  if(m){
    const actual=crypto.pbkdf2Sync(password,m[3],Number(m[2]),Math.floor(m[4].length/2),m[1]).toString("hex");
    return actual.length===m[4].length && crypto.timingSafeEqual(Buffer.from(actual),Buffer.from(m[4]));
  }
  m=hash.match(/^scrypt:(\d+):(\d+):(\d+)\$([^$]+)\$([^$]+)$/);
  if(m){
    const N=Number(m[1]),rr=Number(m[2]),pp=Number(m[3]);
    const actual=crypto.scryptSync(password,m[4],Buffer.from(m[5],"hex").length,{N,r:rr,p:pp,maxmem:Math.max(128*N*rr+1024,64*1024*1024)}).toString("hex");
    return actual.length===m[5].length && crypto.timingSafeEqual(Buffer.from(actual),Buffer.from(m[5]));
  }
  return false;
}
function pwMakeHash(crypto:any,password:string){
  const salt=crypto.randomBytes(16).toString("hex");
  return "pbkdf2:sha256:260000$"+salt+"$"+crypto.pbkdf2Sync(password,salt,260000,32,"sha256").toString("hex");
}


let insuranceRegisterSchemaReady:Promise<void>|null=null;
function ensureInsuranceRegisterSchema():Promise<void>{
  if(!insuranceRegisterSchemaReady){
    insuranceRegisterSchemaReady=(async()=>{
      await pool.query(`CREATE TABLE IF NOT EXISTS insurance_register (
        id bigserial PRIMARY KEY, insurance_type text NOT NULL, date date NOT NULL DEFAULT CURRENT_DATE,
        customer_name text NOT NULL DEFAULT '', total_premium numeric(14,2) NOT NULL DEFAULT 0,
        net_premium numeric(14,2) NOT NULL DEFAULT 0, discount_rate numeric(8,4) NOT NULL DEFAULT 0,
        payable_amount numeric(14,2) NOT NULL DEFAULT 0, insurer text NOT NULL DEFAULT '',
        chassis_no text, bill_no text, sp_no text, vehicle text, dealer_id bigint, remarks text,
        created_by text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      )`);
      await pool.query("CREATE INDEX IF NOT EXISTS insurance_register_type_idx ON insurance_register(insurance_type)");
      await pool.query("CREATE INDEX IF NOT EXISTS insurance_register_chassis_idx ON insurance_register(lower(btrim(chassis_no)))");
      await pool.query("CREATE INDEX IF NOT EXISTS insurance_register_bill_idx ON insurance_register(lower(btrim(bill_no)))");
      await pool.query("CREATE INDEX IF NOT EXISTS insurance_register_sp_idx ON insurance_register(lower(btrim(sp_no)))");
    })().catch(e=>{insuranceRegisterSchemaReady=null;throw e});
  }
  return insuranceRegisterSchemaReady;
}
// Shared validation for Insurance Register create/edit/import. NEW: unique by Chassis No. OLD: unique by SP No. (else Vehicle).
async function insuranceValidate(b:any,editId:any,client:any=pool,seen:Set<string>|null=null,fromImport=false):Promise<{error?:string,status?:number,f?:any}>{
  const type=String(b.insurance_type||"NEW").toUpperCase(); if(!["NEW","OLD"].includes(type))return {error:"insurance_type must be NEW or OLD."};
  const chassis=String(b.chassis_no||"").trim(),sp=String(b.sp_no||"").trim(),vehicle=String(b.vehicle||"").trim(),customer=String(b.customer_name||"").trim(),insurer=String(b.insurer||"").trim();
  const date=b.date&&b.date!=="INVALID"?importDate(b.date):(b.date==="INVALID"?null:todayDate());
  if(!date)return {error:"Invalid date."};
  if(!customer)return {error:"Customer Name required."}; if(!insurer)return {error:"Insurer required."};
  if(type==="NEW"&&!chassis)return {error:"New Insurance me Chassis No. required hai."};
  if(type==="OLD"&&!sp&&!vehicle)return {error:"Old Insurance me SP No. ya Vehicle required hai."};
  const total=fromImport?Number(b.total_premium||0):num(b.total_premium),disc=fromImport?Number(b.discount_rate||0):num(b.discount_rate);
  if(total<0||disc<0||disc>100)return {error:"Invalid premium / discount."};
  const net=b.net_premium!==undefined&&b.net_premium!==""?num(b.net_premium):Math.round(total*(1-disc/100)*100)/100;
  const payable=b.payable_amount!==undefined&&b.payable_amount!==""?num(b.payable_amount):net;
  const dupCol=type==="NEW"?"chassis_no":(sp?"sp_no":"vehicle"),dupVal=type==="NEW"?chassis:(sp||vehicle);
  const k=type+"|"+dupCol+"|"+dupVal.toLowerCase();
  if(seen){if(seen.has(k))return {error:"Duplicate in file: "+dupVal,status:409};seen.add(k);}
  const d=await client.query(`SELECT id FROM insurance_register WHERE insurance_type=$1 AND lower(btrim(${dupCol}))=lower(btrim($2)) AND ($3::bigint IS NULL OR id<>$3::bigint) LIMIT 1`,[type,dupVal,idOf(editId)]);
  if(d.rows.length)return {error:(type==="NEW"?"This Chassis No. is already registered in Insurance: ":"This "+(sp?"SP No.":"Vehicle")+" is already registered in Old Insurance: ")+dupVal,status:409};
  return {f:{type,date,customer,insurer,total,disc,net,payable,chassis,sp,vehicle,bill:String(b.bill_no||"").trim()}};
}
// ---- RTO Expense Register (outside expense - never printed on invoice; Registration Fee on invoice is separate) ----
let rtoRegisterSchemaReady:Promise<void>|null=null;
function ensureRtoRegisterSchema():Promise<void>{
  if(!rtoRegisterSchemaReady){
    rtoRegisterSchemaReady=(async()=>{
      await pool.query(`CREATE TABLE IF NOT EXISTS rto_expense_register (
        id bigserial PRIMARY KEY, rto_type text NOT NULL, date date NOT NULL DEFAULT CURRENT_DATE,
        customer_name text NOT NULL DEFAULT '', amount numeric(14,2) NOT NULL DEFAULT 0, work_type text,
        rto_agent text NOT NULL DEFAULT '', chassis_no text, bill_no text, sp_no text, vehicle text, dealer_id bigint, remarks text,
        created_by text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      )`);
      await pool.query("CREATE INDEX IF NOT EXISTS rto_register_type_idx ON rto_expense_register(rto_type)");
      await pool.query("CREATE INDEX IF NOT EXISTS rto_register_chassis_idx ON rto_expense_register(lower(btrim(chassis_no)))");
      await pool.query("CREATE INDEX IF NOT EXISTS rto_register_sp_idx ON rto_expense_register(lower(btrim(sp_no)))");
      await pool.query("CREATE INDEX IF NOT EXISTS rto_register_agent_idx ON rto_expense_register(lower(btrim(rto_agent)))");
    })().catch(e=>{rtoRegisterSchemaReady=null;throw e});
  }
  return rtoRegisterSchemaReady;
}
// One RTO work per chassis / SP is the normal case, but a vehicle can have several works (transfer, HP, fitness). Duplicate = same
// chassis (or SP/vehicle) + same work_type + same amount + same date, so re-importing a file never doubles the data.
async function rtoValidate(b:any,editId:any,client:any=pool,seen:Set<string>|null=null,fromImport=false):Promise<{error?:string,status?:number,f?:any}>{
  const type=String(b.rto_type||"NEW").toUpperCase(); if(!["NEW","OLD"].includes(type))return {error:"rto_type must be NEW or OLD."};
  const chassis=String(b.chassis_no||"").trim(),sp=String(b.sp_no||"").trim(),vehicle=String(b.vehicle||"").trim(),customer=String(b.customer_name||"").trim(),agent=String(b.rto_agent||"").trim(),work=String(b.work_type||"").trim();
  const date=b.date==="INVALID"?null:(b.date?importDate(b.date):todayDate()); if(!date)return {error:"Invalid date."};
  if(!customer)return {error:"Customer Name required."}; if(!agent)return {error:"RTO Agent / Passing Person required."};
  if(type==="NEW"&&!chassis)return {error:"New RTO Expense me Chassis No. required hai."};
  if(type==="OLD"&&!sp&&!vehicle)return {error:"Old RTO Expense me SP No. ya Vehicle required hai."};
  const amount=fromImport?Number(b.amount||0):num(b.amount); if(!(amount>0))return {error:"RTO Expense amount must be greater than 0."};
  const col=type==="NEW"?"chassis_no":(sp?"sp_no":"vehicle"),val=type==="NEW"?chassis:(sp||vehicle);
  const k=[type,col,val.toLowerCase(),work.toLowerCase(),amount,date].join("|");
  if(seen){if(seen.has(k))return {error:"Duplicate in file: "+val,status:409};seen.add(k);}
  const d=await client.query(`SELECT id FROM rto_expense_register WHERE rto_type=$1 AND lower(btrim(${col}))=lower(btrim($2)) AND lower(btrim(COALESCE(work_type,'')))=lower($3) AND amount=$4 AND date=$5::date AND ($6::bigint IS NULL OR id<>$6::bigint) LIMIT 1`,[type,val,work.toLowerCase(),amount,date,idOf(editId)]);
  if(d.rows.length)return {error:"RTO expense already registered for "+val+" ("+(work||"same work")+", same date & amount).",status:409};
  return {f:{type,date,customer,agent,amount,work,chassis,sp,vehicle,bill:String(b.bill_no||"").trim()}};
}
let hypReceiptSchemaReady:Promise<void>|null=null;
function ensureHypReceiptSchema():Promise<void>{
  if(!hypReceiptSchemaReady){
    hypReceiptSchemaReady=(async()=>{
      await ensureTaxInvoiceVehicleNoColumn();
      await pool.query(`CREATE TABLE IF NOT EXISTS hypothecation_receipt (
        id bigserial PRIMARY KEY, receipt_date date NOT NULL DEFAULT CURRENT_DATE, financer_name text NOT NULL DEFAULT '',
        amount numeric(14,2) NOT NULL DEFAULT 0, cheque_no text NOT NULL DEFAULT '', tax_invoice_id bigint NOT NULL,
        chassis_no text, vehicle_no text, bill_no text, buyer_name text, remarks text, created_by text,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
      await pool.query("ALTER TABLE hypothecation_receipt ADD COLUMN IF NOT EXISTS pay_mode text NOT NULL DEFAULT 'CASH'");
      await pool.query("ALTER TABLE hypothecation_receipt ADD COLUMN IF NOT EXISTS bank_name text");
      await pool.query("ALTER TABLE hypothecation_receipt ADD COLUMN IF NOT EXISTS day_book_id bigint");
      await pool.query("ALTER TABLE hypothecation_receipt ADD COLUMN IF NOT EXISTS bank_ledger_id bigint");
      await pool.query("CREATE INDEX IF NOT EXISTS hyp_receipt_invoice_idx ON hypothecation_receipt(tax_invoice_id)");
      await pool.query("CREATE INDEX IF NOT EXISTS hyp_receipt_date_idx ON hypothecation_receipt(receipt_date DESC)");
      await pool.query("CREATE INDEX IF NOT EXISTS hyp_receipt_cheque_idx ON hypothecation_receipt(lower(btrim(cheque_no)))");
    })().catch(e=>{hypReceiptSchemaReady=null;throw e});
  }
  return hypReceiptSchemaReady;
}
const hypNormChassis=(v:any)=>String(v??"").toUpperCase().replace(/\s+/g,"");
const hypNormVeh=(v:any)=>String(v??"").toUpperCase().replace(/[\s-]+/g,"");
const hypNormName=(v:any)=>String(v??"").toLowerCase().replace(/[^a-z0-9]/g,"");
// Finds live tax invoices by chassis no. (preferred) or, when no chassis is given, by vehicle no.
async function hypFindInvoices(chassis:any,vehicle:any){
  await ensureHypReceiptSchema();
  const c=hypNormChassis(chassis),v=hypNormVeh(vehicle),args:any[]=[];
  let cond="";
  if(c){args.push(c);cond="upper(regexp_replace(COALESCE(ti.chassis_no,''),'\\s','','g'))=$1";}
  else if(v){args.push(v);cond="upper(regexp_replace(COALESCE(ti.vehicle_reg_no,''),'[\\s-]','','g'))=$1";}
  else return [];
  const r=await pool.query(`SELECT ti.id,to_char(ti.date,'YYYY-MM-DD') AS date,ti.bill_no,ti.buyer_name,ti.chassis_no,ti.dealer_name,ti.product_name,ti.financer_name,ti.hypothecation_amount,
    COALESCE(ti.vehicle_reg_no,'') AS vehicle_no,
    COALESCE((SELECT SUM(hr.amount) FROM hypothecation_receipt hr WHERE hr.tax_invoice_id=ti.id),0) AS fin_received
    FROM tax_invoice ti WHERE COALESCE(ti.cancelled,false)=false AND ${cond} ORDER BY ti.date DESC,ti.id DESC LIMIT 5`,args);
  return r.rows.map((x:any)=>{const hyp=num(x.hypothecation_amount),rec=num(x.fin_received);return {...x,hypothecation_amount:hyp,fin_received:rec,balance:Math.max(0,hyp-rec),has_loan:hyp>0};});
}
let bankLedgerSchemaReady:Promise<void>|null=null;
function ensureBankLedgerSchema():Promise<void>{
  if(!bankLedgerSchemaReady){
    bankLedgerSchemaReady=(async()=>{
      await pool.query(`CREATE TABLE IF NOT EXISTS bank_ledger_entry (
        id bigserial PRIMARY KEY, entry_date date NOT NULL DEFAULT CURRENT_DATE, amount numeric(14,2) NOT NULL DEFAULT 0,
        bank_name text NOT NULL DEFAULT '', cheque_no text, upi_ref text, narration text, party_name text,
        entry_type text NOT NULL DEFAULT 'SUSPENSE', status text NOT NULL DEFAULT 'SUSPENSE', source text DEFAULT 'EXCEL', source_ref text,
        created_by text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      )`);
      await pool.query("CREATE INDEX IF NOT EXISTS bank_ledger_date_idx ON bank_ledger_entry(entry_date DESC)");
      await pool.query("CREATE INDEX IF NOT EXISTS bank_ledger_bank_idx ON bank_ledger_entry(lower(btrim(bank_name)))");
      await pool.query("CREATE INDEX IF NOT EXISTS bank_ledger_status_idx ON bank_ledger_entry(status)");
    })().catch(e=>{bankLedgerSchemaReady=null;throw e});
  }
  return bankLedgerSchemaReady;
}
export async function GET(req:Request,{params}:{params:Promise<{path?:string[]}>}){
  try{
    const {path=[]}=await params,p=path.join("/");
    const b:any=await json(req);
    const a=auth(req);
    if(p==="health")return Response.json({status:"ok",backend:"node",python:false});
    if(!a)return Response.json({error:"Authentication required."},{status:401});
    await ensureSecuritySchema();
    if(!canRead(a,p))return Response.json({error:"Forbidden."},{status:403});
    if(!(await actionAllowed(a,p,"view")))return Response.json({error:"Forbidden."},{status:403});
    if(p==="audit-report"){
      if(!isAdmin(a)) return Response.json({error:"Admin access required."},{status:403});
      const u=new URL(req.url),args:any[]=[],w:string[]=['1=1'];
      for(const [param,col] of [['user','username'],['module','module_key'],['action','action'],['record','record_ref']]){const v=u.searchParams.get(param);if(v){args.push('%'+v+'%');w.push(`COALESCE(${col},'') ILIKE $${args.length}`)}}
      const from=u.searchParams.get('from'),to=u.searchParams.get('to'); if(from){args.push(from);w.push(`created_at >= $${args.length}::date`)} if(to){args.push(to);w.push(`created_at < ($${args.length}::date + interval '1 day')`)}
      const r=await pool.query(`SELECT * FROM audit_log WHERE ${w.join(' AND ')} ORDER BY created_at DESC LIMIT 5000`,args); return Response.json({rows:r.rows,count:r.rowCount});
    }
    if(p==="sub-groups"){
      const r=await pool.query("SELECT * FROM product_sub_group WHERE active=true ORDER BY name"); return Response.json({rows:r.rows,sub_groups:r.rows});
    }
    if(p.startsWith('users/') && p.endsWith('/action-permissions')){
      const uid=idOf(path[path.length-2]); if(!uid)return Response.json({error:'User id required.'},{status:400});
      const r=await pool.query('SELECT * FROM user_action_permission WHERE user_id=$1 ORDER BY module_key',[uid]); return Response.json({rows:r.rows,permissions:r.rows});
    }
    if(p==='reports/profit-loss'){
      const u=new URL(req.url),ymd=(d:Date)=>d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0')+'-'+String(d.getUTCDate()).padStart(2,'0');
      const from=u.searchParams.get('from')||ymd(new Date(Date.UTC(new Date().getUTCFullYear(),0,1))),to=u.searchParams.get('to')||ymd(new Date());
      const prevDay=ymd(new Date(new Date(from+'T00:00:00Z').getTime()-86400000));
      // Sales = taxable value (GST excluded, same basis as GST register) of non-cancelled tax invoices.
      const sales=await pool.query(`SELECT COALESCE(SUM(GREATEST(COALESCE(gst_sale_amount,sale_amount,0)-COALESCE(discount,0),0)),0) sales FROM tax_invoice WHERE COALESCE(cancelled,false)=false AND date BETWEEN $1::date AND $2::date`,[from,to]);
      // Purchases = taxable value from bill items (GST is input credit, not cost).
      const pb=await pool.query(`SELECT * FROM purchase_bill WHERE date BETWEEN $1::date AND $2::date`,[from,to]);
      const purchase=pb.rows.reduce((t:number,x:any)=>{const v=purchaseBillTotals(x).taxable;return t+(v||num(x.taxable_amt)||num(x.total_amt));},0);
      const expenses=await pool.query(`SELECT COALESCE(SUM(COALESCE(amount,0)),0) expenses FROM expense_payment_voucher WHERE COALESCE(status,'') NOT IN ('rejected','cancelled') AND date BETWEEN $1::date AND $2::date`,[from,to]);
      // Stock is valued at cost (purchase price first), never at selling price, otherwise profit is overstated.
      const products=await pool.query(`SELECT p.id,p.name,p.code,p.unit,COALESCE(NULLIF(p.purchase_price,0),NULLIF(p.sale_price,0),NULLIF(p.ex_showroom_price,0),0) rate,COALESCE((SELECT SUM(CASE WHEN UPPER(COALESCE(js.work_type,''))='OUT' THEN -ABS(js.qty) WHEN UPPER(COALESCE(js.work_type,''))='IN' THEN ABS(js.qty) ELSE js.qty END) FROM journal_stock js WHERE lower(trim(js.item_name))=lower(trim(p.name)) AND js.date <= $1::date),0) opening_qty,COALESCE((SELECT SUM(CASE WHEN UPPER(COALESCE(js.work_type,''))='OUT' THEN -ABS(js.qty) WHEN UPPER(COALESCE(js.work_type,''))='IN' THEN ABS(js.qty) ELSE js.qty END) FROM journal_stock js WHERE lower(trim(js.item_name))=lower(trim(p.name)) AND js.date <= $2::date),0) closing_qty,COALESCE(p.sub_group_name,'Primary') sub_group_name FROM product p ORDER BY p.name`,[prevDay,to]);
      const rows=products.rows.map((x:any)=>({...x,opening_value:Number(x.opening_qty||0)*Number(x.rate||0),closing_value:Number(x.closing_qty||0)*Number(x.rate||0)}));
      const opening=rows.reduce((t:number,x:any)=>t+x.opening_value,0),closing=rows.reduce((t:number,x:any)=>t+x.closing_value,0),sale=Number(sales.rows[0]?.sales||0),expense=Number(expenses.rows[0]?.expenses||0),cogs=opening+purchase-closing,gross=sale-cogs,net=gross-expense;
      return Response.json({from,to,opening_stock:opening,purchases:purchase,sales:sale,closing_stock:closing,cost_of_goods_sold:cogs,gross_profit:gross,expenses:expense,net_profit:net,rows});
    }
    if(p.startsWith('customer-complete-report')){
      const u=new URL(req.url),customerId=idOf(u.searchParams.get('customer_id')),mobile=String(u.searchParams.get('mobile')||'').trim(),name=String(u.searchParams.get('name')||'').trim();
      if(!customerId&&!mobile&&!name)return Response.json({error:'customer_id, mobile or name is required.'},{status:400});
      const args:any[]=[]; const w:string[]=[]; if(customerId){args.push(customerId);w.push(`(c.id=$${args.length} OR ti.billing_customer_id=$${args.length})`)} else {args.push('%'+(mobile||name)+'%');w.push(`(COALESCE(c.mobile,'') ILIKE $${args.length} OR COALESCE(c.name,'') ILIKE $${args.length} OR COALESCE(ti.buyer_mobile,'') ILIKE $${args.length} OR COALESCE(ti.buyer_name,'') ILIKE $${args.length})`)}
      // Salesman: only invoices of assigned dealers (API-level restriction).
      if(isSalesman(a)){const ids=assignedDealerIds(a)||[];args.push(ids.length?ids:[-1]);w.push(`ti.dealer_id=ANY($${args.length}::bigint[])`);}
      const sales=await pool.query(`SELECT ti.*,${TI_TAXABLE} AS taxable_value FROM tax_invoice ti LEFT JOIN customer c ON c.id=ti.customer_id WHERE COALESCE(ti.cancelled,false)=false AND ${w.join(' AND ')} ORDER BY ti.date DESC,ti.id DESC`,args).catch(()=>({rows:[]}));
      // Expenses/payments must be matched on the customer's actual name/mobile; with only customer_id the old query used '%%' and returned EVERY customer's rows.
      const nm=name||String(sales.rows[0]?.buyer_name||'').trim(),mb=mobile||String(sales.rows[0]?.buyer_mobile||'').trim();
      const noParty=!nm&&!mb;
      const exp=noParty?{rows:[]}:await pool.query(`SELECT * FROM expense_payment_voucher WHERE (($1<>'' AND (COALESCE(party_name,'') ILIKE '%'||$1||'%' OR COALESCE(customer_name,'') ILIKE '%'||$1||'%')) OR ($2<>'' AND COALESCE(customer_mobile,'') = $2)) ORDER BY date DESC,id DESC`,[nm,mb]).catch(()=>pool.query(`SELECT * FROM expense_payment_voucher WHERE $1<>'' AND (COALESCE(party_name,'') ILIKE '%'||$1||'%' OR COALESCE(customer_name,'') ILIKE '%'||$1||'%') ORDER BY date DESC,id DESC`,[nm]).catch(()=>({rows:[]})));
      const pay=noParty||!nm?{rows:[]}:await pool.query(`SELECT * FROM day_book WHERE COALESCE(party_name,'') ILIKE '%'||$1||'%' ORDER BY date DESC,id DESC`,[nm]).catch(()=>({rows:[]}));
      const n=(v:any)=>Number(v||0);
      const totalGst=sales.rows.reduce((t:number,x:any)=>t+n(x.cgst_amount)+n(x.sgst_amount)+n(x.igst_amount)+ (n(x.cgst_amount)+n(x.sgst_amount)+n(x.igst_amount)?0:n(x.tax_amount)),0);
      const totalExpenses=exp.rows.reduce((t:number,x:any)=>t+n(x.amount),0);
      const breakup:any={}; for(const x of exp.rows){const k=String(x.category||x.expense_head||x.expense_type||'Other');breakup[k]=(breakup[k]||0)+n(x.amount);}
      return Response.json({sales:sales.rows,expenses:exp.rows,payments:pay.rows,
        loan_details:sales.rows.map((x:any)=>({loan_amount:x.hypothecation_amount,financer:x.financer_name,date:x.date,bill_no:x.bill_no})),
        total_gst:totalGst,total_expenses:totalExpenses,expense_breakup:Object.entries(breakup).map(([category,amount])=>({category,amount})),
        outstanding:sales.rows.reduce((t:number,x:any)=>t+Math.max(0,n(x.sale_amount)-n(x.hypothecation_amount)-n(x.amount_received)),0)});
    }

    // Server-to-server master bridge for CHFPL. This endpoint intentionally
    // does not use the browser JWT because CHFPL authenticates with the
    // dedicated bridge secret.
    if(p==="integration/masters"){
      const bridgeSecret=String(process.env.GRD_BRIDGE_SECRET||process.env.CHFPL_GRD_BRIDGE_SECRET||"").trim();
      const supplied=String(req.headers.get("x-grd-bridge-secret")||"").trim();
      if(!bridgeSecret || !supplied || supplied!==bridgeSecret){
        return Response.json({success:false,error:"Invalid GRD bridge secret."},{status:401});
      }
      const dealers=await pool.query("SELECT id,code,name,mobile,state_code FROM dealer WHERE COALESCE(blocked,false)=false ORDER BY name,id");
      const models=await pool.query("SELECT id,name,code FROM product WHERE COALESCE(fro,'')<>'R' AND COALESCE(name,'')<>'' ORDER BY name,id");
      return Response.json({success:true,dealers:dealers.rows,models:models.rows});
    }
    if(p==="notifications"){
      await ensureNotificationSchema(); await ensureBatteryFitSchema(); await ensureDealerCashSchema();
      const u=new URL(req.url),limit=Math.min(100,Math.max(1,num(u.searchParams.get("limit"))||50));
      const userKey=String(a?.id??a?.user_id??a?.username??"").trim();
      const args:any[]=[userKey||"__none__",num(a?.dealer_id)||0,limit];
      const r=await pool.query(`SELECT * FROM app_notification
        WHERE is_read=false AND (user_id=$1 OR user_id IS NULL OR (dealer_id IS NOT NULL AND dealer_id=$2))
        ORDER BY created_at DESC LIMIT $3`,args);
      const ds=await pool.query("SELECT id,name,code FROM dealer WHERE LOWER(COALESCE(dealer_category,''))='branch'"+(a?.scope==="dealer"?" AND id=$1":"")+" ORDER BY name",a?.scope==="dealer"?[num(a.dealer_id)]:[]);
      const cash:any[]=[];
      for(const d of ds.rows){
        const lim=await pool.query("SELECT cash_limit FROM dealer_cash_limit WHERE dealer_id=$1",[Number(d.id)]);
        const cap=Number(lim.rows[0]?.cash_limit??15000);
        const pos=await dealerCashPosition(Number(d.id));
        if(cap>0 && Number(pos.cash_at_dealer)>cap) cash.push({
          id:"cash-limit-"+d.id, notification_type:"cash_limit", title:"Branch Cash Limit Exceeded",
          message:`${d.name}: cash at branch ₹${Number(pos.cash_at_dealer).toLocaleString("en-IN")} is above limit ₹${cap.toLocaleString("en-IN")}.`,
          dealer_id:Number(d.id), is_read:false, virtual:true, created_at:new Date().toISOString(), cash_at_dealer:pos.cash_at_dealer, cash_limit:cap
        });
      }
      const limits=await pool.query("SELECT dealer_id,cash_limit FROM dealer_cash_limit WHERE dealer_id=ANY($1::int[])",[ds.rows.map(d=>Number(d.id))]);
      const lm=new Map<number,number>(limits.rows.map((x:any)=>[Number(x.dealer_id),Number(x.cash_limit)]));
      for(const x of cash){x.cash_limit=lm.get(Number(x.dealer_id))??15000;}
      return Response.json({notifications:[...cash,...r.rows],count:cash.length+r.rowCount,branch_cash_limits:ds.rows.map(d=>({dealer_id:d.id,dealer_name:d.name,limit:lm.get(Number(d.id))??15000}))});
    }
    if(p==="battery-fit"){
      await ensureBatteryFitSchema();
      const u=new URL(req.url),q=String(u.searchParams.get("search")||"").trim();
      const args:any[]=[]; const where=["COALESCE(dc.cancelled,false)=false"];
      where.push("NOT EXISTS (SELECT 1 FROM tax_invoice ti WHERE ti.delivery_challan_id=dc.id AND COALESCE(ti.cancelled,false)=false)");
      where.push("dc.vehicle_id IS NOT NULL");
      if(a?.scope==="dealer"){args.push(num(a.dealer_id));where.push("dc.dealer_id=$"+args.length);}
      if(q){args.push("%"+q+"%");where.push("(dc.challan_no ILIKE $"+args.length+" OR dc.chassis_no ILIKE $"+args.length+" OR COALESCE(d.name,'') ILIKE $"+args.length+")");}
      const r=await pool.query(`SELECT dc.id,dc.challan_no,dc.date,dc.dealer_id,d.name AS dealer_name,dc.vehicle_id,
        dc.chassis_no,dc.product_name,v.model_name,v.battery_maker,v.battery_no1,v.battery_no2,v.battery_no3,v.battery_no4,
        dc.battery_fit_date
        FROM delivery_challan dc LEFT JOIN dealer d ON d.id=dc.dealer_id LEFT JOIN vehicle v ON v.id=dc.vehicle_id
        WHERE ${where.join(" AND ")} ORDER BY dc.date DESC,dc.id DESC LIMIT 500`,args);
      return Response.json({challans:r.rows});
    }
    if(p==="reports/cash-at-dealer"&&a.scope==="staff"){
      await ensureDealerCashSchema();
      const u=new URL(req.url),only=idOf(u.searchParams.get("dealer_id"));
      const ds=await pool.query("SELECT id,code,name FROM dealer WHERE LOWER(COALESCE(dealer_category,'')) IN ('showroom','branch')"+(only?" AND id=$1":"")+" ORDER BY name",only?[only]:[]);
      const rows:any[]=[];
      for(const d of ds.rows){const c=await dealerCashPosition(Number(d.id));rows.push({dealer_id:d.id,dealer_code:d.code,dealer_name:d.name,cash_received:c.cash_received,expenses:c.expenses,ho_handover:c.ho_handover,pending_handover:c.pending_handover,cash_at_dealer:c.cash_at_dealer});}
      return Response.json({rows,total_cash_at_dealer:rows.reduce((s,x)=>s+num(x.cash_at_dealer),0),total_pending_handover:rows.reduce((s,x)=>s+num(x.pending_handover),0)});
    }
    if(p==="admin/cash-handovers"){
      if(!isAdmin(a))return Response.json({error:"Admin rights required."},{status:403});
      await ensureDealerCashSchema();
      const st=String(new URL(req.url).searchParams.get("status")||"").trim().toLowerCase();
      const r=await pool.query("SELECT h.*,d.name AS dealer_name,d.code AS dealer_code FROM dealer_cash_handover h LEFT JOIN dealer d ON d.id=h.dealer_id"+(st?" WHERE lower(COALESCE(h.status,'pending'))=$1":"")+" ORDER BY (lower(COALESCE(h.status,'pending'))='pending') DESC,h.date DESC,h.id DESC LIMIT 500",st?[st]:[]);
      return Response.json({handovers:r.rows,rows:r.rows,count:r.rowCount});
    }
    if(p==="chfpl/loan-status"){
      const q:any={};
      if(a?.scope==="dealer") q.grd_dealer_id=String(num(a.dealer_id));
      const d=await chfplBridge("/api/grd-dealer-loans",q);
      return Response.json({source:"CHFPL",applications:d.applications||[],count:(d.applications||[]).length});
    }
    if(p==="chfpl/repo-vehicles"){
      const q:any={status:"ALL"};
      if(a?.scope==="dealer") q.dealer_id=String(num(a.dealer_id));
      const d=await chfplBridge("/api/grd/repossessed",q);
      const vehicles=(d.vehicles||[]).map((v:any)=>({...v,source:"CHFPL",current_status:v.resale_status==="SEIZED"?"HOLD":(v.resale_status||"SEIZED")}));
      return Response.json({source:"CHFPL",vehicles,count:vehicles.length});
    }

    // Dealer Loan Status must be a live CHFPL read. The local loan_workflow
    // table is only the GRD bridge/cache and can otherwise remain stale when
    // a CHFPL status changes after the loan was submitted.
    if(p==="dealer/loan-status"||p==="loan-application-view"){
      const q:any={};
      if(a?.scope==="dealer"){
        q.grd_dealer_id=String(num(a.dealer_id));
        const dealerIdentity=await pool.query("SELECT code FROM dealer WHERE id=$1 LIMIT 1",[num(a.dealer_id)]);
        const dealerCode=String(dealerIdentity.rows[0]?.code||"").trim();
        if(dealerCode) q.grd_dealer_code=dealerCode;
      }
      // Data ab webhook (POST /api/loan-status-webhook) se local cache me aata hai -> CHFPL ko live call nahi jaati.
      await ensureLoanWorkflowBridgeSchema();await ensureChfplLoanCache();
      // Pehli baar cache khali ho to ek baar purana data bridge se import kar lo (webhook sirf naye changes bhejta hai).
      if(!chfplSeedTried){
        const cnt=await pool.query("SELECT COUNT(*)::int AS n FROM chfpl_loan_cache");
        if(!Number(cnt.rows[0]?.n||0)){
          chfplSeedTried=true;
          try{const seed=await chfplBridge("/api/grd-dealer-loans",{});await upsertChfplLoanRows(Array.isArray(seed?.applications)?seed.applications:[]);}catch(_e){}
        }else chfplSeedTried=true;
      }
      const cArgs:any[]=[];let cWhere="1=1";
      if(a?.scope==="dealer"){
        cArgs.push(num(a.dealer_id),String(q.grd_dealer_code||""));
        cWhere="(grd_dealer_id=$1 OR ($2<>'' AND dealer_code=$2))";
      }
      const cached=await pool.query("SELECT chfpl_loan_id,status,application_no,data FROM chfpl_loan_cache WHERE "+cWhere+" ORDER BY chfpl_loan_id DESC LIMIT 5000",cArgs);
      const applications=cached.rows.map((r:any)=>({...(r.data||{}),id:Number(r.chfpl_loan_id),status:r.status||r.data?.status||"submitted",application_no:r.application_no||r.data?.application_no||""}));

      const pendingArgs:any[]=[];
      let pendingWhere="status='PENDING_CHFPL_SYNC'";
      if(a?.scope==="dealer"){
        pendingArgs.push(num(a.dealer_id));
        pendingWhere+=" AND dealer_id=$1";
      }
      const pending=await pool.query(
        "SELECT lw.* FROM loan_workflow lw WHERE "+pendingWhere+" ORDER BY lw.id DESC LIMIT 100",
        pendingArgs
      );

      // Live CHFPL rows are authoritative. Keep only genuinely unsynced
      // local submissions in addition to them.
      const liveIds=new Set(applications.map((x:any)=>Number(idOf(x.id))).filter(Boolean));
      const unsynced=pending.rows.filter((x:any)=>!x.chfpl_loan_id && !liveIds.has(Number(x.id)));
      return Response.json({
        source:"CHFPL",
        applications:[...applications,...unsynced],
        count:applications.length+unsynced.length
      });
    }
    if(p==="billing/pending-sales"){
      await ensureLoanWorkflowBridgeSchema(); await ensureBillingSalesSchema();
      if(!billingStaff(a) && a?.scope!=="dealer")return Response.json({error:"Billing approval rights required."},{status:403});
      const args:any[]=[];
      let where="1=1";
      if(a?.scope==="dealer"){args.push(num(a.dealer_id));where+=" AND s.dealer_id=$"+args.length;}
      const r=await pool.query(`SELECT s.*,lw.application_no,lw.status AS loan_status,lw.loan_amount,lw.loan_model_name,lw.loan_vehicle_type,
        COALESCE(NULLIF(s.customer_name,''),c.full_name) AS customer_name,COALESCE(NULLIF(s.customer_phone,''),c.phone) AS customer_phone,d.name AS dealer_name,
        v.model_name,v.motor_no,v.controller_no,v.colour
        FROM grd_billing_sale s
        LEFT JOIN loan_workflow lw ON lw.id=s.application_id
        LEFT JOIN customer c ON c.id=s.customer_id
        LEFT JOIN dealer d ON d.id=s.dealer_id
        LEFT JOIN vehicle v ON v.id=s.vehicle_id
        WHERE ${where} AND s.status IN ('PENDING','APPROVED')
        ORDER BY s.created_at DESC,s.id DESC LIMIT 800`,args);
      return Response.json({applications:r.rows,rows:r.rows,count:r.rowCount,can_approve:billingStaff(a)});
    }
    if(p==="billing/pending-sales/options"){
      await ensureLoanWorkflowBridgeSchema();
      // Do not run ensureGrdAssetSchema() here. That function recreates a trigger and
      // backfills the entire loan_workflow table on every options request, which can
      // block long enough for the browser request to time out. The options endpoint
      // only reads existing data and does not need the GRD asset backfill.
      if(!billingStaff(a) && a?.scope!=="dealer")return Response.json({error:"Billing rights required."},{status:403});
      // Staged loading (UI asks: dealers -> that dealer's stock -> that dealer's customers/loans).
      const optUrl=new URL(req.url),part=String(optUrl.searchParams.get("part")||"");
      if(part){
        const isDealer=a?.scope==="dealer";
        const did=isDealer?num(a.dealer_id):num(optUrl.searchParams.get("dealer_id"));
        if(part==="dealers"){
          const dr=await pool.query("SELECT id,code,name,dealer_category FROM dealer WHERE COALESCE(blocked,false)=false"+(isDealer?" AND id=$1":"")+" ORDER BY name,id",isDealer?[did]:[]);
          return Response.json({dealers:dr.rows,can_approve:billingStaff(a)});
        }
        if(!did)return Response.json({error:"Dealer is required."},{status:400});
        if(part==="vehicles"){
          await ensureBillingSalesSchema();
          // Already billed / already in a pending sale chassis are not offered (they always failed on save).
          const vr=await pool.query(`SELECT dc.id AS challan_id,dc.vehicle_id,dc.chassis_no,dc.challan_no,dc.product_name,dc.sale_value,dc.date,dc.dealer_id,d.name AS dealer_name,v.model_name,v.colour
            FROM delivery_challan dc LEFT JOIN dealer d ON d.id=dc.dealer_id LEFT JOIN vehicle v ON v.id=dc.vehicle_id
            WHERE dc.dealer_id=$1 AND COALESCE(dc.cancelled,false)=false AND dc.vehicle_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM tax_invoice ti WHERE COALESCE(ti.cancelled,false)=false AND (ti.delivery_challan_id=dc.id OR (COALESCE(ti.chassis_no,'')<>'' AND ti.chassis_no=dc.chassis_no)))
              AND NOT EXISTS (SELECT 1 FROM grd_billing_sale s WHERE s.vehicle_id=dc.vehicle_id AND s.status IN ('PENDING','APPROVED','BILLED'))
            ORDER BY dc.date DESC,dc.id DESC LIMIT 1000`,[did]);
          return Response.json({vehicles:vr.rows,can_approve:billingStaff(a)});
        }
        if(part==="customers"){
          await ensureBillingSalesSchema();await ensureDealerCashSchema();
          const approvedSql=`LOWER(REPLACE(REPLACE(TRIM(COALESCE(lw.status,'')),'_',' '),'-',' ')) IN ('loan approved','approved')`;
          const [lr,cr]=await Promise.all([
            pool.query(`SELECT lw.id,lw.application_no,lw.status,lw.do_no,lw.loan_amount,lw.loan_model_name,lw.loan_vehicle_type,c.full_name AS customer_name,c.phone AS customer_phone,lw.dealer_id
              FROM loan_workflow lw LEFT JOIN customer c ON c.id=lw.customer_id
              WHERE ${approvedSql} AND lw.dealer_id=$1 AND NOT EXISTS (SELECT 1 FROM grd_billing_sale s WHERE s.application_id=lw.id)
              ORDER BY lw.id DESC LIMIT 500`,[did]),
            pool.query(`SELECT c.* FROM dealer_cash_customer c JOIN dealer d ON d.id=c.dealer_id
              WHERE c.dealer_id=$1 AND LOWER(COALESCE(d.dealer_category,'')) IN ('showroom','branch')
                AND NOT EXISTS (SELECT 1 FROM grd_billing_sale s WHERE s.dealer_cash_customer_id=c.id AND s.status IN ('PENDING','APPROVED','BILLED'))
                AND UPPER(COALESCE(c.status,''))<>'DEALER_CANCEL'
              ORDER BY c.id DESC LIMIT 2000`,[did])
          ]);
          const cash=(await enrichCashCustomers(cr.rows)).filter((x:any)=>x.status!=="BILLED").map((x:any)=>({...x,booking_for:x.vehicle_no}));
          return Response.json({applications:lr.rows,cash_customers:cash,can_approve:billingStaff(a)});
        }
        return Response.json({error:"Unknown part."},{status:400});
      }
      await ensureBillingSalesSchema();
      await ensureDealerCashSchema();
      const manualOnly=new URL(req.url).searchParams.get("manual")==="1";
      let appsP:Promise<any>=Promise.resolve({rows:[]});
      if(!manualOnly){
        const args:any[]=[];
        let dealerWhere="";
        if(a?.scope==="dealer"){args.push(num(a.dealer_id));dealerWhere=" AND lw.dealer_id=$"+args.length;}
        const approved=`LOWER(REPLACE(REPLACE(TRIM(COALESCE(lw.status,'')),'_',' '),'-',' ')) IN ('loan approved','approved')`;
        appsP=pool.query(`SELECT lw.id,lw.application_no,lw.status,lw.do_no,lw.loan_amount,lw.loan_model_name,lw.loan_vehicle_type,
          c.full_name AS customer_name,c.phone AS customer_phone,d.name AS dealer_name,lw.dealer_id
          FROM loan_workflow lw
          LEFT JOIN customer c ON c.id=lw.customer_id
          LEFT JOIN dealer d ON d.id=lw.dealer_id
          WHERE ${approved} AND NOT EXISTS (SELECT 1 FROM grd_billing_sale s WHERE s.application_id=lw.id)${dealerWhere}
          ORDER BY lw.id DESC LIMIT 500`,args);
      }
      const vehicleArgs:any[]=[];
      let vehicleWhere="COALESCE(dc.cancelled,false)=false AND dc.vehicle_id IS NOT NULL";
      if(a?.scope==="dealer"){vehicleArgs.push(num(a.dealer_id));vehicleWhere+=" AND dc.dealer_id=$"+vehicleArgs.length;}
      const chP=pool.query(`SELECT dc.id AS challan_id,dc.vehicle_id,dc.chassis_no,dc.product_name,dc.sale_value,dc.date,dc.dealer_id,d.name AS dealer_name
        FROM delivery_challan dc LEFT JOIN dealer d ON d.id=dc.dealer_id
        WHERE ${vehicleWhere}
        ORDER BY dc.date DESC,dc.id DESC LIMIT 1000`,vehicleArgs);
      const dealersP=pool.query("SELECT id,code,name,dealer_category FROM dealer WHERE COALESCE(blocked,false)=false ORDER BY name,id");
      const ccArgs:any[]=[];
      let ccDealer="";
      if(a?.scope==="dealer"){ccArgs.push(num(a.dealer_id));ccDealer=" AND c.dealer_id=$"+ccArgs.length;}
      const cashP=pool.query(`SELECT c.*
        FROM dealer_cash_customer c JOIN dealer d ON d.id=c.dealer_id
        WHERE LOWER(COALESCE(d.dealer_category,'')) IN ('showroom','branch')
          AND NOT EXISTS (SELECT 1 FROM grd_billing_sale s WHERE s.dealer_cash_customer_id=c.id AND s.status IN ('PENDING','APPROVED','BILLED'))${ccDealer}
          AND UPPER(COALESCE(c.status,''))<>'DEALER_CANCEL'
        ORDER BY c.id DESC LIMIT 2000`,ccArgs);
      // Independent reads: run in parallel instead of one after another.
      const [appsR,ch,dealers,cashCustomers]=await Promise.all([appsP,chP,dealersP,cashP]);
      // name/phone resolved + old/new billed customers removed (they cannot be sold again).
      const cashList=(await enrichCashCustomers(cashCustomers.rows)).filter((x:any)=>x.status!=="BILLED").map((x:any)=>({...x,booking_for:x.vehicle_no}));
      return Response.json({applications:appsR.rows,vehicles:ch.rows,dealers:dealers.rows,cash_customers:cashList,can_approve:billingStaff(a)});
    }
    if(p==="billing/pending-sales/invoice"){
      await ensureBillingSalesSchema();
      if(!billingStaff(a))return Response.json({error:"Billing approval rights required."},{status:403});
      const id=idOf(new URL(req.url).searchParams.get("id"));
      if(!id)return Response.json({error:"Sale id is required."},{status:400});
      const r=await pool.query(`SELECT s.*,lw.application_no,lw.loan_amount,lw.loan_model_name,lw.loan_vehicle_type,
        COALESCE(NULLIF(s.customer_name,''),c.full_name) AS customer_name,COALESCE(NULLIF(s.customer_phone,''),c.phone) AS customer_phone,COALESCE(NULLIF(s.customer_address,''),c.address) AS customer_address,COALESCE(NULLIF(s.customer_state,''),c.state) AS customer_state,
        d.name AS dealer_name,v.model_name,v.motor_no,v.controller_no,v.colour
        FROM grd_billing_sale s
        LEFT JOIN loan_workflow lw ON lw.id=s.application_id
        LEFT JOIN customer c ON c.id=s.customer_id
        LEFT JOIN dealer d ON d.id=s.dealer_id
        LEFT JOIN vehicle v ON v.id=s.vehicle_id WHERE s.id=$1`,[id]);
      if(!r.rowCount)return Response.json({error:"Pending Sale not found."},{status:404});
      const x=r.rows[0];
      if(x.status!=="APPROVED")return Response.json({error:"Pending Sale must be approved before Create Sale."},{status:403});
      if(["OLD RICKSHAW","BATTERY"].includes(String(x.sale_type||"").toUpperCase()))return Response.json({error:"Old Rickshaw / Battery sale par GST Tax Invoice nahi banta. 'Complete Sale (No GST)' use karo."},{status:409});
      if(x.invoice_id){const inv=await pool.query("SELECT * FROM tax_invoice WHERE id=$1",[x.invoice_id]);return Response.json({sale:x,invoice:inv.rows[0]||null});}
      const hyp=num(x.hypothecation_amount)||num(x.loan_amount);
      return Response.json({sale:x,invoice:{
        date:new Date().toISOString().slice(0,10),buyer_name:x.customer_name||"",buyer_mobile:x.customer_phone||"",
        buyer_address:x.customer_address||"",buyer_state:x.customer_state||"",dealer_name:x.dealer_name||"",
        product_name:x.model_name||x.loan_model_name||"",chassis_no:x.chassis_no||"",motor_no:x.motor_no||"",
        controller_no:x.controller_no||"",colour:x.colour||"",
        sale_amount:num(x.sale_amount),gst_sale_amount:num(x.gst_sale_amount)||num(x.sale_amount),
        gst_rate:num(x.gst_rate)||5,hypothecation_amount:hyp,amount_received:num(x.amount_received),
        mode_term:x.mode_term||"CHFPL",remarks:x.remarks||x.description||"",
        dealer_page_no:x.page_no||"",buyer_relation:x.buyer_relation||"",buyer_father_name:x.buyer_father_name||"",
        buyer_gst_no:x.buyer_gst_no||"",buyer_pan:x.buyer_pan||"",buyer_aadhar:x.buyer_aadhar||"",
        buyer_dob:x.buyer_dob?String(x.buyer_dob instanceof Date?x.buyer_dob.toISOString():x.buyer_dob).slice(0,10):"",
        buyer_state_code:x.buyer_state_code||"",state_type:x.state_type||"I",bank_name:x.bank_name||"",
        bank_account_no:x.bank_account_no||"",bank_ifsc:x.bank_ifsc||"",rto_name:x.rto_name||"",
        despatch_through:x.despatch_through||"",eway_bill_no:x.eway_bill_no||"",license_no:x.license_no||"",
        cvr_no:x.cvr_no||"",cancelled_cheque_no:x.cancelled_cheque_no||"",financer_name:x.financer_name||"",
        vehicle_reg_no:x.vehicle_reg_no||"",ledger_no:x.ledger_no||"",chassis_record_no:x.chassis_record_no||"",
        voucher_no:x.voucher_no||"",subsidy_amount:num(x.subsidy_amount),do_no:x.do_no||"",
        insurance_amount:num(x.insurance_amount),registration_amount:num(x.registration_amount),discount:num(x.discount)
      }});
    }
    if(p==="credit-notes"){
      await ensureCreditDebitSchema();
      const r=await pool.query(`SELECT cn.*,ti.bill_no AS invoice_bill_no,COALESCE(cn.original_bill_no,ti.bill_no) AS original_bill_no,COALESCE(cn.dealer_name,ti.dealer_name) AS dealer_name,COALESCE(cn.buyer_name,ti.buyer_name) AS buyer_name,COALESCE(cn.chassis_no,ti.chassis_no) AS chassis_no FROM credit_note cn LEFT JOIN tax_invoice ti ON ti.id=cn.tax_invoice_id ORDER BY cn.date DESC,cn.id DESC LIMIT 1000`);
      return Response.json({credit_notes:r.rows,rows:r.rows,data:r.rows});
    }
    if(p==="debit-notes"){
      await ensureCreditDebitSchema();const r=await pool.query("SELECT * FROM debit_note ORDER BY date DESC,id DESC LIMIT 1000");
      return Response.json({debit_notes:r.rows,rows:r.rows,data:r.rows});
    }
    if(p==="repair-service-masters"){
      await ensureRepairSchema();await ensureTaxInvoiceVehicleNoColumn();const u=new URL(req.url),vehicleNo=String(u.searchParams.get("vehicle_no")||"").trim();
      // Vehicle No. ko space/hyphen/case hata kar compare karo: DL5ERB0160 = DL 5E RB 0160 = dl-5e-rb-0160.
      const regNorm=vehicleNo.toUpperCase().replace(/[^A-Z0-9]/g,"");
      const vr=await pool.query(`SELECT v.id AS vehicle_id,COALESCE(to_jsonb(v)->>'vehicle_no',to_jsonb(v)->>'vehicle_reg_no',to_jsonb(v)->>'registration_no','') AS vehicle_no,COALESCE(v.chassis_no,'') AS chassis_no,COALESCE(to_jsonb(ti)->>'buyer_name','') AS customer_name,COALESCE(to_jsonb(ti)->>'buyer_mobile',to_jsonb(ti)->>'customer_mobile','') AS customer_mobile FROM vehicle v LEFT JOIN LATERAL (SELECT * FROM tax_invoice x WHERE x.vehicle_id=v.id AND COALESCE(x.cancelled,false)=false ORDER BY x.date DESC,x.id DESC LIMIT 1) ti ON true WHERE ($1='' OR regexp_replace(upper(COALESCE(to_jsonb(v)->>'vehicle_no',to_jsonb(v)->>'vehicle_reg_no',to_jsonb(v)->>'registration_no','')),'[^A-Z0-9]','','g')=$1) ORDER BY v.id DESC LIMIT 100`,[regNorm]);
      // Vehicle No. Tax Invoice (Vehicle No. tab / bill) mein bhi dhoondo; wahi customer + chassis pehle dikhao.
      let vehicleRows:any[]=vr.rows;
      if(regNorm){
        const tr=await pool.query(`SELECT COALESCE(ti.vehicle_id,0) AS vehicle_id,ti.vehicle_reg_no AS vehicle_no,COALESCE(NULLIF(btrim(ti.chassis_no),''),v.chassis_no,'') AS chassis_no,COALESCE(ti.buyer_name,'') AS customer_name,COALESCE(to_jsonb(ti)->>'buyer_mobile',to_jsonb(ti)->>'customer_mobile','') AS customer_mobile FROM tax_invoice ti LEFT JOIN vehicle v ON v.id=ti.vehicle_id WHERE COALESCE(ti.cancelled,false)=false AND regexp_replace(upper(COALESCE(ti.vehicle_reg_no,'')),'[^A-Z0-9]','','g')=$1 ORDER BY ti.date DESC,ti.id DESC LIMIT 20`,[regNorm]);
        const seen=new Set<string>();
        vehicleRows=[...tr.rows,...vr.rows].filter((x:any)=>{const k=String(x.chassis_no||"")||("id"+x.vehicle_id);if(seen.has(k))return false;seen.add(k);return true;});
      }
      const products=await pool.query(`SELECT p.id,p.name,p.code,p.unit,p.fro,p.product_category,p.show_on_delivery_challan,COALESCE((SELECT SUM(CASE WHEN UPPER(COALESCE(js.work_type,''))='OUT' THEN -ABS(js.qty) WHEN UPPER(COALESCE(js.work_type,''))='IN' THEN ABS(js.qty) ELSE js.qty END) FROM journal_stock js WHERE lower(trim(js.item_name))=lower(trim(p.name))),0) AS stock_qty FROM product p WHERE p.fro='R' OR (UPPER(COALESCE(p.product_category,''))='DISPATCH' AND COALESCE(p.show_on_delivery_challan,false)=true) ORDER BY CASE WHEN UPPER(COALESCE(p.product_category,''))='DISPATCH' THEN 2 ELSE 1 END,p.name`);
      return Response.json({vehicles:vehicleRows,items:products.rows,raw_items:products.rows.filter((x:any)=>x.fro==='R'),dispatch_items:products.rows.filter((x:any)=>String(x.product_category||'').toUpperCase()==='DISPATCH')});
    }
    if(p==="repair-service-vouchers"){
      await ensureRepairSchema();const status=String(new URL(req.url).searchParams.get("status")||"").trim().toUpperCase(),args:any[]=[],w:string[]=[];
      if(status){args.push(status);w.push("CASE WHEN v.balance_amount>0 THEN 'PENDING' ELSE 'PAID' END=$"+args.length);}
      const r=await pool.query("SELECT v.* FROM repair_service_voucher v"+(w.length?" WHERE "+w.join(" AND "):"")+" ORDER BY v.date DESC,v.id DESC LIMIT 1000",args);
      return Response.json({vouchers:r.rows,rows:r.rows});
    }
    if(p==="repair-service-receipts"){
      await ensureRepairSchema();const r=await pool.query("SELECT r.*,v.voucher_no,v.customer_name,v.vehicle_no FROM repair_service_payment_receipt r LEFT JOIN repair_service_voucher v ON v.id=r.voucher_id ORDER BY r.date DESC,r.id DESC LIMIT 1000");
      return Response.json({receipts:r.rows,rows:r.rows});
    }
    if(p==="journal-stock"){
      // Journal Stock screen ko records + paging chahiye (generic list sirf rows deti thi, isliye page crash hota tha).
      const u=new URL(req.url),page=Math.max(1,Math.trunc(num(u.searchParams.get("page"))||1)),per=Math.min(200,Math.max(1,Math.trunc(num(u.searchParams.get("per_page"))||50))),search=String(u.searchParams.get("search")||"").trim();
      const jc=await columns("journal_stock"),args:any[]=[],w:string[]=[];
      if(jc.has("item_type"))w.push("UPPER(COALESCE(item_type,'R'))='R'");
      if(search){args.push("%"+search+"%");const n="$"+args.length;w.push("("+["item_name","model_name","vou_no","reason"].filter(c=>jc.has(c)).map(c=>"COALESCE("+c+"::text,'') ILIKE "+n).join(" OR ")+")");}
      args.push(per+1,(page-1)*per);
      const r=await pool.query("SELECT * FROM journal_stock"+(w.length?" WHERE "+w.join(" AND "):"")+" ORDER BY date DESC NULLS LAST,id DESC LIMIT $"+(args.length-1)+" OFFSET $"+args.length,args);
      const has_next=r.rows.length>per,records=r.rows.slice(0,per);
      return Response.json({records,rows:records,page,per_page:per,has_next,suggested_vou_no:"JS-"+Date.now()});
    }
    if(p==="masters/colour"){
      const r=await pool.query("SELECT * FROM simple_master WHERE lower(kind) IN ('colour','color') ORDER BY id DESC");
      return Response.json({masters:r.rows,rows:r.rows,data:r.rows});
    }
    if(p.startsWith("hr/")){
      await ensureHRSchemas();
    if(p==="hr/employees"){
        const r=await pool.query("SELECT * FROM hr_employee ORDER BY id DESC");
        return Response.json({employees:r.rows,rows:r.rows});
      }
      if(p==="hr/attendance"){
        const month=String(new URL(req.url).searchParams.get("month")||"").trim();
        const r=await pool.query("SELECT a.*,e.employee_code,e.name AS employee_name FROM hr_attendance a JOIN hr_employee e ON e.id=a.employee_id WHERE ($1='' OR to_char(a.work_date,'YYYY-MM')=$1) ORDER BY a.work_date DESC,a.id DESC",[month]);
        return Response.json({attendance:r.rows,rows:r.rows});
      }
      if(p==="hr/salary"){
        const month=String(new URL(req.url).searchParams.get("month")||"").trim();
        const r=await pool.query("SELECT s.*,e.employee_code,e.name AS employee_name FROM hr_salary s JOIN hr_employee e ON e.id=s.employee_id WHERE ($1='' OR s.salary_month=$1) ORDER BY e.name",[month]);
        return Response.json({salaries:r.rows,rows:r.rows});
      }
    }
    if(p==="admin/nav-tabs"){
      const r=await pool.query("SELECT * FROM nav_tab ORDER BY position,id");
      return Response.json(r.rows);
    }
    if(p==="menu"){const r=await pool.query("SELECT * FROM nav_tab ORDER BY id");return Response.json({menu:r.rows,tabs:r.rows});}
    if(p==="reports/ledger"){
      const u=new URL(req.url),dealerId=idOf(u.searchParams.get("dealer_id")),from=String(u.searchParams.get("from")||"").trim(),to=String(u.searchParams.get("to")||"").trim(),search=String(u.searchParams.get("search")||"").trim().toLowerCase();
      const dealerCols=await columns("dealer");
      const dealerWhere=dealerCols.has("blocked")?" WHERE COALESCE(blocked,false)=false":"";
      const dealers=(await pool.query("SELECT id,name FROM dealer"+dealerWhere+" ORDER BY name,id")).rows;
      const dealerNameMap=new Map(dealers.map((d:any)=>[Number(d.id),String(d.name||"").trim().toLowerCase()]));
      const tiCols=await columns("tax_invoice"),dbCols=await columns("day_book");
      const invoices=tiCols.size?(await pool.query("SELECT * FROM tax_invoice WHERE COALESCE(cancelled,false)=false ORDER BY date ASC,id ASC LIMIT 20000")).rows:[];
      const daybook=dbCols.size?(await pool.query("SELECT * FROM day_book ORDER BY date ASC,id ASC LIMIT 20000")).rows:[];
      const dealerMatch=(x:any,did:number)=>{
        const rid=Number(x.dealer_id||0);
        if(rid)return rid===did;
        const target=dealerNameMap.get(did)||"";
        const party=String(x.dealer_name||x.party_name||x.account_name||x.account||"").trim().toLowerCase();
        return Boolean(target)&&party===target;
      };
      const textOf=(x:any)=>[x.bill_no,x.voucher_no,x.doc_no,x.party_name,x.dealer_name,x.buyer_name,x.chassis_no,x.narration,x.particulars,x.description].filter(Boolean).join(" ").toLowerCase();
      const inRange=(x:any)=>{const d=ymd(x.date);return (!from||d>=from)&&(!to||d<=to)&&(!search||textOf(x).includes(search));};
      let shopExpenseRows:any[]=[];
      try{await ensureDealerCashSchema();shopExpenseRows=(await pool.query("SELECT * FROM dealer_cash_expense ORDER BY date ASC,id ASC LIMIT 20000")).rows;}catch(e){console.error("[ledger shop expenses]",e)}
      const shopExpenseEvents=(did:number)=>shopExpenseLedgerEvents(shopExpenseRows.filter((x:any)=>Number(x.dealer_id)===did)).filter((x:any)=>inRange(x));
      const saleEvents=(did:number)=>invoices.filter((x:any)=>dealerMatch(x,did)&&inRange(x)).map((x:any)=>({
        record_type:"sale",record_id:x.id,date:x.date,doc_no:x.bill_no||x.voucher_no||"",account:x.buyer_name||"Sale",
        lines:[x.product_name,x.chassis_no].filter(Boolean),
        debit:Math.max(0,num(x.sale_amount)-num(x.hypothecation_amount)),credit:0,vr_type:"S"
      }));
      const receiptEvents=(did:number)=>daybook.filter((x:any)=>dealerMatch(x,did)&&inRange(x)).map((x:any)=>({
        record_type:"receipt",record_id:x.id,date:x.date,doc_no:x.voucher_no||x.doc_no||x.bill_no||"",
        account:x.party_name||x.account_name||x.account||dealerNameMap.get(did)||"Day Book",
        lines:[x.narration||x.particulars||x.description||""].filter(Boolean),
        debit:num(x.debit||x.dr_amount||x.debit_amount||x.debit_paid),
        credit:num(x.credit||x.cr_amount||x.credit_amount||x.credit_received),vr_type:"R"
      })).filter((x:any)=>x.debit||x.credit);
      if(!dealerId){
        const summary=dealers.map((d:any)=>{
          const ev=[...saleEvents(Number(d.id)),...receiptEvents(Number(d.id)),...shopExpenseEvents(Number(d.id))];
          const balance=ev.reduce((s:number,x:any)=>s+num(x.debit)-num(x.credit),0);
          return {dealer_id:d.id,dealer_name:d.name,balance,dc:balance>=0?"Dr":"Cr"};
        });
        return Response.json({summary,dealers,events:[],rows:[],count:summary.length});
      }
      const selected=dealers.find((d:any)=>Number(d.id)===dealerId);
      if(!selected)return Response.json({error:"Dealer not found."},{status:404});
      const events=[...saleEvents(dealerId),...receiptEvents(dealerId),...shopExpenseEvents(dealerId)].sort((a:any,b:any)=>{
        const da=String(a.date||""),db=String(b.date||"");return da.localeCompare(db)||Number(a.record_id||0)-Number(b.record_id||0);
      });      let running=0;
      const out=events.map((x:any)=>{running+=num(x.debit)-num(x.credit);return {...x,balance:Math.abs(running),dc:running>=0?"Dr":"Cr"};});
      return Response.json({summary:[],dealers,events:out,rows:out,count:out.length});
    }
    if(p==="reports/ledger-v"){
      const u=new URL(req.url),dealerId=idOf(u.searchParams.get("dealer_id")),from=String(u.searchParams.get("from")||"").trim(),to=String(u.searchParams.get("to")||"").trim(),search=String(u.searchParams.get("search")||"").trim().toLowerCase();
      const dealerCols=await columns("dealer"),dealerWhere=dealerCols.has("blocked")?" WHERE COALESCE(blocked,false)=false":"";
      const dealers=(await pool.query("SELECT id,name FROM dealer"+dealerWhere+" ORDER BY name,id")).rows;
      const tiCols=await columns("tax_invoice"),dbCols=await columns("day_book");
      const invoices=tiCols.size?(await pool.query("SELECT * FROM tax_invoice WHERE COALESCE(cancelled,false)=false ORDER BY date ASC,id ASC LIMIT 20000")).rows:[];
      const daybook=dbCols.size?(await pool.query("SELECT * FROM day_book ORDER BY date ASC,id ASC LIMIT 20000")).rows:[];
      const dealerNameMap=new Map(dealers.map((d:any)=>[Number(d.id),String(d.name||"").trim().toLowerCase()]));
      const match=(x:any,did:number)=>{
        const rid=Number(x.dealer_id||0); if(rid)return rid===did;
        const target=dealerNameMap.get(did)||"";
        return Boolean(target)&&String(x.dealer_name||x.party_name||x.account_name||x.account||"").trim().toLowerCase()===target;
      };
      const build=(did:number)=>{
        const textV=(x:any)=>[x.bill_no,x.voucher_no,x.doc_no,x.party_name,x.dealer_name,x.buyer_name,x.chassis_no,x.narration,x.particulars,x.description].filter(Boolean).join(" ").toLowerCase();
        const inv=invoices.filter((x:any)=>match(x,did)&&(!from||String(x.date||"").slice(0,10)>=from)&&(!to||String(x.date||"").slice(0,10)<=to)&&(!search||textV(x).includes(search)));
        const db=daybook.filter((x:any)=>match(x,did)&&(!from||String(x.date||"").slice(0,10)>=from)&&(!to||String(x.date||"").slice(0,10)<=to)&&(!search||textV(x).includes(search)));
        const events:any[]=[];
        for(const x of inv){
          const received=num(x.amount_received);
          if(!received)continue;
          events.push({date:x.date,doc_no:x.bill_no||"",particulars:"Tax Invoice — "+(x.buyer_name||"Sale"),voucher_no:x.voucher_no||"",bill_no:x.bill_no||"",chassis_no:x.chassis_no||"",customer:x.buyer_name||"",receipt:0,amount_received:received,_kind:"invoice",_id:x.id});
        }
        for(const x of db){
          const receipt=num(x.credit_received||x.credit||x.cr_amount||x.credit_amount);
          if(!receipt)continue;
          events.push({date:x.date,doc_no:x.voucher_no||x.doc_no||"",particulars:x.narration||x.particulars||"Day Book Receipt",voucher_no:x.voucher_no||"",bill_no:x.bill_no||"",chassis_no:x.chassis_no||"",customer:x.party_name||x.account_name||"",receipt,amount_received:0,_kind:"receipt",_id:x.id});
        }
        events.sort((a,b)=>String(a.date||"").localeCompare(String(b.date||""))||Number(a._id||0)-Number(b._id||0));
        let running=0; return events.map(e=>({...e,balance:(running+=num(e.amount_received)-num(e.receipt))}));
      };
      if(!dealerId){
        const summary=dealers.map((d:any)=>{const events=build(Number(d.id));return {dealer_id:d.id,dealer_name:d.name,total:events.reduce((s:number,e:any)=>s+num(e.amount_received),0)};});
        return Response.json({summary,dealers,events:[],rows:[],count:summary.length});
      }
      const selected=dealers.find((d:any)=>Number(d.id)===dealerId);
      if(!selected)return Response.json({error:"Dealer not found."},{status:404});
      const events=build(dealerId).map((e:any)=>{const {_kind,_id,...rest}=e;return rest;});
      return Response.json({summary:[],dealers,events,rows:events,count:events.length});
    }
    // Vehicle No. register: one row per live Tax Invoice; only vehicle_reg_no is editable (PUT vehicle-no-register/:id).
    if(p==="vehicle-no-register"){
      await ensureTaxInvoiceVehicleNoColumn();
      const u=new URL(req.url),args:any[]=[]; const {w,search}=dateWhere("ti",u,args);
      if(search){args.push("%"+search+"%");const n=args.length;w.push("(COALESCE(ti.bill_no,'') ILIKE $"+n+" OR COALESCE(ti.buyer_name,'') ILIKE $"+n+" OR COALESCE(ti.chassis_no,'') ILIKE $"+n+" OR COALESCE(ti.dealer_name,'') ILIKE $"+n+" OR COALESCE(ti.product_name,'') ILIKE $"+n+" OR COALESCE(ti.vehicle_reg_no,'') ILIKE $"+n+")");}
      w.push("COALESCE(ti.cancelled,false)=false");
      const r=await pool.query("SELECT ti.id,ti.date,ti.bill_no,ti.buyer_name,ti.chassis_no,ti.dealer_name,ti.product_name,COALESCE(ti.vehicle_reg_no,'') AS vehicle_reg_no FROM tax_invoice ti WHERE "+w.join(" AND ")+" ORDER BY ti.date DESC,ti.id DESC LIMIT 5000",args);
      return Response.json({rows:r.rows,invoices:r.rows});
    }
    if(p==="reports/sale-register"||p==="reports/gst-register"||p==="reports/hypothecation-register"||p==="reports/subsidy"){
      const u=new URL(req.url),args:any[]=[]; const {w,search}=dateWhere("ti",u,args);
      if(search){args.push("%"+search+"%");w.push("(COALESCE(ti.bill_no,'') ILIKE $"+args.length+" OR COALESCE(ti.buyer_name,'') ILIKE $"+args.length+" OR COALESCE(ti.chassis_no,'') ILIKE $"+args.length+")");}
      w.push("COALESCE(ti.cancelled,false)=false");
      const where=w.length?" WHERE "+w.join(" AND "):"";
      // GST split/total fields are computed properties in the legacy model,
      // not persisted columns in tax_invoice. Compute them from state_type,
      // gst_rate and the stored taxable components directly in SQL.
      const base=`SELECT ti.id,ti.date,ti.bill_no,ti.buyer_name,ti.product_name,ti.chassis_no,ti.financer_name,ti.dealer_name,ti.amount_received,ti.sale_amount,ti.hypothecation_amount,ti.subsidy_amount,
        GREATEST(COALESCE(ti.gst_sale_amount,ti.sale_amount,0)-COALESCE(ti.discount,0),0) AS taxable_value,
        CASE WHEN COALESCE(NULLIF(UPPER(TRIM(ti.state_type)),''),'I')='I'
          THEN GREATEST(COALESCE(ti.gst_sale_amount,ti.sale_amount,0)-COALESCE(ti.discount,0),0)*COALESCE(ti.gst_rate,0)/200
          ELSE 0 END AS cgst_amount,
        CASE WHEN COALESCE(NULLIF(UPPER(TRIM(ti.state_type)),''),'I')='I'
          THEN GREATEST(COALESCE(ti.gst_sale_amount,ti.sale_amount,0)-COALESCE(ti.discount,0),0)*COALESCE(ti.gst_rate,0)/200
          ELSE 0 END AS sgst_amount,
        CASE WHEN COALESCE(NULLIF(UPPER(TRIM(ti.state_type)),''),'I')='I'
          THEN 0
          ELSE GREATEST(COALESCE(ti.gst_sale_amount,ti.sale_amount,0)-COALESCE(ti.discount,0),0)*COALESCE(ti.gst_rate,0)/100
        END AS igst_amount,
        GREATEST(COALESCE(ti.gst_sale_amount,ti.sale_amount,0)-COALESCE(ti.discount,0),0)
          + GREATEST(COALESCE(ti.gst_sale_amount,ti.sale_amount,0)-COALESCE(ti.discount,0),0)*COALESCE(ti.gst_rate,0)/100
          + COALESCE(ti.insurance_amount,0) + COALESCE(ti.registration_amount,0) AS bill_total
        FROM tax_invoice ti`;
      const r=await pool.query(base+where+" ORDER BY ti.date DESC,ti.id DESC",args);
      const rows=r.rows.map((x:any)=>({...x,tax_amount:num(x.cgst_amount)+num(x.sgst_amount)+num(x.igst_amount)}));
      if(p==="reports/hypothecation-register"){
        await ensureHypReceiptSchema();
        const hypRows=rows.filter((x:any)=>num(x.hypothecation_amount)>0),ids=hypRows.map((x:any)=>Number(x.id));
        const recQ=ids.length?await pool.query("SELECT tax_invoice_id,SUM(amount) AS s FROM hypothecation_receipt WHERE tax_invoice_id=ANY($1::bigint[]) GROUP BY tax_invoice_id",[ids]):{rows:[] as any[]};
        const vehQ=ids.length?await pool.query("SELECT id,COALESCE(to_jsonb(ti)->>'vehicle_reg_no','') AS v FROM tax_invoice ti WHERE id=ANY($1::bigint[])",[ids]):{rows:[] as any[]};
        const recMap=new Map<number,number>(recQ.rows.map((x:any)=>[Number(x.tax_invoice_id),num(x.s)]));
        const vehMap=new Map<number,string>(vehQ.rows.map((x:any)=>[Number(x.id),String(x.v||"")]));
        const invoices=hypRows.map((x:any)=>{const fr=recMap.get(Number(x.id))||0;return {...x,vehicle_no:vehMap.get(Number(x.id))||"",fin_received:fr,balance_amount:Math.max(0,num(x.hypothecation_amount)-fr)};});
        if(u.searchParams.get("export")==="csv")return csvResponse(invoices.map((x:any)=>({date:x.date,bill_no:x.bill_no,dealer_name:x.dealer_name,buyer_name:x.buyer_name,chassis_no:x.chassis_no,vehicle_no:x.vehicle_no,financer_name:x.financer_name,hypothecation_amount:x.hypothecation_amount,financer_received:x.fin_received,balance_amount:x.balance_amount})),"Hypothecation_Register.csv");
        const total_hyp=invoices.reduce((t:number,x:any)=>t+num(x.hypothecation_amount),0),total_received=invoices.reduce((t:number,x:any)=>t+num(x.fin_received),0);
        return Response.json({invoices,total_hyp,total_received,total_balance:invoices.reduce((t:number,x:any)=>t+num(x.balance_amount),0),rows:invoices});
      }
      if(u.searchParams.get("export")==="csv")return csvResponse(rows,p==="reports/gst-register"?"GST_Register.csv":p==="reports/sale-register"?"Sale_Register.csv":p==="reports/hypothecation-register"?"Hypothecation_Register.csv":"Subsidy_Report.csv");
      if(p==="reports/gst-register"){
        const inwardRaw=await pool.query("SELECT pb.id,pb.date,pb.bill_no AS doc_no,pb.party_name,pb.party_state_code,pb.items FROM purchase_bill pb ORDER BY pb.date DESC,pb.id DESC");
        const inward={rows:inwardRaw.rows.map((x:any)=>{const t=purchaseBillTotals(x);return {id:x.id,date:x.date,doc_no:x.doc_no,party_name:x.party_name,...t,total:t.taxable+t.cgst+t.sgst+t.igst}})};
        const ot=rows.reduce((a:any,x:any)=>(a.taxable+=num(x.taxable_value),a.cgst+=num(x.cgst_amount),a.sgst+=num(x.sgst_amount),a.igst+=num(x.igst_amount),a),{taxable:0,cgst:0,sgst:0,igst:0});
        const it=inward.rows.reduce((a:any,x:any)=>(a.taxable+=num(x.taxable),a.cgst+=num(x.cgst),a.sgst+=num(x.sgst),a.igst+=num(x.igst),a),{taxable:0,cgst:0,sgst:0,igst:0});
        return Response.json({outward:rows,outward_totals:ot,inward:inward.rows,inward_totals:it});
      }
      if(p==="reports/subsidy")return Response.json({invoices:rows.filter((x:any)=>num(x.subsidy_amount)!==0),total_subsidy:rows.reduce((s:number,x:any)=>s+num(x.subsidy_amount),0)});
      const page=Math.max(1,num(u.searchParams.get("page"))||1),per=Math.min(200,Math.max(1,num(u.searchParams.get("per_page"))||50)),start=(page-1)*per;
      const pageRows=rows.slice(start,start+per),totals=rows.reduce((a:any,x:any)=>(a.taxable+=num(x.taxable_value),a.tax+=num(x.tax_amount),a.total+=num(x.bill_total),a),{taxable:0,tax:0,total:0});
      return Response.json({invoices:pageRows,rows:pageRows,page,per_page:per,total:rows.length,total_pages:Math.max(1,Math.ceil(rows.length/per)),totals});
    }
    if(p==="reports/production-register"){
      const u=new URL(req.url),args:any[]=[]; const {w,search}=dateWhere("v",u,args);
      const status=u.searchParams.get("status")||"all";
      if(search){args.push("%"+search+"%");w.push("(COALESCE(v.vou_no,'') ILIKE $"+args.length+" OR COALESCE(v.chassis_no,'') ILIKE $"+args.length+" OR COALESCE(v.product_name,'') ILIKE $"+args.length+")");}
      if(status==="factory")w.push("COALESCE(vh.stage,'Manufacturing')='Manufacturing'");
      if(status==="delivered")w.push("COALESCE(vh.stage,'Manufacturing')<>'Manufacturing'");
      const where=w.length?" WHERE "+w.join(" AND "):"";
      const r=await pool.query("SELECT v.*,COALESCE(vh.stage,'Manufacturing') AS stage FROM production_voucher v LEFT JOIN vehicle vh ON vh.chassis_no=v.chassis_no"+where+" ORDER BY v.date DESC,v.id DESC",args);
      if(u.searchParams.get("export")==="csv")return csvResponse(r.rows,"Production_Register.csv");
      const page=Math.max(1,num(u.searchParams.get("page"))||1),per=Math.min(200,Math.max(1,num(u.searchParams.get("per_page"))||50)),start=(page-1)*per;
      return Response.json({rows:r.rows.slice(start,start+per),page,per_page:per,total:r.rowCount,total_pages:Math.max(1,Math.ceil(r.rowCount/per))});
    }
    if(p==="reports/purchase-register"){
      const u=new URL(req.url),args:any[]=[]; const {w,search}=dateWhere("pb",u,args);
      if(search){args.push("%"+search+"%");w.push("(COALESCE(pb.bill_no,'') ILIKE $"+args.length+" OR COALESCE(pb.party_name,'') ILIKE $"+args.length+")");}
      const where=w.length?" WHERE "+w.join(" AND "):"";
      const raw=await pool.query("SELECT pb.* FROM purchase_bill pb"+where+" ORDER BY pb.date DESC,pb.id DESC",args);
      const rows=raw.rows.map((pb:any)=>{
        const parsed=parseItems(pb.items);
        const firstNum=(...vals:any[])=>{for(const v of vals){if(v===null||v===undefined||v==="")continue;const n0=Number(v);if(Number.isFinite(n0)&&n0!==0)return n0;}return 0;};
        const state=String(pb.party_state_code||pb.state_code||"07").trim();
        let items=parsed.map((it:any)=>{
          const qty=firstNum(it.qty,it.quantity);
          const rate=firstNum(it.rate,it.unit_rate,it.price);
          const taxable=firstNum(it.taxable_amt,it.taxable_amount,it.taxable,it.subtotal,qty*rate);
          const gstRate=firstNum(it.gst_rate,it.gst_percent);
          const gst=firstNum(it.gst_amount,it.tax_amount,it.gst,taxable*gstRate/100);
          const intra=state==="07" || state.toUpperCase()==="07";
          const cgst=firstNum(it.cgst_amt,it.cgst,it.tax_cgst,intra?gst/2:0);
          const sgst=firstNum(it.sgst_amt,it.sgst,it.tax_sgst,intra?gst/2:0);
          const igst=firstNum(it.igst_amt,it.igst,it.tax_igst,!intra?gst:0);
          const total=firstNum(it.total_amt,it.total_amount,it.amount,taxable+gst);
          return {...it,qty,rate,taxable_amt:taxable,gst_amount:gst,cgst_amt:cgst,sgst_amt:sgst,igst_amt:igst,total_amt:total};
        });
        // Legacy purchase rows may have all financial values on the header and
        // an empty/missing items JSON. Preserve those values instead of showing 0.
        const headerQty=firstNum(pb.total_qty,pb.qty,pb.quantity,pb.item_qty,pb.units,purchaseLegacyNum(pb,[/^(total_)?qty$/,/quantity/,/^units$/],[/amount|rate|price/]));
        const headerTaxable=firstNum(pb.taxable_total,pb.taxable_amt,pb.taxable_amount,pb.taxable,pb.subtotal,pb.amount_before_tax,pb.taxable_value,pb.net_amount,purchaseLegacyNum(pb,[/(taxable|subtotal|sub_total|before_tax|net_amount)/],[/(rate|percent|gst_rate)/]));
        const headerCgst=firstNum(pb.cgst_total,pb.cgst_amt,pb.cgst,pb.tax_cgst,pb.cgst_amount,purchaseLegacyNum(pb,[/cgst/]));
        const headerSgst=firstNum(pb.sgst_total,pb.sgst_amt,pb.sgst,pb.tax_sgst,pb.sgst_amount,purchaseLegacyNum(pb,[/sgst/]));
        const headerIgst=firstNum(pb.igst_total,pb.igst_amt,pb.igst,pb.tax_igst,pb.igst_amount,purchaseLegacyNum(pb,[/igst/]));
        const headerTax=firstNum(pb.tax_total,pb.tax_amt,pb.tax_amount,pb.gst_total,pb.gst_amount,pb.total_tax,pb.gst_amount_total,purchaseLegacyNum(pb,[/tax_total|tax_amount|total_tax|gst_total|gst_amount/],[/rate|percent/]));
        const headerTotal=firstNum(pb.bill_total,pb.total_amt,pb.total_amount,pb.grand_total,pb.amount,pb.net_total,pb.invoice_total,pb.total,purchaseLegacyNum(pb,[/(grand|bill|invoice|net).*total$/,/total.*(amount|value)/,/^total$/],[/(tax|qty|quantity|rate|percent)/]));
        if(!items.length && (headerQty||headerTaxable||headerCgst||headerSgst||headerIgst||headerTax||headerTotal)){
          const tax=headerTax || headerCgst+headerSgst+headerIgst;
          const taxable=headerTaxable || Math.max(0,headerTotal-tax);
          items=[{item_name:pb.item_name||pb.description||"Purchase",qty:headerQty,rate:headerQty?taxable/headerQty:taxable,taxable_amt:taxable,gst_amount:tax,cgst_amt:headerCgst,sgst_amt:headerSgst,igst_amt:headerIgst,total_amt:headerTotal||taxable+tax}];
        }
        let taxable_amt=items.reduce((s:number,x:any)=>s+num(x.taxable_amt),0);
        let cgst_amt=items.reduce((s:number,x:any)=>s+num(x.cgst_amt),0);
        let sgst_amt=items.reduce((s:number,x:any)=>s+num(x.sgst_amt),0);
        let igst_amt=items.reduce((s:number,x:any)=>s+num(x.igst_amt),0);
        let total_amt=items.reduce((s:number,x:any)=>s+num(x.total_amt),0);
        let total_qty=items.reduce((s:number,x:any)=>s+num(x.qty),0);
        // Header totals take precedence when the stored item lines are incomplete.
        taxable_amt=taxable_amt||headerTaxable;
        cgst_amt=cgst_amt||headerCgst;
        sgst_amt=sgst_amt||headerSgst;
        igst_amt=igst_amt||headerIgst;
        total_qty=total_qty||headerQty;
        total_amt=total_amt||headerTotal||(taxable_amt+cgst_amt+sgst_amt+igst_amt);
        const tax_total=cgst_amt+sgst_amt+igst_amt || headerTax;
        const extra_total=purchaseExtraTotal(pb.extra_charges);
        return {...pb,items,taxable_amt,cgst_amt,sgst_amt,igst_amt,tax_total,total_amt:total_amt+extra_total,extra_total,total_qty,item_count:items.length};
      });
      if(u.searchParams.get("export")==="csv")return csvResponse(rows,"Purchase_Register.csv");
      const page=Math.max(1,num(u.searchParams.get("page"))||1),per=Math.min(200,Math.max(1,num(u.searchParams.get("per_page"))||50)),start=(page-1)*per;
      const pageRows=rows.slice(start,start+per),totals=pageRows.reduce((a:any,x:any)=>(a.taxable+=num(x.taxable_amt),a.cgst+=num(x.cgst_amt),a.sgst+=num(x.sgst_amt),a.igst+=num(x.igst_amt),a.qty+=num(x.total_qty),a.total+=num(x.total_amt),a),{taxable:0,cgst:0,sgst:0,igst:0,qty:0,total:0});
      return Response.json({rows:pageRows,page,per_page:per,total:rows.length,total_pages:Math.max(1,Math.ceil(rows.length/per)),totals});
    }
    if(/^tax-invoices\/\d+$/.test(p)){
      const id=idOf(path[path.length-1]);if(!id)return Response.json({error:"Tax Invoice id required."},{status:400});
      const r=await pool.query("SELECT ti.*,"+TI_CALC+" FROM tax_invoice ti WHERE ti.id=$1",[id]);
      if(!r.rowCount)return Response.json({error:"Tax Invoice not found."},{status:404});
      return Response.json(r.rows[0]);
    }
    if(p==="tax-invoices"){
      const u=new URL(req.url),args:any[]=[],w:string[]=[];
      const search=String(u.searchParams.get("search")||"").trim();
      if(search){args.push("%"+search+"%");w.push("(COALESCE(ti.bill_no,'') ILIKE $1 OR COALESCE(ti.buyer_name,'') ILIKE $1 OR COALESCE(ti.chassis_no,'') ILIKE $1 OR COALESCE(ti.motor_no,'') ILIKE $1)");}
      const where=w.length?" WHERE "+w.join(" AND "):"";
      const page=Math.max(1,num(u.searchParams.get("page"))||1),per=Math.min(200,Math.max(1,num(u.searchParams.get("per_page"))||50)),start=(page-1)*per;
      // Only the requested page is read from the DB (was: whole 16k+ table fetched, sorted and sliced in JS).
      // Un-invoiced challans are needed once for the "New Tax Invoice" form, not on every page/search click.
      const wantChallans=u.searchParams.get("challans")!=="0";
      const [pg,cnt,challans]=await Promise.all([
        pool.query("SELECT ti.*,"+TI_CALC+" FROM tax_invoice ti"+where+" ORDER BY ti.date DESC,ti.id DESC LIMIT "+per+" OFFSET "+start,args),
        pool.query("SELECT COUNT(*)::int AS n FROM tax_invoice ti"+where,args),
        wantChallans?pool.query("SELECT dc.*,d.name AS dealer_name,v.battery_maker,v.battery_no1,v.battery_no2,v.battery_no3,v.battery_no4 FROM delivery_challan dc LEFT JOIN dealer d ON d.id=dc.dealer_id LEFT JOIN vehicle v ON v.id=dc.vehicle_id WHERE COALESCE(dc.cancelled,false)=false AND NOT EXISTS (SELECT 1 FROM tax_invoice ti WHERE ti.delivery_challan_id=dc.id AND COALESCE(ti.cancelled,false)=false) ORDER BY dc.date DESC,dc.id DESC LIMIT 1000"):Promise.resolve(null)
      ]);
      const invoices=pg.rows,total=cnt.rows[0]?.n||0;
      const out:any={invoices,rows:invoices,data:invoices,page,per_page:per,total,total_pages:Math.max(1,Math.ceil(total/per))};
      if(challans)out.uninvoiced_challans=challans.rows;
      return Response.json(out);
    }
    if(p==="factory-check-reports"){
      await ensureFactoryCheckSchema();
      const u=new URL(req.url),status=String(u.searchParams.get("status")||"all"),search=String(u.searchParams.get("search")||"").trim(),args:any[]=[],w:string[]=[];
      if(status!=="all"){args.push(status.toUpperCase());w.push("f.status=$"+args.length);}
      if(search){args.push("%"+search+"%");w.push("(COALESCE(f.product_name,'') ILIKE $"+args.length+" OR COALESCE(pv.vou_no,'') ILIKE $"+args.length+" OR COALESCE(pv.chassis_no,'') ILIKE $"+args.length+")");}
      const where=w.length?" WHERE "+w.join(" AND "):"";
      const r=await pool.query("SELECT f.*,pv.vou_no,pv.chassis_no,pv.motor_no FROM factory_check_report f JOIN production_voucher pv ON pv.id=f.production_voucher_id"+where+" ORDER BY f.date DESC,f.id DESC",args);
      const ids=r.rows.map((x:any)=>x.id);
      const items=ids.length?await pool.query("SELECT * FROM factory_check_item WHERE report_id=ANY($1::bigint[]) ORDER BY id",[ids]):{rows:[]};
      const grouped:any={};for(const x of items.rows)(grouped[x.report_id] ||= []).push(x);
      return Response.json({reports:r.rows.map((x:any)=>({...x,items:grouped[x.id]||[]})),rows:r.rows,items:items.rows});
    }
    if(p.startsWith("factory-check-reports/") && p.endsWith("/preview")){
      await ensureFactoryCheckSchema();const id=idOf(path[path.length-2]);if(!id)return Response.json({error:"Report id required."},{status:400});
      const r=await pool.query("SELECT f.*,pv.vou_no,pv.chassis_no,pv.motor_no,pv.product_name AS pv_product_name,pv.quantity AS pv_quantity FROM factory_check_report f JOIN production_voucher pv ON pv.id=f.production_voucher_id WHERE f.id=$1",[id]);
      if(!r.rowCount)return Response.json({error:"Factory Check Report not found."},{status:404});
      const items=await pool.query("SELECT * FROM factory_check_item WHERE report_id=$1 ORDER BY id",[id]);
      return Response.json({report:r.rows[0],items:items.rows});
    }
    if(p==="daily-raw-material-checklist"){
      await ensureDailyRawMaterialChecklistSchema();
      const u=new URL(req.url),date=String(u.searchParams.get("date")||"").trim();
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return Response.json({error:"Valid date is required."},{status:400});
      let report=(await pool.query("SELECT * FROM daily_raw_material_checklist WHERE date=$1",[date])).rows[0];
      if(!report){
        const r=await pool.query("INSERT INTO daily_raw_material_checklist(date,status) VALUES($1,'PENDING') RETURNING *",[date]);
        report=r.rows[0];
      }
      if(report.status==="PENDING"){
        const production=await pool.query("SELECT product_name,COALESCE(formula_name,'') AS formula_name,COALESCE(SUM(quantity),0) AS production_qty FROM production_voucher WHERE date=$1 GROUP BY product_name,formula_name ORDER BY product_name,formula_name",[date]);
        const totalQty=production.rows.reduce((s:any,x:any)=>s+num(x.production_qty),0);
        await pool.query("UPDATE daily_raw_material_checklist SET production_qty=$1,updated_at=NOW() WHERE id=$2",[totalQty,report.id]);
        const lines=await pool.query(`SELECT pv.product_name,COALESCE(pv.formula_name,'') AS formula_name,
          COALESCE(SUM(pv.quantity),0) AS production_qty,pf.id AS formula_line_id,pf.raw_item_name,
          pf.qty AS formula_qty_per_unit,pf.unit,
          COALESCE(SUM(pv.quantity*pf.qty),0) AS required_qty
          FROM production_voucher pv
          JOIN production_formula pf ON pf.product_name=pv.product_name
            AND COALESCE(pf.formula_name,'')=COALESCE(pv.formula_name,'')
          WHERE pv.date=$1
          GROUP BY pv.product_name,COALESCE(pv.formula_name,''),pf.id,pf.raw_item_name,pf.qty,pf.unit
          ORDER BY pv.product_name,COALESCE(pv.formula_name,''),pf.id`,[date]);
        for(const line of lines.rows){
          const sourceKey=String(line.product_name||"")+"::"+String(line.formula_name||"")+"::"+String(line.formula_line_id||"");
          await pool.query(`INSERT INTO daily_raw_material_checklist_item
            (checklist_id,source_key,product_name,formula_name,production_qty,raw_item_name,formula_qty_per_unit,required_qty,issued_qty,difference,unit,formula_line_id)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,0,-$8,$9,$10)
            ON CONFLICT(checklist_id,source_key) DO UPDATE SET
              product_name=EXCLUDED.product_name,formula_name=EXCLUDED.formula_name,
              production_qty=EXCLUDED.production_qty,raw_item_name=EXCLUDED.raw_item_name,
              formula_qty_per_unit=EXCLUDED.formula_qty_per_unit,required_qty=EXCLUDED.required_qty,
              unit=EXCLUDED.unit,formula_line_id=EXCLUDED.formula_line_id,updated_at=NOW()`,
            [report.id,sourceKey,line.product_name,line.formula_name,num(line.production_qty),line.raw_item_name,num(line.formula_qty_per_unit),num(line.required_qty),line.unit||"PCS",num(line.formula_line_id)]);
        }
        report=(await pool.query("SELECT * FROM daily_raw_material_checklist WHERE id=$1",[report.id])).rows[0];
      }
      const items=await pool.query("SELECT * FROM daily_raw_material_checklist_item WHERE checklist_id=$1 ORDER BY product_name,formula_name,raw_item_name,id",[report.id]);
      const production=await pool.query("SELECT product_name,COALESCE(formula_name,'') AS formula_name,COALESCE(SUM(quantity),0) AS quantity,COUNT(*)::int AS vouchers FROM production_voucher WHERE date=$1 GROUP BY product_name,formula_name ORDER BY product_name,formula_name",[date]);
      const masters=await pool.query("SELECT id,name FROM product WHERE COALESCE(fro,'')='R' AND COALESCE(name,'')<>'' ORDER BY name,id");
      const formulas=await pool.query("SELECT DISTINCT formula_name,product_name FROM production_formula ORDER BY product_name,formula_name");
      return Response.json({checklist:report,items:items.rows,production:production.rows,raw_materials:masters.rows,formulas:formulas.rows});
    }
    if(p==="factory-check-pending-production"){
      await ensureFactoryCheckSchema();
      const r=await pool.query("SELECT pv.* FROM production_voucher pv LEFT JOIN factory_check_report f ON f.production_voucher_id=pv.id WHERE f.id IS NULL ORDER BY pv.date DESC,pv.id DESC LIMIT 500");
      return Response.json({vouchers:r.rows,rows:r.rows});
    }
    if(p==="billing/vehicle-inventory"){
      const u=new URL(req.url),args:any[]=[],w:string[]=["COALESCE(ti.cancelled,false)=false"];
      const from=u.searchParams.get("from_date"),to=u.searchParams.get("to_date"),name=String(u.searchParams.get("name")||"").trim(),search=String(u.searchParams.get("search")||"").trim(),showroom=String(u.searchParams.get("showroom")||"").trim();
      if(from){args.push(from);w.push("ti.date >= $"+args.length+"::date");}
      if(to){args.push(to);w.push("ti.date < ($"+args.length+"::date + INTERVAL '1 day')");}
      if(name){args.push("%"+name+"%");w.push("(COALESCE(ti.buyer_name,'') ILIKE $"+args.length+" OR COALESCE(v.model_name,'') ILIKE $"+args.length+" OR COALESCE(ti.product_name,'') ILIKE $"+args.length+")");}
      if(showroom){args.push("%"+showroom+"%");w.push("(COALESCE(d.name,'') ILIKE $"+args.length+" OR COALESCE(ti.dealer_name,'') ILIKE $"+args.length+")");}
      if(search){args.push("%"+search+"%");w.push("(COALESCE(v.chassis_no,'') ILIKE $"+args.length+" OR COALESCE(v.motor_no,'') ILIKE $"+args.length+" OR COALESCE(to_jsonb(v)->>'umrn','') ILIKE $"+args.length+")");}
      const r=await pool.query("SELECT ti.id,ti.date,COALESCE(ti.dealer_name,d.name,'') AS dealer_name,COALESCE(ti.buyer_name,'') AS customer_name,COALESCE(v.model_name,ti.product_name,'') AS model_name,v.chassis_no,v.motor_no,COALESCE(to_jsonb(v)->>'umrn','') AS umrn,COALESCE(to_jsonb(v)->>'manufacturing_month','') AS manufacturing_month,COALESCE(to_jsonb(v)->>'colour_code','') AS colour_code,COALESCE(to_jsonb(ti)->>'buyer_state_code','') AS buyer_state_code FROM tax_invoice ti LEFT JOIN dealer d ON d.id=ti.dealer_id LEFT JOIN vehicle v ON v.id=ti.vehicle_id"+(w.length?" WHERE "+w.join(" AND "):"")+" ORDER BY ti.date DESC,ti.id DESC LIMIT 5000",args);
      return Response.json({vehicles:r.rows,rows:r.rows,count:r.rowCount});
    }
    if(p==="dashboard"){
      const [vehicles,stages,monthly,billed,states,dealers,pending,sales,production,todayChallans,todayBills,todayProduction]=await Promise.all([
        pool.query("SELECT * FROM vehicle ORDER BY id DESC LIMIT 100"),
        pool.query("SELECT COALESCE(stage,'Unknown') AS stage,COUNT(*)::int AS count FROM vehicle GROUP BY stage"),
        pool.query(`SELECT COALESCE(d.month,i.month) AS month,COALESCE(d.delivery_challan,0)::int AS delivery_challan,COALESCE(i.tax_invoice,0)::int AS tax_invoice FROM (SELECT TO_CHAR(date,'YYYY-MM') AS month,COUNT(*)::int AS delivery_challan FROM delivery_challan WHERE COALESCE(cancelled,false)=false AND date >= date_trunc('month',CURRENT_DATE)-INTERVAL '11 months' GROUP BY 1) d FULL OUTER JOIN (SELECT TO_CHAR(date,'YYYY-MM') AS month,COUNT(*)::int AS tax_invoice FROM tax_invoice WHERE COALESCE(cancelled,false)=false AND date >= date_trunc('month',CURRENT_DATE)-INTERVAL '11 months' GROUP BY 1) i ON i.month=d.month ORDER BY 1`),
        pool.query(`SELECT TO_CHAR(date,'YYYY-MM') AS month,COUNT(*)::int AS billed,COALESCE(SUM(COALESCE(sale_amount,0)),0)::numeric AS taxable FROM tax_invoice WHERE COALESCE(cancelled,false)=false AND date >= date_trunc('month',CURRENT_DATE)-INTERVAL '11 months' GROUP BY 1 ORDER BY 1`),
        pool.query(`SELECT COALESCE(NULLIF(TRIM(buyer_state),''),'Unknown') AS state,COUNT(*)::int AS billed,COALESCE(SUM(COALESCE(sale_amount,0)),0)::numeric AS taxable FROM tax_invoice WHERE COALESCE(cancelled,false)=false AND date >= date_trunc('month',CURRENT_DATE)-INTERVAL '11 months' GROUP BY 1 ORDER BY taxable DESC,state`),
        pool.query("SELECT COUNT(*)::int AS n FROM dealer WHERE COALESCE(blocked,false)=false"),
        pool.query("SELECT COUNT(*)::int AS n FROM delivery_challan dc WHERE COALESCE(dc.cancelled,false)=false AND NOT EXISTS (SELECT 1 FROM tax_invoice ti WHERE ti.delivery_challan_id=dc.id AND COALESCE(ti.cancelled,false)=false)"),
        pool.query("SELECT COALESCE(SUM(sale_amount),0)::numeric AS sales,COALESCE(SUM(amount_received),0)::numeric AS received,COALESCE(SUM(hypothecation_amount),0)::numeric AS loan FROM tax_invoice WHERE COALESCE(cancelled,false)=false"),
        pool.query("SELECT COUNT(*)::int AS n FROM production_voucher WHERE date >= date_trunc('month',CURRENT_DATE)"),
        pool.query("SELECT dc.id,dc.date,dc.challan_no,COALESCE(NULLIF(dc.product_name,''),v.model_name) AS model_name,d.name AS dealer_name,COALESCE(NULLIF(dc.chassis_no,''),v.chassis_no) AS chassis_no,TRIM(CONCAT_WS(' ',NULLIF(v.battery_maker,''),NULLIF(v.battery_no1,''),NULLIF(v.battery_no2,''),NULLIF(v.battery_no3,''),NULLIF(v.battery_no4,''))) AS battery_name FROM delivery_challan dc LEFT JOIN dealer d ON d.id=dc.dealer_id LEFT JOIN vehicle v ON v.id=dc.vehicle_id WHERE dc.date::date=CURRENT_DATE AND COALESCE(dc.cancelled,false)=false ORDER BY dc.date DESC,dc.id DESC LIMIT 100"),
        pool.query("SELECT ti.id,ti.date,ti.bill_no,COALESCE(ti.dealer_name,d.name) AS dealer_name,ti.financer_name,COALESCE(NULLIF(ti.chassis_no,''),v.chassis_no) AS chassis_no,TRIM(CONCAT_WS(' ',NULLIF(v.battery_maker,''),NULLIF(v.battery_no1,''),NULLIF(v.battery_no2,''),NULLIF(v.battery_no3,''),NULLIF(v.battery_no4,''))) AS battery_name FROM tax_invoice ti LEFT JOIN dealer d ON d.id=ti.dealer_id LEFT JOIN vehicle v ON v.id=ti.vehicle_id WHERE ti.date::date=CURRENT_DATE AND COALESCE(ti.cancelled,false)=false ORDER BY ti.date DESC,ti.id DESC LIMIT 100"),
        pool.query("SELECT id,date,vou_no,product_name AS model_name,quantity FROM production_voucher WHERE date=CURRENT_DATE ORDER BY date DESC,id DESC LIMIT 100")
      ]);
      const stage_counts:any={};for(const r of stages.rows)stage_counts[r.stage]=Number(r.count||0);
      const total=Object.values(stage_counts).reduce((s:number,x:any)=>s+Number(x||0),0);
      const recent=vehicles.rows;
      return Response.json({
        manufacturing:recent.filter((x:any)=>x.stage==="Manufacturing"),
        delivery_challan:recent.filter((x:any)=>x.stage==="Delivery Challan"),
        tax_invoice:recent.filter((x:any)=>x.stage==="Tax Invoice"),
        stage_counts,total_vehicles:total,
        counts:{manufacturing:Number(stage_counts.Manufacturing||0),delivery_challan:Number(stage_counts["Delivery Challan"]||0),tax_invoice:Number(stage_counts["Tax Invoice"]||0),total},
        monthly:monthly.rows,billed_monthly:billed.rows,state_sales:states.rows,cash_at_dealer:0,
        dealers:Number(dealers.rows[0]?.n||0),pending_challans:Number(pending.rows[0]?.n||0),
        sales_total:Number(sales.rows[0]?.sales||0),received_total:Number(sales.rows[0]?.received||0),
        loan_total:Number(sales.rows[0]?.loan||0),production_this_month:Number(production.rows[0]?.n||0),
        today_challans:todayChallans.rows,today_bills:todayBills.rows,today_production:todayProduction.rows
      });
    }
    if(p==="nav-config"){
      const r=await pool.query("SELECT * FROM nav_tab ORDER BY id");
      return Response.json({tabs:r.rows,items:[]});
    }
    if(p==="masters"){
      const r=await pool.query("SELECT DISTINCT kind FROM simple_master ORDER BY kind");
      return Response.json({kinds:r.rows.map((x:any)=>x.kind)});
    }
    if(p==="production-formulas/by-product"){
      const u=new URL(req.url),product=u.searchParams.get("product")||u.searchParams.get("product_code")||"";
      const r=await pool.query("SELECT * FROM production_formula WHERE product_code=$1 OR product_name=$1 ORDER BY id",[product]);
      return Response.json({rows:r.rows,items:r.rows,data:r.rows});
    }
    // Production Voucher list: paginated + search (page / per_page / search). The generic handler
    // returned no "vouchers" key and ignored paging, so the screen always showed "No records found".
    if(p==="production-vouchers"){
      await ensureProductionVoucherSchema();
      const u=new URL(req.url),page=Math.max(1,Math.trunc(num(u.searchParams.get("page"))||1)),per=Math.min(200,Math.max(1,Math.trunc(num(u.searchParams.get("per_page"))||50)));
      const search=String(u.searchParams.get("search")||"").trim(),args:any[]=[];let where="";
      if(search){args.push("%"+search+"%");where=" WHERE (v.vou_no ILIKE $1 OR v.chassis_no ILIKE $1 OR v.motor_no ILIKE $1 OR v.product_name ILIKE $1)";}
      const total=Number((await pool.query("SELECT COUNT(*)::int AS n FROM production_voucher v"+where,args)).rows[0]?.n||0);
      const r=await pool.query("SELECT v.* FROM production_voucher v"+where+" ORDER BY v.date DESC,v.id DESC LIMIT "+per+" OFFSET "+((page-1)*per),args);
      return Response.json({vouchers:r.rows,rows:r.rows,total,page,per_page:per,total_pages:Math.max(1,Math.ceil(total/per))});
    }
    if(/^production-vouchers\/\d+$/.test(p)){
      const r=await pool.query("SELECT * FROM production_voucher WHERE id=$1",[idOf(path[1])]);
      if(!r.rowCount)return Response.json({error:"Production Voucher not found."},{status:404});
      return Response.json({voucher:r.rows[0]});
    }
    if(p==="production-formulas"){
      await ensureProductionFormulaSchema();
      const r=await pool.query("SELECT * FROM production_formula ORDER BY product_name,formula_name,id");
      const grouped:any[]=[]; const map=new Map<string,any>();
      for(const row of r.rows){if(!String(row.formula_name||"").trim())row.formula_name=row.product_name;const key=String(row.formula_name||"")+"::"+String(row.product_name||"");let g=map.get(key);if(!g){g={formula_name:row.formula_name,product_name:row.product_name,lines:[]};map.set(key,g);grouped.push(g)}g.lines.push(row)}
      const products=await pool.query("SELECT name,fro FROM product ORDER BY name");
      return Response.json({grouped,rows:r.rows,lines:r.rows,finished_products:products.rows.filter((x:any)=>x.fro!=="R"),raw_materials:products.rows.filter((x:any)=>x.fro==="R")});
    }
    if(p==="production-formulas/lines"){
      const u=new URL(req.url),args:any[]=[];const w:string[]=[];
      const product=u.searchParams.get("product_name")||u.searchParams.get("product")||"";const formula=u.searchParams.get("formula_name")||"";
      await ensureProductionFormulaSchema();
      if(product){args.push(product);w.push(NORM("product_name")+"="+NORM("$"+args.length))}if(formula){args.push(formula);w.push(NORM("formula_name")+"="+NORM("$"+args.length))}
      const r=await pool.query("SELECT * FROM production_formula"+(w.length?" WHERE "+w.join(" AND "):"")+" ORDER BY id",args);
      return Response.json({rows:r.rows,items:r.rows,data:r.rows,lines:r.rows});
    }
    // Chassis No = <First Fix><Month code><Year code><After Fix><serial>. Serial: 3 digits (len 17) / 4 digits (len 18),
    // Month/Year codes Chassis Master se. Serial har naye prefix (naya month/year) par 001 se shuru hota hai.
    if(p==="production-vouchers/generate-code"){
      const u=new URL(req.url),product=String(u.searchParams.get("product")||u.searchParams.get("product_name")||"").trim();
      if(!product)return Response.json({error:"Product is required."},{status:400});
      const dt=String(u.searchParams.get("date")||"").slice(0,10),d=/^\d{4}-\d{2}-\d{2}$/.test(dt)?dt:new Date().toISOString().slice(0,10);
      const MN=["January","February","March","April","May","June","July","August","September","October","November","December"];
      const mName=MN[Number(d.slice(5,7))-1];
      const mr=await pool.query("SELECT code FROM chassis_month_code WHERE lower(btrim(month))=lower($1) LIMIT 1",[mName]);
      const monthCode=String(mr.rows[0]?.code||"").trim();
      if(!monthCode)return Response.json({error:"Chassis Master mein "+mName+" ka Month Code set nahi hai."},{status:400});
      const yr=await pool.query("SELECT code FROM chassis_year_code WHERE year=$1::int LIMIT 1",[Number(d.slice(0,4))]);
      const yearCode=String(yr.rows[0]?.code||"").trim();
      if(!yearCode)return Response.json({error:"Chassis Master mein "+d.slice(0,4)+" ka Year Code set nahi hai."},{status:400});

      const pr=await pool.query("SELECT to_jsonb(product) AS j FROM product WHERE lower(btrim(name))=lower(btrim($1::text)) ORDER BY (fro='F') DESC,id DESC LIMIT 1",[product]);
      const j:any=pr.rows[0]?.j||{};
      const pick=(names:string[],re:RegExp)=>{
        for(const n of names){if(String(j[n]??"").trim()!=="")return String(j[n]).trim();}
        const k=Object.keys(j).find(k=>re.test(k)&&String(j[k]??"").trim()!=="");
        return k?String(j[k]).trim():"";
      };
      const firstFix=pick(["chassis_item_code","chassis_first_fix","first_fix"],/first.*fix|chassis.*item/i);
      const afterFix=pick(["chassis_after_code","chassis_after_fix","after_fix","chassis_suffix_code","chassis_suffix"],/chassis.*(after|suffix)|after.*(month|year|fix)/i);
      const fullLen=Number(pick(["chassis_length","chassis_no_length","full_chassis_length","chassis_len"],/chassis.*len|len.*chassis/i));
      const seen=Object.keys(j).filter(k=>/chassis|fix|len/i.test(k));
      if(!firstFix)return Response.json({error:"Product Master mein Chassis First Fix set nahi hai.",product_keys:seen},{status:400});
      if(!afterFix)return Response.json({error:"Product Master mein After Month & Year Fix set nahi hai.",product_keys:seen},{status:400});
      if(fullLen!==17&&fullLen!==18)return Response.json({error:"Full Chassis No. Length 17 ya 18 hona chahiye (abhi: "+(fullLen||"blank")+").",product_keys:seen},{status:400});

      const prefix=firstFix+monthCode+yearCode+afterFix,digits=fullLen===17?3:4;
      if(prefix.length+digits!==fullLen)return Response.json({error:"Length match nahi: prefix "+prefix+" ("+prefix.length+" char) + "+digits+" digit serial = "+(prefix.length+digits)+", lekin Full Length "+fullLen+" hai. Product Master ki fix values check karo."},{status:400});

      const mx=await pool.query("SELECT MAX(substr(c,$2::int+1)::bigint) AS n FROM (SELECT chassis_no AS c FROM vehicle UNION ALL SELECT chassis_no FROM production_voucher) x WHERE left(c,$2::int)=$1::text AND length(c)=$3::int AND substr(c,$2::int+1) ~ '^[0-9]+$'",[prefix,prefix.length,fullLen]);
      const next=Number(mx.rows[0]?.n||0)+1;
      if(next>Math.pow(10,digits)-1)return Response.json({error:"Serial limit poori ho gayi ("+"9".repeat(digits)+") for "+prefix},{status:400});
      const chassis=prefix+String(next).padStart(digits,"0");

      const last=await pool.query("SELECT motor_no,controller_no FROM production_voucher WHERE lower(btrim(product_name))=lower(btrim($1::text)) AND COALESCE(motor_no,'')<>'' ORDER BY date DESC,id DESC LIMIT 1",[product]);
      const L=last.rows[0]||{};
      const bump=(v:any,by:number)=>{const m=String(v||"").match(/^(.*?)(\d+)$/);if(!m)return "";return m[1]+(BigInt(m[2])+BigInt(by)).toString().padStart(m[2].length,"0")};
      return Response.json({chassis_no:chassis,motor_no:bump(L.motor_no,1),controller_no:bump(L.controller_no,1),missing_item_code:false});
    }
    if(p==="chassis-master"||p==="chassis-master/months"||p==="chassis-master/years"||p==="chassis-master/rule"){
      await ensureChassisMasterSchema();
      const [m,y,r]=await Promise.all([
        pool.query("SELECT * FROM chassis_month_code ORDER BY id"),
        pool.query("SELECT * FROM chassis_year_code ORDER BY year"),
        pool.query("SELECT * FROM chassis_rule ORDER BY id DESC LIMIT 1")
      ]);
      if(p==="chassis-master/months")return Response.json({rows:m.rows,data:m.rows});
      if(p==="chassis-master/years")return Response.json({rows:y.rows,data:y.rows});
      if(p==="chassis-master/rule")return Response.json({rule:r.rows[0]||null});
      return Response.json({months:m.rows,years:y.rows,rule:r.rows[0]||null});
    }
    if(p==="dealer/loan-masters"){
      const r=await pool.query("SELECT * FROM simple_master WHERE kind ILIKE '%loan%' ORDER BY id");
      const models=await pool.query("SELECT id,name,code FROM product WHERE COALESCE(fro,'')<>'R' AND COALESCE(name,'')<>'' ORDER BY name,id");
      return Response.json({rows:r.rows,masters:r.rows,models:models.rows});
    }
    if((p==="dealer/ledger-accounts"||p==="dealer/ledger-masters")&&a.scope!=="dealer"){const r=await pool.query("SELECT DISTINCT party_name FROM day_book WHERE party_name IS NOT NULL ORDER BY party_name");return Response.json({rows:r.rows});}
    if(p==="factory/old-rickshaw-challans"){
      await ensureOldRickshawInventorySchema();
      const rows=await pool.query("SELECT c.*,d.name AS dealer_name FROM old_rickshaw_challan c LEFT JOIN dealer d ON d.id=c.dealer_id ORDER BY c.date DESC,c.id DESC LIMIT 1000");
      const available=await pool.query("SELECT * FROM old_rickshaw_inventory WHERE status='available' ORDER BY repo_date DESC NULLS LAST,id DESC LIMIT 500");
      return Response.json({challans:rows.rows,rows:rows.rows,available_for_sale:available.rows,suggested_challan_no:"ORC-"+new Date().toISOString().slice(0,10).replace(/-/g,"")+"-"+Date.now()});
    }
    if(p==="dealer/ledger"&&a.scope==="dealer"){
      const did=num(a.dealer_id),u=new URL(req.url),from=String(u.searchParams.get("from")||"").trim(),to=String(u.searchParams.get("to")||"").trim(),search=String(u.searchParams.get("search")||"").trim().toLowerCase();
      const cols=await columns("day_book");
      if(!cols.size)return Response.json({events:[],rows:[],count:0});
      const dealerRow=await pool.query("SELECT name FROM dealer WHERE id=$1 LIMIT 1",[did]);
      const dealerName=String(dealerRow.rows[0]?.name||"").trim().toLowerCase();
      const raw=(await pool.query("SELECT * FROM day_book ORDER BY id ASC LIMIT 5000")).rows;
      const events=raw.filter((x:any)=>{
        const rowDealer=String(x.dealer_id||"").trim();
        const party=String(x.party_name||x.account_name||x.account||"");
        const doc=String(x.doc_no||x.voucher_no||x.reference_no||x.bill_no||"");
        const text=[party,doc,String(x.narration||""),String(x.particulars||""),String(x.chassis_no||"")].join(" ").toLowerCase();
        const d=ymd(x.date);
        const dealerMatch=rowDealer ? Number(rowDealer)===did : (party.trim().toLowerCase()===dealerName || String(x.dealer_name||"").trim().toLowerCase()===dealerName);
        return dealerMatch&&(!from||d>=from)&&(!to||d<=to)&&(!search||text.includes(search));
      });
      let running=0;
      const eventsOut=events.map((x:any)=>{
        const debit=num(x.debit||x.dr_amount||x.debit_amount||x.debit_paid),credit=num(x.credit||x.cr_amount||x.credit_amount||x.credit_received);
        return {record_type:"day_book",record_id:x.id,date:x.date,doc_no:x.doc_no||x.voucher_no||x.vr_no||x.bill_no||"",account:x.party_name||x.account_name||x.account||"",lines:[x.narration||x.particulars||x.description||""].filter(Boolean),debit,credit,vr_type:debit?"S":"R"};
      });
      // Shop expenses (dealer ne HO ke cash se kharch kiye) bhi credit ke roop me dikhte hain.
      await ensureDealerCashSchema();
      const exRows=(await pool.query("SELECT * FROM dealer_cash_expense WHERE dealer_id=$1 ORDER BY date ASC,id ASC LIMIT 5000",[did])).rows;
      const exEvents=shopExpenseLedgerEvents(exRows).filter((x:any)=>{const d=ymd(x.date);return (!from||d>=from)&&(!to||d<=to)&&(!search||[x.doc_no,x.narration].join(" ").toLowerCase().includes(search));});
      const merged=[...eventsOut,...exEvents].sort((x:any,y:any)=>String(x.date||"").slice(0,10).localeCompare(String(y.date||"").slice(0,10))||(x.record_type===y.record_type?Number(x.record_id||0)-Number(y.record_id||0):(x.record_type==="day_book"?-1:1)));
      let bal=0;
      const finalRows=merged.map((x:any)=>{bal+=num(x.debit)-num(x.credit);return {...x,balance:bal,dc:bal>=0?"Dr":"Cr"};});
      return Response.json({events:finalRows,rows:finalRows,count:finalRows.length});
    }
    if(p==="dealer/ledger-masters"&&a.scope==="dealer"){
      const dealers=await pool.query("SELECT id,code,name,mobile,address,account_no,ifsc FROM dealer WHERE COALESCE(blocked,false)=false ORDER BY name,id");
      const types=[
        {id:"dealer",name:"Dealer"},{id:"salesman",name:"Salesman"},{id:"financer",name:"Financer"},
        {id:"rto_expense",name:"RTO Expense"},{id:"insurance_expense",name:"Insurance"},
        {id:"mechanic",name:"Mechanic"},{id:"fabricator",name:"Fabricator"},{id:"expense_head",name:"Expense Head"},{id:"other",name:"Other"}
      ];
      return Response.json({types,dealers:dealers.rows,salesmen:[],financers:[],rtos:[],parties:[],mechanics:[],fabricators:[],expense_heads:[]});
    }
    if(p==="dealer/ledger-accounts"&&a.scope==="dealer"){
      await pool.query(`CREATE TABLE IF NOT EXISTS dealer_ledger_account (
        id bigserial PRIMARY KEY,dealer_id integer NOT NULL,account_type text NOT NULL,name text NOT NULL,code text,
        mobile text,address text,account_no text,ifsc text,opening_balance numeric NOT NULL DEFAULT 0,
        opening_type text NOT NULL DEFAULT 'dr',notes text,created_at timestamptz NOT NULL DEFAULT now()
      )`);
      const r=await pool.query("SELECT * FROM dealer_ledger_account WHERE dealer_id=$1 ORDER BY id DESC LIMIT 500",[num(a.dealer_id)]);
      return Response.json({accounts:r.rows,rows:r.rows,count:r.rowCount});
    }
    // Closing Stock - with Dealers (staff/salesman). Was falling through to the generic journal_stock table list, so the page got
    // an array instead of {vehicles,summary} and crashed ("This page couldn't load"). Salesman logins see only their own dealers.
    if(p==="stock/closing-dealers"&&a.scope!=="dealer"){
      const sm=String(a.department||"").trim().toLowerCase()==="salesman"?String(a.username||"").trim():"";
      const args:any[]=[];let extra="";
      if(sm){args.push(sm);extra=" AND lower(trim(COALESCE(v.dealer_name,''))) IN (SELECT lower(trim(name)) FROM dealer WHERE lower(trim(COALESCE(salesman,'')))=lower(trim($1)))";}
      const r=await pool.query("SELECT v.id,v.date,v.chassis_no,v.model_name,v.motor_no,v.colour,v.dealer_name FROM vehicle v WHERE v.stage='Delivery Challan' AND COALESCE(trim(v.dealer_name),'')<>''"+extra+" ORDER BY v.dealer_name,v.date DESC,v.id DESC",args);
      const m=new Map<string,any>();
      for(const x of r.rows){const k=String(x.dealer_name||"")+"|"+String(x.model_name||"");const e=m.get(k)||{dealer_name:x.dealer_name||"",model_name:x.model_name||"",qty:0};e.qty++;m.set(k,e);}
      return Response.json({vehicles:r.rows,summary:[...m.values()],count:r.rowCount});
    }
    if(p==="dealer/me"&&a.scope==="dealer"){
      const r=await pool.query("SELECT id,code,name,login_id,dealer_category,purchase_access,portal_modules,blocked FROM dealer WHERE id=$1",[num(a.dealer_id)]);
      const d=r.rows[0]||null;
      if(!d)return Response.json({error:"Dealer not found."},{status:404});
      d.purchase_access=Boolean(d.purchase_access);
      d.portal_modules=String(d.portal_modules||"").split(",").map((x:any)=>x.trim()).filter(Boolean);
      if(String(a.role||"")==="salesman"){d.is_salesman=true;d.salesman=String(a.salesman||a.username||"");d.role="salesman";}
      return Response.json({dealer:d});
    }
    if(p==="dealer/profile"&&a.scope==="dealer"){
      if(String(a.role||"")==="salesman"){
        const ucols=await columns("user");
        const wanted=["id","username","mobile","department","full_name","email","date_of_birth","address"];
        const select=wanted.filter((c)=>ucols.has(c)).map((c)=>'"'+c+'"').join(",");
        const r=await pool.query('SELECT '+(select||'id,username')+' FROM "user" WHERE id=$1',[num(a.sub)]);
        if(!r.rowCount)return Response.json({error:"User not found."},{status:404});
        return Response.json({profile:{...r.rows[0],kind:"salesman",editable:true}});
      }
      const dcols=await columns("dealer");
      const wanted=["id","code","name","login_id","dealer_category","mobile","email","address","gstin","state"];
      const select=wanted.filter((c)=>dcols.has(c)).map((c)=>'"'+c+'"').join(",");
      const r=await pool.query('SELECT '+(select||'id,name')+' FROM dealer WHERE id=$1',[num(a.dealer_id)]);
      if(!r.rowCount)return Response.json({error:"Dealer not found."},{status:404});
      return Response.json({profile:{...r.rows[0],kind:"dealer",editable:false}});
    }
    if(p==="dealer/stock"&&a.scope==="dealer"){
      const dr=await pool.query("SELECT id,name FROM dealer WHERE id=$1",[num(a.dealer_id)]);
      const name=dr.rows[0]?.name||"";
      const r=await pool.query("SELECT * FROM vehicle WHERE stage='Delivery Challan' AND lower(trim(COALESCE(dealer_name,'')))=lower(trim($1)) ORDER BY date DESC,id DESC",[name]);
      return Response.json({vehicles:r.rows,count:r.rowCount});
    }
    if(p==="dealer/rickshaw-battery-options"){
      const ou=new URL(req.url),otype=String(ou.searchParams.get("type")||"new").toLowerCase();
      const odid=a.scope==="dealer"?num(a.dealer_id):num(ou.searchParams.get("dealer_id"));
      if(!odid)return Response.json({rickshaws:[]});
      const nums=(r:any)=>[r.battery_no1,r.battery_no2,r.battery_no3,r.battery_no4].map((x:any)=>String(x||"").trim()).filter(Boolean);
      if(otype.includes("old")){
        const orr=await pool.query("SELECT id,vehicle_reg_no,chassis_no,model_name,battery_maker,battery_no1,battery_no2,battery_no3,battery_no4 FROM old_rickshaw WHERE dealer_id=$1 AND status IN ('available','sold') ORDER BY date DESC,id DESC",[odid]);
        return Response.json({rickshaws:orr.rows.map((r:any)=>({id:r.id,reg_no:r.vehicle_reg_no,chassis_no:r.chassis_no,model_name:r.model_name,battery_maker:r.battery_maker,battery_numbers:nums(r),has_battery:nums(r).length>0}))});
      }
      const odr=await pool.query("SELECT name FROM dealer WHERE id=$1",[odid]);
      if(!odr.rowCount)return Response.json({rickshaws:[]});
      const nr=await pool.query("SELECT id,chassis_no,model_name,battery_maker,battery_no1,battery_no2,battery_no3,battery_no4 FROM vehicle WHERE stage='Delivery Challan' AND lower(trim(COALESCE(dealer_name,'')))=lower(trim($1)) ORDER BY date DESC,id DESC",[odr.rows[0].name]);
      return Response.json({rickshaws:nr.rows.map((r:any)=>({id:r.id,reg_no:null,chassis_no:r.chassis_no,model_name:r.model_name,battery_maker:r.battery_maker,battery_numbers:nums(r),has_battery:nums(r).length>0}))});
    }
    if(p==="dealer/old-rickshaws"&&a.scope==="dealer"){
      const r=await pool.query("SELECT * FROM old_rickshaw WHERE dealer_id=$1 AND status IN ('available','sold') ORDER BY CASE WHEN status='available' THEN 0 ELSE 1 END,date DESC,id DESC",[num(a.dealer_id)]);
      return Response.json({rickshaws:r.rows,count:r.rowCount});
    }
    if(p==="dealer/cash-book"&&a.scope==="dealer"){
      await ensureDealerCashSchema();
      const did=num(a.dealer_id),u=new URL(req.url);
      const from=String(u.searchParams.get("from")||"").trim(),to=String(u.searchParams.get("to")||"").trim();
      const runRange=async(table:string,extra:string)=>{const args:any[]=[did],q:string[]=[];if(from){args.push(from);q.push(table+".date >= $"+args.length+"::date");}if(to){args.push(to);q.push(table+".date <= $"+args.length+"::date");}const sql="SELECT * FROM "+table+" WHERE dealer_id=$1"+(extra?" AND "+extra:"")+(q.length?" AND "+q.join(" AND "):"")+" ORDER BY date,id";return pool.query(sql,args);};
      const receipts=await runRange("dealer_cash_receipt","lower(COALESCE(payment_mode,'cash'))='cash'");
      const expenses=await runRange("dealer_cash_expense","");
      const handovers=await runRange("dealer_cash_handover","lower(COALESCE(status,'pending'))='accepted'");
      const pendingHandovers=await runRange("dealer_cash_handover","lower(COALESCE(status,'pending'))='pending'");
      const rejectedHandovers=await runRange("dealer_cash_handover","lower(COALESCE(status,'pending'))='rejected'");
      const priorDate=from||"9999-12-31";
      const priorReceipts=await pool.query("SELECT COALESCE(SUM(amount),0) AS n FROM dealer_cash_receipt WHERE dealer_id=$1 AND lower(COALESCE(payment_mode,'cash'))='cash' AND date < $2::date",[did,priorDate]);
      const priorExpenses=await pool.query("SELECT COALESCE(SUM(amount),0) AS n FROM dealer_cash_expense WHERE dealer_id=$1 AND date < $2::date",[did,priorDate]);
      const priorHandovers=await pool.query("SELECT COALESCE(SUM(amount),0) AS n FROM dealer_cash_handover WHERE dealer_id=$1 AND lower(COALESCE(status,'pending'))='accepted' AND date < $2::date",[did,priorDate]);
      const opening=num(priorReceipts.rows[0]?.n)-num(priorExpenses.rows[0]?.n)-num(priorHandovers.rows[0]?.n);
      const cashReceived=receipts.rows.reduce((s:number,x:any)=>s+num(x.amount),0);
      const expenseTotal=expenses.rows.reduce((s:number,x:any)=>s+num(x.amount),0);
      const handoverTotal=handovers.rows.reduce((s:number,x:any)=>s+num(x.amount),0);
      const closing=opening+cashReceived-expenseTotal-handoverTotal;
      return Response.json({receipts:receipts.rows,expenses:expenses.rows.map((x:any)=>({...x,category_label:x.category_label||x.category||"",folio:x.folio||""})),handovers:handovers.rows,pending_handovers:pendingHandovers.rows,rejected_handovers:rejectedHandovers.rows,summary:{pending_handover:pendingHandovers.rows.reduce((s:number,x:any)=>s+num(x.amount),0),opening_balance:opening,cash_received:cashReceived,expenses:expenseTotal,ho_handover:handoverTotal,net_movement:cashReceived-expenseTotal-handoverTotal,closing_balance:closing}});
    }
    if(p==="dealer/repair-receipts"&&a.scope==="dealer"){
      await ensureRepairSchema();
      if(!(await dealerHasRepairReceiptRight(num(a.dealer_id))))return Response.json({error:"Repair Receipt ka right aapke paas nahi hai."},{status:403});
      const v=await pool.query("SELECT id,voucher_no,date,customer_name,customer_mobile,vehicle_no,chassis_no,total_amount,paid_amount,balance_amount,dealer_name FROM repair_service_voucher WHERE total_amount-COALESCE(paid_amount,0)>0 ORDER BY date DESC,id DESC LIMIT 1000");
      const r=await pool.query("SELECT r.id,r.receipt_no,r.date,r.amount,r.payment_mode,r.reference_no,r.remarks,r.customer_name,r.vehicle_no,v.voucher_no FROM repair_service_payment_receipt r LEFT JOIN repair_service_voucher v ON v.id=r.voucher_id WHERE r.dealer_id=$1 ORDER BY r.date DESC,r.id DESC LIMIT 1000",[num(a.dealer_id)]);
      return Response.json({vouchers:v.rows,receipts:r.rows});
    }
    if(p==="dealer/cash-book/all-receipts"&&a.scope==="dealer"){
      await ensureDealerCashSchema();
      const r=await pool.query("SELECT *,COALESCE(date,receipt_date) AS display_date FROM dealer_cash_receipt WHERE dealer_id=$1 ORDER BY COALESCE(date,receipt_date) DESC,id DESC LIMIT 2000",[num(a.dealer_id)]);
      const rows=r.rows.map((x:any)=>({...x,date:x.date||x.receipt_date||null}));
      return Response.json({receipts:rows,rows,count:rows.length});
    }
    if(p==="dealer/cash-book/all-expenses"&&a.scope==="dealer"){
      await ensureDealerCashSchema();
      const r=await pool.query("SELECT * FROM dealer_cash_expense WHERE dealer_id=$1 ORDER BY date DESC,id DESC LIMIT 2000",[num(a.dealer_id)]);
      return Response.json({expenses:r.rows,rows:r.rows,count:r.rowCount});
    }
    if(p==="dealer/cash-book/customers"&&a.scope==="dealer"){
      await ensureDealerCashSchema();await ensureBillingSalesSchema();
      const did=num(a.dealer_id),u=new URL(req.url),q=String(u.searchParams.get("q")||"").trim().toLowerCase(),status=String(u.searchParams.get("status")||"").trim().toUpperCase(),payable=u.searchParams.get("payable_only")==="1";
      const cols=await columns("dealer_cash_customer"); if(!cols.size)return Response.json({error:"Customer register table not found."},{status:404});
      const r=await pool.query('SELECT * FROM dealer_cash_customer WHERE dealer_id=$1 ORDER BY id DESC LIMIT 2000',[did]);
      let customers=await enrichCashCustomers(r.rows);
      // Search/status are applied after enrichment so resolved name + derived BILLED status are what gets matched.
      if(status)customers=customers.filter((x:any)=>x.status===status);
      if(q)customers=customers.filter((x:any)=>[x.name,x.phone,x.page_no,x.vehicle_no].join(" ").toLowerCase().includes(q));
      if(payable)customers=customers.filter((x:any)=>x.balance>0);
      return Response.json({customers,rows:customers,count:customers.length});
    }
    if(p==="dealer/delivery/customers"&&a.scope==="dealer"){
      await ensureDealerCashSchema();await ensureBillingSalesSchema();
      const r=await pool.query("SELECT * FROM dealer_cash_customer WHERE dealer_id=$1 AND UPPER(COALESCE(status,''))='VEHICLE_PENDING' ORDER BY id DESC LIMIT 2000",[num(a.dealer_id)]);
      const customers=(await enrichCashCustomers(r.rows)).filter((x:any)=>x.status==="VEHICLE_PENDING");
      return Response.json({customers,rows:customers,count:customers.length});
    }
    if(p==="dealer/incentive-record"&&a.scope==="dealer"){
      const r=await pool.query("SELECT id,date,bill_no,buyer_name AS customer_name,chassis_no,product_name AS model,COALESCE(NULLIF(to_jsonb(ti)->>'incentive_amount','')::numeric,0) AS incentive_amount,COALESCE(to_jsonb(ti)->>'incentive_voucher_no','') AS incentive_voucher_no,COALESCE(to_jsonb(ti)->>'incentive_date','') AS incentive_date FROM tax_invoice ti WHERE ti.dealer_id=$1 AND COALESCE(ti.cancelled,false)=false AND COALESCE(NULLIF(to_jsonb(ti)->>'incentive_amount','')::numeric,0)>0 ORDER BY ti.date DESC,ti.id DESC",[num(a.dealer_id)]);
      const rows=r.rows.map((x:any)=>({...x,status:x.incentive_voucher_no?'PAID':'NOT_RECORDED'}));
      return Response.json({rows,data:rows,count:rows.length});
    }
    if(p==="dealer/battery-adjustment"&&a.scope==="dealer"){
      const did=num(a.dealer_id);
      const dr=await pool.query("SELECT id,name FROM dealer WHERE id=$1",[did]);
      if(!dr.rowCount)return Response.json({error:"Dealer not found."},{status:404});
      const stock=await pool.query("SELECT * FROM battery_stock_movement WHERE dealer_id=$1 AND movement_type IN ('withdrawal','delivery') ORDER BY date DESC,id DESC",[did]);
      const used=await pool.query("SELECT battery_no FROM battery_stock_movement WHERE dealer_id=$1 AND movement_type='addition'",[did]);
      const usedSet=new Set(used.rows.map((x:any)=>String(x.battery_no||"").trim().toUpperCase()));
      const batteries=stock.rows.filter((x:any)=>!usedSet.has(String(x.battery_no||"").trim().toUpperCase())).map((x:any)=>({...x,qty:1}));
      const vehicles=await pool.query("SELECT id,date,model_name,chassis_no,motor_no,stage,dealer_name,battery_maker,battery_no1,battery_no2,battery_no3,battery_no4 FROM vehicle WHERE stage='Delivery Challan' AND lower(trim(COALESCE(dealer_name,'')))=lower(trim($1)) ORDER BY date DESC,id DESC",[dr.rows[0].name]);
      return Response.json({batteries,vehicles:vehicles.rows,makers:[...new Set(batteries.map((x:any)=>String(x.battery_maker||"").trim()).filter(Boolean))]});
    }
    if(p==="dealer/battery-stock"&&a.scope==="dealer"){
      const r=await pool.query("SELECT * FROM battery_stock_movement WHERE dealer_id=$1 AND movement_type IN ('withdrawal','delivery') ORDER BY date DESC,id DESC",[num(a.dealer_id)]);
      const used=await pool.query("SELECT battery_no FROM battery_stock_movement WHERE dealer_id=$1 AND movement_type='addition'",[num(a.dealer_id)]);
      const usedSet=new Set(used.rows.map((x:any)=>String(x.battery_no||"").trim().toUpperCase()));
      const batteries=r.rows.filter((x:any)=>!usedSet.has(String(x.battery_no||"").trim().toUpperCase())).map((x:any)=>({...x,qty:1}));
      return Response.json({batteries,count:batteries.length});
    }
    if(p==="dealer/delivery-challans"&&a.scope==="dealer"){
      const r=await pool.query("SELECT * FROM delivery_challan WHERE dealer_id=$1 ORDER BY date DESC,id DESC",[num(a.dealer_id)]);
      return Response.json({challans:r.rows});
    }
    if(p==="dealer/tax-invoices"&&a.scope==="dealer"){
      const r=await pool.query("SELECT ti.*,"+TI_CALC+" FROM tax_invoice ti LEFT JOIN delivery_challan dc ON ti.delivery_challan_id=dc.id WHERE ti.cancelled=false AND (ti.dealer_id=$1 OR dc.dealer_id=$1) ORDER BY ti.date DESC,ti.id DESC",[num(a.dealer_id)]);
      return Response.json({invoices:r.rows});
    }
    if(p==="dealer/seized-vehicles"&&a.scope==="dealer"){
      await ensureOldRickshawInventorySchema();
      const r=await pool.query("SELECT id,vehicle_no,model_name,repo_date,battery_maker,dealer_id,dealer_name,status,available_for_sale FROM old_rickshaw_inventory WHERE dealer_id=$1 AND status='hold' ORDER BY repo_date DESC NULLS LAST,id DESC",[num(a.dealer_id)]);
      return Response.json({vehicles:r.rows.map((x:any)=>({...x,vehicle_no:x.vehicle_no,repo_date:x.repo_date,battery_available:Boolean(x.battery_maker),battery_no:null,rc_available:false,charger_available:false})) ,count:r.rowCount,status:"HOLD"});
    }
    if(p.startsWith("users/") && p.endsWith("/option-setting")){
      const uid=idOf(path[path.length-2]);if(!uid)return Response.json({error:"User id required."},{status:400});
      const r=await pool.query('SELECT u.id,u.username,to_jsonb(u)->>\'department\' AS department,COALESCE((to_jsonb(u)->>\'is_super_user\')::boolean,false) AS is_super_user,u.allowed_modules FROM "user" u WHERE u.id=$1',[uid]);if(!r.rowCount)return Response.json({error:"User not found."},{status:404});
      const v=r.rows[0]?.allowed_modules;const selected=Array.isArray(v)?v.map((x:any)=>String(x)):String(v||"").split(",").map((x:string)=>x.trim()).filter(Boolean);
      const {allowed_modules:_am,...userInfo}=r.rows[0];
      return Response.json({user:userInfo,selected_keys:selected,modules:selected});
    }
    if(p==="auth/me"){
      const ucols=await columns("user");
      const wanted=["id","username","mobile","department","is_super_user","allowed_modules","full_name","email","date_of_birth","address"];
      const select=wanted.filter((c)=>ucols.has(c)).map((c)=>'"'+c+'"').join(",");
      const r=await pool.query('SELECT '+(select||'id,username')+' FROM "user" WHERE id=$1',[num(a.sub)]);
      return Response.json({user:r.rows[0]||null});
    }
    if(p==="dealer/pending-sales" && a.scope==="dealer"){
      await ensureLoanWorkflowBridgeSchema(); await ensureBillingSalesSchema(); await ensureGrdAssetSchema();
      const did=num(a.dealer_id);
      const applications=await pool.query(`
        SELECT lw.*,
          c.full_name AS customer_name,c.phone AS customer_phone,c.address AS customer_address,c.state AS customer_state,
          d.name AS dealer_name
        FROM loan_workflow lw
        LEFT JOIN customer c ON c.id=lw.customer_id
        LEFT JOIN dealer d ON d.id=lw.dealer_id
        WHERE lw.dealer_id=$1
          AND LOWER(REPLACE(REPLACE(TRIM(COALESCE(lw.status,'')),'_',' '),'-',' ')) IN ('loan approved','approved')
          AND NOT EXISTS (SELECT 1 FROM grd_billing_sale s WHERE s.application_id=lw.id)
        ORDER BY lw.id DESC LIMIT 1000
      `,[did]);
      const vehicles=await pool.query(`
        SELECT dc.id AS challan_id,dc.vehicle_id,dc.challan_no,dc.date AS challan_date,
          dc.chassis_no,dc.product_name,dc.sale_value,dc.dealer_id,d.name AS dealer_name,
          v.model_name,v.colour,v.motor_no,v.controller_no,
          v.battery_maker,v.battery_no1,v.battery_no2,v.battery_no3,v.battery_no4
        FROM delivery_challan dc
        LEFT JOIN dealer d ON d.id=dc.dealer_id
        LEFT JOIN vehicle v ON v.id=dc.vehicle_id
        WHERE dc.dealer_id=$1
          AND COALESCE(dc.cancelled,false)=false
          AND NOT EXISTS (SELECT 1 FROM tax_invoice ti WHERE ti.delivery_challan_id=dc.id AND COALESCE(ti.cancelled,false)=false)
          AND NOT EXISTS (SELECT 1 FROM grd_billing_sale s WHERE s.vehicle_id=dc.vehicle_id AND s.status IN ('PENDING','APPROVED','BILLED'))
        ORDER BY dc.date DESC NULLS LAST,dc.id DESC LIMIT 1000
      `,[did]);
      const dealer=await pool.query("SELECT id,name,code FROM dealer WHERE id=$1",[did]);
      return Response.json({applications:applications.rows,vehicles:vehicles.rows,dealers:dealer.rows,count:applications.rowCount});
    }
    if(p==="dealer/loan-status"||p==="loan-application-view"){
      await ensureLoanWorkflowBridgeSchema();
      const did=a.scope==="dealer"?num(a.dealer_id):null;
      const r=did?await pool.query("SELECT * FROM loan_workflow WHERE dealer_id=$1 ORDER BY id DESC",[did]):await pool.query("SELECT * FROM loan_workflow ORDER BY id DESC LIMIT 1000");
      return Response.json({applications:r.rows,rows:r.rows,count:r.rowCount});
    }
    if(p==="reports/payment-receivable"){
      const u=new URL(req.url);
      const from=u.searchParams.get("from"),to=u.searchParams.get("to"),search=String(u.searchParams.get("search")||"").trim();
      const showAll=String(u.searchParams.get("show_all")||"1")!=="0";
      const args:any[]=[]; const w:string[]=["COALESCE(ti.cancelled,false)=false"];
      if(from){args.push(from);w.push("ti.date >= $"+args.length+"::date")}
      if(to){args.push(to);w.push("ti.date <= $"+args.length+"::date")}
      if(search){args.push("%"+search+"%");w.push("(COALESCE(ti.bill_no,'') ILIKE $"+args.length+" OR COALESCE(ti.buyer_name,'') ILIKE $"+args.length+" OR COALESCE(ti.chassis_no,'') ILIKE $"+args.length+" OR COALESCE(ti.dealer_name,'') ILIKE $"+args.length+")")}
      const rr=await pool.query("SELECT ti.* FROM tax_invoice ti WHERE "+w.join(" AND ")+" ORDER BY ti.date DESC,ti.id DESC",args);
      let rows=rr.rows.map((x:any)=>{
        const value=num(x.sale_amount);
        const loan=num(x.hypothecation_amount);
        const received=num(x.amount_received);
        const balance=value-loan-received;
        return {...x,dealer_name:x.dealer_name||"",bill_no:x.bill_no||"",model:x.product_name||x.model_name||"",chassis_no:x.chassis_no||"",
          customer:x.buyer_name||"",mobile_no:x.buyer_mobile||x.customer_phone||"",value_amt:value,loan_amt:loan,amt_recd:received,balance,
          financer:x.financer_name||"",rto:x.rto||x.rto_name||"",vehicle_no:x.vehicle_reg_no||"",salesman:x.salesman||"",
          incentive_amount:num(x.incentive_amount),incentive_voucher_no:x.incentive_voucher_no||"",incentive_date:x.incentive_date||null,
          expense_total:num(x.expense_total),expense_details:Array.isArray(x.expense_details)?x.expense_details:[]};
      });
      if(!showAll)rows=rows.filter((x:any)=>x.balance>0);
      const page=Math.max(1,num(u.searchParams.get("page"))||1),per=Math.min(200,Math.max(1,num(u.searchParams.get("per_page"))||50)),start=(page-1)*per;
      const totals=rows.reduce((a:any,x:any)=>(a.value+=x.value_amt,a.loan+=x.loan_amt,a.received+=x.amt_recd,a.balance+=x.balance,a),{value:0,loan:0,received:0,balance:0});
      if(u.searchParams.get("export")==="csv")return csvResponse(rows,"Payment_Receivable_Report.csv");
      return Response.json({rows:rows.slice(start,start+per),page,per_page:per,total:rows.length,total_pages:Math.max(1,Math.ceil(rows.length/per)),totals});
    }
    if(p==="products"){
      await ensureDispatchSchema();
      const u=new URL(req.url);
      const page=Math.max(1,num(u.searchParams.get("page"))||1);
      const per=Math.min(1000,Math.max(1,num(u.searchParams.get("per_page"))||50));
      const search=String(u.searchParams.get("search")||"").trim();
      const fro=String(u.searchParams.get("fro")||"").trim().toUpperCase();
      const category=String(u.searchParams.get("category")||"").trim().toUpperCase();
      const cols=await columns("product");
      if(!cols.size)return Response.json({error:"Product table not found."},{status:404});
      const args:any[]=[]; const where:string[]=[];
      if(fro && cols.has("fro")){args.push(fro);where.push('UPPER(COALESCE("fro",\'\'))=$'+args.length);}
      if(category && cols.has("product_category")){args.push(category);where.push('UPPER(COALESCE(NULLIF("product_category",\'\'),CASE WHEN "fro"=\'F\' THEN \'FINISHED\' ELSE \'RAW\' END))=$'+args.length);}
      const terms:string[]=[];
      for(const col of ["name","code","hsn_code","chassis_item_code","umrn_code"]){
        if(cols.has(col)){args.push("%"+search+"%");terms.push('"'+col+'" ILIKE $'+args.length);}
      }
      if(terms.length)where.push("("+terms.join(" OR ")+")");
      const whereSql=where.length?" WHERE "+where.join(" AND "):"";
      const total=await pool.query('SELECT COUNT(*)::int AS n FROM "product"'+whereSql,args);
      const offset=(page-1)*per;
      const rows=await pool.query('SELECT *,COALESCE(NULLIF(product_category,\'\'),CASE WHEN fro=\'F\' THEN \'FINISHED\' ELSE \'RAW\' END) AS category FROM "product"'+whereSql+((fro||category)?" ORDER BY name,id":" ORDER BY id DESC")+" LIMIT $"+(args.length+1)+" OFFSET $"+(args.length+2),[...args,per,offset]);
      const totalCount=Number(total.rows[0]?.n||0);
      return Response.json({products:rows.rows,rows:rows.rows,data:rows.rows,page,per_page:per,total:totalCount,total_pages:Math.max(1,Math.ceil(totalCount/per))});
    }
    if(p==="reports/delivery-challan-register"){
      const u=new URL(req.url),args:any[]=[],w:string[]=["COALESCE(dc.cancelled,false)=false"];
      const from=u.searchParams.get("from"),to=u.searchParams.get("to"),search=String(u.searchParams.get("search")||"").trim();
      if(from){args.push(from);w.push("dc.date >= $"+args.length+"::date");}
      if(to){args.push(to);w.push("dc.date <= $"+args.length+"::date");}
      if(search){args.push("%"+search+"%");w.push("(COALESCE(dc.challan_no,'') ILIKE $"+args.length+" OR COALESCE(dc.chassis_no,'') ILIKE $"+args.length+" OR COALESCE(dc.product_name,'') ILIKE $"+args.length+" OR COALESCE(d.name,'') ILIKE $"+args.length+")");}
      const dealer=String(u.searchParams.get("dealer")||"ALL"),product=String(u.searchParams.get("product")||"ALL"),salesman=String(u.searchParams.get("salesman")||"ALL"),battery=String(u.searchParams.get("battery")||"ALL");
      if(dealer!=="ALL"){args.push(dealer);w.push("d.id=$"+args.length);}
      if(product!=="ALL"){args.push(product);w.push("LOWER(COALESCE(NULLIF(to_jsonb(dc)->>'product_name',''),v.model_name,''))=LOWER($"+args.length);}
      if(salesman!=="ALL"){args.push(salesman);w.push("LOWER(COALESCE(to_jsonb(dc)->>'salesman',''))=LOWER($"+args.length);}
      if(battery!=="ALL"){args.push(battery);w.push("LOWER(COALESCE(v.battery_maker,''))=LOWER($"+args.length);}
      const base="SELECT dc.*,d.name AS dealer_name,d.code AS dealer_code,d.mobile AS dealer_mobile,d.gst_no AS dealer_gst_no,COALESCE(NULLIF(to_jsonb(dc)->>'product_name',''),v.model_name) AS product_name,COALESCE(NULLIF(to_jsonb(dc)->>'chassis_no',''),v.chassis_no) AS chassis_no,COALESCE(NULLIF(to_jsonb(dc)->>'motor_no',''),v.motor_no) AS motor_no,COALESCE(NULLIF(to_jsonb(dc)->>'colour',''),v.colour) AS colour,COALESCE(to_jsonb(dc)->>'controller_no','') AS controller_no,COALESCE(to_jsonb(dc)->>'other','') AS other,COALESCE(to_jsonb(dc)->>'remarks1','') AS remarks1,COALESCE(to_jsonb(dc)->>'remarks2','') AS remarks2,COALESCE(to_jsonb(dc)->>'destination','') AS destination,COALESCE(to_jsonb(dc)->>'salesman','') AS salesman,COALESCE(to_jsonb(dc)->>'formula_name','') AS formula_name,v.battery_maker,v.battery_no1,v.battery_no2,v.battery_no3,v.battery_no4,COALESCE(to_jsonb(v)->>'umrn_code','') AS umrn_code,COALESCE(to_jsonb(dc)->>'dealer_page_no','') AS dealer_page_no,ti.bill_no,COALESCE(ti.sale_amount,0) AS sale_value FROM delivery_challan dc LEFT JOIN dealer d ON d.id=dc.dealer_id LEFT JOIN vehicle v ON v.id=dc.vehicle_id LEFT JOIN LATERAL (SELECT * FROM tax_invoice x WHERE x.delivery_challan_id=dc.id AND COALESCE(x.cancelled,false)=false ORDER BY x.id DESC LIMIT 1) ti ON true";
      const all=await pool.query(base+" WHERE "+w.join(" AND ")+" ORDER BY dc.date DESC,dc.id DESC",args);
      const rows=all.rows.map((x:any)=>({...x,battery_name:[x.battery_maker,x.battery_no1,x.battery_no2,x.battery_no3,x.battery_no4].filter(Boolean).join(" ")}));
      const products=[...new Set(rows.map((x:any)=>String(x.product_name||"").trim()).filter(Boolean))].sort();
      const dealerPairs:Array<[string,{id:any,name:any}]>=rows.map((x:any)=>[String(x.dealer_id||"")+"::"+String(x.dealer_name||""),{id:x.dealer_id,name:x.dealer_name}] as [string,{id:any,name:any}]).filter((pair:[string,{id:any,name:any}])=>Boolean(pair[1].id||pair[1].name));
      const dealers=Array.from(new Map<string,{id:any,name:any}>(dealerPairs).values()).sort((a:any,b:any)=>String(a.name).localeCompare(String(b.name)));
      const salesmen=[...new Set(rows.map((x:any)=>String(x.salesman||"").trim()).filter(Boolean))].sort();
      const batteries=[...new Set(rows.map((x:any)=>String(x.battery_maker||"").trim()).filter(Boolean))].sort();
      const page=Math.max(1,num(u.searchParams.get("page"))||1),per=Math.min(200,Math.max(1,num(u.searchParams.get("per_page"))||100)),start=(page-1)*per;
      if(u.searchParams.get("export")==="csv")return csvResponse(rows,"Delivery_Challan_Register.csv");
      return Response.json({rows:rows.slice(start,start+per),page,per_page:per,total:rows.length,total_pages:Math.max(1,Math.ceil(rows.length/per)),filters:{product:products,dealer:dealers,salesman:salesmen,battery:batteries}});
    }
    if(p==="challan-shift"){
      await ensureChallanShiftSchema();
      const u=new URL(req.url),search=String(u.searchParams.get("search")||"").trim();
      const args:any[]=[];const w:string[]=["COALESCE(dc.cancelled,false)=false"];
      w.push("NOT EXISTS (SELECT 1 FROM tax_invoice ti WHERE ti.delivery_challan_id=dc.id AND COALESCE(ti.cancelled,false)=false)");
      if(search){
        args.push("%"+search+"%");
        w.push("(COALESCE(dc.challan_no,'') ILIKE $1 OR COALESCE(dc.chassis_no,'') ILIKE $1 OR COALESCE(dc.product_name,'') ILIKE $1 OR COALESCE(d.name,'') ILIKE $1)");
      }
      const eligible=await pool.query(`SELECT dc.id,dc.date,dc.challan_no,dc.dealer_id,d.name AS dealer_name,
        dc.product_name,dc.chassis_no,dc.battery_maker,dc.battery_no1,dc.battery_no2,dc.battery_no3,dc.battery_no4
        FROM delivery_challan dc LEFT JOIN dealer d ON d.id=dc.dealer_id
        WHERE ${w.join(" AND ")}
        ORDER BY dc.date DESC,dc.id DESC LIMIT 2000`,args);
      const dealers=await pool.query("SELECT id,code,name FROM dealer WHERE COALESCE(blocked,false)=false ORDER BY name,id");
      const shifts=await pool.query(`SELECT s.*,sf.name AS shift_from_dealer_name,st.name AS shift_to_dealer_name
        FROM delivery_challan_shift s
        LEFT JOIN dealer sf ON sf.id=s.shift_from_dealer_id
        LEFT JOIN dealer st ON st.id=s.shift_to_dealer_id
        ORDER BY s.shift_date DESC,s.id DESC LIMIT 2000`);
      return Response.json({challans:eligible.rows,dealers:dealers.rows,shifts:shifts.rows,count:eligible.rowCount});
    }
    if(p==="challan-shift"){
      await ensureChallanShiftSchema();
      const challanId=idOf(b.challan_id),toDealerId=idOf(b.to_dealer_id);
      const shiftDate=String(b.shift_date||"").slice(0,10)||new Date().toISOString().slice(0,10);
      const remark=String(b.remark||"").trim();
      if(!challanId)return Response.json({error:"Delivery Challan is required."},{status:400});
      if(!toDealerId)return Response.json({error:"Shift To Dealer is required."},{status:400});
      if(!remark)return Response.json({error:"Shift Remark is required."},{status:400});
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        const dc=await client.query(`SELECT dc.*,d.name AS dealer_name,
          EXISTS (SELECT 1 FROM tax_invoice ti WHERE ti.delivery_challan_id=dc.id AND COALESCE(ti.cancelled,false)=false) AS invoiced
          FROM delivery_challan dc LEFT JOIN dealer d ON d.id=dc.dealer_id
          WHERE dc.id=$1 FOR UPDATE`,[challanId]);
        if(!dc.rowCount)throw new Error("Delivery Challan not found.");
        const row=dc.rows[0];
        if(Boolean(row.cancelled))throw new Error("Cancelled Delivery Challan cannot be shifted.");
        if(Boolean(row.invoiced))throw new Error("Bill already generated. Dealer shift is locked.");
        if(Number(row.dealer_id||0)===toDealerId)throw new Error("New dealer is same as current dealer.");
        const td=await client.query("SELECT id,name FROM dealer WHERE id=$1 AND COALESCE(blocked,false)=false",[toDealerId]);
        if(!td.rowCount)throw new Error("Shift To Dealer not found.");
        const toName=String(td.rows[0].name||"").trim();
        const fromName=String(row.dealer_name||"").trim();
        const ins=await client.query(`INSERT INTO delivery_challan_shift
          (challan_id,challan_no,chassis_no,model_name,battery_maker,battery_no1,battery_no2,battery_no3,battery_no4,
           shift_from_dealer_id,shift_from_dealer_name,shift_to_dealer_id,shift_to_dealer_name,shift_date,remark,shifted_by)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::date,$15,$16) RETURNING id`,
          [challanId,row.challan_no||"",row.chassis_no||"",row.product_name||"",row.battery_maker||null,row.battery_no1||null,row.battery_no2||null,row.battery_no3||null,row.battery_no4||null,
           idOf(row.dealer_id),fromName,toDealerId,toName,shiftDate,remark,String(a.username||a.full_name||a.user_id||"Admin")]);
        const ref="DCS-"+shiftDate.replace(/-/g,"")+"-"+String(ins.rows[0].id).padStart(5,"0");
        await client.query("UPDATE delivery_challan_shift SET shift_ref=$1 WHERE id=$2",[ref,ins.rows[0].id]);

        const dcCols=await columns("delivery_challan");
        const sets:string[]=["dealer_id=$1"],vals:any[]=[toDealerId];
        if(dcCols.has("dealer_name")){sets.push("dealer_name=$2");vals.push(toName);}
        vals.push(challanId);
        await client.query("UPDATE delivery_challan SET "+sets.join(",")+" WHERE id=$"+vals.length,vals);

        const vcols=await columns("vehicle");
        if(row.vehicle_id&&vcols.has("dealer_name"))await client.query("UPDATE vehicle SET dealer_name=$1 WHERE id=$2",[toName,row.vehicle_id]);

        const log=`Dealer Shift: ${fromName||"—"} → ${toName} | Shift Date: ${shiftDate} | Ref: ${ref} | Remark: ${remark}`;
        const target=dcCols.has("remarks2")?"remarks2":(dcCols.has("remarks1")?"remarks1":null);
        if(target){
          const old=String(row[target]||"").trim();
          const next=old?[old,log].join("\n"):log;
          await client.query("UPDATE delivery_challan SET \""+target+"\"=$1 WHERE id=$2",[next,challanId]);
        }
        await client.query("COMMIT");
        return Response.json({success:true,shift_ref:ref,shift_id:Number(ins.rows[0].id),dealer_id:toDealerId,dealer_name:toName});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    if(p==="delivery-challans" || p==="dealer/delivery-challans"){
      await ensureDispatchSchema();
      const u=new URL(req.url),page=Math.max(1,num(u.searchParams.get("page"))||1),per=Math.min(200,Math.max(1,num(u.searchParams.get("per_page"))||50)),search=String(u.searchParams.get("search")||"").trim();
      const dcCols=await columns("delivery_challan"),dealerCols=await columns("dealer"),vehicleCols=await columns("vehicle"),invoiceCols=await columns("tax_invoice");
      if(!dcCols.size)return Response.json({error:"Delivery Challan table not found."},{status:404});
      const args:any[]=[],where:string[]=[];
      if(dcCols.has("cancelled"))where.push("COALESCE(dc.cancelled,false)=false");
      if(a.scope==="dealer" && dcCols.has("dealer_id")){args.push(num(a.dealer_id));where.push("dc.dealer_id=$"+args.length);}
      if(search){
        const terms:string[]=[];
        for(const col of ["challan_no","chassis_no","product_name"]){if(dcCols.has(col)){args.push("%"+search+"%");terms.push("dc."+col+" ILIKE $"+args.length);}}
        if(dealerCols.has("name")&&dcCols.has("dealer_id")){args.push("%"+search+"%");terms.push("d.name ILIKE $"+args.length);}
        if(terms.length)where.push("("+terms.join(" OR ")+")");
      }
      const whereSql=where.length?" WHERE "+where.join(" AND "):"";
      const total=await pool.query("SELECT COUNT(*)::int AS n FROM delivery_challan dc"+(dcCols.has("dealer_id")?" LEFT JOIN dealer d ON d.id=dc.dealer_id":"")+whereSql,args);
      const dealerExpr=dcCols.has("dealer_name")&&dealerCols.has("name") ? "COALESCE(NULLIF(dc.dealer_name,''),d.name)" : (dealerCols.has("name")&&dcCols.has("dealer_id")?"d.name":"''");
      const joinDealer=dcCols.has("dealer_id")&&dealerCols.has("id")?" LEFT JOIN dealer d ON d.id=dc.dealer_id":"";
      const invoiceExpr=invoiceCols.has("delivery_challan_id") ? "EXISTS (SELECT 1 FROM tax_invoice ti WHERE ti.delivery_challan_id=dc.id AND "+(invoiceCols.has("cancelled")?"COALESCE(ti.cancelled,false)=false":"TRUE")+") AS invoiced,(SELECT ti.bill_no FROM tax_invoice ti WHERE ti.delivery_challan_id=dc.id ORDER BY ti.id DESC LIMIT 1) AS bill_no" : "false AS invoiced,'' AS bill_no";
      const rows=await pool.query("SELECT dc.*,"+dealerExpr+" AS dealer_name,"+invoiceExpr+" FROM delivery_challan dc"+joinDealer+whereSql+" ORDER BY "+(dcCols.has("date")?"dc.date DESC,dc.id DESC":"dc.id DESC")+" LIMIT "+per+" OFFSET "+((page-1)*per),args);
      const stageCol=vehicleCols.has("stage");
      const available=stageCol
        ? await pool.query("SELECT * FROM vehicle WHERE stage='Manufacturing' ORDER BY id DESC LIMIT 2000")
        : await pool.query("SELECT * FROM vehicle WHERE COALESCE(to_jsonb(vehicle)->>'stage','')='Manufacturing' ORDER BY id DESC LIMIT 2000");
      const dispatch=await pool.query("SELECT p.*,COALESCE(NULLIF(p.product_category,''),CASE WHEN p.fro='F' THEN 'FINISHED' ELSE 'RAW' END) AS category,COALESCE(p.show_on_delivery_challan,false) AS show_on_delivery_challan,COALESCE(s.qty,0) AS stock_qty FROM product p LEFT JOIN (SELECT item_name,SUM(CASE WHEN UPPER(COALESCE(work_type,''))='IN' THEN qty ELSE -qty END) qty FROM journal_stock GROUP BY item_name) s ON lower(trim(s.item_name))=lower(trim(p.name)) WHERE UPPER(COALESCE(NULLIF(p.product_category,''),CASE WHEN p.fro='F' THEN 'FINISHED' ELSE 'RAW' END))='DISPATCH' AND COALESCE(p.show_on_delivery_challan,false)=true ORDER BY p.name");
      const totalCount=Number(total.rows[0]?.n||0);
      return Response.json({rows:rows.rows,challans:rows.rows,data:rows.rows,page,per_page:per,total:totalCount,total_pages:Math.max(1,Math.ceil(totalCount/per)),available_vehicles:available.rows,dispatch_items:dispatch.rows,suggested_challan_no:"DC-"+Date.now()});
    }
    if(p==="stock/closing-raw"){
      await ensureDispatchSchema();
      const u=new URL(req.url),from=u.searchParams.get("from")||null,to=u.searchParams.get("to")||null;
      const r=await pool.query(`WITH mv AS (SELECT lower(trim(item_name)) AS k,date::date AS d,CASE WHEN UPPER(COALESCE(work_type,''))='OUT' THEN -ABS(qty) WHEN UPPER(COALESCE(work_type,''))='IN' THEN ABS(qty) ELSE qty END AS q FROM journal_stock)
        SELECT p.id,p.name,p.code,p.unit,COALESCE(to_jsonb(p)->>'hsn_code','') AS hsn,
          COALESCE(SUM(mv.q) FILTER (WHERE $1::date IS NOT NULL AND mv.d < $1::date),0) AS opening,
          COALESCE(SUM(mv.q) FILTER (WHERE mv.q>0 AND ($1::date IS NULL OR mv.d>=$1::date) AND ($2::date IS NULL OR mv.d<=$2::date)),0) AS purchased,
          COALESCE(-SUM(mv.q) FILTER (WHERE mv.q<0 AND ($1::date IS NULL OR mv.d>=$1::date) AND ($2::date IS NULL OR mv.d<=$2::date)),0) AS consumed,
          COALESCE(SUM(mv.q) FILTER (WHERE $2::date IS NULL OR mv.d<=$2::date),0) AS closing
        FROM product p LEFT JOIN mv ON mv.k=lower(trim(p.name))
        WHERE p.fro='R' OR (UPPER(COALESCE(p.product_category,''))='DISPATCH' AND COALESCE(p.show_on_delivery_challan,false)=true)
        GROUP BY p.id ORDER BY p.name`,[from,to]);
      const rows=r.rows.map((x:any)=>({...x,opening:Number(x.opening),purchased:Number(x.purchased),consumed:Number(x.consumed),closing:Number(x.closing)}));
      return Response.json({rows,data:rows,count:rows.length});
    }
    if(p==="stock/ledger-raw"){
      const u=new URL(req.url),name=String(u.searchParams.get("item_name")||"").trim(),from=u.searchParams.get("from")||"",to=u.searchParams.get("to")||"";
      const r=await pool.query("SELECT id,date,vou_no,reason,model_name,work_type,qty FROM journal_stock WHERE lower(trim(item_name))=lower(trim($1)) ORDER BY date,id",[name]);
      let bal=0;const events:any[]=[];
      for(const x of r.rows){
        const wt=String(x.work_type||"").toUpperCase(),q=Number(x.qty)||0,signed=wt==="OUT"?-Math.abs(q):wt==="IN"?Math.abs(q):q;bal+=signed;
        const d=ymd(x.date);if((from&&d<from)||(to&&d>to))continue;
        events.push({id:x.id,date:d,type:signed>=0?"IN":"OUT",doc_no:x.vou_no||"",chassis_no:"",model_name:x.model_name||"",party_name:"",particulars:x.reason||"",qty:Math.abs(q),balance:bal});
      }
      return Response.json({events,rows:events,item_name:name,closing:bal});
    }
    if(p==="purchase-bills"){
      const r=await genericGet(req,path,"purchase_bill"),payload=await r.json();
      const rows=(payload.rows||[]).map((pb:any)=>{
        const items=parseItems(pb.items).map((it:any)=>{
          const qty=Number(it.qty||it.quantity||0),rate=Number(it.rate||it.unit_rate||0);
          const taxable=Number(it.taxable_amt??it.taxable_amount??(qty*rate))||0;
          const gstRate=Number(it.gst_rate||it.gst_percent||0);
          const gst=Number(it.gst_amount??it.tax_amount??(taxable*gstRate/100))||0;
          const state=String(pb.party_state_code||"07").trim();
          const intra=state==="07";
          const cgst=Number(it.cgst_amt??it.cgst??(intra?gst/2:0))||0;
          const sgst=Number(it.sgst_amt??it.sgst??(intra?gst/2:0))||0;
          const igst=Number(it.igst_amt??it.igst??(!intra?gst:0))||0;
          const total=Number(it.total_amt??it.total_amount??(taxable+gst))||0;
          return {...it,qty,rate,taxable_amt:taxable,cgst_amt:cgst,sgst_amt:sgst,igst_amt:igst,total_amt:total};
        });
        const firstNum=(...vals:any[])=>{for(const v of vals){const n0=Number(v);if(Number.isFinite(n0)&&n0!==0)return n0;}return 0;};
        const taxable=items.reduce((s:number,x:any)=>s+num(x.taxable_amt),0)||firstNum(pb.taxable_total,pb.taxable_amt,pb.taxable_amount,pb.subtotal,pb.amount_before_tax,pb.taxable_value,pb.net_amount,purchaseLegacyNum(pb,[/(taxable|subtotal|sub_total|before_tax|net_amount)/], [/(rate|percent|gst_rate)/]));
        const cgst=items.reduce((s:number,x:any)=>s+num(x.cgst_amt),0)||firstNum(pb.cgst_total,pb.cgst_amt,pb.cgst,pb.tax_cgst,pb.cgst_amount,purchaseLegacyNum(pb,[/cgst/]));
        const sgst=items.reduce((s:number,x:any)=>s+num(x.sgst_amt),0)||firstNum(pb.sgst_total,pb.sgst_amt,pb.sgst,pb.tax_sgst,pb.sgst_amount,purchaseLegacyNum(pb,[/sgst/]));
        const igst=items.reduce((s:number,x:any)=>s+num(x.igst_amt),0)||firstNum(pb.igst_total,pb.igst_amt,pb.igst,pb.tax_igst,pb.igst_amount,purchaseLegacyNum(pb,[/igst/]));
        const tax=cgst+sgst+igst||firstNum(pb.tax_total,pb.tax_amount,pb.gst_total,pb.gst_amount,pb.total_tax,pb.gst_amount_total,purchaseLegacyNum(pb,[/tax_total|tax_amount|total_tax|gst_total|gst_amount/],[/rate|percent/]));
        const total=items.reduce((s:number,x:any)=>s+num(x.total_amt),0)||firstNum(pb.bill_total,pb.total_amt,pb.total_amount,pb.grand_total,pb.amount,pb.net_total,pb.invoice_total,pb.total,purchaseLegacyNum(pb,[/(grand|bill|invoice|net).*total$/,/total.*(amount|value)/,/^total$/],[/(tax|qty|quantity|rate|percent)/]),taxable+tax);
        const qty=items.reduce((s:number,x:any)=>s+num(x.qty),0)||firstNum(pb.total_qty,pb.qty,pb.quantity,pb.item_qty,pb.units,purchaseLegacyNum(pb,[/^(total_)?qty$/,/quantity/,/^units$/],[/amount|rate|price/]));
        const extra_charges=parseExtraCharges(pb.extra_charges),extra_total=extra_charges.reduce((s:number,e:any)=>s+e.amount+e.amount*e.gst_rate/100,0);
        return {...pb,items,extra_charges,extra_total,taxable_total:taxable,tax_total:tax,bill_total:total+extra_total,total_qty:qty};
      });
      return Response.json(rows);
    }
    if(p==="battery-register"){
      await ensureBatteryRegisterSchema();
      const u=new URL(req.url),q=String(u.searchParams.get("search")||"").trim(),args:any[]=[],where:string[]=[];
      if(q){args.push("%"+q+"%");where.push("(battery_maker ILIKE $1 OR COALESCE(battery_no,'') ILIKE $1 OR COALESCE(source_no,'') ILIKE $1 OR COALESCE(party_name,'') ILIKE $1)");}
      const makers=await pool.query("SELECT name FROM simple_master WHERE kind='battery-maker' ORDER BY name");
      const entries=await pool.query("SELECT * FROM battery_register_entry"+(where.length?" WHERE "+where.join(" AND "):"")+" ORDER BY date DESC,id DESC",args);
      const byMaker=new Map<string,any>();
      for(const m of makers.rows){const name=String(m.name||"").trim();if(name)byMaker.set(name.toLowerCase(),{battery_maker:name,in_qty:0,out_qty:0,balance:0});}
      for(const x of entries.rows){const key=String(x.battery_maker||"").trim().toLowerCase();if(!key)continue;if(!byMaker.has(key))byMaker.set(key,{battery_maker:String(x.battery_maker||"").trim(),in_qty:0,out_qty:0,balance:0});const s=byMaker.get(key),qty=Number(x.qty||0);if(String(x.entry_type).toUpperCase()==="IN")s.in_qty+=qty;else s.out_qty+=qty;s.balance=s.in_qty-s.out_qty;}
      const summary=[...byMaker.values()].filter(x=>!q||String(x.battery_maker).toLowerCase().includes(q.toLowerCase())||entries.rows.some(e=>String(e.battery_maker||"").toLowerCase()===String(x.battery_maker).toLowerCase()));
      const groups=new Map<string,any>();
      for(const x of entries.rows){const key=String(x.source_type||"")+"::"+String(x.source_id||"")+"::"+String(x.date||"")+"::"+String(x.battery_maker||"")+"::"+String(x.entry_type||"");if(!groups.has(key))groups.set(key,{id:x.id,date:x.date,battery_maker:x.battery_maker,entry_type:x.entry_type,qty:0,source_type:x.source_type,source_id:x.source_id,source_no:x.source_no,party_name:x.party_name,dealer_id:x.dealer_id,vehicle_id:x.vehicle_id,remarks:x.remarks,battery_nos:[]});const g=groups.get(key);g.qty+=Number(x.qty||0);if(x.battery_no)g.battery_nos.push(x.battery_no);}
      const details=[...groups.values()].map((x:any)=>({...x,battery_no1:x.battery_nos[0]||"",battery_no2:x.battery_nos[1]||"",battery_no3:x.battery_nos[2]||"",battery_no4:x.battery_nos[3]||""}));
      return Response.json({summary,details,entries:entries.rows,makers:makers.rows.map((x:any)=>x.name)});
    }
    if(p==="old-rickshaws"){
      await ensureOldRickshawLegacySchema();
      const r=await pool.query(`SELECT o.*,d.name AS joined_dealer_name FROM old_rickshaw o LEFT JOIN dealer d ON d.id=o.dealer_id ORDER BY o.date DESC NULLS LAST,o.id DESC LIMIT 2000`);
      const records=r.rows.map((x:any)=>({...x,dealer_name:x.dealer_name||x.joined_dealer_name||"",has_battery:Boolean(x.battery_maker||x.battery_no1||x.battery_no2||x.battery_no3||x.battery_no4),sold_amount:num(x.sold_amount||x.sale_amount),sale_amount:num(x.sale_amount),loan_amount:num(x.loan_amount),receipt_amount:num(x.receipt_amount),balance_amount:num(x.balance_amount||Math.max(0,num(x.sale_amount)-num(x.loan_amount)))}));
      return Response.json({records,rows:records,count:records.length,suggested_record_no:"OR-"+Date.now(),suggested_vou_no:"ORV-"+Date.now()});
    }
    if(p==="inventory/old-rickshaw"){
      await ensureOldRickshawInventorySchema();
      const u=new URL(req.url),status=String(u.searchParams.get("status")||"all").toLowerCase(),q=String(u.searchParams.get("search")||"").trim();
      const args:any[]=[],where:string[]=[];
      if(status==="hold")where.push("status='hold'");
      else if(status==="unsold")where.push("status IN ('hold','available')");
      else if(status==="available")where.push("status='available'");
      else if(status==="sold")where.push("status='sold'");
      if(q){args.push("%"+q+"%");where.push("(vehicle_no ILIKE $"+args.length+" OR COALESCE(battery_maker,'') ILIKE $"+args.length+" OR COALESCE(dealer_name,'') ILIKE $"+args.length+")");}
      const rows=await pool.query("SELECT * FROM old_rickshaw_inventory"+(where.length?" WHERE "+where.join(" AND "):"")+" ORDER BY CASE status WHEN 'available' THEN 1 WHEN 'hold' THEN 2 ELSE 3 END,repo_date DESC NULLS LAST,id DESC LIMIT 2000",args);
      const summary=await pool.query("SELECT COUNT(*)::int AS all,COUNT(*) FILTER(WHERE status='hold')::int AS hold,COUNT(*) FILTER(WHERE status='available')::int AS available,COUNT(*) FILTER(WHERE status='sold')::int AS sold FROM old_rickshaw_inventory");
      const dealers=await pool.query("SELECT id,name,code FROM dealer ORDER BY name");
      return Response.json({rows:rows.rows,summary:summary.rows[0]||{all:0,hold:0,available:0,sold:0},dealers:dealers.rows});
    }
    if(/^delivery-challans\/\d+\/print$/.test(p)){
      const id=idOf(path[path.length-2]);if(!id)return Response.json({error:"Delivery Challan id required."},{status:400});
      const r=await pool.query("SELECT dc.*,d.name AS dealer_name,d.code AS dealer_code,d.mobile AS dealer_mobile,d.gst_no AS dealer_gst_no,COALESCE(to_jsonb(d)->>'salesman','') AS dealer_salesman,v.model_name AS vehicle_model_name,v.chassis_no AS vehicle_chassis_no,v.motor_no AS vehicle_motor_no,v.colour AS vehicle_colour,v.battery_maker,v.battery_no1,v.battery_no2,v.battery_no3,v.battery_no4,COALESCE(to_jsonb(v)->>'umrn_code','') AS umrn_code FROM delivery_challan dc LEFT JOIN dealer d ON d.id=dc.dealer_id LEFT JOIN vehicle v ON v.id=dc.vehicle_id WHERE dc.id=$1",[id]);
      if(!r.rowCount)return Response.json({error:"Delivery Challan not found."},{status:404});
      const x=r.rows[0],challan={...x,product_name:x.product_name||x.vehicle_model_name,chassis_no:x.chassis_no||x.vehicle_chassis_no,motor_no:x.motor_no||x.vehicle_motor_no,colour:x.colour||x.vehicle_colour,salesman:x.salesman||x.dealer_salesman||""};
      const company=(await pool.query("SELECT * FROM company ORDER BY id LIMIT 1")).rows[0]||{};
      {const lg=await productLogo(challan.product_name,x.vehicle_model_name||"");(challan as any).umrn_code=lg.umrn_code||challan.umrn_code||"";(challan as any).logo_keys=lg.logo_keys;}
      return Response.json({challan,company});
    }
    if(/^tax-invoices\/\d+\/print$/.test(p)){
      const id=idOf(path[path.length-2]);if(!id)return Response.json({error:"Tax Invoice id required."},{status:400});
      const u=new URL(req.url),doc=String(u.searchParams.get("doc")||"invoice");
      const r=await pool.query("SELECT ti.*,d.name AS joined_dealer_name,d.code AS dealer_code,d.mobile AS dealer_mobile,d.gst_no AS dealer_gst_no,d.address1 AS dealer_address1,d.address2 AS dealer_address2,v.model_name AS vehicle_model_name,v.chassis_no AS vehicle_chassis_no,v.motor_no AS vehicle_motor_no,v.colour AS vehicle_colour,v.battery_maker,v.battery_no1,v.battery_no2,v.battery_no3,v.battery_no4,COALESCE(to_jsonb(v)->>'umrn_code','') AS umrn_code,COALESCE(to_jsonb(v)->>'colour_code','') AS colour_code FROM tax_invoice ti LEFT JOIN dealer d ON d.id=ti.dealer_id LEFT JOIN vehicle v ON v.id=ti.vehicle_id WHERE ti.id=$1",[id]);
      if(!r.rowCount)return Response.json({error:"Tax Invoice not found."},{status:404});
      const x=r.rows[0],invoice={...x,dealer_name:x.dealer_name||x.joined_dealer_name||"",dealer_code:x.dealer_code||"",dealer_mobile:x.dealer_mobile||"",dealer_gst_no:x.dealer_gst_no||"",dealer_address1:x.dealer_address1||"",dealer_address2:x.dealer_address2||"",product_name:x.product_name||x.vehicle_model_name||"",chassis_no:x.chassis_no||x.vehicle_chassis_no||"",motor_no:x.motor_no||x.vehicle_motor_no||"",colour:x.colour||x.vehicle_colour||"",battery_maker:x.battery_maker||"",battery_no1:x.battery_no1||"",battery_no2:x.battery_no2||"",battery_no3:x.battery_no3||"",battery_no4:x.battery_no4||"",umrn_code:x.umrn_code||"",colour_code:x.colour_code||""};
      const company=(await pool.query("SELECT * FROM company ORDER BY id LIMIT 1")).rows[0]||{};
      const rtoName=String(x.rto||x.rto_name||"").trim();let rto_address="";
      if(rtoName){const rm=await pool.query("SELECT * FROM simple_master WHERE lower(kind)='rto' AND lower(name)=lower($1) ORDER BY id DESC LIMIT 1",[rtoName]);const rr=rm.rows[0]||{};rto_address=String(rr.address||rr.address1||rr.address2||rr.details||"");}
      const lg=await productLogo(invoice.product_name,x.vehicle_model_name||"");invoice.umrn_code=lg.umrn_code||invoice.umrn_code;(invoice as any).logo_keys=lg.logo_keys;
      return Response.json({invoice,company,product:{umrn_code:invoice.umrn_code,logo_keys:lg.logo_keys,colour_code:invoice.colour_code,name:invoice.product_name},doc_title:doc==="invoice"?"TAX INVOICE":doc.toUpperCase(),doc_no_label:doc==="invoice"?"Bill No.":"Document No.",rto_address,print_bank_name:company.bank_name||"",print_bank_account_no:company.bank_account_no||"",print_bank_ifsc:company.bank_ifsc||""});
    }
    if(p==="battery-register/preview"){
      const u=new URL(req.url),type=String(u.searchParams.get("type")||"").toLowerCase(),id=idOf(u.searchParams.get("id"));
      if(!id)return Response.json({error:"Preview id required."},{status:400});
      if(type==="purchase"){const r=await pool.query("SELECT * FROM purchase_bill WHERE id=$1",[id]);if(!r.rowCount)return Response.json({error:"Purchase not found."},{status:404});return Response.json({type:"purchase",purchase:{...r.rows[0],items:parseItems(r.rows[0].items)}});}
      if(type==="delivery_challan"){const r=await pool.query("SELECT dc.*,d.name AS dealer_name,v.battery_maker,v.battery_no1,v.battery_no2,v.battery_no3,v.battery_no4,v.model_name,v.chassis_no,v.motor_no,v.colour FROM delivery_challan dc LEFT JOIN dealer d ON d.id=dc.dealer_id LEFT JOIN vehicle v ON v.id=dc.vehicle_id WHERE dc.id=$1",[id]);if(!r.rowCount)return Response.json({error:"Delivery Challan not found."},{status:404});return Response.json({type:"delivery_challan",challan:r.rows[0]});}
      return Response.json({error:"Unknown preview type."},{status:400});
    }
    if(p==="battery-history"){
      await ensureBatteryFitSchema();
      const u=new URL(req.url),q=String(u.searchParams.get("search")||"").trim().toLowerCase(),from=String(u.searchParams.get("from")||"").trim(),to=String(u.searchParams.get("to")||"").trim();
      const events:any[]=[];
      // Ek source (table) fail ho jaye to poori history 500 na de.
      const safe=async(label:string,fn:()=>Promise<any[]>)=>{try{return await fn()}catch(e){console.error("[battery-history:"+label+"]",e);return []}};
      const push=(rows:any[],type:string)=>rows.forEach((r:any)=>events.push({...r,history_type:type}));
      // Purchase IN / Delivery OUT / Withdrawal-Addition register entries
      push(await safe("register",async()=>(await pool.query(`SELECT bre.*,d.name AS dealer_name,v.chassis_no,v.model_name
        FROM battery_register_entry bre
        LEFT JOIN dealer d ON d.id=bre.dealer_id
        LEFT JOIN vehicle v ON v.id=bre.vehicle_id
        ORDER BY bre.date DESC NULLS LAST,bre.id DESC LIMIT 10000`)).rows),"REGISTER");
      push(await safe("fit",async()=>(await pool.query(`SELECT bfl.*,d.name AS dealer_name
        FROM battery_fit_log bfl LEFT JOIN dealer d ON d.id=bfl.dealer_id
        ORDER BY bfl.fit_date DESC,bfl.id DESC LIMIT 5000`)).rows),"FIT");
      // Dealer withdrawal / addition / delivery movements
      push(await safe("movement",async()=>{
        if(!(await columns("battery_stock_movement")).size)return [];
        return (await pool.query(`SELECT bsm.*,d.name AS dealer_name
          FROM battery_stock_movement bsm LEFT JOIN dealer d ON d.id=bsm.dealer_id
          ORDER BY bsm.date DESC NULLS LAST,bsm.id DESC LIMIT 10000`)).rows;
      }),"DEALER_MOVEMENT");
      push(await safe("factory",async()=>(await pool.query(`SELECT bdc.*,d.name AS dealer_name
        FROM battery_delivery_challan bdc LEFT JOIN dealer d ON d.id=bdc.dealer_id
        ORDER BY bdc.date DESC NULLS LAST,bdc.id DESC LIMIT 5000`)).rows),"FACTORY_CHALLAN");
      // Battery Swap / Transfer vouchers (pehle history me tha hi nahi)
      push(await safe("swap",async()=>{
        if(!(await columns("battery_swap_voucher")).size)return [];
        const ref=(side:string)=>`CASE WHEN lower(COALESCE(bsv.${side}_type,'')) LIKE '%old%'
          THEN (SELECT to_jsonb(o)->>'vehicle_no' FROM old_rickshaw o WHERE o.id=bsv.${side}_id)
          ELSE (SELECT vv.chassis_no FROM vehicle vv WHERE vv.id=bsv.${side}_id) END`;
        const r=(await pool.query(`SELECT bsv.*,d.name AS dealer_name,${ref("from")} AS from_ref,${ref("to")} AS to_ref
          FROM battery_swap_voucher bsv LEFT JOIN dealer d ON d.id=bsv.dealer_id
          ORDER BY bsv.date DESC NULLS LAST,bsv.id DESC LIMIT 5000`)).rows;
        return r.map((x:any)=>({...x,movement_type:String(x.mode||"swap").toLowerCase(),reference_no:x.voucher_no,
          chassis_no:[x.from_ref||("#"+x.from_id),x.to_ref||("#"+x.to_id)].join(" → ")}));
      }),"SWAP");
      const dateOf=(r:any)=>ymd(r.fit_date||r.date||r.created_at);
      const inRange=(r:any)=>{const d=dateOf(r);return (!from||(d&&d>=from))&&(!to||(d&&d<=to))};
      const textOf=(r:any)=>[r.battery_maker,r.battery_no,r.battery_no1,r.battery_no2,r.battery_no3,r.battery_no4,r.challan_no,r.source_no,r.source_type,r.entry_type,r.movement_type,r.reference_no,r.voucher_no,r.party_name,r.dealer_name,r.chassis_no,r.model_name,r.remarks].filter(Boolean).join(" ").toLowerCase();
      const rows=events.filter(r=>inRange(r)&&(!q||textOf(r).includes(q))).sort((x,y)=>String(dateOf(y)).localeCompare(String(dateOf(x)))||Number(y.id||0)-Number(x.id||0));
      const counts:any={};for(const r of rows)counts[r.history_type]=(counts[r.history_type]||0)+1;
      return Response.json({history:rows,rows,count:rows.length,counts});
    }
    if(p==="hypothecation-receipts/lookup"){
      const u=new URL(req.url);
      const invoices=await hypFindInvoices(u.searchParams.get("chassis_no")||"",u.searchParams.get("vehicle_no")||"");
      return Response.json({found:invoices.length>0,invoice:invoices[0]||null,invoices});
    }
    if(p==="hypothecation-receipts"){
      await ensureHypReceiptSchema();
      const u=new URL(req.url),q=String(u.searchParams.get("search")||"").trim(),from=importDate(u.searchParams.get("from")||""),to=importDate(u.searchParams.get("to")||"");
      const args:any[]=[],where:string[]=[];
      if(q){args.push("%"+q+"%");const i=args.length;where.push(`(financer_name ILIKE $${i} OR cheque_no ILIKE $${i} OR COALESCE(chassis_no,'') ILIKE $${i} OR COALESCE(vehicle_no,'') ILIKE $${i} OR COALESCE(bill_no,'') ILIKE $${i} OR COALESCE(buyer_name,'') ILIKE $${i})`);}
      if(from){args.push(from);where.push(`receipt_date>=$${args.length}::date`);}
      if(to){args.push(to);where.push(`receipt_date<=$${args.length}::date`);}
      const r=await pool.query(`SELECT id,to_char(receipt_date,'YYYY-MM-DD') AS receipt_date,financer_name,amount,cheque_no,tax_invoice_id,chassis_no,vehicle_no,bill_no,buyer_name,remarks,created_by,pay_mode,bank_name FROM hypothecation_receipt ${where.length?"WHERE "+where.join(" AND "):""} ORDER BY receipt_date DESC,id DESC LIMIT 500`,args);
      return Response.json({receipts:r.rows,rows:r.rows,total:r.rows.reduce((t:number,x:any)=>t+num(x.amount),0)});
    }
    if(p==="bank-ledger"){
      await ensureBankLedgerSchema();
      const u=new URL(req.url),q=String(u.searchParams.get("search")||"").trim(),st=String(u.searchParams.get("status")||"all").toUpperCase();
      const bank=String(u.searchParams.get("bank")||"").trim(),from=importDate(u.searchParams.get("from")||""),to=importDate(u.searchParams.get("to")||"");
      const args:any[]=[],where:string[]=[];
      if(q){args.push("%"+q+"%");const i=args.length;where.push(`(bank_name ILIKE $${i} OR COALESCE(cheque_no,'') ILIKE $${i} OR COALESCE(upi_ref,'') ILIKE $${i} OR COALESCE(narration,'') ILIKE $${i} OR COALESCE(party_name,'') ILIKE $${i})`)}
      if(st!=="ALL"){args.push(st);where.push(`status=$${args.length}`)}
      if(bank){args.push(bank);where.push(`lower(btrim(bank_name))=lower(btrim($${args.length}))`)}
      if(from){args.push(from);where.push(`entry_date>=$${args.length}::date`)}
      if(to){args.push(to);where.push(`entry_date<=$${args.length}::date`)}
      const rr=await pool.query(`SELECT * FROM bank_ledger_entry ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY entry_date DESC,id DESC LIMIT 10000`,args);
      const br=await pool.query("SELECT id,name,account_no,ifsc FROM simple_master WHERE lower(kind)='bank' ORDER BY name").catch(()=>({rows:[]}));
      // Per-bank ledger totals: only POSTED entries move the balance; SUSPENSE is shown separately.
      const sm=await pool.query(`SELECT lower(btrim(bank_name)) k,MAX(bank_name) bank_name,
          COALESCE(SUM(CASE WHEN status='POSTED' AND entry_type='RECEIPT' THEN ABS(amount) END),0) receipts,
          COALESCE(SUM(CASE WHEN status='POSTED' AND entry_type='PAYMENT' THEN ABS(amount) END),0) payments,
          COUNT(*) FILTER (WHERE status='SUSPENSE') suspense_count,COALESCE(SUM(ABS(amount)) FILTER (WHERE status='SUSPENSE'),0) suspense_amount
        FROM bank_ledger_entry GROUP BY lower(btrim(bank_name))`);
      let opening=0;
      if(bank&&from){const o=await pool.query(`SELECT COALESCE(SUM(CASE WHEN entry_type='RECEIPT' THEN ABS(amount) WHEN entry_type='PAYMENT' THEN -ABS(amount) ELSE 0 END),0) v FROM bank_ledger_entry WHERE status='POSTED' AND entry_date<$1::date AND lower(btrim(bank_name))=lower(btrim($2))`,[from,bank]);opening=Number(o.rows[0]?.v||0);}
      return Response.json({rows:rr.rows,banks:br.rows,summary:sm.rows.map((x:any)=>({bank_name:x.bank_name,receipts:Number(x.receipts),payments:Number(x.payments),balance:Number(x.receipts)-Number(x.payments),suspense_count:Number(x.suspense_count),suspense_amount:Number(x.suspense_amount)})),opening});
    }

    if(p==="insurance-register"){
      await ensureInsuranceRegisterSchema();
      const u=new URL(req.url),type=String(u.searchParams.get("type")||"NEW").toUpperCase()==="OLD"?"OLD":"NEW";
      const q=String(u.searchParams.get("search")||"").trim(),st=String(u.searchParams.get("status")||"all").toLowerCase();
      const args:any[]=[type],where=["insurance_type=$1"];
      if(q){args.push("%"+q+"%");where.push("(customer_name ILIKE $2 OR insurer ILIKE $2 OR COALESCE(chassis_no,'') ILIKE $2 OR COALESCE(bill_no,'') ILIKE $2 OR COALESCE(sp_no,'') ILIKE $2 OR COALESCE(vehicle,'') ILIKE $2)");}
      const rr=await pool.query(`SELECT * FROM insurance_register WHERE ${where.join(" AND ")} ORDER BY date DESC,id DESC LIMIT 10000`,args);
      const rows=rr.rows,lc=(v:any)=>String(v||"").trim().toLowerCase();
      // Batched lookups (was 2 queries per row -> timeouts on big lists).
      const invByChassis=new Map<string,any>(),invByBill=new Map<string,any>(),orBySp=new Map<string,any>(),orByReg=new Map<string,any>();
      if(type==="NEW"){
        const ch=[...new Set(rows.map((r:any)=>lc(r.chassis_no)).filter(Boolean))],bl=[...new Set(rows.map((r:any)=>lc(r.bill_no)).filter(Boolean))];
        if(ch.length||bl.length){const mr=await pool.query(`SELECT id,bill_no,buyer_name,chassis_no FROM tax_invoice WHERE COALESCE(cancelled,false)=false AND (lower(btrim(COALESCE(chassis_no,'')))=ANY($1::text[]) OR lower(btrim(COALESCE(bill_no,'')))=ANY($2::text[])) ORDER BY id`,[ch,bl]).catch(()=>({rows:[]}));
          for(const x of mr.rows){if(lc(x.chassis_no))invByChassis.set(lc(x.chassis_no),x);if(lc(x.bill_no))invByBill.set(lc(x.bill_no),x);}}
      }else{
        // Old insurance is tagged against Old Rickshaw inventory (SP No. / vehicle reg no.).
        const sp=[...new Set(rows.map((r:any)=>lc(r.sp_no)).filter(Boolean))],rg=[...new Set(rows.map((r:any)=>lc(r.vehicle).replace(/[\s-]+/g,"")).filter(Boolean))];
        if(sp.length||rg.length){const mr=await pool.query(`SELECT id,sp_no,vehicle_reg_no,owner_name FROM old_rickshaw WHERE lower(btrim(COALESCE(sp_no,'')))=ANY($1::text[]) OR lower(regexp_replace(COALESCE(vehicle_reg_no,''),'[\\s-]+','','g'))=ANY($2::text[]) ORDER BY id`,[sp,rg]).catch(()=>({rows:[]}));
          for(const x of mr.rows){if(lc(x.sp_no))orBySp.set(lc(x.sp_no),x);if(lc(x.vehicle_reg_no))orByReg.set(lc(x.vehicle_reg_no).replace(/[\s-]+/g,""),x);}}
      }
      const out=rows.map((r:any)=>{
        if(type==="NEW"){const m=invByChassis.get(lc(r.chassis_no))||invByBill.get(lc(r.bill_no))||null;
          return {...r,mapping_status:m?"BILLED":"UNBILLED",mapped_bill_no:m?.bill_no||"",mapped_invoice_id:m?.id||null,mapped_customer:m?.buyer_name||"",mapped_chassis:m?.chassis_no||""};}
        const m=orBySp.get(lc(r.sp_no))||orByReg.get(lc(r.vehicle).replace(/[\s-]+/g,""))||null;
        return {...r,mapping_status:m?"TAGGED":"UNTAGGED",mapped_old_rickshaw_id:m?.id||null,mapped_customer:m?.owner_name||""};
      });
      const filtered=st==="billed"||st==="tagged"?out.filter((r:any)=>["BILLED","TAGGED"].includes(r.mapping_status)):st==="unbilled"||st==="untagged"?out.filter((r:any)=>!["BILLED","TAGGED"].includes(r.mapping_status)):out;
      // On-account insurer ledger: payments are NOT tied to a record; balance = total payable (New+Old) - vouchers paid to that insurer.
      const pay=await pool.query(`SELECT lower(btrim(insurer)) k,MAX(insurer) insurer,COALESCE(SUM(payable_amount) FILTER (WHERE insurance_type='NEW'),0) new_payable,COALESCE(SUM(payable_amount) FILTER (WHERE insurance_type='OLD'),0) old_payable,COUNT(*) records FROM insurance_register GROUP BY lower(btrim(insurer))`);
      const paid=await pool.query(`SELECT lower(btrim(pay_to_name)) k,COALESCE(SUM(amount),0) paid FROM expense_payment_voucher WHERE lower(COALESCE(expense_type,'')) IN ('insurance','insurance_expense') AND UPPER(COALESCE(status,'')) NOT IN ('CANCELLED','CANCELED','REJECTED') GROUP BY lower(btrim(pay_to_name))`).catch(()=>({rows:[]}));
      const paidMap=new Map(paid.rows.map((x:any)=>[x.k,Number(x.paid)]));
      const insurer_summary=pay.rows.filter((x:any)=>x.k).map((x:any)=>{const np=Number(x.new_payable),op=Number(x.old_payable),pd=paidMap.get(x.k)||0;return {insurer:x.insurer,records:Number(x.records),new_payable:np,old_payable:op,payable:np+op,paid:pd,balance:np+op-pd};}).sort((a:any,b:any)=>b.balance-a.balance);
      return Response.json({rows:filtered,insurers:[...new Set(rows.map((r:any)=>String(r.insurer||"").trim()).filter(Boolean))],insurer_summary});
    }
    if(p==="rto-register"){
      await ensureRtoRegisterSchema();
      const u=new URL(req.url),type=String(u.searchParams.get("type")||"NEW").toUpperCase()==="OLD"?"OLD":"NEW";
      const q=String(u.searchParams.get("search")||"").trim(),st=String(u.searchParams.get("status")||"all").toLowerCase();
      const args:any[]=[type],where=["rto_type=$1"];
      if(q){args.push("%"+q+"%");where.push("(customer_name ILIKE $2 OR rto_agent ILIKE $2 OR COALESCE(work_type,'') ILIKE $2 OR COALESCE(chassis_no,'') ILIKE $2 OR COALESCE(bill_no,'') ILIKE $2 OR COALESCE(sp_no,'') ILIKE $2 OR COALESCE(vehicle,'') ILIKE $2)");}
      const rr=await pool.query(`SELECT * FROM rto_expense_register WHERE ${where.join(" AND ")} ORDER BY date DESC,id DESC LIMIT 10000`,args);
      const rows=rr.rows,lc=(v:any)=>String(v||"").trim().toLowerCase(),nospace=(v:any)=>lc(v).replace(/[\s-]+/g,"");
      const invByChassis=new Map<string,any>(),invByBill=new Map<string,any>(),orBySp=new Map<string,any>(),orByReg=new Map<string,any>();
      if(type==="NEW"){
        const ch=[...new Set(rows.map((r:any)=>lc(r.chassis_no)).filter(Boolean))],bl=[...new Set(rows.map((r:any)=>lc(r.bill_no)).filter(Boolean))];
        if(ch.length||bl.length){const mr=await pool.query(`SELECT id,bill_no,buyer_name,chassis_no FROM tax_invoice WHERE COALESCE(cancelled,false)=false AND (lower(btrim(COALESCE(chassis_no,'')))=ANY($1::text[]) OR lower(btrim(COALESCE(bill_no,'')))=ANY($2::text[])) ORDER BY id`,[ch,bl]).catch(()=>({rows:[]}));
          for(const x of mr.rows){if(lc(x.chassis_no))invByChassis.set(lc(x.chassis_no),x);if(lc(x.bill_no))invByBill.set(lc(x.bill_no),x);}}
      }else{
        const sp=[...new Set(rows.map((r:any)=>lc(r.sp_no)).filter(Boolean))],rg=[...new Set(rows.map((r:any)=>nospace(r.vehicle)).filter(Boolean))];
        if(sp.length||rg.length){const mr=await pool.query(`SELECT id,sp_no,vehicle_reg_no,owner_name FROM old_rickshaw WHERE lower(btrim(COALESCE(sp_no,'')))=ANY($1::text[]) OR lower(regexp_replace(COALESCE(vehicle_reg_no,''),'[\\s-]+','','g'))=ANY($2::text[]) ORDER BY id`,[sp,rg]).catch(()=>({rows:[]}));
          for(const x of mr.rows){if(lc(x.sp_no))orBySp.set(lc(x.sp_no),x);if(lc(x.vehicle_reg_no))orByReg.set(nospace(x.vehicle_reg_no),x);}}
      }
      const out=rows.map((r:any)=>{
        if(type==="NEW"){const m=invByChassis.get(lc(r.chassis_no))||invByBill.get(lc(r.bill_no))||null;return {...r,mapping_status:m?"BILLED":"UNBILLED",mapped_bill_no:m?.bill_no||"",mapped_invoice_id:m?.id||null,mapped_customer:m?.buyer_name||""};}
        const m=orBySp.get(lc(r.sp_no))||orByReg.get(nospace(r.vehicle))||null;return {...r,mapping_status:m?"TAGGED":"UNTAGGED",mapped_old_rickshaw_id:m?.id||null,mapped_customer:m?.owner_name||""};
      });
      const good=["BILLED","TAGGED"];
      const filtered=st==="billed"||st==="tagged"?out.filter((r:any)=>good.includes(r.mapping_status)):st==="unbilled"||st==="untagged"?out.filter((r:any)=>!good.includes(r.mapping_status)):out;
      // On-account agent ledger: expense vouchers (type rto_expense) paid to the agent are not tied to records.
      const pay=await pool.query(`SELECT lower(btrim(rto_agent)) k,MAX(rto_agent) agent,COALESCE(SUM(amount) FILTER (WHERE rto_type='NEW'),0) new_amt,COALESCE(SUM(amount) FILTER (WHERE rto_type='OLD'),0) old_amt,COUNT(*) records FROM rto_expense_register GROUP BY lower(btrim(rto_agent))`);
      const paid=await pool.query(`SELECT lower(btrim(pay_to_name)) k,COALESCE(SUM(amount),0) paid FROM expense_payment_voucher WHERE lower(COALESCE(expense_type,'')) IN ('rto_expense','rto') AND UPPER(COALESCE(status,'')) NOT IN ('CANCELLED','CANCELED','REJECTED') GROUP BY lower(btrim(pay_to_name))`).catch(()=>({rows:[]}));
      const paidMap=new Map(paid.rows.map((x:any)=>[x.k,Number(x.paid)]));
      const agent_summary=pay.rows.filter((x:any)=>x.k).map((x:any)=>{const n=Number(x.new_amt),o=Number(x.old_amt),pd=paidMap.get(x.k)||0;return {agent:x.agent,records:Number(x.records),new_amount:n,old_amount:o,total:n+o,paid:pd,balance:n+o-pd};}).sort((a:any,b:any)=>b.balance-a.balance);
      const pm=await pool.query("SELECT DISTINCT name FROM simple_master WHERE lower(kind)='party' AND lower(COALESCE(sub_category,''))='rto' AND COALESCE(name,'')<>'' ORDER BY name").catch(()=>({rows:[]}));
      return Response.json({rows:filtered,agents:pm.rows.map((x:any)=>x.name),agent_summary});
    }
    if(p==="insurance-register/export"){
      await ensureInsuranceRegisterSchema();
      const u=new URL(req.url),type=String(u.searchParams.get("type")||"NEW").toUpperCase();
      const rr=await pool.query("SELECT * FROM insurance_register WHERE insurance_type=$1 ORDER BY date DESC,id DESC",[type]);
      return Response.json({rows:rr.rows});
    }

    if(p==="showroom/expenses-reports"){
      const u=new URL(req.url),from=String(u.searchParams.get("from")||"").trim(),to=String(u.searchParams.get("to")||"").trim(),search=String(u.searchParams.get("search")||"").trim().toLowerCase();
      const vcols=await columns("expense_payment_voucher");
      const vsql=vcols.has("dealer_id")
        ?"SELECT v.*,d.name AS dealer_name FROM expense_payment_voucher v LEFT JOIN dealer d ON d.id=v.dealer_id ORDER BY v.date DESC,v.id DESC LIMIT 5000"
        :"SELECT * FROM expense_payment_voucher ORDER BY date DESC,id DESC LIMIT 5000";
      const vouchers=(await pool.query(vsql)).rows;
      let shop:any[]=[];
      try{await ensureDealerCashSchema();shop=(await pool.query("SELECT e.*,d.name AS dealer_name FROM dealer_cash_expense e LEFT JOIN dealer d ON d.id=e.dealer_id ORDER BY e.date DESC,e.id DESC LIMIT 5000")).rows;}catch(e){console.error("[showroom expenses]",e);shop=[]}
      const inRange=(r:any)=>{const d=ymd(r.date||r.expense_date);return (!from||(d&&d>=from))&&(!to||(d&&d<=to))};
      const textOf=(r:any)=>[r.expense_type_name,r.expense_type,r.pay_to_name,r.dealer_name,r.remarks,r.bill_no,r.voucher_no,r.category,r.category_label,r.paid_to,r.expense_no].filter(Boolean).join(" ").toLowerCase();
      // Cancelled / inactive rows total me nahi gino (ledger bhi sirf ACTIVE shop expense leta hai).
      const voucherLive=(r:any)=>!["CANCELLED","CANCELED","DELETED"].includes(String(r.status||"").trim().toUpperCase())&&r.cancelled!==true;
      const shopLive=(r:any)=>String(r.status||"ACTIVE").trim().toUpperCase()==="ACTIVE";
      const v=vouchers.filter((r:any)=>voucherLive(r)&&inRange(r)&&(!search||textOf(r).includes(search)));
      const s=shop.filter((r:any)=>shopLive(r)&&inRange(r)&&(!search||textOf(r).includes(search)));
      const voucher_total=v.reduce((n:number,r:any)=>n+num(r.amount),0),shop_total=s.reduce((n:number,r:any)=>n+num(r.amount),0);
      return Response.json({vouchers:v,shop_expenses:s,voucher_total,shop_total,total_expenses:voucher_total+shop_total});
    }
    const table=tableFor(path);
    if(table)return genericGet(req,path,table);
    return Response.json({error:"Node API route not implemented",path:"/api/"+p},{status:404});
  } catch (e) {
    const message=e instanceof Error ? e.message : "Internal server error";
    console.error("[node-api GET]",e);
    return Response.json({error:message},{status:500});
  }
}

export async function POST(req:Request,{params}:{params:Promise<{path?:string[]}>}){
  try{
    const {path=[]}=await params,p=path.join("/");
    if(p==="health")return Response.json({status:"ok",backend:"node",python:false});
    const b:any=await json(req);

    // CHFPL -> GRD status webhook is server-to-server. Check the bridge
    // secret before JWT auth so CHFPL does not need a browser/session token.
    if(p==="loan-status-webhook"){
      const expected=String(process.env.CHFPL_GRD_BRIDGE_SECRET||"").trim();
      const supplied=String(req.headers.get("x-grd-bridge-secret")||"").trim();
      if(!expected || !supplied || supplied!==expected)
        return Response.json({success:false,error:"Invalid CHFPL bridge secret."},{status:401});
      await ensureLoanWorkflowBridgeSchema();await ensureChfplLoanCache();
      // Accepted bodies:
      //  A) {application:{...full row...}}  or  {applications:[{...},{...}]}   (full data, recommended)
      //  B) {chfpl_loan_id,status,grd_submission_ref?,tvr_status?}              (status-only, old format)
      //  C) {event:"deleted",chfpl_loan_id}                                     (remove from GRD)
      const cid0=idOf(b.chfpl_loan_id);
      if((b.event==="deleted"||b.deleted===true)&&cid0){
        await pool.query("DELETE FROM chfpl_loan_cache WHERE chfpl_loan_id=$1",[cid0]);
        return Response.json({success:true,deleted:cid0});
      }
      let list:any[]=Array.isArray(b.applications)?b.applications:(b.application&&typeof b.application==="object"?[b.application]:[]);
      if(!list.length){
        const status0=String(b.status||"").trim();
        if(!cid0||!status0)return Response.json({success:false,error:"application(s) ya chfpl_loan_id + status required hai."},{status:400});
        list=[{id:cid0,status:status0,...(b.tvr_status!==undefined?{tvr_status:b.tvr_status}:{}),grd_submission_ref:b.grd_submission_ref}];
      }
      list=list.filter((x:any)=>idOf(x?.id??x?.chfpl_loan_id));
      if(!list.length)return Response.json({success:false,error:"Har application me id / chfpl_loan_id chahiye."},{status:400});
      const saved=await upsertChfplLoanRows(list);
      let linked:any=null;
      for(const row of list){
        const cid=idOf(row.id??row.chfpl_loan_id),status=String(row.status||"").trim();
        if(!status)continue;
        try{
          const r=await pool.query(
            "UPDATE loan_workflow SET chfpl_loan_id=$1,status=$2,chfpl_status_updated_at=NOW(),updated_at=NOW() WHERE chfpl_loan_id=$1 OR ($3::bigint IS NOT NULL AND id=$3::bigint) OR ($4<>'' AND application_no=$4) RETURNING id,application_no,status,chfpl_loan_id",
            [cid,status,idOf(row.grd_submission_ref??b.grd_submission_ref)||null,String(row.application_no||"").trim()]);
          if(r.rows[0]&&!linked)linked=r.rows[0];
        }catch(_e){/* unique-link conflict: cache already saved, workflow link ko baad me theek kar sakte hain */}
      }
      return Response.json({success:true,saved,application:linked});
    }

    const a=auth(req);if(!a)return Response.json({error:"Authentication required."},{status:401});
    await ensureSecuritySchema();
    if(!(await actionAllowed(a,p,"create")))return Response.json({error:"Forbidden."},{status:403});

    if(p==="admin/backfill-loan-status"){
      if(!isAdmin(a))return Response.json({error:"Admin rights required."},{status:403});
      await ensureLoanWorkflowBridgeSchema();
      const body:any=await json(req);
      const requestedDealerId=idOf(body.dealer_id);
      const q:any={};
      if(requestedDealerId)q.grd_dealer_id=String(requestedDealerId);
      const remote=await chfplBridge("/api/grd-dealer-loans",q);
      const applications=Array.isArray(remote?.applications)?remote.applications:[];
      let updated=0,inserted=0,skipped=0;
      const details:any[]=[];
      for(const row of applications){
        const chfplLoanId=idOf(row.id);
        if(!chfplLoanId){skipped++;continue}
        const applicationNo=String(row.application_no||"").trim();
        const status=String(row.status||"submitted").trim()||"submitted";
        const grdDealerId=idOf(row.grd_dealer_id);
        let dealerId=grdDealerId;
        if(!dealerId && String(row.dealer_code||"").trim()){
          const dr=await pool.query("SELECT id FROM dealer WHERE code=$1 LIMIT 1",[String(row.dealer_code).trim()]);
          dealerId=idOf(dr.rows[0]?.id);
        }
        if(requestedDealerId && dealerId!==requestedDealerId){skipped++;continue}
        const existing=await pool.query(
          "SELECT id,customer_id FROM loan_workflow WHERE chfpl_loan_id=$1 OR ($2<>'' AND application_no=$2) ORDER BY CASE WHEN chfpl_loan_id=$1 THEN 0 ELSE 1 END,id LIMIT 1",
          [chfplLoanId,applicationNo]
        );
        let customerId=idOf(existing.rows[0]?.customer_id);
        const customerName=String(row.customer_name||"").trim();
        const customerPhone=String(row.customer_phone||"").trim();
        if(!customerId && dealerId && (customerName||customerPhone)){
          const cr=await pool.query(
            "SELECT id FROM customer WHERE dealer_id=$1 AND ((COALESCE(btrim(phone),'')=$2 AND $2<>'') OR (lower(btrim(COALESCE(full_name,'')))=lower($3) AND $3<>'')) ORDER BY id LIMIT 1",
            [dealerId,customerPhone,customerName]
          );
          customerId=idOf(cr.rows[0]?.id);
        }
        if(!customerId && dealerId && customerName){
          const cc=await columns("customer");
          const input:any={dealer_id:dealerId,full_name:customerName,phone:customerPhone||null};
          const keys=Object.keys(input).filter(k=>cc.has(k));
          if(keys.length){
            const cr=await pool.query(
              "INSERT INTO customer ("+keys.map(k=>'"'+k+'"').join(",")+") VALUES ("+keys.map((_,i)=>"$"+(i+1)).join(",")+") RETURNING id",
              keys.map(k=>input[k])
            );
            customerId=idOf(cr.rows[0]?.id);
          }
        }
        const loanAmount=num(row.loan_amount_requested);
        const modelName=String(row.vehicle_model_name||"").trim()||null;
        const vehicleType="3W";
        if(existing.rowCount){
          const u=await pool.query(
            "UPDATE loan_workflow SET chfpl_loan_id=$1,status=$2,chfpl_status_updated_at=COALESCE($3::timestamptz,NOW()),updated_at=NOW(),dealer_id=COALESCE(dealer_id,$4),customer_id=COALESCE(customer_id,$5),loan_amount=CASE WHEN COALESCE(loan_amount,0)=0 THEN $6 ELSE loan_amount END,loan_model_name=COALESCE(NULLIF(loan_model_name,''),$7),loan_vehicle_type=COALESCE(NULLIF(loan_vehicle_type,''),$8) WHERE id=$9 RETURNING id,application_no,status,chfpl_loan_id",
            [chfplLoanId,status,row.submitted_at||null,dealerId,customerId,loanAmount,modelName,vehicleType,existing.rows[0].id]
          );
          if(u.rowCount)updated++;
        }else{
          const localNo=applicationNo||("CHFPL-"+chfplLoanId);
          const ins=await pool.query(
            "INSERT INTO loan_workflow (application_no,dealer_id,customer_id,status,loan_amount,loan_model_name,loan_vehicle_type,chfpl_loan_id,chfpl_status_updated_at,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9::timestamptz,NOW()),COALESCE($9::timestamptz,NOW()),NOW()) RETURNING id,application_no,status,chfpl_loan_id",
            [localNo,dealerId,customerId,status,loanAmount,modelName,vehicleType,chfplLoanId,row.submitted_at||null]
          );
          if(ins.rowCount)inserted++;
        }
      }
      return Response.json({success:true,total:applications.length,updated,inserted,skipped});
    }


    // Profile endpoints are self-service: any authenticated staff user may
    // update their own profile/password without needing an admin module flag.
    if(p==="auth/profile"){
      if(a.scope!=="staff")return Response.json({error:"Staff profile only."},{status:403});
      const uid=num(a.sub),cols=await columns("user"),input:any={};
      const allowed=["full_name","mobile","email","address","date_of_birth"];
      for(const key of allowed){
        if(!cols.has(key))continue;
        const value=b[key];
        input[key]=key==="date_of_birth" ? (String(value||"").trim()||null) : String(value??"").trim();
      }
      const keys=Object.keys(input);
      if(!keys.length)return Response.json({error:"Profile fields are not available."},{status:400});
      const sets=keys.map((k,i)=>'"'+k+'"=$'+(i+1));
      const r=await pool.query('UPDATE "user" SET '+sets.join(",")+' WHERE id=$'+(keys.length+1)+' RETURNING *',[...keys.map(k=>input[k]),uid]);
      if(!r.rowCount)return Response.json({error:"User not found."},{status:404});
      const row={...r.rows[0]};delete row.password_hash;
      return Response.json({success:true,user:row});
    }

    if(p==="dealer/profile"){
      if(a.scope!=="dealer"||String(a.role||"")!=="salesman")return Response.json({error:"Profile is managed by admin for dealer logins."},{status:403});
      const uid=num(a.sub),cols=await columns("user"),input:any={};
      for(const key of ["full_name","mobile","email","address","date_of_birth"]){
        if(!cols.has(key))continue;
        const value=b[key];
        input[key]=key==="date_of_birth" ? (String(value||"").trim()||null) : String(value??"").trim();
      }
      const keys=Object.keys(input);
      if(!keys.length)return Response.json({error:"Profile fields are not available."},{status:400});
      const sets=keys.map((k,i)=>'"'+k+'"=$'+(i+1));
      const r=await pool.query('UPDATE "user" SET '+sets.join(",")+' WHERE id=$'+(keys.length+1)+' RETURNING id',[...keys.map(k=>input[k]),uid]);
      if(!r.rowCount)return Response.json({error:"User not found."},{status:404});
      return Response.json({success:true});
    }
    if(p==="dealer/change-password"){
      if(a.scope!=="dealer")return Response.json({error:"Portal password only."},{status:403});
      const current=String(b.current_password||""),next=String(b.new_password||""),confirm=String(b.confirm_password||"");
      if(!current||!next)return Response.json({error:"Current and new password are required."},{status:400});
      if(next!==confirm)return Response.json({error:"New password and confirm password do not match."},{status:400});
      if(next.length<4)return Response.json({error:"New password must be at least 4 characters."},{status:400});
      const isSm=String(a.role||"")==="salesman";
      const table=isSm?'"user"':'dealer',id=isSm?num(a.sub):num(a.dealer_id);
      const r=await pool.query('SELECT password_hash FROM '+table+' WHERE id=$1',[id]);
      if(!r.rowCount)return Response.json({error:"Account not found."},{status:404});
      const crypto=await import("crypto");
      if(!pwVerifyHash(crypto,r.rows[0].password_hash,current))return Response.json({error:"Current password is incorrect."},{status:400});
      await pool.query('UPDATE '+table+' SET password_hash=$1 WHERE id=$2',[pwMakeHash(crypto,next),id]);
      return Response.json({success:true});
    }

    if(p==="auth/change-password"){
      if(a.scope!=="staff")return Response.json({error:"Staff password only."},{status:403});
      const current=String(b.current_password||""),next=String(b.new_password||""),confirm=String(b.confirm_password||"");
      if(!current||!next)return Response.json({error:"Current and new password are required."},{status:400});
      if(next!==confirm)return Response.json({error:"New password and confirm password do not match."},{status:400});
      if(next.length<4)return Response.json({error:"New password must be at least 4 characters."},{status:400});
      const r=await pool.query('SELECT password_hash FROM "user" WHERE id=$1',[num(a.sub)]);
      if(!r.rowCount)return Response.json({error:"User not found."},{status:404});
      const crypto=await import("crypto"),hash=String(r.rows[0].password_hash||"");
      let valid=false,m=hash.match(/^pbkdf2:(sha1|sha256|sha512):(\d+)\$([^$]+)\$([^$]+)$/);
      if(m){
        const digest=m[1],iterations=Number(m[2]),salt=m[3],expected=m[4];
        const actual=crypto.pbkdf2Sync(current,salt,iterations,Math.floor(expected.length/2),digest).toString("hex");
        valid=actual.length===expected.length && crypto.timingSafeEqual(Buffer.from(actual),Buffer.from(expected));
      }else if((m=hash.match(/^scrypt:(\d+):(\d+):(\d+)\$([^$]+)\$([^$]+)$/))){
        const N=Number(m[1]),rr=Number(m[2]),pp=Number(m[3]),salt=m[4],expected=m[5];
        const actual=crypto.scryptSync(current,salt,Buffer.from(expected,"hex").length,{N,r:rr,p:pp,maxmem:Math.max(128*N*rr+1024,64*1024*1024)}).toString("hex");
        valid=actual.length===expected.length && crypto.timingSafeEqual(Buffer.from(actual),Buffer.from(expected));
      }
      if(!valid)return Response.json({error:"Current password is incorrect."},{status:400});
      const salt=crypto.randomBytes(16).toString("hex"),newHash=crypto.pbkdf2Sync(next,salt,260000,32,"sha256").toString("hex"),value="pbkdf2:sha256:260000$"+salt+"$"+newHash;
      await pool.query('UPDATE "user" SET password_hash=$1 WHERE id=$2',[value,num(a.sub)]);
      return Response.json({success:true});
    }

    if(!canWrite(a,p))return Response.json({error:"Forbidden."},{status:403});
    { const cm=await chassisMasterWrite(path,"POST",b);if(cm)return cm; }
    if(p==="users")return saveUserRecord(b);
    // Production Formula: naam ya model (Finished Product) badalna - us formula ki saari lines + pending vouchers ka formula_name/product_name.
    if(p==="production-formulas/rename"){
      await ensureProductionFormulaSchema();
      const oldProduct=String(b.old_product_name||b.product_name||"").trim(),newProduct=String(b.new_product_name||oldProduct).trim();
      const oldName=String(b.old_formula_name||"").trim(),newName=String(b.new_formula_name||"").trim();
      const ids:number[]=(Array.isArray(b.ids)?b.ids:[]).map((x:any)=>Number(x)).filter((x:number)=>Number.isFinite(x)&&x>0);
      if(!newProduct||!newName)return Response.json({error:"Product aur naya Formula Name zaroori hai."},{status:400});
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        // Rows to rename: by id (exact) when the screen sends them, else by normalised product+formula name.
        let rowsQ:any;
        if(ids.length)rowsQ=await client.query("SELECT id,product_name,formula_name FROM production_formula WHERE id=ANY($1::bigint[])",[ids]);
        else rowsQ=await client.query("SELECT id,product_name,formula_name FROM production_formula WHERE "+NORM("product_name")+"="+NORM("$1")+" AND "+NORM("formula_name")+"="+NORM("$2"),[oldProduct,oldName]);
        if(!rowsQ.rowCount){
          const dbg=await client.query("SELECT DISTINCT product_name,formula_name FROM production_formula WHERE "+NORM("product_name")+" LIKE '%'||"+NORM("$1")+"||'%' LIMIT 5",[oldProduct]);
          throw new Error("Purana formula nahi mila. Search: ["+oldProduct+"]/["+oldName+"]. DB me is product ke formula: "+(dbg.rows.map((x:any)=>"["+x.product_name+"]/["+x.formula_name+"]").join(", ")||"koi nahi"));
        }
        const rowIds=rowsQ.rows.map((x:any)=>Number(x.id));
        const prevProduct=String(rowsQ.rows[0].product_name||""),prevName=String(rowsQ.rows[0].formula_name||"");
        const clash=await client.query("SELECT 1 FROM production_formula WHERE "+NORM("product_name")+"="+NORM("$1")+" AND "+NORM("formula_name")+"="+NORM("$2")+" AND id<>ALL($3::bigint[]) LIMIT 1",[newProduct,newName,rowIds]);
        if(clash.rowCount)throw new Error("\""+newProduct+"\" me \""+newName+"\" naam ka formula pehle se hai.");
        const r=await client.query("UPDATE production_formula SET formula_name=$1,product_name=$2 WHERE id=ANY($3::bigint[])",[newName,newProduct,rowIds]);
        await client.query("UPDATE production_voucher SET formula_name=$3,product_name=$4 WHERE "+NORM("product_name")+"="+NORM("$1")+" AND "+NORM("formula_name")+"="+NORM("$2"),[prevProduct,prevName,newName,newProduct]);
        await client.query("COMMIT");
        return Response.json({success:true,updated:r.rowCount});
      }catch(e:any){await client.query("ROLLBACK");return Response.json({error:e.message||"Rename failed"},{status:400})}finally{client.release()}
    }
    // Production Formula: poora formula ek request me save (id wali lines update, bina id wali nayi insert) - ek transaction me.
    if(p==="production-formulas/save"){
      await ensureProductionFormulaSchema();
      const product=String(b.product_name||"").trim(),formula=String(b.formula_name||"").trim();
      const lines:any[]=Array.isArray(b.lines)?b.lines:[];
      if(!product||!formula)return Response.json({error:"Product aur Formula Name zaroori hai."},{status:400});
      if(!lines.length)return Response.json({error:"Kam se kam ek raw material line chahiye."},{status:400});
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        let updated=0,inserted=0;
        for(const l of lines){
          const rawItem=String(l.raw_item_name||"").trim(),qty=num(l.qty),unit=String(l.unit||"PCS").trim()||"PCS";
          if(!rawItem||qty<=0)throw new Error("Har line me Raw Material aur 0 se zyada Qty zaroori hai.");
          const raw=await client.query("SELECT 1 FROM product WHERE COALESCE(fro,'')='R' AND lower(trim(name))=lower(trim($1)) LIMIT 1",[rawItem]);
          if(!raw.rowCount)throw new Error("\""+rawItem+"\" Product Master ke Raw Material me nahi hai.");
          const id=idOf(l.id);
          if(id){
            const r=await client.query("UPDATE production_formula SET raw_item_name=$1,qty=$2,unit=$3 WHERE id=$4 AND "+NORM("product_name")+"="+NORM("$5")+" AND "+NORM("formula_name")+"="+NORM("$6"),[rawItem,qty,unit,id,product,formula]);
            if(r.rowCount){updated++;continue;}
          }
          await client.query("INSERT INTO production_formula (product_name,formula_name,raw_item_name,qty,unit) VALUES ($1,$2,$3,$4,$5)",[product,formula,rawItem,qty,unit]);inserted++;
        }
        await client.query("COMMIT");
        return Response.json({success:true,updated,inserted});
      }catch(e:any){await client.query("ROLLBACK");return Response.json({error:e.message||"Save failed"},{status:400})}finally{client.release()}
    }
    if(p==="hr/employees"){
      await ensureHRSchemas();
      const r=await pool.query("INSERT INTO hr_employee (employee_code,name,department,designation,mobile,photo_url,joining_date,machine_user_id,basic_salary,hra,other_allowance,overtime_rate) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *",[String(b.employee_code||"").trim(),String(b.name||"").trim(),b.department||null,b.designation||null,b.mobile||null,b.photo_url||null,b.joining_date||null,b.machine_user_id||null,num(b.basic_salary),num(b.hra),num(b.other_allowance),num(b.overtime_rate)]);
      return Response.json({success:true,employee:r.rows[0],row:r.rows[0]},{status:201});
    }
    if(p==="hr/salary/process"){
      await ensureHRSchemas();
      const month=String(b.month||"").trim(); if(!/^\d{4}-\d{2}$/.test(month))return Response.json({error:"Valid salary month is required."},{status:400});
      const days=new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).getDate();
      const emps=await pool.query("SELECT * FROM hr_employee WHERE active=true ORDER BY id");
      for(const e of emps.rows){
        const att=await pool.query("SELECT COALESCE(SUM(CASE WHEN status='Present' THEN 1 ELSE 0 END),0) AS present,COALESCE(SUM(overtime_hours),0) AS ot FROM hr_attendance WHERE employee_id=$1 AND to_char(work_date,'YYYY-MM')=$2",[e.id,month]);
        const present=Number(att.rows[0]?.present||0),ot=Number(att.rows[0]?.ot||0),basic=Number(e.basic_salary||0)*present/days,allow=Number(e.hra||0)+Number(e.other_allowance||0),otamt=ot*Number(e.overtime_rate||0),net=basic+allow+otamt;
        await pool.query("INSERT INTO hr_salary (employee_id,salary_month,working_days,present_days,overtime_hours,basic_earned,allowances,overtime_amount,net_salary,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'PROCESSED') ON CONFLICT(employee_id,salary_month) DO UPDATE SET working_days=EXCLUDED.working_days,present_days=EXCLUDED.present_days,overtime_hours=EXCLUDED.overtime_hours,basic_earned=EXCLUDED.basic_earned,allowances=EXCLUDED.allowances,overtime_amount=EXCLUDED.overtime_amount,net_salary=EXCLUDED.net_salary,status='PROCESSED'",[e.id,month,days,present,ot,basic,allow,otamt,net]);
      }
      const r=await pool.query("SELECT s.*,e.employee_code,e.name AS employee_name FROM hr_salary s JOIN hr_employee e ON e.id=s.employee_id WHERE s.salary_month=$1 ORDER BY e.name",[month]);
      return Response.json({success:true,salaries:r.rows,rows:r.rows});
    }
    if(p==="admin/nav-tabs"){
      const label=String(b.label||"").trim(); if(!label)return Response.json({error:"Tab name is required."},{status:400});
      const existing=await pool.query("SELECT key FROM nav_tab"); const keys=new Set(existing.rows.map((x:any)=>String(x.key)));
      let key=String(b.key||"").trim(); if(!key||keys.has(key)){key=label.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"")||"custom-tab"; let i=2; while(keys.has(key))key=key+"-"+i++;}      const max=await pool.query("SELECT COALESCE(MAX(position),0)::int AS n FROM nav_tab");
      const r=await pool.query("INSERT INTO nav_tab (key,label,icon,position,hidden,items) VALUES ($1,$2,$3,$4,false,$5) RETURNING *",[key,label,b.icon||null,Number(max.rows[0]?.n||0)+1,Array.isArray(b.items)?b.items:[]]);
      return Response.json(r.rows[0],{status:201});
    }
    if(a.scope==="dealer" && p==="dealer/cash-book/expense"){
      await ensureDealerCashSchema();
      const did=num(a.dealer_id),amount=num(b.amount);
      if(amount<=0)return Response.json({error:"Expense amount is required."},{status:400});
      const no="EXP-"+new Date().toISOString().slice(0,10).replace(/-/g,"")+"-"+String(Date.now()).slice(-5);
      // Purani DB me expense_date NOT NULL hoti hai; date aur expense_date dono sync rakho (handover jaisa).
      const eDate=String(b.date||b.expense_date||"").slice(0,10)||new Date().toISOString().slice(0,10);
      const ec=await columns("dealer_cash_expense");
      const ein:any={dealer_id:did,date:eDate,expense_date:eDate,expense_no:no,category:String(b.category||"other"),category_label:String(b.category_label||b.category||"").trim(),amount,paid_to:String(b.paid_to||"").trim()||null,remarks:String(b.remarks||"").trim()||null,folio:String(b.folio||"").trim()||null,status:"ACTIVE"};
      const ek=Object.keys(ein).filter(k=>ec.has(k));
      const r=await pool.query('INSERT INTO dealer_cash_expense ('+ek.map(k=>'"'+k+'"').join(",")+') VALUES ('+ek.map((_,i)=>"$"+(i+1)).join(",")+') RETURNING *',ek.map(k=>ein[k]));
      return Response.json({success:true,expense:r.rows[0],row:r.rows[0]},{status:201});
    }
    if(a.scope==="dealer" && p==="dealer/cash-book/handover"){
      await ensureDealerCashSchema();
      const did=num(a.dealer_id),amount=num(b.amount);
      if(amount<=0)return Response.json({error:"Handover amount is required."},{status:400});
      const pos=await dealerCashPosition(did);
      if(amount>pos.available_for_handover+0.001)return Response.json({error:"Handover amount cash in hand se zyada hai. Available: Rs "+Math.max(0,pos.available_for_handover).toLocaleString("en-IN")+(pos.pending_handover>0?" (Rs "+pos.pending_handover.toLocaleString("en-IN")+" pehle se pending acceptance me hai)":"")},{status:400});
      const no="HO-"+new Date().toISOString().slice(0,10).replace(/-/g,"")+"-"+String(Date.now()).slice(-5);
      const hDate=String(b.date||b.handover_date||"").slice(0,10)||new Date().toISOString().slice(0,10);
      const hc=await columns("dealer_cash_handover");
      const hin:any={dealer_id:did,date:hDate,handover_date:hDate,handover_no:no,amount,sent_to:String(b.sent_to||"").trim()||null,remarks:String(b.remarks||"").trim()||null,folio:String(b.folio||"").trim()||null,status:"pending"};
      const hk=Object.keys(hin).filter(k=>hc.has(k));
      const r=await pool.query('INSERT INTO dealer_cash_handover ('+hk.map(k=>'"'+k+'"').join(",")+') VALUES ('+hk.map((_,i)=>"$"+(i+1)).join(",")+') RETURNING *',hk.map(k=>hin[k]));
      return Response.json({success:true,handover:r.rows[0],row:r.rows[0]},{status:201});
    }
    // Admin (Head Office): dealer ka cash handover accept / reject.
    // Accept = dealer ke cashbook me OUT (accepted status se) + admin Day Book me IN (credit entry).
    if(/^admin\/cash-handovers\/\d+\/(accept|reject)$/.test(p)){
      if(!isAdmin(a))return Response.json({error:"Admin rights required."},{status:403});
      await ensureDealerCashSchema();
      const id=idOf(path[2]),action=path[3];
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        const cur=await client.query("SELECT h.*,d.name AS dealer_name FROM dealer_cash_handover h LEFT JOIN dealer d ON d.id=h.dealer_id WHERE h.id=$1 FOR UPDATE OF h",[id]);
        if(!cur.rowCount)throw new Error("Handover not found.");
        const h=cur.rows[0];
        if(String(h.status||"pending").toLowerCase()!=="pending")throw new Error("Ye handover pehle hi "+h.status+" ho chuka hai.");
        const who=String(a.full_name||a.username||a.name||a.sub||"admin");
        if(action==="reject"){
          const upd=await client.query("UPDATE dealer_cash_handover SET status='rejected',accepted_at=NOW(),accepted_by=$1,reject_reason=$2 WHERE id=$3 RETURNING *",[who,String(b.reason||"").trim()||null,id]);
          await client.query("COMMIT");return Response.json({success:true,handover:upd.rows[0]});
        }
        // Admin Day Book me IN entry (columns jo table me hain wahi bharenge).
        const dbc=await columns("day_book");let dayBookId:any=null;
        if(dbc.size){
          const dt=ymd(h.date)||new Date().toISOString().slice(0,10);
          // day_book.vr_no purani DB me integer hai -> handover_no (text) nahi ja sakta. Numeric ho to next number lo; handover no narration me rehta hai.
          const vt=(await client.query("SELECT data_type FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='day_book' AND column_name='vr_no'")).rows[0]?.data_type||"";
          let vrNo:any=h.handover_no;
          if(["integer","bigint","smallint","numeric"].includes(vt)){vrNo=Number((await client.query("SELECT COALESCE(MAX(vr_no),0)+1 AS n FROM day_book")).rows[0]?.n||1);}
          const entry:any={date:dt,vr_no:vrNo,dealer_name:h.dealer_name||"",dealer_id:h.dealer_id,credit_received:num(h.amount),debit_paid:0,payment_mode:"cash",mode:"cash",
            narration:"Cash handover received from "+(h.dealer_name||"dealer")+" ("+h.handover_no+")"+(h.remarks?" - "+h.remarks:""),folio:h.folio||null};
          const keys=Object.keys(entry).filter(k=>dbc.has(k));
          const ins=await client.query('INSERT INTO day_book ('+keys.map(k=>'"'+k+'"').join(",")+') VALUES ('+keys.map((_,i)=>"$"+(i+1)).join(",")+') RETURNING id',keys.map(k=>entry[k]));
          dayBookId=ins.rows[0]?.id||null;
        }
        const upd=await client.query("UPDATE dealer_cash_handover SET status='accepted',accepted_at=NOW(),accepted_by=$1,day_book_id=$2 WHERE id=$3 RETURNING *",[who,dayBookId,id]);
        await client.query("COMMIT");
        return Response.json({success:true,handover:upd.rows[0],day_book_id:dayBookId});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    if(a.scope==="dealer" && p==="dealer/repair-receipts"){
      const did=num(a.dealer_id);
      if(!(await dealerHasRepairReceiptRight(did)))return Response.json({error:"Repair Receipt ka right aapke paas nahi hai."},{status:403});
      try{
        const row=await createRepairReceipt(idOf(b.voucher_id)||0,b,did);
        return Response.json({success:true,receipt:row,row},{status:201});
      }catch(e:any){return Response.json({error:e.message||"Could not create receipt."},{status:400});}
    }
    if(a.scope==="dealer" && p==="dealer/cash-book/receipt"){
      await ensureDealerCashSchema();
      const did=num(a.dealer_id),type=String(b.receipt_type||"new_booking"),customerId=idOf(b.customer_id),date=String(b.date||b.receipt_date||new Date().toISOString().slice(0,10));
      const cc=await columns("dealer_cash_customer"),rc=await columns("dealer_cash_receipt");
      if(!cc.size||!rc.size)return Response.json({error:"Cash receipt tables are not available."},{status:500});
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        let cid=customerId;
        if(type==="balance_payment"){
          if(!cid)throw new Error("Previous customer is required.");
          const chk=await client.query("SELECT * FROM dealer_cash_customer WHERE id=$1 AND dealer_id=$2 FOR UPDATE",[cid,did]);
          if(!chk.rowCount)throw new Error("Customer not found.");
          // Balance payment form sirf customer_id bhejta hai; receipt row (customer_name NOT NULL) ke liye details customer register se lo.
          const [ec]=await enrichCashCustomers([chk.rows[0]]);
          b.customer_name=String(b.customer_name||"").trim()||ec?.name||"";
          b.customer_phone=String(b.customer_phone||"").trim()||ec?.phone||"";
          b.dealer_register_page_no=String(b.dealer_register_page_no||"").trim()||String(chk.rows[0].page_no||"").trim();
          b.sale_amount=chk.rows[0].sale_amount;
          b.loan_amount=chk.rows[0].loan_amount;
        }else{
          const input:any={dealer_id:did,name:String(b.customer_name||"").trim(),phone:String(b.customer_phone||"").trim(),full_name:String(b.customer_name||"").trim(),customer_phone:String(b.customer_phone||"").trim(),page_no:String(b.dealer_register_page_no||"").trim()||null,vehicle_no:String(b.booking_for||"new").trim(),sale_amount:num(b.sale_amount),loan_amount:num(b.loan_amount),paid_amount:num(b.amount),status:"VEHICLE_PENDING",date:date||null};
          const keys=Object.keys(input).filter(k=>cc.has(k));
          if(!input.name||!input.phone)throw new Error("Customer name and mobile are required.");
          if(!keys.length)throw new Error("Customer register schema is missing required fields.");
          const rr=await client.query('INSERT INTO dealer_cash_customer ('+keys.map(k=>'"'+k+'"').join(",")+') VALUES ('+keys.map((_,i)=>"$"+(i+1)).join(",")+') RETURNING *',keys.map(k=>input[k]));
          cid=rr.rows[0].id;
        }
        const input:any={dealer_id:did,customer_id:cid,date:date||null,receipt_type:type,customer_name:String(b.customer_name||"").trim()||"-",customer_phone:String(b.customer_phone||"").trim()||null,dealer_register_page_no:String(b.dealer_register_page_no||"").trim()||null,sale_amount:num(b.sale_amount),loan_amount:num(b.loan_amount),amount:num(b.amount),payment_mode:String(b.payment_mode||"cash"),reference_no:String(b.reference_no||"").trim()||null,remarks:String(b.remarks||"").trim()||null,request_id:String(b.request_id||"").trim()||null,receipt_date:date,receipt_no:"RC-"+Date.now()};
        const keys=Object.keys(input).filter(k=>rc.has(k));
        const rr=await client.query('INSERT INTO dealer_cash_receipt ('+keys.map(k=>'"'+k+'"').join(",")+') VALUES ('+keys.map((_,i)=>"$"+(i+1)).join(",")+') RETURNING *',keys.map(k=>input[k]));
        const receipt=rr.rows[0];
        if(type==="balance_payment"){
          const cust=await client.query("SELECT * FROM dealer_cash_customer WHERE id=$1 FOR UPDATE",[cid]);
          const paid=Number(cust.rows[0]?.paid_amount||0)+num(b.amount);
          await client.query("UPDATE dealer_cash_customer SET paid_amount=$1 WHERE id=$2",[paid,cid]);
        }
        await client.query("COMMIT");
        return Response.json({success:true,receipt},{status:201});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    if(a.scope==="dealer" && p==="battery-withdrawal"){
      const did=num(a.dealer_id), batteryNo=String(b.battery_no||"").trim();
      if(!batteryNo)return Response.json({error:"Battery No. is required."},{status:400});
      const r=await pool.query("INSERT INTO battery_stock_movement (date,dealer_id,battery_maker,battery_no,reference_no,movement_type,created_at) VALUES (COALESCE($1::date,CURRENT_DATE),$2,$3,$4,$5,'withdrawal',NOW()) RETURNING *",
        [b.date||null,did,String(b.battery_maker||"").trim()||null,batteryNo,String(b.reference_no||"").trim()||null]);
      return Response.json({success:true,row:r.rows[0],data:r.rows[0]},{status:201});
    }
    if(a.scope==="dealer" && p==="battery-addition"){
      const did=num(a.dealer_id),vehicleId=idOf(b.vehicle_id),batteryNo=String(b.battery_no||"").trim();
      if(!vehicleId||!batteryNo)return Response.json({error:"Vehicle and Battery No. are required."},{status:400});
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        const dr=await client.query("SELECT name FROM dealer WHERE id=$1",[did]);
        if(!dr.rowCount)throw new Error("Dealer not found.");
        const vr=await client.query("SELECT * FROM vehicle WHERE id=$1 AND stage='Delivery Challan' AND lower(trim(COALESCE(dealer_name,'')))=lower(trim($2)) FOR UPDATE",[vehicleId,dr.rows[0].name]);
        if(!vr.rowCount)throw new Error("Vehicle not found in this dealer's stock.");
        const available=await client.query("SELECT battery_maker,battery_no FROM battery_stock_movement WHERE dealer_id=$1 AND movement_type IN ('withdrawal','delivery') AND upper(trim(battery_no))=upper(trim($2)) AND NOT EXISTS (SELECT 1 FROM battery_stock_movement x WHERE x.dealer_id=$1 AND x.movement_type='addition' AND upper(trim(x.battery_no))=upper(trim($2))) LIMIT 1",[did,batteryNo]);
        if(!available.rowCount)throw new Error("Battery is not available in dealer battery stock.");
        const position=Math.min(4,Math.max(1,Number(b.position)||1));
        const field="battery_no"+position;
        const maker=String(b.battery_maker||available.rows[0].battery_maker||"").trim()||null;
        await client.query('UPDATE vehicle SET battery_maker=$1,"'+field+'"=$2 WHERE id=$3',[maker,batteryNo,vehicleId]);
        const mv=await client.query("INSERT INTO battery_stock_movement (date,dealer_id,battery_maker,battery_no,reference_no,movement_type,created_at) VALUES (COALESCE($1::date,CURRENT_DATE),$2,$3,$4,$5,'addition',NOW()) RETURNING *",
          [b.date||null,did,maker,batteryNo,String(b.reference_no||"").trim()||null]);
        await client.query("COMMIT");
        return Response.json({success:true,row:mv.rows[0],vehicle_id:vehicleId,battery_no:batteryNo},{status:201});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    if(p==="notifications/read"){
      await ensureNotificationSchema();
      const id=idOf(b.id); if(!id)return Response.json({error:"Notification id required."},{status:400});
      const userKey=String(a?.id??a?.user_id??a?.username??"").trim();
      const r=await pool.query("UPDATE app_notification SET is_read=true WHERE id=$1 AND (user_id=$2 OR user_id IS NULL OR dealer_id=$3) RETURNING id",[id,userKey,num(a?.dealer_id)||0]);
      return Response.json({success:r.rowCount>0});
    }
    if(p==="notifications/cash-limit"){
      if(a?.scope!=="staff" || !isAdmin(a))return Response.json({error:"Admin rights required."},{status:403});
      await ensureNotificationSchema();
      const dealerId=idOf(b.dealer_id),cashLimit=num(b.cash_limit);
      if(!dealerId || cashLimit<=0)return Response.json({error:"Branch and a positive cash limit are required."},{status:400});
      const d=await pool.query("SELECT id FROM dealer WHERE id=$1 AND LOWER(COALESCE(dealer_category,''))='branch'",[dealerId]);
      if(!d.rowCount)return Response.json({error:"Selected dealer is not a Branch."},{status:400});
      const r=await pool.query("INSERT INTO dealer_cash_limit(dealer_id,cash_limit,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(dealer_id) DO UPDATE SET cash_limit=EXCLUDED.cash_limit,updated_at=NOW() RETURNING *",[dealerId,cashLimit]);
      return Response.json({success:true,row:r.rows[0]});
    }
    if(p==="battery-fit"){
      await ensureBatteryFitSchema(); await ensureNotificationSchema();
      const challanId=idOf(b.challan_id),fitDate=String(b.fit_date||"").slice(0,10)||ymd(new Date()),maker=String(b.battery_maker||"").trim();
      const nums=[1,2,3,4].map(n=>String(b["battery_no"+n]||"").trim());
      if(!challanId || !maker || !nums[0])return Response.json({error:"Challan, Battery Maker and at least Battery No. 1 are required."},{status:400});
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        const dc=await client.query(`SELECT dc.*,d.name AS dealer_name,v.model_name,v.battery_maker AS old_battery_maker,
          v.battery_no1 AS old_battery_no1,v.battery_no2 AS old_battery_no2,v.battery_no3 AS old_battery_no3,v.battery_no4 AS old_battery_no4
          FROM delivery_challan dc LEFT JOIN dealer d ON d.id=dc.dealer_id LEFT JOIN vehicle v ON v.id=dc.vehicle_id
          WHERE dc.id=$1 FOR UPDATE`,[challanId]);
        if(!dc.rowCount)throw new Error("Delivery Challan not found.");
        const row=dc.rows[0];
        if(row.cancelled)throw new Error("Cancelled challan par battery fit nahi ho sakti.");
        const inv=await client.query("SELECT id FROM tax_invoice WHERE delivery_challan_id=$1 AND COALESCE(cancelled,false)=false LIMIT 1",[challanId]);
        if(inv.rowCount)throw new Error("Billed challan par battery fit/change nahi ho sakti.");
        if(a?.scope==="dealer" && Number(row.dealer_id)!==Number(a.dealer_id))throw new Error("Ye challan aapke dealer ka nahi hai.");
        const oldNums=[1,2,3,4].map(n=>String(row["old_battery_no"+n]||"").trim()).filter(Boolean);
        const changed=oldNums.join("|")!==nums.filter(Boolean).join("|") || String(row.old_battery_maker||"").trim().toLowerCase()!==maker.toLowerCase();
        await client.query(`UPDATE vehicle SET battery_maker=$1,battery_no1=$2,battery_no2=$3,battery_no3=$4,battery_no4=$5,battery_fit_date=$6 WHERE id=$7`,[maker,nums[0]||null,nums[1]||null,nums[2]||null,nums[3]||null,fitDate,row.vehicle_id]);
        await client.query(`UPDATE delivery_challan SET battery_maker=$1,battery_no1=$2,battery_no2=$3,battery_no3=$4,battery_no4=$5,battery_fit_date=$6 WHERE id=$7`,[maker,nums[0]||null,nums[1]||null,nums[2]||null,nums[3]||null,fitDate,challanId]);
        const ins=await client.query(`INSERT INTO battery_fit_log
          (fit_date,challan_id,challan_no,dealer_id,dealer_name,vehicle_id,chassis_no,model_name,battery_maker,battery_no1,battery_no2,battery_no3,battery_no4,
           old_battery_maker,old_battery_no1,old_battery_no2,old_battery_no3,old_battery_no4,reference_no,remarks,fitted_by)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING id`,
          [fitDate,challanId,row.challan_no,row.dealer_id,row.dealer_name,row.vehicle_id,row.chassis_no,row.model_name,maker,nums[0]||null,nums[1]||null,nums[2]||null,nums[3]||null,row.old_battery_maker||null,row.old_battery_no1||null,row.old_battery_no2||null,row.old_battery_no3||null,row.old_battery_no4||null,b.reference_no||null,b.remarks||null,String(a?.username||a?.full_name||a?.id||"").trim()||null]);
        const reg=await client.query("INSERT INTO battery_register_entry(date,battery_maker,battery_no,qty,entry_type,source_type,source_id,source_no,party_name,dealer_id,vehicle_id,remarks) VALUES($1,$2,$3,1,'FIT','DELIVERY_CHALLAN',$4,$5,$6,$7,$8,$9) RETURNING id",[fitDate,maker,nums[0]||null,challanId,row.challan_no,row.dealer_name,row.dealer_id,row.vehicle_id,"Battery fitted to Delivery Challan"+(changed&&oldNums.length?" (battery changed)":"")]);
        const title=changed&&oldNums.length?"Battery Changed on Dealer Challan":"Battery Fitted on Dealer Challan";
        const msg=changed&&oldNums.length
          ? `${row.challan_no||"Challan"} / ${row.chassis_no||""}: battery changed to ${maker} - ${nums.filter(Boolean).join(", ")}.`
          : `${row.challan_no||"Challan"} / ${row.chassis_no||""}: battery fitted (${maker} - ${nums.filter(Boolean).join(", ")}).`;
        await client.query("INSERT INTO app_notification(notification_type,title,message,dealer_id,reference_type,reference_id,dedupe_key) VALUES('battery_change',$1,$2,$3,'battery_fit',$4,$5) ON CONFLICT(dedupe_key) DO UPDATE SET message=EXCLUDED.message,is_read=false",[title,msg,row.dealer_id,Number(ins.rows[0].id),Number(ins.rows[0].id),"battery-fit-"+Number(ins.rows[0].id)]);
        await client.query("COMMIT");
        return Response.json({success:true,fit_id:Number(ins.rows[0].id),register_id:Number(reg.rows[0].id),battery_fit_date:fitDate});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    if(p==="billing/pending-sales/create"){
      await ensureBillingSalesSchema(); await ensureGrdAssetSchema();
      if(!billingStaff(a) && a?.scope!=="dealer")return Response.json({error:"Billing rights required."},{status:403});
      const applicationId=idOf(b.application_id),challanId=idOf(b.delivery_challan_id||b.vehicle_id);
      const dealerId=idOf(b.dealer_id),description=String(b.description||b.internal_sale_details||"").trim();
      const saleAmount=num(b.sale_amount),loanAmount=num(b.loan_amount);
      let customerId:number|null=null;
      if(applicationId){
        const app=await pool.query("SELECT * FROM loan_workflow WHERE id=$1",[applicationId]);
        if(!app.rowCount)return Response.json({error:"Loan Application not found."},{status:404});
        const x=app.rows[0],approved=String(x.status||"").trim().toLowerCase().replace(/[_-]+/g," ");
        if(approved!=="loan approved"&&approved!=="approved")return Response.json({error:"Only Loan Approved applications can be moved to Pending Sale."},{status:409});
        if(a?.scope==="dealer"&&Number(x.dealer_id||0)!==Number(a.dealer_id||0))return Response.json({error:"You can only create Pending Sale for your own dealer applications."},{status:403});
        customerId=idOf(x.customer_id)||null;
        const dup=await pool.query("SELECT id FROM grd_billing_sale WHERE application_id=$1",[applicationId]);
        if(dup.rowCount)return Response.json({error:"This Loan Application is already in the sales workflow."},{status:409});
      }
      const effectiveDealer=dealerId||Number(a?.dealer_id||0);
      if(a?.scope==="dealer"&&effectiveDealer!==Number(a.dealer_id||0))return Response.json({error:"Invalid dealer selected."},{status:403});
      if(!effectiveDealer)return Response.json({error:"Dealer is required."},{status:400});
      // Dealers can create their own Pending Sale only if they are a Showroom / Branch.
      if(a?.scope==="dealer"){
        const dc=await pool.query("SELECT LOWER(COALESCE(dealer_category,'')) AS cat FROM dealer WHERE id=$1",[effectiveDealer]);
        if(!["showroom","branch"].includes(String(dc.rows[0]?.cat||"")))return Response.json({error:"Create Sale sirf Showroom / Branch dealer ke liye hai."},{status:403});
      }
      let vehicle:any=null;
      if(challanId){
        const vr=await pool.query(`SELECT dc.*,d.name AS dealer_name,v.model_name,v.colour AS vehicle_colour,v.motor_no AS vehicle_motor_no,
          v.controller_no AS vehicle_controller_no,v.battery_maker,v.battery_no1,v.battery_no2,v.battery_no3,v.battery_no4
          FROM delivery_challan dc LEFT JOIN dealer d ON d.id=dc.dealer_id LEFT JOIN vehicle v ON v.id=dc.vehicle_id
          WHERE dc.id=$1 AND COALESCE(dc.cancelled,false)=false`,[challanId]);
        if(!vr.rowCount)return Response.json({error:"Selected chassis is not available."},{status:404});
        vehicle=vr.rows[0];
        if(Number(vehicle.dealer_id||0)!==effectiveDealer)return Response.json({error:"Selected chassis does not belong to selected dealer."},{status:403});
        const inv=await pool.query("SELECT id FROM tax_invoice WHERE delivery_challan_id=$1 AND COALESCE(cancelled,false)=false LIMIT 1",[challanId]);
        if(inv.rowCount)return Response.json({error:"Selected chassis is already billed."},{status:409});
      }
      if(loanAmount>saleAmount&&saleAmount>0)return Response.json({error:"Loan Amount cannot be greater than Sale Amount."},{status:400});
      const customerName=String(b.customer_name||b.buyer_name||"").trim()||null;
      const cashCustId=idOf(b.dealer_cash_customer_id);
      if(cashCustId){
        const cc=await pool.query("SELECT id,dealer_id FROM dealer_cash_customer WHERE id=$1",[cashCustId]);
        if(!cc.rowCount||Number(cc.rows[0].dealer_id)!==effectiveDealer)return Response.json({error:"Selected customer does not belong to selected dealer."},{status:403});
        const dupc=await pool.query("SELECT id FROM grd_billing_sale WHERE dealer_cash_customer_id=$1 AND status IN ('PENDING','APPROVED','BILLED') LIMIT 1",[cashCustId]);
        if(dupc.rowCount)return Response.json({error:"This customer already has a Pending Sale."},{status:409});
      }
      if(!applicationId&&!customerName)return Response.json({error:"Select a Loan Approved customer or enter Customer Name manually."},{status:400});
      const values:any={
        application_id:applicationId||null,dealer_cash_customer_id:cashCustId||null,dealer_id:effectiveDealer,customer_id:customerId,vehicle_id:vehicle?.vehicle_id||null,chassis_no:vehicle?.chassis_no||String(b.chassis_no||"").trim()||null,
        description:description||"Internal Sale",sale_amount:saleAmount||Number(vehicle?.sale_value||0),status:"PENDING",
        customer_name:customerName,customer_phone:String(b.customer_phone||b.buyer_mobile||"").trim()||null,customer_address:String(b.customer_address||b.buyer_address||"").trim()||null,customer_state:String(b.customer_state||b.buyer_state||"").trim()||null,
        sale_type:(({NEW:"NEW RICKSHAW",OLD:"OLD RICKSHAW",BATTERY:"BATTERY"} as any)[String(b.sale_category||"").toUpperCase()]||String(b.sale_type||"").trim()||null),page_no:String(b.page_no||b.dealer_page_no||"").trim()||null,do_no:String(b.do_no||"").trim()||null,internal_sale_details:String(b.internal_sale_details||description||"").trim()||null,
        buyer_relation:b.buyer_relation||null,buyer_father_name:b.buyer_father_name||null,buyer_gst_no:b.buyer_gst_no||null,buyer_pan:b.buyer_pan||null,buyer_aadhar:b.buyer_aadhar||null,buyer_dob:b.buyer_dob||null,buyer_state_code:b.buyer_state_code||null,
        state_type:b.state_type||"I",mode_term:b.mode_term||null,bank_name:b.bank_name||null,bank_account_no:b.bank_account_no||null,bank_ifsc:b.bank_ifsc||null,rto_name:b.rto_name||null,despatch_through:b.despatch_through||null,eway_bill_no:b.eway_bill_no||null,license_no:b.license_no||null,cvr_no:b.cvr_no||null,cancelled_cheque_no:b.cancelled_cheque_no||null,remarks:b.remarks||null,
        amount_received:num(b.amount_received),financer_name:b.financer_name||null,hypothecation_amount:num(b.hypothecation_amount||b.loan_amount),vehicle_reg_no:b.vehicle_reg_no||null,ledger_no:b.ledger_no||null,chassis_record_no:b.chassis_record_no||null,voucher_no:b.voucher_no||null,subsidy_amount:num(b.subsidy_amount),
        gst_sale_amount:num(b.gst_sale_amount||b.sale_amount||vehicle?.sale_value),gst_rate:num(b.gst_rate||5),insurance_amount:num(b.insurance_amount),registration_amount:num(b.registration_amount),discount:num(b.discount)
      };
      const cols=await columns("grd_billing_sale"),keys=Object.keys(values).filter(k=>cols.has(k)),ph=keys.map((_,i)=>"$"+(i+1));
      const r=await pool.query('INSERT INTO grd_billing_sale ('+keys.map(k=>'"'+k+'"').join(",")+') VALUES ('+ph.join(",")+') RETURNING *',keys.map(k=>values[k]));
      return Response.json({success:true,sale:r.rows[0]},{status:201});
    }
    if(p.startsWith("billing/pending-sales/") && p.endsWith("/complete")){
      await ensureBillingSalesSchema();
      if(!billingStaff(a))return Response.json({error:"Billing approval rights required."},{status:403});
      const id=idOf(path[path.length-2]);if(!id)return Response.json({error:"Sale id is required."},{status:400});
      const r=await pool.query("UPDATE grd_billing_sale SET status='BILLED',updated_at=NOW() WHERE id=$1 AND status='APPROVED' AND UPPER(COALESCE(sale_type,'')) IN ('OLD RICKSHAW','BATTERY') RETURNING *",[id]);
      if(!r.rowCount)return Response.json({error:"Only approved Old Rickshaw / Battery sales can be completed without GST invoice."},{status:409});
      return Response.json({success:true,sale:r.rows[0]});
    }
    if(p.startsWith("billing/pending-sales/") && p.endsWith("/approve")){
      await ensureBillingSalesSchema();
      if(!billingStaff(a))return Response.json({error:"Billing approval rights required."},{status:403});
      const id=idOf(path[path.length-2]);if(!id)return Response.json({error:"Sale id is required."},{status:400});
      const r=await pool.query("UPDATE grd_billing_sale SET status='APPROVED',approved_by=$1,approved_at=NOW(),updated_at=NOW() WHERE id=$2 AND status='PENDING' RETURNING *",[String(a.username||a.sub||"Admin"),id]);
      if(!r.rowCount)return Response.json({error:"Only Pending Sales can be approved."},{status:409});
      return Response.json({success:true,sale:r.rows[0]});
    }
    if(p.startsWith("billing/pending-sales/") && p.endsWith("/save-invoice")){
      await ensureBillingSalesSchema();
      if(!billingStaff(a))return Response.json({error:"Billing approval rights required."},{status:403});
      const id=idOf(path[path.length-2]);if(!id)return Response.json({error:"Sale id is required."},{status:400});
      const sale=await pool.query(`SELECT s.*,lw.application_no,lw.loan_amount,lw.customer_id AS lw_customer_id,lw.dealer_id AS lw_dealer_id,
        c.full_name AS joined_customer_name,c.phone AS joined_customer_phone,d.name AS dealer_name
        FROM grd_billing_sale s LEFT JOIN loan_workflow lw ON lw.id=s.application_id
        LEFT JOIN customer c ON c.id=s.customer_id LEFT JOIN dealer d ON d.id=s.dealer_id WHERE s.id=$1 FOR UPDATE OF s`,[id]);
      if(!sale.rowCount)return Response.json({error:"Sale not found."},{status:404});
      const s=sale.rows[0];s.customer_name=s.customer_name||s.joined_customer_name||"";s.customer_phone=s.customer_phone||s.joined_customer_phone||"";if(s.status!=="APPROVED")return Response.json({error:"Approve the sale before saving the Tax Invoice."},{status:403});
      if(["OLD RICKSHAW","BATTERY"].includes(String(s.sale_type||"").toUpperCase()))return Response.json({error:"Bill No. sirf New Rickshaw par banta hai. Old Rickshaw / Battery ke liye Complete Sale (No GST) use karo."},{status:409});
      if(s.invoice_id){const inv=await pool.query("SELECT * FROM tax_invoice WHERE id=$1",[s.invoice_id]);return Response.json({success:true,invoice:inv.rows[0]});}
      const invoice:any=b.invoice||b,cols=await columns("tax_invoice");
      // Internal Sale Amount and Loan / Hypothecation Amount are frozen at approval: always taken from the approved sale, never from the form.
      const lockedSale=num(s.sale_amount),lockedLoan=num(s.hypothecation_amount)||num(s.loan_amount);
      const t=(k:string)=>{const v=invoice[k];return v===undefined||v===null||String(v).trim()===""?null:String(v).trim()};
      const values:any={
        date:invoice.date||new Date().toISOString().slice(0,10),bill_no:null,buyer_name:String(invoice.buyer_name||s.customer_name||"").trim()||null,
        buyer_mobile:String(invoice.buyer_mobile||s.customer_phone||"").trim()||null,buyer_address:invoice.buyer_address||null,buyer_state:invoice.buyer_state||null,
        dealer_name:String(invoice.dealer_name||s.dealer_name||"").trim()||null,product_name:invoice.product_name||null,chassis_no:invoice.chassis_no||s.chassis_no||null,
        motor_no:invoice.motor_no||null,controller_no:invoice.controller_no||null,colour:invoice.colour||null,
        sale_amount:lockedSale,gst_sale_amount:num(invoice.gst_sale_amount||lockedSale),
        gst_rate:num(invoice.gst_rate)||5,hypothecation_amount:lockedLoan,amount_received:num(invoice.amount_received),
        mode_term:invoice.mode_term||"CHFPL",remarks:invoice.remarks||s.description||null,vehicle_id:s.vehicle_id||null,delivery_challan_id:null,
        dealer_page_no:t("dealer_page_no"),buyer_relation:t("buyer_relation"),buyer_father_name:t("buyer_father_name"),buyer_gst_no:t("buyer_gst_no"),
        buyer_pan:t("buyer_pan"),buyer_aadhar:t("buyer_aadhar"),buyer_dob:t("buyer_dob"),buyer_state_code:t("buyer_state_code"),state_type:t("state_type")||"I",
        bank_name:t("bank_name"),bank_account_no:t("bank_account_no"),bank_ifsc:t("bank_ifsc"),rto_name:t("rto_name"),despatch_through:t("despatch_through"),
        eway_bill_no:t("eway_bill_no"),license_no:t("license_no"),cvr_no:t("cvr_no"),cancelled_cheque_no:t("cancelled_cheque_no"),financer_name:t("financer_name"),
        vehicle_reg_no:t("vehicle_reg_no"),ledger_no:t("ledger_no"),chassis_record_no:t("chassis_record_no"),voucher_no:t("voucher_no"),
        subsidy_amount:num(invoice.subsidy_amount),do_no:t("do_no"),insurance_amount:num(invoice.insurance_amount),
        registration_amount:num(invoice.registration_amount),discount:num(invoice.discount)
      };
      const keys=Object.keys(values).filter(k=>cols.has(k));const rr=await pool.connect();
      try{
        await rr.query("BEGIN");
        const n=await rr.query("SELECT COUNT(*)::int AS n FROM tax_invoice");
        values.bill_no="GRD/"+new Date().getFullYear()+"/"+String((n.rows[0]?.n||0)+1).padStart(5,"0");
        const ins=await rr.query('INSERT INTO tax_invoice ('+keys.map(k=>'"'+k+'"').join(",")+') VALUES ('+keys.map((_,i)=>"$"+(i+1)).join(",")+') RETURNING *',keys.map(k=>values[k]));
        const inv=ins.rows[0];
        await rr.query("UPDATE grd_billing_sale SET invoice_id=$1,status='BILLED',updated_at=NOW() WHERE id=$2",[inv.id,id]);
        if(s.vehicle_id)await rr.query("UPDATE vehicle SET stage='Tax Invoice' WHERE id=$1",[s.vehicle_id]);
        await rr.query("COMMIT");return Response.json({success:true,invoice:inv});
      }catch(e){await rr.query("ROLLBACK");throw e}finally{rr.release()}
    }
    if(p==="credit-notes"){
      await ensureCreditDebitSchema();const invoiceId=idOf(b.invoice_id||b.tax_invoice_id);if(!invoiceId)return Response.json({error:"Original Tax Invoice is required."},{status:400});
      const client=await pool.connect();try{await client.query("BEGIN");const inv=await client.query("SELECT ti.*,d.name AS joined_dealer_name FROM tax_invoice ti LEFT JOIN dealer d ON d.id=ti.dealer_id WHERE ti.id=$1 FOR UPDATE",[invoiceId]);if(!inv.rowCount)throw new Error("Tax Invoice not found.");const x=inv.rows[0];if(Boolean(x.cancelled))throw new Error("Tax Invoice is already cancelled.");
        const taxable=Math.max(0,Number(x.gst_sale_amount||x.sale_amount||0)-Number(x.discount||0)),tax=taxable*Number(x.gst_rate||0)/100,total=taxable+tax+Number(x.insurance_amount||0)+Number(x.registration_amount||0),no="CN-"+new Date().toISOString().slice(0,10).replace(/-/g,"")+"-"+String(invoiceId).padStart(5,"0");
        const r=await client.query("INSERT INTO credit_note (date,credit_note_no,tax_invoice_id,delivery_challan_id,original_bill_no,dealer_name,buyer_name,chassis_no,taxable_amount,tax_amount,total_amount,reason,remarks) VALUES (COALESCE($1::date,CURRENT_DATE),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *",[b.date||null,no,invoiceId,x.delivery_challan_id||null,x.bill_no||null,x.dealer_name||x.joined_dealer_name||null,x.buyer_name||null,x.chassis_no||null,taxable,tax,total,String(b.reason||"").trim(),String(b.remarks||"").trim()||null]);
        await client.query("UPDATE tax_invoice SET cancelled=true WHERE id=$1",[invoiceId]);await client.query("COMMIT");return Response.json({success:true,credit_note_no:no,credit_note:r.rows[0],row:r.rows[0]},{status:201});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    if(p==="debit-notes"){
      await ensureCreditDebitSchema();const items=Array.isArray(b.items)?b.items:[];if(!String(b.party_name||"").trim())return Response.json({error:"Supplier / Party Name is required."},{status:400});if(!String(b.reason||"").trim())return Response.json({error:"Reason is required."},{status:400});if(!items.length)return Response.json({error:"At least one raw material is required."},{status:400});
      const client=await pool.connect();try{await client.query("BEGIN");let taxable=0,tax=0;const clean:any[]=[];
        for(const it of items){const pid=idOf(it.product_id),qty=Number(it.qty||0);if(!pid||qty<=0)throw new Error("Invalid raw material line.");const pr=await client.query("SELECT * FROM product WHERE id=$1 FOR UPDATE",[pid]);if(!pr.rowCount)throw new Error("Product not found.");if(String(pr.rows[0].fro||"").toUpperCase()!=="R")throw new Error(pr.rows[0].name+" is not a Raw Material.");const rate=Number(it.rate||0),gstRate=Number(it.gst_rate||0),line=qty*rate;taxable+=line;tax+=line*gstRate/100;const stock=await client.query("SELECT COALESCE(SUM(CASE WHEN UPPER(COALESCE(work_type,''))='OUT' THEN -ABS(qty) WHEN UPPER(COALESCE(work_type,''))='IN' THEN ABS(qty) ELSE qty END),0) AS balance FROM journal_stock WHERE lower(trim(item_name))=lower(trim($1))",[pr.rows[0].name]);if(Number(stock.rows[0]?.balance||0)<qty)throw new Error("Insufficient raw material stock for "+pr.rows[0].name+". Available: "+Number(stock.rows[0]?.balance||0));clean.push({product_id:pid,item_name:pr.rows[0].name,qty,rate,gst_rate:gstRate,hsn:pr.rows[0].hsn_code||""});await client.query("INSERT INTO journal_stock (vou_no,date,item_name,item_type,qty,reason,created_at,work_type,batch_ref) VALUES ($1,COALESCE($2::date,CURRENT_DATE),$3,'RAW',$4,'Debit Note Purchase Return',NOW(),'OUT',$1)",[String(b.original_bill_no||"DN"),b.date||null,pr.rows[0].name,qty]);}
        const no="DN-"+new Date().toISOString().slice(0,10).replace(/-/g,"")+"-"+String(Date.now()).slice(-5),r=await client.query("INSERT INTO debit_note (date,debit_note_no,party_name,party_gst_no,party_state_code,original_bill_no,reason,remarks,taxable_amount,tax_amount,total_amount,items) VALUES (COALESCE($1::date,CURRENT_DATE),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *",[b.date||null,no,String(b.party_name).trim(),b.party_gst_no||null,b.party_state_code||null,b.original_bill_no||null,b.reason,b.remarks||null,taxable,tax,taxable+tax,JSON.stringify(clean)]);await client.query("COMMIT");return Response.json({success:true,debit_note_no:no,debit_note:r.rows[0],row:r.rows[0]},{status:201});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    if(p==="daily-raw-material-checklist"){
      await ensureDailyRawMaterialChecklistSchema();
      const date=String(b.date||"").trim();
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return Response.json({error:"Valid date is required."},{status:400});
      const report=(await pool.query("SELECT * FROM daily_raw_material_checklist WHERE date=$1 FOR UPDATE",[date])).rows[0];
      if(!report)return Response.json({error:"Checklist not found for this date. Open the checklist first."},{status:404});
      if(report.status!=="PENDING")return Response.json({error:"Checklist is already verified/locked."},{status:409});
      const items=Array.isArray(b.items)?b.items:[];
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        for(const item of items){
          const id=idOf(item.id);if(!id)continue;
          const issued=Math.max(0,num(item.issued_qty));
          await client.query("UPDATE daily_raw_material_checklist_item SET issued_qty=$1,difference=$1-required_qty,remarks=$2,verified=$3,updated_at=NOW() WHERE id=$4 AND checklist_id=$5",
            [issued,String(item.remarks||"").trim()||null,Boolean(item.verified),id,report.id]);
        }
        await client.query("UPDATE daily_raw_material_checklist SET updated_at=NOW() WHERE id=$1",[report.id]);
        await client.query("COMMIT");
        return Response.json({success:true});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    if(p==="daily-raw-material-checklist/verify"){
      await ensureDailyRawMaterialChecklistSchema();
      const id=idOf(b.checklist_id);if(!id)return Response.json({error:"Checklist id is required."},{status:400});
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        const report=(await client.query("SELECT * FROM daily_raw_material_checklist WHERE id=$1 FOR UPDATE",[id])).rows[0];
        if(!report)throw new Error("Checklist not found.");
        if(report.status!=="PENDING")throw new Error("Checklist is already verified/locked.");
        const rows=await client.query("SELECT * FROM daily_raw_material_checklist_item WHERE checklist_id=$1 ORDER BY id",[id]);
        if(!rows.rowCount)throw new Error("No raw material lines are available for this date.");
        for(const item of rows.rows){
          if(!item.verified)throw new Error("Verify every raw material line before locking: "+item.raw_item_name);
          if(Math.abs(Number(item.difference||0))>0.0000001 && !String(item.remarks||"").trim())
            throw new Error("Remark is required for quantity mismatch: "+item.raw_item_name);
        }
        const r=await client.query("UPDATE daily_raw_material_checklist SET status='VERIFIED',verified_by=$1,verified_at=NOW(),updated_at=NOW() WHERE id=$2 RETURNING *",
          [String(a.user_id||a.username||a.name||"Store"),id]);
        await client.query("COMMIT");
        return Response.json({success:true,checklist:r.rows[0]});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    if(p==="daily-raw-material-checklist/formula"){
      await ensureDailyRawMaterialChecklistSchema();
      const productName=String(b.product_name||"").trim(),formulaName=String(b.formula_name||"").trim(),
        rawItem=String(b.raw_item_name||"").trim(),qty=num(b.qty),unit=String(b.unit||"PCS").trim()||"PCS";
      if(!productName||!formulaName||!rawItem||qty<=0)return Response.json({error:"Product, Formula, Raw Material and positive Qty are required."},{status:400});
      const raw=await pool.query("SELECT id FROM product WHERE COALESCE(fro,'')='R' AND lower(trim(name))=lower(trim($1)) LIMIT 1",[rawItem]);
      if(!raw.rowCount)return Response.json({error:"Select a Raw Material from Product Master."},{status:400});
      const existing=b.id?await pool.query("SELECT id FROM production_formula WHERE id=$1",[idOf(b.id)]):{rowCount:0};
      let r;
      if(existing.rowCount){
        r=await pool.query("UPDATE production_formula SET raw_item_name=$1,qty=$2,unit=$3 WHERE id=$4 RETURNING *",[rawItem,qty,unit,idOf(b.id)]);
      }else{
        r=await pool.query("INSERT INTO production_formula (product_name,formula_name,raw_item_name,qty,unit) VALUES($1,$2,$3,$4,$5) RETURNING *",[productName,formulaName,rawItem,qty,unit]);
      }
      return Response.json({success:true,row:r.rows[0]},{status:existing.rowCount?200:201});
    }
    if(p==="repair-service-vouchers"){
      await ensureRepairSchema();const items=Array.isArray(b.items)?b.items:[];if(!String(b.vehicle_no||"").trim())return Response.json({error:"Vehicle No. is required."},{status:400});if(!items.length)return Response.json({error:"At least one Raw/Dispatch item is required."},{status:400});
      const branchId=idOf(b.dealer_id);if(!branchId)return Response.json({error:"Showroom / Branch select karein."},{status:400});
      const branch=(await pool.query("SELECT id,name FROM dealer WHERE id=$1",[branchId])).rows[0];if(!branch)return Response.json({error:"Showroom / Branch not found."},{status:400});
      const client=await pool.connect();try{await client.query("BEGIN");let total=0;const clean:any[]=[];
        for(const it of items){const pid=idOf(it.item_id),qty=Number(it.qty||0),rate=Number(it.rate||0);if(!pid||qty<=0||rate<0)throw new Error("Select a valid Raw Material / Dispatch item, quantity and rate.");const pr=await client.query("SELECT * FROM product WHERE id=$1 FOR UPDATE",[pid]);if(!pr.rowCount)throw new Error("Item not found.");const isRaw=String(pr.rows[0].fro||"").toUpperCase()==="R",isDispatch=String(pr.rows[0].product_category||"").toUpperCase()==="DISPATCH";if(!isRaw&&!isDispatch)throw new Error(pr.rows[0].name+" is not a Raw Material or Dispatch item.");const stock=await client.query("SELECT COALESCE(SUM(CASE WHEN UPPER(COALESCE(work_type,''))='OUT' THEN -ABS(qty) WHEN UPPER(COALESCE(work_type,''))='IN' THEN ABS(qty) ELSE qty END),0) AS balance FROM journal_stock WHERE lower(trim(item_name))=lower(trim($1))",[pr.rows[0].name]);if(Number(stock.rows[0]?.balance||0)<qty)throw new Error("Insufficient stock for "+pr.rows[0].name+". Available: "+Number(stock.rows[0]?.balance||0));total+=qty*rate;clean.push({item_id:pid,item_code:pr.rows[0].code||"",item_name:pr.rows[0].name,qty,rate,unit:pr.rows[0].unit||"PCS",item_type:isDispatch?"DISPATCH":"R"});await client.query("INSERT INTO journal_stock (vou_no,date,item_name,item_type,qty,reason,created_at,work_type,batch_ref) VALUES ($1,COALESCE($2::date,CURRENT_DATE),$3,$4,$5,'Repair & Service Consumption',NOW(),'OUT',$1)",[String(b.vehicle_no||"RSV"),b.date||null,pr.rows[0].name,isDispatch?"DISPATCH":"RAW",qty]);}
        const no="RSV-"+new Date().toISOString().slice(0,10).replace(/-/g,"")+"-"+String(Date.now()).slice(-5),r=await client.query("INSERT INTO repair_service_voucher (voucher_no,date,vehicle_id,vehicle_no,chassis_no,customer_name,customer_mobile,items,total_amount,paid_amount,balance_amount,gst_amount,remarks,dealer_id,dealer_name) VALUES ($1,COALESCE($2::date,CURRENT_DATE),$3,$4,$5,$6,$7,$8::jsonb,$9::numeric,0,$9::numeric,0,$10,$11,$12) RETURNING *",[no,b.date||null,idOf(b.vehicle_id),String(b.vehicle_no).trim(),b.chassis_no||null,b.customer_name||null,b.customer_mobile||null,JSON.stringify(clean),total,b.remarks||null,branch?.id||null,branch?.name||null]);await client.query("COMMIT");return Response.json({success:true,voucher:r.rows[0],row:r.rows[0]},{status:201});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    if(p.startsWith("repair-service-vouchers/") && p.endsWith("/receipt")){
      // Repair payment receipt ab Factory se nahi banti — sirf authorised Dealer/Showroom portal (dealer/repair-receipts) se.
      return Response.json({error:"Repair Payment Receipt ab sirf authorised Dealer portal se banegi."},{status:403});
    }
    if(p==="journal-stock"){
      const cols=await columns("journal_stock"),itemType=String(b.item_type||"R").toUpperCase();if(itemType!=="R")return Response.json({error:"Journal Stock me sirf Raw Material use/produce ho sakta hai."},{status:400});const input:any={};for(const [k,v] of Object.entries(b||{})){const c=snake(k);if(cols.has(c)&&c!=="id")input[c]=v;}input.item_type="R";input.work_type=input.work_type||"IN";const keys=Object.keys(input);if(!keys.length)return Response.json({error:"No valid fields supplied."},{status:400});const r=await pool.query('INSERT INTO "journal_stock" ('+keys.map(k=>'"'+k+'"').join(",")+') VALUES ('+keys.map((_,i)=>"$"+(i+1)).join(",")+') RETURNING *',keys.map(k=>input[k]));return Response.json({success:true,row:r.rows[0],data:r.rows[0]},{status:201});
    }
    if(p==="journal-stock/work"){
      const inputs=Array.isArray(b.inputs)?b.inputs:[],output=String(b.output_item||"").trim(),outQty=Number(b.output_qty||0);if(!output||outQty<=0||!inputs.length)return Response.json({error:"Raw Material inputs and Raw Material output are required."},{status:400});const client=await pool.connect();
      try{await client.query("BEGIN");const all=[...inputs.map((x:any)=>({name:String(x.item_name||"").trim(),qty:Number(x.qty_per_unit||0)*outQty,dir:"OUT"})),{name:output,qty:outQty,dir:"IN"}];for(const x of all){if(!x.name||x.qty<=0)throw new Error("Every Raw Material name and quantity is required.");const pr=await client.query("SELECT id,name,fro FROM product WHERE lower(trim(name))=lower(trim($1)) LIMIT 1",[x.name]);if(!pr.rowCount)throw new Error("Raw Material not found in Product Master: "+x.name);if(String(pr.rows[0].fro||"").toUpperCase()!=="R")throw new Error(x.name+" must be a Raw Material.");if(x.dir==="OUT"){const st=await client.query("SELECT COALESCE(SUM(CASE WHEN UPPER(COALESCE(work_type,''))='OUT' THEN -ABS(qty) WHEN UPPER(COALESCE(work_type,''))='IN' THEN ABS(qty) ELSE qty END),0) AS balance FROM journal_stock WHERE lower(trim(item_name))=lower(trim($1))",[x.name]);if(Number(st.rows[0]?.balance||0)<x.qty)throw new Error("Insufficient Raw Material stock for "+x.name+". Available: "+Number(st.rows[0]?.balance||0));}}
        const base=String(b.vou_no||"JS-"+Date.now());for(const x of all)await client.query("INSERT INTO journal_stock (vou_no,date,item_name,item_type,qty,reason,created_at,work_type,batch_ref,model_name) VALUES ($1,COALESCE($2::date,CURRENT_DATE),$3,'R',$4,$5,NOW(),$6,$1,$7)",[base,b.date||null,x.name,x.qty,b.reason||"Journal Raw Material Production",x.dir,b.model_name||null]);await client.query("COMMIT");return Response.json({success:true,vou_no:base},{status:201});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    if(p==="purchase-bills"){
      await ensurePurchaseExtraSchema();
      const cols=await columns("purchase_bill"),input:any={};
      for(const [k,v] of Object.entries(b||{})){const col=snake(k);if(cols.has(col)&&col!=="id")input[col]=v;}
      if(Array.isArray(input.items))input.items=JSON.stringify(input.items);
      if(Array.isArray(input.extra_charges))input.extra_charges=JSON.stringify(parseExtraCharges(input.extra_charges));
      const keys=Object.keys(input);if(!keys.length)return Response.json({error:"No valid purchase fields supplied."},{status:400});
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        const r=await client.query('INSERT INTO "purchase_bill" ('+keys.map(k=>'"'+k+'"').join(",")+') VALUES ('+keys.map((_,i)=>"$"+(i+1)).join(",")+') RETURNING *',keys.map(k=>input[k]));
        const row={...r.rows[0],items:parseItems(r.rows[0].items)};await syncBatteryPurchaseBill(client,row);await syncRawPurchaseStock(client,row);
        await client.query("COMMIT");return Response.json({success:true,row,data:row},{status:201});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    if(p==="delivery-challans" || p==="dealer/delivery-challans"){
      const did=a.scope==="dealer"?num(a.dealer_id):num(b.dealer_id),vehicleId=idOf(b.vehicle_id);
      if(a.scope==="dealer"&&!did)return Response.json({error:"Dealer not found."},{status:403});
      if(!vehicleId)return Response.json({error:"Select a chassis to dispatch."},{status:400});
      await ensureDispatchSchema();await ensureBatteryRegisterSchema();
      const selected=Array.isArray(b.dispatch_items)?b.dispatch_items.map((x:any)=>({product_id:idOf(x.product_id),qty:Math.max(1,Number(x.qty)||1)})).filter((x:any)=>x.product_id):[];
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        const vr=await client.query("SELECT * FROM vehicle WHERE id=$1 AND stage='Manufacturing' LIMIT 1 FOR UPDATE",[vehicleId]);
        if(!vr.rowCount)throw new Error("Selected chassis is not available in Manufacturing.");
        const v=vr.rows[0],batteryMaker=String(b.battery_maker||"").trim(),batteryNumbers=[b.battery_no1,b.battery_no2,b.battery_no3,b.battery_no4].map(x=>String(x||"").trim()).filter(Boolean);
        if(batteryNumbers.length&&!batteryMaker)throw new Error("Battery Maker is required when Battery No. is entered.");
        if(batteryNumbers.length)await assertBatterySerialsAvailable(client,batteryMaker,batteryNumbers);
        const products:any[]=[];
        for(const item of selected){
          const pr=await client.query("SELECT id,name,COALESCE(NULLIF(product_category,''),CASE WHEN fro='F' THEN 'FINISHED' ELSE 'RAW' END) AS category,COALESCE(show_on_delivery_challan,false) AS show_on_delivery_challan FROM product WHERE id=$1 LIMIT 1 FOR UPDATE",[item.product_id]);
          if(!pr.rowCount)throw new Error("Dispatch product not found.");
          const pdt=pr.rows[0];if(String(pdt.category).toUpperCase()!=="DISPATCH"||!pdt.show_on_delivery_challan)throw new Error("Invalid Delivery Challan item: "+pdt.name);
          const stock=await client.query("SELECT COALESCE(SUM(CASE WHEN UPPER(COALESCE(work_type,''))='IN' THEN qty ELSE -qty END),0) AS qty FROM journal_stock WHERE lower(trim(item_name))=lower(trim($1))",[pdt.name]);
          const availableStock=Number(stock.rows[0]?.qty||0);if(availableStock<item.qty)throw new Error("Insufficient stock for "+pdt.name+". Available: "+availableStock);products.push({...item,product_name:pdt.name});
        }
        const r=await client.query("INSERT INTO delivery_challan (challan_no,date,cancelled,dealer_id,destination,vehicle_id,product_name,chassis_no,motor_no,controller_no,differential_no,colour,sale_value,remarks1,remarks2,created_at) VALUES (COALESCE(NULLIF($1,''),'DC-'||extract(epoch from now())::bigint),COALESCE($2::date,CURRENT_DATE),false,$3,$4,$5,COALESCE(NULLIF($6,''),$7),COALESCE(NULLIF($8,''),$9),COALESCE(NULLIF($10,''),$11),$12,$13,COALESCE(NULLIF($14,''),$15),$16,$17,$18,NOW()) RETURNING *",
          [String(b.challan_no||""),b.date||null,did,b.destination||null,vehicleId,String(b.product_name||""),v.model_name||"",String(b.chassis_no||""),v.chassis_no||"",String(b.motor_no||""),v.motor_no||"",b.controller_no||v.controller_no||null,b.differential_no||v.differential_no||null,String(b.colour||""),v.colour||"",num(b.sale_value),b.remarks1||null,b.remarks2||null]);
        // Accessories (Toolkit/Jack/...) aur Salesman pehle INSERT me save nahi hote the (sirf Edit ke baad aate the) -> ab create par hi save.
        {
          const ACC=["toolkit","jack","charger","center_lock","mat","stapney","front_glass","h_lock"];
          const ti=await client.query("SELECT column_name,data_type FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='delivery_challan' AND column_name=ANY($1)",[[...ACC,"salesman"]]);
          const typ:any={};for(const c of ti.rows)typ[c.column_name]=String(c.data_type);
          const sets:string[]=[],vals:any[]=[];
          for(const k of ACC){if(!typ[k])continue;const on=b[k]===true||b[k]==="true"||b[k]===1||b[k]==="1"||b[k]==="YES";
            vals.push(typ[k]==="boolean"?on:(/int|numeric|double|real/.test(typ[k])?(on?1:0):(on?"YES":null)));sets.push(k+"=$"+vals.length);}
          if(typ.salesman){
            let sm=String(b.salesman||"").trim();
            if(!sm)sm=String((await client.query("SELECT COALESCE(to_jsonb(d)->>'salesman','') AS s FROM dealer d WHERE d.id=$1",[did])).rows[0]?.s||"").trim();
            vals.push(sm||null);sets.push("salesman=$"+vals.length);
          }
          if(sets.length){vals.push(r.rows[0].id);const u=await client.query("UPDATE delivery_challan SET "+sets.join(",")+" WHERE id=$"+vals.length+" RETURNING *",vals);if(u.rows[0])r.rows[0]=u.rows[0];}
        }
        for(const item of products){await client.query("INSERT INTO delivery_challan_item (delivery_challan_id,product_id,product_name,qty) VALUES ($1,$2,$3,$4)",[r.rows[0].id,item.product_id,item.product_name,item.qty]);await client.query("INSERT INTO journal_stock (vou_no,date,item_name,item_type,qty,reason,created_at,work_type,batch_ref) VALUES ($1,COALESCE($2::date,CURRENT_DATE),$3,'DISPATCH',$4,'Delivery Challan Consumption',NOW(),'OUT',$1)",[String(r.rows[0].challan_no),r.rows[0].date,item.product_name,item.qty]);}
        await client.query("UPDATE vehicle SET stage='Delivery Challan',dealer_name=(SELECT name FROM dealer WHERE id=$1),battery_maker=$2,battery_no1=$3,battery_no2=$4,battery_no3=$5,battery_no4=$6 WHERE id=$7",[did,batteryMaker||null,batteryNumbers[0]||null,batteryNumbers[1]||null,batteryNumbers[2]||null,batteryNumbers[3]||null,vehicleId]);
        const dealerName=(await client.query("SELECT name FROM dealer WHERE id=$1",[did])).rows[0]?.name||"";
        await toggleBatteryRegisterForDelivery(client,{...r.rows[0],dealer_name:dealerName,dealer_id:did,vehicle_id:vehicleId},false);
        await client.query("COMMIT");return Response.json({success:true,row:r.rows[0],data:r.rows[0],dispatch_items:products},{status:201});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    if(p==="factory-check-reports"){
      await ensureFactoryCheckSchema();
      const pvId=idOf(b.production_voucher_id);if(!pvId)return Response.json({error:"Production Voucher is required."},{status:400});
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        const pv=await client.query("SELECT * FROM production_voucher WHERE id=$1 FOR UPDATE",[pvId]);if(!pv.rowCount)throw new Error("Production Voucher not found.");
        const existing=await client.query("SELECT id FROM factory_check_report WHERE production_voucher_id=$1",[pvId]);if(existing.rowCount){await client.query("COMMIT");return Response.json({success:true,id:existing.rows[0].id,already_exists:true});}
        const qty=Math.max(1,num(pv.rows[0].quantity)||1);
        const formula=await client.query("SELECT raw_item_name,qty,unit FROM production_formula WHERE product_name=$1 AND ($2='' OR formula_name=$2) ORDER BY id",[pv.rows[0].product_name||"",String(pv.rows[0].formula_name||"")]);
        const report=await client.query("INSERT INTO factory_check_report (production_voucher_id,date,product_name,quantity,status,remarks) VALUES ($1,COALESCE($2::date,CURRENT_DATE),$3,$4,'PENDING',$5) RETURNING *",[pvId,pv.rows[0].date||null,pv.rows[0].product_name||"",qty,"Checklist created from Production Formula. Approval is informational and does not block production."]);
        for(const line of formula.rows)await client.query("INSERT INTO factory_check_item (report_id,raw_item_name,expected_qty,consumed_qty,unit,additional,status) VALUES ($1,$2,$3,$4,$5,false,'PENDING')",[report.rows[0].id,line.raw_item_name,num(line.qty)*qty,num(line.qty)*qty,line.unit||"PCS"]);
        await client.query("COMMIT");return Response.json({success:true,report:report.rows[0]},{status:201});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    if(p.startsWith("factory-check-reports/") && p.endsWith("/approve")){
      await ensureFactoryCheckSchema();const id=idOf(path[path.length-2]);if(!id)return Response.json({error:"Report id required."},{status:400});
      const r=await pool.query("UPDATE factory_check_report SET status='APPROVED',approved_by=$1,approved_at=NOW() WHERE id=$2 RETURNING *",[String(a.user_id||a.username||a.name||"Staff"),id]);
      if(!r.rowCount)return Response.json({error:"Factory Check Report not found."},{status:404});
      return Response.json({success:true,report:r.rows[0]});
    }
    if(p.startsWith("factory-check-items/") && p.endsWith("/approve")){
      await ensureFactoryCheckSchema();const id=idOf(path[path.length-2]);if(!id)return Response.json({error:"Item id required."},{status:400});
      const r=await pool.query("UPDATE factory_check_item SET status='APPROVED',approved_by=$1,approved_at=NOW() WHERE id=$2 RETURNING *",[String(a.user_id||a.username||a.name||"Staff"),id]);
      if(!r.rowCount)return Response.json({error:"Factory Check Item not found."},{status:404});
      return Response.json({success:true,item:r.rows[0]});
    }
    if(p.startsWith("factory-check-reports/") && p.endsWith("/parts")){
      await ensureFactoryCheckSchema();const id=idOf(path[path.length-2]);if(!id)return Response.json({error:"Report id required."},{status:400});
      const name=String(b.raw_item_name||"").trim(),qty=Math.max(0,num(b.qty)||0),unit=String(b.unit||"PCS").trim()||"PCS";
      if(!name||qty<=0)return Response.json({error:"Part name and quantity are required."},{status:400});
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        const report=await client.query("SELECT * FROM factory_check_report WHERE id=$1 FOR UPDATE",[id]);if(!report.rowCount)throw new Error("Factory Check Report not found.");
        const stock=await client.query("SELECT COALESCE(SUM(CASE WHEN UPPER(COALESCE(work_type,''))='IN' THEN qty ELSE -qty END),0) AS qty FROM journal_stock WHERE lower(trim(item_name))=lower(trim($1))",[name]);
        const available=Number(stock.rows[0]?.qty||0);if(available<qty)throw new Error("Insufficient stock for "+name+". Available: "+available);
        await client.query("INSERT INTO journal_stock (vou_no,date,item_name,item_type,qty,reason,created_at,model_name,work_type,batch_ref) VALUES ($1,CURRENT_DATE,$2,'RAW',$3,'Factory Check Additional Part',NOW(),$4,'OUT',$1)",["FCR-"+id,name,qty,report.rows[0].product_name||null]);
        const r=await client.query("INSERT INTO factory_check_item (report_id,raw_item_name,expected_qty,consumed_qty,unit,additional,status,remarks) VALUES ($1,$2,0,$3,$4,true,'PENDING',$5) RETURNING *",[id,name,qty,unit,String(b.remarks||"Additional part requested from Factory Check")]);
        await client.query("COMMIT");return Response.json({success:true,item:r.rows[0]},{status:201});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    if(p==="tax-invoices"){
      // Form sends challan_id; resolve dealer/vehicle from the challan when not sent explicitly.
      const chId=num(b.delivery_challan_id||b.challan_id);
      if(chId&&(!num(b.dealer_id)||!num(b.vehicle_id))){
        const dcr=await pool.query("SELECT dealer_id,vehicle_id FROM delivery_challan WHERE id=$1",[chId]);
        if(dcr.rowCount){if(!num(b.dealer_id))b.dealer_id=dcr.rows[0].dealer_id;if(!num(b.vehicle_id))b.vehicle_id=dcr.rows[0].vehicle_id;}
      }
      b.delivery_challan_id=chId||null;
      if(!b.dealer_name&&num(b.dealer_id)){const dn=await pool.query("SELECT name FROM dealer WHERE id=$1",[num(b.dealer_id)]);b.dealer_name=dn.rows[0]?.name||null;}
      const customerId=num(b.customer_id)||await upsertBillingCustomer(b);
      const grossTaxable=num(b.gst_sale_amount||b.sale_amount),discount=Math.max(0,num(b.discount)),taxable=Math.max(0,grossTaxable-discount),rate=num(b.gst_rate);
      const companyState=await pool.query("SELECT state_code FROM company ORDER BY id LIMIT 1");
      const sellerStateCode=String(companyState.rows[0]?.state_code||"").trim(),buyerStateCode=String(b.buyer_state_code||"").trim(),stateType=String(b.state_type||"").trim().toUpperCase();
      const sameState=stateType==="I"||stateType==="INTRA"||(!stateType&&!!sellerStateCode&&sellerStateCode===buyerStateCode),gst=taxable*rate/100;
      const cols=await columns("tax_invoice");
      if(!cols.size)return Response.json({error:"Tax Invoice table not found."},{status:500});
      const values:any={
        bill_no:String(b.bill_no||"").trim()||("INV-"+Date.now()),date:b.date||null,cancelled:false,delivery_challan_id:num(b.delivery_challan_id)||null,
        dealer_id:num(b.dealer_id)||null,vehicle_id:num(b.vehicle_id)||null,buyer_name:b.buyer_name||null,buyer_relation:b.buyer_relation||null,buyer_father_name:b.buyer_father_name||null,buyer_address:b.buyer_address||null,buyer_mobile:b.buyer_mobile||null,buyer_pan:b.buyer_pan||null,buyer_aadhar:b.buyer_aadhar||null,buyer_dob:b.buyer_dob||null,license_no:b.license_no||null,customer_id:customerId,buyer_gst_no:b.buyer_gst_no||null,
        buyer_state:b.buyer_state||null,buyer_state_code:b.buyer_state_code||null,state_type:b.state_type||null,product_name:b.product_name||null,
        chassis_no:b.chassis_no||null,motor_no:b.motor_no||null,sale_amount:num(b.sale_amount),gst_sale_amount:taxable,gst_rate:rate,
        discount:num(b.discount),insurance_amount:num(b.insurance_amount),registration_amount:num(b.registration_amount),
        amount_received:num(b.amount_received),subsidy_amount:num(b.subsidy_amount),dealer_name:b.dealer_name||null,created_at:new Date()
      };
      const keys=Object.keys(values).filter(k=>cols.has(k)),ph=keys.map((_,i)=>"$"+(i+1));
      if(!keys.length)return Response.json({error:"No compatible Tax Invoice columns found."},{status:500});
      const r=await pool.query('INSERT INTO tax_invoice ('+keys.map(k=>'"'+k+'"').join(",")+') VALUES ('+ph.join(",")+') RETURNING *',keys.map(k=>values[k]));
      if(num(b.vehicle_id)){
        const vc=await columns("vehicle");
        if(vc.has("stage")) await pool.query("UPDATE vehicle SET stage='Tax Invoice'"+(vc.has("dealer_name")?",dealer_name=COALESCE($1,dealer_name)":"")+" WHERE id="+(vc.has("dealer_name")?"$2":"$1"),vc.has("dealer_name")?[b.dealer_name||null,num(b.vehicle_id)]:[num(b.vehicle_id)]);
      }
      return Response.json({success:true,row:r.rows[0],data:r.rows[0],gst:{rate,amount:gst,cgst:sameState?gst/2:0,sgst:sameState?gst/2:0,igst:sameState?0:gst}},{status:201});
    }
    if(p==="factory/old-rickshaw-challans"){
      await ensureOldRickshawInventorySchema();
      const challan=String(b.challan_no||"").trim()||("ORC-"+Date.now()),date=b.date||null,model=String(b.model_name||"").trim(),vehicle=String(b.vehicle_no||"").trim();
      if(!model||!vehicle)return Response.json({error:"Model and Vehicle No. are required."},{status:400});
      const r=await pool.query("INSERT INTO old_rickshaw_challan (date,challan_no,model_name,vehicle_no,colour,toolkit,dealer_id,source,source_ref,status) VALUES (COALESCE($1::date,CURRENT_DATE),$2,$3,$4,$5,$6,$7,$8,$9,'ACTIVE') RETURNING *",
        [date,challan,model,vehicle,String(b.colour||"").trim()||null,String(b.toolkit||"").trim()||null,idOf(b.dealer_id)||null,String(b.source||"manual"),String(b.source_ref||"").trim()||null]);
      return Response.json({success:true,row:r.rows[0],data:r.rows[0]},{status:201});
    }
    if(p==="production-vouchers"){
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        await ensureProductionVoucherSchema();
        const chassis=String(b.chassis_no||"").trim();
        if(chassis){
          const dup=await client.query("SELECT 1 FROM vehicle WHERE upper(btrim(chassis_no))=upper($1) UNION ALL SELECT 1 FROM production_voucher WHERE upper(btrim(chassis_no))=upper($1) LIMIT 1",[chassis]);
          if(dup.rowCount)throw new Error("Chassis No. \""+chassis+"\" already exists. Duplicate chassis nahi ban sakta.");
          // Product Master me jitni Full Chassis No. Length likhi hai, chassis utna hi bada hona chahiye.
          const pj=(await client.query("SELECT to_jsonb(product) AS j FROM product WHERE lower(btrim(name))=lower(btrim($1::text)) ORDER BY (fro='F') DESC,id DESC LIMIT 1",[String(b.product_name||"")])).rows[0]?.j||{};
          const lk=Object.keys(pj).find(k=>/chassis.*len|len.*chassis/i.test(k)&&Number(pj[k])>0);
          const need=lk?Number(pj[lk]):0;
          if(need&&chassis.length!==need)throw new Error("Chassis No. "+need+" character ka hona chahiye (abhi "+chassis.length+"). Product Master me Full Chassis No. Length "+need+" set hai.");
        }
        if(!String(b.colour||"").trim())throw new Error("Colour select karna zaroori hai.");
        if(!String(b.machnic||"").trim())throw new Error("Mechanic select karna zaroori hai.");
        const qty=Math.max(1,Math.trunc(num(b.quantity)||1));
        // Ek model ke 2-3 formula ho sakte hain: formula chune bina sab formulas ka stock ek saath kat jata, isliye zaroori.
        if(!String(b.formula_name||"").trim()){
          const fc=await client.query("SELECT COUNT(DISTINCT formula_name)::int AS n FROM production_formula WHERE product_name=$1",[b.product_name||""]);
          if(Number(fc.rows[0]?.n||0)>1)throw new Error("Is model ke ek se zyada formula hain. Formula Name select karein.");
        }
        const r=await client.query("INSERT INTO production_voucher (vou_no,date,product_name,formula_name,quantity,chassis_no,motor_no,controller_no,differential_no,colour,colour_code,other,battery_maker,battery_no1,battery_no2,battery_no3,battery_no4,machnic,created_at) VALUES (COALESCE(NULLIF($1,''),'PV-'||extract(epoch from now())::bigint),COALESCE($2::date,CURRENT_DATE),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW()) RETURNING *",
          [String(b.vou_no||""),b.date||null,b.product_name||"",String(b.formula_name||""),qty,chassis,b.motor_no||null,b.controller_no||null,b.differential_no||null,b.colour||null,b.colour_code||null,b.other||null,b.battery_maker||null,b.battery_no1||null,b.battery_no2||null,b.battery_no3||null,b.battery_no4||null,b.machnic||null]);
        if(chassis)await client.query("INSERT INTO vehicle (date,model_name,chassis_no,motor_no,controller_no,differential_no,colour,colour_code,stage,battery_maker,battery_no1,battery_no2,battery_no3,battery_no4) VALUES (COALESCE($1::date,CURRENT_DATE),$2,$3,$4,$5,$6,$7,$8,'Manufacturing',$9,$10,$11,$12,$13) ON CONFLICT (chassis_no) DO UPDATE SET stage='Manufacturing',model_name=EXCLUDED.model_name,battery_maker=EXCLUDED.battery_maker,battery_no1=EXCLUDED.battery_no1,battery_no2=EXCLUDED.battery_no2,battery_no3=EXCLUDED.battery_no3,battery_no4=EXCLUDED.battery_no4",
          [b.date||null,b.product_name||null,chassis,b.motor_no||null,b.controller_no||null,b.differential_no||null,b.colour||null,b.colour_code||null,b.battery_maker||null,b.battery_no1||null,b.battery_no2||null,b.battery_no3||null,b.battery_no4||null]);
        const formula=await client.query("SELECT raw_item_name,qty,unit FROM production_formula WHERE product_name=$1 AND ($2='' OR formula_name=$2) ORDER BY id",[b.product_name||"",String(b.formula_name||"")]);
        for(const line of formula.rows){
          const need=num(line.qty)*qty;
          if(need<=0)continue;
          const existing=await client.query("SELECT id FROM journal_stock WHERE batch_ref=$1 AND item_name=$2 AND reason='Production Consumption' LIMIT 1",[String(b.vou_no||r.rows[0].vou_no),line.raw_item_name]);
          if(!existing.rowCount)await client.query("INSERT INTO journal_stock (vou_no,date,item_name,item_type,qty,reason,created_at,model_name,work_type,batch_ref) VALUES ($1,COALESCE($2::date,CURRENT_DATE),$3,'RAW',$4,'Production Consumption',NOW(),$5,'OUT',$1)",[String(b.vou_no||r.rows[0].vou_no),b.date||null,line.raw_item_name,need,b.product_name||null]);
        }
        await ensureFactoryCheckSchema();
        const check=await client.query("INSERT INTO factory_check_report (production_voucher_id,date,product_name,quantity,status,remarks) VALUES ($1,COALESCE($2::date,CURRENT_DATE),$3,$4,'PENDING',$5) ON CONFLICT (production_voucher_id) DO NOTHING RETURNING id",[r.rows[0].id,b.date||null,b.product_name||"",qty,"Auto-created from Production Formula. Approval is for audit/checking only and does not block production."]);
        if(check.rowCount){
          for(const line of formula.rows){
            const need=num(line.qty)*qty;if(need<=0)continue;
            await client.query("INSERT INTO factory_check_item (report_id,raw_item_name,expected_qty,consumed_qty,unit,additional,status) VALUES ($1,$2,$3,$3,$4,false,'PENDING')",[check.rows[0].id,line.raw_item_name,need,line.unit||"PCS"]);
          }
        }
        await client.query("COMMIT");
        return Response.json({success:true,row:r.rows[0],data:r.rows[0],bom_consumed:formula.rowCount},{status:201});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    if(p.startsWith("delivery-challans/") && p.endsWith("/cancel")){
      const id=idOf(path[path.length-2]); if(!id)return Response.json({error:"Record id required."},{status:400});
      await ensureDispatchSchema();
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        const dc=await client.query("SELECT * FROM delivery_challan WHERE id=$1 FOR UPDATE",[id]);
        if(!dc.rowCount)throw new Error("Delivery Challan not found.");
        const row=dc.rows[0];
        const items=await client.query("SELECT * FROM delivery_challan_item WHERE delivery_challan_id=$1 ORDER BY id",[id]);
        const nextCancelled=!Boolean(row.cancelled);
        for(const item of items.rows){
          const qty=Math.max(0,Number(item.qty)||0);
          if(!qty)continue;
          const reason=nextCancelled?"Delivery Challan Cancel Reversal":"Delivery Challan Consumption";
          const workType=nextCancelled?"IN":"OUT";
          if(!nextCancelled){
            const stock=await client.query("SELECT COALESCE(SUM(CASE WHEN UPPER(COALESCE(work_type,''))='IN' THEN qty ELSE -qty END),0) AS qty FROM journal_stock WHERE lower(trim(item_name))=lower(trim($1))",[item.product_name]);
            if(Number(stock.rows[0]?.qty||0)<qty)throw new Error("Insufficient stock for "+item.product_name+". Available: "+Number(stock.rows[0]?.qty||0));
          }
          await client.query("INSERT INTO journal_stock (vou_no,date,item_name,item_type,qty,reason,created_at,work_type,batch_ref) VALUES ($1,COALESCE($2::date,CURRENT_DATE),$3,'DISPATCH',$4,$5,NOW(),$6,$1)",
            [String(row.challan_no||("DC-"+id)),row.date||null,item.product_name,qty,reason,workType]);
        }
        const r=await client.query("UPDATE delivery_challan SET cancelled=$1 WHERE id=$2 RETURNING *",[nextCancelled,id]);
        if(r.rows[0]?.vehicle_id)await client.query("UPDATE vehicle SET stage=$1 WHERE id=$2",[nextCancelled?"Manufacturing":"Delivery Challan",r.rows[0].vehicle_id]);
        await client.query("COMMIT");
        return Response.json({success:true,row:r.rows[0]||null});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    if(p.startsWith("tax-invoices/") && p.endsWith("/cancel")){
      const id=idOf(path[path.length-2]); if(!id)return Response.json({error:"Record id required."},{status:400});
      const r=await pool.query("UPDATE tax_invoice SET cancelled=true WHERE id=$1 RETURNING *",[id]);
      return Response.json({success:r.rowCount>0,row:r.rows[0]||null});
    }
    if(p.startsWith("tax-invoices/") && p.endsWith("/payment")){
      const id=idOf(path[path.length-2]),pb:any=await json(req);
      if(!id)return Response.json({error:"Invoice id required."},{status:400});
      const r=await pool.query("UPDATE tax_invoice SET amount_received=COALESCE(amount_received,0)+$1 WHERE id=$2 RETURNING *",[num(pb.amount),id]);
      return Response.json({success:r.rowCount>0,row:r.rows[0]||null});
    }
    if(p.startsWith("delivery-challans/") && p.endsWith("/print")){
      const id=idOf(path[path.length-2]); const r=await pool.query("SELECT * FROM delivery_challan WHERE id=$1",[id]);
      return Response.json({success:true,data:r.rows[0]||null});
    }
    if(p.startsWith("tax-invoices/") && p.endsWith("/print")){
      const id=idOf(path[path.length-2]); const r=await pool.query("SELECT ti.*,"+TI_CALC+" FROM tax_invoice ti WHERE ti.id=$1",[id]);
      return Response.json({success:true,data:r.rows[0]||null});
    }
    if(p==="battery-swap-vouchers"){
      const fromType=String(b.from_type||"vehicle").toLowerCase(),toType=String(b.to_type||"vehicle").toLowerCase();
      const fromTable=fromType.includes("old")?"old_rickshaw":"vehicle",toTable=toType.includes("old")?"old_rickshaw":"vehicle";
      const fromId=idOf(b.from_id),toId=idOf(b.to_id);
      if(!fromId||!toId)return Response.json({error:"Source and target are required."},{status:400});
      if(fromTable===toTable&&fromId===toId)return Response.json({error:"Source and target must be different rickshaws."},{status:400});
      if(a.scope==="dealer"){
        const did=num(a.dealer_id);
        const dr=await pool.query("SELECT name FROM dealer WHERE id=$1",[did]);
        if(!dr.rowCount)return Response.json({error:"Dealer not found."},{status:404});
        const ownedNew=async(id:number,table:string)=>table==="old_rickshaw"
          ?(await pool.query("SELECT id FROM old_rickshaw WHERE id=$1 AND dealer_id=$2",[id,did])).rowCount===1
          :(await pool.query("SELECT id FROM vehicle WHERE id=$1 AND stage='Delivery Challan' AND lower(trim(COALESCE(dealer_name,'')))=lower(trim($2))",[id,dr.rows[0].name])).rowCount===1;
        if(!(await ownedNew(fromId,fromTable))||!(await ownedNew(toId,toTable)))return Response.json({error:"Both rickshaws must be in your dealer stock."},{status:403});
      }
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        const fr=await client.query('SELECT * FROM "'+fromTable+'" WHERE id=$1 FOR UPDATE',[fromId]);
        const tr=await client.query('SELECT * FROM "'+toTable+'" WHERE id=$1 FOR UPDATE',[toId]);
        if(!fr.rowCount||!tr.rowCount)throw new Error("Source or target vehicle not found.");
        const source=fr.rows[0],target=tr.rows[0];
        const fields=["battery_maker","battery_no1","battery_no2","battery_no3","battery_no4"];
        const sourceHas=fields.slice(1).some(k=>String(source[k]||"").trim());
        if(!sourceHas)throw new Error("Source has no battery to transfer.");
        const mode=String(b.mode||"swap").toLowerCase();
        if(mode==="transfer" && fields.slice(1).some(k=>String(target[k]||"").trim()))throw new Error("Target already has battery numbers.");
        const nextSource=mode==="transfer"?{battery_maker:null,battery_no1:null,battery_no2:null,battery_no3:null,battery_no4:null}:Object.fromEntries(fields.map(k=>[k,target[k]??null]));
        const nextTarget=Object.fromEntries(fields.map(k=>[k,source[k]??null]));
        const update=async(table:string,id:number,row:any)=>{
          await client.query('UPDATE "'+table+'" SET battery_maker=$1,battery_no1=$2,battery_no2=$3,battery_no3=$4,battery_no4=$5 WHERE id=$6',[row.battery_maker,row.battery_no1,row.battery_no2,row.battery_no3,row.battery_no4,id]);
        };
        await update(fromTable,fromId,nextSource); await update(toTable,toId,nextTarget);
        await ensureNotificationSchema();
        const swapMsg=`Battery swap on dealer ${num(b.dealer_id)||''}: ${String(source.chassis_no||source.vehicle_no||source.reg_no||fromId)} → ${String(target.chassis_no||target.vehicle_no||target.reg_no||toId)}.`;
        await client.query("INSERT INTO app_notification(notification_type,title,message,dealer_id,reference_type,reference_id,dedupe_key) VALUES('battery_change','Battery Changed / Swapped',$1,$2,'battery_swap',NULL,'battery-swap-'||extract(epoch from clock_timestamp())::bigint)",[swapMsg,num(b.dealer_id)||null]);
        const vr=await client.query("INSERT INTO battery_swap_voucher (voucher_no,date,dealer_id,from_type,from_id,to_type,to_id,mode,remarks,created_at) VALUES (COALESCE(NULLIF($1,''),'BS-'||extract(epoch from now())::bigint),COALESCE($2::date,CURRENT_DATE),$3,$4,$5,$6,$7,$8,$9,NOW()) RETURNING *",
          [String(b.voucher_no||""),b.date||null,num(b.dealer_id)||null,fromType,fromId,toType,toId,mode,b.remarks||null]);
        await client.query("COMMIT");
        return Response.json({success:true,row:vr.rows[0],data:vr.rows[0],source:nextSource,target:nextTarget},{status:201});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    if(p==="dealer/ledger-accounts"&&a.scope==="dealer"){
      await pool.query(`CREATE TABLE IF NOT EXISTS dealer_ledger_account (
        id bigserial PRIMARY KEY,dealer_id integer NOT NULL,account_type text NOT NULL,name text NOT NULL,code text,
        mobile text,address text,account_no text,ifsc text,opening_balance numeric NOT NULL DEFAULT 0,
        opening_type text NOT NULL DEFAULT 'dr',notes text,created_at timestamptz NOT NULL DEFAULT now()
      )`);
      const name=String(b.name||"").trim();if(!name)return Response.json({error:"Ledger Name is required."},{status:400});
      const r=await pool.query("INSERT INTO dealer_ledger_account (dealer_id,account_type,name,code,mobile,address,account_no,ifsc,opening_balance,opening_type,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *",
        [num(a.dealer_id),String(b.account_type||"dealer"),name,String(b.code||"").trim()||null,String(b.mobile||"").trim()||null,String(b.address||"").trim()||null,String(b.account_no||"").trim()||null,String(b.ifsc||"").trim()||null,num(b.opening_balance),String(b.opening_type||"dr"),String(b.notes||"").trim()||null]);
      return Response.json({success:true,row:r.rows[0],data:r.rows[0]},{status:201});
    }
    if(p==="dealer/submit-loan"){
      await ensureLoanWorkflowBridgeSchema();
      const did=a.scope==="dealer"?num(a.dealer_id):num(b.dealer_id);
      if(!did)return Response.json({error:"Dealer not found."},{status:400});

      const dealer=(await pool.query("SELECT id,code,name,login_id,mobile FROM dealer WHERE id=$1 LIMIT 1",[did])).rows[0];
      if(!dealer)return Response.json({error:"Dealer not found."},{status:404});

      const borrower=b.borrower||{};
      const guarantor=b.guarantor||{};
      const coBorrower=b.co_borrower||{};
      const vehicleLoan={...(b.vehicle_loan||{})};
      const modelId=idOf(vehicleLoan.vehicle_model_id||vehicleLoan.grd_model_id);
      if(!modelId)return Response.json({error:"Vehicle model select karein."},{status:400});
      const model=(await pool.query("SELECT * FROM product WHERE id=$1 LIMIT 1",[modelId])).rows[0];
      if(!model)return Response.json({error:"Selected vehicle model not found."},{status:404});

      // If this is a new customer, keep a local GRD customer record as well.
      // Existing customer_id is preserved exactly as submitted by the dealer.
      let customerId=idOf(b.customer_id);
      if(!customerId){
        const cc=await columns("customer");
        const input:any={
          dealer_id:did,
          full_name:String(borrower.full_name||"").trim()||null,
          phone:String(borrower.phone||"").trim()||null,
          email:String(borrower.email||"").trim()||null,
          dob:borrower.dob||null,
          gender:String(borrower.gender||"").trim()||null,
          pan:String(borrower.pan||"").trim()||null,
          occupation:String(borrower.occupation||"").trim()||null,
          monthly_income:num(borrower.monthly_income)||null,
          pincode:String(borrower.pincode||"").trim()||null,
          city:String(borrower.city||"").trim()||null,
          state:String(borrower.state||"").trim()||null,
          address:String(borrower.address||"").trim()||null
        };
        const keys=Object.keys(input).filter(k=>cc.has(k));
        if(keys.length){
          const ins=await pool.query('INSERT INTO customer ('+keys.map(k=>'"'+k+'"').join(",")+') VALUES ('+keys.map((_,i)=>"$"+(i+1)).join(",")+') RETURNING id',keys.map(k=>input[k]));
          customerId=Number(ins.rows[0]?.id)||null;
        }
      }

      const localNo=String(b.application_no||"").trim()||("APP-"+Date.now());
      const initial=await pool.query(
        "INSERT INTO loan_workflow (application_no,dealer_id,customer_id,status,loan_amount,loan_model_name,loan_vehicle_type,chfpl_status_updated_at,created_at,updated_at) VALUES ($1,$2,$3,'PENDING_CHFPL_SYNC',$4,$5,$6,NOW(),NOW(),NOW()) RETURNING *",
        [localNo,did,customerId,num(vehicleLoan.loan_amount_requested||b.loan_amount),String(model?.name||vehicleLoan.grd_model_name||"").trim()||null,String(vehicleLoan.vehicle_type||b.loan_vehicle_type||"3W").trim()||"3W"]
      );
      const local=initial.rows[0];

      const bridgeBody={
        grd_submission_ref:String(local.id),
        dealer:{
          grd_dealer_id:did,
          code:String(dealer.code||dealer.login_id||"").trim(),
          login_id:String(dealer.login_id||"").trim()||null,
          name:String(dealer.name||"").trim(),
          mobile:String(dealer.mobile||"").trim()||null
        },
        borrower,
        guarantor,
        co_borrower:coBorrower,
        vehicle_loan:{
          ...vehicleLoan,
          grd_model_id:modelId||null,
          grd_model_code:model ? (String(model.code||"").trim()||null) : null,
          grd_model_name:model ? String(model.name||"").trim() : null,
          vehicle_type:String(vehicleLoan.vehicle_type||b.loan_vehicle_type||"3W").trim()||"3W",
          vehicle_price:num(vehicleLoan.vehicle_price||model?.ex_showroom_price||model?.sale_price)
        },
        loan_type:b.loan_type||"NEW",
        dealer_register_page_no:b.dealer_register_page_no||null,
        customer_photo:b.customer_photo||null,
        documents:Array.isArray(b.documents)?b.documents:[]
      };

      const submitted=await chfplSubmitLoan(bridgeBody);
      if(!submitted.ok){
        console.error("[dealer/submit-loan] CHFPL sync pending:",submitted.error);
        return Response.json({
          success:true,
          sync_status:"PENDING_CHFPL_SYNC",
          application:null,
          application_id:local.id,
          message:"Loan saved in GRD. CHFPL sync is pending.",
          sync_error:submitted.error
        },{status:202});
      }

      const remote=submitted.data||{};
      const chfplLoanId=idOf(remote.application_id);
      if(!chfplLoanId){
        console.error("[dealer/submit-loan] CHFPL returned no application_id");
        return Response.json({
          success:true,
          sync_status:"PENDING_CHFPL_SYNC",
          application:null,
          application_id:local.id,
          message:"Loan saved in GRD. CHFPL sync is pending.",
          sync_error:"CHFPL did not return application_id."
        },{status:202});
      }

      const updated=await pool.query(
        "UPDATE loan_workflow SET chfpl_loan_id=$1,status=$2,chfpl_status_updated_at=NOW(),updated_at=NOW() WHERE id=$3 RETURNING *",
        [chfplLoanId,String(remote.status||"submitted").trim()||"submitted",local.id]
      );
      return Response.json({
        success:true,
        sync_status:"SYNCED",
        application:updated.rows[0],
        application_id:local.id,
        chfpl_loan_id:chfplLoanId,
        application_no:remote.application_no||updated.rows[0]?.application_no||null,
        status:remote.status||"submitted"
      },{status:201});
    }
    if(p==="billing/vehicle-inventory/download-txt"){
      const ids=Array.isArray(b.invoice_ids)?b.invoice_ids.map((x:any)=>idOf(x)).filter(Boolean):[];
      if(!ids.length)return new Response("No invoices selected.",{status:400,headers:{"Content-Type":"text/plain;charset=utf-8"}});
      const r=await pool.query("SELECT ti.date,ti.buyer_name,COALESCE(v.model_name,ti.product_name,'') AS model_name,v.chassis_no,v.motor_no,COALESCE(to_jsonb(v)->>'umrn','') AS umrn,COALESCE(to_jsonb(v)->>'manufacturing_month','') AS manufacturing_month,COALESCE(COALESCE(to_jsonb(v)->>'colour_code','') AS colour_code,'') AS colour_code FROM tax_invoice ti LEFT JOIN vehicle v ON v.id=ti.vehicle_id WHERE ti.id=ANY($1::int[]) ORDER BY ti.date,ti.id",[ids]);
      const parts=Object.fromEntries(new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Kolkata",weekday:"short",day:"2-digit",month:"2-digit",year:"2-digit"}).formatToParts(new Date()).filter((x:any)=>x.type!=="literal").map((x:any)=>[x.type,x.value]));
      const day=String(parts.weekday||"sun").toLowerCase(),fileName=day+String(parts.day||"").padStart(2,"0")+String(parts.month||"").padStart(2,"0")+String(parts.year||"").slice(-2)+".txt";
      const monthNumber=(v:any)=>{const s=String(v??"").trim();if(!s)return "";const direct=s.match(/^(\d{1,2})[\/-](\d{4})$/);if(direct)return String(Number(direct[1])).padStart(2,"0")+direct[2];const y=s.match(/(20\d{2})/),m=s.match(/(?:^|[^a-z])(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(?:[^a-z]|$)/i);if(y&&m){const names=["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];return String(names.indexOf(m[1].toLowerCase())+1).padStart(2,"0")+y[1];}const d=s.match(/(20\d{2})[-/](\d{1,2})/);return d?String(Number(d[2])).padStart(2,"0")+d[1]:s.replace(/[^A-Za-z0-9]/g,"").slice(0,6);};
      const lines=r.rows.map((x:any)=>[x.umrn||"",x.chassis_no||"",monthNumber(x.manufacturing_month),x.colour_code||"","GRD","NA"].map((v:any)=>String(v).replace(/[|\r\n]/g,"")).join("|"));
      return new Response(lines.join("\r\n"),{headers:{"Content-Type":"text/plain;charset=utf-8","Content-Disposition":"attachment; filename=\""+fileName+"\""}});
    }
    if(p==="old-rickshaws"){
      await ensureOldRickshawLegacySchema();
      const b:any=await json(req);
      if(!String(b.vehicle_reg_no||"").trim())return Response.json({error:"Vehicle Reg. No. is required."},{status:400});
      const cols=await columns("old_rickshaw"),input:any={};
      for(const [k,v] of Object.entries(b||{})){const col=snake(k);if(cols.has(col)&&col!=="id")input[col]=v;}
      for(const k of ["purchase_amount","sale_amount","sold_amount","loan_amount","down_payment","receipt_amount","balance_amount"])if(Object.prototype.hasOwnProperty.call(input,k))input[k]=num(input[k]);
      input.dealer_id=idOf(b.dealer_id);input.status=String(b.status||"available");
      const keys=Object.keys(input),ph=keys.map((_,i)=>"$"+(i+1));
      const r=await pool.query('INSERT INTO old_rickshaw ('+keys.map(k=>'"'+k+'"').join(",")+') VALUES ('+ph.join(",")+') RETURNING *',keys.map(k=>input[k]));
      return Response.json({success:true,row:r.rows[0],data:r.rows[0]},{status:201});
    }
    if(p==="old-rickshaws/sale"){
      await ensureOldRickshawLegacySchema();
      const b:any=await json(req),id=idOf(b.id);
      if(!id)return Response.json({error:"Old Rickshaw id is required."},{status:400});
      const saleAmount=num(b.sale_amount),loanAmount=num(b.loan_amount),balance=Math.max(0,saleAmount-loanAmount);
      const vals:any={status:"sold",dealer_id:idOf(b.dealer_id),sale_date:b.sale_date||null,sale_amount:saleAmount,sold_amount:saleAmount,loan_amount:loanAmount,down_payment:num(b.down_payment),balance_amount:balance,file_charge:num(b.file_charge),dealer_page_no:String(b.dealer_page_no||"").trim()||null,sp_no:String(b.sp_no||"").trim()||null,sale_ref_no:String(b.sale_ref_no||"").trim()||null,sale_type:String(b.sale_type||"").trim()||null,do_number:String(b.do_number||"").trim()||null,out_name:String(b.out_name||"").trim()||null,receipt_amount:num(b.receipt_amount),receipt_no:String(b.receipt_no||"").trim()||null,ledger:String(b.ledger||"").trim()||null,resale_date:b.resale_date||null,resale_ledger:String(b.resale_ledger||"").trim()||null,customer_name:String(b.out_name||"").trim()||null,updated_at:new Date()};
      const cols=await columns("old_rickshaw"),keys=Object.keys(vals).filter(k=>cols.has(k)),sets=keys.map((k,i)=>'"'+k+'"=$'+(i+1));
      const r=await pool.query('UPDATE old_rickshaw SET '+sets.join(",")+' WHERE id=$'+(keys.length+1)+' RETURNING *',[...keys.map(k=>vals[k]),id]);
      if(!r.rowCount)return Response.json({error:"Old Rickshaw record not found."},{status:404});
      return Response.json({success:true,row:r.rows[0],data:r.rows[0]});
    }

    if(p==='sub-groups'){
      const name=String(b.name||'').trim(); if(!name)return Response.json({error:'Sub Group Name is required.'},{status:400});
      const r=await pool.query('INSERT INTO product_sub_group(name) VALUES($1) ON CONFLICT(name) DO UPDATE SET active=true RETURNING *',[name]); await audit(a,'sub-groups','create',r.rows[0].id,null,r.rows[0]); return Response.json({success:true,row:r.rows[0]},{status:201});
    }
    if(p.startsWith('users/') && p.endsWith('/action-permissions')){
      const uid=idOf(path[path.length-2]); if(!uid)return Response.json({error:'User id required.'},{status:400});
      const permissions=Array.isArray(b.permissions)?b.permissions:[]; const oldPerm=(await pool.query('SELECT module_key,can_view,can_create,can_edit,can_delete,can_approve FROM user_action_permission WHERE user_id=$1 ORDER BY module_key',[uid])).rows; for(const x of permissions){const m=String(x.module_key||'').trim();if(!m)continue;await pool.query(`INSERT INTO user_action_permission(user_id,module_key,can_view,can_create,can_edit,can_delete,can_approve) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id,module_key) DO UPDATE SET can_view=EXCLUDED.can_view,can_create=EXCLUDED.can_create,can_edit=EXCLUDED.can_edit,can_delete=EXCLUDED.can_delete,can_approve=EXCLUDED.can_approve`,[uid,m,!!x.can_view,!!x.can_create,!!x.can_edit,!!x.can_delete,!!x.can_approve]);} await audit(a,'user-permissions','edit',uid,oldPerm,permissions,null,'user #'+uid); return Response.json({success:true});
    }
    // User Master: reset password + save Module Access (Permissions). Must live in POST (was mistakenly inside GET -> fell to genericWrite -> "No valid fields supplied.").
    if(p.startsWith("users/") && p.endsWith("/password")){
      const uid=idOf(path[path.length-2]),body:any=b,np=String(body.new_password||""),cp=String(body.confirm_password||"");
      if(!uid)return Response.json({error:"User id required."},{status:400});
      if(!np||np!==cp)return Response.json({error:"Passwords do not match."},{status:400});
      const crypto=await import("crypto"),salt=crypto.randomBytes(16).toString("hex"),hash=crypto.pbkdf2Sync(np,salt,260000,32,"sha256").toString("hex"),value="pbkdf2:sha256:260000$"+salt+"$"+hash;
      const r=await pool.query('UPDATE "user" SET password_hash=$1 WHERE id=$2 RETURNING id,username',[value,uid]);
      await audit(a,'users/password','edit',uid,{password:'(old)'},{password:'(changed)'},null,r.rows[0]?.username);
      return Response.json({success:r.rowCount>0,user:r.rows[0]||null});
    }
    if(p.startsWith("users/") && p.endsWith("/option-setting")){
      const uid=idOf(path[path.length-2]),body:any=b,modules=Array.isArray(body.modules)?body.modules.map((x:any)=>String(x).trim()).filter(Boolean):[];
      if(!uid)return Response.json({error:"User id required."},{status:400});
      const meta=await pool.query("SELECT data_type FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='user' AND column_name='allowed_modules'");
      const value=String(meta.rows[0]?.data_type||"").toLowerCase()==="array"?modules:modules.join(",");
      const oldM=(await pool.query('SELECT allowed_modules FROM "user" WHERE id=$1',[uid])).rows[0]?.allowed_modules;
      const r=await pool.query('UPDATE "user" SET allowed_modules=$1 WHERE id=$2 RETURNING id,username,allowed_modules',[value,uid]);
      await audit(a,'users/module-access','edit',uid,{allowed_modules:oldM??null},{allowed_modules:r.rows[0]?.allowed_modules??null},null,r.rows[0]?.username);
      return Response.json({success:r.rowCount>0,user:r.rows[0]||null});
    }
    if(p==="bank-ledger/import"){
      await ensureBankLedgerSchema();
      const rows=Array.isArray(b.rows)?b.rows:[]; if(!rows.length)return Response.json({error:"No rows supplied."},{status:400});
      // Bank name must match Bank Details master (typos would otherwise create phantom ledgers).
      const bm=await pool.query("SELECT name FROM simple_master WHERE lower(kind)='bank'").catch(()=>({rows:[]}));
      const masters:string[]=bm.rows.map((x:any)=>String(x.name||"").trim()).filter(Boolean);
      const matchBank=(v:string)=>{if(!masters.length)return v; const n=normKey(v); if(!n)return ""; const ex=masters.find(m=>normKey(m)===n); if(ex)return ex; const part=masters.filter(m=>normKey(m).includes(n)||n.includes(normKey(m))); return part.length===1?part[0]:"";};
      const client=await pool.connect(); let inserted=0,duplicates=0; const rejected:any[]=[]; const seen=new Map<string,number>();
      try{
        await client.query("BEGIN");
        for(let i=0;i<rows.length;i++){
          const g=rowGetter(rows[i]),rowNo=i+2;
          const rawDate=g(["date","entry date","txn date","transaction date","value date"]),date=rawDate===""?todayDate():importDate(rawDate);
          const amount=importAmount(g(["amount","amt"]));
          const bankRaw=String(g(["bank name","bank"])||"").trim(),cheque=String(g(["cheque no","cheque number","chq no","cheque no./upi"])||"").trim();
          const upi=String(g(["upi","upi ref","upi ref no","utr","utr no","reference no"])||"").trim(),narration=String(g(["narration","description","remarks","particulars"])||"").trim();
          if(!bankRaw&&!amount&&!narration)continue;
          if(!date){rejected.push({row:rowNo,reason:"Invalid date: "+rawDate});continue;}
          if(!amount){rejected.push({row:rowNo,reason:"Amount missing/zero"});continue;}
          if(!bankRaw){rejected.push({row:rowNo,reason:"Bank name missing"});continue;}
          const bank=matchBank(bankRaw); if(!bank){rejected.push({row:rowNo,reason:"Bank not in Bank Details master: "+bankRaw});continue;}
          // Duplicate = same key already stored at least as many times as it appears so far in this file
          // (two genuinely identical UPI payments in one file are both kept; re-importing the same file adds nothing).
          const key=[date,amount,normKey(bank),normKey(cheque),normKey(upi),normKey(narration)].join("|"),occ=(seen.get(key)||0)+1; seen.set(key,occ);
          const ex=await client.query(`SELECT COUNT(*)::int c FROM bank_ledger_entry WHERE entry_date=$1::date AND amount=$2 AND lower(btrim(bank_name))=lower(btrim($3)) AND COALESCE(lower(btrim(cheque_no)),'')=lower(btrim($4)) AND COALESCE(lower(btrim(upi_ref)),'')=lower(btrim($5)) AND COALESCE(lower(btrim(narration)),'')=lower(btrim($6))`,[date,amount,bank,cheque,upi,narration]);
          if(Number(ex.rows[0].c)>=occ){duplicates++;continue;}
          await client.query(`INSERT INTO bank_ledger_entry(entry_date,amount,bank_name,cheque_no,upi_ref,narration,entry_type,status,source,created_by) VALUES($1::date,$2,$3,$4,$5,$6,'SUSPENSE','SUSPENSE','EXCEL',$7)`,[date,amount,bank,cheque||null,upi||null,narration,String(a?.username||"")]);
          inserted++;
        }
        await client.query("COMMIT");
      }catch(e){await client.query("ROLLBACK").catch(()=>{});throw e;}finally{client.release();}
      await audit(a,"bank-ledger","create",null,null,{import:true,inserted,duplicates,rejected:rejected.length},null,"Bank Excel import");
      return Response.json({success:true,inserted,duplicates,rejected:rejected.slice(0,100),rejected_count:rejected.length});
    }
    if(p==="hypothecation-receipts"){
      await ensureHypReceiptSchema();
      const rawDate=b.receipt_date||b.date,date=rawDate?importDate(rawDate):todayDate();
      if(!date)return Response.json({error:"Receipt date galat hai (dd-mm-yyyy)."},{status:400});
      const financer=String(b.financer_name||"").trim(),cheque=String(b.cheque_no||"").trim(),amount=importAmount(b.amount);
      if(!financer)return Response.json({error:"Financer name required."},{status:400});
      if(!(amount>0))return Response.json({error:"Amount 0 se zyada hona chahiye."},{status:400});
      const isBank=String(b.pay_mode||"").toLowerCase()==="bank",bankName=String(b.bank_name||"").trim();
      if(isBank&&!bankName)return Response.json({error:"Bank ka naam chuno."},{status:400});
      if(!cheque&&isBank)return Response.json({error:"Bank receipt me Cheque No. / Ref No. required hai."},{status:400});
      if(!cheque)return Response.json({error:"Cheque No. / Ref No. required."},{status:400});
      if(!hypNormChassis(b.chassis_no)&&!hypNormVeh(b.vehicle_no))return Response.json({error:"Chassis No. ya Vehicle No. daalo."},{status:400});
      const inv:any=(await hypFindInvoices(b.chassis_no,b.vehicle_no))[0];
      if(!inv)return Response.json({error:"Is Chassis / Vehicle No. ka koi bill nahi mila."},{status:400});
      if(!inv.has_loan)return Response.json({error:"Bill "+(inv.bill_no||"")+" par loan (hypothecation) nahi hai."},{status:400});
      const dup=await pool.query("SELECT id FROM hypothecation_receipt WHERE tax_invoice_id=$1 AND lower(btrim(cheque_no))=lower($2) AND amount=$3 LIMIT 1",[inv.id,cheque,amount]);
      if(dup.rowCount)return Response.json({error:"Ye receipt (same cheque/ref, amount, chassis) pehle se entered hai."},{status:409});
      const warnings:string[]=[],typedVeh=hypNormVeh(b.vehicle_no);
      let vehicleNo=String(inv.vehicle_no||"");
      if(!vehicleNo&&typedVeh){await pool.query("UPDATE tax_invoice SET vehicle_reg_no=$1 WHERE id=$2",[typedVeh,inv.id]);vehicleNo=typedVeh;}
      else if(vehicleNo&&typedVeh&&hypNormVeh(vehicleNo)!==typedVeh)warnings.push("Bill par vehicle no. "+vehicleNo+" hai, wahi rakha gaya (aapka "+typedVeh+" ignore hua).");
      if(inv.financer_name&&hypNormName(inv.financer_name)!==hypNormName(financer))warnings.push("Bill me financer '"+inv.financer_name+"' hai, receipt '"+financer+"' ke naam se bani.");
      if(inv.fin_received+amount>inv.hypothecation_amount+0.005)warnings.push("Total receipt loan amount se zyada ho gayi (Loan "+inv.hypothecation_amount+", ab tak+ye "+(inv.fin_received+amount)+").");
      const narr="Financer receipt - "+financer+" | Bill "+(inv.bill_no||"-")+" | Chassis "+(inv.chassis_no||"-")+" | Ref "+cheque;
      if(isBank)await ensureBankLedgerSchema();
      const client=await pool.connect();
      let rrow:any;
      try{
        await client.query("BEGIN");
        let dayBookId:any=null,bankLedgerId:any=null;
        if(isBank){
          const bl=await client.query("INSERT INTO bank_ledger_entry(entry_date,amount,bank_name,cheque_no,narration,party_name,entry_type,status,source,created_by) VALUES($1::date,$2,$3,$4,$5,$6,'RECEIPT','POSTED','HYP_RECEIPT',$7) RETURNING id",[date,amount,bankName,cheque,narr,financer,String(a?.username||"")]);
          bankLedgerId=bl.rows[0].id;
        }else{
          const dbc=await columns("day_book");
          if(!dbc.size)throw new Error("Day Book table nahi mili.");
          const vt=(await client.query("SELECT data_type FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='day_book' AND column_name='vr_no'")).rows[0]?.data_type||"";
          let vrNo:any=null;
          if(["integer","bigint","smallint","numeric"].includes(vt))vrNo=Number((await client.query("SELECT COALESCE(MAX(vr_no),0)+1 AS n FROM day_book")).rows[0]?.n||1);
          else if(vt)vrNo="HR-"+Date.now();
          const entry:any={date,vr_no:vrNo,dealer_name:financer,party_name:financer,credit_received:amount,debit_paid:0,payment_mode:"cash",mode:"cash",narration:narr,remarks:narr};
          const keys=Object.keys(entry).filter(k=>dbc.has(k)&&!(k==="vr_no"&&vrNo==null));
          const ins=await client.query('INSERT INTO day_book ('+keys.map(k=>'"'+k+'"').join(",")+') VALUES ('+keys.map((_,i)=>"$"+(i+1)).join(",")+') RETURNING id',keys.map(k=>entry[k]));
          dayBookId=ins.rows[0]?.id||null;
        }
        const r=await client.query("INSERT INTO hypothecation_receipt(receipt_date,financer_name,amount,cheque_no,tax_invoice_id,chassis_no,vehicle_no,bill_no,buyer_name,remarks,created_by,pay_mode,bank_name,day_book_id,bank_ledger_id) VALUES($1::date,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id,to_char(receipt_date,'YYYY-MM-DD') AS receipt_date,financer_name,amount,cheque_no,tax_invoice_id,chassis_no,vehicle_no,bill_no,buyer_name,pay_mode,bank_name",[date,financer,amount,cheque,inv.id,inv.chassis_no||null,vehicleNo||null,inv.bill_no||null,inv.buyer_name||null,String(b.remarks||"").trim()||null,String(a?.username||""),isBank?"BANK":"CASH",isBank?bankName:null,dayBookId,bankLedgerId]);
        rrow=r.rows[0];
        if(bankLedgerId)await client.query("UPDATE bank_ledger_entry SET source_ref=$1 WHERE id=$2",["HYP-"+rrow.id,bankLedgerId]);
        await client.query("COMMIT");
      }catch(e){await client.query("ROLLBACK").catch(()=>{});throw e;}finally{client.release();}
      await audit(a,"hypothecation-receipts","create",rrow.id,null,rrow,null,inv.chassis_no||inv.bill_no||cheque);
      return Response.json({success:true,row:rrow,warnings});
    }
    if(p==="bank-ledger/update"){
      await ensureBankLedgerSchema(); const id=idOf(b.id); if(!id)return Response.json({error:"Entry id required."},{status:400});
      const old=(await pool.query("SELECT * FROM bank_ledger_entry WHERE id=$1",[id])).rows[0]; if(!old)return Response.json({error:"Entry not found."},{status:404});
      const want=String(b.status||"POSTED").toUpperCase(),status=want==="CANCELLED"?"CANCELLED":want==="SUSPENSE"?"SUSPENSE":"POSTED";
      const party=String(b.party_name||"").trim();
      // Posting needs the manual "kis se aaya / kise diya" + direction; without it the entry must stay in Suspense.
      if(status==="POSTED"&&!party)return Response.json({error:"Party (kis se aaya / kise diya) required to post."},{status:400});
      const type=status==="SUSPENSE"?"SUSPENSE":String(b.entry_type||"").toUpperCase()==="PAYMENT"?"PAYMENT":String(b.entry_type||"").toUpperCase()==="RECEIPT"?"RECEIPT":(status==="POSTED"?"":"SUSPENSE");
      if(status==="POSTED"&&!type)return Response.json({error:"Select Receipt or Payment."},{status:400});
      const r=await pool.query(`UPDATE bank_ledger_entry SET party_name=$1,narration=$2,entry_type=$3,status=$4,updated_at=now() WHERE id=$5 RETURNING *`,[party,String(b.narration??old.narration??"").trim(),type||old.entry_type,status,id]);
      await audit(a,"bank-ledger","approve",id,old,r.rows[0],null,old.cheque_no||old.upi_ref||old.bank_name);
      return Response.json({success:true,row:r.rows[0]});
    }

    if(p==="rto-register"){
      await ensureRtoRegisterSchema();
      const v=await rtoValidate(b,null); if(v.error)return Response.json({error:v.error},{status:v.status||400}); const f=v.f!;
      const r=await pool.query(`INSERT INTO rto_expense_register (rto_type,date,customer_name,amount,work_type,rto_agent,chassis_no,bill_no,sp_no,vehicle,dealer_id,remarks,created_by) VALUES($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [f.type,f.date,f.customer,f.amount,f.work||null,f.agent,f.chassis||null,f.bill||null,f.sp||null,f.vehicle||null,idOf(b.dealer_id),b.remarks||null,String(a?.username||"")]);
      await audit(a,"rto-register","create",r.rows[0].id,null,r.rows[0],r.rows[0].dealer_id,r.rows[0].chassis_no||r.rows[0].sp_no);
      return Response.json({success:true,row:r.rows[0]});
    }
    if(p==="rto-register/import"){
      await ensureRtoRegisterSchema();
      const type=String(b.rto_type||"NEW").toUpperCase(),rows=Array.isArray(b.rows)?b.rows:[];
      if(!["NEW","OLD"].includes(type))return Response.json({error:"rto_type must be NEW or OLD."},{status:400});
      if(!rows.length)return Response.json({error:"No rows supplied."},{status:400});
      const client=await pool.connect(); let inserted=0,mapped=0,duplicates=0; const rejected:any[]=[]; const seenKeys=new Set<string>();
      try{
        await client.query("BEGIN");
        for(let i=0;i<rows.length;i++){
          const g=rowGetter(rows[i]),rowNo=i+2,rawDate=g(["date"]);
          const body:any={rto_type:type,date:rawDate===""?todayDate():importDate(rawDate)||"INVALID",customer_name:g(["customer name","customer","name"]),amount:importAmount(g(["amount","rto expense","rto amount","expense"])),
            work_type:g(["work type","work","particulars","description"]),rto_agent:g(["rto agent","agent","rto passing person","passing person","paid to","party"]),
            chassis_no:g(["chassis no","chassis","chassis number"]),bill_no:g(["bill no","bill","invoice no"]),sp_no:g(["sp no","sp","sp number"]),vehicle:g(["vehicle","vehicle no","vehicle reg no","registration no"]),remarks:g(["remarks"])};
          if(!body.customer_name&&!body.rto_agent&&!body.amount&&!body.chassis_no&&!body.sp_no)continue;
          const v=await rtoValidate(body,null,client,seenKeys,true); if(v.error){if(v.status===409)duplicates++;else rejected.push({row:rowNo,reason:v.error});continue;}
          const f=v.f!;
          await client.query(`INSERT INTO rto_expense_register (rto_type,date,customer_name,amount,work_type,rto_agent,chassis_no,bill_no,sp_no,vehicle,remarks,created_by) VALUES($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[f.type,f.date,f.customer,f.amount,f.work||null,f.agent,f.chassis||null,f.bill||null,f.sp||null,f.vehicle||null,body.remarks||null,String(a?.username||"")]);
          if(type==="NEW"){const mr=await client.query(`SELECT 1 FROM tax_invoice WHERE COALESCE(cancelled,false)=false AND lower(btrim(COALESCE(chassis_no,'')))=lower(btrim($1)) LIMIT 1`,[f.chassis]).catch(()=>({rows:[]}));if(mr.rows.length)mapped++;}
          inserted++;
        }
        await client.query("COMMIT");
      }catch(e){await client.query("ROLLBACK").catch(()=>{});throw e;}finally{client.release();}
      await audit(a,"rto-register","create",null,null,{import:true,type,inserted,duplicates,rejected:rejected.length},null,"RTO import "+type);
      return Response.json({success:true,inserted,mapped,duplicates,rejected:rejected.slice(0,100),rejected_count:rejected.length});
    }
    if(p==="insurance-register"){
      await ensureInsuranceRegisterSchema();
      const v=await insuranceValidate(b,null); if(v.error)return Response.json({error:v.error},{status:v.status||400});
      const f=v.f!;
      const r=await pool.query(`INSERT INTO insurance_register
        (insurance_type,date,customer_name,total_premium,net_premium,discount_rate,payable_amount,insurer,chassis_no,bill_no,sp_no,vehicle,dealer_id,remarks,created_by)
        VALUES($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
        [f.type,f.date,f.customer,f.total,f.net,f.disc,f.payable,f.insurer,f.chassis||null,f.bill||null,f.sp||null,f.vehicle||null,idOf(b.dealer_id),b.remarks||null,String(a?.username||"")]);
      await audit(a,"insurance-register","create",r.rows[0].id,null,r.rows[0],r.rows[0].dealer_id,r.rows[0].chassis_no||r.rows[0].sp_no);
      return Response.json({success:true,row:r.rows[0]});
    }
    if(p==="insurance-register/import"){
      await ensureInsuranceRegisterSchema();
      const type=String(b.insurance_type||"NEW").toUpperCase(),rows=Array.isArray(b.rows)?b.rows:[];
      if(!["NEW","OLD"].includes(type))return Response.json({error:"insurance_type must be NEW or OLD."},{status:400});
      if(!rows.length)return Response.json({error:"No rows supplied."},{status:400});
      const client=await pool.connect(); let inserted=0,mapped=0,duplicates=0; const rejected:any[]=[]; const seenKeys=new Set<string>();
      try{
        await client.query("BEGIN");
        for(let i=0;i<rows.length;i++){
          const g=rowGetter(rows[i]),rowNo=i+2;
          const rawDate=g(["date"]);
          const body:any={insurance_type:type,date:rawDate===""?todayDate():importDate(rawDate)||"INVALID",customer_name:g(["customer name","customer","name"]),
            total_premium:importAmount(g(["total premium","premium"])),discount_rate:importAmount(g(["discount rate","discount","discount %"])),
            net_premium:g(["net premium"])===""?"":importAmount(g(["net premium"])),payable_amount:g(["payable amount","payable"])===""?"":importAmount(g(["payable amount","payable"])),
            insurer:g(["insurer","insurance provider","agent"]),chassis_no:g(["chassis no","chassis","chassis number"]),bill_no:g(["bill no","bill","invoice no"]),
            sp_no:g(["sp no","sp","sp number"]),vehicle:g(["vehicle","vehicle no","vehicle reg no","registration no"]),remarks:g(["remarks"])};
          if(!body.customer_name&&!body.insurer&&!body.total_premium&&!body.chassis_no&&!body.sp_no)continue;
          const v=await insuranceValidate(body,null,client,seenKeys,true); if(v.error){if(v.status===409)duplicates++;else rejected.push({row:rowNo,reason:v.error});continue;}
          const f=v.f!;
          await client.query(`INSERT INTO insurance_register (insurance_type,date,customer_name,total_premium,net_premium,discount_rate,payable_amount,insurer,chassis_no,bill_no,sp_no,vehicle,remarks,created_by) VALUES($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,[f.type,f.date,f.customer,f.total,f.net,f.disc,f.payable,f.insurer,f.chassis||null,f.bill||null,f.sp||null,f.vehicle||null,body.remarks||null,String(a?.username||"")]);
          if(type==="NEW"){const mr=await client.query(`SELECT 1 FROM tax_invoice WHERE COALESCE(cancelled,false)=false AND lower(btrim(COALESCE(chassis_no,'')))=lower(btrim($1)) LIMIT 1`,[f.chassis]).catch(()=>({rows:[]}));if(mr.rows.length)mapped++;}
          inserted++;
        }
        await client.query("COMMIT");
      }catch(e){await client.query("ROLLBACK").catch(()=>{});throw e;}finally{client.release();}
      await audit(a,"insurance-register","create",null,null,{import:true,type,inserted,duplicates,rejected:rejected.length},null,"Insurance import "+type);
      return Response.json({success:true,inserted,mapped,duplicates,rejected:rejected.slice(0,100),rejected_count:rejected.length});
    }

    const table=tableFor(path);
    if(table)return genericWrite(req,path,table,"POST",b);
    return Response.json({error:"Node API route not implemented",path:"/api/"+p},{status:404});
  }catch(e:any){console.error("[node-api POST]",e);return Response.json({error:e.message||"Internal server error"},{status:500})}
}
export async function PUT(req:Request,{params}:{params:Promise<{path?:string[]}>}){return mutation(req,params,"PUT")}
export async function PATCH(req:Request,{params}:{params:Promise<{path?:string[]}>}){return mutation(req,params,"PATCH")}
export async function DELETE(req:Request,{params}:{params:Promise<{path?:string[]}>}){return mutation(req,params,"DELETE")}
async function mutation(req:Request,params:any,method:string){

  try{
    const a=auth(req);if(!a)return Response.json({error:"Authentication required."},{status:401});
    await ensureSecuritySchema();
    const {path=[]}=await params,p=path.join("/"),table=tableFor(path);
    if(!(await actionAllowed(a,p,actionFor(method))))return Response.json({error:"Forbidden."},{status:403});
    if(!canWrite(a,p))return Response.json({error:"Forbidden."},{status:403});
    const bodyForScope=(method==="DELETE"?{}:await json(req));
    const scopeGuard=await enforceDealerScope(a,table,idOf(path[path.length-1]),bodyForScope); if(scopeGuard)return scopeGuard;
    if(path[0]==="rto-register"&&path.length===2&&/^\d+$/.test(path[1])){
      await ensureRtoRegisterSchema(); const id=idOf(path[1]);
      const old=(await pool.query("SELECT * FROM rto_expense_register WHERE id=$1",[id])).rows[0]; if(!old)return Response.json({error:"Record not found."},{status:404});
      if(method==="DELETE"){await pool.query("DELETE FROM rto_expense_register WHERE id=$1",[id]);await audit(a,"rto-register","delete",id,old,null,old.dealer_id,old.chassis_no||old.sp_no);return Response.json({success:true});}
      const eb:any={...old,...bodyForScope,rto_type:old.rto_type};
      const v=await rtoValidate(eb,id); if(v.error)return Response.json({error:v.error},{status:v.status||400}); const f=v.f!;
      const r=await pool.query(`UPDATE rto_expense_register SET date=$1::date,customer_name=$2,amount=$3,work_type=$4,rto_agent=$5,chassis_no=$6,bill_no=$7,sp_no=$8,vehicle=$9,remarks=$10,updated_at=now() WHERE id=$11 RETURNING *`,[f.date,f.customer,f.amount,f.work||null,f.agent,f.chassis||null,f.bill||null,f.sp||null,f.vehicle||null,eb.remarks||null,id]);
      await audit(a,"rto-register","edit",id,old,r.rows[0],old.dealer_id,r.rows[0].chassis_no||r.rows[0].sp_no);
      return Response.json({success:true,row:r.rows[0]});
    }
    if(path[0]==="insurance-register"&&path.length===2&&/^\d+$/.test(path[1])){
      await ensureInsuranceRegisterSchema(); const id=idOf(path[1]);
      const old=(await pool.query("SELECT * FROM insurance_register WHERE id=$1",[id])).rows[0]; if(!old)return Response.json({error:"Record not found."},{status:404});
      if(method==="DELETE"){await pool.query("DELETE FROM insurance_register WHERE id=$1",[id]);await audit(a,"insurance-register","delete",id,old,null,old.dealer_id,old.chassis_no||old.sp_no);return Response.json({success:true});}
      const eb:any={...old,...bodyForScope,insurance_type:old.insurance_type};
      const v=await insuranceValidate(eb,id); if(v.error)return Response.json({error:v.error},{status:v.status||400}); const f=v.f!;
      const r=await pool.query(`UPDATE insurance_register SET date=$1::date,customer_name=$2,total_premium=$3,net_premium=$4,discount_rate=$5,payable_amount=$6,insurer=$7,chassis_no=$8,bill_no=$9,sp_no=$10,vehicle=$11,remarks=$12,updated_at=now() WHERE id=$13 RETURNING *`,[f.date,f.customer,f.total,f.net,f.disc,f.payable,f.insurer,f.chassis||null,f.bill||null,f.sp||null,f.vehicle||null,eb.remarks||null,id]);
      await audit(a,"insurance-register","edit",id,old,r.rows[0],old.dealer_id,r.rows[0].chassis_no||r.rows[0].sp_no);
      return Response.json({success:true,row:r.rows[0]});
    }
    if(path[0]==="chassis-master"){const cm=await chassisMasterWrite(path,method,await json(req));if(cm)return cm;}
    if(path[0]==="hypothecation-receipts"){
      if(method!=="DELETE"||path.length!==2)return Response.json({error:"Sirf receipt delete supported hai."},{status:405});
      await ensureHypReceiptSchema(); const id=idOf(path[1]);
      if(!id)return Response.json({error:"Receipt id required."},{status:400});
      const old=(await pool.query("SELECT * FROM hypothecation_receipt WHERE id=$1",[id])).rows[0]; if(!old)return Response.json({error:"Receipt not found."},{status:404});
      const dc=await pool.connect();
      try{
        await dc.query("BEGIN");
        if(old.day_book_id)await dc.query("DELETE FROM day_book WHERE id=$1",[old.day_book_id]);
        if(old.bank_ledger_id)await dc.query("DELETE FROM bank_ledger_entry WHERE id=$1 AND source='HYP_RECEIPT'",[old.bank_ledger_id]);
        await dc.query("DELETE FROM hypothecation_receipt WHERE id=$1",[id]);
        await dc.query("COMMIT");
      }catch(e){await dc.query("ROLLBACK").catch(()=>{});throw e;}finally{dc.release();}
      await audit(a,"hypothecation-receipts","delete",id,old,null,null,old.chassis_no||old.cheque_no);
      return Response.json({success:true});
    }
    if(path[0]==="vehicle-no-register"&&(method==="PUT"||method==="PATCH")){
      const id=idOf(path[1]);if(!id)return Response.json({error:"Invoice id required."},{status:400});
      const b:any=await json(req);
      const reg=String(b.vehicle_reg_no??"").toUpperCase().replace(/[\s-]+/g,"");
      await ensureTaxInvoiceVehicleNoColumn();
      const r=await pool.query("UPDATE tax_invoice SET vehicle_reg_no=$1 WHERE id=$2 RETURNING id,vehicle_reg_no",[reg||null,id]);
      if(!r.rowCount)return Response.json({error:"Tax Invoice not found."},{status:404});
      return Response.json({success:true,row:{id:r.rows[0].id,vehicle_reg_no:r.rows[0].vehicle_reg_no||""}});
    }

    // Production Formula: poora formula (ek product + formula name ki saari lines) delete.
    if(method==="DELETE" && p==="production-formulas/by-product"){
      await ensureProductionFormulaSchema();
      const u=new URL(req.url),product=String(u.searchParams.get("product_name")||"").trim(),formula=String(u.searchParams.get("formula_name")||"").trim();
      if(!product)return Response.json({error:"Product zaroori hai."},{status:400});
      const r=await pool.query("DELETE FROM production_formula WHERE "+NORM("product_name")+"="+NORM("$1")+" AND "+NORM("formula_name")+"="+NORM("$2"),[product,formula]);
      return Response.json({success:r.rowCount>0,deleted:r.rowCount});
    }

    if(/^delivery-challans\/\d+$/.test(p) && (method==="PUT" || method==="PATCH")){
      const id=idOf(path[path.length-1]);if(!id)return Response.json({error:"Delivery Challan id required."},{status:400});
      const body:any=await json(req);
      const current=await pool.query("SELECT * FROM delivery_challan WHERE id=$1 FOR UPDATE",[id]);
      if(!current.rowCount)return Response.json({error:"Delivery Challan not found."},{status:404});
      const old=current.rows[0];
      if(Object.prototype.hasOwnProperty.call(body,"dealer_id") || Object.prototype.hasOwnProperty.call(body,"dealer_name")){
        const incomingId=idOf(body.dealer_id);
        if(incomingId && incomingId!==Number(old.dealer_id||0))return Response.json({error:"Dealer change ke liye Factory → Challan Shift module use karein."},{status:409});
      }
      for(const k of ["battery_maker","battery_no1","battery_no2","battery_no3","battery_no4"]){
        if(Object.prototype.hasOwnProperty.call(body,k) && String(body[k]??"").trim()!==String(old[k]??"").trim())
          return Response.json({error:"Battery change Delivery Challan Edit se allowed nahi hai. Battery module se Withdrawal / Swap / Fit use karein."},{status:409});
      }
      delete body.dealer_id; delete body.dealer_name;
      delete body.battery_maker; delete body.battery_no1; delete body.battery_no2; delete body.battery_no3; delete body.battery_no4;
      return genericWrite(req,path,"delivery_challan",method,body);
    }
    if(p.startsWith("billing/pending-sales/") && (method==="PUT" || method==="PATCH" || method==="DELETE")){
      await ensureBillingSalesSchema();
      if(!billingStaff(a))return Response.json({error:"Billing approval rights required."},{status:403});
      const id=idOf(path[path.length-1]);if(!id)return Response.json({error:"Sale id is required."},{status:400});
      const cur=await pool.query("SELECT * FROM grd_billing_sale WHERE id=$1",[id]);
      if(!cur.rowCount)return Response.json({error:"Sale not found."},{status:404});
      const s=cur.rows[0];
      if(method==="DELETE"){
        // Approved / Billed sales can never be deleted.
        if(s.status!=="PENDING")return Response.json({error:"Approved / Billed sale delete nahi ho sakti."},{status:409});
        const r=await pool.query("DELETE FROM grd_billing_sale WHERE id=$1 AND status='PENDING' RETURNING id",[id]);
        if(!r.rowCount)return Response.json({error:"Approved / Billed sale delete nahi ho sakti."},{status:409});
        return Response.json({success:true});
      }
      if(s.status==="BILLED")return Response.json({error:"Billed sale edit nahi ho sakti."},{status:409});
      const b:any=await json(req);
      const txt=(k:string,...alts:string[])=>{for(const x of [k,...alts])if(b[x]!==undefined)return String(b[x]??"").trim()||null;return undefined};
      const numv=(...ks:string[])=>{for(const x of ks)if(b[x]!==undefined)return num(b[x]);return undefined};
      const patch:any={
        customer_name:txt("customer_name","buyer_name"),customer_phone:txt("customer_phone","buyer_mobile"),customer_address:txt("customer_address","buyer_address"),
        customer_state:txt("customer_state","buyer_state"),page_no:txt("page_no","dealer_page_no"),do_no:txt("do_no"),internal_sale_details:txt("internal_sale_details"),
        description:txt("description"),buyer_relation:txt("buyer_relation"),buyer_father_name:txt("buyer_father_name"),buyer_gst_no:txt("buyer_gst_no"),buyer_pan:txt("buyer_pan"),
        buyer_aadhar:txt("buyer_aadhar"),buyer_dob:txt("buyer_dob"),buyer_state_code:txt("buyer_state_code"),state_type:txt("state_type"),mode_term:txt("mode_term"),
        bank_name:txt("bank_name"),bank_account_no:txt("bank_account_no"),bank_ifsc:txt("bank_ifsc"),rto_name:txt("rto_name"),despatch_through:txt("despatch_through"),
        eway_bill_no:txt("eway_bill_no"),license_no:txt("license_no"),cvr_no:txt("cvr_no"),cancelled_cheque_no:txt("cancelled_cheque_no"),remarks:txt("remarks"),
        financer_name:txt("financer_name"),vehicle_reg_no:txt("vehicle_reg_no"),ledger_no:txt("ledger_no"),chassis_record_no:txt("chassis_record_no"),voucher_no:txt("voucher_no"),
        amount_received:numv("amount_received"),subsidy_amount:numv("subsidy_amount"),gst_sale_amount:numv("gst_sale_amount"),gst_rate:numv("gst_rate"),
        insurance_amount:numv("insurance_amount"),registration_amount:numv("registration_amount"),discount:numv("discount")
      };
      // Internal Sale Amount + Loan Amount: editable only while PENDING, frozen once APPROVED.
      if(s.status==="PENDING"){
        patch.sale_amount=numv("sale_amount");
        patch.hypothecation_amount=numv("hypothecation_amount","loan_amount");
        const sa=patch.sale_amount??num(s.sale_amount),la=patch.hypothecation_amount??num(s.hypothecation_amount);
        if(sa>0&&la>sa)return Response.json({error:"Loan Amount cannot be greater than Sale Amount."},{status:400});
        if(patch.customer_name===null)return Response.json({error:"Customer Name required hai."},{status:400});
      }
      const cols=await columns("grd_billing_sale"),keys=Object.keys(patch).filter(k=>patch[k]!==undefined&&cols.has(k));
      if(!keys.length)return Response.json({error:"No changes supplied."},{status:400});
      const r=await pool.query('UPDATE grd_billing_sale SET '+keys.map((k,i)=>'"'+k+'"=$'+(i+1)).join(",")+',updated_at=NOW() WHERE id=$'+(keys.length+1)+' AND status IN (\'PENDING\',\'APPROVED\') RETURNING *',[...keys.map(k=>patch[k]),id]);
      if(!r.rowCount)return Response.json({error:"Sale could not be updated."},{status:409});
      return Response.json({success:true,sale:r.rows[0]});
    }
    if(p.startsWith("purchase-bills/") && (method==="PUT" || method==="PATCH" || method==="DELETE")){
      const id=idOf(path[path.length-1]);if(!id)return Response.json({error:"Purchase Bill id required."},{status:400});
      if(method!=="DELETE")await ensurePurchaseExtraSchema();
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        const old=await client.query('SELECT * FROM "purchase_bill" WHERE id=$1 FOR UPDATE',[id]);
        if(!old.rowCount)throw new Error("Purchase Bill not found.");
        if(method==="DELETE"){
          await ensureBatteryRegisterSchema();
          await client.query("DELETE FROM battery_register_entry WHERE source_type='PURCHASE' AND source_id=$1",[id]);
          await syncRawPurchaseStock(client,{id},true);
          const r=await client.query('DELETE FROM "purchase_bill" WHERE id=$1 RETURNING *',[id]);
          await client.query("COMMIT");return Response.json({success:true,row:r.rows[0]||null});
        }
        const body:any=await json(req),cols=await columns("purchase_bill"),input:any={};
        for(const [k,v] of Object.entries(body||{})){const col=snake(k);if(cols.has(col)&&col!=="id")input[col]=v;}
        if(Array.isArray(input.items))input.items=JSON.stringify(input.items);
        if(Array.isArray(input.extra_charges))input.extra_charges=JSON.stringify(parseExtraCharges(input.extra_charges));
        const keys=Object.keys(input);if(!keys.length)return Response.json({error:"No changes supplied."},{status:400});
        const sets=keys.map((k,i)=>'"'+k+'"=$'+(i+1));
        const r=await client.query('UPDATE "purchase_bill" SET '+sets.join(",")+' WHERE id=$'+(keys.length+1)+' RETURNING *',[...keys.map(k=>input[k]),id]);
        const row={...r.rows[0],items:parseItems(r.rows[0].items)};
        await syncBatteryPurchaseBill(client,row);
        await syncRawPurchaseStock(client,row);
        await client.query("COMMIT");return Response.json({success:true,row,data:row});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    if(p.startsWith("tax-invoices/") && p.endsWith("/payment") && method==="POST"){
      const id=idOf(path[path.length-2]),b:any=await json(req);
      if(!id)return Response.json({error:"Invoice id required."},{status:400});
      const r=await pool.query("UPDATE tax_invoice SET amount_received=COALESCE(amount_received,0)+$1 WHERE id=$2 RETURNING *",[num(b.amount),id]);
      return Response.json({success:r.rowCount>0,row:r.rows[0]||null});
    }
    if(p.startsWith("delivery-challans/") && p.endsWith("/print") && method==="POST"){
      const id=idOf(path[path.length-2]); const r=await pool.query("SELECT * FROM delivery_challan WHERE id=$1",[id]);
      return Response.json({success:true,data:r.rows[0]||null});
    }
    if(p.startsWith("tax-invoices/") && p.endsWith("/print") && method==="POST"){
      const id=idOf(path[path.length-2]); const r=await pool.query("SELECT ti.*,"+TI_CALC+" FROM tax_invoice ti WHERE ti.id=$1",[id]);
      return Response.json({success:true,data:r.rows[0]||null});
    }
    if(p.startsWith("dealer/cash-book/receipts/") && method==="PUT" && a.scope==="dealer"){
      const id=idOf(path[path.length-1]),b:any=await json(req);
      if(!id)return Response.json({error:"Receipt id required."},{status:400});
      const rr=await pool.query("SELECT id,customer_id FROM dealer_cash_receipt WHERE id=$1 AND dealer_id=$2 LIMIT 1",[id,num(a.dealer_id)]);
      if(!rr.rowCount)return Response.json({error:"Receipt not found."},{status:404});
      const page=String(b.dealer_register_page_no||"").trim()||null,loan=num(b.loan_amount);
      const client=await pool.connect();
      try{await client.query("BEGIN");await client.query("UPDATE dealer_cash_receipt SET dealer_register_page_no=$1 WHERE id=$2",[page,id]);if(rr.rows[0].customer_id)await client.query("UPDATE dealer_cash_customer SET page_no=$1,loan_amount=$2 WHERE id=$3 AND dealer_id=$4",[page,loan,num(rr.rows[0].customer_id),num(a.dealer_id)]);await client.query("COMMIT");return Response.json({success:true});}
      catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    if(p.startsWith("dealer/cash-book/customers/") && method==="PUT" && a.scope==="dealer"){
      const id=idOf(path[path.length-1]),b:any=await json(req); if(!id)return Response.json({error:"Customer id required."},{status:400});
      const r=await pool.query("UPDATE dealer_cash_customer SET page_no=$1 WHERE id=$2 AND dealer_id=$3 RETURNING *",[String(b.page_no||"").trim()||null,id,num(a.dealer_id)]);
      if(!r.rowCount)return Response.json({error:"Customer not found."},{status:404}); return Response.json({success:true,customer:r.rows[0]});
    }
    if(p.startsWith("dealer/pending-sales/") && p.endsWith("/page") && method==="PUT" && a.scope==="dealer"){
      const id=idOf(path[path.length-2]),b:any=await json(req); if(!id)return Response.json({error:"Application id required."},{status:400});
      const r=await pool.query("SELECT customer_id FROM loan_workflow WHERE id=$1 AND dealer_id=$2 LIMIT 1",[id,num(a.dealer_id)]);
      if(!r.rowCount)return Response.json({error:"Pending sale not found."},{status:404});
      if(!r.rows[0].customer_id)return Response.json({error:"No linked customer record."},{status:400});
      const u=await pool.query("UPDATE dealer_cash_customer SET page_no=$1 WHERE id=$2 AND dealer_id=$3 RETURNING page_no",[String(b.page_no||"").trim()||null,num(r.rows[0].customer_id),num(a.dealer_id)]);
      return Response.json({success:true,page_no:u.rows[0]?.page_no||null});
    }
    if(p.startsWith("credit-notes/") && p.endsWith("/cancel-challan") && method==="POST"){
      await ensureCreditDebitSchema();await ensureDispatchSchema();await ensureBatteryRegisterSchema();
      const id=idOf(path[path.length-2]);if(!id)return Response.json({error:"Credit Note id required."},{status:400});
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        const cn=await client.query("SELECT * FROM credit_note WHERE id=$1 FOR UPDATE",[id]);if(!cn.rowCount)throw new Error("Credit Note not found.");
        const dcId=idOf(cn.rows[0].delivery_challan_id);if(!dcId)throw new Error("No Delivery Challan is linked to this Credit Note.");
        const dc=await client.query("SELECT dc.*,d.name AS dealer_name FROM delivery_challan dc LEFT JOIN dealer d ON d.id=dc.dealer_id WHERE dc.id=$1 FOR UPDATE",[dcId]);if(!dc.rowCount)throw new Error("Linked Delivery Challan not found.");
        if(!dc.rows[0].cancelled){
          const items=await client.query("SELECT * FROM delivery_challan_item WHERE delivery_challan_id=$1 ORDER BY id",[dcId]);
          for(const item of items.rows){const qty=Math.max(0,Number(item.qty)||0);if(qty)await client.query("INSERT INTO journal_stock (vou_no,date,item_name,item_type,qty,reason,created_at,work_type,batch_ref) VALUES ($1,COALESCE($2::date,CURRENT_DATE),$3,'DISPATCH',$4,'Credit Note Challan Reversal',NOW(),'IN',$1)",[String(dc.rows[0].challan_no||("DC-"+dcId)),dc.rows[0].date,item.product_name,qty]);}
          await client.query("UPDATE delivery_challan SET cancelled=true WHERE id=$1",[dcId]);
          await toggleBatteryRegisterForDelivery(client,dc.rows[0],true);
          if(dc.rows[0].vehicle_id)await client.query("UPDATE vehicle SET stage='Manufacturing' WHERE id=$1",[dc.rows[0].vehicle_id]);
        }
        await client.query("COMMIT");return Response.json({success:true,message:"Credit Note linked Delivery Challan cancelled and stock reversed."});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    if(p.startsWith("delivery-challans/") && p.endsWith("/cancel") && method==="POST"){
      const id=idOf(path[path.length-2]);if(!id)return Response.json({error:"Record id required."},{status:400});
      await ensureDispatchSchema();await ensureBatteryRegisterSchema();const client=await pool.connect();
      try{
        await client.query("BEGIN");
        const dc=await client.query("SELECT dc.*,d.name AS dealer_name FROM delivery_challan dc LEFT JOIN dealer d ON d.id=dc.dealer_id WHERE dc.id=$1 FOR UPDATE",[id]);
        if(!dc.rowCount)throw new Error("Delivery Challan not found.");
        const row=dc.rows[0],nextCancelled=!Boolean(row.cancelled);
        const items=await client.query("SELECT * FROM delivery_challan_item WHERE delivery_challan_id=$1 ORDER BY id",[id]);
        for(const item of items.rows){
          const qty=Math.max(0,Number(item.qty)||0);if(!qty)continue;
          const reason=nextCancelled?"Delivery Challan Cancel Reversal":"Delivery Challan Consumption",workType=nextCancelled?"IN":"OUT";
          if(!nextCancelled){
            const stock=await client.query("SELECT COALESCE(SUM(CASE WHEN UPPER(COALESCE(work_type,''))='IN' THEN qty ELSE -qty END),0) AS qty FROM journal_stock WHERE lower(trim(item_name))=lower(trim($1))",[item.product_name]);
            if(Number(stock.rows[0]?.qty||0)<qty)throw new Error("Insufficient stock for "+item.product_name+". Available: "+Number(stock.rows[0]?.qty||0));
          }
          await client.query("INSERT INTO journal_stock (vou_no,date,item_name,item_type,qty,reason,created_at,work_type,batch_ref) VALUES ($1,COALESCE($2::date,CURRENT_DATE),$3,'DISPATCH',$4,$5,NOW(),$6,$1)",[String(row.challan_no||("DC-"+id)),row.date||null,item.product_name,qty,reason,workType]);
        }
        await client.query("UPDATE delivery_challan SET cancelled=$1 WHERE id=$2",[nextCancelled,id]);
        await toggleBatteryRegisterForDelivery(client,row,nextCancelled);
        if(row.vehicle_id)await client.query("UPDATE vehicle SET stage=$1 WHERE id=$2",[nextCancelled?"Manufacturing":"Delivery Challan",row.vehicle_id]);
        await client.query("COMMIT");return Response.json({success:true,row:{...row,cancelled:nextCancelled}});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    if(p.startsWith("admin/nav-tabs/")){
      const id=idOf(path[path.length-1]);
      if(path[path.length-1]==="reorder" && method==="PUT"){
        const b:any=await json(req),order=Array.isArray(b.order)?b.order.map((x:any)=>Number(x)).filter((x:number)=>x>0):[];
        for(let i=0;i<order.length;i++)await pool.query("UPDATE nav_tab SET position=$1 WHERE id=$2",[i+1,order[i]]);
        return Response.json({success:true});
      }
      if(!id)return Response.json({error:"Tab id required."},{status:400});
      if(method==="DELETE"){
        const r=await pool.query("DELETE FROM nav_tab WHERE id=$1 RETURNING *",[id]);
        return Response.json({success:r.rowCount>0,row:r.rows[0]||null});
      }
      const b:any=await json(req),fields:any={};
      for(const k of ["label","icon","hidden","items"]){if(Object.prototype.hasOwnProperty.call(b,k))fields[k]=k==="items"?(Array.isArray(b[k])?b[k]:[]):b[k];}
      const keys=Object.keys(fields);if(!keys.length)return Response.json({error:"No changes supplied."},{status:400});
      const sets=keys.map((k,i)=>'"'+k+'"=$'+(i+1));
      const r=await pool.query('UPDATE nav_tab SET '+sets.join(",")+' WHERE id=$'+(keys.length+1)+' RETURNING *',[...keys.map(k=>fields[k]),id]);
      return Response.json(r.rows[0]||null);
    }
    if(p.startsWith("inventory/old-rickshaw/") && path[path.length-1]==="available" && method==="POST"){
      await ensureOldRickshawInventorySchema();
      const inventoryId=idOf(path[path.length-2]);if(!inventoryId)return Response.json({error:"Inventory id required."},{status:400});
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        const inv=await client.query("SELECT * FROM old_rickshaw_inventory WHERE id=$1 FOR UPDATE",[inventoryId]);
        if(!inv.rowCount)throw new Error("Old Rickshaw inventory record not found.");
        const row=inv.rows[0];
        if(row.status==="sold")throw new Error("Sold vehicle cannot be released again.");
        if(row.status!=="available"){
          const sp=row.sp_no||("SP-"+String(row.id).padStart(6,"0"));
          const challan=row.challan_no||("ORC-"+new Date().toISOString().slice(0,10).replace(/-/g,"")+"-"+String(row.id).padStart(4,"0"));
          const cdate=new Date().toISOString().slice(0,10);
          const existing=await client.query("SELECT id FROM old_rickshaw_challan WHERE challan_no=$1",[challan]);
          let challanId=existing.rows[0]?.id;
          if(!challanId){
            const cr=await client.query("INSERT INTO old_rickshaw_challan(date,challan_no,model_name,vehicle_no,dealer_id,source,source_ref,status) VALUES($1,$2,$3,$4,$5,'CHFPL',$6,'ACTIVE') RETURNING id",[cdate,challan,row.model_name,row.vehicle_no,row.dealer_id,row.source_ref||String(row.id)]);
            challanId=cr.rows[0].id;
          }
          const oldCols=await columns("old_rickshaw");
          const old:any={date:cdate,source:"chfpl",record_no:"OR-"+row.id,vou_no:challan,chfpl_ref_no:row.source_ref||"",vehicle_reg_no:row.vehicle_no,model_name:row.model_name||"",battery_maker:row.battery_maker||"",dealer_id:row.dealer_id||null,dealer_name:row.dealer_name||"",challan_no:challan,sp_no:sp,status:"available",repo_date:row.repo_date||null};
          const keys=Object.keys(old).filter(k=>oldCols.has(k)),vals=keys.map((_,i)=>"$"+(i+1));
          let oldId=row.old_rickshaw_id;
          if(oldId){
            const sets=keys.map((k,i)=>'"'+k+'"=$'+(i+1));
            await client.query('UPDATE old_rickshaw SET '+sets.join(",")+' WHERE id=$'+(keys.length+1),[...keys.map(k=>old[k]),oldId]);
          }else{
            const ins=await client.query('INSERT INTO old_rickshaw ('+keys.map(k=>'"'+k+'"').join(",")+') VALUES('+vals.join(",")+') RETURNING id',keys.map(k=>old[k]));
            oldId=ins.rows[0].id;
          }
          await client.query("UPDATE old_rickshaw_inventory SET status='available',available_for_sale=true,sp_no=$1,challan_no=$2,challan_date=$3,old_rickshaw_id=$4,updated_at=now() WHERE id=$5",[sp,challan,cdate,oldId,inventoryId]);
        }
        const out=await client.query("SELECT * FROM old_rickshaw_inventory WHERE id=$1",[inventoryId]);
        await client.query("COMMIT");return Response.json({success:true,row:out.rows[0]});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    if(p.startsWith("inventory/old-rickshaw/") && path[path.length-1]==="sale" && method==="POST"){
      await ensureOldRickshawInventorySchema();
      const inventoryId=idOf(path[path.length-2]),b:any=await json(req);
      if(!inventoryId)return Response.json({error:"Inventory id required."},{status:400});
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        const inv=await client.query("SELECT * FROM old_rickshaw_inventory WHERE id=$1 FOR UPDATE",[inventoryId]);
        if(!inv.rowCount)throw new Error("Old Rickshaw inventory record not found.");
        const row=inv.rows[0];if(row.status!=="available")throw new Error("Only Available for Sale vehicles can be sold.");
        const saleAmount=num(b.sale_amount),loanAmount=num(b.loan_amount);
        if(!String(b.customer_name||"").trim())throw new Error("Customer Name is required.");
        if(loanAmount>saleAmount)throw new Error("Loan Amount cannot be greater than Sale Amount.");
        const balance=Math.max(0,saleAmount-loanAmount);
        const oldId=idOf(row.old_rickshaw_id);
        if(oldId){
          const oc=await columns("old_rickshaw"),vals:any={status:"sold",customer_name:String(b.customer_name).trim(),sale_amount:saleAmount,loan_amount:loanAmount,balance_amount:balance,file_charge:num(b.file_charge),do_number:String(b.do_number||"").trim()||null,ledger_no:String(b.ledger_no||"").trim()||null,sale_date:b.sale_date||new Date().toISOString().slice(0,10)};
          const keys=Object.keys(vals).filter(k=>oc.has(k)),sets=keys.map((k,i)=>'"'+k+'"=$'+(i+1));
          if(keys.length)await client.query('UPDATE old_rickshaw SET '+sets.join(",")+' WHERE id=$'+(keys.length+1),[...keys.map(k=>vals[k]),oldId]);
        }
        const u=await client.query("UPDATE old_rickshaw_inventory SET status='sold',customer_name=$1,sale_amount=$2,loan_amount=$3,balance_amount=$4,file_charge=$5,do_number=$6,ledger_no=$7,updated_at=now() WHERE id=$8 RETURNING *",[String(b.customer_name).trim(),saleAmount,loanAmount,balance,num(b.file_charge),String(b.do_number||"").trim()||null,String(b.ledger_no||"").trim()||null,inventoryId]);
        await client.query("COMMIT");return Response.json({success:true,row:u.rows[0]});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    if(p.startsWith("delivery-challans/") && method==="DELETE"){
      const id=idOf(path[path.length-1]); if(!id)return Response.json({error:"Record id required."},{status:400});
      await ensureDispatchSchema();
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        const dc=await client.query("SELECT * FROM delivery_challan WHERE id=$1 FOR UPDATE",[id]);
        if(!dc.rowCount)throw new Error("Delivery Challan not found.");
        if(!dc.rows[0].cancelled){
          const items=await client.query("SELECT * FROM delivery_challan_item WHERE delivery_challan_id=$1",[id]);
          for(const item of items.rows){
            const qty=Math.max(0,Number(item.qty)||0);
            if(qty)await client.query("INSERT INTO journal_stock (vou_no,date,item_name,item_type,qty,reason,created_at,work_type,batch_ref) VALUES ($1,COALESCE($2::date,CURRENT_DATE),$3,'DISPATCH',$4,'Delivery Challan Delete Reversal',NOW(),'IN',$1)",
              [String(dc.rows[0].challan_no||("DC-"+id)),dc.rows[0].date,item.product_name,qty]);
          }
        }
        const r=await client.query("DELETE FROM delivery_challan WHERE id=$1 RETURNING *",[id]);
        if(r.rows[0]?.vehicle_id)await client.query("UPDATE vehicle SET stage='Manufacturing' WHERE id=$1",[r.rows[0].vehicle_id]);
        await client.query("COMMIT");
        return Response.json({success:true,row:r.rows[0]||null});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    if(!table)return Response.json({error:"Node API route not implemented",path:"/api/"+p},{status:404});
    return genericWrite(req,path,table,method);
  }catch(e:any){console.error("[node-api mutation]",e);return Response.json({error:e.message||"Internal server error"},{status:500})}
}