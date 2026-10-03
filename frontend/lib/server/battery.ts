// Battery module: Battery Fit, Addition, Withdrawal, Swap vouchers, Register, History + Dealer battery stock/adjustment/sales
// (bade route file se nikala gaya, logic/queries same hain).
// Schema/register helpers dusre modules (delivery-challan, tax-invoice) bhi use karte hain, isliye export hain.
import { addColumns, columns, idOf, num, pool, ymd } from "./common";
import { ensureBillingSalesSchema } from "./billing";

export type BatteryDeps = {
  ensureNotificationSchema: any;
  parseItems: any;
};

let batteryMovementSchemaReady:Promise<void>|null=null;
export function ensureBatteryMovementSchema():Promise<void>{
  if(!batteryMovementSchemaReady){
    batteryMovementSchemaReady=(async()=>{
      await pool.query("CREATE TABLE IF NOT EXISTS battery_stock_movement (id bigserial PRIMARY KEY,date date NOT NULL DEFAULT CURRENT_DATE,dealer_id integer,battery_maker text,battery_no text,reference_no text,movement_type text,created_at timestamptz NOT NULL DEFAULT now())");
      await addColumns("battery_stock_movement",{vehicle_id:"integer",rickshaw_type:"text",remarks:"text",created_by:"text"});
    })().catch((e)=>{batteryMovementSchemaReady=null;throw e});
  }
  return batteryMovementSchemaReady;
}
// Dealer battery stock = har battery ki LATEST movement dekho: withdrawal/delivery => dealer stock me hai; addition => rickshaw par lagi hui.
// (Pehle "kabhi addition hua to hamesha hidden" logic tha, isliye withdraw ke baad battery wapas stock me nahi dikhti thi.)
export const DEALER_BATTERY_STOCK_SQL="SELECT * FROM (SELECT DISTINCT ON (upper(trim(battery_no))) * FROM battery_stock_movement WHERE dealer_id=$1 AND COALESCE(trim(battery_no),'')<>'' ORDER BY upper(trim(battery_no)),id DESC) t WHERE movement_type IN ('withdrawal','delivery') ORDER BY date DESC,id DESC";
let batteryRegisterSchemaReady:Promise<void>|null=null;
// Ek hi baar chalta hai. Pehle har call par ALTER TABLE pool se chalta tha; challan transaction ke andar wo lock me atak kar request hang kar deta tha.
export function ensureBatteryRegisterSchema():Promise<void>{
  if(!batteryRegisterSchemaReady){
    batteryRegisterSchemaReady=(async()=>{
  await pool.query("CREATE TABLE IF NOT EXISTS battery_register_entry (id bigserial PRIMARY KEY, date date NOT NULL DEFAULT CURRENT_DATE, battery_maker text NOT NULL, battery_no text, qty numeric NOT NULL DEFAULT 1, entry_type text NOT NULL, source_type text NOT NULL, source_id integer, source_no text, party_name text, dealer_id integer, vehicle_id integer, remarks text, created_at timestamptz NOT NULL DEFAULT now())");
  for(const [name,type] of [["date","date"],["battery_maker","text"],["battery_no","text"],["qty","numeric NOT NULL DEFAULT 1"],["entry_type","text"],["source_type","text"],["source_id","integer"],["source_no","text"],["party_name","text"],["dealer_id","integer"],["vehicle_id","integer"],["remarks","text"]]) await pool.query('ALTER TABLE battery_register_entry ADD COLUMN IF NOT EXISTS "'+name+'" '+type);
  await pool.query("CREATE INDEX IF NOT EXISTS battery_register_entry_maker_idx ON battery_register_entry (battery_maker)");
  await pool.query("CREATE INDEX IF NOT EXISTS battery_register_entry_no_idx ON battery_register_entry (battery_no)");
  await pool.query("CREATE INDEX IF NOT EXISTS battery_register_entry_source_idx ON battery_register_entry (source_type,source_id)");
    })().catch((e:any)=>{batteryRegisterSchemaReady=null;throw e});
  }
  return batteryRegisterSchemaReady;
}
let batteryFitSchemaReady:Promise<void>|null=null;
export function ensureBatteryFitSchema():Promise<void>{
  if(!batteryFitSchemaReady){batteryFitSchemaReady=ensureBatteryFitSchemaOnce().catch((e:any)=>{batteryFitSchemaReady=null;throw e});}
  return batteryFitSchemaReady;
}
async function ensureBatteryFitSchemaOnce(){
  await ensureBatteryRegisterSchema();
  await pool.query("ALTER TABLE delivery_challan ADD COLUMN IF NOT EXISTS battery_fit_date date");
  await pool.query("ALTER TABLE vehicle ADD COLUMN IF NOT EXISTS battery_fit_date date");
  await pool.query(`CREATE TABLE IF NOT EXISTS battery_fit_log (
    id bigserial PRIMARY KEY,
    fit_date date NOT NULL DEFAULT CURRENT_DATE,
    challan_id bigint NOT NULL,
    challan_no text,
    dealer_id integer,
    dealer_name text,
    vehicle_id bigint,
    chassis_no text,
    model_name text,
    battery_maker text,
    battery_no1 text,
    battery_no2 text,
    battery_no3 text,
    battery_no4 text,
    old_battery_maker text,
    old_battery_no1 text,
    old_battery_no2 text,
    old_battery_no3 text,
    old_battery_no4 text,
    reference_no text,
    remarks text,
    fitted_by text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`);
  await pool.query("CREATE INDEX IF NOT EXISTS battery_fit_log_challan_idx ON battery_fit_log(challan_id)");
  await pool.query("CREATE INDEX IF NOT EXISTS battery_fit_log_date_idx ON battery_fit_log(fit_date)");
}
export async function toggleBatteryRegisterForDelivery(client:any,dc:any,cancelled:boolean){
  await ensureBatteryRegisterSchema();const vr=dc.vehicle_id?await client.query("SELECT battery_maker,battery_no1,battery_no2,battery_no3,battery_no4 FROM vehicle WHERE id=$1 FOR UPDATE",[dc.vehicle_id]):{rows:[]};
  const maker=String(vr.rows[0]?.battery_maker||"").trim(),nums=[1,2,3,4].map(i=>String(vr.rows[0]?.["battery_no"+i]||"").trim()).filter(Boolean);if(!maker||!nums.length)return;
  const entryType=cancelled?"IN":"OUT",sourceType=cancelled?"DELIVERY_CHALLAN_CANCEL":"DELIVERY_CHALLAN";
  for(const no of nums) await client.query("INSERT INTO battery_register_entry (date,battery_maker,battery_no,qty,entry_type,source_type,source_id,source_no,party_name,dealer_id,vehicle_id,remarks) VALUES (COALESCE($1::date,CURRENT_DATE),$2,$3,1,$4,$5,$6,$7,$8,$9,$10,$11)",[dc.date||null,maker,no,entryType,sourceType,dc.id,dc.challan_no||null,dc.dealer_name||null,dc.dealer_id||null,dc.vehicle_id||null,cancelled?"Delivery Challan Cancel":"Battery Issue on Delivery Challan"]);
}
export async function assertBatterySerialsAvailable(client:any,maker:string,numbers:string[]){
  const clean=numbers.map(x=>String(x||"").trim()).filter(Boolean);if(!clean.length)return;if(new Set(clean.map(x=>x.toUpperCase())).size!==clean.length)throw new Error("Duplicate battery number entered in the same Delivery Challan.");
  await ensureBatteryRegisterSchema();const stock=await client.query("SELECT COALESCE(SUM(CASE WHEN entry_type='IN' THEN qty ELSE -qty END),0) AS balance FROM battery_register_entry WHERE upper(trim(battery_maker))=upper(trim($1))",[maker]);
  // Battery minus allowed (purchase qty may be entered later than challan) - no stock-insufficient block here.
  for(const no of clean){const used=await client.query("SELECT COALESCE(SUM(CASE WHEN entry_type='IN' THEN qty ELSE -qty END),0) AS balance FROM battery_register_entry WHERE upper(trim(battery_maker))=upper(trim($1)) AND upper(trim(COALESCE(battery_no,'')))=upper(trim($2))",[maker,no]);if(Number(used.rows[0]?.balance||0)<0)throw new Error("Battery No. "+no+" is already in use.");}
}

