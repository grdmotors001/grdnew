// Permission / audit / dealer-scope logic (bade route file se jas ka tas nikala gaya).
// Naye split routes (expense-payment-voucher, rc-fee, ...) inhi functions se access check karte hain.
import { pool, idOf, columns } from "./common";

export const STOCK_MODULE_ALIAS:any={'dealer-day-book':'cash-at-dealer','dealer-stock':'cash-at-dealer','showroom-stock':'cash-at-dealer','closing-dealers':'closing-stock-dealers','ledger-dealers':'stock-ledger-dealers','closing-premises':'closing-stock-premises','ledger-premises':'stock-ledger-premises','closing-raw':'closing-stock-raw','ledger-raw':'closing-stock-raw','payment-receivable':'payment-receivable-report'};
// API path (plural) -> menu/rights key (singular): Action Rights menu 'dealer'/'product' keys par save hote hain, API /dealers,/products par aati hai.
export const PATH_TO_MENU_KEY:any={'dealers':'dealer','products':'product'};
export function moduleAlias(x:string){if(PATH_TO_MENU_KEY[x])return PATH_TO_MENU_KEY[x];if(STOCK_MODULE_ALIAS[x])return STOCK_MODULE_ALIAS[x];return x==='contra-vouchers'?'v-contra':x==='insurance-register'?'insurance-rto':x==='rto-register'?'rto-expense':x==='hypothecation-receipts'?'hypothecation-register':x;}
// API path -> Action Rights / Module Access menu keys. Menu keys singular hote hain (tax-invoice, credit-note...) jabki API path plural (tax-invoices, credit-notes...);
// kuch paths ka naam alag hai (hr -> hr-attendance, backup -> backup-restore). Isliye diye gaye rights match nahi hote the (Forbidden).
export function rightsKeys(p:string):string[]{
  const segs=String(p||"").split("/").filter(x=>x&&!/^\d+$/.test(x)),root=segs[0]||"",sing=(x:string)=>x.replace(/s$/,"");
  const out=[root,sing(root),moduleAlias(root),moduleAlias(sing(root))];
  if(root==="hr")out.push("hr-attendance");
  if(root==="backup")out.push("backup-restore");
  if(root==="bank-ledger")out.push("day-book"); // Bank Ledger ab Bank & Cash book ka hissa hai
  if(root==="factory-check-items")out.push("factory-check-report");
  if(root==="battery-swap-vouchers")out.push("battery-swap");
  if(root==="repair-service-masters"||root==="repair-service-receipts"||root==="repair-service-vouchers")out.push("repair-service-voucher");
  if(root==="billing"&&segs[1]==="pending-sales")out.push("billing-pending-sales");
  if((root==="masters"||root==="factory"||root==="billing"||root==="dealer")&&segs[1]){out.push(segs[1],sing(segs[1]),moduleAlias(segs[1]),moduleAlias(sing(segs[1])));}
  if(root==="inventory"&&segs[1]==="old-rickshaw")out.push("old-rickshaw-inventory");
  return [...new Set(out.filter(Boolean))];
}
let securitySchemaReady:Promise<void>|null=null;
export function ensureSecuritySchema():Promise<void>{
  if(!securitySchemaReady) securitySchemaReady=(async()=>{
    await pool.query(`CREATE TABLE IF NOT EXISTS user_action_permission (
      id bigserial PRIMARY KEY, user_id bigint NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      module_key text NOT NULL, can_view boolean NOT NULL DEFAULT false, can_create boolean NOT NULL DEFAULT false,
      can_edit boolean NOT NULL DEFAULT false, can_delete boolean NOT NULL DEFAULT false, can_approve boolean NOT NULL DEFAULT false,
      UNIQUE(user_id,module_key)
    )`);
    await pool.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_action_permission' AND column_name='can_download') THEN
        ALTER TABLE user_action_permission ADD COLUMN can_download boolean NOT NULL DEFAULT false;
        UPDATE user_action_permission SET can_download=can_view;
      END IF;
    END $$`);
    await pool.query("ALTER TABLE user_action_permission ADD COLUMN IF NOT EXISTS can_backup boolean NOT NULL DEFAULT false");
    await pool.query(`CREATE TABLE IF NOT EXISTS audit_log (
      id bigserial PRIMARY KEY, user_id bigint, username text, department text, module_key text, action text NOT NULL,
      record_id text, record_ref text, old_value jsonb, new_value jsonb, dealer_id bigint, created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await pool.query("CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log(created_at DESC)");
    await pool.query("CREATE INDEX IF NOT EXISTS audit_log_user_idx ON audit_log(user_id,created_at DESC)");
    await pool.query("CREATE INDEX IF NOT EXISTS audit_log_module_idx ON audit_log(module_key,created_at DESC)");
    await pool.query("ALTER TABLE \"user\" ADD COLUMN IF NOT EXISTS assigned_dealer_ids jsonb NOT NULL DEFAULT '[]'::jsonb");
    await pool.query("CREATE TABLE IF NOT EXISTS product_sub_group (id bigserial PRIMARY KEY, name text NOT NULL UNIQUE, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now())");
    await pool.query("INSERT INTO product_sub_group(name) VALUES('Primary') ON CONFLICT(name) DO NOTHING");
    await pool.query("ALTER TABLE product ADD COLUMN IF NOT EXISTS sub_group_id bigint");
    await pool.query("ALTER TABLE product ADD COLUMN IF NOT EXISTS sub_group_name text");
    // Kharid ka rate (cost): Profit & Loss me stock isi rate se value hota hai. NULL = abhi bhara nahi.
    await pool.query("ALTER TABLE product ADD COLUMN IF NOT EXISTS purchase_price numeric");
    await pool.query("UPDATE product SET sub_group_name='Primary' WHERE COALESCE(BTRIM(sub_group_name),'')=''");
    await pool.query("ALTER TABLE dealer ADD COLUMN IF NOT EXISTS sub_group_name text");
    await pool.query("UPDATE dealer SET sub_group_name='Primary' WHERE COALESCE(BTRIM(sub_group_name),'')=''");
  })().catch(e=>{securitySchemaReady=null;throw e});
  return securitySchemaReady;
}
export function actionFor(method:string){ return method==='GET'?'view':method==='POST'?'create':method==='DELETE'?'delete':'edit'; }
export async function audit(a:any,moduleKey:string,action:string,recordId:any,oldValue:any,newValue:any,dealerId:any=null,recordRef:any=null){
  try{ await ensureSecuritySchema(); await pool.query(`INSERT INTO audit_log(user_id,username,department,module_key,action,record_id,record_ref,old_value,new_value,dealer_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10)`,[idOf(a?.sub),a?.username||null,a?.department||a?.role||null,moduleKey,action,recordId==null?null:String(recordId),recordRef==null?null:String(recordRef),JSON.stringify(oldValue??null),JSON.stringify(newValue??null),idOf(dealerId)]); }catch(e){ console.error('[audit-log]',e); }
}
export function assignedDealerIds(a:any){
  if(a?.is_super_user || String(a?.department||'').toLowerCase()==='admin') return null;
  const raw=a?.assigned_dealer_ids;
  if(Array.isArray(raw)) return raw.map(idOf).filter(Boolean);
  try{return Array.isArray(JSON.parse(String(raw||'[]')))?JSON.parse(String(raw||'[]')).map(idOf).filter(Boolean):[];}catch{return []}
}
export function isSalesman(a:any){return a?.scope==='staff' && String(a?.department||'').trim().toLowerCase()==='salesman' && !a?.is_super_user;}
export function dealerScopeWhere(a:any,alias:string,args:any[]){ if(!isSalesman(a)) return ''; const ids=assignedDealerIds(a)||[]; if(!ids.length){args.push(-1);return `${alias}.id=$${args.length}`;} args.push(ids); return `${alias}.id=ANY($${args.length}::bigint[])`; }
export async function enforceDealerScope(a:any, table:string, id:any=null, body:any=null){
  if(!isSalesman(a)) return null;
  const ids=assignedDealerIds(a)||[]; if(!ids.length) return Response.json({error:'No dealers assigned to this salesman.'},{status:403});
  const dealerTables=new Set(['dealer','delivery_challan','tax_invoice','billing_customer','customer','vehicle','loan_workflow','old_rickshaw','old_rickshaw_challan','dealer_payment','day_book','purchase_bill','journal_stock']);
  if(!dealerTables.has(table)) return null;
  if(id && table==='dealer' && !ids.includes(Number(id))) return Response.json({error:'Dealer access denied.'},{status:403});
  if(id){
    const cols=await columns(table); if(!cols.has('dealer_id')) return null;
    const r=await pool.query(`SELECT dealer_id FROM "${table}" WHERE id=$1 LIMIT 1`,[id]);
    if(r.rowCount && !ids.includes(Number(r.rows[0].dealer_id))) return Response.json({error:'Dealer access denied.'},{status:403});
  }
  if(body?.dealer_id && !ids.includes(Number(body.dealer_id))) return Response.json({error:'Dealer access denied.'},{status:403});
  if(!id && table!=='dealer' && !body?.dealer_id && (await columns(table)).has('dealer_id')) return Response.json({error:'dealer_id is required for salesman.'},{status:403});
  return null;
}
export const DEALER_SCOPED_TABLES=new Set(['dealer','delivery_challan','tax_invoice','billing_customer','customer','vehicle','loan_workflow','old_rickshaw','old_rickshaw_challan','dealer_payment','day_book','purchase_bill','journal_stock','battery_register_entry','credit_note','cash_handover','dealer_cash_receipt']);
// Read-side dealer restriction (salesman): returns {sql,arg} fragment for generic GET so API cannot be used to read other dealers' rows.
export async function dealerReadFilter(a:any,table:string,argsLen:number){
  if(!isSalesman(a)||!DEALER_SCOPED_TABLES.has(table)) return null;
  const ids=assignedDealerIds(a)||[]; const cols=await columns(table);
  const col=table==='dealer'?'id':cols.has('dealer_id')?'dealer_id':null; if(!col) return null;
  return {sql:'"'+col+'"=ANY($'+(argsLen+1)+'::bigint[])',arg:ids.length?ids:[-1]};
}
export async function actionAllowed(a:any,moduleKey:string,action:string){
  if(a?.scope==='dealer') return true;
  if(a?.is_super_user || String(a?.department||'').toLowerCase()==='admin') return true;
  await ensureSecuritySchema();
  const segs=String(moduleKey||'').split('/').filter(Boolean),clean=segs.filter(x=>!/^\d+$/.test(x));
  const keys=[...new Set([moduleKey,clean.join('/'),clean.slice(0,2).join('/'),clean[0],moduleAlias(String(clean[0]||'')),...rightsKeys(moduleKey)].filter(Boolean))];
  if(clean[0]==='bank-ledger'&&action==='view')keys.push('ledger');
  const r=await pool.query('SELECT module_key,can_view,can_create,can_edit,can_delete,can_approve,can_download,can_backup FROM user_action_permission WHERE user_id=$1 AND module_key=ANY($2::text[])',[idOf(a?.sub),keys]);
  if(r.rowCount){const row=keys.map(k=>r.rows.find((x:any)=>x.module_key===k)).find(Boolean); return Boolean(row['can_'+action]);}
  const mods=Array.isArray(a?.allowed_modules)?a.allowed_modules.map((x:any)=>String(x)):String(a?.allowed_modules||'').split(',').map((x:string)=>x.trim()).filter(Boolean);
  const parts=String(moduleKey||'').split('/').filter(Boolean); const candidates=[moduleKey,...parts,...parts.map(moduleAlias),parts.at(-1),String(parts.at(-1)||'').replace(/s$/,''),...(clean[0]==='bank-ledger'?['day-book',...(action==='view'?['ledger']:[])]:[])].filter(Boolean);
  return candidates.some((x:any)=>mods.includes(x));
}

export function billingStaff(a:any){
  return a?.scope==="staff" && (Boolean(a?.is_super_user) ||
    ["admin","billing","accounts","head office","head-office"].includes(String(a?.department||"").trim().toLowerCase()));
}
export function isAdmin(a:any){
  return a?.scope==="staff" && (Boolean(a?.is_super_user) || String(a?.department||"").trim().toLowerCase()==="admin");
}
export function canRead(a:any,p:string){
  // Dealers may only read their explicitly scoped portal endpoints.
  if(a?.scope==="dealer") return p.startsWith("dealer/") || p==="auth/me" || p==="billing/pending-sales/options" || p==="notifications";
  if(p==="notifications") {
    return a?.scope==="staff" && (Boolean(a?.is_super_user) || ["admin","accounts","finance"].includes(String(a?.department||"").trim().toLowerCase()));
  }
  return true;
}
// Dealer battery portal writes are explicitly gated by the module flags
// carried in the dealer JWT. This restores the legacy portal behaviour without
// opening generic staff/master CRUD to dealer tokens.
export const DEALER_WRITE_MODULE:any={
  "battery-swap-vouchers":"battery-swap",
  "battery-withdrawal":"battery-withdrawal",
  "battery-addition":"battery-addition"
};
export function canWrite(a:any,p:string){
  // Dealer tokens are never allowed to use generic CRUD against staff/master tables.
  if(a?.scope==="dealer"){
    if(p==="billing/pending-sales/create")return true;
    if(p==="dealer/submit-loan")return true;
    if(p==="dealer/delivery-challans" || p.startsWith("dealer/delivery-challans/"))return true;
    if(p==="dealer/repair-receipts")return true;
    if(p.startsWith("dealer/cash-book/"))return true;
    if(p.startsWith("dealer/pending-sales/"))return true;
    if(/^dealer\/tax-invoices\/\d+$/.test(p))return true;
    if(p==="dealer/customer-invoice")return true; // permission (purchase_access) handler me check hoti hai
    const need=DEALER_WRITE_MODULE[p];
    if(!need)return false;
    const mods=(Array.isArray(a?.portal_modules)?a.portal_modules:String(a?.portal_modules||"").split(","))
      .map((x:any)=>String(x).replace(/[{}"\[\]]/g,"").trim()).filter(Boolean);
    return mods.includes(need);
  }
  // Billing staff may operate the Pending Sales approval/invoice workflow.
  if(p.startsWith("billing/pending-sales") && billingStaff(a)) return true;
  // Admins retain full mutation access.
  if(isAdmin(a)) return true;
  // Non-admin staff can mutate only modules explicitly granted in allowed_modules.
  const mods=Array.isArray(a?.allowed_modules)?a.allowed_modules.map((x:any)=>String(x)):String(a?.allowed_modules||"").split(",").map((x:string)=>x.trim()).filter(Boolean);
  const key=p.startsWith("masters/") ? p : p.split("/")[0];
  if(p==="challan-shift")return mods.includes("challan-shift") || mods.includes("delivery-challan");
  if(p==="battery-fit")return mods.includes("battery-fit") || mods.includes("battery-addition") || mods.includes("delivery-challan");
  if(p==="notifications/read" || p==="notifications/cash-limit")return true;
  // /masters/<kind> ka menu/rights key <kind> hota hai (party, financer, colour ...), isliye wo bhi match karo.
  if(rightsKeys(p).some(k=>mods.includes(k)))return true;
  return mods.includes(p) || mods.includes(key) || mods.includes(moduleAlias(key));
}
