import jwt from "jsonwebtoken";
import { Pool } from "pg";
export const dynamic="force-dynamic";
export const runtime="nodejs";
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,ssl:{rejectUnauthorized:false}});
const secret=process.env.JWT_SECRET||"grd-node-change-this-secret";

function auth(req:Request){
  const h=req.headers.get("authorization")||"";
  const t=h.startsWith("Bearer ")?h.slice(7):"";
  if(!t)return null;
  try{return jwt.verify(t,secret) as any}catch{return null}
}
const json=async(req:Request)=>await req.json().catch(()=>({}));
const num=(v:any)=>Number.isFinite(Number(v))?Number(v):0;
const snake=(s:string)=>s.replace(/[A-Z]/g,m=>"_"+m.toLowerCase()).replace(/^_/,"");
const idOf=(v:any)=>{const n=Number(v);return Number.isInteger(n)&&n>0?n:null};
function csvCell(v:any){const s=String(v??"");return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}
function csvResponse(rows:any[],filename:string){
  if(!rows.length)return new Response("",{status:200,headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":"attachment; filename="+filename}});
  const keys=Object.keys(rows[0]); const body=[keys.map(csvCell).join(","),...rows.map(r=>keys.map(k=>csvCell(r[k])).join(","))].join("\n");
  return new Response(body,{status:200,headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":"attachment; filename="+filename}});
}
function dateWhere(alias:string,u:URL,args:any[]){
  const w:string[]=[];
  const from=u.searchParams.get("from"),to=u.searchParams.get("to"),search=u.searchParams.get("search");
  if(from){args.push(from);w.push(alias+".date >= $"+args.length+"::date");}
  if(to){args.push(to);w.push(alias+".date <= $"+args.length+"::date");}
  return {w,search};
}

const TABLES:any={
  "company":"company","dealers":"dealer","dealer-list":"dealer","users":"user","salesmen":"user",
  "products":"product","tax-invoices":"tax_invoice","purchase-bills":"purchase_bill",
  "delivery-challans":"delivery_challan","credit-notes":"credit_note","debit-notes":"debit_note",
  "production-vouchers":"production_voucher","production-formulas":"production_formula",
  "repair-service-vouchers":"repair_service_voucher","repair-service-receipts":"repair_service_payment_receipt",
  "expense-payment-voucher":"expense_payment_voucher","day-book":"day_book","journal-stock":"journal_stock",
  "old-rickshaws":"old_rickshaw","old-rickshaw-challans":"old_rickshaw_challan",
  "battery-swap-vouchers":"battery_swap_voucher","battery-delivery-challans":"battery_delivery_challan",
  "battery-addition":"battery_stock_movement","battery-withdrawal":"battery_stock_movement",
  "vehicle-inventory":"vehicle","vehicles":"vehicle","dealer/customers":"customer",
  "loan-application-view":"loan_workflow","loan-workflow":"loan_workflow","dealer/loan-status":"loan_workflow",
  "dealer/pending-sales":"loan_workflow","billing/pending-chfpl":"chfpl_billing_queue",
  "billing/manual-pending-bills":"manual_pending_bill","billing/pending-sales":"loan_workflow",
  "billing/vehicle-inventory":"vehicle","billing/old-rickshaw-challans":"old_rickshaw_challan",
  "reports/cash-at-dealer":"day_book","reports/delivery-challan-register":"delivery_challan","reports/gst-register":"tax_invoice",
  "reports/hypothecation-register":"tax_invoice","reports/ledger":"day_book","reports/ledger-v":"day_book",
  "reports/payment-receivable":"day_book","reports/production-register":"production_voucher","reports/purchase-register":"purchase_bill",
  "reports/sale-register":"tax_invoice","reports/subsidy":"tax_invoice","stock/ledger-dealers":"journal_stock",
  "stock/ledger-premises":"journal_stock","stock/ledger-raw":"journal_stock","stock/closing-dealers":"journal_stock",
  "stock/closing-premises":"journal_stock","stock/closing-raw":"journal_stock",
  "dealer/battery-stock":"battery_stock_movement","dealer/stock":"vehicle","dealer/purchases":"purchase_bill",
  "dealer/tax-invoices":"tax_invoice","dealer/delivery-challans":"delivery_challan",
  "dealer/old-rickshaw-challans":"old_rickshaw_challan","dealer/payments":"dealer_payment",
  "expense-payment-voucher/booking-pending":"expense_payment_voucher","expense-payment-voucher/incentive-pending":"expense_payment_voucher",
  "expense-payment-voucher/party-pending":"expense_payment_voucher","expense-payment-voucher/work-pending":"expense_payment_voucher"
};
function tableFor(path:string[]){
  const full=path.join("/");
  if(path[0]==="masters")return "simple_master";
  return TABLES[full]||TABLES[path[0]]||null;
}
async function columns(table:string){
  const r=await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1",[table]);
  return new Set(r.rows.map((x:any)=>x.column_name));
}
async function genericGet(req:Request,path:string[],table:string){
  const cols=await columns(table);
  if(!cols.size)return Response.json({error:"Table not found",table},{status:404});
  const id=idOf(path[path.length-1]);
  let sql='SELECT * FROM "'+table+'"',args:any[]=[];
  if(id&&/^\d+$/.test(path[path.length-1]||"")){sql+=" WHERE id=$1";args=[id]}
  else{
    const u=new URL(req.url),where:string[]=[];
    for(const [k,v] of u.searchParams.entries()){
      const c=snake(k);
      if(cols.has(c)&&c!=="id"){args.push(v);where.push('"'+c+'"=$'+args.length)}
    }
    if(where.length)sql+=" WHERE "+where.join(" AND ");
  }
  sql+=" ORDER BY id DESC LIMIT 1000";
  const r=await pool.query(sql,args);
  if(path[0]==="masters") return Response.json(r.rows);
  if(path[0]==="purchase-bills") return Response.json(r.rows);
  return Response.json({rows:r.rows,data:r.rows,items:r.rows,count:r.rowCount,
    ...(table==="dealer"?{dealers:r.rows}:{}),
    ...(table==="customer"?{customers:r.rows}:{}),
    ...(table==="loan_workflow"?{applications:r.rows}:{}),
    ...(table==="product"?{products:r.rows}:{}),
    ...(table==="tax_invoice"?{invoices:r.rows}:{}),
    ...(table==="credit_note"?{credit_notes:r.rows}:{}),
    ...(table==="debit_note"?{debit_notes:r.rows}:{}),
    ...(table==="old_rickshaw"?{rickshaws:r.rows}:{}),
    ...(table==="user"?{users:r.rows}:{}),
    ...(table==="simple_master"?{masters:r.rows}:{})
  });
}
function isAdmin(a:any){
  return a?.scope==="staff" && (Boolean(a?.is_super_user) || String(a?.department||"").trim().toLowerCase()==="admin");
}
function canRead(a:any,p:string){
  // Dealers may only read their explicitly scoped portal endpoints.
  if(a?.scope==="dealer") return p.startsWith("dealer/") || p==="auth/me";
  return true;
}
// Dealer battery portal writes are explicitly gated by the module flags
// carried in the dealer JWT. This restores the legacy portal behaviour without
// opening generic staff/master CRUD to dealer tokens.
const DEALER_WRITE_MODULE:any={
  "battery-swap-vouchers":"battery-swap",
  "battery-withdrawal":"battery-withdrawal",
  "battery-addition":"battery-addition"
};
function canWrite(a:any,p:string){
  // Dealer tokens are never allowed to use generic CRUD against staff/master tables.
  if(a?.scope==="dealer"){
    if(p==="dealer/submit-loan")return true;
    if(p==="dealer/cash-book" || p.startsWith("dealer/cash-book/"))return true;
    const need=DEALER_WRITE_MODULE[p];
    if(!need)return false;
    const mods=Array.isArray(a?.portal_modules)
      ? a.portal_modules.map((x:any)=>String(x))
      : String(a?.portal_modules||"").split(",").map((x:string)=>x.trim()).filter(Boolean);
    return mods.includes(need);
  }
  // Admins retain full mutation access.
  if(isAdmin(a)) return true;
  // Non-admin staff can mutate only modules explicitly granted in allowed_modules.
  const mods=Array.isArray(a?.allowed_modules)?a.allowed_modules.map((x:any)=>String(x)):String(a?.allowed_modules||"").split(",").map((x:string)=>x.trim()).filter(Boolean);
  const key=p.startsWith("masters/") ? p : p.split("/")[0];
  return mods.includes(p) || mods.includes(key);
}
async function genericWrite(req:Request,path:string[],table:string,method:string){
  const cols=await columns(table);
  if(!cols.size)return Response.json({error:"Table not found",table},{status:404});
  const body:any=await json(req),input:any={};
  for(const [k,v] of Object.entries(body||{})){
    const c=snake(k);if(cols.has(c)&&c!=="id")input[c]=v;
  }
  const id=idOf(path[path.length-1]);
  if(method==="POST"){
    const keys=Object.keys(input);
    if(!keys.length)return Response.json({error:"No valid fields supplied."},{status:400});
    const vals=keys.map((_,i)=>"$"+(i+1));
    const sql='INSERT INTO "'+table+'" ('+keys.map(k=>'"'+k+'"').join(",")+') VALUES ('+vals.join(",")+') RETURNING *';
    const r=await pool.query(sql,keys.map(k=>input[k]));
    return Response.json({success:true,row:r.rows[0],data:r.rows[0]},{status:201});
  }
  if(!id)return Response.json({error:"Record id required."},{status:400});
  if(method==="DELETE"){
    const r=await pool.query('DELETE FROM "'+table+'" WHERE id=$1 RETURNING *',[id]);
    return Response.json({success:r.rowCount>0,row:r.rows[0]||null});
  }
  const keys=Object.keys(input);
  if(!keys.length)return Response.json({error:"No valid fields supplied."},{status:400});
  const sets=keys.map((k,i)=>'"'+k+'"=$'+(i+1));
  const r=await pool.query('UPDATE "'+table+'" SET '+sets.join(",")+' WHERE id=$'+(keys.length+1)+' RETURNING *',[...keys.map(k=>input[k]),id]);
  return Response.json({success:r.rowCount>0,row:r.rows[0]||null,data:r.rows[0]||null});
}

export async function GET(req:Request,{params}:{params:Promise<{path?:string[]}>}){
  try{
    const {path=[]}=await params,p=path.join("/");
    if(p==="health")return Response.json({status:"ok",backend:"node",python:false});
    const a=auth(req);if(!a)return Response.json({error:"Authentication required."},{status:401});
    if(!canRead(a,p))return Response.json({error:"Forbidden."},{status:403});
    if(p==="menu"){const r=await pool.query("SELECT * FROM nav_tab ORDER BY id");return Response.json({menu:r.rows,tabs:r.rows});}
    if(p==="reports/sale-register"||p==="reports/gst-register"||p==="reports/hypothecation-register"||p==="reports/subsidy"){
      const u=new URL(req.url),args:any[]=[]; const {w,search}=dateWhere("ti",u,args);
      if(search){args.push("%"+search+"%");w.push("(COALESCE(ti.bill_no,'') ILIKE $"+args.length+" OR COALESCE(ti.buyer_name,'') ILIKE $"+args.length+" OR COALESCE(ti.chassis_no,'') ILIKE $"+args.length+")");}
      w.push("COALESCE(ti.cancelled,false)=false");
      const where=w.length?" WHERE "+w.join(" AND "):"";
      // GST split/total fields are computed properties in the legacy model,
      // not persisted columns in tax_invoice. Compute them from state_type,
      // gst_rate and the stored taxable components directly in SQL.
      const base=`SELECT ti.id,ti.date,ti.bill_no,ti.buyer_name,ti.product_name,ti.chassis_no,ti.financer_name,ti.hypothecation_amount,ti.subsidy_amount,
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
      if(u.searchParams.get("export")==="csv")return csvResponse(rows,p==="reports/gst-register"?"GST_Register.csv":p==="reports/sale-register"?"Sale_Register.csv":p==="reports/hypothecation-register"?"Hypothecation_Register.csv":"Subsidy_Report.csv");
      if(p==="reports/gst-register"){
        const inward=await pool.query("SELECT pb.id,pb.date,pb.bill_no AS doc_no,pb.party_name,0::numeric AS taxable,0::numeric AS cgst,0::numeric AS sgst,0::numeric AS igst FROM purchase_bill pb ORDER BY pb.date DESC,pb.id DESC");
        const ot=rows.reduce((a:any,x:any)=>(a.taxable+=num(x.taxable_value),a.cgst+=num(x.cgst_amount),a.sgst+=num(x.sgst_amount),a.igst+=num(x.igst_amount),a),{taxable:0,cgst:0,sgst:0,igst:0});
        const it=inward.rows.reduce((a:any,x:any)=>(a.taxable+=num(x.taxable),a.cgst+=num(x.cgst),a.sgst+=num(x.sgst),a.igst+=num(x.igst),a),{taxable:0,cgst:0,sgst:0,igst:0});
        return Response.json({outward:rows,outward_totals:ot,inward:inward.rows,inward_totals:it});
      }
      if(p==="reports/hypothecation-register")return Response.json({invoices:rows.filter((x:any)=>num(x.hypothecation_amount)!==0),total_hyp:rows.reduce((s:number,x:any)=>s+num(x.hypothecation_amount),0)});
      if(p==="reports/subsidy")return Response.json({invoices:rows.filter((x:any)=>num(x.subsidy_amount)!==0),total_subsidy:rows.reduce((s:number,x:any)=>s+num(x.subsidy_amount),0)});
      const page=Math.max(1,num(u.searchParams.get("page"))||1),per=Math.min(200,Math.max(1,num(u.searchParams.get("per_page"))||50)),start=(page-1)*per;
      const pageRows=rows.slice(start,start+per),totals=rows.reduce((a:any,x:any)=>(a.taxable+=num(x.taxable_value),a.tax+=num(x.tax_amount),a.total+=num(x.bill_total),a),{taxable:0,tax:0,total:0});
      return Response.json({invoices:pageRows,rows:pageRows,page,per_page:per,total:rows.length,total_pages:Math.max(1,Math.ceil(rows.length/per)),totals});
    }
    if(p==="reports/production-register"){
      const u=new URL(req.url),args:any[]=[]; const {w,search}=dateWhere("v",u,args);
      const status=u.searchParams.get("status")||"all";
      if(search){args.push("%"+search+"%");w.push("(COALESCE(v.vou_no,'') ILIKE $"+args.length+" OR COALESCE(v.chassis_no,'') ILIKE $"+args.length+" OR COALESCE(v.product_name,'') ILIKE $"+args.length+")");}
      if(status==="factory")w.push("COALESCE(vh.stage,'Manufacturing')='Manufacturing'");
      if(status==="delivered")w.push("COALESCE(vh.stage,'Manufacturing')<>'Manufacturing'");
      const where=w.length?" WHERE "+w.join(" AND "):"";
      const r=await pool.query("SELECT v.*,COALESCE(vh.stage,'Manufacturing') AS stage FROM production_voucher v LEFT JOIN vehicle vh ON vh.chassis_no=v.chassis_no"+where+" ORDER BY v.date DESC,v.id DESC",args);
      if(u.searchParams.get("export")==="csv")return csvResponse(r.rows,"Production_Register.csv");
      const page=Math.max(1,num(u.searchParams.get("page"))||1),per=Math.min(200,Math.max(1,num(u.searchParams.get("per_page"))||50)),start=(page-1)*per;
      return Response.json({rows:r.rows.slice(start,start+per),page,per_page:per,total:r.rowCount,total_pages:Math.max(1,Math.ceil(r.rowCount/per))});
    }
    if(p==="reports/purchase-register"){
      const u=new URL(req.url),args:any[]=[]; const {w,search}=dateWhere("pb",u,args);
      if(search){args.push("%"+search+"%");w.push("(COALESCE(pb.bill_no,'') ILIKE $"+args.length+" OR COALESCE(pb.party_name,'') ILIKE $"+args.length+")");}
      const where=w.length?" WHERE "+w.join(" AND "):"";
      const r=await pool.query("SELECT pb.*,0::numeric AS taxable_amt,0::numeric AS cgst_amt,0::numeric AS sgst_amt,0::numeric AS igst_amt,0::numeric AS total_amt,0::int AS item_count FROM purchase_bill pb"+where+" ORDER BY pb.date DESC,pb.id DESC",args);
      if(u.searchParams.get("export")==="csv")return csvResponse(r.rows,"Purchase_Register.csv");
      const page=Math.max(1,num(u.searchParams.get("page"))||1),per=Math.min(200,Math.max(1,num(u.searchParams.get("per_page"))||50)),start=(page-1)*per;
      const pageRows=r.rows.slice(start,start+per),totals=pageRows.reduce((a:any,x:any)=>(a.taxable+=num(x.taxable_amt),a.cgst+=num(x.cgst_amt),a.sgst+=num(x.sgst_amt),a.igst+=num(x.igst_amt),a),{taxable:0,cgst:0,sgst:0,igst:0});
      return Response.json({rows:pageRows,page,per_page:per,total:r.rowCount,total_pages:Math.max(1,Math.ceil(r.rowCount/per)),totals});
    }
    if(p==="dashboard"){
      const [counts,monthly,billed,recent]=await Promise.all([
        pool.query("SELECT COALESCE(stage,'Unknown') AS stage,COUNT(*)::int AS count FROM vehicle GROUP BY stage"),
        pool.query("SELECT TO_CHAR(date,'YYYY-MM') AS month,COUNT(*) FILTER (WHERE stage='Manufacturing')::int AS manufacturing,COUNT(*) FILTER (WHERE stage='Delivery Challan')::int AS delivery_challan,COUNT(*) FILTER (WHERE stage='Tax Invoice')::int AS tax_invoice FROM vehicle WHERE date >= (CURRENT_DATE - INTERVAL '11 months') GROUP BY 1 ORDER BY 1"),
        pool.query("SELECT TO_CHAR(date,'YYYY-MM') AS month,COUNT(*) FILTER (WHERE COALESCE(NULLIF(UPPER(TRIM(state_type)),''),'I')<>'I')::int AS interstateCount,COALESCE(SUM(CASE WHEN COALESCE(NULLIF(UPPER(TRIM(state_type)),''),'I')<>'I' THEN GREATEST(COALESCE(gst_sale_amount,sale_amount,0)-COALESCE(discount,0),0) ELSE 0 END),0)::numeric AS interstateTaxable,COUNT(*) FILTER (WHERE COALESCE(NULLIF(UPPER(TRIM(state_type)),''),'I')='I')::int AS localCount,COALESCE(SUM(CASE WHEN COALESCE(NULLIF(UPPER(TRIM(state_type)),''),'I')='I' THEN GREATEST(COALESCE(gst_sale_amount,sale_amount,0)-COALESCE(discount,0),0) ELSE 0 END),0)::numeric AS localTaxable FROM tax_invoice WHERE COALESCE(cancelled,false)=false AND date >= (CURRENT_DATE - INTERVAL '11 months') GROUP BY 1 ORDER BY 1"),
        pool.query("SELECT * FROM vehicle ORDER BY id DESC LIMIT 100")
      ]);
      const stage_counts:any={};for(const x of counts.rows)stage_counts[x.stage]=Number(x.count||0);
      const total=Object.values(stage_counts).reduce((s:any,x:any)=>s+Number(x||0),0);
      const manufacturing=recent.rows.filter((x:any)=>x.stage==="Manufacturing"),delivery_challan=recent.rows.filter((x:any)=>x.stage==="Delivery Challan"),tax_invoice=recent.rows.filter((x:any)=>x.stage==="Tax Invoice");
      return Response.json({manufacturing,delivery_challan,tax_invoice,stage_counts,total_vehicles:total,counts:{manufacturing:Number(stage_counts.Manufacturing||0),delivery_challan:Number(stage_counts["Delivery Challan"]||0),tax_invoice:Number(stage_counts["Tax Invoice"]||0),total},monthly:monthly.rows,billed_monthly:billed.rows,cash_at_dealer:0});
    }
    if(p==="nav-config"){
      const r=await pool.query("SELECT * FROM nav_tab ORDER BY id");
      return Response.json({tabs:r.rows,items:[]});
    }
    if(p==="masters"){
      const r=await pool.query("SELECT DISTINCT kind FROM simple_master ORDER BY kind");
      return Response.json({kinds:r.rows.map((x:any)=>x.kind)});
    }
    if(p==="production-formulas/by-product"){
      const u=new URL(req.url),product=u.searchParams.get("product")||u.searchParams.get("product_code")||"";
      const r=await pool.query("SELECT * FROM production_formula WHERE product_code=$1 OR product_name=$1 ORDER BY id",[product]);
      return Response.json({rows:r.rows,items:r.rows,data:r.rows});
    }
    if(p==="production-formulas"){
      const r=await pool.query("SELECT * FROM production_formula ORDER BY product_name,formula_name,id");
      const grouped:any[]=[]; const map=new Map<string,any>();
      for(const row of r.rows){const key=String(row.formula_name||"")+"::"+String(row.product_name||"");let g=map.get(key);if(!g){g={formula_name:row.formula_name,product_name:row.product_name,lines:[]};map.set(key,g);grouped.push(g)}g.lines.push(row)}
      const products=await pool.query("SELECT name,fro FROM product ORDER BY name");
      return Response.json({grouped,rows:r.rows,lines:r.rows,finished_products:products.rows.filter((x:any)=>x.fro!=="R"),raw_materials:products.rows.filter((x:any)=>x.fro==="R")});
    }
    if(p==="production-formulas/lines"){
      const u=new URL(req.url),args:any[]=[];const w:string[]=[];
      const product=u.searchParams.get("product_name")||u.searchParams.get("product")||"";const formula=u.searchParams.get("formula_name")||"";
      if(product){args.push(product);w.push("product_name=$"+args.length)}if(formula){args.push(formula);w.push("formula_name=$"+args.length)}
      const r=await pool.query("SELECT * FROM production_formula"+(w.length?" WHERE "+w.join(" AND "):"")+" ORDER BY id",args);
      return Response.json({rows:r.rows,items:r.rows,data:r.rows,lines:r.rows});
    }
    if(p==="chassis-master/months"){const r=await pool.query("SELECT * FROM chassis_month_code ORDER BY id");return Response.json({rows:r.rows,data:r.rows});}
    if(p==="chassis-master/years"){const r=await pool.query("SELECT * FROM chassis_year_code ORDER BY id");return Response.json({rows:r.rows,data:r.rows});}
    if(p==="chassis-master/rule"){const r=await pool.query("SELECT * FROM chassis_rule ORDER BY id DESC LIMIT 1");return Response.json({rule:r.rows[0]||null});}
    if(p==="dealer/loan-masters"){
      // Dealer loan form expects a normalized {models, loan_types} payload.
      // Vehicle models are the finished products already present in the existing
      // product master; raw-material products are excluded.
      const products=await pool.query("SELECT * FROM product ORDER BY name,id");
      const simple=await pool.query("SELECT * FROM simple_master WHERE kind ILIKE '%loan%' OR kind ILIKE '%model%' ORDER BY id");
      const models=products.rows
        .filter((x:any)=>String(x.fro||"").toUpperCase()!=="R")
        .map((x:any)=>({id:x.id,name:x.name||x.product_name||x.model_name||"",code:x.code||x.product_code||""}))
        .filter((x:any)=>x.name);
      const fallbackModels=simple.rows
        .filter((x:any)=>/model/i.test(String(x.kind||"")))
        .map((x:any)=>({id:x.id,name:x.name||"",code:x.code||""}))
        .filter((x:any)=>x.name);
      const loanTypes=simple.rows
        .filter((x:any)=>/loan.*type|type.*loan/i.test(String(x.kind||"")))
        .map((x:any)=>({id:x.id,name:x.name||"",code:x.code||""}))
        .filter((x:any)=>x.name);
      return Response.json({models:models.length?models:fallbackModels,loan_types:loanTypes,rows:simple.rows,masters:simple.rows});
    }
    if(p==="dealer/ledger-accounts"||p==="dealer/ledger-masters"){const r=await pool.query("SELECT DISTINCT party_name FROM day_book WHERE party_name IS NOT NULL ORDER BY party_name");return Response.json({rows:r.rows});}
    if(p==="dealer/cash-book"&&a.scope==="dealer"){
      const d=await pool.query("SELECT dealer_category FROM dealer WHERE id=$1",[num(a.dealer_id)]);
      if(String(d.rows[0]?.dealer_category||"dealer").toLowerCase()!=="showroom")return Response.json({error:"Cash Book is available only for showroom/branch accounts."},{status:403});
      const u=new URL(req.url),from=u.searchParams.get("from"),to=u.searchParams.get("to");
      const args=[num(a.dealer_id),from||"1900-01-01",to||"2999-12-31"];
      const receipts=await pool.query("SELECT id,receipt_no,receipt_date AS date,customer_name,customer_phone,dealer_register_page_no,amount,payment_mode,reference_no,remarks FROM dealer_cash_receipt WHERE dealer_id=$1 AND receipt_date BETWEEN $2::date AND $3::date ORDER BY receipt_date DESC,id DESC",[...args]);
      const expenses=await pool.query("SELECT id,expense_no,expense_date AS date,category,amount,paid_to,remarks FROM dealer_cash_expense WHERE dealer_id=$1 AND expense_date BETWEEN $2::date AND $3::date ORDER BY expense_date DESC,id DESC",[...args]);
      const handovers=await pool.query("SELECT id,handover_no,handover_date AS date,amount,sent_to,remarks,status FROM dealer_cash_handover WHERE dealer_id=$1 AND handover_date BETWEEN $2::date AND $3::date AND status <> 'rejected' ORDER BY handover_date DESC,id DESC",[...args]);
      const cash=receipts.rows.filter((x:any)=>String(x.payment_mode||"cash")==="cash").reduce((s:number,x:any)=>s+num(x.amount),0);
      const exp=expenses.rows.reduce((s:number,x:any)=>s+num(x.amount),0);
      const ho=handovers.rows.reduce((s:number,x:any)=>s+num(x.amount),0);
      const pr=await pool.query("SELECT COALESCE(SUM(amount),0) AS v FROM dealer_cash_receipt WHERE dealer_id=$1 AND receipt_date < $2::date AND payment_mode='cash'",[num(a.dealer_id),from||"1900-01-01"]);
      const pe=await pool.query("SELECT COALESCE(SUM(amount),0) AS v FROM dealer_cash_expense WHERE dealer_id=$1 AND expense_date < $2::date",[num(a.dealer_id),from||"1900-01-01"]);
      const ph=await pool.query("SELECT COALESCE(SUM(amount),0) AS v FROM dealer_cash_handover WHERE dealer_id=$1 AND handover_date < $2::date AND status <> 'rejected'",[num(a.dealer_id),from||"1900-01-01"]);
      const opening=num(pr.rows[0]?.v)-num(pe.rows[0]?.v)-num(ph.rows[0]?.v);
      return Response.json({success:true,from,to,receipts:receipts.rows,expenses:expenses.rows,handovers:handovers.rows,
        summary:{total_receipts:receipts.rows.reduce((s:number,x:any)=>s+num(x.amount),0),cash_received:cash,expenses:exp,refunds:0,ho_handover:ho,opening_balance:opening,net_movement:cash-exp-ho,closing_balance:opening+cash-exp-ho}});
    }
    if(p==="dealer/cash-book/all-receipts"&&a.scope==="dealer"){
      const r=await pool.query("SELECT id,receipt_no,receipt_date AS date,customer_name,customer_phone,amount,dealer_register_page_no FROM dealer_cash_receipt WHERE dealer_id=$1 ORDER BY receipt_date DESC,id DESC",[num(a.dealer_id)]);
      return Response.json({success:true,receipts:r.rows});
    }
    if(p==="dealer/cash-book/customers"&&a.scope==="dealer"){
      const q=String(new URL(req.url).searchParams.get("q")||"").trim().toLowerCase();
      const status=String(new URL(req.url).searchParams.get("status")||"").trim().toUpperCase();
      const payable=["1","true","yes"].includes(String(new URL(req.url).searchParams.get("payable_only")||"").toLowerCase());
      if(status==="BILLED"){
        const r=await pool.query("SELECT ti.id,ti.dealer_page_no AS page_no,ti.buyer_name AS name,ti.buyer_mobile AS phone,ti.financer_name AS financer,ti.vehicle_reg_no AS vehicle_no,ti.sale_amount,ti.hypothecation_amount AS loan_amount,COALESCE(ti.amount_received,0) AS paid_amount,ti.date,ti.id AS invoice_id,ti.bill_no FROM tax_invoice ti LEFT JOIN delivery_challan dc ON ti.delivery_challan_id=dc.id WHERE ti.cancelled=false AND (ti.dealer_id=$1 OR dc.dealer_id=$1) ORDER BY ti.date DESC,ti.id DESC",[num(a.dealer_id)]);
        const rows=r.rows.map((x:any)=>({...x,status:"BILLED",status_label:"Billed",balance:num(x.sale_amount)-num(x.loan_amount)-num(x.paid_amount)})).filter((x:any)=>!q||[x.page_no,x.name,x.phone,x.vehicle_no].join(" ").toLowerCase().includes(q));
        return Response.json({success:true,customers:rows});
      }
      const r=await pool.query("SELECT * FROM dealer_cash_customer WHERE dealer_id=$1 ORDER BY id DESC",[num(a.dealer_id)]);
      const ids=r.rows.map((x:any)=>x.id);
      let paid:any[]=[];
      if(ids.length) {
        const p=await pool.query("SELECT customer_id,COALESCE(SUM(amount),0) AS paid FROM dealer_cash_receipt WHERE dealer_id=$1 AND customer_id=ANY($2::int[]) GROUP BY customer_id",[num(a.dealer_id),ids]);
        paid=p.rows;
      }
      const pm=new Map(paid.map((x:any)=>[Number(x.customer_id),num(x.paid)]));
      let rows=r.rows.map((x:any)=>{
        const paidAmount=pm.get(Number(x.id))||0;
        const sale=num(x.sale_amount),loan=num(x.loan_amount),balance=sale-loan-paidAmount;
        return {id:x.id,page_no:x.page_no,name:x.full_name,phone:x.phone,financer:x.financer,vehicle_no:x.vehicle_no,sale_amount:sale,loan_amount:loan,paid_amount:paidAmount,balance,status:"VEHICLE_PENDING",status_label:"Vehicle Pending",date:x.created_at?new Date(x.created_at).toISOString().slice(0,10):null};
      }).filter((x:any)=>!q||[x.page_no,x.name,x.phone,x.vehicle_no].join(" ").toLowerCase().includes(q));
      if(payable)rows=rows.filter((x:any)=>x.balance>0);
      return Response.json({success:true,customers:rows});
    }
        if(p==="dealer/me"&&a.scope==="dealer"){
      const r=await pool.query("SELECT id,code,name,login_id,dealer_category,purchase_access,portal_modules,blocked FROM dealer WHERE id=$1",[num(a.dealer_id)]);
      const d=r.rows[0]||null;
      if(!d)return Response.json({error:"Dealer not found."},{status:404});
      d.purchase_access=Boolean(d.purchase_access);
      d.portal_modules=String(d.portal_modules||"").split(",").map((x:any)=>x.trim()).filter(Boolean);
      return Response.json({dealer:d});
    }
    if(p==="dealer/stock"&&a.scope==="dealer"){
      const dr=await pool.query("SELECT id,name FROM dealer WHERE id=$1",[num(a.dealer_id)]);
      const name=dr.rows[0]?.name||"";
      const r=await pool.query("SELECT * FROM vehicle WHERE stage='Delivery Challan' AND lower(trim(COALESCE(dealer_name,'')))=lower(trim($1)) ORDER BY date DESC,id DESC",[name]);
      return Response.json({vehicles:r.rows,count:r.rowCount});
    }
    if(p==="dealer/old-rickshaws"&&a.scope==="dealer"){
      const r=await pool.query("SELECT * FROM old_rickshaw WHERE dealer_id=$1 AND status IN ('available','sold') ORDER BY CASE WHEN status='available' THEN 0 ELSE 1 END,date DESC,id DESC",[num(a.dealer_id)]);
      return Response.json({rickshaws:r.rows,count:r.rowCount});
    }
    if(p==="dealer/battery-stock"&&a.scope==="dealer"){
      const r=await pool.query("SELECT * FROM battery_stock_movement WHERE dealer_id=$1 AND movement_type IN ('withdrawal','delivery') ORDER BY date DESC,id DESC",[num(a.dealer_id)]);
      const used=await pool.query("SELECT battery_no FROM battery_stock_movement WHERE dealer_id=$1 AND movement_type='addition'",[num(a.dealer_id)]);
      const usedSet=new Set(used.rows.map((x:any)=>String(x.battery_no||"").trim().toUpperCase()));
      const batteries=r.rows.filter((x:any)=>!usedSet.has(String(x.battery_no||"").trim().toUpperCase())).map((x:any)=>({...x,qty:1}));
      return Response.json({batteries,count:batteries.length});
    }
    if(p==="dealer/delivery-challans"&&a.scope==="dealer"){
      const r=await pool.query("SELECT * FROM delivery_challan WHERE dealer_id=$1 ORDER BY date DESC,id DESC",[num(a.dealer_id)]);
      return Response.json({challans:r.rows});
    }
    if(p==="dealer/tax-invoices"&&a.scope==="dealer"){
      const r=await pool.query("SELECT ti.* FROM tax_invoice ti LEFT JOIN delivery_challan dc ON ti.delivery_challan_id=dc.id WHERE ti.cancelled=false AND (ti.dealer_id=$1 OR dc.dealer_id=$1) ORDER BY ti.date DESC,ti.id DESC",[num(a.dealer_id)]);
      return Response.json({invoices:r.rows});
    }
    if(p==="dealer/seized-vehicles"&&a.scope==="dealer"){
      return Response.json({vehicles:[],count:0,status:"HOLD"});
    }
    if(p==="auth/me"){
      const r=await pool.query('SELECT id,username,mobile,department,is_super_user,allowed_modules FROM "user" WHERE id=$1',[num(a.sub)]);
      const u=r.rows[0]||null;
      if(!u)return Response.json({user:null},{status:404});
      const allowedModules=Array.isArray(u.allowed_modules)
        ? u.allowed_modules.map((x:any)=>String(x).trim()).filter(Boolean)
        : String(u.allowed_modules||"").split(",").map((x:string)=>x.trim()).filter(Boolean);
      return Response.json({user:{
        ...u,
        is_super_user:Boolean(u.is_super_user),
        department:String(u.department||"").trim(),
        allowed_modules:allowedModules,
      }});
    }
    if(p==="dealer/loan-status"||p==="loan-application-view"){
      const did=a.scope==="dealer"?num(a.dealer_id):null;
      const r=did?await pool.query("SELECT * FROM loan_workflow WHERE dealer_id=$1 ORDER BY id DESC",[did]):await pool.query("SELECT * FROM loan_workflow ORDER BY id DESC LIMIT 1000");
      return Response.json({applications:r.rows,rows:r.rows,count:r.rowCount});
    }
    if(p==="reports/payment-receivable"){
      const u=new URL(req.url);
      const from=u.searchParams.get("from"),to=u.searchParams.get("to"),search=String(u.searchParams.get("search")||"").trim().toLowerCase();
      const showAll=String(u.searchParams.get("show_all")||"1")!=="0";
      const args:any[]=[]; const w:string[]=["COALESCE(ti.cancelled,false)=false"];
      if(from){args.push(from);w.push("ti.date >= $"+args.length+"::date")}
      if(to){args.push(to);w.push("ti.date <= $"+args.length+"::date")}
      if(search){args.push("%"+search+"%");w.push("(LOWER(COALESCE(ti.dealer_name,'')) LIKE $"+args.length+" OR LOWER(COALESCE(ti.buyer_name,'')) LIKE $"+args.length+" OR LOWER(COALESCE(ti.bill_no,'')) LIKE $"+args.length+" OR LOWER(COALESCE(ti.chassis_no,'')) LIKE $"+args.length+")")}
      const rr=await pool.query("SELECT ti.* FROM tax_invoice ti WHERE "+w.join(" AND ")+" ORDER BY ti.date DESC,ti.id DESC",args);
      let rows=rr.rows.map((x:any)=>{const value=num(x.sale_amount);const loan=num(x.hypothecation_amount);const received=num(x.amount_received);const balance=value-loan-received;return {
        ...x,date:x.date,dealer_name:x.dealer_name||"",bill_no:x.bill_no||"",model:x.product_name||x.model_name||"",chassis_no:x.chassis_no||"",
        other:x.other||"",customer:x.buyer_name||"",mobile_no:x.buyer_mobile||x.customer_phone||"",value_amt:value,loan_amt:loan,amt_recd:received,balance,
        financer:x.financer_name||"",rto:x.rto||x.rto_name||"",chassis_record:x.chassis_record||"",ledger:x.ledger||"",voucher_no:x.voucher_no||"",
        cheque_no:x.cheque_no||"",vehicle_no:x.vehicle_reg_no||"",salesman:x.salesman||"",incentive_amount:num(x.incentive_amount),
        incentive_voucher_no:x.incentive_voucher_no||"",incentive_date:x.incentive_date||null,expense_total:num(x.expense_total),expense_details:Array.isArray(x.expense_details)?x.expense_details:[]
      }});
      if(!showAll)rows=rows.filter((x:any)=>x.balance>0);
      const page=Math.max(1,num(u.searchParams.get("page"))||1),per=Math.min(200,Math.max(1,num(u.searchParams.get("per_page"))||50)),start=(page-1)*per;
      const pageRows=rows.slice(start,start+per);
      const totals=rows.reduce((a:any,x:any)=>(a.value+=num(x.value_amt),a.loan+=num(x.loan_amt),a.received+=num(x.amt_recd),a.balance+=num(x.balance),a),{value:0,loan:0,received:0,balance:0});
      if(u.searchParams.get("export")==="csv")return csvResponse(rows,"Payment_Receivable_Report.csv");
      return Response.json({rows:pageRows,page,per_page:per,total:rows.length,total_pages:Math.max(1,Math.ceil(rows.length/per)),totals});
    }
    if(p==="reports/delivery-challan-register"){
      const u=new URL(req.url),args:any[]=[];const w:string[]=["COALESCE(dc.cancelled,false)=false"];
      const from=u.searchParams.get("from"),to=u.searchParams.get("to"),search=String(u.searchParams.get("search")||"").trim();
      const status=u.searchParams.get("status")||"all";
      if(from){args.push(from);w.push("dc.date >= $"+args.length+"::date")} if(to){args.push(to);w.push("dc.date <= $"+args.length+"::date")}
      if(search){args.push("%"+search+"%");w.push("(dc.challan_no ILIKE $"+args.length+" OR dc.chassis_no ILIKE $"+args.length+" OR dc.dealer_name ILIKE $"+args.length+" OR dc.product_name ILIKE $"+args.length+")")}
      if(status==="sold")w.push("EXISTS (SELECT 1 FROM tax_invoice ti WHERE ti.delivery_challan_id=dc.id AND COALESCE(ti.cancelled,false)=false)");
      if(status==="unsold")w.push("NOT EXISTS (SELECT 1 FROM tax_invoice ti WHERE ti.delivery_challan_id=dc.id AND COALESCE(ti.cancelled,false)=false)");
      for(const [param,col] of [["product","product_name"],["dealer","dealer_name"],["salesman","salesman"],["battery","battery_maker"]]){const v=u.searchParams.get(param);if(v&&v!=="ALL"){args.push(v);w.push("COALESCE(dc."+col+",'')=$"+args.length)}}
      const rr=await pool.query("SELECT dc.*,COALESCE(dc.dealer_name,d.name) AS dealer_name FROM delivery_challan dc LEFT JOIN dealer d ON d.id=dc.dealer_id WHERE "+w.join(" AND ")+" ORDER BY dc.date DESC,dc.id DESC",args);
      const page=Math.max(1,num(u.searchParams.get("page"))||1),per=Math.min(200,Math.max(1,num(u.searchParams.get("per_page"))||100)),start=(page-1)*per;
      const rows=rr.rows;const filters={product:[...new Set(rows.map((x:any)=>x.product_name).filter(Boolean))],dealer:[...new Set(rows.map((x:any)=>x.dealer_name).filter(Boolean))],salesman:[...new Set(rows.map((x:any)=>x.salesman).filter(Boolean))],battery:[...new Set(rows.map((x:any)=>x.battery_maker).filter(Boolean))]};
      if(u.searchParams.get("export")==="csv")return csvResponse(rows,"Delivery_Challan_Register.csv");
      return Response.json({rows:rows.slice(start,start+per),page,per_page:per,total:rows.length,total_pages:Math.max(1,Math.ceil(rows.length/per)),filters});
    }
    if(p==="delivery-challans"){
      const u=new URL(req.url);const page=Math.max(1,num(u.searchParams.get("page"))||1),per=Math.min(200,Math.max(1,num(u.searchParams.get("per_page"))||50)),search=String(u.searchParams.get("search")||"").trim();
      const args:any[]=[];let where="WHERE COALESCE(dc.cancelled,false)=false";
      if(search){args.push("%"+search+"%");where+=" AND (dc.challan_no ILIKE $"+args.length+" OR dc.chassis_no ILIKE $"+args.length+" OR dc.dealer_name ILIKE $"+args.length+" OR dc.product_name ILIKE $"+args.length+")"}
      const total=await pool.query("SELECT COUNT(*)::int AS n FROM delivery_challan dc "+where,args);
      const rows=await pool.query("SELECT dc.*,COALESCE(dc.dealer_name,d.name) AS dealer_name FROM delivery_challan dc LEFT JOIN dealer d ON d.id=dc.dealer_id "+where+" ORDER BY dc.date DESC,dc.id DESC LIMIT "+per+" OFFSET "+((page-1)*per),args);
      const available=await pool.query("SELECT * FROM vehicle WHERE stage='Manufacturing' ORDER BY date DESC,id DESC LIMIT 2000");
      return Response.json({rows:rows.rows,challans:rows.rows,data:rows.rows,page,per_page:per,total:Number(total.rows[0]?.n||0),total_pages:Math.max(1,Math.ceil(Number(total.rows[0]?.n||0)/per)),available_vehicles:available.rows,suggested_challan_no:"DC-"+Date.now()});
    }
    if(p==="stock/closing-premises"){
      const r=await pool.query(`
        SELECT v.id,v.date,v.chassis_no,v.motor_no,v.colour,
               COALESCE(NULLIF(v.model_name,''),pv.product_name) AS model_name
        FROM vehicle v
        LEFT JOIN LATERAL (SELECT product_name FROM production_voucher
          WHERE chassis_no=v.chassis_no ORDER BY id DESC LIMIT 1) pv ON true
        WHERE v.stage='Manufacturing'
        ORDER BY COALESCE(NULLIF(v.model_name,''),pv.product_name),v.colour,v.id
      `);
      const sm=new Map<string,any>();
      for(const v of r.rows){const k=String(v.model_name||"—")+"::"+String(v.colour||"—");const x=sm.get(k)||{model_name:v.model_name||"—",colour:v.colour||"—",qty:0};x.qty++;sm.set(k,x)}
      return Response.json({vehicles:r.rows,summary:[...sm.values()]});
    }
    if(p==="stock/closing-dealers"){
      const r=await pool.query(`
        SELECT v.id,v.date,v.chassis_no,v.motor_no,v.colour,v.model_name,v.dealer_name
        FROM vehicle v WHERE v.stage='Delivery Challan'
        ORDER BY v.dealer_name,v.model_name,v.id
      `);
      const sm=new Map<string,any>();
      for(const v of r.rows){const k=String(v.dealer_name||"—")+"::"+String(v.model_name||"—");const x=sm.get(k)||{dealer_name:v.dealer_name||"—",model_name:v.model_name||"—",qty:0};x.qty++;sm.set(k,x)}
      return Response.json({vehicles:r.rows,summary:[...sm.values()]});
    }
    if(p==="stock/ledger-premises"||p==="stock/ledger-dealers"){
      const u=new URL(req.url),from=u.searchParams.get("from"),to=u.searchParams.get("to");
      const args:any[]=[]; const bounds=(alias:string)=>{const w:string[]=[];if(from){args.push(from);w.push(alias+".date >= $"+args.length+"::date")}if(to){args.push(to);w.push(alias+".date <= $"+args.length+"::date")}return w.length?" AND "+w.join(" AND "):""};
      if(p==="stock/ledger-premises"){
        const before:any[]=[]; if(from){const q=await pool.query("SELECT COALESCE(SUM(quantity),0)::float qty FROM production_voucher WHERE date < $1::date",[from]);const d=await pool.query("SELECT COUNT(*)::float qty FROM delivery_challan WHERE date < $1::date AND cancelled=false",[from]);before.push(Number(q.rows[0]?.qty||0)-Number(d.rows[0]?.qty||0))}
        const opening=before[0]||0;
        const pv=await pool.query("SELECT date,vou_no,chassis_no,product_name,COALESCE(quantity,1)::float qty FROM production_voucher pv WHERE 1=1"+bounds("pv"));
        const dc=await pool.query("SELECT date,challan_no,chassis_no,product_name FROM delivery_challan dc WHERE cancelled=false"+bounds("dc"));
        const events:any[]=[...pv.rows.map((x:any)=>({...x,type:"IN",doc_no:x.vou_no,model_name:x.product_name,particulars:"Production — "+(x.product_name||""),_sort:new Date(x.date).getTime()})),...dc.rows.map((x:any)=>({...x,type:"OUT",doc_no:x.challan_no,model_name:x.product_name,qty:1,particulars:"Delivery Challan",_sort:new Date(x.date).getTime()}))].sort((a,b)=>a._sort-b._sort);
        let bal=opening; return Response.json({opening_balance:opening,events:events.map((e:any)=>{bal+=e.type==="IN"?Number(e.qty||1):-Number(e.qty||1);const {_sort,...z}=e;return {...z,balance:bal}})});
      }
      const dealerId=u.searchParams.get("dealer_id"); const args2:any[]=[]; const dWhere=(alias:string)=>{const w:string[]=[];if(dealerId){args2.push(Number(dealerId));w.push(alias+".dealer_id = $"+args2.length)}if(from){args2.push(from);w.push(alias+".date >= $"+args2.length+"::date")}if(to){args2.push(to);w.push(alias+".date <= $"+args2.length+"::date")}return w.length?" AND "+w.join(" AND "):""};
      const dc=await pool.query("SELECT date,challan_no,chassis_no,product_name,dealer_id,dealer_name FROM delivery_challan dc WHERE cancelled=false"+dWhere("dc"),args2);
      const ti=await pool.query("SELECT date,bill_no,chassis_no,product_name,dealer_name FROM tax_invoice ti WHERE cancelled=false"+(dealerId?" AND EXISTS (SELECT 1 FROM delivery_challan dc WHERE dc.id=ti.delivery_challan_id AND dc.dealer_id="+Number(dealerId)+")":"")+(from?" AND ti.date >= '"+from.replace(/'/g,"''")+"'::date":"")+(to?" AND ti.date <= '"+to.replace(/'/g,"''")+"'::date":""));
      const events:any[]=[...dc.rows.map((x:any)=>({...x,type:"IN",doc_no:x.challan_no,particulars:"Delivery Challan — "+(x.product_name||""),qty:1,_sort:new Date(x.date).getTime()})),...ti.rows.map((x:any)=>({...x,type:"OUT",doc_no:x.bill_no,particulars:"Tax Invoice — "+(x.product_name||""),qty:1,_sort:new Date(x.date).getTime()}))].sort((a,b)=>a._sort-b._sort);
      const opening:any={}; let bal=0; for(const e of events){bal+=e.type==="IN"?1:-1;opening[String(e.dealer_id||e.dealer_name||"")]=bal}
      return Response.json({opening_balances:opening,events:events.map((e:any)=>{const {_sort,...z}=e;return {...z,balance:bal}})});
    }
    const table=tableFor(path);
    if(table)return genericGet(req,path,table);
    return Response.json({error:"Node API route not implemented",path:"/api/"+p},{status:404});
  }catch(e:any){console.error("[node-api GET]",e);return Response.json({error:e.message||"Internal server error"},{status:500})}
}

export async function POST(req:Request,{params}:{params:Promise<{path?:string[]}>}){
  try{
    const {path=[]}=await params,p=path.join("/");
    if(p==="health")return Response.json({status:"ok",backend:"node",python:false});
    const a=auth(req);if(!a)return Response.json({error:"Authentication required."},{status:401});
    if(!canWrite(a,p))return Response.json({error:"Forbidden."},{status:403});
    const b:any=await json(req);
    if(p==="delivery-challans" || p==="dealer/delivery-challans"){
      const did=a.scope==="dealer"?num(a.dealer_id):num(b.dealer_id);
      const vehicleId=num(b.vehicle_id);
      const r=await pool.query("INSERT INTO delivery_challan (challan_no,date,cancelled,dealer_id,destination,vehicle_id,product_name,chassis_no,motor_no,controller_no,differential_no,colour,sale_value,remarks1,remarks2,created_at) VALUES (COALESCE(NULLIF($1,''),'DC-'||extract(epoch from now())::bigint),COALESCE($2::timestamptz,NOW()),false,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW()) RETURNING *",
        [String(b.challan_no||""),b.date||null,did, b.destination||null,vehicleId||null,b.product_name||null,b.chassis_no||null,b.motor_no||null,b.controller_no||null,b.differential_no||null,b.colour||null,num(b.sale_value),b.remarks1||null,b.remarks2||null]);
      if(vehicleId) await pool.query("UPDATE vehicle SET stage='Delivery Challan' WHERE id=$1",[vehicleId]);
      return Response.json({success:true,row:r.rows[0],data:r.rows[0]},{status:201});
    }
    if(p==="tax-invoices"){
      const grossTaxable=num(b.gst_sale_amount||b.sale_amount);
      const discount=Math.max(0,num(b.discount));
      const taxable=Math.max(0,grossTaxable-discount);
      const rate=num(b.gst_rate);
      // Seller state is authoritative company data; never trust a client-supplied seller state.
      const companyState=await pool.query("SELECT state_code FROM company ORDER BY id LIMIT 1");
      const sellerStateCode=String(companyState.rows[0]?.state_code||"").trim();
      const buyerStateCode=String(b.buyer_state_code||"").trim();
      const stateType=String(b.state_type||"").trim().toUpperCase();
      const sameState=stateType==="I" || stateType==="INTRA" || (!stateType && !!sellerStateCode && sellerStateCode===buyerStateCode);
      const gst=taxable*rate/100;
      const r=await pool.query("INSERT INTO tax_invoice (bill_no,date,cancelled,delivery_challan_id,dealer_id,vehicle_id,buyer_name,buyer_gst_no,buyer_state,buyer_state_code,state_type,product_name,chassis_no,motor_no,sale_amount,gst_sale_amount,gst_rate,discount,insurance_amount,registration_amount,amount_received,subsidy_amount,created_at) VALUES (COALESCE(NULLIF($1,''),'INV-'||extract(epoch from now())::bigint),COALESCE($2::timestamptz,NOW()),false,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,NOW()) RETURNING *",
        [String(b.bill_no||""),b.date||null,num(b.delivery_challan_id)||null,num(b.dealer_id)||null,num(b.vehicle_id)||null,b.buyer_name||null,b.buyer_gst_no||null,b.buyer_state||null,b.buyer_state_code||null,b.state_type||null,b.product_name||null,b.chassis_no||null,b.motor_no||null,num(b.sale_amount),taxable,rate,num(b.discount),num(b.insurance_amount),num(b.registration_amount),num(b.amount_received),num(b.subsidy_amount)]);
      if(num(b.vehicle_id)) await pool.query("UPDATE vehicle SET stage='Tax Invoice',dealer_name=COALESCE($1,dealer_name) WHERE id=$2",[b.dealer_name||null,num(b.vehicle_id)]);
      return Response.json({success:true,row:r.rows[0],data:r.rows[0],gst:{rate,amount:gst,cgst:sameState?gst/2:0,sgst:sameState?gst/2:0,igst:sameState?0:gst}},{status:201});
    }
    if(p==="production-vouchers"){
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        const chassis=String(b.chassis_no||"").trim();
        if(chassis){
          const dup=await client.query("SELECT id FROM vehicle WHERE chassis_no=$1 LIMIT 1",[chassis]);
          if(dup.rowCount)throw new Error("Chassis No. already exists.");
        }
        const qty=Math.max(1,Math.trunc(num(b.quantity)||1));
        const r=await client.query("INSERT INTO production_voucher (vou_no,date,product_name,quantity,chassis_no,motor_no,controller_no,differential_no,colour,colour_code,other,battery_maker,battery_no1,battery_no2,battery_no3,battery_no4,machnic,created_at) VALUES (COALESCE(NULLIF($1,''),'PV-'||extract(epoch from now())::bigint),COALESCE($2::date,CURRENT_DATE),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW()) RETURNING *",
          [String(b.vou_no||""),b.date||null,b.product_name||"",qty,chassis,b.motor_no||null,b.controller_no||null,b.differential_no||null,b.colour||null,b.colour_code||null,b.other||null,b.battery_maker||null,b.battery_no1||null,b.battery_no2||null,b.battery_no3||null,b.battery_no4||null,b.machnic||null]);
        if(chassis)await client.query("INSERT INTO vehicle (date,model_name,chassis_no,motor_no,controller_no,differential_no,colour,colour_code,stage,battery_maker,battery_no1,battery_no2,battery_no3,battery_no4) VALUES (COALESCE($1::date,CURRENT_DATE),$2,$3,$4,$5,$6,$7,$8,'Manufacturing',$9,$10,$11,$12,$13) ON CONFLICT (chassis_no) DO UPDATE SET stage='Manufacturing',model_name=EXCLUDED.model_name,battery_maker=EXCLUDED.battery_maker,battery_no1=EXCLUDED.battery_no1,battery_no2=EXCLUDED.battery_no2,battery_no3=EXCLUDED.battery_no3,battery_no4=EXCLUDED.battery_no4",
          [b.date||null,b.product_name||null,chassis,b.motor_no||null,b.controller_no||null,b.differential_no||null,b.colour||null,b.colour_code||null,b.battery_maker||null,b.battery_no1||null,b.battery_no2||null,b.battery_no3||null,b.battery_no4||null]);
        const formula=await client.query("SELECT raw_item_name,qty,unit FROM production_formula WHERE product_name=$1 AND ($2='' OR formula_name=$2) ORDER BY id",[b.product_name||"",String(b.formula_name||"")]);
        for(const line of formula.rows){
          const need=num(line.qty)*qty;
          if(need<=0)continue;
          const existing=await client.query("SELECT id FROM journal_stock WHERE batch_ref=$1 AND item_name=$2 AND reason='Production Consumption' LIMIT 1",[String(b.vou_no||r.rows[0].vou_no),line.raw_item_name]);
          if(!existing.rowCount)await client.query("INSERT INTO journal_stock (vou_no,date,item_name,item_type,qty,reason,created_at,model_name,work_type,batch_ref) VALUES ($1,COALESCE($2::date,CURRENT_DATE),$3,'RAW',$4,'Production Consumption',NOW(),$5,'OUT',$1)",[String(b.vou_no||r.rows[0].vou_no),b.date||null,line.raw_item_name,need,b.product_name||null]);
        }
        await client.query("COMMIT");
        return Response.json({success:true,row:r.rows[0],data:r.rows[0],bom_consumed:formula.rowCount},{status:201});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    if(p.startsWith("delivery-challans/") && p.endsWith("/cancel")){
      const id=idOf(path[path.length-2]); if(!id)return Response.json({error:"Record id required."},{status:400});
      const r=await pool.query("UPDATE delivery_challan SET cancelled=true WHERE id=$1 RETURNING *",[id]);
      return Response.json({success:r.rowCount>0,row:r.rows[0]||null});
    }
    if(p.startsWith("tax-invoices/") && p.endsWith("/cancel")){
      const id=idOf(path[path.length-2]); if(!id)return Response.json({error:"Record id required."},{status:400});
      const r=await pool.query("UPDATE tax_invoice SET cancelled=true WHERE id=$1 RETURNING *",[id]);
      return Response.json({success:r.rowCount>0,row:r.rows[0]||null});
    }
    if(p.startsWith("tax-invoices/") && p.endsWith("/payment")){
      const id=idOf(path[path.length-2]),pb:any=await json(req);
      if(!id)return Response.json({error:"Invoice id required."},{status:400});
      const r=await pool.query("UPDATE tax_invoice SET amount_received=COALESCE(amount_received,0)+$1 WHERE id=$2 RETURNING *",[num(pb.amount),id]);
      return Response.json({success:r.rowCount>0,row:r.rows[0]||null});
    }
    if(p.startsWith("delivery-challans/") && p.endsWith("/print")){
      const id=idOf(path[path.length-2]); const r=await pool.query("SELECT * FROM delivery_challan WHERE id=$1",[id]);
      return Response.json({success:true,data:r.rows[0]||null});
    }
    if(p.startsWith("tax-invoices/") && p.endsWith("/print")){
      const id=idOf(path[path.length-2]); const r=await pool.query("SELECT * FROM tax_invoice WHERE id=$1",[id]);
      return Response.json({success:true,data:r.rows[0]||null});
    }
    if(p==="battery-swap-vouchers"){
      const fromType=String(b.from_type||"vehicle").toLowerCase(),toType=String(b.to_type||"vehicle").toLowerCase();
      const fromTable=fromType.includes("old")?"old_rickshaw":"vehicle",toTable=toType.includes("old")?"old_rickshaw":"vehicle";
      const fromId=idOf(b.from_id),toId=idOf(b.to_id);
      if(!fromId||!toId)return Response.json({error:"Source and target are required."},{status:400});
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        const fr=await client.query('SELECT * FROM "'+fromTable+'" WHERE id=$1 FOR UPDATE',[fromId]);
        const tr=await client.query('SELECT * FROM "'+toTable+'" WHERE id=$1 FOR UPDATE',[toId]);
        if(!fr.rowCount||!tr.rowCount)throw new Error("Source or target vehicle not found.");
        const source=fr.rows[0],target=tr.rows[0];
        const fields=["battery_maker","battery_no1","battery_no2","battery_no3","battery_no4"];
        const sourceHas=fields.slice(1).some(k=>String(source[k]||"").trim());
        if(!sourceHas)throw new Error("Source has no battery to transfer.");
        const mode=String(b.mode||"swap").toLowerCase();
        if(mode==="transfer" && fields.slice(1).some(k=>String(target[k]||"").trim()))throw new Error("Target already has battery numbers.");
        const nextSource=mode==="transfer"?{battery_maker:null,battery_no1:null,battery_no2:null,battery_no3:null,battery_no4:null}:Object.fromEntries(fields.map(k=>[k,target[k]??null]));
        const nextTarget=Object.fromEntries(fields.map(k=>[k,source[k]??null]));
        const update=async(table:string,id:number,row:any)=>{
          await client.query('UPDATE "'+table+'" SET battery_maker=$1,battery_no1=$2,battery_no2=$3,battery_no3=$4,battery_no4=$5 WHERE id=$6',[row.battery_maker,row.battery_no1,row.battery_no2,row.battery_no3,row.battery_no4,id]);
        };
        await update(fromTable,fromId,nextSource); await update(toTable,toId,nextTarget);
        const vr=await client.query("INSERT INTO battery_swap_voucher (voucher_no,date,dealer_id,from_type,from_id,to_type,to_id,mode,remarks,created_at) VALUES (COALESCE(NULLIF($1,''),'BS-'||extract(epoch from now())::bigint),COALESCE($2::date,CURRENT_DATE),$3,$4,$5,$6,$7,$8,$9,NOW()) RETURNING *",
          [String(b.voucher_no||""),b.date||null,num(b.dealer_id)||null,fromType,fromId,toType,toId,mode,b.remarks||null]);
        await client.query("COMMIT");
        return Response.json({success:true,row:vr.rows[0],data:vr.rows[0],source:nextSource,target:nextTarget},{status:201});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    if(p==="dealer/cash-book/receipt"&&a.scope==="dealer"){
      const d=await pool.query("SELECT dealer_category FROM dealer WHERE id=$1",[num(a.dealer_id)]);
      if(String(d.rows[0]?.dealer_category||"dealer").toLowerCase()!=="showroom")return Response.json({error:"Booking Receipt is available only for showroom/branch accounts."},{status:403});
      const b:any=await json(req),type=String(b.receipt_type||"new_booking").toLowerCase(),amount=num(b.amount);
      if(amount<=0)return Response.json({error:"Amount must be greater than zero."},{status:400});
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        const requestId=String(b.request_id||"").trim();
        if(requestId){const ex=await client.query("SELECT * FROM dealer_cash_receipt WHERE dealer_id=$1 AND request_id=$2 LIMIT 1",[num(a.dealer_id),requestId]);if(ex.rowCount){await client.query("COMMIT");return Response.json({success:true,duplicate:true,receipt:{...ex.rows[0],date:ex.rows[0].receipt_date}});}}
        let customerId:number,name="",phone="",bookingFor="";
        if(type==="balance_payment"){
          customerId=num(b.customer_id); const cr=await client.query("SELECT * FROM dealer_cash_customer WHERE id=$1 AND dealer_id=$2",[customerId,num(a.dealer_id)]);
          if(!cr.rowCount)return Response.json({error:"Please select a previous customer for Balance Payment."},{status:400});
          const paid=await client.query("SELECT COALESCE(SUM(amount),0) AS v FROM dealer_cash_receipt WHERE dealer_id=$1 AND customer_id=$2",[num(a.dealer_id),customerId]);
          const cst=cr.rows[0],balance=num(cst.sale_amount)-num(cst.loan_amount)-num(paid.rows[0]?.v);
          if(balance<=0||amount>balance)return Response.json({error:"Receipt amount cannot exceed outstanding balance."},{status:400});
          name=cst.full_name;phone=cst.phone||"";bookingFor=cst.vehicle_no||"";
        }else{
          name=String(b.customer_name||"").trim();phone=String(b.customer_phone||"").trim();bookingFor=String(b.booking_for||"new").toLowerCase();
          const sale=num(b.sale_amount),loan=num(b.loan_amount);
          if(!name||!phone||sale<=0||loan<0||loan>sale)return Response.json({error:"Invalid booking receipt details."},{status:400});
          const cr=await client.query("INSERT INTO dealer_cash_customer (dealer_id,page_no,full_name,phone,sale_amount,loan_amount,vehicle_no) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",[num(a.dealer_id),String(b.dealer_register_page_no||"").trim()||null,name,phone,sale,loan,bookingFor]);
          customerId=Number(cr.rows[0].id);
        }
        const no="DRC-"+new Date().toISOString().slice(0,10).replace(/-/g,"")+"-"+Date.now().toString().slice(-5);
        const rr=await client.query("INSERT INTO dealer_cash_receipt (dealer_id,receipt_no,receipt_date,customer_name,customer_phone,dealer_register_page_no,booking_for,amount,payment_mode,reference_no,remarks,customer_id,request_id,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'cash',$9,$10,$11,$12,$13,NOW()) RETURNING *",
          [num(a.dealer_id),no,b.date||null,name,phone,String(b.dealer_register_page_no||"").trim()||null,bookingFor,amount,String(b.reference_no||"").trim()||null,String(b.remarks||"").trim()||null,customerId,String(b.request_id||"").trim()||null]);
        await client.query("COMMIT");
        return Response.json({success:true,receipt:{...rr.rows[0],date:rr.rows[0].receipt_date}});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    if(p==="dealer/cash-book/expense"&&a.scope==="dealer"){
      const b:any=await json(req),amount=num(b.amount);
      if(amount<=0)return Response.json({error:"Amount must be greater than zero."},{status:400});
      const no="DEX-"+new Date().toISOString().slice(0,10).replace(/-/g,"")+"-"+Date.now().toString().slice(-5);
      const r=await pool.query("INSERT INTO dealer_cash_expense (dealer_id,expense_no,expense_date,category,amount,paid_to,remarks,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) RETURNING *",[num(a.dealer_id),no,b.date||null,String(b.category||"other"),amount,String(b.paid_to||"").trim()||null,String(b.remarks||"").trim()||null]);
      return Response.json({success:true,expense:{...r.rows[0],date:r.rows[0].expense_date}});
    }
    if(p==="dealer/cash-book/handover"&&a.scope==="dealer"){
      const b:any=await json(req),amount=num(b.amount);
      if(amount<=0)return Response.json({error:"Amount must be greater than zero."},{status:400});
      const no="DHO-"+new Date().toISOString().slice(0,10).replace(/-/g,"")+"-"+Date.now().toString().slice(-5);
      const r=await pool.query("INSERT INTO dealer_cash_handover (dealer_id,handover_no,handover_date,amount,sent_to,remarks,status,created_at) VALUES ($1,$2,$3,$4,$5,$6,'sent',NOW()) RETURNING *",[num(a.dealer_id),no,b.date||null,amount,String(b.sent_to||"").trim()||null,String(b.remarks||"").trim()||null]);
      return Response.json({success:true,handover:{...r.rows[0],date:r.rows[0].handover_date}});
    }
        if(p==="users" && isAdmin(a)){
      const userId=idOf(b.id);
      const username=String(b.username||"").trim();
      if(!userId && !username)return Response.json({error:"Username is required."},{status:400});
      const password=String(b.password||"");
      if(userId){
        const existing=await pool.query('SELECT id FROM "user" WHERE id=$1 LIMIT 1',[userId]);
        if(!existing.rowCount)return Response.json({error:"User not found."},{status:404});
        if(password){
          const salt=crypto.randomBytes(16).toString("hex");
          const hash=crypto.pbkdf2Sync(password,salt,600000,32,"sha256").toString("hex");
          await pool.query('UPDATE "user" SET password_hash=$1 WHERE id=$2',["pbkdf2:sha256:600000$"+salt+"$"+hash,userId]);
        }
        const cols=await columns("user"), input:any={};
        for(const [k,v] of Object.entries(b||{})){const col=snake(k);if(cols.has(col)&&!["id","password_hash"].includes(col))input[col]=v}
        const keys=Object.keys(input);
        if(keys.length){
          const rr=await pool.query('UPDATE "user" SET '+keys.map((k,i)=>'"'+k+'"=
      const did=a.scope==="dealer"?num(a.dealer_id):num(b.dealer_id);
      const vl=b.vehicle_loan||{};
      const modelId=num(vl.vehicle_model_id);
      let modelName=String(b.loan_model_name||"").trim();
      if(!modelName && modelId){
        const mr=await pool.query("SELECT * FROM product WHERE id=$1 LIMIT 1",[modelId]);
        const m=mr.rows[0];
        modelName=String(m?.name||m?.product_name||m?.model_name||"").trim();
      }
      if(!modelName)return Response.json({error:"Select model"},{status:400});
      const loanAmount=num(vl.loan_amount_requested||b.loan_amount);
      const tenure=num(vl.tenure_months);
      if(loanAmount<=0||tenure<=0)return Response.json({error:"Loan amount and tenure are required."},{status:400});
      const r=await pool.query("INSERT INTO loan_workflow (application_no,dealer_id,customer_id,status,loan_amount,loan_model_name,loan_vehicle_type,created_at,updated_at) VALUES (COALESCE(NULLIF($1,''),'APP-'||extract(epoch from now())::bigint),$2,$3,'SUBMITTED',$4,$5,$6,NOW(),NOW()) RETURNING *",
        [String(b.application_no||""),did,num(b.customer_id),loanAmount,modelName,String(b.loan_type||"NEW").toLowerCase()]);
      return Response.json({success:true,application:r.rows[0]},{status:201});
    }
    const table=tableFor(path);
    if(table)return genericWrite(req,path,table,"POST");
    return Response.json({error:"Node API route not implemented",path:"/api/"+p},{status:404});
  }catch(e:any){console.error("[node-api POST]",e);return Response.json({error:e.message||"Internal server error"},{status:500})}
}
export async function PUT(req:Request,{params}:{params:Promise<{path?:string[]}>}){return mutation(req,params,"PUT")}
export async function PATCH(req:Request,{params}:{params:Promise<{path?:string[]}>}){return mutation(req,params,"PATCH")}
export async function DELETE(req:Request,{params}:{params:Promise<{path?:string[]}>}){return mutation(req,params,"DELETE")}
async function mutation(req:Request,params:any,method:string){

  try{
    const a=auth(req);if(!a)return Response.json({error:"Authentication required."},{status:401});
    const {path=[]}=await params,p=path.join("/"),table=tableFor(path);
    if(!canWrite(a,p))return Response.json({error:"Forbidden."},{status:403});
    if(p.startsWith("delivery-challans/") && p.endsWith("/cancel") && method==="POST"){
      const id=idOf(path[path.length-2]); if(!id)return Response.json({error:"Record id required."},{status:400});
      const r=await pool.query("UPDATE delivery_challan SET cancelled=true WHERE id=$1 RETURNING *",[id]);
      return Response.json({success:r.rowCount>0,row:r.rows[0]||null});
    }
    if(p.startsWith("tax-invoices/") && p.endsWith("/cancel") && method==="POST"){
      const id=idOf(path[path.length-2]); if(!id)return Response.json({error:"Record id required."},{status:400});
      const r=await pool.query("UPDATE tax_invoice SET cancelled=true WHERE id=$1 RETURNING *",[id]);
      return Response.json({success:r.rowCount>0,row:r.rows[0]||null});
    }
    if(p.startsWith("tax-invoices/") && p.endsWith("/payment") && method==="POST"){
      const id=idOf(path[path.length-2]),b:any=await json(req);
      if(!id)return Response.json({error:"Invoice id required."},{status:400});
      const r=await pool.query("UPDATE tax_invoice SET amount_received=COALESCE(amount_received,0)+$1 WHERE id=$2 RETURNING *",[num(b.amount),id]);
      return Response.json({success:r.rowCount>0,row:r.rows[0]||null});
    }
    if(p.startsWith("delivery-challans/") && p.endsWith("/print") && method==="POST"){
      const id=idOf(path[path.length-2]); const r=await pool.query("SELECT * FROM delivery_challan WHERE id=$1",[id]);
      return Response.json({success:true,data:r.rows[0]||null});
    }
    if(p.startsWith("tax-invoices/") && p.endsWith("/print") && method==="POST"){
      const id=idOf(path[path.length-2]); const r=await pool.query("SELECT * FROM tax_invoice WHERE id=$1",[id]);
      return Response.json({success:true,data:r.rows[0]||null});
    }
    if(!table)return Response.json({error:"Node API route not implemented",path:"/api/"+p},{status:404});
    return genericWrite(req,path,table,method);
  }catch(e:any){console.error("[node-api mutation]",e);return Response.json({error:e.message||"Internal server error"},{status:500})}
}
+(i+1)).join(",")+' WHERE id=
      const did=a.scope==="dealer"?num(a.dealer_id):num(b.dealer_id);
      const vl=b.vehicle_loan||{};
      const modelId=num(vl.vehicle_model_id);
      let modelName=String(b.loan_model_name||"").trim();
      if(!modelName && modelId){
        const mr=await pool.query("SELECT * FROM product WHERE id=$1 LIMIT 1",[modelId]);
        const m=mr.rows[0];
        modelName=String(m?.name||m?.product_name||m?.model_name||"").trim();
      }
      if(!modelName)return Response.json({error:"Select model"},{status:400});
      const loanAmount=num(vl.loan_amount_requested||b.loan_amount);
      const tenure=num(vl.tenure_months);
      if(loanAmount<=0||tenure<=0)return Response.json({error:"Loan amount and tenure are required."},{status:400});
      const r=await pool.query("INSERT INTO loan_workflow (application_no,dealer_id,customer_id,status,loan_amount,loan_model_name,loan_vehicle_type,created_at,updated_at) VALUES (COALESCE(NULLIF($1,''),'APP-'||extract(epoch from now())::bigint),$2,$3,'SUBMITTED',$4,$5,$6,NOW(),NOW()) RETURNING *",
        [String(b.application_no||""),did,num(b.customer_id),loanAmount,modelName,String(b.loan_type||"NEW").toLowerCase()]);
      return Response.json({success:true,application:r.rows[0]},{status:201});
    }
    const table=tableFor(path);
    if(table)return genericWrite(req,path,table,"POST");
    return Response.json({error:"Node API route not implemented",path:"/api/"+p},{status:404});
  }catch(e:any){console.error("[node-api POST]",e);return Response.json({error:e.message||"Internal server error"},{status:500})}
}
export async function PUT(req:Request,{params}:{params:Promise<{path?:string[]}>}){return mutation(req,params,"PUT")}
export async function PATCH(req:Request,{params}:{params:Promise<{path?:string[]}>}){return mutation(req,params,"PATCH")}
export async function DELETE(req:Request,{params}:{params:Promise<{path?:string[]}>}){return mutation(req,params,"DELETE")}
async function mutation(req:Request,params:any,method:string){

  try{
    const a=auth(req);if(!a)return Response.json({error:"Authentication required."},{status:401});
    const {path=[]}=await params,p=path.join("/"),table=tableFor(path);
    if(!canWrite(a,p))return Response.json({error:"Forbidden."},{status:403});
    if(p.startsWith("delivery-challans/") && p.endsWith("/cancel") && method==="POST"){
      const id=idOf(path[path.length-2]); if(!id)return Response.json({error:"Record id required."},{status:400});
      const r=await pool.query("UPDATE delivery_challan SET cancelled=true WHERE id=$1 RETURNING *",[id]);
      return Response.json({success:r.rowCount>0,row:r.rows[0]||null});
    }
    if(p.startsWith("tax-invoices/") && p.endsWith("/cancel") && method==="POST"){
      const id=idOf(path[path.length-2]); if(!id)return Response.json({error:"Record id required."},{status:400});
      const r=await pool.query("UPDATE tax_invoice SET cancelled=true WHERE id=$1 RETURNING *",[id]);
      return Response.json({success:r.rowCount>0,row:r.rows[0]||null});
    }
    if(p.startsWith("tax-invoices/") && p.endsWith("/payment") && method==="POST"){
      const id=idOf(path[path.length-2]),b:any=await json(req);
      if(!id)return Response.json({error:"Invoice id required."},{status:400});
      const r=await pool.query("UPDATE tax_invoice SET amount_received=COALESCE(amount_received,0)+$1 WHERE id=$2 RETURNING *",[num(b.amount),id]);
      return Response.json({success:r.rowCount>0,row:r.rows[0]||null});
    }
    if(p.startsWith("delivery-challans/") && p.endsWith("/print") && method==="POST"){
      const id=idOf(path[path.length-2]); const r=await pool.query("SELECT * FROM delivery_challan WHERE id=$1",[id]);
      return Response.json({success:true,data:r.rows[0]||null});
    }
    if(p.startsWith("tax-invoices/") && p.endsWith("/print") && method==="POST"){
      const id=idOf(path[path.length-2]); const r=await pool.query("SELECT * FROM tax_invoice WHERE id=$1",[id]);
      return Response.json({success:true,data:r.rows[0]||null});
    }
    if(!table)return Response.json({error:"Node API route not implemented",path:"/api/"+p},{status:404});
    return genericWrite(req,path,table,method);
  }catch(e:any){console.error("[node-api mutation]",e);return Response.json({error:e.message||"Internal server error"},{status:500})}
}
+(keys.length+1)+' RETURNING *',[...keys.map(k=>input[k]),userId]);
          return Response.json(rr.rows[0]);
        }
        return Response.json({success:true});
      }
      if(!password)return Response.json({error:"Password is required for a new user."},{status:400});
    }
    if(p.startsWith("users/") && p.endsWith("/password") && isAdmin(a)){
      const parts=p.split("/");
      const userId=idOf(parts[1]);
      const newPassword=String(b.new_password||"");
      const confirmPassword=String(b.confirm_password||"");
      if(!userId)return Response.json({error:"Invalid user."},{status:400});
      if(!newPassword || newPassword!==confirmPassword)return Response.json({error:"Passwords do not match."},{status:400});
      if(newPassword.length<4)return Response.json({error:"Password must be at least 4 characters."},{status:400});
      const salt=crypto.randomBytes(16).toString("hex");
      const hash=crypto.pbkdf2Sync(newPassword,salt,600000,32,"sha256").toString("hex");
      const rr=await pool.query('UPDATE "user" SET password_hash=$1 WHERE id=$2',["pbkdf2:sha256:600000$"+salt+"$"+hash,userId]);
      if(!rr.rowCount)return Response.json({error:"User not found."},{status:404});
      return Response.json({success:true});
    }
    if(p==="dealer/customer-invoice" && a.scope==="dealer"){
      const challanId=idOf(b.challan_id);
      if(!challanId)return Response.json({error:"Delivery challan is required."},{status:400});
      const cr=await pool.query("SELECT * FROM delivery_challan WHERE id=$1 LIMIT 1",[challanId]);
      const ch=cr.rows[0];
      if(!ch)return Response.json({error:"Delivery challan not found."},{status:404});
      const dealerId=num(a.dealer_id);
      if(num(ch.dealer_id)!==dealerId)return Response.json({error:"This challan does not belong to the logged-in dealer."},{status:403});
      const taxable=Math.max(0,num(b.sale_amount)-num(b.discount));
      const rate=Math.max(0,num(b.gst_rate));
      const gst=taxable*rate/100;
      const rr=await pool.query("INSERT INTO tax_invoice (bill_no,date,cancelled,delivery_challan_id,dealer_id,vehicle_id,buyer_name,buyer_gst_no,product_name,chassis_no,motor_no,sale_amount,gst_sale_amount,gst_rate,discount,amount_received,created_at) VALUES ('INV-'||extract(epoch from now())::bigint,CURRENT_DATE,false,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW()) RETURNING *",
        [challanId,dealerId,num(ch.vehicle_id)||null,b.buyer_name||null,b.buyer_gst_no||null,ch.product_name||null,ch.chassis_no||null,ch.motor_no||null,taxable,gst,rate,num(b.discount),num(b.amount_received)]);
      if(num(ch.vehicle_id))await pool.query("UPDATE vehicle SET stage='Tax Invoice',dealer_name=COALESCE($1,dealer_name) WHERE id=$2",[ch.dealer_name||null,num(ch.vehicle_id)]);
      return Response.json({success:true,bill_no:rr.rows[0].bill_no,chassis_no:ch.chassis_no,row:rr.rows[0]},{status:201});
    }
    if(p==="dealer/submit-loan"){
      const did=a.scope==="dealer"?num(a.dealer_id):num(b.dealer_id);
      const vl=b.vehicle_loan||{};
      const modelId=num(vl.vehicle_model_id);
      let modelName=String(b.loan_model_name||"").trim();
      if(!modelName && modelId){
        const mr=await pool.query("SELECT * FROM product WHERE id=$1 LIMIT 1",[modelId]);
        const m=mr.rows[0];
        modelName=String(m?.name||m?.product_name||m?.model_name||"").trim();
      }
      if(!modelName)return Response.json({error:"Select model"},{status:400});
      const loanAmount=num(vl.loan_amount_requested||b.loan_amount);
      const tenure=num(vl.tenure_months);
      if(loanAmount<=0||tenure<=0)return Response.json({error:"Loan amount and tenure are required."},{status:400});
      const r=await pool.query("INSERT INTO loan_workflow (application_no,dealer_id,customer_id,status,loan_amount,loan_model_name,loan_vehicle_type,created_at,updated_at) VALUES (COALESCE(NULLIF($1,''),'APP-'||extract(epoch from now())::bigint),$2,$3,'SUBMITTED',$4,$5,$6,NOW(),NOW()) RETURNING *",
        [String(b.application_no||""),did,num(b.customer_id),loanAmount,modelName,String(b.loan_type||"NEW").toLowerCase()]);
      return Response.json({success:true,application:r.rows[0]},{status:201});
    }
    const table=tableFor(path);
    if(table)return genericWrite(req,path,table,"POST");
    return Response.json({error:"Node API route not implemented",path:"/api/"+p},{status:404});
  }catch(e:any){console.error("[node-api POST]",e);return Response.json({error:e.message||"Internal server error"},{status:500})}
}
export async function PUT(req:Request,{params}:{params:Promise<{path?:string[]}>}){return mutation(req,params,"PUT")}
export async function PATCH(req:Request,{params}:{params:Promise<{path?:string[]}>}){return mutation(req,params,"PATCH")}
export async function DELETE(req:Request,{params}:{params:Promise<{path?:string[]}>}){return mutation(req,params,"DELETE")}
async function mutation(req:Request,params:any,method:string){

  try{
    const a=auth(req);if(!a)return Response.json({error:"Authentication required."},{status:401});
    const {path=[]}=await params,p=path.join("/"),table=tableFor(path);
    if(!canWrite(a,p))return Response.json({error:"Forbidden."},{status:403});
    if(p.startsWith("delivery-challans/") && p.endsWith("/cancel") && method==="POST"){
      const id=idOf(path[path.length-2]); if(!id)return Response.json({error:"Record id required."},{status:400});
      const r=await pool.query("UPDATE delivery_challan SET cancelled=true WHERE id=$1 RETURNING *",[id]);
      return Response.json({success:r.rowCount>0,row:r.rows[0]||null});
    }
    if(p.startsWith("tax-invoices/") && p.endsWith("/cancel") && method==="POST"){
      const id=idOf(path[path.length-2]); if(!id)return Response.json({error:"Record id required."},{status:400});
      const r=await pool.query("UPDATE tax_invoice SET cancelled=true WHERE id=$1 RETURNING *",[id]);
      return Response.json({success:r.rowCount>0,row:r.rows[0]||null});
    }
    if(p.startsWith("tax-invoices/") && p.endsWith("/payment") && method==="POST"){
      const id=idOf(path[path.length-2]),b:any=await json(req);
      if(!id)return Response.json({error:"Invoice id required."},{status:400});
      const r=await pool.query("UPDATE tax_invoice SET amount_received=COALESCE(amount_received,0)+$1 WHERE id=$2 RETURNING *",[num(b.amount),id]);
      return Response.json({success:r.rowCount>0,row:r.rows[0]||null});
    }
    if(p.startsWith("delivery-challans/") && p.endsWith("/print") && method==="POST"){
      const id=idOf(path[path.length-2]); const r=await pool.query("SELECT * FROM delivery_challan WHERE id=$1",[id]);
      return Response.json({success:true,data:r.rows[0]||null});
    }
    if(p.startsWith("tax-invoices/") && p.endsWith("/print") && method==="POST"){
      const id=idOf(path[path.length-2]); const r=await pool.query("SELECT * FROM tax_invoice WHERE id=$1",[id]);
      return Response.json({success:true,data:r.rows[0]||null});
    }
    if(!table)return Response.json({error:"Node API route not implemented",path:"/api/"+p},{status:404});
    return genericWrite(req,path,table,method);
  }catch(e:any){console.error("[node-api mutation]",e);return Response.json({error:e.message||"Internal server error"},{status:500})}
}
