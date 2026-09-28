import jwt from "jsonwebtoken";
import { Pool } from "pg";
export const dynamic="force-dynamic";
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3,ssl:{rejectUnauthorized:false}});
const secret=process.env.JWT_SECRET||"grd-node-change-this-secret";
function auth(req:Request){const h=req.headers.get("authorization")||"",t=h.startsWith("Bearer ")?h.slice(7):"";if(!t)return null;try{return jwt.verify(t,secret) as any}catch{return null}}
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
  const {id}=await params;
  const r=await pool.query("SELECT dc.*,row_to_json(d) AS dealer_json,row_to_json(v) AS vehicle_json FROM delivery_challan dc LEFT JOIN dealer d ON d.id=dc.dealer_id LEFT JOIN vehicle v ON v.id=dc.vehicle_id WHERE dc.id=$1",[Number(id)]);
  if(!r.rowCount)return Response.json({error:"Delivery Challan not found."},{status:404});
  const x=r.rows[0],d=x.dealer_json||{},v=x.vehicle_json||{};
  const challan={...x,dealer_name:x.dealer_name||d.name||"",dealer_code:d.code||"",dealer_mobile:d.mobile||"",dealer_gst_no:d.gst_no||"",dealer_address1:d.address1||"",dealer_address2:d.address2||"",product_name:x.product_name||v.model_name||"",chassis_no:x.chassis_no||v.chassis_no||"",motor_no:x.motor_no||v.motor_no||"",colour:x.colour||v.colour||"",controller_no:x.controller_no||"",other:x.other||"",remarks1:x.remarks1||"",remarks2:x.remarks2||"",destination:x.destination||"",salesman:x.salesman||"",formula_name:x.formula_name||"",battery_maker:v.battery_maker||"",battery_no1:v.battery_no1||"",battery_no2:v.battery_no2||"",battery_no3:v.battery_no3||"",battery_no4:v.battery_no4||"",umrn_code:"",colour_code:v.colour_code||"",dealer_page_no:x.dealer_page_no||""};
  const logo=await productLogo(challan.product_name,v.model_name||"");challan.umrn_code=logo.umrn_code||v.umrn_code||"";(challan as any).logo_keys=logo.logo_keys;
  const company=(await pool.query("SELECT * FROM company ORDER BY id LIMIT 1")).rows[0]||{};
  return Response.json({challan,company});
 }catch(e:any){console.error("[delivery-challan-print]",e);return Response.json({error:e.message||"Unable to load Delivery Challan print."},{status:500})}
}
