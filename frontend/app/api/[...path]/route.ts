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
  "billing/vehicle-inventory":"vehicle","billing/old-rickshaw-challans":"old_rickshaw_challan"
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
    if(p==="menu")return Response.json({menu:[]});
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
    if(p==="dealer/me"&&a.scope==="dealer"){
      const r=await pool.query("SELECT * FROM dealer WHERE id=$1",[num(a.dealer_id)]);
      return Response.json({dealer:r.rows[0]||null});
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
    const b:any=await json(req);
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
    const {path=[]}=await params,table=tableFor(path);
    if(!table)return Response.json({error:"Node API route not implemented",path:"/api/"+path.join("/")},{status:404});
    return genericWrite(req,path,table,method);
  }catch(e:any){console.error("[node-api mutation]",e);return Response.json({error:e.message||"Internal server error"},{status:500})}
}
