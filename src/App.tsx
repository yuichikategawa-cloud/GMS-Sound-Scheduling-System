import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, FormEvent, ReactNode } from "react";
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
  const [tab,setTab] = useState<"schedule"|"people"|"servantInfo"|"availability"|"statistics"|"audit"|"profile">("schedule");
  const [availability,setAvailability] = useState<any[]>([]);
  const [requests,setRequests] = useState<any[]>([]);
  const [auditLogs,setAuditLogs] = useState<any[]>([]);
  const [availabilityDeadline,setAvailabilityDeadline] = useState("");
  const [calendarView,setCalendarView] = useState<"week"|"month">("week");
  const [personFilter,setPersonFilter] = useState("");
  const [locationFilter,setLocationFilter] = useState("");
  const [serviceFilter,setServiceFilter] = useState("");
  const [fromDate,setFromDate] = useState("");
  const [toDate,setToDate] = useState("");
  const [modal,setModal] = useState<"schedule"|"person"|null>(null);
  const [editing,setEditing] = useState<ScheduleView|null>(null);
  const [authMode,setAuthMode] = useState<"login"|"signup"|"reset">("login");
  const [email,setEmail] = useState("");
  const [username,setUsername] = useState("");
  const [memberProfile,setMemberProfile] = useState<any>(null);
  const [memberDirectory,setMemberDirectory] = useState<any[]>([]);
  const [password,setPassword] = useState("");
  const [recoveryMode,setRecoveryMode] = useState(false);
  const [fullName,setFullName] = useState("");
  const [signupCgStatus,setSignupCgStatus] = useState("");
  const [mobileNav,setMobileNav] = useState(false);

  useEffect(() => {
    if (!supabase) { setAuthLoading(false); return; }
    supabase.auth.getSession().then(({data})=>{setSession(data.session);setAuthLoading(false);});
    const {data:{subscription}} = supabase.auth.onAuthStateChange((event,next)=>{setSession(next); if(event==="PASSWORD_RECOVERY") setRecoveryMode(true);});
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
      const [locRes,servRes,tempRes,schedRes,assignRes,availRes,requestRes,settingRes,auditRes,memberRes] = await Promise.all([
        supabase.from("locations").select("*").order("name"),
        supabase.from("servants").select("*").order("full_name"),
        supabase.from("service_templates").select("*").eq("active",true),
        supabase.from("schedules").select("*").order("service_date").order("start_time"),
        supabase.from("assignments").select("*"),
        supabase.from("servant_availability").select("*").order("service_date",{ascending:true}),
        supabase.from("serving_requests").select("*").order("created_at",{ascending:false}),
        supabase.from("system_settings").select("*").eq("key","availability_deadline").maybeSingle(),
        supabase.from("audit_logs").select("*").order("created_at",{ascending:false}).limit(100),
        supabase.from("member_profiles").select("*")
      ]);
      for (const r of [locRes,servRes,tempRes,schedRes,assignRes,availRes,requestRes,settingRes,auditRes,memberRes]) if (r.error) throw r.error;
      const locs=(locRes.data??[]) as Location[], people=(servRes.data??[]) as Servant[];
      const assignments=(assignRes.data??[]) as Assignment[];
      const byId=new Map(people.map(p=>[p.id,p.full_name]));
      const locById=new Map(locs.map(l=>[l.id,l.name]));
      const mapped=(schedRes.data??[] as Schedule[]).map(s=>({
        ...s,location_name:locById.get(s.location_id)??"Unknown location",
        assignments:assignments.filter(a=>a.schedule_id===s.id).map(a=>({
          id:a.id,role:a.role,servant_id:a.servant_id,servant_name:byId.get(a.servant_id)??"Unknown servant",confirmation_status:a.confirmation_status??"pending"
        }))
      })) as ScheduleView[];
      setLocations(locs);setServants(people);setTemplates(tempRes.data??[]);setSchedules(mapped);setAvailability(availRes.data??[]);setRequests(requestRes.data??[]);setAvailabilityDeadline(settingRes.data?.value??"");setAuditLogs(auditRes.data??[]);setMemberDirectory(memberRes.data??[]);setMemberProfile((memberRes.data??[]).find((x:any)=>x.user_id===session.user.id)??null);
    } catch(e) { setMessage(errorText(e)); }
    finally { setLoading(false); }
  }

  useEffect(()=>{if(profile) void loadData();},[profile]);

  async function submitAuth(e:FormEvent<HTMLFormElement>) {
    e.preventDefault(); if(!supabase)return; setMessage(""); setAuthLoading(true);
    const fd=new FormData(e.currentTarget);
    try {
      if(authMode==="signup") {
        const days=fd.getAll("cg_days").map(String);
        if(!days.length)throw new Error("Please select at least one CG day.");
        const leaderPhones=String(fd.get("leader_phone_numbers")||"").split(/[;,\n]/).map(x=>x.trim()).filter(Boolean);
        const meta={
          username:String(fd.get("username")).trim().toLowerCase(), full_name:String(fd.get("full_name")).trim(), email:String(fd.get("email")).trim(),
          gender:String(fd.get("gender")), date_of_birth:String(fd.get("date_of_birth")), nij:String(fd.get("nij")).trim(), phone_number:String(fd.get("phone_number")).trim(),
          domicile_area:String(fd.get("domicile_area")), domicile_other:String(fd.get("domicile_other")||""), cg_category:String(fd.get("cg_category")),
          cg_status:String(fd.get("cg_status")), cg_number:String(fd.get("cg_number")).trim(), cg_days:days, cg_time:String(fd.get("cg_time")),
          team_leader_name:String(fd.get("team_leader_name")||""), coach_name:String(fd.get("coach_name")||""), cg_leader_name:String(fd.get("cg_leader_name")||""), leader_phone_numbers:leaderPhones
        };
        if(meta.domicile_area==="Others"&&!meta.domicile_other.trim())throw new Error("Please specify your domicile area.");
        if(!leaderPhones.length)throw new Error("Enter at least one leader phone number.");
        if(meta.cg_status==="Team Leader")meta.team_leader_name="";
        if(meta.cg_status==="Coach")meta.coach_name="";
        if(meta.cg_status==="CG Leader")meta.cg_leader_name="";
        const {error}=await supabase.auth.signUp({email:meta.email,password:String(fd.get("password")),options:{data:meta}});
        if(error)throw error;
        setMessage("Registration submitted. Verify your email if confirmation is enabled, then sign in with your username.");
        setAuthMode("login");
      } else {
        const {data,error}=await supabase.functions.invoke("username-login",{body:{username:String(fd.get("username")).trim(),password:String(fd.get("password"))}});
        if(error)throw new Error("Username login is not configured yet. Deploy the username-login Edge Function and try again.");
        if(!data?.access_token||!data?.refresh_token)throw new Error(data?.error||"Invalid username or password.");
        const {error:sessionError}=await supabase.auth.setSession({access_token:data.access_token,refresh_token:data.refresh_token});
        if(sessionError)throw sessionError;
      }
    } catch(e){setMessage(errorText(e));}
    finally{setAuthLoading(false);}
  }

  async function sendPasswordReset(e:FormEvent<HTMLFormElement>) {
    e.preventDefault(); if(!supabase)return; setAuthLoading(true); setMessage("");
    const fd=new FormData(e.currentTarget); const recoveryEmail=String(fd.get("recovery_email")||"").trim();
    try { const {error}=await supabase.auth.resetPasswordForEmail(recoveryEmail,{redirectTo:`${window.location.origin}/`}); if(error)throw error; setMessage("If an account exists for that email, a password reset link has been sent. Please check your inbox."); }
    catch(e){setMessage(errorText(e));} finally{setAuthLoading(false);}
  }
  async function updateRecoveredPassword(e:FormEvent<HTMLFormElement>) {
    e.preventDefault(); if(!supabase)return; const fd=new FormData(e.currentTarget); const next=String(fd.get("new_password")||"");
    if(next.length<8){setMessage("Password must be at least 8 characters.");return;} setAuthLoading(true);setMessage("");
    try {const {error}=await supabase.auth.updateUser({password:next});if(error)throw error;setRecoveryMode(false);setMessage("Password updated. You can now continue using your new password.");}
    catch(e){setMessage(errorText(e));}finally{setAuthLoading(false);}
  }
  async function signOut(){await supabase?.auth.signOut();setProfile(null);setSession(null);}
  const isAdmin=profile?.role==="admin";
  const myServant=servants.find(p=>p.auth_user_id===session?.user?.id);

  const filtered=useMemo(()=>{
    const q=personFilter.trim().toLowerCase();
    return schedules.filter(s=>
      s.service_date>=today() &&
      (isAdmin || (s.status==="published" && !!myServant && s.assignments.some(a=>a.servant_id===myServant.id))) &&
      (!q||s.assignments.some(a=>a.servant_name.toLowerCase().includes(q))) &&
      (!locationFilter||s.location_id===locationFilter) &&
      (!serviceFilter||s.service_name===serviceFilter) &&
      (!fromDate||s.service_date>=fromDate) && (!toDate||s.service_date<=toDate)
    );
  },[schedules,personFilter,locationFilter,serviceFilter,fromDate,toDate,isAdmin,myServant?.id]);
  const dailyGroups=useMemo(()=>{
    const groups=new Map<string,ScheduleView[]>();
    for(const item of filtered){const current=groups.get(item.service_date)??[];current.push(item);groups.set(item.service_date,current);}
    return [...groups.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([date,items])=>({date,items}));
  },[filtered]);
  const calendarSections=useMemo(()=>{
    const buckets=new Map<string,{key:string;label:string;groups:typeof dailyGroups}>();
    for(const group of dailyGroups){
      const d=new Date(`${group.date}T12:00:00`);let key:string,label:string;
      if(calendarView==="month"){key=group.date.slice(0,7);label=d.toLocaleDateString("en-US",{month:"long",year:"numeric"});}
      else {const monday=new Date(d);monday.setDate(d.getDate()-((d.getDay()+6)%7));key=monday.toLocaleDateString("en-CA");const sunday=new Date(monday);sunday.setDate(monday.getDate()+6);label=`Week of ${monday.toLocaleDateString("en-US",{month:"short",day:"numeric"})} – ${sunday.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}`;}
      const existing=buckets.get(key)??{key,label,groups:[]};existing.groups.push(group);buckets.set(key,existing);
    }
    return [...buckets.values()];
  },[dailyGroups,calendarView]);

  async function saveSchedule(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();if(!supabase||!isAdmin)return;
    const fd=new FormData(e.currentTarget);
    const payload={service_date:String(fd.get("service_date")),location_id:String(fd.get("location_id")),service_name:String(fd.get("service_name")),start_time:String(fd.get("start_time")),end_time:String(fd.get("end_time")),status:editing?.status==="published"?"draft":editing?.status??"draft"};
    const selected:Record<Role,string>={FOH:String(fd.get("FOH")||""),Monitor:String(fd.get("Monitor")||""),Assistant:String(fd.get("Assistant")||"")};
    const chosen=Object.entries(selected).filter(([,id])=>id).map(([role,id])=>({role,id}));
    const duplicateInService=chosen.find((entry,index)=>chosen.some((other,j)=>j!==index&&other.id===entry.id));
    if(duplicateInService){setMessage("One servant cannot fill more than one role in the same service.");return;}
    const conflicts=chosen.map(entry=>({ ...entry, other:schedules.find(s=>s.service_date===payload.service_date&&s.location_id!==payload.location_id&&s.id!==editing?.id&&s.assignments.some(a=>a.servant_id===entry.id)) })).filter(x=>x.other);
    if(conflicts.length){const names=conflicts.map(c=>`${servants.find(p=>p.id===c.id)?.full_name??"A servant"} (${c.other?.location_name} · ${c.other?.service_name})`);setMessage(`Cannot save: ${names.join(", ")} already assigned at another church location on ${payload.service_date}.`);return;}
    const toMinutes=(t:string)=>Number(t.slice(0,2))*60+Number(t.slice(3,5));
    const overlaps=chosen.map(entry=>({ ...entry, other:schedules.find(s=>s.service_date===payload.service_date&&s.location_id===payload.location_id&&s.id!==editing?.id&&s.assignments.some(a=>a.servant_id===entry.id)&&toMinutes(payload.start_time)<toMinutes(s.end_time)&&toMinutes(payload.end_time)>toMinutes(s.start_time)) })).filter(x=>x.other);
    if(overlaps.length){setMessage(`Cannot save: ${overlaps.map(c=>servants.find(p=>p.id===c.id)?.full_name??"A servant").join(", ")} has an overlapping service at the same location.`);return;}
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
      const rows=ROLES.filter(r=>selected[r]).map(r=>({schedule_id:scheduleId,servant_id:selected[r],role:r,confirmation_status:"pending"}));
      if(rows.length){const {error}=await supabase.from("assignments").insert(rows);if(error)throw error;}
      setModal(null);setEditing(null);await loadData();
    }catch(e){setMessage(errorText(e));setLoading(false);}
  }

  async function generateWeekend(date:string,weeks=1) {
    if(!supabase||!isAdmin)return;
    const d=new Date(`${date}T12:00:00`);
    if(d.getDay()!==6){setMessage("Choose a Saturday to generate the weekend.");return;}
    const dates:{date:string;day:number}[]=[];
    for(let w=0;w<weeks;w++){const sat=new Date(d);sat.setDate(d.getDate()+w*7);const sun=new Date(sat);sun.setDate(sat.getDate()+1);dates.push({date:sat.toLocaleDateString("en-CA"),day:6},{date:sun.toLocaleDateString("en-CA"),day:0});}
    setLoading(true);setMessage("");
    try {
      const rows=dates.flatMap(x=>templates.filter(t=>Number(t.day_of_week)===x.day).map(t=>({
        service_date:x.date,location_id:t.location_id,service_name:t.service_name,start_time:t.start_time,end_time:t.end_time
      })));
      if(!rows.length)throw new Error("No service templates found. Check that the database setup SQL has been run.");
      const {error}=await supabase.from("schedules").upsert(rows,{onConflict:"service_date,location_id,service_name",ignoreDuplicates:true});
      if(error)throw error;
      await loadData();setMessage(`${weeks} weekend(s) generated. New services are drafts; assign servants and publish when ready.`);
    }catch(e){setMessage(errorText(e));setLoading(false);}
  }

  async function saveAvailability(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();if(!supabase)return;
    const form=e.currentTarget;
    const fd=new FormData(form);
    const linkedServant=servants.find(p=>p.auth_user_id===session?.user?.id);
    const row={servant_id:String(fd.get("servant_id")),service_date:String(fd.get("service_date")),status:String(fd.get("status")),notes:String(fd.get("notes")||"").trim()};
    if(!isAdmin&&availabilityDeadline&&today()>availabilityDeadline){setMessage(`The availability submission deadline (${fmtDate(availabilityDeadline)}) has passed. Please contact the administrator if you need to change your availability.`);return;}
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
  async function publishSchedule(s:ScheduleView){
    if(!supabase||!isAdmin)return;
    const {error}=await supabase.from("schedules").update({status:s.status==="published"?"draft":"published"}).eq("id",s.id);
    if(error)setMessage(error.message);else {setMessage(s.status==="published"?"Schedule moved back to draft.":"Schedule published. Servants can now see and confirm it.");await loadData();}
  }
  async function addLocation(){
    if(!supabase||!isAdmin)return;
    const name=prompt("Enter the new church location name:");if(!name?.trim())return;
    const {error}=await supabase.from("locations").insert({name:name.trim()});
    if(error)setMessage(error.message);else {setMessage("Church location added.");await loadData();}
  }
  async function addRecurringTemplate(){
    if(!supabase||!isAdmin)return;
    const locationName=prompt(`Choose a location:\n${locations.map(l=>l.name).join("\n")}`);if(!locationName)return;
    const location=locations.find(l=>l.name.toLowerCase()===locationName.trim().toLowerCase());if(!location){setMessage("Location not found. Add the church first.");return;}
    const day=prompt("Day of week: enter 6 for Saturday or 0 for Sunday:","0");if(day!=="0"&&day!=="6"){setMessage("Recurring templates currently support Saturday (6) and Sunday (0). Add weekday specials as individual services.");return;}
    const service_name=prompt("Service name:");if(!service_name?.trim())return;
    const start_time=prompt("Start time (HH:MM):","09:00");if(!start_time)return;
    const end_time=prompt("End time (HH:MM):","11:00");if(!end_time)return;
    const {error}=await supabase.from("service_templates").upsert({location_id:location.id,day_of_week:Number(day),service_name:service_name.trim(),start_time,end_time,active:true},{onConflict:"location_id,day_of_week,service_name"});
    if(error)setMessage(error.message);else {setMessage("Recurring service template saved.");await loadData();}
  }
  async function saveDeadline(e:FormEvent<HTMLFormElement>){
    e.preventDefault();if(!supabase||!isAdmin)return;
    const fd=new FormData(e.currentTarget);const value=String(fd.get("deadline")||"");
    const {error}=await supabase.from("system_settings").upsert({key:"availability_deadline",value,updated_by:session.user.id},{onConflict:"key"});
    if(error)setMessage(error.message);else {setAvailabilityDeadline(value);setMessage("Availability deadline updated.");}
  }
  async function submitServingRequest(schedule:ScheduleView,kind:"replacement"|"swap"){
    if(!supabase||!myServant)return;
    const own=schedule.assignments.find(a=>a.servant_id===myServant.id);if(!own)return;
    const note=prompt(kind==="replacement"?"Why do you need a replacement?":"Enter the full name of the servant you would like to swap with:");
    if(note===null)return;
    const {error}=await supabase.from("serving_requests").insert({schedule_id:schedule.id,assignment_id:schedule.assignments.find(a=>a.servant_id===myServant.id)?.id??null,requester_servant_id:myServant.id,request_type:kind,details:note.trim(),status:"pending"});
    if(error)setMessage(error.message);else {setMessage("Your request has been sent to the administrator.");await loadData();}
  }
  async function reviewRequest(request:any,approve:boolean){
    if(!supabase||!isAdmin)return;
    const {error}=await supabase.from("serving_requests").update({status:approve?"approved":"declined",reviewed_by:session.user.id,reviewed_at:new Date().toISOString()}).eq("id",request.id);
    if(error)setMessage(error.message);else {setMessage(approve?"Request approved. Please update the assignment if a replacement is needed.":"Request declined.");await loadData();}
  }
  async function confirmAssignment(schedule:ScheduleView,status:"confirmed"|"declined"){
    if(!supabase||!myServant)return;
    const assignment=(schedule.assignments as any[]).find(a=>a.servant_id===myServant.id);
    if(!assignment)return;
    const {error}=await supabase.from("assignments").update({confirmation_status:status}).eq("schedule_id",schedule.id).eq("servant_id",myServant.id);
    if(error)setMessage(error.message);else {setMessage(status==="confirmed"?"Serving assignment confirmed.":"Assignment declined. Please submit a replacement request if needed.");await loadData();}
  }
  async function exportScheduleHistory(){
    if(!supabase||!isAdmin)return;
    const {data,error}=await supabase.from("schedules").select("*,locations(name),assignments(role,servants(full_name))").lt("service_date",today()).order("service_date",{ascending:false});
    if(error){setMessage(error.message);return;}
    const rows=[["date","location","service","start","end","FOH","Monitor","Assistant"].join(","),...(data??[]).map((s:any)=>[s.service_date,s.locations?.name??"",s.service_name,shortTime(s.start_time),shortTime(s.end_time),...ROLES.map(r=>s.assignments?.find((a:any)=>a.role===r)?.servants?.full_name??"")].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(","))];
    const blob=new Blob([rows.join("\r\n")],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="gms-schedule-history.csv";a.click();URL.revokeObjectURL(url);
  }

  function exportCsv(){
    const rows=[["date","location","service","start","end","FOH","Monitor","Assistant"].join(","),
      ...filtered.map(s=>[s.service_date,s.location_name,s.service_name,shortTime(s.start_time),shortTime(s.end_time),...ROLES.map(r=>s.assignments.find(a=>a.role===r)?.servant_name??"")].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(","))];
    const blob=new Blob([rows.join("\r\n")],{type:"text/csv;charset=utf-8"});
    const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="gms-serving-schedule.csv";a.click();URL.revokeObjectURL(url);
  }

  if(!isSupabaseConfigured)return <SetupScreen/>;
  if(authLoading)return <div className="center-screen"><GmsLoader label={authMode==="reset"?"Preparing secure password recovery…":"Preparing your workspace…"}/></div>;
  if(recoveryMode && session)return <div className="auth-page"><div className="auth-card"><div className="brand-mark"><Church size={24}/></div><p className="eyebrow">GMS SOUND SCHEDULING SYSTEM</p><h1>Set a new password</h1><p className="subtle">Choose a new password for your account.</p><form onSubmit={updateRecoveredPassword} className="stack"><label>New password<input name="new_password" type="password" required minLength={8} autoComplete="new-password" placeholder="At least 8 characters"/></label><button className="btn primary full" disabled={authLoading}>{authLoading?<><span className="button-spinner"/> Updating password…</>:"Update password"}</button></form>{message&&<p className="message">{message}</p>}</div></div>;
  if(!session)return <div className="auth-page"><div className="auth-card"><div className="brand-mark"><Church size={24}/></div><p className="eyebrow">GMS SOUND SCHEDULING SYSTEM</p><h1>{authMode==="login"?"Welcome home":authMode==="signup"?"Create your account":"Reset your password"}</h1><p className="subtle">Serving schedule management for Alam Sutera, BSD and Karawaci.</p>
    {authMode==="reset"?<form onSubmit={sendPasswordReset} className="stack"><label>Registered email address<input name="recovery_email" type="email" required autoComplete="email" placeholder="you@example.com"/></label><button className="btn primary full" disabled={authLoading}>{authLoading?<><span className="button-spinner"/> Sending reset link…</>:"Send reset link"}</button><button type="button" className="link-btn" onClick={()=>{setAuthMode("login");setMessage("");}}>Back to sign in</button></form>:<form onSubmit={submitAuth} className="stack auth-registration">
      <label>Username<input name="username" required minLength={3} maxLength={40} pattern="[A-Za-z0-9._-]+" autoComplete="username" placeholder="Choose a username"/></label>
      {authMode==="signup"&&<>
        <label>Full name<input name="full_name" required placeholder="Full name as registered"/></label>
        <label>Email address<input name="email" type="email" required autoComplete="email" placeholder="you@example.com"/></label>
        <label>Gender<select name="gender" required defaultValue=""><option value="" disabled>Select gender</option><option>Male</option><option>Female</option><option>Prefer not to say</option></select></label>
        <label>Date of birth<input name="date_of_birth" type="date" required/></label>
        <label>NIJ – Nomor Induk Jemaat<input name="nij" required placeholder="Your NIJ"/></label>
        <label>Phone number<input name="phone_number" type="tel" required placeholder="e.g. +62812..."/></label>
        <label>Domicile area<select name="domicile_area" required defaultValue="Alam Sutera"><option>Alam Sutera</option><option>BSD</option><option>Karawaci</option><option>Others</option></select></label>
        <label>Other domicile area (if Others)<input name="domicile_other" placeholder="Specify area"/></label>
        <label>CG category<select name="cg_category" required defaultValue=""><option value="" disabled>Select CG</option>{["AOG Teen","AOG Youth","Young Adult","Family","Senior"].map(x=><option key={x}>{x}</option>)}</select></label>
        <label>CG status<select name="cg_status" required value={signupCgStatus} onChange={e=>setSignupCgStatus(e.target.value)}><option value="" disabled>Select status</option>{["Team Leader","Coach","CG Leader","Sponsor","Member"].map(x=><option key={x}>{x}</option>)}</select></label>
        <label>CG number<input name="cg_number" required/></label>
        <fieldset className="days-field"><legend>CG day (select multiple)</legend>{["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"].map(x=><label key={x}><input type="checkbox" name="cg_days" value={x}/>{x}</label>)}</fieldset>
        <label>CG time<input name="cg_time" required placeholder="e.g. 19:00"/></label>
        <label className={signupCgStatus==="Team Leader"?"field-disabled":""}>Team Leader name<input name="team_leader_name" disabled={signupCgStatus==="Team Leader"} placeholder="Not required if you are Team Leader"/></label>
        <label className={signupCgStatus==="Coach"?"field-disabled":""}>Coach name<input name="coach_name" disabled={signupCgStatus==="Coach"} placeholder="Not required if you are Coach"/></label>
        <label className={signupCgStatus==="CG Leader"?"field-disabled":""}>CG Leader name<input name="cg_leader_name" disabled={signupCgStatus==="CG Leader"} placeholder="Not required if you are CG Leader"/></label>
        <label>Leader phone number(s)<textarea name="leader_phone_numbers" required placeholder="At least one number; separate multiple numbers with commas" rows={2}/></label>
      </>}
      <label>Password<input name="password" type="password" required minLength={8} autoComplete={authMode==="login"?"current-password":"new-password"} placeholder="At least 8 characters"/></label>
      <button className="btn primary full" disabled={authLoading}>{authMode==="login"?"Sign in":"Create account"}</button>
    </form>}
    {authMode==="login"&&<button type="button" className="link-btn" onClick={()=>{setAuthMode("reset");setMessage("");}}>Forgot password?</button>}
    {authMode!=="reset"&&<button type="button" className="link-btn" onClick={()=>{setAuthMode(authMode==="login"?"signup":"login");setSignupCgStatus("");setMessage("");}}>{authMode==="login"?"Need an account? Sign up":"Already registered? Sign in"}</button>}
    {message&&<p className="message">{message}</p>}
  </div></div>;

  if(!profile)return <div className="center-screen"><GmsLoader label="Loading your profile…"/></div>;

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav?"open":""}`}>
      <div className="brand"><div className="brand-mark"><Church size={21}/></div><div><b>GMS Sound Scheduling</b><small>SOUND SCHEDULING SYSTEM</small></div></div>
      <div className="nav-label">WORKSPACE</div>
      <button className={`nav-item ${tab==="schedule"?"active":""}`} onClick={()=>{setTab("schedule");setMobileNav(false);}}><CalendarDays size={18}/> Schedule</button>
      <button className={`nav-item ${tab==="availability"?"active":""}`} onClick={()=>{setTab("availability");setMobileNav(false);}}><ClipboardCheck size={18}/> Availability</button>
      {!isAdmin&&<button className={`nav-item ${tab==="profile"?"active":""}`} onClick={()=>{setTab("profile");setMobileNav(false);}}><Users size={18}/> My profile</button>}
      {isAdmin&&<>
        <button className={`nav-item ${tab==="servantInfo"?"active":""}`} onClick={()=>{setTab("servantInfo");setMobileNav(false);}}><Users size={18}/> Servant Information</button>
        <button className={`nav-item ${tab==="statistics"?"active":""}`} onClick={()=>{setTab("statistics");setMobileNav(false);}}><BarChart3 size={18}/> Statistics</button>
        <button className={`nav-item ${tab==="audit"?"active":""}`} onClick={()=>{setTab("audit");setMobileNav(false);}}><ClipboardCheck size={18}/> Audit log</button>
      </>}
      <div className="sidebar-bottom"><div className="user-chip"><div className="avatar">{(profile.display_name||session.user.email||"G").slice(0,1).toUpperCase()}</div><div className="user-meta"><b>{profile.display_name||session.user.email}</b><small>{isAdmin?"Administrator":"Servant"}</small></div><button title="Sign out" className="icon-btn" onClick={signOut}><LogOut size={17}/></button></div></div>
    </aside>
    <div className="main-area">
      <header className="topbar"><button className="mobile-menu icon-btn" onClick={()=>setMobileNav(!mobileNav)}><Menu/></button><div><div className="eyebrow">GMS • CHURCH SERVING</div><h1>{tab==="schedule"?"Serving schedule":tab==="servantInfo"?"Servant Information":tab==="availability"?"Availability management":tab==="audit"?"Audit log":tab==="profile"?"My profile":"Serving statistics"}</h1></div><div className="top-actions"><span className="role-tag"><ShieldCheck size={14}/>{isAdmin?"Admin access":"View access"}</span><button className="icon-btn" onClick={loadData} title="Refresh"><RefreshCw size={17}/></button></div></header>
      <main className="content">
        {!isAdmin&&memberProfile&&((Date.now()-new Date(memberProfile.last_verified_at).getTime())>90*86400000)&&<div className="message-banner profile-reminder"><span><b>Profile verification reminder:</b> Please review your member information. It has been more than 3 months since your last verification.</span><button className="btn tiny secondary" onClick={()=>setTab("profile")}>Review profile</button></div>}{message&&<div className="message-banner"><span>{message}</span><button className="icon-btn" onClick={()=>setMessage("")}><X size={16}/></button></div>}
        {tab==="schedule"?<>
          <div className="toolbar"><div><h2>{isAdmin?"Serving assignments":"My serving schedule"}</h2><p className="subtle">{isAdmin?"Manage services across all church locations.":"Your published assignments and serving commitments."}</p></div><div className="toolbar-actions">{isAdmin&&<><button className="btn primary" onClick={()=>{setEditing(null);setModal("schedule");}}><Plus size={16}/> Add special service</button><button className="btn secondary" onClick={addLocation}><Plus size={16}/> Add church</button><button className="btn secondary" onClick={addRecurringTemplate}><Plus size={16}/> Add recurring service</button></>}<button className="btn secondary" onClick={exportCsv}><Download size={16}/> Export</button>{isAdmin&&<button className="btn secondary" onClick={()=>void exportScheduleHistory()}><Download size={16}/> History CSV</button>}</div></div>
          {isAdmin&&<div className="calendar-switch"><span>Calendar grouping</span><button className={calendarView==="week"?"selected":""} onClick={()=>setCalendarView("week")}>Weekly</button><button className={calendarView==="month"?"selected":""} onClick={()=>setCalendarView("month")}>Monthly</button></div>}
          <section className="stats-grid"><Stat label="VISIBLE SERVICES" value={filtered.length}/><Stat label="SERVANTS ASSIGNED" value={new Set(filtered.flatMap(s=>s.assignments.map(a=>a.servant_id))).size}/><Stat label="CHURCH LOCATIONS" value={new Set(filtered.map(s=>s.location_id)).size}/></section>
          <section className="filter-panel"><div className="filter-title"><Search size={17}/> <b>Filter schedule</b></div><div className="filters">
            <label className="search-field"><span>Servant name · any role</span><input value={personFilter} onChange={e=>setPersonFilter(e.target.value)} placeholder="Search servant name"/></label>
            <label><span>Church location</span><select value={locationFilter} onChange={e=>setLocationFilter(e.target.value)}><option value="">All locations</option>{locations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
            <label><span>Service</span><select value={serviceFilter} onChange={e=>setServiceFilter(e.target.value)}><option value="">All services</option>{[...new Set(schedules.map(s=>s.service_name))].sort().map(n=><option key={n}>{n}</option>)}</select></label>
            <label><span>From</span><input type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)}/></label>
            <label><span>To</span><input type="date" value={toDate} onChange={e=>setToDate(e.target.value)}/></label>
          </div><button className="clear-btn" onClick={()=>{setPersonFilter("");setLocationFilter("");setServiceFilter("");setFromDate("");setToDate("");}}>Clear all filters</button></section>
          <details className="collapsible-panel" open>
            <summary><span><b>{calendarView==="week"?"Weekly calendar":"Monthly calendar"} · Daily overview</b><small>{dailyGroups.length} days · summary by church location</small></span><ChevronDown size={20}/></summary>
            {calendarSections.length>0&&calendarSections.map(section=><section className="calendar-period" key={section.key}><h3>{section.label}</h3><div className="daily-overview">{section.groups.map(group=><DailySummary key={group.date} date={group.date} items={group.items}/>)}</div></section>)}
          </details>
          <details className="collapsible-panel service-panel" open>
            <summary><span><b>Service details</b><small>{filtered.length} service slots · expand a service to see assignments</small></span><ChevronDown size={20}/></summary>
            {loading?<div className="empty-state"><GmsLoader label="Loading schedule…"/></div>:filtered.length===0?<div className="empty-state"><CalendarDays size={30}/><b>No service slots found</b><p>Try changing your filters or generate a weekend schedule.</p></div>:
              <div className="schedule-grid">{filtered.map(s=><ScheduleCard key={s.id} item={s} isAdmin={isAdmin} onEdit={()=>{setEditing(s);setModal("schedule");}} onDelete={()=>deleteSchedule(s)} onPublish={()=>publishSchedule(s)} myServantId={myServant?.id??""} onConfirm={(status)=>confirmAssignment(s,status)} onRequest={(kind)=>submitServingRequest(s,kind)}/>)}</div>}
          </details>
          {isAdmin&&<><GeneratePanel onGenerate={generateWeekend}/><RequestsPanel requests={requests} schedules={schedules} servants={servants} onReview={reviewRequest}/></>}
        </>:tab==="servantInfo"?<ServantInformationPanel servants={servants} memberDirectory={memberDirectory} locations={locations} schedules={schedules} requests={requests} onAdd={()=>setModal("person")} onToggle={togglePerson}/>:tab==="availability"?<AvailabilityPanel servants={servants} availability={availability} isAdmin={isAdmin} currentUserId={session.user.id} onSave={saveAvailability} onDelete={deleteAvailability} deadline={availabilityDeadline} onSaveDeadline={saveDeadline}/>:tab==="statistics"?<StatisticsPanel schedules={filtered} servants={servants}/>:tab==="audit"?<AuditPanel logs={auditLogs}/>:(!isAdmin&&tab==="profile")?<MemberProfilePanel profile={memberProfile} isAdmin={false} directory={[]} onSave={async(payload)=>{if(!supabase)return;const {error}=await supabase.from("member_profiles").upsert({user_id:session.user.id,...payload,last_verified_at:new Date().toISOString(),updated_at:new Date().toISOString()},{onConflict:"user_id"});if(error){setMessage(error.message);return;}await supabase.from("profiles").update({display_name:payload.full_name}).eq("id",session.user.id);await supabase.from("servants").update({full_name:payload.full_name}).eq("auth_user_id",session.user.id);if(payload.email!==memberProfile.email){const {error:emailError}=await supabase.auth.updateUser({email:payload.email});if(emailError)setMessage("Profile saved, but email change needs attention: "+emailError.message);}setMessage("Profile updated and verification date refreshed.");await loadData();}}/>:null}
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

function Stat({label,value}:{label:string;value:number|string}){return <div className="stat-card"><span>{label}</span><b>{value}</b></div>;}
function ScheduleCard({item,isAdmin,onEdit,onDelete,onPublish,myServantId,onConfirm,onRequest}:{item:ScheduleView;isAdmin:boolean;onEdit:()=>void;onDelete:()=>void;onPublish:()=>void;myServantId:string;onConfirm:(status:"confirmed"|"declined")=>void;onRequest:(kind:"replacement"|"swap")=>void}){
 const own=item.assignments.find(a=>a.servant_id===myServantId);
 return <details className="schedule-card" open><summary className="schedule-card-summary"><div><div className="date-text">{fmtDate(item.service_date)} <span className={`status-chip ${item.status||"draft"}`}>{item.status||"draft"}</span></div><div className="location-text">{item.location_name}</div><div className="service-title">{item.service_name}</div><div className="time-text">{shortTime(item.start_time)} – {shortTime(item.end_time)}</div></div><ChevronDown size={19}/></summary>
  <div className="role-grid">{ROLES.map(r=>{const a=item.assignments.find(x=>x.role===r);return <div className={`role-box ${r==="Assistant"?"optional":""}`} key={r}><small>{r}{r==="Assistant"?" · optional":""}</small><b>{a?.servant_name??"Unassigned"}</b></div>;})}</div>
  {!isAdmin&&!!own&&<div className="servant-card-actions"><div className="confirmation-line">Your confirmation: <b>{own?.confirmation_status||"pending"}</b></div><button className="btn tiny primary" onClick={()=>onConfirm("confirmed")}>Confirm</button><button className="btn tiny secondary" onClick={()=>onConfirm("declined")}>Decline</button><button className="btn tiny secondary" onClick={()=>onRequest("replacement")}>Request replacement</button><button className="btn tiny secondary" onClick={()=>onRequest("swap")}>Request swap</button></div>}
  {isAdmin&&<div className="card-actions"><button className="btn tiny secondary" onClick={onEdit}><Pencil size={13}/> Edit</button><button className="btn tiny secondary" onClick={onPublish}>{item.status==="published"?"Unpublish":"Publish"}</button><button className="btn tiny danger" onClick={onDelete}><Trash2 size={13}/> Delete</button></div>}
 </details>;
}

function GeneratePanel({onGenerate}:{onGenerate:(date:string,weeks:number)=>void}){
 const [date,setDate]=useState(()=>{const d=new Date();d.setDate(d.getDate()+((6-d.getDay()+7)%7));return d.toLocaleDateString("en-CA");});const [weeks,setWeeks]=useState(1);
 return <section className="generate-panel"><div><b>Bulk generate recurring weekend slots</b><p className="subtle">Creates recurring Saturday and Sunday services for all active locations. Existing slots remain unchanged.</p></div><div className="generate-controls"><input type="date" value={date} onChange={e=>setDate(e.target.value)}/><select value={weeks} onChange={e=>setWeeks(Number(e.target.value))}><option value={1}>1 weekend</option><option value={2}>2 weekends</option><option value={4}>4 weekends</option><option value={8}>8 weekends</option><option value={12}>12 weekends</option></select><button className="btn primary" onClick={()=>onGenerate(date,weeks)}><CalendarDays size={16}/> Generate</button></div></section>;
}
function ScheduleModal({locations,servants,editing,onClose,onSave}:{locations:Location[];servants:Servant[];editing:ScheduleView|null;onClose:()=>void;onSave:(e:FormEvent<HTMLFormElement>)=>void}){
 const existing=(role:Role)=>editing?.assignments.find(a=>a.role===role)?.servant_id??"";
 return <div className="modal-backdrop"><form className="modal-card" onSubmit={onSave}><div className="modal-head"><div><h2>{editing?"Edit service assignment":"Add service assignment"}</h2><p className="subtle">Add a regular or special service on any date, including weekdays. FOH and Monitor are required; Assistant is optional.</p></div><button type="button" className="icon-btn" onClick={onClose}><X/></button></div>
  <div className="form-grid"><label>Date<input name="service_date" type="date" required defaultValue={editing?.service_date??today()}/></label><label>Location<select name="location_id" required defaultValue={editing?.location_id??locations[0]?.id}>{locations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
   <label className="wide">Service name<input name="service_name" required defaultValue={editing?.service_name??""} placeholder="e.g. Special Service, Christmas, Prayer Meeting"/></label><label>Start time<input name="start_time" type="time" required defaultValue={shortTime(editing?.start_time??"09:00")}/></label><label>End time<input name="end_time" type="time" required defaultValue={shortTime(editing?.end_time??"11:00")}/></label>
   {ROLES.map(r=><label className="wide" key={r}>{r}{r==="Assistant"?" (optional)":" (required)"}<select name={r} required={r!=="Assistant"} defaultValue={existing(r)}><option value="">{r==="Assistant"?"Not assigned":"Select servant"}</option>{servants.map(p=><option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>)}
  </div><div className="modal-actions"><button type="button" className="btn secondary" onClick={onClose}>Cancel</button><button className="btn primary">Save assignment</button></div>
 </form></div>;
}
function PersonModal({onClose,onSave}:{onClose:()=>void;onSave:(e:FormEvent<HTMLFormElement>)=>void}){
 return <div className="modal-backdrop"><form className="modal-card compact" onSubmit={onSave}><div className="modal-head"><h2>Add servant</h2><button type="button" className="icon-btn" onClick={onClose}><X/></button></div><label>Full name<input name="full_name" required autoFocus placeholder="Servant's full name"/></label><div className="modal-actions"><button type="button" className="btn secondary" onClick={onClose}>Cancel</button><button className="btn primary">Add person</button></div></form></div>;
}
function GmsLoader({label="Getting the sound system ready…"}:{label?:string}){
 return <div className="gms-loader-screen" role="status" aria-live="polite" aria-label={label}>
  <div className="gms-loader-panel">
   <p className="gms-loader-brand">GMS Sound Scheduling System</p>
   <div className="gms-equalizer" aria-hidden="true">
    {[34,58,82,100,82,58,34].map((height,index)=><span key={index} style={{"--bar-height":`${height}%`,"--bar-delay":`${index*90}ms`} as CSSProperties}/>) }
   </div>
   <h2>{label}</h2>
   <p className="gms-loader-caption">Animated equalizer loading experience</p>
   <div className="gms-loader-divider"/>
   <p className="gms-loader-footnote">Also includes animated page transitions, schedule-loading animation and reduced-motion accessibility support.</p>
  </div>
 </div>;
}
function ServantInformationPanel({servants,memberDirectory,locations,schedules,requests,onAdd,onToggle}:{servants:Servant[];memberDirectory:any[];locations:Location[];schedules:ScheduleView[];requests:any[];onAdd:()=>void;onToggle:(p:Servant)=>void}){
 const [query,setQuery]=useState(""); const [locationFilter,setLocationFilter]=useState(""); const [cgFilter,setCgFilter]=useState(""); const [statusFilter,setStatusFilter]=useState("");
 const [openSummary,setOpenSummary]=useState({overview:true,church:true,cg:true,leadership:false,health:false});
 const [expanded,setExpanded]=useState<string[]>([]);
 const profiles=new Map(memberDirectory.map((m:any)=>[m.user_id,m]));
 const rows=servants.map(s=>({servant:s,profile:profiles.get(s.auth_user_id) as any}));
 const value=(r:any,k:string)=>r.profile?.[k]??r.servant?.[k]??"";
 const linked=rows.filter(r=>!!r.servant.auth_user_id).length;
 const verified=rows.filter(r=>r.profile?.last_verified_at && Date.now()-new Date(r.profile.last_verified_at).getTime()<=90*86400000).length;
 const overdue=rows.filter(r=>!r.profile?.last_verified_at || Date.now()-new Date(r.profile.last_verified_at).getTime()>90*86400000).length;
 const missingPhone=rows.filter(r=>!value(r,"phone_number")).length;
 const missingCg=rows.filter(r=>!value(r,"cg_category")||!value(r,"cg_number")||!value(r,"cg_status")).length;
 const countBy=(fn:(r:any)=>string)=>{const m=new Map<string,number>();rows.forEach(r=>{const k=fn(r)||"Not recorded";m.set(k,(m.get(k)||0)+1)});return [...m.entries()].sort((a,b)=>b[1]-a[1]);};
 const servantLocationNames=(servantId:string)=>[...new Set(schedules.filter(sc=>sc.assignments.some(a=>a.servant_id===servantId)).map(sc=>sc.location_name).filter(Boolean))];
 const churchCounts=locations.map(l=>[l.name,rows.filter(r=>servantLocationNames(r.servant.id).includes(l.name)).length] as [string,number]).filter(([,n])=>n>0).sort((a,b)=>b[1]-a[1]);
 const unassignedLocationCount=rows.filter(r=>servantLocationNames(r.servant.id).length===0).length;
 if(unassignedLocationCount)churchCounts.push(["No serving assignment",unassignedLocationCount]);
 const cgCounts=countBy(r=>value(r,"cg_category")); const roleCounts=countBy(r=>value(r,"cg_status")); const domicileCounts=countBy(r=>value(r,"domicile_area"));
 const filtered=rows.filter(r=>{const hay=[r.servant.full_name,r.profile?.email,r.profile?.username,value(r,"cg_number"),value(r,"cg_category"),value(r,"phone_number")].join(" ").toLowerCase();return (!query||hay.includes(query.toLowerCase()))&&(!locationFilter||servantLocationNames(r.servant.id).some(name=>locations.find(l=>l.id===locationFilter)?.name===name))&&(!cgFilter||value(r,"cg_category")===cgFilter)&&(!statusFilter||(statusFilter==="linked"?!!r.servant.auth_user_id:statusFilter==="unlinked"?!r.servant.auth_user_id:r.servant.active));});
 const toggle=(id:string)=>setExpanded(v=>v.includes(id)?v.filter(x=>x!==id):[...v,id]);
 const section=(key:keyof typeof openSummary,title:string,sub:string,body:ReactNode)=><details className="servant-summary-section" open={openSummary[key]} onToggle={e=>setOpenSummary(v=>({...v,[key]:(e.currentTarget as HTMLDetailsElement).open}))}><summary><span><b>{title}</b><small>{sub}</small></span><ChevronDown size={18}/></summary><div className="servant-summary-body">{body}</div></details>;
 const bars=(items:[string,number][])=> <div className="servant-bars">{items.map(([name,n])=><div className="servant-bar-row" key={name}><div><span>{name}</span><b>{n} <small>({rows.length?Math.round(n/rows.length*100):0}%)</small></b></div><div className="servant-bar-track"><i style={{width:`${rows.length?n/rows.length*100:0}%`}}/></div></div>)}</div>;
 return <div className="servant-info-page">
  <div className="toolbar"><div><h2>Servant Information</h2><p className="subtle">A complete overview of the serving community, CG structure and profile readiness.</p></div><button className="btn primary" onClick={onAdd}><Plus size={16}/> Add servant</button></div>
  <div className="servant-kpi-grid"><div className="servant-kpi"><span>TOTAL SERVANTS</span><b>{rows.length}</b><small>All registered servant records</small></div><div className="servant-kpi"><span>ACTIVE SERVANTS</span><b>{rows.filter(r=>r.servant.active).length}</b><small>Currently eligible for scheduling</small></div><div className="servant-kpi"><span>LINKED ACCOUNTS</span><b>{linked} <small>/ {rows.length}</small></b><small>{rows.length?Math.round(linked/rows.length*100):0}% connected to login</small></div><div className="servant-kpi"><span>PROFILE FOLLOW-UP</span><b>{overdue}</b><small>{verified} verified within 90 days</small></div></div>
  {section("overview","1. Servant overview","Account access, active status and profile verification",<div className="servant-mini-grid"><div><b>{rows.length-linked}</b><span>Not linked to login</span></div><div><b>{rows.filter(r=>!r.servant.active).length}</b><span>Inactive servants</span></div><div><b>{missingPhone}</b><span>Missing phone number</span></div><div><b>{missingCg}</b><span>Incomplete CG information</span></div><div><b>{requests.filter((x:any)=>x.status==="pending").length}</b><span>Pending serving requests</span></div><div><b>{schedules.filter(s=>s.status==="published").length}</b><span>Published services</span></div></div>)}
  {section("church","2. Church distribution","Servants by assigned serving location",bars(churchCounts))}
  {section("cg","3. CG distribution","Servants by community group and domicile",<div className="servant-two-col"><div><h4>CG category</h4>{bars(cgCounts)}</div><div><h4>Domicile area</h4>{bars(domicileCounts)}</div></div>)}
  {section("leadership","4. CG leadership structure","Team Leader, Coach, CG Leader, Sponsor and Member roles",bars(roleCounts))}
  {section("health","5. Profile health","Records requiring follow-up or verification",<div className="servant-health-list"><div><span>Verified within 90 days</span><b>{verified}</b></div><div><span>Verification overdue / not recorded</span><b>{overdue}</b></div><div><span>Missing phone number</span><b>{missingPhone}</b></div><div><span>Missing CG information</span><b>{missingCg}</b></div></div>)}
  <div className="servant-directory-block"><div className="servant-directory-heading"><div><h3>Detailed servant information</h3><p className="subtle">Expand an individual record to view personal, CG, leadership and account details.</p></div><b>{filtered.length} records</b></div>
   <div className="servant-filters"><input aria-label="Search servant" placeholder="Search name, username, email, phone or CG" value={query} onChange={e=>setQuery(e.target.value)}/><select value={locationFilter} onChange={e=>setLocationFilter(e.target.value)}><option value="">All locations</option>{locations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select><select value={cgFilter} onChange={e=>setCgFilter(e.target.value)}><option value="">All CG categories</option>{["AOG Teen","AOG Youth","Young Adult","Family","Senior"].map(x=><option key={x}>{x}</option>)}</select><select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="">All accounts/status</option><option value="linked">Linked account</option><option value="unlinked">Not linked</option><option value="active">Active only</option></select></div>
   <div className="servant-record-list">{filtered.map(({servant:s,profile:m})=><article className="servant-record" key={s.id}><button className="servant-record-summary" onClick={()=>toggle(s.id)}><span className="servant-avatar">{s.full_name.slice(0,1).toUpperCase()}</span><span className="servant-record-name"><b>{s.full_name}</b><small>{value({servant:s,profile:m},"cg_category")||"CG not recorded"} · {servantLocationNames(s.id).join(", ")||"No serving assignment"}</small></span><span className={`servant-account-chip ${s.auth_user_id?"linked":"unlinked"}`}>{s.auth_user_id?"Linked":"Not linked"}</span><ChevronDown size={18}/></button>
    {expanded.includes(s.id)&&<div className="servant-record-detail"><div><h4>Personal information</h4><p><b>Email:</b> {m?.email||"—"}</p><p><b>Gender:</b> {value({servant:s,profile:m},"gender")||"—"}</p><p><b>Date of birth:</b> {value({servant:s,profile:m},"date_of_birth")||"—"}</p><p><b>NIJ:</b> {value({servant:s,profile:m},"nij")||"—"}</p><p><b>Phone:</b> {value({servant:s,profile:m},"phone_number")||"—"}</p><p><b>Domicile:</b> {[value({servant:s,profile:m},"domicile_area"),value({servant:s,profile:m},"domicile_other")].filter(Boolean).join(" · ")||"—"}</p></div><div><h4>CG information</h4><p><b>Category:</b> {value({servant:s,profile:m},"cg_category")||"—"}</p><p><b>Status:</b> {value({servant:s,profile:m},"cg_status")||"—"}</p><p><b>CG number:</b> {value({servant:s,profile:m},"cg_number")||"—"}</p><p><b>Days:</b> {(value({servant:s,profile:m},"cg_days")||[]).join?.(", ")||"—"}</p><p><b>Time:</b> {value({servant:s,profile:m},"cg_time")||"—"}</p></div><div><h4>Leadership & account</h4><p><b>Team Leader:</b> {value({servant:s,profile:m},"team_leader_name")||"—"}</p><p><b>Coach:</b> {value({servant:s,profile:m},"coach_name")||"—"}</p><p><b>CG Leader:</b> {value({servant:s,profile:m},"cg_leader_name")||"—"}</p><p><b>Leader phone(s):</b> {(value({servant:s,profile:m},"leader_phone_numbers")||[]).join?.(", ")||"—"}</p><p><b>Account:</b> {m?.username||"No username linked"}</p><p><b>Profile verified:</b> {m?.last_verified_at?new Date(m.last_verified_at).toLocaleDateString():"Not yet verified"}</p><p><b>Serving status:</b> {s.active?"Active":"Inactive"}</p>{<button className={`btn tiny ${s.active?"secondary":"primary"}`} onClick={()=>onToggle(s)}>{s.active?"Deactivate servant":"Activate servant"}</button>}</div></div>}
   </article>)}</div>
  </div>
 </div>;
}

function PeoplePanel({servants,isAdmin,onAdd,onToggle}:{servants:Servant[];isAdmin:boolean;onAdd:()=>void;onToggle:(p:Servant)=>void}){
 const [q,setQ]=useState("");
 const rows=servants.filter(p=>p.full_name.toLowerCase().includes(q.toLowerCase()));
 return <><div className="toolbar"><div><h2>Servant directory</h2><p className="subtle">Manage the names available for role assignments.</p></div>{isAdmin&&<button className="btn primary" onClick={onAdd}><Plus size={16}/> Add servant</button>}</div><section className="filter-panel"><label className="search-field"><span>Search people</span><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search by name"/></label></section><div className="people-list">{rows.map(p=><div className="person-row" key={p.id}><div className="avatar">{p.full_name.slice(0,1).toUpperCase()}</div><div className="person-name"><b>{p.full_name}</b><small>{p.active?"Active":"Inactive"}</small></div>{isAdmin&&<button className={`btn tiny ${p.active?"secondary":"primary"}`} onClick={()=>onToggle(p)}>{p.active?"Deactivate":"Activate"}</button>}</div>)}</div></>;
}
function AvailabilityPanel({servants,availability,isAdmin,currentUserId,onSave,onDelete,deadline,onSaveDeadline}:{servants:Servant[];availability:any[];isAdmin:boolean;currentUserId:string;onSave:(e:FormEvent<HTMLFormElement>)=>void;onDelete:(id:string)=>void;deadline:string;onSaveDeadline:(e:FormEvent<HTMLFormElement>)=>void}){
 const [dateFilter,setDateFilter]=useState("");
 const myServant=servants.find(p=>p.auth_user_id===currentUserId);
 const rows=availability.filter(a=>(isAdmin||a.servant_id===myServant?.id)&&(!dateFilter||a.service_date===dateFilter)).sort((a,b)=>a.service_date.localeCompare(b.service_date));
 const name=(id:string)=>servants.find(p=>p.id===id)?.full_name??"Unknown servant";
 return <><div className="toolbar"><div><h2>{isAdmin?"Servant availability":"My availability"}</h2><p className="subtle">{isAdmin?"Manage availability records for the serving team.":"Mark the dates when you can or cannot serve."}</p></div></div>
  {deadline&&<div className="message-banner"><span>Availability submission deadline: <b>{fmtDate(deadline)}</b>{new Date(`${deadline}T23:59:59`).getTime()>=Date.now()?` · ${Math.ceil((new Date(`${deadline}T23:59:59`).getTime()-Date.now())/86400000)} day(s) remaining`:" · Deadline passed"}</span></div>}
  {isAdmin&&<section className="availability-form-panel"><h3>Set availability deadline</h3><form className="availability-form" onSubmit={onSaveDeadline}><label>Submission deadline<input type="date" name="deadline" defaultValue={deadline}/></label><button className="btn secondary">Save deadline</button></form></section>}
  {(isAdmin||myServant)&&<section className="availability-form-panel"><h3>{isAdmin?"Record servant availability":"Update my availability"}</h3><form className="availability-form" onSubmit={onSave}>
   {isAdmin?<label>Servant<select name="servant_id" required defaultValue=""> <option value="" disabled>Select servant</option>{servants.filter(p=>p.active).map(p=><option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>:<><input type="hidden" name="servant_id" value={myServant!.id}/><div className="availability-self-name"><span>Servant</span><b>{myServant!.full_name}</b></div></>}
   <label>Date<input name="service_date" type="date" required defaultValue={today()}/></label><label>Status<select name="status" defaultValue="available"><option value="available">Available</option><option value="unavailable">Unavailable</option><option value="prefer_not">Prefer not to serve</option></select></label><label className="availability-notes">Notes (optional)<input name="notes" placeholder="e.g. only available in the morning"/></label><button className="btn primary">Save availability</button></form><p className="subtle availability-note">One status per person per date. Saving again updates the existing entry.</p></section>}
  {!isAdmin&&!myServant&&<div className="message-banner"><span>Your login is not linked to a servant directory profile yet. Please ask a GMS administrator to link your account before submitting availability.</span></div>}
  <section className="filter-panel availability-filter"><label><span>Filter by date</span><input type="date" value={dateFilter} onChange={e=>setDateFilter(e.target.value)}/></label><button className="clear-btn" onClick={()=>setDateFilter("")}>Clear date</button></section>
  <div className="list-heading"><h2>{isAdmin?"Availability records":"My availability records"}</h2><span>{rows.length} records</span></div>
  {rows.length===0?<div className="empty-state"><ClipboardCheck size={28}/><b>No availability records</b><p>Add a record above to help coordinators plan assignments.</p></div>:<div className="people-list">{rows.map(a=><div className="availability-row" key={a.id}><div className="availability-date">{fmtDate(a.service_date)}</div><div className="availability-person"><b>{name(a.servant_id)}</b><small>{a.notes||"No notes"}</small></div><span className={`availability-status ${a.status}`}>{a.status==="prefer_not"?"Prefer not to serve":a.status}</span>{(isAdmin||a.servant_id===myServant?.id)&&<button className="icon-btn" title="Delete record" onClick={()=>onDelete(a.id)}><Trash2 size={16}/></button>}</div>)}</div>}
 </>;
}

function RequestsPanel({requests,schedules,servants,onReview}:{requests:any[];schedules:ScheduleView[];servants:Servant[];onReview:(request:any,approve:boolean)=>void}){
 const pending=requests.filter(r=>r.status==="pending");
 return <section className="requests-panel"><div className="list-heading"><h2>Servant requests</h2><span>{pending.length} pending</span></div>{requests.length===0?<p className="subtle">No replacement or swap requests yet.</p>:<div className="people-list">{requests.map(r=>{const service=schedules.find(s=>s.id===r.schedule_id);const person=servants.find(p=>p.id===r.requester_servant_id);return <div className="request-row" key={r.id}><div className="request-main"><b>{person?.full_name??"Servant"} · {r.request_type}</b><small>{service?`${fmtDate(service.service_date)} · ${service.location_name} · ${service.service_name}`:"Schedule unavailable"}</small><small>{r.details||"No details provided"}</small><span className={`status-chip ${r.status}`}>{r.status}</span></div>{r.status==="pending"&&<div className="request-actions"><button className="btn tiny primary" onClick={()=>onReview(r,true)}>Approve</button><button className="btn tiny secondary" onClick={()=>onReview(r,false)}>Decline</button></div>}</div>;})}</div>}</section>;
}

function AuditPanel({logs}:{logs:any[]}){
 return <><div className="toolbar"><div><h2>System audit trail</h2><p className="subtle">Recent schedule and assignment changes, including who made them.</p></div></div>{logs.length===0?<div className="empty-state"><ClipboardCheck size={28}/><b>No audit activity yet</b><p>Changes to schedules and assignments will appear here.</p></div>:<div className="people-list">{logs.map(log=><div className="audit-row" key={log.id}><div><b>{log.action} · {log.table_name}</b><small>Record: {log.record_id}</small><small>{new Date(log.created_at).toLocaleString()}</small></div><span>{log.actor_id?`User ${String(log.actor_id).slice(0,8)}`:"System"}</span></div>)}</div>}</>;
}

function StatisticsPanel({schedules,servants}:{schedules:ScheduleView[];servants:Servant[]}){
 const counts=new Map<string,{total:number;FOH:number;Monitor:number;Assistant:number}>();
 for(const s of schedules)for(const a of s.assignments){const c=counts.get(a.servant_id)??{total:0,FOH:0,Monitor:0,Assistant:0};c.total++;c[a.role]++;counts.set(a.servant_id,c);}
 const rows=servants.filter(p=>p.active).map(p=>{const c=counts.get(p.id)??{total:0,FOH:0,Monitor:0,Assistant:0};return {id:p.id,name:p.full_name,...c};}).sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name));
 const totalAssignments=rows.reduce((n,r)=>n+r.total,0);const filledRequired=schedules.reduce((n,s)=>n+s.assignments.filter(a=>a.role!=="Assistant").length,0);const requiredSlots=schedules.length*2;
 const allConfirmations=schedules.flatMap(s=>s.assignments);const confirmed=allConfirmations.filter(a=>a.confirmation_status==="confirmed").length;const declined=allConfirmations.filter(a=>a.confirmation_status==="declined").length;const confirmationRate=allConfirmations.length?Math.round(confirmed/allConfirmations.length*100):0;const activeServants=servants.filter(p=>p.active).length;const notScheduled=Math.max(0,activeServants-rows.filter(r=>r.total>0).length);
 const locationCounts=new Map<string,number>();for(const s of schedules)locationCounts.set(s.location_name,(locationCounts.get(s.location_name)??0)+s.assignments.length);
 return <><div className="toolbar"><div><h2>Serving statistics</h2><p className="subtle">Based on the currently selected schedule filters.</p></div></div>
  <section className="stats-grid stats-grid-wide"><Stat label="TOTAL ASSIGNMENTS" value={totalAssignments}/><Stat label="REQUIRED ROLES FILLED" value={filledRequired}/><Stat label="REQUIRED ROLE GAPS" value={Math.max(0,requiredSlots-filledRequired)}/><Stat label="SERVANTS ASSIGNED" value={rows.length}/><Stat label="CONFIRMATION RATE" value={`${confirmationRate}%`}/><Stat label="DECLINED ASSIGNMENTS" value={declined}/><Stat label="ACTIVE SERVANTS NOT SCHEDULED" value={notScheduled}/></section>
  <section className="filter-panel"><div className="filter-title"><BarChart3 size={17}/><b>Assignments by church location</b></div><div className="location-stat-list">{[...locationCounts.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([name,count])=><div className="location-stat" key={name}><span>{name}</span><b>{count}</b></div>)}</div></section>
  <section className="filter-panel fairness-panel"><div className="filter-title"><ShieldCheck size={17}/><b>Fairness checker</b></div><p className="subtle">Workload comparison for the selected date range. Use this as a review aid, not a performance ranking.</p><div className="fairness-metrics"><div><small>Average assignments</small><b>{rows.length?(totalAssignments/rows.length).toFixed(1):"0"}</b></div><div><small>Highest workload</small><b>{rows[0]?.total??0}</b></div><div><small>Lowest workload</small><b>{rows.length?Math.min(...rows.map(r=>r.total)):0}</b></div></div>{rows.length>1&&rows[0].total-Math.min(...rows.map(r=>r.total))>=3&&<div className="fairness-alert">Workload difference is 3 or more assignments. Consider reviewing upcoming assignments and availability.</div>}</section>
  <div className="list-heading"><h2>Assignments by servant</h2><span>{rows.length} servants</span></div>
  <div className="stats-table-wrap"><table className="stats-table"><thead><tr><th>Servant</th><th>Total</th><th>FOH</th><th>Monitor</th><th>Assistant</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td><b>{r.name}</b></td><td>{r.total}</td><td>{r.FOH}</td><td>{r.Monitor}</td><td>{r.Assistant}</td></tr>)}</tbody></table></div>
 </>;
}

function MemberProfilePanel({profile,isAdmin,directory,onSave}:{profile:any;isAdmin:boolean;directory:any[];onSave:(payload:any)=>Promise<void>}){
 const [saving,setSaving]=useState(false);
 const current=profile??{full_name:"",email:"",gender:"Prefer not to say",date_of_birth:"",nij:"",phone_number:"",domicile_area:"Alam Sutera",domicile_other:"",cg_category:"AOG Youth",cg_status:"Member",cg_number:"",cg_days:[],cg_time:"",team_leader_name:"",coach_name:"",cg_leader_name:"",leader_phone_numbers:[],last_verified_at:new Date().toISOString()};
 const days=["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
 return <><section className="availability-form-panel"><div className="toolbar"><div><h2>{profile?"My member information":"Complete your member profile"}</h2><p className="subtle">{profile?"You can update these details at any time. Please verify them every three months.":"Complete your member information to finish setting up your account."}</p></div></div>
 <div className="message-banner">Last verified: <b>{profile?new Date(current.last_verified_at).toLocaleDateString():"Not yet verified"}</b>{!profile?" · Complete the form below.":(Date.now()-new Date(current.last_verified_at).getTime())>90*86400000?" · Please review your information now.":" · Next review is due in 3 months."}</div>
 <form className="profile-edit-grid" onSubmit={async e=>{e.preventDefault();setSaving(true);const fd=new FormData(e.currentTarget);const phones=String(fd.get("leader_phone_numbers")||"").split(/[;,\n]/).map(x=>x.trim()).filter(Boolean);await onSave({full_name:String(fd.get("full_name")),email:String(fd.get("email")),gender:String(fd.get("gender")),date_of_birth:String(fd.get("date_of_birth")),nij:String(fd.get("nij")),phone_number:String(fd.get("phone_number")),domicile_area:String(fd.get("domicile_area")),domicile_other:String(fd.get("domicile_other")||""),cg_category:String(fd.get("cg_category")),cg_status:String(fd.get("cg_status")),cg_number:String(fd.get("cg_number")),cg_days:fd.getAll("cg_days").map(String),cg_time:String(fd.get("cg_time")),team_leader_name:String(fd.get("team_leader_name")||""),coach_name:String(fd.get("coach_name")||""),cg_leader_name:String(fd.get("cg_leader_name")||""),leader_phone_numbers:phones});setSaving(false);}}>
 {([['Full name','full_name'],['Email address','email'],['NIJ – Nomor Induk Jemaat','nij'],['Phone number','phone_number'],['Date of birth','date_of_birth'],['CG number','cg_number'],['CG time','cg_time'],['Team Leader name','team_leader_name'],['Coach name','coach_name'],['CG Leader name','cg_leader_name'],['Leader phone number(s)','leader_phone_numbers']] as const).map(([label,key])=><label key={key}>{label}{key==='leader_phone_numbers'?<textarea name={key} rows={2} defaultValue={(current[key]??[]).join(', ')}/>:<input name={key} type={key==='date_of_birth'?'date':'text'} defaultValue={key==='date_of_birth'?String(current[key]??'').slice(0,10):current[key]??''} required={!['team_leader_name','coach_name','cg_leader_name'].includes(key)}/>}</label>)}
 <label>Gender<select name="gender" defaultValue={current.gender}><option>Male</option><option>Female</option><option>Prefer not to say</option></select></label>
 <label>Domicile area<select name="domicile_area" defaultValue={current.domicile_area}>{['Alam Sutera','BSD','Karawaci','Others'].map(x=><option key={x}>{x}</option>)}</select></label>
 <label>Other domicile area<input name="domicile_other" defaultValue={current.domicile_other??''}/></label>
 <label>CG category<select name="cg_category" defaultValue={current.cg_category}>{['AOG Teen','AOG Youth','Young Adult','Family','Senior'].map(x=><option key={x}>{x}</option>)}</select></label>
 <label>CG status<select name="cg_status" defaultValue={current.cg_status}>{['Team Leader','Coach','CG Leader','Sponsor','Member'].map(x=><option key={x}>{x}</option>)}</select></label>
 <fieldset className="days-field"><legend>CG days</legend>{days.map(d=><label key={d}><input type="checkbox" name="cg_days" value={d} defaultChecked={(current.cg_days??[]).includes(d)}/>{d}</label>)}</fieldset>
 <button className="btn primary" disabled={saving}>{saving?'Saving…':'Save and verify profile'}</button>
 </form></section>
 {isAdmin&&<section className="availability-form-panel"><h2>Member profile overview (admin only)</h2><p className="subtle">Personal information is visible only to administrators and the member concerned.</p><div className="stats-table-wrap"><table className="stats-table"><thead><tr><th>Name</th><th>NIJ</th><th>Domicile</th><th>CG</th><th>Status</th><th>Phone</th></tr></thead><tbody>{directory.map(p=><tr key={p.user_id}><td>{p.full_name}</td><td>{p.nij}</td><td>{p.domicile_area}{p.domicile_other?` · ${p.domicile_other}`:''}</td><td>{p.cg_category} · {p.cg_number}</td><td>{p.cg_status}</td><td>{p.phone_number}</td></tr>)}</tbody></table></div></section>}</>;
}

function SetupScreen(){
 return <div className="auth-page"><div className="auth-card setup-card"><div className="brand-mark"><Church size={24}/></div><p className="eyebrow">GMS SOUND SCHEDULING SYSTEM</p><h1>Connect your Supabase project</h1><p className="subtle">The app is ready. Add your Supabase project credentials to enable shared login and scheduling.</p><ol><li>Create a Supabase project.</li><li>Run <code>supabase/schema.sql</code> in the SQL Editor.</li><li>Copy <code>.env.example</code> to <code>.env</code> and fill in your Project URL and anon/publishable key.</li><li>Restart the development server.</li></ol><p className="message">No database password or service-role key is needed in this frontend.</p></div></div>;
}
