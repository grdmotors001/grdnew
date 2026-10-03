// Bank Ledger (bank statement entries + Excel import + approve/update) aur Contra Voucher (Bank->Bank, Cash->Bank, Bank->Cash).
// Bade route file se nikala gaya; queries/logic same hain.
import { pool, num, idOf, ymd, todayDate, normKey, importAmount, importDate, rowGetter } from "./common";
import { audit } from "./permissions";
let bankLedgerSchemaReady:Promise<void>|null=null;
let contraSchemaReady:Promise<void>|null=null;
export function ensureContraSchema():Promise<void>{
  if(!contraSchemaReady){
    contraSchemaReady=(async()=>{
      await pool.query(`CREATE TABLE IF NOT EXISTS contra_voucher (
        id bigserial PRIMARY KEY, vr_no integer, date date NOT NULL DEFAULT CURRENT_DATE,
        from_type text NOT NULL, from_bank_id integer, from_bank_name text,
        to_type text NOT NULL, to_bank_id integer, to_bank_name text,
        amount numeric(14,2) NOT NULL DEFAULT 0, ref_no text, narration text,
        created_by text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      )`);
      await pool.query("CREATE INDEX IF NOT EXISTS contra_voucher_date_idx ON contra_voucher(date DESC)");
    })().catch(e=>{contraSchemaReady=null;throw e});
  }
  return contraSchemaReady;
}
// Contra = Bank->Bank, Cash->Bank, Bank->Cash. Cash->Cash is meaningless and rejected.
async function contraValidate(b:any){
  const t=(v:any)=>String(v??"").trim();
  const ft=t(b.from_type).toUpperCase(),tt=t(b.to_type).toUpperCase();
  if(!["CASH","BANK"].includes(ft)||!["CASH","BANK"].includes(tt))return {error:"From aur To me Cash ya Bank chuniye."};
  if(ft==="CASH"&&tt==="CASH")return {error:"Cash se Cash ki contra entry nahi hoti."};
  const amount=Math.round(num(b.amount)*100)/100;
  if(!(amount>0))return {error:"Amount 0 se zyada hona chahiye."};
  const date=ymd(b.date)||todayDate();
  const bank=async(type:string,rawId:any,label:string):Promise<any>=>{
    if(type!=="BANK")return {id:null,name:null};
    const bid=idOf(rawId);if(!bid)return {error:label+" bank select kijiye."};
    const r=await pool.query("SELECT id,name FROM simple_master WHERE id=$1 AND lower(kind)='bank'",[bid]);
    if(!r.rowCount)return {error:label+" bank Bank Details master me nahi mila."};
    return {id:r.rows[0].id,name:r.rows[0].name};
  };
  const fb=await bank(ft,b.from_bank_id,"From");if(fb.error)return {error:fb.error};
  const tb=await bank(tt,b.to_bank_id,"To");if(tb.error)return {error:tb.error};
  if(ft==="BANK"&&tt==="BANK"&&fb.id===tb.id)return {error:"From aur To bank alag-alag hone chahiye."};
  return {f:{date,ft,tt,fbid:fb.id,fbn:fb.name,tbid:tb.id,tbn:tb.name,amount,ref:t(b.ref_no)||null,narration:t(b.narration)||null}};
}
export function ensureBankLedgerSchema():Promise<void>{
  if(!bankLedgerSchemaReady){
    bankLedgerSchemaReady=(async()=>{
      await pool.query(`CREATE TABLE IF NOT EXISTS bank_ledger_entry (
        id bigserial PRIMARY KEY, entry_date date NOT NULL DEFAULT CURRENT_DATE, amount numeric(14,2) NOT NULL DEFAULT 0,
        bank_name text NOT NULL DEFAULT '', cheque_no text, upi_ref text, narration text, party_name text,
        entry_type text NOT NULL DEFAULT 'SUSPENSE', status text NOT NULL DEFAULT 'SUSPENSE', source text DEFAULT 'EXCEL', source_ref text,
        created_by text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      )`);
      await pool.query("CREATE INDEX IF NOT EXISTS bank_ledger_date_idx ON bank_ledger_entry(entry_date DESC)");
      await pool.query("CREATE INDEX IF NOT EXISTS bank_ledger_bank_idx ON bank_ledger_entry(lower(btrim(bank_name)))");
      await pool.query("CREATE INDEX IF NOT EXISTS bank_ledger_status_idx ON bank_ledger_entry(status)");
    })().catch(e=>{bankLedgerSchemaReady=null;throw e});
  }
  return bankLedgerSchemaReady;
}

