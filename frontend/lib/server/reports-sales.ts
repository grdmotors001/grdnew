// Sale Register + Payment Receivable reports (bade route file se nikale gaye, query/logic same hai).
import { pool, num, csvResponse, dateWhere } from "./common";

// Tax Invoice ke hand-filled Record columns (Accounts > Record tab).
let tiRecordReady:Promise<void>|null=null;
export function ensureTaxInvoiceRecordColumns():Promise<void>{
  // Accounts > Record tab: four hand-filled reference fields kept on the Tax Invoice row.
  if(!tiRecordReady)tiRecordReady=pool.query("ALTER TABLE tax_invoice ADD COLUMN IF NOT EXISTS vehicle_reg_no text,ADD COLUMN IF NOT EXISTS chassis_record_no text,ADD COLUMN IF NOT EXISTS ledger_no text,ADD COLUMN IF NOT EXISTS voucher_no text,ADD COLUMN IF NOT EXISTS buyer_pincode text").then(()=>{}).catch(e=>{tiRecordReady=null;throw e});
  return tiRecordReady;
}

// Sale Register / GST / Hypothecation / Subsidy ki common tax_invoice rows (date + search filter, cancelled hata ke).
export async function taxInvoiceReportRows(u:URL):Promise<any[]>{
  const args:any[]=[]; const {w,search}=dateWhere("ti",u,args);
  if(search){args.push("%"+search+"%");w.push("(COALESCE(ti.bill_no,'') ILIKE $"+args.length+" OR COALESCE(ti.buyer_name,'') ILIKE $"+args.length+" OR COALESCE(ti.chassis_no,'') ILIKE $"+args.length+")");}
  w.push("COALESCE(ti.cancelled,false)=false");
  const where=w.length?" WHERE "+w.join(" AND "):"";
  // GST split/total fields are computed properties in the legacy model,
  // not persisted columns in tax_invoice. Compute them from state_type,
  // gst_rate and the stored taxable components directly in SQL.
  const base=`SELECT ti.id,ti.date,ti.bill_no,ti.buyer_name,ti.product_name,ti.chassis_no,ti.financer_name,ti.dealer_name,ti.amount_received,ti.sale_amount,ti.hypothecation_amount,ti.subsidy_amount,
    GREATEST(COALESCE(ti.gst_sale_amount,ti.sale_amount,0)-COALESCE(ti.discount,0),0) AS taxable_value,
    CASE WHEN COALESCE(NULLIF(UPPER(TRIM(ti.state_type)),''),'I')='I'
      THEN GREATEST(COALESCE(ti.gst_sale_amount,ti.sale_amount,0)-COALESCE(ti.discount,0),0)*COALESCE(ti.gst_rate,0)/200
      ELSE 0 END AS cgst_amount,
    CASE WHEN COALESCE(NULLIF(UPPER(TRIM(ti.state_type)),''),'I')='I'
      THEN GREATEST(COALESCE(ti.gst_sale_amount,ti.sale_amount,0)-COALESCE(ti.discount,0),0)*COALESCE(ti.gst_rate,0)/200
      ELSE 0 END AS sgst_amount,
    CASE WHEN COALESCE(NULLIF(UPPER(TRIM(ti.state_type)),''),'I')='I'
      THEN 0
      ELSE GREATEST(COALESCE(ti.gst_sale_amount,ti.sale_amount,0)-COALESCE(ti.discount,0),0)*COALESCE(ti.gst_rate,0)/100
    END AS igst_amount,
    GREATEST(COALESCE(ti.gst_sale_amount,ti.sale_amount,0)-COALESCE(ti.discount,0),0)
      + GREATEST(COALESCE(ti.gst_sale_amount,ti.sale_amount,0)-COALESCE(ti.discount,0),0)*COALESCE(ti.gst_rate,0)/100
      + COALESCE(ti.insurance_amount,0) + COALESCE(ti.registration_amount,0) AS bill_total
    FROM tax_invoice ti`;
  const r=await pool.query(base+where+" ORDER BY ti.date DESC,ti.id DESC",args);
  const rows=r.rows.map((x:any)=>({...x,tax_amount:num(x.cgst_amount)+num(x.sgst_amount)+num(x.igst_amount)}));
  return rows;
}

export async function saleRegisterReport(req:Request):Promise<Response>{
  const u=new URL(req.url);
  const rows=await taxInvoiceReportRows(u);
  if(u.searchParams.get("export")==="csv")return csvResponse(rows,"Sale_Register.csv");
  const page=Math.max(1,num(u.searchParams.get("page"))||1),per=Math.min(200,Math.max(1,num(u.searchParams.get("per_page"))||50)),start=(page-1)*per;
  const pageRows=rows.slice(start,start+per),totals=rows.reduce((a:any,x:any)=>(a.taxable+=num(x.taxable_value),a.tax+=num(x.tax_amount),a.total+=num(x.bill_total),a),{taxable:0,tax:0,total:0});
  return Response.json({invoices:pageRows,rows:pageRows,page,per_page:per,total:rows.length,total_pages:Math.max(1,Math.ceil(rows.length/per)),totals});
}

