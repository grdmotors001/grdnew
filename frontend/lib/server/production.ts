// Production module (bade route file se nikala gaya, logic/queries same hain):
// Production Voucher, Production Formula, Factory Check, Daily Raw Material Checklist,
// Production Register report aur Production Costing (ADMIN ONLY).
// Delivery Challan wale code ko jo helpers chahiye (formulaNameSql, ensureProduction*Schema) wo export hain.
import { pool, num, idOf, ymd, todayDate, columns, csvResponse, dateWhere } from "./common";
import { audit, isAdmin } from "./permissions";

// Chhote local helpers
const snake=(s:string)=>s.replace(/[A-Z]/g,m=>"_"+m.toLowerCase()).replace(/^_/,"");
function parseItems(v:any){if(Array.isArray(v))return v;if(typeof v==="string"){try{const x=JSON.parse(v);return Array.isArray(x)?x:[]}catch{return []}}return []}

let pvSchemaReady:Promise<void>|null=null;
export function ensureProductionVoucherSchema():Promise<void>{
  if(!pvSchemaReady){pvSchemaReady=pool.query("ALTER TABLE production_voucher ADD COLUMN IF NOT EXISTS formula_name text").then(()=>{}).catch((e:any)=>{pvSchemaReady=null;throw e});}
  return pvSchemaReady;
}
// Formula Name: voucher me saved ho to wahi; khali ho to us product ka akela formula (ek hi hai to) -> warna blank.
export function formulaNameSql(vAlias:string,productExpr:string){
  return "COALESCE(NULLIF(btrim("+vAlias+".formula_name),''),(SELECT CASE WHEN COUNT(DISTINCT pf.formula_name)=1 THEN MIN(pf.formula_name) END FROM production_formula pf WHERE lower(btrim(pf.product_name))=lower(btrim("+productExpr+"))),'')";
}
const NORM=(c:string)=>"lower(regexp_replace(btrim(COALESCE("+c+",'')),'\\s+',' ','g'))";
let _pfSchemaDone=false;
// production_formula.formula_name: column guarantee + blank/NULL rows get product name (same as UI rule "khali = product ka naam"),
// so formula name always shows and rename/save can match rows.
export async function ensureProductionFormulaSchema(){
  if(_pfSchemaDone)return;
  await ensureProductionVoucherSchema();
  await pool.query("ALTER TABLE production_formula ADD COLUMN IF NOT EXISTS formula_name text");
  // 1) product_name in formula rows -> exact Product Master name (fixes stray spaces / case so Voucher & Checklist lookups match)
  await pool.query("UPDATE production_formula pf SET product_name=p.name FROM (SELECT DISTINCT ON ("+NORM("name")+") name,"+NORM("name")+" AS k FROM product ORDER BY "+NORM("name")+",id) p WHERE "+NORM("pf.product_name")+"=p.k AND pf.product_name<>p.name");
  await pool.query("UPDATE production_voucher pv SET product_name=p.name FROM (SELECT DISTINCT ON ("+NORM("name")+") name,"+NORM("name")+" AS k FROM product ORDER BY "+NORM("name")+",id) p WHERE "+NORM("pv.product_name")+"=p.k AND pv.product_name<>p.name");
  // 2) formula_name: trim; blank -> product name
  await pool.query("UPDATE production_formula SET formula_name=btrim(formula_name) WHERE formula_name IS NOT NULL AND formula_name<>btrim(formula_name)");
  await pool.query("UPDATE production_voucher SET formula_name=btrim(formula_name) WHERE formula_name IS NOT NULL AND formula_name<>btrim(formula_name)");
  await pool.query("UPDATE production_formula SET formula_name=product_name WHERE COALESCE(BTRIM(formula_name),'')='' AND COALESCE(product_name,'')<>''");
  await pool.query("UPDATE production_voucher v SET formula_name=v.product_name WHERE COALESCE(BTRIM(v.formula_name),'')='' AND EXISTS (SELECT 1 FROM production_formula f WHERE f.product_name=v.product_name) AND (SELECT COUNT(DISTINCT f.formula_name) FROM production_formula f WHERE f.product_name=v.product_name)=1");
  // Ek formula me ek raw material sirf ek baar. Agar purane duplicate rows hain to index nahi banega (supabase/20261001_production_formula_unique.sql chalayein).
  try{await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS uq_production_formula_line ON production_formula (lower(btrim(COALESCE(product_name,''))),lower(btrim(COALESCE(formula_name,''))),lower(btrim(COALESCE(raw_item_name,''))))");}
  catch(e:any){console.warn("[production_formula] unique index skipped (duplicate rows exist):",e?.message);}
  _pfSchemaDone=true;
}
// Raw material ka current stock (journal_stock: OUT = minus, IN = plus).
async function rawStockBalance(client:any,name:string){
  const r=await client.query("SELECT COALESCE(SUM(CASE WHEN UPPER(COALESCE(work_type,''))='OUT' THEN -ABS(qty) WHEN UPPER(COALESCE(work_type,''))='IN' THEN ABS(qty) ELSE qty END),0) AS balance FROM journal_stock WHERE lower(trim(item_name))=lower(trim($1))",[name]);
  return Number(r.rows[0]?.balance||0);
}
// Production voucher ke formula ke hisab se raw material OUT entries. Stock kam ho to poora transaction fail (throw).
// Jo item is voucher ke liye pehle se kata hua hai use dobara nahi katta.
async function consumeProductionStock(client:any,v:{vou_no:string,date:string|null,product_name:string,formula_name:string,quantity:any}){
  const qty=Math.max(1,Math.trunc(num(v.quantity)||1)),ref=String(v.vou_no);
  const formula=await client.query("SELECT raw_item_name,qty,unit FROM production_formula WHERE product_name=$1 AND ($2='' OR formula_name=$2) ORDER BY id",[v.product_name||"",String(v.formula_name||"")]);
  const done=await client.query("SELECT lower(btrim(item_name)) AS k FROM journal_stock WHERE batch_ref=$1 AND reason='Production Consumption'",[ref]);
  const doneSet=new Set(done.rows.map((r:any)=>r.k));
  const need=new Map<string,{name:string,qty:number}>();
  for(const line of formula.rows){
    const n=num(line.qty)*qty;if(n<=0)continue;
    const k=String(line.raw_item_name||"").trim().toLowerCase();if(!k||doneSet.has(k))continue;
    const cur=need.get(k);if(cur)cur.qty+=n;else need.set(k,{name:String(line.raw_item_name).trim(),qty:n});
  }
  const short:string[]=[];
  // Pehle har item ke liye alag-alag lock + balance query chalti thi (64 items = 128+ slow queries, request time out ho jati thi).
  // Ab ek query me sab lock (id order me, deadlock se bachne ke liye) aur ek query me sab balance.
  const keys=[...need.keys()];
  if(keys.length){
    await client.query("SELECT id FROM product WHERE lower(btrim(name))=ANY($1::text[]) ORDER BY id FOR UPDATE",[keys]);
    const bq=await client.query("SELECT lower(btrim(item_name)) AS k,COALESCE(SUM(CASE WHEN UPPER(COALESCE(work_type,''))='OUT' THEN -ABS(qty) WHEN UPPER(COALESCE(work_type,''))='IN' THEN ABS(qty) ELSE qty END),0) AS balance FROM journal_stock WHERE lower(btrim(item_name))=ANY($1::text[]) GROUP BY 1",[keys]);
    const balMap=new Map<string,number>(bq.rows.map((r:any)=>[String(r.k),Number(r.balance||0)] as [string,number]));
    for(const [k,it] of need.entries()){
      const bal=balMap.get(k)||0;
      if(bal<it.qty)short.push(it.name+" (chahiye "+it.qty+", available "+bal+")");
    }
  }
  if(short.length)throw new Error("Insufficient stock: "+short.join("; "));
  for(const it of need.values())await client.query("INSERT INTO journal_stock (vou_no,date,item_name,item_type,qty,reason,created_at,model_name,work_type,batch_ref) VALUES ($1,COALESCE($2::date,CURRENT_DATE),$3,'RAW',$4,'Production Consumption',NOW(),$5,'OUT',$1)",[ref,v.date||null,it.name,it.qty,v.product_name||null]);
  return formula;
}
// Voucher delete/edit par is voucher ki raw material consumption wapas (stock +).
async function reverseProductionStock(client:any,vouNo:string){
  const r=await client.query("DELETE FROM journal_stock WHERE batch_ref=$1 AND reason='Production Consumption'",[String(vouNo)]);
  return r.rowCount||0;
}
async function ensureFactoryCheckSchema(){
  await pool.query("CREATE TABLE IF NOT EXISTS factory_check_report (id bigserial PRIMARY KEY, production_voucher_id integer NOT NULL UNIQUE, date date NOT NULL DEFAULT CURRENT_DATE, product_name text, quantity numeric NOT NULL DEFAULT 1, status text NOT NULL DEFAULT 'PENDING', approved_by text, approved_at timestamptz, remarks text, created_at timestamptz NOT NULL DEFAULT now())");
  await pool.query("CREATE TABLE IF NOT EXISTS factory_check_item (id bigserial PRIMARY KEY, report_id integer NOT NULL REFERENCES factory_check_report(id) ON DELETE CASCADE, raw_item_name text NOT NULL, expected_qty numeric NOT NULL DEFAULT 0, consumed_qty numeric NOT NULL DEFAULT 0, unit text, additional boolean NOT NULL DEFAULT false, status text NOT NULL DEFAULT 'PENDING', approved_by text, approved_at timestamptz, remarks text, created_at timestamptz NOT NULL DEFAULT now())");
  await pool.query("CREATE INDEX IF NOT EXISTS factory_check_item_report_idx ON factory_check_item(report_id)");
}
async function ensureDailyRawMaterialChecklistSchema(){
  await pool.query(`CREATE TABLE IF NOT EXISTS daily_raw_material_checklist (
    id bigserial PRIMARY KEY,
    date date NOT NULL UNIQUE,
    production_qty numeric NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'PENDING',
    verified_by text,
    verified_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS daily_raw_material_checklist_item (
    id bigserial PRIMARY KEY,
    checklist_id bigint NOT NULL REFERENCES daily_raw_material_checklist(id) ON DELETE CASCADE,
    source_key text NOT NULL,
    product_name text NOT NULL,
    formula_name text,
    production_qty numeric NOT NULL DEFAULT 0,
    raw_item_name text NOT NULL,
    formula_qty_per_unit numeric NOT NULL DEFAULT 0,
    required_qty numeric NOT NULL DEFAULT 0,
    issued_qty numeric NOT NULL DEFAULT 0,
    difference numeric NOT NULL DEFAULT 0,
    unit text NOT NULL DEFAULT 'PCS',
    formula_line_id bigint,
    verified boolean NOT NULL DEFAULT false,
    remarks text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS daily_raw_material_checklist_item_key_idx ON daily_raw_material_checklist_item(checklist_id,source_key)");
  await pool.query("CREATE INDEX IF NOT EXISTS daily_raw_material_checklist_date_idx ON daily_raw_material_checklist(date)");
}
// ===== Production costing (ADMIN ONLY) =========================================================
// Avg cost of one vehicle = SUM( raw-material qty used x weighted-average PURCHASE rate of that item ) / vehicles.
//  * Rate = total taxable purchase value / total purchase qty of that item, using only purchases dated ON OR BEFORE
//    the production voucher date (moving weighted average). GST is excluded (input credit).
//  * If an item has no purchase up to that date, the average of ALL its purchases is used.
//  * If an item was never purchased, it is counted in cost_missing (cost is then understated).
//  * Consumption lines come from: stock journal (Production Consumption) -> production_voucher_item -> formula x qty.
type RateSeries={d:string[],cq:number[],ca:number[]};
let _rateCache:{t:number,idx:Map<string,RateSeries>}|null=null;
const costKey=(s:any)=>String(s??"").replace(/\s+/g," ").trim().toLowerCase();
async function purchaseRateIndex(){
  if(_rateCache&&Date.now()-_rateCache.t<60000)return _rateCache.idx;
  const r=await pool.query("SELECT date,items FROM purchase_bill WHERE date IS NOT NULL");
  const first=(...v:any[])=>{for(const x of v){if(x===null||x===undefined||x==="")continue;const n=Number(x);if(Number.isFinite(n)&&n!==0)return n;}return 0;};
  const raw=new Map<string,{d:string,q:number,a:number}[]>();
  for(const pb of r.rows){
    const d=ymd(pb.date);if(!d)continue;
    for(const it of parseItems(pb.items)){
      const k=costKey(it?.item_name||it?.name);if(!k)continue;
      const q=first(it.qty,it.quantity),rate=first(it.rate,it.unit_rate,it.price);
      const amt=first(it.taxable_amt,it.taxable_amount,it.taxable,it.subtotal,q*rate);
      if(q<=0||amt<=0)continue;
      let arr=raw.get(k);if(!arr){arr=[];raw.set(k,arr);}
      arr.push({d,q,a:amt});
    }
  }
  const idx=new Map<string,RateSeries>();
  for(const [k,arr] of raw){
    arr.sort((x,y)=>x.d<y.d?-1:x.d>y.d?1:0);
    let cq=0,ca=0;const s:RateSeries={d:[],cq:[],ca:[]};
    for(const e of arr){cq+=e.q;ca+=e.a;s.d.push(e.d);s.cq.push(cq);s.ca.push(ca);}
    idx.set(k,s);
  }
  _rateCache={t:Date.now(),idx};
  return idx;
}
function avgRateAsOf(idx:Map<string,RateSeries>,k:string,date:string):number|null{
  const s=idx.get(k);if(!s||!s.d.length)return null;
  let lo=0,hi=s.d.length-1,pos=-1;
  if(date){while(lo<=hi){const m=(lo+hi)>>1;if(s.d[m]<=date){pos=m;lo=m+1}else hi=m-1}}
  const i=pos>=0?pos:s.d.length-1;   // nothing on/before the date -> use all purchases
  return s.cq[i]>0?s.ca[i]/s.cq[i]:null;
}
async function productionCosts(rows:any[]){
  const out=new Map<number,{cost:number,missing:number,lines:number,source:string}>();
  if(!rows.length)return out;
  const idx=await purchaseRateIndex();
  const lines=new Map<number,{k:string,qty:number}[]>(),source=new Map<number,string>();
  // 1) stock journal lines written when the voucher was saved in this app
  const vous=rows.map(r=>String(r.vou_no||"")).filter(Boolean);
  if(vous.length){
    const j=await pool.query("SELECT batch_ref,item_name,ABS(qty) AS qty FROM journal_stock WHERE reason='Production Consumption' AND batch_ref=ANY($1::text[])",[vous]);
    const by=new Map<string,any[]>();
    for(const x of j.rows){let a=by.get(String(x.batch_ref));if(!a){a=[];by.set(String(x.batch_ref),a);}a.push(x);}
    for(const r of rows){const a=by.get(String(r.vou_no||""));if(a&&a.length){lines.set(r.id,a.map(x=>({k:costKey(x.item_name),qty:num(x.qty)})));source.set(r.id,"stock");}}
  }
  // 2) raw-material lines saved with the voucher (imported / older vouchers)
  const need2=rows.filter(r=>!lines.has(r.id)).map(r=>Number(r.id));
  if(need2.length){
    try{
      const it=await pool.query("SELECT voucher_id,item_name,qty FROM production_voucher_item WHERE voucher_id=ANY($1::int[])",[need2]);
      const by=new Map<number,any[]>();
      for(const x of it.rows){let a=by.get(Number(x.voucher_id));if(!a){a=[];by.set(Number(x.voucher_id),a);}a.push(x);}
      for(const id of need2){const a=by.get(id);if(a&&a.length){lines.set(id,a.map(x=>({k:costKey(x.item_name),qty:Math.abs(num(x.qty))})));source.set(id,"items");}}
    }catch{/* table not present in this database */}
  }
  // 3) fallback: Production Formula x voucher quantity
  const need3=rows.filter(r=>!lines.has(r.id));
  if(need3.length){
    const prods=[...new Set(need3.map(r=>costKey(r.product_name)).filter(Boolean))];
    if(prods.length){
      const f=await pool.query("SELECT product_name,formula_name,raw_item_name,qty FROM production_formula WHERE lower(btrim(product_name))=ANY($1::text[])",[prods]);
      for(const r of need3){
        const pk=costKey(r.product_name),fk=costKey(r.formula_name),q=Math.max(1,Math.trunc(num(r.quantity)||1));
        const l=f.rows.filter((x:any)=>costKey(x.product_name)===pk&&(!fk||costKey(x.formula_name)===fk));
        if(l.length){lines.set(r.id,l.map((x:any)=>({k:costKey(x.raw_item_name),qty:num(x.qty)*q})));source.set(r.id,"formula");}
      }
    }
  }
  for(const r of rows){
    const l=lines.get(r.id)||[],d=ymd(r.date),vq=Math.max(1,Math.trunc(num(r.quantity)||1));
    let total=0,missing=0;
    for(const x of l){if(!x.k||x.qty<=0)continue;const rate=avgRateAsOf(idx,x.k,d);if(rate===null)missing++;else total+=x.qty*rate;}
    out.set(r.id,{cost:Math.round((total/vq)*100)/100,missing,lines:l.length,source:source.get(r.id)||"none"});
  }
  return out;
}

// ---------------- GET ----------------
// Match na ho to null -> bada route file aage chalta hai.
export async function productionGet(req:Request,path:string[],a:any):Promise<Response|null>{
  const p=path.join("/");
    if(p==="reports/production-register"){
      const u=new URL(req.url),args:any[]=[]; const {w,search}=dateWhere("v",u,args);
      const status=u.searchParams.get("status")||"all";
      if(search){args.push("%"+search+"%");w.push("(COALESCE(v.vou_no,'') ILIKE $"+args.length+" OR COALESCE(v.chassis_no,'') ILIKE $"+args.length+" OR COALESCE(v.product_name,'') ILIKE $"+args.length+" OR COALESCE(v.machnic,'') ILIKE $"+args.length+" OR COALESCE(v.formula_name,'') ILIKE $"+args.length+")");}
      if(status==="factory")w.push("COALESCE(vh.stage,'Manufacturing')='Manufacturing'");
      if(status==="delivered")w.push("COALESCE(vh.stage,'Manufacturing')<>'Manufacturing'");
      const where=w.length?" WHERE "+w.join(" AND "):"";
      try{await ensureProductionFormulaSchema()}catch(e){console.error("[reg formula schema]",e)}
      const r=await pool.query("SELECT v.*,"+formulaNameSql("v","v.product_name")+" AS formula_name,COALESCE(vh.stage,'Manufacturing') AS stage FROM production_voucher v LEFT JOIN vehicle vh ON vh.chassis_no=v.chassis_no"+where+" ORDER BY v.date DESC,v.id DESC",args);
      // Costing is ADMIN ONLY: non-admin users never get any cost field, in the table or in the Excel export.
      const costAdmin=isAdmin(a);
      const withCost=async(list:any[])=>{
        if(!costAdmin||!list.length)return list;
        const cm=await productionCosts(list);
        return list.map((x:any)=>{const c=cm.get(x.id);return {...x,avg_cost:c?c.cost:0,cost_missing_items:c?c.missing:0,cost_source:c?c.source:"none"};});
      };
      if(u.searchParams.get("export")==="csv")return csvResponse(await withCost(r.rows),"Production_Register.csv");
      const page=Math.max(1,num(u.searchParams.get("page"))||1),per=Math.min(200,Math.max(1,num(u.searchParams.get("per_page"))||50)),start=(page-1)*per;
      return Response.json({rows:await withCost(r.rows.slice(start,start+per)),page,per_page:per,total:r.rowCount,total_pages:Math.max(1,Math.ceil(r.rowCount/per)),cost_visible:costAdmin});
    }
    if(p==="factory-check-reports"){
      await ensureFactoryCheckSchema();
      const u=new URL(req.url),status=String(u.searchParams.get("status")||"all"),search=String(u.searchParams.get("search")||"").trim(),args:any[]=[],w:string[]=[];
      if(status!=="all"){args.push(status.toUpperCase());w.push("f.status=$"+args.length);}
      if(search){args.push("%"+search+"%");w.push("(COALESCE(f.product_name,'') ILIKE $"+args.length+" OR COALESCE(pv.vou_no,'') ILIKE $"+args.length+" OR COALESCE(pv.chassis_no,'') ILIKE $"+args.length+")");}
      const where=w.length?" WHERE "+w.join(" AND "):"";
      const r=await pool.query("SELECT f.*,pv.vou_no,pv.chassis_no,pv.motor_no FROM factory_check_report f JOIN production_voucher pv ON pv.id=f.production_voucher_id"+where+" ORDER BY f.date DESC,f.id DESC",args);
      const ids=r.rows.map((x:any)=>x.id);
      const items=ids.length?await pool.query("SELECT * FROM factory_check_item WHERE report_id=ANY($1::bigint[]) ORDER BY id",[ids]):{rows:[]};
      const grouped:any={};for(const x of items.rows)(grouped[x.report_id] ||= []).push(x);
      return Response.json({reports:r.rows.map((x:any)=>({...x,items:grouped[x.id]||[]})),rows:r.rows,items:items.rows});
    }
    if(p.startsWith("factory-check-reports/") && p.endsWith("/preview")){
      await ensureFactoryCheckSchema();const id=idOf(path[path.length-2]);if(!id)return Response.json({error:"Report id required."},{status:400});
      const r=await pool.query("SELECT f.*,pv.vou_no,pv.chassis_no,pv.motor_no,pv.product_name AS pv_product_name,pv.quantity AS pv_quantity FROM factory_check_report f JOIN production_voucher pv ON pv.id=f.production_voucher_id WHERE f.id=$1",[id]);
      if(!r.rowCount)return Response.json({error:"Factory Check Report not found."},{status:404});
      const items=await pool.query("SELECT * FROM factory_check_item WHERE report_id=$1 ORDER BY id",[id]);
      return Response.json({report:r.rows[0],items:items.rows});
    }
    if(p==="daily-raw-material-checklist"){
      await ensureDailyRawMaterialChecklistSchema();
      const u=new URL(req.url),date=String(u.searchParams.get("date")||"").trim();
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return Response.json({error:"Valid date is required."},{status:400});
      let report=(await pool.query("SELECT * FROM daily_raw_material_checklist WHERE date=$1",[date])).rows[0];
      if(!report){
        const r=await pool.query("INSERT INTO daily_raw_material_checklist(date,status) VALUES($1,'PENDING') RETURNING *",[date]);
        report=r.rows[0];
      }
      if(report.status==="PENDING"){
        const production=await pool.query("SELECT product_name,COALESCE(formula_name,'') AS formula_name,COALESCE(SUM(quantity),0) AS production_qty FROM production_voucher WHERE date=$1 GROUP BY product_name,formula_name ORDER BY product_name,formula_name",[date]);
        const totalQty=production.rows.reduce((s:any,x:any)=>s+num(x.production_qty),0);
        await pool.query("UPDATE daily_raw_material_checklist SET production_qty=$1,updated_at=NOW() WHERE id=$2",[totalQty,report.id]);
        const lines=await pool.query(`SELECT pv.product_name,COALESCE(pv.formula_name,'') AS formula_name,
          COALESCE(SUM(pv.quantity),0) AS production_qty,pf.id AS formula_line_id,pf.raw_item_name,
          pf.qty AS formula_qty_per_unit,pf.unit,
          COALESCE(SUM(pv.quantity*pf.qty),0) AS required_qty
          FROM production_voucher pv
          JOIN production_formula pf ON pf.product_name=pv.product_name
            AND COALESCE(pf.formula_name,'')=COALESCE(pv.formula_name,'')
          WHERE pv.date=$1
          GROUP BY pv.product_name,COALESCE(pv.formula_name,''),pf.id,pf.raw_item_name,pf.qty,pf.unit
          ORDER BY pv.product_name,COALESCE(pv.formula_name,''),pf.id`,[date]);
        for(const line of lines.rows){
          const sourceKey=String(line.product_name||"")+"::"+String(line.formula_name||"")+"::"+String(line.formula_line_id||"");
          await pool.query(`INSERT INTO daily_raw_material_checklist_item
            (checklist_id,source_key,product_name,formula_name,production_qty,raw_item_name,formula_qty_per_unit,required_qty,issued_qty,difference,unit,formula_line_id)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,0,-$8,$9,$10)
            ON CONFLICT(checklist_id,source_key) DO UPDATE SET
              product_name=EXCLUDED.product_name,formula_name=EXCLUDED.formula_name,
              production_qty=EXCLUDED.production_qty,raw_item_name=EXCLUDED.raw_item_name,
              formula_qty_per_unit=EXCLUDED.formula_qty_per_unit,required_qty=EXCLUDED.required_qty,
              unit=EXCLUDED.unit,formula_line_id=EXCLUDED.formula_line_id,updated_at=NOW()`,
            [report.id,sourceKey,line.product_name,line.formula_name,num(line.production_qty),line.raw_item_name,num(line.formula_qty_per_unit),num(line.required_qty),line.unit||"PCS",num(line.formula_line_id)]);
        }
        report=(await pool.query("SELECT * FROM daily_raw_material_checklist WHERE id=$1",[report.id])).rows[0];
      }
      const items=await pool.query("SELECT * FROM daily_raw_material_checklist_item WHERE checklist_id=$1 ORDER BY product_name,formula_name,raw_item_name,id",[report.id]);
      const production=await pool.query("SELECT product_name,COALESCE(formula_name,'') AS formula_name,COALESCE(SUM(quantity),0) AS quantity,COUNT(*)::int AS vouchers FROM production_voucher WHERE date=$1 GROUP BY product_name,formula_name ORDER BY product_name,formula_name",[date]);
      const masters=await pool.query("SELECT id,name FROM product WHERE COALESCE(fro,'')='R' AND COALESCE(name,'')<>'' ORDER BY name,id");
      const formulas=await pool.query("SELECT DISTINCT formula_name,product_name FROM production_formula ORDER BY product_name,formula_name");
      return Response.json({checklist:report,items:items.rows,production:production.rows,raw_materials:masters.rows,formulas:formulas.rows});
    }
    if(p==="factory-check-pending-production"){
      await ensureFactoryCheckSchema();
      const r=await pool.query("SELECT pv.* FROM production_voucher pv LEFT JOIN factory_check_report f ON f.production_voucher_id=pv.id WHERE f.id IS NULL ORDER BY pv.date DESC,pv.id DESC LIMIT 500");
      return Response.json({vouchers:r.rows,rows:r.rows});
    }
    if(p==="production-formulas/by-product"){
      const u=new URL(req.url),product=u.searchParams.get("product")||u.searchParams.get("product_code")||"";
      const r=await pool.query("SELECT * FROM production_formula WHERE product_code=$1 OR product_name=$1 ORDER BY id",[product]);
      return Response.json({rows:r.rows,items:r.rows,data:r.rows});
    }
    // Production Voucher list: paginated + search (page / per_page / search). The generic handler
    // returned no "vouchers" key and ignored paging, so the screen always showed "No records found".
    if(p==="production-vouchers"){
      await ensureProductionVoucherSchema();
      const u=new URL(req.url),page=Math.max(1,Math.trunc(num(u.searchParams.get("page"))||1)),per=Math.min(200,Math.max(1,Math.trunc(num(u.searchParams.get("per_page"))||50)));
      const search=String(u.searchParams.get("search")||"").trim(),args:any[]=[];let where="";
      if(search){args.push("%"+search+"%");where=" WHERE (v.vou_no ILIKE $1 OR v.chassis_no ILIKE $1 OR v.motor_no ILIKE $1 OR v.product_name ILIKE $1 OR COALESCE(v.formula_name,'') ILIKE $1)";}
      const total=Number((await pool.query("SELECT COUNT(*)::int AS n FROM production_voucher v"+where,args)).rows[0]?.n||0);
      try{await ensureProductionFormulaSchema()}catch(e){console.error("[pv formula schema]",e)}
      const r=await pool.query("SELECT v.*,"+formulaNameSql("v","v.product_name")+" AS formula_name FROM production_voucher v"+where+" ORDER BY v.date DESC,v.id DESC LIMIT "+per+" OFFSET "+((page-1)*per),args);
      return Response.json({vouchers:r.rows,rows:r.rows,total,page,per_page:per,total_pages:Math.max(1,Math.ceil(total/per))});
    }
    if(/^production-vouchers\/\d+$/.test(p)){
      const r=await pool.query("SELECT * FROM production_voucher WHERE id=$1",[idOf(path[1])]);
      if(!r.rowCount)return Response.json({error:"Production Voucher not found."},{status:404});
      return Response.json({voucher:r.rows[0]});
    }
    if(p==="production-formulas"){
      await ensureProductionFormulaSchema();
      const r=await pool.query("SELECT * FROM production_formula ORDER BY product_name,formula_name,id");
      const grouped:any[]=[]; const map=new Map<string,any>();
      for(const row of r.rows){if(!String(row.formula_name||"").trim())row.formula_name=row.product_name;const key=String(row.formula_name||"")+"::"+String(row.product_name||"");let g=map.get(key);if(!g){g={formula_name:row.formula_name,product_name:row.product_name,lines:[]};map.set(key,g);grouped.push(g)}g.lines.push(row)}
      const products=await pool.query("SELECT name,fro,UPPER(COALESCE(NULLIF(product_category,''),CASE WHEN fro='F' THEN 'FINISHED' ELSE 'RAW' END)) AS category FROM product ORDER BY name");
      // Finished Product dropdown: sirf asli FINISHED items (Production Voucher jaisa rule). DISPATCH (Data Card, Drill, Labour Charge, Packing...) aur RAW yahan nahi aayenge.
      return Response.json({grouped,rows:r.rows,lines:r.rows,finished_products:products.rows.filter((x:any)=>x.fro!=="R"&&x.category==="FINISHED"),raw_materials:products.rows.filter((x:any)=>x.fro==="R")});
    }
    if(p==="production-formulas/lines"){
      const u=new URL(req.url),args:any[]=[];const w:string[]=[];
      const product=u.searchParams.get("product_name")||u.searchParams.get("product")||"";const formula=u.searchParams.get("formula_name")||"";
      await ensureProductionFormulaSchema();
      if(product){args.push(product);w.push(NORM("product_name")+"="+NORM("$"+args.length))}if(formula){args.push(formula);w.push(NORM("formula_name")+"="+NORM("$"+args.length))}
      const r=await pool.query("SELECT * FROM production_formula"+(w.length?" WHERE "+w.join(" AND "):"")+" ORDER BY id",args);
      return Response.json({rows:r.rows,items:r.rows,data:r.rows,lines:r.rows});
    }
    // Chassis No = <First Fix><Month code><Year code><After Fix><serial>. Serial: 3 digits (len 17) / 4 digits (len 18),
    // Month/Year codes Chassis Master se. Serial har naye prefix (naya month/year) par 001 se shuru hota hai.
    if(p==="production-vouchers/generate-code"){
      const u=new URL(req.url),product=String(u.searchParams.get("product")||u.searchParams.get("product_name")||"").trim();
      if(!product)return Response.json({error:"Product is required."},{status:400});
      const dt=String(u.searchParams.get("date")||"").slice(0,10),d=/^\d{4}-\d{2}-\d{2}$/.test(dt)?dt:new Date().toISOString().slice(0,10);
      const MN=["January","February","March","April","May","June","July","August","September","October","November","December"];
      const mName=MN[Number(d.slice(5,7))-1];
      const mr=await pool.query("SELECT code FROM chassis_month_code WHERE lower(btrim(month))=lower($1) LIMIT 1",[mName]);
      const monthCode=String(mr.rows[0]?.code||"").trim();
      if(!monthCode)return Response.json({error:"Chassis Master mein "+mName+" ka Month Code set nahi hai."},{status:400});
      const yr=await pool.query("SELECT code FROM chassis_year_code WHERE year=$1::int LIMIT 1",[Number(d.slice(0,4))]);
      const yearCode=String(yr.rows[0]?.code||"").trim();
      if(!yearCode)return Response.json({error:"Chassis Master mein "+d.slice(0,4)+" ka Year Code set nahi hai."},{status:400});

      const pr=await pool.query("SELECT to_jsonb(product) AS j FROM product WHERE lower(btrim(name))=lower(btrim($1::text)) ORDER BY (fro='F') DESC,id DESC LIMIT 1",[product]);
      const j:any=pr.rows[0]?.j||{};
      const pick=(names:string[],re:RegExp)=>{
        for(const n of names){if(String(j[n]??"").trim()!=="")return String(j[n]).trim();}
        const k=Object.keys(j).find(k=>re.test(k)&&String(j[k]??"").trim()!=="");
        return k?String(j[k]).trim():"";
      };
      const firstFix=pick(["chassis_item_code","chassis_first_fix","first_fix"],/first.*fix|chassis.*item/i);
      const afterFix=pick(["chassis_after_code","chassis_after_fix","after_fix","chassis_suffix_code","chassis_suffix"],/chassis.*(after|suffix)|after.*(month|year|fix)/i);
      // Product Master screen par length default 17 dikhta hai; purane products me DB me blank ho sakti hai -> 17 maano.
      const fullLen=Number(pick(["chassis_length_digits","chassis_length","chassis_no_length","full_chassis_length","chassis_len"],/chassis.*len|len.*chassis/i))||17;
      const seen=Object.keys(j).filter(k=>/chassis|fix|len/i.test(k));
      if(!firstFix)return Response.json({error:"Product Master mein Chassis First Fix set nahi hai.",product_keys:seen},{status:400});
      if(!afterFix)return Response.json({error:"Product Master mein After Month & Year Fix set nahi hai.",product_keys:seen},{status:400});
      if(fullLen!==17&&fullLen!==18)return Response.json({error:"Full Chassis No. Length 17 ya 18 hona chahiye (abhi: "+(fullLen||"blank")+").",product_keys:seen},{status:400});

      // Rule: First Fix 9 char -> Month code 10th position -> Year code 11th position -> After Month & Year Fix -> serial (17 digit: 001, 18 digit: 0001).
      if(firstFix.length!==9)return Response.json({error:"Chassis First Fix 9 character ka hona chahiye taaki Month Code 10th aur Year Code 11th position par aaye (abhi \""+firstFix+"\" = "+firstFix.length+" character). Product Master check karo."},{status:400});
      if(monthCode.length!==1||yearCode.length!==1)return Response.json({error:"Chassis Master me Month Code aur Year Code 1-1 character ke hone chahiye (Month: \""+monthCode+"\", Year: \""+yearCode+"\")."},{status:400});
      const prefix=firstFix+monthCode+yearCode+afterFix,digits=fullLen===17?3:4;
      if(prefix.length+digits!==fullLen)return Response.json({error:"Length match nahi: prefix "+prefix+" ("+prefix.length+" char) + "+digits+" digit serial = "+(prefix.length+digits)+", lekin Full Length "+fullLen+" hai. Product Master ki fix values check karo."},{status:400});

      // Serial 001..999 (17 digit) ya 0001..9999 (18 digit). Last used + 1; limit ke baad dobara 001 se, jo number pehle se use ho chuka ho use skip.
      const usedQ=await pool.query("SELECT DISTINCT substr(c,$2::int+1)::bigint AS n FROM (SELECT chassis_no AS c FROM vehicle UNION ALL SELECT chassis_no FROM production_voucher) x WHERE left(c,$2::int)=$1::text AND length(c)=$3::int AND substr(c,$2::int+1) ~ '^[0-9]+$'",[prefix,prefix.length,fullLen]);
      const used=new Set<number>(usedQ.rows.map((r:any)=>Number(r.n)));
      const limit=Math.pow(10,digits)-1,lastUsed=used.size?Math.max(...used):0;
      let next=0,wrapped=false;
      for(let i=1;i<=limit;i++){
        const cand=((lastUsed+i-1)%limit)+1;
        if(!used.has(cand)){next=cand;wrapped=cand<=lastUsed;break;}
      }
      if(!next)return Response.json({error:"Serial 1 se "+limit+" tak sab use ho chuke hain for "+prefix+". Naya serial nahi mil sakta."},{status:400});
      const chassis=prefix+String(next).padStart(digits,"0");

      const last=await pool.query("SELECT motor_no,controller_no FROM production_voucher WHERE lower(btrim(product_name))=lower(btrim($1::text)) AND COALESCE(motor_no,'')<>'' ORDER BY date DESC,id DESC LIMIT 1",[product]);
      const L=last.rows[0]||{};
      const bump=(v:any,by:number)=>{const m=String(v||"").match(/^(.*?)(\d+)$/);if(!m)return "";return m[1]+(BigInt(m[2])+BigInt(by)).toString().padStart(m[2].length,"0")};
      return Response.json({chassis_no:chassis,motor_no:bump(L.motor_no,1),controller_no:bump(L.controller_no,1),missing_item_code:false,wrapped});
    }
  return null;
}

// ---------------- POST ----------------
export async function productionPost(req:Request,path:string[],b:any,a:any):Promise<Response|null>{
  const p=path.join("/");
    // Production Formula: naam ya model (Finished Product) badalna - us formula ki saari lines + pending vouchers ka formula_name/product_name.
    if(p==="production-formulas/rename"){
      await ensureProductionFormulaSchema();
      const oldProduct=String(b.old_product_name||b.product_name||"").trim(),newProduct=String(b.new_product_name||oldProduct).trim();
      const oldName=String(b.old_formula_name||"").trim(),newName=String(b.new_formula_name||"").trim();
      const ids:number[]=(Array.isArray(b.ids)?b.ids:[]).map((x:any)=>Number(x)).filter((x:number)=>Number.isFinite(x)&&x>0);
      if(!newProduct||!newName)return Response.json({error:"Product aur naya Formula Name zaroori hai."},{status:400});
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        // Rows to rename: by id (exact) when the screen sends them, else by normalised product+formula name.
        let rowsQ:any;
        if(ids.length)rowsQ=await client.query("SELECT id,product_name,formula_name FROM production_formula WHERE id=ANY($1::bigint[])",[ids]);
        else rowsQ=await client.query("SELECT id,product_name,formula_name FROM production_formula WHERE "+NORM("product_name")+"="+NORM("$1")+" AND "+NORM("formula_name")+"="+NORM("$2"),[oldProduct,oldName]);
        if(!rowsQ.rowCount){
          const dbg=await client.query("SELECT DISTINCT product_name,formula_name FROM production_formula WHERE "+NORM("product_name")+" LIKE '%'||"+NORM("$1")+"||'%' LIMIT 5",[oldProduct]);
          throw new Error("Purana formula nahi mila. Search: ["+oldProduct+"]/["+oldName+"]. DB me is product ke formula: "+(dbg.rows.map((x:any)=>"["+x.product_name+"]/["+x.formula_name+"]").join(", ")||"koi nahi"));
        }
        const rowIds=rowsQ.rows.map((x:any)=>Number(x.id));
        const prevProduct=String(rowsQ.rows[0].product_name||""),prevName=String(rowsQ.rows[0].formula_name||"");
        const clash=await client.query("SELECT 1 FROM production_formula WHERE "+NORM("product_name")+"="+NORM("$1")+" AND "+NORM("formula_name")+"="+NORM("$2")+" AND id<>ALL($3::bigint[]) LIMIT 1",[newProduct,newName,rowIds]);
        if(clash.rowCount)throw new Error("\""+newProduct+"\" me \""+newName+"\" naam ka formula pehle se hai.");
        const r=await client.query("UPDATE production_formula SET formula_name=$1,product_name=$2 WHERE id=ANY($3::bigint[])",[newName,newProduct,rowIds]);
        await client.query("UPDATE production_voucher SET formula_name=$3,product_name=$4 WHERE "+NORM("product_name")+"="+NORM("$1")+" AND "+NORM("formula_name")+"="+NORM("$2"),[prevProduct,prevName,newName,newProduct]);
        await client.query("COMMIT");
        return Response.json({success:true,updated:r.rowCount});
      }catch(e:any){await client.query("ROLLBACK");return Response.json({error:e.message||"Rename failed"},{status:400})}finally{client.release()}
    }
    // Production Formula: poora formula ek request me save (id wali lines update, bina id wali nayi insert) - ek transaction me.
    if(p==="production-formulas/save"){
      await ensureProductionFormulaSchema();
      const product=String(b.product_name||"").trim(),formula=String(b.formula_name||"").trim();
      const lines:any[]=Array.isArray(b.lines)?b.lines:[];
      if(!product||!formula)return Response.json({error:"Product aur Formula Name zaroori hai."},{status:400});
      if(!lines.length)return Response.json({error:"Kam se kam ek raw material line chahiye."},{status:400});
      const seen=new Set<string>();
      for(const l of lines){const k=String(l.raw_item_name||"").trim().toLowerCase();if(!k)continue;if(seen.has(k))return Response.json({error:"\""+String(l.raw_item_name).trim()+"\" is formula me do baar hai. Ek hi line rakhein."},{status:400});seen.add(k);}
      const removeIds:number[]=(Array.isArray(b.removed_ids)?b.removed_ids:[]).map((x:any)=>idOf(x)).filter(Boolean) as number[];
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        // Modal me hataayi gayi lines Save ke saath hi (isi transaction me) delete hoti hain; Cancel par kuch nahi udta.
        // Pehle delete, taaki "line hatao + wahi raw material nayi line" unique index se na takraye.
        let deleted=0;
        if(removeIds.length){const d=await client.query("DELETE FROM production_formula WHERE id=ANY($1::bigint[]) AND "+NORM("product_name")+"="+NORM("$2")+" AND "+NORM("formula_name")+"="+NORM("$3"),[removeIds,product,formula]);deleted=d.rowCount||0;}
        let updated=0,inserted=0;
        for(const l of lines){
          const rawItem=String(l.raw_item_name||"").trim(),qty=num(l.qty),unit=String(l.unit||"PCS").trim()||"PCS";
          if(!rawItem||qty<=0)throw new Error("Har line me Raw Material aur 0 se zyada Qty zaroori hai.");
          const raw=await client.query("SELECT 1 FROM product WHERE COALESCE(fro,'')='R' AND lower(trim(name))=lower(trim($1)) LIMIT 1",[rawItem]);
          if(!raw.rowCount)throw new Error("\""+rawItem+"\" Product Master ke Raw Material me nahi hai.");
          const id=idOf(l.id);
          if(id){
            const r=await client.query("UPDATE production_formula SET raw_item_name=$1,qty=$2,unit=$3 WHERE id=$4 AND "+NORM("product_name")+"="+NORM("$5")+" AND "+NORM("formula_name")+"="+NORM("$6"),[rawItem,qty,unit,id,product,formula]);
            if(r.rowCount){updated++;continue;}
          }
          await client.query("INSERT INTO production_formula (product_name,formula_name,raw_item_name,qty,unit) VALUES ($1,$2,$3,$4,$5)",[product,formula,rawItem,qty,unit]);inserted++;
        }
        await client.query("COMMIT");
        return Response.json({success:true,updated,inserted,deleted});
      }catch(e:any){await client.query("ROLLBACK");const dup=e?.code==="23505";return Response.json({error:dup?"Ek formula me ek raw material do baar nahi aa sakta.":(e.message||"Save failed")},{status:400})}finally{client.release()}
    }
    if(p==="daily-raw-material-checklist"){
      await ensureDailyRawMaterialChecklistSchema();
      const date=String(b.date||"").trim();
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return Response.json({error:"Valid date is required."},{status:400});
      const report=(await pool.query("SELECT * FROM daily_raw_material_checklist WHERE date=$1 FOR UPDATE",[date])).rows[0];
      if(!report)return Response.json({error:"Checklist not found for this date. Open the checklist first."},{status:404});
      if(report.status!=="PENDING")return Response.json({error:"Checklist is already verified/locked."},{status:409});
      const items=Array.isArray(b.items)?b.items:[];
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        for(const item of items){
          const id=idOf(item.id);if(!id)continue;
          const issued=Math.max(0,num(item.issued_qty));
          await client.query("UPDATE daily_raw_material_checklist_item SET issued_qty=$1,difference=$1-required_qty,remarks=$2,verified=$3,updated_at=NOW() WHERE id=$4 AND checklist_id=$5",
            [issued,String(item.remarks||"").trim()||null,Boolean(item.verified),id,report.id]);
        }
        await client.query("UPDATE daily_raw_material_checklist SET updated_at=NOW() WHERE id=$1",[report.id]);
        await client.query("COMMIT");
        return Response.json({success:true});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    if(p==="daily-raw-material-checklist/verify"){
      await ensureDailyRawMaterialChecklistSchema();
      const id=idOf(b.checklist_id);if(!id)return Response.json({error:"Checklist id is required."},{status:400});
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        const report=(await client.query("SELECT * FROM daily_raw_material_checklist WHERE id=$1 FOR UPDATE",[id])).rows[0];
        if(!report)throw new Error("Checklist not found.");
        if(report.status!=="PENDING")throw new Error("Checklist is already verified/locked.");
        const rows=await client.query("SELECT * FROM daily_raw_material_checklist_item WHERE checklist_id=$1 ORDER BY id",[id]);
        if(!rows.rowCount)throw new Error("No raw material lines are available for this date.");
        for(const item of rows.rows){
          if(!item.verified)throw new Error("Verify every raw material line before locking: "+item.raw_item_name);
          if(Math.abs(Number(item.difference||0))>0.0000001 && !String(item.remarks||"").trim())
            throw new Error("Remark is required for quantity mismatch: "+item.raw_item_name);
        }
        const r=await client.query("UPDATE daily_raw_material_checklist SET status='VERIFIED',verified_by=$1,verified_at=NOW(),updated_at=NOW() WHERE id=$2 RETURNING *",
          [String(a.user_id||a.username||a.name||"Store"),id]);
        await client.query("COMMIT");
        return Response.json({success:true,checklist:r.rows[0]});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    if(p==="daily-raw-material-checklist/formula"){
      await ensureDailyRawMaterialChecklistSchema();
      const productName=String(b.product_name||"").trim(),formulaName=String(b.formula_name||"").trim(),
        rawItem=String(b.raw_item_name||"").trim(),qty=num(b.qty),unit=String(b.unit||"PCS").trim()||"PCS";
      if(!productName||!formulaName||!rawItem||qty<=0)return Response.json({error:"Product, Formula, Raw Material and positive Qty are required."},{status:400});
      const raw=await pool.query("SELECT id FROM product WHERE COALESCE(fro,'')='R' AND lower(trim(name))=lower(trim($1)) LIMIT 1",[rawItem]);
      if(!raw.rowCount)return Response.json({error:"Select a Raw Material from Product Master."},{status:400});
      const existing=b.id?await pool.query("SELECT id FROM production_formula WHERE id=$1",[idOf(b.id)]):{rowCount:0};
      let r;
      if(existing.rowCount){
        r=await pool.query("UPDATE production_formula SET raw_item_name=$1,qty=$2,unit=$3 WHERE id=$4 RETURNING *",[rawItem,qty,unit,idOf(b.id)]);
      }else{
        r=await pool.query("INSERT INTO production_formula (product_name,formula_name,raw_item_name,qty,unit) VALUES($1,$2,$3,$4,$5) RETURNING *",[productName,formulaName,rawItem,qty,unit]);
      }
      return Response.json({success:true,row:r.rows[0]},{status:existing.rowCount?200:201});
    }
    if(p==="factory-check-reports"){
      await ensureFactoryCheckSchema();
      const pvId=idOf(b.production_voucher_id);if(!pvId)return Response.json({error:"Production Voucher is required."},{status:400});
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        const pv=await client.query("SELECT * FROM production_voucher WHERE id=$1 FOR UPDATE",[pvId]);if(!pv.rowCount)throw new Error("Production Voucher not found.");
        const existing=await client.query("SELECT id FROM factory_check_report WHERE production_voucher_id=$1",[pvId]);if(existing.rowCount){await client.query("COMMIT");return Response.json({success:true,id:existing.rows[0].id,already_exists:true});}
        const qty=Math.max(1,num(pv.rows[0].quantity)||1);
        const formula=await client.query("SELECT raw_item_name,qty,unit FROM production_formula WHERE product_name=$1 AND ($2='' OR formula_name=$2) ORDER BY id",[pv.rows[0].product_name||"",String(pv.rows[0].formula_name||"")]);
        const report=await client.query("INSERT INTO factory_check_report (production_voucher_id,date,product_name,quantity,status,remarks) VALUES ($1,COALESCE($2::date,CURRENT_DATE),$3,$4,'PENDING',$5) RETURNING *",[pvId,pv.rows[0].date||null,pv.rows[0].product_name||"",qty,"Checklist created from Production Formula. Approval is informational and does not block production."]);
        for(const line of formula.rows)await client.query("INSERT INTO factory_check_item (report_id,raw_item_name,expected_qty,consumed_qty,unit,additional,status) VALUES ($1,$2,$3,$4,$5,false,'PENDING')",[report.rows[0].id,line.raw_item_name,num(line.qty)*qty,num(line.qty)*qty,line.unit||"PCS"]);
        await client.query("COMMIT");return Response.json({success:true,report:report.rows[0]},{status:201});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    if(p.startsWith("factory-check-reports/") && p.endsWith("/approve")){
      await ensureFactoryCheckSchema();const id=idOf(path[path.length-2]);if(!id)return Response.json({error:"Report id required."},{status:400});
      const r=await pool.query("UPDATE factory_check_report SET status='APPROVED',approved_by=$1,approved_at=NOW() WHERE id=$2 RETURNING *",[String(a.user_id||a.username||a.name||"Staff"),id]);
      if(!r.rowCount)return Response.json({error:"Factory Check Report not found."},{status:404});
      return Response.json({success:true,report:r.rows[0]});
    }
    if(p.startsWith("factory-check-items/") && p.endsWith("/approve")){
      await ensureFactoryCheckSchema();const id=idOf(path[path.length-2]);if(!id)return Response.json({error:"Item id required."},{status:400});
      const r=await pool.query("UPDATE factory_check_item SET status='APPROVED',approved_by=$1,approved_at=NOW() WHERE id=$2 RETURNING *",[String(a.user_id||a.username||a.name||"Staff"),id]);
      if(!r.rowCount)return Response.json({error:"Factory Check Item not found."},{status:404});
      return Response.json({success:true,item:r.rows[0]});
    }
    if(p.startsWith("factory-check-reports/") && p.endsWith("/parts")){
      await ensureFactoryCheckSchema();const id=idOf(path[path.length-2]);if(!id)return Response.json({error:"Report id required."},{status:400});
      const name=String(b.raw_item_name||"").trim(),qty=Math.max(0,num(b.qty)||0),unit=String(b.unit||"PCS").trim()||"PCS";
      if(!name||qty<=0)return Response.json({error:"Part name and quantity are required."},{status:400});
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        const report=await client.query("SELECT * FROM factory_check_report WHERE id=$1 FOR UPDATE",[id]);if(!report.rowCount)throw new Error("Factory Check Report not found.");
        const stock=await client.query("SELECT COALESCE(SUM(CASE WHEN UPPER(COALESCE(work_type,''))='IN' THEN qty ELSE -qty END),0) AS qty FROM journal_stock WHERE lower(trim(item_name))=lower(trim($1))",[name]);
        const available=Number(stock.rows[0]?.qty||0);if(available<qty)throw new Error("Insufficient stock for "+name+". Available: "+available);
        await client.query("INSERT INTO journal_stock (vou_no,date,item_name,item_type,qty,reason,created_at,model_name,work_type,batch_ref) VALUES ($1,CURRENT_DATE,$2,'RAW',$3,'Factory Check Additional Part',NOW(),$4,'OUT',$1)",["FCR-"+id,name,qty,report.rows[0].product_name||null]);
        const r=await client.query("INSERT INTO factory_check_item (report_id,raw_item_name,expected_qty,consumed_qty,unit,additional,status,remarks) VALUES ($1,$2,0,$3,$4,true,'PENDING',$5) RETURNING *",[id,name,qty,unit,String(b.remarks||"Additional part requested from Factory Check")]);
        await client.query("COMMIT");return Response.json({success:true,item:r.rows[0]},{status:201});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    if(p==="production-vouchers"){
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        await ensureProductionVoucherSchema();
        const chassis=String(b.chassis_no||"").trim();
        if(chassis){
          // Same chassis ke do save ek saath aaye to dusra pehle wale ke commit tak ruk jaye (phir duplicate error mile).
          await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",["chassis:"+chassis.toUpperCase()]);
          const dup=await client.query("SELECT 1 FROM vehicle WHERE upper(btrim(chassis_no))=upper($1) UNION ALL SELECT 1 FROM production_voucher WHERE upper(btrim(chassis_no))=upper($1) LIMIT 1",[chassis]);
          if(dup.rowCount)throw new Error("Chassis No. \""+chassis+"\" already exists. Duplicate chassis nahi ban sakta.");
          // Product Master me jitni Full Chassis No. Length likhi hai, chassis utna hi bada hona chahiye.
          const pj=(await client.query("SELECT to_jsonb(product) AS j FROM product WHERE lower(btrim(name))=lower(btrim($1::text)) ORDER BY (fro='F') DESC,id DESC LIMIT 1",[String(b.product_name||"")])).rows[0]?.j||{};
          const lk=Object.keys(pj).find(k=>/chassis.*len|len.*chassis/i.test(k)&&Number(pj[k])>0);
          const need=lk?Number(pj[lk]):0;
          if(need&&chassis.length!==need)throw new Error("Chassis No. "+need+" character ka hona chahiye (abhi "+chassis.length+"). Product Master me Full Chassis No. Length "+need+" set hai.");
        }
        if(!String(b.colour||"").trim())throw new Error("Colour select karna zaroori hai.");
        if(!String(b.machnic||"").trim())throw new Error("Mechanic select karna zaroori hai.");
        const qty=Math.max(1,Math.trunc(num(b.quantity)||1));
        // Ek model ke 2-3 formula ho sakte hain: formula chune bina sab formulas ka stock ek saath kat jata, isliye zaroori.
        if(!String(b.formula_name||"").trim()){
          const fc=await client.query("SELECT COUNT(DISTINCT formula_name)::int AS n FROM production_formula WHERE product_name=$1",[b.product_name||""]);
          if(Number(fc.rows[0]?.n||0)>1)throw new Error("Is model ke ek se zyada formula hain. Formula Name select karein.");
        }
        const r=await client.query("INSERT INTO production_voucher (vou_no,date,product_name,formula_name,quantity,chassis_no,motor_no,controller_no,differential_no,colour,colour_code,other,battery_maker,battery_no1,battery_no2,battery_no3,battery_no4,machnic,created_at) VALUES (COALESCE(NULLIF($1,''),'PV-'||extract(epoch from now())::bigint),COALESCE($2::date,CURRENT_DATE),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW()) RETURNING *",
          [String(b.vou_no||""),b.date||null,b.product_name||"",String(b.formula_name||""),qty,chassis,b.motor_no||null,b.controller_no||null,b.differential_no||null,b.colour||null,b.colour_code||null,b.other||null,b.battery_maker||null,b.battery_no1||null,b.battery_no2||null,b.battery_no3||null,b.battery_no4||null,b.machnic||null]);
        if(chassis)await client.query("INSERT INTO vehicle (date,model_name,chassis_no,motor_no,controller_no,differential_no,colour,colour_code,stage,battery_maker,battery_no1,battery_no2,battery_no3,battery_no4) VALUES (COALESCE($1::date,CURRENT_DATE),$2,$3,$4,$5,$6,$7,$8,'Manufacturing',$9,$10,$11,$12,$13) ON CONFLICT (chassis_no) DO UPDATE SET stage='Manufacturing',model_name=EXCLUDED.model_name,battery_maker=EXCLUDED.battery_maker,battery_no1=EXCLUDED.battery_no1,battery_no2=EXCLUDED.battery_no2,battery_no3=EXCLUDED.battery_no3,battery_no4=EXCLUDED.battery_no4",
          [b.date||null,b.product_name||null,chassis,b.motor_no||null,b.controller_no||null,b.differential_no||null,b.colour||null,b.colour_code||null,b.battery_maker||null,b.battery_no1||null,b.battery_no2||null,b.battery_no3||null,b.battery_no4||null]);
        // Stock check + raw material OUT: kam stock par poora voucher (vehicle samet) rollback ho jata hai.
        const formula=await consumeProductionStock(client,{vou_no:String(b.vou_no||r.rows[0].vou_no),date:b.date||null,product_name:b.product_name||"",formula_name:String(b.formula_name||""),quantity:qty});
        await ensureFactoryCheckSchema();
        const check=await client.query("INSERT INTO factory_check_report (production_voucher_id,date,product_name,quantity,status,remarks) VALUES ($1,COALESCE($2::date,CURRENT_DATE),$3,$4,'PENDING',$5) ON CONFLICT (production_voucher_id) DO NOTHING RETURNING id",[r.rows[0].id,b.date||null,b.product_name||"",qty,"Auto-created from Production Formula. Approval is for audit/checking only and does not block production."]);
        if(check.rowCount){
          for(const line of formula.rows){
            const need=num(line.qty)*qty;if(need<=0)continue;
            await client.query("INSERT INTO factory_check_item (report_id,raw_item_name,expected_qty,consumed_qty,unit,additional,status) VALUES ($1,$2,$3,$3,$4,false,'PENDING')",[check.rows[0].id,line.raw_item_name,need,line.unit||"PCS"]);
          }
        }
        await client.query("COMMIT");
        return Response.json({success:true,row:r.rows[0],data:r.rows[0],bom_consumed:formula.rowCount},{status:201});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
  return null;
}

// ---------------- PUT / PATCH / DELETE ----------------
export async function productionMutation(req:Request,path:string[],method:string,a:any,body:any):Promise<Response|null>{
  const p=path.join("/");
    // Production Voucher delete: raw material stock wapas, vehicle row aur factory check report bhi saaf (ek transaction).
    if(method==="DELETE" && /^production-vouchers\/\d+$/.test(p)){
      await ensureProductionVoucherSchema();await ensureFactoryCheckSchema();
      const id=idOf(path[1]);const client=await pool.connect();
      try{
        await client.query("BEGIN");
        const pv=await client.query("SELECT * FROM production_voucher WHERE id=$1 FOR UPDATE",[id]);
        if(!pv.rowCount){await client.query("ROLLBACK");return Response.json({error:"Production Voucher not found."},{status:404});}
        const old=pv.rows[0],ch=String(old.chassis_no||"").trim();
        if(ch){
          const vh=await client.query("SELECT stage FROM vehicle WHERE upper(btrim(chassis_no))=upper($1) FOR UPDATE",[ch]);
          const st=String(vh.rows[0]?.stage||"Manufacturing");
          if(vh.rowCount&&st.toLowerCase()!=="manufacturing")throw new Error("Chassis "+ch+" ki gaadi aage ke stage ("+st+") me ja chuki hai, voucher delete nahi ho sakta.");
          await client.query("DELETE FROM vehicle WHERE upper(btrim(chassis_no))=upper($1)",[ch]);
        }
        const reversed=await reverseProductionStock(client,String(old.vou_no));
        await client.query("DELETE FROM factory_check_report WHERE production_voucher_id=$1",[id]);
        await client.query("DELETE FROM production_voucher WHERE id=$1",[id]);
        await client.query("COMMIT");
        await audit(a,p.split("/")[0],"delete",id,old,null,null,old.vou_no);
        return Response.json({success:true,row:old,stock_reversed:reversed});
      }catch(e:any){await client.query("ROLLBACK");return Response.json({error:e.message||"Delete failed"},{status:400})}finally{client.release()}
    }
    // Production Voucher edit: purani consumption hatakar nayi qty/formula ke hisab se dobara (stock check ke saath).
    if((method==="PUT"||method==="PATCH") && /^production-vouchers\/\d+$/.test(p)){
      await ensureProductionVoucherSchema();await ensureFactoryCheckSchema();
      const id=idOf(path[1]),cols=await columns("production_voucher"),input:any={};
      for(const [k,v] of Object.entries(body||{})){const c=snake(k);if(cols.has(c)&&c!=="id"&&c!=="created_at")input[c]=v;}
      if("quantity" in input)input.quantity=Math.max(1,Math.trunc(num(input.quantity)||1));
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        const pv=await client.query("SELECT * FROM production_voucher WHERE id=$1 FOR UPDATE",[id]);
        if(!pv.rowCount){await client.query("ROLLBACK");return Response.json({error:"Production Voucher not found."},{status:404});}
        const old=pv.rows[0],keys=Object.keys(input);
        if(!keys.length)throw new Error("No valid fields supplied.");
        if("chassis_no" in input){
          const newCh=String(input.chassis_no||"").trim(),oldCh=String(old.chassis_no||"").trim();
          input.chassis_no=newCh;
          if(newCh&&newCh.toUpperCase()!==oldCh.toUpperCase()){
            await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",["chassis:"+newCh.toUpperCase()]);
            const dup=await client.query("SELECT 1 FROM vehicle WHERE upper(btrim(chassis_no))=upper($1) UNION ALL SELECT 1 FROM production_voucher WHERE upper(btrim(chassis_no))=upper($1) AND id<>$2 LIMIT 1",[newCh,id]);
            if(dup.rowCount)throw new Error("Chassis No. \""+newCh+"\" already exists. Duplicate chassis nahi ban sakta.");
          }
        }
        const prod=String(input.product_name??old.product_name??""),fname=String(input.formula_name??old.formula_name??"");
        if(!fname.trim()){
          const fc=await client.query("SELECT COUNT(DISTINCT formula_name)::int AS n FROM production_formula WHERE product_name=$1",[prod]);
          if(Number(fc.rows[0]?.n||0)>1)throw new Error("Is model ke ek se zyada formula hain. Formula Name select karein.");
        }
        const up=await client.query('UPDATE production_voucher SET '+keys.map((k,i)=>'"'+k+'"=$'+(i+1)).join(",")+' WHERE id=$'+(keys.length+1)+" RETURNING *, to_char(date,'YYYY-MM-DD') AS date_s",[...keys.map(k=>input[k]),id]);
        const nv=up.rows[0];
        // Sirf Mechanic / Colour / Motor No. jaisi cheezein badli hon (product, formula, quantity, date same) to stock dobara nahi kata/lauta -
        // purane imported vouchers me mechanic bharte waqt "Insufficient stock" na aaye.
        const sameVal=(k:string,f:(x:any)=>string)=>!(k in input)||f(input[k])===f(old[k]);
        const stockChanged=!(sameVal("product_name",x=>String(x||"").trim())&&sameVal("formula_name",x=>String(x||"").trim())&&sameVal("quantity",x=>String(Math.max(1,Math.trunc(num(x)||1))))&&sameVal("date",x=>ymd(x)||""));
        let formula:any={rows:[]};
        if(stockChanged){
          await reverseProductionStock(client,String(old.vou_no));
          formula=await consumeProductionStock(client,{vou_no:String(nv.vou_no),date:nv.date_s||null,product_name:String(nv.product_name||""),formula_name:String(nv.formula_name||""),quantity:nv.quantity});
        }
        const rep=await client.query("SELECT id,status FROM factory_check_report WHERE production_voucher_id=$1 FOR UPDATE",[id]);
        if(stockChanged&&rep.rowCount&&String(rep.rows[0].status).toUpperCase()!=="APPROVED"){
          const q=Math.max(1,Math.trunc(num(nv.quantity)||1));
          await client.query("UPDATE factory_check_report SET product_name=$1,quantity=$2,date=COALESCE($3::date,date) WHERE id=$4",[nv.product_name||"",q,nv.date_s||null,rep.rows[0].id]);
          await client.query("DELETE FROM factory_check_item WHERE report_id=$1 AND additional=false",[rep.rows[0].id]);
          for(const line of formula.rows){const need=num(line.qty)*q;if(need<=0)continue;await client.query("INSERT INTO factory_check_item (report_id,raw_item_name,expected_qty,consumed_qty,unit,additional,status) VALUES ($1,$2,$3,$3,$4,false,'PENDING')",[rep.rows[0].id,line.raw_item_name,need,line.unit||"PCS"]);}
        }
        await client.query("COMMIT");
        delete nv.date_s;
        await audit(a,"production-vouchers","edit",id,old,nv,null,nv.vou_no);
        return Response.json({success:true,row:nv,data:nv});
      }catch(e:any){await client.query("ROLLBACK");return Response.json({error:e.message||"Update failed"},{status:400})}finally{client.release()}
    }
    // Production Formula: poora formula (ek product + formula name ki saari lines) delete.
    if(method==="DELETE" && p==="production-formulas/by-product"){
      await ensureProductionFormulaSchema();
      const u=new URL(req.url),product=String(u.searchParams.get("product_name")||"").trim(),formula=String(u.searchParams.get("formula_name")||"").trim();
      if(!product)return Response.json({error:"Product zaroori hai."},{status:400});
      const r=await pool.query("DELETE FROM production_formula WHERE "+NORM("product_name")+"="+NORM("$1")+" AND "+NORM("formula_name")+"="+NORM("$2"),[product,formula]);
      return Response.json({success:r.rowCount>0,deleted:r.rowCount});
    }
  return null;
}
