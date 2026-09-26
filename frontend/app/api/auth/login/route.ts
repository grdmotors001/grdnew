import crypto from "crypto";
import jwt from "jsonwebtoken";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const secret = process.env.JWT_SECRET || "grd-node-change-this-secret";

function verifyWerkzeug(hash:string, password:string){
  const m=hash.match(/^pbkdf2:sha256:(\d+)\$([^$]+)\$([^$]+)$/);
  if(!m) return false;
  const iterations=Number(m[1]), salt=m[2], expected=m[3];
  const actual=crypto.pbkdf2Sync(password,salt,iterations,32,"sha256").toString("hex");
  return crypto.timingSafeEqual(Buffer.from(actual),Buffer.from(expected));
}
function token(user:any,scope="staff",extra:any={}){
  return jwt.sign({sub:user.id,username:user.username,scope,...extra},secret,{expiresIn:"12h"});
}
export async function POST(req:Request){
  try{
    const body=await req.json().catch(()=>({}));
    const userid=String(body.userid||"").trim(), password=String(body.password||"");
    if(!process.env.DATABASE_URL) return Response.json({error:"DATABASE_URL is not configured"}, {status:500});
    const q=await pool.query('SELECT * FROM "user" WHERE username=$1 OR mobile=$1 LIMIT 1',[userid]);
    const user=q.rows[0];
    if(!user || !verifyWerkzeug(user.password_hash,password)) return Response.json({error:"Invalid Username/Mobile or Password."},{status:401});
    const otpToken=jwt.sign({pending:true,sub:user.id,username:user.username},secret,{expiresIn:"10m"});
    const {password_hash,...safe}=user;
    return Response.json({otp_required:true,otp_token:otpToken,user:safe});
  }catch(e:any){console.error("[staff-login]",e);return Response.json({error:e.message||"Staff login failed"},{status:500})}
}