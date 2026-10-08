// Billing / Pending Sales (bade route file se nikala gaya, logic/queries same hain).
// Endpoints: billing/pending-sales*, billing/vehicle-inventory*, dealer/pending-sales*.
// ensureBillingSalesSchema / upsertBillingCustomer dusre modules (tax-invoice, delivery-challan, cashbook) bhi use karte hain, isliye export hain.
import { addColumns, columns, idOf, json, num, pool } from "./common";
import { healManualChallanStock } from "./manual-challan";
import { actionAllowed, billingStaff } from "./permissions";
import { enrichCashCustomers, ensureDealerCashSchema } from "./dealer-cashbook";
import { ensureTaxInvoiceRecordColumns } from "./reports-sales";

export type BillingDeps = {
  defaultBank: any;
  ensureGrdAssetSchema: any;
  ensureLoanWorkflowBridgeSchema: any;
  ensureOldRickshawInventorySchema: any;
  ensureOldRickshawLegacySchema: any;
  finalizeOldRickshawSale: any;
  productLogo: any;
  rtoAddressText: any;
};

// Billing customer master (per dealer). Upserts by dealer + name + mobile and returns the id.
export async function upsertBillingCustomer(b:any):Promise<number|null>{
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
let challanLinksReady:Promise<void>|null=null;
// Invoices made from a Pending Sale before delivery_challan_id was stored have no link to their Delivery Challan, so the
// Challan Register showed them Unsold / without Sale Bill No. Link them (by stored challan, else vehicle, else chassis) and fill the Model.
// Only invoices that came from a Pending Sale are touched; legacy invoices are left alone. Idempotent; runs once per process.
function ensureChallanInvoiceLinks():Promise<void>{
  if(!challanLinksReady)challanLinksReady=(async()=>{
    await pool.query("ALTER TABLE tax_invoice ADD COLUMN IF NOT EXISTS delivery_challan_id integer");
    await pool.query("ALTER TABLE grd_billing_sale ADD COLUMN IF NOT EXISTS delivery_challan_id bigint");
    await pool.query(`UPDATE grd_billing_sale s SET delivery_challan_id=COALESCE(
        (SELECT id FROM delivery_challan d1 WHERE s.vehicle_id IS NOT NULL AND d1.vehicle_id=s.vehicle_id AND COALESCE(d1.cancelled,false)=false ORDER BY id DESC LIMIT 1),
        (SELECT id FROM delivery_challan d2 WHERE COALESCE(btrim(s.chassis_no),'')<>'' AND lower(btrim(d2.chassis_no))=lower(btrim(s.chassis_no)) AND COALESCE(d2.cancelled,false)=false ORDER BY id DESC LIMIT 1))
      WHERE s.delivery_challan_id IS NULL`);
    await pool.query("UPDATE tax_invoice ti SET delivery_challan_id=s.delivery_challan_id FROM grd_billing_sale s WHERE s.invoice_id=ti.id AND ti.delivery_challan_id IS NULL AND s.delivery_challan_id IS NOT NULL");
    await pool.query("UPDATE tax_invoice ti SET product_name=dc.product_name FROM delivery_challan dc, grd_billing_sale s WHERE s.invoice_id=ti.id AND dc.id=ti.delivery_challan_id AND COALESCE(btrim(ti.product_name),'')='' AND COALESCE(dc.product_name,'')<>''");
  })().catch((e:any)=>{challanLinksReady=null;console.error("[challan invoice links]",e)});
  return challanLinksReady;
}
let billingSalesSchemaReady:Promise<void>|null=null;
export function ensureBillingSalesSchema():Promise<void>{
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
    buyer_relation:"text",buyer_father_name:"text",buyer_gst_no:"text",buyer_pan:"text",buyer_aadhar:"text",buyer_dob:"date",buyer_state_code:"text",buyer_pincode:"text",
    state_type:"text",mode_term:"text",bank_name:"text",bank_account_no:"text",bank_ifsc:"text",rto_name:"text",despatch_through:"text",eway_bill_no:"text",license_no:"text",cvr_no:"text",cancelled_cheque_no:"text",remarks:"text",
    amount_received:"numeric NOT NULL DEFAULT 0",financer_name:"text",hypothecation_amount:"numeric NOT NULL DEFAULT 0",vehicle_reg_no:"text",ledger_no:"text",chassis_record_no:"text",voucher_no:"text",subsidy_amount:"numeric NOT NULL DEFAULT 0",
    gst_sale_amount:"numeric NOT NULL DEFAULT 0",gst_rate:"numeric NOT NULL DEFAULT 5",insurance_amount:"numeric NOT NULL DEFAULT 0",registration_amount:"numeric NOT NULL DEFAULT 0",discount:"numeric NOT NULL DEFAULT 0",dealer_cash_customer_id:"bigint",
    old_rickshaw_id:"bigint",sp_no:"text",sale_date:"date",delivery_challan_id:"bigint"
  };
  await addColumns("grd_billing_sale",extra);
  // Ek Old Rickshaw par ek hi Pending/Approved sale ho sakti hai.
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS grd_billing_sale_old_rickshaw_unique ON grd_billing_sale(old_rickshaw_id) WHERE old_rickshaw_id IS NOT NULL AND status IN ('PENDING','APPROVED')");
  await ensureChallanInvoiceLinks();
}

