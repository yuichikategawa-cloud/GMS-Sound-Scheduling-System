import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import "./App.css";
import { useBrowserLifecycle } from "./app/hooks/useBrowserLifecycle";
import {
  createInitialDashboardState,
  dashboardStateReducer,
  type DashboardState,
} from "./app/state/dashboardState";
import { CalendarDays, Church, Users, Search, LogOut, Pencil, Trash2, Download, RefreshCw, ShieldCheck, X, Menu, ChevronDown, BarChart3, AlertTriangle, Inbox as InboxIcon, UserRound, MoreHorizontal, Info, Bell, Smartphone, Clock3, MapPin, WifiOff, Moon, Sun, EyeOff, Send, CheckCircle2 } from "lucide-react";
import { supabase, isSupabaseConfigured } from "./supabase";
import { useDashboardLoader } from "./app/hooks/useDashboardLoader";
import { createProfileLoadGuard } from "./app/services/profileLoadGuard";
import { useAssignmentConfirmationActions } from "./app/hooks/useAssignmentConfirmationActions";
import type { Location, Profile, ScheduleView, Servant } from "./types";
import { fmtDate, errorText, today } from "./shared/formatters";
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
import { useAuthenticationActions } from "./features/auth/hooks/useAuthenticationActions";
import { startAuthSessionLifecycle } from "./features/auth/services/sessionLifecycle";
import { loadMemberAccountProfile } from "./features/auth/services/memberProfile";
import { useMemberProfileActions } from "./features/auth/hooks/useMemberProfileActions";



import { useAvailabilityActions } from "./features/availability/hooks/useAvailabilityActions";
import AvailabilityWorkspace from "./features/availability/components/AvailabilityWorkspace";

import { useServantActions } from "./features/servants/hooks/useServantActions";
import AddServantDialog from "./features/servants/components/AddServantDialog";
import { buildServantAccountCandidates } from "./features/servants/services/servantDirectory";


import PushNotificationSettings from "./features/notifications/components/PushNotificationSettings";
import { useNotificationActions } from "./features/notifications/hooks/useNotificationActions";
import { usePushNotificationActions } from "./features/notifications/hooks/usePushNotificationActions";
import { useRequestActions } from "./features/requests/hooks/useRequestActions";
import ServantInformationPanel from "./features/servants/components/ServantInformationPanel";
import ServantInbox from "./features/requests/components/ServantInbox";
import RequestsPanel from "./features/requests/components/RequestsPanel";
import AuditPanel from "./features/audit/components/AuditPanel";

import { useAuditActions } from "./features/audit/hooks/useAuditActions";
import StatisticsPanel from "./features/statistics/components/StatisticsPanel";
import { useScheduleExportActions } from "./features/schedule/hooks/useScheduleExportActions";
import { useScheduleActions } from "./features/schedule/hooks/useScheduleActions";
import { useScheduleWorkspace } from "./features/schedule/hooks/useScheduleWorkspace";
import ScheduleWorkspace from "./features/schedule/components/ScheduleWorkspace";
import { DirectSwapModal, ScheduleModal } from "./features/schedule/components/ScheduleDialogs";


