import jwt from "jsonwebtoken";
import { Pool } from "pg";
export const dynamic="force-dynamic";
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3,ssl:{rejectUnauthorized:false}});
const secret=process.env.JWT_SECRET||"grd-node-change-this-secret";
const num=(v:any)=>Number.isFinite(Number(v))?Number(v):0;
function auth(req:Request){const h=req.headers.get("authorization")||"",t=h.startsWith("Bearer ")?h.slice(7):"";if(!t)return null;try{return jwt.verify(t,secret) as any}catch{return null}}
export async function GET(req:Request){
 try{
  const a=auth(req);if(!a)return Response.json({error:"Authentication required."},{status:401});
  if(a.scope!=="dealer")return Response.json({error:"Dealer ledger is only available in dealer portal."},{status:403});
  const did=num(a.dealer_id),u=new URL(req.url),from=String(u.searchParams.get("from")||"").trim(),to=String(u.searchParams.get("to")||"").trim(),search=String(u.searchParams.get("search")||"").trim().toLowerCase();
  const dr=await pool.query("SELECT id,name,LOWER(COALESCE(dealer_category,'dealer')) AS cat FROM dealer WHERE id=$1 LIMIT 1",[did]);
  if(!dr.rowCount)return Response.json({events:[],rows:[],count:0});
  if(["showroom","branch"].includes(String(dr.rows[0].cat||"")))return Response.json({error:"Ledger sirf Dealer ke liye hai."},{status:403});
  const dealerName=String(dr.rows[0].name||"").trim().toLowerCase();
  const rr=await pool.query("SELECT * FROM day_book LIMIT 5000");
  const rows=rr.rows.filter((x:any)=>{
    const rowDealer=String(x.dealer_id||"").trim();
    const party=String(x.party_name||x.account_name||x.account||"");
    const doc=String(x.doc_no||x.voucher_no||x.reference_no||x.bill_no||"");
    const text=[party,doc,String(x.narration||""),String(x.particulars||""),String(x.chassis_no||"")].join(" ").toLowerCase();
    const d=String(x.date||"").slice(0,10);
    const dealerMatch=rowDealer?Number(rowDealer)===did:party.toLowerCase()===dealerName||String(x.dealer_name||"").toLowerCase()===dealerName;
    return dealerMatch&&(!from||d>=from)&&(!to||d<=to)&&(!search||text.includes(search));
  }).sort((a:any,b:any)=>String(a.date||"").localeCompare(String(b.date||"")));
  let running=0;
  const events=rows.map((x:any)=>{
    const debit=num(x.debit||x.dr_amount||x.debit_amount),credit=num(x.credit||x.cr_amount||x.credit_amount);
    running+=debit-credit;
    return {record_type:"day_book",record_id:x.id,date:x.date,doc_no:x.doc_no||x.voucher_no||x.bill_no||"",account:x.party_name||x.account_name||x.account||"",lines:[x.narration||x.particulars||x.description||""].filter(Boolean),debit,credit,balance:running,dc:running>=0?"Dr":"Cr",vr_type:debit?"S":"R"};
  });
  return Response.json({events,rows:events,count:events.length});
 }catch(e:any){console.error("[dealer-ledger]",e);return Response.json({error:e.message||"Unable to load dealer ledger."},{status:500})}
}
