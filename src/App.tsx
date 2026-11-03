import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent, ReactNode } from "react";
import { CalendarDays, Church, AudioLines, Users, Search, Plus, LogOut, Pencil, Trash2, Download, RefreshCw, ShieldCheck, X, Menu, ChevronDown, BarChart3, ClipboardCheck, AlertTriangle, Inbox as InboxIcon, UserRound, MoreHorizontal, Info, Bell, Smartphone, Clock3, MapPin, WifiOff } from "lucide-react";
import { supabase, isSupabaseConfigured } from "./supabase";
import type { Assignment, Location, Profile, Role, Schedule, ScheduleView, Servant } from "./types";

const ROLES: Role[] = ["FOH", "Monitor", "Assistant"];
const today = () => new Date().toLocaleDateString("en-CA");
const fmtDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric",year:"numeric"});
const shortTime = (t: string) => t?.slice(0,5) ?? "";
const dayNameForTemplate = (d:number) => Number(d)===6?"Saturday":"Sunday";
const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);
const displayList = (v: unknown) => {
  if (Array.isArray(v)) return v.filter(Boolean).join(", ");
  if (typeof v === "string") {
    try { const parsed = JSON.parse(v); if (Array.isArray(parsed)) return parsed.filter(Boolean).join(", "); } catch {}
    return v;
  }
  return "";
};