export async function bankLedgerGet(req:Request,path:string[],a:any):Promise<Response|null>{
  const p=path.join("/");
  if(p==="contra-vouchers"){
      await ensureContraSchema();
      const u=new URL(req.url),from=u.searchParams.get("from"),to=u.searchParams.get("to"),q=String(u.searchParams.get("search")||"").trim();
      const args:any[]=[],w:string[]=[];
      if(from){args.push(from);w.push(`date>=$${args.length}::date`)}
      if(to){args.push(to);w.push(`date<=$${args.length}::date`)}
      if(q){args.push("%"+q+"%");const i=args.length;w.push(`(COALESCE(from_bank_name,'') ILIKE $${i} OR COALESCE(to_bank_name,'') ILIKE $${i} OR COALESCE(ref_no,'') ILIKE $${i} OR COALESCE(narration,'') ILIKE $${i} OR vr_no::text ILIKE $${i})`)}
      const r=await pool.query(`SELECT id,vr_no,to_char(date,'YYYY-MM-DD') AS date,from_type,from_bank_id,from_bank_name,to_type,to_bank_id,to_bank_name,amount,ref_no,narration,created_by FROM contra_voucher ${w.length?'WHERE '+w.join(' AND '):''} ORDER BY date DESC,id DESC LIMIT 5000`,args);
      const nx=await pool.query("SELECT COALESCE(MAX(vr_no),0)+1 AS n FROM contra_voucher");
      return Response.json({rows:r.rows,count:r.rowCount,next_vr_no:Number(nx.rows[0]?.n||1)});
    }
  if(p==="bank-ledger"){
      await ensureBankLedgerSchema();
      const u=new URL(req.url),q=String(u.searchParams.get("search")||"").trim(),st=String(u.searchParams.get("status")||"all").toUpperCase();
      const bank=String(u.searchParams.get("bank")||"").trim(),from=importDate(u.searchParams.get("from")||""),to=importDate(u.searchParams.get("to")||"");
      const args:any[]=[],where:string[]=[];
      if(q){args.push("%"+q+"%");const i=args.length;where.push(`(bank_name ILIKE $${i} OR COALESCE(cheque_no,'') ILIKE $${i} OR COALESCE(upi_ref,'') ILIKE $${i} OR COALESCE(narration,'') ILIKE $${i} OR COALESCE(party_name,'') ILIKE $${i})`)}
      if(st!=="ALL"){args.push(st);where.push(`status=$${args.length}`)}
      if(bank){args.push(bank);where.push(`lower(btrim(bank_name))=lower(btrim($${args.length}))`)}
      if(from){args.push(from);where.push(`entry_date>=$${args.length}::date`)}
      if(to){args.push(to);where.push(`entry_date<=$${args.length}::date`)}
      const rr=await pool.query(`SELECT * FROM bank_ledger_entry ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY entry_date DESC,id DESC LIMIT 10000`,args);
      const br=await pool.query("SELECT id,name,account_no,ifsc FROM simple_master WHERE lower(kind)='bank' ORDER BY name").catch(()=>({rows:[]}));
      // Per-bank ledger totals: only POSTED entries move the balance; SUSPENSE is shown separately.
      const sm=await pool.query(`SELECT lower(btrim(bank_name)) k,MAX(bank_name) bank_name,
          COALESCE(SUM(CASE WHEN status='POSTED' AND entry_type='RECEIPT' THEN ABS(amount) END),0) receipts,
          COALESCE(SUM(CASE WHEN status='POSTED' AND entry_type='PAYMENT' THEN ABS(amount) END),0) payments,
          COUNT(*) FILTER (WHERE status='SUSPENSE') suspense_count,COALESCE(SUM(ABS(amount)) FILTER (WHERE status='SUSPENSE'),0) suspense_amount
        FROM bank_ledger_entry GROUP BY lower(btrim(bank_name))`);
      let opening=0;
      if(bank&&from){const o=await pool.query(`SELECT COALESCE(SUM(CASE WHEN entry_type='RECEIPT' THEN ABS(amount) WHEN entry_type='PAYMENT' THEN -ABS(amount) ELSE 0 END),0) v FROM bank_ledger_entry WHERE status='POSTED' AND entry_date<$1::date AND lower(btrim(bank_name))=lower(btrim($2))`,[from,bank]);opening=Number(o.rows[0]?.v||0);}
      return Response.json({rows:rr.rows,banks:br.rows,summary:sm.rows.map((x:any)=>({bank_name:x.bank_name,receipts:Number(x.receipts),payments:Number(x.payments),balance:Number(x.receipts)-Number(x.payments),suspense_count:Number(x.suspense_count),suspense_amount:Number(x.suspense_amount)})),opening});
    }
  return null;
}