// ---------------- GET ----------------
export async function batteryGet(req:Request,path:string[],a:any,deps:BatteryDeps):Promise<Response|null>{
  const p=path.join("/");
  const {parseItems}=deps;
    if(p==="battery-fit"){
      await ensureBatteryFitSchema();
      const u=new URL(req.url),q=String(u.searchParams.get("search")||"").trim();
      const args:any[]=[]; const where=["COALESCE(dc.cancelled,false)=false"];
      where.push("NOT EXISTS (SELECT 1 FROM tax_invoice ti WHERE ti.delivery_challan_id=dc.id AND COALESCE(ti.cancelled,false)=false)");
      where.push("dc.vehicle_id IS NOT NULL");
      if(a?.scope==="dealer"){args.push(num(a.dealer_id));where.push("dc.dealer_id=$"+args.length);}
      if(q){args.push("%"+q+"%");where.push("(dc.challan_no ILIKE $"+args.length+" OR dc.chassis_no ILIKE $"+args.length+" OR COALESCE(d.name,'') ILIKE $"+args.length+")");}
      const r=await pool.query(`SELECT dc.id,dc.challan_no,dc.date,dc.dealer_id,d.name AS dealer_name,dc.vehicle_id,
        dc.chassis_no,dc.product_name,v.model_name,v.battery_maker,v.battery_no1,v.battery_no2,v.battery_no3,v.battery_no4,
        dc.battery_fit_date
        FROM delivery_challan dc LEFT JOIN dealer d ON d.id=dc.dealer_id LEFT JOIN vehicle v ON v.id=dc.vehicle_id
        WHERE ${where.join(" AND ")} ORDER BY dc.date DESC,dc.id DESC LIMIT 500`,args);
      return Response.json({challans:r.rows});
    }
    if(p==="battery-addition"&&a.scope==="staff"){
      const u=new URL(req.url);
      if(String(u.searchParams.get("location")||"").toLowerCase()==="factory"){
        const r=await pool.query("SELECT id,chassis_no,model_name,battery_maker FROM vehicle WHERE COALESCE(to_jsonb(vehicle)->>'stage','')='Manufacturing' AND COALESCE(NULLIF(trim(battery_no1),''),NULLIF(trim(battery_no2),''),NULLIF(trim(battery_no3),''),NULLIF(trim(battery_no4),'')) IS NULL ORDER BY id DESC LIMIT 2000");
        return Response.json({rickshaws:r.rows.map((x:any)=>({id:x.id,reg_no:null,chassis_no:x.chassis_no,model_name:x.model_name,battery_maker:x.battery_maker,battery_numbers:[]}))});
      }
      await ensureBatteryMovementSchema();
      const did=idOf(u.searchParams.get("dealer_id"));
      if(!did)return Response.json({batteries:[],count:0});
      // Har battery ki LATEST movement dekho: withdrawal/delivery = dealer stock me available; addition = rickshaw par lagi hui.
      const r=await pool.query("SELECT * FROM (SELECT DISTINCT ON (upper(trim(battery_no))) * FROM battery_stock_movement WHERE dealer_id=$1 AND COALESCE(trim(battery_no),'')<>'' ORDER BY upper(trim(battery_no)),id DESC) t WHERE movement_type IN ('withdrawal','delivery') ORDER BY date DESC,id DESC",[did]);
      const batteries=r.rows.map((x:any)=>({...x,qty:1}));
      return Response.json({batteries,count:batteries.length});
    }
    if(p==="battery-swap-vouchers"&&a.scope==="staff"){
      if(!(await columns("battery_swap_voucher")).size)return Response.json({records:[],rows:[]});
      const r=await pool.query("SELECT bsv.*,d.name AS dealer_name FROM battery_swap_voucher bsv LEFT JOIN dealer d ON d.id=bsv.dealer_id ORDER BY bsv.date DESC,bsv.id DESC LIMIT 1000");
      const isOld=(t:any)=>String(t||"").toLowerCase().includes("old");
      const ids=(side:string,old:boolean)=>[...new Set(r.rows.filter((x:any)=>isOld(x[side+"_type"])===old).map((x:any)=>Number(x[side+"_id"])).filter((n:number)=>n>0))];
      const load=async(table:string,list:number[])=>{const m=new Map<number,any>();if(list.length){const q=await pool.query('SELECT * FROM "'+table+'" WHERE id=ANY($1::bigint[])',[list]);q.rows.forEach((x:any)=>m.set(Number(x.id),x));}return m;};
      const vNew=await load("vehicle",[...new Set([...ids("from",false),...ids("to",false)])] as number[]);
      const vOld=await load("old_rickshaw",[...new Set([...ids("from",true),...ids("to",true)])] as number[]);
      const side=(x:any,sd:string)=>{
        const row=(isOld(x[sd+"_type"])?vOld:vNew).get(Number(x[sd+"_id"]));
        const nums=row?[1,2,3,4].map(i=>String(row["battery_no"+i]||"").trim()).filter(Boolean):[];
        return {[sd+"_model_name"]:row?.model_name||"",[sd+"_chassis_no"]:row?.chassis_no||"",[sd+"_reg_no"]:row?.vehicle_reg_no||row?.vehicle_no||"",[sd+"_battery_maker"]:row?.battery_maker||"",[sd+"_battery_numbers"]:nums};
      };
      const records=r.rows.map((x:any)=>({...x,...side(x,"from"),...side(x,"to")}));
      return Response.json({records,rows:records});
    }
    if(p==="battery-withdrawal"&&a.scope==="staff"){
      await ensureBatteryMovementSchema();
      const r=await pool.query("SELECT m.*,d.name AS dealer_name FROM battery_stock_movement m LEFT JOIN dealer d ON d.id=m.dealer_id WHERE m.movement_type='withdrawal' ORDER BY m.date DESC,m.id DESC LIMIT 1000");
      return Response.json({records:r.rows,rows:r.rows});
    }
    if(p==="dealer/rickshaw-battery-options"){
      const ou=new URL(req.url),otype=String(ou.searchParams.get("type")||"new").toLowerCase();
      const odid=a.scope==="dealer"?num(a.dealer_id):num(ou.searchParams.get("dealer_id"));
      if(!odid)return Response.json({rickshaws:[]});
      const nums=(r:any)=>[r.battery_no1,r.battery_no2,r.battery_no3,r.battery_no4].map((x:any)=>String(x||"").trim()).filter(Boolean);
      if(otype.includes("old")){
        const orr=await pool.query("SELECT id,vehicle_reg_no,chassis_no,model_name,battery_maker,battery_no1,battery_no2,battery_no3,battery_no4 FROM old_rickshaw WHERE dealer_id=$1 AND status IN ('available','sold') ORDER BY date DESC,id DESC",[odid]);
        return Response.json({rickshaws:orr.rows.map((r:any)=>({id:r.id,reg_no:r.vehicle_reg_no,chassis_no:r.chassis_no,model_name:r.model_name,battery_maker:r.battery_maker,battery_numbers:nums(r),has_battery:nums(r).length>0}))});
      }
      const odr=await pool.query("SELECT name FROM dealer WHERE id=$1",[odid]);
      if(!odr.rowCount)return Response.json({rickshaws:[]});
      const nr=await pool.query("SELECT id,chassis_no,model_name,battery_maker,battery_no1,battery_no2,battery_no3,battery_no4 FROM vehicle WHERE stage='Delivery Challan' AND lower(trim(COALESCE(dealer_name,'')))=lower(trim($1)) ORDER BY date DESC,id DESC",[odr.rows[0].name]);
      return Response.json({rickshaws:nr.rows.map((r:any)=>({id:r.id,reg_no:null,chassis_no:r.chassis_no,model_name:r.model_name,battery_maker:r.battery_maker,battery_numbers:nums(r),has_battery:nums(r).length>0}))});
    }
    if(p==="dealer/battery-adjustment"&&a.scope==="dealer"){
      const did=num(a.dealer_id);
      const dr=await pool.query("SELECT id,name FROM dealer WHERE id=$1",[did]);
      if(!dr.rowCount)return Response.json({error:"Dealer not found."},{status:404});
      await ensureBatteryMovementSchema();
      const stock=await pool.query(DEALER_BATTERY_STOCK_SQL,[did]);
      const batteries=stock.rows.map((x:any)=>({...x,qty:1}));
      const vehicles=await pool.query("SELECT id,date,model_name,chassis_no,motor_no,stage,dealer_name,battery_maker,battery_no1,battery_no2,battery_no3,battery_no4 FROM vehicle WHERE stage='Delivery Challan' AND lower(trim(COALESCE(dealer_name,'')))=lower(trim($1)) ORDER BY date DESC,id DESC",[dr.rows[0].name]);
      return Response.json({batteries,vehicles:vehicles.rows,makers:[...new Set(batteries.map((x:any)=>String(x.battery_maker||"").trim()).filter(Boolean))]});
    }
    if(p==="dealer/battery-stock"&&a.scope==="dealer"){
      await ensureBatteryMovementSchema();
      const r=await pool.query(DEALER_BATTERY_STOCK_SQL,[num(a.dealer_id)]);
      const batteries=r.rows.map((x:any)=>({...x,qty:1}));
      return Response.json({batteries,count:batteries.length});
    }
    if(p==="dealer/battery-sales"&&a.scope==="dealer"){
      await ensureBillingSalesSchema();
      const r=await pool.query("SELECT s.id,COALESCE(s.sale_date,s.created_at::date) AS date,COALESCE(NULLIF(s.customer_name,''),c.full_name,'') AS customer_name,COALESCE(s.description,'') AS description,COALESCE(s.sale_amount,0) AS sale_amount,COALESCE(s.hypothecation_amount,0) AS loan_amount,COALESCE(s.amount_received,0) AS amount_received,s.status,COALESCE(s.page_no,'') AS page_no FROM grd_billing_sale s LEFT JOIN customer c ON c.id=s.customer_id WHERE s.dealer_id=$1 AND UPPER(COALESCE(s.sale_type,''))='BATTERY' AND s.status IN ('PENDING','APPROVED','BILLED') ORDER BY COALESCE(s.sale_date,s.created_at::date) DESC,s.id DESC",[num(a.dealer_id)]);
      return Response.json({sales:r.rows,count:r.rowCount});
    }
    if(p==="battery-register"){
      await ensureBatteryRegisterSchema();
      const u=new URL(req.url),q=String(u.searchParams.get("search")||"").trim(),args:any[]=[],where:string[]=[];
      if(q){args.push("%"+q+"%");where.push("(battery_maker ILIKE $1 OR COALESCE(battery_no,'') ILIKE $1 OR COALESCE(source_no,'') ILIKE $1 OR COALESCE(party_name,'') ILIKE $1)");}
      const makers=await pool.query("SELECT name FROM simple_master WHERE kind='battery-maker' ORDER BY name");
      const entries=await pool.query("SELECT * FROM battery_register_entry"+(where.length?" WHERE "+where.join(" AND "):"")+" ORDER BY date DESC,id DESC",args);
      const byMaker=new Map<string,any>();
      for(const m of makers.rows){const name=String(m.name||"").trim();if(name)byMaker.set(name.toLowerCase(),{battery_maker:name,in_qty:0,out_qty:0,balance:0});}
      for(const x of entries.rows){const key=String(x.battery_maker||"").trim().toLowerCase();if(!key)continue;if(!byMaker.has(key))byMaker.set(key,{battery_maker:String(x.battery_maker||"").trim(),in_qty:0,out_qty:0,balance:0});const s=byMaker.get(key),qty=Number(x.qty||0);if(String(x.entry_type).toUpperCase()==="IN")s.in_qty+=qty;else s.out_qty+=qty;s.balance=s.in_qty-s.out_qty;}
      const summary=[...byMaker.values()].filter(x=>!q||String(x.battery_maker).toLowerCase().includes(q.toLowerCase())||entries.rows.some(e=>String(e.battery_maker||"").toLowerCase()===String(x.battery_maker).toLowerCase()));
      const groups=new Map<string,any>();
      for(const x of entries.rows){const key=String(x.source_type||"")+"::"+String(x.source_id||"")+"::"+String(x.date||"")+"::"+String(x.battery_maker||"")+"::"+String(x.entry_type||"");if(!groups.has(key))groups.set(key,{id:x.id,date:x.date,battery_maker:x.battery_maker,entry_type:x.entry_type,qty:0,source_type:x.source_type,source_id:x.source_id,source_no:x.source_no,party_name:x.party_name,dealer_id:x.dealer_id,vehicle_id:x.vehicle_id,remarks:x.remarks,battery_nos:[]});const g=groups.get(key);g.qty+=Number(x.qty||0);if(x.battery_no)g.battery_nos.push(x.battery_no);}
      const details=[...groups.values()].map((x:any)=>({...x,battery_no1:x.battery_nos[0]||"",battery_no2:x.battery_nos[1]||"",battery_no3:x.battery_nos[2]||"",battery_no4:x.battery_nos[3]||""}));
      return Response.json({summary,details,entries:entries.rows,makers:makers.rows.map((x:any)=>x.name)});
    }
    if(p==="battery-register/preview"){
      const u=new URL(req.url),type=String(u.searchParams.get("type")||"").toLowerCase(),id=idOf(u.searchParams.get("id"));
      if(!id)return Response.json({error:"Preview id required."},{status:400});
      if(type==="purchase"){const r=await pool.query("SELECT * FROM purchase_bill WHERE id=$1",[id]);if(!r.rowCount)return Response.json({error:"Purchase not found."},{status:404});return Response.json({type:"purchase",purchase:{...r.rows[0],items:parseItems(r.rows[0].items)}});}
      if(type==="delivery_challan"){const r=await pool.query("SELECT dc.*,d.name AS dealer_name,v.battery_maker,v.battery_no1,v.battery_no2,v.battery_no3,v.battery_no4,v.model_name,v.chassis_no,v.motor_no,v.colour FROM delivery_challan dc LEFT JOIN dealer d ON d.id=dc.dealer_id LEFT JOIN vehicle v ON v.id=dc.vehicle_id WHERE dc.id=$1",[id]);if(!r.rowCount)return Response.json({error:"Delivery Challan not found."},{status:404});return Response.json({type:"delivery_challan",challan:r.rows[0]});}
      return Response.json({error:"Unknown preview type."},{status:400});
    }
    if(p==="battery-history"){
      await ensureBatteryFitSchema();
      const u=new URL(req.url),q=String(u.searchParams.get("search")||"").trim().toLowerCase(),from=String(u.searchParams.get("from")||"").trim(),to=String(u.searchParams.get("to")||"").trim();
      const events:any[]=[];
      // Ek source (table) fail ho jaye to poori history 500 na de.
      const safe=async(label:string,fn:()=>Promise<any[]>)=>{try{return await fn()}catch(e){console.error("[battery-history:"+label+"]",e);return []}};
      const push=(rows:any[],type:string)=>rows.forEach((r:any)=>events.push({...r,history_type:type}));
      // Purchase IN / Delivery OUT / Withdrawal-Addition register entries
      push(await safe("register",async()=>(await pool.query(`SELECT bre.*,d.name AS dealer_name,v.chassis_no,v.model_name
        FROM battery_register_entry bre
        LEFT JOIN dealer d ON d.id=bre.dealer_id
        LEFT JOIN vehicle v ON v.id=bre.vehicle_id
        ORDER BY bre.date DESC NULLS LAST,bre.id DESC LIMIT 10000`)).rows),"REGISTER");
      push(await safe("fit",async()=>(await pool.query(`SELECT bfl.*,d.name AS dealer_name
        FROM battery_fit_log bfl LEFT JOIN dealer d ON d.id=bfl.dealer_id
        ORDER BY bfl.fit_date DESC,bfl.id DESC LIMIT 5000`)).rows),"FIT");
      // Dealer withdrawal / addition / delivery movements
      push(await safe("movement",async()=>{
        if(!(await columns("battery_stock_movement")).size)return [];
        return (await pool.query(`SELECT bsm.*,d.name AS dealer_name
          FROM battery_stock_movement bsm LEFT JOIN dealer d ON d.id=bsm.dealer_id
          ORDER BY bsm.date DESC NULLS LAST,bsm.id DESC LIMIT 10000`)).rows;
      }),"DEALER_MOVEMENT");
      push(await safe("factory",async()=>(await pool.query(`SELECT bdc.*,d.name AS dealer_name
        FROM battery_delivery_challan bdc LEFT JOIN dealer d ON d.id=bdc.dealer_id
        ORDER BY bdc.date DESC NULLS LAST,bdc.id DESC LIMIT 5000`)).rows),"FACTORY_CHALLAN");
      // Battery Swap / Transfer vouchers (pehle history me tha hi nahi)
      push(await safe("swap",async()=>{
        if(!(await columns("battery_swap_voucher")).size)return [];
        const ref=(side:string)=>`CASE WHEN lower(COALESCE(bsv.${side}_type,'')) LIKE '%old%'
          THEN (SELECT to_jsonb(o)->>'vehicle_no' FROM old_rickshaw o WHERE o.id=bsv.${side}_id)
          ELSE (SELECT vv.chassis_no FROM vehicle vv WHERE vv.id=bsv.${side}_id) END`;
        const r=(await pool.query(`SELECT bsv.*,d.name AS dealer_name,${ref("from")} AS from_ref,${ref("to")} AS to_ref
          FROM battery_swap_voucher bsv LEFT JOIN dealer d ON d.id=bsv.dealer_id
          ORDER BY bsv.date DESC NULLS LAST,bsv.id DESC LIMIT 5000`)).rows;
        return r.map((x:any)=>({...x,movement_type:String(x.mode||"swap").toLowerCase(),reference_no:x.voucher_no,
          chassis_no:[x.from_ref||("#"+x.from_id),x.to_ref||("#"+x.to_id)].join(" → ")}));
      }),"SWAP");
      const dateOf=(r:any)=>ymd(r.fit_date||r.date||r.created_at);
      const inRange=(r:any)=>{const d=dateOf(r);return (!from||(d&&d>=from))&&(!to||(d&&d<=to))};
      const textOf=(r:any)=>[r.battery_maker,r.battery_no,r.battery_no1,r.battery_no2,r.battery_no3,r.battery_no4,r.challan_no,r.source_no,r.source_type,r.entry_type,r.movement_type,r.reference_no,r.voucher_no,r.party_name,r.dealer_name,r.chassis_no,r.model_name,r.remarks].filter(Boolean).join(" ").toLowerCase();
      const rows=events.filter(r=>inRange(r)&&(!q||textOf(r).includes(q))).sort((x,y)=>String(dateOf(y)).localeCompare(String(dateOf(x)))||Number(y.id||0)-Number(x.id||0));
      const counts:any={};for(const r of rows)counts[r.history_type]=(counts[r.history_type]||0)+1;
      return Response.json({history:rows,rows,count:rows.length,counts});
    }
  return null;
}

