import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { CalendarDays, Church, Users, Search, Plus, LogOut, Pencil, Trash2, Download, RefreshCw, ShieldCheck, X, Menu, ChevronDown, BarChart3, ClipboardCheck, AlertTriangle, Inbox as InboxIcon, UserRound, MoreHorizontal, Info, Bell, Smartphone, Clock3, MapPin, WifiOff, Moon, Sun, EyeOff, Send, CheckCircle2 } from "lucide-react";
import { supabase, isSupabaseConfigured } from "./supabase";
import type { Assignment, Location, Profile, Role, Schedule, ScheduleView, Servant } from "./types";
import { today, fmtDate, shortTime, dayNameForTemplate, errorText } from "./shared/formatters";
import GmsLoader from "./shared/components/GmsLoader";
import ActionDialog, { type ActionDialogState } from "./shared/components/ActionDialog";
import Sidebar from "./app/components/Sidebar";
import MobileNavigation from "./app/components/MobileNavigation";
import AppHeader from "./app/components/AppHeader";
import AppLayout from "./app/components/AppLayout";
import AuthScreen, { type AuthMode } from "./features/auth/components/AuthScreen";
import PasswordRecoveryScreen from "./features/auth/components/PasswordRecoveryScreen";
import SupabaseSetupScreen from "./features/auth/components/SupabaseSetupScreen";
import MemberProfilePanel from "./features/auth/components/MemberProfilePanel";
import { registerAccount, signInWithUsername, sendPasswordResetLink, updateAccountPassword } from "./features/auth/services/authentication";
import { startAuthSessionLifecycle } from "./features/auth/services/sessionLifecycle";
import { loadMemberAccountProfile, saveMemberProfile } from "./features/auth/services/memberProfile";
import { mapSchedules } from "./features/schedule/services/mapSchedules";
import { DAILY_CATEGORY_TINTS, dailyChurchColor, dailyServiceCategory, dailyTeamTint } from "./features/schedule/services/dailyDisplay";
import { validateScheduleAssignment } from "./features/schedule/services/assignmentValidation";
import { buildWeekendScheduleRows } from "./features/schedule/services/weekendGeneration";
import { deleteScheduleById, saveScheduleWithAssignments, upsertGeneratedSchedules } from "./features/schedule/services/schedulePersistence";
import { buildVirtualAvailability, validateRecurringAvailabilityRule } from "./features/availability/services/recurringAvailability";
import { deleteAvailabilityRecordById, deleteAvailabilityRuleById, deleteServingPreferenceById, insertAvailabilityRule, insertServingPreference, upsertAvailabilityDeadline, upsertAvailabilityRecord, upsertAvailabilityRecords } from "./features/availability/services/availabilityPersistence";
import { createServantRecord, linkServantAccountRecord, loadServantRecords, setServantActive } from "./features/servants/services/servantManagement";
import { buildServantAccountCandidates, loadServantDirectoryData } from "./features/servants/services/servantDirectory";
import { loadServingRequestData } from "./features/requests/services/requestData";
import { loadServingNotificationData } from "./features/notifications/services/notificationData";
import { markServingNotificationRead, saveServingNotificationPreferences } from "./features/notifications/services/notificationPersistence";
import { cleanupServingPushSubscriptionForSignOut, disableServingPushSubscription, enableServingPushSubscription, isServingPushSubscriptionEnabled, type PushLifecycleRuntime } from "./features/notifications/services/pushSubscription";
import { createServingRequest, executeServingRequestSwap, markServingRequestRead, resolveServingRequestReplacement, updateServingRequestReview } from "./features/requests/services/requestPersistence";
import ServantInformationPanel from "./features/servants/components/ServantInformationPanel";
import ServantInbox from "./features/requests/components/ServantInbox";
import RequestsPanel from "./features/requests/components/RequestsPanel";

