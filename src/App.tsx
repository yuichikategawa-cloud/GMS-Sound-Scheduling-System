import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { CalendarDays, Church, Users, Search, Plus, LogOut, Pencil, Trash2, Download, RefreshCw, ShieldCheck, X, Menu, ChevronDown, BarChart3, AlertTriangle, Inbox as InboxIcon, UserRound, MoreHorizontal, Info, Bell, Smartphone, Clock3, MapPin, WifiOff, Moon, Sun, EyeOff, Send, CheckCircle2 } from "lucide-react";
import { supabase, isSupabaseConfigured } from "./supabase";
import type { Assignment, Location, Profile, Role, Schedule, ScheduleView, Servant } from "./types";
import { today, fmtDate, shortTime, errorText } from "./shared/formatters";
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
import { loadAvailabilityWorkspaceData } from "./features/availability/services/availabilityData";
import { useAvailabilityActions } from "./features/availability/hooks/useAvailabilityActions";
import AvailabilityWorkspace from "./features/availability/components/AvailabilityWorkspace";
import { createServantRecord, linkServantAccountRecord, loadServantRecords, setServantActive } from "./features/servants/services/servantManagement";
import { buildServantAccountCandidates, loadServantDirectoryData } from "./features/servants/services/servantDirectory";
import { loadServingRequestData } from "./features/requests/services/requestData";
import { loadServingNotificationData } from "./features/notifications/services/notificationData";
import PushNotificationSettings from "./features/notifications/components/PushNotificationSettings";
import { markServingNotificationRead, saveServingNotificationPreferences } from "./features/notifications/services/notificationPersistence";
import { cleanupServingPushSubscriptionForSignOut, disableServingPushSubscription, enableServingPushSubscription, isServingPushSubscriptionEnabled, type PushLifecycleRuntime } from "./features/notifications/services/pushSubscription";
import { createServingRequest, executeServingRequestSwap, markServingRequestRead, resolveServingRequestReplacement, updateServingRequestReview } from "./features/requests/services/requestPersistence";
import ServantInformationPanel from "./features/servants/components/ServantInformationPanel";
import ServantInbox from "./features/requests/components/ServantInbox";
import RequestsPanel from "./features/requests/components/RequestsPanel";
import AuditPanel from "./features/audit/components/AuditPanel";
import { buildAuditCsv, loadHistoricalAuditLogs, loadRecentAuditLogs } from "./features/audit/services/auditData";
import StatisticsPanel from "./features/statistics/components/StatisticsPanel";
import { ROLES } from "./features/schedule/constants";
import { useScheduleActions } from "./features/schedule/hooks/useScheduleActions";
import { useScheduleWorkspace } from "./features/schedule/hooks/useScheduleWorkspace";
import ScheduleWorkspace from "./features/schedule/components/ScheduleWorkspace";
import { DirectSwapModal, ScheduleModal } from "./features/schedule/components/ScheduleDialogs";


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
  const [theme,setTheme] = useState<"light"|"dark">(()=>{
    try { return window.localStorage.getItem("gms-sound-theme")==="dark"?"dark":"light"; }
    catch { return "light"; }
  });
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
      const [locRes,servRes,tempRes,schedRes,assignRes,availabilityDataRes,requestDataRes,notificationDataRes,auditRes,servantDirectoryRes] = await Promise.all([
        supabase.from("locations").select("*").order("name"),
        loadServantRecords(supabase),
        supabase.from("service_templates").select("*").eq("active",true),
        supabase.from("schedules").select("*").order("service_date").order("start_time"),
        supabase.from("assignments").select("*"),
        loadAvailabilityWorkspaceData(supabase),
        loadServingRequestData(supabase),
        loadServingNotificationData(supabase, notificationCutoff, session?.user?.id??""),
        loadRecentAuditLogs(supabase, auditCutoff),
        loadServantDirectoryData(supabase),
      ]);
      // Core schedule/servant data is required. Ancillary tables must not blank the whole dashboard
      // when their RLS policy or migration is not yet configured.
      for (const r of [locRes,servRes,schedRes,assignRes]) if (r.error) throw r.error;
      const optionalErrors = [...availabilityDataRes.optionalErrors,...[tempRes,requestDataRes.requests,requestDataRes.reads,notificationDataRes.notifications,notificationDataRes.preferences,auditRes,servantDirectoryRes.memberProfiles,servantDirectoryRes.accountProfiles]
        .filter((r:any) => r.error)
        .map((r:any) => r.error.message)];
      if (optionalErrors.length) console.warn("Some optional GMS dashboard data could not be loaded:", optionalErrors);
      const locs=(locRes.data??[]) as Location[], people=(servRes.data??[]) as Servant[];
      const assignments=(assignRes.data??[]) as Assignment[];
      const mapped=mapSchedules((schedRes.data??[]) as Schedule[],assignments,locs,people);
      const safeMemberRows = servantDirectoryRes.memberProfiles.error ? [] : (servantDirectoryRes.memberProfiles.data ?? []);
      setLocations(locs);setServants(people);setTemplates(tempRes.error?[]:(tempRes.data??[]));setSchedules(mapped);
      setAvailabilityRules(availabilityDataRes.rules);setServingPreferences(availabilityDataRes.preferences);
      setAvailability(availabilityDataRes.availability);setAvailabilityDeadline(availabilityDataRes.deadline);
      setRequests(requestDataRes.requests.error?[]:(requestDataRes.requests.data??[]));setRequestReads(requestDataRes.reads.error?[]:(requestDataRes.reads.data??[]));setNotifications(notificationDataRes.notifications.error?[]:(notificationDataRes.notifications.data??[]));
      setAuditLogs(auditRes.error?[]:(auditRes.data??[]));
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
  const scheduleActions = useScheduleActions({
    client: supabase, isAdmin, schedules, locations, servants, availability,
    servingPreferences, templates, editing, askAction, askText, loadData,
    setLoading, setMessage, setScheduleError, setModal, setEditing
  });
  const scheduleWorkspace = useScheduleWorkspace({
    schedules, isAdmin, myServantId: myServant?.id
  });

  const availabilityActions = useAvailabilityActions({
    client: supabase, isAdmin, servants, sessionUserId: session?.user?.id,
    availability, availabilityRules, servingPreferences, schedules, deadline: availabilityDeadline,
    loadData, setLoading, setMessage, setScheduleError, setAvailabilityDeadline
  });

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
    const newerThan=new Date(Date.now()-14*24*60*60*1000).toISOString();
    const {data,error}=await loadHistoricalAuditLogs(supabase,newerThan);
    if(error){setMessage(error.message);return;}
    if(!data||data.length===0){setMessage("No audit records older than 14 days are available to export.");return;}
    const csv=buildAuditCsv(data);
    const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="gms-audit-older-than-14-days-"+today()+".csv";a.click();URL.revokeObjectURL(url);
    setMessage("Downloaded "+data.length+" audit record(s) older than 14 days.");
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
      ...scheduleWorkspace.filtered.map(s=>[s.service_date,s.location_name,s.service_name,shortTime(s.start_time),shortTime(s.end_time),...ROLES.map(r=>s.assignments.find(a=>a.role===r)?.servant_name??"")].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(","))];
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
    {modal==="schedule"&&<ScheduleModal locations={locations} servants={servants.filter(s=>s.active)} availability={availability} preferences={servingPreferences} schedules={schedules} editing={editing} onClose={()=>{setScheduleError("");setModal(null);setEditing(null);}} onSave={scheduleActions.saveSchedule} error={scheduleError}/>}
    {modal==="person"&&<PersonModal onClose={()=>setModal(null)} onSave={savePerson}/>}
    {swapDraft&&<DirectSwapModal source={swapDraft} schedules={schedules} servantId={myServant?.id??""} onClose={()=>setSwapDraft(null)} onSubmit={submitDirectSwap}/>}
        </>
      }
    >

        {!isAdmin&&memberProfile&&((Date.now()-new Date(memberProfile.last_verified_at).getTime())>90*86400000)&&<div className="message-banner profile-reminder"><span><b>Profile verification reminder:</b> Please review your member information. It has been more than 3 months since your last verification.</span><button className="btn tiny secondary" onClick={()=>setTab("profile")}>Review profile</button></div>}{message&&<div className="message-banner"><span>{message}</span><button className="icon-btn" onClick={()=>setMessage("")}><X size={16}/></button></div>}{!isOnline&&<div className="offline-status-banner"><WifiOff size={16}/>You are offline. Schedule data is not refreshed or saved for offline use; reconnect before making assignment changes.</div>}
        {tab==="schedule" ? <ScheduleWorkspace
          workspace={scheduleWorkspace} isAdmin={isAdmin} schedules={schedules}
          requests={requests} servants={servants} availability={availability}
          preferences={servingPreferences} locations={locations} templates={templates}
          loading={loading} myServant={myServant}
          onOpenNewSchedule={()=>{setScheduleError("");setEditing(null);setModal("schedule");}}
          onAddLocation={scheduleActions.addLocation}
          onAddRecurringTemplate={scheduleActions.addRecurringTemplate}
          onPublishLocation={id=>void scheduleActions.bulkSetLocationStatus(id,"published")}
          onUnpublishLocation={id=>void scheduleActions.bulkSetLocationStatus(id,"draft")}
          onDeleteLocationSchedules={id=>void scheduleActions.deleteAllLocationSchedules(id)}
          onApplyBulkAssignments={scheduleActions.applyBulkAssignments}
          onEditSchedule={schedule=>{setScheduleError("");setEditing(schedule);setModal("schedule");}}
          onPublishSchedule={scheduleActions.publishSchedule}
          onDeleteSchedule={scheduleActions.deleteSchedule}
          onGenerate={scheduleActions.generateWeekend}
          onAddTemplate={scheduleActions.addServiceTemplate}
          onDeleteTemplate={scheduleActions.archiveServiceTemplate}
          onExportCsv={exportCsv} onExportScheduleHistory={exportScheduleHistory}
          onConfirmAssignment={confirmAssignment} onSubmitServingRequest={submitServingRequest}
        />:tab==="servantInfo"?<ServantInformationPanel isAdmin={isAdmin} servants={servants} memberDirectory={memberDirectory} accountCandidates={servantAccountCandidates} locations={locations} schedules={schedules} requests={requests} onAdd={()=>setModal("person")} onToggle={togglePerson} onLink={linkServantAccount}/>:tab==="inbox"&&!isAdmin?<ServantInbox requests={requests.filter(r=>r.requester_servant_id===myServant?.id)} schedules={schedules} reads={requestReads} onRead={markRequestRead} notifications={notifications.filter(n=>n.recipient_user_id===session?.user?.id)} notificationSettings={<PushNotificationSettings enabled={pushEnabled} busy={pushBusy} onEnable={enablePushNotifications} onDisable={disablePushNotifications} preferences={notificationPrefs} onSavePreferences={onSaveNotificationPreferences}/>} onNotificationRead={markNotificationRead}/>:tab==="requests"&&isAdmin?<RequestsPanel requests={requests} schedules={schedules} servants={servants} onReview={reviewRequest} onResolve={resolveReplacement} notifications={notifications.filter(n=>n.recipient_user_id===session?.user?.id)} notificationSettings={<PushNotificationSettings enabled={pushEnabled} busy={pushBusy} onEnable={enablePushNotifications} onDisable={disablePushNotifications} preferences={notificationPrefs} onSavePreferences={onSaveNotificationPreferences}/>} onNotificationRead={markNotificationRead}/>:tab==="availability"?<AvailabilityWorkspace servants={servants} availability={availability} rules={availabilityRules} preferences={servingPreferences} locations={locations} schedules={schedules} templates={templates} isAdmin={isAdmin} currentUserId={session.user.id} onSave={availabilityActions.saveAvailability} onBulkSave={availabilityActions.saveBulkAvailability} onSaveRule={availabilityActions.saveAvailabilityRule} onSavePreference={availabilityActions.saveServingPreference} onDeletePreference={availabilityActions.deleteServingPreference} onDeleteRule={async(id)=>{const ok=await askAction("Delete recurring restriction?","Future dates generated by this rule will no longer be treated as unavailable. Existing dated availability records will remain unchanged.","Delete rule",true);if(ok)await availabilityActions.deleteAvailabilityRule(id);}} onDelete={availabilityActions.deleteAvailability} deadline={availabilityDeadline} onSaveDeadline={availabilityActions.saveDeadline}/>:tab==="statistics"?<StatisticsPanel schedules={scheduleWorkspace.filtered} servants={servants}/>:tab==="audit"?<AuditPanel logs={auditLogs} onDownload={exportAuditHistory}/>:(!isAdmin&&tab==="profile")?<MemberProfilePanel profile={memberProfile} isAdmin={false} directory={[]} onSave={async(payload)=>{if(!supabase)return;try{await saveMemberProfile(supabase,session.user.id,payload,memberProfile?.email);setMessage("Profile updated and verification date refreshed.");await loadData();}catch(error){setMessage(errorText(error));}}}/>:null}
      </AppLayout>
  );
}



