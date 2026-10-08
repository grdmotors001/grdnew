import { salesmanMasterList, salesmanMasterWrite } from "../../../lib/server/salesman-master";
import { types } from "pg";
import { pool, secret, auth, num, idOf, ymd, columns, addColumns, dateWhere, json, normKey, rowGetter, importDate, importAmount } from "../../../lib/server/common";
import { ensureTaxInvoiceRecordColumns, saleRegisterReport, paymentReceivableReport } from "../../../lib/server/reports-sales";
import { actionFor, audit, assignedDealerIds, isSalesman, enforceDealerScope, dealerReadFilter, actionAllowed, ensureSecuritySchema, isAdmin, canRead, canWrite } from "../../../lib/server/permissions";
import { expenseVoucherGet, expenseVoucherPost, expenseVoucherDelete } from "../../../lib/server/expense-voucher";
import { bankLedgerGet, bankLedgerPost, bankLedgerMutation, ensureBankLedgerSchema } from "../../../lib/server/bank-ledger";
import { insuranceRtoGet, insuranceRtoPost, insuranceRtoMutation } from "../../../lib/server/insurance-rto";
import { reportsGet } from "../../../lib/server/reports";
import { productionGet, productionPost, productionMutation } from "../../../lib/server/production";
import { ensureDealerCashSchema, dealerCashPosition, enrichCashCustomers, dealerCashbookGet, dealerCashbookPost, dealerCashbookMutation, cashbookAdminGet, cashbookAdminPost } from "../../../lib/server/dealer-cashbook";
import { ensureLoanWorkflowBridgeSchema, chfplBridge, loanGet, loanWebhookPost, loanPost } from "../../../lib/server/loan";
import { ensureBatteryRegisterSchema, ensureBatteryFitSchema, assertBatterySerialsAvailable, toggleBatteryRegisterForDelivery, batteryGet, batteryPost, batteryMutation } from "../../../lib/server/battery";
import { ensureBillingSalesSchema, upsertBillingCustomer, billingGet, billingPost, billingMutation } from "../../../lib/server/billing";
import { TI_TAXABLE, taxInvoiceGet, taxInvoicePost, taxInvoiceMutation } from "../../../lib/server/tax-invoice";
import { dealerInvoicePost } from "../../../lib/server/dealer-invoice";
import { deliveryChallanGet, deliveryChallanPost, deliveryChallanMutation } from "../../../lib/server/delivery-challan";
import { gstHypSubsidyReport, hypothecationGet, hypothecationPost, hypothecationMutation, ensureTaxInvoiceVehicleNoColumn } from "../../../lib/server/gst-hypothecation";
export const dynamic="force-dynamic";
export const runtime="nodejs";
const snake=(s:string)=>s.replace(/[A-Z]/g,m=>"_"+m.toLowerCase()).replace(/^_/,"");

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
// Postgres unique violation (23505) -> 500 ki jagah 409 + saaf message ("Dealer code 'X' already exists").
function dupKeyResponse(e:any):Response|null{
  if(!e||e.code!=="23505")return null;
  const m=String(e.detail||"").match(/Key \(([^)]+)\)=\(([^)]*)\) already exists/i);
  const label=m?m[1].split(",").map((x:string)=>x.trim().replace(/_/g," ")).join(" + "):"value";
  const msg=m?`${label.charAt(0).toUpperCase()+label.slice(1)} '${m[2]}' already exists. Please use a different value.`:"This record already exists (duplicate value).";
  return Response.json({error:msg,code:"duplicate",constraint:e.constraint||null},{status:409});
}
// pg returns DATE columns as JS Date objects; String(Date).slice(0,10) gives "Mon Sep 28" (invalid for ::date). Always use ymd().
// Import helpers (normKey/rowGetter/importDate/importAmount) ab lib/server/common.ts me hain.
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

