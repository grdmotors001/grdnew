"use client";
export function ProfileScreen({user,onClose}){
 return <section className="oc-profile"><button onClick={onClose}>← Back</button><div className="oc-profile-avatar">{(user?.name||"?").slice(0,1).toUpperCase()}</div><h2>{user?.name||"Profile"}</h2><p>{user?.about||"Available"}</p>{user?.mobile&&<p>Mobile: {user.mobile}</p>}</section>
}
export function CallPanel({call,onEnd}){return <div className="oc-call"><h3>{call.video?"Video":"Voice"} Call</h3><p>Room: {call.room}</p><button onClick={onEnd}>End Call</button></div>}