const ROLES: Role[] = ["FOH", "Monitor", "Assistant"];


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
  const [notificationPrefs,setNotificationPrefs] = useState<any>({new_assignments:true,schedule_changes:true,confirmation_reminders:true,availability_deadlines:true,request_updates:true});
  const [swapDraft,setSwapDraft] = useState<ScheduleView|null>(null);
  const [auditLogs,setAuditLogs] = useState<any[]>([]);
  const [availabilityDeadline,setAvailabilityDeadline] = useState("");
  const [calendarView,setCalendarView] = useState<"week"|"month">("week");
  const [adminScheduleView,setAdminScheduleView] = useState<"overview"|"assignments"|"calendar">("overview");
  const [theme,setTheme] = useState<"light"|"dark">(()=>{
    try { return window.localStorage.getItem("gms-sound-theme")==="dark"?"dark":"light"; }
    catch { return "light"; }
  });
  const [personFilter,setPersonFilter] = useState("");
  const [locationFilter,setLocationFilter] = useState("");
  const [serviceFilter,setServiceFilter] = useState("");
  const [fromDate,setFromDate] = useState("");
  const [toDate,setToDate] = useState("");
  const [modal,setModal] = useState<"schedule"|"person"|null>(null);
  const [editing,setEditing] = useState<ScheduleView|null>(null);
  const [authMode,setAuthMode] = useState<AuthMode>("login");
  const [email,setEmail] = useState("");
  const [username,setUsername] = useState("");
  const [memberProfile,setMemberProfile] = useState<any>(null);
  const [memberDirectory,setMemberDirectory] = useState<any[]>([]);
  const [accountProfiles,setAccountProfiles] = useState<any[]>([]);
  const [password,setPassword] = useState("");
  const [recoveryMode,setRecoveryMode] = useState(false);
  const [fullName,setFullName] = useState("");
  const [signupCgStatus,setSignupCgStatus] = useState("");
  const [mobileNav,setMobileNav] = useState(false);
  const [actionDialog,setActionDialog] = useState<ActionDialogState|null>(null);
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
    const lifecycle = startAuthSessionLifecycle(supabase, {
      setSession,
      setRecoveryMode,
      setAuthLoading,
      setMessage,
      errorText
    });
    return () => lifecycle.stop();
  }, []);

  useEffect(() => {
    setTab("schedule");setMobileNav(false);
    if (!session || !supabase) { setProfile(null); return; }
    void loadProfile();
  },[session?.user?.id]);

  useEffect(()=>{
    document.documentElement.dataset.theme=theme;
    const themeColor=document.querySelector('meta[name="theme-color"]');
    themeColor?.setAttribute("content",theme==="dark"?"#101727":"#171d35");
    try { window.localStorage.setItem("gms-sound-theme",theme); } catch {}
  },[theme]);

  const toggleTheme=()=>setTheme(current=>current==="dark"?"light":"dark");

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
      if(!session?.user?.id){if(!cancelled)setPushEnabled(false);return;}
      const enabled=await isServingPushSubscriptionEnabled(supabase!,session.user.id,getPushLifecycleRuntime());
      if(!cancelled)setPushEnabled(enabled);
    }
    void checkPush();return()=>{cancelled=true;};
  },[session?.user?.id]);

  async function loadProfile() {
    if (!supabase || !session) return;
    const {data,error} = await loadMemberAccountProfile(supabase,session.user.id);
    if (error) setMessage(error.message);
    else setProfile(data as Profile|null);
  }

  async function loadData() {
    if (!supabase) return;
    setLoading(true); setMessage("");
    try {
      const notificationCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const auditCutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
      const [locRes,servRes,tempRes,schedRes,assignRes,availRes,ruleRes,preferenceRes,requestDataRes,notificationDataRes,settingRes,auditRes,servantDirectoryRes] = await Promise.all([
        supabase.from("locations").select("*").order("name"),
        loadServantRecords(supabase),
        supabase.from("service_templates").select("*").eq("active",true),
        supabase.from("schedules").select("*").order("service_date").order("start_time"),
        supabase.from("assignments").select("*"),
        supabase.from("servant_availability").select("*").order("service_date",{ascending:true}),
        supabase.from("servant_availability_rules").select("*").order("created_at",{ascending:false}),
        supabase.from("servant_serving_preferences").select("*").eq("active",true).order("created_at",{ascending:false}),
        loadServingRequestData(supabase),
        loadServingNotificationData(supabase, notificationCutoff, session?.user?.id??""),
        supabase.from("system_settings").select("*").eq("key","availability_deadline").maybeSingle(),
        supabase.from("audit_logs").select("*").gte("created_at",auditCutoff).order("created_at",{ascending:false}).limit(50),
        loadServantDirectoryData(supabase),
      ]);
      // Core schedule/servant data is required. Ancillary tables must not blank the whole dashboard
      // when their RLS policy or migration is not yet configured.
      for (const r of [locRes,servRes,schedRes,assignRes]) if (r.error) throw r.error;
      const optionalErrors = [tempRes,availRes,ruleRes,preferenceRes,requestDataRes.requests,requestDataRes.reads,notificationDataRes.notifications,notificationDataRes.preferences,settingRes,auditRes,servantDirectoryRes.memberProfiles,servantDirectoryRes.accountProfiles]
        .filter((r:any) => r.error)
        .map((r:any) => r.error.message);
      if (optionalErrors.length) console.warn("Some optional GMS dashboard data could not be loaded:", optionalErrors);
      const locs=(locRes.data??[]) as Location[], people=(servRes.data??[]) as Servant[];
      const assignments=(assignRes.data??[]) as Assignment[];
      const mapped=mapSchedules((schedRes.data??[]) as Schedule[],assignments,locs,people);
      const safeMemberRows = servantDirectoryRes.memberProfiles.error ? [] : (servantDirectoryRes.memberProfiles.data ?? []);
      setLocations(locs);setServants(people);setTemplates(tempRes.error?[]:(tempRes.data??[]));setSchedules(mapped);
      const loadedRules=ruleRes.error?[]:(ruleRes.data??[]);setAvailabilityRules(loadedRules);setServingPreferences(preferenceRes.error?[]:(preferenceRes.data??[]));
      const explicitAvailability=availRes.error?[]:(availRes.data??[]);
      const ruleEndLimit=new Date();ruleEndLimit.setFullYear(ruleEndLimit.getFullYear()+2);
      const virtualAvailability=buildVirtualAvailability(loadedRules,ruleEndLimit);
      setAvailability([...explicitAvailability,...virtualAvailability]);setRequests(requestDataRes.requests.error?[]:(requestDataRes.requests.data??[]));setRequestReads(requestDataRes.reads.error?[]:(requestDataRes.reads.data??[]));setNotifications(notificationDataRes.notifications.error?[]:(notificationDataRes.notifications.data??[]));
      setAvailabilityDeadline(settingRes.error?"":(settingRes.data?.value??""));setAuditLogs(auditRes.error?[]:(auditRes.data??[]));
      setMemberDirectory(safeMemberRows);setMemberProfile(safeMemberRows.find((x:any)=>x.user_id===session.user.id)??null);
      setAccountProfiles(servantDirectoryRes.accountProfiles.error?[]:(servantDirectoryRes.accountProfiles.data??[]));
      setNotificationPrefs(notificationDataRes.preferences.error||!notificationDataRes.preferences.data?{new_assignments:true,schedule_changes:true,confirmation_reminders:true,availability_deadlines:true,request_updates:true}:notificationDataRes.preferences.data);
    } catch(e) { setMessage(errorText(e)); }
    finally { setLoading(false); }
  }

  useEffect(()=>{if(profile) void loadData();},[profile]);

  async function installGmsApp(){
    if(installPrompt){try{await installPrompt.prompt();await installPrompt.userChoice;}catch(e){console.warn("PWA install prompt was not completed",e);}finally{setInstallPrompt(null);}return;}
    const ua=navigator.userAgent.toLowerCase();
    const ios=/iphone|ipad|ipod/.test(ua)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
    const message=ios?"On your iPhone, open this page in Safari, tap Share, choose Add to Home Screen, turn on Open as Web App, then tap Add. If Add to Home Screen is missing, scroll to Edit Actions and enable it. Open GMS from the new Home Screen icon before enabling notifications.":"To install Sound Scheduling: open your browser menu and choose Install app or Add to Home Screen. If the install option is not shown, refresh the page once and try again.";
    await askAction("Install app",message,"Got it",false);
  }

  function getPushLifecycleRuntime():PushLifecycleRuntime {
    const isIOS=/iphone|ipad|ipod/.test(navigator.userAgent.toLowerCase())||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
    const isStandalone=window.matchMedia?.("(display-mode: standalone)").matches||(navigator as any).standalone===true;
    return {
      serviceWorkerSupported:"serviceWorker" in navigator,
      pushManagerSupported:"PushManager" in window,
      notificationSupported:"Notification" in window,
      isIOS,
      isStandalone,
      userAgent:navigator.userAgent,
      notificationPermission:()=>Notification.permission,
      requestNotificationPermission:()=>Notification.requestPermission(),
      serviceWorkerReady:()=>navigator.serviceWorker.ready as unknown as ReturnType<PushLifecycleRuntime["serviceWorkerReady"]>,
      getServiceWorkerRegistration:(scope)=>navigator.serviceWorker.getRegistration(scope) as unknown as ReturnType<PushLifecycleRuntime["getServiceWorkerRegistration"]>,
      delay:(milliseconds)=>new Promise<void>(resolve=>window.setTimeout(resolve,milliseconds)),
      warn:(message,error)=>console.warn(message,error),
    };
  }

  async function enablePushNotifications(){
    if(!supabase||!session?.user?.id)return;
    let started=false;
    try{
      const vapidKey=(import.meta.env.VITE_VAPID_PUBLIC_KEY as string|undefined)?.trim();
      const result=await enableServingPushSubscription(supabase,session.user.id,vapidKey,getPushLifecycleRuntime(),()=>{
        started=true;setPushBusy(true);setMessage("");
      });
      if(result==="missing-vapid-key")setMessage("Push delivery is not configured yet. Set VITE_VAPID_PUBLIC_KEY in Vercel and your local environment, then redeploy.");
      else if(result==="unsupported-browser")setMessage("This browser does not support web push notifications. You can still use the in-app Inbox.");
      else if(result==="ios-install-required")setMessage("On iPhone or iPad, install GMS first: open this page in Safari → Share → Add to Home Screen, turn on Open as Web App, then tap Add. Open GMS from the new Home Screen icon and enable push notifications there.");
      else if(result==="permission-blocked")setMessage("Notifications are blocked for this device. Open iPhone Settings, find the installed Sound Scheduling web app, and allow notifications. In-app Inbox notifications will continue to work.");
      else if(result==="permission-not-granted")setMessage("Notification permission was not granted. In-app Inbox notifications will continue to work.");
      else {setPushEnabled(true);setMessage("Push notifications enabled on this device. Your in-app Inbox remains the primary notification history.");}
    }catch(e){setMessage(errorText(e));}
    finally{if(started)setPushBusy(false);}
  }

  async function disablePushNotifications(){
    if(!supabase||!session?.user?.id||!("serviceWorker" in navigator))return;
    setPushBusy(true);
    try{await disableServingPushSubscription(supabase,getPushLifecycleRuntime());setPushEnabled(false);setMessage("Push notifications disabled on this device. Your in-app Inbox is unchanged.");}
    catch(e){setMessage(errorText(e));}finally{setPushBusy(false);}
  }

  async function submitAuth(e:FormEvent<HTMLFormElement>) {
    e.preventDefault(); if(!supabase)return; setMessage(""); setAuthLoading(true);
    const formData=new FormData(e.currentTarget);
    try {
      if(authMode==="signup") {
        await registerAccount(supabase,formData);
        setMessage("Registration submitted. Verify your email if confirmation is enabled, then sign in with your username.");
        setAuthMode("login");
      } else {
        await signInWithUsername(supabase,String(formData.get("username")),String(formData.get("password")));
      }
    } catch(e){setMessage(errorText(e));}
    finally{setAuthLoading(false);}
  }

  async function sendPasswordReset(e:FormEvent<HTMLFormElement>) {
    e.preventDefault(); if(!supabase)return; setAuthLoading(true); setMessage("");
    const formData=new FormData(e.currentTarget);
    const recoveryEmail=String(formData.get("recovery_email")||"").trim();
    try {
      await sendPasswordResetLink(supabase,recoveryEmail,`${window.location.origin}/`);
      setMessage("If an account exists for that email, a password reset link has been sent. Please check your inbox.");
    } catch(e){setMessage(errorText(e));}
    finally{setAuthLoading(false);}
  }

  async function updateRecoveredPassword(e:FormEvent<HTMLFormElement>) {
    e.preventDefault(); if(!supabase)return;
    const formData=new FormData(e.currentTarget);
    const next=String(formData.get("new_password")||"");
    setAuthLoading(true); setMessage("");
    try {
      await updateAccountPassword(supabase,next);
      setRecoveryMode(false);
      setMessage("Password updated. You can now continue using your new password.");
    } catch(e){setMessage(errorText(e));}
    finally{setAuthLoading(false);}
  }

  async function signOut(){
    const userId=session?.user?.id;
    setPushEnabled(false);setTab("schedule");setMobileNav(false);

    // Push cleanup is best-effort and must never block authentication sign-out.
    // Do not await navigator.serviceWorker.ready: if /sw.js is missing or fails
    // to install, that promise can remain pending forever and trap the user.
    if(supabase&&userId&&"serviceWorker" in navigator){
      await cleanupServingPushSubscriptionForSignOut(supabase,userId,getPushLifecycleRuntime());
    }

    try{
      if(supabase){
        // Use local sign-out deliberately. The global logout endpoint can return
        // 403 for sessions whose refresh token is stale/revoked; calling it is
        // unnecessary to remove this device's credentials and can make logout fail.
        const {error}=await supabase.auth.signOut({scope:"local"});
        if(error){
          console.warn("Supabase local sign-out returned an error; clearing local auth storage.",error);
          try {
            const projectUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
            const projectRef = projectUrl ? new URL(projectUrl).hostname.split(".")[0] : "";
            if(projectRef) window.localStorage.removeItem(`sb-${projectRef}-auth-token`);
          } catch (storageError) { console.warn("Could not clear the cached GMS session.",storageError); }
        }
      }
    }catch(e){
      console.error("Sign-out failed; clearing this device session locally.",e);
      try{
        const projectUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
        const projectRef = projectUrl ? new URL(projectUrl).hostname.split(".")[0] : "";
        if(projectRef) window.localStorage.removeItem(`sb-${projectRef}-auth-token`);
      }catch{}
    }finally{
      setProfile(null);setSession(null);setMemberProfile(null);setMemberDirectory([]);setNotifications([]);setRequests([]);setRequestReads([]);setAvailability([]);setAvailabilityRules([]);setServingPreferences([]);
    }
  }
  const isAdmin=profile?.role==="admin";
  const servantAccountCandidates=useMemo(
    ()=>buildServantAccountCandidates(memberDirectory,accountProfiles,servants),
    [memberDirectory,accountProfiles,servants]
  );

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
    const payload={service_date:String(fd.get("service_date")),location_id:String(fd.get("location_id")),service_name:String(fd.get("service_name")),start_time:String(fd.get("start_time")),end_time:String(fd.get("end_time"))};
    const selected:Record<Role,string>={FOH:String(fd.get("FOH")||""),Monitor:String(fd.get("Monitor")||""),Assistant:String(fd.get("Assistant")||"")};
    const chosen=Object.entries(selected).filter(([,id])=>id).map(([role,id])=>({role,id}));
    const validation=validateScheduleAssignment({
      selected:chosen,
      serviceDate:payload.service_date,
      locationId:payload.location_id,
      serviceName:payload.service_name,
      startTime:payload.start_time,
      endTime:payload.end_time,
      schedules,
      availability,
      preferences:servingPreferences,
      editingScheduleId:editing?.id
    });
    if(validation.duplicateServantId){setScheduleError("This servant is selected for more than one role in this service. Please choose a different servant.");return;}
    if(validation.blockedServantIds.length){
      const names=validation.blockedServantIds.map(id=>servants.find(p=>p.id===id)?.full_name??"A servant");
      setScheduleError(`Serving eligibility restriction: ${names.join(", ")} cannot serve in this time window, location or service based on their saved preferences. Review Availability → Serving preferences.`);
      return;
    }
    const conflicts=validation.crossChurchConflicts;
    if(conflicts.length){const names=conflicts.map(c=>`${servants.find(p=>p.id===c.servantId)?.full_name??"A servant"} (${c.schedule.location_name} · ${c.schedule.service_name})`);setScheduleError(`Cannot save this schedule. ${names.join(", ")} ${conflicts.length===1?"is":"are"} already assigned at another church location on ${fmtDate(payload.service_date)}. A servant can only serve at one church location per day.`);return;}
    if(validation.overlappingConflicts.length){setScheduleError(`Cannot save this schedule. ${validation.overlappingConflicts.map(c=>servants.find(p=>p.id===c.servantId)?.full_name??"A servant").join(", ")} ${validation.overlappingConflicts.length===1?"has":"have"} an overlapping service at this location.`);return;}
    if(validation.unavailableServantIds.length){setScheduleError(`Cannot assign this schedule. ${validation.unavailableServantIds.map(id=>servants.find(p=>p.id===id)?.full_name??"A servant").join(", ")} marked unavailable on ${fmtDate(payload.service_date)}.`);return;}
    if(validation.preferNotServantIds.length&&!await askAction("Availability preference",`${validation.preferNotServantIds.map(id=>servants.find(p=>p.id===id)?.full_name??"A servant").join(", ")} marked “Prefer not to serve” on this date. Do you want to continue with this manual assignment?`,"Assign anyway",true))return;
    if(validation.highWorkload.length&&!await askAction("High workload warning",`${validation.highWorkload.map(item=>`${servants.find(p=>p.id===item.servantId)?.full_name??"Servant"} (${item.days} days in the previous 30 days)`).join(", ")} already have a high serving frequency. Continue with this manual assignment?`,"Assign anyway",true))return;
    setLoading(true);setMessage("");
    try {
      const {error}=await saveScheduleWithAssignments(supabase,{
        scheduleId:editing?.id??null,
        service:payload,
        assignments:ROLES.filter(role=>selected[role]).map(role=>({role,servant_id:selected[role]}))
      });
      if(error)throw error;
      setScheduleError("");setModal(null);setEditing(null);await loadData();
    }catch(e){setScheduleError(errorText(e));setLoading(false);}
  }

  async function generateWeekend(date:string,weeks=1,templateIds:string[]=[],mode:"add"|"replace"="add") {
    if(!supabase||!isAdmin)return;
    const generation=buildWeekendScheduleRows({startDate:date,weeks,templateIds,templates});
    if(!generation.ok){
      if(generation.reason==="choose_saturday"){setMessage("Choose a Saturday to generate the weekend.");return;}
      if(generation.reason==="select_template"){setMessage("Select at least one service template to generate.");return;}
      if(generation.reason==="no_weekend_services"){setScheduleError("The selected templates do not include Saturday or Sunday services.");return;}
      setScheduleError("Choose a valid Saturday and a positive number of weekends.");
      return;
    }
    setLoading(true);setMessage("");setScheduleError("");
    try {
      const {error}=await upsertGeneratedSchedules(supabase,generation.rows,mode);
      if(error)throw error;
      await loadData();setMessage(`${generation.weekendCount} weekend(s) generated using ${generation.selectedTemplateCount} selected template(s). ${mode==="replace"?"Matching existing slots were updated; assignments were preserved.":"Existing slots were left unchanged."} New slots are drafts; assign servants and publish when ready.`);
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
      const {error}=await upsertAvailabilityRecord(supabase,row);
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
    try { const {error}=await upsertAvailabilityRecords(supabase,rows); if(error)throw error; await loadData();setMessage(`${rows.length} availability record(s) saved.`);return true; }
    catch(e){setMessage(errorText(e));return false;} finally{setLoading(false);}
  }
  async function saveAvailabilityRule(rule:any) {
    if(!supabase)return false;
    const validation=validateRecurringAvailabilityRule(rule,availabilityRules,availability);
    if(!validation.ok){
      if(validation.reason==="overlapping_rule"){
        setMessage("This recurring rule overlaps an existing rule with a different status. Review or remove the existing rule first.");
        return false;
      }
      setMessage(`This rule conflicts with an existing availability entry on ${validation.conflictDate}. Resolve that date before saving the recurring rule.`);
      return false;
    }
    const {error}=await insertAvailabilityRule(supabase,rule,session?.user?.id);
    if(error){setMessage(errorText(error));return false;} await loadData();setMessage("Recurring availability restriction saved.");return true;
  }
  async function deleteAvailabilityRule(id:string){if(!supabase)return;const {error}=await deleteAvailabilityRuleById(supabase,id);if(error)setMessage(errorText(error));else await loadData();}

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
    const {error}=await insertServingPreference(supabase,preference,session?.user?.id);
    if(error){setMessage(errorText(error));return false;}
    await loadData();setMessage("Serving eligibility rule saved and will be checked during manual assignment.");return true;
  }
  async function deleteServingPreference(id:string){
    if(!supabase)return;
    const {error}=await deleteServingPreferenceById(supabase,id);
    if(error)setMessage(errorText(error));else{await loadData();setMessage("Serving eligibility rule removed.");}
  }

  async function deleteAvailability(id:string){
    if(!supabase||!isAdmin)return;
    const {error}=await deleteAvailabilityRecordById(supabase,id);
    if(error)setMessage(errorText(error));else await loadData();
  }

  async function linkServantAccount(servant:Servant,userId:string,verifiedNij:string):Promise<boolean>{
    if(!supabase||!isAdmin)return false;
    const {error}=await linkServantAccountRecord(supabase,{
      servantId:servant.id,
      userId,
      verifiedNij
    });
    if(error){setMessage(errorText(error));return false;}
    await loadData();
    setMessage(`Account successfully linked to ${servant.full_name}. Identity verification was recorded in the audit trail.`);
    return true;
  }

  async function savePerson(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();if(!supabase||!isAdmin)return;
    setScheduleError("");
    const fd=new FormData(e.currentTarget);const name=String(fd.get("full_name")).trim();
    if(!name)return;
    setLoading(true);
    try{
      const {error}=await createServantRecord(supabase,name);if(error)throw error;
      setModal(null);await loadData();
    }catch(e){setScheduleError(errorText(e));setLoading(false);}
  }
  async function togglePerson(p:Servant){
    if(!supabase||!isAdmin)return;
    const {error}=await setServantActive(supabase,p.id,!p.active);
    if(error)setMessage(errorText(error));else await loadData();
  }
  async function deleteSchedule(s:ScheduleView){
    if(!supabase||!isAdmin||!await askAction("Delete service",`Delete ${s.service_name} on ${fmtDate(s.service_date)}? This also removes its assignments.`,"Delete service",true))return;
    const {error}=await deleteScheduleById(supabase,s.id);
    if(error)setMessage(errorText(error));else await loadData();
  }
  async function publishSchedule(s:ScheduleView){
    if(!supabase||!isAdmin)return;
    const nextStatus=s.status==="published"?"draft":"published";
    if(nextStatus==="published"){
      const missing=["FOH","Monitor"].filter(role=>!s.assignments.some(a=>a.role===role&&a.servant_id));
      if(missing.length&&!await askAction("Incomplete service",`${s.service_name} is missing ${missing.join(" and ")}. Publish anyway?`,"Publish anyway",true))return;
    }
    const {error}=await supabase.rpc("admin_publish_schedules_grouped",{p_location_id:null,p_schedule_ids:[s.id],p_status:nextStatus});
    if(error){setMessage(error.message);return;}
    setMessage(nextStatus==="published"?"Schedule published. Affected servants receive one grouped notification.":"Schedule moved back to draft.");
    await loadData();
  }
  async function bulkSetLocationStatus(locationId:string,status:"published"|"draft"){
    if(!supabase||!isAdmin||!locationId)return;
    const allChurches=locationId==="__all_churches__";
    const location=locations.find(l=>l.id===locationId);
    const scopeName=allChurches?"all church locations":location?.name??"this church";
    const action=status==="published"?"publish":"unpublish";
    if(status==="published"){
      const candidates=schedules.filter(s=>(allChurches||s.location_id===locationId)&&s.service_date>=today());
      const missing=candidates.filter(s=>!["FOH","Monitor"].every(role=>s.assignments.some(a=>a.role===role&&a.servant_id)));
      const unavailable=candidates.flatMap(s=>s.assignments.filter(a=>a.servant_id&&availability.some(v=>v.servant_id===a.servant_id&&v.service_date===s.service_date&&v.status==="unavailable")).map(a=>`${a.servant_name} · ${s.location_name} · ${s.service_name} · ${fmtDate(s.service_date)}`));
      const conflicts=candidates.flatMap(s=>s.assignments.filter(a=>a.servant_id&&schedules.some(other=>other.id!==s.id&&other.service_date===s.service_date&&other.location_id!==s.location_id&&other.assignments.some(x=>x.servant_id===a.servant_id))).map(a=>`${a.servant_name} · ${s.location_name} · ${s.service_name} · ${fmtDate(s.service_date)}`));
      if(missing.length||unavailable.length||conflicts.length){
        const report=[missing.length?`${missing.length} service(s) missing FOH or Monitor`:null,unavailable.length?`Unavailable servants: ${unavailable.join("; ")}`:null,conflicts.length?`Cross-church conflicts: ${conflicts.join("; ")}`:null].filter(Boolean).join("\n");
        if(!await askAction("Scheduling validation warning",`There are issues across ${scopeName}:\n${report}\n\nDo you want to publish anyway?`,"Publish anyway",true))return;
      }
    }
    const confirmationDetail=allChurches
      ? `${action==="publish"?"Publish":"Unpublish"} all service schedules across ${locations.length} church locations? Servants will receive one grouped notification per account.`
      : `${action==="publish"?"Publish":"Unpublish"} all schedules for ${scopeName}?`;
    if(!await askAction(`${action==="publish"?"Publish":"Unpublish"} all schedules?`,confirmationDetail,action==="publish"?"Publish all":"Unpublish all",action!=="publish"))return;
    setLoading(true);setScheduleError("");setMessage("");
    try{
      const {error}=await supabase.rpc("admin_publish_schedules_grouped",{p_location_id:allChurches?null:locationId,p_schedule_ids:null,p_status:status});
      if(error)throw error;
      await loadData();
      setMessage(`All schedules across ${scopeName} have been ${status==="published"?"published":"unpublished"}. Each affected servant receives one grouped notification.`);
    }catch(e){setMessage(`Bulk ${action} failed: ${errorText(e)}`);}
    finally{setLoading(false);}
  }
  async function applyBulkAssignments(rows:any[]){
    if(!supabase||!isAdmin)return false;
    setLoading(true);setMessage("");
    try{
      const {data,error}=await supabase.rpc("admin_bulk_assignments_grouped",{p_assignments:rows,p_batch_label:"Bulk schedule assignment"});
      if(error){
        const detail=errorText(error);
        if(/admin_bulk_assignments_grouped|schema cache|function .*not found|PGRST202|42883|23505|duplicate key|unique constraint.*assignments/i.test(detail)){
          throw new Error(`The bulk-assignment database function may be missing or outdated. Run supabase/migrations_20261115_bulk_assignment_commit_fix.sql in Supabase SQL Editor, then retry. Details: ${detail}`);
        }
        throw new Error(detail);
      }
      await loadData();
      const changed=typeof data==="number"?data:Number(data??0);
      setMessage(changed>0?`${changed} assignment change(s) saved. Affected servants receive one consolidated notification.`:"No assignment changes were needed; the saved schedule is already up to date.");
      return true;
    }catch(e){setMessage(`Bulk assignment failed: ${errorText(e)}`);return false;}
    finally{setLoading(false);}
  }
  async function deleteAllLocationSchedules(locationId:string){
    if(!supabase||!isAdmin||!locationId)return;
    const allChurches=locationId==="__all_churches__";
    const targetLocations=allChurches?locations:[locations.find(l=>l.id===locationId)].filter(Boolean) as Location[];
    if(!targetLocations.length){setMessage("No church locations are available to delete.");return;}
    const targetIds=targetLocations.map(l=>l.id);
    const targetNames=targetLocations.map(l=>l.name);
    const targetSchedules=schedules.filter(s=>targetIds.includes(s.location_id));
    const scopeName=allChurches?`ALL ${targetLocations.length} church locations (${targetNames.join(", ")})`:targetNames[0];
    if(!targetSchedules.length){setMessage(`There are no schedules to delete for ${scopeName}.`);return;}
    const confirmation=await askText(
      "Confirm permanent deletion",
      `This will permanently delete ALL ${targetSchedules.length} schedules and their assignments for ${scopeName}. This cannot be undone.`,
      'Type exactly: I do understand',
      "I do understand"
    );
    if(confirmation!=="I do understand"){
      if(confirmation!==null)setMessage("Delete all cancelled: confirmation text did not match.");
      return;
    }
    if(!await askAction(
      "Final deletion confirmation",
      `Permanently delete all ${targetSchedules.length} schedules and assignments for ${scopeName}? This cannot be undone.`,
      "Delete permanently",
      true
    ))return;
    setLoading(true);setScheduleError("");setMessage("");
    try{
      const result=allChurches
        ? await supabase.from("schedules").delete().in("location_id",targetIds)
        : await supabase.from("schedules").delete().eq("location_id",targetIds[0]);
      if(result.error)throw result.error;
      await loadData();
      setMessage(`Deleted ${targetSchedules.length} schedules and their assignments for ${scopeName}.`);
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
    const {error}=await upsertAvailabilityDeadline(supabase,value,session.user.id);
    if(error)setMessage(errorText(error));else {setAvailabilityDeadline(value);setMessage("Availability deadline updated.");}
  }
  async function submitServingRequest(schedule:ScheduleView,kind:"replacement"|"swap"){
    if(kind==="swap"){setSwapDraft(schedule);return;}
    if(!supabase||!myServant)return;
    const own=schedule.assignments.find(a=>a.servant_id===myServant.id);if(!own)return;
    const note=await askText("Request a replacement","Tell the administrator why you need a replacement.","Reason (optional)");
    if(note===null)return;
    const {error}=await createServingRequest(supabase,{schedule_id:schedule.id,assignment_id:own.id,requester_servant_id:myServant.id,request_type:"replacement",details:note.trim(),status:"pending"});
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
    const {error}=await createServingRequest(supabase,{schedule_id:source.id,assignment_id:own.id,requester_servant_id:myServant.id,request_type:"swap",details:details.trim(),status:"pending",target_schedule_id:targetSchedule.id,target_assignment_id:target.id,target_servant_id:target.servant_id});
    if(error)setMessage(error.message);else {setSwapDraft(null);setMessage("Your cross-date swap request has been sent for admin approval.");await loadData();}
  }
  async function markRequestRead(requestId:string){
    if(!supabase||!session)return;
    const {error}=await markServingRequestRead(supabase,{request_id:requestId,user_id:session.user.id,read_at:new Date().toISOString()});
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
      const {error:swapError}=await executeServingRequestSwap(supabase,request.id);
      if(swapError){setMessage(swapError.message);return;}
      setMessage("Swap approved and assignments exchanged.");await loadData();return;
    }
    const {error}=await updateServingRequestReview(supabase,request.id,{status:approve?"approved":"declined",reviewed_by:session.user.id,reviewed_at:new Date().toISOString()});
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
        const {error:requestError}=await createServingRequest(supabase,{schedule_id:schedule.id,assignment_id:assignment.id,requester_servant_id:myServant.id,request_type:"replacement",details:reason.trim()||"Servant declined the assignment and requests a replacement.",status:"pending"});
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
  async function onSaveNotificationPreferences(next:any){
    if(!supabase||!session?.user?.id)return;
    const {payload,error}=await saveServingNotificationPreferences(supabase,session.user.id,next);
    if(error){setMessage(error.message);return;}
    setNotificationPrefs(payload);setMessage("Notification preferences saved. In-app Inbox history remains enabled.");
  }
  async function markNotificationRead(id:string){
    if(!supabase)return;
    const {error}=await markServingNotificationRead(supabase,id);
    if(!error)setNotifications(v=>v.map(n=>n.id===id?{...n,is_read:true}:n));
  }
  async function resolveReplacement(request:any,replacementServantId:string){
    if(!supabase||!isAdmin)return;
    const {error}=await resolveServingRequestReplacement(supabase,request.id,replacementServantId);
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

  if(!isSupabaseConfigured)return <SupabaseSetupScreen/>;
  if(authLoading)return <div className="center-screen"><GmsLoader label={authMode==="reset"?"Preparing secure password recovery…":"Preparing your workspace…"}/></div>;
  if(recoveryMode && session)return <PasswordRecoveryScreen loading={authLoading} message={message} onSubmit={updateRecoveredPassword}/>;
  if(!session)return <AuthScreen mode={authMode} loading={authLoading} message={message} signupCgStatus={signupCgStatus} onModeChange={setAuthMode} onSignupCgStatusChange={setSignupCgStatus} onClearMessage={()=>setMessage("")} onResetSignupCgStatus={()=>setSignupCgStatus("")} onSubmitAuth={submitAuth} onSendPasswordReset={sendPasswordReset}/>;
  if(!profile)return <div className="center-screen"><GmsLoader label="Loading your profile…"/></div>;

  return (
    <AppLayout
      theme={theme}
      sidebar={<Sidebar
      activeTab={tab}
      isAdmin={isAdmin}
      displayName={profile.display_name || session.user.email || "G"}
      unreadServantRequestCount={requests.filter(r =>
        r.requester_servant_id === myServant?.id &&
        ["approved", "declined", "rejected"].includes(String(r.status).toLowerCase()) &&
        !requestReads.some(x => x.request_id === r.id && x.user_id === session?.user?.id)
      ).length}
      adminRequestCount={
        requests.filter(r => r.status === "pending").length +
        notifications.filter(n => n.recipient_user_id === session?.user?.id && !n.is_read).length
      }
      onSelectTab={setTab}
      onCloseMobileNav={() => setMobileNav(false)}
      onSignOut={signOut}
    />}
      header={<AppHeader
      activeTab={tab}
      isAdmin={isAdmin}
      pwaInstalled={pwaInstalled}
      theme={theme}
      onToggleMobileMenu={() => setMobileNav(value => !value)}
      onInstallApp={installGmsApp}
      onToggleTheme={toggleTheme}
      onRefresh={loadData}
    />}
      mobileNavigation={<MobileNavigation
      activeTab={tab}
      isAdmin={isAdmin}
      open={mobileNav}
      pwaInstalled={pwaInstalled}
      theme={theme}
      showInboxBadge={(isAdmin ? (requests.filter(r => r.status === "pending").length + notifications.filter(n => n.recipient_user_id === session?.user?.id && !n.is_read).length) : requests.filter(r => r.requester_servant_id === myServant?.id && ["approved", "declined", "rejected"].includes(String(r.status).toLowerCase()) && !requestReads.some(x => x.request_id === r.id && x.user_id === session?.user?.id)).length) > 0}
      onSelectTab={setTab}
      onToggleMenu={() => setMobileNav(value => !value)}
      onCloseMenu={() => setMobileNav(false)}
      onToggleTheme={toggleTheme}
      onInstallApp={() => { void installGmsApp(); }}
      onSignOut={signOut}
    />}
      overlays={
        <>
          {actionDialog&&<ActionDialog dialog={actionDialog} inputValue={actionDialogInput} onInputChange={setActionDialogInput} onClose={closeActionDialog}/> }
    {modal==="schedule"&&<ScheduleModal locations={locations} servants={servants.filter(s=>s.active)} availability={availability} preferences={servingPreferences} schedules={schedules} editing={editing} onClose={()=>{setScheduleError("");setModal(null);setEditing(null);}} onSave={saveSchedule} error={scheduleError}/>}
    {modal==="person"&&<PersonModal onClose={()=>setModal(null)} onSave={savePerson}/>}
    {swapDraft&&<DirectSwapModal source={swapDraft} schedules={schedules} servantId={myServant?.id??""} onClose={()=>setSwapDraft(null)} onSubmit={submitDirectSwap}/>}
        </>
      }
    >

        {!isAdmin&&memberProfile&&((Date.now()-new Date(memberProfile.last_verified_at).getTime())>90*86400000)&&<div className="message-banner profile-reminder"><span><b>Profile verification reminder:</b> Please review your member information. It has been more than 3 months since your last verification.</span><button className="btn tiny secondary" onClick={()=>setTab("profile")}>Review profile</button></div>}{message&&<div className="message-banner"><span>{message}</span><button className="icon-btn" onClick={()=>setMessage("")}><X size={16}/></button></div>}{!isOnline&&<div className="offline-status-banner"><WifiOff size={16}/>You are offline. Schedule data is not refreshed or saved for offline use; reconnect before making assignment changes.</div>}
        {tab==="schedule"? <>
          {!isAdmin&&<MyScheduleSummary daysServed={myDaysServed} upcoming={nextMySchedule} servantId={myServant?.id??""}/>}
          {!isAdmin&&<MyUpcomingAssignments items={[...myPublishedSchedules].filter(s=>s.service_date>=today()).sort((a,b)=>a.service_date.localeCompare(b.service_date)||a.start_time.localeCompare(b.start_time))} servantId={myServant?.id??""} onConfirm={confirmAssignment} onRequest={submitServingRequest}/>}
          {isAdmin ? <>
            <div className="toolbar schedule-page-heading"><div><h2>Serving schedule</h2><p className="subtle">Manage coverage, servant assignments and service calendars across all church locations.</p></div></div>
            <div className="schedule-workspace-tabs" role="tablist" aria-label="Schedule workspace">
              <button type="button" role="tab" aria-selected={adminScheduleView==="overview"} className={adminScheduleView==="overview"?"selected":""} onClick={()=>setAdminScheduleView("overview")}><BarChart3 size={16}/> Overview</button>
              <button type="button" role="tab" aria-selected={adminScheduleView==="assignments"} className={adminScheduleView==="assignments"?"selected":""} onClick={()=>setAdminScheduleView("assignments")}><Users size={16}/> Assignments</button>
              <button type="button" role="tab" aria-selected={adminScheduleView==="calendar"} className={adminScheduleView==="calendar"?"selected":""} onClick={()=>setAdminScheduleView("calendar")}><CalendarDays size={16}/> Calendar</button>
            </div>

            <section className="schedule-workspace-panel" role="tabpanel" hidden={adminScheduleView!=="overview"}>
              <AssignmentOverview schedules={schedules} requests={requests} servants={servants} availability={availability}/>
            </section>

            <section className="schedule-workspace-panel" role="tabpanel" hidden={adminScheduleView!=="assignments"}>
              <div className="toolbar assignment-workspace-heading"><div><h2>Assignment management</h2><p className="subtle">Create services, manage church-wide actions and assign servants across multiple services.</p></div><div className="toolbar-actions assignment-management-actions"><button className="btn primary" onClick={()=>{setScheduleError("");setEditing(null);setModal("schedule");}}><Plus size={16}/> Add special service</button><button className="btn secondary" onClick={addLocation}><Plus size={16}/> Add church</button><button className="btn secondary" onClick={addRecurringTemplate}><Plus size={16}/> Add recurring service</button></div></div>
              <ChurchBulkActions locations={locations} disabled={loading} onPublish={id=>void bulkSetLocationStatus(id,"published")} onUnpublish={id=>void bulkSetLocationStatus(id,"draft")} onDelete={id=>void deleteAllLocationSchedules(id)}/>
              <BulkAssignmentCenter schedules={schedules} servants={servants} availability={availability} preferences={servingPreferences} disabled={loading} onApply={applyBulkAssignments} onEditSchedule={s=>{setScheduleError("");setEditing(s);setModal("schedule");}} onPublishSchedule={publishSchedule} onDeleteSchedule={deleteSchedule}/>
              <GeneratePanel templates={templates} locations={locations} onGenerate={generateWeekend} onAddTemplate={async(locationId,day,name,start,end)=>{if(!supabase||!isAdmin)return;const {error}=await supabase.from("service_templates").upsert({location_id:locationId,day_of_week:day,service_name:name,start_time:start,end_time:end,active:true},{onConflict:"location_id,day_of_week,service_name"});if(error)throw error;await loadData();setMessage(`${name} template saved. Select it above to generate future weekends.`);}} onDeleteTemplate={async(template)=>{if(!supabase||!isAdmin)return;const ok=await askAction("Remove service template",`Remove ${template.service_name} (${dayNameForTemplate(template.day_of_week)}) from future recurring generation? Existing schedules already generated from this template will not be deleted.`,`Remove template`,true);if(!ok)return;const {error}=await supabase.from("service_templates").update({active:false}).eq("id",template.id);if(error){setMessage(error.message);return;}await loadData();setMessage(`${template.service_name} was removed from active templates. Existing schedules were preserved.`);}}/>
            </section>

            <section className="schedule-workspace-panel" role="tabpanel" hidden={adminScheduleView!=="calendar"}>
              <div className="toolbar calendar-workspace-heading"><div><h2>Schedule calendar</h2><p className="subtle">Browse the daily schedule by church. Use Assignments to edit, publish or remove individual services.</p></div><div className="toolbar-actions"><button className="btn secondary" onClick={exportCsv}><Download size={16}/> Export</button><button className="btn secondary" onClick={()=>void exportScheduleHistory()}><Download size={16}/> History CSV</button></div></div>
              <div className="calendar-switch"><span>Calendar grouping</span><button className={calendarView==="week"?"selected":""} onClick={()=>setCalendarView("week")}>Weekly</button><button className={calendarView==="month"?"selected":""} onClick={()=>setCalendarView("month")}>Monthly</button></div>
              <details className="filter-panel filter-panel-collapsible" open><summary className="filter-title"><span><Search size={17}/> <b>Filter schedule</b></span><ChevronDown size={18}/></summary><div className="filters">
                <label className="search-field"><span>Servant name · any role</span><input value={personFilter} onChange={e=>setPersonFilter(e.target.value)} placeholder="Search servant name"/></label>
                <label><span>Church location</span><select value={locationFilter} onChange={e=>setLocationFilter(e.target.value)}><option value="">All locations</option>{locations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
                <label><span>Service</span><select value={serviceFilter} onChange={e=>setServiceFilter(e.target.value)}><option value="">All services</option>{[...new Set(schedules.map(s=>s.service_name))].sort().map(n=><option key={n}>{n}</option>)}</select></label>
                <label><span>From</span><input type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)}/></label>
                <label><span>To</span><input type="date" value={toDate} onChange={e=>setToDate(e.target.value)}/></label>
              </div><button className="clear-btn" onClick={()=>{setPersonFilter("");setLocationFilter("");setServiceFilter("");setFromDate("");setToDate("");}}>Clear all filters</button></details>
              <details className="collapsible-panel">
                <summary><span><b>{calendarView==="week"?"Weekly calendar":"Monthly calendar"} · Daily overview</b><small>{dailyGroups.length} days · summary by church location</small></span><ChevronDown size={20}/></summary>
                {calendarSections.length>0&&calendarSections.map(section=><section className="calendar-period" key={section.key}><h3>{section.label}</h3><div className="daily-overview">{section.groups.map(group=><DailySummary key={group.date} date={group.date} items={group.items} isAdmin={isAdmin}/>)}</div></section>)}
              </details>

            </section>
          </> : <>
            <div className="toolbar"><div><h2>All published schedules</h2><p className="subtle">Browse published serving assignments across all church locations.</p></div><div className="toolbar-actions serving-toolbar-actions"><button className="btn secondary" onClick={exportCsv}><Download size={16}/> Export</button></div></div>
            <div className="calendar-switch servant-calendar-switch" role="group" aria-label="Calendar grouping"><span>Calendar view</span><button type="button" className={calendarView==="week"?"selected":""} aria-pressed={calendarView==="week"} onClick={()=>setCalendarView("week")}>Weekly</button><button type="button" className={calendarView==="month"?"selected":""} aria-pressed={calendarView==="month"} onClick={()=>setCalendarView("month")}>Monthly</button></div>
            <details className="filter-panel filter-panel-collapsible" open><summary className="filter-title"><span><Search size={17}/> <b>Filter schedule</b></span><ChevronDown size={18}/></summary><div className="filters">
              <label className="search-field"><span>Servant name · any role</span><input value={personFilter} onChange={e=>setPersonFilter(e.target.value)} placeholder="Search servant name"/></label>
              <label><span>Church location</span><select value={locationFilter} onChange={e=>setLocationFilter(e.target.value)}><option value="">All locations</option>{locations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
              <label><span>Service</span><select value={serviceFilter} onChange={e=>setServiceFilter(e.target.value)}><option value="">All services</option>{[...new Set(schedules.map(s=>s.service_name))].sort().map(n=><option key={n}>{n}</option>)}</select></label>
              <label><span>From</span><input type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)}/></label>
              <label><span>To</span><input type="date" value={toDate} onChange={e=>setToDate(e.target.value)}/></label>
            </div><button className="clear-btn" onClick={()=>{setPersonFilter("");setLocationFilter("");setServiceFilter("");setFromDate("");setToDate("");}}>Clear all filters</button></details>
            <details className="collapsible-panel">
              <summary><span><b>{calendarView==="week"?"Weekly calendar":"Monthly calendar"} · Daily overview</b><small>{dailyGroups.length} days · summary by church location</small></span><ChevronDown size={20}/></summary>
              {calendarSections.length>0&&calendarSections.map(section=><section className="calendar-period" key={section.key}><h3>{section.label}</h3><div className="daily-overview">{section.groups.map(group=><DailySummary key={group.date} date={group.date} items={group.items} isAdmin={false}/>)}</div></section>)}
            </details>

          </>}
        </>:tab==="servantInfo"?<ServantInformationPanel isAdmin={isAdmin} servants={servants} memberDirectory={memberDirectory} accountCandidates={servantAccountCandidates} locations={locations} schedules={schedules} requests={requests} onAdd={()=>setModal("person")} onToggle={togglePerson} onLink={linkServantAccount}/>:tab==="inbox"&&!isAdmin?<ServantInbox requests={requests.filter(r=>r.requester_servant_id===myServant?.id)} schedules={schedules} reads={requestReads} onRead={markRequestRead} notifications={notifications.filter(n=>n.recipient_user_id===session?.user?.id)} onNotificationRead={markNotificationRead} pushEnabled={pushEnabled} pushBusy={pushBusy} onEnablePush={enablePushNotifications} onDisablePush={disablePushNotifications} notificationPrefs={notificationPrefs} onSaveNotificationPreferences={onSaveNotificationPreferences}/>:tab==="requests"&&isAdmin?<RequestsPanel requests={requests} schedules={schedules} servants={servants} onReview={reviewRequest} onResolve={resolveReplacement} notifications={notifications.filter(n=>n.recipient_user_id===session?.user?.id)} onNotificationRead={markNotificationRead} pushEnabled={pushEnabled} pushBusy={pushBusy} onEnablePush={enablePushNotifications} onDisablePush={disablePushNotifications} notificationPrefs={notificationPrefs} onSaveNotificationPreferences={onSaveNotificationPreferences}/>:tab==="availability"?<AvailabilityPanel servants={servants} availability={availability} rules={availabilityRules} preferences={servingPreferences} locations={locations} schedules={schedules} templates={templates} isAdmin={isAdmin} currentUserId={session.user.id} onSave={saveAvailability} onBulkSave={saveBulkAvailability} onSaveRule={saveAvailabilityRule} onSavePreference={saveServingPreference} onDeletePreference={deleteServingPreference} onDeleteRule={async(id)=>{const ok=await askAction("Delete recurring restriction?","Future dates generated by this rule will no longer be treated as unavailable. Existing dated availability records will remain unchanged.","Delete rule",true);if(ok)await deleteAvailabilityRule(id);}} onDelete={deleteAvailability} deadline={availabilityDeadline} onSaveDeadline={saveDeadline}/>:tab==="statistics"?<StatisticsPanel schedules={filtered} servants={servants}/>:tab==="audit"?<AuditPanel logs={auditLogs} onDownload={exportAuditHistory}/>:(!isAdmin&&tab==="profile")?<MemberProfilePanel profile={memberProfile} isAdmin={false} directory={[]} onSave={async(payload)=>{if(!supabase)return;try{await saveMemberProfile(supabase,session.user.id,payload,memberProfile?.email);setMessage("Profile updated and verification date refreshed.");await loadData();}catch(error){setMessage(errorText(error));}}}/>:null}
      </AppLayout>
  );
}



