// Insurance Register + RTO Expense Register: schema, validation, list/ledger/export, create, bulk import, edit/delete.
// Bade route file se nikala gaya; queries/logic same hain.
import { pool, num, idOf, ymd, todayDate, importAmount, importDate, rowGetter } from "./common";
import { audit } from "./permissions";
let insuranceRegisterSchemaReady:Promise<void>|null=null;
function ensureInsuranceRegisterSchema():Promise<void>{
  if(!insuranceRegisterSchemaReady){
    insuranceRegisterSchemaReady=(async()=>{
      await pool.query(`CREATE TABLE IF NOT EXISTS insurance_register (
        id bigserial PRIMARY KEY, insurance_type text NOT NULL, date date NOT NULL DEFAULT CURRENT_DATE,
        customer_name text NOT NULL DEFAULT '', total_premium numeric(14,2) NOT NULL DEFAULT 0,
        net_premium numeric(14,2) NOT NULL DEFAULT 0, discount_rate numeric(8,4) NOT NULL DEFAULT 0,
        payable_amount numeric(14,2) NOT NULL DEFAULT 0, insurer text NOT NULL DEFAULT '',
        chassis_no text, bill_no text, sp_no text, vehicle text, dealer_id bigint, remarks text,
        created_by text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      )`);
      await pool.query("CREATE INDEX IF NOT EXISTS insurance_register_type_idx ON insurance_register(insurance_type)");
      await pool.query("CREATE INDEX IF NOT EXISTS insurance_register_chassis_idx ON insurance_register(lower(btrim(chassis_no)))");
      await pool.query("CREATE INDEX IF NOT EXISTS insurance_register_bill_idx ON insurance_register(lower(btrim(bill_no)))");
      await pool.query("CREATE INDEX IF NOT EXISTS insurance_register_sp_idx ON insurance_register(lower(btrim(sp_no)))");
    })().catch(e=>{insuranceRegisterSchemaReady=null;throw e});
  }
  return insuranceRegisterSchemaReady;
}
// Shared validation for Insurance Register create/edit/import. NEW: unique by Chassis No. OLD: unique by SP No. (else Vehicle).
async function insuranceValidate(b:any,editId:any,client:any=pool,seen:Set<string>|null=null,fromImport=false):Promise<{error?:string,status?:number,f?:any}>{
  const type=String(b.insurance_type||"NEW").toUpperCase(); if(!["NEW","OLD"].includes(type))return {error:"insurance_type must be NEW or OLD."};
  const chassis=String(b.chassis_no||"").trim(),sp=String(b.sp_no||"").trim(),vehicle=String(b.vehicle||"").trim(),customer=String(b.customer_name||"").trim(),insurer=String(b.insurer||"").trim();
  const date=b.date&&b.date!=="INVALID"?importDate(b.date):(b.date==="INVALID"?null:todayDate());
  if(!date)return {error:"Invalid date."};
  if(!customer)return {error:"Customer Name required."}; if(!insurer)return {error:"Insurer required."};
  if(type==="OLD"&&!sp&&!vehicle)return {error:"Old Insurance me SP No. ya Vehicle required hai."};
  const total=fromImport?Number(b.total_premium||0):num(b.total_premium),disc=fromImport?Number(b.discount_rate||0):num(b.discount_rate);
  if(total<0||disc<0||disc>100)return {error:"Invalid premium / discount."};
  const net=b.net_premium!==undefined&&b.net_premium!==""?num(b.net_premium):Math.round(total*(1-disc/100)*100)/100;
  const payable=b.payable_amount!==undefined&&b.payable_amount!==""?num(b.payable_amount):net;
  const dupCol=type==="NEW"?"chassis_no":(sp?"sp_no":"vehicle"),dupVal=type==="NEW"?chassis:(sp||vehicle);
  const k=type+"|"+dupCol+"|"+dupVal.toLowerCase();
  if(seen&&!(type==="NEW"&&!chassis)){if(seen.has(k))return {error:"Duplicate in file: "+dupVal,status:409};seen.add(k);}
  const d=(type==="NEW"&&!chassis)?{rows:[]}:await client.query(`SELECT id FROM insurance_register WHERE insurance_type=$1 AND lower(btrim(${dupCol}))=lower(btrim($2)) AND ($3::bigint IS NULL OR id<>$3::bigint) LIMIT 1`,[type,dupVal,idOf(editId)]);
  if(d.rows.length)return {error:(type==="NEW"?"This Chassis No. is already registered in Insurance: ":"This "+(sp?"SP No.":"Vehicle")+" is already registered in Old Insurance: ")+dupVal,status:409};
  return {f:{type,date,customer,insurer,total,disc,net,payable,chassis,sp,vehicle,bill:String(b.bill_no||"").trim()}};
}
// ---- RTO Expense Register (outside expense - never printed on invoice; Registration Fee on invoice is separate) ----
let rtoRegisterSchemaReady:Promise<void>|null=null;
function ensureRtoRegisterSchema():Promise<void>{
  if(!rtoRegisterSchemaReady){
    rtoRegisterSchemaReady=(async()=>{
      await pool.query(`CREATE TABLE IF NOT EXISTS rto_expense_register (
        id bigserial PRIMARY KEY, rto_type text NOT NULL, date date NOT NULL DEFAULT CURRENT_DATE,
        customer_name text NOT NULL DEFAULT '', amount numeric(14,2) NOT NULL DEFAULT 0, work_type text,
        rto_agent text NOT NULL DEFAULT '', chassis_no text, bill_no text, sp_no text, vehicle text, dealer_id bigint, remarks text,
        created_by text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      )`);
      await pool.query("CREATE INDEX IF NOT EXISTS rto_register_type_idx ON rto_expense_register(rto_type)");
      await pool.query("CREATE INDEX IF NOT EXISTS rto_register_chassis_idx ON rto_expense_register(lower(btrim(chassis_no)))");
      await pool.query("CREATE INDEX IF NOT EXISTS rto_register_sp_idx ON rto_expense_register(lower(btrim(sp_no)))");
      await pool.query("CREATE INDEX IF NOT EXISTS rto_register_agent_idx ON rto_expense_register(lower(btrim(rto_agent)))");
    })().catch(e=>{rtoRegisterSchemaReady=null;throw e});
  }
  return rtoRegisterSchemaReady;
}
// One RTO work per chassis / SP is the normal case, but a vehicle can have several works (transfer, HP, fitness). Duplicate = same
// chassis (or SP/vehicle) + same work_type + same amount + same date, so re-importing a file never doubles the data.
async function rtoValidate(b:any,editId:any,client:any=pool,seen:Set<string>|null=null,fromImport=false):Promise<{error?:string,status?:number,f?:any}>{
  const type=String(b.rto_type||"NEW").toUpperCase(); if(!["NEW","OLD"].includes(type))return {error:"rto_type must be NEW or OLD."};
  const chassis=String(b.chassis_no||"").trim(),sp=String(b.sp_no||"").trim(),vehicle=String(b.vehicle||"").trim(),customer=String(b.customer_name||"").trim(),agent=String(b.rto_agent||"").trim(),work=String(b.work_type||"").trim();
  const date=b.date==="INVALID"?null:(b.date?importDate(b.date):todayDate()); if(!date)return {error:"Invalid date."};
  if(!customer)return {error:"Customer Name required."}; if(!agent)return {error:"RTO Agent / Passing Person required."};
  if(type==="NEW"&&!chassis)return {error:"New RTO Expense me Chassis No. required hai."};
  if(type==="OLD"&&!sp&&!vehicle)return {error:"Old RTO Expense me SP No. ya Vehicle required hai."};
  const amount=fromImport?Number(b.amount||0):num(b.amount); if(!(amount>0))return {error:"RTO Expense amount must be greater than 0."};
  const col=type==="NEW"?"chassis_no":(sp?"sp_no":"vehicle"),val=type==="NEW"?chassis:(sp||vehicle);
  const k=[type,col,val.toLowerCase(),work.toLowerCase(),amount,date].join("|");
  if(seen){if(seen.has(k))return {error:"Duplicate in file: "+val,status:409};seen.add(k);}
  const d=await client.query(`SELECT id FROM rto_expense_register WHERE rto_type=$1 AND lower(btrim(${col}))=lower(btrim($2)) AND lower(btrim(COALESCE(work_type,'')))=lower($3) AND amount=$4 AND date=$5::date AND ($6::bigint IS NULL OR id<>$6::bigint) LIMIT 1`,[type,val,work.toLowerCase(),amount,date,idOf(editId)]);
  if(d.rows.length)return {error:"RTO expense already registered for "+val+" ("+(work||"same work")+", same date & amount).",status:409};
  return {f:{type,date,customer,agent,amount,work,chassis,sp,vehicle,bill:String(b.bill_no||"").trim()}};
}

