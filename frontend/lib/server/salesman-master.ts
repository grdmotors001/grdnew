// Salesman Master = Dealer Master jaisa: naam + Login ID + Password ek hi jagah se.
// Login `user` table (department='Salesman') me sync hota hai, isliye existing permissions / dealer-scope enforcement jyon ke tyon chalte hain.
// Module / action permissions: Salesman Master me "Permissions" button -> wahi User Permissions page.
import { pool, columns, idOf } from "./common";

const t=(v:any)=>String(v??"").trim();
const DEFAULT_SALESMAN_MODULES=["delivery-challan","tax-invoice","closing-stock-dealers","stock-ledger-dealers","sale-register","payment-receivable-report"];
const modCount=(v:any)=>Array.isArray(v)?v.length:String(v||"").replace(/[{}"\[\]]/g,"").split(",").map(x=>x.trim()).filter(Boolean).length;

async function salesmanUsers(){
  const cols=await columns("user");
  const sel=['id','username',cols.has("salesman_name")?"salesman_name":"NULL::text AS salesman_name",cols.has("allowed_modules")?"allowed_modules":"NULL AS allowed_modules"].join(",");
  const r=await pool.query('SELECT '+sel+' FROM "user" WHERE lower(btrim(COALESCE(department,\'\')))=\'salesman\'');
  return r.rows;
}
const userFor=(users:any[],name:string)=>{const k=name.toLowerCase();return users.find(u=>t(u.salesman_name).toLowerCase()===k)||users.find(u=>t(u.username).toLowerCase()===k)||null;};

export async function salesmanMasterList():Promise<Response>{
  const sm=await pool.query("SELECT * FROM simple_master WHERE lower(kind)='salesman' ORDER BY name,id");
  const users=await salesmanUsers();
  const rows=sm.rows.map((m:any)=>{const u=userFor(users,t(m.name));return {...m,user_id:u?.id||null,login_id:u?.username||"",has_login:!!u,modules_count:u?modCount(u.allowed_modules):0};});
  return Response.json({masters:rows,rows,data:rows});
}

async function syncLogin(name:string,b:any,saveUser:(b:any)=>Promise<Response>):Promise<Response|null>{
  const loginId=t(b.login_id),password=String(b.password||"");
  const existing=userFor(await salesmanUsers(),name);
  if(!existing&&!loginId&&!password)return null;            // login set nahi karna
  if(existing&&!loginId&&!password)return null;             // kuch badla nahi
  if(!existing&&!password)return Response.json({error:"New login ke liye Password zaroori hai."},{status:400});
  const payload:any={username:loginId||existing?.username||name,department:"Salesman",salesman_name:name,is_super_user:false,password};
  if(existing)payload.id=existing.id;else payload.allowed_modules=DEFAULT_SALESMAN_MODULES;
  const res=await saveUser(payload);
  return res.ok?null:res;
}

export async function salesmanMasterWrite(method:string,path:string[],b:any,saveUser:(b:any)=>Promise<Response>):Promise<Response>{
  const name=t(b?.name),id=idOf(path[2]);
  if(method==="DELETE"){
    if(!id)return Response.json({error:"Record id required."},{status:400});
    const r=await pool.query("DELETE FROM simple_master WHERE id=$1 AND lower(kind)='salesman' RETURNING *",[id]);
    return Response.json({success:r.rowCount>0,row:r.rows[0]||null,note:"Login (User Master) delete nahi hua."});
  }
  if(!name)return Response.json({error:"Salesman Name is required."},{status:400});
  if(method==="POST"){
    const dup=await pool.query("SELECT 1 FROM simple_master WHERE lower(kind)='salesman' AND lower(btrim(name))=lower($1) LIMIT 1",[name]);
    if(dup.rowCount)return Response.json({error:"Salesman '"+name+"' already exists."},{status:400});
    const r=await pool.query("INSERT INTO simple_master (kind,name) VALUES ('salesman',$1) RETURNING *",[name]);
    const err=await syncLogin(name,b,saveUser);
    if(err)return err;
    return Response.json({success:true,row:r.rows[0],data:r.rows[0]},{status:201});
  }
  // PUT / PATCH
  if(!id)return Response.json({error:"Record id required."},{status:400});
  const old=(await pool.query("SELECT * FROM simple_master WHERE id=$1 AND lower(kind)='salesman'",[id])).rows[0];
  if(!old)return Response.json({error:"Salesman not found."},{status:404});
  const oldName=t(old.name);
  const dup=await pool.query("SELECT 1 FROM simple_master WHERE lower(kind)='salesman' AND lower(btrim(name))=lower($1) AND id<>$2 LIMIT 1",[name,id]);
  if(dup.rowCount)return Response.json({error:"Salesman '"+name+"' already exists."},{status:400});
  const r=await pool.query("UPDATE simple_master SET name=$1 WHERE id=$2 RETURNING *",[name,id]);
  if(oldName.toLowerCase()!==name.toLowerCase()||oldName!==name){
    // Rename: login aur Dealer Master ka salesman naam bhi saath me badlo, warna link toot jata hai.
    const dcols=await columns("dealer");
    if(dcols.has("salesman"))await pool.query("UPDATE dealer SET salesman=$1 WHERE lower(btrim(COALESCE(salesman,'')))=lower($2)",[name,oldName]);
    const ucols=await columns("user");
    if(ucols.has("salesman_name"))await pool.query('UPDATE "user" SET salesman_name=$1 WHERE lower(btrim(COALESCE(salesman_name,\'\')))=lower($2)',[name,oldName]);
  }
  const err=await syncLogin(name,b,saveUser);
  if(err)return err;
  return Response.json({success:true,row:r.rows[0],data:r.rows[0]});
}
