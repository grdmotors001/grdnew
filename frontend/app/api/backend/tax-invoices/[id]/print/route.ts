import jwt from "jsonwebtoken";
import { Pool } from "pg";
export const dynamic="force-dynamic";
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3,ssl:{rejectUnauthorized:false}});
const secret=process.env.JWT_SECRET||"grd-node-change-this-secret";
function auth(req:Request){const h=req.headers.get("authorization")||"",t=h.startsWith("Bearer ")?h.slice(7):"";if(!t)return null;try{return jwt.verify(t,secret) as any}catch{return null}}
function pick(o:any,...k:string[]){for(const x of k){if(o?.[x]!=null&&String(o[x]).trim()!=="")return o[x]}return ""}
async function productLogo(name:string,model:string){
  // UMRN code lives on the PRODUCT master (not on vehicle). Match product by name.
  const r=await pool.query("SELECT to_jsonb(p)->>'umrn_code' AS umrn_code,to_jsonb(p)->>'chassis_item_code' AS chassis_item_code,p.name FROM product p WHERE lower(btrim(p.name)) IN (lower(btrim($1)),lower(btrim($2))) ORDER BY (COALESCE(to_jsonb(p)->>'umrn_code','')<>'') DESC,(p.fro='F') DESC,p.id DESC LIMIT 1",[name||"",model||""]);
  const x=r.rows[0]||{},umrn=String(x.umrn_code||"").trim();
  const keys=[umrn,String(x.chassis_item_code||"").trim(),String(x.name||name||model||"").trim()].filter((k,i,a)=>k&&a.indexOf(k)===i);
  return {umrn_code:umrn,logo_keys:keys};
}
export async function GET(req:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const a=auth(req);if(!a)return Response.json({error:"Authentication required."},{status:401});
  const {id}=await params;const u=new URL(req.url),doc=String(u.searchParams.get("doc")||"invoice");
  const r=await pool.query("SELECT ti.*,row_to_json(d) AS dealer_json,row_to_json(v) AS vehicle_json FROM tax_invoice ti LEFT JOIN dealer d ON d.id=ti.dealer_id LEFT JOIN vehicle v ON v.id=ti.vehicle_id WHERE ti.id=$1",[Number(id)]);
  if(!r.rowCount)return Response.json({error:"Tax Invoice not found."},{status:404});
  const x=r.rows[0],d=x.dealer_json||{},v=x.vehicle_json||{};
  const invoice={...x,dealer_name:pick(x,"dealer_name")||d.name||"",dealer_code:d.code||"",dealer_mobile:d.mobile||"",dealer_gst_no:d.gst_no||"",dealer_address1:d.address1||"",dealer_address2:d.address2||"",product_name:pick(x,"product_name")||v.model_name||"",chassis_no:pick(x,"chassis_no")||v.chassis_no||"",motor_no:pick(x,"motor_no")||v.motor_no||"",colour:pick(x,"colour")||v.colour||"",battery_maker:v.battery_maker||"",battery_no1:v.battery_no1||"",battery_no2:v.battery_no2||"",battery_no3:v.battery_no3||"",battery_no4:v.battery_no4||"",umrn_code:"",colour_code:v.colour_code||""};
  const logo=await productLogo(invoice.product_name,v.model_name||"");invoice.umrn_code=logo.umrn_code||v.umrn_code||"";(invoice as any).logo_keys=logo.logo_keys;
  const company=(await pool.query("SELECT * FROM company ORDER BY id LIMIT 1")).rows[0]||{};
  let rto_address="";const rtoName=String(x.rto||x.rto_name||"").trim();
  if(rtoName){const rm=await pool.query("SELECT * FROM simple_master WHERE lower(kind)='rto' AND lower(name)=lower($1) ORDER BY id DESC LIMIT 1",[rtoName]);const rr=rm.rows[0]||{};rto_address=String(rr.address||rr.address1||rr.address2||rr.details||"")}
  return Response.json({invoice,company,product:{umrn_code:invoice.umrn_code,logo_keys:logo.logo_keys,colour_code:invoice.colour_code,name:invoice.product_name},doc_title:doc==="invoice"?"TAX INVOICE":doc.toUpperCase(),doc_no_label:doc==="invoice"?"Bill No.":"Document No.",rto_address,print_bank_name:company.bank_name||"",print_bank_account_no:company.bank_account_no||"",print_bank_ifsc:company.bank_ifsc||""});
 }catch(e:any){console.error("[tax-invoice-print]",e);return Response.json({error:e.message||"Unable to load Tax Invoice print."},{status:500})}
}
