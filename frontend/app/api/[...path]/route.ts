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
async function genericGet(req:Request,path:string[],table:string){
  const cols=await columns(table);
  if(!cols.size)return Response.json({error:"Table not found",table},{status:404});
  const id=idOf(path[path.length-1]);
  let sql='SELECT * FROM "'+table+'"',args:any[]=[];
  if(id&&/^\d+$/.test(path[path.length-1]||"")){sql+=" WHERE id=$1";args=[id]}
  else{
    const u=new URL(req.url),where:string[]=[];
    for(const [k,v] of u.searchParams.entries()){
      const c=snake(k);
      if(cols.has(c)&&c!=="id"){args.push(v);where.push('"'+c+'"=$'+args.length)}
    }
    if(where.length)sql+=" WHERE "+where.join(" AND ");
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
function canWrite(a:any,p:string){
  // Dealer tokens are never allowed to use generic CRUD against staff/master tables.
  if(a?.scope==="dealer") return p==="dealer/submit-loan";
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

export async function GET(req:Request,{params}:{params:Promise<{path?:string[]}>}){
  try{
    const {path=[]}=await params,p=path.join("/");
    if(p==="health")return Response.json({status:"ok",backend:"node",python:false});
    const a=auth(req);if(!a)return Response.json({error:"Authentication required."},{status:401});
    if(!canRead(a,p))return Response.json({error:"Forbidden."},{status:403});
    if(p==="menu"){const r=await pool.query("SELECT * FROM nav_tab ORDER BY id");return Response.json({menu:r.rows,tabs:r.rows});}
    if(p==="dashboard"){
      const [v,s]=await Promise.all([
        pool.query("SELECT * FROM vehicle ORDER BY id DESC LIMIT 100"),
        pool.query("SELECT stage,COUNT(*)::int AS count FROM vehicle GROUP BY stage")
      ]);
      const stage_counts:any={};for(const r of s.rows)stage_counts[r.stage||"Unknown"]=r.count;
      return Response.json({manufacturing:v.rows.filter((x:any)=>x.stage==="Manufacturing"),
        delivery_challan:v.rows.filter((x:any)=>x.stage==="Delivery Challan"),
        tax_invoice:v.rows.filter((x:any)=>x.stage==="Tax Invoice"),stage_counts,monthly:[],billed_monthly:[],cash_at_dealer:0});
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
    if(p==="production-formulas/lines"){
      const r=await pool.query("SELECT * FROM production_formula ORDER BY id");
      return Response.json({rows:r.rows,items:r.rows,data:r.rows});
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
    if(p==="auth/me"){
      const r=await pool.query('SELECT id,username,mobile,department,is_super_user,allowed_modules FROM "user" WHERE id=$1',[num(a.sub)]);
      return Response.json({user:r.rows[0]||null});
    }
    if(p==="dealer/loan-status"||p==="loan-application-view"){
      const did=a.scope==="dealer"?num(a.dealer_id):null;
      const r=did?await pool.query("SELECT * FROM loan_workflow WHERE dealer_id=$1 ORDER BY id DESC",[did]):await pool.query("SELECT * FROM loan_workflow ORDER BY id DESC LIMIT 1000");
      return Response.json({applications:r.rows,rows:r.rows,count:r.rowCount});
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
    if(p==="delivery-challans" || p==="dealer/delivery-challans"){
      const did=a.scope==="dealer"?num(a.dealer_id):num(b.dealer_id);
      const vehicleId=num(b.vehicle_id);
      const r=await pool.query("INSERT INTO delivery_challan (challan_no,date,cancelled,dealer_id,destination,vehicle_id,product_name,chassis_no,motor_no,controller_no,differential_no,colour,sale_value,remarks1,remarks2,created_at) VALUES (COALESCE(NULLIF($1,''),'DC-'||extract(epoch from now())::bigint),COALESCE($2::timestamptz,NOW()),false,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW()) RETURNING *",
        [String(b.challan_no||""),b.date||null,did, b.destination||null,vehicleId||null,b.product_name||null,b.chassis_no||null,b.motor_no||null,b.controller_no||null,b.differential_no||null,b.colour||null,num(b.sale_value),b.remarks1||null,b.remarks2||null]);
      if(vehicleId) await pool.query("UPDATE vehicle SET stage='Delivery Challan' WHERE id=$1",[vehicleId]);
      return Response.json({success:true,row:r.rows[0],data:r.rows[0]},{status:201});
    }
    if(p==="tax-invoices"){
      const taxable=num(b.gst_sale_amount||b.sale_amount);
      const rate=num(b.gst_rate);
      const gst=taxable*rate/100, sameState=(String(b.state_type||"").toLowerCase()==="intra"||String(b.buyer_state_code||"")===String(b.seller_state_code||""));
      const r=await pool.query("INSERT INTO tax_invoice (bill_no,date,cancelled,delivery_challan_id,dealer_id,vehicle_id,buyer_name,buyer_gst_no,buyer_state,buyer_state_code,state_type,product_name,chassis_no,motor_no,sale_amount,gst_sale_amount,gst_rate,discount,insurance_amount,registration_amount,amount_received,subsidy_amount,created_at) VALUES (COALESCE(NULLIF($1,''),'INV-'||extract(epoch from now())::bigint),COALESCE($2::timestamptz,NOW()),false,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,NOW()) RETURNING *",
        [String(b.bill_no||""),b.date||null,num(b.delivery_challan_id)||null,num(b.dealer_id)||null,num(b.vehicle_id)||null,b.buyer_name||null,b.buyer_gst_no||null,b.buyer_state||null,b.buyer_state_code||null,b.state_type||null,b.product_name||null,b.chassis_no||null,b.motor_no||null,num(b.sale_amount),taxable,rate,num(b.discount),num(b.insurance_amount),num(b.registration_amount),num(b.amount_received),num(b.subsidy_amount)]);
      if(num(b.vehicle_id)) await pool.query("UPDATE vehicle SET stage='Tax Invoice',dealer_name=COALESCE($1,dealer_name) WHERE id=$2",[b.dealer_name||null,num(b.vehicle_id)]);
      return Response.json({success:true,row:r.rows[0],data:r.rows[0],gst:{rate,amount:gst,cgst:sameState?gst/2:0,sgst:sameState?gst/2:0,igst:sameState?0:gst}},{status:201});
    }
    if(p==="production-vouchers"){
      const r=await pool.query("INSERT INTO production_voucher (vou_no,date,product_name,quantity,chassis_no,motor_no,controller_no,differential_no,colour,colour_code,created_at) VALUES (COALESCE(NULLIF($1,''),'PV-'||extract(epoch from now())::bigint),COALESCE($2::timestamptz,NOW()),$3,$4,$5,$6,$7,$8,$9,$10,NOW()) RETURNING *",
        [String(b.vou_no||""),b.date||null,b.product_name||"",num(b.quantity),b.chassis_no||"",b.motor_no||null,b.controller_no||null,b.differential_no||null,b.colour||null,b.colour_code||null]);
      if(b.chassis_no) await pool.query("INSERT INTO vehicle (date,model_name,chassis_no,motor_no,controller_no,differential_no,colour,colour_code,stage) VALUES (NOW(),$1,$2,$3,$4,$5,$6,$7,'Manufacturing') ON CONFLICT (chassis_no) DO UPDATE SET stage='Manufacturing'",[b.product_name||null,b.chassis_no,b.motor_no||null,b.controller_no||null,b.differential_no||null,b.colour||null,b.colour_code||null]);
      return Response.json({success:true,row:r.rows[0],data:r.rows[0]},{status:201});
    }
    if(p.startsWith("delivery-challans/") && p.endsWith("/cancel")){
      const id=idOf(path[path.length-2]); if(!id)return Response.json({error:"Record id required."},{status:400});
      const r=await pool.query("UPDATE delivery_challan SET cancelled=true WHERE id=$1 RETURNING *",[id]);
      return Response.json({success:r.rowCount>0,row:r.rows[0]||null});
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
    if(p==="dealer/submit-loan"){
      const did=a.scope==="dealer"?num(a.dealer_id):num(b.dealer_id);
      const r=await pool.query("INSERT INTO loan_workflow (application_no,dealer_id,customer_id,status,loan_amount,loan_model_name,loan_vehicle_type,created_at,updated_at) VALUES (COALESCE(NULLIF($1,''),'APP-'||extract(epoch from now())::bigint),$2,$3,'SUBMITTED',$4,$5,$6,NOW(),NOW()) RETURNING *",
        [String(b.application_no||""),did,num(b.customer_id),num(b.loan_amount),b.loan_model_name||null,b.loan_vehicle_type||"new"]);
      return Response.json({success:true,application:r.rows[0]},{status:201});
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
    if(p.startsWith("delivery-challans/") && p.endsWith("/cancel") && method==="POST"){
      const id=idOf(path[path.length-2]); if(!id)return Response.json({error:"Record id required."},{status:400});
      const r=await pool.query("UPDATE delivery_challan SET cancelled=true WHERE id=$1 RETURNING *",[id]);
      return Response.json({success:r.rowCount>0,row:r.rows[0]||null});
    }
    if(p.startsWith("tax-invoices/") && p.endsWith("/cancel") && method==="POST"){
      const id=idOf(path[path.length-2]); if(!id)return Response.json({error:"Record id required."},{status:400});
      const r=await pool.query("UPDATE tax_invoice SET cancelled=true WHERE id=$1 RETURNING *",[id]);
      return Response.json({success:r.rowCount>0,row:r.rows[0]||null});
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
    if(!table)return Response.json({error:"Node API route not implemented",path:"/api/"+p},{status:404});
    return genericWrite(req,path,table,method);
  }catch(e:any){console.error("[node-api mutation]",e);return Response.json({error:e.message||"Internal server error"},{status:500})}
}