export async function insuranceRtoGet(req:Request,path:string[],a:any):Promise<Response|null>{
  const p=path.join("/");
  if(p==="insurance-register/ledger"){
      await ensureInsuranceRegisterSchema();
      const u=new URL(req.url),insurer=String(u.searchParams.get("insurer")||"").trim();
      if(!insurer)return Response.json({error:"insurer required."},{status:400});
      const inv=await pool.query(`SELECT id,date,customer_name,insurance_type,chassis_no,bill_no,sp_no,vehicle,payable_amount,created_at FROM insurance_register WHERE lower(btrim(insurer))=lower(btrim($1))`,[insurer]);
      const pay=await pool.query(`SELECT id,date,voucher_no,amount,payment_mode,remarks,status,created_at FROM expense_payment_voucher WHERE lower(COALESCE(expense_type,'')) IN ('insurance','insurance_expense') AND lower(btrim(COALESCE(pay_to_name,'')))=lower(btrim($1)) AND UPPER(COALESCE(status,'')) NOT IN ('CANCELLED','CANCELED','REJECTED')`,[insurer]).catch(()=>({rows:[]}));
      const ev:any[]=[];
      for(const r of inv.rows)ev.push({t:new Date(r.created_at).getTime(),date:ymd(r.date),kind:"INSURANCE",particulars:(r.customer_name||"")+(r.insurance_type==="OLD"?" (Old)":""),ref:[r.chassis_no||r.sp_no||r.vehicle||"",r.bill_no?("Bill "+r.bill_no):""].filter(Boolean).join(" · "),credit:Number(r.payable_amount||0),debit:0,status:""});
      for(const r of pay.rows)ev.push({t:new Date(r.created_at).getTime(),date:ymd(r.date),kind:"PAYMENT",particulars:"Payment"+(r.payment_mode?" ("+String(r.payment_mode).toUpperCase()+")":"")+(r.remarks?" — "+r.remarks:""),ref:r.voucher_no||"",credit:0,debit:Number(r.amount||0),status:String(r.status||"")});
      ev.sort((a,b)=>a.date===b.date?a.t-b.t:(a.date<b.date?-1:1));
      let bal=0,tc=0,td=0;
      const rows=ev.map(e=>{bal=Math.round((bal+e.credit-e.debit)*100)/100;tc+=e.credit;td+=e.debit;return {date:e.date,kind:e.kind,particulars:e.particulars,ref:e.ref,credit:e.credit,debit:e.debit,balance:bal,status:e.status};});
      return Response.json({insurer,rows,total_credit:Math.round(tc*100)/100,total_debit:Math.round(td*100)/100,balance:bal});
    }
  if(p==="insurance-register"){
      await ensureInsuranceRegisterSchema();
      const u=new URL(req.url),type=String(u.searchParams.get("type")||"NEW").toUpperCase()==="OLD"?"OLD":"NEW";
      const q=String(u.searchParams.get("search")||"").trim(),st=String(u.searchParams.get("status")||"all").toLowerCase();
      const args:any[]=[type],where=["insurance_type=$1"];
      if(q){args.push("%"+q+"%");where.push("(customer_name ILIKE $2 OR insurer ILIKE $2 OR COALESCE(chassis_no,'') ILIKE $2 OR COALESCE(bill_no,'') ILIKE $2 OR COALESCE(sp_no,'') ILIKE $2 OR COALESCE(vehicle,'') ILIKE $2)");}
      const rr=await pool.query(`SELECT * FROM insurance_register WHERE ${where.join(" AND ")} ORDER BY date DESC,id DESC LIMIT 10000`,args);
      const rows=rr.rows,lc=(v:any)=>String(v||"").trim().toLowerCase();
      // Batched lookups (was 2 queries per row -> timeouts on big lists).
      const invByChassis=new Map<string,any>(),invByBill=new Map<string,any>(),orBySp=new Map<string,any>(),orByReg=new Map<string,any>();
      if(type==="NEW"){
        const ch=[...new Set(rows.map((r:any)=>lc(r.chassis_no)).filter(Boolean))],bl=[...new Set(rows.map((r:any)=>lc(r.bill_no)).filter(Boolean))];
        if(ch.length||bl.length){const mr=await pool.query(`SELECT id,bill_no,buyer_name,chassis_no FROM tax_invoice WHERE COALESCE(cancelled,false)=false AND (lower(btrim(COALESCE(chassis_no,'')))=ANY($1::text[]) OR lower(btrim(COALESCE(bill_no,'')))=ANY($2::text[])) ORDER BY id`,[ch,bl]).catch(()=>({rows:[]}));
          for(const x of mr.rows){if(lc(x.chassis_no))invByChassis.set(lc(x.chassis_no),x);if(lc(x.bill_no))invByBill.set(lc(x.bill_no),x);}}
      }else{
        // Old insurance is tagged against Old Rickshaw inventory (SP No. / vehicle reg no.).
        const sp=[...new Set(rows.map((r:any)=>lc(r.sp_no)).filter(Boolean))],rg=[...new Set(rows.map((r:any)=>lc(r.vehicle).replace(/[\s-]+/g,"")).filter(Boolean))];
        if(sp.length||rg.length){const mr=await pool.query(`SELECT id,sp_no,vehicle_reg_no,owner_name FROM old_rickshaw WHERE lower(btrim(COALESCE(sp_no,'')))=ANY($1::text[]) OR lower(regexp_replace(COALESCE(vehicle_reg_no,''),'[\\s-]+','','g'))=ANY($2::text[]) ORDER BY id`,[sp,rg]).catch(()=>({rows:[]}));
          for(const x of mr.rows){if(lc(x.sp_no))orBySp.set(lc(x.sp_no),x);if(lc(x.vehicle_reg_no))orByReg.set(lc(x.vehicle_reg_no).replace(/[\s-]+/g,""),x);}}
      }
      const out=rows.map((r:any)=>{
        if(type==="NEW"){const m=invByChassis.get(lc(r.chassis_no))||invByBill.get(lc(r.bill_no))||null;
          return {...r,mapping_status:m?"BILLED":"UNBILLED",mapped_bill_no:m?.bill_no||"",mapped_invoice_id:m?.id||null,mapped_customer:m?.buyer_name||"",mapped_chassis:m?.chassis_no||""};}
        const m=orBySp.get(lc(r.sp_no))||orByReg.get(lc(r.vehicle).replace(/[\s-]+/g,""))||null;
        return {...r,mapping_status:m?"TAGGED":"UNTAGGED",mapped_old_rickshaw_id:m?.id||null,mapped_customer:m?.owner_name||""};
      });
      const filtered=st==="billed"||st==="tagged"?out.filter((r:any)=>["BILLED","TAGGED"].includes(r.mapping_status)):st==="unbilled"||st==="untagged"?out.filter((r:any)=>!["BILLED","TAGGED"].includes(r.mapping_status)):out;
      // On-account insurer ledger: payments are NOT tied to a record; balance = total payable (New+Old) - vouchers paid to that insurer.
      const pay=await pool.query(`SELECT lower(btrim(insurer)) k,MAX(insurer) insurer,COALESCE(SUM(payable_amount) FILTER (WHERE insurance_type='NEW'),0) new_payable,COALESCE(SUM(payable_amount) FILTER (WHERE insurance_type='OLD'),0) old_payable,COUNT(*) records FROM insurance_register GROUP BY lower(btrim(insurer))`);
      const paid=await pool.query(`SELECT lower(btrim(pay_to_name)) k,COALESCE(SUM(amount),0) paid FROM expense_payment_voucher WHERE lower(COALESCE(expense_type,'')) IN ('insurance','insurance_expense') AND UPPER(COALESCE(status,'')) NOT IN ('CANCELLED','CANCELED','REJECTED') GROUP BY lower(btrim(pay_to_name))`).catch(()=>({rows:[]}));
      const paidMap=new Map(paid.rows.map((x:any)=>[x.k,Number(x.paid)]));
      const insurer_summary=pay.rows.filter((x:any)=>x.k).map((x:any)=>{const np=Number(x.new_payable),op=Number(x.old_payable),pd=paidMap.get(x.k)||0;return {insurer:x.insurer,records:Number(x.records),new_payable:np,old_payable:op,payable:np+op,paid:pd,balance:np+op-pd};}).sort((a:any,b:any)=>b.balance-a.balance);
      return Response.json({rows:filtered,insurers:[...new Set(rows.map((r:any)=>String(r.insurer||"").trim()).filter(Boolean))],insurer_summary});
    }
  if(p==="rto-register"){
      await ensureRtoRegisterSchema();
      const u=new URL(req.url),type=String(u.searchParams.get("type")||"NEW").toUpperCase()==="OLD"?"OLD":"NEW";
      const q=String(u.searchParams.get("search")||"").trim(),st=String(u.searchParams.get("status")||"all").toLowerCase();
      const args:any[]=[type],where=["rto_type=$1"];
      if(q){args.push("%"+q+"%");where.push("(customer_name ILIKE $2 OR rto_agent ILIKE $2 OR COALESCE(work_type,'') ILIKE $2 OR COALESCE(chassis_no,'') ILIKE $2 OR COALESCE(bill_no,'') ILIKE $2 OR COALESCE(sp_no,'') ILIKE $2 OR COALESCE(vehicle,'') ILIKE $2)");}
      const rr=await pool.query(`SELECT * FROM rto_expense_register WHERE ${where.join(" AND ")} ORDER BY date DESC,id DESC LIMIT 10000`,args);
      const rows=rr.rows,lc=(v:any)=>String(v||"").trim().toLowerCase(),nospace=(v:any)=>lc(v).replace(/[\s-]+/g,"");
      const invByChassis=new Map<string,any>(),invByBill=new Map<string,any>(),orBySp=new Map<string,any>(),orByReg=new Map<string,any>();
      if(type==="NEW"){
        const ch=[...new Set(rows.map((r:any)=>lc(r.chassis_no)).filter(Boolean))],bl=[...new Set(rows.map((r:any)=>lc(r.bill_no)).filter(Boolean))];
        if(ch.length||bl.length){const mr=await pool.query(`SELECT id,bill_no,buyer_name,chassis_no FROM tax_invoice WHERE COALESCE(cancelled,false)=false AND (lower(btrim(COALESCE(chassis_no,'')))=ANY($1::text[]) OR lower(btrim(COALESCE(bill_no,'')))=ANY($2::text[])) ORDER BY id`,[ch,bl]).catch(()=>({rows:[]}));
          for(const x of mr.rows){if(lc(x.chassis_no))invByChassis.set(lc(x.chassis_no),x);if(lc(x.bill_no))invByBill.set(lc(x.bill_no),x);}}
      }else{
        const sp=[...new Set(rows.map((r:any)=>lc(r.sp_no)).filter(Boolean))],rg=[...new Set(rows.map((r:any)=>nospace(r.vehicle)).filter(Boolean))];
        if(sp.length||rg.length){const mr=await pool.query(`SELECT id,sp_no,vehicle_reg_no,owner_name FROM old_rickshaw WHERE lower(btrim(COALESCE(sp_no,'')))=ANY($1::text[]) OR lower(regexp_replace(COALESCE(vehicle_reg_no,''),'[\\s-]+','','g'))=ANY($2::text[]) ORDER BY id`,[sp,rg]).catch(()=>({rows:[]}));
          for(const x of mr.rows){if(lc(x.sp_no))orBySp.set(lc(x.sp_no),x);if(lc(x.vehicle_reg_no))orByReg.set(nospace(x.vehicle_reg_no),x);}}
      }
      const out=rows.map((r:any)=>{
        if(type==="NEW"){const m=invByChassis.get(lc(r.chassis_no))||invByBill.get(lc(r.bill_no))||null;return {...r,mapping_status:m?"BILLED":"UNBILLED",mapped_bill_no:m?.bill_no||"",mapped_invoice_id:m?.id||null,mapped_customer:m?.buyer_name||""};}
        const m=orBySp.get(lc(r.sp_no))||orByReg.get(nospace(r.vehicle))||null;return {...r,mapping_status:m?"TAGGED":"UNTAGGED",mapped_old_rickshaw_id:m?.id||null,mapped_customer:m?.owner_name||""};
      });
      const good=["BILLED","TAGGED"];
      const filtered=st==="billed"||st==="tagged"?out.filter((r:any)=>good.includes(r.mapping_status)):st==="unbilled"||st==="untagged"?out.filter((r:any)=>!good.includes(r.mapping_status)):out;
      // On-account agent ledger: expense vouchers (type rto_expense) paid to the agent are not tied to records.
      const pay=await pool.query(`SELECT lower(btrim(rto_agent)) k,MAX(rto_agent) agent,COALESCE(SUM(amount) FILTER (WHERE rto_type='NEW'),0) new_amt,COALESCE(SUM(amount) FILTER (WHERE rto_type='OLD'),0) old_amt,COUNT(*) records FROM rto_expense_register GROUP BY lower(btrim(rto_agent))`);
      const paid=await pool.query(`SELECT lower(btrim(pay_to_name)) k,COALESCE(SUM(amount),0) paid FROM expense_payment_voucher WHERE lower(COALESCE(expense_type,'')) IN ('rto_expense','rto') AND UPPER(COALESCE(status,'')) NOT IN ('CANCELLED','CANCELED','REJECTED') GROUP BY lower(btrim(pay_to_name))`).catch(()=>({rows:[]}));
      const paidMap=new Map(paid.rows.map((x:any)=>[x.k,Number(x.paid)]));
      const agent_summary=pay.rows.filter((x:any)=>x.k).map((x:any)=>{const n=Number(x.new_amt),o=Number(x.old_amt),pd=paidMap.get(x.k)||0;return {agent:x.agent,records:Number(x.records),new_amount:n,old_amount:o,total:n+o,paid:pd,balance:n+o-pd};}).sort((a:any,b:any)=>b.balance-a.balance);
      const pm=await pool.query("SELECT DISTINCT name FROM simple_master WHERE lower(kind)='party' AND lower(COALESCE(sub_category,''))='rto' AND COALESCE(name,'')<>'' ORDER BY name").catch(()=>({rows:[]}));
      return Response.json({rows:filtered,agents:pm.rows.map((x:any)=>x.name),agent_summary});
    }
  if(p==="insurance-register/export"){
      await ensureInsuranceRegisterSchema();
      const u=new URL(req.url),type=String(u.searchParams.get("type")||"NEW").toUpperCase();
      const rr=await pool.query("SELECT * FROM insurance_register WHERE insurance_type=$1 ORDER BY date DESC,id DESC",[type]);
      return Response.json({rows:rr.rows});
    }
  return null;
}

