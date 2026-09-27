"use client";
import { useEffect, useRef, useState } from "react";
const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const toKey=(s)=>{const pad="=".repeat((4-(s.length%4))%4);const raw=atob((s+pad).replace(/-/g,"+").replace(/_/g,"/"));return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));};
export function usePush({db,me,onOpen}){
 const [state,setState]=useState("unknown"); const openRef=useRef(onOpen); openRef.current=onOpen;
 const supported=typeof window!=="undefined"&&"serviceWorker"in navigator&&"PushManager"in window&&"Notification"in window;
 useEffect(()=>{if(!supported)return setState("unsupported");navigator.serviceWorker.register("/sw.js").catch(()=>setState("unsupported"));const onMsg=e=>{if(e.data?.type==="open"&&e.data.cid)openRef.current?.(e.data.cid)};navigator.serviceWorker.addEventListener("message",onMsg);return()=>navigator.serviceWorker.removeEventListener("message",onMsg)},[]);
 const save=async sub=>{const j=sub.toJSON();await db.rpc("save_push",{p_endpoint:j.endpoint,p_p256dh:j.keys.p256dh,p_auth:j.keys.auth});};
 useEffect(()=>{if(!supported||!db||!me)return;(async()=>{if(Notification.permission==="denied")return setState("denied");const reg=await navigator.serviceWorker.ready;const sub=await reg.pushManager.getSubscription();if(sub){await save(sub);setState("on")}else setState("off")})()},[db,me]);
 async function enable(){const perm=await Notification.requestPermission();if(perm!=="granted")return setState("denied");const reg=await navigator.serviceWorker.ready;const sub=await reg.pushManager.getSubscription()||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:toKey(VAPID)});await save(sub);setState("on")}
 async function disable(){const reg=await navigator.serviceWorker.ready;const sub=await reg.pushManager.getSubscription();if(sub){await db.rpc("drop_push",{p_endpoint:sub.endpoint});await sub.unsubscribe()}setState("off")}
 return {state,enable,disable};
}