export default function App() {
  const [session,setSession] = useState<any>(null);
  const [profile,setProfile] = useState<Profile|null>(null);
  const [authLoading,setAuthLoading] = useState(true);
  const [loading,setLoading] = useState(false);
  const [message,setMessage] = useState("");
  const [scheduleError,setScheduleError] = useState("");
  const [schedules,setSchedules] = useState<ScheduleView[]>([]);
  const [locations,setLocations] = useState<Location[]>([]);
  const [servants,setServants] = useState<Servant[]>([]);
  const [templates,setTemplates] = useState<any[]>([]);
  const [tab,setTab] = useState<"schedule"|"people"|"servantInfo"|"availability"|"statistics"|"audit"|"profile"|"inbox"|"requests">("schedule");
  const [availability,setAvailability] = useState<any[]>([]);
  const [availabilityRules,setAvailabilityRules] = useState<any[]>([]);
  const [servingPreferences,setServingPreferences] = useState<any[]>([]);
  const [installPrompt,setInstallPrompt] = useState<any>(null);
  const [pwaInstalled,setPwaInstalled] = useState(false);
  const [pushEnabled,setPushEnabled] = useState(false);
  const [pushBusy,setPushBusy] = useState(false);
  const [isOnline,setIsOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const lastForegroundRefresh = useRef(0);
  const [requests,setRequests] = useState<any[]>([]);
  const [requestReads,setRequestReads] = useState<any[]>([]);
  const [notifications,setNotifications] = useState<any[]>([]);
  const [swapDraft,setSwapDraft] = useState<ScheduleView|null>(null);
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
  const [actionDialog,setActionDialog] = useState<{title:string;message:string;confirmLabel?:string;danger?:boolean;inputLabel?:string;requiredText?:string}|null>(null);
  const [actionDialogInput,setActionDialogInput] = useState("");
  const actionDialogResolver = useRef<((accepted:boolean)=>void)|null>(null);
  const actionTextResolver = useRef<((value:string|null)=>void)|null>(null);
  function askAction(title:string,message:string,confirmLabel="Continue",danger=false):Promise<boolean>{
    return new Promise(resolve=>{actionDialogResolver.current=resolve;setActionDialog({title,message,confirmLabel,danger});});
  }
  function askText(title:string,message:string,inputLabel:string,requiredText?:string,defaultValue=""):Promise<string|null>{
    return new Promise(resolve=>{actionTextResolver.current=resolve;setActionDialogInput(defaultValue);setActionDialog({title,message,inputLabel,requiredText,confirmLabel:"Continue",danger:false});});
  }
  function closeActionDialog(accepted:boolean){
    setActionDialog(null);
    if(actionTextResolver.current){actionTextResolver.current(accepted?actionDialogInput:null);actionTextResolver.current=null;}
    else {actionDialogResolver.current?.(accepted);actionDialogResolver.current=null;}
    setActionDialogInput("");
  }

  useEffect(()=>{
    const overlayOpen=!!modal||!!swapDraft||!!actionDialog;
    if(overlayOpen){const previous=document.body.style.overflow;document.body.style.overflow="hidden";return()=>{document.body.style.overflow=previous;};}
  },[modal,swapDraft,actionDialog]);

  useEffect(() => {
    if (!supabase) { setAuthLoading(false); return; }
    supabase.auth.getSession().then(({data})=>{setSession(data.session);setAuthLoading(false);});
    const {data:{subscription}} = supabase.auth.onAuthStateChange((event,next)=>{setSession(next); if(event==="PASSWORD_RECOVERY") setRecoveryMode(true);});
    return ()=>subscription.unsubscribe();
  },[]);

  useEffect(() => {
    setTab("schedule");setMobileNav(false);
    if (!session || !supabase) { setProfile(null); return; }
    void loadProfile();
  },[session?.user?.id]);

  useEffect(() => {
    const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;
    setPwaInstalled(!!standalone);
    const onBeforeInstall = (event:Event) => { event.preventDefault(); setInstallPrompt(event as any); };
    const onInstalled = () => { setPwaInstalled(true); setInstallPrompt(null); setMessage("Sound Scheduling is installed on this device."); };
    window.addEventListener("beforeinstallprompt",onBeforeInstall);
    window.addEventListener("appinstalled",onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt",onBeforeInstall); window.removeEventListener("appinstalled",onInstalled); };
  },[]);

  useEffect(() => {
    const online = () => setIsOnline(true);
    const offline = () => setIsOnline(false);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => { window.removeEventListener("online", online); window.removeEventListener("offline", offline); };
  }, []);

  useEffect(() => {
    if (!profile || !session?.user?.id) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      const now = Date.now();
      if (now - lastForegroundRefresh.current < 5000) return;
      lastForegroundRefresh.current = now;
      void loadData();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("pageshow", refreshWhenVisible);
    return () => { document.removeEventListener("visibilitychange", refreshWhenVisible); window.removeEventListener("pageshow", refreshWhenVisible); };
  }, [profile?.id, session?.user?.id]);

  useEffect(() => {
    let cancelled=false;
    async function checkPush(){
      if(!session?.user?.id||!("serviceWorker" in navigator)||!("PushManager" in window)){if(!cancelled)setPushEnabled(false);return;}
      try{
        const registration=await navigator.serviceWorker.ready;
        const subscription=await registration.pushManager.getSubscription();
        if(!subscription){if(!cancelled)setPushEnabled(false);return;}
        const {data,error}=await supabase!.from("serving_push_subscriptions").select("id").eq("user_id",session.user.id).eq("endpoint",subscription.endpoint).maybeSingle();
        if(!cancelled)setPushEnabled(!error&&!!data);
      }catch{if(!cancelled)setPushEnabled(false);}
    }
    void checkPush();return()=>{cancelled=true;};
  },[session?.user?.id]);

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
      const notificationCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const auditCutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
      const [locRes,servRes,tempRes,schedRes,assignRes,availRes,ruleRes,preferenceRes,requestRes,readRes,notificationRes,settingRes,auditRes,memberRes] = await Promise.all([
        supabase.from("locations").select("*").order("name"),
        supabase.from("servants").select("*").order("full_name"),
        supabase.from("service_templates").select("*").eq("active",true),
        supabase.from("schedules").select("*").order("service_date").order("start_time"),
        supabase.from("assignments").select("*"),
        supabase.from("servant_availability").select("*").order("service_date",{ascending:true}),
        supabase.from("servant_availability_rules").select("*").order("created_at",{ascending:false}),
        supabase.from("servant_serving_preferences").select("*").eq("active",true).order("created_at",{ascending:false}),
        supabase.from("serving_requests").select("*").order("created_at",{ascending:false}),
        supabase.from("serving_request_reads").select("*"),
        supabase.from("serving_notifications").select("*").gte("created_at",notificationCutoff).order("created_at",{ascending:false}).limit(100),
        supabase.from("system_settings").select("*").eq("key","availability_deadline").maybeSingle(),
        supabase.from("audit_logs").select("*").gte("created_at",auditCutoff).order("created_at",{ascending:false}).limit(50),
        supabase.from("member_profiles").select("*")
      ]);
      // Core schedule/servant data is required. Ancillary tables must not blank the whole dashboard
      // when their RLS policy or migration is not yet configured.
      for (const r of [locRes,servRes,schedRes,assignRes]) if (r.error) throw r.error;
      const optionalErrors = [tempRes,availRes,ruleRes,preferenceRes,requestRes,readRes,notificationRes,settingRes,auditRes,memberRes]
        .filter((r:any) => r.error)
        .map((r:any) => r.error.message);
      if (optionalErrors.length) console.warn("Some optional GMS dashboard data could not be loaded:", optionalErrors);
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
      const safeMemberRows = memberRes.error ? [] : (memberRes.data ?? []);
      setLocations(locs);setServants(people);setTemplates(tempRes.error?[]:(tempRes.data??[]));setSchedules(mapped);
      const loadedRules=ruleRes.error?[]:(ruleRes.data??[]);setAvailabilityRules(loadedRules);setServingPreferences(preferenceRes.error?[]:(preferenceRes.data??[]));
      const explicitAvailability=availRes.error?[]:(availRes.data??[]);
      const virtualAvailability:any[]=[];
      const ruleEndLimit=new Date();ruleEndLimit.setFullYear(ruleEndLimit.getFullYear()+2);
      for(const rule of loadedRules){const from=new Date(`${rule.effective_from}T12:00:00`);const until=rule.effective_until?new Date(`${rule.effective_until}T12:00:00`):ruleEndLimit;for(const d=new Date(from);d<=until&&d<=ruleEndLimit;d.setDate(d.getDate()+1)){const day=d.getDay(),date=d.toLocaleDateString("en-CA"),dayOfMonth=d.getDate(),lastDay=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();let matches=false;if(rule.pattern==="weekday")matches=day>=1&&day<=5;else if(rule.pattern==="saturday")matches=day===6;else if(rule.pattern==="sunday")matches=day===0;else if(rule.pattern==="second_week")matches=dayOfMonth>=8&&dayOfMonth<=14;else if(rule.pattern==="month_edges")matches=dayOfMonth<=3||dayOfMonth>lastDay-3;else if(rule.pattern==="nth_weekday"){const ordinal=Math.ceil(dayOfMonth/7),isLast=dayOfMonth+7>lastDay;matches=day===Number(rule.weekday)&&(Number(rule.ordinal)===5?isLast:ordinal===Number(rule.ordinal));}if(matches)virtualAvailability.push({id:`rule-${rule.id}-${date}`,servant_id:rule.servant_id,service_date:date,status:rule.status,notes:rule.notes||"Recurring restriction",is_recurring:true,rule_id:rule.id});}}
      setAvailability([...explicitAvailability,...virtualAvailability]);setRequests(requestRes.error?[]:(requestRes.data??[]));setRequestReads(readRes.error?[]:(readRes.data??[]));setNotifications(notificationRes.error?[]:(notificationRes.data??[]));
      setAvailabilityDeadline(settingRes.error?"":(settingRes.data?.value??""));setAuditLogs(auditRes.error?[]:(auditRes.data??[]));
      setMemberDirectory(safeMemberRows);setMemberProfile(safeMemberRows.find((x:any)=>x.user_id===session.user.id)??null);
    } catch(e) { setMessage(errorText(e)); }
    finally { setLoading(false); }
  }

  useEffect(()=>{if(profile) void loadData();},[profile]);

  async function installGmsApp(){
    if(installPrompt){try{await installPrompt.prompt();await installPrompt.userChoice;}catch(e){console.warn("PWA install prompt was not completed",e);}finally{setInstallPrompt(null);}return;}
    const ua=navigator.userAgent.toLowerCase();
    const ios=/iphone|ipad|ipod/.test(ua);
    const message=ios?"To install Sound Scheduling on your iPhone: open this page in Safari, tap the Share button, choose Add to Home Screen, then tap Add. The installed icon will open Sound Scheduling in its own app window.":"To install Sound Scheduling: open your browser menu and choose Install app or Add to Home Screen. If the install option is not shown, refresh the page once and try again.";
    await askAction("Install app",message,"Got it",false);
  }

  function decodeVapidKey(value:string){const padding="=".repeat((4-value.length%4)%4);const base64=(value+padding).replace(/-/g,"+").replace(/_/g,"/");const raw=window.atob(base64);return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));}

  async function enablePushNotifications(){
    if(!supabase||!session?.user?.id)return;
    const vapidKey=(import.meta.env.VITE_VAPID_PUBLIC_KEY as string|undefined)?.trim();
    if(!vapidKey){setMessage("Push delivery is not configured yet. Set VITE_VAPID_PUBLIC_KEY in Vercel and your local environment, then redeploy.");return;}
    if(!("serviceWorker" in navigator)||!("PushManager" in window)||!("Notification" in window)){setMessage("This browser does not support web push notifications. You can still use the in-app Inbox.");return;}
    const isIOS=/iphone|ipad|ipod/.test(navigator.userAgent.toLowerCase());
    const isStandalone=window.matchMedia?.("(display-mode: standalone)").matches||(navigator as any).standalone===true;
    if(isIOS&&!isStandalone){setMessage("On iPhone or iPad, first install GMS using Safari → Share → Add to Home Screen, open the installed GMS icon, then enable push notifications.");return;}
    setPushBusy(true);setMessage("");
    try{
      const permission=Notification.permission==="granted"?"granted":await Notification.requestPermission();
      if(permission!=="granted"){setMessage("Notification permission was not granted. In-app Inbox notifications will continue to work.");return;}
      const registration=await navigator.serviceWorker.ready;
      const existing=await registration.pushManager.getSubscription();
      const subscription=existing??await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decodeVapidKey(vapidKey)});
      const json=subscription.toJSON();
      if(!json.endpoint||!json.keys?.p256dh||!json.keys?.auth)throw new Error("The browser did not return a complete push subscription.");
      const {error}=await supabase.rpc("register_serving_push_subscription",{p_endpoint:json.endpoint,pp256dh:json.keys.p256dh,pauth:json.keys.auth,p_user_agent:navigator.userAgent});
      if(error)throw error;
      setPushEnabled(true);setMessage("Push notifications enabled on this device. Your in-app Inbox remains the primary notification history.");
    }catch(e){setMessage(errorText(e));}
    finally{setPushBusy(false);}
  }

  async function disablePushNotifications(){
    if(!supabase||!session?.user?.id||!("serviceWorker" in navigator))return;
    setPushBusy(true);
    try{const registration=await navigator.serviceWorker.ready;const subscription=await registration.pushManager.getSubscription();if(subscription){await supabase.from("serving_push_subscriptions").delete().eq("endpoint",subscription.endpoint);await subscription.unsubscribe();}setPushEnabled(false);setMessage("Push notifications disabled on this device. Your in-app Inbox is unchanged.");}
    catch(e){setMessage(errorText(e));}finally{setPushBusy(false);}
  }

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
  async function signOut(){
    const userId=session?.user?.id;
    setPushEnabled(false);setTab("schedule");setMobileNav(false);

    // Push cleanup is best-effort and must never block authentication sign-out.
    // Do not await navigator.serviceWorker.ready: if /sw.js is missing or fails
    // to install, that promise can remain pending forever and trap the user.
    if(supabase&&userId&&"serviceWorker" in navigator){
      try{
        const registration=await Promise.race([
          navigator.serviceWorker.getRegistration("/"),
          new Promise<undefined>(resolve=>window.setTimeout(()=>resolve(undefined),500))
        ]);
        const subscription=await registration?.pushManager?.getSubscription();
        if(subscription){
          const cleanup=(async()=>{
            const {error}=await supabase.from("serving_push_subscriptions").delete().eq("user_id",userId).eq("endpoint",subscription.endpoint);
            if(error)console.warn("Could not remove this device push subscription during sign out",error);
            await subscription.unsubscribe();
          })();
          await Promise.race([cleanup,new Promise<void>(resolve=>window.setTimeout(resolve,700))]);
        }
      }catch(e){console.warn("Could not remove this device push subscription during sign out",e);}
    }

    try{
      if(supabase){
        const {error}=await supabase.auth.signOut();
        if(error){
          console.warn("Remote sign-out failed; clearing this device session locally.",error);
          await supabase.auth.signOut({scope:"local"});
        }
      }
    }catch(e){
      console.error("Sign-out failed; attempting to clear the local session.",e);
      try{await supabase?.auth.signOut({scope:"local"});}catch{}
    }finally{
      setProfile(null);setSession(null);setMemberProfile(null);setMemberDirectory([]);setNotifications([]);setRequests([]);setRequestReads([]);setAvailability([]);setAvailabilityRules([]);setServingPreferences([]);
    }
  }
  const isAdmin=profile?.role==="admin";

  // Push notification clicks open the authenticated user's primary notification area.
  // Servants land in Inbox; administrators land in Servant Requests / notification history.
  useEffect(()=>{
    if(!profile)return;
    const requestedTab=new URLSearchParams(window.location.search).get("tab");
    if(requestedTab==="notifications")setTab(isAdmin?"requests":"inbox");
    else if(requestedTab==="inbox"&&!isAdmin)setTab("inbox");
    if(requestedTab)window.history.replaceState({},document.title,window.location.pathname);
  },[profile?.id,isAdmin]);
  const myServant=servants.find(p=>p.auth_user_id===session?.user?.id);

  const myPublishedSchedules=useMemo(()=>myServant?schedules.filter(s=>s.status==="published"&&s.assignments.some(a=>a.servant_id===myServant.id)):[],[schedules,myServant?.id]);
  // Count distinct calendar days, not individual service slots. Two services on one date count as one serving day.
  const thirtyDaysAgoForMyStats=new Date(Date.now()-30*86400000).toLocaleDateString("en-CA");
  const myDaysServed=new Set(myPublishedSchedules.filter(s=>s.service_date>=thirtyDaysAgoForMyStats&&s.service_date<today()).map(s=>s.service_date)).size;
  const nextMySchedule=[...myPublishedSchedules].filter(s=>s.service_date>=today()).sort((a,b)=>a.service_date.localeCompare(b.service_date)||a.start_time.localeCompare(b.start_time))[0]??null;

  const filtered=useMemo(()=>{
    const q=personFilter.trim().toLowerCase();
    return schedules.filter(s=>
      s.service_date>=today() &&
      (isAdmin || s.status==="published") &&
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
    setScheduleError("");
    const fd=new FormData(e.currentTarget);
    const payload={service_date:String(fd.get("service_date")),location_id:String(fd.get("location_id")),service_name:String(fd.get("service_name")),start_time:String(fd.get("start_time")),end_time:String(fd.get("end_time")),status:editing?.status==="published"?"draft":editing?.status??"draft"};
    const selected:Record<Role,string>={FOH:String(fd.get("FOH")||""),Monitor:String(fd.get("Monitor")||""),Assistant:String(fd.get("Assistant")||"")};
    const chosen=Object.entries(selected).filter(([,id])=>id).map(([role,id])=>({role,id}));
    const duplicateInService=chosen.find((entry,index)=>chosen.some((other,j)=>j!==index&&other.id===entry.id));
    if(duplicateInService){setScheduleError("This servant is selected for more than one role in this service. Please choose a different servant.");return;}
    const serviceWeekday=new Date(`${payload.service_date}T12:00:00`).getDay();
    const preferenceBlocks=chosen.filter(entry=>{
      const prefs=servingPreferences.filter(rule=>rule.servant_id===entry.id&&rule.active!==false&&(!rule.effective_from||rule.effective_from<=payload.service_date)&&(!rule.effective_until||rule.effective_until>=payload.service_date));
      const timeRules=prefs.filter(rule=>rule.rule_type==="allowed_time_window");
      const serviceRules=prefs.filter(rule=>rule.rule_type==="allowed_service_scope");
      const timeAllowed=!timeRules.length||timeRules.some(rule=>(!rule.days_of_week?.length||rule.days_of_week.includes(serviceWeekday))&&payload.start_time>=String(rule.start_time).slice(0,5)&&payload.end_time<=String(rule.end_time).slice(0,5));
      const serviceAllowed=!serviceRules.length||serviceRules.some(rule=>rule.location_id===payload.location_id&&(!rule.service_names?.length||rule.service_names.includes(payload.service_name)));
      return !timeAllowed||!serviceAllowed;
    });
    if(preferenceBlocks.length){setScheduleError(`Serving eligibility restriction: ${preferenceBlocks.map(x=>servants.find(p=>p.id===x.id)?.full_name??"A servant").join(", ")} cannot serve in this time window, location or service based on their saved preferences. Review Availability → Serving preferences.`);return;}
    const conflicts=chosen.map(entry=>({ ...entry, other:schedules.find(s=>s.service_date===payload.service_date&&s.location_id!==payload.location_id&&s.id!==editing?.id&&s.assignments.some(a=>a.servant_id===entry.id)) })).filter(x=>x.other);
    if(conflicts.length){const names=conflicts.map(c=>`${servants.find(p=>p.id===c.id)?.full_name??"A servant"} (${c.other?.location_name} · ${c.other?.service_name})`);setScheduleError(`Cannot save this schedule. ${names.join(", ")} ${conflicts.length===1?"is":"are"} already assigned at another church location on ${fmtDate(payload.service_date)}. A servant can only serve at one church location per day.`);return;}
    const toMinutes=(t:string)=>Number(t.slice(0,2))*60+Number(t.slice(3,5));
    const overlaps=chosen.map(entry=>({ ...entry, other:schedules.find(s=>s.service_date===payload.service_date&&s.location_id===payload.location_id&&s.id!==editing?.id&&s.assignments.some(a=>a.servant_id===entry.id)&&toMinutes(payload.start_time)<toMinutes(s.end_time)&&toMinutes(payload.end_time)>toMinutes(s.start_time)) })).filter(x=>x.other);
    if(overlaps.length){setScheduleError(`Cannot save this schedule. ${overlaps.map(c=>servants.find(p=>p.id===c.id)?.full_name??"A servant").join(", ")} ${overlaps.length===1?"has":"have"} an overlapping service at this location.`);return;}
    const unavailable=chosen.filter(entry=>availability.some(a=>a.servant_id===entry.id&&a.service_date===payload.service_date&&a.status==="unavailable"));
    if(unavailable.length){setScheduleError(`Cannot assign this schedule. ${unavailable.map(x=>servants.find(p=>p.id===x.id)?.full_name??"A servant").join(", ")} marked unavailable on ${fmtDate(payload.service_date)}.`);return;}
    const preferNot=chosen.filter(entry=>availability.some(a=>a.servant_id===entry.id&&a.service_date===payload.service_date&&a.status==="prefer_not"));
    if(preferNot.length&&!await askAction("Availability preference",`${preferNot.map(x=>servants.find(p=>p.id===x.id)?.full_name??"A servant").join(", ")} marked “Prefer not to serve” on this date. Do you want to continue with this manual assignment?`,"Assign anyway",true))return;
    const thirtyDaysAgo=new Date(new Date(`${payload.service_date}T12:00:00`).getTime()-30*86400000).toLocaleDateString("en-CA");
    const highWorkload=chosen.map(entry=>({...entry,days:new Set(schedules.filter(s=>s.service_date<payload.service_date&&s.service_date>=thirtyDaysAgo&&s.assignments.some(a=>a.servant_id===entry.id)).map(s=>s.service_date)).size})).filter(x=>x.days>=5);
    if(highWorkload.length&&!await askAction("High workload warning",`${highWorkload.map(x=>`${servants.find(p=>p.id===x.id)?.full_name??"Servant"} (${x.days} days in the previous 30 days)`).join(", ")} already have a high serving frequency. Continue with this manual assignment?`,"Assign anyway",true))return;
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
      setScheduleError("");setModal(null);setEditing(null);await loadData();
    }catch(e){setScheduleError(errorText(e));setLoading(false);}
  }

  async function generateWeekend(date:string,weeks=1,templateIds:string[]=[],mode:"add"|"replace"="add") {
    if(!supabase||!isAdmin)return;
    const d=new Date(`${date}T12:00:00`);
    if(d.getDay()!==6){setMessage("Choose a Saturday to generate the weekend.");return;}
    const dates:{date:string;day:number}[]=[];
    for(let w=0;w<weeks;w++){const sat=new Date(d);sat.setDate(d.getDate()+w*7);const sun=new Date(sat);sun.setDate(sat.getDate()+1);dates.push({date:sat.toLocaleDateString("en-CA"),day:6},{date:sun.toLocaleDateString("en-CA"),day:0});}
    const selected=templates.filter(t=>templateIds.includes(String(t.id)));
    if(!selected.length){setMessage("Select at least one service template to generate.");return;}
    setLoading(true);setMessage("");setScheduleError("");
    try {
      const rows=dates.flatMap(x=>selected.filter(t=>Number(t.day_of_week)===x.day).map(t=>({
        service_date:x.date,location_id:t.location_id,service_name:t.service_name,start_time:t.start_time,end_time:t.end_time
      })));
      if(!rows.length)throw new Error("The selected templates do not include Saturday or Sunday services.");
      const {error}=await supabase.from("schedules").upsert(rows,{onConflict:"service_date,location_id,service_name",ignoreDuplicates:mode==="add"});
      if(error)throw error;
      await loadData();setMessage(`${weeks} weekend(s) generated using ${selected.length} selected template(s). ${mode==="replace"?"Matching existing slots were updated; assignments were preserved.":"Existing slots were left unchanged."} New slots are drafts; assign servants and publish when ready.`);
    }catch(e){setScheduleError(errorText(e));setLoading(false);}
  }

  async function saveAvailability(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();if(!supabase)return;
    const form=e.currentTarget;
    const fd=new FormData(form);
    const linkedServant=servants.find(p=>p.auth_user_id===session?.user?.id);
    const row={servant_id:String(fd.get("servant_id")),service_date:String(fd.get("service_date")),status:String(fd.get("status")),notes:String(fd.get("notes")||"").trim()};
    if(!isAdmin&&availabilityDeadline&&today()>availabilityDeadline){setMessage(`The availability submission deadline (${fmtDate(availabilityDeadline)}) has passed. Please contact the administrator if you need to change your availability.`);return;}
    if(!isAdmin&&(!linkedServant||row.servant_id!==linkedServant.id)){setMessage("Your login is not linked to a servant profile. Please ask an administrator to link your account.");return;}
    const recurringConflict=availability.find(a=>a.is_recurring&&a.servant_id===row.servant_id&&a.service_date===row.service_date&&a.status!==row.status);
    if(recurringConflict){setMessage(`This date conflicts with a recurring ${recurringConflict.status.replace("_"," ")} restriction. Review the recurring rule before saving.`);return;}
    setLoading(true);setMessage("");
    try {
      const {error}=await supabase.from("servant_availability").upsert(row,{onConflict:"servant_id,service_date"});
      if(error)throw error;
      await loadData();form.reset();setMessage("Availability saved.");
    } catch(e){setMessage(errorText(e));}
    finally{setLoading(false);}
  }
  async function saveBulkAvailability(rows:any[]) {
    if(!supabase)return false;
    const conflicts=rows.filter(row=>availability.some(a=>a.servant_id===row.servant_id&&a.service_date===row.service_date&&a.status!==row.status));
    if(conflicts.length){setMessage(`Cannot save: ${conflicts.length} date/person combination(s) already have a different availability status. Resolve the conflicts first.`);return false;}
    setLoading(true);setMessage("");
    try { const {error}=await supabase.from("servant_availability").upsert(rows,{onConflict:"servant_id,service_date"}); if(error)throw error; await loadData();setMessage(`${rows.length} availability record(s) saved.`);return true; }
    catch(e){setMessage(errorText(e));return false;} finally{setLoading(false);}
  }
  async function saveAvailabilityRule(rule:any) {
    if(!supabase)return false;
    const overlaps=availabilityRules.filter(r=>r.servant_id===rule.servant_id&&r.status!==rule.status&&(!r.effective_until||r.effective_until>=rule.effective_from)&&(!rule.effective_until||rule.effective_until>=r.effective_from));
    if(overlaps.length){setMessage("This recurring rule overlaps an existing rule with a different status. Review or remove the existing rule first.");return false;}
    const end=rule.effective_until?new Date(`${rule.effective_until}T12:00:00`):new Date(new Date().setFullYear(new Date().getFullYear()+2));
    const cursor=new Date(`${rule.effective_from}T12:00:00`);let conflictDate="";
    for(let i=0;cursor<=end&&i<740;cursor.setDate(cursor.getDate()+1),i++){const day=cursor.getDay(),dom=cursor.getDate(),last=new Date(cursor.getFullYear(),cursor.getMonth()+1,0).getDate();let match=rule.pattern==="weekday"?day>=1&&day<=5:rule.pattern==="saturday"?day===6:rule.pattern==="sunday"?day===0:rule.pattern==="second_week"?dom>=8&&dom<=14:rule.pattern==="month_edges"?dom<=3||dom>last-3:rule.pattern==="nth_weekday"?day===Number(rule.weekday)&&(Number(rule.ordinal)===5?dom+7>last:Math.ceil(dom/7)===Number(rule.ordinal)):false;const date=cursor.toLocaleDateString("en-CA");if(match&&availability.some(a=>a.servant_id===rule.servant_id&&a.service_date===date&&a.status!==rule.status)){conflictDate=date;break;}}
    if(conflictDate){setMessage(`This rule conflicts with an existing availability entry on ${conflictDate}. Resolve that date before saving the recurring rule.`);return false;}
    const {error}=await supabase.from("servant_availability_rules").insert({...rule,created_by:session?.user?.id});
    if(error){setMessage(error.message);return false;} await loadData();setMessage("Recurring availability restriction saved.");return true;
  }
  async function deleteAvailabilityRule(id:string){if(!supabase)return;const {error}=await supabase.from("servant_availability_rules").delete().eq("id",id);if(error)setMessage(error.message);else await loadData();}

  async function saveServingPreference(preference:any){
    if(!supabase)return false;
    const currentForPerson=servingPreferences.filter(r=>r.servant_id===preference.servant_id&&r.active!==false);
    const combined=[...currentForPerson,preference];
    const conflicts=schedules.filter(schedule=>schedule.service_date>=today()&&schedule.assignments.some(a=>a.servant_id===preference.servant_id)).filter(schedule=>{
      const dateDow=new Date(`${schedule.service_date}T12:00:00`).getDay();
      const timeRules=combined.filter(r=>r.rule_type==="allowed_time_window");
      const serviceRules=combined.filter(r=>r.rule_type==="allowed_service_scope");
      const timeAllowed=!timeRules.length||timeRules.some(r=>(!r.days_of_week?.length||r.days_of_week.includes(dateDow))&&shortTime(schedule.start_time)>=String(r.start_time).slice(0,5)&&shortTime(schedule.end_time)<=String(r.end_time).slice(0,5));
      const serviceAllowed=!serviceRules.length||serviceRules.some(r=>r.location_id===schedule.location_id&&(!r.service_names?.length||r.service_names.includes(schedule.service_name)));
      return !timeAllowed||!serviceAllowed;
    });
    if(conflicts.length){setMessage(`This restriction would conflict with ${conflicts.length} existing upcoming assignment(s): ${conflicts.slice(0,4).map(s=>`${s.service_name} · ${fmtDate(s.service_date)}`).join("; ")}. Review or change those assignments before saving the restriction.`);return false;}
    const {error}=await supabase.from("servant_serving_preferences").insert({...preference,created_by:session?.user?.id});
    if(error){setMessage(error.message);return false;}
    await loadData();setMessage("Serving eligibility rule saved and will be checked during manual assignment.");return true;
  }
  async function deleteServingPreference(id:string){
    if(!supabase)return;
    const {error}=await supabase.from("servant_serving_preferences").delete().eq("id",id);
    if(error)setMessage(error.message);else{await loadData();setMessage("Serving eligibility rule removed.");}
  }

  async function deleteAvailability(id:string){
    if(!supabase||!isAdmin)return;
    const {error}=await supabase.from("servant_availability").delete().eq("id",id);
    if(error)setMessage(error.message);else await loadData();
  }

  async function savePerson(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();if(!supabase||!isAdmin)return;
    setScheduleError("");
    const fd=new FormData(e.currentTarget);const name=String(fd.get("full_name")).trim();
    if(!name)return;
    setLoading(true);
    try{
      const {error}=await supabase.from("servants").insert({full_name:name,active:true});if(error)throw error;
      setModal(null);await loadData();
    }catch(e){setScheduleError(errorText(e));setLoading(false);}
  }
  async function togglePerson(p:Servant){
    if(!supabase||!isAdmin)return;
    const {error}=await supabase.from("servants").update({active:!p.active}).eq("id",p.id);
    if(error)setMessage(error.message);else await loadData();
  }
  async function deleteSchedule(s:ScheduleView){
    if(!supabase||!isAdmin||!await askAction("Delete service",`Delete ${s.service_name} on ${fmtDate(s.service_date)}? This also removes its assignments.`,"Delete service",true))return;
    const {error}=await supabase.from("schedules").delete().eq("id",s.id);
    if(error)setMessage(error.message);else await loadData();
  }
  async function publishSchedule(s:ScheduleView){
    if(!supabase||!isAdmin)return;
    const {error}=await supabase.from("schedules").update({status:s.status==="published"?"draft":"published"}).eq("id",s.id);
    if(error)setMessage(error.message);else {setMessage(s.status==="published"?"Schedule moved back to draft.":"Schedule published. Servants can now see and confirm it.");await loadData();}
  }
  async function bulkSetLocationStatus(locationId:string,status:"published"|"draft"){
    if(!supabase||!isAdmin||!locationId)return;
    const location=locations.find(l=>l.id===locationId);
    const action=status==="published"?"publish":"unpublish";
    if(status==="published"){
      const candidates=schedules.filter(s=>s.location_id===locationId&&s.service_date>=today());
      const missing=candidates.filter(s=>!["FOH","Monitor"].every(role=>s.assignments.some(a=>a.role===role&&a.servant_id)));
      const unavailable=candidates.flatMap(s=>s.assignments.filter(a=>a.servant_id&&availability.some(v=>v.servant_id===a.servant_id&&v.service_date===s.service_date&&v.status==="unavailable")).map(a=>`${a.servant_name} · ${s.service_name} · ${fmtDate(s.service_date)}`));
      const conflicts=candidates.flatMap(s=>s.assignments.filter(a=>a.servant_id&&schedules.some(other=>other.id!==s.id&&other.service_date===s.service_date&&other.location_id!==s.location_id&&other.assignments.some(x=>x.servant_id===a.servant_id))).map(a=>`${a.servant_name} · ${s.service_name} · ${fmtDate(s.service_date)}`));
      if(missing.length||unavailable.length||conflicts.length){
        const report=[missing.length?`${missing.length} service(s) missing FOH or Monitor`:null,unavailable.length?`Unavailable servants: ${unavailable.join("; ")}`:null,conflicts.length?`Cross-church conflicts: ${conflicts.join("; ")}`:null].filter(Boolean).join("\\n");
        if(!await askAction("Scheduling validation warning",`There are issues for ${location?.name??"this church"}:\n${report}\n\nDo you want to publish anyway?`,"Publish anyway",true))return;
      }
    }
    if(!await askAction(`${action==="publish"?"Publish":"Unpublish"} all schedules?`,`${action==="publish"?"Publish":"Unpublish"} all schedules for ${location?.name??"this church"}?`,action==="publish"?"Publish all":"Unpublish all",action!=="publish"))return;
    setLoading(true);setScheduleError("");setMessage("");
    try{
      const {error}=await supabase.from("schedules").update({status}).eq("location_id",locationId);
      if(error)throw error;
      await loadData();
      setMessage(`All schedules for ${location?.name??"this church"} have been ${status==="published"?"published":"unpublished"}.`);
    }catch(e){setMessage(`Bulk ${action} failed: ${errorText(e)}`);}
    finally{setLoading(false);}
  }
  async function deleteAllLocationSchedules(locationId:string){
    if(!supabase||!isAdmin||!locationId)return;
    const location=locations.find(l=>l.id===locationId);
    const confirmation=await askText("Confirm permanent deletion",`This will permanently delete ALL schedules and their assignments for ${location?.name??"this church"}. This cannot be undone.`,"Type exactly: I do understand","I do understand");
    if(confirmation!=="I do understand"){if(confirmation!==null)setMessage("Delete all cancelled: confirmation text did not match.");return;}
    if(!await askAction("Final deletion confirmation",`Permanently delete every schedule and assignment for ${location?.name??"this church"}? This cannot be undone.`,"Delete permanently",true))return;
    setLoading(true);setScheduleError("");setMessage("");
    try{
      const {error}=await supabase.from("schedules").delete().eq("location_id",locationId);
      if(error)throw error;
      await loadData();
      setMessage(`All schedules for ${location?.name??"this church"} have been deleted.`);
    }catch(e){setMessage(`Delete all failed: ${errorText(e)}`);}
    finally{setLoading(false);}
  }
  async function addLocation(){
    if(!supabase||!isAdmin)return;
    const name=await askText("Add church location","Enter the name of the new church location.","Church name");if(!name?.trim())return;
    const {error}=await supabase.from("locations").insert({name:name.trim()});
    if(error)setMessage(error.message);else {setMessage("Church location added.");await loadData();}
  }
  async function addRecurringTemplate(){
    if(!supabase||!isAdmin)return;
    const locationName=await askText("Add recurring service","Enter the exact church location name. Available: "+locations.map(l=>l.name).join(", "),"Church location");if(!locationName)return;
    const location=locations.find(l=>l.name.toLowerCase()===locationName.trim().toLowerCase());if(!location){setMessage("Location not found. Add the church first.");return;}
    const day=await askText("Choose service day","Enter 6 for Saturday or 0 for Sunday.","Day of week",undefined,"0");if(day!=="0"&&day!=="6"){setMessage("Recurring templates currently support Saturday (6) and Sunday (0). Add weekday specials as individual services.");return;}
    const service_name=await askText("Service name","Enter the recurring service name.","Service name");if(!service_name?.trim())return;
    const start_time=await askText("Start time","Enter the start time in HH:MM format.","Start time",undefined,"09:00");if(!start_time)return;
    const end_time=await askText("End time","Enter the end time in HH:MM format.","End time",undefined,"11:00");if(!end_time)return;
    const {error}=await supabase.from("service_templates").upsert({location_id:location.id,day_of_week:Number(day),service_name:service_name.trim(),start_time,end_time,active:true},{onConflict:"location_id,day_of_week,service_name"});
    if(error)setMessage(error.message);else {setMessage("Recurring service template saved.");await loadData();}
  }
  async function saveDeadline(e:FormEvent<HTMLFormElement>){
    e.preventDefault();if(!supabase||!isAdmin)return;
    setScheduleError("");
    const fd=new FormData(e.currentTarget);const value=String(fd.get("deadline")||"");
    const {error}=await supabase.from("system_settings").upsert({key:"availability_deadline",value,updated_by:session.user.id},{onConflict:"key"});
    if(error)setMessage(error.message);else {setAvailabilityDeadline(value);setMessage("Availability deadline updated.");}
  }
  async function submitServingRequest(schedule:ScheduleView,kind:"replacement"|"swap"){
    if(kind==="swap"){setSwapDraft(schedule);return;}
    if(!supabase||!myServant)return;
    const own=schedule.assignments.find(a=>a.servant_id===myServant.id);if(!own)return;
    const note=await askText("Request a replacement","Tell the administrator why you need a replacement.","Reason (optional)");
    if(note===null)return;
    const {error}=await supabase.from("serving_requests").insert({schedule_id:schedule.id,assignment_id:own.id,requester_servant_id:myServant.id,request_type:"replacement",details:note.trim(),status:"pending"});
    if(error)setMessage(error.message);else {setMessage("Your replacement request has been sent to the administrator.");await loadData();}
  }
  async function submitDirectSwap(targetScheduleId:string,targetAssignmentId:string,details:string){
    if(!supabase||!myServant||!swapDraft)return;
    const source=swapDraft, own=source.assignments.find(a=>a.servant_id===myServant.id);
    const targetSchedule=schedules.find(s=>s.id===targetScheduleId);
    const target=targetSchedule?.assignments.find(a=>a.id===targetAssignmentId);
    if(!own||!targetSchedule||!target){setMessage("Please select a valid servant assignment to swap with.");return;}
    if(target.servant_id===myServant.id){setMessage("You cannot swap with yourself.");return;}
    if(source.id===targetSchedule.id){setMessage("Choose an assignment on a different service date.");return;}
    const conflicts=(personId:string,date:string,excludeIds:string[])=>schedules.some(s=>s.service_date===date&&s.location_id!== (date===source.service_date?source.location_id:targetSchedule.location_id) && !excludeIds.includes(s.id) && s.assignments.some(a=>a.servant_id===personId));
    // Each servant must be free of another church assignment on the day they would receive.
    const targetConflict=schedules.some(s=>s.service_date===source.service_date&&s.location_id!==source.location_id&&s.assignments.some(a=>a.servant_id===target.servant_id));
    const requesterConflict=schedules.some(s=>s.service_date===targetSchedule.service_date&&s.location_id!==targetSchedule.location_id&&s.assignments.some(a=>a.servant_id===myServant.id));
    if(targetConflict||requesterConflict){setMessage(targetConflict?`${target.servant_name} already has an assignment at another church on ${fmtDate(source.service_date)}.`:`You already have an assignment at another church on ${fmtDate(targetSchedule.service_date)}.`);return;}
    const {error}=await supabase.from("serving_requests").insert({schedule_id:source.id,assignment_id:own.id,requester_servant_id:myServant.id,request_type:"swap",details:details.trim(),status:"pending",target_schedule_id:targetSchedule.id,target_assignment_id:target.id,target_servant_id:target.servant_id});
    if(error)setMessage(error.message);else {setSwapDraft(null);setMessage("Your cross-date swap request has been sent for admin approval.");await loadData();}
  }
  async function markRequestRead(requestId:string){
    if(!supabase||!session)return;
    const {error}=await supabase.from("serving_request_reads").upsert({request_id:requestId,user_id:session.user.id,read_at:new Date().toISOString()},{onConflict:"request_id,user_id"});
    if(error)console.warn("Could not mark request notification as read:",error.message);
    else setRequestReads(v=>[...v.filter(x=>x.request_id!==requestId),{request_id:requestId,user_id:session.user.id,read_at:new Date().toISOString()}]);
  }
  async function reviewRequest(request:any,approve:boolean){
    if(!supabase||!isAdmin)return;
    if(approve&&request.request_type==="swap"&&request.target_assignment_id){
      const source=schedules.find(s=>s.id===request.schedule_id);
      const targetSchedule=schedules.find(s=>s.id===request.target_schedule_id);
      const sourceAssignment=source?.assignments.find(a=>a.id===request.assignment_id);
      const targetAssignment=targetSchedule?.assignments.find(a=>a.id===request.target_assignment_id);
      if(!source||!targetSchedule||!sourceAssignment||!targetAssignment){setMessage("Swap cannot be approved because one of the assignments no longer exists.");return;}
      const conflict=(personId:string,date:string,destinationLocationId:string,excludeScheduleIds:string[])=>schedules.some(s=>s.service_date===date&&s.location_id!==destinationLocationId&&!excludeScheduleIds.includes(s.id)&&s.assignments.some(a=>a.servant_id===personId));
      if(conflict(targetAssignment.servant_id,source.service_date,source.location_id,[source.id,targetSchedule.id])||conflict(sourceAssignment.servant_id,targetSchedule.service_date,targetSchedule.location_id,[source.id,targetSchedule.id])){setMessage("Swap approval blocked: one servant now has another assignment on the destination date. Review the schedule first.");return;}
      const {error:swapError}=await supabase.rpc("admin_execute_servant_swap",{p_request_id:request.id});
      if(swapError){setMessage(swapError.message);return;}
      setMessage("Swap approved and assignments exchanged.");await loadData();return;
    }
    const {error}=await supabase.from("serving_requests").update({status:approve?"approved":"declined",reviewed_by:session.user.id,reviewed_at:new Date().toISOString()}).eq("id",request.id);
    if(error)setMessage(error.message);else {setMessage(approve?(request.request_type==="swap"?"Swap approved and assignments exchanged.":"Request approved. Please update the assignment if a replacement is needed."):"Request declined.");await loadData();}
  }
  async function confirmAssignment(schedule:ScheduleView,status:"confirmed"|"declined"){
    if(!supabase||!myServant||!session)return;
    const assignment=schedule.assignments.find(a=>a.servant_id===myServant.id);
    if(!assignment)return;
    if(status==="declined"){
      const reason=await askText("Decline assignment","Please provide a reason for declining (optional).","Reason (optional)");
      if(reason===null)return;
      const {error}=await supabase.from("assignments").update({confirmation_status:"declined"}).eq("id",assignment.id);
      if(error){setMessage(error.message);return;}
      const existing=requests.find(r=>r.assignment_id===assignment.id&&r.request_type==="replacement"&&r.status==="pending");
      if(!existing){
        const {error:requestError}=await supabase.from("serving_requests").insert({schedule_id:schedule.id,assignment_id:assignment.id,requester_servant_id:myServant.id,request_type:"replacement",details:reason.trim()||"Servant declined the assignment and requests a replacement.",status:"pending"});
        if(requestError){setMessage("Decline saved, but replacement request could not be created: "+requestError.message);await loadData();return;}
      }
      setMessage("Assignment declined. A replacement request has been sent to the administrator.");await loadData();return;
    }
    const {error}=await supabase.from("assignments").update({confirmation_status:"confirmed"}).eq("id",assignment.id);
    if(error){setMessage(error.message);return;}
    const {error:notifyError}=await supabase.rpc("notify_admin_assignment_confirmation",{p_assignment_id:assignment.id});
    if(notifyError)console.warn("Confirmation saved but admin notification failed:",notifyError.message);
    setMessage("Serving assignment confirmed. The administrator has been notified.");await loadData();
  }
  async function markNotificationRead(id:string){
    if(!supabase)return;
    const {error}=await supabase.from("serving_notifications").update({is_read:true}).eq("id",id);
    if(!error)setNotifications(v=>v.map(n=>n.id===id?{...n,is_read:true}:n));
  }
  async function resolveReplacement(request:any,replacementServantId:string){
    if(!supabase||!isAdmin)return;
    const {error}=await supabase.rpc("admin_resolve_replacement",{p_request_id:request.id,p_replacement_servant_id:replacementServantId});
    if(error){setMessage(error.message);return;}
    setMessage("Replacement assigned. Both servants have been notified.");await loadData();
  }
  async function exportAuditHistory(){
    if(!supabase||!isAdmin)return;
    const now=Date.now();
    const newerThan=new Date(now-14*24*60*60*1000).toISOString();
    const data:any[]=[];
    const pageSize=1000;
    for(let offset=0;;offset+=pageSize){
      const {data:page,error}=await supabase.from("audit_logs").select("*")
        .lt("created_at",newerThan)
        .order("created_at",{ascending:false}).range(offset,offset+pageSize-1);
      if(error){setMessage(error.message);return;}
      data.push(...(page??[]));
      if(!page||page.length<pageSize)break;
    }
    if(data.length===0){setMessage("No audit records older than 14 days are available to export.");return;}
    const cols=["created_at","actor_id","action","table_name","record_id","old_data","new_data"];
    const cell=(value:any)=>`"${String(value===null||value===undefined?"":typeof value==="object"?JSON.stringify(value):value).replace(/"/g,'""')}"`;
    const csv=[cols.join(","),...data.map((row:any)=>cols.map(k=>cell(row[k])).join(","))].join("\r\n");
    const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`gms-audit-older-than-14-days-${today()}.csv`;a.click();URL.revokeObjectURL(url);
    setMessage(`Downloaded ${data.length} audit record(s) older than 14 days.`);
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
  if(!session)return <div className="auth-page"><div className="auth-card">{authMode!=="login"&&<div className="brand-mark"><Church size={24}/></div>}<p className="eyebrow">GMS SOUND SCHEDULING SYSTEM</p><h1 className={authMode==="login"?"welcome-home-script":""}>{authMode==="login"?"Welcome Home":authMode==="signup"?"Create your account":"Reset your password"}</h1><p className="subtle">Serving schedule management for Alam Sutera, BSD and Karawaci.</p>
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
    <aside className="sidebar">
      <div className="brand brand-sound-identity"><div className="brand-sound-icon"><AudioLines size={25}/></div><div className="brand-sound-copy"><b>GMS Sound Scheduling</b><small>SERVE WITH EXCELLENCE</small></div></div>
      <div className="nav-label">WORKSPACE</div>
      <button className={`nav-item ${tab==="schedule"?"active":""}`} onClick={()=>{setTab("schedule");setMobileNav(false);}}><CalendarDays size={18}/> Schedule</button>
      <button className={`nav-item ${tab==="availability"?"active":""}`} onClick={()=>{setTab("availability");setMobileNav(false);}}><ClipboardCheck size={18}/> Availability</button>
      {!isAdmin&&<button className={`nav-item ${tab==="inbox"?"active":""}`} onClick={()=>{setTab("inbox");setMobileNav(false);}}><ClipboardCheck size={18}/> Inbox{requests.filter(r=>r.requester_servant_id===myServant?.id&&["approved","declined","rejected"].includes(String(r.status).toLowerCase())&&!requestReads.some(x=>x.request_id===r.id&&x.user_id===session?.user?.id)).length>0&&<span className="inbox-count">{requests.filter(r=>r.requester_servant_id===myServant?.id&&["approved","declined","rejected"].includes(String(r.status).toLowerCase())&&!requestReads.some(x=>x.request_id===r.id&&x.user_id===session?.user?.id)).length}</span>}</button>}
      {isAdmin&&<button className={`nav-item ${tab==="requests"?"active":""}`} onClick={()=>{setTab("requests");setMobileNav(false);}}><ClipboardCheck size={18}/> Servant Requests{(requests.filter(r=>r.status==="pending").length+notifications.filter(n=>n.recipient_user_id===session?.user?.id&&!n.is_read).length)>0&&<span className="inbox-count">{requests.filter(r=>r.status==="pending").length+notifications.filter(n=>n.recipient_user_id===session?.user?.id&&!n.is_read).length}</span>}</button>}
      {!isAdmin&&<button className={`nav-item ${tab==="profile"?"active":""}`} onClick={()=>{setTab("profile");setMobileNav(false);}}><Users size={18}/> My profile</button>}
      {isAdmin&&<>
        <button className={`nav-item ${tab==="servantInfo"?"active":""}`} onClick={()=>{setTab("servantInfo");setMobileNav(false);}}><Users size={18}/> Servant Information</button>
        <button className={`nav-item ${tab==="statistics"?"active":""}`} onClick={()=>{setTab("statistics");setMobileNav(false);}}><BarChart3 size={18}/> Statistics</button>
        <button className={`nav-item ${tab==="audit"?"active":""}`} onClick={()=>{setTab("audit");setMobileNav(false);}}><ClipboardCheck size={18}/> Audit log</button>
      </>}
      <div className="sidebar-bottom"><div className="user-chip"><div className="avatar">{(profile.display_name||session.user.email||"G").slice(0,1).toUpperCase()}</div><div className="user-meta"><b>{profile.display_name||session.user.email}</b><small>{isAdmin?"Administrator":"Servant"}</small></div><button title="Sign out" className="icon-btn" onClick={signOut}><LogOut size={17}/></button></div></div>
    </aside>
    <div className="main-area">
      <header className="topbar"><button className="mobile-menu icon-btn" onClick={()=>setMobileNav(!mobileNav)}><Menu/></button><div><div className="eyebrow">GMS • CHURCH SERVING</div><h1>{tab==="schedule"?"Serving schedule":tab==="servantInfo"?"Servant Information":tab==="availability"?"Availability management":tab==="audit"?"Audit log":tab==="profile"?"My profile":tab==="inbox"?"Inbox":tab==="requests"?"Servant Requests":"Serving statistics"}</h1></div><div className="top-actions"><span className="role-tag"><ShieldCheck size={14}/>{isAdmin?"Admin access":"View access"}</span>{!pwaInstalled&&<button className="btn secondary pwa-install-button" onClick={installGmsApp}><Smartphone size={15}/> Install app</button>}<button className="icon-btn" onClick={loadData} title="Refresh"><RefreshCw size={17}/></button></div></header>
      <main className="content">
        {!isAdmin&&memberProfile&&((Date.now()-new Date(memberProfile.last_verified_at).getTime())>90*86400000)&&<div className="message-banner profile-reminder"><span><b>Profile verification reminder:</b> Please review your member information. It has been more than 3 months since your last verification.</span><button className="btn tiny secondary" onClick={()=>setTab("profile")}>Review profile</button></div>}{message&&<div className="message-banner"><span>{message}</span><button className="icon-btn" onClick={()=>setMessage("")}><X size={16}/></button></div>}{!isOnline&&<div className="offline-status-banner"><WifiOff size={16}/>You are offline. Schedule data is not refreshed or saved for offline use; reconnect before making assignment changes.</div>}
        {tab==="schedule"?<>
          {!isAdmin&&<MyScheduleSummary daysServed={myDaysServed} upcoming={nextMySchedule} servantId={myServant?.id??""}/>}
          {!isAdmin&&<MyUpcomingAssignments items={[...myPublishedSchedules].filter(s=>s.service_date>=today()).sort((a,b)=>a.service_date.localeCompare(b.service_date)||a.start_time.localeCompare(b.start_time))} servantId={myServant?.id??""} onConfirm={confirmAssignment} onRequest={submitServingRequest}/>}
          <div className="toolbar"><div><h2>{isAdmin?"Serving assignments":"All published schedules"}</h2><p className="subtle">{isAdmin?"Manage services across all church locations.":"Browse published serving assignments across all church locations."}</p></div><div className={`toolbar-actions serving-toolbar-actions${isAdmin?" admin-toolbar-actions":""}`}>{isAdmin&&<><button className="btn primary" onClick={()=>{setScheduleError("");setEditing(null);setModal("schedule");}}><Plus size={16}/> Add special service</button><button className="btn secondary" onClick={addLocation}><Plus size={16}/> Add church</button><button className="btn secondary" onClick={addRecurringTemplate}><Plus size={16}/> Add recurring service</button></>}<button className="btn secondary" onClick={exportCsv}><Download size={16}/> Export</button>{isAdmin&&<button className="btn secondary" onClick={()=>void exportScheduleHistory()}><Download size={16}/> History CSV</button>}</div></div>
          {isAdmin&&<div className="calendar-switch"><span>Calendar grouping</span><button className={calendarView==="week"?"selected":""} onClick={()=>setCalendarView("week")}>Weekly</button><button className={calendarView==="month"?"selected":""} onClick={()=>setCalendarView("month")}>Monthly</button></div>}
          {isAdmin&&<section className="stats-grid"><Stat label="VISIBLE SERVICES" value={filtered.length}/><Stat label="SERVANTS ASSIGNED" value={new Set(filtered.flatMap(s=>s.assignments.map(a=>a.servant_id))).size}/><Stat label="CHURCH LOCATIONS" value={new Set(filtered.map(s=>s.location_id)).size}/></section>}
          {isAdmin&&<ChurchBulkActions locations={locations} disabled={loading} onPublish={id=>void bulkSetLocationStatus(id,"published")} onUnpublish={id=>void bulkSetLocationStatus(id,"draft")} onDelete={id=>void deleteAllLocationSchedules(id)}/>}
          {isAdmin&&<AdminSchedulingCenter schedules={schedules} requests={requests} servants={servants} availability={availability}/>}
          <details className="filter-panel filter-panel-collapsible" open><summary className="filter-title"><span><Search size={17}/> <b>Filter schedule</b></span><ChevronDown size={18}/></summary><div className="filters">
            <label className="search-field"><span>Servant name · any role</span><input value={personFilter} onChange={e=>setPersonFilter(e.target.value)} placeholder="Search servant name"/></label>
            <label><span>Church location</span><select value={locationFilter} onChange={e=>setLocationFilter(e.target.value)}><option value="">All locations</option>{locations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
            <label><span>Service</span><select value={serviceFilter} onChange={e=>setServiceFilter(e.target.value)}><option value="">All services</option>{[...new Set(schedules.map(s=>s.service_name))].sort().map(n=><option key={n}>{n}</option>)}</select></label>
            <label><span>From</span><input type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)}/></label>
            <label><span>To</span><input type="date" value={toDate} onChange={e=>setToDate(e.target.value)}/></label>
          </div><button className="clear-btn" onClick={()=>{setPersonFilter("");setLocationFilter("");setServiceFilter("");setFromDate("");setToDate("");}}>Clear all filters</button></details>
          <details className="collapsible-panel" open>
            <summary><span><b>{calendarView==="week"?"Weekly calendar":"Monthly calendar"} · Daily overview</b><small>{dailyGroups.length} days · summary by church location</small></span><ChevronDown size={20}/></summary>
            {calendarSections.length>0&&calendarSections.map(section=><section className="calendar-period" key={section.key}><h3>{section.label}</h3><div className="daily-overview">{section.groups.map(group=><DailySummary key={group.date} date={group.date} items={group.items} isAdmin={isAdmin}/>)}</div></section>)}
          </details>
          <details className="collapsible-panel service-panel" open>
            <summary><span><b>Service details</b><small>{filtered.length} service slots · expand a service to see assignments</small></span><ChevronDown size={20}/></summary>
            {loading?<div className="empty-state"><GmsLoader label="Loading schedule…"/></div>:filtered.length===0?<div className="empty-state"><CalendarDays size={30}/><b>No service slots found</b><p>Try changing your filters or generate a weekend schedule.</p></div>:
              <div className="schedule-location-groups">{locations.filter(l=>filtered.some(s=>s.location_id===l.id)).map(location=><section className="schedule-location-group" key={location.id}><h3>{location.name}</h3><div className="schedule-grid">{filtered.filter(s=>s.location_id===location.id).sort((a,b)=>a.service_date.localeCompare(b.service_date)||a.start_time.localeCompare(b.start_time)).map(s=><ScheduleCard key={s.id} item={s} isAdmin={isAdmin} onEdit={()=>{setScheduleError("");setEditing(s);setModal("schedule");}} onDelete={()=>deleteSchedule(s)} onPublish={()=>publishSchedule(s)} myServantId={myServant?.id??""} onConfirm={(status)=>confirmAssignment(s,status)} onRequest={(kind)=>submitServingRequest(s,kind)}/>)}</div></section>)}</div>}
          </details>
          {isAdmin&&<GeneratePanel templates={templates} locations={locations} onGenerate={generateWeekend} onAddTemplate={async(locationId,day,name,start,end)=>{if(!supabase||!isAdmin)return;const {error}=await supabase.from("service_templates").upsert({location_id:locationId,day_of_week:day,service_name:name,start_time:start,end_time:end,active:true},{onConflict:"location_id,day_of_week,service_name"});if(error)throw error;await loadData();setMessage(`${name} template saved. Select it above to generate future weekends.`);}} onDeleteTemplate={async(template)=>{if(!supabase||!isAdmin)return;const ok=await askAction("Remove service template",`Remove ${template.service_name} (${dayNameForTemplate(template.day_of_week)}) from future recurring generation? Existing schedules already generated from this template will not be deleted.`,"Remove template",true);if(!ok)return;const {error}=await supabase.from("service_templates").update({active:false}).eq("id",template.id);if(error){setMessage(error.message);return;}await loadData();setMessage(`${template.service_name} was removed from active templates. Existing schedules were preserved.`);}}/>}
        </>:tab==="servantInfo"?<ServantInformationPanel servants={servants} memberDirectory={memberDirectory} locations={locations} schedules={schedules} requests={requests} onAdd={()=>setModal("person")} onToggle={togglePerson}/>:tab==="inbox"&&!isAdmin?<ServantInbox requests={requests.filter(r=>r.requester_servant_id===myServant?.id)} schedules={schedules} reads={requestReads} onRead={markRequestRead} notifications={notifications.filter(n=>n.recipient_user_id===session?.user?.id)} onNotificationRead={markNotificationRead} pushEnabled={pushEnabled} pushBusy={pushBusy} onEnablePush={enablePushNotifications} onDisablePush={disablePushNotifications}/>:tab==="requests"&&isAdmin?<RequestsPanel requests={requests} schedules={schedules} servants={servants} onReview={reviewRequest} onResolve={resolveReplacement} notifications={notifications.filter(n=>n.recipient_user_id===session?.user?.id)} onNotificationRead={markNotificationRead} pushEnabled={pushEnabled} pushBusy={pushBusy} onEnablePush={enablePushNotifications} onDisablePush={disablePushNotifications}/>:tab==="availability"?<AvailabilityPanel servants={servants} availability={availability} rules={availabilityRules} preferences={servingPreferences} locations={locations} schedules={schedules} templates={templates} isAdmin={isAdmin} currentUserId={session.user.id} onSave={saveAvailability} onBulkSave={saveBulkAvailability} onSaveRule={saveAvailabilityRule} onSavePreference={saveServingPreference} onDeletePreference={deleteServingPreference} onDeleteRule={async(id)=>{const ok=await askAction("Delete recurring restriction?","Future dates generated by this rule will no longer be treated as unavailable. Existing dated availability records will remain unchanged.","Delete rule",true);if(ok)await deleteAvailabilityRule(id);}} onDelete={deleteAvailability} deadline={availabilityDeadline} onSaveDeadline={saveDeadline}/>:tab==="statistics"?<StatisticsPanel schedules={filtered} servants={servants}/>:tab==="audit"?<AuditPanel logs={auditLogs} onDownload={exportAuditHistory}/>:(!isAdmin&&tab==="profile")?<MemberProfilePanel profile={memberProfile} isAdmin={false} directory={[]} onSave={async(payload)=>{if(!supabase)return;const {error}=await supabase.from("member_profiles").upsert({user_id:session.user.id,...payload,last_verified_at:new Date().toISOString(),updated_at:new Date().toISOString()},{onConflict:"user_id"});if(error){setMessage(error.message);return;}await supabase.from("profiles").update({display_name:payload.full_name}).eq("id",session.user.id);await supabase.from("servants").update({full_name:payload.full_name}).eq("auth_user_id",session.user.id);if(payload.email!==memberProfile.email){const {error:emailError}=await supabase.auth.updateUser({email:payload.email});if(emailError)setMessage("Profile saved, but email change needs attention: "+emailError.message);}setMessage("Profile updated and verification date refreshed.");await loadData();}}/>:null}
      </main>
    </div>
    <nav className="mobile-bottom-nav" aria-label="Primary navigation">
      <button className={`mobile-nav-item ${tab==="schedule"?"active":""}`} onClick={()=>{setTab("schedule");setMobileNav(false);}}>
        <CalendarDays size={20}/><span>Schedule</span>
      </button>
      <button className={`mobile-nav-item ${tab==="availability"?"active":""}`} onClick={()=>{setTab("availability");setMobileNav(false);}}>
        <ClipboardCheck size={20}/><span>Availability</span>
      </button>
      <button className={`mobile-nav-item ${(!isAdmin&&tab==="inbox")||(isAdmin&&tab==="requests")?"active":""}`} onClick={()=>{setTab(isAdmin?"requests":"inbox");setMobileNav(false);}}>
        <InboxIcon size={20}/><span>{isAdmin?"Requests":"Inbox"}</span>
        {(isAdmin ? (requests.filter(r=>r.status==="pending").length+notifications.filter(n=>n.recipient_user_id===session?.user?.id&&!n.is_read).length) : requests.filter(r=>r.requester_servant_id===myServant?.id&&["approved","declined","rejected"].includes(String(r.status).toLowerCase())&&!requestReads.some(x=>x.request_id===r.id&&x.user_id===session?.user?.id)).length)>0&&<i className="mobile-nav-badge"/>}
      </button>
      <button className={`mobile-nav-item ${mobileNav?"active":""}`} aria-expanded={mobileNav} onClick={()=>setMobileNav(v=>!v)}>
        <MoreHorizontal size={20}/><span>More</span>
      </button>
    </nav>
    {mobileNav&&<div className="mobile-more-backdrop" onClick={()=>setMobileNav(false)}>
      <div className="mobile-more-menu" onClick={e=>e.stopPropagation()}>
        <div className="mobile-more-heading">More options</div>{!pwaInstalled&&<button onClick={()=>{setMobileNav(false);void installGmsApp();}}><Smartphone size={18}/> Install app</button>}
        {!isAdmin&&<button onClick={()=>{setTab("profile");setMobileNav(false);}}><UserRound size={18}/> My profile</button>}
        {isAdmin&&<>
          <button onClick={()=>{setTab("servantInfo");setMobileNav(false);}}><Users size={18}/> Servant Information</button>
          <button onClick={()=>{setTab("statistics");setMobileNav(false);}}><BarChart3 size={18}/> Statistics</button>
          <button onClick={()=>{setTab("audit");setMobileNav(false);}}><ClipboardCheck size={18}/> Audit log</button>
        </>}
        <button className="mobile-more-signout" onClick={signOut}><LogOut size={18}/> Sign out</button>
      </div>
    </div>}
    {actionDialog&&<div className="modal-backdrop action-dialog-backdrop" role="presentation"><section className="modal-card action-dialog" role="alertdialog" aria-modal="true" aria-labelledby="action-dialog-title"><div className="modal-head"><div><h2 id="action-dialog-title">{actionDialog.title}</h2><p className="subtle action-dialog-message">{actionDialog.message}</p></div><button type="button" className="icon-btn" aria-label="Close" onClick={()=>closeActionDialog(false)}><X/></button></div>{actionDialog.inputLabel&&<label className="action-dialog-input">{actionDialog.inputLabel}<input autoFocus value={actionDialogInput} onChange={e=>setActionDialogInput(e.target.value)}/></label>}<div className="modal-actions"><button type="button" className="btn secondary" onClick={()=>closeActionDialog(false)}>Cancel</button><button type="button" className={`btn ${actionDialog.danger?"danger":"primary"}`} disabled={!!actionDialog.requiredText&&actionDialogInput!==actionDialog.requiredText} onClick={()=>closeActionDialog(true)}>{actionDialog.confirmLabel??"Continue"}</button></div></section></div>}
    {modal==="schedule"&&<ScheduleModal locations={locations} servants={servants.filter(s=>s.active)} availability={availability} preferences={servingPreferences} schedules={schedules} editing={editing} onClose={()=>{setScheduleError("");setModal(null);setEditing(null);}} onSave={saveSchedule} error={scheduleError}/>}
    {modal==="person"&&<PersonModal onClose={()=>setModal(null)} onSave={savePerson}/>}
    {swapDraft&&<DirectSwapModal source={swapDraft} schedules={schedules} servantId={myServant?.id??""} onClose={()=>setSwapDraft(null)} onSubmit={submitDirectSwap}/>}
  </div>;
}


