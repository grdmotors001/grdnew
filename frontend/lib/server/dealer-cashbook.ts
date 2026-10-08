// Dealer Cash Book + Dealer Ledger (bade route file se nikala gaya, logic/queries same hain).
// Dealer-portal endpoints: dealer/ledger*, dealer/cash-book*, dealer/cash-position.
// Helpers (ensureDealerCashSchema, dealerDayBook, enrichCashCustomers...) admin reports me bhi use hote hain, isliye export hain.
import { pool, num, idOf, ymd, todayDate, columns } from "./common";
import { audit, isAdmin } from "./permissions";

// Bade route file ka function jo yahan se seedhe import nahi ho sakta (route.ts se non-handler export allowed nahi).
export type CashbookDeps = { ensureBillingSalesSchema: () => Promise<void> };

// Dealer customer register helpers.
// - name: old imports keep it in full_name; new receipt bookings may only have it on the receipt.
// - status: nothing ever wrote BILLED on dealer_cash_customer, so it is derived from Tax Invoices
//   (old desktop-app bills) and from grd_billing_sale rows that reached BILLED (new flow).
const normReg=(v:any)=>String(v??"").toUpperCase().replace(/[^A-Z0-9]/g,"");
const normPhone=(v:any)=>String(v??"").replace(/\D/g,"").slice(-10);
export async function enrichCashCustomers(rows:any[]):Promise<any[]>{
  if(!rows.length)return rows;
  const ids=rows.map((r:any)=>num(r.id)).filter(Boolean);
  const dealerIds=[...new Set(rows.map((r:any)=>num(r.dealer_id)).filter(Boolean))];
  const dn=await pool.query("SELECT id,lower(btrim(name)) AS n FROM dealer WHERE id = ANY($1::int[])",[dealerIds]);
  const dealerName=new Map<number,string>(dn.rows.map((x:any)=>[Number(x.id),String(x.n||"")]));
  const nameToId=new Map<string,number>(dn.rows.map((x:any)=>[String(x.n||""),Number(x.id)]));
  const [rc,inv,sale]=await Promise.all([
    pool.query("SELECT DISTINCT ON (customer_id) customer_id,customer_name,customer_phone FROM dealer_cash_receipt WHERE customer_id = ANY($1::bigint[]) AND COALESCE(btrim(customer_name),'')<>'' ORDER BY customer_id,id",[ids]),
    pool.query("SELECT ti.dealer_id,lower(btrim(ti.dealer_name)) AS dname,ti.buyer_name,to_jsonb(ti)->>'vehicle_reg_no' AS reg,to_jsonb(ti)->>'dealer_page_no' AS pg,to_jsonb(ti)->>'buyer_mobile' AS mobile FROM tax_invoice ti WHERE COALESCE(ti.cancelled,false)=false AND (ti.dealer_id = ANY($1::int[]) OR lower(btrim(ti.dealer_name)) = ANY($2::text[]))",[dealerIds,[...nameToId.keys()]]),
    pool.query("SELECT DISTINCT dealer_cash_customer_id AS id FROM grd_billing_sale WHERE status='BILLED' AND dealer_cash_customer_id = ANY($1::bigint[])",[ids])
  ]);
  const rcMap=new Map<number,any>(rc.rows.map((x:any)=>[Number(x.customer_id),x]));
  const saleSet=new Set<number>(sale.rows.map((x:any)=>Number(x.id)));
  const regs=new Map<number,Set<string>>(),pgs=new Map<number,Set<string>>(),blankByMobile=new Map<string,number>(),blankByName=new Map<string,number>();
  const normName=(v:any)=>String(v??"").toUpperCase().replace(/[^A-Z0-9 ]/g," ").replace(/\s+/g," ").trim();
  for(const x of inv.rows){
    const d=Number(x.dealer_id)||nameToId.get(String(x.dname||""))||0;
    // Bill made to the dealer itself (registered / out-of-Delhi dealers): not a customer sale, never matched.
    if(normName(x.buyer_name)&&normName(x.buyer_name)===normName(dealerName.get(d)))continue;
    const reg=normReg(x.reg),pg=String(x.pg||"").trim(),mb=normPhone(x.mobile),nm=normName(x.buyer_name);
    if(reg.length>=5){if(!regs.has(d))regs.set(d,new Set());regs.get(d)!.add(reg)}
    else if(mb.length===10){const k=d+"|"+mb;blankByMobile.set(k,(blankByMobile.get(k)||0)+1)} // bill without Vehicle No.
    else if(nm){const k=d+"|"+nm;blankByName.set(k,(blankByName.get(k)||0)+1)} // bill without Vehicle No. and mobile
    if(pg&&mb){if(!pgs.has(d))pgs.set(d,new Set());pgs.get(d)!.add(pg+"|"+mb)}
  }
  // Fallback for old bills that have no Vehicle No.: one such bill marks one (oldest) imported customer
  // of that dealer+mobile as billed. Fresh bookings (vehicle_no 'new'/'old') are never matched this way.
  const fallbackBilled=new Set<number>();
  for(const r of [...rows].sort((x:any,y:any)=>Number(x.id)-Number(y.id))){
    const d=Number(r.dealer_id),reg=normReg(r.vehicle_no),cur=String(r.status||"").toUpperCase();
    if(cur==="DEALER_CANCEL"||saleSet.has(Number(r.id))||reg==="NEW"||reg==="OLD")continue;
    if(reg.length>=5&&regs.get(d)?.has(reg))continue;
    const rr=rcMap.get(Number(r.id));
    const k=d+"|"+normPhone(String(r.phone||r.customer_phone||rr?.customer_phone||""));
    const left=blankByMobile.get(k)||0;
    if(left>0){blankByMobile.set(k,left-1);fallbackBilled.add(Number(r.id));continue}
    // Old sales with neither Vehicle No. nor mobile: register name is 'NAME 1103' (name + serial), the bill has just 'NAME'.
    const full=normName(r.name||r.full_name||rr?.customer_name),stripped=full.replace(/\s+\d+$/,"").trim();
    for(const cand of [full,stripped]){
      const nk=d+"|"+cand,nl=cand?blankByName.get(nk)||0:0;
      if(nl>0){blankByName.set(nk,nl-1);fallbackBilled.add(Number(r.id));break}
    }
  }
  return rows.map((r:any)=>{
    const rr=rcMap.get(Number(r.id));
    const name=String(r.name||"").trim()||String(r.full_name||"").trim()||String(rr?.customer_name||"").trim();
    const phone=String(r.phone||"").trim()||String(r.customer_phone||"").trim()||String(rr?.customer_phone||"").trim();
    const d=Number(r.dealer_id),reg=normReg(r.vehicle_no),pg=String(r.page_no||"").trim();
    const billed=saleSet.has(Number(r.id))||fallbackBilled.has(Number(r.id))||(reg.length>=5&&regs.get(d)?.has(reg))||(pg&&pgs.get(d)?.has(pg+"|"+normPhone(phone)));
    const cur=String(r.status||"").trim().toUpperCase();
    const status=cur==="DEALER_CANCEL"?cur:(billed?"BILLED":(cur||"VEHICLE_PENDING"));
    return {...r,name,phone,status,balance:Math.max(0,Number(r.sale_amount||0)-Number(r.loan_amount||0)-Number(r.paid_amount||0))};
  });
}
let dealerCashSchemaReady:Promise<void>|null=null;
export function ensureDealerCashSchema():Promise<void>{
  if(!dealerCashSchemaReady){
    dealerCashSchemaReady=ensureDealerCashSchemaOnce().catch((e:any)=>{dealerCashSchemaReady=null;throw e});
  }
  return dealerCashSchemaReady;
}
// Dealer ke haath me cash = cash receipts - expenses - ACCEPTED handovers. Pending handover abhi dealer ke paas hi maana jata hai.
export async function dealerCashPosition(did:number,client:any=pool){
  const r=await client.query("SELECT (SELECT COALESCE(SUM(amount),0) FROM dealer_cash_receipt WHERE dealer_id=$1 AND lower(COALESCE(payment_mode,'cash'))='cash') AS rc,(SELECT COALESCE(SUM(amount),0) FROM dealer_cash_expense WHERE dealer_id=$1) AS ex,(SELECT COALESCE(SUM(amount),0) FROM dealer_cash_handover WHERE dealer_id=$1 AND lower(COALESCE(status,'pending'))='accepted') AS acc,(SELECT COALESCE(SUM(amount),0) FROM dealer_cash_handover WHERE dealer_id=$1 AND lower(COALESCE(status,'pending'))='pending') AS pend",[did]);
  const x=r.rows[0]||{},cash=num(x.rc)-num(x.ex)-num(x.acc),pending=num(x.pend);
  return {cash_received:num(x.rc),expenses:num(x.ex),ho_handover:num(x.acc),pending_handover:pending,cash_at_dealer:cash,available_for_handover:cash-pending};
}
// Showroom / branch ke shop expense dealer ledger me CREDIT ban ke aate hain: dealer ne HO ke hisaab ka cash kharch kiya,
// isliye HO ko dena wala balance utna kam hota hai. Ye sirf ledger view hai - admin Day Book / cash me koi entry nahi banti.
export function shopExpenseLedgerEvents(rows:any[]){
  return rows.filter((x:any)=>String(x.status||"ACTIVE").toUpperCase()==="ACTIVE"&&num(x.amount)>0).map((x:any)=>{
    const label=String(x.category_label||x.category||"Shop Expense").trim();
    const narration="Shop Expense - "+label+(x.paid_to?" - "+x.paid_to:"")+(x.remarks?" ("+x.remarks+")":"");
    return {record_type:"shop_expense",record_id:x.id,date:x.date,doc_no:x.expense_no||"",account:"Shop Expense",narration,lines:[narration],debit:0,credit:num(x.amount),vr_type:"E"};
  });
}
async function ensureDealerCashSchemaOnce(){
  await pool.query("CREATE TABLE IF NOT EXISTS dealer_cash_customer (id bigserial PRIMARY KEY,dealer_id integer NOT NULL,name text NOT NULL,phone text,customer_phone text,page_no text,vehicle_no text,sale_amount numeric NOT NULL DEFAULT 0,loan_amount numeric NOT NULL DEFAULT 0,paid_amount numeric NOT NULL DEFAULT 0,status text NOT NULL DEFAULT 'VEHICLE_PENDING',date date NOT NULL DEFAULT CURRENT_DATE,created_at timestamptz NOT NULL DEFAULT now())");
  await pool.query("CREATE TABLE IF NOT EXISTS dealer_cash_receipt (id bigserial PRIMARY KEY,dealer_id integer NOT NULL,customer_id bigint,date date NOT NULL DEFAULT CURRENT_DATE,receipt_type text,payment_mode text NOT NULL DEFAULT 'cash',receipt_no text,customer_name text,customer_phone text,dealer_register_page_no text,sale_amount numeric NOT NULL DEFAULT 0,loan_amount numeric NOT NULL DEFAULT 0,amount numeric NOT NULL DEFAULT 0,reference_no text,remarks text,request_id text,created_at timestamptz NOT NULL DEFAULT now())");
  await pool.query("CREATE TABLE IF NOT EXISTS dealer_cash_expense (id bigserial PRIMARY KEY,dealer_id integer NOT NULL,date date NOT NULL DEFAULT CURRENT_DATE,expense_no text,category text,category_label text,amount numeric NOT NULL DEFAULT 0,paid_to text,remarks text,folio text,status text NOT NULL DEFAULT 'ACTIVE',created_at timestamptz NOT NULL DEFAULT now())");
  await pool.query("CREATE TABLE IF NOT EXISTS dealer_cash_handover (id bigserial PRIMARY KEY,dealer_id integer NOT NULL,date date NOT NULL DEFAULT CURRENT_DATE,handover_no text,amount numeric NOT NULL DEFAULT 0,sent_to text,remarks text,folio text,status text NOT NULL DEFAULT 'pending',created_at timestamptz NOT NULL DEFAULT now())");
  const defs:any={
    // Older DBs already have dealer_cash_customer without these columns (CREATE TABLE IF NOT EXISTS skips them).
    dealer_cash_customer:{dealer_id:"integer",name:"text",full_name:"text",phone:"text",customer_phone:"text",page_no:"text",vehicle_no:"text",sale_amount:"numeric NOT NULL DEFAULT 0",loan_amount:"numeric NOT NULL DEFAULT 0",paid_amount:"numeric NOT NULL DEFAULT 0",status:"text NOT NULL DEFAULT 'VEHICLE_PENDING'",date:"date",created_at:"timestamptz NOT NULL DEFAULT now()"},
    dealer_cash_receipt:{dealer_id:"integer",customer_id:"bigint",date:"date NOT NULL DEFAULT CURRENT_DATE",receipt_date:"date",receipt_type:"text",payment_mode:"text NOT NULL DEFAULT 'cash'",receipt_no:"text",customer_name:"text",customer_phone:"text",dealer_register_page_no:"text",sale_amount:"numeric NOT NULL DEFAULT 0",loan_amount:"numeric NOT NULL DEFAULT 0",amount:"numeric NOT NULL DEFAULT 0",reference_no:"text",remarks:"text",request_id:"text"},
    dealer_cash_expense:{dealer_id:"integer",date:"date",expense_date:"date",expense_no:"text",category:"text",category_label:"text",amount:"numeric NOT NULL DEFAULT 0",paid_to:"text",remarks:"text",folio:"text",status:"text NOT NULL DEFAULT 'ACTIVE'",customer_id:"bigint",customer_name:"text",customer_page_no:"text"},
    dealer_cash_handover:{dealer_id:"integer",date:"date",handover_date:"date",handover_no:"text",amount:"numeric NOT NULL DEFAULT 0",sent_to:"text",remarks:"text",folio:"text",status:"text NOT NULL DEFAULT 'pending'",accepted_at:"timestamptz",accepted_by:"text",reject_reason:"text",day_book_id:"bigint"}
  };
  for(const table of Object.keys(defs)) for(const [col,type] of Object.entries(defs[table]))
    await pool.query('ALTER TABLE "'+table+'" ADD COLUMN IF NOT EXISTS "'+col+'" '+type);
  // Backfill once: old imports store the name in full_name; receipt bookings may only have it on the receipt.
  await pool.query("UPDATE dealer_cash_customer SET name=btrim(full_name) WHERE COALESCE(btrim(name),'')='' AND COALESCE(btrim(full_name),'')<>''");
  await pool.query("UPDATE dealer_cash_customer SET phone=btrim(customer_phone) WHERE COALESCE(btrim(phone),'')='' AND COALESCE(btrim(customer_phone),'')<>''");
  await pool.query("UPDATE dealer_cash_customer c SET name=r.customer_name FROM (SELECT DISTINCT ON (customer_id) customer_id,btrim(customer_name) AS customer_name FROM dealer_cash_receipt WHERE customer_id IS NOT NULL AND COALESCE(btrim(customer_name),'')<>'' ORDER BY customer_id,id) r WHERE r.customer_id=c.id AND COALESCE(btrim(c.name),'')=''");
  await pool.query("UPDATE dealer_cash_receipt SET date=COALESCE(receipt_date,date,CURRENT_DATE)");
  await pool.query("UPDATE dealer_cash_receipt SET receipt_date=COALESCE(receipt_date,date,CURRENT_DATE)");
  await pool.query("UPDATE dealer_cash_expense SET date=COALESCE(date,expense_date,CURRENT_DATE) WHERE date IS NULL");
  await pool.query("UPDATE dealer_cash_expense SET expense_date=COALESCE(expense_date,date,CURRENT_DATE) WHERE expense_date IS NULL");
  // Purani DB me handover_date NOT NULL hoti hai; date aur handover_date dono ko sync rakho.
  await pool.query("UPDATE dealer_cash_handover SET date=COALESCE(date,handover_date,CURRENT_DATE) WHERE date IS NULL");
  await pool.query("UPDATE dealer_cash_handover SET handover_date=COALESCE(handover_date,date,CURRENT_DATE) WHERE handover_date IS NULL");
}

