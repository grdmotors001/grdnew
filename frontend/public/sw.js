const OFFLINE_CACHE="grd-offline-v1";
self.addEventListener("install",(e)=>{e.waitUntil(caches.open(OFFLINE_CACHE).then(c=>c.add("/offline.html")).catch(()=>{}).then(()=>self.skipWaiting()))});
// Sirf page open (navigation) par: net chale to normal, na chale to offline page. API / data kabhi cache nahi hota.
self.addEventListener("fetch",(e)=>{
  if(e.request.mode!=="navigate")return;
  e.respondWith(fetch(e.request).catch(()=>caches.match("/offline.html").then(r=>r||Response.error())));
});
self.addEventListener("activate",(e)=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(n=>n!==OFFLINE_CACHE).map(n=>caches.delete(n)))).then(()=>self.clients.claim())));
self.addEventListener("push",(event)=>{
  let data={};try{data=event.data?event.data.json():{}}catch{data={title:"New message",body:event.data?event.data.text():""}}
  const title=data.title||"Office Chat";
  const options={body:data.body||"",icon:data.icon||"/icon.png",badge:data.badge||"/icon.png",data:{cid:data.cid||null,url:data.url||"/chat"}};
  event.waitUntil(self.registration.showNotification(title,options));
});
self.addEventListener("notificationclick",(event)=>{
 event.notification.close();
 const cid=event.notification.data?.cid,url=event.notification.data?.url||"/chat";
 event.waitUntil((async()=>{const clients=await self.clients.matchAll({type:"window",includeUncontrolled:true});const existing=clients.find(c=>c.url.includes("/chat"));if(existing){existing.postMessage({type:"open",cid});return existing.focus()}return self.clients.openWindow(url)})());
});