// ---------------- GET ----------------
export async function billingGet(req:Request,path:string[],a:any,deps:BillingDeps):Promise<Response|null>{
  const p=path.join("/");
  const {defaultBank,ensureGrdAssetSchema,ensureLoanWorkflowBridgeSchema,productLogo,rtoAddressText}=deps;
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
        if(part==="old_rickshaws"){
          // Dealer ke Old Rickshaw stock me wahi gaadi jiska Challan Voucher dealer ke naam ban chuka hai, available hai aur jis par Pending/Approved sale nahi.
          await ensureBillingSalesSchema();await deps.ensureOldRickshawLegacySchema();
          await healManualChallanStock(did).catch(()=>{});
          const orr=await pool.query(`SELECT o.id,o.vehicle_reg_no,o.model_name,o.colour,o.chassis_no,o.challan_no,o.sp_no,o.date
            FROM old_rickshaw o
            WHERE o.dealer_id=$1 AND LOWER(COALESCE(o.status,''))='available'
              AND NOT EXISTS (SELECT 1 FROM grd_billing_sale s WHERE s.old_rickshaw_id=o.id AND s.status IN ('PENDING','APPROVED'))
            ORDER BY o.date DESC NULLS LAST,o.id DESC LIMIT 1000`,[did]);
          return Response.json({rickshaws:orr.rows,can_approve:billingStaff(a)});
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
    if(p==="billing/pending-sales/proforma"){
      // PROFORMA INVOICE print for a Pending Sale (not available after approval): same data shape as tax-invoices/:id/print, but no Bill No. and
      // Registration / Insurance charges are left out (amounts forced to 0 and excluded from the total).
      await ensureBillingSalesSchema();
      if(!billingStaff(a))return Response.json({error:"Billing approval rights required."},{status:403});
      const id=idOf(new URL(req.url).searchParams.get("id"));
      if(!id)return Response.json({error:"Sale id is required."},{status:400});
      const r=await pool.query(`SELECT s.*,lw.application_no,lw.loan_model_name,
        COALESCE(NULLIF(s.customer_name,''),c.full_name) AS c_name,COALESCE(NULLIF(s.customer_phone,''),c.phone) AS c_phone,COALESCE(NULLIF(s.customer_address,''),c.address) AS c_address,COALESCE(NULLIF(s.customer_state,''),c.state) AS c_state,
        d.name AS d_name,v.model_name,COALESCE(NULLIF(to_jsonb(dcx)->>'motor_no',''),v.motor_no) AS motor_no,COALESCE(NULLIF(to_jsonb(dcx)->>'colour',''),v.colour) AS colour,NULLIF(dcx.product_name,'') AS dc_product_name,v.battery_maker,v.battery_no1,v.battery_no2,v.battery_no3,v.battery_no4,
        COALESCE(to_jsonb(v)->>'umrn_code','') AS umrn_code,COALESCE(to_jsonb(v)->>'colour_code','') AS colour_code
        FROM grd_billing_sale s LEFT JOIN loan_workflow lw ON lw.id=s.application_id LEFT JOIN customer c ON c.id=s.customer_id
        LEFT JOIN dealer d ON d.id=s.dealer_id LEFT JOIN vehicle v ON v.id=s.vehicle_id
        LEFT JOIN delivery_challan dcx ON dcx.id=COALESCE(s.delivery_challan_id,(SELECT id FROM delivery_challan WHERE vehicle_id=s.vehicle_id AND COALESCE(cancelled,false)=false ORDER BY id DESC LIMIT 1)) WHERE s.id=$1`,[id]);
      if(!r.rowCount)return Response.json({error:"Sale not found."},{status:404});
      const x=r.rows[0];
      if(String(x.status||"")!=="PENDING")return Response.json({error:"Proforma Invoice sirf Pending Sale ka banta hai (Approve ke baad nahi)."},{status:403});
      if(["OLD RICKSHAW","BATTERY"].includes(String(x.sale_type||"").toUpperCase()))return Response.json({error:"Proforma Invoice sirf New Rickshaw (GST) sale ka banta hai."},{status:409});
      const company=(await pool.query("SELECT * FROM company ORDER BY id DESC LIMIT 1")).rows[0]||{};
      const printBank=await defaultBank(company);
      const taxable=Math.max(0,num(x.gst_sale_amount||x.sale_amount)-num(x.discount)),rate=num(x.gst_rate)||5,gst=taxable*rate/100;
      const intra=(String(x.state_type||"I").trim().toUpperCase()||"I")==="I";
      const productName=x.dc_product_name||x.model_name||x.loan_model_name||"";
      const lg=await productLogo(productName,x.model_name||"");
      const dt=(x.created_at?new Date(x.created_at):new Date()).toISOString().slice(0,10);
      const invoice={...x,bill_no:"PF/"+dt.slice(0,4)+"/"+String(x.id).padStart(5,"0"),date:dt,
        buyer_name:x.c_name||"",buyer_mobile:x.c_phone||"",buyer_address:x.c_address||"",buyer_state:x.c_state||"",buyer_pincode:x.buyer_pincode||"",dealer_name:x.d_name||"",
        product_name:productName,chassis_no:x.chassis_no||"",motor_no:x.motor_no||"",colour:x.colour||"",
        insurance_amount:0,registration_amount:0,gst_rate:rate,taxable_value:taxable,
        cgst_amount:intra?gst/2:0,sgst_amount:intra?gst/2:0,igst_amount:intra?0:gst,tax_amount:gst,bill_total:taxable+gst,
        financer_name:x.financer_name||"",eway_bill_no:"",umrn_code:lg.umrn_code||x.umrn_code||"",logo_keys:lg.logo_keys};
      let rto_address="";const rtoName=String(x.rto_name||"").trim();
      if(rtoName){const rm=await pool.query("SELECT * FROM simple_master WHERE lower(kind)='rto' AND lower(name)=lower($1) ORDER BY id DESC LIMIT 1",[rtoName]);rto_address=rtoAddressText(rm.rows[0]||{});}
      return Response.json({invoice,company,product:{umrn_code:invoice.umrn_code,logo_keys:lg.logo_keys,colour_code:x.colour_code,name:productName},doc_title:"PROFORMA INVOICE",doc_no_label:"Proforma No.",rto_address,
        print_bank_name:printBank.name,print_bank_account_no:printBank.account_no,print_bank_ifsc:printBank.ifsc});
    }
    if(p==="billing/pending-sales/invoice"){
      await ensureBillingSalesSchema();
      if(!billingStaff(a))return Response.json({error:"Billing approval rights required."},{status:403});
      const id=idOf(new URL(req.url).searchParams.get("id"));
      if(!id)return Response.json({error:"Sale id is required."},{status:400});
      const r=await pool.query(`SELECT s.*,lw.application_no,lw.loan_amount,lw.loan_model_name,lw.loan_vehicle_type,
        COALESCE(NULLIF(s.customer_name,''),c.full_name) AS customer_name,COALESCE(NULLIF(s.customer_phone,''),c.phone) AS customer_phone,COALESCE(NULLIF(s.customer_address,''),c.address) AS customer_address,COALESCE(NULLIF(s.customer_state,''),c.state) AS customer_state,
        d.name AS dealer_name,v.model_name,COALESCE(NULLIF(to_jsonb(dcx)->>'motor_no',''),v.motor_no) AS motor_no,COALESCE(NULLIF(to_jsonb(dcx)->>'controller_no',''),v.controller_no) AS controller_no,COALESCE(NULLIF(to_jsonb(dcx)->>'colour',''),v.colour) AS colour,
        NULLIF(dcx.product_name,'') AS dc_product_name
        FROM grd_billing_sale s
        LEFT JOIN loan_workflow lw ON lw.id=s.application_id
        LEFT JOIN customer c ON c.id=s.customer_id
        LEFT JOIN dealer d ON d.id=s.dealer_id
        LEFT JOIN vehicle v ON v.id=s.vehicle_id
        LEFT JOIN delivery_challan dcx ON dcx.id=COALESCE(s.delivery_challan_id,(SELECT id FROM delivery_challan WHERE vehicle_id=s.vehicle_id AND COALESCE(cancelled,false)=false ORDER BY id DESC LIMIT 1)) WHERE s.id=$1`,[id]);
      if(!r.rowCount)return Response.json({error:"Pending Sale not found."},{status:404});
      const x=r.rows[0];
      if(x.status!=="APPROVED")return Response.json({error:"Pending Sale must be approved before Create Sale."},{status:403});
      if(["OLD RICKSHAW","BATTERY"].includes(String(x.sale_type||"").toUpperCase()))return Response.json({error:"Old Rickshaw / Battery sale par GST Tax Invoice nahi banta. 'Complete Sale (No GST)' use karo."},{status:409});
      if(x.invoice_id){const inv=await pool.query("SELECT * FROM tax_invoice WHERE id=$1",[x.invoice_id]);return Response.json({sale:x,invoice:inv.rows[0]||null});}
      const hyp=num(x.hypothecation_amount)||num(x.loan_amount);
      return Response.json({sale:x,invoice:{
        date:new Date().toISOString().slice(0,10),buyer_name:x.customer_name||"",buyer_mobile:x.customer_phone||"",
        buyer_address:x.customer_address||"",buyer_pincode:x.buyer_pincode||"",buyer_state:x.customer_state||"",dealer_name:x.dealer_name||"",
        product_name:x.dc_product_name||x.model_name||x.loan_model_name||"",chassis_no:x.chassis_no||"",motor_no:x.motor_no||"",
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
  return null;
}

// ---------------- POST ----------------
export async function billingPost(req:Request,path:string[],b:any,a:any,deps:BillingDeps):Promise<Response|null>{
  const p=path.join("/");
  const {ensureGrdAssetSchema,ensureOldRickshawInventorySchema,ensureOldRickshawLegacySchema,finalizeOldRickshawSale}=deps;
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
      // Old Rickshaw sale (dealer ya admin): gaadi dealer ke stock me honi chahiye (Challan Voucher ban chuka ho), aur ek gaadi par ek hi Pending/Approved sale.
      const oldRickId=idOf(b.old_rickshaw_id);
      let oldRow:any=null;
      if(oldRickId){
        await ensureOldRickshawLegacySchema();await ensureOldRickshawInventorySchema();
        const orq=await pool.query("SELECT * FROM old_rickshaw WHERE id=$1",[oldRickId]);
        if(!orq.rowCount)return Response.json({error:"Old Rickshaw not found."},{status:404});
        oldRow=orq.rows[0];
        if(String(oldRow.status||"").toLowerCase()!=="available")return Response.json({error:"Sirf Available (unsold) Old Rickshaw ki sale ban sakti hai."},{status:409});
        if(!oldRow.dealer_id)return Response.json({error:"Is gaadi ka Old Rickshaw Challan Voucher (dealer ke naam) abhi nahi bana. Pehle voucher banao."},{status:409});
        const oi=await pool.query("SELECT status,challan_no FROM old_rickshaw_inventory WHERE old_rickshaw_id=$1 ORDER BY id DESC LIMIT 1",[oldRickId]);
        if(oi.rowCount&&(oi.rows[0].status!=="available"||!oi.rows[0].challan_no))return Response.json({error:"Gaadi Available for Sale + Challan Voucher ke baad hi bik sakti hai."},{status:409});
        const pd=await pool.query("SELECT id FROM grd_billing_sale WHERE old_rickshaw_id=$1 AND status IN ('PENDING','APPROVED') LIMIT 1",[oldRickId]);
        if(pd.rowCount)return Response.json({error:"Is Old Rickshaw par Pending Sale pehle se hai."},{status:409});
        if(!(saleAmount>0))return Response.json({error:"Sale Amount is required."},{status:400});
        if(!String(b.customer_name||b.buyer_name||"").trim())return Response.json({error:"Customer Name is required."},{status:400});
      }
      const effectiveDealer=(oldRow?Number(oldRow.dealer_id):0)||dealerId||Number(a?.dealer_id||0);
      if(a?.scope==="dealer"&&effectiveDealer!==Number(a.dealer_id||0))return Response.json({error:"Invalid dealer selected."},{status:403});
      if(!effectiveDealer)return Response.json({error:"Dealer is required."},{status:400});
      // Dealers can create their own Pending Sale only if they are a Showroom / Branch.
      if(a?.scope==="dealer"&&!oldRow){
        const dc=await pool.query("SELECT LOWER(COALESCE(dealer_category,'')) AS cat,LOWER(COALESCE(registration_type,'registered')) AS reg FROM dealer WHERE id=$1",[effectiveDealer]);
        const isShowroom=["showroom","branch"].includes(String(dc.rows[0]?.cat||"")),isUnreg=String(dc.rows[0]?.reg||"")==="unregistered";
        if(!isShowroom&&!isUnreg)return Response.json({error:"Pending Sale sirf Showroom / Branch ya Unregistered dealer bana sakta hai."},{status:403});
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
        application_id:applicationId||null,dealer_cash_customer_id:cashCustId||null,dealer_id:effectiveDealer,customer_id:customerId,vehicle_id:vehicle?.vehicle_id||null,delivery_challan_id:challanId||null,chassis_no:vehicle?.chassis_no||String(b.chassis_no||"").trim()||null,
        description:description||"Internal Sale",sale_amount:saleAmount||Number(vehicle?.sale_value||0),status:"PENDING",
        customer_name:customerName,customer_phone:String(b.customer_phone||b.buyer_mobile||"").trim()||null,customer_address:String(b.customer_address||b.buyer_address||"").trim()||null,customer_state:String(b.customer_state||b.buyer_state||"").trim()||null,
        sale_type:(({NEW:"NEW RICKSHAW",OLD:"OLD RICKSHAW",BATTERY:"BATTERY"} as any)[String(b.sale_category||"").toUpperCase()]||String(b.sale_type||"").trim()||null),page_no:String(b.page_no||b.dealer_page_no||"").trim()||null,do_no:String(b.do_no||"").trim()||null,internal_sale_details:String(b.internal_sale_details||description||"").trim()||null,
        buyer_relation:b.buyer_relation||null,buyer_father_name:b.buyer_father_name||null,buyer_gst_no:b.buyer_gst_no||null,buyer_pan:b.buyer_pan||null,buyer_aadhar:b.buyer_aadhar||null,buyer_dob:b.buyer_dob||null,buyer_state_code:b.buyer_state_code||null,buyer_pincode:String(b.buyer_pincode||"").replace(/\D/g,"").slice(0,6)||null,
        state_type:b.state_type||"I",mode_term:b.mode_term||null,bank_name:b.bank_name||null,bank_account_no:b.bank_account_no||null,bank_ifsc:b.bank_ifsc||null,rto_name:b.rto_name||null,despatch_through:b.despatch_through||null,eway_bill_no:b.eway_bill_no||null,license_no:b.license_no||null,cvr_no:b.cvr_no||null,cancelled_cheque_no:b.cancelled_cheque_no||null,remarks:b.remarks||null,
        amount_received:num(b.amount_received),financer_name:b.financer_name||null,hypothecation_amount:num(b.hypothecation_amount||b.loan_amount),vehicle_reg_no:b.vehicle_reg_no||null,ledger_no:b.ledger_no||null,chassis_record_no:b.chassis_record_no||null,voucher_no:b.voucher_no||null,subsidy_amount:num(b.subsidy_amount),
        gst_sale_amount:num(b.gst_sale_amount||b.sale_amount||vehicle?.sale_value),gst_rate:num(b.gst_rate||5),insurance_amount:num(b.insurance_amount),registration_amount:num(b.registration_amount),discount:num(b.discount)
      };
      if(oldRow){
        const ol=num(b.loan_amount||b.hypothecation_amount);
        Object.assign(values,{old_rickshaw_id:oldRickId,sp_no:oldRow.sp_no||String(b.sp_no||"").trim()||null,sale_date:String(b.sale_date||"").slice(0,10)||new Date().toISOString().slice(0,10),
          sale_type:"OLD RICKSHAW",vehicle_reg_no:oldRow.vehicle_reg_no||null,chassis_no:oldRow.chassis_no||null,hypothecation_amount:ol,
          ledger_no:ol>0?(String(b.ledger_no||"").trim()||null):null,
          description:"Old Rickshaw · "+[oldRow.vehicle_reg_no,oldRow.model_name].filter(Boolean).join(" · ")});
      }
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
      // Ledger No. dealer nahi, admin approval ke time bharta hai: loan wali Old Rickshaw sale ka ledger no. bina approve nahi hogi.
      const pre=await pool.query("SELECT sale_type,hypothecation_amount,ledger_no FROM grd_billing_sale WHERE id=$1 AND status='PENDING'",[id]);
      if(pre.rowCount&&String(pre.rows[0].sale_type||"").toUpperCase()==="OLD RICKSHAW"&&Number(pre.rows[0].hypothecation_amount||0)>0&&!String(pre.rows[0].ledger_no||"").trim())
        return Response.json({error:"Loan wali Old Rickshaw sale hai. Approve se pehle Edit me Ledger No. bharo aur Save Changes karo."},{status:400});
      const r=await pool.query("UPDATE grd_billing_sale SET status='APPROVED',approved_by=$1,approved_at=NOW(),updated_at=NOW() WHERE id=$2 AND status='PENDING' RETURNING *",[String(a.username||a.sub||"Admin"),id]);
      if(!r.rowCount)return Response.json({error:"Only Pending Sales can be approved."},{status:409});
      if(String(r.rows[0].sale_type||"").toUpperCase()==="OLD RICKSHAW"&&idOf(r.rows[0].old_rickshaw_id)){
        try{
          const chfpl_sync=await finalizeOldRickshawSale(r.rows[0]);
          return Response.json({success:true,sale:r.rows[0],chfpl_sync});
        }catch(e:any){
          await pool.query("UPDATE grd_billing_sale SET status='PENDING',approved_by=NULL,approved_at=NULL,updated_at=NOW() WHERE id=$1",[id]);
          return Response.json({error:"Approve nahi ho payi: "+(e?.message||"Old Rickshaw sold mark nahi ho saki.")},{status:409});
        }
      }
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
      await ensureTaxInvoiceRecordColumns();
      const invoice:any=b.invoice||b,cols=await columns("tax_invoice");
      // Link the invoice to the sale's Delivery Challan (Challan Register "Sale Bill No." / Sold-Unsold and "already billed" checks rely on this).
      const dcRow=(await pool.query("SELECT id,product_name FROM delivery_challan WHERE id=COALESCE($1::int,(SELECT id FROM delivery_challan WHERE vehicle_id=$2::int AND COALESCE(cancelled,false)=false ORDER BY id DESC LIMIT 1))",[idOf(s.delivery_challan_id)||null,idOf(s.vehicle_id)||null])).rows[0]||null;
      // Internal Sale Amount and Loan / Hypothecation Amount are frozen at approval: always taken from the approved sale, never from the form.
      const lockedSale=num(s.sale_amount),lockedLoan=num(s.hypothecation_amount)||num(s.loan_amount);
      if(!String(invoice.buyer_state||"").trim())return Response.json({error:"Buyer State required hai."},{status:400});
      if(!/^[1-9]\d{5}$/.test(String(invoice.buyer_pincode||"").replace(/\D/g,"")))return Response.json({error:"Buyer Pin Code required hai (6 digit)."},{status:400});
      const t=(k:string)=>{const v=invoice[k];return v===undefined||v===null||String(v).trim()===""?null:String(v).trim()};
      const values:any={
        // Dealer, Chassis, Customer Name, Father Name (+ Relation) are frozen at approval: always taken from the approved sale, never from the form.
        date:invoice.date||new Date().toISOString().slice(0,10),bill_no:null,buyer_name:String(s.customer_name||"").trim()||null,
        buyer_mobile:String(invoice.buyer_mobile||s.customer_phone||"").trim()||null,buyer_address:invoice.buyer_address||null,buyer_state:invoice.buyer_state||null,
        dealer_name:String(s.dealer_name||"").trim()||null,dealer_id:num(s.dealer_id)||null,product_name:invoice.product_name||dcRow?.product_name||null,chassis_no:s.chassis_no||null,
        motor_no:invoice.motor_no||null,controller_no:invoice.controller_no||null,colour:invoice.colour||null,
        sale_amount:lockedSale,gst_sale_amount:num(invoice.gst_sale_amount||lockedSale),
        gst_rate:num(invoice.gst_rate)||5,hypothecation_amount:lockedLoan,amount_received:num(invoice.amount_received),
        mode_term:invoice.mode_term||"CHFPL",remarks:invoice.remarks||s.description||null,vehicle_id:s.vehicle_id||null,delivery_challan_id:dcRow?.id||null,
        dealer_page_no:t("dealer_page_no"),buyer_relation:s.buyer_relation||null,buyer_father_name:s.buyer_father_name||null,buyer_pincode:String(invoice.buyer_pincode||"").replace(/\D/g,"").slice(0,6)||null,buyer_gst_no:t("buyer_gst_no"),
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
    if(p==="billing/vehicle-inventory/download-txt"){
      if(!(await actionAllowed(a,p,"download")))return Response.json({error:"Download permission required."},{status:403});
      const ids=Array.isArray(b.invoice_ids)?b.invoice_ids.map((x:any)=>idOf(x)).filter(Boolean):[];
      if(!ids.length)return new Response("No invoices selected.",{status:400,headers:{"Content-Type":"text/plain;charset=utf-8"}});
      const r=await pool.query("SELECT ti.date,ti.buyer_name,COALESCE(v.model_name,ti.product_name,'') AS model_name,v.chassis_no,v.motor_no,COALESCE(to_jsonb(v)->>'umrn','') AS umrn,COALESCE(to_jsonb(v)->>'manufacturing_month','') AS manufacturing_month,COALESCE(COALESCE(to_jsonb(v)->>'colour_code','') AS colour_code,'') AS colour_code FROM tax_invoice ti LEFT JOIN vehicle v ON v.id=ti.vehicle_id WHERE ti.id=ANY($1::int[]) ORDER BY ti.date,ti.id",[ids]);
      const parts=Object.fromEntries(new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Kolkata",weekday:"short",day:"2-digit",month:"2-digit",year:"2-digit"}).formatToParts(new Date()).filter((x:any)=>x.type!=="literal").map((x:any)=>[x.type,x.value]));
      const day=String(parts.weekday||"sun").toLowerCase(),fileName=day+String(parts.day||"").padStart(2,"0")+String(parts.month||"").padStart(2,"0")+String(parts.year||"").slice(-2)+".txt";
      const monthNumber=(v:any)=>{const s=String(v??"").trim();if(!s)return "";const direct=s.match(/^(\d{1,2})[\/-](\d{4})$/);if(direct)return String(Number(direct[1])).padStart(2,"0")+direct[2];const y=s.match(/(20\d{2})/),m=s.match(/(?:^|[^a-z])(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(?:[^a-z]|$)/i);if(y&&m){const names=["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];return String(names.indexOf(m[1].toLowerCase())+1).padStart(2,"0")+y[1];}const d=s.match(/(20\d{2})[-/](\d{1,2})/);return d?String(Number(d[2])).padStart(2,"0")+d[1]:s.replace(/[^A-Za-z0-9]/g,"").slice(0,6);};
      const lines=r.rows.map((x:any)=>[x.umrn||"",x.chassis_no||"",monthNumber(x.manufacturing_month),x.colour_code||"","GRD","NA"].map((v:any)=>String(v).replace(/[|\r\n]/g,"")).join("|"));
      return new Response(lines.join("\r\n"),{headers:{"Content-Type":"text/plain;charset=utf-8","Content-Disposition":"attachment; filename=\""+fileName+"\""}});
    }
  return null;
}

// ---------------- PUT / PATCH / DELETE ----------------
export async function billingMutation(req:Request,path:string[],method:string,a:any,deps:BillingDeps):Promise<Response|null>{
  const p=path.join("/");
    // Old Rickshaw (sold) Register se Received Amount edit: Sale / Loan lock; balance pending ho to hi edit. Sirf balance kam hota hai, ledger entry nahi banti.
    if(/^old-rickshaws\/\d+\/received$/.test(p) && method==="PUT"){
      if(!billingStaff(a))return Response.json({error:"Billing approval rights required."},{status:403});
      await addColumns("old_rickshaw",{receipt_amount:"numeric NOT NULL DEFAULT 0"});
      const id=idOf(path[1]);const b:any=await json(req);const next=num(b.amount);
      const cl=await pool.connect();
      try{
        await cl.query("BEGIN");
        const o=(await cl.query("SELECT * FROM old_rickshaw WHERE id=$1 FOR UPDATE",[id])).rows[0];
        if(!o){await cl.query("ROLLBACK");return Response.json({error:"Old Rickshaw not found."},{status:404});}
        if(String(o.status||"").toLowerCase()!=="sold"){await cl.query("ROLLBACK");return Response.json({error:"Sirf sold gaadi ka Received Amount edit hota hai."},{status:409});}
        const sale=num(o.sale_amount||o.sold_amount),loan=num(o.loan_amount),payable=Math.max(0,sale-loan),prev=num(o.receipt_amount);
        if(next<0){await cl.query("ROLLBACK");return Response.json({error:"Received Amount negative nahi ho sakta."},{status:400});}
        if(next>payable){await cl.query("ROLLBACK");return Response.json({error:"Received Amount balance (Sale - Loan = "+payable+") se zyada nahi ho sakta."},{status:400});}
        if(next!==prev&&prev>=payable){await cl.query("ROLLBACK");return Response.json({error:"Balance pending nahi hai, Received Amount edit nahi ho sakta."},{status:409});}
        const linked=(await cl.query("SELECT id FROM grd_billing_sale WHERE old_rickshaw_id=$1 AND status IN ('APPROVED','BILLED') ORDER BY id DESC LIMIT 1",[id]).catch(()=>({rows:[]as any[]}))).rows[0];
        await cl.query("UPDATE old_rickshaw SET receipt_amount=$1,balance_amount=$2,updated_at=now() WHERE id=$3",[next,Math.max(0,payable-next),id]);
        await cl.query("UPDATE old_rickshaw_inventory SET balance_amount=$1,updated_at=now() WHERE old_rickshaw_id=$2",[Math.max(0,payable-next),id]).catch(()=>{});
        if(linked)await cl.query("UPDATE grd_billing_sale SET amount_received=$1,updated_at=NOW() WHERE id=$2",[next,linked.id]).catch(()=>{});
        await cl.query("COMMIT");
        return Response.json({success:true,received:next,balance:Math.max(0,payable-next)});
      }catch(e:any){await cl.query("ROLLBACK").catch(()=>{});return Response.json({error:e?.message||"Save failed."},{status:500});}
      finally{cl.release();}
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
        buyer_aadhar:txt("buyer_aadhar"),buyer_dob:txt("buyer_dob"),buyer_state_code:txt("buyer_state_code"),buyer_pincode:txt("buyer_pincode"),state_type:txt("state_type"),mode_term:txt("mode_term"),
        bank_name:txt("bank_name"),bank_account_no:txt("bank_account_no"),bank_ifsc:txt("bank_ifsc"),rto_name:txt("rto_name"),despatch_through:txt("despatch_through"),
        eway_bill_no:txt("eway_bill_no"),license_no:txt("license_no"),cvr_no:txt("cvr_no"),cancelled_cheque_no:txt("cancelled_cheque_no"),remarks:txt("remarks"),
        financer_name:txt("financer_name"),vehicle_reg_no:txt("vehicle_reg_no"),ledger_no:txt("ledger_no"),chassis_record_no:txt("chassis_record_no"),voucher_no:txt("voucher_no"),
        amount_received:numv("amount_received"),subsidy_amount:numv("subsidy_amount"),gst_sale_amount:numv("gst_sale_amount"),gst_rate:numv("gst_rate"),
        insurance_amount:numv("insurance_amount"),registration_amount:numv("registration_amount"),discount:numv("discount")
      };
      // Customer Name, Father Name (+ Relation): also frozen once APPROVED (dealer / chassis are never in this patch).
      if(s.status!=="PENDING"){delete patch.customer_name;delete patch.buyer_father_name;delete patch.buyer_relation;}
      // Internal Sale Amount + Loan Amount: editable only while PENDING, frozen once APPROVED.
      if(s.status==="PENDING"){
        patch.sale_amount=numv("sale_amount");
        patch.hypothecation_amount=numv("hypothecation_amount","loan_amount");
        const sa=patch.sale_amount??num(s.sale_amount),la=patch.hypothecation_amount??num(s.hypothecation_amount);
        if(sa>0&&la>sa)return Response.json({error:"Loan Amount cannot be greater than Sale Amount."},{status:400});
        if(patch.customer_name===null)return Response.json({error:"Customer Name required hai."},{status:400});
      }
      // OLD RICKSHAW (approved): Sale / Loan locked. Agar balance pending hai to sirf Received Amount edit hoga
      // (customer manual naam se dealer ki sale hai) aur wo dealer ledger me adjust (credit) hoga.
      const isOldApproved=s.status==="APPROVED"&&String(s.sale_type||"").toUpperCase()==="OLD RICKSHAW";
      let syncReceived:null|{amount:number}=null;
      if(isOldApproved&&patch.amount_received!==undefined){
        const prev=num(s.amount_received),next=num(patch.amount_received);
        const payable=Math.max(0,num(s.sale_amount)-num(s.hypothecation_amount));
        if(next!==prev){
          if(prev>=payable)return Response.json({error:"Balance pending nahi hai, Received Amount edit nahi ho sakta."},{status:409});
          if(next<0)return Response.json({error:"Received Amount negative nahi ho sakta."},{status:400});
          if(next>payable)return Response.json({error:"Received Amount balance (Sale - Loan = "+payable+") se zyada nahi ho sakta."},{status:400});
          syncReceived={amount:next};
        }else delete patch.amount_received;
      }
      const cols=await columns("grd_billing_sale"),keys=Object.keys(patch).filter(k=>patch[k]!==undefined&&cols.has(k));
      if(!keys.length)return Response.json({error:"No changes supplied."},{status:400});
      const r=await pool.query('UPDATE grd_billing_sale SET '+keys.map((k,i)=>'"'+k+'"=$'+(i+1)).join(",")+',updated_at=NOW() WHERE id=$'+(keys.length+1)+' AND status IN (\'PENDING\',\'APPROVED\') RETURNING *',[...keys.map(k=>patch[k]),id]);
      if(!r.rowCount)return Response.json({error:"Sale could not be updated."},{status:409});
      if(syncReceived){
        // Received Amount sirf marker hai (paisa dealer ledger me receipt voucher se aata hai): koi ledger entry nahi, sirf balance kam hota hai.
        const row=r.rows[0];
        if(row.old_rickshaw_id){
          const payable=Math.max(0,num(row.sale_amount)-num(row.hypothecation_amount));
          await pool.query("UPDATE old_rickshaw SET receipt_amount=$1,balance_amount=$2,updated_at=now() WHERE id=$3",[syncReceived.amount,Math.max(0,payable-syncReceived.amount),row.old_rickshaw_id]).catch(()=>{});
          await pool.query("UPDATE old_rickshaw_inventory SET balance_amount=$1,updated_at=now() WHERE old_rickshaw_id=$2",[Math.max(0,payable-syncReceived.amount),row.old_rickshaw_id]).catch(()=>{});
        }
      }
      return Response.json({success:true,sale:r.rows[0]});
    }
    if(p.startsWith("dealer/pending-sales/") && p.endsWith("/page") && method==="PUT" && a.scope==="dealer"){
      const id=idOf(path[path.length-2]),b:any=await json(req); if(!id)return Response.json({error:"Application id required."},{status:400});
      const r=await pool.query("SELECT customer_id FROM loan_workflow WHERE id=$1 AND dealer_id=$2 LIMIT 1",[id,num(a.dealer_id)]);
      if(!r.rowCount)return Response.json({error:"Pending sale not found."},{status:404});
      if(!r.rows[0].customer_id)return Response.json({error:"No linked customer record."},{status:400});
      const u=await pool.query("UPDATE dealer_cash_customer SET page_no=$1 WHERE id=$2 AND dealer_id=$3 RETURNING page_no",[String(b.page_no||"").trim()||null,num(r.rows[0].customer_id),num(a.dealer_id)]);
      return Response.json({success:true,page_no:u.rows[0]?.page_no||null});
    }
  return null;
}
