const KEY="oc_prefs";
export const MSG_TONES={chime:"Chime",pop:"Pop",bell:"Bell",drop:"Drop",none:"None"};
export const RING_TONES={classic:"Classic",marimba:"Marimba",pulse:"Pulse",digital:"Digital"};
const DEFAULTS={msgTone:"chime",ringTone:"classic",muted:false};
export const getPrefs=()=>{try{return {...DEFAULTS,...JSON.parse(localStorage.getItem(KEY)||"{}")}}catch{return {...DEFAULTS}}};
export const setPrefs=patch=>{try{localStorage.setItem(KEY,JSON.stringify({...getPrefs(),...patch}))}catch{}};
let ctx;const ac=()=>{try{ctx=ctx||new(window.AudioContext||window.webkitAudioContext)();if(ctx.state==="suspended")ctx.resume();return ctx}catch{return null}};
function note(c,freq,at,dur,type="sine",vol=.18){const o=c.createOscillator(),g=c.createGain();o.type=type;o.frequency.setValueAtTime(freq,at);g.gain.setValueAtTime(.0001,at);g.gain.exponentialRampToValueAtTime(vol,at+.02);g.gain.exponentialRampToValueAtTime(.0001,at+dur);o.connect(g);g.connect(c.destination);o.start(at);o.stop(at+dur+.05)}
const MSG={chime:(c,t)=>{note(c,880,t,.25);note(c,1320,t+.12,.35)},pop:(c,t)=>note(c,520,t,.12,"triangle",.28),bell:(c,t)=>{note(c,1046,t,.7);note(c,2092,t,.5,"sine",.06)},drop:(c,t)=>{note(c,900,t,.15);note(c,600,t+.12,.25)}};
const RING={classic:(c,t)=>[0,.5].forEach(o=>{note(c,440,t+o,.4,"sine",.2);note(c,480,t+o,.4,"sine",.2)}),marimba:(c,t)=>[523,659,784,659,523,659,784,1046].forEach((f,i)=>note(c,f,t+i*.22,.3,"triangle",.2)),pulse:(c,t)=>[0,.35,.7].forEach(o=>note(c,330,t+o,.2,"square",.07)),digital:(c,t)=>[0,.15,.3,.6,.75,.9].forEach((o,i)=>note(c,1000+(i%3)*200,t+o,.1,"square",.06))};
export function playMsg(name,force=false){const p=getPrefs(),n=name||p.msgTone;if((p.muted&&!force)||n==="none"||!MSG[n])return;const c=ac();if(c)MSG[n](c,c.currentTime)}
export function previewRing(name){const c=ac();if(c&&RING[name])RING[name](c,c.currentTime)}
export function startRing(name){const p=getPrefs(),n=name||p.ringTone,c=ac();if(p.muted||!c||!RING[n])return()=>{};const play=()=>RING[n](c,c.currentTime);play();const id=setInterval(play,3000);return()=>clearInterval(id)}
