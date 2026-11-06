import { useState } from "react";
import type { ReactNode } from "react";
import "./RequestsInbox.css";
import { fmtDate } from "../../../shared/formatters";
import type { ScheduleView, Servant } from "../../../types";

export default function RequestsPanel({requests,schedules,servants,onReview,onResolve,notifications,onNotificationRead,notificationSettings}:{requests:any[];schedules:ScheduleView[];servants:Servant[];onReview:(request:any,approve:boolean)=>void;onResolve:(request:any,replacementServantId:string)=>void;notifications:any[];onNotificationRead:(id:string)=>void;notificationSettings:ReactNode}){
 const pending=requests.filter(r=>r.status==="pending");
 const [replacementChoice,setReplacementChoice]=useState<Record<string,string>>({});
 return <section className="requests-panel">
  {notificationSettings}
  <section className="requests-content-card notification-history-section">
   <div className="list-heading requests-content-heading"><h2>Notification history</h2><span>{notifications.length} in the last 30 days</span></div>
   {notifications.length===0?<div className="requests-empty-note">No notifications in the last 30 days.</div>:<div className="notification-history-list">{notifications.map(n=><article className={`inbox-item ${n.is_read?"read":"unread"}`} key={n.id} onClick={()=>onNotificationRead(n.id)}><div className="inbox-item-body"><b>{n.title}</b><p>{n.body}</p><small>{new Date(n.created_at).toLocaleString()}</small></div><span className="inbox-status approved">{n.is_read?"Read":"New"}</span></article>)}</div>}
  </section>
  <section className="requests-content-card servant-requests-section">
   <div className="list-heading requests-content-heading"><h2>Servant requests</h2><span>{pending.length} pending</span></div>
   {requests.length===0?<div className="requests-empty-note">No replacement or swap requests yet.</div>:<div className="people-list">{requests.map(r=>{const service=schedules.find(s=>s.id===r.schedule_id);const person=servants.find(p=>p.id===r.requester_servant_id);const candidates=servants.filter(p=>p.active&&p.id!==r.requester_servant_id);return <div className="request-row" key={r.id}><div className="request-main"><b>{person?.full_name??"Servant"} · {r.request_type}</b><small>{service?`${fmtDate(service.service_date)} · ${service.location_name} · ${service.service_name}`:"Schedule unavailable"}</small><small>{r.details||"No details provided"}</small><span className={`status-chip ${r.status}`}>{r.status}</span></div>{r.status==="pending"&&<div className="request-actions">{r.request_type==="replacement"&&<><select value={replacementChoice[r.id]??""} onChange={e=>setReplacementChoice(v=>({...v,[r.id]:e.target.value}))}><option value="">Choose replacement servant</option>{candidates.map(p=><option key={p.id} value={p.id}>{p.full_name}</option>)}</select><button className="btn tiny primary" disabled={!replacementChoice[r.id]} onClick={()=>onResolve(r,replacementChoice[r.id])}>Assign replacement</button></>}<button className="btn tiny secondary" onClick={()=>onReview(r,false)}>Decline request</button></div>}</div>;})}</div>}
  </section>
 </section>;
}
