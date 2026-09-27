import jwt from "jsonwebtoken";
import { Pool } from "pg";
export const dynamic="force-dynamic";
export const runtime="nodejs";
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
  "products":"product","tax-invoices":"tax_invoice","purchase-bills":"purchase_bill",
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
async function columns(table:string){
  const r=await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1",[table]);
  return new Set(r.rows.map((x:any)=>x.column_name));
}
async function ensureBillingSalesSchema(){
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
}
async function ensureGrdAssetSchema(){
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
  await pool.query(`ALTER TABLE dealer_cash_customer ADD COLUMN IF NOT EXISTS "full_name" text`);
async function ensureCreditDebitSchema(){
  await pool.query(`CREATE TABLE IF NOT EXISTS credit_note (id bigserial PRIMARY KEY,date date NOT NULL DEFAULT CURRENT_DATE,credit_note_no text,tax_invoice_id integer,delivery_challan_id integer,original_bill_no text,dealer_name text,buyer_name text,chassis_no text,taxable_amount numeric NOT NULL DEFAULT 0,tax_amount numeric NOT NULL DEFAULT 0,total_amount numeric NOT NULL DEFAULT 0,reason text,remarks text,created_at timestamptz NOT NULL DEFAULT now())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS debit_note (id bigserial PRIMARY KEY,date date NOT NULL DEFAULT CURRENT_DATE,debit_note_no text,party_name text,party_gst_no text,party_state_code text,original_bill_no text,reason text,remarks text,taxable_amount numeric NOT NULL DEFAULT 0,tax_amount numeric NOT NULL DEFAULT 0,total_amount numeric NOT NULL DEFAULT 0,items jsonb NOT NULL DEFAULT '[]'::jsonb,created_at timestamptz NOT NULL DEFAULT now())`);
  const defs:any={credit_note:{credit_note_no:"text",tax_invoice_id:"integer",delivery_challan_id:"integer",original_bill_no:"text",dealer_name:"text",buyer_name:"text",chassis_no:"text",taxable_amount:"numeric NOT NULL DEFAULT 0",tax_amount:"numeric NOT NULL DEFAULT 0",total_amount:"numeric NOT NULL DEFAULT 0",reason:"text",remarks:"text"},debit_note:{debit_note_no:"text",party_name:"text",party_gst_no:"text",party_state_code:"text",original_bill_no:"text",reason:"text",remarks:"text",taxable_amount:"numeric NOT NULL DEFAULT 0",tax_amount:"numeric NOT NULL DEFAULT 0",total_amount:"numeric NOT NULL DEFAULT 0",items:"jsonb NOT NULL DEFAULT '[]'::jsonb"}};
  for(const table of Object.keys(defs)) for(const [col,type] of Object.entries(defs[table])) await pool.query('ALTER TABLE "'+table+'" ADD COLUMN IF NOT EXISTS "'+col+'" '+type);
}
async function ensureDealerCashSchema(){
  await pool.query("CREATE TABLE IF NOT EXISTS dealer_cash_customer (id bigserial PRIMARY KEY,dealer_id integer NOT NULL,name text NOT NULL,phone text,customer_phone text,page_no text,vehicle_no text,sale_amount numeric NOT NULL DEFAULT 0,loan_amount numeric NOT NULL DEFAULT 0,paid_amount numeric NOT NULL DEFAULT 0,status text NOT NULL DEFAULT 'VEHICLE_PENDING',date date NOT NULL DEFAULT CURRENT_DATE,created_at timestamptz NOT NULL DEFAULT now())");
  await pool.query("CREATE TABLE IF NOT EXISTS dealer_cash_receipt (id bigserial PRIMARY KEY,dealer_id integer NOT NULL,customer_id bigint,date date NOT NULL DEFAULT CURRENT_DATE,receipt_type text,payment_mode text NOT NULL DEFAULT 'cash',receipt_no text,customer_name text,customer_phone text,dealer_register_page_no text,sale_amount numeric NOT NULL DEFAULT 0,loan_amount numeric NOT NULL DEFAULT 0,amount numeric NOT NULL DEFAULT 0,reference_no text,remarks text,request_id text,created_at timestamptz NOT NULL DEFAULT now())");
  await pool.query("CREATE TABLE IF NOT EXISTS dealer_cash_expense (id bigserial PRIMARY KEY,dealer_id integer NOT NULL,date date NOT NULL DEFAULT CURRENT_DATE,expense_no text,category text,category_label text,amount numeric NOT NULL DEFAULT 0,paid_to text,remarks text,folio text,status text NOT NULL DEFAULT 'ACTIVE',created_at timestamptz NOT NULL DEFAULT now())");
  await pool.query("CREATE TABLE IF NOT EXISTS dealer_cash_handover (id bigserial PRIMARY KEY,dealer_id integer NOT NULL,date date NOT NULL DEFAULT CURRENT_DATE,handover_no text,amount numeric NOT NULL DEFAULT 0,sent_to text,remarks text,folio text,status text NOT NULL DEFAULT 'pending',created_at timestamptz NOT NULL DEFAULT now())");
  const defs:any={
    dealer_cash_expense:{dealer_id:"integer",date:"date",expense_no:"text",category:"text",category_label:"text",amount:"numeric NOT NULL DEFAULT 0",paid_to:"text",remarks:"text",folio:"text",status:"text NOT NULL DEFAULT 'ACTIVE'"},
    dealer_cash_handover:{dealer_id:"integer",date:"date",handover_no:"text",amount:"numeric NOT NULL DEFAULT 0",sent_to:"text",remarks:"text",folio:"text
