import type { CSSProperties } from "react";
import { CalendarDays, Pencil, Trash2, ChevronDown, AlertTriangle } from "lucide-react";
import type { Role, ScheduleView } from "../../../types";
import { fmtDate, shortTime } from "../../../shared/formatters";
import { DAILY_CATEGORY_TINTS, dailyChurchColor, dailyServiceCategory, dailyTeamTint } from "../services/dailyDisplay";
import { ROLES } from "../constants";

export function MyUpcomingAssignments({items,servantId,onConfirm,onRequest}:{items:ScheduleView[];servantId:string;onConfirm:(s:ScheduleView,status:"confirmed"|"declined")=>void;onRequest:(s:ScheduleView,kind:"replacement"|"swap")=>void}){
 const grouped=[...new Map(items.map(s=>[s.location_id,{id:s.location_id,name:s.location_name}])).values()];
 return <section className="my-upcoming-panel"><div className="my-upcoming-panel-head"><div><h3>My upcoming serving assignments</h3><p className="subtle">Confirm your upcoming service or request a replacement or swap.</p></div><span>{items.length} upcoming</span></div>{!items.length?<p className="my-upcoming-empty">You have no upcoming published assignments.</p>:grouped.map(location=><div className="my-upcoming-location" key={location.id}><h4>{location.name}</h4><div className="my-upcoming-list">{items.filter(s=>s.location_id===location.id).map(s=>{const own=s.assignments.find(a=>a.servant_id===servantId);return <article className="my-upcoming-item" key={s.id}><div className="my-upcoming-info"><b>{fmtDate(s.service_date)} · {s.service_name}</b><span>{shortTime(s.start_time)}–{shortTime(s.end_time)} · Your role: {own?.role??"Assigned"}</span><small>Confirmation: {own?.confirmation_status??"pending"}</small></div><div className="my-upcoming-actions"><button className="btn tiny primary" onClick={()=>onConfirm(s,"confirmed")}>Accept</button><button className="btn tiny secondary" onClick={()=>onRequest(s,"swap")}>Request swap</button><button className="btn tiny secondary" onClick={()=>onRequest(s,"replacement")}>Request replacement</button></div></article>;})}</div></div>)}</section>;
}

export function MyScheduleSummary({daysServed,upcoming,servantId}:{daysServed:number;upcoming:ScheduleView|null;servantId:string}){
 const myRole=upcoming?.assignments.find(a=>a.servant_id===servantId)?.role;
 return <section className="my-schedule-summary">
  <div className="my-days-card"><span className="my-schedule-label">YOUR SERVING DAYS</span><strong>{daysServed}</strong><small>Unique days served in the last 30 days</small></div>
  <div className="my-next-card"><div className="my-next-heading"><CalendarDays size={17}/><b>My next serving schedule</b></div>
   {upcoming?<><div className="my-next-date">{fmtDate(upcoming.service_date)}</div><div className="my-next-detail"><b>{upcoming.location_name}</b><span>{upcoming.service_name} · {shortTime(upcoming.start_time)}–{shortTime(upcoming.end_time)}</span><span>Your role: <b>{myRole??"Assigned"}</b></span></div></>:<p className="my-next-empty">No upcoming published assignment.</p>}
  </div>
 </section>;
}

