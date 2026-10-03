// Reports (GET): Profit & Loss, Showroom Stock, Dealer Stock, Ledger, Ledger-V, Purchase Register, Showroom Expenses Report.
// Bade route file se nikala gaya; queries/logic same hain. Route ke local helpers D (deps) me aate hain.
import { pool, num, idOf, ymd, columns, csvResponse, dateWhere } from "./common";
import { ensureDealerCashSchema, shopExpenseLedgerEvents } from "./dealer-cashbook";

export async function reportsGet(req:Request,path:string[],a:any,D:any):Promise<Response|null>{
  const p=path.join("/");
  const {ensureOldRickshawLegacySchema,parseItems,purchaseBillTotals,purchaseExtraTotal,purchaseLegacyNum}=D;
  if(p==='reports/profit-loss'){
      const u=new URL(req.url),ymd=(d:Date)=>d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0')+'-'+String(d.getUTCDate()).padStart(2,'0');
      const from=u.searchParams.get('from')||ymd(new Date(Date.UTC(new Date().getUTCFullYear(),0,1))),to=u.searchParams.get('to')||ymd(new Date());
      const prevDay=ymd(new Date(new Date(from+'T00:00:00Z').getTime()-86400000));
      // Sales = taxable value (GST excluded, same basis as GST register) of non-cancelled tax invoices.
      const sales=await pool.query(`SELECT COALESCE(SUM(GREATEST(COALESCE(gst_sale_amount,sale_amount,0)-COALESCE(discount,0),0)),0) sales FROM tax_invoice WHERE COALESCE(cancelled,false)=false AND date BETWEEN $1::date AND $2::date`,[from,to]);
      // Purchases = taxable value from bill items (GST is input credit, not cost).
      const pb=await pool.query(`SELECT * FROM purchase_bill WHERE date BETWEEN $1::date AND $2::date`,[from,to]);
      const purchase=pb.rows.reduce((t:number,x:any)=>{const v=purchaseBillTotals(x).taxable;return t+(v||num(x.taxable_amt)||num(x.total_amt));},0);
      const expenses=await pool.query(`SELECT COALESCE(SUM(COALESCE(amount,0)),0) expenses FROM expense_payment_voucher WHERE COALESCE(status,'') NOT IN ('rejected','cancelled') AND date BETWEEN $1::date AND $2::date`,[from,to]);
      // Stock is valued at cost (purchase price first), never at selling price, otherwise profit is overstated.
      // Product table me jo price columns maujood hain wahi use hote hain (purani DB me purchase_price column nahi hota -> pehle yahan 500 error aata tha).
      const pcols=await columns("product");
      const listCols=["sale_price","ex_showroom_price"].filter(c=>pcols.has(c));
      const ownExpr=pcols.has("purchase_price")?"COALESCE(p.purchase_price,0)":"0";
      const listExpr=listCols.length?"COALESCE("+listCols.map(c=>"NULLIF(p."+c+",0)").join(",")+",0)":"0";
      const subExpr=pcols.has("sub_group_name")?"COALESCE(p.sub_group_name,'Primary')":"'Primary'";
      const products=await pool.query(`SELECT p.id,p.name,${pcols.has('code')?'p.code':'NULL::text'} AS code,${pcols.has('unit')?'p.unit':'NULL::text'} AS unit,${ownExpr} own_cost,${listExpr} list_rate,COALESCE((SELECT SUM(CASE WHEN UPPER(COALESCE(js.work_type,''))='OUT' THEN -ABS(js.qty) WHEN UPPER(COALESCE(js.work_type,''))='IN' THEN ABS(js.qty) ELSE js.qty END) FROM journal_stock js WHERE lower(trim(js.item_name))=lower(trim(p.name)) AND js.date <= $1::date),0) opening_qty,COALESCE((SELECT SUM(CASE WHEN UPPER(COALESCE(js.work_type,''))='OUT' THEN -ABS(js.qty) WHEN UPPER(COALESCE(js.work_type,''))='IN' THEN ABS(js.qty) ELSE js.qty END) FROM journal_stock js WHERE lower(trim(js.item_name))=lower(trim(p.name)) AND js.date <= $2::date),0) closing_qty,${subExpr} sub_group_name FROM product p ORDER BY p.name`,[prevDay,to]);
      // Stock rate (cost): 1) product ka apna Purchase Price, 2) us date tak ke aakhri Purchase Bill ka rate (GST ke bina), 3) list price.
      const billsUpTo=(await pool.query(`SELECT date,items FROM purchase_bill WHERE date <= $1::date ORDER BY date ASC,id ASC`,[to]).catch(()=>({rows:[] as any[]}))).rows;
      // (is block me ymd() Date maangta hai, isliye date ko string slice se compare kiya hai)
      const lastRates=(upTo:string)=>{const m=new Map<string,number>();for(const b of billsUpTo){if(String(b.date||"").slice(0,10)>upTo)continue;for(const it of parseItems(b.items)){const k=String(it?.item_name||"").trim().toLowerCase(),r=num(it?.rate);if(k&&r>0)m.set(k,r);}}return m;};
      const rateOpen=lastRates(prevDay),rateClose=lastRates(to);
      const rows=products.rows.map((x:any)=>{
        const k=String(x.name||"").trim().toLowerCase(),own=num(x.own_cost),list=num(x.list_rate);
        const pick=(m:Map<string,number>)=>own>0?{r:own,src:"Purchase Price"}:m.get(k)?{r:m.get(k) as number,src:"Last Purchase Bill"}:list>0?{r:list,src:"List Price"}:{r:0,src:"Not set"};
        const o=pick(rateOpen),c=pick(rateClose);
        const {own_cost,list_rate,...rest}=x;
        return {...rest,rate:c.r,rate_source:c.src,opening_rate:o.r,opening_value:Number(x.opening_qty||0)*o.r,closing_value:Number(x.closing_qty||0)*c.r};
      });
      const opening=rows.reduce((t:number,x:any)=>t+x.opening_value,0),closing=rows.reduce((t:number,x:any)=>t+x.closing_value,0),sale=Number(sales.rows[0]?.sales||0),expense=Number(expenses.rows[0]?.expenses||0),cogs=opening+purchase-closing,gross=sale-cogs,net=gross-expense;
      const hb=await pool.query(`SELECT COALESCE(NULLIF(btrim(account_head),''),'Unassigned') AS account_head,COALESCE(NULLIF(btrim(account_sub_category),''),'-') AS sub_category,COALESCE(SUM(COALESCE(amount,0)),0) AS amount FROM expense_payment_voucher WHERE COALESCE(status,'') NOT IN ('rejected','cancelled') AND date BETWEEN $1::date AND $2::date GROUP BY 1,2 ORDER BY 3 DESC`,[from,to]).then((r:any)=>r.rows.map((x:any)=>({...x,amount:Number(x.amount)}))).catch(()=>[]);
      return Response.json({from,to,opening_stock:opening,purchases:purchase,sales:sale,closing_stock:closing,cost_of_goods_sold:cogs,gross_profit:gross,expenses:expense,net_profit:net,expense_heads:hb,rows});
    }
  if(p==="reports/showroom-stock"&&a.scope==="staff"){
      await ensureOldRickshawLegacySchema();
      const r=await pool.query("SELECT d.id,d.code,d.name,COALESCE(n.c,0)::int AS stock_new,COALESCE(o.c,0)::int AS stock_old FROM dealer d LEFT JOIN (SELECT lower(trim(dealer_name)) AS k,COUNT(*) AS c FROM vehicle WHERE stage='Delivery Challan' GROUP BY 1) n ON n.k=lower(trim(d.name)) LEFT JOIN (SELECT dealer_id,COUNT(*) AS c FROM old_rickshaw WHERE status='available' GROUP BY 1) o ON o.dealer_id=d.id WHERE LOWER(COALESCE(d.dealer_category,'')) IN ('showroom','branch') ORDER BY d.name");
      const rows=r.rows.map((x:any)=>({dealer_id:x.id,dealer_code:x.code,dealer_name:x.name,stock_new:x.stock_new,stock_old:x.stock_old,stock_total:x.stock_new+x.stock_old}));
      return Response.json({rows,total_stock:rows.reduce((t:number,x:any)=>t+x.stock_total,0)});
    }
  if(p==="reports/dealer-stock"&&a.scope==="staff"){
      const did=idOf(new URL(req.url).searchParams.get("dealer_id"));
      if(!did)return Response.json({error:"dealer_id required."},{status:400});
      const dr=await pool.query("SELECT id,code,name FROM dealer WHERE id=$1",[did]);
      if(!dr.rowCount)return Response.json({error:"Dealer not found."},{status:404});
      await ensureOldRickshawLegacySchema();
      const nv=await pool.query("SELECT v.id,COALESCE(dc.date,v.date) AS date,dc.challan_no,v.chassis_no,COALESCE(NULLIF(trim(COALESCE(v.model_name,'')),''),NULLIF(trim(COALESCE(dc.product_name,'')),''),'') AS model_name,v.colour,COALESCE(v.battery_maker,'') AS battery_maker FROM vehicle v LEFT JOIN LATERAL (SELECT * FROM delivery_challan c WHERE c.vehicle_id=v.id AND COALESCE(c.cancelled,false)=false ORDER BY c.id DESC LIMIT 1) dc ON true WHERE v.stage='Delivery Challan' AND lower(trim(COALESCE(v.dealer_name,'')))=lower(trim($1)) ORDER BY COALESCE(dc.date,v.date) DESC,v.id DESC",[dr.rows[0].name]);
      const ov=await pool.query("SELECT id,date,challan_no,vehicle_reg_no,model_name,colour,COALESCE(battery_maker,'') AS battery_maker,repo_date FROM old_rickshaw WHERE status='available' AND dealer_id=$1 ORDER BY date DESC,id DESC",[did]);
      return Response.json({dealer:dr.rows[0],new_vehicles:nv.rows,old_rickshaws:ov.rows,counts:{new:nv.rowCount,old:ov.rowCount,total:(nv.rowCount||0)+(ov.rowCount||0)}});
    }
  if(p==="reports/ledger"){
      const u=new URL(req.url),dealerId=idOf(u.searchParams.get("dealer_id")),from=String(u.searchParams.get("from")||"").trim(),to=String(u.searchParams.get("to")||"").trim(),search=String(u.searchParams.get("search")||"").trim().toLowerCase();
      const dealerCols=await columns("dealer");
      const dealerWhere=dealerCols.has("blocked")?" WHERE COALESCE(blocked,false)=false":"";
      const dealers=(await pool.query("SELECT id,name FROM dealer"+dealerWhere+" ORDER BY name,id")).rows;
      const dealerNameMap=new Map(dealers.map((d:any)=>[Number(d.id),String(d.name||"").trim().toLowerCase()]));
      const tiCols=await columns("tax_invoice"),dbCols=await columns("day_book");
      const invoices=tiCols.size?(await pool.query("SELECT * FROM tax_invoice WHERE COALESCE(cancelled,false)=false ORDER BY date ASC,id ASC LIMIT 20000")).rows:[];
      const daybook=dbCols.size?(await pool.query("SELECT * FROM day_book ORDER BY date ASC,id ASC LIMIT 20000")).rows:[];
      const dealerMatch=(x:any,did:number)=>{
        const rid=Number(x.dealer_id||0);
        if(rid)return rid===did;
        const target=dealerNameMap.get(did)||"";
        const party=String(x.dealer_name||x.party_name||x.account_name||x.account||"").trim().toLowerCase();
        return Boolean(target)&&party===target;
      };
      const textOf=(x:any)=>[x.bill_no,x.voucher_no,x.doc_no,x.party_name,x.dealer_name,x.buyer_name,x.chassis_no,x.narration,x.particulars,x.description].filter(Boolean).join(" ").toLowerCase();
      const inRange=(x:any)=>{const d=ymd(x.date);return (!from||d>=from)&&(!to||d<=to)&&(!search||textOf(x).includes(search));};
      let shopExpenseRows:any[]=[];
      try{await ensureDealerCashSchema();shopExpenseRows=(await pool.query("SELECT * FROM dealer_cash_expense ORDER BY date ASC,id ASC LIMIT 20000")).rows;}catch(e){console.error("[ledger shop expenses]",e)}
      const shopExpenseEvents=(did:number)=>shopExpenseLedgerEvents(shopExpenseRows.filter((x:any)=>Number(x.dealer_id)===did)).filter((x:any)=>inRange(x));
      const saleEvents=(did:number)=>invoices.filter((x:any)=>dealerMatch(x,did)&&inRange(x)).map((x:any)=>({
        record_type:"sale",record_id:x.id,date:x.date,doc_no:x.bill_no||x.voucher_no||"",account:x.buyer_name||"Sale",
        lines:[x.product_name,x.chassis_no].filter(Boolean),
        debit:Math.max(0,num(x.sale_amount)-num(x.hypothecation_amount)),credit:0,vr_type:"S"
      }));
      const receiptEvents=(did:number)=>daybook.filter((x:any)=>dealerMatch(x,did)&&inRange(x)).map((x:any)=>({
        record_type:"receipt",record_id:x.id,date:x.date,doc_no:x.voucher_no||x.doc_no||x.bill_no||"",
        account:x.party_name||x.account_name||x.account||dealerNameMap.get(did)||"Day Book",
        lines:[x.narration||x.particulars||x.description||""].filter(Boolean),
        debit:num(x.debit||x.dr_amount||x.debit_amount||x.debit_paid),
        credit:num(x.credit||x.cr_amount||x.credit_amount||x.credit_received),vr_type:"R"
      })).filter((x:any)=>x.debit||x.credit);
      if(!dealerId){
        const summary=dealers.map((d:any)=>{
          const ev=[...saleEvents(Number(d.id)),...receiptEvents(Number(d.id)),...shopExpenseEvents(Number(d.id))];
          const balance=ev.reduce((s:number,x:any)=>s+num(x.debit)-num(x.credit),0);
          return {dealer_id:d.id,dealer_name:d.name,balance,dc:balance>=0?"Dr":"Cr"};
        });
        return Response.json({summary,dealers,events:[],rows:[],count:summary.length});
      }
      const selected=dealers.find((d:any)=>Number(d.id)===dealerId);
      if(!selected)return Response.json({error:"Dealer not found."},{status:404});
      const events=[...saleEvents(dealerId),...receiptEvents(dealerId),...shopExpenseEvents(dealerId)].sort((a:any,b:any)=>{
        const da=String(a.date||""),db=String(b.date||"");return da.localeCompare(db)||Number(a.record_id||0)-Number(b.record_id||0);
      });      let running=0;
      const out=events.map((x:any)=>{running+=num(x.debit)-num(x.credit);return {...x,balance:Math.abs(running),dc:running>=0?"Dr":"Cr"};});
      return Response.json({summary:[],dealers,events:out,rows:out,count:out.length});
    }
  if(p==="reports/ledger-v"){
      const u=new URL(req.url),dealerId=idOf(u.searchParams.get("dealer_id")),from=String(u.searchParams.get("from")||"").trim(),to=String(u.searchParams.get("to")||"").trim(),search=String(u.searchParams.get("search")||"").trim().toLowerCase();
      const dealerCols=await columns("dealer"),dealerWhere=dealerCols.has("blocked")?" WHERE COALESCE(blocked,false)=false":"";
      const dealers=(await pool.query("SELECT id,name FROM dealer"+dealerWhere+" ORDER BY name,id")).rows;
      const tiCols=await columns("tax_invoice"),dbCols=await columns("day_book");
      const invoices=tiCols.size?(await pool.query("SELECT * FROM tax_invoice WHERE COALESCE(cancelled,false)=false ORDER BY date ASC,id ASC LIMIT 20000")).rows:[];
      const daybook=dbCols.size?(await pool.query("SELECT * FROM day_book ORDER BY date ASC,id ASC LIMIT 20000")).rows:[];
      const dealerNameMap=new Map(dealers.map((d:any)=>[Number(d.id),String(d.name||"").trim().toLowerCase()]));
      const match=(x:any,did:number)=>{
        const rid=Number(x.dealer_id||0); if(rid)return rid===did;
        const target=dealerNameMap.get(did)||"";
        return Boolean(target)&&String(x.dealer_name||x.party_name||x.account_name||x.account||"").trim().toLowerCase()===target;
      };
      const build=(did:number)=>{
        const textV=(x:any)=>[x.bill_no,x.voucher_no,x.doc_no,x.party_name,x.dealer_name,x.buyer_name,x.chassis_no,x.narration,x.particulars,x.description].filter(Boolean).join(" ").toLowerCase();
        const inv=invoices.filter((x:any)=>match(x,did)&&(!from||String(x.date||"").slice(0,10)>=from)&&(!to||String(x.date||"").slice(0,10)<=to)&&(!search||textV(x).includes(search)));
        const db=daybook.filter((x:any)=>match(x,did)&&(!from||String(x.date||"").slice(0,10)>=from)&&(!to||String(x.date||"").slice(0,10)<=to)&&(!search||textV(x).includes(search)));
        const events:any[]=[];
        for(const x of inv){
          const received=num(x.amount_received);
          if(!received)continue;
          events.push({date:x.date,doc_no:x.bill_no||"",particulars:"Tax Invoice — "+(x.buyer_name||"Sale"),voucher_no:x.voucher_no||"",bill_no:x.bill_no||"",chassis_no:x.chassis_no||"",customer:x.buyer_name||"",receipt:0,amount_received:received,_kind:"invoice",_id:x.id});
        }
        for(const x of db){
          const receipt=num(x.credit_received||x.credit||x.cr_amount||x.credit_amount);
          if(!receipt)continue;
          events.push({date:x.date,doc_no:x.voucher_no||x.doc_no||"",particulars:x.narration||x.particulars||"Day Book Receipt",voucher_no:x.voucher_no||"",bill_no:x.bill_no||"",chassis_no:x.chassis_no||"",customer:x.party_name||x.account_name||"",receipt,amount_received:0,_kind:"receipt",_id:x.id});
        }
        events.sort((a,b)=>String(a.date||"").localeCompare(String(b.date||""))||Number(a._id||0)-Number(b._id||0));
        let running=0; return events.map(e=>({...e,balance:(running+=num(e.amount_received)-num(e.receipt))}));
      };
      if(!dealerId){
        const summary=dealers.map((d:any)=>{const events=build(Number(d.id));return {dealer_id:d.id,dealer_name:d.name,total:events.reduce((s:number,e:any)=>s+num(e.amount_received),0)};});
        return Response.json({summary,dealers,events:[],rows:[],count:summary.length});
      }
      const selected=dealers.find((d:any)=>Number(d.id)===dealerId);
      if(!selected)return Response.json({error:"Dealer not found."},{status:404});
      const events=build(dealerId).map((e:any)=>{const {_kind,_id,...rest}=e;return rest;});
      return Response.json({summary:[],dealers,events,rows:events,count:events.length});
    }
  if(p==="reports/purchase-register"){
      const u=new URL(req.url),args:any[]=[]; const {w,search}=dateWhere("pb",u,args);
      if(search){args.push("%"+search+"%");w.push("(COALESCE(pb.bill_no,'') ILIKE $"+args.length+" OR COALESCE(pb.party_name,'') ILIKE $"+args.length+")");}
      const where=w.length?" WHERE "+w.join(" AND "):"";
      const raw=await pool.query("SELECT pb.* FROM purchase_bill pb"+where+" ORDER BY pb.date DESC,pb.id DESC",args);
      const rows=raw.rows.map((pb:any)=>{
        const parsed=parseItems(pb.items);
        const firstNum=(...vals:any[])=>{for(const v of vals){if(v===null||v===undefined||v==="")continue;const n0=Number(v);if(Number.isFinite(n0)&&n0!==0)return n0;}return 0;};
        const state=String(pb.party_state_code||pb.state_code||"07").trim();
        let items=parsed.map((it:any)=>{
          const qty=firstNum(it.qty,it.quantity);
          const rate=firstNum(it.rate,it.unit_rate,it.price);
          const taxable=firstNum(it.taxable_amt,it.taxable_amount,it.taxable,it.subtotal,qty*rate);
          const gstRate=firstNum(it.gst_rate,it.gst_percent);
          const gst=firstNum(it.gst_amount,it.tax_amount,it.gst,taxable*gstRate/100);
          const intra=state==="07" || state.toUpperCase()==="07";
          const cgst=firstNum(it.cgst_amt,it.cgst,it.tax_cgst,intra?gst/2:0);
          const sgst=firstNum(it.sgst_amt,it.sgst,it.tax_sgst,intra?gst/2:0);
          const igst=firstNum(it.igst_amt,it.igst,it.tax_igst,!intra?gst:0);
          const total=firstNum(it.total_amt,it.total_amount,it.amount,taxable+gst);
          return {...it,qty,rate,taxable_amt:taxable,gst_amount:gst,cgst_amt:cgst,sgst_amt:sgst,igst_amt:igst,total_amt:total};
        });
        // Legacy purchase rows may have all financial values on the header and
        // an empty/missing items JSON. Preserve those values instead of showing 0.
        const headerQty=firstNum(pb.total_qty,pb.qty,pb.quantity,pb.item_qty,pb.units,purchaseLegacyNum(pb,[/^(total_)?qty$/,/quantity/,/^units$/],[/amount|rate|price/]));
        const headerTaxable=firstNum(pb.taxable_total,pb.taxable_amt,pb.taxable_amount,pb.taxable,pb.subtotal,pb.amount_before_tax,pb.taxable_value,pb.net_amount,purchaseLegacyNum(pb,[/(taxable|subtotal|sub_total|before_tax|net_amount)/],[/(rate|percent|gst_rate)/]));
        const headerCgst=firstNum(pb.cgst_total,pb.cgst_amt,pb.cgst,pb.tax_cgst,pb.cgst_amount,purchaseLegacyNum(pb,[/cgst/]));
        const headerSgst=firstNum(pb.sgst_total,pb.sgst_amt,pb.sgst,pb.tax_sgst,pb.sgst_amount,purchaseLegacyNum(pb,[/sgst/]));
        const headerIgst=firstNum(pb.igst_total,pb.igst_amt,pb.igst,pb.tax_igst,pb.igst_amount,purchaseLegacyNum(pb,[/igst/]));
        const headerTax=firstNum(pb.tax_total,pb.tax_amt,pb.tax_amount,pb.gst_total,pb.gst_amount,pb.total_tax,pb.gst_amount_total,purchaseLegacyNum(pb,[/tax_total|tax_amount|total_tax|gst_total|gst_amount/],[/rate|percent/]));
        const headerTotal=firstNum(pb.bill_total,pb.total_amt,pb.total_amount,pb.grand_total,pb.amount,pb.net_total,pb.invoice_total,pb.total,purchaseLegacyNum(pb,[/(grand|bill|invoice|net).*total$/,/total.*(amount|value)/,/^total$/],[/(tax|qty|quantity|rate|percent)/]));
        if(!items.length && (headerQty||headerTaxable||headerCgst||headerSgst||headerIgst||headerTax||headerTotal)){
          const tax=headerTax || headerCgst+headerSgst+headerIgst;
          const taxable=headerTaxable || Math.max(0,headerTotal-tax);
          items=[{item_name:pb.item_name||pb.description||"Purchase",qty:headerQty,rate:headerQty?taxable/headerQty:taxable,taxable_amt:taxable,gst_amount:tax,cgst_amt:headerCgst,sgst_amt:headerSgst,igst_amt:headerIgst,total_amt:headerTotal||taxable+tax}];
        }
        let taxable_amt=items.reduce((s:number,x:any)=>s+num(x.taxable_amt),0);
        let cgst_amt=items.reduce((s:number,x:any)=>s+num(x.cgst_amt),0);
        let sgst_amt=items.reduce((s:number,x:any)=>s+num(x.sgst_amt),0);
        let igst_amt=items.reduce((s:number,x:any)=>s+num(x.igst_amt),0);
        let total_amt=items.reduce((s:number,x:any)=>s+num(x.total_amt),0);
        let total_qty=items.reduce((s:number,x:any)=>s+num(x.qty),0);
        // Header totals take precedence when the stored item lines are incomplete.
        taxable_amt=taxable_amt||headerTaxable;
        cgst_amt=cgst_amt||headerCgst;
        sgst_amt=sgst_amt||headerSgst;
        igst_amt=igst_amt||headerIgst;
        total_qty=total_qty||headerQty;
        total_amt=total_amt||headerTotal||(taxable_amt+cgst_amt+sgst_amt+igst_amt);
        const tax_total=cgst_amt+sgst_amt+igst_amt || headerTax;
        const extra_total=purchaseExtraTotal(pb.extra_charges);
        return {...pb,items,taxable_amt,cgst_amt,sgst_amt,igst_amt,tax_total,total_amt:total_amt+extra_total,extra_total,total_qty,item_count:items.length};
      });
      if(u.searchParams.get("export")==="csv")return csvResponse(rows,"Purchase_Register.csv");
      const page=Math.max(1,num(u.searchParams.get("page"))||1),per=Math.min(200,Math.max(1,num(u.searchParams.get("per_page"))||50)),start=(page-1)*per;
      const pageRows=rows.slice(start,start+per),totals=pageRows.reduce((a:any,x:any)=>(a.taxable+=num(x.taxable_amt),a.cgst+=num(x.cgst_amt),a.sgst+=num(x.sgst_amt),a.igst+=num(x.igst_amt),a.qty+=num(x.total_qty),a.total+=num(x.total_amt),a),{taxable:0,cgst:0,sgst:0,igst:0,qty:0,total:0});
      return Response.json({rows:pageRows,page,per_page:per,total:rows.length,total_pages:Math.max(1,Math.ceil(rows.length/per)),totals});
    }
  if(p==="showroom/expenses-reports"){
      const u=new URL(req.url),from=String(u.searchParams.get("from")||"").trim(),to=String(u.searchParams.get("to")||"").trim(),search=String(u.searchParams.get("search")||"").trim().toLowerCase();
      const vcols=await columns("expense_payment_voucher");
      const vsql=vcols.has("dealer_id")
        ?"SELECT v.*,d.name AS dealer_name FROM expense_payment_voucher v LEFT JOIN dealer d ON d.id=v.dealer_id ORDER BY v.date DESC,v.id DESC LIMIT 5000"
        :"SELECT * FROM expense_payment_voucher ORDER BY date DESC,id DESC LIMIT 5000";
      const vouchers=(await pool.query(vsql)).rows;
      let shop:any[]=[];
      try{await ensureDealerCashSchema();shop=(await pool.query("SELECT e.*,d.name AS dealer_name FROM dealer_cash_expense e LEFT JOIN dealer d ON d.id=e.dealer_id ORDER BY e.date DESC,e.id DESC LIMIT 5000")).rows;}catch(e){console.error("[showroom expenses]",e);shop=[]}
      const inRange=(r:any)=>{const d=ymd(r.date||r.expense_date);return (!from||(d&&d>=from))&&(!to||(d&&d<=to))};
      const textOf=(r:any)=>[r.expense_type_name,r.expense_type,r.pay_to_name,r.dealer_name,r.remarks,r.bill_no,r.voucher_no,r.category,r.category_label,r.paid_to,r.expense_no].filter(Boolean).join(" ").toLowerCase();
      // Cancelled / inactive rows total me nahi gino (ledger bhi sirf ACTIVE shop expense leta hai).
      const voucherLive=(r:any)=>!["CANCELLED","CANCELED","DELETED"].includes(String(r.status||"").trim().toUpperCase())&&r.cancelled!==true;
      const shopLive=(r:any)=>String(r.status||"ACTIVE").trim().toUpperCase()==="ACTIVE";
      const v=vouchers.filter((r:any)=>voucherLive(r)&&inRange(r)&&(!search||textOf(r).includes(search)));
      const s=shop.filter((r:any)=>shopLive(r)&&inRange(r)&&(!search||textOf(r).includes(search)));
      const voucher_total=v.reduce((n:number,r:any)=>n+num(r.amount),0),shop_total=s.reduce((n:number,r:any)=>n+num(r.amount),0);
      return Response.json({vouchers:v,shop_expenses:s,voucher_total,shop_total,total_expenses:voucher_total+shop_total});
    }
  return null;
}