// ---- Dealer (showroom/branch) Day Book + daily verification (admin/accounts) ----
let dayVerifyReady:Promise<void>|null=null;
export function ensureDayVerifySchema():Promise<void>{
  if(!dayVerifyReady){
    dayVerifyReady=(async()=>{
      await pool.query("CREATE TABLE IF NOT EXISTS dealer_cash_day_verify (id bigserial PRIMARY KEY,dealer_id integer NOT NULL,date date NOT NULL,verified_by text,verified_at timestamptz NOT NULL DEFAULT now(),remarks text,snap_receipts numeric NOT NULL DEFAULT 0,snap_expenses numeric NOT NULL DEFAULT 0,snap_handover numeric NOT NULL DEFAULT 0,snap_count integer NOT NULL DEFAULT 0,UNIQUE(dealer_id,date))");
    })().catch((e:any)=>{dayVerifyReady=null;throw e});
  }
  return dayVerifyReady;
}
// Ek dealer ka din-wise cash book: entries + opening/closing + verify status. Dono (GET report aur verify POST) yahi use karte hain.
export async function dealerDayBook(did:number,from:string,to:string){
  await ensureDealerCashSchema();await ensureDayVerifySchema();
  const rq=(t:string,dc:string,where:string)=>pool.query("SELECT *,"+dc+"::date AS d FROM "+t+" WHERE dealer_id=$1"+(where?" AND "+where:"")+" AND "+dc+">=$2::date AND "+dc+"<=$3::date ORDER BY "+dc+",id",[did,from,to]);
  const [rc,ex,ho,pr]=await Promise.all([
    rq("dealer_cash_receipt","COALESCE(date,receipt_date)",""),
    rq("dealer_cash_expense","COALESCE(date,expense_date)",""),
    rq("dealer_cash_handover","COALESCE(date,handover_date)",""),
    pool.query("SELECT (SELECT COALESCE(SUM(amount),0) FROM dealer_cash_receipt WHERE dealer_id=$1 AND lower(COALESCE(payment_mode,'cash'))='cash' AND COALESCE(date,receipt_date)<$2::date) AS rc,(SELECT COALESCE(SUM(amount),0) FROM dealer_cash_expense WHERE dealer_id=$1 AND COALESCE(date,expense_date)<$2::date) AS ex,(SELECT COALESCE(SUM(amount),0) FROM dealer_cash_handover WHERE dealer_id=$1 AND lower(COALESCE(status,'pending'))='accepted' AND COALESCE(date,handover_date)<$2::date) AS ho",[did,from]),
  ]);
  const ver=await pool.query("SELECT * FROM dealer_cash_day_verify WHERE dealer_id=$1 AND date>=$2::date AND date<=$3::date",[did,from,to]);
  const vmap=new Map<string,any>(ver.rows.map((v:any)=>[ymd(v.date),v]));
  const days=new Map<string,any>();
  const day=(d:any)=>{const k=ymd(d);if(!days.has(k))days.set(k,{date:k,entries:[],cash_in:0,expenses:0,ho_out:0});return days.get(k)};
  for(const x of rc.rows){
    const cash=String(x.payment_mode||"cash").toLowerCase()==="cash",dd=day(x.d);
    dd.entries.push({kind:"receipt",id:x.id,no:x.receipt_no||"",party:x.customer_name||"",detail:[x.receipt_type,x.remarks,x.dealer_register_page_no?("Pg "+x.dealer_register_page_no):""].filter(Boolean).join(" · "),mode:String(x.payment_mode||"cash"),status:"",amount:num(x.amount),in_cash:cash});
    if(cash)dd.cash_in+=num(x.amount);
  }
  for(const x of ex.rows){
    const dd=day(x.d);
    dd.entries.push({kind:"expense",id:x.id,no:x.expense_no||"",party:x.paid_to||"",detail:[x.category_label||x.category,x.remarks,x.folio?("Folio "+x.folio):""].filter(Boolean).join(" · "),mode:"cash",status:String(x.status||""),amount:num(x.amount),in_cash:true});
    dd.expenses+=num(x.amount);
  }
  for(const x of ho.rows){
    const st=String(x.status||"pending").toLowerCase(),dd=day(x.d);
    dd.entries.push({kind:"handover",id:x.id,no:x.handover_no||"",party:x.sent_to||"Head Office",detail:x.remarks||"",mode:"cash",status:st,amount:num(x.amount),in_cash:st==="accepted"});
    if(st==="accepted")dd.ho_out+=num(x.amount);
  }
  const order=[...days.keys()].sort();
  let bal=num(pr.rows[0]?.rc)-num(pr.rows[0]?.ex)-num(pr.rows[0]?.ho);
  const out:any[]=[];
  for(const k of order){
    const dd=days.get(k);dd.opening=bal;bal=bal+dd.cash_in-dd.expenses-dd.ho_out;dd.closing=bal;dd.count=dd.entries.length;
    const v=vmap.get(k);
    if(v){
      const changed=Math.abs(num(v.snap_receipts)-dd.cash_in)>0.004||Math.abs(num(v.snap_expenses)-dd.expenses)>0.004||Math.abs(num(v.snap_handover)-dd.ho_out)>0.004||Number(v.snap_count)!==dd.count;
      dd.verified={by:v.verified_by||"",at:v.verified_at,remarks:v.remarks||"",changed};
    }else dd.verified=null;
    out.push(dd);
  }
  return out.reverse();
}

