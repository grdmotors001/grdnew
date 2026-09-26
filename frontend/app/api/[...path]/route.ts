import jwt from "jsonwebtoken";
import { Pool } from "pg";
export const dynamic="force-dynamic";
export const runtime="nodejs";
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:5});
const secret=process.env.JWT_SECRET||"grd-node-change-this-secret";
function auth(req:Request){
 const h=req.headers.get("authorization")||""; const t=h.startsWith("Bearer ")?h.slice(7):"";
 if(!t) return null; try{return jwt.verify(t,secret) as any}catch{return null}
}
const j=async(r:Request)=>await r.json().catch(()=>({}));
const n=(v:any)=>Number.isFinite(Number(v))?Number(v):0;
export async function GET(req:Request,{params}:{params:Promise<{path?:string[]}>}){
 try{
  const a=auth(req); const {path=[]}=await params; const p=path.join("/");
  if(p==="health") return Response.json({status:"ok",backend:"node",python:false});
  if(!a)return Response.json({error:"Authentication required."},{status:401});
  if(p==="dashboard"){
   const [v,s,i]=await Promise.all([
    pool.query('SELECT * FROM vehicle ORDER BY id DESC LIMIT 50'),
    pool.query('SELECT stage,COUNT(*)::int AS count FROM vehicle GROUP BY stage'),
    pool.query('SELECT * FROM tax_invoice WHERE cancelled=false ORDER BY id DESC LIMIT 100')
   ]);
   const stage_counts:any={}; for(const r of s.rows)stage_counts[r.stage||"Unknown"]=r.count;
   return Response.json({manufacturing:v.rows.filter(x=>x.stage==="Manufacturing"),delivery_challan:v.rows.filter(x=>x.stage==="Delivery Challan"),tax_invoice:v.rows.filter(x=>x.stage==="Tax Invoice"),stage_counts,monthly:[],billed_monthly:[],cash_at_dealer:0});
  }
  if(p==="company"){const r=await pool.query('SELECT * FROM company ORDER BY id LIMIT 1');return Response.json({company:r.rows[0]||null});}
  if(p==="dealer-list"||p==="dealers"){const r=await pool.query('SELECT * FROM dealer ORDER BY name');return Response.json({dealers:r.rows});}
  if(p==="menu")return Response.json({menu:[]});
  if(p==="nav-config"){const r=await pool.query('SELECT * FROM nav_tab WHERE hidden IS NOT TRUE ORDER BY position NULLS LAST,id');return Response.json({tabs:r.rows});}
  if(p==="dealer/customers"){const did=a.scope==="dealer"?n(a.dealer_id):null;const r=did?await pool.query('SELECT * FROM customer WHERE dealer_id=$1 ORDER BY id DESC',[did]):await pool.query('SELECT * FROM customer ORDER BY id DESC LIMIT 1000');return Response.json({customers:r.rows,count:r.rowCount});}
  if(p==="dealer/loan-status"){const did=a.scope==="dealer"?n(a.dealer_id):null;const r=did?await pool.query('SELECT * FROM loan_workflow WHERE dealer_id=$1 ORDER BY id DESC',[did]):await pool.query('SELECT * FROM loan_workflow ORDER BY id DESC LIMIT 1000');return Response.json({applications:r.rows,rows:r.rows});}
  if(p==="loan-application-view"){const r=await pool.query('SELECT * FROM loan_workflow ORDER BY id DESC LIMIT 1000');return Response.json({applications:r.rows,rows:r.rows});}
  return Response.json({error:"Node API route not implemented",path:"/api/"+p},{status:404});
 }catch(e:any){console.error("[node-api]",e);return Response.json({error:e.message||"Internal server error"},{status:500})}
}
export async function POST(req:Request,{params}:{params:Promise<{path?:string[]}>}){
 try{
  const a=auth(req);if(!a)return Response.json({error:"Authentication required."},{status:401});
  const {path=[]}=await params,p=path.join("/"),b=await j(req);
  if(p==="dealer/submit-loan"){
   const did=a.scope==="dealer"?n(a.dealer_id):n(b.dealer_id);
   const r=await pool.query(`INSERT INTO loan_workflow (application_no,dealer_id,customer_id,status,loan_amount,loan_model_name,loan_vehicle_type,created_at,updated_at) VALUES (COALESCE(NULLIF($1,''),'APP-'||extract(epoch from now())::bigint),$2,$3,'SUBMITTED',$4,$5,$6,NOW(),NOW()) RETURNING *`,[String(b.application_no||""),did,n(b.customer_id),n(b.loan_amount),b.loan_model_name||null,b.loan_vehicle_type||null]);
   return Response.json({success:true,application:r.rows[0]},{status:201});
  }
  return Response.json({error:"Node API route not implemented",path:"/api/"+p},{status:404});
 }catch(e:any){console.error("[node-api]",e);return Response.json({error:e.message||"Internal server error"},{status:500})}
}
