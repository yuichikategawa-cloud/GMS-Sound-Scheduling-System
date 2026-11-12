import { lazy, Suspense } from "react";
import { BarChart3, CalendarDays, Users, Plus, Download, Search, ChevronDown } from "lucide-react";
import "./ScheduleWorkspace.css";
import type { Location, ScheduleView, Servant } from "../../../types";
import type { ScheduleWorkspaceState } from "../hooks/useScheduleWorkspace";
import type { MonthlyPlanApplyInput } from "../services/schedulePersistence";
const AssignmentOverview = lazy(() => import("./ScheduleManagementPanels").then((module) => ({ default: module.AssignmentOverview })));
const BulkAssignmentCenter = lazy(() => import("./ScheduleManagementPanels").then((module) => ({ default: module.BulkAssignmentCenter })));
const ChurchBulkActions = lazy(() => import("./ScheduleManagementPanels").then((module) => ({ default: module.ChurchBulkActions })));
const GeneratePanel = lazy(() => import("./ScheduleManagementPanels").then((module) => ({ default: module.GeneratePanel })));
const DailySummary = lazy(() => import("./ScheduleDisplayComponents").then((module) => ({ default: module.DailySummary })));
const MyScheduleSummary = lazy(() => import("./ScheduleDisplayComponents").then((module) => ({ default: module.MyScheduleSummary })));
const MyUpcomingAssignments = lazy(() => import("./ScheduleDisplayComponents").then((module) => ({ default: module.MyUpcomingAssignments })));
const MonthlySmartScheduler = lazy(() => import("./MonthlySmartScheduler"));

type ScheduleWorkspaceProps = {
  workspace: ScheduleWorkspaceState;
  isAdmin: boolean;
  schedules: ScheduleView[];
  requests: any[];
  servants: Servant[];
  availability: any[];
  preferences: any[];
  scheduleGenerationErrors: string[];
  locations: Location[];
  templates: any[];
  loading: boolean;
  myServant: Servant | undefined;
  aiWorkerUrl?: string;
  aiAccessToken?: string;
  onOpenNewSchedule: () => void;
  onAddLocation: () => void;
  onAddRecurringTemplate: () => void;
  onPublishLocation: (locationId: string) => void;
  onUnpublishLocation: (locationId: string) => void;
  onDeleteLocationSchedules: (locationId: string) => void;
  onApplyBulkAssignments: (rows: any[]) => Promise<boolean>;
  onApplyMonthlyPlan: (input: MonthlyPlanApplyInput) => Promise<boolean>;
  onEditSchedule: (schedule: ScheduleView) => void;
  onPublishSchedule: (schedule: ScheduleView) => void;
  onDeleteSchedule: (schedule: ScheduleView) => void;
  onGenerate: (date: string, weeks: number, templateIds: string[], mode: "add" | "replace") => void;
  onAddTemplate: (locationId: string, day: number, name: string, start: string, end: string) => Promise<void>;
  onDeleteTemplate: (template: any) => Promise<void>;
  onExportCsv: () => void;
  onExportScheduleHistory: () => void;
  onConfirmAssignment: (schedule: ScheduleView, status: "confirmed" | "declined") => void;
  onSubmitServingRequest: (schedule: ScheduleView, kind: "replacement" | "swap") => void;
};

