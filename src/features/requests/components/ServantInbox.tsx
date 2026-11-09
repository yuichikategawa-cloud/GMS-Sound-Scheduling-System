import { ClipboardCheck } from "lucide-react";
import type { ReactNode } from "react";
import "./RequestsInbox.css";
import { fmtDate } from "../../../shared/formatters";
import type { ScheduleView, ServingNotificationRecord } from "../../../types";
import type { ServingRequestReadMarker, ServingRequestRecord } from "../services/requestData";

export default function ServantInbox({requests,schedules,reads,onRead,notifications,onNotificationRead,notificationSettings}:{requests:ServingRequestRecord[];schedules:ScheduleView[];reads:ServingRequestReadMarker[];onRead:(id:string)=>void;notifications:ServingNotificationRecord[];onNotificationRead:(id:string)=>void;notificationSettings:ReactNode}){
 const decisions=requests.filter(r=>["approved","declined","rejected"].includes(String(r.status??"").toLowerCase())).sort((a,b)=>String(b.reviewed_at??b.created_at).localeCompare(String(a.reviewed_at??a.created_at)));
 const pending=requests.filter(r=>String(r.status??"").toLowerCase()==="pending");
 const unread=notifications.filter(n=>!n.is_read).length;
 return <section className="servant-inbox"><div className="inbox-intro"><div><h2>Inbox</h2><p className="subtle">Assignment confirmations and replacement updates.</p></div><span className="inbox-unread-count">{unread} unread</span></div>
 {notificationSettings}
 <div className="list-heading"><h3>Notification history</h3><span>{notifications.length} recent</span></div>
 {notifications.map(n => (
    <article className={`inbox-item ${n.is_read ? "read" : "unread"}`} key={n.id} role="button" tabIndex={0} onClick={() => onNotificationRead(n.id)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onNotificationRead(n.id); } }}>
      <div className="inbox-item-icon"><ClipboardCheck size={19}/></div>
      <div className="inbox-item-body">
        <div className="inbox-item-title"><b>{n.title}</b><span className="inbox-status approved">{n.is_read ? "Read" : "New"}</span></div>
        <p>{n.body}</p><small>{new Date(n.created_at).toLocaleString()}</small>
      </div>
    </article>
  ))}
  {decisions.map(r => {
    const s = schedules.find(x => x.id === r.schedule_id);
    const approved = String(r.status).toLowerCase() === "approved";
    return (
      <article className={`inbox-item ${reads.some(x => x.request_id === r.id) ? "read" : "unread"}`} key={r.id} role="button" tabIndex={0} onClick={() => onRead(r.id)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onRead(r.id); } }}>
        <div className="inbox-item-icon"><ClipboardCheck size={19}/></div>
        <div className="inbox-item-body">
          <div className="inbox-item-title"><b>{r.request_type === "swap" ? "Swap request" : "Replacement request"}</b><span className={`inbox-status ${approved ? "approved" : "rejected"}`}>{approved ? "Approved" : "Rejected"}</span></div>
          <p>{approved ? "Your request has been approved by the administrator." : "Your request was not approved by the administrator."}</p>
          <small>{s ? `${fmtDate(s.service_date)} · ${s.location_name} · ${s.service_name}` : "Schedule details unavailable"}</small>
          {r.details && <small>{r.details}</small>}
        </div>
      </article>
    );
  })}
  {pending.map(r=>{const s=schedules.find(x=>x.id===r.schedule_id);return <article className="inbox-item" key={r.id}><div className="inbox-item-icon"><ClipboardCheck size={19}/></div><div className="inbox-item-body"><div className="inbox-item-title"><b>{r.request_type==="swap"?"Swap request":"Replacement request"}</b><span className="inbox-status pending">Pending</span></div><p>Your request is waiting for administrator review.</p><small>{s?`${fmtDate(s.service_date)} · ${s.location_name} · ${s.service_name}`:"Schedule details unavailable"}</small></div></article>;})}
 {notifications.length+decisions.length+pending.length===0&&<div className="empty-state"><ClipboardCheck size={28}/><b>No notifications yet</b><p>You'll be notified when assignments or requests change.</p></div>}
 </section>;
}