function ChurchBulkActions({locations,disabled,onPublish,onUnpublish,onDelete}:{locations:Location[];disabled:boolean;onPublish:(id:string)=>void;onUnpublish:(id:string)=>void;onDelete:(id:string)=>void}){
 const [locationId,setLocationId]=useState("");
 useEffect(()=>{if(!locationId&&locations.length)setLocationId(locations[0].id);else if(locationId&&!locations.some(l=>l.id===locationId))setLocationId(locations[0]?.id??"");},[locations,locationId]);
 return <section className="church-bulk-actions"><div><b>Church-wide schedule actions</b><p className="subtle">Publish, unpublish or delete all service slots for one church location.</p></div><div className="church-bulk-controls"><label className="church-location-picker"><span>Church location</span><select value={locationId} onChange={e=>setLocationId(e.target.value)} disabled={!locations.length||disabled}>{locations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label><button className="btn primary" disabled={!locationId||disabled} onClick={()=>onPublish(locationId)}>Publish all</button><button className="btn secondary" disabled={!locationId||disabled} onClick={()=>onUnpublish(locationId)}>Unpublish all</button><button className="btn danger" disabled={!locationId||disabled} onClick={()=>onDelete(locationId)}><Trash2 size={14}/> Delete all</button></div></section>;
}
function MyUpcomingAssignments({items,servantId,onConfirm,onRequest}:{items:ScheduleView[];servantId:string;onConfirm:(s:ScheduleView,status:"confirmed"|"declined")=>void;onRequest:(s:ScheduleView,kind:"replacement"|"swap")=>void}){
 const grouped=[...new Map(items.map(s=>[s.location_id,{id:s.location_id,name:s.location_name}])).values()];
 return <section className="my-upcoming-panel"><div className="my-upcoming-panel-head"><div><h3>My upcoming serving assignments</h3><p className="subtle">Confirm your upcoming service or request a replacement or swap.</p></div><span>{items.length} upcoming</span></div>{!items.length?<p className="my-upcoming-empty">You have no upcoming published assignments.</p>:grouped.map(location=><div className="my-upcoming-location" key={location.id}><h4>{location.name}</h4><div className="my-upcoming-list">{items.filter(s=>s.location_id===location.id).map(s=>{const own=s.assignments.find(a=>a.servant_id===servantId);return <article className="my-upcoming-item" key={s.id}><div className="my-upcoming-info"><b>{fmtDate(s.service_date)} · {s.service_name}</b><span>{shortTime(s.start_time)}–{shortTime(s.end_time)} · Your role: {own?.role??"Assigned"}</span><small>Confirmation: {own?.confirmation_status??"pending"}</small></div><div className="my-upcoming-actions"><button className="btn tiny primary" onClick={()=>onConfirm(s,"confirmed")}>Accept</button><button className="btn tiny secondary" onClick={()=>onRequest(s,"swap")}>Request swap</button><button className="btn tiny secondary" onClick={()=>onRequest(s,"replacement")}>Request replacement</button></div></article>;})}</div></div>)}</section>;
}

function DirectSwapModal({source,schedules,servantId,onClose,onSubmit}:{source:ScheduleView;schedules:ScheduleView[];servantId:string;onClose:()=>void;onSubmit:(scheduleId:string,assignmentId:string,details:string)=>void}){
 const candidates=schedules.filter(s=>s.status==="published"&&s.id!==source.id&&s.service_date!==source.service_date&&s.assignments.some(a=>a.servant_id&&a.servant_id!==servantId));
 const [targetId,setTargetId]=useState("");const [assignmentId,setAssignmentId]=useState("");const [details,setDetails]=useState("");
 const selected=candidates.find(s=>s.id===targetId);const eligible=selected?.assignments.filter(a=>a.servant_id&&a.servant_id!==servantId)??[];
 return <div className="modal-backdrop"><section className="modal-card swap-modal"><div className="modal-heading"><div><h2>Request a schedule swap</h2><p className="subtle">Choose another servant's published assignment, even on a different date.</p></div><button className="icon-btn" onClick={onClose}><X/></button></div><div className="swap-source"><b>Your assignment</b><span>{fmtDate(source.service_date)} · {source.location_name} · {source.service_name}</span></div><label>Swap with service<select value={targetId} onChange={e=>{setTargetId(e.target.value);setAssignmentId("");}}><option value="">Select another date and service</option>{candidates.map(s=><option key={s.id} value={s.id}>{fmtDate(s.service_date)} · {s.location_name} · {s.service_name}</option>)}</select></label><label>Servant assignment<select value={assignmentId} onChange={e=>setAssignmentId(e.target.value)} disabled={!selected}><option value="">Select servant</option>{eligible.map(a=><option key={a.id} value={a.id}>{a.servant_name} · {a.role}</option>)}</select></label><label>Note (optional)<textarea value={details} onChange={e=>setDetails(e.target.value)} placeholder="Add a note for the administrator"/></label><div className="modal-actions"><button className="btn secondary" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!targetId||!assignmentId} onClick={()=>onSubmit(targetId,assignmentId,details)}>Submit swap request</button></div></section></div>;
}
function AdminSchedulingCenter({schedules,requests,servants,availability}:{schedules:ScheduleView[];requests:any[];servants:Servant[];availability:any[]}){
 const upcoming=schedules.filter(s=>s.service_date>=today());
 const incomplete=upcoming.filter(s=>!["FOH","Monitor"].every(role=>s.assignments.some(a=>a.role===role&&a.servant_id)));
 const pending=requests.filter(r=>r.status==="pending").length;
 const unconfirmed=upcoming.reduce((n,s)=>n+s.assignments.filter(a=>a.servant_id&&a.confirmation_status!=="confirmed").length,0);
 const thirtyDaysAgo=new Date(Date.now()-30*86400000).toLocaleDateString("en-CA");
 const workload=servants.filter(p=>p.active).map(p=>({id:p.id,name:p.full_name,days:new Set(schedules.filter(s=>s.service_date>=thirtyDaysAgo&&s.service_date<=today()&&s.assignments.some(a=>a.servant_id===p.id)).map(s=>s.service_date)).size})).sort((a,b)=>b.days-a.days);
 const high=workload.filter(p=>p.days>=5);
 const crossChurch=upcoming.filter(s=>s.assignments.some(a=>a.servant_id&&upcoming.some(other=>other.id!==s.id&&other.service_date===s.service_date&&other.location_id!==s.location_id&&other.assignments.some(x=>x.servant_id===a.servant_id))));
 const unavailable=upcoming.flatMap(s=>s.assignments.filter(a=>a.servant_id&&availability.some(v=>v.servant_id===a.servant_id&&v.service_date===s.service_date&&v.status==="unavailable")).map(a=>({name:a.servant_name,service:s.service_name,date:s.service_date})));
 const validationCount=incomplete.length+crossChurch.length+unavailable.length;
 return <section className="admin-control-center">
  <div className="control-center-head"><div><h2>Scheduling control center</h2><p className="subtle">Coverage, availability, conflicts and serving workload before publication.</p></div></div>
  <div className="control-center-grid"><div><small>Incomplete services</small><b>{incomplete.length}</b><span>Missing FOH or Monitor</span></div><div><small>Pending requests</small><b>{pending}</b><span>Awaiting admin review</span></div><div><small>Awaiting confirmation</small><b>{unconfirmed}</b><span>Upcoming assignments</span></div><div><small>Validation flags</small><b>{validationCount}</b><span>Coverage or church conflicts</span></div></div>
  {incomplete.length>0&&<div className="control-center-alert"><AlertTriangle size={16}/><span>{incomplete.length} service(s) need FOH or Monitor coverage.</span></div>}
  {crossChurch.length>0&&<div className="control-center-alert"><AlertTriangle size={16}/><span>{crossChurch.length} service(s) have a servant assigned at another church on the same day.</span></div>}
  {unavailable.length>0&&<div className="control-center-alert"><AlertTriangle size={16}/><span>{unavailable.length} assignment(s) conflict with submitted unavailability: {unavailable.slice(0,4).map(x=>`${x.name} · ${x.service} · ${fmtDate(x.date)}`).join("; ")}.</span></div>}
  <div className="workload-preview"><div className="workload-copy"><b>Fair workload · last 30 days</b><span>Calendar days served per active servant. Multiple services on the same day count once.</span></div>
   {high.length===0?<p className="workload-status">No servants currently exceed the 5-day workload warning threshold.</p>:<div className="workload-list">{high.slice(0,5).map(p=><div className="workload-row" key={p.id}><span>{p.name}</span><b>{p.days} days</b><em>High frequency</em></div>)}</div>}
  </div>
 </section>;
}

function MyScheduleSummary({daysServed,upcoming,servantId}:{daysServed:number;upcoming:ScheduleView|null;servantId:string}){
 const myRole=upcoming?.assignments.find(a=>a.servant_id===servantId)?.role;
 return <section className="my-schedule-summary">
  <div className="my-days-card"><span className="my-schedule-label">YOUR SERVING DAYS</span><strong>{daysServed}</strong><small>Unique days served in the last 30 days</small></div>
  <div className="my-next-card"><div className="my-next-heading"><CalendarDays size={17}/><b>My next serving schedule</b></div>
   {upcoming?<><div className="my-next-date">{fmtDate(upcoming.service_date)}</div><div className="my-next-detail"><b>{upcoming.location_name}</b><span>{upcoming.service_name} · {shortTime(upcoming.start_time)}–{shortTime(upcoming.end_time)}</span><span>Your role: <b>{myRole??"Assigned"}</b></span></div></>:<p className="my-next-empty">No upcoming published assignment.</p>}
  </div>
 </section>;
}

function DailySummary({date,items,isAdmin=true}:{date:string;items:ScheduleView[];isAdmin?:boolean}){
 const locations=[...new Map(items.map(item=>[item.location_id,{id:item.location_id,name:item.location_name}])).values()];
 const assigned=items.reduce((n,item)=>n+item.assignments.filter(a=>a.servant_id&&a.role!=="Assistant").length,0);
 const required=items.length*2;
 const servantLocations=new Map<string,Set<string>>();
 for(const item of items)for(const assignment of item.assignments){const set=servantLocations.get(assignment.servant_id)??new Set<string>();set.add(item.location_id);servantLocations.set(assignment.servant_id,set);}
 const crossLocationConflicts=[...servantLocations.entries()].filter(([,ids])=>ids.size>1).map(([id])=>items.flatMap(i=>i.assignments.filter(a=>a.servant_id===id).map(a=>a.servant_name))[0]);
 const dayLabel=new Date(`${date}T12:00:00`).toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"});
 return <details className="daily-card" open>
  <summary className="daily-head"><div><div className="daily-date">{dayLabel}</div><div className="daily-subtitle">{items.length} services · {locations.length} {locations.length===1?"location":"locations"}</div></div><div className="daily-head-right">{isAdmin&&<div className={`coverage-pill ${assigned>=required?"complete":"pending"}`}>{assigned}/{required} required roles filled</div>}<ChevronDown size={19}/></div></summary>
  {crossLocationConflicts.length>0&&<div className="day-conflict-warning"><AlertTriangle size={16}/><span><b>Cross-location conflict:</b> {crossLocationConflicts.join(", ")} assigned at more than one church location on this date.</span></div>}
  <div className="daily-locations">{locations.map(location=>{
   const services=items.filter(item=>item.location_id===location.id).sort((a,b)=>a.start_time.localeCompare(b.start_time));
   return <div className="daily-location" key={location.id}><div className="daily-location-name">{location.name}</div><div className="daily-services">{services.map(item=><div className="daily-service" key={item.id}>
    <div className="daily-service-top"><b>{item.service_name}</b><span>{shortTime(item.start_time)}–{shortTime(item.end_time)}</span></div>
    <div className="daily-roles">{(item.status==="published"&&!item.assignments.some(a=>a.role==="Assistant")?["FOH","Monitor"]:ROLES).map(role=>{const assignment=item.assignments.find(a=>a.role===role);return <div className={`daily-role-row ${!assignment&&role!=="Assistant"?"role-missing":""}`} key={role}><b>{role}</b><span>{assignment?.servant_name??(role==="Assistant"?"Optional":"UNASSIGNED")}</span></div>;})}</div>
   </div>)}</div></div>;
  })}</div>
 </details>;
}

function Stat({label,value}:{label:string;value:number|string}){return <div className="stat-card"><span>{label}</span><b>{value}</b></div>;}
function ScheduleCard({item,isAdmin,onEdit,onDelete,onPublish,myServantId,onConfirm,onRequest}:{item:ScheduleView;isAdmin:boolean;onEdit:()=>void;onDelete:()=>void;onPublish:()=>void;myServantId:string;onConfirm:(status:"confirmed"|"declined")=>void;onRequest:(kind:"replacement"|"swap")=>void}){
 const own=item.assignments.find(a=>a.servant_id===myServantId);
 return <details className="schedule-card" open><summary className="schedule-card-summary"><div><div className="date-text">{fmtDate(item.service_date)} {isAdmin&&<span className={`status-chip ${item.status||"draft"}`}>{item.status||"draft"}</span>}</div><div className="location-text">{item.location_name}</div><div className="service-title">{item.service_name}</div><div className="time-text">{shortTime(item.start_time)} – {shortTime(item.end_time)}</div></div><ChevronDown size={19}/></summary>
  <div className="role-grid">{(item.status==="published"&&!item.assignments.some(a=>a.role==="Assistant")?["FOH","Monitor"]:ROLES).map(r=>{const a=item.assignments.find(x=>x.role===r);return <div className={`role-box ${r==="Assistant"?"optional":""}`} key={r}><small>{r}{r==="Assistant"?" · optional":""}</small><b>{a?.servant_name??"Unassigned"}</b></div>;})}</div>
  {!isAdmin&&!!own&&<div className="servant-card-actions"><div className="confirmation-line">Your confirmation: <b>{own?.confirmation_status||"pending"}</b></div><button className="btn tiny primary" onClick={()=>onConfirm("confirmed")}>Confirm</button><button className="btn tiny secondary" onClick={()=>onConfirm("declined")}>Decline</button><button className="btn tiny secondary" onClick={()=>onRequest("replacement")}>Request replacement</button><button className="btn tiny secondary" onClick={()=>onRequest("swap")}>Request swap</button></div>}
  {isAdmin&&<div className="card-actions"><button className="btn tiny secondary" onClick={onEdit}><Pencil size={13}/> Edit</button><button className="btn tiny secondary" onClick={onPublish}>{item.status==="published"?"Unpublish":"Publish"}</button><button className="btn tiny danger" onClick={onDelete}><Trash2 size={13}/> Delete</button></div>}
 </details>;
}

function GeneratePanel({templates,locations,onGenerate,onAddTemplate,onDeleteTemplate}:{templates:any[];locations:Location[];onGenerate:(date:string,weeks:number,templateIds:string[],mode:"add"|"replace")=>void;onAddTemplate:(locationId:string,day:number,name:string,start:string,end:string)=>Promise<void>;onDeleteTemplate:(template:any)=>Promise<void>}){
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
 return <details className="generate-panel generate-panel-collapsible" open><summary className="generate-panel-summary"><div className="generate-heading"><div><b>Bulk generate recurring weekend slots</b><p className="subtle">Choose the church services to generate and how existing matching slots should be handled.</p></div></div><ChevronDown className="generate-chevron" size={19}/></summary><div className="generate-panel-content">
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
  <div className="generate-footer"><label>Start Saturday<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label>Duration<select value={weeks} onChange={e=>setWeeks(Number(e.target.value))}><option value={1}>1 weekend</option><option value={2}>2 weekends</option><option value={4}>4 weekends</option><option value={8}>8 weekends</option><option value={12}>12 weekends</option></select></label><label>Existing matching slots<select value={mode} onChange={e=>setMode(e.target.value as "add"|"replace")}><option value="add">Add missing only</option><option value="replace">Replace times from template</option></select></label><button className="btn primary" disabled={!selected.length||!templates.length} onClick={()=>onGenerate(date,weeks,selected,mode)}><CalendarDays size={16}/> Generate</button></div>
  <div className="generate-note"><div className="generate-note-title"><Info size={16}/><b>How generation handles existing services</b></div><p><b>Add missing only</b><span>Leaves existing matching slots unchanged.</span></p><p><b>Replace times from template</b><span>Updates matching service times while preserving existing assignments. Other services are not deleted.</span></p></div>
 </div></details>;
}
function ScheduleModal({locations,servants,availability,preferences,schedules,editing,onClose,onSave,error}:{locations:Location[];servants:Servant[];availability:any[];preferences:any[];schedules:ScheduleView[];editing:ScheduleView|null;onClose:()=>void;onSave:(e:FormEvent<HTMLFormElement>)=>void;error:string}){
 const [serviceDate,setServiceDate]=useState(editing?.service_date??today());
 const [locationId,setLocationId]=useState(editing?.location_id??locations[0]?.id??"");
 const [serviceName,setServiceName]=useState(editing?.service_name??"");
 const [startTime,setStartTime]=useState(shortTime(editing?.start_time??"09:00"));
 const [endTime,setEndTime]=useState(shortTime(editing?.end_time??"11:00"));
 const existing=(role:Role)=>editing?.assignments.find(a=>a.role===role)?.servant_id??"";
 const workloadDays=(servantId:string)=>new Set(schedules.filter(s=>s.service_date<serviceDate&&s.service_date>=new Date(new Date(`${serviceDate}T12:00:00`).getTime()-30*86400000).toLocaleDateString("en-CA")&&s.assignments.some(a=>a.servant_id===servantId)).map(s=>s.service_date)).size;
 const availabilityStatus=(servantId:string)=>availability.find(a=>a.servant_id===servantId&&a.service_date===serviceDate)?.status??"not submitted";
 const eligibilityNote=(servantId:string)=>{const prefs=preferences.filter(r=>r.servant_id===servantId&&r.active!==false&&(!r.effective_from||r.effective_from<=serviceDate)&&(!r.effective_until||r.effective_until>=serviceDate));const dow=new Date(`${serviceDate}T12:00:00`).getDay();const timeRules=prefs.filter(r=>r.rule_type==="allowed_time_window");const serviceRules=prefs.filter(r=>r.rule_type==="allowed_service_scope");const timeOk=!timeRules.length||timeRules.some(r=>(!r.days_of_week?.length||r.days_of_week.includes(dow))&&startTime>=String(r.start_time).slice(0,5)&&endTime<=String(r.end_time).slice(0,5));const serviceOk=!serviceRules.length||serviceRules.some(r=>r.location_id===locationId&&(!r.service_names?.length||r.service_names.includes(serviceName)));return !timeOk?" · OUTSIDE ALLOWED TIME":!serviceOk?" · SERVICE NOT ALLOWED":"";};
 return <div className="modal-backdrop"><form className="modal-card" onSubmit={onSave}><div className="modal-head"><div><h2>{editing?"Edit service assignment":"Add service assignment"}</h2><p className="subtle">Add a regular or special service on any date, including weekdays. FOH and Monitor are required; Assistant is optional.</p></div><button type="button" className="icon-btn" onClick={onClose}><X/></button></div>
  <div className="form-grid"><label>Date<input name="service_date" type="date" required value={serviceDate} onChange={e=>setServiceDate(e.target.value)}/></label><label>Location<select name="location_id" required value={locationId} onChange={e=>setLocationId(e.target.value)}>{locations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
   <label className="wide">Service name<input name="service_name" required value={serviceName} onChange={e=>setServiceName(e.target.value)} placeholder="e.g. Special Service, Christmas, Prayer Meeting"/></label><label>Start time<input name="start_time" type="time" required value={startTime} onChange={e=>setStartTime(e.target.value)}/></label><label>End time<input name="end_time" type="time" required value={endTime} onChange={e=>setEndTime(e.target.value)}/></label>
   {ROLES.map(r=><label className="wide" key={r}>{r}{r==="Assistant"?" (optional)":" (required)"}<select name={r} required={r!=="Assistant"} defaultValue={existing(r)}><option value="">{r==="Assistant"?"Not assigned":"Select servant"}</option>{servants.map(p=>{const av=availabilityStatus(p.id);const days=workloadDays(p.id);const label=av==="unavailable"?" · UNAVAILABLE":av==="prefer_not"?" · PREFERS NOT TO SERVE":av==="available"?" · Available": " · Availability not submitted";const eligibility=eligibilityNote(p.id);return <option key={p.id} value={p.id}>{p.full_name}{label}{eligibility} · {days} days served in prior 30d</option>;})}</select></label>)}
  </div><div className="availability-guidance"><div className="availability-guidance-title"><ShieldCheck size={17}/><b>Assignment guidance</b></div><p>Servant options show their availability and workload over the previous 30 days.</p><p>Unavailable servants and high-workload selections are checked again before saving.</p></div>{error&&<div className="schedule-error" role="alert"><AlertTriangle size={18}/><span>{error}</span></div>}<div className="modal-actions"><button type="button" className="btn secondary" onClick={onClose}>Cancel</button><button className="btn primary">Save assignment</button></div>
 </form></div>;
}
function PersonModal({onClose,onSave}:{onClose:()=>void;onSave:(e:FormEvent<HTMLFormElement>)=>void}){
 return <div className="modal-backdrop"><form className="modal-card compact" onSubmit={onSave}><div className="modal-head"><h2>Add servant</h2><button type="button" className="icon-btn" onClick={onClose}><X/></button></div><label>Full name<input name="full_name" required autoFocus placeholder="Servant's full name"/></label><div className="modal-actions"><button type="button" className="btn secondary" onClick={onClose}>Cancel</button><button className="btn primary">Add person</button></div></form></div>;
}
function GmsLoader({label="Getting the sound system ready..."}:{label?:string}){
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
 const section=(key:keyof typeof openSummary,title:string,sub:string,body:ReactNode)=><details className="servant-summary-section" open={openSummary[key]} onToggle={e=>{const isOpen=(e.currentTarget as HTMLDetailsElement).open;setOpenSummary(v=>({...v,[key]:isOpen}));}}><summary><span><b>{title}</b><small>{sub}</small></span><ChevronDown size={18}/></summary><div className="servant-summary-body">{body}</div></details>;
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
   <div className="servant-record-list">{filtered.length===0?<div className="servant-empty-state"><b>No servant records to display</b><p>{servants.length===0?"No servant rows were returned. Check the Supabase servants table and its SELECT policy for the admin role.":"No servants match the current search or filters."}</p><button className="btn secondary" onClick={()=>{setQuery("");setLocationFilter("");setCgFilter("");setStatusFilter("");}}>Clear filters</button></div>:filtered.map(({servant:s,profile:m})=><article className="servant-record" key={s.id}><button className="servant-record-summary" onClick={()=>toggle(s.id)}><span className="servant-avatar">{s.full_name.slice(0,1).toUpperCase()}</span><span className="servant-record-name"><b>{s.full_name}</b><small>{value({servant:s,profile:m},"cg_category")||"CG not recorded"} · {servantLocationNames(s.id).join(", ")||"No serving assignment"}</small></span><span className={`servant-account-chip ${s.auth_user_id?"linked":"unlinked"}`}>{s.auth_user_id?"Linked":"Not linked"}</span><ChevronDown size={18}/></button>
    {expanded.includes(s.id)&&<div className="servant-record-detail"><div><h4>Personal information</h4><p><b>Email:</b> {m?.email||"—"}</p><p><b>Gender:</b> {value({servant:s,profile:m},"gender")||"—"}</p><p><b>Date of birth:</b> {value({servant:s,profile:m},"date_of_birth")||"—"}</p><p><b>NIJ:</b> {value({servant:s,profile:m},"nij")||"—"}</p><p><b>Phone:</b> {value({servant:s,profile:m},"phone_number")||"—"}</p><p><b>Domicile:</b> {[value({servant:s,profile:m},"domicile_area"),value({servant:s,profile:m},"domicile_other")].filter(Boolean).join(" · ")||"—"}</p></div><div><h4>CG information</h4><p><b>Category:</b> {value({servant:s,profile:m},"cg_category")||"—"}</p><p><b>Status:</b> {value({servant:s,profile:m},"cg_status")||"—"}</p><p><b>CG number:</b> {value({servant:s,profile:m},"cg_number")||"—"}</p><p><b>Days:</b> {displayList(value({servant:s,profile:m},"cg_days"))||"—"}</p><p><b>Time:</b> {value({servant:s,profile:m},"cg_time")||"—"}</p></div><div><h4>Leadership & account</h4><p><b>Team Leader:</b> {value({servant:s,profile:m},"team_leader_name")||"—"}</p><p><b>Coach:</b> {value({servant:s,profile:m},"coach_name")||"—"}</p><p><b>CG Leader:</b> {value({servant:s,profile:m},"cg_leader_name")||"—"}</p><p><b>Leader phone(s):</b> {displayList(value({servant:s,profile:m},"leader_phone_numbers"))||"—"}</p><p><b>Account:</b> {m?.username||"No username linked"}</p><p><b>Profile verified:</b> {m?.last_verified_at?new Date(m.last_verified_at).toLocaleDateString():"Not yet verified"}</p><p><b>Serving status:</b> {s.active?"Active":"Inactive"}</p>{<button className={`btn tiny ${s.active?"secondary":"primary"}`} onClick={()=>onToggle(s)}>{s.active?"Deactivate servant":"Activate servant"}</button>}</div></div>}
   </article>)}</div>
  </div>
 </div>;
}

function PeoplePanel({servants,isAdmin,onAdd,onToggle}:{servants:Servant[];isAdmin:boolean;onAdd:()=>void;onToggle:(p:Servant)=>void}){
 const [q,setQ]=useState("");
 const rows=servants.filter(p=>p.full_name.toLowerCase().includes(q.toLowerCase()));
 return <><div className="toolbar"><div><h2>Servant directory</h2><p className="subtle">Manage the names available for role assignments.</p></div>{isAdmin&&<button className="btn primary" onClick={onAdd}><Plus size={16}/> Add servant</button>}</div><section className="filter-panel"><label className="search-field"><span>Search people</span><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search by name"/></label></section><div className="people-list">{rows.map(p=><div className="person-row" key={p.id}><div className="avatar">{p.full_name.slice(0,1).toUpperCase()}</div><div className="person-name"><b>{p.full_name}</b><small>{p.active?"Active":"Inactive"}</small></div>{isAdmin&&<button className={`btn tiny ${p.active?"secondary":"primary"}`} onClick={()=>onToggle(p)}>{p.active?"Deactivate":"Activate"}</button>}</div>)}</div></>;
}
function AvailabilityPanel({servants,availability,rules,preferences,locations,schedules,templates,isAdmin,currentUserId,onSave,onBulkSave,onSaveRule,onDeleteRule,onSavePreference,onDeletePreference,onDelete,deadline,onSaveDeadline}:{servants:Servant[];availability:any[];rules:any[];preferences:any[];locations:Location[];schedules:ScheduleView[];templates:any[];isAdmin:boolean;currentUserId:string;onSave:(e:FormEvent<HTMLFormElement>)=>void;onBulkSave:(rows:any[])=>Promise<boolean>;onSaveRule:(rule:any)=>Promise<boolean>;onDeleteRule:(id:string)=>void;onSavePreference:(preference:any)=>Promise<boolean>;onDeletePreference:(id:string)=>void;onDelete:(id:string)=>void;deadline:string;onSaveDeadline:(e:FormEvent<HTMLFormElement>)=>void}){
 const [dateFilter,setDateFilter]=useState("");
 const [entryMode,setEntryMode]=useState<"single"|"person"|"day">("single");
 const [bulkPerson,setBulkPerson]=useState(""); const [bulkPeople,setBulkPeople]=useState<string[]>([]);
 const [bulkFrom,setBulkFrom]=useState(today()); const [bulkTo,setBulkTo]=useState(today()); const [bulkStatus,setBulkStatus]=useState("unavailable");
 const [bulkPattern,setBulkPattern]=useState("daily"); const [bulkWeekdays,setBulkWeekdays]=useState<number[]>([1,2,3,4,5,6,0]); const [bulkNotes,setBulkNotes]=useState("");
 const [previewRows,setPreviewRows]=useState<any[]|null>(null); const [previewConflicts,setPreviewConflicts]=useState<any[]>([]);
 const [rulePerson,setRulePerson]=useState(""); const [rulePattern,setRulePattern]=useState("weekday"); const [ruleStatus,setRuleStatus]=useState("unavailable"); const [ruleFrom,setRuleFrom]=useState(today()); const [ruleUntil,setRuleUntil]=useState(""); const [ruleWeekday,setRuleWeekday]=useState("6"); const [ruleOrdinal,setRuleOrdinal]=useState("2"); const [ruleNotes,setRuleNotes]=useState("");
 const [preferencePerson,setPreferencePerson]=useState(""); const [preferenceType,setPreferenceType]=useState("allowed_time_window"); const [preferenceDays,setPreferenceDays]=useState<number[]>([0]); const [preferenceStart,setPreferenceStart]=useState("07:00"); const [preferenceEnd,setPreferenceEnd]=useState("11:00"); const [preferenceLocation,setPreferenceLocation]=useState(""); const [preferenceServices,setPreferenceServices]=useState<string[]>([]); const [preferenceNotes,setPreferenceNotes]=useState("");
 const myServant=servants.find(p=>p.auth_user_id===currentUserId);
 const selectable=servants.filter(p=>p.active&&(isAdmin||p.id===myServant?.id));
 const ownRules=rules.filter(r=>isAdmin||r.servant_id===myServant?.id);
 const rows=availability.filter(a=>!a.is_recurring&&a.service_date>=today()&&(isAdmin||a.servant_id===myServant?.id)&&(!dateFilter||a.service_date===dateFilter)).sort((a,b)=>a.service_date.localeCompare(b.service_date));
 const name=(id:string)=>servants.find(p=>p.id===id)?.full_name??"Unknown servant";
 const dateRange=(from:string,to:string)=>{const out:string[]=[];const d=new Date(`${from}T12:00:00`),last=new Date(`${to}T12:00:00`);for(let n=0;d<=last&&n<370;n++,d.setDate(d.getDate()+1))out.push(d.toLocaleDateString("en-CA"));return out;};
 const buildBulkPreview=()=>{if(!bulkFrom||!bulkTo||bulkTo<bulkFrom){setPreviewRows([]);return;}const people=entryMode==="person"?[isAdmin?bulkPerson:(myServant?.id??"")]:bulkPeople;const dates=dateRange(bulkFrom,bulkTo).filter(ds=>{const d=new Date(`${ds}T12:00:00`).getDay();if(bulkPattern==="daily")return true;if(bulkPattern==="weekdays")return d>=1&&d<=5;if(bulkPattern==="weekends")return d===0||d===6;return bulkWeekdays.includes(d);});const next=people.filter(Boolean).flatMap(servant_id=>dates.map(service_date=>({servant_id,service_date,status:bulkStatus,notes:bulkNotes.trim()})));const conflicts=next.filter(n=>availability.some(a=>a.servant_id===n.servant_id&&a.service_date===n.service_date&&a.status!==n.status));setPreviewConflicts(conflicts);setPreviewRows(next);};
 const togglePerson=(id:string)=>setBulkPeople(v=>v.includes(id)?v.filter(x=>x!==id):[...v,id]);
 const savePreview=async()=>{if(!previewRows?.length)return;const ok=await onBulkSave(previewRows);if(ok){setPreviewRows(null);setBulkPeople([]);setBulkNotes("");}};
 const makeRule=async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const servant_id=isAdmin?rulePerson:myServant?.id;if(!servant_id)return;const rule={servant_id,pattern:rulePattern,status:ruleStatus,effective_from:ruleFrom,effective_until:ruleUntil||null,weekday:Number(ruleWeekday),ordinal:Number(ruleOrdinal),notes:ruleNotes.trim()};await onSaveRule(rule);};
 const savePreference=async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const servant_id=isAdmin?preferencePerson:myServant?.id;if(!servant_id)return;const payload=preferenceType==="allowed_time_window"?{servant_id,rule_type:preferenceType,days_of_week:preferenceDays,start_time:preferenceStart,end_time:preferenceEnd,location_id:null,service_names:[],notes:preferenceNotes.trim(),active:true}:{servant_id,rule_type:preferenceType,days_of_week:[],start_time:null,end_time:null,location_id:preferenceLocation,service_names:preferenceServices,notes:preferenceNotes.trim(),active:true};if(preferenceType==="allowed_time_window"&&(!preferenceDays.length||preferenceStart>=preferenceEnd))return;if(preferenceType==="allowed_service_scope"&&(!preferenceLocation||!preferenceServices.length))return;const ok=await onSavePreference(payload);if(ok){setPreferenceNotes("");setPreferenceServices([]);}};
 const togglePreferenceDay=(day:number)=>setPreferenceDays(v=>v.includes(day)?v.filter(x=>x!==day):[...v,day]);
 const selectablePreferenceServices=[...new Set([...templates.filter(t=>t.location_id===preferenceLocation).map(t=>t.service_name),...schedules.filter(s=>s.location_id===preferenceLocation).map(s=>s.service_name)])].sort();
 const visiblePreferences=preferences.filter(r=>isAdmin||r.servant_id===myServant?.id);
 return <><div className="toolbar"><div><h2>{isAdmin?"Servant availability":"My availability"}</h2><p className="subtle">{isAdmin?"Manage availability records for the serving team.":"Mark the dates when you can or cannot serve."}</p></div></div>
  {deadline&&<div className="message-banner"><span>Availability submission deadline: <b>{fmtDate(deadline)}</b>{new Date(`${deadline}T23:59:59`).getTime()>=Date.now()?` · ${Math.ceil((new Date(`${deadline}T23:59:59`).getTime()-Date.now())/86400000)} day(s) remaining`:" · Deadline passed"}</span></div>}
  {isAdmin&&<section className="availability-form-panel"><h3>Set availability deadline</h3><form className="availability-form" onSubmit={onSaveDeadline}><label>Submission deadline<input type="date" name="deadline" defaultValue={deadline}/></label><button className="btn secondary">Save deadline</button></form></section>}
  {(isAdmin||myServant)&&<section className="availability-form-panel"><h3>{isAdmin?"Record servant availability":"Update my availability"}</h3><div className="availability-mode-switch"><button type="button" className={entryMode==="single"?"active":""} onClick={()=>{setEntryMode("single");setPreviewRows(null);}}>Single entry</button><button type="button" className={entryMode==="person"?"active":""} onClick={()=>{setEntryMode("person");setPreviewRows(null);setPreviewConflicts([]);}}>{isAdmin?"Bulk per person":"Multiple dates"}</button>{isAdmin&&<button type="button" className={entryMode==="day"?"active":""} onClick={()=>{setEntryMode("day");setPreviewRows(null);setPreviewConflicts([]);}}>Bulk per day</button>}</div>
   {entryMode==="single"?<><form className="availability-form" onSubmit={onSave}>{isAdmin?<label>Servant<select name="servant_id" required defaultValue=""><option value="" disabled>Select servant</option>{selectable.map(p=><option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>:<><input type="hidden" name="servant_id" value={myServant!.id}/><div className="availability-self-name"><span>Servant</span><b>{myServant!.full_name}</b></div></>}<label>Date<input name="service_date" type="date" required defaultValue={today()}/></label><label>Status<select name="status" defaultValue="available"><option value="available">Available</option><option value="unavailable">Unavailable</option><option value="prefer_not">Prefer not to serve</option></select></label><label className="availability-notes">Notes (optional)<input name="notes" placeholder="e.g. only available in the morning"/></label><button className="btn primary">Save availability</button></form><p className="subtle availability-note">One status per person per date. Saving again updates the existing entry.</p></>:
   <div className="bulk-availability-form"><div className="bulk-form-grid">{entryMode==="person"?(isAdmin?<label>Servant<select value={bulkPerson} onChange={e=>setBulkPerson(e.target.value)}><option value="">Select servant</option>{selectable.map(p=><option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>:<div className="availability-self-name"><span>Servant</span><b>{myServant?.full_name??"Your linked servant profile"}</b></div>):<div className="bulk-servant-picker"><b>Select servants</b><div className="bulk-servant-list">{selectable.map(p=><label key={p.id}><input type="checkbox" checked={bulkPeople.includes(p.id)} onChange={()=>togglePerson(p.id)}/>{p.full_name}</label>)}</div><small>{bulkPeople.length} servant(s) selected</small></div>}<label>From date<input type="date" value={bulkFrom} onChange={e=>setBulkFrom(e.target.value)}/></label><label>To date<input type="date" value={bulkTo} onChange={e=>setBulkTo(e.target.value)}/></label><label>Status<select value={bulkStatus} onChange={e=>setBulkStatus(e.target.value)}><option value="available">Available</option><option value="unavailable">Unavailable</option><option value="prefer_not">Prefer not to serve</option></select></label><label>Apply to<select value={bulkPattern} onChange={e=>setBulkPattern(e.target.value)}><option value="daily">Every day</option><option value="weekdays">Weekdays (Mon–Fri)</option><option value="weekends">Weekends (Sat–Sun)</option><option value="selected">Selected weekdays</option></select></label>{bulkPattern==="selected"&&<div className="bulk-weekdays"><b>Select weekdays</b>{[ [1,"Mon"],[2,"Tue"],[3,"Wed"],[4,"Thu"],[5,"Fri"],[6,"Sat"],[0,"Sun"] ].map(([d,label])=><label key={d}><input type="checkbox" checked={bulkWeekdays.includes(Number(d))} onChange={()=>setBulkWeekdays(v=>v.includes(Number(d))?v.filter(x=>x!==Number(d)):[...v,Number(d)])}/>{label}</label>)}</div>}<label className="wide">Notes (optional)<input value={bulkNotes} onChange={e=>setBulkNotes(e.target.value)} placeholder="Optional note"/></label></div><button type="button" className="btn primary" onClick={buildBulkPreview}>Preview affected dates</button>
   {previewRows!==null&&<div className="bulk-preview-card"><div className="bulk-preview-head"><b>Preview before saving</b><span>{previewRows.length} record(s)</span></div>{previewRows.length===0?<p className="subtle">No dates or servants selected.</p>:<>{previewConflicts.length>0&&<div className="bulk-conflict-warning"><b>{previewConflicts.length} conflicting record(s)</b><span>These person/date combinations already have a different status. Resolve them before saving.</span>{previewConflicts.slice(0,12).map((r,i)=><small key={i}>{name(r.servant_id)} · {fmtDate(r.service_date)} · currently {availability.find(a=>a.servant_id===r.servant_id&&a.service_date===r.service_date)?.status}</small>)}</div>}<div className="bulk-preview-list">{previewRows.map((r,i)=><div key={i}><b>{name(r.servant_id)}</b><span>{fmtDate(r.service_date)} · {r.status.replace("_"," ")}</span></div>)}</div><button type="button" className="btn primary" disabled={previewConflicts.length>0} onClick={savePreview}>Confirm and save {previewRows.length} records</button></>}</div>}</div>}
  </section>}
  {(isAdmin||myServant)&&<section className="availability-form-panel recurring-rule-panel"><h3>Recurring availability restrictions</h3><p className="subtle">Create a repeating pattern for dates when a servant cannot serve. Admins can manage any servant; servants can manage their own rules.</p><form className="recurring-rule-form" onSubmit={makeRule}>{isAdmin&&<label>Servant<select value={rulePerson} onChange={e=>setRulePerson(e.target.value)} required><option value="">Select servant</option>{selectable.map(p=><option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>}<label>Pattern<select value={rulePattern} onChange={e=>setRulePattern(e.target.value)}><option value="weekday">Every weekday (Mon–Fri)</option><option value="saturday">Every Saturday</option><option value="sunday">Every Sunday</option><option value="second_week">Second week of each month (8th–14th)</option><option value="nth_weekday">Specific weekday occurrence each month</option><option value="month_edges">Beginning and end of month (first/last 3 days)</option></select></label>{rulePattern==="nth_weekday"&&<div className="rule-inline"><label>Occurrence<select value={ruleOrdinal} onChange={e=>setRuleOrdinal(e.target.value)}>{[[1,"First"],[2,"Second"],[3,"Third"],[4,"Fourth"],[5,"Last"]].map(([v,l])=><option value={v}>{l}</option>)}</select></label><label>Weekday<select value={ruleWeekday} onChange={e=>setRuleWeekday(e.target.value)}>{[[1,"Monday"],[2,"Tuesday"],[3,"Wednesday"],[4,"Thursday"],[5,"Friday"],[6,"Saturday"],[0,"Sunday"]].map(([v,l])=><option value={v}>{l}</option>)}</select></label></div>}<label>Status<select value={ruleStatus} onChange={e=>setRuleStatus(e.target.value)}><option value="unavailable">Unavailable</option><option value="prefer_not">Prefer not to serve</option></select></label><div className="rule-inline"><label>Effective from<input type="date" value={ruleFrom} onChange={e=>setRuleFrom(e.target.value)}/></label><label>Until (optional)<input type="date" value={ruleUntil} onChange={e=>setRuleUntil(e.target.value)}/></label></div><label>Notes (optional)<input value={ruleNotes} onChange={e=>setRuleNotes(e.target.value)} placeholder="e.g. family commitment"/></label><button className="btn primary">Save recurring restriction</button></form><div className="saved-rules-list">{ownRules.map(r=><div className="saved-rule-row" key={r.id}><div><b>{name(r.servant_id)}</b><small>{r.pattern.replaceAll("_"," ")} · {r.status} · from {fmtDate(r.effective_from)}{r.effective_until?` until ${fmtDate(r.effective_until)}`:" · no end date"}</small></div><button className="icon-btn" onClick={()=>onDeleteRule(r.id)} title="Delete recurring rule"><Trash2 size={15}/></button></div>)}</div></section>}
  {(isAdmin||myServant)&&<section className="availability-form-panel serving-preferences-panel"><h3>Serving preferences & eligibility</h3><p className="subtle">Set hard eligibility limits for when, where, or which services a servant can be assigned to. These rules are checked when an administrator saves an assignment.</p><form className="serving-preference-form" onSubmit={savePreference}>{isAdmin?<label>Servant<select value={preferencePerson} onChange={e=>setPreferencePerson(e.target.value)} required><option value="">Select servant</option>{selectable.map(p=><option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>:<div className="availability-self-name"><span>Servant</span><b>{myServant?.full_name}</b></div>}<label>Restriction type<select value={preferenceType} onChange={e=>setPreferenceType(e.target.value)}><option value="allowed_time_window">Can serve only during these time windows</option><option value="allowed_service_scope">Can serve only at these services / church</option></select></label>{preferenceType==="allowed_time_window"?<><div className="preference-weekday-picker"><b>Allowed days</b><div>{[[1,"Mon"],[2,"Tue"],[3,"Wed"],[4,"Thu"],[5,"Fri"],[6,"Sat"],[0,"Sun"]].map(([day,label])=><label key={day}><input type="checkbox" checked={preferenceDays.includes(Number(day))} onChange={()=>togglePreferenceDay(Number(day))}/>{label}</label>)}</div></div><div className="rule-inline"><label>Allowed from<input type="time" value={preferenceStart} onChange={e=>setPreferenceStart(e.target.value)}/></label><label>Allowed until<input type="time" value={preferenceEnd} onChange={e=>setPreferenceEnd(e.target.value)}/></label></div><small className="subtle">The entire service must fit inside the allowed window. Example: Sunday 07:00–11:00.</small></>:<><label>Church location<select value={preferenceLocation} onChange={e=>{setPreferenceLocation(e.target.value);setPreferenceServices([]);}} required><option value="">Select church</option>{locations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label><div className="preference-service-picker"><b>Allowed services</b>{selectablePreferenceServices.length?selectablePreferenceServices.map(name=><label key={name}><input type="checkbox" checked={preferenceServices.includes(name)} onChange={()=>setPreferenceServices(v=>v.includes(name)?v.filter(x=>x!==name):[...v,name])}/>{name}</label>):<small className="subtle">Choose a church to see its service templates and scheduled service names.</small>}</div><small className="subtle">Example: GMS Alam Sutera · Service 3, Service 4 and Service 5.</small></>}<label>Notes (optional)<input value={preferenceNotes} onChange={e=>setPreferenceNotes(e.target.value)} placeholder="e.g. Only available for morning services"/></label><button className="btn primary">Save serving preference</button></form><div className="saved-rules-list">{visiblePreferences.map(rule=><div className="saved-rule-row" key={rule.id}><div><b>{name(rule.servant_id)}</b><small>{rule.rule_type==="allowed_time_window"?`Only ${rule.days_of_week?.length?rule.days_of_week.map((d:number)=>["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d]).join(", "):"any day"} · ${String(rule.start_time).slice(0,5)}–${String(rule.end_time).slice(0,5)}`:`Only ${rule.service_names?.join(", ")||"selected services"} · ${locations.find(l=>l.id===rule.location_id)?.name??"Selected church"}`}{rule.notes?` · ${rule.notes}`:""}</small></div><button className="icon-btn" title="Remove serving preference" onClick={()=>onDeletePreference(rule.id)}><Trash2 size={15}/></button></div>)}</div></section>}
  {!isAdmin&&!myServant&&<div className="message-banner"><span>Your login is not linked to a servant directory profile yet. Please ask a GMS administrator to link your account before submitting availability.</span></div>}
  <section className="filter-panel availability-filter"><label><span>Filter by date</span><input type="date" value={dateFilter} onChange={e=>setDateFilter(e.target.value)}/></label><button className="clear-btn" onClick={()=>setDateFilter("")}>Clear date</button></section>
  <div className="list-heading"><h2>{isAdmin?"Availability records":"My availability records"}</h2><span>{rows.length} records</span></div>
  {rows.length===0?<div className="empty-state"><ClipboardCheck size={28}/><b>No availability records</b><p>Add a record above to help coordinators plan assignments.</p></div>:<div className="people-list">{rows.map(a=><div className="availability-row" key={a.id}><div className="availability-date">{fmtDate(a.service_date)}</div><div className="availability-person"><b>{name(a.servant_id)}</b><small>{a.notes||"No notes"}</small></div><span className={`availability-status ${a.status}`}>{a.status==="prefer_not"?"Prefer not to serve":a.status}</span>{(isAdmin||a.servant_id===myServant?.id)&&<button className="icon-btn" title="Delete record" onClick={()=>onDelete(a.id)}><Trash2 size={16}/></button>}</div>)}</div>}
 </>;
}

function PushNotificationSettings({enabled,busy,onEnable,onDisable}:{enabled:boolean;busy:boolean;onEnable:()=>void;onDisable:()=>void}){
 const configured=!!(import.meta.env.VITE_VAPID_PUBLIC_KEY as string|undefined)?.trim();
 return <section className="push-settings-card"><div className="push-settings-icon"><Bell size={19}/></div><div className="push-settings-copy"><b>Device notifications</b><p>In-app Inbox is your primary notification history. Enable push alerts to receive important updates when GMS is not open.</p>{!configured&&<small>Push delivery setup is still pending. The in-app Inbox continues to work.</small>}</div><button className="btn secondary tiny" disabled={busy||(!configured&&!enabled)} onClick={enabled?onDisable:onEnable}>{busy?"Please wait…":enabled?"Disable on this device":"Enable push"}</button></section>;
}

function ServantInbox({requests,schedules,reads,onRead,notifications,onNotificationRead,pushEnabled,pushBusy,onEnablePush,onDisablePush}:{requests:any[];schedules:ScheduleView[];reads:any[];onRead:(id:string)=>void;notifications:any[];onNotificationRead:(id:string)=>void;pushEnabled:boolean;pushBusy:boolean;onEnablePush:()=>void;onDisablePush:()=>void}){
 const decisions=requests.filter(r=>["approved","declined","rejected"].includes(String(r.status??"").toLowerCase())).sort((a,b)=>String(b.reviewed_at??b.created_at).localeCompare(String(a.reviewed_at??a.created_at)));
 const pending=requests.filter(r=>String(r.status??"").toLowerCase()==="pending");
 const unread=notifications.filter(n=>!n.is_read).length;
 return <section className="servant-inbox"><div className="inbox-intro"><div><h2>Inbox</h2><p className="subtle">Assignment confirmations and replacement updates.</p></div><span className="inbox-unread-count">{unread} unread</span></div>
 <PushNotificationSettings enabled={pushEnabled} busy={pushBusy} onEnable={onEnablePush} onDisable={onDisablePush}/>
 <div className="list-heading"><h3>Notification history</h3><span>{notifications.length} recent</span></div>
 {notifications.map(n => (
    <article className={`inbox-item ${n.is_read ? "read" : "unread"}`} key={n.id} onClick={() => onNotificationRead(n.id)}>
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
      <article className={`inbox-item ${reads.some(x => x.request_id === r.id) ? "read" : "unread"}`} key={r.id} onClick={() => onRead(r.id)}>
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

function RequestsPanel({requests,schedules,servants,onReview,onResolve,notifications,onNotificationRead,pushEnabled,pushBusy,onEnablePush,onDisablePush}:{requests:any[];schedules:ScheduleView[];servants:Servant[];onReview:(request:any,approve:boolean)=>void;onResolve:(request:any,replacementServantId:string)=>void;notifications:any[];onNotificationRead:(id:string)=>void;pushEnabled:boolean;pushBusy:boolean;onEnablePush:()=>void;onDisablePush:()=>void}){
 const pending=requests.filter(r=>r.status==="pending");
 const [replacementChoice,setReplacementChoice]=useState<Record<string,string>>({});
 return <section className="requests-panel"><PushNotificationSettings enabled={pushEnabled} busy={pushBusy} onEnable={onEnablePush} onDisable={onDisablePush}/><div className="list-heading"><h2>Notification history</h2><span>{notifications.length} in the last 30 days</span></div>{notifications.map(n=><article className={`inbox-item ${n.is_read?"read":"unread"}`} key={n.id} onClick={()=>onNotificationRead(n.id)}><div className="inbox-item-body"><b>{n.title}</b><p>{n.body}</p><small>{new Date(n.created_at).toLocaleString()}</small></div><span className="inbox-status approved">{n.is_read?"Read":"New"}</span></article>)}<div className="list-heading requests-section-heading"><h2>Servant requests</h2><span>{pending.length} pending</span></div>{requests.length===0?<p className="subtle">No replacement or swap requests yet.</p>:<div className="people-list">{requests.map(r=>{const service=schedules.find(s=>s.id===r.schedule_id);const person=servants.find(p=>p.id===r.requester_servant_id);const candidates=servants.filter(p=>p.active&&p.id!==r.requester_servant_id);return <div className="request-row" key={r.id}><div className="request-main"><b>{person?.full_name??"Servant"} · {r.request_type}</b><small>{service?`${fmtDate(service.service_date)} · ${service.location_name} · ${service.service_name}`:"Schedule unavailable"}</small><small>{r.details||"No details provided"}</small><span className={`status-chip ${r.status}`}>{r.status}</span></div>{r.status==="pending"&&<div className="request-actions">{r.request_type==="replacement"&&<><select value={replacementChoice[r.id]??""} onChange={e=>setReplacementChoice(v=>({...v,[r.id]:e.target.value}))}><option value="">Choose replacement servant</option>{candidates.map(p=><option key={p.id} value={p.id}>{p.full_name}</option>)}</select><button className="btn tiny primary" disabled={!replacementChoice[r.id]} onClick={()=>onResolve(r,replacementChoice[r.id])}>Assign replacement</button></>}<button className="btn tiny secondary" onClick={()=>onReview(r,false)}>Decline request</button></div>}</div>;})}</div>}</section>;
}

function AuditPanel({logs,onDownload}:{logs:any[];onDownload:()=>void}){
 const [page,setPage]=useState(1);const pageSize=10;const pageCount=Math.max(1,Math.ceil(logs.length/pageSize));const visible=logs.slice((page-1)*pageSize,page*pageSize);
 useEffect(()=>{setPage(1);},[logs.length]);
 return <><div className="toolbar audit-toolbar"><div><h2>System audit trail</h2><p className="subtle">Showing up to 50 events from the last 14 days. Records older than 14 days can be downloaded; all audit data is automatically deleted after 30 days.</p></div><button className="btn secondary" onClick={onDownload}><Download size={16}/> Download older records (15+ days)</button></div>{logs.length===0?<div className="empty-state"><ClipboardCheck size={28}/><b>No audit activity in the last 14 days</b><p>Older records, if available, can be downloaded using the button above.</p></div>:<><div className="people-list">{visible.map(log=><div className="audit-row" key={log.id}><div><b>{log.action} · {log.table_name}</b><small>Record: {log.record_id}</small><small>{new Date(log.created_at).toLocaleString()}</small></div><span>{log.actor_id?`User ${String(log.actor_id).slice(0,8)}`:"System"}</span></div>)}</div><div className="audit-pagination"><span>Page {page} of {pageCount} · {logs.length} events from the last 14 days</span><div><button className="btn secondary tiny" disabled={page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}>Previous</button><button className="btn secondary tiny" disabled={page>=pageCount} onClick={()=>setPage(p=>Math.min(pageCount,p+1))}>Next</button></div></div></>}</>;
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
  <div className="stats-table-wrap stats-desktop-table"><table className="stats-table"><thead><tr><th>Servant</th><th>Total</th><th>FOH</th><th>Monitor</th><th>Assistant</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td><b>{r.name}</b></td><td>{r.total}</td><td>{r.FOH}</td><td>{r.Monitor}</td><td>{r.Assistant}</td></tr>)}</tbody></table></div><div className="stats-servant-cards">{rows.map(r=><article className="stats-servant-card" key={r.id}><b className="stats-servant-name">{r.name}</b><div className="stats-servant-metrics"><div><small>Total</small><strong>{r.total}</strong></div><div><small>FOH</small><strong>{r.FOH}</strong></div><div><small>Monitor</small><strong>{r.Monitor}</strong></div><div><small>Assistant</small><strong>{r.Assistant}</strong></div></div></article>)}</div>
 </>;
}

function MemberProfilePanel({profile,isAdmin,directory,onSave}:{profile:any;isAdmin:boolean;directory:any[];onSave:(payload:any)=>Promise<void>}){
 const [saving,setSaving]=useState(false);
 const current=profile??{full_name:"",email:"",gender:"Prefer not to say",date_of_birth:"",nij:"",phone_number:"",domicile_area:"Alam Sutera",domicile_other:"",cg_category:"AOG Youth",cg_status:"Member",cg_number:"",cg_days:[],cg_time:"",team_leader_name:"",coach_name:"",cg_leader_name:"",leader_phone_numbers:[],last_verified_at:new Date().toISOString()};
 const days=["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
 return <><section className="availability-form-panel"><div className="toolbar"><div><h2>{profile?"My information":"Complete your member profile"}</h2><p className="subtle">{profile?"You can update these details at any time. Please verify them every three months.":"Complete your member information to finish setting up your account."}</p></div></div>
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