// ---------------- GET (dealer portal) ----------------
// Match na ho to null -> bada route file aage chalta hai.
export async function dealerCashbookGet(req:Request,path:string[],a:any,deps:CashbookDeps):Promise<Response|null>{
  const p=path.join("/");
  if(a?.scope!=="dealer")return null;
    if(p==="dealer/ledger"&&a.scope==="dealer"){
      const did=num(a.dealer_id),u=new URL(req.url),from=String(u.searchParams.get("from")||"").trim(),to=String(u.searchParams.get("to")||"").trim(),search=String(u.searchParams.get("search")||"").trim().toLowerCase();
      {const catRow=await pool.query("SELECT LOWER(COALESCE(dealer_category,'dealer')) AS c FROM dealer WHERE id=$1",[did]);if(["showroom","branch"].includes(String(catRow.rows[0]?.c||"")))return Response.json({error:"Ledger sirf Dealer ke liye hai."},{status:403});}
      const cols=await columns("day_book");
      if(!cols.size)return Response.json({events:[],rows:[],count:0});
      const dealerRow=await pool.query("SELECT name FROM dealer WHERE id=$1 LIMIT 1",[did]);
      const dealerName=String(dealerRow.rows[0]?.name||"").trim().toLowerCase();
      const raw=(await pool.query("SELECT * FROM day_book ORDER BY id ASC LIMIT 5000")).rows;
      const events=raw.filter((x:any)=>{
        const rowDealer=String(x.dealer_id||"").trim();
        const party=String(x.party_name||x.account_name||x.account||"");
        const doc=String(x.doc_no||x.voucher_no||x.reference_no||x.bill_no||"");
        const text=[party,doc,String(x.narration||""),String(x.particulars||""),String(x.chassis_no||"")].join(" ").toLowerCase();
        const d=ymd(x.date);
        const dealerMatch=rowDealer ? Number(rowDealer)===did : (party.trim().toLowerCase()===dealerName || String(x.dealer_name||"").trim().toLowerCase()===dealerName);
        return dealerMatch&&(!from||d>=from)&&(!to||d<=to)&&(!search||text.includes(search));
      });
      let running=0;
      const eventsOut=events.map((x:any)=>{
        const debit=num(x.debit||x.dr_amount||x.debit_amount||x.debit_paid),credit=num(x.credit||x.cr_amount||x.credit_amount||x.credit_received);
        return {record_type:"day_book",record_id:x.id,date:x.date,doc_no:x.doc_no||x.voucher_no||x.vr_no||x.bill_no||"",account:x.party_name||x.account_name||x.account||"",lines:[x.narration||x.particulars||x.description||""].filter(Boolean),debit,credit,vr_type:debit?"S":"R"};
      });
      // Shop expenses (dealer ne HO ke cash se kharch kiye) bhi credit ke roop me dikhte hain.
      await ensureDealerCashSchema();
      const exRows=(await pool.query("SELECT * FROM dealer_cash_expense WHERE dealer_id=$1 ORDER BY date ASC,id ASC LIMIT 5000",[did])).rows;
      const exEvents=shopExpenseLedgerEvents(exRows).filter((x:any)=>{const d=ymd(x.date);return (!from||d>=from)&&(!to||d<=to)&&(!search||[x.doc_no,x.narration].join(" ").toLowerCase().includes(search));});
      const merged=[...eventsOut,...exEvents].sort((x:any,y:any)=>String(x.date||"").slice(0,10).localeCompare(String(y.date||"").slice(0,10))||(x.record_type===y.record_type?Number(x.record_id||0)-Number(y.record_id||0):(x.record_type==="day_book"?-1:1)));
      let bal=0;
      const finalRows=merged.map((x:any)=>{bal+=num(x.debit)-num(x.credit);return {...x,balance:bal,dc:bal>=0?"Dr":"Cr"};});
      return Response.json({events:finalRows,rows:finalRows,count:finalRows.length});
    }
    if(p==="dealer/ledger-masters"&&a.scope==="dealer"){
      const dealers=await pool.query("SELECT id,code,name,mobile,address,account_no,ifsc FROM dealer WHERE COALESCE(blocked,false)=false AND id=$1 ORDER BY name,id",[num(a.dealer_id)]);
      const types=[
        {id:"dealer",name:"Dealer"},{id:"salesman",name:"Salesman"},{id:"financer",name:"Financer"},
        {id:"rto_expense",name:"RTO Expense"},{id:"insurance_expense",name:"Insurance"},
        {id:"mechanic",name:"Mechanic"},{id:"fabricator",name:"Fabricator"},{id:"expense_head",name:"Expense Head"},{id:"other",name:"Other"}
      ];
      return Response.json({types,dealers:dealers.rows,salesmen:[],financers:[],rtos:[],parties:[],mechanics:[],fabricators:[],expense_heads:[]});
    }
    if(p==="dealer/ledger-accounts"&&a.scope==="dealer"){
      await pool.query(`CREATE TABLE IF NOT EXISTS dealer_ledger_account (
        id bigserial PRIMARY KEY,dealer_id integer NOT NULL,account_type text NOT NULL,name text NOT NULL,code text,
        mobile text,address text,account_no text,ifsc text,opening_balance numeric NOT NULL DEFAULT 0,
        opening_type text NOT NULL DEFAULT 'dr',notes text,created_at timestamptz NOT NULL DEFAULT now()
      )`);
      const r=await pool.query("SELECT * FROM dealer_ledger_account WHERE dealer_id=$1 ORDER BY id DESC LIMIT 500",[num(a.dealer_id)]);
      return Response.json({accounts:r.rows,rows:r.rows,count:r.rowCount});
    }
    if(p==="dealer/cash-book"&&a.scope==="dealer"){
      await ensureDealerCashSchema();
      const did=num(a.dealer_id),u=new URL(req.url);
      const from=String(u.searchParams.get("from")||"").trim(),to=String(u.searchParams.get("to")||"").trim();
      const runRange=async(table:string,extra:string)=>{const args:any[]=[did],q:string[]=[];if(from){args.push(from);q.push(table+".date >= $"+args.length+"::date");}if(to){args.push(to);q.push(table+".date <= $"+args.length+"::date");}const sql="SELECT * FROM "+table+" WHERE dealer_id=$1"+(extra?" AND "+extra:"")+(q.length?" AND "+q.join(" AND "):"")+" ORDER BY date,id";return pool.query(sql,args);};
      const receipts=await runRange("dealer_cash_receipt","lower(COALESCE(payment_mode,'cash'))='cash'");
      const expenses=await runRange("dealer_cash_expense","");
      const handovers=await runRange("dealer_cash_handover","lower(COALESCE(status,'pending'))='accepted'");
      const pendingHandovers=await runRange("dealer_cash_handover","lower(COALESCE(status,'pending'))='pending'");
      const rejectedHandovers=await runRange("dealer_cash_handover","lower(COALESCE(status,'pending'))='rejected'");
      const priorDate=from||"9999-12-31";
      const priorReceipts=await pool.query("SELECT COALESCE(SUM(amount),0) AS n FROM dealer_cash_receipt WHERE dealer_id=$1 AND lower(COALESCE(payment_mode,'cash'))='cash' AND date < $2::date",[did,priorDate]);
      const priorExpenses=await pool.query("SELECT COALESCE(SUM(amount),0) AS n FROM dealer_cash_expense WHERE dealer_id=$1 AND date < $2::date",[did,priorDate]);
      const priorHandovers=await pool.query("SELECT COALESCE(SUM(amount),0) AS n FROM dealer_cash_handover WHERE dealer_id=$1 AND lower(COALESCE(status,'pending'))='accepted' AND date < $2::date",[did,priorDate]);
      const opening=num(priorReceipts.rows[0]?.n)-num(priorExpenses.rows[0]?.n)-num(priorHandovers.rows[0]?.n);
      const cashReceived=receipts.rows.reduce((s:number,x:any)=>s+num(x.amount),0);
      const expenseTotal=expenses.rows.reduce((s:number,x:any)=>s+num(x.amount),0);
      const handoverTotal=handovers.rows.reduce((s:number,x:any)=>s+num(x.amount),0);
      const closing=opening+cashReceived-expenseTotal-handoverTotal;
      return Response.json({receipts:receipts.rows,expenses:expenses.rows.map((x:any)=>({...x,category_label:x.category_label||x.category||"",folio:x.folio||""})),handovers:handovers.rows,pending_handovers:pendingHandovers.rows,rejected_handovers:rejectedHandovers.rows,summary:{pending_handover:pendingHandovers.rows.reduce((s:number,x:any)=>s+num(x.amount),0),opening_balance:opening,cash_received:cashReceived,expenses:expenseTotal,ho_handover:handoverTotal,net_movement:cashReceived-expenseTotal-handoverTotal,closing_balance:closing}});
    }
    if(p==="dealer/cash-position"&&a.scope==="dealer"){
      await ensureDealerCashSchema();
      return Response.json(await dealerCashPosition(num(a.dealer_id)));
    }
    if(p==="dealer/cash-book/all-receipts"&&a.scope==="dealer"){
      await ensureDealerCashSchema();
      const r=await pool.query("SELECT *,COALESCE(date,receipt_date) AS display_date FROM dealer_cash_receipt WHERE dealer_id=$1 ORDER BY COALESCE(date,receipt_date) DESC,id DESC LIMIT 2000",[num(a.dealer_id)]);
      const rows=r.rows.map((x:any)=>({...x,date:x.date||x.receipt_date||null}));
      return Response.json({receipts:rows,rows,count:rows.length});
    }
    if(p==="dealer/cash-book/all-expenses"&&a.scope==="dealer"){
      await ensureDealerCashSchema();await ensureDayVerifySchema();
      const r=await pool.query("SELECT * FROM dealer_cash_expense WHERE dealer_id=$1 ORDER BY date DESC,id DESC LIMIT 2000",[num(a.dealer_id)]);
      const today=todayDate();
      const vr=await pool.query("SELECT date FROM dealer_cash_day_verify WHERE dealer_id=$1 AND date=$2::date LIMIT 1",[num(a.dealer_id),today]);
      const verifiedToday=vr.rowCount>0;
      const rows=r.rows.map((x:any)=>({...x,editable_today:ymd(x.date||x.expense_date)===today&&!verifiedToday}));
      return Response.json({expenses:rows,rows,count:r.rowCount,verified_today:verifiedToday});
    }
    if(p==="dealer/cash-book/customers"&&a.scope==="dealer"){
      await ensureDealerCashSchema();await deps.ensureBillingSalesSchema();
      const did=num(a.dealer_id),u=new URL(req.url),q=String(u.searchParams.get("q")||"").trim().toLowerCase(),status=String(u.searchParams.get("status")||"").trim().toUpperCase(),payable=u.searchParams.get("payable_only")==="1";
      const cols=await columns("dealer_cash_customer"); if(!cols.size)return Response.json({error:"Customer register table not found."},{status:404});
      const r=await pool.query('SELECT * FROM dealer_cash_customer WHERE dealer_id=$1 ORDER BY id DESC LIMIT 2000',[did]);
      let customers=await enrichCashCustomers(r.rows);
      // Showroom/Branch: inke customers GRD ke tax invoice se bante hain (cash-book register me entry nahi hoti),
      // isliye jin bills ka register me match nahi hai unhe BILLED customer ke roop me jod do (read-only).
      const dRow=(await pool.query("SELECT lower(btrim(name)) AS n,LOWER(COALESCE(dealer_category,'dealer')) AS c FROM dealer WHERE id=$1",[did])).rows[0];
      if(dRow&&["showroom","branch"].includes(String(dRow.c||""))){
        const ir=await pool.query("SELECT ti.id,ti.date,ti.bill_no,ti.buyer_name,to_jsonb(ti)->>'buyer_mobile' AS mobile,to_jsonb(ti)->>'vehicle_reg_no' AS reg,to_jsonb(ti)->>'dealer_page_no' AS pg,COALESCE(ti.sale_amount,0) AS sale_amount,COALESCE(ti.amount_received,0) AS paid FROM tax_invoice ti WHERE COALESCE(ti.cancelled,false)=false AND (ti.dealer_id=$1 OR lower(btrim(ti.dealer_name))=$2) ORDER BY ti.date DESC,ti.id DESC LIMIT 3000",[did,String(dRow.n||"")]);
        const haveReg=new Set<string>(),havePg=new Set<string>();
        for(const c of customers){const g=normReg(c.vehicle_no);if(g.length>=5)haveReg.add(g);const pg=String(c.page_no||"").trim();if(pg)havePg.add(pg+"|"+normPhone(c.phone))}
        const norm=(v:any)=>String(v??"").toUpperCase().replace(/[^A-Z0-9 ]/g," ").replace(/\s+/g," ").trim();
        for(const x of ir.rows){
          if(norm(x.buyer_name)===norm(dRow.n))continue; // dealer ke naam ka bill customer nahi hai
          const g=normReg(x.reg),pg=String(x.pg||"").trim();
          if((g.length>=5&&haveReg.has(g))||(pg&&havePg.has(pg+"|"+normPhone(x.mobile))))continue;
          customers.push({id:"bill-"+x.id,from_bill:true,page_no:pg||x.bill_no||"",date:ymd(x.date),name:String(x.buyer_name||"").trim(),phone:String(x.mobile||"").trim(),vehicle_no:String(x.reg||"").trim(),status:"BILLED",sale_amount:num(x.sale_amount),loan_amount:0,paid_amount:num(x.paid),balance:Math.max(0,num(x.sale_amount)-num(x.paid)),bill_no:x.bill_no});
        }
        customers.sort((x:any,y:any)=>String(y.date||"").localeCompare(String(x.date||"")));
      }
      // Search/status are applied after enrichment so resolved name + derived BILLED status are what gets matched.
      if(status)customers=customers.filter((x:any)=>x.status===status);
      if(q)customers=customers.filter((x:any)=>[x.name,x.phone,x.page_no,x.vehicle_no].join(" ").toLowerCase().includes(q));
      if(payable)customers=customers.filter((x:any)=>x.balance>0);
      return Response.json({customers,rows:customers,count:customers.length});
    }
    // Customer Register row click: ek customer ka poora record (customer + vehicle + sale/loan + receipts + kharche).
    if(p.startsWith("dealer/cash-book/customers/")&&p.endsWith("/detail")&&a.scope==="dealer"){
      await ensureDealerCashSchema();await deps.ensureBillingSalesSchema();
      const did=num(a.dealer_id),cid=idOf(path[path.length-2]);
      if(!cid)return Response.json({error:"Customer id required."},{status:400});
      const cr=await pool.query("SELECT * FROM dealer_cash_customer WHERE id=$1 AND dealer_id=$2",[cid,did]);
      if(!cr.rowCount)return Response.json({error:"Customer not found."},{status:404});
      const [customer]=await enrichCashCustomers(cr.rows);
      const [rcp,exp,sal,dl]=await Promise.all([
        pool.query("SELECT * FROM dealer_cash_receipt WHERE customer_id=$1 AND dealer_id=$2 ORDER BY COALESCE(date,receipt_date) ASC,id ASC",[cid,did]),
        pool.query("SELECT * FROM dealer_cash_expense WHERE customer_id=$1 AND dealer_id=$2 ORDER BY COALESCE(date,expense_date) ASC,id ASC",[cid,did]),
        pool.query("SELECT * FROM grd_billing_sale WHERE dealer_cash_customer_id=$1 AND dealer_id=$2 ORDER BY (status='BILLED') DESC,id DESC LIMIT 1",[cid,did]),
        pool.query("SELECT lower(btrim(name)) AS n FROM dealer WHERE id=$1",[did])
      ]);
      const sale:any=sal.rows[0]||null;
      // Tax invoice (bill): pehle sale se link, warna vehicle no., warna page no.+mobile se match.
      let inv:any=null;
      const reg=normReg(customer.vehicle_no),mob=normPhone(customer.phone),pg=String(customer.page_no||"").trim();
      const dealerScope="(ti.dealer_id=$1 OR lower(btrim(COALESCE(ti.dealer_name,'')))=$2)";
      if(sale?.invoice_id){inv=(await pool.query("SELECT to_jsonb(ti) AS j FROM tax_invoice ti WHERE ti.id=$1 AND ti.dealer_id=$2 LIMIT 1",[sale.invoice_id,did])).rows[0]?.j||null;}
      if(!inv&&reg.length>=5&&reg!=="NEW"&&reg!=="OLD"){inv=(await pool.query("SELECT to_jsonb(ti) AS j FROM tax_invoice ti WHERE COALESCE(ti.cancelled,false)=false AND "+dealerScope+" AND regexp_replace(upper(COALESCE(to_jsonb(ti)->>'vehicle_reg_no','')),'[^A-Z0-9]','','g')=$3 ORDER BY ti.id DESC LIMIT 1",[did,dl.rows[0]?.n||"",reg])).rows[0]?.j||null;}
      if(!inv&&pg&&mob.length===10){inv=(await pool.query("SELECT to_jsonb(ti) AS j FROM tax_invoice ti WHERE COALESCE(ti.cancelled,false)=false AND "+dealerScope+" AND btrim(COALESCE(to_jsonb(ti)->>'dealer_page_no',''))=$3 AND right(regexp_replace(COALESCE(to_jsonb(ti)->>'buyer_mobile',''),'[^0-9]','','g'),10)=$4 ORDER BY ti.id DESC LIMIT 1",[did,dl.rows[0]?.n||"",pg,mob])).rows[0]?.j||null;}
      // Vehicle: chassis se vehicle master.
      const chassis=String(inv?.chassis_no||sale?.chassis_no||"").trim();
      let veh:any=null;
      if(chassis){veh=(await pool.query("SELECT model_name,chassis_no,motor_no,controller_no,colour,battery_maker,battery_no1,battery_no2,battery_no3,battery_no4 FROM vehicle WHERE lower(btrim(chassis_no))=lower($1) ORDER BY id DESC LIMIT 1",[chassis])).rows[0]||null;}
      const vehicle={
        vehicle_no:customer.vehicle_no||"",
        registration_no:inv?.vehicle_reg_no||sale?.vehicle_reg_no||"",
        model:veh?.model_name||inv?.product_name||sale?.description||"",
        chassis_no:chassis,motor_no:veh?.motor_no||inv?.motor_no||"",controller_no:veh?.controller_no||"",colour:veh?.colour||"",
        battery_maker:veh?.battery_maker||"",
        battery_nos:[veh?.battery_no1,veh?.battery_no2,veh?.battery_no3,veh?.battery_no4].map((x:any)=>String(x||"").trim()).filter(Boolean),
        linked:Boolean(inv||sale||veh)
      };
      const expenses=exp.rows.map((x:any)=>({...x,date:ymd(x.date||x.expense_date),amount:num(x.amount)}));
      const activeExp=expenses.filter((x:any)=>!["CANCELLED","CANCELED","DELETED","VOID"].includes(String(x.status||"").toUpperCase()));
      const expenseTotal=activeExp.reduce((t:number,x:any)=>t+x.amount,0);
      const byCat=new Map<string,number>();
      for(const x of activeExp){const k=String(x.category_label||x.category||"Other").trim()||"Other";byCat.set(k,(byCat.get(k)||0)+x.amount)}
      const receipts=rcp.rows.map((x:any)=>({...x,date:ymd(x.date||x.receipt_date),amount:num(x.amount)}));
      // Dealer ne booking (Pending Sale) par jo Internal Sale Amount / Loan likha wahi pehle; na ho to cash register, phir bill.
      const saleAmount=num(sale?.sale_amount)||num(customer.sale_amount)||num(inv?.sale_amount);
      const loanAmount=num(sale?.hypothecation_amount)||num(customer.loan_amount)||num(inv?.hypothecation_amount);
      const paid=num(customer.paid_amount);
      return Response.json({
        customer:{id:customer.id,name:customer.name,phone:customer.phone,page_no:customer.page_no,date:ymd(customer.date),status:customer.status,status_label:customer.status_label||customer.status,cancel_reason:customer.cancel_reason||"",
          address:sale?.customer_address||inv?.buyer_address||"",father_name:sale?.buyer_father_name||"",aadhar:sale?.buyer_aadhar||"",pan:sale?.buyer_pan||""},
        vehicle,
        sale:{sale_amount:saleAmount,loan_amount:loanAmount,paid_amount:paid,balance:Math.max(0,saleAmount-loanAmount-paid),financer:sale?.financer_name||inv?.financer_name||"",
          bill_no:inv?.bill_no||"",bill_date:ymd(inv?.date),invoice_id:inv?.id||null,sale_status:sale?.status||"",
          internal_sale_details:String(sale?.internal_sale_details||"").trim(),description:String(sale?.description||"").trim(),sale_type:sale?.sale_type||"",do_no:sale?.do_no||"",remarks:sale?.remarks||"",booking_page_no:sale?.page_no||""},
        receipts,expenses,
        expense_summary:{total:expenseTotal,count:activeExp.length,by_category:[...byCat.entries()].map(([category,amount])=>({category,amount}))}
      });
    }
  return null;
}