export default function App() {
  const [session,setSession] = useState<any>(null);
  const [profile,setProfile] = useState<Profile|null>(null);
  const [profileError,setProfileError] = useState("");
  const profileLoadGuard = useMemo(() => createProfileLoadGuard(), []);
  const [authLoading,setAuthLoading] = useState(true);
  const [loading,setLoading] = useState(false);
  const [message,setMessage] = useState("");
  const previousSessionUserId = useRef<string | undefined>(undefined);
  const [scheduleError,setScheduleError] = useState("");
  const [dashboardState, dispatchDashboardState] = useReducer(
    dashboardStateReducer,
    createInitialDashboardState(),
  );
  const {
    schedules,
    locations,
    servants,
    templates,
    availability,
    availabilityRules,
    servingPreferences,
    requests,
    requestReads,
    notifications,
    notificationPrefs,
    auditLogs,
    availabilityDeadline,
    memberProfile,
    memberDirectory,
    accountProfiles,
  } = dashboardState;
  const setNotifications: Dispatch<SetStateAction<DashboardState["notifications"]>> =
    update => dispatchDashboardState({ type: "set-notifications", update });
  const setNotificationPrefs: Dispatch<SetStateAction<DashboardState["notificationPrefs"]>> =
    update => dispatchDashboardState({ type: "set-notification-preferences", update });
  const setRequestReads: Dispatch<SetStateAction<DashboardState["requestReads"]>> =
    update => dispatchDashboardState({ type: "set-request-reads", update });
  const setAvailabilityDeadline = (value: string) =>
    dispatchDashboardState({ type: "set-availability-deadline", value });

  const [tab,setTab] = useState<"schedule"|"people"|"servantInfo"|"availability"|"statistics"|"audit"|"profile"|"inbox"|"requests">("schedule");
  const [swapDraft,setSwapDraft] = useState<ScheduleView|null>(null);
  const [theme,setTheme] = useState<"light"|"dark">(()=>{
    try { return window.localStorage.getItem("gms-sound-theme")==="dark"?"dark":"light"; }
    catch { return "light"; }
  });
  const [modal,setModal] = useState<"schedule"|"person"|null>(null);
  const [editing,setEditing] = useState<ScheduleView|null>(null);
  const [authMode,setAuthMode] = useState<AuthMode>("login");
  const [email,setEmail] = useState("");
  const [username,setUsername] = useState("");
  const [password,setPassword] = useState("");
  const [recoveryMode,setRecoveryMode] = useState(false);
  const [fullName,setFullName] = useState("");
  const [signupCgStatus,setSignupCgStatus] = useState("");
  const [mobileNav,setMobileNav] = useState(false);
  const [actionDialog,setActionDialog] = useState<ActionDialogState|null>(null);
  const [actionDialogInput,setActionDialogInput] = useState("");
  const actionDialogResolver = useRef<((accepted:boolean)=>void)|null>(null);
  const actionTextResolver = useRef<((value:string|null)=>void)|null>(null);

  const { loadData, invalidateDashboardLoad } = useDashboardLoader({
    client: supabase,
    userId: session?.user?.id,
    dispatchDashboardState,
    setLoading,
    setMessage,
  });

  const { installPrompt, pwaInstalled, isOnline, clearInstallPrompt } = useBrowserLifecycle({
    profileId: profile?.id,
    userId: session?.user?.id,
    refreshData: loadData,
    setMessage,
  });

  const pushActions = usePushNotificationActions({
    client: supabase,
    userId: session?.user?.id,
    setMessage
  });
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
    const currentUserId = session?.user?.id as string | undefined;
    if (previousSessionUserId.current !== currentUserId) {
      setMessage("");
      previousSessionUserId.current = currentUserId;
    }
  }, [session?.user?.id]);

  useEffect(() => {
    const userId = session?.user?.id as string | undefined;
    const requestId = profileLoadGuard.begin();
    setTab("schedule");
    setMobileNav(false);
    setProfile(null);
    setProfileError("");
    dispatchDashboardState({ type: "clear-member-data" });
    if (!userId || !supabase) return;
    void loadProfile(userId, requestId);
    return () => {
      if (profileLoadGuard.isCurrent(requestId)) profileLoadGuard.invalidate();
    };
  },[session?.user?.id]);

  useEffect(()=>{
    document.documentElement.dataset.theme=theme;
    const themeColor=document.querySelector('meta[name="theme-color"]');
    themeColor?.setAttribute("content",theme==="dark"?"#101727":"#171d35");
    try { window.localStorage.setItem("gms-sound-theme",theme); } catch {}
  },[theme]);

  const toggleTheme=()=>setTheme(current=>current==="dark"?"light":"dark");

  async function loadProfile(userId: string, requestId: number) {
    if (!supabase) return;
    try {
      const {data,error} = await loadMemberAccountProfile(supabase,userId);
      if (!profileLoadGuard.isCurrent(requestId)) return;
      if (error) {
        setProfileError(errorText(error));
        return;
      }
      if (!data) {
        setProfileError("Your GMS account profile could not be found. Please retry or sign out and contact an administrator.");
        return;
      }
      setProfileError("");
      setProfile(data as Profile);
    } catch (error) {
      if (profileLoadGuard.isCurrent(requestId)) setProfileError(errorText(error));
    }
  }

  const memberProfileActions = useMemberProfileActions({
    client: supabase,
    userId: session?.user?.id,
    currentEmail: memberProfile?.email,
    loadData,
    setMessage
  });

  const authenticationActions = useAuthenticationActions({
    client: supabase,
    mode: authMode,
    setMode: setAuthMode,
    setAuthLoading,
    setMessage,
    setRecoveryMode
  });

  useEffect(()=>{if(profile) void loadData();},[profile]);

  async function installGmsApp(){
    if(installPrompt){try{await installPrompt.prompt();await installPrompt.userChoice;}catch(e){console.warn("PWA install prompt was not completed",e);}finally{clearInstallPrompt();}return;}
    const ua=navigator.userAgent.toLowerCase();
    const ios=/iphone|ipad|ipod/.test(ua)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
    const message=ios?"On your iPhone, open this page in Safari, tap Share, choose Add to Home Screen, turn on Open as Web App, then tap Add. If Add to Home Screen is missing, scroll to Edit Actions and enable it. Open GMS from the new Home Screen icon before enabling notifications.":"To install Sound Scheduling: open your browser menu and choose Install app or Add to Home Screen. If the install option is not shown, refresh the page once and try again.";
    await askAction("Install app",message,"Got it",false);
  }

  async function signOut(){
    const userId=session?.user?.id;
    invalidateDashboardLoad();
    const pushCleanup = pushActions.cleanupForSignOut(userId);
    setTab("schedule");setMobileNav(false);
    await pushCleanup;

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
      setProfile(null);
      setSession(null);
      dispatchDashboardState({ type: "clear-member-data" });
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
  // Statistics has its own stable scope; Schedule-page search and filters are local to that page.
  const statisticsSchedules = useMemo(
    () => schedules.filter(schedule =>
      schedule.status === "published" && schedule.service_date >= today()
    ),
    [schedules]
  );
  const scheduleExportActions = useScheduleExportActions({
    client: supabase,
    isAdmin,
    filteredSchedules: scheduleWorkspace.filtered,
    setMessage
  });
  const requestActions = useRequestActions({
    client: supabase,
    isAdmin,
    schedules,
    requests,
    myServant,
    sessionUserId: session?.user?.id,
    swapDraft,
    setSwapDraft,
    setRequestReads,
    askText,
    loadData,
    setMessage
  });
  const notificationActions = useNotificationActions({
    client: supabase,
    sessionUserId: session?.user?.id,
    setNotificationPrefs,
    setNotifications,
    setMessage
  });
  const auditActions = useAuditActions({
    client: supabase,
    isAdmin,
    setMessage
  });

  const availabilityActions = useAvailabilityActions({
    client: supabase, isAdmin, servants, sessionUserId: session?.user?.id,
    availability, availabilityRules, servingPreferences, schedules, deadline: availabilityDeadline,
    loadData, setLoading, setMessage, setScheduleError, setAvailabilityDeadline
  });
  const servantActions = useServantActions({
    client: supabase,
    isAdmin,
    loadData,
    setLoading,
    setMessage,
    setScheduleError,
    setModal
  });

  const assignmentConfirmationActions = useAssignmentConfirmationActions({
    client: supabase,
    sessionUserId: session?.user?.id,
    myServant,
    requests,
    askText,
    loadData,
    setMessage,
  });


  if(!isSupabaseConfigured)return <SupabaseSetupScreen/>;
  if(authLoading)return <div className="center-screen"><GmsLoader label={authMode==="reset"?"Preparing secure password recovery…":"Preparing your workspace…"}/></div>;
  if(recoveryMode && session)return <PasswordRecoveryScreen loading={authLoading} message={message} onSubmit={authenticationActions.updateRecoveredPassword}/>;
  if(!session)return <AuthScreen mode={authMode} loading={authLoading} message={message} signupCgStatus={signupCgStatus} onModeChange={setAuthMode} onSignupCgStatusChange={setSignupCgStatus} onClearMessage={()=>setMessage("")} onResetSignupCgStatus={()=>setSignupCgStatus("")} onSubmitAuth={authenticationActions.submitAuth} onSendPasswordReset={authenticationActions.sendPasswordReset}/>;
  if(!profile)return profileError
    ? <div className="center-screen"><section className="auth-card" role="alert" aria-live="polite">
        <h2>We couldn't load your profile</h2><p className="subtle">{profileError}</p>
        <div className="toolbar-actions">
          <button className="btn primary" onClick={() => {
            const requestId = profileLoadGuard.begin();
            setProfileError("");
            void loadProfile(session.user.id, requestId);
          }}>Retry</button>
          <button className="btn secondary" onClick={() => void signOut()}>Sign out</button>
        </div>
      </section></div>
    : <div className="center-screen"><GmsLoader label="Loading your profile…"/></div>;

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
    {modal==="person"&&<AddServantDialog onClose={()=>setModal(null)} onSave={servantActions.savePerson}/>}
    {swapDraft&&<DirectSwapModal source={swapDraft} schedules={schedules} servantId={myServant?.id??""} onClose={()=>setSwapDraft(null)} onSubmit={requestActions.submitDirectSwap}/>}
        </>
      }
    >

        {!isAdmin&&memberProfile?.last_verified_at&&((Date.now()-new Date(memberProfile.last_verified_at).getTime())>90*86400000)&&<div className="message-banner profile-reminder"><span><b>Profile verification reminder:</b> Please review your member information. It has been more than 3 months since your last verification.</span><button className="btn tiny secondary" onClick={()=>setTab("profile")}>Review profile</button></div>}{message&&<div className="message-banner app-message-banner" role="status" aria-live="polite"><span>{message}</span><button className="icon-btn" aria-label="Dismiss message" onClick={()=>setMessage("")}><X size={16}/></button></div>}{!isOnline&&<div className="offline-status-banner"><WifiOff size={16}/>You are offline. Schedule data is not refreshed or saved for offline use; reconnect before making assignment changes.</div>}
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
          onExportCsv={scheduleExportActions.exportCsv} onExportScheduleHistory={scheduleExportActions.exportScheduleHistory}
          onConfirmAssignment={assignmentConfirmationActions.confirmAssignment} onSubmitServingRequest={requestActions.submitServingRequest}
        />:tab==="servantInfo"?<ServantInformationPanel isAdmin={isAdmin} servants={servants} memberDirectory={memberDirectory} accountCandidates={servantAccountCandidates} locations={locations} schedules={schedules} requests={requests} onAdd={()=>setModal("person")} onToggle={servantActions.togglePerson} onLink={servantActions.linkServantAccount}/>:tab==="inbox"&&!isAdmin?<ServantInbox requests={requests.filter(r=>r.requester_servant_id===myServant?.id)} schedules={schedules} reads={requestReads} onRead={requestActions.markRequestRead} notifications={notifications.filter(n=>n.recipient_user_id===session?.user?.id)} notificationSettings={<PushNotificationSettings enabled={pushActions.pushEnabled} busy={pushActions.pushBusy} onEnable={pushActions.enablePushNotifications} onDisable={pushActions.disablePushNotifications} preferences={notificationPrefs} onSavePreferences={notificationActions.saveNotificationPreferences}/>} onNotificationRead={notificationActions.markNotificationRead}/>:tab==="requests"&&isAdmin?<RequestsPanel requests={requests} schedules={schedules} servants={servants} onReview={requestActions.reviewRequest} onResolve={requestActions.resolveReplacement} notifications={notifications.filter(n=>n.recipient_user_id===session?.user?.id)} notificationSettings={<PushNotificationSettings enabled={pushActions.pushEnabled} busy={pushActions.pushBusy} onEnable={pushActions.enablePushNotifications} onDisable={pushActions.disablePushNotifications} preferences={notificationPrefs} onSavePreferences={notificationActions.saveNotificationPreferences}/>} onNotificationRead={notificationActions.markNotificationRead}/>:tab==="availability"?<AvailabilityWorkspace servants={servants} availability={availability} rules={availabilityRules} preferences={servingPreferences} locations={locations} schedules={schedules} templates={templates} isAdmin={isAdmin} currentUserId={session.user.id} onSave={availabilityActions.saveAvailability} onBulkSave={availabilityActions.saveBulkAvailability} onSaveRule={availabilityActions.saveAvailabilityRule} onSavePreference={availabilityActions.saveServingPreference} onDeletePreference={availabilityActions.deleteServingPreference} onDeleteRule={async(id)=>{const ok=await askAction("Delete recurring restriction?","Future dates generated by this rule will no longer be treated as unavailable. Existing dated availability records will remain unchanged.","Delete rule",true);if(ok)await availabilityActions.deleteAvailabilityRule(id);}} onDelete={availabilityActions.deleteAvailability} deadline={availabilityDeadline} onSaveDeadline={availabilityActions.saveDeadline}/>:tab==="statistics"?<StatisticsPanel schedules={statisticsSchedules} servants={servants}/>:tab==="audit"?<AuditPanel logs={auditLogs} onDownload={auditActions.exportAuditHistory}/>:(!isAdmin&&tab==="profile")?<MemberProfilePanel profile={memberProfile} isAdmin={false} directory={[]} onSave={memberProfileActions.saveProfile}/>:null}
      </AppLayout>
  );
}