export async function insuranceRtoPost(req:Request,path:string[],b:any,a:any):Promise<Response|null>{
  const p=path.join("/");
  if(p==="rto-register"){
      await ensureRtoRegisterSchema();
      const v=await rtoValidate(b,null); if(v.error)return Response.json({error:v.error},{status:v.status||400}); const f=v.f!;
      const r=await pool.query(`INSERT INTO rto_expense_register (rto_type,date,customer_name,amount,work_type,rto_agent,chassis_no,bill_no,sp_no,vehicle,dealer_id,remarks,created_by) VALUES($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [f.type,f.date,f.customer,f.amount,f.work||null,f.agent,f.chassis||null,f.bill||null,f.sp||null,f.vehicle||null,idOf(b.dealer_id),b.remarks||null,String(a?.username||"")]);
      await audit(a,"rto-register","create",r.rows[0].id,null,r.rows[0],r.rows[0].dealer_id,r.rows[0].chassis_no||r.rows[0].sp_no);
      return Response.json({success:true,row:r.rows[0]});
    }
  if(p==="rto-register/import"){
      await ensureRtoRegisterSchema();
      const type=String(b.rto_type||"NEW").toUpperCase(),rows=Array.isArray(b.rows)?b.rows:[];
      if(!["NEW","OLD"].includes(type))return Response.json({error:"rto_type must be NEW or OLD."},{status:400});
      if(!rows.length)return Response.json({error:"No rows supplied."},{status:400});
      const client=await pool.connect(); let inserted=0,mapped=0,duplicates=0; const rejected:any[]=[]; const seenKeys=new Set<string>();
      try{
        await client.query("BEGIN");
        for(let i=0;i<rows.length;i++){
          const g=rowGetter(rows[i]),rowNo=i+2,rawDate=g(["date"]);
          const body:any={rto_type:type,date:rawDate===""?todayDate():importDate(rawDate)||"INVALID",customer_name:g(["customer name","customer","name"]),amount:importAmount(g(["amount","rto expense","rto amount","expense"])),
            work_type:g(["work type","work","particulars","description"]),rto_agent:g(["rto agent","agent","rto passing person","passing person","paid to","party"]),
            chassis_no:g(["chassis no","chassis","chassis number"]),bill_no:g(["bill no","bill","invoice no"]),sp_no:g(["sp no","sp","sp number"]),vehicle:g(["vehicle","vehicle no","vehicle reg no","registration no"]),remarks:g(["remarks"])};
          if(!body.customer_name&&!body.rto_agent&&!body.amount&&!body.chassis_no&&!body.sp_no)continue;
          const v=await rtoValidate(body,null,client,seenKeys,true); if(v.error){if(v.status===409)duplicates++;else rejected.push({row:rowNo,reason:v.error});continue;}
          const f=v.f!;
          await client.query(`INSERT INTO rto_expense_register (rto_type,date,customer_name,amount,work_type,rto_agent,chassis_no,bill_no,sp_no,vehicle,remarks,created_by) VALUES($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[f.type,f.date,f.customer,f.amount,f.work||null,f.agent,f.chassis||null,f.bill||null,f.sp||null,f.vehicle||null,body.remarks||null,String(a?.username||"")]);
          if(type==="NEW"){const mr=await client.query(`SELECT 1 FROM tax_invoice WHERE COALESCE(cancelled,false)=false AND lower(btrim(COALESCE(chassis_no,'')))=lower(btrim($1)) LIMIT 1`,[f.chassis]).catch(()=>({rows:[]}));if(mr.rows.length)mapped++;}
          inserted++;
        }
        await client.query("COMMIT");
      }catch(e){await client.query("ROLLBACK").catch(()=>{});throw e;}finally{client.release();}
      await audit(a,"rto-register","create",null,null,{import:true,type,inserted,duplicates,rejected:rejected.length},null,"RTO import "+type);
      return Response.json({success:true,inserted,mapped,duplicates,rejected:rejected.slice(0,100),rejected_count:rejected.length});
    }
  if(p==="insurance-register"){
      await ensureInsuranceRegisterSchema();
      const v=await insuranceValidate(b,null); if(v.error)return Response.json({error:v.error},{status:v.status||400});
      const f=v.f!;
      const r=await pool.query(`INSERT INTO insurance_register
        (insurance_type,date,customer_name,total_premium,net_premium,discount_rate,payable_amount,insurer,chassis_no,bill_no,sp_no,vehicle,dealer_id,remarks,created_by)
        VALUES($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
        [f.type,f.date,f.customer,f.total,f.net,f.disc,f.payable,f.insurer,f.chassis||null,f.bill||null,f.sp||null,f.vehicle||null,idOf(b.dealer_id),b.remarks||null,String(a?.username||"")]);
      await audit(a,"insurance-register","create",r.rows[0].id,null,r.rows[0],r.rows[0].dealer_id,r.rows[0].chassis_no||r.rows[0].sp_no);
      return Response.json({success:true,row:r.rows[0]});
    }
  if(p==="insurance-register/import"){
      await ensureInsuranceRegisterSchema();
      const type=String(b.insurance_type||"NEW").toUpperCase(),rows=Array.isArray(b.rows)?b.rows:[];
      if(!["NEW","OLD"].includes(type))return Response.json({error:"insurance_type must be NEW or OLD."},{status:400});
      if(!rows.length)return Response.json({error:"No rows supplied."},{status:400});
      const client=await pool.connect(); let inserted=0,mapped=0,duplicates=0,skippedPayments=0; const rejected:any[]=[]; const seenKeys=new Set<string>();
      // Sheet me insurer ka chhota naam (jaise NITIN) ho to Party Master ke insurer (NITIN JAIN) se match karo.
      const pins:string[]=((await pool.query("SELECT DISTINCT name FROM simple_master WHERE lower(kind)='party' AND lower(COALESCE(sub_category,''))='insurance' AND COALESCE(btrim(name),'')<>''").catch(()=>({rows:[]}))).rows as any[]).map((x:any)=>String(x.name).trim());
      const resolveInsurer=(nm:string)=>{const k=nm.toLowerCase();if(!k)return nm;const ex=pins.find(x=>x.toLowerCase()===k);if(ex)return ex;const c=pins.filter(x=>{const l=x.toLowerCase();return l.startsWith(k)||l.includes(k)});return c.length===1?c[0]:nm;};
      try{
        await client.query("BEGIN");
        for(let i=0;i<rows.length;i++){
          const g=rowGetter(rows[i]),rowNo=i+2;
          const rawDate=g(["date"]);
          // Sheet me PAYMENT wali rows (type=PAYMENT / negative amount) insurance record nahi hoti; skip.
          if(/payment/i.test(String(g(["type"])))||importAmount(g(["amount"]))<0){skippedPayments++;continue;}
          const gross=g(["gross","total premium"]);
          let total:number,base=0;
          if(gross!==""){total=importAmount(gross);base=importAmount(g(["premium","base premium","discount premium"]));}
          else total=importAmount(g(["premium"]));
          const rateRaw=g(["discount rate","discount %","discount percent"]),amtRaw=g(["discount amount","discount amt","discount"]);
          let disc=0,netCalc:any="";
          if(rateRaw!=="")disc=importAmount(rateRaw);
          else if(amtRaw!==""){
            const amt=importAmount(amtRaw);
            if(gross!==""){const ref=base>0?base:total;disc=ref>0?Math.round(amt/ref*10000)/100:0;netCalc=Math.round((total-amt)*100)/100;}
            else disc=amt; // purani file: "discount" = percent
          }
          const netRaw=g(["net premium"]),amountRaw=g(["amount"]),payRaw=g(["payable amount","payable"]);
          const refNo=g(["id","ref","ref no","sr no"]);
          const body:any={insurance_type:type,date:rawDate===""?todayDate():importDate(rawDate)||"INVALID",customer_name:g(["customer name","customer","name","applicant name","applicant"]),
            total_premium:total,discount_rate:disc,
            net_premium:netRaw!==""?importAmount(netRaw):amountRaw!==""?importAmount(amountRaw):netCalc,
            payable_amount:payRaw!==""?importAmount(payRaw):amountRaw!==""?importAmount(amountRaw):"",
            insurer:resolveInsurer(String(g(["insurer","insurance provider","agent","zxc"])).trim()),chassis_no:g(["chassis no","chassis","chassis number"]),bill_no:g(["bill no","bill","invoice no"]),
            sp_no:g(["sp no","sp","sp number"]),vehicle:g(["vehicle","vehicle no","vehicle reg no","registration no"]),remarks:g(["remarks"])||(refNo!==""?"Ref: "+refNo:"")};
          if(!body.customer_name&&!body.insurer&&!body.total_premium&&!body.chassis_no&&!body.sp_no)continue;
          const v=await insuranceValidate(body,null,client,seenKeys,true); if(v.error){if(v.status===409)duplicates++;else rejected.push({row:rowNo,reason:v.error});continue;}
          const f=v.f!;
          if(type==="NEW"&&!f.chassis){const dq=await client.query(`SELECT 1 FROM insurance_register WHERE insurance_type='NEW' AND COALESCE(btrim(chassis_no),'')='' AND date=$1::date AND lower(btrim(customer_name))=lower(btrim($2)) AND lower(btrim(insurer))=lower(btrim($3)) AND total_premium=$4 LIMIT 1`,[f.date,f.customer,f.insurer,f.total]);if(dq.rows.length){duplicates++;continue;}}
          await client.query(`INSERT INTO insurance_register (insurance_type,date,customer_name,total_premium,net_premium,discount_rate,payable_amount,insurer,chassis_no,bill_no,sp_no,vehicle,remarks,created_by) VALUES($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,[f.type,f.date,f.customer,f.total,f.net,f.disc,f.payable,f.insurer,f.chassis||null,f.bill||null,f.sp||null,f.vehicle||null,body.remarks||null,String(a?.username||"")]);
          if(type==="NEW"){const mr=await client.query(`SELECT 1 FROM tax_invoice WHERE COALESCE(cancelled,false)=false AND lower(btrim(COALESCE(chassis_no,'')))=lower(btrim($1)) LIMIT 1`,[f.chassis]).catch(()=>({rows:[]}));if(mr.rows.length)mapped++;}
          inserted++;
        }
        await client.query("COMMIT");
      }catch(e){await client.query("ROLLBACK").catch(()=>{});throw e;}finally{client.release();}
      await audit(a,"insurance-register","create",null,null,{import:true,type,inserted,duplicates,rejected:rejected.length},null,"Insurance import "+type);
      return Response.json({success:true,inserted,mapped,duplicates,skipped_payments:skippedPayments,rejected:rejected.slice(0,100),rejected_count:rejected.length});
    }
  return null;
}

