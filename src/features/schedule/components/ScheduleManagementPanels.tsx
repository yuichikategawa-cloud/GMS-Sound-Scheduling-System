import { useEffect, useState } from "react";
import { Church, Pencil, Trash2, X, ChevronDown, AlertTriangle, Info, EyeOff, Send, CheckCircle2, CalendarDays } from "lucide-react";
import type { Location, ScheduleView, Servant } from "../../../types";
import { today, fmtDate, shortTime } from "../../../shared/formatters";
import { ROLES } from "../constants";

export function AssignmentOverview({schedules,requests,servants,availability}:{schedules:ScheduleView[];requests:any[];servants:Servant[];availability:any[]}){
 const upcoming=schedules.filter(s=>s.service_date>=today());
 const required=upcoming.length*2;
 const filled=upcoming.reduce((n,s)=>n+s.assignments.filter(a=>(a.role==="FOH"||a.role==="Monitor")&&!!a.servant_id).length,0);
 const people=new Set(upcoming.flatMap(s=>s.assignments.filter(a=>a.servant_id).map(a=>a.servant_id)));
 const groups=[...new Map(upcoming.map(s=>[s.location_id,{id:s.location_id,name:s.location_name}])).values()];
 const incomplete=upcoming.filter(s=>!["FOH","Monitor"].every(role=>s.assignments.some(a=>a.role===role&&a.servant_id)));
 const pending=requests.filter(r=>r.status==="pending").length;
 const awaiting=upcoming.reduce((n,s)=>n+s.assignments.filter(a=>a.servant_id&&a.confirmation_status!=="confirmed").length,0);
 const crossChurch=upcoming.filter(s=>s.assignments.some(a=>a.servant_id&&upcoming.some(other=>other.id!==s.id&&other.service_date===s.service_date&&other.location_id!==s.location_id&&other.assignments.some(x=>x.servant_id===a.servant_id))));
 const unavailable=upcoming.flatMap(s=>s.assignments.filter(a=>a.servant_id&&availability.some(v=>v.servant_id===a.servant_id&&v.service_date===s.service_date&&v.status==="unavailable")).map(a=>({name:a.servant_name,service:s.service_name,date:s.service_date})));
 const validationCount=crossChurch.length+unavailable.length;
 const thirtyDaysAgo=new Date(Date.now()-30*86400000).toLocaleDateString("en-CA");
 const workload=servants.filter(p=>p.active).map(p=>({id:p.id,name:p.full_name,days:new Set(schedules.filter(s=>s.service_date>=thirtyDaysAgo&&s.service_date<=today()&&s.assignments.some(a=>a.servant_id===p.id)).map(s=>s.service_date)).size})).sort((a,b)=>b.days-a.days);
 const high=workload.filter(p=>p.days>=5);
 const coverage=required?Math.round(filled/required*100):100;
 return <section className="assignment-overview-card">
  <div className="assignment-overview-heading"><div><h2>Assignment overview</h2><p className="subtle">Coverage, confirmations and scheduling health across all church locations.</p></div><span className={`assignment-coverage-pill ${coverage<70?"needs-attention":""}`}>{coverage}% covered</span></div>
  <div className="assignment-overview-stats">
   <div><small>Upcoming services</small><b>{upcoming.length}</b></div>
   <div><small>Required roles filled</small><b>{filled} / {required}</b></div>
   <div><small>Unassigned required roles</small><b>{Math.max(0,required-filled)}</b></div>
   <div><small>Servants assigned</small><b>{people.size}</b></div>
  </div>
  <div className="assignment-overview-locations">{groups.map(g=>{const services=upcoming.filter(s=>s.location_id===g.id);const count=services.reduce((n,s)=>n+s.assignments.filter(a=>(a.role==="FOH"||a.role==="Monitor")&&!!a.servant_id).length,0);return <div key={g.id}><span>{g.name}</span><b>{count}/{services.length*2} required roles</b></div>;})}</div>
  <div className="assignment-overview-ops">
   <div><small>Incomplete services</small><b className={incomplete.length?"attention-number":""}>{incomplete.length}</b></div>
   <div><small>Pending requests</small><b>{pending}</b></div>
   <div><small>Awaiting confirmation</small><b>{awaiting}</b></div>
   <div><small>Validation flags</small><b className={validationCount?"attention-number":""}>{validationCount}</b></div>
  </div>
  {(incomplete.length>0||crossChurch.length>0||unavailable.length>0)&&<div className="assignment-overview-alerts">
   {incomplete.length>0&&<div className="control-center-alert"><AlertTriangle size={15}/><span>{incomplete.length} service(s) need FOH or Monitor coverage.</span></div>}
   {crossChurch.length>0&&<div className="control-center-alert"><AlertTriangle size={15}/><span>{crossChurch.length} service(s) have a servant assigned at another church on the same day.</span></div>}
   {unavailable.length>0&&<div className="control-center-alert"><AlertTriangle size={15}/><span>{unavailable.length} assignment(s) conflict with submitted unavailability: {unavailable.slice(0,4).map(x=>`${x.name} · ${x.service} · ${fmtDate(x.date)}`).join("; ")}{unavailable.length>4?` and ${unavailable.length-4} more`:""}.</span></div>}
  </div>}
  <details className="assignment-workload-detail"><summary><span><b>Fair workload · last 30 days</b><small>Calendar days served per active servant; multiple services on the same day count once.</small></span><span className="workload-detail-status">{high.length?`${high.length} need review`:"No workload warnings"}</span><ChevronDown size={17}/></summary>
   {high.length===0?<p className="workload-status">No servants currently exceed the 5-day workload warning threshold.</p>:<div className="workload-list">{high.slice(0,8).map(p=><div className="workload-row" key={p.id}><span>{p.name}</span><b>{p.days} days</b><em>High frequency</em></div>)}</div>}
  </details>
 </section>;
}

