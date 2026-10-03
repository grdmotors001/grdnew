// Loan module: Dealer Loan Status / Loan Masters / Submit Loan + CHFPL bridge (loan cache, webhook, backfill, repo-vehicles).
// (bade route file se nikala gaya, logic/queries same hain).
// chfplBridge / ensureLoanWorkflowBridgeSchema dusre modules (billing, old-rickshaw) bhi use karte hain, isliye export hain.
import { columns, idOf, json, num, pool } from "./common";
import { isAdmin } from "./permissions";

// Schema DDL only needs to run once per server process. Running ~40 CREATE/ALTER
// statements on every request made /billing/pending-sales/options hang for many seconds.
let loanWorkflowBridgeSchemaReady:Promise<void>|null=null;
export function ensureLoanWorkflowBridgeSchema():Promise<void>{
  if(!loanWorkflowBridgeSchemaReady){
    loanWorkflowBridgeSchemaReady=ensureLoanWorkflowBridgeSchemaOnce().catch((e:any)=>{loanWorkflowBridgeSchemaReady=null;throw e});
  }
  return loanWorkflowBridgeSchemaReady;
}
async function ensureLoanWorkflowBridgeSchemaOnce(){
  await pool.query("ALTER TABLE loan_workflow ADD COLUMN IF NOT EXISTS chfpl_loan_id bigint");
  await pool.query("ALTER TABLE loan_workflow ADD COLUMN IF NOT EXISTS chfpl_status_updated_at timestamptz");
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS loan_workflow_chfpl_loan_id_uq ON loan_workflow(chfpl_loan_id) WHERE chfpl_loan_id IS NOT NULL");
}
export async function chfplBridge(path:string, query:Record<string,string>={}){
  const base=String(process.env.CHFPL_API_URL||'').replace(/\/$/,'');
  const secret=String(process.env.CHFPL_GRD_BRIDGE_SECRET||'');
  if(!base || !secret) throw new Error('CHFPL bridge is not configured. Set CHFPL_API_URL and CHFPL_GRD_BRIDGE_SECRET.');
  const u=new URL(base+path);
  for(const [k,v] of Object.entries(query)) if(v) u.searchParams.set(k,v);
  const r=await fetch(u.toString(),{method:'GET',headers:{'x-grd-bridge-secret':secret,'Accept':'application/json'},cache:'no-store'});
  const d=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(d?.error||'CHFPL bridge request failed');
  return d;
}
// ---- CHFPL loan applications: local cache fed by webhook (no live bridge call on page load) ----
let chfplLoanCacheReady:Promise<void>|null=null;
function ensureChfplLoanCache():Promise<void>{
  if(!chfplLoanCacheReady){
    chfplLoanCacheReady=(async()=>{
      await pool.query("CREATE TABLE IF NOT EXISTS chfpl_loan_cache (chfpl_loan_id bigint PRIMARY KEY,grd_dealer_id integer,dealer_code text,application_no text,status text,data jsonb NOT NULL DEFAULT '{}'::jsonb,updated_at timestamptz NOT NULL DEFAULT now())");
      await pool.query("CREATE INDEX IF NOT EXISTS chfpl_loan_cache_dealer_idx ON chfpl_loan_cache(grd_dealer_id)");
    })().catch((e:any)=>{chfplLoanCacheReady=null;throw e});
  }
  return chfplLoanCacheReady;
}
// Full row (ya sirf status wala partial row) cache me daalo; partial update purana data mita nahi deta (jsonb merge).
async function upsertChfplLoanRows(rows:any[]){
  await ensureChfplLoanCache();
  let n=0;
  for(const row of rows){
    const cid=idOf(row?.id??row?.chfpl_loan_id);if(!cid)continue;
    const data={...row,id:cid};delete (data as any).chfpl_loan_id;
    await pool.query(
      "INSERT INTO chfpl_loan_cache (chfpl_loan_id,grd_dealer_id,dealer_code,application_no,status,data,updated_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,NOW()) ON CONFLICT (chfpl_loan_id) DO UPDATE SET grd_dealer_id=COALESCE(EXCLUDED.grd_dealer_id,chfpl_loan_cache.grd_dealer_id),dealer_code=COALESCE(NULLIF(EXCLUDED.dealer_code,''),chfpl_loan_cache.dealer_code),application_no=COALESCE(NULLIF(EXCLUDED.application_no,''),chfpl_loan_cache.application_no),status=COALESCE(NULLIF(EXCLUDED.status,''),chfpl_loan_cache.status),data=chfpl_loan_cache.data||EXCLUDED.data,updated_at=NOW()",
      [cid,idOf(row?.grd_dealer_id)||null,String(row?.dealer_code||"").trim(),String(row?.application_no||"").trim(),String(row?.status||"").trim(),JSON.stringify(data)]);
    n++;
  }
  return n;
}
let chfplSeedTried=false;

