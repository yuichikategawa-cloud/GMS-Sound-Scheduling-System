import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { CalendarDays, Church, Users, Search, Plus, LogOut, Pencil, Trash2, Download, RefreshCw, ShieldCheck, X, Menu, ChevronDown, BarChart3, ClipboardCheck, AlertTriangle, Inbox as InboxIcon, UserRound, MoreHorizontal, Info, Bell, Smartphone, Clock3, MapPin, WifiOff, Moon, Sun, EyeOff, Send, CheckCircle2 } from "lucide-react";
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
        loadRecentAuditLogs(supabase, auditCutoff),
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
  const scheduleActions = useScheduleActions({
    client: supabase, isAdmin, schedules, locations, servants, availability,
    servingPreferences, templates, editing, askAction, askText, loadData,
    setLoading, setMessage, setScheduleError, setModal, setEditing
  });
  const scheduleWorkspace = useScheduleWorkspace({
    schedules, isAdmin, myServantId: myServant?.id
  });

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
        />:tab==="servantInfo"?<ServantInformationPanel isAdmin={isAdmin} servants={servants} memberDirectory={memberDirectory} accountCandidates={servantAccountCandidates} locations={locations} schedules={schedules} requests={requests} onAdd={()=>setModal("person")} onToggle={togglePerson} onLink={linkServantAccount}/>:tab==="inbox"&&!isAdmin?<ServantInbox requests={requests.filter(r=>r.requester_servant_id===myServant?.id)} schedules={schedules} reads={requestReads} onRead={markRequestRead} notifications={notifications.filter(n=>n.recipient_user_id===session?.user?.id)} onNotificationRead={markNotificationRead} pushEnabled={pushEnabled} pushBusy={pushBusy} onEnablePush={enablePushNotifications} onDisablePush={disablePushNotifications} notificationPrefs={notificationPrefs} onSaveNotificationPreferences={onSaveNotificationPreferences}/>:tab==="requests"&&isAdmin?<RequestsPanel requests={requests} schedules={schedules} servants={servants} onReview={reviewRequest} onResolve={resolveReplacement} notifications={notifications.filter(n=>n.recipient_user_id===session?.user?.id)} onNotificationRead={markNotificationRead} pushEnabled={pushEnabled} pushBusy={pushBusy} onEnablePush={enablePushNotifications} onDisablePush={disablePushNotifications} notificationPrefs={notificationPrefs} onSaveNotificationPreferences={onSaveNotificationPreferences}/>:tab==="availability"?<AvailabilityPanel servants={servants} availability={availability} rules={availabilityRules} preferences={servingPreferences} locations={locations} schedules={schedules} templates={templates} isAdmin={isAdmin} currentUserId={session.user.id} onSave={saveAvailability} onBulkSave={saveBulkAvailability} onSaveRule={saveAvailabilityRule} onSavePreference={saveServingPreference} onDeletePreference={deleteServingPreference} onDeleteRule={async(id)=>{const ok=await askAction("Delete recurring restriction?","Future dates generated by this rule will no longer be treated as unavailable. Existing dated availability records will remain unchanged.","Delete rule",true);if(ok)await deleteAvailabilityRule(id);}} onDelete={deleteAvailability} deadline={availabilityDeadline} onSaveDeadline={saveDeadline}/>:tab==="statistics"?<StatisticsPanel schedules={scheduleWorkspace.filtered} servants={servants}/>:tab==="audit"?<AuditPanel logs={auditLogs} onDownload={exportAuditHistory}/>:(!isAdmin&&tab==="profile")?<MemberProfilePanel profile={memberProfile} isAdmin={false} directory={[]} onSave={async(payload)=>{if(!supabase)return;try{await saveMemberProfile(supabase,session.user.id,payload,memberProfile?.email);setMessage("Profile updated and verification date refreshed.");await loadData();}catch(error){setMessage(errorText(error));}}}/>:null}
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




