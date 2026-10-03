// Expense Payment Voucher (Head Office) - bade route file se nikala gaya, logic wahi hai.
import { pool, num, idOf, ymd, todayDate, columns, addColumns } from "./common";
import { audit, isAdmin } from "./permissions";

// ===================== Expense Payment Voucher (Head Office) =====================
// Voucher pehle "pending" banta hai -> Head Office approve kare to usi transaction me Cash Book (day_book) me
// cash OUT (debit_paid) entry ban jati hai. Reject par koi entry nahi banti. Voucher delete par entry bhi hat jati hai.
export const EPV_TYPES=[
  {id:"office_exp",name:"Office Expense"},{id:"commission",name:"Commission"},{id:"incentive",name:"Incentive"},
  {id:"assembly",name:"Assembly Work"},{id:"fabrication",name:"Fabrication Work"},{id:"passing_exp",name:"Passing Expense"},
  {id:"insurance",name:"Insurance"},{id:"rto_expense",name:"RTO Expense"},
  {id:"dl_exp",name:"DL Expense"},{id:"ll_exp",name:"LL Expense"},{id:"pcc_cvr_exp",name:"PCC/CVR Expense"},{id:"fitness",name:"Fitness Expense"},
  {id:"other",name:"Other Expense"}
];
// In types ka Account Head Master me head hona zaroori hai (Balance Sheet / Profit & Loss ke liye). Head na ho to neeche seed ho jata hai.
export const EPV_HEAD_REQUIRED=["dl_exp","ll_exp","pcc_cvr_exp","fitness","office_exp","other"];
export const EPV_SEED_HEADS=[{name:"DL EXP",sub:"Indirect Expense",et:"dl_exp"},{name:"LL EXP",sub:"Indirect Expense",et:"ll_exp"},{name:"PCC/CVR EXP",sub:"Indirect Expense",et:"pcc_cvr_exp"},{name:"FITNESS",sub:"Indirect Expense",et:"fitness"}];
export const EPV_EXPENSE_SUBS=["direct expense","indirect expense"];
export const epvNorm=(v:any)=>String(v??"").trim().toLowerCase().replace(/[\s_-]+/g," ");
// Account Head Master ki saari expense heads (Direct / Indirect Expense) - kind ka naam guess nahi karte.
export async function epvAccountHeads():Promise<any[]>{
  const sc=await columns("simple_master");
  if(!sc.has("sub_category"))return [];
  const r=await pool.query("SELECT id,name,sub_category,kind,to_jsonb(simple_master)->>'expense_type' AS expense_type FROM simple_master WHERE COALESCE(btrim(name),'')<>'' AND lower(kind)<>'party' ORDER BY name");
  return r.rows.filter((x:any)=>EPV_EXPENSE_SUBS.includes(epvNorm(x.sub_category))).map((x:any)=>({id:Number(x.id),name:String(x.name).trim(),sub_category:String(x.sub_category).trim(),kind:x.kind,expense_type:String(x.expense_type||"").trim()}));
}
// DL/LL/PCC-CVR/Fitness ke heads Account Head Master me na hon to ek baar bana deta hai (naam se dekhta hai, duplicate nahi banata).
export async function epvSeedAccountHeads(){
  try{
    const sc=await columns("simple_master");
    if(!sc.has("sub_category")||!sc.has("kind")||!sc.has("name"))return;
    if(!sc.has("expense_type")){await pool.query('ALTER TABLE simple_master ADD COLUMN IF NOT EXISTS "expense_type" text');sc.add("expense_type");}
    const k=(await pool.query("SELECT kind,COUNT(*) c FROM simple_master WHERE kind ILIKE '%account%' AND kind ILIKE '%head%' GROUP BY kind ORDER BY c DESC LIMIT 1")).rows[0];
    if(!k)return;
    const have=new Set((await pool.query("SELECT name FROM simple_master WHERE kind=$1",[k.kind])).rows.map((x:any)=>epvNorm(x.name)));
    for(const h of EPV_SEED_HEADS){
      if(have.has(epvNorm(h.name))){await pool.query("UPDATE simple_master SET expense_type=$1 WHERE kind=$2 AND lower(btrim(name))=lower($3) AND COALESCE(btrim(expense_type),'')=''",[h.et,k.kind,h.name]);continue;}
      const entry:any={kind:k.kind,name:h.name,sub_category:h.sub,expense_type:h.et};
      const keys=Object.keys(entry).filter(c=>sc.has(c));
      await pool.query('INSERT INTO simple_master ('+keys.map(c=>'"'+c+'"').join(",")+') VALUES ('+keys.map((_,i)=>"$"+(i+1)).join(",")+')',keys.map(c=>entry[c]));
    }
  }catch(e){console.error("[expense voucher seed heads]",e);}
}
export const EPV_TYPE_NAME:any={};
for(const t of EPV_TYPES)EPV_TYPE_NAME[t.id]=t.name;
// ===== Expense Type Master (Masters > Expense Type Master, kind="expense-type") =====
// 13 built-in types (fixed id) master me seed hote hain: naam rename / band ho sakta hai, delete karoge to wapas ban jaate hain.
// Naye types ki id "m"+row id hoti hai aur wo simple expense ki tarah chalte hain (Date, Account Head, Pay To, Amount...).
export const EPV_DEFAULT_CAT:any={assembly:"Direct Expense",fabrication:"Direct Expense"};
export const EPV_CATS=["Direct Expense","Indirect Expense"];
export async function epvTypes(includeInactive:boolean=false):Promise<any[]>{
  const base=EPV_TYPES.map(t=>({id:t.id,name:t.name,sub_category:EPV_DEFAULT_CAT[t.id]||"Indirect Expense",builtin:true,inactive:false}));
  try{
    let sc=await columns("simple_master");
    if(!sc.has("name")||!sc.has("kind"))return base;
    if(!sc.has("type_code")||!sc.has("inactive")||!sc.has("sub_category")){
      await addColumns("simple_master",{type_code:"text",inactive:"boolean DEFAULT false",sub_category:"text"});
    }
    const load=async()=>(await pool.query("SELECT id,name,sub_category,type_code,COALESCE(inactive,false) AS inactive FROM simple_master WHERE kind='expense-type' ORDER BY id")).rows;
    let rows=await load();
    const have=new Set(rows.map((x:any)=>String(x.type_code||"")));
    let added=false;
    for(const t of base){
      if(have.has(t.id))continue;
      await pool.query("INSERT INTO simple_master (kind,name,sub_category,type_code,inactive) VALUES ('expense-type',$1,$2,$3,false)",[t.name,t.sub_category,t.id]);
      added=true;
    }
    if(added)rows=await load();
    const out:any[]=[];
    for(const t of base){
      const r=rows.find((x:any)=>String(x.type_code||"")===t.id);
      out.push({id:t.id,name:String(r?.name||"").trim()||t.name,sub_category:EPV_CATS.includes(String(r?.sub_category||"").trim())?String(r.sub_category).trim():t.sub_category,builtin:true,inactive:!!r?.inactive});
    }
    for(const r of rows){
      if(String(r.type_code||"").trim())continue;
      const nm=String(r.name||"").trim();if(!nm)continue;
      out.push({id:"m"+r.id,name:nm,sub_category:EPV_CATS.includes(String(r.sub_category||"").trim())?String(r.sub_category).trim():"Indirect Expense",builtin:false,inactive:!!r.inactive});
    }
    for(const t of out)EPV_TYPE_NAME[t.id]=t.name;
    for(const t of out)EPV_TYPE_CAT[t.id]=t.sub_category;
    return includeInactive?out:out.filter(t=>!t.inactive);
  }catch(e){console.error("[epvTypes]",e);return base;}
}
export const EPV_TYPE_CAT:any={};
export const EPV_ONE_PER_VEHICLE=["commission","incentive","assembly","insurance","rto_expense","passing_exp"];
let epvSchemaReady:Promise<void>|null=null;
export function ensureEpvSchema():Promise<void>{
  if(!epvSchemaReady){
    epvSchemaReady=(async()=>{
      await pool.query("CREATE TABLE IF NOT EXISTS expense_payment_voucher (id bigserial PRIMARY KEY,voucher_no text,date date NOT NULL DEFAULT CURRENT_DATE,expense_type text,pay_to_name text,amount numeric NOT NULL DEFAULT 0,status text NOT NULL DEFAULT 'pending',created_at timestamptz NOT NULL DEFAULT now())");
      const defs:any={
        voucher_no:"text",date:"date",expense_type:"text",expense_type_name:"text",pay_to_type:"text",pay_to_name:"text",dealer_id:"integer",staff_name:"text",
        vehicle_id:"integer",chassis_no:"text",customer_name:"text",bill_no:"text",payment_mode:"text DEFAULT 'cash'",amount:"numeric NOT NULL DEFAULT 0",
        remarks:"text",attachment_url:"text",work_model_name:"text",work_qty:"numeric",rate_per_unit:"numeric",on_account:"boolean DEFAULT false",
        status:"text NOT NULL DEFAULT 'pending'",payment_status:"text DEFAULT 'unpaid'",approved_by:"text",approved_at:"timestamptz",reject_reason:"text",
        paid_at:"timestamptz",paid_by:"text",day_book_id:"bigint",account_head:"text",account_sub_category:"text",created_by:"text",created_at:"timestamptz NOT NULL DEFAULT now()"
      };
      for(const col of Object.keys(defs))await pool.query('ALTER TABLE expense_payment_voucher ADD COLUMN IF NOT EXISTS "'+col+'" '+defs[col]);
      // Incentive: ONE voucher + N rickshaw lines (approval aur payment isi ek voucher par).
      await pool.query("CREATE TABLE IF NOT EXISTS expense_payment_voucher_line (id bigserial PRIMARY KEY,voucher_id bigint NOT NULL,vehicle_id integer,chassis_no text,customer_name text,bill_no text,model_name text,amount numeric NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now())");
      // Purani DB me kuch columns varchar(n) the (CREATE/ADD COLUMN IF NOT EXISTS unhe nahi badalta) -> "value too long for type character varying(n)".
      // Yahan sab varchar columns ko text bana dete hain (multi-chassis join, lambe naam/remarks ke liye).
      for(const tbl of ["expense_payment_voucher","expense_payment_voucher_line"]){
        const vc=await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 AND data_type='character varying' AND character_maximum_length IS NOT NULL",[tbl]);
        for(const r of vc.rows){try{await pool.query('ALTER TABLE '+tbl+' ALTER COLUMN "'+r.column_name+'" TYPE text');}catch(e){console.error("[epv schema] varchar->text failed",tbl,r.column_name,e);}}
      }
      await pool.query("CREATE INDEX IF NOT EXISTS epv_line_voucher_idx ON expense_payment_voucher_line(voucher_id)");
      await pool.query("CREATE INDEX IF NOT EXISTS epv_line_vehicle_idx ON expense_payment_voucher_line(vehicle_id)");
      await epvSeedAccountHeads();
    })().catch((e:any)=>{epvSchemaReady=null;throw e;});
  }
  return epvSchemaReady;
}
export function epvOut(r:any){
  const st=String(r.status||"pending").toLowerCase();
  const ps=String(r.payment_status||"").toLowerCase()||(r.paid_at?"paid":"unpaid");
  return {...r,id:Number(r.id),date:ymd(r.date),amount:num(r.amount),status:st,payment_status:ps,paid_at:r.paid_at?ymd(r.paid_at):null,
    expense_type_name:r.expense_type_name||EPV_TYPE_NAME[String(r.expense_type||"")]||String(r.expense_type||"")};
}
export async function epvLines(ids:number[]):Promise<Map<number,any[]>>{
  const m=new Map<number,any[]>();
  if(!ids.length)return m;
  const r=await pool.query("SELECT * FROM expense_payment_voucher_line WHERE voucher_id=ANY($1::bigint[]) ORDER BY id",[ids]);
  for(const l of r.rows){const k=Number(l.voucher_id);if(!m.has(k))m.set(k,[]);m.get(k)!.push({...l,id:Number(l.id),voucher_id:k,amount:num(l.amount)});}
  return m;
}
// Voucher + uski rickshaw list. Purane (1 voucher = 1 rickshaw) records ke liye voucher ki apni chassis ek vehicle ban jaati hai.
export function epvWithVehicles(v:any,lines:any[]|undefined){
  const vehicles=lines&&lines.length?lines:(v.vehicle_id||v.chassis_no?[{vehicle_id:v.vehicle_id,chassis_no:v.chassis_no,customer_name:v.customer_name,bill_no:v.bill_no,model_name:v.work_model_name,amount:v.amount}]:[]);
  return {...v,vehicles,chassis_nos:vehicles.map((x:any)=>x.chassis_no).filter(Boolean),vehicle_count:vehicles.length};
}
export async function epvCanApprove(a:any):Promise<boolean>{
  if(isAdmin(a))return true;
  const r=await pool.query("SELECT can_approve FROM user_action_permission WHERE user_id=$1 AND module_key='expense-payment-voucher'",[idOf(a?.sub)]);
  return Boolean(r.rows[0]?.can_approve);
}
// Naye rules: voucher banane wale ka naam, approve karne wale ka naam, aur Paid sirf Cashier.
// - Voucher kisne banaya = created_by (username). Apna banaya voucher khud approve nahi kar sakte, sirf Admin kar sakta hai.
// - Paid mark + Cash Book (day_book) entry sirf Cashier department ka user karega; entry usi ke naam se banegi.
const epvWho=(a:any)=>String(a?.username||a?.sub||"");
export const epvIsCashier=(a:any)=>String(a?.department||"").trim().toLowerCase()==="cashier";
export function epvIsOwn(v:any,a:any){const c=String(v?.created_by||"").trim().toLowerCase(),me=epvWho(a).trim().toLowerCase();return !!c&&!!me&&c===me;}
// UI ke liye har row par: current user is voucher ko approve / Paid kar sakta hai ya nahi.
export function epvWithFlags(v:any,a:any,canApproveRight:boolean){
  const st=String(v.status||"").toLowerCase(),ps=String(v.payment_status||"").toLowerCase();
  return {...v,
    can_approve:st==="pending"&&canApproveRight&&(isAdmin(a)||!epvIsOwn(v,a)),
    can_pay:st==="approved"&&ps!=="paid"&&epvIsCashier(a),
    own_voucher:epvIsOwn(v,a)};
}
export function epvFail(msg:string,status:number){return Object.assign(new Error(msg),{status});}
// Approve hote hi Cash Book (day_book) me cash OUT entry. Cash Handover wale code jaisa vr_no handling.
export async function epvPostDayBook(client:any,v:any,by:string=""):Promise<any>{
  const dbc=await columns("day_book");
  if(!dbc.size)throw epvFail("Day Book table nahi mili.",500);
  if(!dbc.has("debit_paid"))throw epvFail("Day Book me debit_paid column nahi mila.",500);
  const vt=(await client.query("SELECT data_type FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='day_book' AND column_name='vr_no'")).rows[0]?.data_type||"";
  let vrNo:any=null;
  if(["integer","bigint","smallint","numeric"].includes(vt))vrNo=Number((await client.query("SELECT COALESCE(MAX(vr_no),0)+1 AS n FROM day_book")).rows[0]?.n||1);
  else if(vt)vrNo=v.voucher_no||("EPV-"+Date.now());
  const mode=String(v.payment_mode||"cash").toLowerCase();
  const narr="Expense voucher "+(v.voucher_no||"")+" - "+(v.expense_type_name||"Expense")+" - "+(v.pay_to_name||"")
    +(v.account_head?" | Head "+v.account_head:"")+(v.chassis_no?" | Chassis "+v.chassis_no:"")+(v.expense_type==="incentive"&&num(v.work_qty)>1?" | "+num(v.work_qty)+" rickshaw":"")+(v.customer_name?" | "+v.customer_name:"")+(v.work_model_name?" | "+v.work_model_name+" x"+num(v.work_qty||1):"")
    +(mode!=="cash"?" | Mode "+mode:"")+(v.bill_no?" | Bill "+v.bill_no:"")+(v.remarks?" | "+v.remarks:"")
    +(v.created_by?" | Voucher by "+v.created_by:"")+(v.approved_by?" | Approved by "+v.approved_by:"")+(by?" | Paid by "+by:"");
  const entry:any={date:ymd(v.date)||todayDate(),vr_no:vrNo,dealer_name:v.pay_to_name||"",party_name:v.pay_to_name||"",credit_received:0,debit_paid:num(v.amount),
    payment_mode:"cash",mode:"cash",narration:narr,remarks:narr,voucher_no:v.voucher_no||null,doc_no:v.voucher_no||null,created_by:by||null};
  const keys=Object.keys(entry).filter(k=>dbc.has(k)&&!(k==="vr_no"&&vrNo==null));
  const ins=await client.query('INSERT INTO day_book ('+keys.map(k=>'"'+k+'"').join(",")+') VALUES ('+keys.map((_,i)=>"$"+(i+1)).join(",")+') RETURNING id',keys.map(k=>entry[k]));
  return ins.rows[0]?.id||null;
}
export async function epvVehicles(expenseType:string,dealerName:string){
  const args:any[]=[expenseType];
  let where="COALESCE(btrim(v.chassis_no),'')<>''";
  if(dealerName){args.push(dealerName);where+=" AND lower(btrim(COALESCE(v.dealer_name,'')))=lower(btrim($2))";}
  const r=await pool.query(`SELECT v.id AS vehicle_id,v.date,v.chassis_no,v.model_name,v.dealer_name FROM vehicle v WHERE ${where}
    AND NOT EXISTS (SELECT 1 FROM expense_payment_voucher e WHERE e.vehicle_id=v.id AND lower(COALESCE(e.expense_type,''))=$1 AND lower(COALESCE(e.status,'')) NOT IN ('rejected','cancelled','canceled'))
    ORDER BY v.date DESC NULLS LAST,v.id DESC LIMIT 1000`,args);
  return r.rows;
}
export async function expenseVoucherGet(req:Request,path:string[],a:any):Promise<Response|null>{
  await ensureEpvSchema();
  const sub=path.slice(1).join("/"),u=new URL(req.url);
  await epvTypes(true);
  const q=(k:string)=>String(u.searchParams.get(k)||"").trim();
  if(sub===""){
    const st=q("status").toLowerCase();
    const where=st==="paid"?" WHERE lower(COALESCE(payment_status,''))='paid'":st==="unpaid"?" WHERE lower(COALESCE(payment_status,''))<>'paid' AND lower(COALESCE(status,''))<>'rejected'":"";
    const r=await pool.query("SELECT * FROM expense_payment_voucher"+where+" ORDER BY date DESC,id DESC LIMIT 1000");
    const lm=await epvLines(r.rows.map((x:any)=>Number(x.id)));
    const canAp=await epvCanApprove(a);
    const vouchers=r.rows.map((x:any)=>epvWithFlags(epvWithVehicles(epvOut(x),lm.get(Number(x.id))),a,canAp));
    return Response.json({vouchers,rows:vouchers,count:vouchers.length,is_cashier:epvIsCashier(a),can_approve:canAp});
  }
  if(sub==="masters"){
    const dealers=(await pool.query("SELECT id,code,name FROM dealer WHERE COALESCE(blocked,false)=false ORDER BY name,id").catch(()=>({rows:[]as any[]}))).rows;
    const kindList=async(pattern:string[])=>(await pool.query("SELECT id,name FROM simple_master WHERE ("+pattern.map((_,i)=>"kind ILIKE $"+(i+1)).join(" OR ")+") AND COALESCE(btrim(name),'')<>'' ORDER BY name",pattern).catch(()=>({rows:[]as any[]}))).rows;
    const mechanics=await kindList(["%mechanic%","%assembl%"]),fabricators=await kindList(["%fabricat%"]);
    let staff:any[]=[];
    try{
      const uc=await columns("user");
      const expr=uc.has("full_name")&&uc.has("username")?"COALESCE(NULLIF(btrim(full_name),''),username)":uc.has("full_name")?"full_name":uc.has("username")?"username":uc.has("name")?"name":"";
      if(expr)staff=(await pool.query('SELECT DISTINCT '+expr+' AS name FROM "user" WHERE COALESCE(btrim('+expr+"),'')<>'' ORDER BY 1")).rows;
    }catch(e){console.error("[expense voucher staff]",e);}
    const account_heads=await epvAccountHeads().catch(()=>[]);
    const expense_types=await epvTypes();
    return Response.json({expense_types,account_heads,pay_to_types:[{id:"dealer",name:"Dealer"},{id:"staff",name:"Staff / Salesman"},{id:"other",name:"Other"}],dealers,staff,mechanics,fabricators});
  }
  if(sub==="incentive-pending"){
    const did=idOf(q("dealer_id"));
    if(!did)return Response.json({rows:[],count:0});
    const per=Math.min(500,Math.max(1,num(q("per_page"))||100));
    const r=await pool.query(`SELECT v.id AS vehicle_id,ti.date,ti.chassis_no,ti.product_name AS model,ti.buyer_name AS customer,ti.bill_no
      FROM tax_invoice ti JOIN vehicle v ON lower(btrim(v.chassis_no))=lower(btrim(ti.chassis_no))
      WHERE ti.dealer_id=$1 AND COALESCE(ti.cancelled,false)=false
        AND NOT EXISTS (SELECT 1 FROM expense_payment_voucher e WHERE e.vehicle_id=v.id AND lower(COALESCE(e.expense_type,''))='incentive' AND lower(COALESCE(e.status,'')) NOT IN ('rejected','cancelled','canceled'))
        AND NOT EXISTS (SELECT 1 FROM expense_payment_voucher_line l JOIN expense_payment_voucher ev ON ev.id=l.voucher_id WHERE l.vehicle_id=v.id AND lower(COALESCE(ev.expense_type,''))='incentive' AND lower(COALESCE(ev.status,'')) NOT IN ('rejected','cancelled','canceled'))
      ORDER BY ti.date DESC,ti.id DESC LIMIT $2`,[did,per]);
    return Response.json({rows:r.rows,count:r.rowCount});
  }
  if(sub==="incentive-register"){
    // Rickshaw-wise running list (Paid / Unpaid). Rejected voucher ki rickshaw yahan se hat jaati hai (wo wapas pending list me aa jaati hai).
    const did=a?.scope==="dealer"?idOf(a.dealer_id):idOf(q("dealer_id")),st=q("status").toLowerCase();
    if(!did)return Response.json({rows:[],count:0});
    const r=await pool.query(`SELECT * FROM (
        SELECT l.id::text||'L' AS id,v.id AS voucher_id,v.voucher_no,v.date,l.chassis_no,v.pay_to_name,l.amount,v.status,v.payment_status,v.paid_at
          FROM expense_payment_voucher_line l JOIN expense_payment_voucher v ON v.id=l.voucher_id
         WHERE lower(COALESCE(v.expense_type,''))='incentive' AND v.dealer_id=$1
        UNION ALL
        SELECT v.id::text AS id,v.id AS voucher_id,v.voucher_no,v.date,v.chassis_no,v.pay_to_name,v.amount,v.status,v.payment_status,v.paid_at
          FROM expense_payment_voucher v
         WHERE lower(COALESCE(v.expense_type,''))='incentive' AND v.dealer_id=$1
           AND NOT EXISTS (SELECT 1 FROM expense_payment_voucher_line l WHERE l.voucher_id=v.id)
      ) x WHERE lower(COALESCE(x.status,'')) NOT IN ('rejected','cancelled','canceled') ORDER BY x.date DESC,x.voucher_id DESC,x.id`,[did]);
    let rows=r.rows.map((x:any)=>({...x,voucher_id:Number(x.voucher_id),date:ymd(x.date),amount:num(x.amount),status:String(x.status||"pending").toLowerCase(),paid_at:x.paid_at?ymd(x.paid_at):null}));
    if(st==="paid")rows=rows.filter((x:any)=>x.paid_at);
    else if(st==="unpaid")rows=rows.filter((x:any)=>!x.paid_at);
    return Response.json({rows,count:rows.length});
  }
  if(sub==="incentive-vouchers"){
    // Voucher-wise list: Voucher No, Dealer, Amount, Date + View me rickshaw list (vehicles).
    const did=a?.scope==="dealer"?idOf(a.dealer_id):idOf(q("dealer_id")),st=q("status").toLowerCase();
    const args:any[]=[];let where="lower(COALESCE(expense_type,''))='incentive'";
    if(did){args.push(did);where+=" AND dealer_id=$"+args.length;}
    const r=await pool.query("SELECT * FROM expense_payment_voucher WHERE "+where+" ORDER BY date DESC,id DESC LIMIT 1000",args);
    const lm=await epvLines(r.rows.map((x:any)=>Number(x.id)));
    let vouchers=r.rows.map((x:any)=>epvWithVehicles(epvOut(x),lm.get(Number(x.id))));
    if(st==="paid")vouchers=vouchers.filter((v:any)=>v.payment_status==="paid");
    else if(st==="unpaid")vouchers=vouchers.filter((v:any)=>v.payment_status!=="paid"&&v.status!=="rejected");
    return Response.json({vouchers,rows:vouchers,count:vouchers.length});
  }
  if(sub==="booking-pending"){
    const r=await pool.query(`SELECT v.id AS vehicle_id,ti.date,ti.bill_no,ti.buyer_name AS customer,COALESCE(to_jsonb(ti)->>'buyer_mobile',to_jsonb(ti)->>'customer_mobile','') AS mobile_no,ti.chassis_no
      FROM tax_invoice ti JOIN vehicle v ON lower(btrim(v.chassis_no))=lower(btrim(ti.chassis_no))
      WHERE COALESCE(ti.cancelled,false)=false
        AND NOT EXISTS (SELECT 1 FROM expense_payment_voucher e WHERE e.vehicle_id=v.id AND lower(COALESCE(e.expense_type,''))='commission' AND lower(COALESCE(e.status,'')) NOT IN ('rejected','cancelled','canceled'))
      ORDER BY ti.date DESC,ti.id DESC LIMIT 1000`);
    return Response.json({rows:r.rows,count:r.rowCount});
  }
  if(sub==="work-pending"){
    const rows=await epvVehicles(q("work_type").toLowerCase()||"assembly","");
    return Response.json({rickshaws:rows,rows,count:rows.length});
  }
  if(sub==="party-rickshaws"){
    const rows=await epvVehicles(q("expense_type").toLowerCase()||"insurance","");
    return Response.json({rickshaws:rows,rows,count:rows.length});
  }
  if(sub==="rickshaws"){
    let dealerName="";
    const did=idOf(q("dealer_id"));
    if(did)dealerName=String((await pool.query("SELECT name FROM dealer WHERE id=$1",[did])).rows[0]?.name||"");
    const rows=await epvVehicles("passing_exp",dealerName);
    return Response.json({rickshaws:rows,rows,count:rows.length});
  }
  return null;
}
export async function epvCreate(b:any,a:any):Promise<Response>{
  const bad=(m:string)=>Response.json({error:m},{status:400});
  const et=String(b.expense_type||"").trim();
  const _types=await epvTypes(true);
  const _t=_types.find((x:any)=>x.id===et);
  if(!_t)return bad("Expense type select karo.");
  if(_t.inactive)return bad("Ye Expense Type band hai.");
  const date=ymd(b.date)||todayDate();
  let payToType=String(b.pay_to_type||"other").trim()||"other",payTo=String(b.pay_to_name||"").trim();
  const dealerId=idOf(b.dealer_id);
  if(!payTo&&dealerId)payTo=String((await pool.query("SELECT name FROM dealer WHERE id=$1",[dealerId])).rows[0]?.name||"");
  let amountEach=num(b.amount),qty=1,rate=0,onAccount=false,perVehicle=false;
  const single=et==="incentive"; // incentive: sabhi selected rickshaw ka ek hi voucher
  const model=String(b.work_model_name||"").trim();
  const ids:number[]=(Array.isArray(b.vehicle_ids)?b.vehicle_ids:[]).map((x:any)=>idOf(x)).filter((x:any)=>x) as number[];
  if(et==="commission"||et==="incentive"){
    if(!ids.length)return bad(et==="commission"?"Kam se kam ek booking select karo.":"Kam se kam ek rickshaw select karo.");
    if(single)amountEach=num(b.per_vehicle_amount)||num(b.amount); // per rickshaw amount; total backend khud banata hai
    if(amountEach<=0)return bad("Amount 0 se zyada hona chahiye.");
    perVehicle=true;
  }else if(et==="assembly"){
    payTo=String(b.staff_name||payTo).trim();payToType="staff";
    if(!payTo)return bad("Assembler / Mechanic select karo.");
    if(!ids.length)return bad("Kam se kam ek rickshaw select karo.");
    rate=num(b.rate_per_unit);if(rate<=0)return bad("Rate per rickshaw daalo.");
    amountEach=rate;perVehicle=true;
  }else if(et==="fabrication"){
    payToType="other";qty=num(b.work_qty);rate=num(b.rate_per_unit);
    if(!payTo)return bad("Fabricator select karo.");
    if(qty<=0||rate<=0)return bad("Qty aur rate daalo.");
    amountEach=qty*rate;
  }else if(et==="insurance"||et==="rto_expense"){
    payToType="other";
    if(!payTo)return bad(et==="insurance"?"Insurance provider select karo.":"RTO passing person / provider select karo.");
    if(amountEach<=0)return bad("Amount 0 se zyada hona chahiye.");
    if(ids.length)perVehicle=true;else onAccount=true;
  }else{
    if(amountEach<=0)return bad("Amount 0 se zyada hona chahiye.");
    if(et==="passing_exp"){const vid=idOf(b.vehicle_id);if(!vid)return bad("Rickshaw select karo.");ids.push(vid);perVehicle=true;}
  }
  if(!payTo)return bad("Pay To select / enter karo.");
  // Account Head (Account Head Master, Direct / Indirect Expense) - Balance Sheet aur Profit & Loss isi se banta hai.
  const headIn=String(b.account_head||"").trim();
  let head:any=null;
  if(headIn||EPV_HEAD_REQUIRED.includes(et)){
    if(!headIn)return bad("Account Head select karo (Account Head Master se).");
    head=(await epvAccountHeads()).find((h:any)=>epvNorm(h.name)===epvNorm(headIn));
    if(!head)return bad("Account Head '"+headIn+"' Account Head Master me Direct / Indirect Expense ke saath nahi mila.");
    if(head.expense_type&&head.expense_type!==et)return bad("Account Head '"+headIn+"' is expense type ke under nahi hai.");
  }
  const vmap=new Map<number,any>();
  if(ids.length){
    const vr=await pool.query(`SELECT v.id,v.chassis_no,v.model_name,ti.buyer_name,ti.bill_no FROM vehicle v
      LEFT JOIN LATERAL (SELECT t.buyer_name,t.bill_no FROM tax_invoice t WHERE lower(btrim(t.chassis_no))=lower(btrim(v.chassis_no)) AND COALESCE(t.cancelled,false)=false ORDER BY t.id DESC LIMIT 1) ti ON true
      WHERE v.id=ANY($1::bigint[])`,[ids]);
    for(const r of vr.rows)vmap.set(Number(r.id),r);
    if(vmap.size!==new Set(ids).size)return bad("Selected rickshaw vehicle master me nahi mila.");
    if(single){
      const dl=await pool.query("SELECT l.chassis_no,v.voucher_no FROM expense_payment_voucher_line l JOIN expense_payment_voucher v ON v.id=l.voucher_id WHERE l.vehicle_id=ANY($1::bigint[]) AND lower(COALESCE(v.expense_type,''))='incentive' AND lower(COALESCE(v.status,'')) NOT IN ('rejected','cancelled','canceled') LIMIT 5",[ids]);
      if(dl.rowCount)return Response.json({error:"In rickshaw ka Incentive voucher pehle se bana hua hai: "+dl.rows.map((x:any)=>(x.chassis_no||"-")+" ("+(x.voucher_no||"-")+")").join(", ")},{status:409});
    }
    if(EPV_ONE_PER_VEHICLE.includes(et)){
      const dup=await pool.query("SELECT chassis_no,voucher_no FROM expense_payment_voucher WHERE vehicle_id=ANY($1::bigint[]) AND lower(COALESCE(expense_type,''))=$2 AND lower(COALESCE(status,'')) NOT IN ('rejected','cancelled','canceled') LIMIT 5",[ids,et]);
      if(dup.rowCount)return Response.json({error:"In rickshaw ka "+EPV_TYPE_NAME[et]+" voucher pehle se bana hua hai: "+dup.rows.map((x:any)=>(x.chassis_no||"-")+" ("+(x.voucher_no||"-")+")").join(", ")},{status:409});
    }
  }
  const cols=await columns("expense_payment_voucher");
  const jobs:any[]=perVehicle&&!single?ids.map(id=>({vid:id})):[{vid:null}];
  const stamp=date.replace(/-/g,"")+"-"+String(Date.now()).slice(-5);
  const mode=String(b.payment_mode||"cash").trim().toLowerCase()||"cash";
  const created:any[]=[];
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    for(let i=0;i<jobs.length;i++){
      const vh=jobs[i].vid?vmap.get(jobs[i].vid):null;
      const entry:any={voucher_no:"EPV-"+stamp+(jobs.length>1?"-"+(i+1):""),date,expense_type:et,expense_type_name:EPV_TYPE_NAME[et],pay_to_type:payToType,pay_to_name:payTo,
        dealer_id:payToType==="dealer"?dealerId:null,staff_name:payToType==="staff"?payTo:null,vehicle_id:vh?Number(vh.id):null,chassis_no:vh?.chassis_no||null,customer_name:vh?.buyer_name||null,
        bill_no:String(b.bill_no||"").trim()||vh?.bill_no||null,payment_mode:mode,amount:amountEach,remarks:String(b.remarks||"").trim()||null,attachment_url:String(b.attachment_url||"").trim()||null,
        work_model_name:et==="fabrication"?model||null:(vh?.model_name||null),work_qty:et==="fabrication"?qty:(perVehicle?1:null),rate_per_unit:(et==="fabrication"||et==="assembly")?rate:null,
        on_account:onAccount,account_head:head?.name||null,account_sub_category:head?.sub_category||EPV_TYPE_CAT[et]||null,status:"pending",payment_status:"unpaid",created_by:String(a?.username||a?.sub||"")};
      const uids=single?[...new Set(ids)]:[];
      if(single){const vl=uids.map(id=>vmap.get(id));entry.amount=amountEach*uids.length;entry.chassis_no=vl.map((x:any)=>x?.chassis_no).filter(Boolean).join(", ")||null;entry.work_qty=uids.length;entry.rate_per_unit=amountEach;}
      const keys=Object.keys(entry).filter(k=>cols.has(k));
      const r=await client.query('INSERT INTO expense_payment_voucher ('+keys.map(k=>'"'+k+'"').join(",")+') VALUES ('+keys.map((_,k)=>"$"+(k+1)).join(",")+') RETURNING *',keys.map(k=>entry[k]));
      if(single){for(const id of uids){const x=vmap.get(id);await client.query("INSERT INTO expense_payment_voucher_line (voucher_id,vehicle_id,chassis_no,customer_name,bill_no,model_name,amount) VALUES ($1,$2,$3,$4,$5,$6,$7)",[r.rows[0].id,id,x?.chassis_no||null,x?.buyer_name||null,x?.bill_no||null,x?.model_name||null,amountEach]);}}
      created.push(epvOut(r.rows[0]));
    }
    await client.query("COMMIT");
  }catch(e){await client.query("ROLLBACK").catch(()=>{});throw e;}finally{client.release();}
  await audit(a,"expense-payment-voucher","create",created[0]?.id,null,{count:created.length,expense_type:et,pay_to_name:payTo},null,created[0]?.voucher_no);
  const lmc=await epvLines(created.map((c:any)=>c.id));
  const canAp0=await epvCanApprove(a);
  const out=created.map((c:any)=>epvWithFlags(epvWithVehicles(c,lmc.get(c.id)),a,canAp0));
  return Response.json({success:true,vouchers:out,voucher:out[0]},{status:201});
}
export async function epvApproval(id:number,b:any,a:any):Promise<Response>{
  if(!(await epvCanApprove(a)))return Response.json({error:"Sirf Head Office / approval right wale user voucher approve ya reject kar sakte hain."},{status:403});
  const action=String(b.action||"").toLowerCase();
  if(action!=="approve"&&action!=="reject")return Response.json({error:"Action approve ya reject hona chahiye."},{status:400});
  const reason=String(b.reason||"").trim();
  if(action==="reject"&&!reason)return Response.json({error:"Rejection reason required."},{status:400});
  const who=String(a?.full_name||a?.username||a?.name||a?.sub||"admin");
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const cur=await client.query("SELECT * FROM expense_payment_voucher WHERE id=$1 FOR UPDATE",[id]);
    if(!cur.rowCount)throw epvFail("Voucher nahi mila.",404);
    const old=epvOut(cur.rows[0]);
    if(old.status!=="pending")throw epvFail("Ye voucher pehle hi "+old.status+" ho chuka hai.",409);
    if(action==="approve"&&!isAdmin(a)&&epvIsOwn(old,a))throw epvFail("Apna banaya hua voucher aap khud approve nahi kar sakte. Doosra approver ya Admin approve karega.",403);
    let upd:any;
    if(action==="reject"){
      upd=await client.query("UPDATE expense_payment_voucher SET status='rejected',reject_reason=$1,approved_by=$2,approved_at=NOW() WHERE id=$3 RETURNING *",[reason,who,id]);
    }else{
      // Approve par sirf status badalta hai. Cash Book (day_book) entry Cashier ke "Mark Paid" par banti hai.
      upd=await client.query("UPDATE expense_payment_voucher SET status='approved',approved_by=$1,approved_at=NOW() WHERE id=$2 RETURNING *",[who,id]);
    }
    await client.query("COMMIT");
    const voucher=epvWithFlags(epvOut(upd.rows[0]),a,true);
    await audit(a,"expense-payment-voucher",action,id,old,voucher,null,voucher.voucher_no);
    return Response.json({success:true,voucher,day_book_id:voucher.day_book_id||null});
  }catch(e:any){
    await client.query("ROLLBACK").catch(()=>{});
    if(e?.status)return Response.json({error:e.message},{status:e.status});
    throw e;
  }finally{client.release();}
}
export async function epvMarkPaid(id:number,a:any):Promise<Response>{
  if(!epvIsCashier(a))return Response.json({error:"Paid mark sirf Cashier kar sakta hai (aur Cash Book entry bhi wahi banata hai)."},{status:403});
  const who=epvWho(a);
  // Cash Book me "kisne entry banayi" ka column: transaction se PEHLE banao (transaction ke andar banega to columns() use dekh nahi paata).
  await pool.query("ALTER TABLE day_book ADD COLUMN IF NOT EXISTS created_by text").catch((e:any)=>console.error("[epv day_book.created_by]",e?.message));
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const cur=await client.query("SELECT * FROM expense_payment_voucher WHERE id=$1 FOR UPDATE",[id]);
    if(!cur.rowCount)throw epvFail("Voucher nahi mila.",404);
    const old=epvOut(cur.rows[0]);
    if(old.status!=="approved"||old.payment_status==="paid")throw epvFail("Sirf approved aur unpaid voucher Paid mark ho sakta hai.",409);
    // Purane approved vouchers (jinki entry approve par pehle hi ban chuki hai) ki dobara entry nahi banegi.
    const dayBookId=old.day_book_id||await epvPostDayBook(client,old,who);
    const upd=await client.query("UPDATE expense_payment_voucher SET payment_status='paid',paid_at=NOW(),paid_by=$1,day_book_id=$2 WHERE id=$3 RETURNING *",[who,dayBookId,id]);
    await client.query("COMMIT");
    const voucher=epvWithFlags(epvOut(upd.rows[0]),a,false);
    await audit(a,"expense-payment-voucher","mark-paid",id,old,voucher,null,voucher.voucher_no);
    return Response.json({success:true,voucher,day_book_id:dayBookId});
  }catch(e:any){
    await client.query("ROLLBACK").catch(()=>{});
    if(e?.status)return Response.json({error:e.message},{status:e.status});
    throw e;
  }finally{client.release();}
}
export async function expenseVoucherPost(path:string[],b:any,a:any):Promise<Response|null>{
  await ensureEpvSchema();
  const sub=path.slice(1);
  if(!sub.length)return epvCreate(b,a);
  const id=idOf(sub[0]);
  if(id&&sub.length===2&&sub[1]==="approval")return epvApproval(id,b,a);
  if(id&&sub.length===2&&sub[1]==="mark-paid")return epvMarkPaid(id,a);
  return null;
}
export async function expenseVoucherDelete(path:string[],a:any):Promise<Response>{
  await ensureEpvSchema();
  const id=idOf(path[1]);
  if(!id)return Response.json({error:"Voucher id required."},{status:400});
  const old=(await pool.query("SELECT * FROM expense_payment_voucher WHERE id=$1",[id])).rows[0];
  if(!old)return Response.json({error:"Voucher not found."},{status:404});
  if(String(old.status||"").toLowerCase()==="approved"&&!isAdmin(a))return Response.json({error:"Approved voucher sirf admin delete kar sakta hai."},{status:403});
  const dc=await pool.connect();
  try{
    await dc.query("BEGIN");
    if(old.day_book_id)await dc.query("DELETE FROM day_book WHERE id=$1",[old.day_book_id]);
    await dc.query("DELETE FROM expense_payment_voucher_line WHERE voucher_id=$1",[id]);
    await dc.query("DELETE FROM expense_payment_voucher WHERE id=$1",[id]);
    await dc.query("COMMIT");
  }catch(e){await dc.query("ROLLBACK").catch(()=>{});throw e;}finally{dc.release();}
  await audit(a,"expense-payment-voucher","delete",id,old,null,null,old.voucher_no);
  return Response.json({success:true});
}
// =================== end Expense Payment Voucher ===================
