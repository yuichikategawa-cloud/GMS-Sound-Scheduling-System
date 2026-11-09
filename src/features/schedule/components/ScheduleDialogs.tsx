import { useState } from "react";
import type { FormEvent } from "react";
import { X, AlertTriangle, Info, CheckCircle2, ShieldCheck } from "lucide-react";
import type { Location, Role, ScheduleView, Servant } from "../../../types";
import { today, fmtDate, shortTime } from "../../../shared/formatters";
import { ROLES } from "../constants";

export function DirectSwapModal({source,schedules,servantId,onClose,onSubmit}:{source:ScheduleView;schedules:ScheduleView[];servantId:string;onClose:()=>void;onSubmit:(scheduleId:string,assignmentId:string,details:string)=>void}){
 const candidates=schedules.filter(s=>s.status==="published"&&s.id!==source.id&&s.service_date!==source.service_date&&s.assignments.some(a=>a.servant_id&&a.servant_id!==servantId));
 const [targetId,setTargetId]=useState("");const [assignmentId,setAssignmentId]=useState("");const [details,setDetails]=useState("");
 const selected=candidates.find(s=>s.id===targetId);const eligible=selected?.assignments.filter(a=>a.servant_id&&a.servant_id!==servantId)??[];
 return <div className="modal-backdrop"><section className="modal-card swap-modal"><div className="modal-head"><div><h2>Request a schedule swap</h2><p className="subtle">Choose another servant's published assignment, even on a different date.</p></div><button className="icon-btn" onClick={onClose}><X/></button></div><div className="swap-source"><b>Your assignment</b><span>{fmtDate(source.service_date)} · {source.location_name} · {source.service_name}</span></div><label>Swap with service<select value={targetId} onChange={e=>{setTargetId(e.target.value);setAssignmentId("");}}><option value="">Select another date and service</option>{candidates.map(s=><option key={s.id} value={s.id}>{fmtDate(s.service_date)} · {s.location_name} · {s.service_name}</option>)}</select></label><label>Servant assignment<select value={assignmentId} onChange={e=>setAssignmentId(e.target.value)} disabled={!selected}><option value="">Select servant</option>{eligible.map(a=><option key={a.id} value={a.id}>{a.servant_name} · {a.role}</option>)}</select></label><label>Note (optional)<textarea value={details} onChange={e=>setDetails(e.target.value)} placeholder="Add a note for the administrator"/></label><div className="modal-actions"><button className="btn secondary" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!targetId||!assignmentId} onClick={()=>onSubmit(targetId,assignmentId,details)}>Submit swap request</button></div></section></div>;
}

