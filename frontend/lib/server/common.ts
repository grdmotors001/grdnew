// Shared server helpers (bade route file se nikale gaye, code same hai).
// pool/auth/num/idOf/ymd/columns ab sab routes yahin se lete hain.
import jwt from "jsonwebtoken";
import { Pool, types } from "pg";

// DATE columns ko plain "YYYY-MM-DD" string rakho (JS Date banne se timezone ke karan 1 din pichhe ho jaata tha).
types.setTypeParser(1082,(v:string)=>v);
// Ek hi pool poore server me share hota hai (alag-alag file me naya pool = connections khatam).
const g:any=globalThis;
export const pool:Pool=g.__grdSharedPool??(g.__grdSharedPool=new Pool({connectionString:process.env.DATABASE_URL,max:5}));
export const secret=process.env.JWT_SECRET||"grd-node-change-this-secret";

export function auth(req:Request):any{
  const h=req.headers.get("authorization")||"";
  const t=h.startsWith("Bearer ")?h.slice(7):"";
  if(!t)return null;
  try{return jwt.verify(t,secret) as any}catch{return null}
}
export const num=(v:any)=>Number.isFinite(Number(v))?Number(v):0;
export const idOf=(v:any)=>{const n=Number(v);return Number.isInteger(n)&&n>0?n:null};
export function todayDate(){return new Date().toISOString().slice(0,10);}
export function ymd(v:any):string{
  if(v instanceof Date){if(isNaN(v.getTime()))return "";return v.getFullYear()+"-"+String(v.getMonth()+1).padStart(2,"0")+"-"+String(v.getDate()).padStart(2,"0");}
  return String(v||"").slice(0,10);
}
// Sab missing columns ek hi ALTER TABLE se (pehle har column ke liye alag query thi -> remote DB par bahut slow, request timeout).
export async function addColumns(table:string,defs:Record<string,string>){
  const parts=Object.entries(defs).map(([col,type])=>'ADD COLUMN IF NOT EXISTS "'+col+'" '+type);
  if(parts.length)await pool.query('ALTER TABLE "'+table+'" '+parts.join(", "));
}
export async function columns(table:string){
  const r=await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1",[table]);
  return new Set(r.rows.map((x:any)=>x.column_name));
}

// ---- chhote helpers (RC fee jaise naye routes ke liye) ----
export const isStaff=(a:any)=>!!a&&a.scope==="staff";
export const todayYmd=todayDate;
export const jerr=(error:string,status=400)=>Response.json({error},{status});
export const tableColumns=columns;

// ---- CSV / date-filter helpers (bade route file se) ----
export function csvCell(v:any){const s=String(v??"");return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}
export function csvResponse(rows:any[],filename:string){
  if(!rows.length)return new Response("",{status:200,headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":"attachment; filename="+filename}});
  const keys=Object.keys(rows[0]); const body=[keys.map(csvCell).join(","),...rows.map(r=>keys.map(k=>csvCell(r[k])).join(","))].join("\n");
  return new Response(body,{status:200,headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":"attachment; filename="+filename}});
}
export function dateWhere(alias:string,u:URL,args:any[]){
  const w:string[]=[];
  const from=u.searchParams.get("from"),to=u.searchParams.get("to"),search=u.searchParams.get("search");
  if(from){args.push(from);w.push(alias+".date >= $"+args.length+"::date");}
  if(to){args.push(to);w.push(alias+".date <= $"+args.length+"::date");}
  return {w,search};
}

// ---- request body cache (bade route file se) ----
const _bodyCache=new WeakMap<Request,Promise<any>>();
// Body cache: mutation() reads the body for permission/dealer checks and handlers read it again; an uncached req.json() returned {} the 2nd time.
export const json=(req:Request):Promise<any>=>{let p=_bodyCache.get(req);if(!p){p=req.json().catch(()=>({}));_bodyCache.set(req,p);}return p;};

// ---- Import helpers (Excel/CSV): route.ts se yahan laye gaye, logic same ----
// rowGetter: header-insensitive getter ("Chassis No.", "chassis_no", "CHASSIS NO" all match).
// importDate: Excel serial numbers (45930) / dd/mm/yyyy text ko safely YYYY-MM-DD me badalta hai (warna ::date error ya day/month swap).
export function normKey(k:any){return String(k??'').toLowerCase().replace(/[^a-z0-9]/g,'');}
export function rowGetter(o:any){const m:any={};for(const [k,v] of Object.entries(o||{}))m[normKey(k)]=v;return (keys:string[])=>{for(const k of keys){const v=m[normKey(k)];if(v!==undefined&&v!==null&&String(v).trim()!=='')return v;}return '';};}
export function importDate(v:any):string|null{
  if(v===''||v==null)return null;
  const ok=(y:number,m:number,d:number)=>{const t=new Date(Date.UTC(y,m-1,d));return t.getUTCFullYear()===y&&t.getUTCMonth()===m-1&&t.getUTCDate()===d?y+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0'):null;};
  if(v instanceof Date)return isNaN(v.getTime())?null:v.toISOString().slice(0,10);
  if(typeof v==='number'||/^\d{5}(\.\d+)?$/.test(String(v).trim())){const n=Number(v);if(n<20000||n>80000)return null;return new Date(Date.UTC(1899,11,30)+Math.floor(n)*86400000).toISOString().slice(0,10);}
  const t=String(v).trim();let m=t.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);if(m)return ok(+m[1],+m[2],+m[3]);
  m=t.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/);if(m){const y=m[3].length===2?2000+ +m[3]:+m[3];return ok(y,+m[2],+m[1]);}
  return null;
}
export function importAmount(v:any):number{if(typeof v==='number')return Number.isFinite(v)?v:0;const t=String(v??'').replace(/[₹,\s]/g,'').replace(/\((.*)\)/,'-$1').replace(/(dr|cr)\.?$/i,'');const n=Number(t);return Number.isFinite(n)?n:0;}
