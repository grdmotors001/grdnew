"use client";
import {useEffect,useRef} from "react";

export function ProfileScreen({user,onClose}){
 return <section className="oc-profile"><button onClick={onClose}>← Back</button><div className="oc-profile-avatar">{(user?.name||"?").slice(0,1).toUpperCase()}</div><h2>{user?.name||"Profile"}</h2><p>{user?.about||"Available"}</p>{user?.mobile&&<p>Mobile: {user.mobile}</p>}</section>
}

function TrackView({track,video}){
 const ref=useRef(null);
 useEffect(()=>{
   if(!ref.current||!track)return;
   track.attach(ref.current);
   return()=>{try{track.detach(ref.current)}catch{}};
 },[track]);
 return video ? <video ref={ref} autoPlay playsInline muted={false} className="oc-call-video"/> : <audio ref={ref} autoPlay playsInline/>;
}

export function CallPanel({call,onEnd,localTracks=[],remoteTracks=[]}){
 const localVideo=localTracks.find(t=>t.kind==="video");
 const remoteVideo=remoteTracks.find(t=>t.kind==="video");
 const remoteAudio=remoteTracks.find(t=>t.kind==="audio");
 return <div className="oc-call">
   <h3>{call.video?"Video":"Voice"} Call</h3>
   <p>Connected · Room: {call.room}</p>
   {call.video&&<div className="oc-call-stage">{remoteVideo?<TrackView track={remoteVideo} video/>:localVideo?<TrackView track={localVideo} video/>:<div className="oc-call-wait">Waiting for video…</div>}</div>}
   {!call.video&&remoteAudio&&<TrackView track={remoteAudio}/>}
   <button onClick={onEnd}>End Call</button>
 </div>
}
