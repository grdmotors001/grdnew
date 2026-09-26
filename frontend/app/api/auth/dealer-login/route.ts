import crypto from "crypto";
import jwt from "jsonwebtoken";
import { Pool } from "pg";
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:5});
const secret=process.env.JWT_SECRET||"grd-node-change-this-secret";
function check(hash:string,password:string){
  if(!hash)return false;
  let m=hash.match(/^pbkdf2:sha256:(\d+)\$([^$]+)\$([^$]+)$/);
  if(m){
    const actual=crypto.pbkdf2Sync(password,m[2],Number(m[1]),32,"sha256").toString("hex");
    return actual.length===m[3].length&&crypto.timingSafeEqual(Buffer.from(actual),Buffer.from(m[3]));
  }
  m=hash.match(/^scrypt:(\d+):(\d+):(\d+)\$([^$]+)\$([^$]+)$/);
  if(m){
    const N=Number(m[1]),r=Number(m[2]),p=Number(m[3]);
    const actual=crypto.scryptSync(password,m[4],Buffer.from(m[5],"hex").length,{N,r,p,maxmem:Math.max(128*N*r+1024,64*1024*1024)}).toString("hex");
    return actual===m[5];
  }
  return false;
}
export async function POST(req:Request){
 try{
  const b:any=await req.json().catch(()=>({}));
  const login=String(b.login_id||b.userid||b.username||"").trim(),password=String(b.password||"");
  const r=await pool.query("SELECT * FROM dealer WHERE login_id=$1 LIMIT 1",[login]);
  const d=r.rows[0];
  if(!d||d.blocked||!check(d.password_hash,password))return Response.json({error:"Invalid Dealer Login."},{status:401});
  const portalModules=String(d.portal_modules||"").split(",").map((x:string)=>x.trim()).filter(Boolean);
  const safe={
    id:d.id,
    code:d.code,
    name:d.name,
    login_id:d.login_id,
    dealer_category:d.dealer_category||"dealer",
    purchase_access:Boolean(d.purchase_access),
    portal_modules:portalModules,
  };
  const token=jwt.sign({sub:d.id,username:d.login_id,dealer_id:d.id,scope:"dealer",portal_modules:portalModules},secret,{expiresIn:"12h"});
  return Response.json({success:true,token,dealer:safe,user:safe});
 }catch(e:any){console.error("[dealer-login]",e);return Response.json({error:e.message||"Dealer login failed"},{status:500})}
}