// ---------------- POST (dealer portal) ----------------
export async function dealerCashbookPost(path:string[],b:any,a:any):Promise<Response|null>{
  const p=path.join("/");
  if(a?.scope!=="dealer")return null;
    if(a.scope==="dealer" && p==="dealer/cash-book/expense"){
      await ensureDealerCashSchema();
      const did=num(a.dealer_id),amount=num(b.amount);
      if(amount<=0)return Response.json({error:"Expense amount is required."},{status:400});
      const no="EXP-"+new Date().toISOString().slice(0,10).replace(/-/g,"")+"-"+String(Date.now()).slice(-5);
      // Purani DB me expense_date NOT NULL hoti hai; date aur expense_date dono sync rakho (handover jaisa).
      const eDate=String(b.date||b.expense_date||"").slice(0,10)||new Date().toISOString().slice(0,10);
      const ec=await columns("dealer_cash_expense");
      // Customer-linked kharche (PCC / LL / DL / Makkhi): customer ka naam + page no. DB se liya jata hai (client par bharosa nahi).
      let cust:any=null;
      if(b.customer_id){const cr=await pool.query("SELECT * FROM dealer_cash_customer WHERE id=$1 AND dealer_id=$2",[num(b.customer_id),did]);if(!cr.rowCount)return Response.json({error:"Selected customer not found."},{status:400});cust=cr.rows[0];}
      const custName=cust?String(cust.name||cust.full_name||"").trim():"";
      const ein:any={dealer_id:did,date:eDate,expense_date:eDate,expense_no:no,category:String(b.category||"other"),category_label:String(b.category_label||b.category||"").trim(),amount,paid_to:String(b.paid_to||"").trim()||null,remarks:String(b.remarks||"").trim()||null,folio:String(b.folio||"").trim()||(cust&&cust.page_no?String(cust.page_no).trim():null),status:"ACTIVE",customer_id:cust?cust.id:null,customer_name:custName||null,customer_page_no:cust&&cust.page_no?String(cust.page_no).trim():null};
      const ek=Object.keys(ein).filter(k=>ec.has(k));
      const r=await pool.query('INSERT INTO dealer_cash_expense ('+ek.map(k=>'"'+k+'"').join(",")+') VALUES ('+ek.map((_,i)=>"$"+(i+1)).join(",")+') RETURNING *',ek.map(k=>ein[k]));
      return Response.json({success:true,expense:r.rows[0],row:r.rows[0]},{status:201});
    }
    if(a.scope==="dealer" && p==="dealer/cash-book/handover"){
      await ensureDealerCashSchema();
      const did=num(a.dealer_id),amount=num(b.amount);
      if(amount<=0)return Response.json({error:"Handover amount is required."},{status:400});
      const pos=await dealerCashPosition(did);
      if(amount>pos.available_for_handover+0.001)return Response.json({error:"Handover amount cash in hand se zyada hai. Available: Rs "+Math.max(0,pos.available_for_handover).toLocaleString("en-IN")+(pos.pending_handover>0?" (Rs "+pos.pending_handover.toLocaleString("en-IN")+" pehle se pending acceptance me hai)":"")},{status:400});
      const no="HO-"+new Date().toISOString().slice(0,10).replace(/-/g,"")+"-"+String(Date.now()).slice(-5);
      const hDate=String(b.date||b.handover_date||"").slice(0,10)||new Date().toISOString().slice(0,10);
      const hc=await columns("dealer_cash_handover");
      const hin:any={dealer_id:did,date:hDate,handover_date:hDate,handover_no:no,amount,sent_to:String(b.sent_to||"").trim()||null,remarks:String(b.remarks||"").trim()||null,folio:String(b.folio||"").trim()||null,status:"pending"};
      const hk=Object.keys(hin).filter(k=>hc.has(k));
      const r=await pool.query('INSERT INTO dealer_cash_handover ('+hk.map(k=>'"'+k+'"').join(",")+') VALUES ('+hk.map((_,i)=>"$"+(i+1)).join(",")+') RETURNING *',hk.map(k=>hin[k]));
      return Response.json({success:true,handover:r.rows[0],row:r.rows[0]},{status:201});
    }
    if(a.scope==="dealer" && p==="dealer/cash-book/receipt"){
      await ensureDealerCashSchema();
      const did=num(a.dealer_id),type=String(b.receipt_type||"new_booking"),customerId=idOf(b.customer_id),date=String(b.date||b.receipt_date||new Date().toISOString().slice(0,10));
      const cc=await columns("dealer_cash_customer"),rc=await columns("dealer_cash_receipt");
      if(!cc.size||!rc.size)return Response.json({error:"Cash receipt tables are not available."},{status:500});
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        let cid=customerId;
        if(type==="balance_payment"){
          if(!cid)throw new Error("Previous customer is required.");
          const chk=await client.query("SELECT * FROM dealer_cash_customer WHERE id=$1 AND dealer_id=$2 FOR UPDATE",[cid,did]);
          if(!chk.rowCount)throw new Error("Customer not found.");
          // Balance payment form sirf customer_id bhejta hai; receipt row (customer_name NOT NULL) ke liye details customer register se lo.
          const [ec]=await enrichCashCustomers([chk.rows[0]]);
          b.customer_name=String(b.customer_name||"").trim()||ec?.name||"";
          b.customer_phone=String(b.customer_phone||"").trim()||ec?.phone||"";
          b.dealer_register_page_no=String(b.dealer_register_page_no||"").trim()||String(chk.rows[0].page_no||"").trim();
          b.sale_amount=chk.rows[0].sale_amount;
          b.loan_amount=chk.rows[0].loan_amount;
        }else{
          const input:any={dealer_id:did,name:String(b.customer_name||"").trim(),phone:String(b.customer_phone||"").trim(),full_name:String(b.customer_name||"").trim(),customer_phone:String(b.customer_phone||"").trim(),page_no:String(b.dealer_register_page_no||"").trim()||null,vehicle_no:String(b.booking_for||"new").trim(),sale_amount:num(b.sale_amount),loan_amount:num(b.loan_amount),paid_amount:num(b.amount),status:"VEHICLE_PENDING",date:date||null};
          const keys=Object.keys(input).filter(k=>cc.has(k));
          if(!input.name||!input.phone)throw new Error("Customer name and mobile are required.");
          if(!keys.length)throw new Error("Customer register schema is missing required fields.");
          const rr=await client.query('INSERT INTO dealer_cash_customer ('+keys.map(k=>'"'+k+'"').join(",")+') VALUES ('+keys.map((_,i)=>"$"+(i+1)).join(",")+') RETURNING *',keys.map(k=>input[k]));
          cid=rr.rows[0].id;
        }
        const input:any={dealer_id:did,customer_id:cid,date:date||null,receipt_type:type,customer_name:String(b.customer_name||"").trim()||"-",customer_phone:String(b.customer_phone||"").trim()||null,dealer_register_page_no:String(b.dealer_register_page_no||"").trim()||null,sale_amount:num(b.sale_amount),loan_amount:num(b.loan_amount),amount:num(b.amount),payment_mode:String(b.payment_mode||"cash"),reference_no:String(b.reference_no||"").trim()||null,remarks:String(b.remarks||"").trim()||null,request_id:String(b.request_id||"").trim()||null,receipt_date:date,receipt_no:"RC-"+Date.now()};
        const keys=Object.keys(input).filter(k=>rc.has(k));
        const rr=await client.query('INSERT INTO dealer_cash_receipt ('+keys.map(k=>'"'+k+'"').join(",")+') VALUES ('+keys.map((_,i)=>"$"+(i+1)).join(",")+') RETURNING *',keys.map(k=>input[k]));
        const receipt=rr.rows[0];
        if(type==="balance_payment"){
          const cust=await client.query("SELECT * FROM dealer_cash_customer WHERE id=$1 FOR UPDATE",[cid]);
          const paid=Number(cust.rows[0]?.paid_amount||0)+num(b.amount);
          await client.query("UPDATE dealer_cash_customer SET paid_amount=$1 WHERE id=$2",[paid,cid]);
        }
        await client.query("COMMIT");
        return Response.json({success:true,receipt},{status:201});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    if(p==="dealer/ledger-accounts"&&a.scope==="dealer"){
      await pool.query(`CREATE TABLE IF NOT EXISTS dealer_ledger_account (
        id bigserial PRIMARY KEY,dealer_id integer NOT NULL,account_type text NOT NULL,name text NOT NULL,code text,
        mobile text,address text,account_no text,ifsc text,opening_balance numeric NOT NULL DEFAULT 0,
        opening_type text NOT NULL DEFAULT 'dr',notes text,created_at timestamptz NOT NULL DEFAULT now()
      )`);
      const name=String(b.name||"").trim();if(!name)return Response.json({error:"Ledger Name is required."},{status:400});
      const r=await pool.query("INSERT INTO dealer_ledger_account (dealer_id,account_type,name,code,mobile,address,account_no,ifsc,opening_balance,opening_type,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *",
        [num(a.dealer_id),String(b.account_type||"dealer"),name,String(b.code||"").trim()||null,String(b.mobile||"").trim()||null,String(b.address||"").trim()||null,String(b.account_no||"").trim()||null,String(b.ifsc||"").trim()||null,num(b.opening_balance),String(b.opening_type||"dr"),String(b.notes||"").trim()||null]);
      return Response.json({success:true,row:r.rows[0],data:r.rows[0]},{status:201});
    }
  return null;
}

// ---------------- PUT (dealer portal) ----------------
export async function dealerCashbookMutation(path:string[],method:string,a:any,body:any,deps:CashbookDeps):Promise<Response|null>{
  const p=path.join("/");
  if(a?.scope!=="dealer"||method!=="PUT")return null;
    if(p.startsWith("dealer/cash-book/expenses/") && method==="PUT" && a.scope==="dealer"){
      await ensureDealerCashSchema();
      await ensureDayVerifySchema();
      const id=idOf(path[path.length-1]),b:any=body,did=num(a.dealer_id);
      if(!id)return Response.json({error:"Expense id required."},{status:400});
      const rr=await pool.query("SELECT * FROM dealer_cash_expense WHERE id=$1 AND dealer_id=$2 LIMIT 1",[id,did]);
      if(!rr.rowCount)return Response.json({error:"Expense not found."},{status:404});
      const old=rr.rows[0],eDate=ymd(old.date||old.expense_date),today=todayDate();
      if(eDate!==today)return Response.json({error:"Sirf aaj ke expense ko edit kiya ja sakta hai."},{status:403});
      const vr=await pool.query("SELECT id FROM dealer_cash_day_verify WHERE dealer_id=$1 AND date=$2::date LIMIT 1",[did,eDate]);
      if(vr.rowCount)return Response.json({error:"Cashbook Admin verify ho chuka hai. Ab expense me koi change nahi ho sakta."},{status:403});
      const amount=num(b.amount);
      if(amount<=0)return Response.json({error:"Valid expense amount required."},{status:400});
      const category=String(b.category||old.category||"other").trim()||"other";
      const categoryLabel=String(b.category_label||old.category_label||category).trim()||category;
      const paidTo=String(b.paid_to??old.paid_to??"").trim()||null;
      const remarks=String(b.remarks??old.remarks??"").trim()||null;
      const folio=String(b.folio??old.folio??"").trim()||null;
      const r=await pool.query("UPDATE dealer_cash_expense SET category=$1,category_label=$2,amount=$3,paid_to=$4,remarks=$5,folio=$6 WHERE id=$7 AND dealer_id=$8 RETURNING *",[category,categoryLabel,amount,paidTo,remarks,folio,id,did]);
      await audit(a,"dealer/cash-book/expenses","edit",id,old,r.rows[0],did,old.expense_no||id);
      return Response.json({success:true,expense:r.rows[0],row:r.rows[0]});
    }
    if(p.startsWith("dealer/cash-book/receipts/") && method==="PUT" && a.scope==="dealer"){
      const id=idOf(path[path.length-1]),b:any=body;
      if(!id)return Response.json({error:"Receipt id required."},{status:400});
      const rr=await pool.query("SELECT id,customer_id FROM dealer_cash_receipt WHERE id=$1 AND dealer_id=$2 LIMIT 1",[id,num(a.dealer_id)]);
      if(!rr.rowCount)return Response.json({error:"Receipt not found."},{status:404});
      const page=String(b.dealer_register_page_no||"").trim()||null,loan=num(b.loan_amount);
      const client=await pool.connect();
      try{await client.query("BEGIN");await client.query("UPDATE dealer_cash_receipt SET dealer_register_page_no=$1 WHERE id=$2",[page,id]);if(rr.rows[0].customer_id)await client.query("UPDATE dealer_cash_customer SET page_no=$1,loan_amount=$2 WHERE id=$3 AND dealer_id=$4",[page,loan,num(rr.rows[0].customer_id),num(a.dealer_id)]);await client.query("COMMIT");return Response.json({success:true});}
      catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    if(p.startsWith("dealer/cash-book/customers/") && method==="PUT" && a.scope==="dealer"){
      const id=idOf(path[path.length-1]),b:any=body; if(!id)return Response.json({error:"Customer id required."},{status:400});
      const did=num(a.dealer_id);
      await deps.ensureBillingSalesSchema();
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        const cur=await client.query("SELECT * FROM dealer_cash_customer WHERE id=$1 AND dealer_id=$2 FOR UPDATE",[id,did]);
        if(!cur.rowCount){await client.query("ROLLBACK");return Response.json({error:"Customer not found."},{status:404});}
        const old=cur.rows[0];
        const amountKeys=['sale_amount','loan_amount'].filter((key)=>Object.prototype.hasOwnProperty.call(b,key));
        let saleRow:any=null,invoice:any=null;
        if(amountKeys.length){
          saleRow=(await client.query("SELECT * FROM grd_billing_sale WHERE dealer_cash_customer_id=$1 AND dealer_id=$2 ORDER BY (status='BILLED') DESC,id DESC LIMIT 1",[id,did])).rows[0]||null;

          // Find the real tax invoice as well. Older/imported customer rows do not always have
          // a linked grd_billing_sale, so page+mobile alone was not enough in some cases.
          if(saleRow?.invoice_id){
            invoice=(await client.query("SELECT * FROM tax_invoice WHERE id=$1 AND (dealer_id=$2 OR dealer_id IS NULL) LIMIT 1",[idOf(saleRow.invoice_id),did])).rows[0]||null;
          }
          if(!invoice && saleRow?.delivery_challan_id){
            invoice=(await client.query("SELECT * FROM tax_invoice WHERE delivery_challan_id=$1 AND COALESCE(cancelled,false)=false AND (dealer_id=$2 OR dealer_id IS NULL) ORDER BY id DESC LIMIT 1",[idOf(saleRow.delivery_challan_id),did])).rows[0]||null;
          }
          if(!invoice && String(saleRow?.chassis_no||'').trim()){
            invoice=(await client.query("SELECT * FROM tax_invoice WHERE COALESCE(cancelled,false)=false AND (dealer_id=$1 OR (dealer_id IS NULL AND lower(btrim(COALESCE(dealer_name,'')))=lower(btrim((SELECT name FROM dealer WHERE id=$1))))) AND lower(btrim(COALESCE(chassis_no,'')))=lower(btrim($2)) ORDER BY id DESC LIMIT 1",[did,String(saleRow.chassis_no).trim()])).rows[0]||null;
          }
          if(!invoice && String(old.vehicle_no||'').trim() && !['NEW','OLD'].includes(normReg(old.vehicle_no))){
            const reg=normReg(old.vehicle_no);
            invoice=(await client.query("SELECT * FROM tax_invoice WHERE COALESCE(cancelled,false)=false AND (dealer_id=$1 OR (dealer_id IS NULL AND lower(btrim(COALESCE(dealer_name,'')))=lower(btrim((SELECT name FROM dealer WHERE id=$1))))) AND regexp_replace(upper(COALESCE(to_jsonb(tax_invoice)->>'vehicle_reg_no','')),'[^A-Z0-9]','','g')=$2 ORDER BY id DESC LIMIT 1",[did,reg])).rows[0]||null;
          }
          if(!invoice && String(old.page_no||'').trim() && normPhone(old.phone||old.customer_phone).length===10){
            invoice=(await client.query("SELECT * FROM tax_invoice WHERE COALESCE(cancelled,false)=false AND (dealer_id=$1 OR (dealer_id IS NULL AND lower(btrim(COALESCE(dealer_name,'')))=lower(btrim((SELECT name FROM dealer WHERE id=$1))))) AND btrim(COALESCE(to_jsonb(tax_invoice)->>'dealer_page_no',''))=$2 AND right(regexp_replace(COALESCE(to_jsonb(tax_invoice)->>'buyer_mobile',''),'[^0-9]','','g'),10)=$3 ORDER BY id DESC LIMIT 1",[did,String(old.page_no).trim(),normPhone(old.phone||old.customer_phone)])).rows[0]||null;
          }
          if(!invoice && String(old.name||old.full_name||'').trim() && normPhone(old.phone||old.customer_phone).length===10){
            invoice=(await client.query("SELECT * FROM tax_invoice WHERE COALESCE(cancelled,false)=false AND (dealer_id=$1 OR (dealer_id IS NULL AND lower(btrim(COALESCE(dealer_name,'')))=lower(btrim((SELECT name FROM dealer WHERE id=$1))))) AND lower(btrim(COALESCE(buyer_name,'')))=lower(btrim($2)) AND right(regexp_replace(COALESCE(to_jsonb(tax_invoice)->>'buyer_mobile',''),'[^0-9]','','g'),10)=$3 ORDER BY id DESC LIMIT 1",[did,String(old.name||old.full_name).trim(),normPhone(old.phone||old.customer_phone)])).rows[0]||null;
          }
        }
        const sets:string[]=[],vals:any[]=[];
        if(Object.prototype.hasOwnProperty.call(b,'page_no')){
          vals.push(String(b.page_no||"").trim()||null);
          sets.push("page_no=$"+vals.length);
        }
        const amountUpdates:any={};
        for(const key of amountKeys){
          const n=Number(b[key]);
          if(!Number.isFinite(n)||n<0){await client.query("ROLLBACK");return Response.json({error:"Invalid "+key+"."},{status:400});}
          // A filled value anywhere in the linked sale/bill is also treated as filled. Dealer cannot overwrite it.
          const currentCustomer=num(old[key]);
          const currentSale=num(saleRow?.[key]);
          const currentInvoice=key==='sale_amount'?num(invoice?.sale_amount):num(invoice?.hypothecation_amount);
          if(currentCustomer!==0 || currentSale!==0 || currentInvoice!==0){
            await client.query("ROLLBACK");
            return Response.json({error:(key==='sale_amount'?"Sale Amount":"Loan Amount")+" already filled hai, isliye edit nahi ho sakta."},{status:403});
          }
          vals.push(n);
          sets.push('\"'+key+'\"=$'+vals.length);
          amountUpdates[key]=n;
        }
        if(!sets.length){await client.query("ROLLBACK");return Response.json({error:"Koi editable field nahi mili."},{status:400});}
        vals.push(id,did);
        const r=await client.query("UPDATE dealer_cash_customer SET "+sets.join(",")+" WHERE id=$"+(vals.length-1)+" AND dealer_id=$"+vals.length+" RETURNING *",vals);
        if(!r.rowCount){await client.query("ROLLBACK");return Response.json({error:"Customer not found."},{status:404});}
        // Keep linked billing records in sync when their corresponding amount was blank.
        if(saleRow){
          const saleSets:string[]=[],saleVals:any[]=[];
          for(const key of amountKeys){
            if(Object.prototype.hasOwnProperty.call(amountUpdates,key)) { saleVals.push(amountUpdates[key]); saleSets.push('\"'+key+'\"=$'+saleVals.length); }
          }
          if(saleSets.length){saleVals.push(saleRow.id);await client.query("UPDATE grd_billing_sale SET "+saleSets.join(",")+",updated_at=NOW() WHERE id=$"+saleVals.length+"",saleVals);}
        }
        if(invoice){
          const invSets:string[]=[],invVals:any[]=[];
          for(const key of amountKeys){
            if(!Object.prototype.hasOwnProperty.call(amountUpdates,key))continue;
            invVals.push(amountUpdates[key]);
            invSets.push((key==='sale_amount'?"sale_amount":"hypothecation_amount")+"=$"+invVals.length);
          }
          if(invSets.length){invVals.push(invoice.id);await client.query("UPDATE tax_invoice SET "+invSets.join(",")+" WHERE id=$"+invVals.length,invVals);}
        }
        await client.query("COMMIT");
        await audit(a,"dealer/cash-book/customers","edit",id,old,r.rows[0],did,r.rows[0]?.page_no||id);
        return Response.json({success:true,customer:r.rows[0]});
      }catch(e){await client.query("ROLLBACK").catch(()=>{});throw e}finally{client.release()}
    }
  return null;
}

// ---------------- Admin / staff side (route.ts se nikala gaya, logic same) ----------------
// GET: reports/dealer-day-book, reports/cash-at-dealer, admin/cash-handovers
const isCashierUser=(a:any)=>String(a?.department||"").trim().toLowerCase()==="cashier";
export async function cashbookAdminGet(req:Request,path:string[],a:any):Promise<Response|null>{
  const p=path.join("/");
    if(p==="reports/dealer-day-book"&&a.scope==="staff"){
      const u=new URL(req.url),did=idOf(u.searchParams.get("dealer_id"));
      if(!did)return Response.json({error:"dealer_id required."},{status:400});
      const today=new Date().toISOString().slice(0,10),back=new Date(Date.now()-30*86400000).toISOString().slice(0,10);
      const from=ymd(u.searchParams.get("from"))||back,to=ymd(u.searchParams.get("to"))||today;
      const dr=await pool.query("SELECT id,code,name FROM dealer WHERE id=$1",[did]);
      if(!dr.rowCount)return Response.json({error:"Dealer not found."},{status:404});
      const days=await dealerDayBook(did,from,to);
      const verified=days.filter((d:any)=>d.verified&&!d.verified.changed).length;
      return Response.json({dealer:dr.rows[0],from,to,days,summary:{days:days.length,verified,changed:days.filter((d:any)=>d.verified?.changed).length,unverified:days.filter((d:any)=>!d.verified).length}});
    }
    if(p==="reports/cash-at-dealer"&&a.scope==="staff"){
      await ensureDealerCashSchema();
      const u=new URL(req.url),only=idOf(u.searchParams.get("dealer_id"));
      const ds=await pool.query("SELECT id,code,name FROM dealer WHERE LOWER(COALESCE(dealer_category,'')) IN ('showroom','branch')"+(only?" AND id=$1":"")+" ORDER BY name",only?[only]:[]);
      const rows:any[]=await Promise.all(ds.rows.map(async(d:any)=>{const c=await dealerCashPosition(Number(d.id));return {dealer_id:d.id,dealer_code:d.code,dealer_name:d.name,cash_received:c.cash_received,expenses:c.expenses,ho_handover:c.ho_handover,pending_handover:c.pending_handover,cash_at_dealer:c.cash_at_dealer};}));
      return Response.json({rows,total_cash_at_dealer:rows.reduce((s,x)=>s+num(x.cash_at_dealer),0),total_pending_handover:rows.reduce((s,x)=>s+num(x.pending_handover),0)});
    }
    // Cashier tab: Head Office me aaya CASH (Day Book receipts, bank_id khali = cash). Showroom / branch ki apni receipts (dealer_cash_receipt) isme nahi aati.
    // Accept hue cash handover bhi yahin aate hain (Day Book me IN entry banti hai).
    if(p==="cashier/all-receipts"&&a.scope==="staff"){
      if(!isAdmin(a)&&!isCashierUser(a))return Response.json({error:"Cashier rights required."},{status:403});
      const dc=await columns("day_book");
      if(!dc.size)return Response.json({receipts:[],rows:[],count:0,total:0});
      const cashOnly=dc.has("bank_id")?" AND bank_id IS NULL":"";
      const r=await pool.query("SELECT * FROM day_book WHERE COALESCE(credit_received,0)>0"+cashOnly+" ORDER BY date DESC,id DESC LIMIT 5000");
      const rows=r.rows.map((x:any)=>({id:x.id,date:ymd(x.date)||null,vr_no:x.vr_no,party:String(x.dealer_name||x.party_name||"").trim(),narration:x.narration||"",amount:num(x.credit_received),folio:x.folio||""}));
      return Response.json({receipts:rows,rows,count:rows.length,total:rows.reduce((t:number,x:any)=>t+x.amount,0)});
    }
    if(p==="admin/cash-handovers"){
      if(!isAdmin(a)&&!isCashierUser(a))return Response.json({error:"Admin / Cashier rights required."},{status:403});
      await ensureDealerCashSchema();
      const st=String(new URL(req.url).searchParams.get("status")||"").trim().toLowerCase();
      const r=await pool.query("SELECT h.*,d.name AS dealer_name,d.code AS dealer_code FROM dealer_cash_handover h LEFT JOIN dealer d ON d.id=h.dealer_id"+(st?" WHERE lower(COALESCE(h.status,'pending'))=$1":"")+" ORDER BY (lower(COALESCE(h.status,'pending'))='pending') DESC,h.date DESC,h.id DESC LIMIT 500",st?[st]:[]);
      return Response.json({handovers:r.rows,rows:r.rows,count:r.rowCount});
    }
  return null;
}

// POST: admin/cash-handovers/:id/accept|reject, dealer-day-book/verify
export async function cashbookAdminPost(path:string[],b:any,a:any):Promise<Response|null>{
  const p=path.join("/");
    // Admin (Head Office): dealer ka cash handover accept / reject.
    // Accept = dealer ke cashbook me OUT (accepted status se) + admin Day Book me IN (credit entry).
    if(/^admin\/cash-handovers\/\d+\/(accept|reject)$/.test(p)){
      if(!isAdmin(a)&&!isCashierUser(a))return Response.json({error:"Admin / Cashier rights required."},{status:403});
      await ensureDealerCashSchema();
      const id=idOf(path[2]),action=path[3];
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        const cur=await client.query("SELECT h.*,d.name AS dealer_name FROM dealer_cash_handover h LEFT JOIN dealer d ON d.id=h.dealer_id WHERE h.id=$1 FOR UPDATE OF h",[id]);
        if(!cur.rowCount)throw new Error("Handover not found.");
        const h=cur.rows[0];
        if(String(h.status||"pending").toLowerCase()!=="pending")throw new Error("Ye handover pehle hi "+h.status+" ho chuka hai.");
        const who=String(a.full_name||a.username||a.name||a.sub||"admin");
        if(action==="reject"){
          const upd=await client.query("UPDATE dealer_cash_handover SET status='rejected',accepted_at=NOW(),accepted_by=$1,reject_reason=$2 WHERE id=$3 RETURNING *",[who,String(b.reason||"").trim()||null,id]);
          await client.query("COMMIT");return Response.json({success:true,handover:upd.rows[0]});
        }
        // Admin Day Book me IN entry (columns jo table me hain wahi bharenge).
        const dbc=await columns("day_book");let dayBookId:any=null;
        if(dbc.size){
          const dt=ymd(h.date)||new Date().toISOString().slice(0,10);
          // day_book.vr_no purani DB me integer hai -> handover_no (text) nahi ja sakta. Numeric ho to next number lo; handover no narration me rehta hai.
          const vt=(await client.query("SELECT data_type FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='day_book' AND column_name='vr_no'")).rows[0]?.data_type||"";
          let vrNo:any=h.handover_no;
          if(["integer","bigint","smallint","numeric"].includes(vt)){vrNo=Number((await client.query("SELECT COALESCE(MAX(vr_no),0)+1 AS n FROM day_book")).rows[0]?.n||1);}
          const entry:any={date:dt,vr_no:vrNo,dealer_name:h.dealer_name||"",dealer_id:h.dealer_id,credit_received:num(h.amount),debit_paid:0,payment_mode:"cash",mode:"cash",
            narration:"Cash handover received from "+(h.dealer_name||"dealer")+" ("+h.handover_no+")"+(h.remarks?" - "+h.remarks:""),folio:h.folio||null};
          const keys=Object.keys(entry).filter(k=>dbc.has(k));
          const ins=await client.query('INSERT INTO day_book ('+keys.map(k=>'"'+k+'"').join(",")+') VALUES ('+keys.map((_,i)=>"$"+(i+1)).join(",")+') RETURNING id',keys.map(k=>entry[k]));
          dayBookId=ins.rows[0]?.id||null;
        }
        const upd=await client.query("UPDATE dealer_cash_handover SET status='accepted',accepted_at=NOW(),accepted_by=$1,day_book_id=$2 WHERE id=$3 RETURNING *",[who,dayBookId,id]);
        await client.query("COMMIT");
        return Response.json({success:true,handover:upd.rows[0],day_book_id:dayBookId});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    // Day Book verify: {dealer_id, dates:["2026-09-28",...] (ya date), unverify?:true, remarks?}
    if(p==="dealer-day-book/verify"){
      if(a?.scope!=="staff")return Response.json({error:"Staff rights required."},{status:403});
      const did=idOf(b.dealer_id);if(!did)return Response.json({error:"dealer_id required."},{status:400});
      const dates=[...new Set((Array.isArray(b.dates)?b.dates:[b.date]).map((x:any)=>ymd(x)).filter(Boolean))] as string[];
      if(!dates.length)return Response.json({error:"date required."},{status:400});
      if(dates.length>93)return Response.json({error:"Ek baar me maximum 93 din verify ho sakte hain."},{status:400});
      await ensureDayVerifySchema();
      if(b.unverify){
        await pool.query("DELETE FROM dealer_cash_day_verify WHERE dealer_id=$1 AND date=ANY($2::date[])",[did,dates]);
        await audit(a,"dealer-day-book","unverify",did,{dates},null,did,dates.join(","));
        return Response.json({success:true,unverified:dates.length});
      }
      const sorted=[...dates].sort(),days=await dealerDayBook(did,sorted[0],sorted[sorted.length-1]);
      const byDate=new Map<string,any>(days.map((d:any)=>[d.date,d]));
      const who=String(a?.username||a?.full_name||"").trim()||"staff",remarks=String(b.remarks||"").trim()||null;
      let n=0;
      for(const d of dates){
        const dd=byDate.get(d);if(!dd)continue;
        await pool.query("INSERT INTO dealer_cash_day_verify(dealer_id,date,verified_by,verified_at,remarks,snap_receipts,snap_expenses,snap_handover,snap_count) VALUES($1,$2::date,$3,now(),$4,$5,$6,$7,$8) ON CONFLICT (dealer_id,date) DO UPDATE SET verified_by=EXCLUDED.verified_by,verified_at=now(),remarks=EXCLUDED.remarks,snap_receipts=EXCLUDED.snap_receipts,snap_expenses=EXCLUDED.snap_expenses,snap_handover=EXCLUDED.snap_handover,snap_count=EXCLUDED.snap_count",[did,d,who,remarks,dd.cash_in,dd.expenses,dd.ho_out,dd.count]);
        n++;
      }
      await audit(a,"dealer-day-book","verify",did,null,{dates},did,dates.join(","));
      return Response.json({success:true,verified:n});
    }
  return null;
}