async function chfplSubmitLoan(body:any){
  const base=String(process.env.CHFPL_API_URL||'').replace(/\/$/,'');
  const bridgeSecret=String(process.env.CHFPL_GRD_BRIDGE_SECRET||'').trim();
  if(!base || !bridgeSecret) return {ok:false,error:'CHFPL bridge is not configured.'};
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),30000);
  try{
    const r=await fetch(base+'/api/grd-submit-loan',{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'x-grd-bridge-secret':bridgeSecret,
        'Accept':'application/json'
      },
      body:JSON.stringify(body),
      signal:controller.signal,
      cache:'no-store'
    });
    const d=await r.json().catch(()=>({}));
    if(!r.ok)return {ok:false,error:d?.error||'CHFPL loan submission failed.'};
    return {ok:true,data:d};
  }catch(e:any){
    return {ok:false,error:e?.name==='AbortError'?'CHFPL submission timed out.':(e?.message||'CHFPL submission failed.')};
  }finally{
    clearTimeout(timer);
  }
}

// ---------------- GET ----------------
export async function loanGet(path:string[],a:any):Promise<Response|null>{
  const p=path.join("/");
    if(p==="chfpl/loan-status"){
      const q:any={};
      if(a?.scope==="dealer") q.grd_dealer_id=String(num(a.dealer_id));
      const d=await chfplBridge("/api/grd-dealer-loans",q);
      return Response.json({source:"CHFPL",applications:d.applications||[],count:(d.applications||[]).length});
    }
    if(p==="chfpl/repo-vehicles"){
      const q:any={status:"ALL"};
      if(a?.scope==="dealer") q.dealer_id=String(num(a.dealer_id));
      const d=await chfplBridge("/api/grd/repossessed",q);
      const vehicles=(d.vehicles||[]).map((v:any)=>({...v,source:"CHFPL",current_status:v.resale_status==="SEIZED"?"HOLD":(v.resale_status||"SEIZED")}));
      return Response.json({source:"CHFPL",vehicles,count:vehicles.length});
    }

    // Dealer Loan Status must be a live CHFPL read. The local loan_workflow
    // table is only the GRD bridge/cache and can otherwise remain stale when
    // a CHFPL status changes after the loan was submitted.
    if(p==="dealer/loan-status"||p==="loan-application-view"){
      const q:any={};
      if(a?.scope==="dealer"){
        q.grd_dealer_id=String(num(a.dealer_id));
        const dealerIdentity=await pool.query("SELECT code FROM dealer WHERE id=$1 LIMIT 1",[num(a.dealer_id)]);
        const dealerCode=String(dealerIdentity.rows[0]?.code||"").trim();
        if(dealerCode) q.grd_dealer_code=dealerCode;
      }
      // Data ab webhook (POST /api/loan-status-webhook) se local cache me aata hai -> CHFPL ko live call nahi jaati.
      await ensureLoanWorkflowBridgeSchema();await ensureChfplLoanCache();
      // Pehli baar cache khali ho to ek baar purana data bridge se import kar lo (webhook sirf naye changes bhejta hai).
      if(!chfplSeedTried){
        const cnt=await pool.query("SELECT COUNT(*)::int AS n FROM chfpl_loan_cache");
        if(!Number(cnt.rows[0]?.n||0)){
          chfplSeedTried=true;
          try{const seed=await chfplBridge("/api/grd-dealer-loans",{});await upsertChfplLoanRows(Array.isArray(seed?.applications)?seed.applications:[]);}catch(_e){}
        }else chfplSeedTried=true;
      }
      const cArgs:any[]=[];let cWhere="1=1";
      if(a?.scope==="dealer"){
        cArgs.push(num(a.dealer_id),String(q.grd_dealer_code||""));
        cWhere="(grd_dealer_id=$1 OR ($2<>'' AND dealer_code=$2))";
      }
      const cached=await pool.query("SELECT chfpl_loan_id,status,application_no,data FROM chfpl_loan_cache WHERE "+cWhere+" ORDER BY chfpl_loan_id DESC LIMIT 5000",cArgs);
      const applications=cached.rows.map((r:any)=>({...(r.data||{}),id:Number(r.chfpl_loan_id),status:r.status||r.data?.status||"submitted",application_no:r.application_no||r.data?.application_no||""}));

      const pendingArgs:any[]=[];
      let pendingWhere="status='PENDING_CHFPL_SYNC'";
      if(a?.scope==="dealer"){
        pendingArgs.push(num(a.dealer_id));
        pendingWhere+=" AND dealer_id=$1";
      }
      const pending=await pool.query(
        "SELECT lw.* FROM loan_workflow lw WHERE "+pendingWhere+" ORDER BY lw.id DESC LIMIT 100",
        pendingArgs
      );

      // Live CHFPL rows are authoritative. Keep only genuinely unsynced
      // local submissions in addition to them.
      const liveIds=new Set(applications.map((x:any)=>Number(idOf(x.id))).filter(Boolean));
      const unsynced=pending.rows.filter((x:any)=>!x.chfpl_loan_id && !liveIds.has(Number(x.id)));
      return Response.json({
        source:"CHFPL",
        applications:[...applications,...unsynced],
        count:applications.length+unsynced.length
      });
    }
    if(p==="dealer/loan-masters"){
      const r=await pool.query("SELECT * FROM simple_master WHERE kind ILIKE '%loan%' ORDER BY id");
      const models=await pool.query("SELECT id,name,code FROM product WHERE COALESCE(fro,'')<>'R' AND COALESCE(name,'')<>'' ORDER BY name,id");
      return Response.json({rows:r.rows,masters:r.rows,models:models.rows});
    }
    if(p==="dealer/loan-status"||p==="loan-application-view"){
      await ensureLoanWorkflowBridgeSchema();
      const did=a.scope==="dealer"?num(a.dealer_id):null;
      const r=did?await pool.query("SELECT * FROM loan_workflow WHERE dealer_id=$1 ORDER BY id DESC",[did]):await pool.query("SELECT * FROM loan_workflow ORDER BY id DESC LIMIT 1000");
      return Response.json({applications:r.rows,rows:r.rows,count:r.rowCount});
    }
  return null;
}