export function DailySummary({date,items,isAdmin=true}:{date:string;items:ScheduleView[];isAdmin?:boolean}){
 const locations=[...new Map(items.map(item=>[item.location_id,{id:item.location_id,name:item.location_name}])).values()];
 const assigned=items.reduce((n,item)=>n+item.assignments.filter(a=>a.servant_id&&a.role!=="Assistant").length,0);
 const required=items.length*2;
 const servantLocations=new Map<string,Set<string>>();
 for(const item of items)for(const assignment of item.assignments){if(!assignment.servant_id)continue;const set=servantLocations.get(assignment.servant_id)??new Set<string>();set.add(item.location_id);servantLocations.set(assignment.servant_id,set);}
 const crossLocationConflicts=[...servantLocations.entries()].filter(([,ids])=>ids.size>1).map(([id])=>items.flatMap(i=>i.assignments.filter(a=>a.servant_id===id).map(a=>a.servant_name))[0]);
 const dayDate=new Date(`${date}T12:00:00`);
 const dayLabel=dayDate.toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"});
 const compactDayLabel=dayDate.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric",year:"numeric"});
 return <details className="daily-card" open>
  <summary className="daily-head"><div className="daily-head-copy"><div className="daily-date"><span className="daily-date-full">{dayLabel}</span><span className="daily-date-compact">{compactDayLabel}</span></div><div className="daily-subtitle">{items.length} services · {locations.length} {locations.length===1?"location":"locations"}</div></div><div className="daily-head-right">{isAdmin&&<div className={`coverage-pill ${assigned>=required?"complete":"pending"}`}>{assigned}/{required} required roles filled</div>}<ChevronDown size={19}/></div></summary>
  {crossLocationConflicts.length>0&&<div className="day-conflict-warning"><AlertTriangle size={16}/><span><b>Cross-location conflict:</b> {crossLocationConflicts.join(", ")} assigned at more than one church location on this date.</span></div>}
  <div className="daily-locations">{locations.map(location=>{
   const services=items.filter(item=>item.location_id===location.id).sort((a,b)=>a.start_time.localeCompare(b.start_time));
   const showAssistant=services.some(item=>item.status!=="published"||item.assignments.some(a=>a.role==="Assistant"));
   const roles:Role[]=showAssistant?["FOH","Monitor","Assistant"]:["FOH","Monitor"];
   const columns=`minmax(150px,1.15fr) repeat(${roles.length},minmax(0,1fr))`;
   return <section className="daily-location" key={location.id}>
    <div className="daily-location-name" style={{"--church-band":dailyChurchColor(location.name)} as CSSProperties}><b>{location.name}</b><span>{services.length} {services.length===1?"service":"services"}</span></div>
    <div className="daily-service-table">
     <div className="daily-service-table-head" style={{gridTemplateColumns:columns}}><span>Service / time</span>{roles.map(role=><span key={role}>{role}</span>)}</div>
     {services.map(item=>{const category=dailyServiceCategory(item.service_name);const foh=item.assignments.find(a=>a.role==="FOH");return <div className={`daily-service-row role-count-${roles.length} category-${category}`} key={item.id} style={{gridTemplateColumns:columns,"--service-category-tint":category==="vss"?DAILY_CATEGORY_TINTS.vss:category==="aog"?DAILY_CATEGORY_TINTS.aog:"transparent","--foh-team-tint":dailyTeamTint(foh?.servant_id,foh?.servant_name)??"transparent"} as CSSProperties}>
      <div className="daily-service-identity"><b>{item.service_name}</b><small>{shortTime(item.start_time)}–{shortTime(item.end_time)}</small></div>
      <div className={`daily-role-cells role-count-${roles.length}`}>
       {roles.map(role=>{const assignment=item.assignments.find(a=>a.role===role);const missing=!assignment&&role!=="Assistant";const teamTint=dailyTeamTint(assignment?.servant_id,assignment?.servant_name);return <div className={`daily-assignee-cell ${missing?"missing":role==="Assistant"&&!assignment?"optional":""}`} key={role} style={teamTint?{"--role-team-tint":teamTint} as CSSProperties:undefined}><small>{role}</small><span>{assignment?.servant_name??(role==="Assistant"?"Optional":"Unassigned")}</span></div>;})}
      </div>
     </div>;})}
    </div>
   </section>;
  })}</div>
 </details>;
}

export function ScheduleCard({item,isAdmin,onEdit,onDelete,onPublish,myServantId,onConfirm,onRequest}:{item:ScheduleView;isAdmin:boolean;onEdit:()=>void;onDelete:()=>void;onPublish:()=>void;myServantId:string;onConfirm:(status:"confirmed"|"declined")=>void;onRequest:(kind:"replacement"|"swap")=>void}){
 const own=item.assignments.find(a=>a.servant_id===myServantId);
 return <details className="schedule-card" open><summary className="schedule-card-summary"><div><div className="date-text">{fmtDate(item.service_date)} {isAdmin&&<span className={`status-chip ${item.status||"draft"}`}>{item.status||"draft"}</span>}</div><div className="location-text">{item.location_name}</div><div className="service-title">{item.service_name}</div><div className="time-text">{shortTime(item.start_time)} – {shortTime(item.end_time)}</div></div><ChevronDown size={19}/></summary>
  <div className="role-grid">{(item.status==="published"&&!item.assignments.some(a=>a.role==="Assistant")?["FOH","Monitor"]:ROLES).map(r=>{const a=item.assignments.find(x=>x.role===r);return <div className={`role-box ${r==="Assistant"?"optional":""}`} key={r}><small>{r}{r==="Assistant"?" · optional":""}</small><b>{a?.servant_name??"Unassigned"}</b></div>;})}</div>
  {!isAdmin&&!!own&&<div className="servant-card-actions"><div className="confirmation-line">Your confirmation: <b>{own?.confirmation_status||"pending"}</b></div><button className="btn tiny primary" onClick={()=>onConfirm("confirmed")}>Confirm</button><button className="btn tiny secondary" onClick={()=>onConfirm("declined")}>Decline</button><button className="btn tiny secondary" onClick={()=>onRequest("replacement")}>Request replacement</button><button className="btn tiny secondary" onClick={()=>onRequest("swap")}>Request swap</button></div>}
  {isAdmin&&<div className="card-actions"><button className="btn tiny secondary" onClick={onEdit}><Pencil size={13}/> Edit</button><button className="btn tiny secondary" onClick={onPublish}>{item.status==="published"?"Unpublish":"Publish"}</button><button className="btn tiny danger" onClick={onDelete}><Trash2 size={13}/> Delete</button></div>}
 </details>;
}