export default function ScheduleWorkspace({
  workspace, isAdmin, schedules, requests, servants, availability, preferences,
  scheduleGenerationErrors, locations, templates, loading, myServant, aiWorkerUrl, aiAccessToken, onOpenNewSchedule,
  onAddLocation, onAddRecurringTemplate, onPublishLocation, onUnpublishLocation,
  onDeleteLocationSchedules, onApplyBulkAssignments, onApplyMonthlyPlan, onEditSchedule,
  onPublishSchedule, onDeleteSchedule, onGenerate, onAddTemplate,
  onDeleteTemplate, onExportCsv, onExportScheduleHistory,
  onConfirmAssignment, onSubmitServingRequest
}: ScheduleWorkspaceProps) {
  const {
    adminScheduleView, setAdminScheduleView,
    calendarView, setCalendarView,
    personFilter, setPersonFilter,
    locationFilter, setLocationFilter,
    serviceFilter, setServiceFilter,
    fromDate, setFromDate,
    toDate, setToDate,
    myDaysServed, nextMySchedule, myUpcomingSchedules,
    dailyGroups, calendarSections
  } = workspace;
  const clearFilters = () => {
    setPersonFilter("");
    setLocationFilter("");
    setServiceFilter("");
    setFromDate("");
    setToDate("");
  };

  return (
    <Suspense fallback={<div className="workspace-loading"><span className="spinner" aria-hidden="true"/>Loading schedule tools…</div>}>
    <>
      {!isAdmin && <MyScheduleSummary daysServed={myDaysServed} upcoming={nextMySchedule} servantId={myServant?.id ?? ""}/>}
      {!isAdmin && <MyUpcomingAssignments items={myUpcomingSchedules} servantId={myServant?.id ?? ""} onConfirm={onConfirmAssignment} onRequest={onSubmitServingRequest}/>}
      {isAdmin ? (
        <>
          <div className="toolbar schedule-page-heading"><div><h2>Schedule management</h2><p className="subtle">Manage coverage, servant assignments and service calendars across all church locations.</p></div></div>
          <div className="schedule-workspace-tabs" role="tablist" aria-label="Schedule workspace">
            <button type="button" role="tab" aria-selected={adminScheduleView === "overview"} className={adminScheduleView === "overview" ? "selected" : ""} onClick={() => setAdminScheduleView("overview")}><BarChart3 size={16}/> Overview</button>
            <button type="button" role="tab" aria-selected={adminScheduleView === "assignments"} className={adminScheduleView === "assignments" ? "selected" : ""} onClick={() => setAdminScheduleView("assignments")}><Users size={16}/> Assignments</button>
            <button type="button" role="tab" aria-selected={adminScheduleView === "calendar"} className={adminScheduleView === "calendar" ? "selected" : ""} onClick={() => setAdminScheduleView("calendar")}><CalendarDays size={16}/> Calendar</button>
          </div>
          {adminScheduleView === "overview" && <section className="schedule-workspace-panel" role="tabpanel" aria-label="Schedule overview">
            <AssignmentOverview schedules={schedules} requests={requests} servants={servants} availability={availability}/>
          </section>}
          {adminScheduleView === "assignments" && <section className="schedule-workspace-panel" role="tabpanel" aria-label="Assignment management">
            <div className="toolbar assignment-workspace-heading">
              <div><h2>Assignment management</h2><p className="subtle">Create services, manage church-wide actions and assign servants across multiple services.</p></div>
              <div className="toolbar-actions assignment-management-actions">
                <button className="btn primary" onClick={onOpenNewSchedule}><Plus size={16}/> Add special service</button>
                <button className="btn secondary" onClick={onAddLocation}><Plus size={16}/> Add church</button>
                <button className="btn secondary" onClick={onAddRecurringTemplate}><Plus size={16}/> Add recurring service</button>
              </div>
            </div>
            <ChurchBulkActions locations={locations} disabled={loading} onPublish={onPublishLocation} onUnpublish={onUnpublishLocation} onDelete={onDeleteLocationSchedules}/>
            <BulkAssignmentCenter schedules={schedules} servants={servants} availability={availability} preferences={preferences} disabled={loading} onApply={onApplyBulkAssignments} onEditSchedule={onEditSchedule} onPublishSchedule={onPublishSchedule} onDeleteSchedule={onDeleteSchedule}/>
            <MonthlySmartScheduler locations={locations} templates={templates} schedules={schedules} servants={servants} availability={availability} preferences={preferences} requests={requests} inputErrors={scheduleGenerationErrors} aiWorkerUrl={aiWorkerUrl} aiAccessToken={aiAccessToken} onApplyPlan={onApplyMonthlyPlan}/>
            <GeneratePanel templates={templates} locations={locations} onGenerate={onGenerate} onAddTemplate={onAddTemplate} onDeleteTemplate={onDeleteTemplate}/>
          </section>}
          {adminScheduleView === "calendar" && <section className="schedule-workspace-panel" role="tabpanel" aria-label="Schedule calendar">
            <div className="toolbar calendar-workspace-heading">
              <div><h2>Schedule calendar</h2><p className="subtle">Browse the daily schedule by church. Use Assignments to edit, publish or remove individual services.</p></div>
              <div className="toolbar-actions">
                <button className="btn secondary" onClick={onExportCsv}><Download size={16}/> Export</button>
                <button className="btn secondary" onClick={() => void onExportScheduleHistory()}><Download size={16}/> History CSV</button>
              </div>
            </div>
            <div className="calendar-switch"><span>Calendar grouping</span><button className={calendarView === "week" ? "selected" : ""} onClick={() => setCalendarView("week")}>Weekly</button><button className={calendarView === "month" ? "selected" : ""} onClick={() => setCalendarView("month")}>Monthly</button></div>
            <details className="filter-panel filter-panel-collapsible" open>
              <summary className="filter-title"><span><Search size={17}/> <b>Filter schedule</b></span><ChevronDown size={18}/></summary>
              <div className="filters">
                <label className="search-field"><span>Servant name · any role</span><input value={personFilter} onChange={event => setPersonFilter(event.target.value)} placeholder="Search servant name"/></label>
                <label><span>Church location</span><select value={locationFilter} onChange={event => setLocationFilter(event.target.value)}><option value="">All locations</option>{locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
                <label><span>Service</span><select value={serviceFilter} onChange={event => setServiceFilter(event.target.value)}><option value="">All services</option>{[...new Set(schedules.map(schedule => schedule.service_name))].sort().map(name => <option key={name}>{name}</option>)}</select></label>
                <label><span>From</span><input type="date" value={fromDate} onChange={event => setFromDate(event.target.value)}/></label>
                <label><span>To</span><input type="date" value={toDate} onChange={event => setToDate(event.target.value)}/></label>
              </div>
              <button className="clear-btn" onClick={clearFilters}>Clear all filters</button>
            </details>
            <details className="collapsible-panel">
              <summary><span><b>{calendarView === "week" ? "Weekly calendar" : "Monthly calendar"} · Daily overview</b><small>{dailyGroups.length} days · summary by church location</small></span><ChevronDown size={20}/></summary>
              {calendarSections.length > 0 ? calendarSections.map(section => <section className="calendar-period" key={section.key}><h3>{section.label}</h3><div className="daily-overview">{section.groups.map(group => <DailySummary key={group.date} date={group.date} items={group.items} isAdmin={isAdmin}/>)}</div></section>) : <div className="empty-state"><b>No published schedules match these filters.</b><p>Draft and unpublished schedules remain available in Assignment management.</p></div>}
            </details>
          </section>}
        </>
      ) : (
        <>
          <div className="toolbar"><div><h2>All published schedules</h2><p className="subtle">Browse published serving assignments across all church locations.</p></div><div className="toolbar-actions serving-toolbar-actions"><button className="btn secondary" onClick={onExportCsv}><Download size={16}/> Export</button></div></div>
          <div className="calendar-switch servant-calendar-switch" role="group" aria-label="Calendar grouping">
            <span>Calendar view</span>
            <button type="button" className={calendarView === "week" ? "selected" : ""} aria-pressed={calendarView === "week"} onClick={() => setCalendarView("week")}>Weekly</button>
            <button type="button" className={calendarView === "month" ? "selected" : ""} aria-pressed={calendarView === "month"} onClick={() => setCalendarView("month")}>Monthly</button>
          </div>
          <details className="filter-panel filter-panel-collapsible" open>
            <summary className="filter-title"><span><Search size={17}/> <b>Filter schedule</b></span><ChevronDown size={18}/></summary>
            <div className="filters">
              <label className="search-field"><span>Servant name · any role</span><input value={personFilter} onChange={event => setPersonFilter(event.target.value)} placeholder="Search servant name"/></label>
              <label><span>Church location</span><select value={locationFilter} onChange={event => setLocationFilter(event.target.value)}><option value="">All locations</option>{locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
              <label><span>Service</span><select value={serviceFilter} onChange={event => setServiceFilter(event.target.value)}><option value="">All services</option>{[...new Set(schedules.map(schedule => schedule.service_name))].sort().map(name => <option key={name}>{name}</option>)}</select></label>
            <label><span>From</span><input type="date" value={fromDate} onChange={event => setFromDate(event.target.value)}/></label>
                <label><span>To</span><input type="date" value={toDate} onChange={event => setToDate(event.target.value)}/></label>
              </div>
              <button className="clear-btn" onClick={clearFilters}>Clear all filters</button>
            </details>
            <details className="collapsible-panel">
              <summary><span><b>{calendarView === "week" ? "Weekly calendar" : "Monthly calendar"} · Daily overview</b><small>{dailyGroups.length} days · summary by church location</small></span><ChevronDown size={20}/></summary>
              {calendarSections.length > 0 ? calendarSections.map(section => <section className="calendar-period" key={section.key}><h3>{section.label}</h3><div className="daily-overview">{section.groups.map(group => <DailySummary key={group.date} date={group.date} items={group.items} isAdmin={false}/>)}</div></section>) : <div className="empty-state"><b>No published schedules match these filters.</b><p>Try clearing or adjusting the filters.</p></div>}
          </details>
        </>
      )}
    </>
    </Suspense>
  );
}
