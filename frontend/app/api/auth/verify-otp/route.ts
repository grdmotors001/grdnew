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

  if(String(u.department||"").trim().toLowerCase()==="salesman"){
    let assigned:any[]=[];
    try{assigned=Array.isArray(u.assigned_dealer_ids)?u.assigned_dealer_ids.map((x:any)=>Number(x)).filter((x:number)=>Number.isInteger(x)&&x>0):JSON.parse(String(u.assigned_dealer_ids||"[]")).map((x:any)=>Number(x)).filter((x:number)=>Number.isInteger(x)&&x>0)}catch{assigned=[]}
    if(!assigned.length){
      const dr=await pool.query("SELECT id FROM dealer WHERE lower(trim(COALESCE(salesman,'')))=lower(trim($1)) AND COALESCE(blocked,false)=false ORDER BY id",[u.username]);
      assigned=dr.rows.map((x:any)=>Number(x.id)).filter(Boolean);
    }
    const token=jwt.sign({sub:u.id,username:u.username,scope:"staff",role:"salesman",is_super_user:Boolean(u.is_super_user),department:u.department||"Salesman",allowed_modules:allowedModules,assigned_dealer_ids:assigned},secret,{expiresIn:"12h"});
    return Response.json({success:true,token,user:{...safe,assigned_dealer_ids:assigned},portal:"staff",role:"Salesman",assigned_dealer_ids:assigned});
  }

  return Response.json({success:true,token:jwt.sign({sub:u.id,username:u.username,scope:"staff",is_super_user:Boolean(u.is_super_user),department:u.department||"",allowed_modules:allowedModules,assigned_dealer_ids:u.assigned_dealer_ids||[]},secret,{expiresIn:"12h"}),user:safe,portal:"staff",role:u.department||"staff"});
 }catch(e:any){return Response.json({error:e.message||"OTP verification failed"},{status:401})}
}