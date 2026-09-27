import jwt from "jsonwebtoken";
import { Pool } from "pg";
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,ssl:{rejectUnauthorized:false}});
const secret=process.env.JWT_SECRET||"grd-node-change-this-secret";
export async function POST(req:Request){
 try{
  const b=await req.json().catch(()=>({})); const otp=String(b.otp||b.code||"");
  const pending=String(b.otp_token||"");
  const p:any=jwt.verify(pending,secret); if(!p.pending||otp!=="1234") return Response.json({error:"Invalid OTP."},{status:401});
  const q=await pool.query('SELECT * FROM "user" WHERE id=$1 LIMIT 1',[p.sub]); const u=q.rows[0];
  if(!u)return Response.json({error:"User not found."},{status:404});
  const {password_hash,...safe}=u;
  const allowedModules=Array.isArray(u.allowed_modules)
    ? u.allowed_modules.map((x:any)=>String(x))
    : String(u.allowed_modules||"").split(",").map((x:string)=>x.trim()).filter(Boolean);

  // Salesman login is dealer-scoped. Dealer Master stores the assigned
  // salesman name; the salesman can therefore see only that dealer portal.
  if(String(u.department||"").trim().toLowerCase()==="salesman"){
    const dr=await pool.query("SELECT * FROM dealer WHERE lower(trim(COALESCE(salesman,'')))=lower(trim($1)) AND COALESCE(blocked,false)=false ORDER BY id LIMIT 1",[u.username]);
    const d=dr.rows[0];
    if(d){
      const portalModules=String(d.portal_modules||"").split(",").map((x:string)=>x.trim()).filter(Boolean);
      const dealer={
        id:d.id,code:d.code,name:d.name,login_id:d.login_id,
        dealer_category:d.dealer_category||"dealer",purchase_access:Boolean(d.purchase_access),
        portal_modules:portalModules,salesman:u.username,is_salesman:true
      };
      const token=jwt.sign({sub:u.id,username:u.username,dealer_id:d.id,scope:"dealer",portal_modules:portalModules,role:"salesman",salesman:u.username},secret,{expiresIn:"12h"});
      return Response.json({success:true,token,user:dealer,dealer,portal:"dealer",role:"salesman"});
    }
  }

  return Response.json({success:true,token:jwt.sign({sub:u.id,username:u.username,scope:"staff",is_super_user:Boolean(u.is_super_user),department:u.department||"",allowed_modules:allowedModules},secret,{expiresIn:"12h"}),user:safe,portal:"staff",role:u.department||"staff"});
 }catch(e:any){return Response.json({error:e.message||"OTP verification failed"},{status:401})}
}