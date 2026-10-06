// Delivery Challan module (bade route file se nikala gaya, logic/queries same hain):
// delivery-challans list/create/edit/cancel/delete/print, Challan Shift, Delivery Challan Register report
// aur dealer portal ka dealer/delivery-challans.
import { pool, num, idOf, ymd, todayDate, columns, csvResponse, dateWhere, json } from "./common";
import { audit } from "./permissions";
import { formulaNameSql, ensureProductionVoucherSchema, ensureProductionFormulaSchema } from "./production";
import { TI_CALC } from "./tax-invoice";

let challanShiftSchemaReady:Promise<void>|null=null;
export function ensureChallanShiftSchema():Promise<void>{
  if(!challanShiftSchemaReady){
    challanShiftSchemaReady=(async()=>{
      await pool.query(`CREATE TABLE IF NOT EXISTS delivery_challan_shift (
        id bigserial PRIMARY KEY,
        shift_ref text UNIQUE,
        challan_id bigint NOT NULL,
        challan_no text,
        chassis_no text,
        model_name text,
        battery_maker text,
        battery_no1 text,
        battery_no2 text,
        battery_no3 text,
        battery_no4 text,
        shift_from_dealer_id integer,
        shift_from_dealer_name text,
        shift_to_dealer_id integer,
        shift_to_dealer_name text,
        shift_date date NOT NULL DEFAULT CURRENT_DATE,
        remark text,
        shifted_by text,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
      await pool.query("CREATE INDEX IF NOT EXISTS delivery_challan_shift_challan_idx ON delivery_challan_shift(challan_id)");
      await pool.query("CREATE INDEX IF NOT EXISTS delivery_challan_shift_date_idx ON delivery_challan_shift(shift_date)");
    })().catch(e=>{challanShiftSchemaReady=null;throw e});
  }
  return challanShiftSchemaReady;
}

// ---- Delivery Challan Register speed helpers ----
// Register query tax_invoice / production_voucher / production_formula par lookup karti hai; indexes na hone se full scan hota tha.
let registerIndexesReady:Promise<void>|null=null;
export function ensureRegisterIndexes():Promise<void>{
  if(!registerIndexesReady){
    registerIndexesReady=(async()=>{
      const stmts=[
        "CREATE INDEX IF NOT EXISTS tax_invoice_dc_idx ON tax_invoice(delivery_challan_id,id DESC)",
        "CREATE INDEX IF NOT EXISTS production_voucher_chassis_idx ON production_voucher(lower(btrim(chassis_no)),id DESC)",
        "CREATE INDEX IF NOT EXISTS production_formula_prod_idx ON production_formula(lower(btrim(product_name)))",
        "CREATE INDEX IF NOT EXISTS delivery_challan_date_idx ON delivery_challan(date DESC,id DESC)",
        "CREATE INDEX IF NOT EXISTS delivery_challan_vehicle_idx ON delivery_challan(vehicle_id)",
        "CREATE INDEX IF NOT EXISTS delivery_challan_dealer_idx ON delivery_challan(dealer_id)",
      ];
      for(const q of stmts){try{await pool.query(q)}catch(e){console.error("[register index]",q,e)}}
    })();
  }
  return registerIndexesReady;
}
let registerFilterCache:{t:number,v:any}|null=null;
async function registerFilterLists(){
  if(registerFilterCache&&Date.now()-registerFilterCache.t<60000)return registerFilterCache.v;
  const live="COALESCE(dc.cancelled,false)=false";
  const pr=await pool.query("SELECT DISTINCT btrim(COALESCE(NULLIF(to_jsonb(dc)->>'product_name',''),v.model_name)) AS n FROM delivery_challan dc LEFT JOIN vehicle v ON v.id=dc.vehicle_id WHERE "+live);
  const dl=await pool.query("SELECT DISTINCT d.id,d.name FROM delivery_challan dc JOIN dealer d ON d.id=dc.dealer_id WHERE "+live+" ORDER BY d.name");
  const sm=await pool.query("SELECT DISTINCT btrim(to_jsonb(dc)->>'salesman') AS n FROM delivery_challan dc WHERE "+live);
  const bt=await pool.query("SELECT DISTINCT btrim(COALESCE(NULLIF(v.battery_maker,''),to_jsonb(dc)->>'battery_maker','')) AS n FROM delivery_challan dc LEFT JOIN vehicle v ON v.id=dc.vehicle_id WHERE "+live);
  const names=(r:any)=>r.rows.map((x:any)=>String(x.n||"").trim()).filter(Boolean).sort();
  const v={product:names(pr),dealer:dl.rows.map((x:any)=>({id:x.id,name:x.name})),salesman:names(sm),battery:names(bt)};
  registerFilterCache={t:Date.now(),v};
  return v;
}
export async function deliveryChallanGet(req:Request,path:string[],a:any,deps:any):Promise<Response|null>{
  const p=path.join("/");
  const {ensureBatteryFitSchema,ensureBillingSalesSchema,ensureDispatchSchema,productLogo}=deps||({} as any);
    if(p==="dealer/delivery-challans"&&a.scope==="dealer"){
      const r=await pool.query("SELECT * FROM delivery_challan WHERE dealer_id=$1 ORDER BY date DESC,id DESC",[num(a.dealer_id)]);
      return Response.json({challans:r.rows});
    }
    if(p==="reports/delivery-challan-register"){
      await ensureBatteryFitSchema();try{await ensureBillingSalesSchema()}catch(e){console.error("[register billing schema]",e)}
      void ensureRegisterIndexes();
      const u=new URL(req.url),args:any[]=[],w:string[]=["COALESCE(dc.cancelled,false)=false"];
      const from=u.searchParams.get("from"),to=u.searchParams.get("to"),search=String(u.searchParams.get("search")||"").trim();
      if(from){args.push(from);w.push("dc.date >= $"+args.length+"::date");}
      if(to){args.push(to);w.push("dc.date <= $"+args.length+"::date");}
      if(search){
        // Har word alag match (AND); challan/chassis/motor/model/colour/dealer/battery/destination/salesman/date me kahin bhi.
        for(const tok of search.split(/\s+/).filter(Boolean).slice(0,6)){
          args.push("%"+tok+"%");const ix="$"+args.length;
          w.push("(COALESCE(dc.challan_no,'') ILIKE "+ix+" OR COALESCE(dc.chassis_no,'') ILIKE "+ix+" OR COALESCE(dc.product_name,'') ILIKE "+ix+" OR COALESCE(d.name,'') ILIKE "+ix+" OR COALESCE(NULLIF(v.battery_maker,''),to_jsonb(dc)->>'battery_maker','') ILIKE "+ix+" OR COALESCE(to_jsonb(dc)->>'motor_no',v.motor_no,'') ILIKE "+ix+" OR COALESCE(to_jsonb(dc)->>'colour',v.colour,'') ILIKE "+ix+" OR COALESCE(to_jsonb(dc)->>'destination','') ILIKE "+ix+" OR COALESCE(to_jsonb(dc)->>'salesman','') ILIKE "+ix+" OR to_char(dc.date,'DD-MM-YYYY') ILIKE "+ix+" OR to_char(dc.date,'YYYY-MM-DD') ILIKE "+ix+")");
        }
      }
      const dealer=String(u.searchParams.get("dealer")||"ALL"),product=String(u.searchParams.get("product")||"ALL"),salesman=String(u.searchParams.get("salesman")||"ALL"),battery=String(u.searchParams.get("battery")||"ALL");
      // Sold = has a live (non-cancelled) Tax Invoice; Unsold = none. `ti` is the lateral Tax Invoice join in the query below.
      const soldStatus=String(u.searchParams.get("status")||"all").toLowerCase();
      const tiEx="EXISTS (SELECT 1 FROM tax_invoice x WHERE x.delivery_challan_id=dc.id AND COALESCE(x.cancelled,false)=false)";
      if(soldStatus==="sold")w.push(tiEx);else if(soldStatus==="unsold")w.push("NOT "+tiEx);
      if(dealer!=="ALL"){args.push(dealer);w.push("d.id=$"+args.length);}
      if(product!=="ALL"){args.push(product);w.push("LOWER(COALESCE(NULLIF(to_jsonb(dc)->>'product_name',''),v.model_name,''))=LOWER($"+args.length);}
      if(salesman!=="ALL"){args.push(salesman);w.push("LOWER(COALESCE(to_jsonb(dc)->>'salesman',''))=LOWER($"+args.length);}
      if(battery!=="ALL"){args.push(battery);w.push("LOWER(COALESCE(NULLIF(v.battery_maker,''),to_jsonb(dc)->>'battery_maker',''))=LOWER($"+args.length);}
      const base="SELECT dc.*,d.name AS dealer_name,d.code AS dealer_code,d.mobile AS dealer_mobile,d.gst_no AS dealer_gst_no,COALESCE(NULLIF(to_jsonb(dc)->>'product_name',''),v.model_name) AS product_name,COALESCE(NULLIF(to_jsonb(dc)->>'chassis_no',''),v.chassis_no) AS chassis_no,COALESCE(NULLIF(to_jsonb(dc)->>'motor_no',''),v.motor_no) AS motor_no,COALESCE(NULLIF(to_jsonb(dc)->>'colour',''),v.colour) AS colour,COALESCE(to_jsonb(dc)->>'controller_no','') AS controller_no,COALESCE(to_jsonb(dc)->>'other','') AS other,COALESCE(to_jsonb(dc)->>'remarks1','') AS remarks1,COALESCE(to_jsonb(dc)->>'remarks2','') AS remarks2,COALESCE(to_jsonb(dc)->>'destination','') AS destination,COALESCE(to_jsonb(dc)->>'salesman','') AS salesman,COALESCE(NULLIF(btrim(to_jsonb(dc)->>'formula_name'),''),(SELECT "+formulaNameSql("pvx","COALESCE(NULLIF(to_jsonb(dc)->>'product_name',''),v.model_name)")+" FROM (SELECT p.formula_name FROM production_voucher p WHERE lower(btrim(p.chassis_no))=lower(btrim(COALESCE(NULLIF(to_jsonb(dc)->>'chassis_no',''),v.chassis_no))) ORDER BY p.id DESC LIMIT 1) pvx),'') AS formula_name,CASE WHEN (COALESCE(v.battery_maker,'')<>'' OR COALESCE(v.battery_no1,'')<>'') THEN v.battery_maker ELSE to_jsonb(dc)->>'battery_maker' END AS battery_maker,CASE WHEN (COALESCE(v.battery_maker,'')<>'' OR COALESCE(v.battery_no1,'')<>'') THEN v.battery_no1 ELSE to_jsonb(dc)->>'battery_no1' END AS battery_no1,CASE WHEN (COALESCE(v.battery_maker,'')<>'' OR COALESCE(v.battery_no1,'')<>'') THEN v.battery_no2 ELSE to_jsonb(dc)->>'battery_no2' END AS battery_no2,CASE WHEN (COALESCE(v.battery_maker,'')<>'' OR COALESCE(v.battery_no1,'')<>'') THEN v.battery_no3 ELSE to_jsonb(dc)->>'battery_no3' END AS battery_no3,CASE WHEN (COALESCE(v.battery_maker,'')<>'' OR COALESCE(v.battery_no1,'')<>'') THEN v.battery_no4 ELSE to_jsonb(dc)->>'battery_no4' END AS battery_no4,bf.old_battery_maker,bf.old_battery_no1,bf.old_battery_no2,bf.old_battery_no3,bf.old_battery_no4,bf.battery_change_date,COALESCE(to_jsonb(v)->>'umrn_code','') AS umrn_code,COALESCE(to_jsonb(dc)->>'dealer_page_no','') AS dealer_page_no,ti.bill_no,COALESCE(ti.sale_amount,0) AS sale_value FROM delivery_challan dc LEFT JOIN dealer d ON d.id=dc.dealer_id LEFT JOIN vehicle v ON v.id=dc.vehicle_id LEFT JOIN LATERAL (SELECT f.old_battery_maker,f.old_battery_no1,f.old_battery_no2,f.old_battery_no3,f.old_battery_no4,f.fit_date AS battery_change_date FROM battery_fit_log f WHERE f.challan_id=dc.id AND (COALESCE(f.old_battery_no1,'')<>'' OR COALESCE(f.old_battery_maker,'')<>'') AND (COALESCE(f.old_battery_maker,'')<>COALESCE(f.battery_maker,'') OR concat_ws('|',f.old_battery_no1,f.old_battery_no2,f.old_battery_no3,f.old_battery_no4)<>concat_ws('|',f.battery_no1,f.battery_no2,f.battery_no3,f.battery_no4)) ORDER BY f.id DESC LIMIT 1) bf ON true LEFT JOIN LATERAL (SELECT x.id,x.bill_no,x.sale_amount FROM tax_invoice x WHERE x.delivery_challan_id=dc.id AND COALESCE(x.cancelled,false)=false ORDER BY x.id DESC LIMIT 1) ti ON true";
      const page=Math.max(1,num(u.searchParams.get("page"))||1),per=Math.min(200,Math.max(1,num(u.searchParams.get("per_page"))||100)),start=(page-1)*per;
      const isCsv=u.searchParams.get("export")==="csv";
      // Step 1: sirf ids + count (halka query; join sirf wahi jo filter ko chahiye)
      const joinsA=(search||dealer!=="ALL"?" LEFT JOIN dealer d ON d.id=dc.dealer_id":"")+(search||product!=="ALL"||battery!=="ALL"?" LEFT JOIN vehicle v ON v.id=dc.vehicle_id":"");
      const idSql="SELECT dc.id,COUNT(*) OVER() AS total FROM delivery_challan dc"+joinsA+" WHERE "+w.join(" AND ")+" ORDER BY dc.date DESC,dc.id DESC"+(isCsv?"":" LIMIT "+per+" OFFSET "+start);
      const idr=await pool.query(idSql,args);
      let total=Number(idr.rows[0]?.total||0);
      if(!idr.rows.length&&start>0){const c=await pool.query("SELECT COUNT(*)::int AS n FROM delivery_challan dc"+joinsA+" WHERE "+w.join(" AND "),args);total=Number(c.rows[0]?.n||0);}
      // Step 2: bhaari columns (formula/battery/jsonb) sirf is page ki rows ke liye
      const ids=idr.rows.map((x:any)=>x.id);
      const det=ids.length?await pool.query(base+" WHERE dc.id=ANY($1::bigint[]) ORDER BY dc.date DESC,dc.id DESC",[ids]):{rows:[] as any[]};
      const rows=det.rows.map((x:any)=>({...x,battery_name:[x.battery_maker,x.battery_no1,x.battery_no2,x.battery_no3,x.battery_no4].filter(Boolean).join(" ")}));
      if(isCsv)return csvResponse(rows,"Delivery_Challan_Register.csv");
      const filters=await registerFilterLists();
      return Response.json({rows,page,per_page:per,total,total_pages:Math.max(1,Math.ceil(total/per)),filters});
    }
    if(p==="challan-shift"){
      await ensureChallanShiftSchema();
      const u=new URL(req.url),search=String(u.searchParams.get("search")||"").trim();
      const args:any[]=[];const w:string[]=["COALESCE(dc.cancelled,false)=false"];
      w.push("NOT EXISTS (SELECT 1 FROM tax_invoice ti WHERE ti.delivery_challan_id=dc.id AND COALESCE(ti.cancelled,false)=false)");
      if(search){
        args.push("%"+search+"%");
        w.push("(COALESCE(dc.challan_no,'') ILIKE $1 OR COALESCE(dc.chassis_no,'') ILIKE $1 OR COALESCE(dc.product_name,'') ILIKE $1 OR COALESCE(d.name,'') ILIKE $1)");
      }
      const eligible=await pool.query(`SELECT dc.id,dc.date,dc.challan_no,dc.dealer_id,d.name AS dealer_name,
        dc.product_name,dc.chassis_no,dc.battery_maker,dc.battery_no1,dc.battery_no2,dc.battery_no3,dc.battery_no4
        FROM delivery_challan dc LEFT JOIN dealer d ON d.id=dc.dealer_id
        WHERE ${w.join(" AND ")}
        ORDER BY dc.date DESC,dc.id DESC LIMIT 2000`,args);
      const dealers=await pool.query("SELECT id,code,name FROM dealer WHERE COALESCE(blocked,false)=false ORDER BY name,id");
      const shifts=await pool.query(`SELECT s.*,sf.name AS shift_from_dealer_name,st.name AS shift_to_dealer_name
        FROM delivery_challan_shift s
        LEFT JOIN dealer sf ON sf.id=s.shift_from_dealer_id
        LEFT JOIN dealer st ON st.id=s.shift_to_dealer_id
        ORDER BY s.shift_date DESC,s.id DESC LIMIT 2000`);
      return Response.json({challans:eligible.rows,dealers:dealers.rows,shifts:shifts.rows,count:eligible.rowCount});
    }
    if(p==="delivery-challans" || p==="dealer/delivery-challans"){
      await ensureDispatchSchema();
      const u=new URL(req.url),page=Math.max(1,num(u.searchParams.get("page"))||1),per=Math.min(200,Math.max(1,num(u.searchParams.get("per_page"))||50)),search=String(u.searchParams.get("search")||"").trim();
      const dcCols=await columns("delivery_challan"),dealerCols=await columns("dealer"),vehicleCols=await columns("vehicle"),invoiceCols=await columns("tax_invoice");
      if(!dcCols.size)return Response.json({error:"Delivery Challan table not found."},{status:404});
      const args:any[]=[],where:string[]=[];
      if(dcCols.has("cancelled"))where.push("COALESCE(dc.cancelled,false)=false");
      if(a.scope==="dealer" && dcCols.has("dealer_id")){args.push(num(a.dealer_id));where.push("dc.dealer_id=$"+args.length);}
      if(search){
        // Har word alag match hota hai (AND); ek word challan/chassis/motor/model/colour/dealer/destination/date me kahin bhi mil jaye.
        for(const tok of search.split(/\s+/).filter(Boolean).slice(0,6)){
          const terms:string[]=[];args.push("%"+tok+"%");const ix="$"+args.length;
          for(const col of ["challan_no","chassis_no","motor_no","product_name","colour","destination"]){if(dcCols.has(col))terms.push("dc."+col+" ILIKE "+ix);}
          if(dcCols.has("date"))terms.push("to_char(dc.date,'DD-MM-YYYY') ILIKE "+ix+" OR to_char(dc.date,'YYYY-MM-DD') ILIKE "+ix);
          if(dealerCols.has("name")&&dcCols.has("dealer_id"))terms.push("d.name ILIKE "+ix);
          if(terms.length)where.push("("+terms.join(" OR ")+")");
        }
      }
      const whereSql=where.length?" WHERE "+where.join(" AND "):"";
      const total=await pool.query("SELECT COUNT(*)::int AS n FROM delivery_challan dc"+(dcCols.has("dealer_id")?" LEFT JOIN dealer d ON d.id=dc.dealer_id":"")+whereSql,args);
      const dealerExpr=dcCols.has("dealer_name")&&dealerCols.has("name") ? "COALESCE(NULLIF(dc.dealer_name,''),d.name)" : (dealerCols.has("name")&&dcCols.has("dealer_id")?"d.name":"''");
      const joinDealer=dcCols.has("dealer_id")&&dealerCols.has("id")?" LEFT JOIN dealer d ON d.id=dc.dealer_id":"";
      const invoiceExpr=invoiceCols.has("delivery_challan_id") ? "EXISTS (SELECT 1 FROM tax_invoice ti WHERE ti.delivery_challan_id=dc.id AND "+(invoiceCols.has("cancelled")?"COALESCE(ti.cancelled,false)=false":"TRUE")+") AS invoiced,(SELECT ti.bill_no FROM tax_invoice ti WHERE ti.delivery_challan_id=dc.id ORDER BY ti.id DESC LIMIT 1) AS bill_no" : "false AS invoiced,'' AS bill_no";
      const bmExpr=vehicleCols.has("battery_maker")&&dcCols.has("vehicle_id")?"COALESCE(NULLIF(v.battery_maker,''),'')":"''";const joinVeh=vehicleCols.has("battery_maker")&&dcCols.has("vehicle_id")?" LEFT JOIN vehicle v ON v.id=dc.vehicle_id":"";const rows=await pool.query("SELECT dc.*,"+dealerExpr+" AS dealer_name,"+bmExpr+" AS battery_maker,"+invoiceExpr+" FROM delivery_challan dc"+joinDealer+joinVeh+whereSql+" ORDER BY "+(dcCols.has("date")?"dc.date DESC,dc.id DESC":"dc.id DESC")+" LIMIT "+per+" OFFSET "+((page-1)*per),args);
      const stageCol=vehicleCols.has("stage");
      await ensureProductionVoucherSchema();try{await ensureProductionFormulaSchema()}catch(e){console.error("[dc formula schema]",e)}
      const availSql="SELECT v.*,"+formulaNameSql("pvl","v.model_name")+" AS formula_name FROM vehicle v LEFT JOIN LATERAL (SELECT p.formula_name FROM production_voucher p WHERE lower(btrim(p.chassis_no))=lower(btrim(v.chassis_no)) ORDER BY p.id DESC LIMIT 1) pvl ON true WHERE "+(stageCol?"v.stage":"COALESCE(to_jsonb(v)->>'stage','')")+"='Manufacturing' ORDER BY v.id DESC LIMIT 2000";
      const available=await pool.query(availSql);
      const dispatch=await pool.query("SELECT p.*,COALESCE(NULLIF(p.product_category,''),CASE WHEN p.fro='F' THEN 'FINISHED' ELSE 'RAW' END) AS category,COALESCE(p.show_on_delivery_challan,false) AS show_on_delivery_challan,COALESCE(s.qty,0) AS stock_qty FROM product p LEFT JOIN (SELECT item_name,SUM(CASE WHEN UPPER(COALESCE(work_type,''))='IN' THEN qty ELSE -qty END) qty FROM journal_stock GROUP BY item_name) s ON lower(trim(s.item_name))=lower(trim(p.name)) WHERE UPPER(COALESCE(NULLIF(p.product_category,''),CASE WHEN p.fro='F' THEN 'FINISHED' ELSE 'RAW' END))='DISPATCH' AND COALESCE(p.show_on_delivery_challan,false)=true ORDER BY p.name");
      const totalCount=Number(total.rows[0]?.n||0);
      return Response.json({rows:rows.rows,challans:rows.rows,data:rows.rows,page,per_page:per,total:totalCount,total_pages:Math.max(1,Math.ceil(totalCount/per)),available_vehicles:available.rows,dispatch_items:dispatch.rows,suggested_challan_no:""});
    }
    if(/^delivery-challans\/\d+\/print$/.test(p)){
      const id=idOf(path[path.length-2]);if(!id)return Response.json({error:"Delivery Challan id required."},{status:400});
      const r=await pool.query("SELECT dc.*,d.name AS dealer_name,d.code AS dealer_code,d.mobile AS dealer_mobile,d.gst_no AS dealer_gst_no,COALESCE(to_jsonb(d)->>'salesman','') AS dealer_salesman,v.model_name AS vehicle_model_name,v.chassis_no AS vehicle_chassis_no,v.motor_no AS vehicle_motor_no,v.colour AS vehicle_colour,v.battery_maker,v.battery_no1,v.battery_no2,v.battery_no3,v.battery_no4,COALESCE(to_jsonb(v)->>'umrn_code','') AS umrn_code FROM delivery_challan dc LEFT JOIN dealer d ON d.id=dc.dealer_id LEFT JOIN vehicle v ON v.id=dc.vehicle_id WHERE dc.id=$1",[id]);
      if(!r.rowCount)return Response.json({error:"Delivery Challan not found."},{status:404});
      const x=r.rows[0],challan={...x,product_name:x.product_name||x.vehicle_model_name,chassis_no:x.chassis_no||x.vehicle_chassis_no,motor_no:x.motor_no||x.vehicle_motor_no,colour:x.colour||x.vehicle_colour,salesman:x.salesman||x.dealer_salesman||""};
      const company=(await pool.query("SELECT * FROM company ORDER BY id DESC LIMIT 1")).rows[0]||{};
      {const lg=await productLogo(challan.product_name,x.vehicle_model_name||"");(challan as any).umrn_code=lg.umrn_code||challan.umrn_code||"";(challan as any).logo_keys=lg.logo_keys;}
      return Response.json({challan,company});
    }
  return null;
}

export async function deliveryChallanPost(req:Request,path:string[],b:any,a:any,deps:any):Promise<Response|null>{
  const p=path.join("/");
  const {ensureDispatchSchema,ensureBatteryRegisterSchema,assertBatterySerialsAvailable,toggleBatteryRegisterForDelivery}=deps||({} as any);
    if(p==="challan-shift"){
      await ensureChallanShiftSchema();
      const challanId=idOf(b.challan_id),toDealerId=idOf(b.to_dealer_id);
      const shiftDate=String(b.shift_date||"").slice(0,10)||new Date().toISOString().slice(0,10);
      const remark=String(b.remark||"").trim();
      if(!challanId)return Response.json({error:"Delivery Challan is required."},{status:400});
      if(!toDealerId)return Response.json({error:"Shift To Dealer is required."},{status:400});
      if(!remark)return Response.json({error:"Shift Remark is required."},{status:400});
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        const dc=await client.query(`SELECT dc.*,d.name AS dealer_name,
          EXISTS (SELECT 1 FROM tax_invoice ti WHERE ti.delivery_challan_id=dc.id AND COALESCE(ti.cancelled,false)=false) AS invoiced
          FROM delivery_challan dc LEFT JOIN dealer d ON d.id=dc.dealer_id
          WHERE dc.id=$1 FOR UPDATE OF dc`,[challanId]);
        if(!dc.rowCount)throw new Error("Delivery Challan not found.");
        const row=dc.rows[0];
        if(Boolean(row.cancelled))throw new Error("Cancelled Delivery Challan cannot be shifted.");
        if(Boolean(row.invoiced))throw new Error("Bill already generated. Dealer shift is locked.");
        if(Number(row.dealer_id||0)===toDealerId)throw new Error("New dealer is same as current dealer.");
        const td=await client.query("SELECT id,name FROM dealer WHERE id=$1 AND COALESCE(blocked,false)=false",[toDealerId]);
        if(!td.rowCount)throw new Error("Shift To Dealer not found.");
        const toName=String(td.rows[0].name||"").trim();
        const fromName=String(row.dealer_name||"").trim();
        const ins=await client.query(`INSERT INTO delivery_challan_shift
          (challan_id,challan_no,chassis_no,model_name,battery_maker,battery_no1,battery_no2,battery_no3,battery_no4,
           shift_from_dealer_id,shift_from_dealer_name,shift_to_dealer_id,shift_to_dealer_name,shift_date,remark,shifted_by)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::date,$15,$16) RETURNING id`,
          [challanId,row.challan_no||"",row.chassis_no||"",row.product_name||"",row.battery_maker||null,row.battery_no1||null,row.battery_no2||null,row.battery_no3||null,row.battery_no4||null,
           idOf(row.dealer_id),fromName,toDealerId,toName,shiftDate,remark,String(a.username||a.full_name||a.user_id||"Admin")]);
        const ref="DCS-"+shiftDate.replace(/-/g,"")+"-"+String(ins.rows[0].id).padStart(5,"0");
        await client.query("UPDATE delivery_challan_shift SET shift_ref=$1 WHERE id=$2",[ref,ins.rows[0].id]);

        const dcCols=await columns("delivery_challan");
        const sets:string[]=["dealer_id=$1"],vals:any[]=[toDealerId];
        if(dcCols.has("dealer_name")){sets.push("dealer_name=$2");vals.push(toName);}
        vals.push(challanId);
        await client.query("UPDATE delivery_challan SET "+sets.join(",")+" WHERE id=$"+vals.length,vals);

        const vcols=await columns("vehicle");
        if(row.vehicle_id&&vcols.has("dealer_name"))await client.query("UPDATE vehicle SET dealer_name=$1 WHERE id=$2",[toName,row.vehicle_id]);

        const log=`Dealer Shift: ${fromName||"—"} → ${toName} | Shift Date: ${shiftDate} | Ref: ${ref} | Remark: ${remark}`;
        const target=dcCols.has("remarks2")?"remarks2":(dcCols.has("remarks1")?"remarks1":null);
        if(target){
          const old=String(row[target]||"").trim();
          const next=old?[old,log].join("\n"):log;
          await client.query("UPDATE delivery_challan SET \""+target+"\"=$1 WHERE id=$2",[next,challanId]);
        }
        await client.query("COMMIT");
        return Response.json({success:true,shift_ref:ref,shift_id:Number(ins.rows[0].id),dealer_id:toDealerId,dealer_name:toName});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    if(p==="delivery-challans" || p==="dealer/delivery-challans"){
      const did=a.scope==="dealer"?num(a.dealer_id):num(b.dealer_id),vehicleId=idOf(b.vehicle_id);
      if(a.scope==="dealer"&&!did)return Response.json({error:"Dealer not found."},{status:403});
      if(!vehicleId)return Response.json({error:"Select a chassis to dispatch."},{status:400});
      await ensureDispatchSchema();await ensureBatteryRegisterSchema();
      const selected=Array.isArray(b.dispatch_items)?b.dispatch_items.map((x:any)=>({product_id:idOf(x.product_id),qty:Math.max(1,Number(x.qty)||1)})).filter((x:any)=>x.product_id):[];
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        const vr=await client.query("SELECT * FROM vehicle WHERE id=$1 AND stage='Manufacturing' LIMIT 1 FOR UPDATE",[vehicleId]);
        if(!vr.rowCount)throw new Error("Selected chassis is not available in Manufacturing.");
        const v=vr.rows[0],batteryMaker=String(b.battery_maker||"").trim(),batteryNumbers=[b.battery_no1,b.battery_no2,b.battery_no3,b.battery_no4].map(x=>String(x||"").trim()).filter(Boolean);
        if(batteryNumbers.length&&!batteryMaker)throw new Error("Battery Maker is required when Battery No. is entered.");
        if(batteryNumbers.length)await assertBatterySerialsAvailable(client,batteryMaker,batteryNumbers);
        const products:any[]=[];
        for(const item of selected){
          const pr=await client.query("SELECT id,name,COALESCE(NULLIF(product_category,''),CASE WHEN fro='F' THEN 'FINISHED' ELSE 'RAW' END) AS category,COALESCE(show_on_delivery_challan,false) AS show_on_delivery_challan FROM product WHERE id=$1 LIMIT 1 FOR UPDATE",[item.product_id]);
          if(!pr.rowCount)throw new Error("Dispatch product not found.");
          const pdt=pr.rows[0];if(String(pdt.category).toUpperCase()!=="DISPATCH"||!pdt.show_on_delivery_challan)throw new Error("Invalid Delivery Challan item: "+pdt.name);
          const stock=await client.query("SELECT COALESCE(SUM(CASE WHEN UPPER(COALESCE(work_type,''))='IN' THEN qty ELSE -qty END),0) AS qty FROM journal_stock WHERE lower(trim(item_name))=lower(trim($1))",[pdt.name]);
          const availableStock=Number(stock.rows[0]?.qty||0);if(availableStock<item.qty)throw new Error("Insufficient stock for "+pdt.name+". Available: "+availableStock);products.push({...item,product_name:pdt.name});
        }
        // Auto Challan No: DC + YYMM(production) + MM(challan date) + 5-digit running serial (00001 se).
        let challanNo=String(b.challan_no||"").trim();
        if(!challanNo||/^DC-\d+$/i.test(challanNo)){
          await client.query("SELECT pg_advisory_xact_lock(7340101)");
          const cd=String(b.date||"").slice(0,10)||new Date().toISOString().slice(0,10);
          const pdr=await client.query("SELECT pv.date::text AS d FROM production_voucher pv WHERE lower(btrim(pv.chassis_no))=lower(btrim($1)) ORDER BY pv.id DESC LIMIT 1",[String(v.chassis_no||b.chassis_no||"")]);
          const pdt=String(pdr.rows[0]?.d||"").slice(0,10)||cd;
          const sq=await client.query("SELECT COALESCE(MAX(RIGHT(challan_no,5)::int),0)+1 AS n FROM delivery_challan WHERE challan_no ~ '^DC[0-9]{11}$'");
          challanNo="DC"+pdt.slice(2,4)+pdt.slice(5,7)+cd.slice(5,7)+String(sq.rows[0].n).padStart(5,"0");
        }
        const r=await client.query("INSERT INTO delivery_challan (challan_no,date,cancelled,dealer_id,destination,vehicle_id,product_name,chassis_no,motor_no,controller_no,differential_no,colour,sale_value,remarks1,remarks2,created_at) VALUES (COALESCE(NULLIF($1,''),'DC-'||extract(epoch from now())::bigint),COALESCE($2::date,CURRENT_DATE),false,$3,$4,$5,COALESCE(NULLIF($6,''),$7),COALESCE(NULLIF($8,''),$9),COALESCE(NULLIF($10,''),$11),$12,$13,COALESCE(NULLIF($14,''),$15),$16,$17,$18,NOW()) RETURNING *",
          [challanNo,b.date||null,did,b.destination||null,vehicleId,String(b.product_name||""),v.model_name||"",String(b.chassis_no||""),v.chassis_no||"",String(b.motor_no||""),v.motor_no||"",b.controller_no||v.controller_no||null,b.differential_no||v.differential_no||null,String(b.colour||""),v.colour||"",num(b.sale_value),b.remarks1||null,b.remarks2||null]);
        // Accessories (Toolkit/Jack/...) aur Salesman pehle INSERT me save nahi hote the (sirf Edit ke baad aate the) -> ab create par hi save.
        {
          const ACC=["toolkit","jack","charger","center_lock","mat","stapney","front_glass","h_lock"];
          const ti=await client.query("SELECT column_name,data_type FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='delivery_challan' AND column_name=ANY($1)",[[...ACC,"salesman","formula_name"]]);
          const typ:any={};for(const c of ti.rows)typ[c.column_name]=String(c.data_type);
          const sets:string[]=[],vals:any[]=[];
          for(const k of ACC){if(!typ[k])continue;const on=b[k]===true||b[k]==="true"||b[k]===1||b[k]==="1"||b[k]==="YES";
            vals.push(typ[k]==="boolean"?on:(/int|numeric|double|real/.test(typ[k])?(on?1:0):(on?"YES":null)));sets.push(k+"=$"+vals.length);}
          if(typ.salesman){
            let sm=String(b.salesman||"").trim();
            if(!sm)sm=String((await client.query("SELECT COALESCE(to_jsonb(d)->>'salesman','') AS s FROM dealer d WHERE d.id=$1",[did])).rows[0]?.s||"").trim();
            vals.push(sm||null);sets.push("salesman=$"+vals.length);
          }
          if(typ.formula_name){
            let fn=String(b.formula_name||"").trim();
            if(!fn){const fr=await client.query("SELECT "+formulaNameSql("p","p.product_name")+" AS f FROM production_voucher p WHERE lower(btrim(p.chassis_no))=lower(btrim($1)) ORDER BY p.id DESC LIMIT 1",[String(v.chassis_no||b.chassis_no||"")]);fn=String(fr.rows[0]?.f||"").trim();}
            vals.push(fn||null);sets.push("formula_name=$"+vals.length);
          }
          if(sets.length){vals.push(r.rows[0].id);const u=await client.query("UPDATE delivery_challan SET "+sets.join(",")+" WHERE id=$"+vals.length+" RETURNING *",vals);if(u.rows[0])r.rows[0]=u.rows[0];}
        }
        for(const item of products){await client.query("INSERT INTO delivery_challan_item (delivery_challan_id,product_id,product_name,qty) VALUES ($1,$2,$3,$4)",[r.rows[0].id,item.product_id,item.product_name,item.qty]);await client.query("INSERT INTO journal_stock (vou_no,date,item_name,item_type,qty,reason,created_at,work_type,batch_ref) VALUES ($1,COALESCE($2::date,CURRENT_DATE),$3,'DISPATCH',$4,'Delivery Challan Consumption',NOW(),'OUT',$1)",[String(r.rows[0].challan_no),r.rows[0].date,item.product_name,item.qty]);}
        await client.query("UPDATE vehicle SET stage='Delivery Challan',dealer_name=(SELECT name FROM dealer WHERE id=$1),battery_maker=$2,battery_no1=$3,battery_no2=$4,battery_no3=$5,battery_no4=$6 WHERE id=$7",[did,batteryMaker||null,batteryNumbers[0]||null,batteryNumbers[1]||null,batteryNumbers[2]||null,batteryNumbers[3]||null,vehicleId]);
        const dealerName=(await client.query("SELECT name FROM dealer WHERE id=$1",[did])).rows[0]?.name||"";
        await toggleBatteryRegisterForDelivery(client,{...r.rows[0],dealer_name:dealerName,dealer_id:did,vehicle_id:vehicleId},false);
        await client.query("COMMIT");return Response.json({success:true,row:r.rows[0],data:r.rows[0],dispatch_items:products},{status:201});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    if(p.startsWith("delivery-challans/") && p.endsWith("/cancel")){
      const id=idOf(path[path.length-2]); if(!id)return Response.json({error:"Record id required."},{status:400});
      await ensureDispatchSchema();
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        const dc=await client.query("SELECT * FROM delivery_challan WHERE id=$1 FOR UPDATE",[id]);
        if(!dc.rowCount)throw new Error("Delivery Challan not found.");
        const row=dc.rows[0];
        const items=await client.query("SELECT * FROM delivery_challan_item WHERE delivery_challan_id=$1 ORDER BY id",[id]);
        const nextCancelled=!Boolean(row.cancelled);
        for(const item of items.rows){
          const qty=Math.max(0,Number(item.qty)||0);
          if(!qty)continue;
          const reason=nextCancelled?"Delivery Challan Cancel Reversal":"Delivery Challan Consumption";
          const workType=nextCancelled?"IN":"OUT";
          if(!nextCancelled){
            const stock=await client.query("SELECT COALESCE(SUM(CASE WHEN UPPER(COALESCE(work_type,''))='IN' THEN qty ELSE -qty END),0) AS qty FROM journal_stock WHERE lower(trim(item_name))=lower(trim($1))",[item.product_name]);
            if(Number(stock.rows[0]?.qty||0)<qty)throw new Error("Insufficient stock for "+item.product_name+". Available: "+Number(stock.rows[0]?.qty||0));
          }
          await client.query("INSERT INTO journal_stock (vou_no,date,item_name,item_type,qty,reason,created_at,work_type,batch_ref) VALUES ($1,COALESCE($2::date,CURRENT_DATE),$3,'DISPATCH',$4,$5,NOW(),$6,$1)",
            [String(row.challan_no||("DC-"+id)),row.date||null,item.product_name,qty,reason,workType]);
        }
        const r=await client.query("UPDATE delivery_challan SET cancelled=$1 WHERE id=$2 RETURNING *",[nextCancelled,id]);
        if(r.rows[0]?.vehicle_id)await client.query("UPDATE vehicle SET stage=$1 WHERE id=$2",[nextCancelled?"Manufacturing":"Delivery Challan",r.rows[0].vehicle_id]);
        await client.query("COMMIT");
        return Response.json({success:true,row:r.rows[0]||null});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    if(p.startsWith("delivery-challans/") && p.endsWith("/print")){
      const id=idOf(path[path.length-2]); const r=await pool.query("SELECT * FROM delivery_challan WHERE id=$1",[id]);
      return Response.json({success:true,data:r.rows[0]||null});
    }
  return null;
}

export async function deliveryChallanMutation(req:Request,path:string[],method:string,a:any,deps:any):Promise<Response|null>{
  const p=path.join("/");
  const {ensureDispatchSchema,ensureBatteryRegisterSchema,toggleBatteryRegisterForDelivery,genericWrite}=deps||({} as any);
    if(/^delivery-challans\/\d+$/.test(p) && (method==="PUT" || method==="PATCH")){
      const id=idOf(path[path.length-1]);if(!id)return Response.json({error:"Delivery Challan id required."},{status:400});
      const body:any=await json(req);
      const current=await pool.query("SELECT * FROM delivery_challan WHERE id=$1 FOR UPDATE",[id]);
      if(!current.rowCount)return Response.json({error:"Delivery Challan not found."},{status:404});
      const old=current.rows[0];
      if(Object.prototype.hasOwnProperty.call(body,"dealer_id") || Object.prototype.hasOwnProperty.call(body,"dealer_name")){
        const incomingId=idOf(body.dealer_id);
        if(incomingId && incomingId!==Number(old.dealer_id||0))return Response.json({error:"Dealer change ke liye Factory → Challan Shift module use karein."},{status:409});
      }
      for(const k of ["battery_maker","battery_no1","battery_no2","battery_no3","battery_no4"]){
        if(Object.prototype.hasOwnProperty.call(body,k) && String(body[k]??"").trim()!==String(old[k]??"").trim())
          return Response.json({error:"Battery change Delivery Challan Edit se allowed nahi hai. Battery module se Withdrawal / Swap / Fit use karein."},{status:409});
      }
      delete body.dealer_id; delete body.dealer_name;
      delete body.battery_maker; delete body.battery_no1; delete body.battery_no2; delete body.battery_no3; delete body.battery_no4;
      return genericWrite(req,path,"delivery_challan",method,body);
    }
    if(p.startsWith("delivery-challans/") && p.endsWith("/print") && method==="POST"){
      const id=idOf(path[path.length-2]); const r=await pool.query("SELECT * FROM delivery_challan WHERE id=$1",[id]);
      return Response.json({success:true,data:r.rows[0]||null});
    }
    if(p.startsWith("delivery-challans/") && p.endsWith("/cancel") && method==="POST"){
      const id=idOf(path[path.length-2]);if(!id)return Response.json({error:"Record id required."},{status:400});
      await ensureDispatchSchema();await ensureBatteryRegisterSchema();const client=await pool.connect();
      try{
        await client.query("BEGIN");
        const dc=await client.query("SELECT dc.*,d.name AS dealer_name FROM delivery_challan dc LEFT JOIN dealer d ON d.id=dc.dealer_id WHERE dc.id=$1 FOR UPDATE OF dc",[id]);
        if(!dc.rowCount)throw new Error("Delivery Challan not found.");
        const row=dc.rows[0],nextCancelled=!Boolean(row.cancelled);
        const items=await client.query("SELECT * FROM delivery_challan_item WHERE delivery_challan_id=$1 ORDER BY id",[id]);
        for(const item of items.rows){
          const qty=Math.max(0,Number(item.qty)||0);if(!qty)continue;
          const reason=nextCancelled?"Delivery Challan Cancel Reversal":"Delivery Challan Consumption",workType=nextCancelled?"IN":"OUT";
          if(!nextCancelled){
            const stock=await client.query("SELECT COALESCE(SUM(CASE WHEN UPPER(COALESCE(work_type,''))='IN' THEN qty ELSE -qty END),0) AS qty FROM journal_stock WHERE lower(trim(item_name))=lower(trim($1))",[item.product_name]);
            if(Number(stock.rows[0]?.qty||0)<qty)throw new Error("Insufficient stock for "+item.product_name+". Available: "+Number(stock.rows[0]?.qty||0));
          }
          await client.query("INSERT INTO journal_stock (vou_no,date,item_name,item_type,qty,reason,created_at,work_type,batch_ref) VALUES ($1,COALESCE($2::date,CURRENT_DATE),$3,'DISPATCH',$4,$5,NOW(),$6,$1)",[String(row.challan_no||("DC-"+id)),row.date||null,item.product_name,qty,reason,workType]);
        }
        await client.query("UPDATE delivery_challan SET cancelled=$1 WHERE id=$2",[nextCancelled,id]);
        await toggleBatteryRegisterForDelivery(client,row,nextCancelled);
        if(row.vehicle_id)await client.query("UPDATE vehicle SET stage=$1 WHERE id=$2",[nextCancelled?"Manufacturing":"Delivery Challan",row.vehicle_id]);
        await client.query("COMMIT");return Response.json({success:true,row:{...row,cancelled:nextCancelled}});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
    if(p.startsWith("delivery-challans/") && method==="DELETE"){
      const id=idOf(path[path.length-1]); if(!id)return Response.json({error:"Record id required."},{status:400});
      await ensureDispatchSchema();
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        const dc=await client.query("SELECT * FROM delivery_challan WHERE id=$1 FOR UPDATE",[id]);
        if(!dc.rowCount)throw new Error("Delivery Challan not found.");
        if(!dc.rows[0].cancelled){
          const items=await client.query("SELECT * FROM delivery_challan_item WHERE delivery_challan_id=$1",[id]);
          for(const item of items.rows){
            const qty=Math.max(0,Number(item.qty)||0);
            if(qty)await client.query("INSERT INTO journal_stock (vou_no,date,item_name,item_type,qty,reason,created_at,work_type,batch_ref) VALUES ($1,COALESCE($2::date,CURRENT_DATE),$3,'DISPATCH',$4,'Delivery Challan Delete Reversal',NOW(),'IN',$1)",
              [String(dc.rows[0].challan_no||("DC-"+id)),dc.rows[0].date,item.product_name,qty]);
          }
        }
        const r=await client.query("DELETE FROM delivery_challan WHERE id=$1 RETURNING *",[id]);
        if(r.rows[0]?.vehicle_id)await client.query("UPDATE vehicle SET stage='Manufacturing' WHERE id=$1",[r.rows[0].vehicle_id]);
        await client.query("COMMIT");
        return Response.json({success:true,row:r.rows[0]||null});
      }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
    }
  return null;
}