export async function insuranceRtoMutation(req:Request,path:string[],method:string,a:any,bodyForScope:any):Promise<Response|null>{
  const p=path.join("/");
  if(path[0]==="rto-register"&&path.length===2&&/^\d+$/.test(path[1])){
      await ensureRtoRegisterSchema(); const id=idOf(path[1]);
      const old=(await pool.query("SELECT * FROM rto_expense_register WHERE id=$1",[id])).rows[0]; if(!old)return Response.json({error:"Record not found."},{status:404});
      if(method==="DELETE"){await pool.query("DELETE FROM rto_expense_register WHERE id=$1",[id]);await audit(a,"rto-register","delete",id,old,null,old.dealer_id,old.chassis_no||old.sp_no);return Response.json({success:true});}
      const eb:any={...old,...bodyForScope,rto_type:old.rto_type};
      const v=await rtoValidate(eb,id); if(v.error)return Response.json({error:v.error},{status:v.status||400}); const f=v.f!;
      const r=await pool.query(`UPDATE rto_expense_register SET date=$1::date,customer_name=$2,amount=$3,work_type=$4,rto_agent=$5,chassis_no=$6,bill_no=$7,sp_no=$8,vehicle=$9,remarks=$10,updated_at=now() WHERE id=$11 RETURNING *`,[f.date,f.customer,f.amount,f.work||null,f.agent,f.chassis||null,f.bill||null,f.sp||null,f.vehicle||null,eb.remarks||null,id]);
      await audit(a,"rto-register","edit",id,old,r.rows[0],old.dealer_id,r.rows[0].chassis_no||r.rows[0].sp_no);
      return Response.json({success:true,row:r.rows[0]});
    }
  if(path[0]==="insurance-register"&&path.length===2&&/^\d+$/.test(path[1])){
      await ensureInsuranceRegisterSchema(); const id=idOf(path[1]);
      const old=(await pool.query("SELECT * FROM insurance_register WHERE id=$1",[id])).rows[0]; if(!old)return Response.json({error:"Record not found."},{status:404});
      if(method==="DELETE"){await pool.query("DELETE FROM insurance_register WHERE id=$1",[id]);await audit(a,"insurance-register","delete",id,old,null,old.dealer_id,old.chassis_no||old.sp_no);return Response.json({success:true});}
      const eb:any={...old,...bodyForScope,insurance_type:old.insurance_type};
      const v=await insuranceValidate(eb,id); if(v.error)return Response.json({error:v.error},{status:v.status||400}); const f=v.f!;
      const r=await pool.query(`UPDATE insurance_register SET date=$1::date,customer_name=$2,total_premium=$3,net_premium=$4,discount_rate=$5,payable_amount=$6,insurer=$7,chassis_no=$8,bill_no=$9,sp_no=$10,vehicle=$11,remarks=$12,updated_at=now() WHERE id=$13 RETURNING *`,[f.date,f.customer,f.total,f.net,f.disc,f.payable,f.insurer,f.chassis||null,f.bill||null,f.sp||null,f.vehicle||null,eb.remarks||null,id]);
      await audit(a,"insurance-register","edit",id,old,r.rows[0],old.dealer_id,r.rows[0].chassis_no||r.rows[0].sp_no);
      return Response.json({success:true,row:r.rows[0]});
    }
  return null;
}
