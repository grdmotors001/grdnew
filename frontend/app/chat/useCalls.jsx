"use client";
import {useCallback,useState} from "react";
import {getToken} from "../../lib/api";
export function useCalls(){
 const [call,setCall]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const startCall=useCallback(async(room,video=false)=>{
  try{setBusy(true);setError("");const r=await fetch("/api/backend/chat/call-token?room="+encodeURIComponent(room),{headers:{Authorization:"Bearer "+getToken()}});const d=await r.json();if(!r.ok)throw new Error(d.error||"Call token failed");setCall({room,video,token:d.token,url:d.url||process.env.NEXT_PUBLIC_LIVEKIT_URL});}catch(e){setError(e.message)}finally{setBusy(false)}
 },[]);
 const endCall=useCallback(()=>setCall(null),[]);
 return {call,busy,error,startCall,endCall};
}