// ---------------- POST ----------------
export async function batteryPost(path:string[],b:any,a:any,deps:BatteryDeps):Promise<Response|null>{
  const p=path.join("/");
  const {ensureNotificationSchema}=deps;
    if(a.scope==="staff" && p==="battery-addition"){
      await ensureBatteryMovementSchema();
      const loc=String(b.location||"dealer").toLowerCase()==="factory"?"factory":"dealer";
      const rid=idOf(b.rickshaw_id),batteryNo=String(b.battery_no||"").trim();
      const isOld=loc==="dealer"&&String(b.rickshaw_type||"new").toLowerCase().includes("old");
      if(!rid)return Response.json({error:"Rickshaw is required."},{status:400});
      if(!batteryNo)return Response.json({error:"Battery No. is required."},{status:400});
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        if(loc==="factory"){
          const maker=String(b.battery_maker||"").trim();
          if(!maker)throw new Error("Battery Maker is required.");
          const vr=await client.query("SELECT * FROM vehicle WHERE id=$1 AND COALESCE(to_jsonb(vehicle)->>'stage','')='Manufacturing' FOR UPDATE",[rid]);
          if(!vr.rowCount)throw new Error("Rickshaw not found in Factory (Manufacturing) stock.");
          const row=vr.rows[0],slot=[1,2,3,4].find(i=>!String(row["battery_no"+i]||"").trim());
          if(!slot)throw new Error("Rickshaw already has 4 batteries fitted.");
          const dup=await client.query("SELECT chassis_no FROM vehicle WHERE id<>$1 AND upper(trim($2)) IN (upper(trim(COALESCE(battery_no1,''))),upper(trim(COALESCE(battery_no2,''))),upper(trim(COALESCE(battery_no3,''))),upper(trim(COALESCE(battery_no4,'')))) LIMIT 1",[rid,batteryNo]);
          if(dup.rowCount)throw new Error("Battery No. "+batteryNo+" is already fitted on another rickshaw ("+(dup.rows[0].chassis_no||"")+").");
          const existingMaker=String(row.battery_maker||"").trim();
          if(existingMaker&&existingMaker.toLowerCase()!==maker.toLowerCase())throw new Error("Rickshaw already has batteries of a different maker ("+existingMaker+").");
          await client.query('UPDATE vehicle SET "battery_no'+slot+'"=$1,battery_maker=$2 WHERE id=$3',[batteryNo,maker,rid]);
          await client.query("COMMIT");
          // Factory stock register ka OUT entry Delivery Challan banne par hota hai (toggleBatteryRegisterForDelivery), isliye yahan double entry nahi.
          return Response.json({success:true,vehicle_id:rid,battery_no:batteryNo,battery_maker:maker},{status:201});
        }
        const did=idOf(b.dealer_id);
        if(!did)throw new Error("Dealer is required.");
        const dr=await client.query("SELECT id,name FROM dealer WHERE id=$1",[did]);
        if(!dr.rowCount)throw new Error("Dealer not found.");
        const avail=await client.query("SELECT * FROM (SELECT DISTINCT ON (upper(trim(battery_no))) * FROM battery_stock_movement WHERE dealer_id=$1 AND upper(trim(battery_no))=upper(trim($2)) ORDER BY upper(trim(battery_no)),id DESC) t WHERE movement_type IN ('withdrawal','delivery')",[did,batteryNo]);
        if(!avail.rowCount)throw new Error("Battery is not available in this dealer's battery stock.");
        const tbl=isOld?"old_rickshaw":"vehicle";
        const vr=isOld
          ?await client.query("SELECT * FROM old_rickshaw WHERE id=$1 AND dealer_id=$2 FOR UPDATE",[rid,did])
          :await client.query("SELECT * FROM vehicle WHERE id=$1 AND stage='Delivery Challan' AND lower(trim(COALESCE(dealer_name,'')))=lower(trim($2)) FOR UPDATE",[rid,dr.rows[0].name]);
        if(!vr.rowCount)throw new Error("Rickshaw not found in this dealer's stock.");
        const row=vr.rows[0],slot=[1,2,3,4].find(i=>!String(row["battery_no"+i]||"").trim());
        if(!slot)throw new Error("Rickshaw already has 4 batteries fitted.");
        const maker=String(avail.rows[0].battery_maker||b.battery_maker||"").trim()||null;
        const existingMaker=String(row.battery_maker||"").trim();
        if(existingMaker&&maker&&existingMaker.toLowerCase()!==maker.toLowerCase())throw new Error("Rickshaw already has batteries of a different maker ("+existingMaker+").");
        await client.query('UPDATE "'+tbl+'" SET "battery_no'+slot+'"=$1,battery_maker=COALESCE(NULLIF(battery_maker,\'\'),$2) WHERE id=$3',[batteryNo,maker,rid]);
        const mv=await client.query("INSERT INTO battery_stock_movement (date,dealer_id,battery_maker,battery_no,reference_no,movement_type,vehicle_id,rickshaw_type,remarks,created_by,created_at) VALUES (COALESCE($1::date,CURRENT_DATE),$2,$3,$4,$5,'addition',$6,$7,$8,$9,NOW()) RETURNING *",
          [ymd(b.date)||null,did,maker,batteryNo,String(b.reference_no||"").trim()||null,rid,isOld?"old":"new",String(b.remarks||"").trim()||null,String(a.username||a.full_name||a.user_id||"")]);
        await client.query("COMMIT");
        return Response.json({success:true,row:mv.rows[0],vehicle_id:rid,battery_no:batteryNo},{status:201});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    if(a.scope==="staff" && p==="battery-withdrawal"){
      await ensureBatteryMovementSchema();
      const did=idOf(b.dealer_id),rid=idOf(b.rickshaw_id),batteryNo=String(b.battery_no||"").trim();
      const isOld=String(b.rickshaw_type||"new").toLowerCase().includes("old");
      if(!did)return Response.json({error:"Dealer is required."},{status:400});
      if(!rid)return Response.json({error:"Rickshaw is required."},{status:400});
      if(!batteryNo)return Response.json({error:"Battery No. is required."},{status:400});
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        const dr=await client.query("SELECT id,name FROM dealer WHERE id=$1",[did]);
        if(!dr.rowCount)throw new Error("Dealer not found.");
        const tbl=isOld?"old_rickshaw":"vehicle";
        const vr=isOld
          ?await client.query("SELECT * FROM old_rickshaw WHERE id=$1 AND dealer_id=$2 FOR UPDATE",[rid,did])
          :await client.query("SELECT * FROM vehicle WHERE id=$1 AND lower(trim(COALESCE(dealer_name,'')))=lower(trim($2)) FOR UPDATE",[rid,dr.rows[0].name]);
        if(!vr.rowCount)throw new Error("Rickshaw not found in this dealer's stock.");
        const row=vr.rows[0];
        let slot="";
        for(const i of [1,2,3,4]){if(String(row["battery_no"+i]||"").trim().toLowerCase()===batteryNo.toLowerCase()){slot="battery_no"+i;break;}}
        if(!slot)throw new Error("This battery is not fitted on the selected rickshaw.");
        const maker=String(row.battery_maker||"").trim()||null;
        await client.query('UPDATE "'+tbl+'" SET "'+slot+'"=NULL WHERE id=$1',[rid]);
        const left=[1,2,3,4].filter(i=>"battery_no"+i!==slot&&String(row["battery_no"+i]||"").trim()!=="").length;
        if(!left)await client.query('UPDATE "'+tbl+'" SET battery_maker=NULL WHERE id=$1',[rid]);
        const mv=await client.query("INSERT INTO battery_stock_movement (date,dealer_id,battery_maker,battery_no,reference_no,movement_type,vehicle_id,rickshaw_type,remarks,created_by,created_at) VALUES (COALESCE($1::date,CURRENT_DATE),$2,$3,$4,$5,'withdrawal',$6,$7,$8,$9,NOW()) RETURNING *",
          [ymd(b.date)||null,did,maker,batteryNo,String(b.reference_no||"").trim()||null,rid,isOld?"old":"new",String(b.remarks||"").trim()||null,String(a.username||a.full_name||a.user_id||"")]);
        await client.query("COMMIT");
        return Response.json({success:true,row:mv.rows[0],data:mv.rows[0]},{status:201});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    if(a.scope==="dealer" && p==="battery-withdrawal"){
      await ensureBatteryMovementSchema();
      const did=num(a.dealer_id), batteryNo=String(b.battery_no||"").trim();
      if(!batteryNo)return Response.json({error:"Battery No. is required."},{status:400});
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        const dr=await client.query("SELECT id,name FROM dealer WHERE id=$1",[did]);
        if(!dr.rowCount)throw new Error("Dealer not found.");
        // Latest movement: agar battery pehle se dealer stock me hai to dobara withdraw nahi (duplicate stock entry).
        const last=await client.query("SELECT movement_type FROM battery_stock_movement WHERE dealer_id=$1 AND upper(trim(battery_no))=upper(trim($2)) ORDER BY id DESC LIMIT 1",[did,batteryNo]);
        if(last.rowCount&&["withdrawal","delivery"].includes(String(last.rows[0].movement_type)))throw new Error("Battery No. "+batteryNo+" is already in your battery stock.");
        // Agar battery abhi is dealer ki kisi rickshaw par lagi hai to wahan se nikaal do (taaki dobara fit karne par do jagah na dikhe).
        const slotsSql="upper(trim($2)) IN (upper(trim(COALESCE(battery_no1,''))),upper(trim(COALESCE(battery_no2,''))),upper(trim(COALESCE(battery_no3,''))),upper(trim(COALESCE(battery_no4,''))))";
        let maker=String(b.battery_maker||"").trim()||null,vehicleId:number|null=null,rType:string|null=null;
        const vr=await client.query("SELECT * FROM vehicle WHERE stage='Delivery Challan' AND lower(trim(COALESCE(dealer_name,'')))=lower(trim($1)) AND "+slotsSql+" ORDER BY id DESC LIMIT 1 FOR UPDATE",[dr.rows[0].name,batteryNo]);
        const orr=vr.rowCount?{rowCount:0,rows:[]}:await client.query("SELECT * FROM old_rickshaw WHERE dealer_id=$1 AND "+slotsSql+" ORDER BY id DESC LIMIT 1 FOR UPDATE",[did,batteryNo]);
        const fitted=vr.rowCount?vr:orr;
        if(fitted.rowCount){
          const tbl=vr.rowCount?"vehicle":"old_rickshaw",row=fitted.rows[0];
          const slot=[1,2,3,4].find(i=>String(row["battery_no"+i]||"").trim().toLowerCase()===batteryNo.toLowerCase())!;
          await client.query('UPDATE "'+tbl+'" SET "battery_no'+slot+'"=NULL WHERE id=$1',[row.id]);
          const left=[1,2,3,4].filter(i=>i!==slot&&String(row["battery_no"+i]||"").trim()!=="").length;
          if(!left)await client.query('UPDATE "'+tbl+'" SET battery_maker=NULL WHERE id=$1',[row.id]);
          maker=String(row.battery_maker||"").trim()||maker;vehicleId=Number(row.id);rType=vr.rowCount?"new":"old";
        }
        const r=await client.query("INSERT INTO battery_stock_movement (date,dealer_id,battery_maker,battery_no,reference_no,movement_type,vehicle_id,rickshaw_type,remarks,created_by,created_at) VALUES (COALESCE($1::date,CURRENT_DATE),$2,$3,$4,$5,'withdrawal',$6,$7,$8,$9,NOW()) RETURNING *",
          [ymd(b.date)||null,did,maker,batteryNo,String(b.reference_no||"").trim()||null,vehicleId,rType,vehicleId?"Withdrawn from rickshaw":null,String(a.username||a.full_name||a.dealer_id||"")]);
        await client.query("COMMIT");
        return Response.json({success:true,row:r.rows[0],data:r.rows[0],removed_from_rickshaw:Boolean(vehicleId)},{status:201});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    if(a.scope==="dealer" && p==="battery-addition"){
      await ensureBatteryMovementSchema();
      const did=num(a.dealer_id),vehicleId=idOf(b.vehicle_id),batteryNo=String(b.battery_no||"").trim();
      const fromFactory=String(b.source||b.location||"dealer").toLowerCase()==="factory";
      if(!vehicleId||!batteryNo)return Response.json({error:"Vehicle and Battery No. are required."},{status:400});
      if(fromFactory&&!String(b.battery_maker||"").trim())return Response.json({error:"Battery Maker is required for a factory battery."},{status:400});
      if(fromFactory){await ensureBatteryFitSchema();await ensureNotificationSchema();}
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        const dr=await client.query("SELECT id,name FROM dealer WHERE id=$1",[did]);
        if(!dr.rowCount)throw new Error("Dealer not found.");
        const vr=await client.query("SELECT * FROM vehicle WHERE id=$1 AND stage='Delivery Challan' AND lower(trim(COALESCE(dealer_name,'')))=lower(trim($2)) FOR UPDATE",[vehicleId,dr.rows[0].name]);
        if(!vr.rowCount)throw new Error("Vehicle not found in this dealer's stock.");
        const row=vr.rows[0];
        const position=Math.min(4,Math.max(1,Number(b.position)||1));
        const field="battery_no"+position;
        if(String(row[field]||"").trim())throw new Error("Battery position "+position+" par pehle se battery ("+String(row[field]).trim()+") lagi hai. Dusri position chuno ya pehle usse withdraw karo.");
        // Ye battery kisi aur rickshaw par to nahi lagi?
        const dup=await client.query("SELECT chassis_no FROM vehicle WHERE id<>$1 AND upper(trim($2)) IN (upper(trim(COALESCE(battery_no1,''))),upper(trim(COALESCE(battery_no2,''))),upper(trim(COALESCE(battery_no3,''))),upper(trim(COALESCE(battery_no4,'')))) LIMIT 1",[vehicleId,batteryNo]);
        if(dup.rowCount)throw new Error("Battery No. "+batteryNo+" is already fitted on another rickshaw ("+(dup.rows[0].chassis_no||"")+").");
        const stockQ=await client.query("SELECT * FROM (SELECT DISTINCT ON (upper(trim(battery_no))) * FROM battery_stock_movement WHERE dealer_id=$1 AND upper(trim(battery_no))=upper(trim($2)) ORDER BY upper(trim(battery_no)),id DESC) t WHERE movement_type IN ('withdrawal','delivery')",[did,batteryNo]);
        const date=ymd(b.date)||ymd(new Date()),refNo=String(b.reference_no||"").trim()||null,who=String(a.username||a.full_name||a.dealer_id||"");
        if(!fromFactory){
          // Dealer stock se fit
          if(!stockQ.rowCount)throw new Error("Battery is not available in dealer battery stock.");
          const maker=String(b.battery_maker||stockQ.rows[0].battery_maker||"").trim()||null;
          await client.query('UPDATE vehicle SET battery_maker=$1,"'+field+'"=$2 WHERE id=$3',[maker,batteryNo,vehicleId]);
          const mv=await client.query("INSERT INTO battery_stock_movement (date,dealer_id,battery_maker,battery_no,reference_no,movement_type,vehicle_id,rickshaw_type,remarks,created_by,created_at) VALUES ($1::date,$2,$3,$4,$5,'addition',$6,'new','Fitted from dealer stock',$7,NOW()) RETURNING *",[date,did,maker,batteryNo,refNo,vehicleId,who]);
          await client.query("COMMIT");
          return Response.json({success:true,source:"dealer",row:mv.rows[0],vehicle_id:vehicleId,battery_no:batteryNo},{status:201});
        }
        // Factory se fit: battery dealer stock me hona nahi chahiye, aur factory register me pehle issue nahi hui honi chahiye
        if(stockQ.rowCount)throw new Error("Battery No. "+batteryNo+" already your dealer stock me hai - 'Dealer Stock' option se fit karo.");
        const maker=String(b.battery_maker||"").trim();
        await assertBatterySerialsAvailable(client,maker,[batteryNo]);
        const oldNums=[1,2,3,4].map(i=>String(row["battery_no"+i]||"").trim()),oldMaker=String(row.battery_maker||"").trim();
        const newNums=oldNums.slice();newNums[position-1]=batteryNo;
        await client.query('UPDATE vehicle SET battery_maker=COALESCE(NULLIF(battery_maker,\'\'),$1),"'+field+'"=$2,battery_fit_date=$3 WHERE id=$4',[maker,batteryNo,date,vehicleId]);
        // History: factory -> dealer (delivery) + rickshaw par fit (addition)
        const fromRemark="Factory se "+dr.rows[0].name+" ko bheji gayi - rickshaw "+(row.chassis_no||vehicleId)+" par fit";
        await client.query("INSERT INTO battery_stock_movement (date,dealer_id,battery_maker,battery_no,reference_no,movement_type,vehicle_id,rickshaw_type,remarks,created_by,created_at) VALUES ($1::date,$2,$3,$4,$5,'delivery',$6,'new',$7,$8,NOW())",[date,did,maker,batteryNo,refNo,vehicleId,fromRemark,who]);
        const mv=await client.query("INSERT INTO battery_stock_movement (date,dealer_id,battery_maker,battery_no,reference_no,movement_type,vehicle_id,rickshaw_type,remarks,created_by,created_at) VALUES ($1::date,$2,$3,$4,$5,'addition',$6,'new',$7,$8,NOW()) RETURNING *",[date,did,maker,batteryNo,refNo,vehicleId,"Factory battery fitted on "+(row.chassis_no||vehicleId),who]);
        // Delivery challan / battery fit log / factory register update
        const dc=await client.query("SELECT id,challan_no FROM delivery_challan WHERE vehicle_id=$1 AND COALESCE(cancelled,false)=false ORDER BY id DESC LIMIT 1 FOR UPDATE",[vehicleId]);
        const dcRow=dc.rows[0];
        let fitId:number|null=null;
        if(dcRow){
          const billed=await client.query("SELECT 1 FROM tax_invoice WHERE delivery_challan_id=$1 AND COALESCE(cancelled,false)=false LIMIT 1",[dcRow.id]);
          if(!billed.rowCount){
            await client.query('UPDATE delivery_challan SET battery_maker=COALESCE(NULLIF(battery_maker,\'\'),$1),"'+field+'"=$2,battery_fit_date=$3 WHERE id=$4',[maker,batteryNo,date,dcRow.id]);
            const fl=await client.query(`INSERT INTO battery_fit_log
              (fit_date,challan_id,challan_no,dealer_id,dealer_name,vehicle_id,chassis_no,model_name,battery_maker,battery_no1,battery_no2,battery_no3,battery_no4,
               old_battery_maker,old_battery_no1,old_battery_no2,old_battery_no3,old_battery_no4,reference_no,remarks,fitted_by)
              VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING id`,
              [date,dcRow.id,dcRow.challan_no,did,dr.rows[0].name,vehicleId,row.chassis_no,row.model_name,oldMaker||maker,newNums[0]||null,newNums[1]||null,newNums[2]||null,newNums[3]||null,oldMaker||null,oldNums[0]||null,oldNums[1]||null,oldNums[2]||null,oldNums[3]||null,refNo,"Factory battery fitted by dealer",who||null]);
            fitId=Number(fl.rows[0].id);
          }
        }
        await client.query("INSERT INTO battery_register_entry(date,battery_maker,battery_no,qty,entry_type,source_type,source_id,source_no,party_name,dealer_id,vehicle_id,remarks) VALUES($1,$2,$3,1,'OUT','DEALER_FACTORY_FIT',$4,$5,$6,$7,$8,$9)",
          [date,maker,batteryNo,dcRow?Number(dcRow.id):vehicleId,dcRow?.challan_no||row.chassis_no||null,dr.rows[0].name,did,vehicleId,"Factory battery fitted by dealer on "+(row.chassis_no||"rickshaw")]);
        if(fitId){
          await client.query("INSERT INTO app_notification(notification_type,title,message,dealer_id,reference_type,reference_id,dedupe_key) VALUES('battery_change','Factory Battery Fitted on Dealer Rickshaw',$1,$2,'battery_fit',$3,$4) ON CONFLICT(dedupe_key) DO UPDATE SET message=EXCLUDED.message,is_read=false",
            [`${dr.rows[0].name} / ${row.chassis_no||""}: factory battery fitted (${maker} - ${batteryNo}).`,did,fitId,"battery-fit-"+fitId]);
        }
        await client.query("COMMIT");
        return Response.json({success:true,source:"factory",row:mv.rows[0],vehicle_id:vehicleId,battery_no:batteryNo,challan_updated:Boolean(fitId)},{status:201});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    if(p==="battery-fit"){
      await ensureBatteryFitSchema(); await ensureNotificationSchema();
      const challanId=idOf(b.challan_id),fitDate=String(b.fit_date||"").slice(0,10)||ymd(new Date()),maker=String(b.battery_maker||"").trim();
      const nums=[1,2,3,4].map(n=>String(b["battery_no"+n]||"").trim());
      if(!challanId || !maker || !nums[0])return Response.json({error:"Challan, Battery Maker and at least Battery No. 1 are required."},{status:400});
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        const dc=await client.query(`SELECT dc.*,d.name AS dealer_name,v.model_name,v.battery_maker AS old_battery_maker,
          v.battery_no1 AS old_battery_no1,v.battery_no2 AS old_battery_no2,v.battery_no3 AS old_battery_no3,v.battery_no4 AS old_battery_no4
          FROM delivery_challan dc LEFT JOIN dealer d ON d.id=dc.dealer_id LEFT JOIN vehicle v ON v.id=dc.vehicle_id
          WHERE dc.id=$1 FOR UPDATE OF dc`,[challanId]);
        if(!dc.rowCount)throw new Error("Delivery Challan not found.");
        const row=dc.rows[0];
        if(row.cancelled)throw new Error("Cancelled challan par battery fit nahi ho sakti.");
        const inv=await client.query("SELECT id FROM tax_invoice WHERE delivery_challan_id=$1 AND COALESCE(cancelled,false)=false LIMIT 1",[challanId]);
        if(inv.rowCount)throw new Error("Billed challan par battery fit/change nahi ho sakti.");
        if(a?.scope==="dealer" && Number(row.dealer_id)!==Number(a.dealer_id))throw new Error("Ye challan aapke dealer ka nahi hai.");
        const oldNums=[1,2,3,4].map(n=>String(row["old_battery_no"+n]||"").trim()).filter(Boolean);
        const changed=oldNums.join("|")!==nums.filter(Boolean).join("|") || String(row.old_battery_maker||"").trim().toLowerCase()!==maker.toLowerCase();
        await client.query(`UPDATE vehicle SET battery_maker=$1,battery_no1=$2,battery_no2=$3,battery_no3=$4,battery_no4=$5,battery_fit_date=$6 WHERE id=$7`,[maker,nums[0]||null,nums[1]||null,nums[2]||null,nums[3]||null,fitDate,row.vehicle_id]);
        await client.query(`UPDATE delivery_challan SET battery_maker=$1,battery_no1=$2,battery_no2=$3,battery_no3=$4,battery_no4=$5,battery_fit_date=$6 WHERE id=$7`,[maker,nums[0]||null,nums[1]||null,nums[2]||null,nums[3]||null,fitDate,challanId]);
        const ins=await client.query(`INSERT INTO battery_fit_log
          (fit_date,challan_id,challan_no,dealer_id,dealer_name,vehicle_id,chassis_no,model_name,battery_maker,battery_no1,battery_no2,battery_no3,battery_no4,
           old_battery_maker,old_battery_no1,old_battery_no2,old_battery_no3,old_battery_no4,reference_no,remarks,fitted_by)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING id`,
          [fitDate,challanId,row.challan_no,row.dealer_id,row.dealer_name,row.vehicle_id,row.chassis_no,row.model_name,maker,nums[0]||null,nums[1]||null,nums[2]||null,nums[3]||null,row.old_battery_maker||null,row.old_battery_no1||null,row.old_battery_no2||null,row.old_battery_no3||null,row.old_battery_no4||null,b.reference_no||null,b.remarks||null,String(a?.username||a?.full_name||a?.id||"").trim()||null]);
        const newNums=nums.filter(Boolean),oldMakerName=String(row.old_battery_maker||"").trim(),sameMaker=oldMakerName.toLowerCase()===maker.toLowerCase();
        const oldKey=new Set(oldNums.map(x=>x.toUpperCase())),newKey=new Set(newNums.map(x=>x.toUpperCase()));
        // Register me sirf actual movement: purani battery wapas IN, nayi battery OUT. Same battery dobara save ho to koi double entry nahi.
        const returnNums=oldMakerName?oldNums.filter(x=>!sameMaker||!newKey.has(x.toUpperCase())):[];
        const issueNums=newNums.filter(x=>!sameMaker||!oldKey.has(x.toUpperCase()));
        await assertBatterySerialsAvailable(client,maker,issueNums);
        const regIds:number[]=[];
        const regSql="INSERT INTO battery_register_entry(date,battery_maker,battery_no,qty,entry_type,source_type,source_id,source_no,party_name,dealer_id,vehicle_id,remarks) VALUES($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id";
        for(const no of returnNums){const rr=await client.query(regSql,[fitDate,oldMakerName,no,"IN","DELIVERY_CHALLAN_FIT_RETURN",challanId,row.challan_no,row.dealer_name,row.dealer_id,row.vehicle_id,"Old battery returned - battery changed on Delivery Challan"]);regIds.push(Number(rr.rows[0].id));}
        for(const no of issueNums){const rr=await client.query(regSql,[fitDate,maker,no,"OUT","DELIVERY_CHALLAN_FIT",challanId,row.challan_no,row.dealer_name,row.dealer_id,row.vehicle_id,"Battery fitted to Delivery Challan"+(changed&&oldNums.length?" (battery changed)":"")]);regIds.push(Number(rr.rows[0].id));}
        const title=changed&&oldNums.length?"Battery Changed on Dealer Challan":"Battery Fitted on Dealer Challan";
        const msg=changed&&oldNums.length
          ? `${row.challan_no||"Challan"} / ${row.chassis_no||""}: battery changed to ${maker} - ${nums.filter(Boolean).join(", ")}.`
          : `${row.challan_no||"Challan"} / ${row.chassis_no||""}: battery fitted (${maker} - ${nums.filter(Boolean).join(", ")}).`;
        await client.query("INSERT INTO app_notification(notification_type,title,message,dealer_id,reference_type,reference_id,dedupe_key) VALUES('battery_change',$1,$2,$3,'battery_fit',$4,$5) ON CONFLICT(dedupe_key) DO UPDATE SET message=EXCLUDED.message,is_read=false",[title,msg,row.dealer_id,Number(ins.rows[0].id),Number(ins.rows[0].id),"battery-fit-"+Number(ins.rows[0].id)]);
        await client.query("COMMIT");
        return Response.json({success:true,fit_id:Number(ins.rows[0].id),register_id:regIds[0]||null,battery_fit_date:fitDate});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    if(p==="battery-swap-vouchers"){
      const fromType=String(b.from_type||"vehicle").toLowerCase(),toType=String(b.to_type||"vehicle").toLowerCase();
      const fromTable=fromType.includes("old")?"old_rickshaw":"vehicle",toTable=toType.includes("old")?"old_rickshaw":"vehicle";
      const fromId=idOf(b.from_id),toId=idOf(b.to_id);
      if(!fromId||!toId)return Response.json({error:"Source and target are required."},{status:400});
      if(fromTable===toTable&&fromId===toId)return Response.json({error:"Source and target must be different rickshaws."},{status:400});
      if(a.scope==="dealer"){
        const did=num(a.dealer_id);
        const dr=await pool.query("SELECT name FROM dealer WHERE id=$1",[did]);
        if(!dr.rowCount)return Response.json({error:"Dealer not found."},{status:404});
        const ownedNew=async(id:number,table:string)=>table==="old_rickshaw"
          ?(await pool.query("SELECT id FROM old_rickshaw WHERE id=$1 AND dealer_id=$2",[id,did])).rowCount===1
          :(await pool.query("SELECT id FROM vehicle WHERE id=$1 AND stage='Delivery Challan' AND lower(trim(COALESCE(dealer_name,'')))=lower(trim($2))",[id,dr.rows[0].name])).rowCount===1;
        if(!(await ownedNew(fromId,fromTable))||!(await ownedNew(toId,toTable)))return Response.json({error:"Both rickshaws must be in your dealer stock."},{status:403});
      }
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
        await ensureNotificationSchema();
        const swapMsg=`Battery swap on dealer ${num(b.dealer_id)||''}: ${String(source.chassis_no||source.vehicle_no||source.reg_no||fromId)} → ${String(target.chassis_no||target.vehicle_no||target.reg_no||toId)}.`;
        await client.query("INSERT INTO app_notification(notification_type,title,message,dealer_id,reference_type,reference_id,dedupe_key) VALUES('battery_change','Battery Changed / Swapped',$1,$2,'battery_swap',NULL,'battery-swap-'||extract(epoch from clock_timestamp())::bigint)",[swapMsg,num(b.dealer_id)||null]);
        const vr=await client.query("INSERT INTO battery_swap_voucher (voucher_no,date,dealer_id,from_type,from_id,to_type,to_id,mode,remarks,created_at) VALUES (COALESCE(NULLIF($1,''),'BS-'||extract(epoch from now())::bigint),COALESCE($2::date,CURRENT_DATE),$3,$4,$5,$6,$7,$8,$9,NOW()) RETURNING *",
          [String(b.voucher_no||""),b.date||null,num(b.dealer_id)||null,fromType,fromId,toType,toId,mode,b.remarks||null]);
        await client.query("COMMIT");
        return Response.json({success:true,row:vr.rows[0],data:vr.rows[0],source:nextSource,target:nextTarget},{status:201});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
  return null;
}

// ---------------- PUT / PATCH / DELETE ----------------
export async function batteryMutation(req:Request,path:string[],method:string,a:any):Promise<Response|null>{
  const p=path.join("/");
    if(p==="battery-withdrawal"&&method==="DELETE"&&a.scope==="staff"){
      await ensureBatteryMovementSchema();
      const id=idOf(new URL(req.url).searchParams.get("id"));
      if(!id)return Response.json({error:"Record id required."},{status:400});
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        const m=await client.query("SELECT * FROM battery_stock_movement WHERE id=$1 AND movement_type='withdrawal' FOR UPDATE",[id]);
        if(!m.rowCount)throw new Error("Withdrawal record not found.");
        const x=m.rows[0];
        const used=await client.query("SELECT 1 FROM battery_stock_movement WHERE dealer_id=$1 AND movement_type='addition' AND upper(trim(battery_no))=upper(trim($2)) AND id>$3 LIMIT 1",[x.dealer_id,x.battery_no,x.id]);
        if(used.rowCount)throw new Error("This battery is already fitted again; withdrawal cannot be deleted.");
        if(x.vehicle_id){
          const tbl=String(x.rickshaw_type||"")==="old"?"old_rickshaw":"vehicle";
          const vr=await client.query('SELECT * FROM "'+tbl+'" WHERE id=$1 FOR UPDATE',[x.vehicle_id]);
          if(vr.rowCount){
            const row=vr.rows[0],free=[1,2,3,4].find(i=>String(row["battery_no"+i]||"").trim()==="");
            if(!free)throw new Error("Rickshaw has no free battery slot to restore this battery.");
            await client.query('UPDATE "'+tbl+'" SET "battery_no'+free+'"=$1,battery_maker=COALESCE(NULLIF(battery_maker,\'\'),$2) WHERE id=$3',[x.battery_no,x.battery_maker||null,x.vehicle_id]);
          }
        }
        await client.query("DELETE FROM battery_stock_movement WHERE id=$1",[id]);
        await client.query("COMMIT");
        return Response.json({success:true});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
  return null;
}