// ---------------- POST (server-to-server webhook, JWT auth se pehle) ----------------
export async function loanWebhookPost(req:Request,path:string[],b:any):Promise<Response|null>{
  const p=path.join("/");
    if(p==="loan-status-webhook"){
      const expected=String(process.env.CHFPL_GRD_BRIDGE_SECRET||"").trim();
      const supplied=String(req.headers.get("x-grd-bridge-secret")||"").trim();
      if(!expected || !supplied || supplied!==expected)
        return Response.json({success:false,error:"Invalid CHFPL bridge secret."},{status:401});
      await ensureLoanWorkflowBridgeSchema();await ensureChfplLoanCache();
      // Accepted bodies:
      //  A) {application:{...full row...}}  or  {applications:[{...},{...}]}   (full data, recommended)
      //  B) {chfpl_loan_id,status,grd_submission_ref?,tvr_status?}              (status-only, old format)
      //  C) {event:"deleted",chfpl_loan_id}                                     (remove from GRD)
      const cid0=idOf(b.chfpl_loan_id);
      if((b.event==="deleted"||b.deleted===true)&&cid0){
        await pool.query("DELETE FROM chfpl_loan_cache WHERE chfpl_loan_id=$1",[cid0]);
        return Response.json({success:true,deleted:cid0});
      }
      let list:any[]=Array.isArray(b.applications)?b.applications:(b.application&&typeof b.application==="object"?[b.application]:[]);
      if(!list.length){
        const status0=String(b.status||"").trim();
        if(!cid0||!status0)return Response.json({success:false,error:"application(s) ya chfpl_loan_id + status required hai."},{status:400});
        list=[{id:cid0,status:status0,...(b.tvr_status!==undefined?{tvr_status:b.tvr_status}:{}),grd_submission_ref:b.grd_submission_ref}];
      }
      list=list.filter((x:any)=>idOf(x?.id??x?.chfpl_loan_id));
      if(!list.length)return Response.json({success:false,error:"Har application me id / chfpl_loan_id chahiye."},{status:400});
      const saved=await upsertChfplLoanRows(list);
      let linked:any=null;
      for(const row of list){
        const cid=idOf(row.id??row.chfpl_loan_id),status=String(row.status||"").trim();
        if(!status)continue;
        try{
          const r=await pool.query(
            "UPDATE loan_workflow SET chfpl_loan_id=$1,status=$2,chfpl_status_updated_at=NOW(),updated_at=NOW() WHERE chfpl_loan_id=$1 OR ($3::bigint IS NOT NULL AND id=$3::bigint) OR ($4<>'' AND application_no=$4) RETURNING id,application_no,status,chfpl_loan_id",
            [cid,status,idOf(row.grd_submission_ref??b.grd_submission_ref)||null,String(row.application_no||"").trim()]);
          if(r.rows[0]&&!linked)linked=r.rows[0];
        }catch(_e){/* unique-link conflict: cache already saved, workflow link ko baad me theek kar sakte hain */}
      }
      return Response.json({success:true,saved,application:linked});
    }
  return null;
}

