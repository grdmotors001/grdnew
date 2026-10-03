// Tax Invoice module (bade route file se nikala gaya, logic/queries same hain):
// tax-invoices list/get/create/cancel/payment/print aur dealer portal ka dealer/tax-invoices (view + edit).
// TI_CALC wo SQL hai jo taxable/CGST/SGST/IGST/total nikalta hai; baaki modules (reports, dealer portal) bhi ise import karte hain.
import { pool, num, idOf, ymd, todayDate, columns, json } from "./common";
import { audit } from "./permissions";
import { ensureTaxInvoiceRecordColumns } from "./reports-sales";

// tax_invoice has no stored taxable/GST/total columns (legacy model computes them). Screens, print and the dealer portal read
// taxable_value / cgst_amount / sgst_amount / igst_amount / tax_amount / bill_total, so every tax_invoice read that feeds them adds this (alias: ti).
export const TI_TAXABLE="GREATEST(COALESCE(ti.gst_sale_amount,ti.sale_amount,0)-COALESCE(ti.discount,0),0)";
export const TI_STATE_INTRA="COALESCE(NULLIF(UPPER(TRIM(ti.state_type)),''),'I')='I'";
export const TI_CALC=`${TI_TAXABLE} AS taxable_value,
  CASE WHEN ${TI_STATE_INTRA} THEN ${TI_TAXABLE}*COALESCE(ti.gst_rate,0)/200 ELSE 0 END AS cgst_amount,
  CASE WHEN ${TI_STATE_INTRA} THEN ${TI_TAXABLE}*COALESCE(ti.gst_rate,0)/200 ELSE 0 END AS sgst_amount,
  CASE WHEN ${TI_STATE_INTRA} THEN 0 ELSE ${TI_TAXABLE}*COALESCE(ti.gst_rate,0)/100 END AS igst_amount,
  ${TI_TAXABLE}*COALESCE(ti.gst_rate,0)/100 AS tax_amount,
  ${TI_TAXABLE}+${TI_TAXABLE}*COALESCE(ti.gst_rate,0)/100+COALESCE(ti.insurance_amount,0)+COALESCE(ti.registration_amount,0) AS bill_total`;

