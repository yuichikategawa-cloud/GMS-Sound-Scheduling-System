import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { CalendarDays, Church, Users, Search, Plus, LogOut, Pencil, Trash2, Download, RefreshCw, ShieldCheck, X, Menu, ChevronDown, BarChart3, ClipboardCheck, AlertTriangle } from "lucide-react";
import { supabase, isSupabaseConfigured } from "./supabase";
import type { Assignment, Location, Profile, Role, Schedule, ScheduleView, Servant } from "./types";

const ROLES: Role[] = ["FOH", "Monitor", "Assistant"];
const today = () => new Date().toLocaleDateString("en-CA");
const fmtDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric",year:"numeric"});
const shortTime = (t: string) => t?.slice(0,5) ?? "";
const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);

export default function App() {
  const [session,setSession] = useState<any>(null);
  const [profile,setProfile] = useState<Profile|null>(null);
  const [authLoading,setAuthLoading] = useState(true);
  const [loading,setLoading] = useState(false);
  const [message,setMessage] = useState("");
  const [schedules,setSchedules] = useState<ScheduleView[]>([]);
  const [locations,setLocations] = useState<Location[]>([]);
  const [servants,setServants] = useState<Servant[]>([]);
  const [templates,setTemplates] = useState<any[]>([]);
  const [tab,setTab] = useState<"schedule"|"people"|"availability"|"statistics">("schedule");
  const [availability,setAvailability] = useState<any[]>([]);
  const [personFilter,setPersonFilter] = useState("");
  const [locationFilter,setLocationFilter] = useState("");
  const [serviceFilter,setServiceFilter] = useState("");
  const [fromDate,setFromDate] = useState("");
  const [toDate,setToDate] = useState("");
  const [modal,setModal] = useState<"schedule"|"person"|null>(null);
  const [editing,setEditing] = useState<ScheduleView|null>(null);
  const [authMode,setAuthMode] = useState<"login"|"signup">("login");
  const [email,setEmail] = useState("");
  const [password,setPassword] = useState("");
  const [fullName,setFullName] = useState("");
  const [mobileNav,setMobileNav] = useState(false);

  useEffect(() => {
    if (!supabase) { setAuthLoading(false); return; }
    supabase.auth.getSession().then(({data})=>{setSession(data.session);setAuthLoading(false);});
    const {data:{subscription}} = supabase.auth.onAuthStateChange((_event,next)=>{setSession(next);});
    return ()=>subscription.unsubscribe();
  },[]);

  useEffect(() => {
    if (!session || !supabase) { setProfile(null); return; }
    void loadProfile();
  },[session]);

  async function loadProfile() {
    if (!supabase || !session) return;
    const {data,error} = await supabase.from("profiles").select("*").eq("id",session.user.id).maybeSingle();
    if (error) setMessage(error.message);
    else setProfile(data as Profile|null);
  }

  async function loadData() {
    if (!supabase) return;
    setLoading(true); setMessage("");
    try {
      const [locRes,servRes,tempRes,schedRes,assignRes,availRes] = await Promise.all([
        supabase.from("locations").select("*").order("name"),
        supabase.from("servants").select("*").order("full_name"),
        supabase.from("service_templates").select("*").eq("active",true),
        supabase.from("schedules").select("*").order("service_date").order("start_time"),
        supabase.from("assignments").select("*"),
        supabase.from("servant_availability").select("*").order("service_date",{ascending:true})
      ]);
      for (const r of [locRes,servRes,tempRes,schedRes,assignRes,availRes]) if (r.error) throw r.error;
      const locs=(locRes.data??[]) as Location[], people=(servRes.data??[]) as Servant[];
      const assignments=(assignRes.data??[]) as Assignment[];
      const byId=new Map(people.map(p=>[p.id,p.full_name]));
      const locById=new Map(locs.map(l=>[l.id,l.name]));
      const mapped=(schedRes.data??[] as Schedule[]).map(s=>({
        ...s,location_name:locById.get(s.location_id)??"Unknown location",
        assignments:assignments.filter(a=>a.schedule_id===s.id).map(a=>({
          role:a.role,servant_id:a.servant_id,servant_name:byId.get(a.servant_id)??"Unknown servant"
        }))
      })) as ScheduleView[];
      setLocations(locs);setServants(people);setTemplates(tempRes.data??[]);setSchedules(mapped);setAvailability(availRes.data??[]);
    } catch(e) { setMessage(errorText(e)); }
    finally { setLoading(false); }
  }

  useEffect(()=>{if(profile) void loadData();},[profile]);

  async function submitAuth(e:FormEvent) {
    e.preventDefault(); if(!supabase)return;setMessage("");setAuthLoading(true);
    try {
      if(authMode==="signup") {
        const {error}=await supabase.auth.signUp({email,password,options:{data:{full_name:fullName}}});
        if(error)throw error;
        setMessage("Account created. If email confirmation is enabled, verify your email before signing in.");
        setAuthMode("login");
      } else {
        const {error}=await supabase.auth.signInWithPassword({email,password});if(error)throw error;
      }
    } catch(e){setMessage(errorText(e));}
    finally{setAuthLoading(false);}
  }

  async function signOut(){await supabase?.auth.signOut();setProfile(null);setSession(null);}
  const isAdmin=profile?.role==="admin";

  const filtered=useMemo(()=>{
    const q=personFilter.trim().toLowerCase();
    return schedules.filter(s=>
      (!q||s.assignments.some(a=>a.servant_name.toLowerCase().includes(q))) &&
      (!locationFilter||s.location_id===locationFilter) &&
      (!serviceFilter||s.service_name===serviceFilter) &&
      (!fromDate||s.service_date>=fromDate) && (!toDate||s.service_date<=toDate)
    );
  },[schedules,personFilter,locationFilter,serviceFilter,fromDate,toDate]);
  const dailyGroups=useMemo(()=>{
    const groups=new Map<string,ScheduleView[]>();
    for(const item of filtered){const current=groups.get(item.service_date)??[];current.push(item);groups.set(item.service_date,current);}
    return [...groups.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([date,items])=>({date,items}));
  },[filtered]);

  async function saveSchedule(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();if(!supabase||!isAdmin)return;
    const fd=new FormData(e.currentTarget);
    const payload={service_date:String(fd.get("service_date")),location_id:String(fd.get("location_id")),service_name:String(fd.get("service_name")),start_time:String(fd.get("start_time")),end_time:String(fd.get("end_time"))};
    const selected:Record<Role,string>={FOH:String(fd.get("FOH")||""),Monitor:String(fd.get("Monitor")||""),Assistant:String(fd.get("Assistant")||"")};
    const chosen=Object.entries(selected).filter(([,id])=>id).map(([role,id])=>({role,id}));
    const duplicateInService=chosen.find((entry,index)=>chosen.some((other,j)=>j!==index&&other.id===entry.id));
    if(duplicateInService){setMessage("One servant cannot fill more than one role in the same service.");return;}
    const conflicts=chosen.map(entry=>({ ...entry, other:schedules.find(s=>s.service_date===payload.service_date&&s.location_id!==payload.location_id&&s.id!==editing?.id&&s.assignments.some(a=>a.servant_id===entry.id)) })).filter(x=>x.other);
    if(conflicts.length){const names=conflicts.map(c=>`${servants.find(p=>p.id===c.id)?.full_name??"A servant"} (${c.other?.location_name} · ${c.other?.service_name})`);setMessage(`Cannot save: ${names.join(", ")} already assigned at another church location on ${payload.service_date}.`);return;}
    const unavailable=chosen.filter(entry=>availability.some(a=>a.servant_id===entry.id&&a.service_date===payload.service_date&&a.status==="unavailable"));
    if(unavailable.length){setMessage(`Cannot assign: ${unavailable.map(x=>servants.find(p=>p.id===x.id)?.full_name??"A servant").join(", ")} marked unavailable on ${payload.service_date}.`);return;}
    const preferNot=chosen.filter(entry=>availability.some(a=>a.servant_id===entry.id&&a.service_date===payload.service_date&&a.status==="prefer_not"));
    if(preferNot.length&&!confirm(`${preferNot.map(x=>servants.find(p=>p.id===x.id)?.full_name??"A servant").join(", ")} marked “Prefer not to serve” on this date. Assign anyway?`))return;
    setLoading(true);setMessage("");
    try {
      let scheduleId=editing?.id;
      if(scheduleId){
        const {error}=await supabase.from("schedules").update(payload).eq("id",scheduleId);if(error)throw error;
      }else{
        const {data,error}=await supabase.from("schedules").insert(payload).select("id").single();if(error)throw error;scheduleId=data.id;
      }
      const {error:delError}=await supabase.from("assignments").delete().eq("schedule_id",scheduleId);if(delError)throw delError;
      const rows=ROLES.filter(r=>selected[r]).map(r=>({schedule_id:scheduleId,servant_id:selected[r],role:r}));
      if(rows.length){const {error}=await supabase.from("assignments").insert(rows);if(error)throw error;}
      setModal(null);setEditing(null);await loadData();
    }catch(e){setMessage(errorText(e));setLoading(false);}
  }

  async function generateWeekend(date:string) {
    if(!supabase||!isAdmin)return;
    const d=new Date(`${date}T12:00:00`);
    if(d.getDay()!==6){setMessage("Choose a Saturday to generate the weekend.");return;}
    const sunday=new Date(d);sunday.setDate(d.getDate()+1);
    const dates=[{date,day:6},{date:sunday.toLocaleDateString("en-CA"),day:0}];
    setLoading(true);setMessage("");
    try {
      const rows=dates.flatMap(x=>templates.filter(t=>Number(t.day_of_week)===x.day).map(t=>({
        service_date:x.date,location_id:t.location_id,service_name:t.service_name,start_time:t.start_time,end_time:t.end_time
      })));
      if(!rows.length)throw new Error("No service templates found. Check that the database setup SQL has been run.");
      const {error}=await supabase.from("schedules").upsert(rows,{onConflict:"service_date,location_id,service_name",ignoreDuplicates:true});
      if(error)throw error;
      await loadData();setMessage("Weekend service slots generated. Assign servants by editing each service.");
    }catch(e){setMessage(errorText(e));setLoading(false);}
  }

  async function saveAvailability(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();if(!supabase)return;
    const form=e.currentTarget;
    const fd=new FormData(form);
    const linkedServant=servants.find(p=>p.auth_user_id===session?.user?.id);
    const row={servant_id:String(fd.get("servant_id")),service_date:String(fd.get("service_date")),status:String(fd.get("status")),notes:String(fd.get("notes")||"").trim()};
    if(!isAdmin&&(!linkedServant||row.servant_id!==linkedServant.id)){setMessage("Your login is not linked to a servant profile. Please ask an administrator to link your account.");return;}
    setLoading(true);setMessage("");
    try {
      const {error}=await supabase.from("servant_availability").upsert(row,{onConflict:"servant_id,service_date"});
      if(error)throw error;
      await loadData();form.reset();setMessage("Availability saved.");
    } catch(e){setMessage(errorText(e));}
    finally{setLoading(false);}
  }
  async function deleteAvailability(id:string){
    if(!supabase||!isAdmin)return;
    const {error}=await supabase.from("servant_availability").delete().eq("id",id);
    if(error)setMessage(error.message);else await loadData();
  }

  async function savePerson(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();if(!supabase||!isAdmin)return;
    const fd=new FormData(e.currentTarget);const name=String(fd.get("full_name")).trim();
    if(!name)return;
    setLoading(true);
    try{
      const {error}=await supabase.from("servants").insert({full_name:name,active:true});if(error)throw error;
      setModal(null);await loadData();
    }catch(e){setMessage(errorText(e));setLoading(false);}
  }
  async function togglePerson(p:Servant){
    if(!supabase||!isAdmin)return;
    const {error}=await supabase.from("servants").update({active:!p.active}).eq("id",p.id);
    if(error)setMessage(error.message);else await loadData();
  }
  async function deleteSchedule(s:ScheduleView){
    if(!supabase||!isAdmin||!confirm(`Delete ${s.service_name} on ${s.service_date}?`))return;
    const {error}=await supabase.from("schedules").delete().eq("id",s.id);
    if(error)setMessage(error.message);else await loadData();
  }
  function exportCsv(){
    const rows=[["date","location","service","start","end","FOH","Monitor","Assistant"].join(","),
      ...filtered.map(s=>[s.service_date,s.location_name,s.service_name,shortTime(s.start_time),shortTime(s.end_time),...ROLES.map(r=>s.assignments.find(a=>a.role===r)?.servant_name??"")].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(","))];
    const blob=new Blob([rows.join("\r\n")],{type:"text/csv;charset=utf-8"});
    const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="gms-serving-schedule.csv";a.click();URL.revokeObjectURL(url);
  }

  if(!isSupabaseConfigured)return <SetupScreen/>;
  if(authLoading)return <div className="center-screen"><div className="loader"/>Loading...</div>;
  if(!session)return <div className="auth-page"><div className="auth-card"><div className="brand-mark"><Church size={24}/></div><p className="eyebrow">GMS WEEKEND OPERATIONS</p><h1>{authMode==="login"?"Welcome back":"Create your account"}</h1><p className="subtle">Serving schedule management for Alam Sutera, BSD and Karawaci.</p>
    <form onSubmit={submitAuth} className="stack">
      {authMode==="signup"&&<label>Full name<input required value={fullName} onChange={e=>setFullName(e.target.value)} placeholder="Your name"/></label>}
      <label>Email<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/></label>
      <label>Password<input type="password" required minLength={6} value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 6 characters"/></label>
      <button className="btn primary full" disabled={authLoading}>{authMode==="login"?"Sign in":"Create account"}</button>
    </form>
    <button className="link-btn" onClick={()=>{setAuthMode(authMode==="login"?"signup":"login");setMessage("");}}>{authMode==="login"?"Need an account? Sign up":"Already registered? Sign in"}</button>
    {message&&<p className="message">{message}</p>}
  </div></div>;

  if(!profile)return <div className="center-screen"><div className="loader"/>Loading your profile...</div>;

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav?"open":""}`}>
      <div className="brand"><div className="brand-mark"><Church size={21}/></div><div><b>GMS Serving</b><small>WEEKEND OPERATIONS</small></div></div>
      <div className="nav-label">WORKSPACE</div>
      <button className={`nav-item ${tab==="schedule"?"active":""}`} onClick={()=>{setTab("schedule");setMobileNav(false);}}><CalendarDays size={18}/> Schedule</button>
      <button className={`nav-item ${tab==="availability"?"active":""}`} onClick={()=>{setTab("availability");setMobileNav(false);}}><ClipboardCheck size={18}/> Availability</button>
      {isAdmin&&<>
        <button className={`nav-item ${tab==="people"?"active":""}`} onClick={()=>{setTab("people");setMobileNav(false);}}><Users size={18}/> Servant directory</button>
        <button className={`nav-item ${tab==="statistics"?"active":""}`} onClick={()=>{setTab("statistics");setMobileNav(false);}}><BarChart3 size={18}/> Statistics</button>
      </>}
      <div className="sidebar-bottom"><div className="user-chip"><div className="avatar">{(profile.display_name||session.user.email||"G").slice(0,1).toUpperCase()}</div><div className="user-meta"><b>{profile.display_name||session.user.email}</b><small>{isAdmin?"Administrator":"Servant"}</small></div><button title="Sign out" className="icon-btn" onClick={signOut}><LogOut size={17}/></button></div></div>
    </aside>
    <div className="main-area">
      <header className="topbar"><button className="mobile-menu icon-btn" onClick={()=>setMobileNav(!mobileNav)}><Menu/></button><div><div className="eyebrow">GMS • CHURCH SERVING</div><h1>{tab==="schedule"?"Serving schedule":tab==="people"?"Servant directory":tab==="availability"?"Availability management":"Serving statistics"}</h1></div><div className="top-actions"><span className="role-tag"><ShieldCheck size={14}/>{isAdmin?"Admin access":"View access"}</span><button className="icon-btn" onClick={loadData} title="Refresh"><RefreshCw size={17}/></button></div></header>
      <main className="content">
        {message&&<div className="message-banner"><span>{message}</span><button className="icon-btn" onClick={()=>setMessage("")}><X size={16}/></button></div>}
        {tab==="schedule"?<>
          <div className="toolbar"><div><h2>Weekend assignments</h2><p className="subtle">Find who is serving, where, and in which role.</p></div><div className="toolbar-actions">{isAdmin&&<button className="btn primary" onClick={()=>{setEditing(null);setModal("schedule");}}><Plus size={16}/> Add service</button>}<button className="btn secondary" onClick={exportCsv}><Download size={16}/> Export</button></div></div>
          <section className="stats-grid"><Stat label="VISIBLE SERVICES" value={filtered.length}/><Stat label="SERVANTS ASSIGNED" value={new Set(filtered.flatMap(s=>s.assignments.map(a=>a.servant_id))).size}/><Stat label="CHURCH LOCATIONS" value={new Set(filtered.map(s=>s.location_id)).size}/></section>
          <section className="filter-panel"><div className="filter-title"><Search size={17}/> <b>Filter schedule</b></div><div className="filters">
            <label className="search-field"><span>Servant name · any role</span><input value={personFilter} onChange={e=>setPersonFilter(e.target.value)} placeholder="Search servant name"/></label>
            <label><span>Church location</span><select value={locationFilter} onChange={e=>setLocationFilter(e.target.value)}><option value="">All locations</option>{locations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
            <label><span>Service</span><select value={serviceFilter} onChange={e=>setServiceFilter(e.target.value)}><option value="">All services</option>{[...new Set(schedules.map(s=>s.service_name))].sort().map(n=><option key={n}>{n}</option>)}</select></label>
            <label><span>From</span><input type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)}/></label>
            <label><span>To</span><input type="date" value={toDate} onChange={e=>setToDate(e.target.value)}/></label>
          </div><button className="clear-btn" onClick={()=>{setPersonFilter("");setLocationFilter("");setServiceFilter("");setFromDate("");setToDate("");}}>Clear all filters</button></section>
          <details className="collapsible-panel" open>
            <summary><span><b>Daily overview</b><small>{dailyGroups.length} days · summary by church location</small></span><ChevronDown size={20}/></summary>
            {dailyGroups.length>0&&<div className="daily-overview">{dailyGroups.map(group=><DailySummary key={group.date} date={group.date} items={group.items}/>)}</div>}
          </details>
          <details className="collapsible-panel service-panel" open>
            <summary><span><b>Service details</b><small>{filtered.length} service slots · expand a service to see assignments</small></span><ChevronDown size={20}/></summary>
            {loading?<div className="empty-state"><div className="loader"/>Loading schedule...</div>:filtered.length===0?<div className="empty-state"><CalendarDays size={30}/><b>No service slots found</b><p>Try changing your filters or generate a weekend schedule.</p></div>:
              <div className="schedule-grid">{filtered.map(s=><ScheduleCard key={s.id} item={s} isAdmin={isAdmin} onEdit={()=>{setEditing(s);setModal("schedule");}} onDelete={()=>deleteSchedule(s)}/>)}</div>}
          </details>
          {isAdmin&&<GeneratePanel onGenerate={generateWeekend}/>}
        </>:tab==="people"?<PeoplePanel servants={servants} isAdmin={isAdmin} onAdd={()=>setModal("person")} onToggle={togglePerson}/>:tab==="availability"?<AvailabilityPanel servants={servants} availability={availability} isAdmin={isAdmin} currentUserId={session.user.id} onSave={saveAvailability} onDelete={deleteAvailability}/>:<StatisticsPanel schedules={filtered} servants={servants}/>}
      </main>
    </div>
    {modal==="schedule"&&<ScheduleModal locations={locations} servants={servants.filter(s=>s.active)} editing={editing} onClose={()=>{setModal(null);setEditing(null);}} onSave={saveSchedule}/>}
    {modal==="person"&&<PersonModal onClose={()=>setModal(null)} onSave={savePerson}/>}
  </div>;
}


function DailySummary({date,items}:{date:string;items:ScheduleView[]}){
 const locations=[...new Map(items.map(item=>[item.location_id,{id:item.location_id,name:item.location_name}])).values()];
 const assigned=items.reduce((n,item)=>n+item.assignments.filter(a=>a.servant_id&&a.role!=="Assistant").length,0);
 const required=items.length*2;
 const servantLocations=new Map<string,Set<string>>();
 for(const item of items)for(const assignment of item.assignments){const set=servantLocations.get(assignment.servant_id)??new Set<string>();set.add(item.location_id);servantLocations.set(assignment.servant_id,set);}
 const crossLocationConflicts=[...servantLocations.entries()].filter(([,ids])=>ids.size>1).map(([id])=>items.flatMap(i=>i.assignments.filter(a=>a.servant_id===id).map(a=>a.servant_name))[0]);
 const dayLabel=new Date(`${date}T12:00:00`).toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"});
 return <details className="daily-card" open>
  <summary className="daily-head"><div><div className="daily-date">{dayLabel}</div><div className="daily-subtitle">{items.length} services · {locations.length} {locations.length===1?"location":"locations"}</div></div><div className="daily-head-right"><div className={`coverage-pill ${assigned>=required?"complete":"pending"}`}>{assigned}/{required} required roles filled</div><ChevronDown size={19}/></div></summary>
  {crossLocationConflicts.length>0&&<div className="day-conflict-warning"><AlertTriangle size={16}/><span><b>Cross-location conflict:</b> {crossLocationConflicts.join(", ")} assigned at more than one church location on this date.</span></div>}
  <div className="daily-locations">{locations.map(location=>{
   const services=items.filter(item=>item.location_id===location.id).sort((a,b)=>a.start_time.localeCompare(b.start_time));
   return <div className="daily-location" key={location.id}><div className="daily-location-name">{location.name}</div><div className="daily-services">{services.map(item=><div className="daily-service" key={item.id}>
    <div className="daily-service-top"><b>{item.service_name}</b><span>{shortTime(item.start_time)}–{shortTime(item.end_time)}</span></div>
    <div className="daily-roles">{ROLES.map(role=>{const assignment=item.assignments.find(a=>a.role===role);return <div className={`daily-role-row ${!assignment&&role!=="Assistant"?"role-missing":""}`} key={role}><b>{role}</b><span>{assignment?.servant_name??(role==="Assistant"?"Optional":"UNASSIGNED")}</span></div>;})}</div>
   </div>)}</div></div>;
  })}</div>
 </details>;
}

function Stat({label,value}:{label:string;value:number}){return <div className="stat-card"><span>{label}</span><b>{value}</b></div>;}
function ScheduleCard({item,isAdmin,onEdit,onDelete}:{item:ScheduleView;isAdmin:boolean;onEdit:()=>void;onDelete:()=>void}){
 return <details className="schedule-card" open><summary className="schedule-card-summary"><div><div className="date-text">{fmtDate(item.service_date)}</div><div className="location-text">{item.location_name}</div><div className="service-title">{item.service_name}</div><div className="time-text">{shortTime(item.start_time)} – {shortTime(item.end_time)}</div></div><ChevronDown size={19}/></summary>
  <div className="role-grid">{ROLES.map(r=>{const a=item.assignments.find(x=>x.role===r);return <div className={`role-box ${r==="Assistant"?"optional":""}`} key={r}><small>{r}{r==="Assistant"?" · optional":""}</small><b>{a?.servant_name??"Unassigned"}</b></div>;})}</div>
  {isAdmin&&<div className="card-actions"><button className="btn tiny secondary" onClick={onEdit}><Pencil size={13}/> Edit</button><button className="btn tiny danger" onClick={onDelete}><Trash2 size={13}/> Delete</button></div>}
 </details>;
}

function GeneratePanel({onGenerate}:{onGenerate:(date:string)=>void}){
 const [date,setDate]=useState(()=>{const d=new Date();d.setDate(d.getDate()+((6-d.getDay()+7)%7));return d.toLocaleDateString("en-CA");});
 return <section className="generate-panel"><div><b>Generate recurring weekend slots</b><p className="subtle">Creates the Saturday and Sunday services for all three locations. Existing slots are left unchanged.</p></div><div className="generate-controls"><input type="date" value={date} onChange={e=>setDate(e.target.value)}/><button className="btn primary" onClick={()=>onGenerate(date)}><CalendarDays size={16}/> Generate weekend</button></div></section>;
}
function ScheduleModal({locations,servants,editing,onClose,onSave}:{locations:Location[];servants:Servant[];editing:ScheduleView|null;onClose:()=>void;onSave:(e:FormEvent<HTMLFormElement>)=>void}){
 const existing=(role:Role)=>editing?.assignments.find(a=>a.role===role)?.servant_id??"";
 return <div className="modal-backdrop"><form className="modal-card" onSubmit={onSave}><div className="modal-head"><div><h2>{editing?"Edit service assignment":"Add service assignment"}</h2><p className="subtle">FOH and Monitor are required. Assistant is optional.</p></div><button type="button" className="icon-btn" onClick={onClose}><X/></button></div>
  <div className="form-grid"><label>Date<input name="service_date" type="date" required defaultValue={editing?.service_date??today()}/></label><label>Location<select name="location_id" required defaultValue={editing?.location_id??locations[0]?.id}>{locations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
   <label className="wide">Service name<input name="service_name" required defaultValue={editing?.service_name??""} placeholder="e.g. Service 1, VSS, AOG"/></label><label>Start time<input name="start_time" type="time" required defaultValue={shortTime(editing?.start_time??"09:00")}/></label><label>End time<input name="end_time" type="time" required defaultValue={shortTime(editing?.end_time??"11:00")}/></label>
   {ROLES.map(r=><label className="wide" key={r}>{r}{r==="Assistant"?" (optional)":" (required)"}<select name={r} required={r!=="Assistant"} defaultValue={existing(r)}><option value="">{r==="Assistant"?"Not assigned":"Select servant"}</option>{servants.map(p=><option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>)}
  </div><div className="modal-actions"><button type="button" className="btn secondary" onClick={onClose}>Cancel</button><button className="btn primary">Save assignment</button></div>
 </form></div>;
}
function PersonModal({onClose,onSave}:{onClose:()=>void;onSave:(e:FormEvent<HTMLFormElement>)=>void}){
 return <div className="modal-backdrop"><form className="modal-card compact" onSubmit={onSave}><div className="modal-head"><h2>Add servant</h2><button type="button" className="icon-btn" onClick={onClose}><X/></button></div><label>Full name<input name="full_name" required autoFocus placeholder="Servant's full name"/></label><div className="modal-actions"><button type="button" className="btn secondary" onClick={onClose}>Cancel</button><button className="btn primary">Add person</button></div></form></div>;
}
function PeoplePanel({servants,isAdmin,onAdd,onToggle}:{servants:Servant[];isAdmin:boolean;onAdd:()=>void;onToggle:(p:Servant)=>void}){
 const [q,setQ]=useState("");
 const rows=servants.filter(p=>p.full_name.toLowerCase().includes(q.toLowerCase()));
 return <><div className="toolbar"><div><h2>Servant directory</h2><p className="subtle">Manage the names available for role assignments.</p></div>{isAdmin&&<button className="btn primary" onClick={onAdd}><Plus size={16}/> Add servant</button>}</div><section className="filter-panel"><label className="search-field"><span>Search people</span><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search by name"/></label></section><div className="people-list">{rows.map(p=><div className="person-row" key={p.id}><div className="avatar">{p.full_name.slice(0,1).toUpperCase()}</div><div className="person-name"><b>{p.full_name}</b><small>{p.active?"Active":"Inactive"}</small></div>{isAdmin&&<button className={`btn tiny ${p.active?"secondary":"primary"}`} onClick={()=>onToggle(p)}>{p.active?"Deactivate":"Activate"}</button>}</div>)}</div></>;
}
function AvailabilityPanel({servants,availability,isAdmin,currentUserId,onSave,onDelete}:{servants:Servant[];availability:any[];isAdmin:boolean;currentUserId:string;onSave:(e:FormEvent<HTMLFormElement>)=>void;onDelete:(id:string)=>void}){
 const [dateFilter,setDateFilter]=useState("");
 const myServant=servants.find(p=>p.auth_user_id===currentUserId);
 const rows=availability.filter(a=>(isAdmin||a.servant_id===myServant?.id)&&(!dateFilter||a.service_date===dateFilter)).sort((a,b)=>a.service_date.localeCompare(b.service_date));
 const name=(id:string)=>servants.find(p=>p.id===id)?.full_name??"Unknown servant";
 return <><div className="toolbar"><div><h2>{isAdmin?"Servant availability":"My availability"}</h2><p className="subtle">{isAdmin?"Manage availability records for the serving team.":"Mark the dates when you can or cannot serve."}</p></div></div>
  {(isAdmin||myServant)&&<section className="availability-form-panel"><h3>{isAdmin?"Record servant availability":"Update my availability"}</h3><form className="availability-form" onSubmit={onSave}>
   {isAdmin?<label>Servant<select name="servant_id" required defaultValue=""> <option value="" disabled>Select servant</option>{servants.filter(p=>p.active).map(p=><option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>:<><input type="hidden" name="servant_id" value={myServant!.id}/><div className="availability-self-name"><span>Servant</span><b>{myServant!.full_name}</b></div></>}
   <label>Date<input name="service_date" type="date" required defaultValue={today()}/></label><label>Status<select name="status" defaultValue="available"><option value="available">Available</option><option value="unavailable">Unavailable</option><option value="prefer_not">Prefer not to serve</option></select></label><label className="availability-notes">Notes (optional)<input name="notes" placeholder="e.g. only available in the morning"/></label><button className="btn primary">Save availability</button></form><p className="subtle availability-note">One status per person per date. Saving again updates the existing entry.</p></section>}
  {!isAdmin&&!myServant&&<div className="message-banner"><span>Your login is not linked to a servant directory profile yet. Please ask a GMS administrator to link your account before submitting availability.</span></div>}
  <section className="filter-panel availability-filter"><label><span>Filter by date</span><input type="date" value={dateFilter} onChange={e=>setDateFilter(e.target.value)}/></label><button className="clear-btn" onClick={()=>setDateFilter("")}>Clear date</button></section>
  <div className="list-heading"><h2>{isAdmin?"Availability records":"My availability records"}</h2><span>{rows.length} records</span></div>
  {rows.length===0?<div className="empty-state"><ClipboardCheck size={28}/><b>No availability records</b><p>Add a record above to help coordinators plan assignments.</p></div>:<div className="people-list">{rows.map(a=><div className="availability-row" key={a.id}><div className="availability-date">{fmtDate(a.service_date)}</div><div className="availability-person"><b>{name(a.servant_id)}</b><small>{a.notes||"No notes"}</small></div><span className={`availability-status ${a.status}`}>{a.status==="prefer_not"?"Prefer not to serve":a.status}</span>{(isAdmin||a.servant_id===myServant?.id)&&<button className="icon-btn" title="Delete record" onClick={()=>onDelete(a.id)}><Trash2 size={16}/></button>}</div>)}</div>}
 </>;
}

function StatisticsPanel({schedules,servants}:{schedules:ScheduleView[];servants:Servant[]}){
 const counts=new Map<string,{total:number;FOH:number;Monitor:number;Assistant:number}>();
 for(const s of schedules)for(const a of s.assignments){const c=counts.get(a.servant_id)??{total:0,FOH:0,Monitor:0,Assistant:0};c.total++;c[a.role]++;counts.set(a.servant_id,c);}
 const rows=[...counts.entries()].map(([id,c])=>({id,name:servants.find(p=>p.id===id)?.full_name??"Unknown",...c})).sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name));
 const totalAssignments=rows.reduce((n,r)=>n+r.total,0);const filledRequired=schedules.reduce((n,s)=>n+s.assignments.filter(a=>a.role!=="Assistant").length,0);const requiredSlots=schedules.length*2;
 const locationCounts=new Map<string,number>();for(const s of schedules)locationCounts.set(s.location_name,(locationCounts.get(s.location_name)??0)+s.assignments.length);
 return <><div className="toolbar"><div><h2>Serving statistics</h2><p className="subtle">Based on the currently selected schedule filters.</p></div></div>
  <section className="stats-grid stats-grid-wide"><Stat label="TOTAL ASSIGNMENTS" value={totalAssignments}/><Stat label="REQUIRED ROLES FILLED" value={filledRequired}/><Stat label="REQUIRED ROLE GAPS" value={Math.max(0,requiredSlots-filledRequired)}/><Stat label="SERVANTS ASSIGNED" value={rows.length}/></section>
  <section className="filter-panel"><div className="filter-title"><BarChart3 size={17}/><b>Assignments by church location</b></div><div className="location-stat-list">{[...locationCounts.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([name,count])=><div className="location-stat" key={name}><span>{name}</span><b>{count}</b></div>)}</div></section>
  <div className="list-heading"><h2>Assignments by servant</h2><span>{rows.length} servants</span></div>
  <div className="stats-table-wrap"><table className="stats-table"><thead><tr><th>Servant</th><th>Total</th><th>FOH</th><th>Monitor</th><th>Assistant</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td><b>{r.name}</b></td><td>{r.total}</td><td>{r.FOH}</td><td>{r.Monitor}</td><td>{r.Assistant}</td></tr>)}</tbody></table></div>
 </>;
}

function SetupScreen(){
 return <div className="auth-page"><div className="auth-card setup-card"><div className="brand-mark"><Church size={24}/></div><p className="eyebrow">GMS SERVING SYSTEM</p><h1>Connect your Supabase project</h1><p className="subtle">The app code is ready. Add your Supabase project credentials to enable shared login and scheduling.</p><ol><li>Create a Supabase project.</li><li>Run <code>supabase/schema.sql</code> in the SQL Editor.</li><li>Copy <code>.env.example</code> to <code>.env</code> and fill in your Project URL and anon/publishable key.</li><li>Restart the development server.</li></ol><p className="message">No database password or service-role key is needed in this frontend.</p></div></div>;
}
