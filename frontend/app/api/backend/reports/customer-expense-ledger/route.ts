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

    const sql="SELECT ti.*,row_to_json(dc) AS dc_json,row_to_json(v) AS vehicle_json,row_to_json(d) AS dealer_json,row_to_json(lw) AS loan_json,row_to_json(c) AS customer_json "+
      "FROM tax_invoice ti "+
      "LEFT JOIN delivery_challan dc ON dc.id=ti.delivery_challan_id "+
      "LEFT JOIN vehicle v ON v.id=ti.vehicle_id "+
      "LEFT JOIN dealer d ON d.id=ti.dealer_id "+
      "LEFT JOIN LATERAL (SELECT * FROM loan_workflow z WHERE lower(trim(COALESCE(z.customer_name,'')))=lower(trim(COALESCE(ti.buyer_name,''))) AND (ti.dealer_id IS NULL OR z.dealer_id=ti.dealer_id) ORDER BY z.id DESC LIMIT 1) lw ON true "+
      "LEFT JOIN LATERAL (SELECT * FROM customer z WHERE z.id=CASE WHEN COALESCE(to_jsonb(ti)->>'customer_id','') ~ '^[0-9]+$' THEN (to_jsonb(ti)->>'customer_id')::bigint ELSE NULL END LIMIT 1) c ON true "+
      "WHERE "+where.join(" AND ")+" ORDER BY ti.date DESC,ti.id DESC";

    const rr=await pool.query(sql,args);
    const rows=rr.rows.map((x:any)=>{
      const dc=x.dc_json||{},v=x.vehicle_json||{},d=x.dealer_json||{},lw=x.loan_json||{},cust=x.customer_json||{};
      const sale=njson(x,"sale_amount"),loan=njson(x,"hypothecation_amount"),received=njson(x,"amount_received");
      const file=njson(x,"file_charge"),incentive=njson(x,"incentive_amount"),registration=njson(x,"registration_amount");
      const insurance=njson(x,"insurance_amount"),commission=njson(x,"commission_amount")||njson(x,"commission");
      const rto=njson(x,"rto_fee")||njson(x,"rto_amount"),insuranceFee=njson(x,"insurance_fee");
      const misc=njson(x,"misc_charge")||njson(x,"other_charge")||njson(x,"processing_fee"),subsidy=njson(x,"subsidy_amount");
      const details=jsonVal(x,"expense_details"),expenseDetails=Array.isArray(details)?details:[];
      const expenseTotal=file+incentive+registration+insurance+commission+rto+insuranceFee+misc;
      const vehicleNo=pick(x,"vehicle_reg_no")||pick(v,"vehicle_no","registration_no","vehicle_reg_no","reg_no");
      const applicationNo=pick(x,"application_no")||pick(lw,"application_no");
      const doNo=pick(x,"do_no")||pick(lw,"do_no");
      const ledgerNo=pick(x,"ledger_no")||pick(dc,"ledger_no")||pick(v,"ledger_no");
      const recordNo=pick(x,"record_no","chassis_record_no")||pick(dc,"record_no","chassis_record_no")||pick(x,"dealer_page_no","page_no")||pick(cust,"record_no","page_no");
      const photo=pick(x,"buyer_photo_url","customer_photo_url","photo_url")||pick(cust,"photo_url","photo","image_url");
      return {
        id:x.id,date:x.date,
        customer_name:x.buyer_name||cust.name||cust.full_name||"",
        customer_mobile:pick(x,"buyer_mobile","customer_phone")||pick(cust,"phone","mobile"),
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
        page_no:pick(x,"dealer_page_no","page_no")||pick(cust,"page_no"),
        chassis_record_no:x.chassis_record_no||dc.chassis_record_no||"",
        voucher_no:x.voucher_no||dc.voucher_no||"",
        bill_no:x.bill_no||"",
        challan_no:dc.challan_no||x.challan_no||"",
        sale_value:sale,loan_value:loan,amount_received:received,balance:sale-loan-received,
        file_charge:file,incentive_amount:incentive,registration_amount:registration,insurance_amount:insurance,
        commission_amount:commission,rto_fee:rto,insurance_fee:insuranceFee,misc_charge:misc,subsidy_amount:subsidy,
        expense_total:expenseTotal,expense_details:expenseDetails
      };
    });

    const page=Math.max(1,num(u.searchParams.get("page"))||1);
    const per=Math.min(200,Math.max(1,num(u.searchParams.get("per_page"))||100));
    const start=(page-1)*per;
    if(u.searchParams.get("export")==="csv")return csvResponse(rows,"Customer_Expense_Ledger.csv");
    return Response.json({rows:rows.slice(start,start+per),page,per_page:per,total:rows.length,total_pages:Math.max(1,Math.ceil(rows.length/per))});
  }catch(e:any){
    console.error("[customer-expense-ledger]",e);
    return Response.json({error:e.message||"Customer ledger report failed."},{status:500});
  }
}
