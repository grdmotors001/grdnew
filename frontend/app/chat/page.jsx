"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import {createClient} from "@supabase/supabase-js";
import {getToken} from "../../lib/api";
import "./chat.css";
import {PhoneIcon,VideoIcon,UserIcon} from "./Icons";
import {ProfileScreen,CallPanel} from "./ProfileScreens";
import {useCalls} from "./useCalls";

const SB_URL=process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const TOKEN_URL="/api/backend/chat/token";
const BUCKET="chat-files";

async function chatJwt(){
  const r=await fetch(TOKEN_URL,{headers:{Authorization:"Bearer "+getToken()}});
  if(!r.ok) throw new Error("Chat login failed");
  return (await r.json()).token;
}

export default function ChatPage({onClose}={}){
 const [db,setDb]=useState(null),[me,setMe]=useState(null),[users,setUsers]=useState([]),[convs,setConvs]=useState([]),[parts,setParts]=useState([]),[msgs,setMsgs]=useState([]),[active,setActive]=useState(null),[text,setText]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false),[tab,setTab]=useState("chats"),[profile,setProfile]=useState(false);
 const {call,busy:callBusy,error:callError,startCall,endCall,remoteTracks,localTracks}=useCalls();
 const end=useRef(null);
 useEffect(()=>{(async()=>{try{
   const jwt=await chatJwt();
   const payload=JSON.parse(atob(jwt.split(".")[1].replace(/-/g,"+").replace(/_/g,"/")));
   setMe(payload.sub);
   const client=createClient(SB_URL,SB_KEY,{accessToken:async()=>chatJwt()});
   setDb(client);
   const [{data:u,error:ue},{data:c,error:ce},{data:p,error:pe},{data:m,error:me2}]=await Promise.all([
     client.from("chat_users").select("*").order("name"),
     client.from("conversations").select("*"),
     client.from("participants").select("*"),
     client.from("messages").select("*").order("created_at")
   ]);
   if(ue||ce||pe||me2) throw new Error((ue||ce||pe||me2).message);
   setUsers(u||[]);setConvs(c||[]);setParts(p||[]);setMsgs(m||[]);
   const ch=client.channel("office-chat").on("postgres_changes",{event:"*",schema:"public",table:"messages"},({new:row})=>setMsgs(x=>x.some(a=>a.id===row.id)?x:[...x,row])).subscribe();
   return()=>client.removeChannel(ch);
 }catch(e){setError(e.message)}})()},[]);
 const mineUsers=useMemo(()=>users.filter(u=>u.id!==me),[users,me]);
 const chats=useMemo(()=>convs.map(c=>{const ps=parts.filter(p=>p.conversation_id===c.id);const other=ps.find(p=>p.user_id!==me);const u=other&&users.find(x=>x.id===other.user_id);const last=msgs.filter(m=>m.conversation_id===c.id).at(-1);return {...c,name:c.is_group?c.title:(u?.name||"Chat"),avatar:u?.avatar,last}}).filter(Boolean),[convs,parts,users,msgs,me]);
 const thread=msgs.filter(m=>m.conversation_id===active);
 useEffect(()=>{end.current?.scrollIntoView({behavior:"smooth"})},[thread.length,active]);
 async function openUser(uid){
   setError("");
   let c=convs.find(x=>!x.is_group&&parts.some(p=>p.conversation_id===x.id&&p.user_id===me)&&parts.some(p=>p.conversation_id===x.id&&p.user_id===uid));
   if(!c){const {data,error}=await db.rpc("start_dm",{other:uid});if(error)return setError(error.message);c={id:data};const {data:cc}=await db.from("conversations").select("*").eq("id",data).single();c=cc;const {data:pp}=await db.from("participants").select("*").eq("conversation_id",data);setConvs(x=>[...x,c]);setParts(x=>[...x,...(pp||[])]);}
   setActive(c.id);
 }
 async function send(e){e.preventDefault();if(!text.trim()||!active)return;setBusy(true);const {error}=await db.from("messages").insert({conversation_id:active,sender_id:me,body:text.trim()});setBusy(false);if(error)setError(error.message);else setText("")}
 async function sendFile(e){const f=e.target.files?.[0];if(!f||!active)return;if(f.size>10*1024*1024)return setError("File must be smaller than 10 MB");setBusy(true);const path=active+"/"+crypto.randomUUID()+"-"+f.name.replace(/[^\\w.\\-]+/g,"_");const up=await db.storage.from(BUCKET).upload(path,f,{contentType:f.type});if(up.error){setBusy(false);return setError(up.error.message)}const r=await db.from("messages").insert({conversation_id:active,sender_id:me,body:null,file_url:path,file_name:f.name,file_type:f.type});setBusy(false);if(r.error)setError(r.error.message)}
 return <div className="oc">
  <aside className="oc-listpane"><header><button onClick={()=>onClose?onClose():(location.href="/")}>←</button><h1>Office Chat</h1></header><nav className="oc-tabs"><button className={tab==="chats"?"on":""} onClick={()=>setTab("chats")}>Chats</button><button className={tab==="calls"?"on":""} onClick={()=>setTab("calls")}>Calls</button><button className={tab==="profile"?"on":""} onClick={()=>setTab("profile")}>Profile</button></nav>
   {error&&<div className="oc-error" onClick={()=>setError("")}>{error}</div>}
   {tab==="chats" && mineUsers.map(u=><button key={u.id} className="oc-user" onClick={()=>openUser(u.id)}><span className="oc-avatar">{(u.name||"?").slice(0,1).toUpperCase()}</span><span><b>{u.name}</b><small>{u.about||"Available"}</small></span></button>)}
   {tab==="chats" && chats.map(c=><button key={c.id} className={"oc-user "+(active===c.id?"on":"")} onClick={()=>setActive(c.id)}><span className="oc-avatar">{(c.name||"?").slice(0,1).toUpperCase()}</span><span><b>{c.name}</b><small>{c.last?.body||"No messages"}</small></span></button>)}
  </aside>
  <main className="oc-main">{active?<><header className="oc-head"><h2>{chats.find(c=>c.id===active)?.name||"Chat"}</h2><div className="oc-actions"><button title="Voice call" disabled={callBusy} onClick={()=>startCall(active,false)}><PhoneIcon/></button><button title="Video call" disabled={callBusy} onClick={()=>startCall(active,true)}><VideoIcon/></button><button title="Profile" onClick={()=>setProfile(true)}><UserIcon/></button><button onClick={()=>setActive(null)}>Close</button></div></header><section className="oc-thread">{thread.map(m=><div key={m.id} className={"oc-msg "+(m.sender_id===me?"mine":"")}><div>{m.body}</div>{m.file_name&&<small>📎 {m.file_name}</small>}<time>{new Date(m.created_at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</time></div>)}<div ref={end}/></section>{(call||callError)&&<CallPanel call={call||{room:active,video:false}} onEnd={endCall} remoteTracks={remoteTracks} localTracks={localTracks}/>} {profile&&<ProfileScreen user={users.find(u=>u.id!==me&&parts.some(p=>p.conversation_id===active&&p.user_id===u.id))} onClose={()=>setProfile(false)}/>}<form className="oc-send" onSubmit={send}><label>📎<input hidden type="file" onChange={sendFile}/></label><input value={text} onChange={e=>setText(e.target.value)} placeholder={busy?"Sending…":"Type a message"}/><button disabled={busy}>Send</button></form></>:<div className="oc-empty"><h2>Office Chat</h2><p>Select a person to start chatting.</p></div>}</main>
 </div>
}
