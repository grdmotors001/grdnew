"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Room, RoomEvent, createLocalTracks } from "livekit-client";
import { getToken } from "../../lib/api";

const TOKEN_URL="/api/backend/chat/call-token";

export function useCalls(){
  const roomRef=useRef(null);
  const [call,setCall]=useState(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [remoteTracks,setRemoteTracks]=useState([]);
  const [localTracks,setLocalTracks]=useState([]);

  const cleanup=useCallback(async()=>{
    const room=roomRef.current;
    roomRef.current=null;
    if(room){
      try{room.disconnect()}catch{}
    }
    setCall(null);
    setRemoteTracks([]);
    setLocalTracks([]);
  },[]);

  const startCall=useCallback(async(roomName,video)=>{
    if(!roomName || busy) return;
    setBusy(true); setError("");
    try{
      const r=await fetch(TOKEN_URL+"?room="+encodeURIComponent(roomName),{
        headers:{Authorization:"Bearer "+getToken()}
      });
      const body=await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(body.error||"Could not start call");
      const room=new Room({adaptiveStream:true,dynacast:true});
      roomRef.current=room;
      room.on(RoomEvent.TrackSubscribed,(track)=>setRemoteTracks(x=>x.some(t=>t.sid===track.sid)?x:[...x,track]));
      room.on(RoomEvent.TrackUnsubscribed,(track)=>setRemoteTracks(x=>x.filter(t=>t.sid!==track.sid)));
      room.on(RoomEvent.Disconnected,()=>cleanup());

      await room.connect((process.env.NEXT_PUBLIC_LIVEKIT_URL||"").trim(),body.token);
      const tracks=await createLocalTracks({audio:true,video:!!video});
      for(const track of tracks) await room.localParticipant.publishTrack(track);
      setLocalTracks(tracks);
      setCall({room:roomName,video:!!video});
    }catch(e){
      await cleanup();
      setError(e.message||"Call could not start");
    }finally{setBusy(false)}
  },[busy,cleanup]);

  const endCall=useCallback(async()=>{await cleanup()},[cleanup]);

  useEffect(()=>()=>{try{roomRef.current?.disconnect()}catch{}},[]);

  return {call,busy,error,startCall,endCall,remoteTracks,localTracks};
}
