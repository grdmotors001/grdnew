import crypto from "crypto";
import jwt from "jsonwebtoken";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, ssl: { rejectUnauthorized: false } });
const secret = process.env.JWT_SECRET || "grd-node-change-this-secret";

function verifyWerkzeug(hash:string, password:string){
  if(!hash) return false;
  // Existing GRD users may have older Werkzeug PBKDF2 variants.
  let m=hash.match(/^pbkdf2:(sha1|sha256|sha512):(\d+)\$([^$]+)\$([^$]+)$/);
  if(m){
    const digest=m[1], iterations=Number(m[2]), salt=m[3], expected=m[4];
    const actual=crypto.pbkdf2Sync(password,salt,iterations,Math.floor(expected.length/2),digest).toString("hex");
    return actual.length===expected.length && crypto.timingSafeEqual(Buffer.from(actual),Buffer.from(expected));
  }
  m=hash.match(/^scrypt:(\d+):(\d+):(\d+)\$([^$]+)\$([^$]+)$/);
  if(m){
    const N=Number(m[1]), r=Number(m[2]), p=Number(m[3]), salt=m[4], expected=m[5];
    const actual=crypto.scryptSync(password,salt,Buffer.from(expected,"hex").length,{N,r,p,maxmem:Math.max(128*N*r+1024,64*1024*1024)}).toString("hex");
    return actual.length===expected.length && crypto.timingSafeEqual(Buffer.from(actual),Buffer.from(expected));
  }
  return false;
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