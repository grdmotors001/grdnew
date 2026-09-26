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
async function ensureCreditDebitSchema(){
  await pool.query(`CREATE TABLE IF NOT EXISTS credit_note (id bigserial PRIMARY KEY,date date NOT NULL DEFAULT CURRENT_DATE,credit_note_no text,tax_invoice_id integer,delivery_challan_id integer,original_bill_no text,dealer_name text,buyer_name text,chassis_no text,taxable_amount numeric NOT NULL DEFAULT 0,tax_amount numeric NOT NULL DEFAULT 0,total_amount numeric NOT NULL DEFAULT 0,reason text,remarks text,created_at timestamptz NOT NULL DEFAULT now())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS debit_note (id bigserial PRIMARY KEY,date date NOT NULL DEFAULT CURRENT_DATE,debit_note_no text,party_name text,party_gst_no text,party_state_code text,original_bill_no text,reason text,remarks text,taxable_amount numeric NOT NULL DEFAULT 0,tax_amount numeric NOT NULL DEFAULT 0,total_amount numeric NOT NULL DEFAULT 0,items jsonb NOT NULL DEFAULT '[]'::jsonb,created_at timestamptz NOT NULL DEFAULT now())`);
  const defs:any={credit_note:{credit_note_no:"text",tax_invoice_id:"integer",delivery_challan_id:"integer",original_bill_no:"text",dealer_name:"text",buyer_name:"text",chassis_no:"text",taxable_amount:"numeric NOT NULL DEFAULT 0",tax_amount:"numeric NOT NULL DEFAULT 0",total_amount:"numeric NOT NULL DEFAULT 0",reason:"text",remarks:"text"},debit_note:{debit_note_no:"text",party_name:"text",party_gst_no:"text",party_state_code:"text",original_bill_no:"text",reason:"text",remarks:"text",taxable_amount:"numeric NOT NULL DEFAULT 0",tax_amount:"numeric NOT NULL DEFAULT 0",total_amount:"numeric NOT NULL DEFAULT 0",items:"jsonb NOT NULL DEFAULT '[]'::jsonb"}};
  for(const table of Object.keys(defs)) for(const [col,type] of Object.entries(defs[table])) await pool.query('ALTER TABLE "'+table+'" ADD COLUMN IF NOT EXISTS "'+col+'" '+type);
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

export async function GET(req:Request,{params}:{params:Promise<{path?:string[]}>}){
  try{
    const {path=[]}=await params,p=path.join("/");
    if(p==="health")return Response.json({status:"ok",backend:"node",python:false});
    const a=auth(req);if(!a)return Response.json({error:"Authentication required."},{status:401});
    if(!canRead(a,p))return Response.json({error:"Forbidden."},{status:403});
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
    if(p==="hr/employees"){
      await ensureHRSchemas();
      const r=await pool.query("INSERT INTO hr_employee (employee_code,name,department,designation,mobile,photo_url,joining_date,machine_user_id,basic_salary,hra,other_allowance,overtime_rate) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *",[String(b.employee_code||"").trim(),String(b.name||"").trim(),b.department||null,b.designation||null,b.mobile||null,b.photo_url||null,b.joining_date||null,b.machine_user_id||null,num(b.basic_salary),num(b.hra),num(b.other_allowance),num(b.overtime_rate)]);
      return Response.json({success:true,employee:r.rows[0],row:r.rows[0]},{status:201});
    }
    if(p==="hr/salary/process"){
      await ensureHRSchemas();
      const month=String(b.month||"").trim(); if(!/^\\d{4}-\\d{2}$/.test(month))return Response.json({error:"Valid salary month is required."},{status:400});
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
        pool.query("SELECT dc.id,dc.date,dc.challan_no,COALESCE(NULLIF(dc.product_name,''),v.model_name) AS model_name,COALESCE(NULLIF(dc.dealer_name,''),d.name) AS dealer_name,COALESCE(NULLIF(dc.chassis_no,''),v.chassis_no) AS chassis_no,TRIM(CONCAT_WS(' ',NULLIF(v.battery_maker,''),NULLIF(v.battery_no1,''),NULLIF(v.battery_no2,''),NULLIF(v.battery_no3,''),NULLIF(v.battery_no4,''))) AS battery_name FROM delivery_challan dc LEFT JOIN dealer d ON d.id=dc.dealer_id LEFT JOIN vehicle v ON v.id=dc.vehicle_id WHERE dc.date::date=CURRENT_DATE AND COALESCE(dc.cancelled,false)=false ORDER BY dc.date DESC,dc.id DESC LIMIT 100"),
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
    if(p==="dealer/cash-book/customers"&&a.scope==="dealer"){
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
      const r=await pool.query("SELECT * FROM dealer_cash_customer WHERE dealer_id=$1 AND UPPER(COALESCE(status,''))<>'DEALER_CANCEL' ORDER BY id DESC LIMIT 1000",[num(a.dealer_id)]);
      const customers=r.rows.map((x:any)=>({...x,phone:x.phone||x.customer_phone||"",balance:Math.max(0,Number(x.sale_amount||0)-Number(x.loan_amount||0)-Number(x.paid_amount||0))}));
      return Response.json({customers,rows:customers,count:customers.length});
    }
    if(p==="dealer/incentive-record"&&a.scope==="dealer"){
      const r=await pool.query("SELECT id,date,bill_no,buyer_name AS customer_name,chassis_no,product_name AS model,COALESCE(incentive_amount,0) AS incentive_amount,incentive_voucher_no,incentive_date FROM tax_invoice WHERE dealer_id=$1 AND COALESCE(cancelled,false)=false AND COALESCE(incentive_amount,0)>0 ORDER BY date DESC,id DESC",[num(a.dealer_id)]);
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
      return Response.json({vehicles:[],count:0,status:"HOLD"});
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
    if(p==="admin/nav-tabs"){
      const label=String(b.label||"").trim(); if(!label)return Response.json({error:"Tab name is required."},{status:400});
      const existing=await pool.query("SELECT key FROM nav_tab"); const keys=new Set(existing.rows.map((x:any)=>String(x.key)));
      let key=String(b.key||"").trim(); if(!key||keys.has(key)){key=label.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"")||"custom-tab"; let i=2; while(keys.has(key))key=key+"-"+i++;}
      const max=await pool.query("SELECT COALESCE(MAX(position),0)::int AS n FROM nav_tab");
      const r=await pool.query("INSERT INTO nav_tab (key,label,icon,position,hidden,items) VALUES ($1,$2,$3,$4,false,$5) RETURNING *",[key,label,b.icon||null,Number(max.rows[0]?.n||0)+1,Array.isArray(b.items)?b.items:[]]);
      return Response.json(r.rows[0],{status:201});
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
    if(a.scope==="dealer" && p==="dealer/cash-book/receipt"){
      const did=num(a.dealer_id),type=String(b.receipt_type||"new_booking"),customerId=idOf(b.customer_id),date=b.date||null;
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
        }else{
          const input:any={dealer_id:did,name:String(b.customer_name||"").trim(),phone:String(b.customer_phone||"").trim(),customer_phone:String(b.customer_phone||"").trim(),page_no:String(b.dealer_register_page_no||"").trim()||null,vehicle_no:String(b.booking_for||"new").trim(),sale_amount:num(b.sale_amount),loan_amount:num(b.loan_amount),paid_amount:num(b.amount),status:"VEHICLE_PENDING",date:date||null};
          const keys=Object.keys(input).filter(k=>cc.has(k));
          if(!input.name||!input.phone)throw new Error("Customer name and mobile are required.");
          if(!keys.length)throw new Error("Customer register schema is missing required fields.");
          const rr=await client.query('INSERT INTO dealer_cash_customer ('+keys.map(k=>'"'+k+'"').join(",")+') VALUES ('+keys.map((_,i)=>"$"+(i+1)).join(",")+') RETURNING *',keys.map(k=>input[k]));
          cid=rr.rows[0].id;
        }
        const input:any={dealer_id:did,customer_id:cid,date:date||null,receipt_type:type,customer_name:String(b.customer_name||"").trim()||null,customer_phone:String(b.customer_phone||"").trim()||null,dealer_register_page_no:String(b.dealer_register_page_no||"").trim()||null,sale_amount:num(b.sale_amount),loan_amount:num(b.loan_amount),amount:num(b.amount),payment_mode:String(b.payment_mode||"cash"),reference_no:String(b.reference_no||"").trim()||null,remarks:String(b.remarks||"").trim()||null,request_id:String(b.request_id||"").trim()||null,receipt_no:"RC-"+Date.now()};
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
      const dispatch=await pool.query("SELECT p.*,COALESCE(NULLIF(p.product_category,''),CASE WHEN p.fro='F' THEN 'FINISHED' ELSE 'RAW' END) AS category,COALESCE(p.show_on_delivery_challan,false) AS show_on_delivery_challan,COALESCE(s.qty,0) AS stock_qty FROM product p LEFT JOIN (SELECT item_name,SUM(CASE WHEN UPPER(COALESCE(work_type,''))='IN' THEN qty ELSE -qty END) qty FROM journal_stock GROUP BY item_name) s ON lower(trim(s.item_name))=lower(trim(p.name)) WHERE UPPER(COALESCE(NULLIF(p.product_category,''),CASE WHEN p.fro='F' THEN 'FINISHED' ELSE 'RAW' END))='DISPATCH' AND COALESCE(p.show_on_delivery_challan,false)=true ORDER BY p.name");
      const totalCount=Number(total.rows[0]?.n||0);
      return Response.json({rows:rows.rows,challans:rows.rows,data:rows.rows,page,per_page:per,total:totalCount,total_pages:Math.max(1,Math.ceil(totalCount/per)),available_vehicles:available.rows,dispatch_items:dispatch.rows,suggested_challan_no:"DC-"+Date.now()});
    }
    if(p==="purchase-bills"){
      const r=await genericGet(req,path,"purchase_bill"),payload=await r.json(),rows=(payload.rows||[]).map((x:any)=>({...x,items:parseItems(x.items)}));
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
  }catch(e:any){console.error("[node-api GET]",e);return Response.json({error:e.message||"Internal server error"},{status:500})}
}

export async function POST(req:Request,{params}:{params:Promise<{path?:string[]}>}){
  try{
    const {path=[]}=await params,p=path.join("/");
    if(p==="health")return Response.json({status:"ok",backend:"node",python:false});
    const a=auth(req);if(!a)return Response.json({error:"Authentication required."},{status:401});
    if(!canWrite(a,p))return Response.json({error:"Forbidden."},{status:403});
    const b:any=await json(req);
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
      const grossTaxable=num(b.gst_sale_amount||b.sale_amount);
      const discount=Math.max(0,num(b.discount));
      const taxable=Math.max(0,grossTaxable-discount);
      const rate=num(b.gst_rate);
      // Seller state is authoritative company data; never trust a client-supplied seller state.
      const companyState=await pool.query("SELECT state_code FROM company ORDER BY id LIMIT 1");
      const sellerStateCode=String(companyState.rows[0]?.state_code||"").trim();
      const buyerStateCode=String(b.buyer_state_code||"").trim();
      const stateType=String(b.state_type||"").trim().toUpperCase();
      const sameState=stateType==="I" || stateType==="INTRA" || (!stateType && !!sellerStateCode && sellerStateCode===buyerStateCode);
      const gst=taxable*rate/100;
      const r=await pool.query("INSERT INTO tax_invoice (bill_no,date,cancelled,delivery_challan_id,dealer_id,vehicle_id,buyer_name,buyer_gst_no,buyer_state,buyer_state_code,state_type,product_name,chassis_no,motor_no,sale_amount,gst_sale_amount,gst_rate,discount,insurance_amount,registration_amount,amount_received,subsidy_amount,created_at) VALUES (COALESCE(NULLIF($1,''),'INV-'||extract(epoch from now())::bigint),COALESCE($2::timestamptz,NOW()),false,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,NOW()) RETURNING *",
        [String(b.bill_no||""),b.date||null,num(b.delivery_challan_id)||null,num(b.dealer_id)||null,num(b.vehicle_id)||null,b.buyer_name||null,b.buyer_gst_no||null,b.buyer_state||null,b.buyer_state_code||null,b.state_type||null,b.product_name||null,b.chassis_no||null,b.motor_no||null,num(b.sale_amount),taxable,rate,num(b.discount),num(b.insurance_amount),num(b.registration_amount),num(b.amount_received),num(b.subsidy_amount)]);
      if(num(b.vehicle_id)) await pool.query("UPDATE vehicle SET stage='Tax Invoice',dealer_name=COALESCE($1,dealer_name) WHERE id=$2",[b.dealer_name||null,num(b.vehicle_id)]);
      return Response.json({success:true,row:r.rows[0],data:r.rows[0],gst:{rate,amount:gst,cgst:sameState?gst/2:0,sgst:sameState?gst/2:0,igst:sameState?0:gst}},{status:201});
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
      const id=idOf(path[path.length-2]); const r=await pool.query("SELECT * FROM tax_invoice WHERE id=$1",[id]);
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
    if(p==="dealer/submit-loan"){
      const did=a.scope==="dealer"?num(a.dealer_id):num(b.dealer_id);
      const r=await pool.query("INSERT INTO loan_workflow (application_no,dealer_id,customer_id,status,loan_amount,loan_model_name,loan_vehicle_type,created_at,updated_at) VALUES (COALESCE(NULLIF($1,''),'APP-'||extract(epoch from now())::bigint),$2,$3,'SUBMITTED',$4,$5,$6,NOW(),NOW()) RETURNING *",
        [String(b.application_no||""),did,num(b.customer_id),num(b.loan_amount),b.loan_model_name||null,b.loan_vehicle_type||"new"]);
      return Response.json({success:true,application:r.rows[0]},{status:201});
    }
    if(a.scope==="dealer" && p==="dealer/cash-book/receipt"){
      const did=num(a.dealer_id),type=String(b.receipt_type||"new_booking"),customerId=idOf(b.customer_id),date=b.date||null;
      const cc=await columns("dealer_cash_customer"),rc=await columns("dealer_cash_receipt");
      if(!cc.size||!rc.size)return Response.json({error:"Cash receipt tables are not available."},{status:500});
      const client=await pool.connect();
      try{
        await client.query("BEGIN");let cid=customerId;
        if(type==="balance_payment"){
          if(!cid)throw new Error("Previous customer is required.");
          const chk=await client.query("SELECT * FROM dealer_cash_customer WHERE id=$1 AND dealer_id=$2 FOR UPDATE",[cid,did]);
          if(!chk.rowCount)throw new Error("Customer not found.");
        }else{
          const input:any={dealer_id:did,name:String(b.customer_name||"").trim(),phone:String(b.customer_phone||"").trim(),customer_phone:String(b.customer_phone||"").trim(),page_no:String(b.dealer_register_page_no||"").trim()||null,vehicle_no:String(b.booking_for||"new").trim(),sale_amount:num(b.sale_amount),loan_amount:num(b.loan_amount),paid_amount:num(b.amount),status:"VEHICLE_PENDING",date:date||null};
          const keys=Object.keys(input).filter(k=>cc.has(k));if(!input.name||!input.phone)throw new Error("Customer name and mobile are required.");if(!keys.length)throw new Error("Customer register schema is missing required fields.");
          const rr=await client.query('INSERT INTO dealer_cash_customer ('+keys.map(k=>'"'+k+'"').join(",")+') VALUES ('+keys.map((_,i)=>"$"+(i+1)).join(",")+') RETURNING *',keys.map(k=>input[k]));cid=rr.rows[0].id;
        }
        const input:any={dealer_id:did,customer_id:cid,date:date||null,receipt_type:type,customer_name:String(b.customer_name||"").trim()||null,customer_phone:String(b.customer_phone||"").trim()||null,dealer_register_page_no:String(b.dealer_register_page_no||"").trim()||null,sale_amount:num(b.sale_amount),loan_amount:num(b.loan_amount),amount:num(b.amount),payment_mode:String(b.payment_mode||"cash"),reference_no:String(b.reference_no||"").trim()||null,remarks:String(b.remarks||"").trim()||null,request_id:String(b.request_id||"").trim()||null,receipt_no:"RC-"+Date.now()};
        const keys=Object.keys(input).filter(k=>rc.has(k));if(!keys.length)throw new Error("Cash receipt schema is missing required fields.");
        const rr=await client.query('INSERT INTO dealer_cash_receipt ('+keys.map(k=>'"'+k+'"').join(",")+') VALUES ('+keys.map((_,i)=>"$"+(i+1)).join(",")+') RETURNING *',keys.map(k=>input[k]));
        if(type==="balance_payment"){const cust=await client.query("SELECT * FROM dealer_cash_customer WHERE id=$1 FOR UPDATE",[cid]);const paid=Number(cust.rows[0]?.paid_amount||0)+num(b.amount);await client.query("UPDATE dealer_cash_customer SET paid_amount=$1 WHERE id=$2",[paid,cid]);}
        await client.query("COMMIT");return Response.json({success:true,receipt:rr.rows[0]},{status:201});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    if(a.scope==="dealer" && p==="battery-withdrawal"){
      const did=num(a.dealer_id),batteryNo=String(b.battery_no||"").trim();
      if(!batteryNo)return Response.json({error:"Battery No. is required."},{status:400});
      const r=await pool.query("INSERT INTO battery_stock_movement (date,dealer_id,battery_maker,battery_no,reference_no,movement_type,created_at) VALUES (COALESCE($1::date,CURRENT_DATE),$2,$3,$4,$5,'withdrawal',NOW()) RETURNING *",[b.date||null,did,String(b.battery_maker||"").trim()||null,batteryNo,String(b.reference_no||"").trim()||null]);
      return Response.json({success:true,row:r.rows[0],data:r.rows[0]},{status:201});
    }
    if(a.scope==="dealer" && p==="battery-addition"){
      const did=num(a.dealer_id),vehicleId=idOf(b.vehicle_id),batteryNo=String(b.battery_no||"").trim();
      if(!vehicleId||!batteryNo)return Response.json({error:"Vehicle and Battery No. are required."},{status:400});
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        const dr=await client.query("SELECT name FROM dealer WHERE id=$1",[did]);if(!dr.rowCount)throw new Error("Dealer not found.");
        const vr=await client.query("SELECT * FROM vehicle WHERE id=$1 AND stage='Delivery Challan' AND lower(trim(COALESCE(dealer_name,'')))=lower(trim($2)) FOR UPDATE",[vehicleId,dr.rows[0].name]);if(!vr.rowCount)throw new Error("Vehicle not found in this dealer's stock.");
        const available=await client.query("SELECT battery_maker,battery_no FROM battery_stock_movement WHERE dealer_id=$1 AND movement_type IN ('withdrawal','delivery') AND upper(trim(battery_no))=upper(trim($2)) AND NOT EXISTS (SELECT 1 FROM battery_stock_movement x WHERE x.dealer_id=$1 AND x.movement_type='addition' AND upper(trim(x.battery_no))=upper(trim($2))) LIMIT 1",[did,batteryNo]);
        if(!available.rowCount)throw new Error("Battery is not available in dealer battery stock.");
        const position=Math.min(4,Math.max(1,Number(b.position)||1)),field="battery_no"+position,maker=String(b.battery_maker||available.rows[0].battery_maker||"").trim()||null;
        await client.query('UPDATE vehicle SET battery_maker=$1,"'+field+'"=$2 WHERE id=$3',[maker,batteryNo,vehicleId]);
        const mv=await client.query("INSERT INTO battery_stock_movement (date,dealer_id,battery_maker,battery_no,reference_no,movement_type,created_at) VALUES (COALESCE($1::date,CURRENT_DATE),$2,$3,$4,$5,'addition',NOW()) RETURNING *",[b.date||null,did,maker,batteryNo,String(b.reference_no||"").trim()||null]);
        await client.query("COMMIT");return Response.json({success:true,row:mv.rows[0],vehicle_id:vehicleId,battery_no:batteryNo},{status:201});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    if(p==="billing/vehicle-inventory/download-txt"){
      const ids=Array.isArray(b.invoice_ids)?b.invoice_ids.map((x:any)=>idOf(x)).filter(Boolean):[];
      if(!ids.length)return new Response("No invoices selected.",{status:400,headers:{"Content-Type":"text/plain;charset=utf-8"}});
      const r=await pool.query("SELECT ti.date,ti.buyer_name,COALESCE(v.model_name,ti.product_name,'') AS model_name,v.chassis_no,v.motor_no,COALESCE(to_jsonb(v)->>'umrn','') AS umrn,COALESCE(to_jsonb(v)->>'manufacturing_month','') AS manufacturing_month,COALESCE(v.colour_code,'') AS colour_code FROM tax_invoice ti LEFT JOIN vehicle v ON v.id=ti.vehicle_id WHERE ti.id=ANY($1::int[]) ORDER BY ti.date,ti.id",[ids]);
      const dateNow=new Date(),dd=String(dateNow.getDate()).padStart(2,"0"),mm=String(dateNow.getMonth()+1).padStart(2,"0"),yy=String(dateNow.getFullYear()).slice(-2);
      const day=["sun","mon","tue","wed","thu","fri","sat"][dateNow.getDay()],fileName=day+dd+mm+yy+".txt";
      const monthNumber=(v:any)=>{const s=String(v??"").trim();if(!s)return "";const direct=s.match(/^(\\d{1,2})[\\/-](\\d{4})$/);if(direct)return String(Number(direct[1])).padStart(2,"0")+direct[2];const y=s.match(/(20\\d{2})/),m=s.match(/(?:^|[^a-z])(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(?:[^a-z]|$)/i);if(y&&m){const names=["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];return String(names.indexOf(m[1].toLowerCase())+1).padStart(2,"0")+y[1];}const d=s.match(/(20\\d{2})[-/](\\d{1,2})/);return d?String(Number(d[2])).padStart(2,"0")+d[1]:s.replace(/[^A-Za-z0-9]/g,"").slice(0,6);};
      const lines=r.rows.map((x:any)=>[x.umrn||"",x.chassis_no||"",monthNumber(x.manufacturing_month),x.colour_code||"","GRD","NA"].map((v:any)=>String(v).replace(/[|\\r\\n]/g,"")).join("|"));
      return new Response(lines.join("\\r\\n"),{headers:{"Content-Type":"text/plain;charset=utf-8","Content-Disposition":"attachment; filename=\""+fileName+"\""}});
    }
    const table=tableFor(path);
    if(table)return genericWrite(req,path,table,"POST");
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
      const id=idOf(path[path.length-2]); const r=await pool.query("SELECT * FROM tax_invoice WHERE id=$1",[id]);
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
+args.length)}
    }
    if(where.length)sql+=(sql.includes(" WHERE ")?" AND ":" WHERE ")+where.join(" AND ");
  }
  sql+=" ORDER BY id DESC LIMIT 1000";
  const r=await pool.query(sql,args);
  return Response.json({rows:r.rows,data:r.rows,items:r.rows,count:r.rowCount,
    ...(table==="dealer"?{dealers:r.rows}:{}),
    ...(table==="customer"?{customers:r.rows}:{}),
    ...(table==="loan_workflow"?{applications:r.rows}:{}),
    ...(table==="simple_master"?{masters:r.rows}:{})
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