export function BulkAssignmentCenter({schedules,servants,availability,preferences,disabled,onApply,onEditSchedule,onPublishSchedule,onDeleteSchedule}:{schedules:ScheduleView[];servants:Servant[];availability:any[];preferences:any[];disabled:boolean;onApply:(rows:any[])=>Promise<boolean>;onEditSchedule:(schedule:ScheduleView)=>void;onPublishSchedule:(schedule:ScheduleView)=>void;onDeleteSchedule:(schedule:ScheduleView)=>void}){
 const upcoming=schedules.filter(s=>s.service_date>=today()).sort((a,b)=>a.service_date.localeCompare(b.service_date)||a.start_time.localeCompare(b.start_time));
 const [visibleLimit,setVisibleLimit]=useState(60);
 const listedUpcoming = upcoming.slice(0, visibleLimit);
 const [selected,setSelected]=useState<string[]>([]);
 const [selectionError,setSelectionError]=useState("");
 const [draft,setDraft]=useState<Record<string,Record<string,string>>>({});
 const [sourceDate,setSourceDate]=useState("");
 const [targetDate,setTargetDate]=useState("");
 const [preview,setPreview]=useState(false);
 const [acceptWorkload,setAcceptWorkload]=useState(false);
 useEffect(()=>{
  // Rehydrate draft values whenever the persisted schedule data is refreshed.
  // This prevents a servant removed through the bulk editor from reappearing
  // in stale local dropdown state after the database save succeeds.
  setDraft(Object.fromEntries(upcoming.map(s=>[
   s.id,
   Object.fromEntries(ROLES.map(role=>[role,s.assignments.find(a=>a.role===role)?.servant_id??""]))
  ])));
  setSelected(current=>current.filter(id=>upcoming.some(s=>s.id===id)));
 },[schedules]);
 const toggle=(id:string)=>{setAcceptWorkload(false);setSelectionError("");setSelected(v=>v.includes(id)?v.filter(x=>x!==id):[...v,id]);};
 const setRole=(scheduleId:string,role:string,servantId:string)=>{setAcceptWorkload(false);setDraft(v=>({...v,[scheduleId]:{...(v[scheduleId]??{}),[role]:servantId}}));};
 const hasPendingRowChanges=(schedule:ScheduleView)=>ROLES.some(role=>(draft[schedule.id]?.[role]??"")!==(schedule.assignments.find(a=>a.role===role)?.servant_id??""));
 const scheduleWithDraftAssignments=(schedule:ScheduleView):ScheduleView=>({
  ...schedule,
  assignments:ROLES.flatMap(role=>{
   const servantId=draft[schedule.id]?.[role]??"";
   if(!servantId)return [];
   const existing=schedule.assignments.find(a=>a.role===role);
   const person=servants.find(p=>p.id===servantId);
   return [{...(existing??{}),role,servant_id:servantId,servant_name:person?.full_name??existing?.servant_name??"Unknown servant"}];
  })
 });
 const handleRowPublish=async(schedule:ScheduleView)=>{
  if(!hasPendingRowChanges(schedule)){await onPublishSchedule(schedule);return;}
  const blocking=ROLES.flatMap(role=>{
   const servantId=draft[schedule.id]?.[role]??"";
   return servantId?assignmentFeedback(schedule,role,servantId).blockers:[];
  });
  const caution=ROLES.flatMap(role=>{
   const servantId=draft[schedule.id]?.[role]??"";
   return servantId?assignmentFeedback(schedule,role,servantId).warnings:[];
  });
  if(blocking.length||(caution.length&&!acceptWorkload)){
   setSelected(current=>current.includes(schedule.id)?current:[...current,schedule.id]);
   setPreview(true);
   return;
  }
  const serviceRows=ROLES.map(role=>({schedule_id:schedule.id,role,servant_id:draft[schedule.id]?.[role]||null}));
  const saved=await onApply(serviceRows);
  if(!saved)return;
  // Pass the staged assignments to the publisher so required-role checks use
  // the just-saved values rather than the stale pre-edit schedule snapshot.
  await onPublishSchedule(scheduleWithDraftAssignments(schedule));
 };
 const assignmentFeedback=(schedule:ScheduleView,role:string,servantId:string)=>{
  const blockers:string[]=[];const warnings:string[]=[];
  const person=servants.find(p=>p.id===servantId);
  const status=availability.find(a=>a.servant_id===servantId&&a.service_date===schedule.service_date)?.status;
  if(status==="unavailable")blockers.push("Marked unavailable on this date");
  else if(status==="prefer_not")warnings.push("Prefers not to serve on this date");
  if(ROLES.some(other=>other!==role&&draft[schedule.id]?.[other]===servantId))blockers.push("Already selected for another role in this service");
  const otherHasServant=(other:ScheduleView)=>ROLES.some(otherRole=>{
   const staged=draft[other.id]?.[otherRole];
   const original=other.assignments.find(a=>a.role===otherRole)?.servant_id??"";
   return (staged??original)===servantId;
  });
  const otherChurch=upcoming.find(other=>other.id!==schedule.id&&other.service_date===schedule.service_date&&other.location_id!==schedule.location_id&&otherHasServant(other));
  if(otherChurch)blockers.push(`Already assigned at ${otherChurch.location_name} on this date`);
  const toMinutes=(time:string)=>Number(String(time).slice(0,2))*60+Number(String(time).slice(3,5));
  const sameChurchSameDay=upcoming.filter(other=>other.id!==schedule.id&&other.service_date===schedule.service_date&&other.location_id===schedule.location_id&&otherHasServant(other));
  const overlap=sameChurchSameDay.find(other=>toMinutes(schedule.start_time)<toMinutes(other.end_time)&&toMinutes(schedule.end_time)>toMinutes(other.start_time));
  if(overlap)blockers.push(`Overlaps ${overlap.service_name} at this church`);
  const prefs=preferences.filter(rule=>rule.servant_id===servantId&&rule.active!==false&&(!rule.effective_from||rule.effective_from<=schedule.service_date)&&(!rule.effective_until||rule.effective_until>=schedule.service_date));
  const dow=new Date(`${schedule.service_date}T12:00:00`).getDay();
  const timeRules=prefs.filter(rule=>rule.rule_type==="allowed_time_window");
  const scopeRules=prefs.filter(rule=>rule.rule_type==="allowed_service_scope");
  if(timeRules.length&&!timeRules.some(rule=>(!rule.days_of_week?.length||rule.days_of_week.includes(dow))&&shortTime(schedule.start_time)>=String(rule.start_time).slice(0,5)&&shortTime(schedule.end_time)<=String(rule.end_time).slice(0,5)))blockers.push("Outside saved serving day/time restrictions");
  if(scopeRules.length&&!scopeRules.some(rule=>rule.location_id===schedule.location_id&&(!rule.service_names?.length||rule.service_names.includes(schedule.service_name))))blockers.push("Outside saved church/service restrictions");
  const from=new Date(`${schedule.service_date}T12:00:00`);from.setDate(from.getDate()-30);const fromDate=from.toLocaleDateString("en-CA");
  const days=new Set(schedules.filter(item=>item.service_date>=fromDate&&item.service_date<schedule.service_date&&item.assignments.some(a=>a.servant_id===servantId)).map(item=>item.service_date)).size;
  if(days>=5)warnings.push(`High workload: ${days} serving days in the previous 30 days`);
  return {personName:person?.full_name??"Servant",blockers,warnings,status};
 };
 const copyPrevious=()=>{
  if(!sourceDate||!targetDate)return;
  const source=upcoming.filter(s=>s.service_date===sourceDate);
  const target=upcoming.filter(s=>s.service_date===targetDate);
  let copied=0;
  setDraft(current=>{
   const next={...current};
   for(const targetService of target){
    const sourceService=source.find(x=>x.location_id===targetService.location_id&&x.service_name===targetService.service_name);
    if(!sourceService)continue;
    next[targetService.id]={...(next[targetService.id]??{}),...Object.fromEntries(ROLES.map(role=>[role,sourceService.assignments.find(a=>a.role===role)?.servant_id??""]))};
    copied++;
   }
   return next;
  });
  const matchingTarget = target.filter(t=>source.some(x=>x.location_id===t.location_id&&x.service_name===t.service_name));
  const lastTargetIndex = matchingTarget.reduce((max,service)=>Math.max(max,upcoming.findIndex(item=>item.id===service.id)),-1);
  if(lastTargetIndex>=0)setVisibleLimit(current=>Math.max(current,lastTargetIndex+1));
  setSelected(current=>[...new Set([...current,...matchingTarget.map(t=>t.id)])]);
  setPreview(false);
 };
 const rows=selected.flatMap(id=>ROLES.map(role=>({schedule_id:id,role,servant_id:draft[id]?.[role]||null})));
 const conflicts=selected.flatMap(id=>{
  const schedule=upcoming.find(s=>s.id===id);if(!schedule)return [];
  return ROLES.flatMap(role=>{
   const servantId=draft[id]?.[role];if(!servantId)return [];
   const person=servants.find(x=>x.id===servantId);
   const unavailable=availability.some(a=>a.servant_id===servantId&&a.service_date===schedule.service_date&&a.status==="unavailable");
   const duplicate=ROLES.some(other=>other!==role&&draft[id]?.[other]===servantId);
   const otherHasServant=(other:ScheduleView)=>ROLES.some(otherRole=>(draft[other.id]?.[otherRole]??other.assignments.find(a=>a.role===otherRole)?.servant_id??"")===servantId);
   const cross=upcoming.some(other=>other.id!==id&&other.service_date===schedule.service_date&&other.location_id!==schedule.location_id&&otherHasServant(other));
   const prefs=preferences.filter(p=>p.servant_id===servantId&&p.active!==false&&(!p.effective_from||p.effective_from<=schedule.service_date)&&(!p.effective_until||p.effective_until>=schedule.service_date));
   const dow=new Date(`${schedule.service_date}T12:00:00`).getDay();
   const timeRules=prefs.filter(p=>p.rule_type==="allowed_time_window");
   const scopeRules=prefs.filter(p=>p.rule_type==="allowed_service_scope");
   const timeBlocked=timeRules.length>0&&!timeRules.some(p=>(!p.days_of_week?.length||p.days_of_week.includes(dow))&&shortTime(schedule.start_time)>=String(p.start_time).slice(0,5)&&shortTime(schedule.end_time)<=String(p.end_time).slice(0,5));
   const scopeBlocked=scopeRules.length>0&&!scopeRules.some(p=>p.location_id===schedule.location_id&&(!p.service_names?.length||p.service_names.includes(schedule.service_name)));
   const overlapping=upcoming.some(other=>other.id!==id&&other.service_date===schedule.service_date&&other.location_id===schedule.location_id&&otherHasServant(other)&&Number(schedule.start_time.slice(0,2))*60+Number(schedule.start_time.slice(3,5))<Number(other.end_time.slice(0,2))*60+Number(other.end_time.slice(3,5))&&Number(schedule.end_time.slice(0,2))*60+Number(schedule.end_time.slice(3,5))>Number(other.start_time.slice(0,2))*60+Number(other.start_time.slice(3,5)));
   const reason=unavailable?"Unavailable":duplicate?"Duplicate role":cross?"Other church assignment":overlapping?"Overlapping service":timeBlocked?"Time-window restriction":scopeBlocked?"Service/location restriction":"";
   return reason?[`${person?.full_name??"Servant"} · ${schedule.service_name} · ${reason}`]:[];
  });
 });
 const workloadWarnings=selected.flatMap(id=>{
  const schedule=upcoming.find(s=>s.id===id);if(!schedule)return [];
  return ROLES.flatMap(role=>{
   const servantId=draft[id]?.[role];if(!servantId)return [];
   const from=new Date(`${schedule.service_date}T12:00:00`);from.setDate(from.getDate()-30);const fromDate=from.toLocaleDateString("en-CA");
   const days=new Set(schedules.filter(x=>x.service_date>=fromDate&&x.service_date<schedule.service_date&&x.assignments.some(a=>a.servant_id===servantId)).map(x=>x.service_date)).size;
   const personName=servants.find(x=>x.id===servantId)?.full_name??"Servant";
   const warnings:string[]=[];
   if(days>=5)warnings.push(`${personName} already served ${days} days in the previous 30 days`);
   if(availability.some(a=>a.servant_id===servantId&&a.service_date===schedule.service_date&&a.status==="prefer_not"))warnings.push(`${personName} prefers not to serve on ${fmtDate(schedule.service_date)}`);
   return warnings;
  });
 });
 const churchGroups=[...new Map(listedUpcoming.map(s=>[s.location_id,{id:s.location_id,name:s.location_name}])).values()];
 const commit=async()=>{if(!selected.length)return;const ok=await onApply(rows);if(ok){setSelected([]);setPreview(false);}};
 return <details className="bulk-assignment-center bulk-assignment-collapsible">
  <summary className="bulk-assignment-summary"><div className="bulk-assignment-heading"><div><h2>Bulk Assignment Center</h2><p className="subtle">Edit multiple service assignments, copy a previous weekend and review conflicts before applying.</p></div><span className="bulk-selected-count">{selected.length} selected</span></div><ChevronDown size={19}/></summary><div className="bulk-assignment-content">
  <div className="bulk-copy-panel"><div><b>Copy previous weekend</b><small>Copy matching church and service names into another weekend. Review every copied assignment before applying.</small></div><div className="bulk-copy-controls"><label>From Saturday<input type="date" value={sourceDate} onChange={e=>setSourceDate(e.target.value)}/></label><label>To Saturday<input type="date" value={targetDate} onChange={e=>setTargetDate(e.target.value)}/></label><button className="btn secondary" disabled={!sourceDate||!targetDate||disabled} onClick={copyPrevious}>Copy assignments</button></div></div>
  <div className="bulk-matrix-toolbar"><div className="bulk-matrix-heading-copy"><b>Assignment distribution matrix</b><small>Use the actions at the end of each row to edit, publish or delete an individual service.</small></div><div><button className="link-btn" onClick={()=>{setSelectionError("");setSelected(listedUpcoming.map(s=>s.id));}}>Select all listed</button><button className="link-btn" onClick={()=>{setSelectionError("");setSelected([]);}}>Clear selection</button></div></div>
  <div className="bulk-church-groups">{churchGroups.map(group=>{const services=listedUpcoming.filter(s=>s.location_id===group.id);const selectedHere=services.filter(s=>selected.includes(s.id)).length;return <details className="bulk-church-group" key={group.id}><summary><span><b>{group.name}</b><small>{services.length} services · {selectedHere} selected</small></span><div className="bulk-group-selection-actions"><button type="button" className="link-btn" onClick={e=>{e.preventDefault();e.stopPropagation();setSelected(v=>[...new Set([...v,...services.map(service=>service.id)])]);}}>Select all</button><button type="button" className="link-btn" disabled={selectedHere===0} onClick={e=>{e.preventDefault();e.stopPropagation();setSelected(v=>v.filter(id=>!services.some(service=>service.id===id)));}}>Clear selection</button></div><ChevronDown size={17}/></summary><div className="bulk-matrix-wrap"><table className="bulk-matrix"><thead><tr><th>Select</th><th>Service</th><th>Date / time</th><th>FOH</th><th>Monitor</th><th>Assistant</th><th>Actions</th></tr></thead><tbody>{services.map(s=><tr key={s.id}><td><input aria-label={`Select ${s.location_name} ${s.service_name}`} type="checkbox" checked={selected.includes(s.id)} onChange={()=>toggle(s.id)}/></td><td><b>{s.service_name}</b><small className={`bulk-matrix-status ${s.status==="published"?"is-published":"is-draft"}`}>{s.status==="published"?"Published":"Draft"}</small>{hasPendingRowChanges(s)&&<small className="bulk-matrix-pending">Unsaved assignment edits</small>}</td><td>{fmtDate(s.service_date)}<small>{shortTime(s.start_time)}–{shortTime(s.end_time)}</small></td>{ROLES.map(role=>{const servantId=draft[s.id]?.[role]??"";const feedback=servantId?assignmentFeedback(s,role,servantId):null;return <td key={role}><div className="bulk-assignment-cell"><select aria-label={`${role} for ${s.location_name} ${s.service_name}`} value={servantId} onChange={e=>setRole(s.id,role,e.target.value)}><option value="">Unassigned</option>{servants.filter(p=>p.active).map(p=>{const status=availability.find(a=>a.servant_id===p.id&&a.service_date===s.service_date)?.status;const marker=status==="unavailable"?" · UNAVAILABLE":status==="prefer_not"?" · PREFER NOT":status==="available"?" · Available":"";return <option key={p.id} value={p.id}>{p.full_name}{marker}</option>;})}</select>{feedback?.blockers.length?<small className="assignment-field-feedback blocked"><AlertTriangle size={12}/><span>{feedback.blockers.join(" · ")}</span></small>:feedback?.warnings.length?<small className="assignment-field-feedback warning"><Info size={12}/><span>{feedback.warnings.join(" · ")}</span></small>:feedback?.status==="available"?<small className="assignment-field-feedback clear"><CheckCircle2 size={12}/><span>Available on this date</span></small>:null}</div></td>;})}<td><div className="bulk-row-actions"><button type="button" className="bulk-row-action" title="Edit service" aria-label={`Edit ${s.service_name}`} onClick={()=>onEditSchedule(s)}><Pencil size={14}/></button><button type="button" className="bulk-row-action" disabled={disabled} title={hasPendingRowChanges(s)?`${s.status==="published"?"Save changes and unpublish":"Save changes and publish"} service`:(s.status==="published"?"Unpublish service":"Publish service")} aria-label={`${hasPendingRowChanges(s)?"Save changes and ": ""}${s.status==="published"?"Unpublish":"Publish"} ${s.service_name}`} onClick={()=>void handleRowPublish(s)}>{s.status==="published"?<EyeOff size={14}/>:<Send size={14}/>}</button><button type="button" className="bulk-row-action danger" title="Delete service" aria-label={`Delete ${s.service_name}`} onClick={()=>onDeleteSchedule(s)}><Trash2 size={14}/></button></div></td></tr>)}</tbody></table></div></details>;})}</div>
  {upcoming.length>0&&<div className="bulk-pagination"><span className="subtle">Showing {listedUpcoming.length} of {upcoming.length} upcoming services.</span>{listedUpcoming.length<upcoming.length&&<button type="button" className="btn secondary" disabled={disabled} onClick={()=>setVisibleLimit(current=>Math.min(upcoming.length,current+60))}>Load next 60 services</button>}</div>}
  {selectionError&&<div className="control-center-alert bulk-selection-error" role="alert">{selectionError}</div>}
  <div className="bulk-apply-footer"><span>{selected.length} services · {rows.length} role slots in the update</span><button className="btn primary" disabled={disabled} onClick={()=>{if(!selected.length){setSelectionError("Select at least one service before reviewing assignments.");return;}setSelectionError("");setPreview(true);}}>Review assignments</button></div>
  {preview&&<div className="bulk-preview-panel"><div className="bulk-preview-heading"><div><h3>Review bulk assignments</h3><p className="subtle">No assignments are changed until you confirm.</p></div><button className="icon-btn" onClick={()=>setPreview(false)}><X size={17}/></button></div><div className="bulk-preview-stats"><span><b>{selected.length}</b> services</span><span><b>{rows.filter(r=>r.servant_id).length}</b> assigned roles</span><span><b>{conflicts.length}</b> blocking conflicts</span><span><b>{workloadWarnings.length}</b> workload warnings</span></div>{conflicts.length>0?<div className="control-center-alert"><AlertTriangle size={16}/><span>{conflicts.slice(0,12).join("; ")}. Correct conflicts before applying.</span></div>:<p className="workload-status">No blocking availability, preference or scheduling conflicts detected. Database checks run again when saving.</p>}{workloadWarnings.length>0&&<div className="workload-warning"><b>Fairness warnings</b><p>{workloadWarnings.slice(0,8).join("; ")}</p><label><input type="checkbox" checked={acceptWorkload} onChange={e=>setAcceptWorkload(e.target.checked)}/> I reviewed these workload warnings and want to continue.</label></div>}<button className="btn primary" disabled={disabled||conflicts.length>0||(workloadWarnings.length>0&&!acceptWorkload)} onClick={()=>void commit()}>Confirm and apply assignments</button></div>}
 </div>
  </details>;
}

