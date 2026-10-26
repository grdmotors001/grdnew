import crypto from "crypto";
import jwt from "jsonwebtoken";
import { Pool } from "pg";
import { ensurePinSchema, signPinToken } from "../../../../lib/server/pin";

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
    if(user && verifyWerkzeug(user.password_hash,password)){
      // OTP removed. If the user has a PIN -> ask for it; otherwise offer "Set PIN" (with Skip).
      await ensurePinSchema(pool);
      const pr=await pool.query('SELECT login_pin_hash FROM "user" WHERE id=$1',[user.id]);
      const hasPin=Boolean(pr.rows[0]?.login_pin_hash);
      const {password_hash,login_pin_hash,pin_failed_attempts,pin_locked_until,...safe}=user;
      return Response.json(hasPin
        ? {pin_required:true,pin_token:signPinToken(user,"pin_verify"),user:safe,role:user.department||"staff"}
        : {pin_setup:true,pin_token:signPinToken(user,"pin_setup"),user:safe,role:user.department||"staff"});
    }

    // One login screen: if the ID belongs to a Dealer, authenticate it here
    // instead of forcing the user to switch to a separate Dealer tab.
    const dr=await pool.query("SELECT * FROM dealer WHERE login_id=$1 LIMIT 1",[userid]);
    const dealer=dr.rows[0];
    if(dealer && !dealer.blocked && verifyWerkzeug(dealer.password_hash,password)){
      // Dealer ko bhi staff jaisa PIN: PIN set hai to poochho, nahi to Set PIN (skip ke option ke saath).
      await ensurePinSchema(pool);
      const pr=await pool.query("SELECT 1 FROM dealer_login_pin WHERE dealer_id=$1::int",[dealer.id]);
      const who={id:dealer.id,username:dealer.login_id};
      const safe={id:dealer.id,code:dealer.code,name:dealer.name,login_id:dealer.login_id};
      return Response.json(pr.rowCount
        ? {pin_required:true,pin_token:signPinToken(who,"pin_verify","dealer"),user:safe,role:"dealer"}
        : {pin_setup:true,pin_token:signPinToken(who,"pin_setup","dealer"),user:safe,role:"dealer"});
    }

    return Response.json({error:"Invalid Username/Mobile, Dealer ID or Password."},{status:401});
  }catch(e:any){console.error("[staff-login]",e);return Response.json({error:e.message||"Staff login failed"},{status:500})}
}