import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

export function GmsLoader({label="Getting the sound system ready..."}:{label?:string}){
 const soundFacts=[
  "A 3 dB increase represents roughly twice the sound intensity.",
  "Sound travels faster through water than through air.",
  "Human hearing typically spans frequencies from 20 Hz to 20 kHz.",
  "A sound wave transfers energy through a medium.",
  "Reverberation is the persistence of sound after its source stops."
 ];
 const [factIndex,setFactIndex]=useState(()=>Math.floor(Math.random()*soundFacts.length));
 useEffect(()=>{const timer=window.setInterval(()=>setFactIndex(index=>(index+1)%soundFacts.length),5000);return()=>window.clearInterval(timer);},[]);
 return <div className="gms-loader-screen" role="status" aria-live="polite" aria-label={label}>
  <main className="gms-loader-content">
   <h1 className="gms-loader-title">GMS Sound Scheduling System</h1>
   <div className="gms-equalizer" aria-hidden="true">
    {[42,66,88,100,88,66,42].map((height,index)=><span key={index} style={{"--bar-height":`${height}%`,"--bar-delay":`${index*110}ms`} as CSSProperties}/>)}
   </div>
   <h2 className="gms-loader-message">{label}</h2>
   <p className="gms-loader-caption" key={factIndex}>{soundFacts[factIndex]}</p>
  </main>
 </div>;
}