let dispatchSchemaReady:Promise<void>|null=null;
// Ek hi baar chalta hai. Pehle har call par ALTER TABLE pool se chalta tha; challan transaction ke andar wo lock me atak kar request hang kar deta tha.
function ensureDispatchSchema():Promise<void>{
  if(!dispatchSchemaReady){
    dispatchSchemaReady=(async()=>{
  await pool.query("ALTER TABLE delivery_challan ADD COLUMN IF NOT EXISTS formula_name text");
  await pool.query("ALTER TABLE product ADD COLUMN IF NOT EXISTS product_category text");
  await pool.query("ALTER TABLE product ADD COLUMN IF NOT EXISTS show_on_delivery_challan boolean NOT NULL DEFAULT false");
  await pool.query("CREATE TABLE IF NOT EXISTS delivery_challan_item (id bigserial PRIMARY KEY, delivery_challan_id integer NOT NULL REFERENCES delivery_challan(id) ON DELETE CASCADE, product_id integer NOT NULL REFERENCES product(id), product_name text NOT NULL, qty numeric NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(delivery_challan_id, product_id))");
    })().catch((e:any)=>{dispatchSchemaReady=null;throw e});
  }
  return dispatchSchemaReady;
}
let notificationSchemaReady:Promise<void>|null=null;
function ensureNotificationSchema():Promise<void>{
  if(!notificationSchemaReady){notificationSchemaReady=ensureNotificationSchemaOnce().catch((e:any)=>{notificationSchemaReady=null;throw e});}
  return notificationSchemaReady;
}
async function ensureNotificationSchemaOnce(){
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
let oldRickshawLegacySchemaReady:Promise<void>|null=null;
function ensureOldRickshawLegacySchema():Promise<void>{
  if(!oldRickshawLegacySchemaReady){
    oldRickshawLegacySchemaReady=ensureOldRickshawLegacySchemaOnce().catch((e:any)=>{oldRickshawLegacySchemaReady=null;throw e});
  }
  return oldRickshawLegacySchemaReady;
}
async function ensureOldRickshawLegacySchemaOnce(){
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
  await addColumns("old_rickshaw",defs);
}
let oldRickshawInventorySchemaReady:Promise<void>|null=null;
function ensureOldRickshawInventorySchema():Promise<void>{
  if(!oldRickshawInventorySchemaReady){
    oldRickshawInventorySchemaReady=ensureOldRickshawInventorySchemaOnce().catch((e:any)=>{oldRickshawInventorySchemaReady=null;throw e});
  }
  return oldRickshawInventorySchemaReady;
}
async function ensureOldRickshawInventorySchemaOnce(){
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
    do_number:"text",ledger_no:"text",source:"text NOT NULL DEFAULT 'CHFPL'",source_ref:"text",
    sale_date:"date",chfpl_sale_synced:"boolean NOT NULL DEFAULT false",chfpl_sale_sync_error:"text"
  };
  await addColumns("old_rickshaw_inventory",defs);
  await pool.query("CREATE INDEX IF NOT EXISTS old_rickshaw_inventory_status_idx ON old_rickshaw_inventory(status)");
  await pool.query("CREATE INDEX IF NOT EXISTS old_rickshaw_inventory_dealer_idx ON old_rickshaw_inventory(dealer_id)");
  await pool.query(`CREATE TABLE IF NOT EXISTS old_rickshaw_challan (
    id bigserial PRIMARY KEY,date date NOT NULL DEFAULT CURRENT_DATE,challan_no text UNIQUE,model_name text,vehicle_no text,colour text,toolkit text,
    dealer_id integer,source text NOT NULL DEFAULT 'CHFPL',source_ref text,status text NOT NULL DEFAULT 'ACTIVE',created_at timestamptz NOT NULL DEFAULT now()
  )`);
  const cdefs:any={date:"date",challan_no:"text",model_name:"text",vehicle_no:"text",colour:"text",toolkit:"text",dealer_id:"integer",source:"text NOT NULL DEFAULT 'CHFPL'",source_ref:"text",status:"text NOT NULL DEFAULT 'ACTIVE'",
    inventory_id:"integer",old_rickshaw_id:"integer",salesman:"text",ledger_date:"date",chassis_no:"text",battery_name:"text",charger:"text",
    mat_yn:"text",jack_yn:"text",centre_lock_yn:"text",big_mirror_yn:"text",colour_yn:"text",toolkit_yn:"text",stepney_yn:"text"};
  await addColumns("old_rickshaw_challan",cdefs);
  const odefs:any={
    dealer_id:"integer",dealer_name:"text",challan_no:"text",sp_no:"text",challan_date:"date",customer_name:"text",
    sale_amount:"numeric NOT NULL DEFAULT 0",loan_amount:"numeric NOT NULL DEFAULT 0",balance_amount:"numeric NOT NULL DEFAULT 0",
    file_charge:"numeric NOT NULL DEFAULT 0",do_number:"text",ledger_no:"text",sale_date:"date"
  };
  await addColumns("old_rickshaw",odefs);
}
// old_rickshaw table purani DB me alag types ke saath ban chuki ho sakti hai (jaise record_no integer).
// Isliye insert/update se pehle value ko column type ke hisaab se theek karte hain: integer column me "OR-1" ki jagah 1.
async function fitOldRickshaw(obj:any,rowId?:any):Promise<any>{
  const r=await pool.query("SELECT column_name,data_type FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='old_rickshaw'");
  const types=new Map<string,string>(r.rows.map((x:any)=>[x.column_name,String(x.data_type)]));
  const numeric=new Set(["integer","bigint","smallint","numeric","double precision","real"]);
  const out:any={};
  for(const [k,v] of Object.entries(obj)){
    const t=types.get(k);
    if(!t){continue;}
    if(numeric.has(t)&&v!==null&&v!==undefined&&v!==""){
      if(k==="record_no"&&rowId!==undefined&&rowId!==null){out[k]=Number(rowId);continue;}
      const n=Number(String(v).replace(/[^0-9.\-]/g,""));
      if(typeof v==="number"||/^-?\d+(\.\d+)?$/.test(String(v).trim())){out[k]=v;}
      else if(k==="record_no"&&Number.isFinite(n)&&String(v).replace(/\D/g,"")!==""){out[k]=n;}
      // baaki non-numeric value numeric column me nahi jaati (skip)
      continue;
    }
    out[k]=v;
  }
  return out;
}
// ---- CHFPL Repo -> GRD Old Rickshaw sync (webhook) ----
// Repo vehicle "Available for Sale" hote hi: inventory=available, temporary Old Rickshaw Challan (parked dealer ke naam),
// aur old_rickshaw record (dealer ke Old Rickshaw stock + factory Old Rickshaw list dono me dikhta hai).
async function releaseRepoInventory(client:any,inventoryId:number){
  const inv=await client.query("SELECT * FROM old_rickshaw_inventory WHERE id=$1 FOR UPDATE",[inventoryId]);
  const row=inv.rows[0];
  if(!row||row.status==="sold")return row||null;
  const today=new Date().toISOString().slice(0,10);
  const sp=row.sp_no||("SP-"+String(row.id).padStart(6,"0"));
  // Voucher pehle se ACTIVE hai (dobara sync aaya) -> kuch nahi chhedna, dealer stock jaisa hai waisa rahe.
  if(row.status==="available"&&row.challan_no){
    const ac=await client.query("SELECT 1 FROM old_rickshaw_challan WHERE challan_no=$1 AND status='ACTIVE'",[row.challan_no]);
    if(ac.rowCount){
      if(!row.sp_no)await client.query("UPDATE old_rickshaw_inventory SET sp_no=$1,updated_at=now() WHERE id=$2",[sp,inventoryId]);
      return (await client.query("SELECT * FROM old_rickshaw_inventory WHERE id=$1",[inventoryId])).rows[0];
    }
  }
  // Available for Sale = sirf GRD Old Rickshaw Inventory me aati hai. Dealer stock me tab dikhegi jab
  // Factory Old Rickshaw Challan Voucher (dealer ke naam) ban jaye -> isliye yahan dealer_id/challan set nahi hota.
  const oldCols=await columns("old_rickshaw");
  const old:any={date:today,source:"chfpl",record_no:"OR-"+row.id,chfpl_ref_no:row.source_ref||"",vehicle_reg_no:row.vehicle_no,model_name:row.model_name||"",colour:row.colour||"",toolkit:row.toolkit||"",battery_maker:row.battery_maker||"",dealer_id:null,dealer_name:"",challan_no:null,vou_no:null,sp_no:sp,status:"available",repo_date:row.repo_date||null};
  const oldFit=await fitOldRickshaw(old,row.id);
  const keys=Object.keys(oldFit).filter(k=>oldCols.has(k));
  let oldId=row.old_rickshaw_id;
  if(oldId){
    await client.query('UPDATE old_rickshaw SET '+keys.map((k,i)=>'"'+k+'"=$'+(i+1)).join(",")+' WHERE id=$'+(keys.length+1),[...keys.map(k=>oldFit[k]),oldId]);
  }else{
    const ins=await client.query('INSERT INTO old_rickshaw ('+keys.map(k=>'"'+k+'"').join(",")+') VALUES('+keys.map((_,i)=>"$"+(i+1)).join(",")+') RETURNING id',keys.map(k=>oldFit[k]));
    oldId=ins.rows[0].id;
  }
  await client.query("UPDATE old_rickshaw_inventory SET status='available',available_for_sale=true,sp_no=$1,challan_no=NULL,challan_date=NULL,old_rickshaw_id=$2,updated_at=now() WHERE id=$3",[sp,oldId,inventoryId]);
  return (await client.query("SELECT * FROM old_rickshaw_inventory WHERE id=$1",[inventoryId])).rows[0];
}
// CHFPL me "available for sale" wapas hata diya gaya (bika nahi) -> GRD me dobara HOLD, temporary challan cancel.
async function holdRepoInventory(client:any,row:any){
  // Pending / Approved sale chal rahi ho to gaadi wapas HOLD nahi ho sakti.
  if(row.old_rickshaw_id){
    await ensureBillingSalesSchema();
    const ps=await client.query("SELECT id FROM grd_billing_sale WHERE old_rickshaw_id=$1 AND status IN ('PENDING','APPROVED') LIMIT 1",[row.old_rickshaw_id]);
    if(ps.rowCount)throw new Error("Is gaadi par Pending Sale chal rahi hai. Pehle Pending Sale delete karein, phir HOLD karein.");
  }
  await client.query("UPDATE old_rickshaw_inventory SET status='hold',available_for_sale=false,challan_no=NULL,challan_date=NULL,updated_at=now() WHERE id=$1",[row.id]);
  if(row.challan_no)await client.query("UPDATE old_rickshaw_challan SET status='CANCELLED' WHERE challan_no=$1",[row.challan_no]);
  if(row.old_rickshaw_id)await client.query("UPDATE old_rickshaw SET status='hold',dealer_id=NULL,dealer_name='',challan_no=NULL,vou_no=NULL WHERE id=$1",[row.old_rickshaw_id]);
}
async function resolveRepoDealer(v:any){
  const dm=(v&&typeof v.dealer_master==="object"&&v.dealer_master)||{};
  const id=idOf(v.grd_dealer_id??v.dealer_id??dm.grd_dealer_id??dm.dealer_id);
  const code=String(v.dealer_code??dm.dealer_code??"").trim();
  const name=String(v.dealer_name??v.parked_dealer??v.parked_at??dm.dealer_name??"").trim();
  if(id){const r=await pool.query("SELECT id,name FROM dealer WHERE id=$1",[id]);if(r.rowCount)return {id:r.rows[0].id,name:r.rows[0].name,matched:true};}
  if(code){const r=await pool.query("SELECT id,name FROM dealer WHERE lower(trim(code))=lower($1) ORDER BY id LIMIT 1",[code]);if(r.rowCount)return {id:r.rows[0].id,name:r.rows[0].name,matched:true};}
  if(!name||/^grd\s*factory$/i.test(name))return {id:null,name:"GRD Factory",matched:true};
  const r=await pool.query("SELECT id,name FROM dealer WHERE lower(trim(name))=lower(trim($1)) ORDER BY id LIMIT 1",[name]);
  if(r.rowCount)return {id:r.rows[0].id,name:r.rows[0].name,matched:true};
  return {id:null,name,matched:false};
}
// Shared by the CHFPL webhook (push) and the admin "Sync from CHFPL" (pull), so both apply the same rules.
async function applyRepoVehicles(list:any[],b:any,opts:any={}):Promise<any[]>{
      const results:any[]=[];
      for(const v0 of list){
        const v:any={...(b&&!Array.isArray(b.vehicles)&&!b.vehicle?{}:{event:b.event}),...v0};
        const vehicleNo=String(v.vehicle_no||"").trim().toUpperCase();
        const ref=String(v.source_ref??v.id??v.repo_id??"").trim();
        if(!vehicleNo&&!ref){results.push({ok:false,error:"vehicle_no ya id chahiye."});continue;}
        const client=await pool.connect();
        try{
          await client.query("BEGIN");
          let cur=(await client.query("SELECT * FROM old_rickshaw_inventory WHERE source='CHFPL' AND $1<>'' AND source_ref=$1 ORDER BY id LIMIT 1 FOR UPDATE",[ref])).rows[0];
          if(!cur&&vehicleNo)cur=(await client.query("SELECT * FROM old_rickshaw_inventory WHERE upper(trim(vehicle_no))=$1 AND status<>'sold' ORDER BY id DESC LIMIT 1 FOR UPDATE",[vehicleNo])).rows[0];
          if(v.event==="deleted"||v.deleted===true){
            if(cur&&cur.status==="hold")await client.query("DELETE FROM old_rickshaw_inventory WHERE id=$1",[cur.id]);
            await client.query("COMMIT");results.push({ok:true,source_ref:ref,deleted:Boolean(cur&&cur.status==="hold")});continue;
          }
          const st=String(v.resale_status??v.status??"").trim().toUpperCase().replace(/[\s-]+/g,"_");
          const target=(st==="AVAILABLE_FOR_SALE"||st==="AVAILABLE")?"available":st==="SOLD"?"sold":"hold";
          if(!cur&&target==="sold"&&opts.skipUnknownSold){await client.query("COMMIT");results.push({ok:true,skipped:true,source_ref:ref});continue;}
          const dealer=await resolveRepoDealer(v);
          // Factory par sirf HOLD (seized) gaadi park ho sakti hai. Available for Sale ke liye real dealer/showroom chahiye.
          if(target==="available"&&!dealer.id){
            await client.query("ROLLBACK");
            results.push({ok:false,source_ref:ref,vehicle_no:vehicleNo,error:dealer.matched?"Factory par parked vehicle Available for Sale nahi ho sakti. Pehle dealer/showroom select karein.":"Parked dealer GRD me nahi mila: "+dealer.name});
            continue;
          }
          const model=String(v.model_name??v.grd_model_name??"").trim()||null,colour=String(v.colour??"").trim()||null,toolkit=String(v.toolkit??"").trim()||null;
          const battery=String(v.battery_maker??"").trim()||null,repoDate=ymd(v.repo_date)||null;
          let id:number;
          if(!cur){
            const ins=await client.query("INSERT INTO old_rickshaw_inventory(vehicle_no,model_name,colour,toolkit,battery_maker,repo_date,dealer_id,dealer_name,status,available_for_sale,source,source_ref) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'hold',false,'CHFPL',$9) RETURNING id",[vehicleNo||ref,model,colour,toolkit,battery,repoDate,dealer.id,dealer.name,ref||null]);
            id=ins.rows[0].id;
          }else{
            id=cur.id;
            if(cur.status!=="sold")await client.query("UPDATE old_rickshaw_inventory SET vehicle_no=COALESCE(NULLIF($1,''),vehicle_no),model_name=COALESCE($2,model_name),colour=COALESCE($3,colour),toolkit=COALESCE($4,toolkit),battery_maker=COALESCE($5,battery_maker),repo_date=COALESCE($6::date,repo_date),dealer_id=$7,dealer_name=$8,source='CHFPL',source_ref=COALESCE(NULLIF($9,''),source_ref),updated_at=now() WHERE id=$10",[vehicleNo,model,colour,toolkit,battery,repoDate,dealer.id,dealer.name,ref,id]);
          }
          const row0=(await client.query("SELECT * FROM old_rickshaw_inventory WHERE id=$1",[id])).rows[0];
          let out=row0;
          if(row0.status==="sold"){/* GRD me bik chuki gaadi ko chhedte nahi */}
          else if(target==="available")out=await releaseRepoInventory(client,id);
          else if(target==="hold"&&row0.status==="available"){await holdRepoInventory(client,row0);out=(await client.query("SELECT * FROM old_rickshaw_inventory WHERE id=$1",[id])).rows[0];}
          await client.query("COMMIT");
          results.push({ok:true,inventory_id:id,source_ref:ref,vehicle_no:out?.vehicle_no,status:out?.status,parked_dealer:dealer.name,dealer_matched:dealer.matched,challan_no:out?.challan_no||null});
        }catch(e:any){await client.query("ROLLBACK");results.push({ok:false,source_ref:ref,error:e?.message||"failed"});}
        finally{client.release()}
      }
      return results;
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

async function ensureHRSchemas(){
  await pool.query("CREATE TABLE IF NOT EXISTS hr_employee (id bigserial PRIMARY KEY, employee_code text NOT NULL UNIQUE, name text NOT NULL, department text, designation text, mobile text, photo_url text, joining_date date, machine_user_id text, basic_salary numeric NOT NULL DEFAULT 0, hra numeric NOT NULL DEFAULT 0, other_allowance numeric NOT NULL DEFAULT 0, overtime_rate numeric NOT NULL DEFAULT 0, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now())");
  await pool.query("CREATE TABLE IF NOT EXISTS hr_attendance (id bigserial PRIMARY KEY, employee_id bigint NOT NULL REFERENCES hr_employee(id) ON DELETE CASCADE, work_date date NOT NULL, first_in timestamptz, last_out timestamptz, status text NOT NULL DEFAULT 'Present', work_hours numeric NOT NULL DEFAULT 0, overtime_hours numeric NOT NULL DEFAULT 0, UNIQUE(employee_id,work_date))");
  await pool.query("CREATE TABLE IF NOT EXISTS hr_salary (id bigserial PRIMARY KEY, employee_id bigint NOT NULL REFERENCES hr_employee(id) ON DELETE CASCADE, salary_month text NOT NULL, working_days numeric NOT NULL DEFAULT 0, present_days numeric NOT NULL DEFAULT 0, overtime_hours numeric NOT NULL DEFAULT 0, basic_earned numeric NOT NULL DEFAULT 0, allowances numeric NOT NULL DEFAULT 0, overtime_amount numeric NOT NULL DEFAULT 0, net_salary numeric NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'PROCESSED', UNIQUE(employee_id,salary_month))");
}
let dealerPincodeReady:Promise<void>|null=null;
// Dealer Master me Pin Code field: column pehli baar use hone par apne aap ban jata hai.
function ensureDealerPincode():Promise<void>{
  if(!dealerPincodeReady)dealerPincodeReady=addColumns("dealer",{pincode:"text"}).catch(e=>{dealerPincodeReady=null;throw e});
  return dealerPincodeReady;
}
async function genericGet(req:Request,path:string[],table:string){
  if(table==="dealer")await ensureDealerPincode();
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

async function defaultBank(company:any){
  // Bank Details master: the row ticked "Default". Falls back to the Company Master bank when none is ticked.
  const r=await pool.query("SELECT sm.name,to_jsonb(sm)->>'account_no' AS account_no,to_jsonb(sm)->>'ifsc' AS ifsc FROM simple_master sm WHERE lower(sm.kind)='bank' AND COALESCE(btrim(sm.name),'')<>'' AND lower(COALESCE(to_jsonb(sm)->>'is_default','false')) IN ('true','t','1','yes') ORDER BY sm.id DESC LIMIT 1").catch(()=>({rows:[] as any[]}));
  const b=r.rows[0];
  if(b)return {name:b.name||"",account_no:b.account_no||"",ifsc:b.ifsc||""};
  return {name:company.bank_name||"",account_no:company.bank_account_no||"",ifsc:company.bank_ifsc||""};
}
// RTO Master prints as two address lines at the bottom-left of the invoice (Address + Address Line 2).
function rtoAddressText(rr:any){
  const lines=[rr.address||rr.address1,rr.address2].map((v:any)=>String(v||"").trim()).filter(Boolean);
  return lines.length?lines.join("\n"):String(rr.details||"").trim();
}

let simpleMasterAddr2Ready:Promise<void>|null=null;
async function genericWrite(req:Request,path:string[],table:string,method:string,parsedBody?:any){
  if(table==="dealer")await ensureDealerPincode();
  // RTO Master keeps a second address line (prints as the 2nd line at the invoice bottom-left).
  if(table==="simple_master"){if(!simpleMasterAddr2Ready)simpleMasterAddr2Ready=addColumns("simple_master",{address2:"text",expense_type:"text"}).catch(e=>{simpleMasterAddr2Ready=null;throw e});await simpleMasterAddr2Ready;}
  const cols=await columns(table);
  if(!cols.size)return Response.json({error:"Table not found",table},{status:404});
  const body:any=parsedBody!==undefined?parsedBody:await json(req),input:any={};
  for(const [k,v] of Object.entries(body||{})){
    const c=snake(k);if(cols.has(c)&&c!=="id")input[c]=v;
  }
  if(table==="simple_master" && path[0]==="masters" && path[1] && cols.has("kind"))input.kind=path[1]==="color"?"colour":path[1];
  const id=idOf(path[path.length-1]);
  if(table==="dealer"){
    // Dealer Master form sends plain "password"; dealer table only has password_hash and the dealer login verifies that hash.
    // Without this the password was silently dropped (no "password" column) so the login could never match.
    const authz:any=auth(req);
    delete input.password;delete input.password_hash;
    const pw=String(body?.password??"");
    if(pw.trim()&&authz?.scope!=="dealer"){const crypto=await import("crypto");input.password_hash=pwMakeHash(crypto,pw);}
    if(typeof input.login_id==="string")input.login_id=input.login_id.trim();
    if(String(input.registration_type||"").toLowerCase()==="unregistered")input.purchase_access=false;
    if(input.pincode!==undefined)input.pincode=String(input.pincode??"").replace(/\D/g,"").slice(0,6)||null;
  }
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


// Pending Old Rickshaw sale approve hote hi: gaadi SOLD (old_rickshaw + inventory) aur sale data CHFPL ko.
async function finalizeOldRickshawSale(sale:any):Promise<{ok:boolean,skipped?:boolean,error?:string}>{
  const oldId=idOf(sale.old_rickshaw_id);
  if(!oldId)return {ok:true,skipped:true};
  const saleAmount=num(sale.sale_amount),loan=num(sale.hypothecation_amount),balance=Math.max(0,saleAmount-loan);
  const ledgerNo=loan>0?(String(sale.ledger_no||"").trim()||null):null;
  const doNo=String(sale.do_no||"").trim()||null,customer=String(sale.customer_name||"").trim();
  const saleDate=ymd(sale.sale_date)||new Date().toISOString().slice(0,10);
  const client=await pool.connect();
  let invId:number|null=null;
  try{
    await client.query("BEGIN");
    const cur=await client.query("SELECT status FROM old_rickshaw WHERE id=$1 FOR UPDATE",[oldId]);
    if(!cur.rowCount)throw new Error("Old Rickshaw record not found.");
    if(String(cur.rows[0].status||"").toLowerCase()!=="available")throw new Error("Gaadi Available nahi hai (already sold / hold).");
    const oc=await columns("old_rickshaw");
    const vals:any={status:"sold",customer_name:customer,out_name:customer,sale_amount:saleAmount,sold_amount:saleAmount,loan_amount:loan,balance_amount:balance,do_number:doNo,ledger:ledgerNo,ledger_no:ledgerNo,sale_date:saleDate,updated_at:new Date()};
    const keys=Object.keys(vals).filter(k=>oc.has(k));
    await client.query('UPDATE old_rickshaw SET '+keys.map((k,i)=>'"'+k+'"=$'+(i+1)).join(",")+' WHERE id=$'+(keys.length+1),[...keys.map(k=>vals[k]),oldId]);
    const inv=await client.query("UPDATE old_rickshaw_inventory SET status='sold',customer_name=$1,sale_amount=$2,loan_amount=$3,balance_amount=$4,do_number=$5,ledger_no=$6,sale_date=$7::date,chfpl_sale_synced=false,chfpl_sale_sync_error=NULL,updated_at=now() WHERE old_rickshaw_id=$8 RETURNING id",[customer,saleAmount,loan,balance,doNo,ledgerNo,saleDate,oldId]);
    invId=inv.rowCount?Number(inv.rows[0].id):null;
    await client.query("COMMIT");
  }catch(e){await client.query("ROLLBACK").catch(()=>{});throw e}
  finally{client.release()}
  // CHFPL ko sale data webhook se, background me: approve turant ho jaye, CHFPL slow ho to bhi wait nahi.
  // Fail hone par inventory row par error save hota hai aur "Retry CHFPL Sync" button se dobara jata hai.
  if(invId)void syncSaleToChfpl(invId).catch(()=>{});
  return {ok:true,queued:true} as any;
}
// Old Rickshaw sale -> CHFPL: customer, sale date, amount, new loan, balance, ledger no (only if loan) and DO no.
// Best-effort: the GRD sale is already saved; result is stored on the inventory row so it can be retried.
async function syncSaleToChfpl(inventoryId:number):Promise<{ok:boolean,skipped?:boolean,error?:string}>{
  const r=await pool.query("SELECT * FROM old_rickshaw_inventory WHERE id=$1",[inventoryId]);
  const row=r.rows[0];
  if(!row||row.status!=="sold")return {ok:false,error:"Sold record not found."};
  if(String(row.source||"").toUpperCase()!=="CHFPL"||!row.source_ref)return {ok:true,skipped:true};
  try{
    const base=String(process.env.CHFPL_API_URL||"").replace(/\/$/,""),secret=String(process.env.CHFPL_GRD_BRIDGE_SECRET||"");
    if(!base||!secret)throw new Error("CHFPL bridge is not configured. Set CHFPL_API_URL and CHFPL_GRD_BRIDGE_SECRET.");
    const loan=num(row.loan_amount),saleAmount=num(row.sale_amount);
    const payload={vehicle:{source_ref:String(row.source_ref),vehicle_no:row.vehicle_no,resale_status:"SOLD",sale:{
      customer_name:row.customer_name||"",sale_date:ymd(row.sale_date)||ymd(row.updated_at)||new Date().toISOString().slice(0,10),
      sale_amount:saleAmount,loan_amount:loan,balance_amount:num(row.balance_amount)||Math.max(0,saleAmount-loan),
      ledger_no:loan>0?(row.ledger_no||""):"",do_number:row.do_number||""}}};
    const resp=await fetch(base+"/api/grd/repo-status-webhook",{method:"POST",headers:{"x-grd-bridge-secret":secret,"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify(payload),cache:"no-store"});
    const d:any=await resp.json().catch(()=>({}));
    if(!resp.ok||d.success===false){
      const bad=Array.isArray(d.results)?d.results.find((x:any)=>x&&x.ok===false):null;
      throw new Error(d.error||bad?.error||("CHFPL sale sync failed ("+resp.status+")"));
    }
    await pool.query("UPDATE old_rickshaw_inventory SET chfpl_sale_synced=true,chfpl_sale_sync_error=NULL WHERE id=$1",[inventoryId]);
    return {ok:true};
  }catch(e:any){
    const msg=String(e?.message||"CHFPL sale sync failed").slice(0,300);
    await pool.query("UPDATE old_rickshaw_inventory SET chfpl_sale_synced=false,chfpl_sale_sync_error=$2 WHERE id=$1",[inventoryId,msg]).catch(()=>{});
    return {ok:false,error:msg};
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
}const BILLING_DEPS:any={defaultBank,ensureGrdAssetSchema,ensureLoanWorkflowBridgeSchema,ensureOldRickshawInventorySchema,ensureOldRickshawLegacySchema,finalizeOldRickshawSale,productLogo,rtoAddressText};
const REPORTS_DEPS:any={ensureOldRickshawLegacySchema,parseItems,purchaseBillTotals,purchaseExtraTotal,purchaseLegacyNum};
const BATTERY_DEPS:any={ensureNotificationSchema,parseItems};
const SALES_DEPS:any={ensureBatteryFitSchema,ensureBillingSalesSchema,ensureDispatchSchema,productLogo,ensureBatteryRegisterSchema,assertBatterySerialsAvailable,toggleBatteryRegisterForDelivery,genericWrite,defaultBank,rtoAddressText,upsertBillingCustomer};
export async function GET(req:Request,{params}:{params:Promise<{path?:string[]}>}){
  try{
    const {path=[]}=await params,p=path.join("/");
    const b:any=await json(req);
    const a=auth(req);
    if(p==="health")return Response.json({status:"ok",backend:"node",python:false});
    if(!a)return Response.json({error:"Authentication required."},{status:401});
    await ensureSecuritySchema();
    // Notifications: jinke paas permission nahi (jaise Salesman) unko 403 ki jagah khali list -> header me error/console spam nahi.
    if(p==="notifications"&&!canRead(a,p))return Response.json({notifications:[],branch_cash_limits:[],count:0});
    // Har logged-in staff ko menu (nav-config), dashboard aur apna profile chahiye; ye allowed_modules se block nahi hone chahiye.
    const baselineRead=a?.scope==="staff"&&(p==="nav-config"||p==="dashboard"||p==="auth/me");
    if(!baselineRead&&!canRead(a,p))return Response.json({error:"Forbidden."},{status:403});
    // Dealer Master form ko salesman list aur sub-group list chahiye: jiske paas Dealer module ka view right hai use ye 2 lookup read allowed (warna dropdown khali rehta tha).
    const dealerLookup=a?.scope==="staff"&&(p==="masters/salesman"||p==="sub-groups")&&(await actionAllowed(a,"dealer","view"));
    // Ledger page (Dealer / Financer / Bank / Other Party) in lookups ko padhta hai: jiske paas Ledger ka view right hai use ye read-only lookups allowed (warna "You don't have rights" aata tha).
    const LEDGER_LOOKUPS=["day-book","bank-ledger","masters/bank","masters/financer","dealers","reports/hypothecation-register"];
    const ledgerLookup=a?.scope==="staff"&&LEDGER_LOOKUPS.includes(p)&&(await actionAllowed(a,"ledger","view"));
    if(!baselineRead&&!dealerLookup&&!ledgerLookup&&!(await actionAllowed(a,p,"view")))return Response.json({error:"Forbidden."},{status:403});
    // Download right: CSV exports and *export / *download endpoints need can_download on that module.
    if(String(new URL(req.url).searchParams.get("export")||"").toLowerCase()==="csv"||p.endsWith("/export")||p.includes("/download")){
      if(!(await actionAllowed(a,p,"download")))return Response.json({error:"Download permission required."},{status:403});
    }
    if(p==="expense-payment-voucher"||p.startsWith("expense-payment-voucher/")){const evr=await expenseVoucherGet(req,path,a);if(evr)return evr;}
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
    {const x=await reportsGet(req,path,a,REPORTS_DEPS);if(x)return x;}
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
    {const x=await batteryGet(req,path,a,BATTERY_DEPS);if(x)return x;}
    // Showroom / Branch stock summary: 2 grouped query (dealer-wise loop nahi) -> fast. Detail row click par reports/dealer-stock se aati hai.
    {const x=await cashbookAdminGet(req,path,a);if(x)return x;}
    {const x=await loanGet(path,a);if(x)return x;}
    {const x=await billingGet(req,path,a,BILLING_DEPS);if(x)return x;}
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
    if(p==="masters/salesman"&&a.scope==="staff")return salesmanMasterList();
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
    // Vehicle No. register: one row per live Tax Invoice; only vehicle_reg_no is editable (PUT vehicle-no-register/:id).
    if(p==="vehicle-no-register"){
      await ensureTaxInvoiceVehicleNoColumn();
      const u=new URL(req.url),args:any[]=[]; const {w,search}=dateWhere("ti",u,args);
      if(search){args.push("%"+search+"%");const n=args.length;w.push("(COALESCE(ti.bill_no,'') ILIKE $"+n+" OR COALESCE(ti.buyer_name,'') ILIKE $"+n+" OR COALESCE(ti.chassis_no,'') ILIKE $"+n+" OR COALESCE(ti.dealer_name,'') ILIKE $"+n+" OR COALESCE(ti.product_name,'') ILIKE $"+n+" OR COALESCE(ti.vehicle_reg_no,'') ILIKE $"+n+")");}
      w.push("COALESCE(ti.cancelled,false)=false");
      const r=await pool.query("SELECT ti.id,ti.date,ti.bill_no,ti.buyer_name,ti.chassis_no,ti.dealer_name,ti.product_name,COALESCE(ti.vehicle_reg_no,'') AS vehicle_reg_no FROM tax_invoice ti WHERE "+w.join(" AND ")+" ORDER BY ti.date DESC,ti.id DESC LIMIT 5000",args);
      return Response.json({rows:r.rows,invoices:r.rows});
    }
    // Accounts > Record: one row per live Tax Invoice. Only chassis_record_no / ledger_no / voucher_no / vehicle_reg_no are editable (PUT sale-record/:id).
    if(p==="sale-record"){
      await ensureTaxInvoiceRecordColumns();
      const u=new URL(req.url),args:any[]=[]; const {w,search}=dateWhere("ti",u,args);
      if(search){args.push("%"+search+"%");const n=args.length;w.push("(COALESCE(ti.bill_no,'') ILIKE $"+n+" OR COALESCE(ti.buyer_name,'') ILIKE $"+n+" OR COALESCE(ti.chassis_no,'') ILIKE $"+n+" OR COALESCE(ti.dealer_name,'') ILIKE $"+n+" OR COALESCE(ti.product_name,'') ILIKE $"+n+" OR COALESCE(ti.vehicle_reg_no,'') ILIKE $"+n+" OR COALESCE(ti.ledger_no,'') ILIKE $"+n+" OR COALESCE(ti.voucher_no,'') ILIKE $"+n+" OR COALESCE(ti.chassis_record_no,'') ILIKE $"+n+")");}
      w.push("COALESCE(ti.cancelled,false)=false");
      const r=await pool.query("SELECT ti.id,ti.date,ti.dealer_name,ti.bill_no,ti.product_name,ti.chassis_no,COALESCE(ti.remarks,'') AS other,ti.buyer_name,COALESCE(ti.sale_amount,0) AS sale_amount,COALESCE(ti.hypothecation_amount,0) AS loan_amount,COALESCE(ti.amount_received,0) AS amount_received,COALESCE(ti.sale_amount,0)-COALESCE(ti.hypothecation_amount,0)-COALESCE(ti.amount_received,0) AS balance,COALESCE(ti.financer_name,'') AS financer_name,COALESCE(ti.chassis_record_no,'') AS chassis_record_no,COALESCE(ti.ledger_no,'') AS ledger_no,COALESCE(ti.voucher_no,'') AS voucher_no,COALESCE(ti.vehicle_reg_no,'') AS vehicle_reg_no,COALESCE(NULLIF(to_jsonb(ti)->>'salesman',''),NULLIF(to_jsonb(ti)->>'salesman_name',''),(SELECT NULLIF(to_jsonb(dc)->>'salesman','') FROM delivery_challan dc WHERE dc.id=ti.delivery_challan_id),'') AS salesman FROM tax_invoice ti WHERE "+w.join(" AND ")+" ORDER BY ti.date DESC,ti.id DESC LIMIT 5000",args);
      return Response.json({rows:r.rows});
    }
    if(p==="reports/sale-register")return saleRegisterReport(req);
    {const x=await gstHypSubsidyReport(req,path,{purchaseBillTotals});if(x)return x;}
    {const pg=await productionGet(req,path,a);if(pg)return pg;}
    {const x=await taxInvoiceGet(req,path,a,SALES_DEPS);if(x)return x;}
    if(p==="dashboard"){
      const [vehicles,stages,monthly,billed,states,dealers,pending,sales,production,todayChallans,todayBills,todayProduction,mfgMonthly]=await Promise.all([
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
        pool.query("SELECT id,date,vou_no,product_name AS model_name,quantity FROM production_voucher WHERE date=CURRENT_DATE ORDER BY date DESC,id DESC LIMIT 100"),
        pool.query(`SELECT TO_CHAR(date,'YYYY-MM') AS month,COALESCE(SUM(COALESCE(quantity,0)),0)::int AS quantity FROM production_voucher WHERE date >= date_trunc('month',CURRENT_DATE)-INTERVAL '11 months' GROUP BY 1 ORDER BY 1`)
      ]);
      const stage_counts:any={};for(const r of stages.rows)stage_counts[r.stage]=Number(r.count||0);
      const total=Object.values(stage_counts).reduce((s:number,x:any)=>s+Number(x||0),0);
      const recent=vehicles.rows;
      const dash:any={
        manufacturing:recent.filter((x:any)=>x.stage==="Manufacturing"),
        delivery_challan:recent.filter((x:any)=>x.stage==="Delivery Challan"),
        tax_invoice:recent.filter((x:any)=>x.stage==="Tax Invoice"),
        stage_counts,total_vehicles:total,
        counts:{manufacturing:Number(stage_counts.Manufacturing||0),delivery_challan:Number(stage_counts["Delivery Challan"]||0),tax_invoice:Number(stage_counts["Tax Invoice"]||0),total},
        monthly:monthly.rows,billed_monthly:billed.rows,manufacturing_monthly:mfgMonthly.rows,state_sales:states.rows,cash_at_dealer:0,
        dealers:Number(dealers.rows[0]?.n||0),pending_challans:Number(pending.rows[0]?.n||0),
        sales_total:Number(sales.rows[0]?.sales||0),received_total:Number(sales.rows[0]?.received||0),
        loan_total:Number(sales.rows[0]?.loan||0),production_this_month:Number(production.rows[0]?.n||0),
        today_challans:todayChallans.rows,today_bills:todayBills.rows,today_production:todayProduction.rows
      };
      if(isSalesman(a)){dash.sales_total=0;dash.received_total=0;dash.loan_total=0;dash.billed_monthly=[];dash.manufacturing_monthly=[];dash.state_sales=[];dash.today_bills=[];dash.today_production=[];dash.production_this_month=0;}
      return Response.json(dash);
    }
    if(p==="nav-config"){
      const r=await pool.query("SELECT * FROM nav_tab ORDER BY id");
      return Response.json({tabs:r.rows,items:[]});
    }
    if(p==="masters"){
      const r=await pool.query("SELECT DISTINCT kind FROM simple_master ORDER BY kind");
      return Response.json({kinds:r.rows.map((x:any)=>x.kind)});
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
    if((p==="dealer/ledger-accounts"||p==="dealer/ledger-masters")&&a.scope!=="dealer"){const r=await pool.query("SELECT DISTINCT party_name FROM day_book WHERE party_name IS NOT NULL ORDER BY party_name");return Response.json({rows:r.rows});}
    if(p==="factory/old-rickshaw-challans"){
      await ensureOldRickshawInventorySchema();
      const rows=await pool.query("SELECT c.*,d.name AS dealer_name FROM old_rickshaw_challan c LEFT JOIN dealer d ON d.id=c.dealer_id ORDER BY c.date DESC,c.id DESC LIMIT 1000");
      const available=await pool.query("SELECT i.* FROM old_rickshaw_inventory i WHERE i.status='available' AND NOT EXISTS (SELECT 1 FROM old_rickshaw_challan c WHERE c.challan_no=i.challan_no AND c.status='ACTIVE') ORDER BY i.repo_date DESC NULLS LAST,i.id DESC LIMIT 500");
      const dealers=await pool.query("SELECT d.id,d.name,d.code,COALESCE(to_jsonb(d)->>'salesman','') AS salesman FROM dealer d ORDER BY d.name");
      return Response.json({challans:rows.rows,rows:rows.rows,available_for_sale:available.rows,dealers:dealers.rows,suggested_challan_no:"ORC-"+new Date().toISOString().slice(0,10).replace(/-/g,"")+"-"+Date.now()});
    }
    if(a.scope==="dealer"&&p.startsWith("dealer/")){const dg=await dealerCashbookGet(req,path,a,{ensureBillingSalesSchema});if(dg)return dg;}
    // Closing Stock - Premises: gaadi jo abhi factory/premises me hai (stage = Manufacturing) - Delivery Challan dropdown wali hi stock.
    // Pehle iska handler nahi tha: request generic journal_stock list par jati thi aur page ko {vehicles,summary} nahi milta tha.
    if(p==="stock/closing-premises"&&a.scope!=="dealer"){
      const r=await pool.query("SELECT v.id,v.date,v.chassis_no,v.model_name,v.motor_no,v.colour FROM vehicle v WHERE lower(COALESCE(to_jsonb(v)->>'stage','')) = 'manufacturing' ORDER BY v.date DESC NULLS LAST,v.id DESC LIMIT 5000");
      const by=new Map<string,any>();
      for(const v of r.rows){const k=String(v.model_name||"")+"|"+String(v.colour||"");const e=by.get(k)||{model_name:v.model_name||"",colour:v.colour||"",qty:0};e.qty+=1;by.set(k,e);}
      const summary=[...by.values()].sort((x:any,y:any)=>String(x.model_name).localeCompare(String(y.model_name))||String(x.colour).localeCompare(String(y.colour)));
      return Response.json({vehicles:r.rows,summary,total:r.rowCount});
    }
    // Closing Stock - with Dealers (staff/salesman). Was falling through to the generic journal_stock table list, so the page got
    // an array instead of {vehicles,summary} and crashed ("This page couldn't load"). Salesman logins see only their own dealers.
    if(p==="stock/closing-dealers"&&a.scope!=="dealer"){
      const sm=String(a.department||"").trim().toLowerCase()==="salesman"?String(a.username||"").trim():"";
      const args:any[]=[];let extra="";
      if(sm){args.push(sm);extra=" AND lower(trim(COALESCE(v.dealer_name,''))) IN (SELECT lower(trim(name)) FROM dealer WHERE lower(trim(COALESCE(salesman,'')))=lower(trim($1)))";}
      // Challan no / date / model / battery make / salesman bhi bhejte hain (dealer-wise detail popup, print aur export ke liye).
      // Model: vehicle.model_name khali ho to delivery challan ka product_name use hota hai.
      const r=await pool.query("SELECT v.id,COALESCE(dc.date,v.date) AS date,dc.challan_no,v.chassis_no,COALESCE(NULLIF(trim(COALESCE(v.model_name,'')),''),NULLIF(trim(COALESCE(dc.product_name,'')),''),'') AS model_name,v.motor_no,v.colour,v.dealer_name,COALESCE(v.battery_maker,'') AS battery_maker,COALESCE(NULLIF(trim(COALESCE(to_jsonb(dc)->>'salesman','')),''),NULLIF(trim(COALESCE(dm.salesman,'')),''),'') AS salesman FROM vehicle v LEFT JOIN LATERAL (SELECT * FROM delivery_challan c WHERE c.vehicle_id=v.id AND COALESCE(c.cancelled,false)=false ORDER BY c.id DESC LIMIT 1) dc ON true LEFT JOIN LATERAL (SELECT d.salesman FROM dealer d WHERE lower(trim(d.name))=lower(trim(v.dealer_name)) ORDER BY d.id LIMIT 1) dm ON true WHERE v.stage='Delivery Challan' AND COALESCE(trim(v.dealer_name),'')<>''"+extra+" ORDER BY v.dealer_name,COALESCE(dc.date,v.date) DESC,v.id DESC",args);
      const m=new Map<string,any>();
      for(const x of r.rows){const k=String(x.dealer_name||"")+"|"+String(x.model_name||"");const e=m.get(k)||{dealer_name:x.dealer_name||"",model_name:x.model_name||"",qty:0};e.qty++;m.set(k,e);}
      return Response.json({vehicles:r.rows,summary:[...m.values()],count:r.rowCount});
    }
    if(p==="dealer/me"&&a.scope==="dealer"){
      const r=await pool.query("SELECT id,code,name,login_id,dealer_category,registration_type,purchase_access,portal_modules,blocked FROM dealer WHERE id=$1",[num(a.dealer_id)]);
      const d=r.rows[0]||null;
      if(!d)return Response.json({error:"Dealer not found."},{status:404});
      d.purchase_access=Boolean(d.purchase_access)&&String(d.registration_type||"registered").toLowerCase()!=="unregistered";
      d.portal_modules=String(d.portal_modules||"").replace(/[{}"\[\]]/g,"").split(",").map((x:any)=>x.trim()).filter(Boolean);
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
    if(p==="dealer/old-rickshaws"&&a.scope==="dealer"){
      await ensureBillingSalesSchema();
      const r=await pool.query("SELECT o.*,(SELECT s.id FROM grd_billing_sale s WHERE s.old_rickshaw_id=o.id AND s.status IN ('PENDING','APPROVED') LIMIT 1) AS pending_sale_id FROM old_rickshaw o WHERE o.dealer_id=$1 AND o.status IN ('available','sold') ORDER BY CASE WHEN o.status='available' THEN 0 ELSE 1 END,o.date DESC,o.id DESC",[num(a.dealer_id)]);
      return Response.json({rickshaws:r.rows,count:r.rowCount});
    }
    if(p==="dealer/repair-receipts"&&a.scope==="dealer"){
      await ensureRepairSchema();
      if(!(await dealerHasRepairReceiptRight(num(a.dealer_id))))return Response.json({error:"Repair Receipt ka right aapke paas nahi hai."},{status:403});
      const v=await pool.query("SELECT id,voucher_no,date,customer_name,customer_mobile,vehicle_no,chassis_no,total_amount,paid_amount,balance_amount,dealer_name FROM repair_service_voucher WHERE total_amount-COALESCE(paid_amount,0)>0 ORDER BY date DESC,id DESC LIMIT 1000");
      const r=await pool.query("SELECT r.id,r.receipt_no,r.date,r.amount,r.payment_mode,r.reference_no,r.remarks,r.customer_name,r.vehicle_no,v.voucher_no FROM repair_service_payment_receipt r LEFT JOIN repair_service_voucher v ON v.id=r.voucher_id WHERE r.dealer_id=$1 ORDER BY r.date DESC,r.id DESC LIMIT 1000",[num(a.dealer_id)]);
      return Response.json({vouchers:v.rows,receipts:r.rows});
    }
    if(p==="dealer/delivery/customers"&&a.scope==="dealer"){
      await ensureDealerCashSchema();await ensureBillingSalesSchema();
      const r=await pool.query("SELECT * FROM dealer_cash_customer WHERE dealer_id=$1 AND UPPER(COALESCE(status,''))='VEHICLE_PENDING' ORDER BY id DESC LIMIT 2000",[num(a.dealer_id)]);
      const customers=(await enrichCashCustomers(r.rows)).filter((x:any)=>x.status==="VEHICLE_PENDING");
      return Response.json({customers,rows:customers,count:customers.length});
    }
    if(p==="dealer/incentive-record"&&a.scope==="dealer"){
      // Same source as admin Incentive Register: expense_payment_voucher (+ lines), matched to dealer's tax invoices by chassis.
      const did=num(a.dealer_id);
      const r=await pool.query(`WITH inc AS (
          SELECT lower(btrim(l.chassis_no)) AS ch,v.voucher_no,l.amount,v.status,v.payment_status,v.paid_at,v.date AS vdate
            FROM expense_payment_voucher_line l JOIN expense_payment_voucher v ON v.id=l.voucher_id
           WHERE lower(COALESCE(v.expense_type,''))='incentive' AND v.dealer_id=$1 AND lower(COALESCE(v.status,'')) NOT IN ('rejected','cancelled','canceled')
          UNION ALL
          SELECT lower(btrim(v.chassis_no)),v.voucher_no,v.amount,v.status,v.payment_status,v.paid_at,v.date
            FROM expense_payment_voucher v
           WHERE lower(COALESCE(v.expense_type,''))='incentive' AND v.dealer_id=$1 AND lower(COALESCE(v.status,'')) NOT IN ('rejected','cancelled','canceled')
             AND NOT EXISTS (SELECT 1 FROM expense_payment_voucher_line l WHERE l.voucher_id=v.id)
        )
        SELECT * FROM (
          SELECT DISTINCT ON (ti.id) ti.id AS vehicle_id,ti.date,ti.bill_no,ti.buyer_name AS customer,
                 COALESCE(to_jsonb(ti)->>'buyer_mobile',to_jsonb(ti)->>'customer_mobile','') AS mobile_no,
                 ti.chassis_no,ti.product_name AS model,
                 COALESCE(inc.amount,0) AS incentive_amount,COALESCE(inc.voucher_no,'') AS voucher_no,
                 inc.paid_at AS paid_date,
                 CASE WHEN inc.voucher_no IS NULL THEN 'NOT_RECORDED' WHEN inc.paid_at IS NOT NULL THEN 'PAID' ELSE 'PENDING_PAYMENT' END AS status
            FROM tax_invoice ti LEFT JOIN inc ON inc.ch=lower(btrim(ti.chassis_no))
           WHERE ti.dealer_id=$1 AND COALESCE(ti.cancelled,false)=false
           ORDER BY ti.id,(inc.paid_at IS NULL),inc.vdate DESC
        ) x ORDER BY x.date DESC,x.vehicle_id DESC`,[did]);
      const rows=r.rows.map((x:any)=>({...x,incentive_amount:num(x.incentive_amount),date:ymd(x.date),paid_date:x.paid_date?ymd(x.paid_date):null}));
      const summary={total:rows.length,paid:rows.filter((x:any)=>x.status==="PAID").length,pending:rows.filter((x:any)=>x.status==="PENDING_PAYMENT").length,not_recorded:rows.filter((x:any)=>x.status==="NOT_RECORDED").length};
      return Response.json({rows,data:rows,summary,count:rows.length});
    }
    {const x=await deliveryChallanGet(req,path,a,SALES_DEPS);if(x)return x;}
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
    if(p==="reports/payment-receivable")return paymentReceivableReport(req);
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
    // Stock Ledger - with Dealers: pehle ye generic journal_stock list me chala jaata tha (array/rows aata, "events" nahi) aur page crash hota tha.
    // IN = Delivery Challan (gaadi dealer ko gayi), OUT = Tax Invoice (dealer ne bech di). Balance dealer-wise chalta hai.
    if(p==="stock/ledger-dealers"&&a.scope!=="dealer"){
      const u=new URL(req.url),fd=num(u.searchParams.get("dealer_id")),from=u.searchParams.get("from")||"",to=u.searchParams.get("to")||"";
      const isSm=String(a.department||"").trim().toLowerCase()==="salesman";
      let allowed:Set<number>|null=null;
      if(isSm){const ar=await pool.query("SELECT id FROM dealer WHERE lower(trim(COALESCE(salesman,'')))=lower(trim($1))",[String(a.username||"")]);allowed=new Set(ar.rows.map((x:any)=>Number(x.id)));}
      const ins=await pool.query("SELECT dc.id,dc.date,dc.challan_no AS doc_no,COALESCE(NULLIF(dc.chassis_no,''),v.chassis_no) AS chassis_no,dc.dealer_id,d.name AS dealer_name FROM delivery_challan dc LEFT JOIN dealer d ON d.id=dc.dealer_id LEFT JOIN vehicle v ON v.id=dc.vehicle_id WHERE COALESCE(dc.cancelled,false)=false AND dc.dealer_id IS NOT NULL");
      const outs=await pool.query("SELECT ti.id,ti.date,ti.bill_no AS doc_no,COALESCE(NULLIF(ti.chassis_no,''),NULLIF(dc.chassis_no,''),v.chassis_no) AS chassis_no,COALESCE(dc.dealer_id,ti.dealer_id) AS dealer_id,d.name AS dealer_name,ti.buyer_name FROM tax_invoice ti LEFT JOIN delivery_challan dc ON dc.id=ti.delivery_challan_id LEFT JOIN vehicle v ON v.id=COALESCE(ti.vehicle_id,dc.vehicle_id) LEFT JOIN dealer d ON d.id=COALESCE(dc.dealer_id,ti.dealer_id) WHERE COALESCE(ti.cancelled,false)=false AND ti.delivery_challan_id IS NOT NULL");
      let all:any[]=[
        ...ins.rows.map((x:any)=>({id:x.id,kind:0,date:ymd(x.date),type:"IN",doc_no:x.doc_no||"",chassis_no:x.chassis_no||"",dealer_id:Number(x.dealer_id)||0,dealer_name:x.dealer_name||"",particulars:"Delivery Challan"})),
        ...outs.rows.map((x:any)=>({id:x.id,kind:1,date:ymd(x.date),type:"OUT",doc_no:x.doc_no||"",chassis_no:x.chassis_no||"",dealer_id:Number(x.dealer_id)||0,dealer_name:x.dealer_name||"",particulars:"Sold - Tax Invoice"+(x.buyer_name?" ("+x.buyer_name+")":"")})),
      ];
      if(allowed)all=all.filter(e=>allowed!.has(e.dealer_id));
      if(fd)all=all.filter(e=>e.dealer_id===fd);
      all.sort((x,y)=>String(x.date).localeCompare(String(y.date))||x.kind-y.kind||Number(x.id)-Number(y.id));
      const bal=new Map<number,number>();
      const events=all.map((e:any)=>{const b=(bal.get(e.dealer_id)||0)+(e.type==="IN"?1:-1);bal.set(e.dealer_id,b);return {id:e.kind+"-"+e.id,date:e.date,type:e.type,doc_no:e.doc_no,chassis_no:e.chassis_no,dealer_name:e.dealer_name,particulars:e.particulars,qty:1,balance:b};})
        .filter((e:any)=>!(from&&e.date<from)&&!(to&&e.date>to));
      return Response.json({events,rows:events,count:events.length});
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
    if(p==="old-rickshaws"){
      await ensureOldRickshawLegacySchema();
      const r=await pool.query(`SELECT o.*,d.name AS joined_dealer_name FROM old_rickshaw o LEFT JOIN dealer d ON d.id=o.dealer_id ORDER BY o.date DESC NULLS LAST,o.id DESC LIMIT 2000`);
      const records=r.rows.map((x:any)=>({...x,dealer_name:x.dealer_name||x.joined_dealer_name||"",has_battery:Boolean(x.battery_maker||x.battery_no1||x.battery_no2||x.battery_no3||x.battery_no4),sold_amount:num(x.sold_amount||x.sale_amount),sale_amount:num(x.sale_amount),loan_amount:num(x.loan_amount),receipt_amount:num(x.receipt_amount),balance_amount:num(x.balance_amount||Math.max(0,num(x.sale_amount)-num(x.loan_amount)))}));
      return Response.json({records,rows:records,count:records.length,suggested_record_no:"OR-"+Date.now(),suggested_vou_no:"ORV-"+Date.now()});
    }
    // Seized Stock = CHFPL repo vehicles still on HOLD. dealer_id NULL => parked at GRD Factory.
    // Available for Sale / Sold vehicles never appear here (they live in Old Rickshaw stock).
    if(p==="inventory/seized-stock"){
      await ensureOldRickshawInventorySchema();
      const u=new URL(req.url),loc=String(u.searchParams.get("location")||"all").toLowerCase(),q=String(u.searchParams.get("search")||"").trim();
      const args:any[]=[],where:string[]=["status='hold'"];
      if(loc==="factory")where.push("dealer_id IS NULL");
      else if(loc==="dealers")where.push("dealer_id IS NOT NULL");
      if(q){args.push("%"+q+"%");where.push("(vehicle_no ILIKE $"+args.length+" OR COALESCE(model_name,'') ILIKE $"+args.length+" OR COALESCE(battery_maker,'') ILIKE $"+args.length+" OR COALESCE(dealer_name,'') ILIKE $"+args.length+")");}
      const rows=await pool.query("SELECT * FROM old_rickshaw_inventory WHERE "+where.join(" AND ")+" ORDER BY repo_date DESC NULLS LAST,id DESC LIMIT 2000",args);
      const summary=await pool.query("SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE dealer_id IS NULL)::int AS factory,COUNT(*) FILTER(WHERE dealer_id IS NOT NULL)::int AS dealers FROM old_rickshaw_inventory WHERE status='hold'");
      return Response.json({rows:rows.rows,summary:summary.rows[0]||{total:0,factory:0,dealers:0}});
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
      await ensureBillingSalesSchema();
      const rows=await pool.query("SELECT *,(SELECT s.id FROM grd_billing_sale s WHERE s.old_rickshaw_id=old_rickshaw_inventory.old_rickshaw_id AND s.status IN ('PENDING','APPROVED') LIMIT 1) AS pending_sale_id FROM old_rickshaw_inventory"+(where.length?" WHERE "+where.join(" AND "):"")+" ORDER BY CASE status WHEN 'available' THEN 1 WHEN 'hold' THEN 2 ELSE 3 END,repo_date DESC NULLS LAST,id DESC LIMIT 2000",args);
      const summary=await pool.query("SELECT COUNT(*)::int AS all,COUNT(*) FILTER(WHERE status='hold')::int AS hold,COUNT(*) FILTER(WHERE status='available')::int AS available,COUNT(*) FILTER(WHERE status='sold')::int AS sold FROM old_rickshaw_inventory");
      const dealers=await pool.query("SELECT id,name,code FROM dealer ORDER BY name");
      return Response.json({rows:rows.rows,summary:summary.rows[0]||{all:0,hold:0,available:0,sold:0},dealers:dealers.rows});
    }
    {const x=await hypothecationGet(req,path,{importDate});if(x)return x;}


    {const x=await bankLedgerGet(req,path,a);if(x)return x;}
    {const x=await insuranceRtoGet(req,path,a);if(x)return x;}
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
    // CHFPL Repo case -> GRD Old Rickshaw webhook (server-to-server, same bridge secret as loan-status-webhook).
    // Body: {vehicle:{...}} | {vehicles:[...]} | flat {...}
    //  id / source_ref (CHFPL repo id), vehicle_no, model_name, colour, toolkit, battery_maker, repo_date,
    //  resale_status: SEIZED | AVAILABLE_FOR_SALE | SOLD   (status bhi chalega)
    //  parked dealer: grd_dealer_id / dealer_id / dealer_code / dealer_name  (ya dealer_master:{dealer_name,dealer_code}); khali = GRD Factory
    //  event:"deleted" -> hold wali entry hata di jaati hai (available/sold ko nahi chhedta)
    if(p==="repo-vehicle-webhook"){
      const expected=String(process.env.CHFPL_GRD_BRIDGE_SECRET||"").trim();
      const supplied=String(req.headers.get("x-grd-bridge-secret")||"").trim();
      if(!expected||!supplied||supplied!==expected)return Response.json({success:false,error:"Invalid CHFPL bridge secret."},{status:401});
      await ensureOldRickshawLegacySchema();await ensureOldRickshawInventorySchema();
      await pool.query("ALTER TABLE old_rickshaw_inventory ADD COLUMN IF NOT EXISTS colour text");
      await pool.query("ALTER TABLE old_rickshaw_inventory ADD COLUMN IF NOT EXISTS toolkit text");
      const list:any[]=Array.isArray(b.vehicles)?b.vehicles:(b.vehicle&&typeof b.vehicle==="object"?[b.vehicle]:[b]);
      const results=await applyRepoVehicles(list,b);
      const failed=results.filter(x=>!x.ok).length;
      return Response.json({success:failed===0,results},{status:failed===list.length&&failed>0?400:200});
    }
    {const x=await loanWebhookPost(req,path,b);if(x)return x;}

    const a=auth(req);if(!a)return Response.json({error:"Authentication required."},{status:401});
    await ensureSecuritySchema();
    if(!(await actionAllowed(a,p,"create")))return Response.json({error:"Forbidden."},{status:403});

    {const x=await deliveryChallanPost(req,path,b,a,SALES_DEPS);if(x)return x;}

    {const x=await loanPost(req,path,b,a);if(x)return x;}


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
    if(p==="expense-payment-voucher"||p.startsWith("expense-payment-voucher/")){const evp=await expenseVoucherPost(path,b,a);if(evp)return evp;}
    { const cm=await chassisMasterWrite(path,"POST",b);if(cm)return cm; }
    if(p==="masters/salesman")return salesmanMasterWrite("POST",path,b,saveUserRecord);
    if(p==="users")return saveUserRecord(b);
    {const pp=await productionPost(req,path,b,a);if(pp)return pp;}
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
    if(a.scope==="dealer"&&p.startsWith("dealer/")){const dp=await dealerCashbookPost(path,b,a);if(dp)return dp;}
    {const x=await cashbookAdminPost(path,b,a);if(x)return x;}
    if(a.scope==="dealer" && p==="dealer/repair-receipts"){
      const did=num(a.dealer_id);
      if(!(await dealerHasRepairReceiptRight(did)))return Response.json({error:"Repair Receipt ka right aapke paas nahi hai."},{status:403});
      try{
        const row=await createRepairReceipt(idOf(b.voucher_id)||0,b,did);
        return Response.json({success:true,receipt:row,row},{status:201});
      }catch(e:any){return Response.json({error:e.message||"Could not create receipt."},{status:400});}
    }
    {const x=await batteryPost(path,b,a,BATTERY_DEPS);if(x)return x;}
    if(p==="notifications/read"){
      await ensureNotificationSchema();
      const id=idOf(b.id); if(!id)return Response.json({error:"Notification id required."},{status:400});
      const userKey=String(a?.id??a?.user_id??a?.username??"").trim();
      const r=await pool.query("UPDATE app_notification SET is_read=true WHERE id=$1 AND (user_id=$2 OR user_id IS NULL OR dealer_id=$3) RETURNING id",[id,userKey,num(a?.dealer_id)||0]);
      return Response.json({success:r.rowCount>0});
    }
    {const x=await cashbookAdminPost(path,b,a);if(x)return x;}
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
    {const x=await billingPost(req,path,b,a,BILLING_DEPS);if(x)return x;}
    if(p==="credit-notes"){
      await ensureCreditDebitSchema();const invoiceId=idOf(b.invoice_id||b.tax_invoice_id);if(!invoiceId)return Response.json({error:"Original Tax Invoice is required."},{status:400});
      const client=await pool.connect();try{await client.query("BEGIN");const inv=await client.query("SELECT ti.*,d.name AS joined_dealer_name FROM tax_invoice ti LEFT JOIN dealer d ON d.id=ti.dealer_id WHERE ti.id=$1 FOR UPDATE OF ti",[invoiceId]);if(!inv.rowCount)throw new Error("Tax Invoice not found.");const x=inv.rows[0];if(Boolean(x.cancelled))throw new Error("Tax Invoice is already cancelled.");
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
    {const x=await dealerInvoicePost(req,path,a);if(x)return x;}
    {const x=await taxInvoicePost(req,path,b,a,SALES_DEPS);if(x)return x;}
    if(p==="factory/old-rickshaw-challans"){
      // Old Rickshaw Challan Voucher: GRD Old Rickshaw Inventory ki Available-for-Sale gaadi se, Dealer ke naam.
      // Voucher banne ke baad hi gaadi dealer ke Old Rickshaw stock me dikhti hai. Stock lena-dena (ledger) baad me.
      await ensureOldRickshawLegacySchema();await ensureOldRickshawInventorySchema();
      const inventoryId=idOf(b.inventory_id),dealerId=idOf(b.dealer_id);
      if(!inventoryId)return Response.json({error:"Available for Sale gaadi select karein."},{status:400});
      if(!dealerId)return Response.json({error:"Dealer select karein."},{status:400});
      const yn=(v:any)=>String(v||"").trim().toUpperCase()==="YES"?"YES":"NO";
      const txt=(v:any)=>String(v??"").trim()||null;
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        const inv=await client.query("SELECT * FROM old_rickshaw_inventory WHERE id=$1 FOR UPDATE",[inventoryId]);
        if(!inv.rowCount)throw new Error("Old Rickshaw inventory record not found.");
        const row=inv.rows[0];
        if(row.status!=="available")throw new Error("Sirf Available for Sale gaadi ka voucher ban sakta hai.");
        if(row.challan_no){
          const ac=await client.query("SELECT 1 FROM old_rickshaw_challan WHERE challan_no=$1 AND status='ACTIVE'",[row.challan_no]);
          if(ac.rowCount)throw new Error("Is gaadi ka Challan Voucher pehle se bana hua hai ("+row.challan_no+").");
        }
        const dr=await client.query("SELECT id,name FROM dealer WHERE id=$1",[dealerId]);
        if(!dr.rowCount)throw new Error("Dealer not found.");
        const today=new Date().toISOString().slice(0,10);
        const date=String(b.date||"").slice(0,10)||today;
        const challan=String(b.challan_no||"").trim()||("ORC-"+date.replace(/-/g,"")+"-"+String(row.id).padStart(4,"0"));
        const dup=await client.query("SELECT 1 FROM old_rickshaw_challan WHERE challan_no=$1",[challan]);
        if(dup.rowCount)throw new Error("Challan No. \""+challan+"\" pehle se maujood hai.");
        const ledgerDate=String(b.ledger_date||"").slice(0,10)||null;
        const f={salesman:txt(b.salesman),chassis:txt(b.chassis_no),battery:txt(b.battery_name),charger:txt(b.charger),
          mat:yn(b.mat),jack:yn(b.jack),cl:yn(b.centre_lock),bm:yn(b.big_mirror),col:yn(b.colour),tk:yn(b.toolkit),st:yn(b.stepney)};
        const cr=await client.query("INSERT INTO old_rickshaw_challan(date,challan_no,model_name,vehicle_no,colour,toolkit,dealer_id,source,source_ref,status,inventory_id,old_rickshaw_id,salesman,ledger_date,chassis_no,battery_name,charger,mat_yn,jack_yn,centre_lock_yn,big_mirror_yn,colour_yn,toolkit_yn,stepney_yn) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'ACTIVE',$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) RETURNING *",
          [date,challan,row.model_name||null,row.vehicle_no,row.colour||null,row.toolkit||null,dealerId,row.source||"CHFPL",row.source_ref||String(row.id),inventoryId,row.old_rickshaw_id||null,f.salesman,ledgerDate,f.chassis,f.battery,f.charger,f.mat,f.jack,f.cl,f.bm,f.col,f.tk,f.st]);
        const oldCols=await columns("old_rickshaw");
        const old:any={date,challan_date:date,ledger_date:ledgerDate,dealer_id:dealerId,dealer_name:dr.rows[0].name,challan_no:challan,vou_no:challan,salesman:f.salesman,
          chassis_no:f.chassis,charger:f.charger,mat:f.mat,jack:f.jack,centre_lock:f.cl,big_mirror:f.bm,stepney:f.st,status:"available"};
        if(f.battery)old.battery_maker=f.battery;
        let oldId=idOf(row.old_rickshaw_id);
        if(oldId){
          const oldFit2=await fitOldRickshaw(old);
          const keys=Object.keys(oldFit2).filter(k=>oldCols.has(k));
          await client.query('UPDATE old_rickshaw SET '+keys.map((k,i)=>'"'+k+'"=$'+(i+1)).join(",")+' WHERE id=$'+(keys.length+1),[...keys.map(k=>oldFit2[k]),oldId]);
        }else{
          const full:any={...old,source:"chfpl",record_no:"OR-"+row.id,chfpl_ref_no:row.source_ref||"",vehicle_reg_no:row.vehicle_no,model_name:row.model_name||"",colour:row.colour||"",toolkit:row.toolkit||"",sp_no:row.sp_no||null,repo_date:row.repo_date||null};
          const fullFit=await fitOldRickshaw(full,row.id);
          const keys=Object.keys(fullFit).filter(k=>oldCols.has(k));
          const ins=await client.query('INSERT INTO old_rickshaw ('+keys.map(k=>'"'+k+'"').join(",")+') VALUES('+keys.map((_,i)=>"$"+(i+1)).join(",")+') RETURNING id',keys.map(k=>fullFit[k]));
          oldId=ins.rows[0].id;
          await client.query("UPDATE old_rickshaw_challan SET old_rickshaw_id=$1 WHERE id=$2",[oldId,cr.rows[0].id]);
        }
        await client.query("UPDATE old_rickshaw_inventory SET challan_no=$1,challan_date=$2,dealer_id=$3,dealer_name=$4,old_rickshaw_id=$5,updated_at=now() WHERE id=$6",[challan,date,dealerId,dr.rows[0].name,oldId,inventoryId]);
        await client.query("COMMIT");
        return Response.json({success:true,row:cr.rows[0],data:cr.rows[0]},{status:201});
      }catch(e:any){await client.query("ROLLBACK").catch(()=>{});return Response.json({error:e?.message||"Could not create Old Rickshaw Challan Voucher."},{status:400});}
      finally{client.release()}
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
    if(/^dealer\/old-rickshaws\/\d+\/sale$/.test(p)){
      return Response.json({error:"Old Rickshaw sale ab seedhi nahi hoti. Sale pehle Pending Sales me jaati hai aur Billing approval ke baad Sold hoti hai."},{status:409});
    }
    if(p==="old-rickshaws/sale"){
      return Response.json({error:"Old Rickshaw sale ab seedhi nahi hoti. Sale pehle Pending Sales me jaati hai aur Billing approval ke baad Sold hoti hai."},{status:409});
    }

    if(p==='sub-groups'){
      const name=String(b.name||'').trim(); if(!name)return Response.json({error:'Sub Group Name is required.'},{status:400});
      const r=await pool.query('INSERT INTO product_sub_group(name) VALUES($1) ON CONFLICT(name) DO UPDATE SET active=true RETURNING *',[name]); await audit(a,'sub-groups','create',r.rows[0].id,null,r.rows[0]); return Response.json({success:true,row:r.rows[0]},{status:201});
    }
    if(p.startsWith('users/') && p.endsWith('/action-permissions')){
      const uid=idOf(path[path.length-2]); if(!uid)return Response.json({error:'User id required.'},{status:400});
      const permissions=Array.isArray(b.permissions)?b.permissions:[]; const oldPerm=(await pool.query('SELECT module_key,can_view,can_create,can_edit,can_delete,can_approve,can_download,can_backup FROM user_action_permission WHERE user_id=$1 ORDER BY module_key',[uid])).rows; for(const x of permissions){const m=String(x.module_key||'').trim();if(!m)continue;await pool.query(`INSERT INTO user_action_permission(user_id,module_key,can_view,can_create,can_edit,can_delete,can_approve,can_download,can_backup) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(user_id,module_key) DO UPDATE SET can_view=EXCLUDED.can_view,can_create=EXCLUDED.can_create,can_edit=EXCLUDED.can_edit,can_delete=EXCLUDED.can_delete,can_approve=EXCLUDED.can_approve,can_download=EXCLUDED.can_download,can_backup=EXCLUDED.can_backup`,[uid,m,!!x.can_view,!!x.can_create,!!x.can_edit,!!x.can_delete,!!x.can_approve,!!x.can_download,!!x.can_backup]);} await audit(a,'user-permissions','edit',uid,oldPerm,permissions,null,'user #'+uid); return Response.json({success:true});
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
    {const x=await bankLedgerPost(req,path,b,a);if(x)return x;}
    {const x=await hypothecationPost(req,path,b,a,{importDate,importAmount,ensureBankLedgerSchema});if(x)return x;}


    {const x=await insuranceRtoPost(req,path,b,a);if(x)return x;}
    // Old Rickshaw inventory release / sale handlers live in mutation(); POST() must hand these over,
    // otherwise they are unreachable and the sale form returns "route not implemented".
    if(p.startsWith("inventory/old-rickshaw/")&&(path[path.length-1]==="available"||path[path.length-1]==="sale"||path[path.length-1]==="resync-sale"||path[path.length-1]==="sync-chfpl"))return mutation(req,params,"POST");
    const table=tableFor(path);
    // Dealer Master form edit par bhi POST /dealers {id,...} bhejta hai; genericWrite POST me id ignore hoti thi -> naya INSERT -> duplicate-key 500. id ho to UPDATE.
    if(table==="dealer"&&path.length===1&&idOf(b?.id))return genericWrite(req,[...path,String(idOf(b.id))],table,"PUT",b);
    if(table)return genericWrite(req,path,table,"POST",b);
    return Response.json({error:"Node API route not implemented",path:"/api/"+p},{status:404});
  }catch(e:any){console.error("[node-api POST]",e);const dk=dupKeyResponse(e);if(dk)return dk;return Response.json({error:e.message||"Internal server error"},{status:500})}
}
export async function PUT(req:Request,{params}:{params:Promise<{path?:string[]}>}){return mutation(req,params,"PUT")}
export async function PATCH(req:Request,{params}:{params:Promise<{path?:string[]}>}){return mutation(req,params,"PATCH")}
export async function DELETE(req:Request,{params}:{params:Promise<{path?:string[]}>}){return mutation(req,params,"DELETE")}
async function mutation(req:Request,params:any,method:string){

  try{
    const a=auth(req);if(!a)return Response.json({error:"Authentication required."},{status:401});
    await ensureSecuritySchema();
    const {path=[]}=await params,p=path.join("/"),table=tableFor(path);
    if(table==="tax_invoice")await ensureTaxInvoiceRecordColumns();
    if(!(await actionAllowed(a,p,actionFor(method))))return Response.json({error:"Forbidden."},{status:403});
    if(!canWrite(a,p))return Response.json({error:"Forbidden."},{status:403});
    const bodyForScope=(method==="DELETE"?{}:await json(req));
    const scopeGuard=await enforceDealerScope(a,table,idOf(path[path.length-1]),bodyForScope); if(scopeGuard)return scopeGuard;
    if(path[0]==="masters"&&path[1]==="salesman"&&path.length===3&&a.scope==="staff")return salesmanMasterWrite(method,path,bodyForScope,saveUserRecord);
    if(path[0]==="expense-payment-voucher"&&path.length===2&&method==="DELETE")return expenseVoucherDelete(path,a);
    {const x=await batteryMutation(req,path,method,a);if(x)return x;}
    {const x=await bankLedgerMutation(req,path,method,a,bodyForScope);if(x)return x;}
    {const x=await insuranceRtoMutation(req,path,method,a,bodyForScope);if(x)return x;}
    if(path[0]==="chassis-master"){const cm=await chassisMasterWrite(path,method,await json(req));if(cm)return cm;}
    {const x=await hypothecationMutation(path,method,a);if(x)return x;}
    if(path[0]==="sale-record"&&(method==="PUT"||method==="PATCH")){
      const id=idOf(path[1]);if(!id)return Response.json({error:"Invoice id required."},{status:400});
      const b:any=await json(req);
      await ensureTaxInvoiceRecordColumns();
      // Only these four fields can be changed from the Record tab; anything else in the body is ignored.
      const clean=(k:string,v:any)=>k==="vehicle_reg_no"?String(v??"").toUpperCase().replace(/[\s-]+/g,""):String(v??"").trim();
      const sets:string[]=[],vals:any[]=[];
      for(const k of ["chassis_record_no","ledger_no","voucher_no","vehicle_reg_no"]){
        if(Object.prototype.hasOwnProperty.call(b,k)){vals.push(clean(k,b[k])||null);sets.push(k+"=$"+vals.length);}
      }
      // Admin only: BLANK (null/0) sale_amount / loan_amount (hypothecation_amount) can be filled once. Filled amounts are never overwritten here.
      const amtSets:string[]=[];
      for(const [bk,col] of [["sale_amount","sale_amount"],["loan_amount","hypothecation_amount"]] as const){
        if(Object.prototype.hasOwnProperty.call(b,bk)){
          if(!isAdmin(a))return Response.json({error:"Only admin can edit sale / loan amount."},{status:403});
          const n=Number(b[bk]);
          if(!Number.isFinite(n)||n<0)return Response.json({error:"Invalid "+bk+"."},{status:400});
          vals.push(n);amtSets.push(col+"=CASE WHEN COALESCE("+col+",0)=0 THEN $"+vals.length+" ELSE "+col+" END");
        }
      }
      sets.push(...amtSets);
      if(!sets.length)return Response.json({error:"Koi editable field nahi mili."},{status:400});
      vals.push(id);
      const old=amtSets.length?(await pool.query("SELECT sale_amount,hypothecation_amount,bill_no FROM tax_invoice WHERE id=$1",[id])).rows[0]:null;
      const r=await pool.query("UPDATE tax_invoice SET "+sets.join(",")+" WHERE id=$"+vals.length+" RETURNING id,bill_no,chassis_record_no,ledger_no,voucher_no,vehicle_reg_no,COALESCE(sale_amount,0) AS sale_amount,COALESCE(hypothecation_amount,0) AS loan_amount,COALESCE(sale_amount,0)-COALESCE(hypothecation_amount,0)-COALESCE(amount_received,0) AS balance",vals);
      if(!r.rowCount)return Response.json({error:"Tax Invoice not found."},{status:404});
      const x=r.rows[0];
      if(amtSets.length)await audit(a,"sale-record","update",id,old,{sale_amount:x.sale_amount,hypothecation_amount:x.loan_amount},null,x.bill_no).catch(()=>{});
      return Response.json({success:true,row:{id:x.id,chassis_record_no:x.chassis_record_no||"",ledger_no:x.ledger_no||"",voucher_no:x.voucher_no||"",vehicle_reg_no:x.vehicle_reg_no||"",sale_amount:num(x.sale_amount),loan_amount:num(x.loan_amount),balance:num(x.balance)}});
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

    {const pm=await productionMutation(req,path,method,a,await json(req));if(pm)return pm;}


    {const x=await deliveryChallanMutation(req,path,method,a,SALES_DEPS);if(x)return x;}
    {const x=await billingMutation(req,path,method,a,BILLING_DEPS);if(x)return x;}
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
    {const x=await taxInvoiceMutation(req,path,method,a,SALES_DEPS);if(x)return x;}
    if(a.scope==="dealer"&&method==="PUT"&&p.startsWith("dealer/cash-book/")){const dm=await dealerCashbookMutation(path,method,a,await json(req),{ensureBillingSalesSchema});if(dm)return dm;}
    if(p.startsWith("credit-notes/") && p.endsWith("/cancel-challan") && method==="POST"){
      await ensureCreditDebitSchema();await ensureDispatchSchema();await ensureBatteryRegisterSchema();
      const id=idOf(path[path.length-2]);if(!id)return Response.json({error:"Credit Note id required."},{status:400});
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        const cn=await client.query("SELECT * FROM credit_note WHERE id=$1 FOR UPDATE",[id]);if(!cn.rowCount)throw new Error("Credit Note not found.");
        const dcId=idOf(cn.rows[0].delivery_challan_id);if(!dcId)throw new Error("No Delivery Challan is linked to this Credit Note.");
        const dc=await client.query("SELECT dc.*,d.name AS dealer_name FROM delivery_challan dc LEFT JOIN dealer d ON d.id=dc.dealer_id WHERE dc.id=$1 FOR UPDATE OF dc",[dcId]);if(!dc.rowCount)throw new Error("Linked Delivery Challan not found.");
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
        if(row.status!=="available"&&!row.dealer_id)throw new Error("Factory par parked vehicle Available for Sale nahi ho sakti. Pehle CHFPL me dealer/showroom select karein.");
        if(row.status!=="available")await releaseRepoInventory(client,inventoryId);
        const out=await client.query("SELECT * FROM old_rickshaw_inventory WHERE id=$1",[inventoryId]);
        await client.query("COMMIT");return Response.json({success:true,row:out.rows[0]});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    // Pull CHFPL repo status into GRD (CHFPL is the source of truth for HOLD / Available for Sale).
    // Safety net for when the CHFPL -> GRD webhook did not arrive (wrong URL, localhost, downtime).
    if(p==="inventory/old-rickshaw/sync-chfpl" && method==="POST"){
      await ensureOldRickshawLegacySchema();await ensureOldRickshawInventorySchema();
      await pool.query("ALTER TABLE old_rickshaw_inventory ADD COLUMN IF NOT EXISTS colour text");
      await pool.query("ALTER TABLE old_rickshaw_inventory ADD COLUMN IF NOT EXISTS toolkit text");
      let remote:any;
      try{remote=await chfplBridge("/api/grd/repossessed",{status:"ALL"});}
      catch(e:any){return Response.json({success:false,error:e?.message||"CHFPL se connect nahi ho paya."},{status:502});}
      const list:any[]=Array.isArray(remote?.vehicles)?remote.vehicles:[];
      const results=await applyRepoVehicles(list,{},{skipUnknownSold:true});
      const changed=results.filter((x:any)=>x.ok&&!x.skipped).length,failed=results.filter((x:any)=>!x.ok);
      return Response.json({success:true,total:list.length,synced:changed,failed:failed.length,errors:failed.slice(0,10)});
    }
    if(p.startsWith("inventory/old-rickshaw/") && path[path.length-1]==="resync-sale" && method==="POST"){
      await ensureOldRickshawInventorySchema();
      const invId=idOf(path[path.length-2]);if(!invId)return Response.json({error:"Inventory id required."},{status:400});
      const chfpl_sync=await syncSaleToChfpl(invId);
      return Response.json({success:chfpl_sync.ok,chfpl_sync},{status:chfpl_sync.ok?200:502});
    }
    if(p.startsWith("inventory/old-rickshaw/") && path[path.length-1]==="sale" && method==="POST"){
      return Response.json({error:"Old Rickshaw sale ab seedhi nahi hoti. Sale pehle Pending Sales me jaati hai aur Billing approval ke baad Sold hoti hai."},{status:409});
    }
    if(!table)return Response.json({error:"Node API route not implemented",path:"/api/"+p},{status:404});
    return genericWrite(req,path,table,method);
  }catch(e:any){console.error("[node-api mutation]",e);const dk=dupKeyResponse(e);if(dk)return dk;return Response.json({error:e.message||"Internal server error"},{status:500})}
}