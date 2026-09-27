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
    dealer_cash_handover:{dealer_id:"integer",date:"date",handover_no:"text",amount:"numeric NOT NULL DEFAULT 0",sent_to:"text",remarks:"text",folio:"text",status:"text NOT NULL DEFAULT 'pending'"}
  };
  for(const table of Object.keys(defs)) for(const [col,type] of Object.entries(defs[table]))
    await pool.query('ALTER TABLE "'+table+'" ADD COLUMN IF NOT EXISTS "'+col+'" '+type);
}

async function ensureRepairSchema(){
  await pool.query(`CREATE TABLE IF NOT EXISTS repair_service_voucher (id bigserial PRIMARY KEY,voucher_no text,date date NOT NULL DEFAULT CURRENT_DATE,vehicle_id integer,vehicle_no text,chassis_no text,customer_name text,customer_mobile text,items jsonb NOT NULL DEFAULT '[]'::jsonb,total_amount numeric NOT NULL DEFAULT 0,paid_amount numeric NOT NULL DEFAULT 0,balance_amount numeric NOT NULL DEFAULT 0,gst_amount numeric NOT NULL DEFAULT 0,remarks text,created_at timestamptz NOT NULL DEFAULT now())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS repair_service_payment_receipt (id bigserial PRIMARY KEY,receipt_no text,voucher_id integer REFERENCES repair_service_voucher(id) ON DELETE CASCADE,date date NOT NULL DEFAULT CURRENT_DATE,amount numeric NOT NULL DEFAULT 0,payment_mode text,reference_no text,remarks text,created_at timestamptz NOT NULL DEFAULT now())`);
  const defs:any={repair_service_voucher:{voucher_no:"text",vehicle_id:"integer",vehicle_no:"text",chassis_no:"text",customer_name:"text",customer_mobile:"text",items:"jsonb NOT NULL DEFAULT '[]'::jsonb",total_amount:"numeric NOT NULL DEFAULT 0",paid_amount:"numeric NOT NULL DEFAULT 0",balance_amount:"numeric NOT NULL DEFAULT 0",gst_amount:"numeric NOT NULL DEFAULT 0",remarks:"text"},repair_service_payment_receipt:{receipt_no:"text",voucher_id:"integer",date:"date",amount:"numeric NOT NULL DEFAULT 0",payment_mode:"text",reference_no:"text",remarks:"text"}};
  for(const table of Object.keys(defs)) for(const [col,type] of Object.entries(defs[table])) await pool.query('ALTER TABLE "'+table+'" ADD COLUMN IF NOT EXISTS "'+col+'" '+type);
}
function parseItems(v:any){if(Array.isArray(v))return v;if(typeof v==="string"){try{const x=JSON.parse(v);return Array.isArray(x)?x:[]}catch{return []}}return []}
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
  if(a?.scope==="dealer") return p.startsWith("dealer/") || p==="auth/me";
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
async function genericWrite(req:Request,path:string[],table:string,method:string){
  const cols=await columns(table);
  if(!cols.size)return Response.json({error:"Table not found",table},{status:404});
  const body:any=await json(req),input:any={};
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

export async function GET(req:Request,{params}:{params:Promise<{path?:string[]}>}){
  try{
    const {path=[]}=await params,p=path.join("/");
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
    if(p==="billing/pending-sales"){
      await ensureBillingSalesSchema();
      if(!billingStaff(a) && a?.scope!=="dealer")return Response.json({error:"Billing approval rights required."},{status:403});
      const args:any[]=[];
      let where="1=1";
      if(a?.scope==="dealer"){args.push(num(a.dealer_id));where+=" AND s.dealer_id=$"+args.length;}
      const r=await pool.query(`SELECT s.*,lw.application_no,lw.status AS loan_status,lw.loan_amount,lw.loan_model_name,lw.loan_vehicle_type,
        c.full_name AS customer_name,c.phone AS customer_phone,d.name AS dealer_name,
        v.model_name,v.motor_no,v.controller_no,v.colour
        FROM grd_billing_sale s
        LEFT JOIN loan_workflow lw ON lw.id=s.application_id
        LEFT JOIN customer c ON c.id=s.customer_id
        LEFT JOIN dealer d ON d.id=s.dealer_id
        LEFT JOIN vehicle v ON v.id=s.vehicle_id
        WHERE ${where}
        ORDER BY s.created_at DESC,s.id DESC LIMIT 500`,args);
      return Response.json({applications:r.rows,rows:r.rows,count:r.rowCount,can_approve:billingStaff(a)});
    }
    if(p==="billing/pending-sales/options"){
      await ensureBillingSalesSchema();await ensureGrdAssetSchema();
      if(!billingStaff(a) && a?.scope!=="dealer")return Response.json({error:"Billing rights required."},{status:403});
      const args:any[]=[];
      let dealerWhere="";
      if(a?.scope==="dealer"){args.push(num(a.dealer_id));dealerWhere=" AND lw.dealer_id=$"+args.length;}
      const approved=`LOWER(REPLACE(REPLACE(TRIM(COALESCE(lw.status,'')),'_',' '),'-',' ')) IN ('loan approved','approved')`;
      const r=await pool.query(`SELECT lw.id,lw.application_no,lw.status,lw.loan_amount,lw.loan_model_name,lw.loan_vehicle_type,
        c.full_name AS customer_name,c.phone AS customer_phone,d.name AS dealer_name,lw.dealer_id
        FROM loan_workflow lw
        LEFT JOIN customer c ON c.id=lw.customer_id
        LEFT JOIN dealer d ON d.id=lw.dealer_id
        WHERE ${approved} AND NOT EXISTS (SELECT 1 FROM grd_billing_sale s WHERE s.application_id=lw.id)${dealerWhere}
        ORDER BY lw.id DESC LIMIT 500`,args);
      const vehicleArgs:any[]=[];
      let vehicleWhere="COALESCE(dc.cancelled,false)=false AND dc.vehicle_id IS NOT NULL";
      if(a?.scope==="dealer"){vehicleArgs.push(num(a.dealer_id));vehicleWhere+=" AND dc.dealer_id=$"+vehicleArgs.length;}
      const ch=await pool.query(`SELECT dc.id AS challan_id,dc.vehicle_id,dc.chassis_no,dc.product_name,dc.sale_value,dc.date,dc.dealer_id,d.name AS dealer_name
        FROM delivery_challan dc LEFT JOIN dealer d ON d.id=dc.dealer_id
        WHERE ${vehicleWhere}
        ORDER BY dc.date DESC,dc.id DESC LIMIT 1000`,vehicleArgs);
      return Response.json({applications:r.rows,vehicles:ch.rows,can_approve:billingStaff(a)});
    }
    if(p==="billing/pending-sales/invoice"){
      await ensureBillingSalesSchema();
      if(!billingStaff(a))return Response.json({error:"Billing approval rights required."},{status:403});
      const id=idOf(new URL(req.url).searchParams.get("id"));
      if(!id)return Response.json({error:"Sale id is required."},{status:400});
      const r=await pool.query(`SELECT s.*,lw.application_no,lw.loan_amount,lw.loan_model_name,lw.loan_vehicle_type,
        c.full_name AS customer_name,c.phone AS customer_phone,c.address AS customer_address,c.state AS customer_state,
        d.name AS dealer_name,v.model_name,v.motor_no,v.controller_no,v.colour
        FROM grd_billing_sale s
        LEFT JOIN loan_workflow lw ON lw.id=s.application_id
        LEFT JOIN customer c ON c.id=s.customer_id
        LEFT JOIN dealer d ON d.id=s.dealer_id
        LEFT JOIN vehicle v ON v.id=s.vehicle_id WHERE s.id=$1`,[id]);
      if(!r.rowCount)return Response.json({error:"Pending Sale not found."},{status:404});
      const x=r.rows[0];
      if(x.status!=="APPROVED")return Response.json({error:"Pending Sale must be approved before Create Sale."},{status:403});
      if(x.invoice_id){const inv=await pool.query("SELECT * FROM tax_invoice WHERE id=$1",[x.invoice_id]);return Response.json({sale:x,invoice:inv.rows[0]||null});}
      return Response.json({sale:x,invoice:{
        date:new Date().toISOString().slice(0,10),buyer_name:x.customer_name||"",buyer_mobile:x.customer_phone||"",
        buyer_address:x.customer_address||"",buyer_state:x.customer_state||"",dealer_name:x.dealer_name||"",
        product_name:x.model_name||x.loan_model_name||"",chassis_no:x.chassis_no||"",motor_no:x.motor_no||"",
        controller_no:x.controller_no||"",colour:x.colour||"",sale_amount:num(x.sale_amount),gst_sale_amount:num(x.sale_amount),
        gst_rate:5,hypothecation_amount:num(x.loan_amount),amount_received:0,mode_term:"CHFPL",remarks:x.description||""
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
        const inward=await pool.query("SELECT pb.id,pb.date,pb.bill_no AS doc_no,pb.party_name,0::numeric AS taxable,0::numeric AS cgst,0::numeric AS sgst,0::numeric AS igst FROM purchase_bill pb ORDER BY pb.date DESC,pb.id DESC");
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
      const r=await pool.query("SELECT pb.*,0::numeric AS taxable_amt,0::numeric AS cgst_amt,0::numeric AS sgst_amt,0::numeric AS igst_amt,0::numeric AS total_amt,0::int AS item_count FROM purchase_bill pb"+where+" ORDER BY pb.date DESC,pb.id DESC",args);
      if(u.searchParams.get("export")==="csv")return csvResponse(r.rows,"Purchase_Register.csv");
      const page=Math.max(1,num(u.searchParams.get("page"))||1),per=Math.min(200,Math.max(1,num(u.searchParams.get("per_page"))||50)),start=(page-1)*per;
      const pageRows=r.rows.slice(start,start+per),totals=pageRows.reduce((a:any,x:any)=>(a.taxable+=num(x.taxable_amt),a.cgst+=num(x.cgst_amt),a.sgst+=num(x.sgst_amt),a.igst+=num(x.igst_amt),a),{taxable:0,cgst:0,sgst:0,igst:0});
      return Response.json({rows:pageRows,page,per_page:per,total:r.rowCount,total_pages:Math.max(1,Math.ceil(r.rowCount/per)),totals});
    }
    if(/^tax-invoices\/\d+$/.test(p)){
      const id=idOf(path[path.length-1]);if(!id)return Response.json({error:"Tax Invoice id required."},{status:400});
      const r=await pool.query("SELECT * FROM tax_invoice WHERE id=$1",[id]);
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
      const all=await pool.query("SELECT ti.* FROM tax_invoice ti"+where+" ORDER BY ti.date DESC,ti.id DESC",args);
      const page=Math.max(1,num(u.searchParams.get("page"))||1),per=Math.min(200,Math.max(1,num(u.searchParams.get("per_page"))||50)),start=(page-1)*per;
      const invoices=all.rows.slice(start,start+per);
      const challans=await pool.query("SELECT dc.*,d.name AS dealer_name,v.battery_maker,v.battery_no1,v.battery_no2,v.battery_no3,v.battery_no4 FROM delivery_challan dc LEFT JOIN dealer d ON d.id=dc.dealer_id LEFT JOIN vehicle v ON v.id=dc.vehicle_id WHERE COALESCE(dc.cancelled,false)=false AND NOT EXISTS (SELECT 1 FROM tax_invoice ti WHERE ti.delivery_challan_id=dc.id AND COALESCE(ti.cancelled,false)=false) ORDER BY dc.date DESC,dc.id DESC LIMIT 1000");
      return Response.json({invoices,rows:invoices,data:invoices,uninvoiced_challans:challans.rows,page,per_page:per,total:all.rowCount,total_pages:Math.max(1,Math.ceil(all.rowCount/per))});
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
      const r=await pool.query("SELECT ti.id,ti.date,COALESCE(ti.dealer_name,d.name,'') AS dealer_name,COALESCE(ti.buyer_name,'') AS customer_name,COALESCE(v.model_name,ti.product_name,'') AS model_name,v.chassis_no,v.motor_no,COALESCE(to_jsonb(v)->>'umrn','') AS umrn,COALESCE(to_jsonb(v)->>'manufacturing_month','') AS manufacturing_month,COALESCE(v.colour_code,ti.buyer_state_code,'') AS colour_code FROM tax_invoice ti LEFT JOIN dealer d ON d.id=ti.dealer_id LEFT JOIN vehicle v ON v.id=ti.vehicle_id"+(w.length?" WHERE "+w.join(" AND "):"")+" ORDER BY ti.date DESC,ti.id DESC LIMIT 5000",args);
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
    if(p==="production-formulas"){
      const r=await pool.query("SELECT * FROM production_formula ORDER BY product_name,formula_name,id");
      const grouped:any[]=[]; const map=new Map<string,any>();
      for(const row of r.rows){const key=String(row.formula_name||"")+"::"+String(row.product_name||"");let g=map.get(key);if(!g){g={formula_name:row.formula_name,product_name:row.product_name,lines:[]};map.set(key,g);grouped.push(g)}g.lines.push(row)}
      const products=await pool.query("SELECT name,fro FROM product ORDER BY name");
      return Response.json({grouped,rows:r.rows,lines:r.rows,finished_products:products.rows.filter((x:any)=>x.fro!=="R"),raw_materials:products.rows.filter((x:any)=>x.fro==="R")});
    }
    if(p==="production-formulas/lines"){
      const u=new URL(req.url),args:any[]=[];const w:string[]=[];
      const product=u.searchParams.get("product_name")||u.searchParams.get("product")||"";const formula=u.searchParams.get("formula_name")||"";
      if(product){args.push(product);w.push("product_name=$"+args.length)}if(formula){args.push(formula);w.push("formula_name=$"+args.length)}
      const r=await pool.query("SELECT * FROM production_formula"+(w.length?" WHERE "+w.join(" AND "):"")+" ORDER BY id",args);
      return Response.json({rows:r.rows,items:r.rows,data:r.rows,lines:r.rows});
    }
    if(p==="chassis-master/months"){const r=await pool.query("SELECT * FROM chassis_month_code ORDER BY id");return Response.json({rows:r.rows,data:r.rows});}
    if(p==="chassis-master/years"){const r=await pool.query("SELECT * FROM chassis_year_code ORDER BY id");return Response.json({rows:r.rows,data:r.rows});}
    if(p==="chassis-master/rule"){const r=await pool.query("SELECT * FROM chassis_rule ORDER BY id DESC LIMIT 1");return Response.json({rule:r.rows[0]||null});}
    if(p==="dealer/loan-masters"){const r=await pool.query("SELECT * FROM simple_master WHERE kind ILIKE '%loan%' ORDER BY id");return Response.json({rows:r.rows,masters:r.rows});}
    if(p==="dealer/ledger-accounts"||p==="dealer/ledger-masters"){const r=await pool.query("SELECT DISTINCT party_name FROM day_book WHERE party_name IS NOT NULL ORDER BY party_name");return Response.json({rows:r.rows});}
    if(p==="factory/old-rickshaw-challans"){
      await ensureOldRickshawInventorySchema();
      const rows=await pool.query("SELECT c.*,d.name AS dealer_name FROM old_rickshaw_challan c LEFT JOIN dealer d ON d.id=c.dealer_id ORDER BY c.date DESC,c.id DESC LIMIT 1000");
      const available=await pool.query("SELECT * FROM old_rickshaw_inventory WHERE status='available' ORDER BY repo_date DESC NULLS LAST,id DESC LIMIT 500");
      return Response.json({challans:rows.rows,rows:rows.rows,available_for_sale:available.rows,suggested_challan_no:"ORC-"+new Date().toISOString().slice(0,10).replace(/-/g,"")+"-"+Date.now()});
    }
    if(p==="dealer/ledger"&&a.scope==="dealer"){
      const did=num(a.dealer_id),u=new URL(req.url),from=String(u.searchParams.get("from")||"").trim(),to=String(u.searchParams.get("to")||"").trim(),search=String(u.searchParams.get("search")||"").trim();
      const cols=await columns("day_book");
      if(!cols.size)return Response.json({events:[],rows:[],count:0});
      const rows=(await pool.query('SELECT * FROM day_book ORDER BY id DESC LIMIT 5000')).rows;
      const events=rows.filter((x:any)=>{
        const party=String(x.party_name||x.account_name||x.account||"");
        const doc=String(x.doc_no||x.voucher_no||x.reference_no||x.bill_no||"");
        const text=[party,doc,String(x.narration||""),String(x.particulars||""),String(x.chassis_no||"")].join(" ").toLowerCase();
        const d=String(x.date||"").slice(0,10);
        return (!from||d>=from)&&(!to||d<=to)&&(!search||text.includes(search.toLowerCase()));
      });
      let running=0;
      const eventsOut=events.reverse().map((x:any,i:number)=>{
        const debit=num(x.debit||x.dr_amount||x.debit_amount),credit=num(x.credit||x.cr_amount||x.credit_amount);
        running+=debit-credit;
        return {record_type:"day_book",record_id:x.id,date:x.date,doc_no:x.doc_no||x.voucher_no||x.bill_no||"",account:x.party_name||x.account_name||x.account||"",lines:[x.narration||x.particulars||x.description||""].filter(Boolean),debit,credit,balance:running,dc:running>=0?"Dr":"Cr",vr_type:debit?"S":"R"};
      }).reverse();
      return Response.json({events:eventsOut,rows:eventsOut,count:eventsOut.length});
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
      const handovers=await runRange("dealer_cash_handover","");
      const priorDate=from||"9999-12-31";
      const priorReceipts=await pool.query("SELECT COALESCE(SUM(amount),0) AS n FROM dealer_cash_receipt WHERE dealer_id=$1 AND lower(COALESCE(payment_mode,'cash'))='cash' AND date < $2::date",[did,priorDate]);
      const priorExpenses=await pool.query("SELECT COALESCE(SUM(amount),0) AS n FROM dealer_cash_expense WHERE dealer_id=$1 AND date < $2::date",[did,priorDate]);
      const priorHandovers=await pool.query("SELECT COALESCE(SUM(amount),0) AS n FROM dealer_cash_handover WHERE dealer_id=$1 AND date < $2::date",[did,priorDate]);
      const opening=num(priorReceipts.rows[0]?.n)-num(priorExpenses.rows[0]?.n)-num(priorHandovers.rows[0]?.n);
      const cashReceived=receipts.rows.reduce((s:number,x:any)=>s+num(x.amount),0);
      const expenseTotal=expenses.rows.reduce((s:number,x:any)=>s+num(x.amount),0);
      const handoverTotal=handovers.rows.reduce((s:number,x:any)=>s+num(x.amount),0);
      const closing=opening+cashReceived-expenseTotal-handoverTotal;
      return Response.json({receipts:receipts.rows,expenses:expenses.rows.map((x:any)=>({...x,category_label:x.category_label||x.category||"",folio:x.folio||""})),handovers:handovers.rows,summary:{opening_balance:opening,cash_received:cashReceived,expenses:expenseTotal,ho_handover:handoverTotal,net_movement:cashReceived-expenseTotal-handoverTotal,closing_balance:closing}});
    }
    if(p==="dealer/cash-book/all-receipts"&&a.scope==="dealer"){
      const r=await pool.query("SELECT * FROM dealer_cash_receipt WHERE dealer_id=$1 ORDER BY date DESC,id DESC LIMIT 2000",[num(a.dealer_id)]);
      return Response.json({receipts:r.rows,rows:r.rows,count:r.rowCount});
    }
    if(p==="dealer/cash-book/all-expenses"&&a.scope==="dealer"){
      await ensureDealerCashSchema();
      const r=await pool.query("SELECT * FROM dealer_cash_expense WHERE dealer_id=$1 ORDER BY date DESC,id DESC LIMIT 2000",[num(a.dealer_id)]);
      return Response.json({expenses:r.rows,rows:r.rows,count:r.rowCount});
    }
    if(p==="dealer/cash-book/customers"&&a.scope==="dealer"){
      await ensureDealerCashSchema();
      const did=num(a.dealer_id),u=new URL(req.url),q=String(u.searchParams.get("q")||"").trim(),status=String(u.searchParams.get("status")||"").trim().toUpperCase(),payable=u.searchParams.get("payable_only")==="1";
      const cols=await columns("dealer_cash_customer"); if(!cols.size)return Response.json({error:"Customer register table not found."},{status:404});
      const args:any[]=[did],where:string[]=['dealer_id=$1'];
      if(status&&cols.has("status")){args.push(status);where.push("UPPER(COALESCE(status,''))=$"+args.length);}
      if(q){const parts=["name","phone","page_no","vehicle_no"].filter(x=>cols.has(x));if(parts.length){args.push("%"+q+"%");const n=args.length;where.push("("+parts.map(x=>"COALESCE(\""+x+"\",'') ILIKE $"+n).join(" OR ")+")");}}
      const r=await pool.query('SELECT * FROM dealer_cash_customer WHERE '+where.join(" AND ")+' ORDER BY id DESC LIMIT 1000',args);
      let customers=r.rows.map((x:any)=>({...x,phone:x.phone||x.customer_phone||"",balance:Math.max(0,Number(x.sale_amount||0)-Number(x.loan_amount||0)-Number(x.paid_amount||0))}));
      if(payable)customers=customers.filter((x:any)=>x.balance>0);
      return Response.json({customers,rows:customers,count:customers.length});
    }
    if(p==="dealer/delivery/customers"&&a.scope==="dealer"){
      await ensureDealerCashSchema();
      const r=await pool.query("SELECT * FROM dealer_cash_customer WHERE dealer_id=$1 AND UPPER(COALESCE(status,''))<>'DEALER_CANCEL' ORDER BY id DESC LIMIT 1000",[num(a.dealer_id)]);
      const customers=r.rows.map((x:any)=>({...x,phone:x.phone||x.customer_phone||"",balance:Math.max(0,Number(x.sale_amount||0)-Number(x.loan_amount||0)-Number(x.paid_amount||0))}));
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
      const r=await pool.query("SELECT ti.* FROM tax_invoice ti LEFT JOIN delivery_challan dc ON ti.delivery_challan_id=dc.id WHERE ti.cancelled=false AND (ti.dealer_id=$1 OR dc.dealer_id=$1) ORDER BY ti.date DESC,ti.id DESC",[num(a.dealer_id)]);
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
      const r=await pool.query('SELECT id,username,mobile,department,is_super_user,allowed_modules FROM "user" WHERE id=$1',[num(a.sub)]);
      return Response.json({user:r.rows[0]||null});
    }
    if(p==="dealer/loan-status"||p==="loan-application-view"){
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
      const per=Math.min(200,Math.max(1,num(u.searchParams.get("per_page"))||50));
      const search=String(u.searchParams.get("search")||"").trim();
      const fro=String(u.searchParams.get("fro")||"").trim().toUpperCase();
      const category=String(u.searchParams.get("category")||"").trim().toUpperCase();
      const cols=await columns("product");
      if(!cols.size)return Response.json({error:"Product table not found."},{status:404});
      const args:any[]=[]; const where:string[]=[];
      if(category && cols.has("product_category")){args.push(category);where.push('UPPER(COALESCE("product_category",CASE WHEN "fro"=\'F\' THEN \'FINISHED\' ELSE \'RAW\' END))=$'+args.length);}
      const terms:string[]=[];
      for(const col of ["name","code","hsn_code","chassis_item_code","umrn_code"]){
        if(cols.has(col)){args.push("%"+search+"%");terms.push('"'+col+'" ILIKE $'+args.length);}
      }
      if(terms.length)where.push("("+terms.join(" OR ")+")");
      const whereSql=where.length?" WHERE "+where.join(" AND "):"";
      const total=await pool.query('SELECT COUNT(*)::int AS n FROM "product"'+whereSql,args);
      const offset=(page-1)*per;
      const rows=await pool.query('SELECT *,COALESCE(NULLIF(product_category,\'\'),CASE WHEN fro=\'F\' THEN \'FINISHED\' ELSE \'RAW\' END) AS category FROM "product"'+whereSql+" ORDER BY id DESC LIMIT $"+(args.length+1)+" OFFSET $"+(args.length+2),[...args,per,offset]);
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
      const base="SELECT dc.*,d.name AS dealer_name,d.code AS dealer_code,d.mobile AS dealer_mobile,d.gst_no AS dealer_gst_no,COALESCE(NULLIF(to_jsonb(dc)->>'product_name',''),v.model_name) AS product_name,COALESCE(NULLIF(to_jsonb(dc)->>'chassis_no',''),v.chassis_no) AS chassis_no,COALESCE(NULLIF(to_jsonb(dc)->>'motor_no',''),v.motor_no) AS motor_no,COALESCE(NULLIF(to_jsonb(dc)->>'colour',''),v.colour) AS colour,COALESCE(to_jsonb(dc)->>'controller_no','') AS controller_no,COALESCE(to_jsonb(dc)->>'other','') AS other,COALESCE(to_jsonb(dc)->>'remarks1','') AS remarks1,COALESCE(to_jsonb(dc)->>'remarks2','') AS remarks2,COALESCE(to_jsonb(dc)->>'destination','') AS destination,COALESCE(to_jsonb(dc)->>'salesman','') AS salesman,COALESCE(to_jsonb(dc)->>'formula_name','') AS formula_name,v.battery_maker,v.battery_no1,v.battery_no2,v.battery_no3,v.battery_no4,v.umrn_code,COALESCE(to_jsonb(dc)->>'dealer_page_no','') AS dealer_page_no,ti.bill_no,COALESCE(ti.sale_amount,0) AS sale_value FROM delivery_challan dc LEFT JOIN dealer d ON d.id=dc.dealer_id LEFT JOIN vehicle v ON v.id=dc.vehicle_id LEFT JOIN LATERAL (SELECT * FROM tax_invoice x WHERE x.delivery_challan_id=dc.id AND COALESCE(x.cancelled,false)=false ORDER BY x.id DESC LIMIT 1) ti ON true";
      const all=await pool.query(base+" WHERE "+w.join(" AND ")+" ORDER BY dc.date DESC,dc.id DESC",args);
      const rows=all.rows.map((x:any)=>({...x,battery_name:[x.battery_maker,x.battery_no1,x.battery_no2,x.battery_no3,x.battery_no4].filter(Boolean).join(" ")}));
      const products=[...new Set(rows.map((x:any)=>String(x.product_name||"").trim()).filter(Boolean))].sort();
      const dealers=[...new Map(rows.map((x:any)=>[String(x.dealer_id||"")+"::"+String(x.dealer_name||""),{id:x.dealer_id,name:x.dealer_name}]).filter(([k,v]:any)=>v.id||v.name))].map(([k,v]:any)=>v).sort((a:any,b:any)=>String(a.name).localeCompare(String(b.name)));
      const salesmen=[...new Set(rows.map((x:any)=>String(x.salesman||"").trim()).filter(Boolean))].sort();
      const batteries=[...new Set(rows.map((x:any)=>String(x.battery_maker||"").trim()).filter(Boolean))].sort();
      const page=Math.max(1,num(u.searchParams.get("page"))||1),per=Math.min(200,Math.max(1,num(u.searchParams.get("per_page"))||100)),start=(page-1)*per;
      if(u.searchParams.get("export")==="csv")return csvResponse(rows,"Delivery_Challan_Register.csv");
      return Response.json({rows:rows.slice(start,start+per),page,per_page:per,total:rows.length,total_pages:Math.max(1,Math.ceil(rows.length/per)),filters:{product:products,dealer:dealers,salesman:salesmen,battery:batteries}});
    }
    if(p==="delivery-challans" || p==="dealer/delivery-challans"){
      const u=new URL(req.url),page=Math.max(1,num(u.searchParams.get("page"))||1),per=Math.min(200,Math.max(1,num(u.searchParams.get("per_page"))||50)),search=String(u.searchParams.get("search")||"").trim();
      const dcCols=await columns("delivery_challan");
      if(!dcCols.size)return Response.json({error:"Delivery Challan table not found."},{status:404});
      const args:any[]=[]; const where:string[]=[];
      if(dcCols.has("cancelled"))where.push("COALESCE(dc.cancelled,false)=false");
      if(a.scope==="dealer" && dcCols.has("dealer_id")){args.push(num(a.dealer_id));where.push("dc.dealer_id=$"+args.length);}
      if(search){
        const terms:string[]=[];
        for(const col of ["challan_no","chassis_no","product_name"]){if(dcCols.has(col)){args.push("%"+search+"%");terms.push("dc."+col+" ILIKE $"+args.length);}}
        if(dcCols.has("dealer_id")){args.push("%"+search+"%");terms.push("d.name ILIKE $"+args.length);}
        if(terms.length)where.push("("+terms.join(" OR ")+")");
      }
      const whereSql=where.length?" WHERE "+where.join(" AND "):"";
      const total=await pool.query("SELECT COUNT(*)::int AS n FROM delivery_challan dc LEFT JOIN dealer d ON d.id=dc.dealer_id"+whereSql,args);
      const dealerExpr=dcCols.has("dealer_name") ? "COALESCE(NULLIF(dc.dealer_name,''),d.name)" : "d.name";
      const rows=await pool.query("SELECT dc.*,"+dealerExpr+" AS dealer_name,EXISTS (SELECT 1 FROM tax_invoice ti WHERE ti.delivery_challan_id=dc.id) AS invoiced,(SELECT ti.bill_no FROM tax_invoice ti WHERE ti.delivery_challan_id=dc.id ORDER BY ti.id DESC LIMIT 1) AS bill_no FROM delivery_challan dc LEFT JOIN dealer d ON d.id=dc.dealer_id"+whereSql+" ORDER BY dc.date DESC,dc.id DESC LIMIT "+per+" OFFSET "+((page-1)*per),args);
      const available=await pool.query("SELECT * FROM vehicle WHERE stage='Manufacturing' ORDER BY date DESC,id DESC LIMIT 2000");
      await ensureDispatchSchema();
      const dispatch=await pool.query("SELECT p.*,COALESCE(NULLIF(p.product_category,''),CASE WHEN p.fro='F