export async function taxInvoiceGet(req:Request,path:string[],a:any,deps:any):Promise<Response|null>{
  const p=path.join("/");
  const {productLogo,defaultBank,rtoAddressText}=deps||({} as any);
    if(/^tax-invoices\/\d+$/.test(p)){
      const id=idOf(path[path.length-1]);if(!id)return Response.json({error:"Tax Invoice id required."},{status:400});
      const r=await pool.query("SELECT ti.*,"+TI_CALC+" FROM tax_invoice ti WHERE ti.id=$1",[id]);
      if(!r.rowCount)return Response.json({error:"Tax Invoice not found."},{status:404});
      return Response.json(r.rows[0]);
    }
    if(p==="tax-invoices"){
      const u=new URL(req.url),args:any[]=[],w:string[]=[];
      const search=String(u.searchParams.get("search")||"").trim();
      if(search){args.push("%"+search+"%");w.push("(COALESCE(ti.bill_no,'') ILIKE $1 OR COALESCE(ti.buyer_name,'') ILIKE $1 OR COALESCE(ti.chassis_no,'') ILIKE $1 OR COALESCE(ti.motor_no,'') ILIKE $1)");}
      const where=w.length?" WHERE "+w.join(" AND "):"";
      const page=Math.max(1,num(u.searchParams.get("page"))||1),per=Math.min(200,Math.max(1,num(u.searchParams.get("per_page"))||50)),start=(page-1)*per;
      // Only the requested page is read from the DB (was: whole 16k+ table fetched, sorted and sliced in JS).
      // Un-invoiced challans are needed once for the "New Tax Invoice" form, not on every page/search click.
      const wantChallans=u.searchParams.get("challans")!=="0";
      const [pg,cnt,challans]=await Promise.all([
        pool.query("SELECT ti.*,"+TI_CALC+" FROM tax_invoice ti"+where+" ORDER BY ti.date DESC,ti.id DESC LIMIT "+per+" OFFSET "+start,args),
        pool.query("SELECT COUNT(*)::int AS n FROM tax_invoice ti"+where,args),
        wantChallans?pool.query("SELECT dc.*,d.name AS dealer_name,v.battery_maker,v.battery_no1,v.battery_no2,v.battery_no3,v.battery_no4 FROM delivery_challan dc LEFT JOIN dealer d ON d.id=dc.dealer_id LEFT JOIN vehicle v ON v.id=dc.vehicle_id WHERE COALESCE(dc.cancelled,false)=false AND NOT EXISTS (SELECT 1 FROM tax_invoice ti WHERE ti.delivery_challan_id=dc.id AND COALESCE(ti.cancelled,false)=false) ORDER BY dc.date DESC,dc.id DESC LIMIT 1000"):Promise.resolve(null)
      ]);
      const invoices=pg.rows,total=cnt.rows[0]?.n||0;
      const out:any={invoices,rows:invoices,data:invoices,page,per_page:per,total,total_pages:Math.max(1,Math.ceil(total/per))};
      if(challans)out.uninvoiced_challans=challans.rows;
      return Response.json(out);
    }
    if(p==="dealer/tax-invoices"&&a.scope==="dealer"){
      const r=await pool.query("SELECT ti.*,"+TI_CALC+" FROM tax_invoice ti LEFT JOIN delivery_challan dc ON ti.delivery_challan_id=dc.id WHERE COALESCE(ti.cancelled,false)=false AND (ti.dealer_id=$1 OR dc.dealer_id=$1 OR (ti.dealer_id IS NULL AND dc.dealer_id IS NULL AND lower(btrim(COALESCE(ti.dealer_name,'')))<>'' AND lower(btrim(ti.dealer_name))=lower(btrim(COALESCE((SELECT name FROM dealer WHERE id=$1),''))))) ORDER BY ti.date DESC,ti.id DESC",[num(a.dealer_id)]);
      return Response.json({invoices:r.rows});
    }
    if(/^tax-invoices\/\d+\/print$/.test(p)){
      const id=idOf(path[path.length-2]);if(!id)return Response.json({error:"Tax Invoice id required."},{status:400});
      const u=new URL(req.url),doc=String(u.searchParams.get("doc")||"invoice");
      const r=await pool.query("SELECT ti.*,d.name AS joined_dealer_name,d.code AS dealer_code,d.mobile AS dealer_mobile,d.gst_no AS dealer_gst_no,d.address1 AS dealer_address1,d.address2 AS dealer_address2,v.model_name AS vehicle_model_name,v.chassis_no AS vehicle_chassis_no,v.motor_no AS vehicle_motor_no,v.colour AS vehicle_colour,v.battery_maker,v.battery_no1,v.battery_no2,v.battery_no3,v.battery_no4,COALESCE(to_jsonb(v)->>'umrn_code','') AS umrn_code,COALESCE(to_jsonb(v)->>'colour_code','') AS colour_code FROM tax_invoice ti LEFT JOIN dealer d ON d.id=ti.dealer_id LEFT JOIN vehicle v ON v.id=ti.vehicle_id WHERE ti.id=$1",[id]);
      if(!r.rowCount)return Response.json({error:"Tax Invoice not found."},{status:404});
      const x=r.rows[0],invoice={...x,dealer_name:x.dealer_name||x.joined_dealer_name||"",dealer_code:x.dealer_code||"",dealer_mobile:x.dealer_mobile||"",dealer_gst_no:x.dealer_gst_no||"",dealer_address1:x.dealer_address1||"",dealer_address2:x.dealer_address2||"",product_name:x.product_name||x.vehicle_model_name||"",chassis_no:x.chassis_no||x.vehicle_chassis_no||"",motor_no:x.motor_no||x.vehicle_motor_no||"",colour:x.colour||x.vehicle_colour||"",battery_maker:x.battery_maker||"",battery_no1:x.battery_no1||"",battery_no2:x.battery_no2||"",battery_no3:x.battery_no3||"",battery_no4:x.battery_no4||"",umrn_code:x.umrn_code||"",colour_code:x.colour_code||""};
      const company=(await pool.query("SELECT * FROM company ORDER BY id DESC LIMIT 1")).rows[0]||{};
      const pd=await pool.query("SELECT (SELECT pv.date::text FROM production_voucher pv WHERE lower(btrim(pv.chassis_no))=lower(btrim($1)) ORDER BY pv.id DESC LIMIT 1) AS d",[invoice.chassis_no||""]).catch(()=>({rows:[] as any[]}));
      (invoice as any).production_date=String(pd.rows[0]?.d||"").slice(0,10);
      const printBank=await defaultBank(company);
      const rtoName=String(x.rto||x.rto_name||"").trim();let rto_address="";
      if(rtoName){const rm=await pool.query("SELECT * FROM simple_master WHERE lower(kind)='rto' AND lower(name)=lower($1) ORDER BY id DESC LIMIT 1",[rtoName]);const rr=rm.rows[0]||{};rto_address=rtoAddressText(rr);}
      const lg=await productLogo(invoice.product_name,x.vehicle_model_name||"");invoice.umrn_code=lg.umrn_code||invoice.umrn_code;(invoice as any).logo_keys=lg.logo_keys;
      return Response.json({invoice,company,product:{umrn_code:invoice.umrn_code,logo_keys:lg.logo_keys,colour_code:invoice.colour_code,name:invoice.product_name},doc_title:doc==="invoice"?"TAX INVOICE":doc.toUpperCase(),doc_no_label:doc==="invoice"?"Bill No.":"Document No.",rto_address,print_bank_name:printBank.name,print_bank_account_no:printBank.account_no,print_bank_ifsc:printBank.ifsc});
    }
  return null;
}