function AssignmentOverview({schedules,requests,servants,availability}:{schedules:ScheduleView[];requests:any[];servants:Servant[];availability:any[]}){
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

function BulkAssignmentCenter({schedules,servants,availability,preferences,disabled,onApply,onEditSchedule,onPublishSchedule,onDeleteSchedule}:{schedules:ScheduleView[];servants:Servant[];availability:any[];preferences:any[];disabled:boolean;onApply:(rows:any[])=>Promise<boolean>;onEditSchedule:(schedule:ScheduleView)=>void;onPublishSchedule:(schedule:ScheduleView)=>void;onDeleteSchedule:(schedule:ScheduleView)=>void}){
 const upcoming=schedules.filter(s=>s.service_date>=today()).sort((a,b)=>a.service_date.localeCompare(b.service_date)||a.start_time.localeCompare(b.start_time));
 const [selected,setSelected]=useState<string[]>([]);
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
 const toggle=(id:string)=>{setAcceptWorkload(false);setSelected(v=>v.includes(id)?v.filter(x=>x!==id):[...v,id]);};
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
  setSelected(current=>[...new Set([...current,...target.filter(t=>source.some(x=>x.location_id===t.location_id&&x.service_name===t.service_name)).map(t=>t.id)])]);
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
 const churchGroups=[...new Map(upcoming.slice(0,60).map(s=>[s.location_id,{id:s.location_id,name:s.location_name}])).values()];
 const commit=async()=>{if(!selected.length)return;const ok=await onApply(rows);if(ok){setSelected([]);setPreview(false);}};
 return <details className="bulk-assignment-center bulk-assignment-collapsible">
  <summary className="bulk-assignment-summary"><div className="bulk-assignment-heading"><div><h2>Bulk Assignment Center</h2><p className="subtle">Edit multiple service assignments, copy a previous weekend and review conflicts before applying.</p></div><span className="bulk-selected-count">{selected.length} selected</span></div><ChevronDown size={19}/></summary><div className="bulk-assignment-content">
  <div className="bulk-copy-panel"><div><b>Copy previous weekend</b><small>Copy matching church and service names into another weekend. Review every copied assignment before applying.</small></div><div className="bulk-copy-controls"><label>From Saturday<input type="date" value={sourceDate} onChange={e=>setSourceDate(e.target.value)}/></label><label>To Saturday<input type="date" value={targetDate} onChange={e=>setTargetDate(e.target.value)}/></label><button className="btn secondary" disabled={!sourceDate||!targetDate||disabled} onClick={copyPrevious}>Copy assignments</button></div></div>
  <div className="bulk-matrix-toolbar"><div className="bulk-matrix-heading-copy"><b>Assignment distribution matrix</b><small>Use the actions at the end of each row to edit, publish or delete an individual service.</small></div><div><button className="link-btn" onClick={()=>setSelected(upcoming.slice(0,60).map(s=>s.id))}>Select all listed</button><button className="link-btn" onClick={()=>setSelected([])}>Clear selection</button></div></div>
  <div className="bulk-church-groups">{churchGroups.map(group=>{const services=upcoming.filter(s=>s.location_id===group.id).slice(0,60);const selectedHere=services.filter(s=>selected.includes(s.id)).length;return <details className="bulk-church-group" key={group.id}><summary><span><b>{group.name}</b><small>{services.length} services · {selectedHere} selected</small></span><div className="bulk-group-selection-actions"><button type="button" className="link-btn" onClick={e=>{e.preventDefault();e.stopPropagation();setSelected(v=>[...new Set([...v,...services.map(service=>service.id)])]);}}>Select all</button><button type="button" className="link-btn" disabled={selectedHere===0} onClick={e=>{e.preventDefault();e.stopPropagation();setSelected(v=>v.filter(id=>!services.some(service=>service.id===id)));}}>Clear selection</button></div><ChevronDown size={17}/></summary><div className="bulk-matrix-wrap"><table className="bulk-matrix"><thead><tr><th>Select</th><th>Service</th><th>Date / time</th><th>FOH</th><th>Monitor</th><th>Assistant</th><th>Actions</th></tr></thead><tbody>{services.map(s=><tr key={s.id}><td><input aria-label={`Select ${s.location_name} ${s.service_name}`} type="checkbox" checked={selected.includes(s.id)} onChange={()=>toggle(s.id)}/></td><td><b>{s.service_name}</b><small className={`bulk-matrix-status ${s.status==="published"?"is-published":"is-draft"}`}>{s.status==="published"?"Published":"Draft"}</small>{hasPendingRowChanges(s)&&<small className="bulk-matrix-pending">Unsaved assignment edits</small>}</td><td>{fmtDate(s.service_date)}<small>{shortTime(s.start_time)}–{shortTime(s.end_time)}</small></td>{ROLES.map(role=>{const servantId=draft[s.id]?.[role]??"";const feedback=servantId?assignmentFeedback(s,role,servantId):null;return <td key={role}><div className="bulk-assignment-cell"><select aria-label={`${role} for ${s.location_name} ${s.service_name}`} value={servantId} onChange={e=>setRole(s.id,role,e.target.value)}><option value="">Unassigned</option>{servants.filter(p=>p.active).map(p=>{const status=availability.find(a=>a.servant_id===p.id&&a.service_date===s.service_date)?.status;const marker=status==="unavailable"?" · UNAVAILABLE":status==="prefer_not"?" · PREFER NOT":status==="available"?" · Available":"";return <option key={p.id} value={p.id}>{p.full_name}{marker}</option>;})}</select>{feedback?.blockers.length?<small className="assignment-field-feedback blocked"><AlertTriangle size={12}/><span>{feedback.blockers.join(" · ")}</span></small>:feedback?.warnings.length?<small className="assignment-field-feedback warning"><Info size={12}/><span>{feedback.warnings.join(" · ")}</span></small>:feedback?.status==="available"?<small className="assignment-field-feedback clear"><CheckCircle2 size={12}/><span>Available on this date</span></small>:null}</div></td>;})}<td><div className="bulk-row-actions"><button type="button" className="bulk-row-action" title="Edit service" aria-label={`Edit ${s.service_name}`} onClick={()=>onEditSchedule(s)}><Pencil size={14}/></button><button type="button" className="bulk-row-action" disabled={disabled} title={hasPendingRowChanges(s)?`${s.status==="published"?"Save changes and unpublish":"Save changes and publish"} service`:(s.status==="published"?"Unpublish service":"Publish service")} aria-label={`${hasPendingRowChanges(s)?"Save changes and ": ""}${s.status==="published"?"Unpublish":"Publish"} ${s.service_name}`} onClick={()=>void handleRowPublish(s)}>{s.status==="published"?<EyeOff size={14}/>:<Send size={14}/>}</button><button type="button" className="bulk-row-action danger" title="Delete service" aria-label={`Delete ${s.service_name}`} onClick={()=>onDeleteSchedule(s)}><Trash2 size={14}/></button></div></td></tr>)}</tbody></table></div></details>;})}</div>
  {upcoming.length>60&&<p className="subtle">Showing the first 60 upcoming services. Use the schedule filters to narrow the list.</p>}
  <div className="bulk-apply-footer"><span>{selected.length} services · {rows.length} role slots in the update</span><button className="btn primary" disabled={!selected.length||disabled} onClick={()=>setPreview(true)}>Review assignments</button></div>
  {preview&&<div className="bulk-preview-panel"><div className="bulk-preview-heading"><div><h3>Review bulk assignments</h3><p className="subtle">No assignments are changed until you confirm.</p></div><button className="icon-btn" onClick={()=>setPreview(false)}><X size={17}/></button></div><div className="bulk-preview-stats"><span><b>{selected.length}</b> services</span><span><b>{rows.filter(r=>r.servant_id).length}</b> assigned roles</span><span><b>{conflicts.length}</b> blocking conflicts</span><span><b>{workloadWarnings.length}</b> workload warnings</span></div>{conflicts.length>0?<div className="control-center-alert"><AlertTriangle size={16}/><span>{conflicts.slice(0,12).join("; ")}. Correct conflicts before applying.</span></div>:<p className="workload-status">No blocking availability, preference or scheduling conflicts detected. Database checks run again when saving.</p>}{workloadWarnings.length>0&&<div className="workload-warning"><b>Fairness warnings</b><p>{workloadWarnings.slice(0,8).join("; ")}</p><label><input type="checkbox" checked={acceptWorkload} onChange={e=>setAcceptWorkload(e.target.checked)}/> I reviewed these workload warnings and want to continue.</label></div>}<button className="btn primary" disabled={disabled||conflicts.length>0||(workloadWarnings.length>0&&!acceptWorkload)} onClick={()=>void commit()}>Confirm and apply assignments</button></div>}
 </div>
  </details>;
}
function ChurchBulkActions({locations,disabled,onPublish,onUnpublish,onDelete}:{locations:Location[];disabled:boolean;onPublish:(id:string)=>void;onUnpublish:(id:string)=>void;onDelete:(id:string)=>void}){
 const [locationId,setLocationId]=useState("__all_churches__");
 useEffect(()=>{if(locationId!=="__all_churches__"&&locationId&&!locations.some(l=>l.id===locationId))setLocationId("__all_churches__");},[locations,locationId]);
 const allChurches=locationId==="__all_churches__";
 return <section className="church-bulk-actions"><div><b>Church-wide schedule actions</b><p className="subtle">Publish, unpublish or permanently delete schedules across one church or all church locations.</p></div><div className="church-bulk-controls"><label className="church-location-picker"><span>Church location</span><select value={locationId} onChange={e=>setLocationId(e.target.value)} disabled={!locations.length||disabled}><option value="__all_churches__">All churches</option>{locations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label><button className="btn primary" disabled={!locations.length||disabled} onClick={()=>onPublish(locationId)}>Publish all</button><button className="btn secondary" disabled={!locations.length||disabled} onClick={()=>onUnpublish(locationId)}>Unpublish all</button><button className="btn danger" disabled={!locations.length||disabled} title={allChurches?"Delete all schedules across every church":"Delete all schedules for this church"} onClick={()=>onDelete(locationId)}><Trash2 size={14}/> Delete all</button></div>{allChurches&&<small className="church-bulk-safety-note">All-church deletion requires typing “I do understand” and a second confirmation.</small>}</section>;
}
function MyUpcomingAssignments({items,servantId,onConfirm,onRequest}:{items:ScheduleView[];servantId:string;onConfirm:(s:ScheduleView,status:"confirmed"|"declined")=>void;onRequest:(s:ScheduleView,kind:"replacement"|"swap")=>void}){
 const grouped=[...new Map(items.map(s=>[s.location_id,{id:s.location_id,name:s.location_name}])).values()];
 return <section className="my-upcoming-panel"><div className="my-upcoming-panel-head"><div><h3>My upcoming serving assignments</h3><p className="subtle">Confirm your upcoming service or request a replacement or swap.</p></div><span>{items.length} upcoming</span></div>{!items.length?<p className="my-upcoming-empty">You have no upcoming published assignments.</p>:grouped.map(location=><div className="my-upcoming-location" key={location.id}><h4>{location.name}</h4><div className="my-upcoming-list">{items.filter(s=>s.location_id===location.id).map(s=>{const own=s.assignments.find(a=>a.servant_id===servantId);return <article className="my-upcoming-item" key={s.id}><div className="my-upcoming-info"><b>{fmtDate(s.service_date)} · {s.service_name}</b><span>{shortTime(s.start_time)}–{shortTime(s.end_time)} · Your role: {own?.role??"Assigned"}</span><small>Confirmation: {own?.confirmation_status??"pending"}</small></div><div className="my-upcoming-actions"><button className="btn tiny primary" onClick={()=>onConfirm(s,"confirmed")}>Accept</button><button className="btn tiny secondary" onClick={()=>onRequest(s,"swap")}>Request swap</button><button className="btn tiny secondary" onClick={()=>onRequest(s,"replacement")}>Request replacement</button></div></article>;})}</div></div>)}</section>;
}

function DirectSwapModal({source,schedules,servantId,onClose,onSubmit}:{source:ScheduleView;schedules:ScheduleView[];servantId:string;onClose:()=>void;onSubmit:(scheduleId:string,assignmentId:string,details:string)=>void}){
 const candidates=schedules.filter(s=>s.status==="published"&&s.id!==source.id&&s.service_date!==source.service_date&&s.assignments.some(a=>a.servant_id&&a.servant_id!==servantId));
 const [targetId,setTargetId]=useState("");const [assignmentId,setAssignmentId]=useState("");const [details,setDetails]=useState("");
 const selected=candidates.find(s=>s.id===targetId);const eligible=selected?.assignments.filter(a=>a.servant_id&&a.servant_id!==servantId)??[];
 return <div className="modal-backdrop"><section className="modal-card swap-modal"><div className="modal-head"><div><h2>Request a schedule swap</h2><p className="subtle">Choose another servant's published assignment, even on a different date.</p></div><button className="icon-btn" onClick={onClose}><X/></button></div><div className="swap-source"><b>Your assignment</b><span>{fmtDate(source.service_date)} · {source.location_name} · {source.service_name}</span></div><label>Swap with service<select value={targetId} onChange={e=>{setTargetId(e.target.value);setAssignmentId("");}}><option value="">Select another date and service</option>{candidates.map(s=><option key={s.id} value={s.id}>{fmtDate(s.service_date)} · {s.location_name} · {s.service_name}</option>)}</select></label><label>Servant assignment<select value={assignmentId} onChange={e=>setAssignmentId(e.target.value)} disabled={!selected}><option value="">Select servant</option>{eligible.map(a=><option key={a.id} value={a.id}>{a.servant_name} · {a.role}</option>)}</select></label><label>Note (optional)<textarea value={details} onChange={e=>setDetails(e.target.value)} placeholder="Add a note for the administrator"/></label><div className="modal-actions"><button className="btn secondary" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!targetId||!assignmentId} onClick={()=>onSubmit(targetId,assignmentId,details)}>Submit swap request</button></div></section></div>;
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
function PersonModal({onClose,onSave}:{onClose:()=>void;onSave:(e:FormEvent<HTMLFormElement>)=>void}){
 return <div className="modal-backdrop"><form className="modal-card compact" onSubmit={onSave}><div className="modal-head"><h2>Add servant</h2><button type="button" className="icon-btn" onClick={onClose}><X/></button></div><label>Full name<input name="full_name" required autoFocus placeholder="Servant's full name"/></label><div className="modal-actions"><button type="button" className="btn secondary" onClick={onClose}>Cancel</button><button className="btn primary">Add person</button></div></form></div>;
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
  {isAdmin&&<section className="availability-form-panel"><h3>Set availability deadline</h3><form className="availability-form" onSubmit={onSaveDeadline}><label>Submission deadline<input type="date" name="deadline" defaultValue={deadline}/></label><button className="btn primary">Save deadline</button></form></section>}
  {(isAdmin||myServant)&&<section className="availability-form-panel"><h3>{isAdmin?"Record servant availability":"Update my availability"}</h3><div className="availability-mode-switch"><button type="button" className={entryMode==="single"?"active":""} onClick={()=>{setEntryMode("single");setPreviewRows(null);}}>Single entry</button><button type="button" className={entryMode==="person"?"active":""} onClick={()=>{setEntryMode("person");setPreviewRows(null);setPreviewConflicts([]);}}>{isAdmin?"Bulk per person":"Multiple dates"}</button>{isAdmin&&<button type="button" className={entryMode==="day"?"active":""} onClick={()=>{setEntryMode("day");setPreviewRows(null);setPreviewConflicts([]);}}>Bulk per day</button>}</div>
   {entryMode==="single"?<><form className="availability-form" onSubmit={onSave}>{isAdmin?<label>Servant<select name="servant_id" required defaultValue=""><option value="" disabled>Select servant</option>{selectable.map(p=><option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>:<><input type="hidden" name="servant_id" value={myServant!.id}/><div className="availability-self-name"><span>Servant</span><b>{myServant!.full_name}</b></div></>}<label>Date<input name="service_date" type="date" required defaultValue={today()}/></label><label>Status<select name="status" defaultValue="available"><option value="available">Available</option><option value="unavailable">Unavailable</option><option value="prefer_not">Prefer not to serve</option></select></label><label className="availability-notes">Notes (optional)<input name="notes" placeholder="e.g. only available in the morning"/></label><button className="btn primary">Save availability</button></form><p className="subtle availability-note">One status per person per date. Saving again updates the existing entry.</p></>:
   <div className="bulk-availability-form"><div className={`bulk-form-grid ${entryMode==="day"?"is-day":"is-person"}`}>{entryMode==="person"?(isAdmin?<label className="bulk-person-servant">Servant<select value={bulkPerson} onChange={e=>setBulkPerson(e.target.value)}><option value="">Select servant</option>{selectable.map(p=><option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>:<div className="availability-self-name bulk-person-servant"><span>Servant</span><b>{myServant?.full_name??"Your linked servant profile"}</b></div>):<div className="bulk-servant-picker"><b>Select servants</b><div className="bulk-servant-list">{selectable.map(p=><label key={p.id}><input type="checkbox" checked={bulkPeople.includes(p.id)} onChange={()=>togglePerson(p.id)}/>{p.full_name}</label>)}</div><small>{bulkPeople.length} servant(s) selected</small></div>}<label className="bulk-from-date">From date<input type="date" value={bulkFrom} onChange={e=>setBulkFrom(e.target.value)}/></label><label className="bulk-to-date">To date<input type="date" value={bulkTo} onChange={e=>setBulkTo(e.target.value)}/></label><label className="bulk-status">Status<select value={bulkStatus} onChange={e=>setBulkStatus(e.target.value)}><option value="available">Available</option><option value="unavailable">Unavailable</option><option value="prefer_not">Prefer not to serve</option></select></label><label className="bulk-apply-to">Apply to<select value={bulkPattern} onChange={e=>setBulkPattern(e.target.value)}><option value="daily">Every day</option><option value="weekdays">Weekdays (Mon–Fri)</option><option value="weekends">Weekends (Sat–Sun)</option><option value="selected">Selected weekdays</option></select></label>{bulkPattern==="selected"&&<div className="bulk-weekdays"><b>Select weekdays</b>{[ [1,"Mon"],[2,"Tue"],[3,"Wed"],[4,"Thu"],[5,"Fri"],[6,"Sat"],[0,"Sun"] ].map(([d,label])=><label key={d}><input type="checkbox" checked={bulkWeekdays.includes(Number(d))} onChange={()=>setBulkWeekdays(v=>v.includes(Number(d))?v.filter(x=>x!==Number(d)):[...v,Number(d)])}/>{label}</label>)}</div>}<label className="wide">Notes (optional)<input value={bulkNotes} onChange={e=>setBulkNotes(e.target.value)} placeholder="Optional note"/></label></div><button type="button" className="btn primary" onClick={buildBulkPreview}>Preview affected dates</button>
   {previewRows!==null&&<div className="bulk-preview-card"><div className="bulk-preview-head"><b>Preview before saving</b><span>{previewRows.length} record(s)</span></div>{previewRows.length===0?<p className="subtle">No dates or servants selected.</p>:<>{previewConflicts.length>0&&<div className="bulk-conflict-warning"><b>{previewConflicts.length} conflicting record(s)</b><span>These person/date combinations already have a different status. Resolve them before saving.</span>{previewConflicts.slice(0,12).map((r,i)=><small key={i}>{name(r.servant_id)} · {fmtDate(r.service_date)} · currently {availability.find(a=>a.servant_id===r.servant_id&&a.service_date===r.service_date)?.status}</small>)}</div>}<div className="bulk-preview-list">{previewRows.map((r,i)=><div key={i}><b>{name(r.servant_id)}</b><span>{fmtDate(r.service_date)} · {r.status.replace("_"," ")}</span></div>)}</div><button type="button" className="btn primary" disabled={previewConflicts.length>0} onClick={savePreview}>Confirm and save {previewRows.length} records</button></>}</div>}</div>}
  </section>}
  {(isAdmin||myServant)&&<section className="availability-form-panel recurring-rule-panel"><h3>Recurring availability restrictions</h3><form className="recurring-rule-form" onSubmit={makeRule}>{isAdmin&&<label className="rule-field-servant">Servant<select value={rulePerson} onChange={e=>setRulePerson(e.target.value)} required><option value="">Select servant</option>{selectable.map(p=><option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>}<label className="rule-field-pattern">Pattern<select value={rulePattern} onChange={e=>setRulePattern(e.target.value)}><option value="weekday">Every weekday (Mon–Fri)</option><option value="saturday">Every Saturday</option><option value="sunday">Every Sunday</option><option value="second_week">Second week of each month (8th–14th)</option><option value="nth_weekday">Specific weekday occurrence each month</option><option value="month_edges">Beginning and end of month (first/last 3 days)</option></select></label>{rulePattern==="nth_weekday"&&<div className="rule-inline rule-field-occurrence"><label>Occurrence<select value={ruleOrdinal} onChange={e=>setRuleOrdinal(e.target.value)}>{[[1,"First"],[2,"Second"],[3,"Third"],[4,"Fourth"],[5,"Last"]].map(([v,l])=><option value={v}>{l}</option>)}</select></label><label>Weekday<select value={ruleWeekday} onChange={e=>setRuleWeekday(e.target.value)}>{[[1,"Monday"],[2,"Tuesday"],[3,"Wednesday"],[4,"Thursday"],[5,"Friday"],[6,"Saturday"],[0,"Sunday"]].map(([v,l])=><option value={v}>{l}</option>)}</select></label></div>}<label className="rule-field-status">Status<select value={ruleStatus} onChange={e=>setRuleStatus(e.target.value)}><option value="unavailable">Unavailable</option><option value="prefer_not">Prefer not to serve</option></select></label><div className="rule-inline rule-field-dates"><label>Effective from<input type="date" value={ruleFrom} onChange={e=>setRuleFrom(e.target.value)}/></label><label>Until (optional)<input type="date" value={ruleUntil} onChange={e=>setRuleUntil(e.target.value)}/></label></div><label className="rule-field-notes">Notes (optional)<input value={ruleNotes} onChange={e=>setRuleNotes(e.target.value)} placeholder="e.g. family commitment"/></label><button className="btn primary rule-save">Save recurring restriction</button></form><div className="saved-rules-list">{ownRules.map(r=><div className="saved-rule-row" key={r.id}><div><b>{name(r.servant_id)}</b><small>{r.pattern.replaceAll("_"," ")} · {r.status} · from {fmtDate(r.effective_from)}{r.effective_until?` until ${fmtDate(r.effective_until)}`:" · no end date"}</small></div><button className="icon-btn" onClick={()=>onDeleteRule(r.id)} title="Delete recurring rule"><Trash2 size={15}/></button></div>)}</div></section>}
  {(isAdmin||myServant)&&<section className="availability-form-panel serving-preferences-panel"><h3>Serving preferences & eligibility</h3><form className="serving-preference-form" onSubmit={savePreference}>{isAdmin?<label>Servant<select value={preferencePerson} onChange={e=>setPreferencePerson(e.target.value)} required><option value="">Select servant</option>{selectable.map(p=><option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>:<div className="availability-self-name"><span>Servant</span><b>{myServant?.full_name}</b></div>}<label>Restriction type<select value={preferenceType} onChange={e=>setPreferenceType(e.target.value)}><option value="allowed_time_window">Can serve only during these time windows</option><option value="allowed_service_scope">Can serve only at these services / church</option></select></label>{preferenceType==="allowed_time_window"?<><div className="preference-weekday-picker"><b>Allowed days</b><div>{[[1,"Mon"],[2,"Tue"],[3,"Wed"],[4,"Thu"],[5,"Fri"],[6,"Sat"],[0,"Sun"]].map(([day,label])=><label key={day}><input type="checkbox" checked={preferenceDays.includes(Number(day))} onChange={()=>togglePreferenceDay(Number(day))}/>{label}</label>)}</div></div><div className="rule-inline"><label>Allowed from<input type="time" value={preferenceStart} onChange={e=>setPreferenceStart(e.target.value)}/></label><label>Allowed until<input type="time" value={preferenceEnd} onChange={e=>setPreferenceEnd(e.target.value)}/></label></div><small className="subtle">The entire service must fit inside the allowed window. Example: Sunday 07:00–11:00.</small></>:<><label>Church location<select value={preferenceLocation} onChange={e=>{setPreferenceLocation(e.target.value);setPreferenceServices([]);}} required><option value="">Select church</option>{locations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label><div className="preference-service-picker"><b>Allowed services</b>{selectablePreferenceServices.length?selectablePreferenceServices.map(name=><label key={name}><input type="checkbox" checked={preferenceServices.includes(name)} onChange={()=>setPreferenceServices(v=>v.includes(name)?v.filter(x=>x!==name):[...v,name])}/>{name}</label>):<small className="subtle">Choose a church to see its service templates and scheduled service names.</small>}</div><small className="subtle">Example: GMS Alam Sutera · Service 3, Service 4 and Service 5.</small></>}<label>Notes (optional)<input value={preferenceNotes} onChange={e=>setPreferenceNotes(e.target.value)} placeholder="e.g. Only available for morning services"/></label><button className="btn primary">Save serving preference</button></form><div className="saved-rules-list">{visiblePreferences.map(rule=><div className="saved-rule-row" key={rule.id}><div><b>{name(rule.servant_id)}</b><small>{rule.rule_type==="allowed_time_window"?`Only ${rule.days_of_week?.length?rule.days_of_week.map((d:number)=>["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d]).join(", "):"any day"} · ${String(rule.start_time).slice(0,5)}–${String(rule.end_time).slice(0,5)}`:`Only ${rule.service_names?.join(", ")||"selected services"} · ${locations.find(l=>l.id===rule.location_id)?.name??"Selected church"}`}{rule.notes?` · ${rule.notes}`:""}</small></div><button className="icon-btn" title="Remove serving preference" onClick={()=>onDeletePreference(rule.id)}><Trash2 size={15}/></button></div>)}</div></section>}
  {!isAdmin&&!myServant&&<div className="message-banner"><span>Your login is not linked to a servant directory profile yet. Please ask a GMS administrator to link your account before submitting availability.</span></div>}
  <section className="filter-panel availability-filter"><label><span>Filter by date</span><input type="date" value={dateFilter} onChange={e=>setDateFilter(e.target.value)}/></label><button className="clear-btn" onClick={()=>setDateFilter("")}>Clear date</button></section>
  <div className="list-heading"><h2>{isAdmin?"Availability records":"My availability records"}</h2><span>{rows.length} records</span></div>
  {rows.length===0?<div className="empty-state"><ClipboardCheck size={28}/><b>No availability records</b><p>Add a record above to help coordinators plan assignments.</p></div>:<div className="people-list">{rows.map(a=><div className="availability-row" key={a.id}><div className="availability-date">{fmtDate(a.service_date)}</div><div className="availability-person"><b>{name(a.servant_id)}</b><small>{a.notes||"No notes"}</small></div><span className={`availability-status ${a.status}`}>{a.status==="prefer_not"?"Prefer not to serve":a.status}</span>{(isAdmin||a.servant_id===myServant?.id)&&<button className="icon-btn" title="Delete record" onClick={()=>onDelete(a.id)}><Trash2 size={16}/></button>}</div>)}</div>}
 </>;
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