export function ChurchBulkActions({locations,disabled,onPublish,onUnpublish,onDelete}:{locations:Location[];disabled:boolean;onPublish:(id:string)=>void;onUnpublish:(id:string)=>void;onDelete:(id:string)=>void}){
 const [locationId,setLocationId]=useState("__all_churches__");
 useEffect(()=>{if(locationId!=="__all_churches__"&&locationId&&!locations.some(l=>l.id===locationId))setLocationId("__all_churches__");},[locations,locationId]);
 const allChurches=locationId==="__all_churches__";
 return <section className="church-bulk-actions"><div><b>Church-wide schedule actions</b><p className="subtle">Publish, unpublish or permanently delete schedules across one church or all church locations.</p></div><div className="church-bulk-controls"><label className="church-location-picker"><span>Church location</span><select value={locationId} onChange={e=>setLocationId(e.target.value)} disabled={!locations.length||disabled}><option value="__all_churches__">All churches</option>{locations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label><button className="btn primary" disabled={!locations.length||disabled} onClick={()=>onPublish(locationId)}>Publish all</button><button className="btn secondary" disabled={!locations.length||disabled} onClick={()=>onUnpublish(locationId)}>Unpublish all</button><button className="btn danger" disabled={!locations.length||disabled} title={allChurches?"Delete all schedules across every church":"Delete all schedules for this church"} onClick={()=>onDelete(locationId)}><Trash2 size={14}/> Delete all</button></div><small className="church-bulk-safety-note">Permanent deletion for one church or all churches requires typing “I do understand” and a second confirmation.</small></section>;
}

export function GeneratePanel({templates,locations,onGenerate,onAddTemplate,onDeleteTemplate}:{templates:any[];locations:Location[];onGenerate:(date:string,weeks:number,templateIds:string[],mode:"add"|"replace")=>void;onAddTemplate:(locationId:string,day:number,name:string,start:string,end:string)=>Promise<void>;onDeleteTemplate:(template:any)=>Promise<void>}){
 const [date,setDate]=useState(()=>{const d=new Date();d.setDate(d.getDate()+((6-d.getDay()+7)%7));return d.toLocaleDateString("en-CA");});
 const [weeks,setWeeks]=useState(1); const [mode,setMode]=useState<"add"|"replace">("add");
 const [showNewTemplate,setShowNewTemplate]=useState(false);
 const [newLocation,setNewLocation]=useState(locations[0]?.id??"");
 const [newDay,setNewDay]=useState(0); const [newName,setNewName]=useState("");
 const [newStart,setNewStart]=useState("09:00"); const [newEnd,setNewEnd]=useState("11:00");
 const [savingTemplate,setSavingTemplate]=useState(false); const [formError,setFormError]=useState("");
 const [selected,setSelected]=useState<string[]>(()=>templates.filter(t=>t.active!==false).map(t=>String(t.id)));
 useEffect(()=>setSelected(current=>current.filter(id=>templates.some(t=>String(t.id)===id)).concat(templates.filter(t=>t.active!==false&&!current.includes(String(t.id))).map(t=>String(t.id)))),[templates]);
 const toggle=(id:string)=>setSelected(v=>v.includes(id)?v.filter(x=>x!==id):[...v,id]);
 const dayName=(d:number)=>Number(d)===6?"Saturday":"Sunday";
 return <details className="generate-panel generate-panel-collapsible"><summary className="generate-panel-summary"><div className="generate-heading"><div><b>Bulk generate recurring weekend slots</b><p className="subtle">Choose the church services to generate and how existing matching slots should be handled.</p></div></div><ChevronDown className="generate-chevron" size={19}/></summary><div className="generate-panel-content">
  <div className="template-picker"><div className="template-picker-head"><b>Service templates</b><span>{selected.length} selected</span><button type="button" className="clear-btn" onClick={()=>setSelected(templates.filter(t=>t.active!==false).map(t=>String(t.id)))}>Select all</button><button type="button" className="clear-btn" onClick={()=>setSelected([])} disabled={selected.length===0}>Clear selection</button><button type="button" className="btn secondary template-add-btn" onClick={()=>setShowNewTemplate(v=>!v)}>{showNewTemplate?"Close":"＋ Add new service"}</button></div>
   {showNewTemplate&&<form className="new-template-form" onSubmit={async e=>{e.preventDefault();if(!newLocation||!newName.trim()||newStart>=newEnd)return;setSavingTemplate(true);setFormError("");try{await onAddTemplate(newLocation,newDay,newName.trim(),newStart,newEnd);setNewName("");setShowNewTemplate(false);}catch(error){setFormError(error instanceof Error?error.message:"Could not save service template.");}finally{setSavingTemplate(false);}}}>
    <label>Church location<select value={newLocation} onChange={e=>setNewLocation(e.target.value)} required>{locations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
    <label>Service day<select value={newDay} onChange={e=>setNewDay(Number(e.target.value))}><option value={6}>Saturday</option><option value={0}>Sunday</option></select></label>
    <label>Service name<input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="e.g. Service 4" required/></label>
    <label>Start time<input type="time" value={newStart} onChange={e=>setNewStart(e.target.value)} required/></label>
    <label>End time<input type="time" value={newEnd} onChange={e=>setNewEnd(e.target.value)} required/></label>
    <button className="btn primary" type="submit" disabled={savingTemplate||!newName.trim()||newStart>=newEnd}>{savingTemplate?"Saving…":"Save service template"}</button>
    {formError&&<p className="schedule-error" role="alert">{formError}</p>}
    <p className="new-template-help">The new service will be added to this church’s template list and can be selected for future weekend generation.</p>
   </form>}
   {locations.map(location=>{const items=templates.filter(t=>t.location_id===location.id&&t.active!==false);return items.length?<div className="template-location" key={location.id}><b>{location.name}</b><div className="template-options">{items.map(t=><div className="template-option-row" key={t.id}><label><input type="checkbox" checked={selected.includes(String(t.id))} onChange={()=>toggle(String(t.id))}/><span>{dayName(t.day_of_week)} · {t.service_name} ({shortTime(t.start_time)}–{shortTime(t.end_time)})</span></label><button type="button" className="template-delete-btn" title="Remove template from future generation" aria-label={`Delete ${t.service_name} template`} onClick={()=>void onDeleteTemplate(t)}><Trash2 size={14}/></button></div>)}</div></div>:null;})}
   {templates.filter(t=>t.active!==false).length===0&&<p className="subtle">No active templates. Add recurring services first.</p>}
  </div>
  <div className="generate-footer"><label>Start Saturday<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label>Duration<select value={weeks} onChange={e=>setWeeks(Number(e.target.value))}><option value={1}>1 weekend</option><option value={2}>2 weekends</option><option value={4}>4 weekends</option><option value={8}>8 weekends</option><option value={12}>12 weekends</option></select></label><label>Existing matching slots<select value={mode} onChange={e=>setMode(e.target.value as "add"|"replace")}><option value="add">Add missing only</option><option value="replace" disabled>Replace times from template (temporarily unavailable)</option></select></label><button className="btn primary" disabled={!selected.length||!templates.length} onClick={()=>onGenerate(date,weeks,selected,mode)}><CalendarDays size={16}/> Generate</button></div>
  <div className="generate-note"><div className="generate-note-title"><Info size={16}/><b>How generation handles existing services</b></div><p><b>Add missing only</b><span>Leaves existing matching slots unchanged.</span></p><p><b>Replace times from template</b><span>Temporarily unavailable until it can safely revalidate assignments and reset servant confirmations. Use Edit service for existing slots.</span></p></div>
 </div></details>;
}