export async function taxInvoicePost(req:Request,path:string[],b:any,a:any,deps:any):Promise<Response|null>{
  const p=path.join("/");
  const {upsertBillingCustomer}=deps||({} as any);
    if(p==="tax-invoices"){
      // Form sends challan_id; resolve dealer/vehicle from the challan when not sent explicitly.
      const chId=num(b.delivery_challan_id||b.challan_id);
      if(chId&&(!num(b.dealer_id)||!num(b.vehicle_id))){
        const dcr=await pool.query("SELECT dealer_id,vehicle_id FROM delivery_challan WHERE id=$1",[chId]);
        if(dcr.rowCount){if(!num(b.dealer_id))b.dealer_id=dcr.rows[0].dealer_id;if(!num(b.vehicle_id))b.vehicle_id=dcr.rows[0].vehicle_id;}
      }
      b.delivery_challan_id=chId||null;
      if(!b.dealer_name&&num(b.dealer_id)){const dn=await pool.query("SELECT name FROM dealer WHERE id=$1",[num(b.dealer_id)]);b.dealer_name=dn.rows[0]?.name||null;}
      const customerId=num(b.customer_id)||await upsertBillingCustomer(b);
      const grossTaxable=num(b.gst_sale_amount||b.sale_amount),discount=Math.max(0,num(b.discount)),taxable=Math.max(0,grossTaxable-discount),rate=num(b.gst_rate);
      const companyState=await pool.query("SELECT state_code FROM company ORDER BY id DESC LIMIT 1");
      const sellerStateCode=String(companyState.rows[0]?.state_code||"").trim(),buyerStateCode=String(b.buyer_state_code||"").trim(),stateType=String(b.state_type||"").trim().toUpperCase();
      const sameState=stateType==="I"||stateType==="INTRA"||(!stateType&&!!sellerStateCode&&sellerStateCode===buyerStateCode),gst=taxable*rate/100;
      await ensureTaxInvoiceRecordColumns();
      const cols=await columns("tax_invoice");
      if(!cols.size)return Response.json({error:"Tax Invoice table not found."},{status:500});
      const values:any={
        bill_no:String(b.bill_no||"").trim()||("INV-"+Date.now()),date:b.date||null,cancelled:false,delivery_challan_id:num(b.delivery_challan_id)||null,
        dealer_id:num(b.dealer_id)||null,vehicle_id:num(b.vehicle_id)||null,buyer_name:b.buyer_name||null,buyer_relation:b.buyer_relation||null,buyer_father_name:b.buyer_father_name||null,buyer_address:b.buyer_address||null,buyer_mobile:b.buyer_mobile||null,buyer_pan:b.buyer_pan||null,buyer_aadhar:b.buyer_aadhar||null,buyer_dob:b.buyer_dob||null,license_no:b.license_no||null,customer_id:customerId,buyer_gst_no:b.buyer_gst_no||null,
        buyer_state:b.buyer_state||null,buyer_state_code:b.buyer_state_code||null,buyer_pincode:String(b.buyer_pincode||"").replace(/\D/g,"").slice(0,6)||null,state_type:b.state_type||null,product_name:b.product_name||null,
        chassis_no:b.chassis_no||null,motor_no:b.motor_no||null,sale_amount:num(b.sale_amount),gst_sale_amount:taxable,gst_rate:rate,
        discount:num(b.discount),insurance_amount:num(b.insurance_amount),registration_amount:num(b.registration_amount),
        amount_received:num(b.amount_received),subsidy_amount:num(b.subsidy_amount),dealer_name:b.dealer_name||null,created_at:new Date(),
        // RTO (prints bottom-left of the invoice) and bank details; only columns that exist are written.
        rto_name:b.rto_name||null,rto:b.rto_name||null,bank_name:b.bank_name||null,bank_account_no:b.bank_account_no||null,bank_ifsc:b.bank_ifsc||null
      };
      const keys=Object.keys(values).filter(k=>cols.has(k)),ph=keys.map((_,i)=>"$"+(i+1));
      if(!keys.length)return Response.json({error:"No compatible Tax Invoice columns found."},{status:500});
      const r=await pool.query('INSERT INTO tax_invoice ('+keys.map(k=>'"'+k+'"').join(",")+') VALUES ('+ph.join(",")+') RETURNING *',keys.map(k=>values[k]));
      if(num(b.vehicle_id)){
        const vc=await columns("vehicle");
        if(vc.has("stage")) await pool.query("UPDATE vehicle SET stage='Tax Invoice'"+(vc.has("dealer_name")?",dealer_name=COALESCE($1,dealer_name)":"")+" WHERE id="+(vc.has("dealer_name")?"$2":"$1"),vc.has("dealer_name")?[b.dealer_name||null,num(b.vehicle_id)]:[num(b.vehicle_id)]);
      }
      return Response.json({success:true,row:r.rows[0],data:r.rows[0],gst:{rate,amount:gst,cgst:sameState?gst/2:0,sgst:sameState?gst/2:0,igst:sameState?0:gst}},{status:201});
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
    if(p.startsWith("tax-invoices/") && p.endsWith("/print")){
      const id=idOf(path[path.length-2]); const r=await pool.query("SELECT ti.*,"+TI_CALC+" FROM tax_invoice ti WHERE ti.id=$1",[id]);
      return Response.json({success:true,data:r.rows[0]||null});
    }
  return null;
}

export async function taxInvoiceMutation(req:Request,path:string[],method:string,a:any,deps:any):Promise<Response|null>{
  const p=path.join("/");

    if(p.startsWith("tax-invoices/") && p.endsWith("/payment") && method==="POST"){
      const id=idOf(path[path.length-2]),b:any=await json(req);
      if(!id)return Response.json({error:"Invoice id required."},{status:400});
      const r=await pool.query("UPDATE tax_invoice SET amount_received=COALESCE(amount_received,0)+$1 WHERE id=$2 RETURNING *",[num(b.amount),id]);
      return Response.json({success:r.rowCount>0,row:r.rows[0]||null});
    }
    if(p.startsWith("tax-invoices/") && p.endsWith("/print") && method==="POST"){
      const id=idOf(path[path.length-2]); const r=await pool.query("SELECT ti.*,"+TI_CALC+" FROM tax_invoice ti WHERE ti.id=$1",[id]);
      return Response.json({success:true,data:r.rows[0]||null});
    }
    if(p.startsWith("dealer/tax-invoices/") && method==="PUT" && a.scope==="dealer"){
      const id=idOf(path[path.length-1]),b:any=await json(req); if(!id)return Response.json({error:"Invoice id required."},{status:400});
      const did=num(a.dealer_id);
      const inv=(await pool.query("SELECT * FROM tax_invoice WHERE id=$1 AND (dealer_id=$2 OR (dealer_id IS NULL AND lower(btrim(COALESCE(dealer_name,'')))=lower(btrim(COALESCE((SELECT name FROM dealer WHERE id=$2),''))))) LIMIT 1",[id,did])).rows[0];
      if(!inv)return Response.json({error:"Tax Invoice not found."},{status:404});
      const allowed=['dealer_page_no','sale_amount','loan_amount'];
      const unknown=Object.keys(b||{}).filter((k)=>!allowed.includes(k));
      if(unknown.length)return Response.json({error:"Dealer sirf Page No., Sale Amount aur Loan Amount edit kar sakta hai."},{status:403});
      const sets:string[]=[],vals:any[]=[];
      if(Object.prototype.hasOwnProperty.call(b,'dealer_page_no')){vals.push(String(b.dealer_page_no||"").trim()||null);sets.push("dealer_page_no=$"+vals.length);}
      for(const key of ['sale_amount','loan_amount']){
        if(!Object.prototype.hasOwnProperty.call(b,key))continue;
        const n=Number(b[key]);
        if(!Number.isFinite(n)||n<0)return Response.json({error:"Invalid "+key+"."},{status:400});
        const col=key==='sale_amount'?'sale_amount':'hypothecation_amount';
        if(num(inv[col])!==0)return Response.json({error:(key==='sale_amount'?"Sale Amount":"Loan Amount")+" already filled hai, isliye edit nahi ho sakta."},{status:403});
        vals.push(n);sets.push(col+"=$"+vals.length);
      }
      if(!sets.length)return Response.json({error:"Koi editable field nahi mili."},{status:400});
      vals.push(id);
      const r=await pool.query("UPDATE tax_invoice SET "+sets.join(",")+" WHERE id=$"+vals.length+" RETURNING *",vals);
      await audit(a,"dealer/tax-invoices","edit",id,inv,r.rows[0],did,r.rows[0]?.bill_no||id);
      return Response.json({success:true,row:r.rows[0]});
    }
  return null;
}