export function ScheduleModal({locations,servants,availability,preferences,schedules,editing,onClose,onSave,error}:{locations:Location[];servants:Servant[];availability:any[];preferences:any[];schedules:ScheduleView[];editing:ScheduleView|null;onClose:()=>void;onSave:(e:FormEvent<HTMLFormElement>)=>void;error:string}){
 const [serviceDate,setServiceDate]=useState(editing?.service_date??today());
 const [locationId,setLocationId]=useState(editing?.location_id??locations[0]?.id??"");
 const [serviceName,setServiceName]=useState(editing?.service_name??"");
 const [startTime,setStartTime]=useState(shortTime(editing?.start_time??"09:00"));
 const [endTime,setEndTime]=useState(shortTime(editing?.end_time??"11:00"));
 const [roleSelections,setRoleSelections]=useState<Record<Role,string>>(()=>Object.fromEntries(ROLES.map(role=>[role,editing?.assignments.find(a=>a.role===role)?.servant_id??""])) as Record<Role,string>);
 const existing=(role:Role)=>editing?.assignments.find(a=>a.role===role)?.servant_id??"";
 const workloadDays=(servantId:string)=>new Set(schedules.filter(s=>s.service_date<serviceDate&&s.service_date>=new Date(new Date(`${serviceDate}T12:00:00`).getTime()-30*86400000).toLocaleDateString("en-CA")&&s.assignments.some(a=>a.servant_id===servantId)).map(s=>s.service_date)).size;
 const availabilityStatus=(servantId:string)=>availability.find(a=>a.servant_id===servantId&&a.service_date===serviceDate)?.status??"not submitted";
 const eligibilityNote=(servantId:string)=>{const prefs=preferences.filter(r=>r.servant_id===servantId&&r.active!==false&&(!r.effective_from||r.effective_from<=serviceDate)&&(!r.effective_until||r.effective_until>=serviceDate));const dow=new Date(`${serviceDate}T12:00:00`).getDay();const timeRules=prefs.filter(r=>r.rule_type==="allowed_time_window");const serviceRules=prefs.filter(r=>r.rule_type==="allowed_service_scope");const timeOk=!timeRules.length||timeRules.some(r=>(!r.days_of_week?.length||r.days_of_week.includes(dow))&&startTime>=String(r.start_time).slice(0,5)&&endTime<=String(r.end_time).slice(0,5));const serviceOk=!serviceRules.length||serviceRules.some(r=>r.location_id===locationId&&(!r.service_names?.length||r.service_names.includes(serviceName)));return !timeOk?" · OUTSIDE ALLOWED TIME":!serviceOk?" · SERVICE NOT ALLOWED":"";};
 const roleFeedback=(role:Role,servantId:string)=>{
  if(!servantId)return null;
  const blockers:string[]=[];const warnings:string[]=[];
  const status=availabilityStatus(servantId);
  if(status==="unavailable")blockers.push("Marked unavailable on this date");
  else if(status==="prefer_not")warnings.push("Prefers not to serve on this date");
  if(ROLES.some(other=>other!==role&&roleSelections[other]===servantId))blockers.push("Already selected for another role in this service");
  const toMinutes=(value:string)=>Number(value.slice(0,2))*60+Number(value.slice(3,5));
  const otherChurch=schedules.find(item=>item.id!==editing?.id&&item.service_date===serviceDate&&item.location_id!==locationId&&item.assignments.some(a=>a.servant_id===servantId));
  if(otherChurch)blockers.push(`Already assigned at ${otherChurch.location_name} on this date`);
  const sameChurchSameDay=schedules.filter(item=>item.id!==editing?.id&&item.service_date===serviceDate&&item.location_id===locationId&&item.assignments.some(a=>a.servant_id===servantId));
  const overlap=sameChurchSameDay.find(item=>toMinutes(startTime)<toMinutes(item.end_time)&&toMinutes(endTime)>toMinutes(item.start_time));
  if(overlap)blockers.push(`Overlaps ${overlap.service_name} at this church`);
  const prefs=preferences.filter(rule=>rule.servant_id===servantId&&rule.active!==false&&(!rule.effective_from||rule.effective_from<=serviceDate)&&(!rule.effective_until||rule.effective_until>=serviceDate));
  const dow=new Date(`${serviceDate}T12:00:00`).getDay();
  const timeRules=prefs.filter(rule=>rule.rule_type==="allowed_time_window");
  const scopeRules=prefs.filter(rule=>rule.rule_type==="allowed_service_scope");
  if(timeRules.length&&!timeRules.some(rule=>(!rule.days_of_week?.length||rule.days_of_week.includes(dow))&&startTime>=String(rule.start_time).slice(0,5)&&endTime<=String(rule.end_time).slice(0,5)))blockers.push("Outside saved serving day/time restrictions");
  if(scopeRules.length&&!scopeRules.some(rule=>rule.location_id===locationId&&(!rule.service_names?.length||rule.service_names.includes(serviceName))))blockers.push("Outside saved church/service restrictions");
  const days=workloadDays(servantId);
  if(days>=5)warnings.push(`High workload: ${days} serving days in the previous 30 days`);
  return {blockers,warnings,status};
 };
 return <div className="modal-backdrop"><form className="modal-card" onSubmit={onSave}><div className="modal-head"><div><h2>{editing?"Edit service assignment":"Add service assignment"}</h2><p className="subtle">Add a regular or special service on any date, including weekdays. FOH and Monitor are required; Assistant is optional.</p></div><button type="button" className="icon-btn" onClick={onClose}><X/></button></div>
  <div className="form-grid"><label>Date<input name="service_date" type="date" required value={serviceDate} onChange={e=>setServiceDate(e.target.value)}/></label><label>Location<select name="location_id" required value={locationId} onChange={e=>setLocationId(e.target.value)}>{locations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
   <label className="wide">Service name<input name="service_name" required value={serviceName} onChange={e=>setServiceName(e.target.value)} placeholder="e.g. Special Service, Christmas, Prayer Meeting"/></label><label>Start time<input name="start_time" type="time" required value={startTime} onChange={e=>setStartTime(e.target.value)}/></label><label>End time<input name="end_time" type="time" required value={endTime} onChange={e=>setEndTime(e.target.value)}/></label>
   {ROLES.map(r=>{const selectedId=roleSelections[r]??"";const feedback=roleFeedback(r,selectedId);return <label className="wide role-assignment-field" key={r}>{r}{r==="Assistant"?" (optional)":" (required)"}<select name={r} required={r!=="Assistant"} value={selectedId} onChange={e=>setRoleSelections(current=>({...current,[r]:e.target.value}))}><option value="">{r==="Assistant"?"Not assigned":"Select servant"}</option>{servants.map(p=>{const av=availabilityStatus(p.id);const days=workloadDays(p.id);const label=av==="unavailable"?" · UNAVAILABLE":av==="prefer_not"?" · PREFER NOT TO SERVE":av==="available"?" · Available":"";const eligibility=eligibilityNote(p.id);return <option key={p.id} value={p.id}>{p.full_name}{label}{eligibility} · {days} days served in prior 30d</option>;})}</select>{feedback?.blockers.length?<small className="assignment-field-feedback blocked"><AlertTriangle size={13}/><span>{feedback.blockers.join(" · ")}</span></small>:feedback?.warnings.length?<small className="assignment-field-feedback warning"><Info size={13}/><span>{feedback.warnings.join(" · ")}</span></small>:feedback?.status==="available"?<small className="assignment-field-feedback clear"><CheckCircle2 size={13}/><span>Available on this date</span></small>:null}</label>;})}
  </div><div className="availability-guidance"><div className="availability-guidance-title"><ShieldCheck size={17}/><b>Assignment guidance</b></div><p>Servant options show their availability and workload over the previous 30 days.</p><p>Unavailable servants and high-workload selections are checked again before saving.</p></div>{error&&<div className="schedule-error" role="alert"><AlertTriangle size={18}/><span>{error}</span></div>}<div className="modal-actions"><button type="button" className="btn secondary" onClick={onClose}>Cancel</button><button className="btn primary">Save assignment</button></div>
 </form></div>;
}