// ---------------- POST (staff / dealer) ----------------
export async function loanPost(req:Request,path:string[],b:any,a:any):Promise<Response|null>{
  const p=path.join("/");
    if(p==="admin/backfill-loan-status"){
      if(!isAdmin(a))return Response.json({error:"Admin rights required."},{status:403});
      await ensureLoanWorkflowBridgeSchema();
      const body:any=await json(req);
      const requestedDealerId=idOf(body.dealer_id);
      const q:any={};
      if(requestedDealerId)q.grd_dealer_id=String(requestedDealerId);
      const remote=await chfplBridge("/api/grd-dealer-loans",q);
      const applications=Array.isArray(remote?.applications)?remote.applications:[];
      let updated=0,inserted=0,skipped=0;
      const details:any[]=[];
      for(const row of applications){
        const chfplLoanId=idOf(row.id);
        if(!chfplLoanId){skipped++;continue}
        const applicationNo=String(row.application_no||"").trim();
        const status=String(row.status||"submitted").trim()||"submitted";
        const grdDealerId=idOf(row.grd_dealer_id);
        let dealerId=grdDealerId;
        if(!dealerId && String(row.dealer_code||"").trim()){
          const dr=await pool.query("SELECT id FROM dealer WHERE code=$1 LIMIT 1",[String(row.dealer_code).trim()]);
          dealerId=idOf(dr.rows[0]?.id);
        }
        if(requestedDealerId && dealerId!==requestedDealerId){skipped++;continue}
        const existing=await pool.query(
          "SELECT id,customer_id FROM loan_workflow WHERE chfpl_loan_id=$1 OR ($2<>'' AND application_no=$2) ORDER BY CASE WHEN chfpl_loan_id=$1 THEN 0 ELSE 1 END,id LIMIT 1",
          [chfplLoanId,applicationNo]
        );
        let customerId=idOf(existing.rows[0]?.customer_id);
        const customerName=String(row.customer_name||"").trim();
        const customerPhone=String(row.customer_phone||"").trim();
        if(!customerId && dealerId && (customerName||customerPhone)){
          const cr=await pool.query(
            "SELECT id FROM customer WHERE dealer_id=$1 AND ((COALESCE(btrim(phone),'')=$2 AND $2<>'') OR (lower(btrim(COALESCE(full_name,'')))=lower($3) AND $3<>'')) ORDER BY id LIMIT 1",
            [dealerId,customerPhone,customerName]
          );
          customerId=idOf(cr.rows[0]?.id);
        }
        if(!customerId && dealerId && customerName){
          const cc=await columns("customer");
          const input:any={dealer_id:dealerId,full_name:customerName,phone:customerPhone||null};
          const keys=Object.keys(input).filter(k=>cc.has(k));
          if(keys.length){
            const cr=await pool.query(
              "INSERT INTO customer ("+keys.map(k=>'"'+k+'"').join(",")+") VALUES ("+keys.map((_,i)=>"$"+(i+1)).join(",")+") RETURNING id",
              keys.map(k=>input[k])
            );
            customerId=idOf(cr.rows[0]?.id);
          }
        }
        const loanAmount=num(row.loan_amount_requested);
        const modelName=String(row.vehicle_model_name||"").trim()||null;
        const vehicleType="3W";
        if(existing.rowCount){
          const u=await pool.query(
            "UPDATE loan_workflow SET chfpl_loan_id=$1,status=$2,chfpl_status_updated_at=COALESCE($3::timestamptz,NOW()),updated_at=NOW(),dealer_id=COALESCE(dealer_id,$4),customer_id=COALESCE(customer_id,$5),loan_amount=CASE WHEN COALESCE(loan_amount,0)=0 THEN $6 ELSE loan_amount END,loan_model_name=COALESCE(NULLIF(loan_model_name,''),$7),loan_vehicle_type=COALESCE(NULLIF(loan_vehicle_type,''),$8) WHERE id=$9 RETURNING id,application_no,status,chfpl_loan_id",
            [chfplLoanId,status,row.submitted_at||null,dealerId,customerId,loanAmount,modelName,vehicleType,existing.rows[0].id]
          );
          if(u.rowCount)updated++;
        }else{
          const localNo=applicationNo||("CHFPL-"+chfplLoanId);
          const ins=await pool.query(
            "INSERT INTO loan_workflow (application_no,dealer_id,customer_id,status,loan_amount,loan_model_name,loan_vehicle_type,chfpl_loan_id,chfpl_status_updated_at,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9::timestamptz,NOW()),COALESCE($9::timestamptz,NOW()),NOW()) RETURNING id,application_no,status,chfpl_loan_id",
            [localNo,dealerId,customerId,status,loanAmount,modelName,vehicleType,chfplLoanId,row.submitted_at||null]
          );
          if(ins.rowCount)inserted++;
        }
      }
      return Response.json({success:true,total:applications.length,updated,inserted,skipped});
    }
    if(p==="dealer/submit-loan"){
      await ensureLoanWorkflowBridgeSchema();
      const did=a.scope==="dealer"?num(a.dealer_id):num(b.dealer_id);
      if(!did)return Response.json({error:"Dealer not found."},{status:400});

      const dealer=(await pool.query("SELECT id,code,name,login_id,mobile FROM dealer WHERE id=$1 LIMIT 1",[did])).rows[0];
      if(!dealer)return Response.json({error:"Dealer not found."},{status:404});

      const borrower=b.borrower||{};
      const guarantor=b.guarantor||{};
      const coBorrower=b.co_borrower||{};
      const vehicleLoan={...(b.vehicle_loan||{})};
      const modelId=idOf(vehicleLoan.vehicle_model_id||vehicleLoan.grd_model_id);
      if(!modelId)return Response.json({error:"Vehicle model select karein."},{status:400});
      const model=(await pool.query("SELECT * FROM product WHERE id=$1 LIMIT 1",[modelId])).rows[0];
      if(!model)return Response.json({error:"Selected vehicle model not found."},{status:404});

      // If this is a new customer, keep a local GRD customer record as well.
      // Existing customer_id is preserved exactly as submitted by the dealer.
      let customerId=idOf(b.customer_id);
      if(!customerId){
        const cc=await columns("customer");
        const input:any={
          dealer_id:did,
          full_name:String(borrower.full_name||"").trim()||null,
          phone:String(borrower.phone||"").trim()||null,
          email:String(borrower.email||"").trim()||null,
          dob:borrower.dob||null,
          gender:String(borrower.gender||"").trim()||null,
          pan:String(borrower.pan||"").trim()||null,
          occupation:String(borrower.occupation||"").trim()||null,
          monthly_income:num(borrower.monthly_income)||null,
          pincode:String(borrower.pincode||"").trim()||null,
          city:String(borrower.city||"").trim()||null,
          state:String(borrower.state||"").trim()||null,
          address:String(borrower.address||"").trim()||null
        };
        const keys=Object.keys(input).filter(k=>cc.has(k));
        if(keys.length){
          const ins=await pool.query('INSERT INTO customer ('+keys.map(k=>'"'+k+'"').join(",")+') VALUES ('+keys.map((_,i)=>"$"+(i+1)).join(",")+') RETURNING id',keys.map(k=>input[k]));
          customerId=Number(ins.rows[0]?.id)||null;
        }
      }

      const localNo=String(b.application_no||"").trim()||("APP-"+Date.now());
      const initial=await pool.query(
        "INSERT INTO loan_workflow (application_no,dealer_id,customer_id,status,loan_amount,loan_model_name,loan_vehicle_type,chfpl_status_updated_at,created_at,updated_at) VALUES ($1,$2,$3,'PENDING_CHFPL_SYNC',$4,$5,$6,NOW(),NOW(),NOW()) RETURNING *",
        [localNo,did,customerId,num(vehicleLoan.loan_amount_requested||b.loan_amount),String(model?.name||vehicleLoan.grd_model_name||"").trim()||null,String(vehicleLoan.vehicle_type||b.loan_vehicle_type||"3W").trim()||"3W"]
      );
      const local=initial.rows[0];

      const bridgeBody={
        grd_submission_ref:String(local.id),
        dealer:{
          grd_dealer_id:did,
          code:String(dealer.code||dealer.login_id||"").trim(),
          login_id:String(dealer.login_id||"").trim()||null,
          name:String(dealer.name||"").trim(),
          mobile:String(dealer.mobile||"").trim()||null
        },
        borrower,
        guarantor,
        co_borrower:coBorrower,
        vehicle_loan:{
          ...vehicleLoan,
          grd_model_id:modelId||null,
          grd_model_code:model ? (String(model.code||"").trim()||null) : null,
          grd_model_name:model ? String(model.name||"").trim() : null,
          vehicle_type:String(vehicleLoan.vehicle_type||b.loan_vehicle_type||"3W").trim()||"3W",
          vehicle_price:num(vehicleLoan.vehicle_price||model?.ex_showroom_price||model?.sale_price)
        },
        loan_type:b.loan_type||"NEW",
        dealer_register_page_no:b.dealer_register_page_no||null,
        customer_photo:b.customer_photo||null,
        documents:Array.isArray(b.documents)?b.documents:[]
      };

      const submitted=await chfplSubmitLoan(bridgeBody);
      if(!submitted.ok){
        console.error("[dealer/submit-loan] CHFPL sync pending:",submitted.error);
        return Response.json({
          success:true,
          sync_status:"PENDING_CHFPL_SYNC",
          application:null,
          application_id:local.id,
          message:"Loan saved in GRD. CHFPL sync is pending.",
          sync_error:submitted.error
        },{status:202});
      }

      const remote=submitted.data||{};
      const chfplLoanId=idOf(remote.application_id);
      if(!chfplLoanId){
        console.error("[dealer/submit-loan] CHFPL returned no application_id");
        return Response.json({
          success:true,
          sync_status:"PENDING_CHFPL_SYNC",
          application:null,
          application_id:local.id,
          message:"Loan saved in GRD. CHFPL sync is pending.",
          sync_error:"CHFPL did not return application_id."
        },{status:202});
      }

      const updated=await pool.query(
        "UPDATE loan_workflow SET chfpl_loan_id=$1,status=$2,chfpl_status_updated_at=NOW(),updated_at=NOW() WHERE id=$3 RETURNING *",
        [chfplLoanId,String(remote.status||"submitted").trim()||"submitted",local.id]
      );
      return Response.json({
        success:true,
        sync_status:"SYNCED",
        application:updated.rows[0],
        application_id:local.id,
        chfpl_loan_id:chfplLoanId,
        application_no:remote.application_no||updated.rows[0]?.application_no||null,
        status:remote.status||"submitted"
      },{status:201});
    }
  return null;
}