export async function bankLedgerPost(req:Request,path:string[],b:any,a:any):Promise<Response|null>{
  const p=path.join("/");
  if(p==="bank-ledger/import"){
      await ensureBankLedgerSchema();
      const rows=Array.isArray(b.rows)?b.rows:[]; if(!rows.length)return Response.json({error:"No rows supplied."},{status:400});
      // Bank name must match Bank Details master (typos would otherwise create phantom ledgers).
      const bm=await pool.query("SELECT name FROM simple_master WHERE lower(kind)='bank'").catch(()=>({rows:[]}));
      const masters:string[]=bm.rows.map((x:any)=>String(x.name||"").trim()).filter(Boolean);
      const matchBank=(v:string)=>{if(!masters.length)return v; const n=normKey(v); if(!n)return ""; const ex=masters.find(m=>normKey(m)===n); if(ex)return ex; const part=masters.filter(m=>normKey(m).includes(n)||n.includes(normKey(m))); return part.length===1?part[0]:"";};
      const client=await pool.connect(); let inserted=0,duplicates=0; const rejected:any[]=[]; const seen=new Map<string,number>();
      try{
        await client.query("BEGIN");
        for(let i=0;i<rows.length;i++){
          const g=rowGetter(rows[i]),rowNo=i+2;
          const rawDate=g(["date","entry date","txn date","transaction date","value date"]),date=rawDate===""?todayDate():importDate(rawDate);
          const amount=importAmount(g(["amount","amt"]));
          const bankRaw=String(g(["bank name","bank"])||"").trim(),cheque=String(g(["cheque no","cheque number","chq no","cheque no./upi"])||"").trim();
          const upi=String(g(["upi","upi ref","upi ref no","utr","utr no","reference no"])||"").trim(),narration=String(g(["narration","description","remarks","particulars"])||"").trim();
          if(!bankRaw&&!amount&&!narration)continue;
          if(!date){rejected.push({row:rowNo,reason:"Invalid date: "+rawDate});continue;}
          if(!amount){rejected.push({row:rowNo,reason:"Amount missing/zero"});continue;}
          if(!bankRaw){rejected.push({row:rowNo,reason:"Bank name missing"});continue;}
          const bank=matchBank(bankRaw); if(!bank){rejected.push({row:rowNo,reason:"Bank not in Bank Details master: "+bankRaw});continue;}
          // Duplicate = same key already stored at least as many times as it appears so far in this file
          // (two genuinely identical UPI payments in one file are both kept; re-importing the same file adds nothing).
          const key=[date,amount,normKey(bank),normKey(cheque),normKey(upi),normKey(narration)].join("|"),occ=(seen.get(key)||0)+1; seen.set(key,occ);
          const ex=await client.query(`SELECT COUNT(*)::int c FROM bank_ledger_entry WHERE entry_date=$1::date AND amount=$2 AND lower(btrim(bank_name))=lower(btrim($3)) AND COALESCE(lower(btrim(cheque_no)),'')=lower(btrim($4)) AND COALESCE(lower(btrim(upi_ref)),'')=lower(btrim($5)) AND COALESCE(lower(btrim(narration)),'')=lower(btrim($6))`,[date,amount,bank,cheque,upi,narration]);
          if(Number(ex.rows[0].c)>=occ){duplicates++;continue;}
          await client.query(`INSERT INTO bank_ledger_entry(entry_date,amount,bank_name,cheque_no,upi_ref,narration,entry_type,status,source,created_by) VALUES($1::date,$2,$3,$4,$5,$6,'SUSPENSE','SUSPENSE','EXCEL',$7)`,[date,amount,bank,cheque||null,upi||null,narration,String(a?.username||"")]);
          inserted++;
        }
        await client.query("COMMIT");
      }catch(e){await client.query("ROLLBACK").catch(()=>{});throw e;}finally{client.release();}
      await audit(a,"bank-ledger","create",null,null,{import:true,inserted,duplicates,rejected:rejected.length},null,"Bank Excel import");
      return Response.json({success:true,inserted,duplicates,rejected:rejected.slice(0,100),rejected_count:rejected.length});
    }
  if(p==="contra-vouchers"){
      await ensureContraSchema();
      const id=idOf(b.id);
      const v:any=await contraValidate(b);if(v.error)return Response.json({error:v.error},{status:400});const f=v.f;
      if(id){
        const old=(await pool.query("SELECT * FROM contra_voucher WHERE id=$1",[id])).rows[0];if(!old)return Response.json({error:"Contra voucher not found."},{status:404});
        const r=await pool.query(`UPDATE contra_voucher SET date=$1::date,from_type=$2,from_bank_id=$3,from_bank_name=$4,to_type=$5,to_bank_id=$6,to_bank_name=$7,amount=$8,ref_no=$9,narration=$10,updated_at=now() WHERE id=$11 RETURNING *`,[f.date,f.ft,f.fbid,f.fbn,f.tt,f.tbid,f.tbn,f.amount,f.ref,f.narration,id]);
        await audit(a,"contra-vouchers","edit",id,old,r.rows[0],null,String(old.vr_no||id));
        return Response.json({success:true,row:r.rows[0]});
      }
      const vr=Number(b.vr_no)>0?Math.floor(Number(b.vr_no)):Number((await pool.query("SELECT COALESCE(MAX(vr_no),0)+1 AS n FROM contra_voucher")).rows[0]?.n||1);
      const r=await pool.query(`INSERT INTO contra_voucher(vr_no,date,from_type,from_bank_id,from_bank_name,to_type,to_bank_id,to_bank_name,amount,ref_no,narration,created_by) VALUES($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[vr,f.date,f.ft,f.fbid,f.fbn,f.tt,f.tbid,f.tbn,f.amount,f.ref,f.narration,String(a?.username||"")]);
      await audit(a,"contra-vouchers","create",r.rows[0].id,null,r.rows[0],null,String(vr));
      return Response.json({success:true,row:r.rows[0]});
    }
  if(p==="bank-ledger/update"){
      await ensureBankLedgerSchema(); const id=idOf(b.id); if(!id)return Response.json({error:"Entry id required."},{status:400});
      const old=(await pool.query("SELECT * FROM bank_ledger_entry WHERE id=$1",[id])).rows[0]; if(!old)return Response.json({error:"Entry not found."},{status:404});
      const want=String(b.status||"POSTED").toUpperCase(),status=want==="CANCELLED"?"CANCELLED":want==="SUSPENSE"?"SUSPENSE":"POSTED";
      const party=String(b.party_name||"").trim();
      // Posting needs the manual "kis se aaya / kise diya" + direction; without it the entry must stay in Suspense.
      if(status==="POSTED"&&!party)return Response.json({error:"Party (kis se aaya / kise diya) required to post."},{status:400});
      const type=status==="SUSPENSE"?"SUSPENSE":String(b.entry_type||"").toUpperCase()==="PAYMENT"?"PAYMENT":String(b.entry_type||"").toUpperCase()==="RECEIPT"?"RECEIPT":(status==="POSTED"?"":"SUSPENSE");
      if(status==="POSTED"&&!type)return Response.json({error:"Select Receipt or Payment."},{status:400});
      const r=await pool.query(`UPDATE bank_ledger_entry SET party_name=$1,narration=$2,entry_type=$3,status=$4,updated_at=now() WHERE id=$5 RETURNING *`,[party,String(b.narration??old.narration??"").trim(),type||old.entry_type,status,id]);
      await audit(a,"bank-ledger","approve",id,old,r.rows[0],null,old.cheque_no||old.upi_ref||old.bank_name);
      return Response.json({success:true,row:r.rows[0]});
    }
  return null;
}

export async function bankLedgerMutation(req:Request,path:string[],method:string,a:any,bodyForScope:any):Promise<Response|null>{
  const p=path.join("/");
  if(path[0]==="contra-vouchers"&&path.length===2&&method==="DELETE"){
      await ensureContraSchema();const id=idOf(path[1]);
      const old=(await pool.query("SELECT * FROM contra_voucher WHERE id=$1",[id])).rows[0];if(!old)return Response.json({error:"Contra voucher not found."},{status:404});
      await pool.query("DELETE FROM contra_voucher WHERE id=$1",[id]);
      await audit(a,"contra-vouchers","delete",id,old,null,null,String(old.vr_no||id));
      return Response.json({success:true});
    }
  return null;
}