function PersonModal({onClose,onSave}:{onClose:()=>void;onSave:(e:FormEvent<HTMLFormElement>)=>void}){
 return <div className="modal-backdrop"><form className="modal-card compact" onSubmit={onSave}><div className="modal-head"><h2>Add servant</h2><button type="button" className="icon-btn" onClick={onClose}><X/></button></div><label>Full name<input name="full_name" required autoFocus placeholder="Servant's full name"/></label><div className="modal-actions"><button type="button" className="btn secondary" onClick={onClose}>Cancel</button><button className="btn primary">Add person</button></div></form></div>;
}
function PeoplePanel({servants,isAdmin,onAdd,onToggle}:{servants:Servant[];isAdmin:boolean;onAdd:()=>void;onToggle:(p:Servant)=>void}){
 const [q,setQ]=useState("");
 const rows=servants.filter(p=>p.full_name.toLowerCase().includes(q.toLowerCase()));
 return <><div className="toolbar"><div><h2>Servant directory</h2><p className="subtle">Manage the names available for role assignments.</p></div>{isAdmin&&<button className="btn primary" onClick={onAdd}><Plus size={16}/> Add servant</button>}</div><section className="filter-panel"><label className="search-field"><span>Search people</span><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search by name"/></label></section><div className="people-list">{rows.map(p=><div className="person-row" key={p.id}><div className="avatar">{p.full_name.slice(0,1).toUpperCase()}</div><div className="person-name"><b>{p.full_name}</b><small>{p.active?"Active":"Inactive"}</small></div>{isAdmin&&<button className={`btn tiny ${p.active?"secondary":"primary"}`} onClick={()=>onToggle(p)}>{p.active?"Deactivate":"Activate"}</button>}</div>)}</div></>;
}
