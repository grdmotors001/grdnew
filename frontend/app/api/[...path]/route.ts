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
const json=async(req:Request)=>await req.json().catch(()=>({}));
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
function ymd(v:any):string{
  if(v instanceof Date){if(isNaN(v.getTime()))return "";return v.getFullYear()+"-"+String(v.getMonth()+1).padStart(2,"0")+"-"+String(v.getDate()).padStart(2,"0");}
  return String(v||"").slice(0,10);
}
async function columns(table:string){
  const r=await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1",[table]);
  return new Set(r.rows.map((x:any)=>x.column_name));
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
  `);
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
  const defs:any={repair_service_voucher:{voucher_no:"text",vehicle_id:"integer",vehicle_no:"text",chassis_no:"text",customer_name:"text",customer_mobile:"text",items:"jsonb NOT NULL DEFAULT '[]'::jsonb",total_amount:"numeric NOT NULL DEFAULT 0",paid_amount:"numeric NOT NULL DEFAULT 0",balance_amount:"numeric NOT NULL DEFAULT 0",gst_amount:"numeric NOT NULL DEFAULT 0",remarks:"text"},repair_service_payment_receipt:{receipt_no:"text",voucher_id:"integer",date:"date",amount:"numeric NOT NULL DEFAULT 0",payment_mode:"text",reference_no:"text",remarks:"text"}};
  for(const table of Object.keys(defs)) for(const [col,type] of Object.entries(defs[table])) await pool.query('ALTER TABLE "'+table+'" ADD COLUMN IF NOT EXISTS "'+col+'" '+type);
}
function parseItems(v:any){if(Array.isArray(v))return v;if(typeof v==="string"){try{const x=JSON.parse(v);return Array.isArray(x)?x:[]}catch{return []}}return []}
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
async function toggleBatteryRegisterForDelivery(client:any,dc:any,cancelled:boolean){
  await ensureBatteryRegisterSchema();const vr=dc.vehicle_id?await client.query("SELECT battery_maker,battery_no1,battery_no2,battery_no3,battery_no4 FROM vehicle WHERE id=$1 FOR UPDATE",[dc.vehicle_id]):{rows:[]};
  const maker=String(vr.rows[0]?.battery_maker||"").trim(),nums=[1,2,3,4].map(i=>String(vr.rows[0]?.["battery_no"+i]||"").trim()).filter(Boolean);if(!maker||!nums.length)return;
  const entryType=cancelled?"IN":"OUT",sourceType=cancelled?"DELIVERY_CHALLAN_CANCEL":"DELIVERY_CHALLAN";
  for(const no of nums) await client.query("INSERT INTO battery_register_entry (date,battery_maker,battery_no,qty,entry_type,source_type,source_id,source_no,party_name,dealer_id,vehicle_id,remarks) VALUES (COALESCE($1::date,CURRENT_DATE),$2,$3,1,$4,$5,$6,$7,$8,$9,$10,$11)",[dc.date||null,maker,no,entryType,sourceType,dc.id,dc.challan_no||null,dc.dealer_name||null,dc.dealer_id||null,dc.vehicle_id||null,cancelled?"Delivery Challan Cancel":"Battery Issue on Delivery Challan"]);
}
async function assertBatterySerialsAvailable(client:any,maker:string,numbers:string[]){
  const clean=numbers.map(x=>String(x||"").trim()).filter(Boolean);if(!clean.length)return;if(new Set(clean.map(x=>x.toUpperCase())).size!==clean.length)throw new Error("Duplicate battery number entered in the same Delivery Challan.");
  await ensureBatteryRegisterSchema();const stock=await client.query("SELECT COALESCE(SUM(CASE WHEN entry_type='IN' THEN qty ELSE -qty END),0) AS balance FROM battery_register_entry WHERE upper(trim(battery_maker))=upper(trim($1))",[maker]);
  if(Number(stock.rows[0]?.balance||0)<clean.length)throw new Error("Battery stock is insufficient for "+maker+". Available: "+Number(stock.rows[0]?.balance||0)+", required: "+clean.length);
  for(const no of clean){const used=await client.query("SELECT COALESCE(SUM(CASE WHEN entry_type='IN' THEN qty ELSE -qty END),0) AS balance FROM battery_register_entry WHERE upper(trim(battery_maker))=upper(trim($1)) AND upper(trim(COALESCE(battery_no,'')))=upper(trim($2))",[maker,no]);if(Number(used.rows[0]?.balance||0)>0)throw new Error("Battery No. "+no+" is already in use.");}
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
  if(table==="simple_master" && path[0]==="masters" && path[1]){args.push(path[1]);sql+=' WHERE kind=$1';}
  else if(id&&/^\d+$/.test(path[path.length-1]||"")){sql+=" WHERE id=$1";args=[id]}
  else{
    const u=new URL(req.url),where:string[]=[];
    for(const [k,v] of u.searchParams.entries()){
      const c=snake(k);
      if(cols.has(c)&&c!=="id"){args.push(v);where.push('"'+c+'"=$'+args.length);}
    }
  }

  sql+=" ORDER BY id DESC LIMIT 1000";
  const r=await pool.query(sql,args);
  return Response.json({rows:r.rows,data:r.rows,items:r.rows,count:r.rowCount,
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
  if(a?.scope==="dealer") return p.startsWith("dealer/") || p==="auth/me" || p==="billing/pending-sales/options";
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
  return mods.includes(p) || mods.includes(key);
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
  if(method==="POST"){
    const keys=Object.keys(input);
    if(!keys.length)return Response.json({error:"No valid fields supplied."},{status:400});
    const vals=keys.map((_,i)=>"$"+(i+1));
    const sql='INSERT INTO "'+table+'" ('+keys.map(k=>'"'+k+'"').join(",")+') VALUES ('+vals.join(",")+') RETURNING *';
    const r=await pool.query(sql,keys.map(k=>input[k]));
    return Response.json({success:true,row:r.rows[0],data:r.rows[0]},{status:201});
  }
  if(!id)return Response.json({error:"Record id required."},{status:400});
  if(method==="DELETE"){
    const r=await pool.query('DELETE FROM "'+table+'" WHERE id=$1 RETURNING *',[id]);
    return Response.json({success:r.rowCount>0,row:r.rows[0]||null});
  }
  const keys=Object.keys(input);
  if(!keys.length)return Response.json({error:"No valid fields supplied."},{status:400});
  const sets=keys.map((k,i)=>'"'+k+'"=$'+(i+1));
  const r=await pool.query('UPDATE "'+table+'" SET '+sets.join(",")+' WHERE id=$'+(keys.length+1)+' RETURNING *',[...keys.map(k=>input[k]),id]);
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

export async function GET(req:Request,{params}:{params:Promise<{path?:string[]}>}){
  try{
    const {path=[]}=await params,p=path.join("/");
    const b:any=await json(req);
    if(p==="health")return Response.json({status:"ok",backend:"node",python:false});
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
    const a=auth(req);if(!a)return Response.json({error:"Authentication required."},{status:401});
    if(!canRead(a,p))return Response.json({error:"Forbidden."},{status:403});
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
      const remote=await chfplBridge("/api/grd-dealer-loans",q);
      const applications=Array.isArray(remote?.applications)?remote.applications:[];
      await ensureLoanWorkflowBridgeSchema();

      // Reconcile every live CHFPL row into the local bridge by CHFPL id.
      // This makes Refresh recover status changes even when a webhook was
      // delayed/missed. Existing GRD-only pending submissions are preserved.
      for(const row of applications){
        const cid=idOf(row.id);
        if(!cid) continue;
        const status=String(row.status||"submitted").trim()||"submitted";
        const applicationNo=String(row.application_no||"").trim();

        // First use the immutable CHFPL id or GRD application number when
        // already linked.
        const linked=await pool.query(
          "UPDATE loan_workflow SET chfpl_loan_id=$1,status=$2,chfpl_status_updated_at=NOW(),updated_at=NOW() WHERE chfpl_loan_id=$1 OR application_no=$3 RETURNING id",
          [cid,status,applicationNo]
        );
        if(linked.rowCount) continue;

        // Do not auto-match older pending rows using dealer/phone/amount/time.
        // Those fields are not a unique loan identity. Older rows remain\n        // PENDING_CHFPL_SYNC until an explicit immutable link is available.\n      }\n\n      const pendingArgs:any[]=[];
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
      await ensureRepairSchema();const u=new URL(req.url),vehicleNo=String(u.searchParams.get("vehicle_no")||"").trim();
      const vr=await pool.query(`SELECT v.id AS vehicle_id,COALESCE(to_jsonb(v)->>'vehicle_no',to_jsonb(v)->>'vehicle_reg_no',to_jsonb(v)->>'registration_no','') AS vehicle_no,COALESCE(v.chassis_no,'') AS chassis_no,COALESCE(to_jsonb(ti)->>'buyer_name','') AS customer_name,COALESCE(to_jsonb(ti)->>'buyer_mobile',to_jsonb(ti)->>'customer_mobile','') AS customer_mobile FROM vehicle v LEFT JOIN LATERAL (SELECT * FROM tax_invoice x WHERE x.vehicle_id=v.id AND COALESCE(x.cancelled,false)=false ORDER BY x.date DESC,x.id DESC LIMIT 1) ti ON true WHERE ($1='' OR lower(COALESCE(to_jsonb(v)->>'vehicle_no',to_jsonb(v)->>'vehicle_reg_no',to_jsonb(v)->>'registration_no',''))=lower($1)) ORDER BY v.id DESC LIMIT 100`,[vehicleNo]);
      const products=await pool.query(`SELECT p.id,p.name,p.code,p.unit,p.fro,p.product_category,p.show_on_delivery_challan,COALESCE((SELECT SUM(CASE WHEN UPPER(COALESCE(js.work_type,''))='OUT' THEN -ABS(js.qty) WHEN UPPER(COALESCE(js.work_type,''))='IN' THEN ABS(js.qty) ELSE js.qty END) FROM journal_stock js WHERE lower(trim(js.item_name))=lower(trim(p.name))),0) AS stock_qty FROM product p WHERE p.fro='R' OR (UPPER(COALESCE(p.product_category,''))='DISPATCH' AND COALESCE(p.show_on_delivery_challan,false)=true) ORDER BY CASE WHEN UPPER(COALESCE(p.product_category,''))='DISPATCH' THEN 2 ELSE 1 END,p.name`);
      return Response.json({vehicles:vr.rows,items:products.rows,raw_items:products.rows.filter((x:any)=>x.fro==='R'),dispatch_items:products.rows.filter((x:any)=>String(x.product_category||'').toUpperCase()==='DISPATCH')});
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
      if(u.searchParams.get("export")==="csv")return csvResponse(rows,p==="reports/gst-register"?"GST_Register.csv":p==="reports/sale-register"?"Sale_Register.csv":p==="reports/hypothecation-register"?"Hypothecation_Register.csv":"Subsidy_Report.csv");
      if(p==="reports/gst-register"){
        const inwardRaw=await pool.query("SELECT pb.id,pb.date,pb.bill_no AS doc_no,pb.party_name,pb.party_state_code,pb.items FROM purchase_bill pb ORDER BY pb.date DESC,pb.id DESC");
        const inward={rows:inwardRaw.rows.map((x:any)=>{const t=purchaseBillTotals(x);return {id:x.id,date:x.date,doc_no:x.doc_no,party_name:x.party_name,...t,total:t.taxable+t.cgst+t.sgst+t.igst}})};
        const ot=rows.reduce((a:any,x:any)=>(a.taxable+=num(x.taxable_value),a.cgst+=num(x.cgst_amount),a.sgst+=num(x.sgst_amount),a.igst+=num(x.igst_amount),a),{taxable:0,cgst:0,sgst:0,igst:0});
        const it=inward.rows.reduce((a:any,x:any)=>(a.taxable+=num(x.taxable),a.cgst+=num(x.cgst),a.sgst+=num(x.sgst),a.igst+=num(x.igst),a),{taxable:0,cgst:0,sgst:0,igst:0});
        return Response.json({outward:rows,outward_totals:ot,inward:inward.rows,inward_totals:it});
      }
      if(p==="reports/hypothecation-register"){const invoices=rows.filter((x:any)=>num(x.hypothecation_amount)>0).map((x:any)=>({...x,balance_amount:Math.max(0,num(x.hypothecation_amount)-num(x.amount_received))}));return Response.json({invoices,total_hyp:invoices.reduce((s:number,x:any)=>s+num(x.hypothecation_amount),0),rows:invoices});}
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
        return {...pb,items,taxable_amt,cgst_amt,sgst_amt,igst_amt,tax_total,total_amt,total_qty,item_count:items.length};
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
      const r=await pool.query("SELECT ti.id,ti.date,COALESCE(ti.dealer_name,d.name,'') AS dealer_name,COALESCE(ti.buyer_name,'') AS customer_name,COALESCE(v.model_name,ti.product_name,'') AS model_name,v.chassis_no,v.motor_no,COALESCE(to_jsonb(v)->>'umrn','') AS umrn,COALESCE(to_jsonb(v)->>'manufacturing_month','') AS manufacturing_month,COALESCE(COALESCE(to_jsonb(v)->>'colour_code','') AS colour_code,ti.buyer_state_code,'') AS colour_code FROM tax_invoice ti LEFT JOIN dealer d ON d.id=ti.dealer_id LEFT JOIN vehicle v ON v.id=ti.vehicle_id"+(w.length?" WHERE "+w.join(" AND "):"")+" ORDER BY ti.date DESC,ti.id DESC LIMIT 5000",args);
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
    // Next Chassis / Motor / Controller No. for a Production Voucher (was missing -> fell into the generic
    // table handler and crashed with a 500). Format: <item code><month letter><year letter><running serial>.
    // Month letters A..M skip "I"; year letters come from chassis_year_code. The running serial continues from
    // the latest voucher of the same model (motor/controller continue their own trailing number).
    if(p==="production-vouchers/generate-code"){
      const u=new URL(req.url),product=String(u.searchParams.get("product")||u.searchParams.get("product_name")||"").trim();
      if(!product)return Response.json({error:"Product is required."},{status:400});
      const dt=String(u.searchParams.get("date")||"").slice(0,10),d=/^\d{4}-\d{2}-\d{2}$/.test(dt)?dt:new Date().toISOString().slice(0,10);
      const monthLetter="ABCDEFGHJKLM"[Number(d.slice(5,7))-1]||"";
      const yr=await pool.query("SELECT code FROM chassis_year_code WHERE year=$1::int LIMIT 1",[Number(d.slice(0,4))]);
      const yearLetter=String(yr.rows[0]?.code||"").trim();
      if(!monthLetter||!yearLetter)return Response.json({error:"No chassis year code set for "+d.slice(0,4)+" in Chassis Master."},{status:400});
      const pr=await pool.query("SELECT to_jsonb(product)->>'chassis_item_code' AS code FROM product WHERE lower(btrim(name))=lower(btrim($1::text)) ORDER BY (fro='F') DESC,id DESC LIMIT 1",[product]);
      let itemCode=String(pr.rows[0]?.code||"").trim();
      const last=await pool.query("SELECT chassis_no,motor_no,controller_no FROM production_voucher WHERE lower(btrim(product_name))=lower(btrim($1::text)) AND COALESCE(chassis_no,'')<>'' ORDER BY date DESC,id DESC LIMIT 1",[product]);
      const L=last.rows[0]||{};
      const missing=!itemCode;
      if(missing&&L.chassis_no){const m=String(L.chassis_no).match(/^(.*?)[A-Za-z]{2}\d+$/);if(m)itemCode=m[1];}
      if(!itemCode)return Response.json({error:"Chassis Item Code is not set for this product in Product Master."},{status:400});
      const bump=(v:any,by:number)=>{const m=String(v||"").match(/^(.*?)(\d+)$/);if(!m)return "";return m[1]+(BigInt(m[2])+BigInt(by)).toString().padStart(m[2].length,"0")};
      const tail=String(L.chassis_no||"").match(/(\d+)$/);
      let chassis="",k=1;
      for(;k<=200;k++){
        const serial=tail?(BigInt(tail[1])+BigInt(k)).toString().padStart(tail[1].length,"0"):String(k).padStart(4,"0");
        chassis=itemCode+monthLetter+yearLetter+serial;
        const dup=await pool.query("SELECT 1 FROM vehicle WHERE chassis_no=$1::text UNION ALL SELECT 1 FROM production_voucher WHERE chassis_no=$1::text LIMIT 1",[chassis]);
        if(!dup.rowCount)break;
      }
      return Response.json({chassis_no:chassis,motor_no:bump(L.motor_no,k),controller_no:bump(L.controller_no,k),missing_item_code:missing});
    }
    if(p==="chassis-master/months"){const r=await pool.query("SELECT * FROM chassis_month_code ORDER BY id");return Response.json({rows:r.rows,data:r.rows});}
    if(p==="chassis-master/years"){const r=await pool.query("SELECT * FROM chassis_year_code ORDER BY id");return Response.json({rows:r.rows,data:r.rows});}
    if(p==="chassis-master/rule"){const r=await pool.query("SELECT * FROM chassis_rule ORDER BY id DESC LIMIT 1");return Response.json({rule:r.rows[0]||null});}
    if(p==="dealer/loan-masters"){const r=await pool.query("SELECT * FROM simple_master WHERE kind ILIKE '%loan%' ORDER BY id");return Response.json({rows:r.rows,masters:r.rows});}
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
    if(p==="dealer/me"&&a.scope==="dealer"){
      const r=await pool.query("SELECT id,code,name,login_id,dealer_category,purchase_access,portal_modules,blocked FROM dealer WHERE id=$1",[num(a.dealer_id)]);
      const d=r.rows[0]||null;
      if(!d)return Response.json({error:"Dealer not found."},{status:404});
      d.purchase_access=Boolean(d.purchase_access);
      d.portal_modules=String(d.portal_modules||"").split(",").map((x:any)=>x.trim()).filter(Boolean);
      return Response.json({dealer:d});
    }
    if(p==="dealer/stock"&&a.scope==="dealer"){
      const dr=await pool.query("SELECT id,name FROM dealer WHERE id=$1",[num(a.dealer_id)]);
      const name=dr.rows[0]?.name||"";
      const r=await pool.query("SELECT * FROM vehicle WHERE stage='Delivery Challan' AND lower(trim(COALESCE(dealer_name,'')))=lower(trim($1)) ORDER BY date DESC,id DESC",[name]);
      return Response.json({vehicles:r.rows,count:r.rowCount});
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
      const r=await pool.query('SELECT allowed_modules FROM "user" WHERE id=$1',[uid]);if(!r.rowCount)return Response.json({error:"User not found."},{status:404});
      const v=r.rows[0]?.allowed_modules;const selected=Array.isArray(v)?v.map((x:any)=>String(x)):String(v||"").split(",").map((x:string)=>x.trim()).filter(Boolean);
      return Response.json({selected_keys:selected,modules:selected});
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
    if(p.startsWith("users/") && p.endsWith("/password")){
      const uid=idOf(path[path.length-2]),body:any=await json(req),np=String(body.new_password||""),cp=String(body.confirm_password||"");
      if(!uid)return Response.json({error:"User id required."},{status:400});
      if(!np||np!==cp)return Response.json({error:"Passwords do not match."},{status:400});
      const crypto=await import("crypto"),salt=crypto.randomBytes(16).toString("hex"),hash=crypto.pbkdf2Sync(np,salt,260000,32,"sha256").toString("hex"),value="pbkdf2:sha256:260000$"+salt+"$"+hash;
      const r=await pool.query('UPDATE "user" SET password_hash=$1 WHERE id=$2 RETURNING id,username',[value,uid]);
      return Response.json({success:r.rowCount>0,user:r.rows[0]||null});
    }
    if(p.startsWith("users/") && p.endsWith("/option-setting")){
      const uid=idOf(path[path.length-2]),body:any=await json(req),modules=Array.isArray(body.modules)?body.modules.map((x:any)=>String(x).trim()).filter(Boolean):[];
      if(!uid)return Response.json({error:"User id required."},{status:400});
      const meta=await pool.query("SELECT data_type FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='user' AND column_name='allowed_modules'");
      const value=String(meta.rows[0]?.data_type||"").toLowerCase()==="array"?modules:modules.join(",");
      const r=await pool.query('UPDATE "user" SET allowed_modules=$1 WHERE id=$2 RETURNING id,username,allowed_modules',[value,uid]);
      return Response.json({success:r.rowCount>0,user:r.rows[0]||null});
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
        return {...pb,items,taxable_total:taxable,tax_total:tax,bill_total:total,total_qty:qty};
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
      const r=await pool.query("SELECT dc.*,d.name AS dealer_name,d.code AS dealer_code,d.mobile AS dealer_mobile,d.gst_no AS dealer_gst_no,v.model_name AS vehicle_model_name,v.chassis_no AS vehicle_chassis_no,v.motor_no AS vehicle_motor_no,v.colour AS vehicle_colour,v.battery_maker,v.battery_no1,v.battery_no2,v.battery_no3,v.battery_no4,COALESCE(to_jsonb(v)->>'umrn_code','') AS umrn_code FROM delivery_challan dc LEFT JOIN dealer d ON d.id=dc.dealer_id LEFT JOIN vehicle v ON v.id=dc.vehicle_id WHERE dc.id=$1",[id]);
      if(!r.rowCount)return Response.json({error:"Delivery Challan not found."},{status:404});
      const x=r.rows[0],challan={...x,product_name:x.product_name||x.vehicle_model_name,chassis_no:x.chassis_no||x.vehicle_chassis_no,motor_no:x.motor_no||x.vehicle_motor_no,colour:x.colour||x.vehicle_colour};
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
      const chfplLoanId=idOf(b.chfpl_loan_id),status=String(b.status||"").trim();
      const grdSubmissionRef=idOf(b.grd_submission_ref);
      if(!chfplLoanId||!status)return Response.json({success:false,error:"chfpl_loan_id and status are required."},{status:400});
      await ensureLoanWorkflowBridgeSchema();
      const r=await pool.query(
        "UPDATE loan_workflow SET chfpl_loan_id=$1,status=$2,chfpl_status_updated_at=NOW(),updated_at=NOW() WHERE chfpl_loan_id=$1 OR ($3 IS NOT NULL AND id=$3) RETURNING id,application_no,status,chfpl_loan_id",
        [chfplLoanId,status,grdSubmissionRef]
      );
      if(!r.rowCount)return Response.json({success:false,error:"GRD loan not found for chfpl_loan_id or grd_submission_ref."},{status:404});
      return Response.json({success:true,application:r.rows[0]});
    }

    const a=auth(req);if(!a)return Response.json({error:"Authentication required."},{status:401});

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
    if(p==="repair-service-vouchers"){
      await ensureRepairSchema();const items=Array.isArray(b.items)?b.items:[];if(!String(b.vehicle_no||"").trim())return Response.json({error:"Vehicle No. is required."},{status:400});if(!items.length)return Response.json({error:"At least one Raw/Dispatch item is required."},{status:400});
      const client=await pool.connect();try{await client.query("BEGIN");let total=0;const clean:any[]=[];
        for(const it of items){const pid=idOf(it.item_id),qty=Number(it.qty||0),rate=Number(it.rate||0);if(!pid||qty<=0||rate<0)throw new Error("Select a valid Raw Material / Dispatch item, quantity and rate.");const pr=await client.query("SELECT * FROM product WHERE id=$1 FOR UPDATE",[pid]);if(!pr.rowCount)throw new Error("Item not found.");const isRaw=String(pr.rows[0].fro||"").toUpperCase()==="R",isDispatch=String(pr.rows[0].product_category||"").toUpperCase()==="DISPATCH";if(!isRaw&&!isDispatch)throw new Error(pr.rows[0].name+" is not a Raw Material or Dispatch item.");const stock=await client.query("SELECT COALESCE(SUM(CASE WHEN UPPER(COALESCE(work_type,''))='OUT' THEN -ABS(qty) WHEN UPPER(COALESCE(work_type,''))='IN' THEN ABS(qty) ELSE qty END),0) AS balance FROM journal_stock WHERE lower(trim(item_name))=lower(trim($1))",[pr.rows[0].name]);if(Number(stock.rows[0]?.balance||0)<qty)throw new Error("Insufficient stock for "+pr.rows[0].name+". Available: "+Number(stock.rows[0]?.balance||0));total+=qty*rate;clean.push({item_id:pid,item_code:pr.rows[0].code||"",item_name:pr.rows[0].name,qty,rate,unit:pr.rows[0].unit||"PCS",item_type:isDispatch?"DISPATCH":"R"});await client.query("INSERT INTO journal_stock (vou_no,date,item_name,item_type,qty,reason,created_at,work_type,batch_ref) VALUES ($1,COALESCE($2::date,CURRENT_DATE),$3,$4,$5,'Repair & Service Consumption',NOW(),'OUT',$1)",[String(b.vehicle_no||"RSV"),b.date||null,pr.rows[0].name,isDispatch?"DISPATCH":"RAW",qty]);}
        const no="RSV-"+new Date().toISOString().slice(0,10).replace(/-/g,"")+"-"+String(Date.now()).slice(-5),r=await client.query("INSERT INTO repair_service_voucher (voucher_no,date,vehicle_id,vehicle_no,chassis_no,customer_name,customer_mobile,items,total_amount,paid_amount,balance_amount,gst_amount,remarks) VALUES ($1,COALESCE($2::date,CURRENT_DATE),$3,$4,$5,$6,$7,$8,$9,0,$9,0,$10) RETURNING *",[no,b.date||null,idOf(b.vehicle_id),String(b.vehicle_no).trim(),b.chassis_no||null,b.customer_name||null,b.customer_mobile||null,JSON.stringify(clean),total,b.remarks||null]);await client.query("COMMIT");return Response.json({success:true,voucher:r.rows[0],row:r.rows[0]},{status:201});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    if(p.startsWith("repair-service-vouchers/") && p.endsWith("/receipt")){
      await ensureRepairSchema();const id=idOf(path[path.length-2]),amount=Number(b.amount||0);if(!id||amount<=0)return Response.json({error:"Valid voucher and receipt amount are required."},{status:400});const client=await pool.connect();try{await client.query("BEGIN");const v=await client.query("SELECT * FROM repair_service_voucher WHERE id=$1 FOR UPDATE",[id]);if(!v.rowCount)throw new Error("Repair / Service Voucher not found.");const paid=Number(v.rows[0].paid_amount||0)+amount,total=Number(v.rows[0].total_amount||0),balance=Math.max(0,total-paid),no="RCP-"+new Date().toISOString().slice(0,10).replace(/-/g,"")+"-"+String(Date.now()).slice(-5);const rr=await client.query("INSERT INTO repair_service_payment_receipt (receipt_no,voucher_id,date,amount,payment_mode,reference_no,remarks) VALUES ($1,$2,COALESCE($3::date,CURRENT_DATE),$4,$5,$6,$7) RETURNING *",[no,id,b.date||null,amount,b.payment_mode||"cash",b.reference_no||null,b.remarks||null]);await client.query("UPDATE repair_service_voucher SET paid_amount=$1,balance_amount=$2 WHERE id=$3",[paid,balance,id]);await client.query("COMMIT");return Response.json({success:true,receipt:rr.rows[0],row:rr.rows[0]},{status:201});}catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
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
      const cols=await columns("purchase_bill"),input:any={};
      for(const [k,v] of Object.entries(b||{})){const col=snake(k);if(cols.has(col)&&col!=="id")input[col]=v;}
      if(Array.isArray(input.items))input.items=JSON.stringify(input.items);
      const keys=Object.keys(input);if(!keys.length)return Response.json({error:"No valid purchase fields supplied."},{status:400});
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        const r=await client.query('INSERT INTO "purchase_bill" ('+keys.map(k=>'"'+k+'"').join(",")+') VALUES ('+keys.map((_,i)=>"$"+(i+1)).join(",")+') RETURNING *',keys.map(k=>input[k]));
        const row={...r.rows[0],items:parseItems(r.rows[0].items)};await syncBatteryPurchaseBill(client,row);
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
          const dup=await client.query("SELECT id FROM vehicle WHERE chassis_no=$1 LIMIT 1",[chassis]);
          if(dup.rowCount)throw new Error("Chassis No. already exists.");
        }
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
      if(a.scope==="dealer"){
        const did=num(a.dealer_id);
        const dr=await pool.query("SELECT name FROM dealer WHERE id=$1",[did]);
        if(!dr.rowCount)return Response.json({error:"Dealer not found."},{status:404});
        const owned=await pool.query("SELECT id FROM vehicle WHERE id=ANY($1::int[]) AND stage='Delivery Challan' AND lower(trim(COALESCE(dealer_name,'')))=lower(trim($2))",[ [fromId,toId], dr.rows[0].name ]);
        if(owned.rowCount!==2)return Response.json({error:"Both vehicles must be in your dealer stock."},{status:403});
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
      const model=modelId
        ? (await pool.query("SELECT * FROM product WHERE id=$1 LIMIT 1",[modelId])).rows[0]
        : null;
      if(modelId && !model)return Response.json({error:"Selected vehicle model not found."},{status:404});

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
    const {path=[]}=await params,p=path.join("/"),table=tableFor(path);
    if(!canWrite(a,p))return Response.json({error:"Forbidden."},{status:403});

    // Production Formula: poora formula (ek product + formula name ki saari lines) delete.
    if(method==="DELETE" && p==="production-formulas/by-product"){
      await ensureProductionFormulaSchema();
      const u=new URL(req.url),product=String(u.searchParams.get("product_name")||"").trim(),formula=String(u.searchParams.get("formula_name")||"").trim();
      if(!product)return Response.json({error:"Product zaroori hai."},{status:400});
      const r=await pool.query("DELETE FROM production_formula WHERE "+NORM("product_name")+"="+NORM("$1")+" AND "+NORM("formula_name")+"="+NORM("$2"),[product,formula]);
      return Response.json({success:r.rowCount>0,deleted:r.rowCount});
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
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        const old=await client.query('SELECT * FROM "purchase_bill" WHERE id=$1 FOR UPDATE',[id]);
        if(!old.rowCount)throw new Error("Purchase Bill not found.");
        if(method==="DELETE"){
          await ensureBatteryRegisterSchema();
          await client.query("DELETE FROM battery_register_entry WHERE source_type='PURCHASE' AND source_id=$1",[id]);
          const r=await client.query('DELETE FROM "purchase_bill" WHERE id=$1 RETURNING *',[id]);
          await client.query("COMMIT");return Response.json({success:true,row:r.rows[0]||null});
        }
        const body:any=await json(req),cols=await columns("purchase_bill"),input:any={};
        for(const [k,v] of Object.entries(body||{})){const col=snake(k);if(cols.has(col)&&col!=="id")input[col]=v;}
        if(Array.isArray(input.items))input.items=JSON.stringify(input.items);
        const keys=Object.keys(input);if(!keys.length)return Response.json({error:"No changes supplied."},{status:400});
        const sets=keys.map((k,i)=>'"'+k+'"=$'+(i+1));
        const r=await client.query('UPDATE "purchase_bill" SET '+sets.join(",")+' WHERE id=$'+(keys.length+1)+' RETURNING *',[...keys.map(k=>input[k]),id]);
        const row={...r.rows[0],items:parseItems(r.rows[0].items)};
        await syncBatteryPurchaseBill(client,row);
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