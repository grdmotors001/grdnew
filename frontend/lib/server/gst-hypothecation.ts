// GST Register, Hypothecation Register, Subsidy Report aur Hypothecation Receipts (financer se aaya loan paisa).
// Bade route file se nikala gaya, logic/queries same hain. Sale Register / Payment Receivable pehle se reports-sales.ts me hain.
import { pool, num, idOf, todayDate, columns, csvResponse } from "./common";
import { audit } from "./permissions";
import { taxInvoiceReportRows } from "./reports-sales";

let tiVehNoReady:Promise<void>|null=null;
export function ensureTaxInvoiceVehicleNoColumn():Promise<void>{
  if(!tiVehNoReady)tiVehNoReady=pool.query("ALTER TABLE tax_invoice ADD COLUMN IF NOT EXISTS vehicle_reg_no text").then(()=>{}).catch(e=>{tiVehNoReady=null;throw e});
  return tiVehNoReady;
}
let hypReceiptSchemaReady:Promise<void>|null=null;
export function ensureHypReceiptSchema():Promise<void>{
  if(!hypReceiptSchemaReady){
    hypReceiptSchemaReady=(async()=>{
      await ensureTaxInvoiceVehicleNoColumn();
      await pool.query(`CREATE TABLE IF NOT EXISTS hypothecation_receipt (
        id bigserial PRIMARY KEY, receipt_date date NOT NULL DEFAULT CURRENT_DATE, financer_name text NOT NULL DEFAULT '',
        amount numeric(14,2) NOT NULL DEFAULT 0, cheque_no text NOT NULL DEFAULT '', tax_invoice_id bigint NOT NULL,
        chassis_no text, vehicle_no text, bill_no text, buyer_name text, remarks text, created_by text,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
      await pool.query("ALTER TABLE hypothecation_receipt ADD COLUMN IF NOT EXISTS pay_mode text NOT NULL DEFAULT 'CASH'");
      await pool.query("ALTER TABLE hypothecation_receipt ADD COLUMN IF NOT EXISTS bank_name text");
      await pool.query("ALTER TABLE hypothecation_receipt ADD COLUMN IF NOT EXISTS day_book_id bigint");
      await pool.query("ALTER TABLE hypothecation_receipt ADD COLUMN IF NOT EXISTS bank_ledger_id bigint");
      await pool.query("CREATE INDEX IF NOT EXISTS hyp_receipt_invoice_idx ON hypothecation_receipt(tax_invoice_id)");
      await pool.query("CREATE INDEX IF NOT EXISTS hyp_receipt_date_idx ON hypothecation_receipt(receipt_date DESC)");
      await pool.query("CREATE INDEX IF NOT EXISTS hyp_receipt_cheque_idx ON hypothecation_receipt(lower(btrim(cheque_no)))");
    })().catch(e=>{hypReceiptSchemaReady=null;throw e});
  }
  return hypReceiptSchemaReady;
}
const hypNormChassis=(v:any)=>String(v??"").toUpperCase().replace(/\s+/g,"");
const hypNormVeh=(v:any)=>String(v??"").toUpperCase().replace(/[\s-]+/g,"");
const hypNormName=(v:any)=>String(v??"").toLowerCase().replace(/[^a-z0-9]/g,"");
// Finds live tax invoices by chassis no. (preferred) or, when no chassis is given, by vehicle no.
export async function hypFindInvoices(chassis:any,vehicle:any){
  await ensureHypReceiptSchema();
  const c=hypNormChassis(chassis),v=hypNormVeh(vehicle),args:any[]=[];
  let cond="";
  if(c){args.push(c);cond="upper(regexp_replace(COALESCE(ti.chassis_no,''),'\\s','','g'))=$1";}
  else if(v){args.push(v);cond="upper(regexp_replace(COALESCE(ti.vehicle_reg_no,''),'[\\s-]','','g'))=$1";}
  else return [];
  const r=await pool.query(`SELECT ti.id,to_char(ti.date,'YYYY-MM-DD') AS date,ti.bill_no,ti.buyer_name,ti.chassis_no,ti.dealer_name,ti.product_name,ti.financer_name,ti.hypothecation_amount,
    COALESCE(ti.vehicle_reg_no,'') AS vehicle_no,
    COALESCE((SELECT SUM(hr.amount) FROM hypothecation_receipt hr WHERE hr.tax_invoice_id=ti.id),0) AS fin_received
    FROM tax_invoice ti WHERE COALESCE(ti.cancelled,false)=false AND ${cond} ORDER BY ti.date DESC,ti.id DESC LIMIT 5`,args);
  return r.rows.map((x:any)=>{const hyp=num(x.hypothecation_amount),rec=num(x.fin_received);return {...x,hypothecation_amount:hyp,fin_received:rec,balance:Math.max(0,hyp-rec),has_loan:hyp>0};});
}
// GET reports/gst-register | reports/hypothecation-register | reports/subsidy
export async function gstHypSubsidyReport(req:Request,path:string[],deps:any):Promise<Response|null>{
  const p=path.join("/");
  const {purchaseBillTotals}=deps||({} as any);
    if(p==="reports/gst-register"||p==="reports/hypothecation-register"||p==="reports/subsidy"){
      const u=new URL(req.url);
      const rows=await taxInvoiceReportRows(u);
      if(p==="reports/hypothecation-register"){
        await ensureHypReceiptSchema();
        const hypRows=rows.filter((x:any)=>num(x.hypothecation_amount)>0),ids=hypRows.map((x:any)=>Number(x.id));
        const recQ=ids.length?await pool.query("SELECT tax_invoice_id,SUM(amount) AS s FROM hypothecation_receipt WHERE tax_invoice_id=ANY($1::bigint[]) GROUP BY tax_invoice_id",[ids]):{rows:[] as any[]};
        const vehQ=ids.length?await pool.query("SELECT id,COALESCE(to_jsonb(ti)->>'vehicle_reg_no','') AS v FROM tax_invoice ti WHERE id=ANY($1::bigint[])",[ids]):{rows:[] as any[]};
        const recMap=new Map<number,number>(recQ.rows.map((x:any)=>[Number(x.tax_invoice_id),num(x.s)]));
        const vehMap=new Map<number,string>(vehQ.rows.map((x:any)=>[Number(x.id),String(x.v||"")]));
        const invoices=hypRows.map((x:any)=>{const fr=recMap.get(Number(x.id))||0;return {...x,vehicle_no:vehMap.get(Number(x.id))||"",fin_received:fr,balance_amount:Math.max(0,num(x.hypothecation_amount)-fr)};});
        if(u.searchParams.get("export")==="csv")return csvResponse(invoices.map((x:any)=>({date:x.date,bill_no:x.bill_no,dealer_name:x.dealer_name,buyer_name:x.buyer_name,chassis_no:x.chassis_no,vehicle_no:x.vehicle_no,financer_name:x.financer_name,hypothecation_amount:x.hypothecation_amount,financer_received:x.fin_received,balance_amount:x.balance_amount})),"Hypothecation_Register.csv");
        const total_hyp=invoices.reduce((t:number,x:any)=>t+num(x.hypothecation_amount),0),total_received=invoices.reduce((t:number,x:any)=>t+num(x.fin_received),0);
        return Response.json({invoices,total_hyp,total_received,total_balance:invoices.reduce((t:number,x:any)=>t+num(x.balance_amount),0),rows:invoices});
      }
      if(u.searchParams.get("export")==="csv")return csvResponse(rows,p==="reports/gst-register"?"GST_Register.csv":"Subsidy_Report.csv");
      if(p==="reports/gst-register"){
        const inwardRaw=await pool.query("SELECT pb.id,pb.date,pb.bill_no AS doc_no,pb.party_name,pb.party_state_code,pb.items FROM purchase_bill pb ORDER BY pb.date DESC,pb.id DESC");
        const inward={rows:inwardRaw.rows.map((x:any)=>{const t=purchaseBillTotals(x);return {id:x.id,date:x.date,doc_no:x.doc_no,party_name:x.party_name,...t,total:t.taxable+t.cgst+t.sgst+t.igst}})};
        const ot=rows.reduce((a:any,x:any)=>(a.taxable+=num(x.taxable_value),a.cgst+=num(x.cgst_amount),a.sgst+=num(x.sgst_amount),a.igst+=num(x.igst_amount),a),{taxable:0,cgst:0,sgst:0,igst:0});
        const it=inward.rows.reduce((a:any,x:any)=>(a.taxable+=num(x.taxable),a.cgst+=num(x.cgst),a.sgst+=num(x.sgst),a.igst+=num(x.igst),a),{taxable:0,cgst:0,sgst:0,igst:0});
        return Response.json({outward:rows,outward_totals:ot,inward:inward.rows,inward_totals:it});
      }
      if(p==="reports/subsidy")return Response.json({invoices:rows.filter((x:any)=>num(x.subsidy_amount)!==0),total_subsidy:rows.reduce((s:number,x:any)=>s+num(x.subsidy_amount),0)});
    }
  return null;
}

// GET hypothecation-receipts/lookup | hypothecation-receipts
export async function hypothecationGet(req:Request,path:string[],deps:any):Promise<Response|null>{
  const p=path.join("/");
  const {importDate}=deps||({} as any);
    if(p==="hypothecation-receipts/lookup"){
      const u=new URL(req.url);
      const invoices=await hypFindInvoices(u.searchParams.get("chassis_no")||"",u.searchParams.get("vehicle_no")||"");
      return Response.json({found:invoices.length>0,invoice:invoices[0]||null,invoices});
    }
    if(p==="hypothecation-receipts"){
      await ensureHypReceiptSchema();
      const u=new URL(req.url),q=String(u.searchParams.get("search")||"").trim(),from=importDate(u.searchParams.get("from")||""),to=importDate(u.searchParams.get("to")||"");
      const args:any[]=[],where:string[]=[];
      if(q){args.push("%"+q+"%");const i=args.length;where.push(`(financer_name ILIKE $${i} OR cheque_no ILIKE $${i} OR COALESCE(chassis_no,'') ILIKE $${i} OR COALESCE(vehicle_no,'') ILIKE $${i} OR COALESCE(bill_no,'') ILIKE $${i} OR COALESCE(buyer_name,'') ILIKE $${i})`);}
      if(from){args.push(from);where.push(`receipt_date>=$${args.length}::date`);}
      if(to){args.push(to);where.push(`receipt_date<=$${args.length}::date`);}
      const r=await pool.query(`SELECT id,to_char(receipt_date,'YYYY-MM-DD') AS receipt_date,financer_name,amount,cheque_no,tax_invoice_id,chassis_no,vehicle_no,bill_no,buyer_name,remarks,created_by,pay_mode,bank_name FROM hypothecation_receipt ${where.length?"WHERE "+where.join(" AND "):""} ORDER BY receipt_date DESC,id DESC LIMIT 500`,args);
      return Response.json({receipts:r.rows,rows:r.rows,total:r.rows.reduce((t:number,x:any)=>t+num(x.amount),0)});
    }
  return null;
}

// POST hypothecation-receipts (cash => Day Book credit, bank => Bank Ledger entry)
export async function hypothecationPost(req:Request,path:string[],b:any,a:any,deps:any):Promise<Response|null>{
  const p=path.join("/");
  const {importDate,importAmount,ensureBankLedgerSchema}=deps||({} as any);
    if(p==="hypothecation-receipts"){
      await ensureHypReceiptSchema();
      const rawDate=b.receipt_date||b.date,date=rawDate?importDate(rawDate):todayDate();
      if(!date)return Response.json({error:"Receipt date galat hai (dd-mm-yyyy)."},{status:400});
      const financer=String(b.financer_name||"").trim(),cheque=String(b.cheque_no||"").trim(),amount=importAmount(b.amount);
      if(!financer)return Response.json({error:"Financer name required."},{status:400});
      if(!(amount>0))return Response.json({error:"Amount 0 se zyada hona chahiye."},{status:400});
      const isBank=String(b.pay_mode||"").toLowerCase()==="bank",bankName=String(b.bank_name||"").trim();
      if(isBank&&!bankName)return Response.json({error:"Bank ka naam chuno."},{status:400});
      if(!cheque&&isBank)return Response.json({error:"Bank receipt me Cheque No. / Ref No. required hai."},{status:400});
      if(!cheque)return Response.json({error:"Cheque No. / Ref No. required."},{status:400});
      if(!hypNormChassis(b.chassis_no)&&!hypNormVeh(b.vehicle_no))return Response.json({error:"Chassis No. ya Vehicle No. daalo."},{status:400});
      const inv:any=(await hypFindInvoices(b.chassis_no,b.vehicle_no))[0];
      if(!inv)return Response.json({error:"Is Chassis / Vehicle No. ka koi bill nahi mila."},{status:400});
      if(!inv.has_loan)return Response.json({error:"Bill "+(inv.bill_no||"")+" par loan (hypothecation) nahi hai."},{status:400});
      const dup=await pool.query("SELECT id FROM hypothecation_receipt WHERE tax_invoice_id=$1 AND lower(btrim(cheque_no))=lower($2) AND amount=$3 LIMIT 1",[inv.id,cheque,amount]);
      if(dup.rowCount)return Response.json({error:"Ye receipt (same cheque/ref, amount, chassis) pehle se entered hai."},{status:409});
      const warnings:string[]=[],typedVeh=hypNormVeh(b.vehicle_no);
      let vehicleNo=String(inv.vehicle_no||"");
      if(!vehicleNo&&typedVeh){await pool.query("UPDATE tax_invoice SET vehicle_reg_no=$1 WHERE id=$2",[typedVeh,inv.id]);vehicleNo=typedVeh;}
      else if(vehicleNo&&typedVeh&&hypNormVeh(vehicleNo)!==typedVeh)warnings.push("Bill par vehicle no. "+vehicleNo+" hai, wahi rakha gaya (aapka "+typedVeh+" ignore hua).");
      if(inv.financer_name&&hypNormName(inv.financer_name)!==hypNormName(financer))warnings.push("Bill me financer '"+inv.financer_name+"' hai, receipt '"+financer+"' ke naam se bani.");
      if(inv.fin_received+amount>inv.hypothecation_amount+0.005)warnings.push("Total receipt loan amount se zyada ho gayi (Loan "+inv.hypothecation_amount+", ab tak+ye "+(inv.fin_received+amount)+").");
      const narr="Financer receipt - "+financer+" | Bill "+(inv.bill_no||"-")+" | Chassis "+(inv.chassis_no||"-")+" | Ref "+cheque;
      if(isBank)await ensureBankLedgerSchema();
      const client=await pool.connect();
      let rrow:any;
      try{
        await client.query("BEGIN");
        let dayBookId:any=null,bankLedgerId:any=null;
        if(isBank){
          const bl=await client.query("INSERT INTO bank_ledger_entry(entry_date,amount,bank_name,cheque_no,narration,party_name,entry_type,status,source,created_by) VALUES($1::date,$2,$3,$4,$5,$6,'RECEIPT','POSTED','HYP_RECEIPT',$7) RETURNING id",[date,amount,bankName,cheque,narr,financer,String(a?.username||"")]);
          bankLedgerId=bl.rows[0].id;
        }else{
          const dbc=await columns("day_book");
          if(!dbc.size)throw new Error("Day Book table nahi mili.");
          const vt=(await client.query("SELECT data_type FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='day_book' AND column_name='vr_no'")).rows[0]?.data_type||"";
          let vrNo:any=null;
          if(["integer","bigint","smallint","numeric"].includes(vt))vrNo=Number((await client.query("SELECT COALESCE(MAX(vr_no),0)+1 AS n FROM day_book")).rows[0]?.n||1);
          else if(vt)vrNo="HR-"+Date.now();
          const entry:any={date,vr_no:vrNo,dealer_name:financer,party_name:financer,credit_received:amount,debit_paid:0,payment_mode:"cash",mode:"cash",narration:narr,remarks:narr};
          const keys=Object.keys(entry).filter(k=>dbc.has(k)&&!(k==="vr_no"&&vrNo==null));
          const ins=await client.query('INSERT INTO day_book ('+keys.map(k=>'"'+k+'"').join(",")+') VALUES ('+keys.map((_,i)=>"$"+(i+1)).join(",")+') RETURNING id',keys.map(k=>entry[k]));
          dayBookId=ins.rows[0]?.id||null;
        }
        const r=await client.query("INSERT INTO hypothecation_receipt(receipt_date,financer_name,amount,cheque_no,tax_invoice_id,chassis_no,vehicle_no,bill_no,buyer_name,remarks,created_by,pay_mode,bank_name,day_book_id,bank_ledger_id) VALUES($1::date,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id,to_char(receipt_date,'YYYY-MM-DD') AS receipt_date,financer_name,amount,cheque_no,tax_invoice_id,chassis_no,vehicle_no,bill_no,buyer_name,pay_mode,bank_name",[date,financer,amount,cheque,inv.id,inv.chassis_no||null,vehicleNo||null,inv.bill_no||null,inv.buyer_name||null,String(b.remarks||"").trim()||null,String(a?.username||""),isBank?"BANK":"CASH",isBank?bankName:null,dayBookId,bankLedgerId]);
        rrow=r.rows[0];
        if(bankLedgerId)await client.query("UPDATE bank_ledger_entry SET source_ref=$1 WHERE id=$2",["HYP-"+rrow.id,bankLedgerId]);
        await client.query("COMMIT");
      }catch(e){await client.query("ROLLBACK").catch(()=>{});throw e;}finally{client.release();}
      await audit(a,"hypothecation-receipts","create",rrow.id,null,rrow,null,inv.chassis_no||inv.bill_no||cheque);
      return Response.json({success:true,row:rrow,warnings});
    }
  return null;
}

// DELETE hypothecation-receipts/:id
export async function hypothecationMutation(path:string[],method:string,a:any):Promise<Response|null>{
    if(path[0]==="hypothecation-receipts"){
      if(method!=="DELETE"||path.length!==2)return Response.json({error:"Sirf receipt delete supported hai."},{status:405});
      await ensureHypReceiptSchema(); const id=idOf(path[1]);
      if(!id)return Response.json({error:"Receipt id required."},{status:400});
      const old=(await pool.query("SELECT * FROM hypothecation_receipt WHERE id=$1",[id])).rows[0]; if(!old)return Response.json({error:"Receipt not found."},{status:404});
      const dc=await pool.connect();
      try{
        await dc.query("BEGIN");
        if(old.day_book_id)await dc.query("DELETE FROM day_book WHERE id=$1",[old.day_book_id]);
        if(old.bank_ledger_id)await dc.query("DELETE FROM bank_ledger_entry WHERE id=$1 AND source='HYP_RECEIPT'",[old.bank_ledger_id]);
        await dc.query("DELETE FROM hypothecation_receipt WHERE id=$1",[id]);
        await dc.query("COMMIT");
      }catch(e){await dc.query("ROLLBACK").catch(()=>{});throw e;}finally{dc.release();}
      await audit(a,"hypothecation-receipts","delete",id,old,null,null,old.chassis_no||old.cheque_no);
      return Response.json({success:true});
    }
  return null;
}