export async function paymentReceivableReport(req:Request):Promise<Response>{
  const u=new URL(req.url);
  const from=u.searchParams.get("from"),to=u.searchParams.get("to"),search=String(u.searchParams.get("search")||"").trim();
  const showAll=String(u.searchParams.get("show_all")||"1")!=="0";
  const args:any[]=[]; const w:string[]=["COALESCE(ti.cancelled,false)=false"];
  if(from){args.push(from);w.push("ti.date >= $"+args.length+"::date")}
  if(to){args.push(to);w.push("ti.date <= $"+args.length+"::date")}
  if(search){args.push("%"+search+"%");w.push("(COALESCE(ti.bill_no,'') ILIKE $"+args.length+" OR COALESCE(ti.buyer_name,'') ILIKE $"+args.length+" OR COALESCE(ti.chassis_no,'') ILIKE $"+args.length+" OR COALESCE(ti.dealer_name,'') ILIKE $"+args.length+")")}
  await ensureTaxInvoiceRecordColumns();
  // Salesman is not stored on tax_invoice itself: take it from the delivery challan, else from the dealer master.
  const rr=await pool.query("SELECT ti.*,COALESCE(NULLIF(to_jsonb(ti)->>'salesman',''),NULLIF(to_jsonb(dc)->>'salesman',''),NULLIF(to_jsonb(d)->>'salesman','')) AS sale_salesman FROM tax_invoice ti LEFT JOIN delivery_challan dc ON dc.id=ti.delivery_challan_id LEFT JOIN dealer d ON d.id=ti.dealer_id WHERE "+w.join(" AND ")+" ORDER BY ti.date DESC,ti.id DESC",args);
  let rows=rr.rows.map((x:any)=>{
    const value=num(x.sale_amount);
    const loan=num(x.hypothecation_amount);
    const received=num(x.amount_received);
    const balance=value-loan-received;
    return {...x,dealer_name:x.dealer_name||"",bill_no:x.bill_no||"",model:x.product_name||x.model_name||"",chassis_no:x.chassis_no||"",
      customer:x.buyer_name||"",mobile_no:x.buyer_mobile||x.customer_phone||"",value_amt:value,loan_amt:loan,amt_recd:received,balance,
      financer:x.financer_name||"",rto:x.rto||x.rto_name||"",vehicle_no:x.vehicle_reg_no||"",salesman:x.sale_salesman||"",chassis_record:x.chassis_record_no||"",ledger:x.ledger_no||"",voucher_no:x.voucher_no||"",other:x.remarks||"",
      incentive_amount:num(x.incentive_amount),incentive_voucher_no:x.incentive_voucher_no||"",incentive_date:x.incentive_date||null,
      expense_total:num(x.expense_total),expense_details:Array.isArray(x.expense_details)?x.expense_details:[]};
  });
  if(!showAll)rows=rows.filter((x:any)=>x.balance>0);
  const page=Math.max(1,num(u.searchParams.get("page"))||1),per=Math.min(200,Math.max(1,num(u.searchParams.get("per_page"))||50)),start=(page-1)*per;
  const totals=rows.reduce((a:any,x:any)=>(a.value+=x.value_amt,a.loan+=x.loan_amt,a.received+=x.amt_recd,a.balance+=x.balance,a),{value:0,loan:0,received:0,balance:0});
  if(u.searchParams.get("export")==="csv"){
    // Export = exactly the screen's columns (one Ledger column), not a dump of every raw tax_invoice column.
    const d10=(v:any)=>v?String(v instanceof Date?v.toISOString():v).slice(0,10):"";
    return csvResponse(rows.map((x:any,i:number)=>({"Sr.No.":i+1,"Date":d10(x.date),"Dealer Name":x.dealer_name,"Bill No.":x.bill_no,"Model":x.model,"Chassis No.":x.chassis_no,"Other":x.other,"Customer":x.customer,"Mobile No.":x.mobile_no,"Value Amt.":x.value_amt,"Loan Amt.":x.loan_amt,"Amt.Recd.":x.amt_recd,"Balance":x.balance,"Financer":x.financer,"RTO":x.rto,"Chassis Record":x.chassis_record,"Ledger":x.ledger,"Voucher No.":x.voucher_no,"Cheque No.":x.cheque_no||"","Vehicle No.":x.vehicle_no,"Salesman":x.salesman,"Incentive Amount":x.incentive_amount,"Incentive Voucher":x.incentive_voucher_no,"Incentive Date":d10(x.incentive_date),"All Expenses":x.expense_total})),"Payment_Receivable_Report.csv");
  }
  return Response.json({rows:rows.slice(start,start+per),page,per_page:per,total:rows.length,total_pages:Math.max(1,Math.ceil(rows.length/per)),totals});
}
