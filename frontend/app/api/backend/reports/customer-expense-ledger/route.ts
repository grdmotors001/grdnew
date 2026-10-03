import jwt from "jsonwebtoken";
import { Pool } from "pg";

export const dynamic="force-dynamic";
export const runtime="nodejs";

const pool=new Pool({connectionString:process.env.DATABASE_URL,max:5,ssl:{rejectUnauthorized:false}});
const secret=process.env.JWT_SECRET||"grd-node-change-this-secret";

function auth(req:Request){
  const h=req.headers.get("authorization")||"";
  const t=h.startsWith("Bearer ")?h.slice(7):"";
  if(!t)return null;
  try{return jwt.verify(t,secret) as any}catch{return null}
}
const num=(v:any)=>Number.isFinite(Number(v))?Number(v):0;
const csvCell=(v:any)=>{const s=String(v??"");return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s};
function csvResponse(rows:any[],filename:string){
  const keys=Object.keys(rows[0]||{customer_name:"",chassis_no:"",dealer_name:"",vehicle_no:"",sale_value:0,loan_value:0,expense_total:0,record_no:""});
  const body=[keys.join(","),...rows.map(r=>keys.map(k=>csvCell(r[k])).join(","))].join("\n");
  return new Response(body,{status:200,headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":"attachment; filename="+filename}});
}
function jsonVal(x:any,k:string){
  const v=x?.[k];
  if(v==null)return "";
  if(typeof v==="object")return v;
  try{return JSON.parse(v)}catch{return v}
}
function njson(x:any,k:string){return num(jsonVal(x,k))}
const normReg=(v:any)=>String(v??"").toUpperCase().replace(/[^A-Z0-9]/g,"");
const normPhone=(v:any)=>String(v??"").replace(/\D/g,"").slice(-10);
const normCh=(v:any)=>String(v??"").trim().toLowerCase();
function pick(o:any,...keys:string[]){
  for(const k of keys){
    const v=o?.[k];
    if(v!==undefined&&v!==null&&String(v).trim()!=="")return v;
  }
  return "";
}

export async function GET(req:Request){
  try{
    const a=auth(req);
    if(!a)return Response.json({error:"Authentication required."},{status:401});

    const u=new URL(req.url),args:any[]=[],where:string[]=["COALESCE(ti.cancelled,false)=false"];
    const from=String(u.searchParams.get("from")||"").trim();
    const to=String(u.searchParams.get("to")||"").trim();
    const search=String(u.searchParams.get("search")||"").trim();

    if(from){args.push(from);where.push("ti.date >= $"+args.length+"::date");}
    if(to){args.push(to);where.push("ti.date <= $"+args.length+"::date");}
    if(a.scope==="dealer"){args.push(num(a.dealer_id));where.push("ti.dealer_id=$"+args.length);}
    if(search){
      args.push("%"+search+"%");
      const n=args.length;
      where.push("(COALESCE(ti.buyer_name,'') ILIKE $"+n+" OR COALESCE(ti.chassis_no,'') ILIKE $"+n+" OR COALESCE(ti.dealer_name,'') ILIKE $"+n+" OR COALESCE(d.name,'') ILIKE $"+n+" OR COALESCE(ti.bill_no,'') ILIKE $"+n+")");
    }

    const page=Math.max(1,num(u.searchParams.get("page"))||1);
    const per=Math.min(200,Math.max(1,num(u.searchParams.get("per_page"))||100));
    const start=(page-1)*per;
    const exportAll=u.searchParams.get("export")==="csv";

    // Prefer the real billing-sale -> dealer-cash-customer relationship.  The
    // old version matched customers by page/mobile/vehicle with a LATERAL
    // scan for every tax invoice, which becomes very slow as the invoice
    // table grows.  Keep a small fallback only for legacy invoices that were
    // not created from a showroom/branch customer register sale.
    const sql="SELECT ti.*,row_to_json(dc) AS dc_json,row_to_json(v) AS vehicle_json,row_to_json(d) AS dealer_json,row_to_json(lw) AS loan_json,row_to_json(c) AS customer_json,row_to_json(dcc) AS dcc_json "+
      "FROM tax_invoice ti "+
      "LEFT JOIN delivery_challan dc ON dc.id=ti.delivery_challan_id "+
      "LEFT JOIN vehicle v ON v.id=ti.vehicle_id "+
      "LEFT JOIN dealer d ON d.id=ti.dealer_id "+
      "LEFT JOIN grd_billing_sale gbs ON gbs.invoice_id=ti.id AND gbs.status='BILLED' "+
      "LEFT JOIN dealer_cash_customer dcc ON dcc.id=gbs.dealer_cash_customer_id "+
      "LEFT JOIN LATERAL (SELECT z.* FROM loan_workflow z LEFT JOIN customer zc ON zc.id=z.customer_id WHERE (CASE WHEN COALESCE(to_jsonb(ti)->>'customer_id','') ~ '^[0-9]+$' THEN z.customer_id=(to_jsonb(ti)->>'customer_id')::bigint ELSE lower(trim(COALESCE(zc.full_name,'')))=lower(trim(COALESCE(ti.buyer_name,''))) END) AND (ti.dealer_id IS NULL OR z.dealer_id=ti.dealer_id) ORDER BY z.id DESC LIMIT 1) lw ON true "+
      "LEFT JOIN LATERAL (SELECT * FROM customer z WHERE z.id=CASE WHEN COALESCE(to_jsonb(ti)->>'customer_id','') ~ '^[0-9]+$' THEN (to_jsonb(ti)->>'customer_id')::bigint ELSE NULL END LIMIT 1) c ON true "+
      "WHERE "+where.join(" AND ")+" ORDER BY ti.date DESC,ti.id DESC"+(exportAll?"":" LIMIT $"+(args.length+1)+" OFFSET $"+(args.length+2));
    if(!exportAll){args.push(per,start);}

    const rr=await pool.query(sql,args);

    // Dealer panel (Customer Register) invoice ko sale se, warna vehicle no., warna page no.+mobile se customer se jodta hai.
    // Admin ledger ab same fallback use karta hai, taaki dealer ke PCC/LL/DL/Makkhi kharche aur receipts yahan bhi dikhen.
    try{
      const need=rr.rows.filter((x:any)=>!num((x.dcc_json||{}).id));
      if(need.length){
        const dealerIds=Array.from(new Set(need.map((x:any)=>num(x.dealer_id)).filter(Boolean)));
        const regs=Array.from(new Set(need.map((x:any)=>normReg(x.vehicle_reg_no)).filter((r:string)=>r.length>=5&&r!=="NEW"&&r!=="OLD")));
        const pages=Array.from(new Set(need.map((x:any)=>String(x.dealer_page_no||"").trim()).filter(Boolean)));
        if(dealerIds.length&&(regs.length||pages.length)){
          const cr=await pool.query("SELECT * FROM dealer_cash_customer WHERE dealer_id=ANY($1::bigint[]) AND (regexp_replace(upper(COALESCE(vehicle_no,'')),'[^A-Z0-9]','','g')=ANY($2::text[]) OR btrim(COALESCE(page_no,''))=ANY($3::text[])) AND upper(COALESCE(status,'')) NOT IN ('DEALER_CANCEL','CANCELLED','CANCELED') ORDER BY id DESC",[dealerIds,regs,pages]);
          for(const x of need){
            const did=num(x.dealer_id),reg=normReg(x.vehicle_reg_no),pg=String(x.dealer_page_no||"").trim(),mob=normPhone(x.buyer_mobile);
            const hit=(reg.length>=5&&cr.rows.find((c:any)=>num(c.dealer_id)===did&&normReg(c.vehicle_no)===reg))
              ||(pg&&mob.length===10&&cr.rows.find((c:any)=>num(c.dealer_id)===did&&String(c.page_no||"").trim()===pg&&normPhone(c.phone)===mob));
            if(hit)x.dcc_json=hit;
          }
        }
      }
    }catch(e){console.error("[customer-expense-ledger dcc fallback]",e)}

    // Insurance Register / RTO Expense Register: chassis ya bill no. se invoice se match.
    const insMap=new Map<string,any[]>();
    const rtoMap=new Map<string,any[]>();
    try{
      const chs=Array.from(new Set(rr.rows.map((x:any)=>normCh(x.chassis_no)).filter(Boolean)));
      const bills=Array.from(new Set(rr.rows.map((x:any)=>normCh(x.bill_no)).filter(Boolean)));
      if(chs.length||bills.length){
        const ir=await pool.query("SELECT id,to_char(date,'YYYY-MM-DD') AS date,insurer,insurance_type,total_premium,net_premium,payable_amount,remarks,lower(btrim(COALESCE(chassis_no,''))) AS ck,lower(btrim(COALESCE(bill_no,''))) AS bk FROM insurance_register WHERE lower(btrim(COALESCE(chassis_no,'')))=ANY($1::text[]) OR lower(btrim(COALESCE(bill_no,'')))=ANY($2::text[]) ORDER BY date,id",[chs,bills]);
        for(const i of ir.rows){for(const k of new Set([i.ck&&"c:"+i.ck,i.bk&&"b:"+i.bk].filter(Boolean) as string[])){if(!insMap.has(k))insMap.set(k,[]);insMap.get(k)!.push(i);}}
        const tr=await pool.query("SELECT id,to_char(date,'YYYY-MM-DD') AS date,rto_agent,work_type,rto_type,amount,remarks,lower(btrim(COALESCE(chassis_no,''))) AS ck,lower(btrim(COALESCE(bill_no,''))) AS bk FROM rto_expense_register WHERE lower(btrim(COALESCE(chassis_no,'')))=ANY($1::text[]) OR lower(btrim(COALESCE(bill_no,'')))=ANY($2::text[]) ORDER BY date,id",[chs,bills]);
        for(const i of tr.rows){for(const k of new Set([i.ck&&"c:"+i.ck,i.bk&&"b:"+i.bk].filter(Boolean) as string[])){if(!rtoMap.has(k))rtoMap.set(k,[]);rtoMap.get(k)!.push(i);}}
      }
    }catch(e){console.error("[customer-expense-ledger insurance/rto register]",e)}
    const regRows=(m:Map<string,any[]>,chassis:any,bill:any)=>{
      const seen=new Set<number>(),out:any[]=[];
      for(const k of ["c:"+normCh(chassis),"b:"+normCh(bill)]){for(const r of m.get(k)||[]){if(!seen.has(r.id)){seen.add(r.id);out.push(r);}}}
      return out;
    };

    // Incentive: voucher se (naya single voucher + purane per-rickshaw voucher). Voucher na ho to tax_invoice ka incentive_amount hi dikhega.
    const incMap=new Map<string,any[]>();
    try{
      const chs=Array.from(new Set(rr.rows.map((x:any)=>String(x.chassis_no||"").trim().toLowerCase()).filter(Boolean)));
      if(chs.length){
        const ir=await pool.query(`SELECT lower(btrim(chassis_no)) AS ck,voucher_no,to_char(date,'YYYY-MM-DD') AS vdate,amount,status,payment_status,paid_at FROM (
            SELECT l.chassis_no,v.voucher_no,v.date,l.amount,v.status,v.payment_status,v.paid_at,v.id AS vid FROM expense_payment_voucher_line l JOIN expense_payment_voucher v ON v.id=l.voucher_id WHERE lower(COALESCE(v.expense_type,''))='incentive'
            UNION ALL
            SELECT v.chassis_no,v.voucher_no,v.date,v.amount,v.status,v.payment_status,v.paid_at,v.id AS vid FROM expense_payment_voucher v WHERE lower(COALESCE(v.expense_type,''))='incentive' AND v.vehicle_id IS NOT NULL
          ) z WHERE lower(btrim(chassis_no))=ANY($1::text[]) AND lower(COALESCE(status,'')) NOT IN ('rejected','cancelled','canceled') ORDER BY date,vid`,[chs]);
        for(const i of ir.rows){if(!incMap.has(i.ck))incMap.set(i.ck,[]);incMap.get(i.ck)!.push(i);}
      }
    }catch(e){console.error("[customer-expense-ledger incentive]",e);}
    const dealerExpenseMap=new Map<number,any[]>();
    const dealerReceiptMap=new Map<number,any[]>();
    try{
      const dccIds=Array.from(new Set(rr.rows.map((x:any)=>num((x.dcc_json||{}).id)).filter(Boolean)));
      if(dccIds.length){
        const er=await pool.query("SELECT customer_id,category,category_label,amount,paid_to,remarks,date,expense_no FROM dealer_cash_expense WHERE customer_id=ANY($1::bigint[]) AND upper(COALESCE(status,'')) NOT IN ('CANCELLED','CANCELED','DELETED','VOID') ORDER BY date,id",[dccIds]);
        const labels:any={pcc:'PCC',ll:'LL',dl:'DL',makki:'Makkhi / Commission',commission:'Makkhi / Commission'};
        for(const e of er.rows){
          const cat=String(e.category_label||labels[String(e.category||'').toLowerCase()]||e.category||'Other').trim();
          const arr=dealerExpenseMap.get(Number(e.customer_id))||[];
          arr.push({type:cat,amount:num(e.amount),category:cat,paid_to:e.paid_to||'',remarks:e.remarks||'',date:e.date||'',expense_no:e.expense_no||''});
          dealerExpenseMap.set(Number(e.customer_id),arr);
        }

        // Dealer ke Customer Register se banaye gaye receipts bhi isi customer ledger me dikhao.
        const rr2=await pool.query("SELECT customer_id,receipt_no,date,receipt_type,payment_mode,amount,reference_no,remarks,dealer_register_page_no FROM dealer_cash_receipt WHERE customer_id=ANY($1::bigint[]) ORDER BY date,id",[dccIds]);
        for(const r of rr2.rows){
          const arr=dealerReceiptMap.get(Number(r.customer_id))||[];
          arr.push({receipt_no:r.receipt_no||'',date:r.date||'',receipt_type:r.receipt_type||'',payment_mode:r.payment_mode||'',amount:num(r.amount),reference_no:r.reference_no||'',remarks:r.remarks||'',dealer_register_page_no:r.dealer_register_page_no||''});
          dealerReceiptMap.set(Number(r.customer_id),arr);
        }
      }
    }catch(e){console.error('[customer-expense-ledger dealer expenses/receipts]',e)}

    const rows=rr.rows.map((x:any)=>{
      const dc=x.dc_json||{},v=x.vehicle_json||{},d=x.dealer_json||{},lw=x.loan_json||{},cust=x.customer_json||{},dcc=x.dcc_json||{};
      // Dealer-entered Sale/Loan values are authoritative when the invoice still has 0/blank.
      const saleInvoice=njson(x,"sale_amount"),loanInvoice=njson(x,"hypothecation_amount");
      const saleCustomer=njson(dcc,"sale_amount"),loanCustomer=njson(dcc,"loan_amount");
      const sale=saleInvoice||saleCustomer,loan=loanInvoice||loanCustomer,received=njson(x,"amount_received")||njson(dcc,"paid_amount");
      const incRows=incMap.get(String(x.chassis_no||v.chassis_no||dc.chassis_no||"").trim().toLowerCase())||[];
      const incV=incRows.reduce((t:number,i:any)=>t+num(i.amount),0),incLast=incRows[incRows.length-1];
      const incStatus=!incLast?"":(incLast.paid_at||String(incLast.payment_status||"").toLowerCase()==="paid")?"Paid":String(incLast.status||"").toLowerCase()==="approved"?"Approved - Unpaid":"Pending Approval";
      const file=njson(x,"file_charge"),incentive=incRows.length?incV:njson(x,"incentive_amount"),registration=njson(x,"registration_amount");
      const insurance=njson(x,"insurance_amount"),commission=njson(x,"commission_amount")||njson(x,"commission");
      const chKey=x.chassis_no||v.chassis_no||dc.chassis_no||"";
      const rtoRegRows=regRows(rtoMap,chKey,x.bill_no),insRegRows=regRows(insMap,chKey,x.bill_no);
      const rtoReg=rtoRegRows.reduce((t:number,r:any)=>t+num(r.amount),0);
      const insReg=insRegRows.reduce((t:number,r:any)=>t+num(r.payable_amount),0);
      const rto=rtoReg||njson(x,"rto_fee")||njson(x,"rto_amount");
      // Insurance Fee = insurer ko jo payable hai; kharcha hone se hamesha minus (-) me dikhega.
      const insuranceFee=-Math.abs(insReg||njson(x,"insurance_fee"));
      const misc=njson(x,"misc_charge")||njson(x,"other_charge")||njson(x,"processing_fee"),subsidy=njson(x,"subsidy_amount");
      const details=jsonVal(x,"expense_details"),expenseDetails=Array.isArray(details)?details.slice():[];
      const dealerExpenseRows=dealerExpenseMap.get(num(dcc.id))||[];
      const dealerReceiptRows=dealerReceiptMap.get(num(dcc.id))||[];
      const mergedExpenseDetails=[...expenseDetails,...dealerExpenseRows];
      const dealerExpenseTotal=dealerExpenseRows.reduce((t:number,e:any)=>t+num(e.amount),0);
      const dealerReceiptTotal=dealerReceiptRows.reduce((t:number,e:any)=>t+num(e.amount),0);
      const expenseTotal=file+incentive+registration+insurance+commission+rto+insuranceFee+misc+dealerExpenseTotal;
      const vehicleNo=pick(x,"vehicle_reg_no")||pick(v,"vehicle_no","registration_no","vehicle_reg_no","reg_no");
      const applicationNo=pick(x,"application_no")||pick(lw,"application_no");
      const doNo=pick(x,"do_no")||pick(lw,"do_no");
      const ledgerNo=pick(x,"ledger_no")||pick(dc,"ledger_no")||pick(v,"ledger_no");
      const recordNo=pick(x,"record_no","chassis_record_no")||pick(dc,"record_no","chassis_record_no")||pick(x,"dealer_page_no","page_no")||pick(cust,"record_no","page_no");
      const photo=pick(x,"buyer_photo_url","customer_photo_url","photo_url")||pick(cust,"photo_url","photo","image_url");
      return {
        id:x.id,date:x.date,
        customer_name:x.buyer_name||dcc.name||cust.name||cust.full_name||"",
        customer_mobile:pick(x,"buyer_mobile","customer_phone")||pick(dcc,"phone","customer_phone")||pick(cust,"phone","mobile"),
        customer_address:pick(x,"buyer_address","customer_address")||pick(cust,"address","address1"),
        photo_url:photo,
        dealer_name:x.dealer_name||d.name||"",
        dealer_code:d.code||"",
        model:x.product_name||x.model_name||v.model_name||"",
        chassis_no:x.chassis_no||v.chassis_no||dc.chassis_no||"",
        motor_no:x.motor_no||v.motor_no||"",
        colour:x.colour||v.colour||"",
        vehicle_no:vehicleNo,
        salesman:x.salesman||dc.salesman||"",
        financer:x.financer_name||pick(lw,"financer_name","financer"),
        application_no:applicationNo,do_no:doNo,ledger_no:ledgerNo,record_no:recordNo,
        page_no:pick(x,"dealer_page_no","page_no")||pick(dcc,"page_no")||pick(cust,"page_no"),
        chassis_record_no:x.chassis_record_no||dc.chassis_record_no||"",
        voucher_no:x.voucher_no||dc.voucher_no||"",
        bill_no:x.bill_no||"",
        challan_no:dc.challan_no||x.challan_no||"",
        sale_value:sale,loan_value:loan,amount_received:received,balance:sale-loan-received,
        file_charge:file,incentive_amount:incentive,incentive_voucher_no:incRows.map((i:any)=>i.voucher_no).filter(Boolean).join(", "),incentive_voucher_date:incLast?.vdate||"",incentive_status:incStatus,
        incentive_vouchers:incRows.map((i:any)=>({voucher_no:i.voucher_no,date:i.vdate,amount:num(i.amount),paid:Boolean(i.paid_at)||String(i.payment_status||"").toLowerCase()==="paid"})),registration_amount:registration,insurance_amount:insurance,
        commission_amount:commission,rto_fee:rto,insurance_fee:insuranceFee,misc_charge:misc,subsidy_amount:subsidy,
        expense_total:expenseTotal,expense_details:mergedExpenseDetails,dealer_expenses:dealerExpenseRows,
        rto_expenses:rtoRegRows.map((r:any)=>({date:r.date,agent:r.rto_agent||"",work_type:r.work_type||"",rto_type:r.rto_type||"",amount:num(r.amount),remarks:r.remarks||""})),
        insurance_expenses:insRegRows.map((r:any)=>({date:r.date,insurer:r.insurer||"",insurance_type:r.insurance_type||"",total_premium:num(r.total_premium),amount:-Math.abs(num(r.payable_amount)),remarks:r.remarks||""})),
        dealer_receipts:dealerReceiptRows,dealer_receipt_total:dealerReceiptTotal
      };
    });

    if(exportAll)return csvResponse(rows,"Customer_Expense_Ledger.csv");
    return Response.json({rows,page,per_page:per,total:rows.length,total_pages:Math.max(1,Math.ceil(rows.length/per)),has_more:rows.length===per});
  }catch(e:any){
    console.error("[customer-expense-ledger]",e);
    return Response.json({error:e.message||"Customer ledger report failed."},{status:500});
  }
}
