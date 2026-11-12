import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Clock3, WandSparkles } from "lucide-react";
import type { Location, Role, ScheduleView, Servant, ServiceTemplate } from "../../../types";
import type { AvailabilityRecord } from "../../availability/services/recurringAvailability";
import type { ServingPreferenceRecord } from "../../availability/services/availabilityData";
import type { ServingRequestRecord } from "../../requests/services/requestData";
import { buildMonthlyScheduleSlots } from "../services/monthlyScheduleGeneration";
import {
  getMonthlyAssignmentCandidates,
  optimizeMonthlyAssignments,
  type MonthlyAssignmentOptimizerResult,
  type MonthlyGeneratedAssignment,
  type MonthlyUnfilledPosition,
} from "../services/monthlyAssignmentOptimizer";
import type { MonthlyScheduleSlot, MonthlySpecialServiceInput } from "../services/monthlyScheduleGeneration";
import { mapHistoricalRosterProfiles } from "../services/historicalRosterProfiles";
import type { MonthlyPlanApplyInput, MonthlyPlanAssignment, MonthlyPlanExpectedSlot } from "../services/schedulePersistence";
import { fmtDate } from "../../../shared/formatters";
import { buildAiSchedulingSnapshot, requestAiSchedulingExplanation } from "../services/aiSchedulingAssistant";
import {
  applyMonthlyServingTeamAssignments,
  buildMonthlyServingTeamGroups,
  buildMonthlyServingTeamWeeks,
  type MonthlyServingTeamGroup,
  type MonthlyServingTeamPattern,
} from "../services/monthlyServingTeams";
import "./MonthlySmartScheduler.css";

type SuccessfulOptimizerResult = Extract<MonthlyAssignmentOptimizerResult, { ok: true }>;
type ManualOverrides = Record<string, Partial<Record<Role, string>>>;

type PreviewData = {
  baseSlots: MonthlyScheduleSlot[];
  slots: MonthlyScheduleSlot[];
  result: SuccessfulOptimizerResult;
  manualOverrides: ManualOverrides;
  teamGroups: MonthlyServingTeamGroup[];
  teamWarnings: string[];
};

type MonthlySmartSchedulerProps = {
  locations: Location[];
  templates: ServiceTemplate[];
  schedules: ScheduleView[];
  servants: Servant[];
  availability: AvailabilityRecord[];
  preferences: ServingPreferenceRecord[];
  requests: ServingRequestRecord[];
  inputErrors: string[];
  onApplyPlan: (input: MonthlyPlanApplyInput) => Promise<boolean>;
  aiWorkerUrl?: string;
  aiAccessToken?: string;
};

const ROLES: Role[] = ["FOH", "Monitor", "Assistant"];

function applicableSlotsForApply(preview: PreviewData): MonthlyScheduleSlot[] {
  const frozen = new Set(preview.result.frozenScheduleKeys);
  return preview.baseSlots.filter((slot) => !frozen.has(slot.key));
}

function applyManualOverrides(
  baseSlots: readonly MonthlyScheduleSlot[],
  overrides: ManualOverrides,
  servants: readonly Servant[],
): MonthlyScheduleSlot[] {
  const servantNames = new Map(servants.map((servant) => [servant.id, servant.full_name]));
  return baseSlots.map((slot) => {
    const selected = overrides[slot.key] ?? {};
    const additions = ROLES.flatMap((role) => {
      const servantId = selected[role];
      if (!servantId || slot.assignments.some((assignment) => assignment.role === role)) {
        return [];
      }
      const servantName = servantNames.get(servantId);
      if (!servantName) return [];
      return [{
        role,
        servant_id: servantId,
        servant_name: servantName,
        confirmation_status: "pending",
        preview_manual: true,
      }];
    });
    return additions.length ? { ...slot, assignments: [...slot.assignments, ...additions] } : slot;
  });
}

function nextMonthKey(): string {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() + 1);
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0");
}


function reasonLabel(reason: MonthlyUnfilledPosition["reason"]): string {
  const labels: Record<MonthlyUnfilledPosition["reason"], string> = {
    published_service: "Published service · review manually",
    pending_request: "Pending swap/replacement · resolve first",
    preexisting_conflict: "Existing assignment has a hard conflict",
    declined_assignment: "Assigned servant declined · review or replace manually",
    no_active_servants: "No active servants in the directory",
    no_auto_assignable_servants: "No servants eligible for automatic assignment",
    unavailable: "All candidates marked unavailable",
    serving_preference: "Saved serving restrictions exclude candidates",
    cross_church_conflict: "Candidates already assigned at another church",
    consecutive_day_conflict: "Candidates served on the previous or next calendar day",
    daily_service_limit: "Candidates already have four services on this day",
    overlapping_service: "Candidates have overlapping services",
    serving_restriction: "Availability and serving restrictions exclude candidates",
    no_eligible_candidate: "No eligible candidate remains",
    role_not_qualified: "No servant is qualified for this role",
  };
  return labels[reason];
}

function GeneratedOrExistingRole({
  slot,
  role,
  generated,
  unfilled,
  includeAssistant,
  candidateOptions,
  servants,
  onManualChange,
}: {
  slot: MonthlyScheduleSlot;
  role: Role;
  generated: MonthlyGeneratedAssignment | undefined;
  unfilled: MonthlyUnfilledPosition | undefined;
  includeAssistant: boolean;
  candidateOptions: Servant[];
  servants: Servant[];
  onManualChange: (servantId: string) => void;
}) {
  const selected = slot.assignments.find((assignment) => assignment.role === role);
  if (selected && !selected.preview_manual && !selected.preview_team) {
    return (
      <div className="monthly-role-value is-locked">
        <b>{selected.servant_name}</b>
        <small><span className="monthly-lock-dot"/> Preserved · {selected.confirmation_status === "declined" ? "declined" : "locked"}</small>
      </div>
    );
  }
  if (role === "Assistant" && !includeAssistant && !selected && !generated) {
    return <div className="monthly-role-value is-optional"><b>Not included</b><small>Optional role</small></div>;
  }

  const selectedId = selected?.servant_id ?? generated?.servant_id ?? "";
  const selectedName = selected?.servant_name ?? generated?.servant_name ?? "";
  const options = [...candidateOptions];
  if (selectedId && !options.some((servant) => servant.id === selectedId)) {
    const current = servants.find((servant) => servant.id === selectedId);
    if (current) options.unshift(current);
  }

  return (
    <div className="monthly-role-value">
      <b>{selectedName || "Unfilled"}</b>
      <small className={selected?.preview_manual ? "is-manual" : generated || selected?.preview_team ? "is-generated" : "is-unfilled"}>
        {selected?.preview_manual
          ? "Manual selection · preview only"
          : selected?.preview_team
          ? "Shared serving team · preview only"
          : generated
          ? "Auto-generated · preview only"
          : unfilled
          ? reasonLabel(unfilled.reason)
          : "No candidate selected"}
      </small>
      <select
        className="monthly-role-select"
        aria-label={slot.service_name + " " + role + " candidate"}
        value={selectedId}
        onChange={(event) => onManualChange(event.target.value)}
      >
        <option value="">Auto assign / clear manual selection</option>
        {options.map((servant) => (
          <option key={servant.id} value={servant.id}>{servant.full_name}</option>
        ))}
      </select>
    </div>
  );
}

export default function MonthlySmartScheduler({
  locations,
  templates,
  schedules,
  servants,
  availability,
  preferences,
  requests,
  inputErrors,
  onApplyPlan,
  aiWorkerUrl,
  aiAccessToken,
}: MonthlySmartSchedulerProps) {
  const [month, setMonth] = useState(nextMonthKey);
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
  const [includeAssistant, setIncludeAssistant] = useState(true);
  const [specialServices, setSpecialServices] = useState<MonthlySpecialServiceInput[]>([]);
  const [specialServiceMode, setSpecialServiceMode] = useState<"single" | "lineup">("single");
  const [specialServiceLineupDay, setSpecialServiceLineupDay] = useState(0);
  const [specialServiceDate, setSpecialServiceDate] = useState(nextMonthKey() + "-25");
  const [specialServiceLocation, setSpecialServiceLocation] = useState("");
  const [specialServiceName, setSpecialServiceName] = useState("");
  const [specialServiceStart, setSpecialServiceStart] = useState("10:00");
  const [specialServiceEnd, setSpecialServiceEnd] = useState("12:00");
  const [teamPatternOverrides, setTeamPatternOverrides] = useState<Record<string, MonthlyServingTeamPattern>>({});
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [error, setError] = useState("");
  const [acknowledgedPreferNot, setAcknowledgedPreferNot] = useState(false);
  const [applying, setApplying] = useState(false);
  const [aiExplanation, setAiExplanation] = useState("");
  const [aiError, setAiError] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiCached, setAiCached] = useState(false);
  const initializedLocations = useRef(false);

  useEffect(() => {
    if (!locations.length) return;
    if (!initializedLocations.current) {
      setSelectedLocationIds(locations.map((location) => location.id));
      initializedLocations.current = true;
      return;
    }
    setSelectedLocationIds((current) =>
      current.filter((id) => locations.some((location) => location.id === id))
    );
  }, [locations]);

  useEffect(() => {
    if (!selectedLocationIds.length) {
      setSpecialServiceLocation("");
      return;
    }
    if (!selectedLocationIds.includes(specialServiceLocation)) {
      setSpecialServiceLocation(selectedLocationIds[0]);
    }
  }, [selectedLocationIds, specialServiceLocation]);

  const specialServiceLineupTemplates = useMemo(() => templates
    .filter((template) => template.location_id === specialServiceLocation && template.active !== false && Number(template.day_of_week) === specialServiceLineupDay)
    .slice()
    .sort((a, b) => a.start_time.localeCompare(b.start_time) || a.service_name.localeCompare(b.service_name)),
  [templates, specialServiceLocation, specialServiceLineupDay]);

  const teamPatternWeeks = useMemo(() => buildMonthlyServingTeamWeeks({
    month,
    locations,
    templates,
    selectedLocationIds,
  }), [month, locations, templates, selectedLocationIds]);

  const patternsByWeek = useMemo(() => Object.fromEntries(teamPatternWeeks.map((week) => [
    week.key,
    teamPatternOverrides[week.key] ?? week.defaultPattern,
  ])) as Record<string, MonthlyServingTeamPattern>, [teamPatternWeeks, teamPatternOverrides]);

  const specialServiceDateMax = useMemo(() => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return undefined;
    const [year, monthNumber] = month.split("-").map(Number);
    const lastDay = new Date(year, monthNumber, 0).getDate();
    return month + "-" + String(lastDay).padStart(2, "0");
  }, [month]);

  const historicalRoster = useMemo(
    () => mapHistoricalRosterProfiles(servants),
    [servants],
  );

  const pendingRequestScheduleIds = useMemo(() => {
    const ids = new Set<string>();
    for (const request of requests) {
      if (request.status !== "pending") continue;
      if (request.schedule_id) ids.add(request.schedule_id);
      if (request.target_schedule_id) ids.add(request.target_schedule_id);
    }
    return [...ids];
  }, [requests]);

  const unmatchedManualOnly = historicalRoster.unmatchedManualOnlyNames;
  const unmatchedHistorical = historicalRoster.unmatchedHistoricalNames;
  const ambiguousManualOnlyServants = historicalRoster.ambiguousManualOnlyServantIds.map((id) => {
    const servant = servants.find((item) => item.id === id);
    return servant ? `${servant.full_name} (${id})` : id;
  });
  const canReview = !inputErrors.length && selectedLocationIds.length > 0 && Boolean(month);

  const runOptimizer = (baseSlots: MonthlyScheduleSlot[], manualOverrides: ManualOverrides) => {
    const slots = applyManualOverrides(baseSlots, manualOverrides, servants);
    const optimizerInput = {
      servants,
      availability,
      preferences,
      schedules,
      historicalProfiles: historicalRoster.profiles,
      autoAssignmentExcludedServantIds: historicalRoster.autoAssignmentExcludedServantIds,
      includeAssistant,
      dataErrors: inputErrors,
    };
    const baseline = optimizeMonthlyAssignments({ ...optimizerInput, slots });
    if (!baseline.ok) return { slots, result: baseline, teamGroups: [], teamWarnings: [] };

    const teamGroups = buildMonthlyServingTeamGroups({ slots, locations, patternsByWeek });
    const teamPlan = applyMonthlyServingTeamAssignments({
      optimizerInput,
      slots,
      baseline,
      groups: teamGroups,
    });
    const result = teamPlan.assignedGroupCount
      ? optimizeMonthlyAssignments({ ...optimizerInput, slots: teamPlan.slots })
      : baseline;
    return {
      slots: teamPlan.slots,
      result,
      teamGroups,
      teamWarnings: teamPlan.warnings,
    };
  };

  const generatePreview = () => {
    setError("");
    setPreview(null);
    setAiExplanation("");
    setAiError("");
    setAiCached(false);
    setAcknowledgedPreferNot(false);

    const built = buildMonthlyScheduleSlots({
      month,
      locationIds: selectedLocationIds,
      templates,
      existingSchedules: schedules,
      specialServices,
      pendingRequestScheduleIds,
      dataErrors: inputErrors,
    });
    if (!built.ok) {
      const reasonMessages: Record<typeof built.reason, string> = {
        invalid_month: "Choose a valid month.",
        select_location: "Select at least one church location.",
        data_unavailable: "Required scheduling data could not be loaded. Refresh the GMS workspace and retry.",
        no_weekend_templates: "No active weekend templates or one-off services exist for this month and selection.",
        invalid_special_service: "A one-off service has an invalid date, location, name or time range, or duplicates another service.",
        duplicate_existing_slot: "Duplicate existing services share the same date, church and service name. Resolve these duplicates before generating.",
      };
      setError(reasonMessages[built.reason] + (built.errors?.length ? " " + built.errors.join(" · ") : ""));
      return;
    }

    const manualOverrides: ManualOverrides = {};
    const optimized = runOptimizer(built.slots, manualOverrides);
    if (!optimized.result.ok) {
      setError(
        optimized.result.reason === "data_unavailable"
          ? "Required scheduling data could not be loaded. Generation stopped safely."
          : optimized.result.reason === "no_service_slots"
          ? "No service slots were available to optimize."
          : "The final allocation validation failed. No plan was created.",
      );
      return;
    }

    setAiExplanation("");
    setAiError("");
    setAiCached(false);
    setPreview({
      baseSlots: built.slots,
      slots: optimized.slots,
      result: optimized.result,
      manualOverrides,
      teamGroups: optimized.teamGroups,
      teamWarnings: optimized.teamWarnings,
    });
  };

  const applyReviewedPlan = async () => {
    if (!preview || applying || inputErrors.length) return;
    setError("");

    const frozenKeys = new Set(preview.result.frozenScheduleKeys);
    const applicableSlots = preview.baseSlots.filter((slot) => !frozenKeys.has(slot.key));
    if (!applicableSlots.length) {
      setError("Every selected service is frozen or skipped. Resolve those services manually before applying a monthly plan.");
      return;
    }

    const expectedState: MonthlyPlanExpectedSlot[] = [];
    for (const slot of applicableSlots) {
      const persistedAssignments = slot.assignments.filter((assignment) => !assignment.preview_manual);
      if (persistedAssignments.some((assignment) => !assignment.id)) {
        setError("An existing assignment is missing its database ID. Refresh the workspace and generate a new preview before applying.");
        return;
      }
      expectedState.push({
        template_id: slot.template_id,
        schedule_id: slot.schedule_id,
        service_date: slot.service_date,
        location_id: slot.location_id,
        service_name: slot.service_name,
        start_time: slot.start_time,
        end_time: slot.end_time,
        expected_status: slot.schedule_id ? "draft" : slot.status === "new_special" ? "new_special" : "new",
        assignments: persistedAssignments.map((assignment) => ({
          id: assignment.id!,
          role: assignment.role,
          servant_id: assignment.servant_id,
          confirmation_status: assignment.confirmation_status === "confirmed" ||
              assignment.confirmation_status === "declined"
            ? assignment.confirmation_status
            : "pending",
        })),
      });
    }

    const applicableKeys = new Set(applicableSlots.map((slot) => slot.key));
    const assignments: MonthlyPlanAssignment[] = preview.result.assignments
      .filter((assignment) => applicableKeys.has(assignment.schedule_key))
      .map((assignment) => ({
        service_date: assignment.service_date,
        location_id: assignment.location_id,
        service_name: assignment.service_name,
        role: assignment.role,
        servant_id: assignment.servant_id,
      }));

    if (!assignments.length) {
      setError("No new assignments were generated. Nothing needs to be applied to the database.");
      return;
    }

    const payload: MonthlyPlanApplyInput = {
      monthStart: month + "-01",
      expectedState,
      assignments,
      acknowledgedPreferNot,
    };

    setApplying(true);
    try {
      const applied = await onApplyPlan(payload);
      if (!applied) {
        setError("The database did not apply this plan. Review the administrator message, refresh the schedule, and generate a new preview if any data changed.");
        return;
      }
      setPreview(null);
      setAcknowledgedPreferNot(false);
      setSpecialServices([]);
    } finally {
      setApplying(false);
    }
  };

  const handleManualChange = (scheduleKey: string, role: Role, servantId: string) => {
    if (!preview) return;
    const baseSlot = preview.baseSlots.find((slot) => slot.key === scheduleKey);
    const currentSlot = preview.slots.find((slot) => slot.key === scheduleKey);
    if (!baseSlot || !currentSlot || baseSlot.blocked_reason) return;
    if (baseSlot.assignments.some((assignment) => assignment.role === role)) return;

    if (servantId) {
      const eligible = getMonthlyAssignmentCandidates({
        slots: preview.slots,
        servants,
        availability,
        preferences,
        schedules,
        historicalProfiles: historicalRoster.profiles,
        autoAssignmentExcludedServantIds: historicalRoster.autoAssignmentExcludedServantIds,
        includeAssistant,
        dataErrors: inputErrors,
      }, currentSlot, role);
      if (!eligible.some((servant) => servant.id === servantId)) {
        setError("That servant is no longer eligible for this service. The preview has not been changed.");
        return;
      }
    }

    const nextOverrides: ManualOverrides = Object.fromEntries(
      Object.entries(preview.manualOverrides).map(([key, roles]) => [key, { ...roles }])
    );
    const nextRoles = { ...(nextOverrides[scheduleKey] ?? {}) };
    if (servantId) nextRoles[role] = servantId;
    else delete nextRoles[role];
    if (Object.keys(nextRoles).length) nextOverrides[scheduleKey] = nextRoles;
    else delete nextOverrides[scheduleKey];

    const recalculated = runOptimizer(preview.baseSlots, nextOverrides);
    if (!recalculated.result.ok) {
      setError("The adjusted preview could not be validated. Your previous preview remains unchanged.");
      return;
    }

    setError("");
    setAiExplanation("");
    setAiError("");
    setAiCached(false);
    setAcknowledgedPreferNot(false);
    setPreview({
      baseSlots: preview.baseSlots,
      slots: recalculated.slots,
      result: recalculated.result,
      manualOverrides: nextOverrides,
      teamGroups: recalculated.teamGroups,
      teamWarnings: recalculated.teamWarnings,
    });
  };

  const candidateOptionsByRole = useMemo(() => {
    const map = new Map<string, Servant[]>();
    if (!preview) return map;
    const preexistingConflictKeys = new Set(
      preview.result.unfilledPositions
        .filter((position) => position.reason === "preexisting_conflict")
        .map((position) => position.schedule_key)
    );
    for (const slot of preview.slots) {
      if (slot.blocked_reason || preexistingConflictKeys.has(slot.key)) continue;
      for (const role of ROLES) {
        if (role === "Assistant" && !includeAssistant) continue;
        if (slot.assignments.some((assignment) => assignment.role === role && !assignment.preview_manual && !assignment.preview_team)) {
          continue;
        }
        map.set(slot.key + "|" + role, getMonthlyAssignmentCandidates({
          slots: preview.slots,
          servants,
          availability,
          preferences,
          schedules,
          historicalProfiles: historicalRoster.profiles,
          autoAssignmentExcludedServantIds: historicalRoster.autoAssignmentExcludedServantIds,
          includeAssistant,
          dataErrors: inputErrors,
        }, slot, role));
      }
    }
    return map;
  }, [preview, servants, availability, preferences, schedules, historicalRoster, includeAssistant, inputErrors]);

  const generatedBySlot = useMemo(() => {
    const map = new Map<string, Map<Role, MonthlyGeneratedAssignment>>();
    for (const assignment of preview?.result.assignments ?? []) {
      const roles = map.get(assignment.schedule_key) ?? new Map<Role, MonthlyGeneratedAssignment>();
      roles.set(assignment.role, assignment);
      map.set(assignment.schedule_key, roles);
    }
    return map;
  }, [preview]);

  const unfilledBySlot = useMemo(() => {
    const map = new Map<string, Map<Role, MonthlyUnfilledPosition>>();
    for (const position of preview?.result.unfilledPositions ?? []) {
      const roles = map.get(position.schedule_key) ?? new Map<Role, MonthlyUnfilledPosition>();
      roles.set(position.role, position);
      map.set(position.schedule_key, roles);
    }
    return map;
  }, [preview]);

  const locationNames = useMemo(
    () => new Map(locations.map((location) => [location.id, location.name])),
    [locations],
  );

  const servingTeamBySlot = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of preview?.teamGroups ?? []) {
      for (const key of group.slotKeys) map.set(key, group.label);
    }
    return map;
  }, [preview]);

  const previewChurchGroups = useMemo(() => {
    if (!preview) return [];
    return locations
      .filter((location) => selectedLocationIds.includes(location.id))
      .map((location) => ({
        location,
        slots: preview.slots
          .filter((slot) => slot.location_id === location.id)
          .slice()
          .sort((first, second) =>
            first.service_date.localeCompare(second.service_date) ||
            first.start_time.localeCompare(second.start_time) ||
            first.service_name.localeCompare(second.service_name)
          ),
      }))
      .filter((group) => group.slots.length > 0);
  }, [preview, locations, selectedLocationIds]);

  const addSpecialService = () => {
    const normalizedName = specialServiceName.trim();
    if (!normalizedName || !specialServiceLocation || !specialServiceDate ||
        !specialServiceDate.startsWith(month + "-")) {
      setError("Enter a service name, selected church and valid date in the planning month.");
      return;
    }

    let additions: MonthlySpecialServiceInput[];
    if (specialServiceMode === "lineup") {
      if (!specialServiceLineupTemplates.length) {
        setError("The selected church has no active templates for that service day.");
        return;
      }
      additions = specialServiceLineupTemplates.map((template) => ({
        service_date: specialServiceDate,
        location_id: specialServiceLocation,
        service_name: normalizedName + " - " + template.service_name,
        start_time: template.start_time.slice(0, 5),
        end_time: template.end_time.slice(0, 5),
      }));
    } else {
      if (specialServiceStart >= specialServiceEnd) {
        setError("The service end time must be later than its start time.");
        return;
      }
      additions = [{
        service_date: specialServiceDate,
        location_id: specialServiceLocation,
        service_name: normalizedName,
        start_time: specialServiceStart,
        end_time: specialServiceEnd,
      }];
    }

    const existingKeys = new Set([
      ...specialServices.map((service) => [service.service_date, service.location_id, service.service_name.trim()].join("|")),
      ...schedules.map((schedule) => [schedule.service_date, schedule.location_id, schedule.service_name.trim()].join("|")),
    ]);
    const additionKeys = additions.map((service) =>
      [service.service_date, service.location_id, service.service_name.trim()].join("|")
    );
    if (new Set(additionKeys).size !== additionKeys.length || additionKeys.some((key) => existingKeys.has(key))) {
      setError("One or more services in this lineup already exist for that date and church. No services were added.");
      return;
    }

    setSpecialServices((current) => [...current, ...additions].sort((first, second) =>
      first.service_date.localeCompare(second.service_date) ||
      first.location_id.localeCompare(second.location_id) ||
      first.start_time.localeCompare(second.start_time)
    ));
    setSpecialServiceName("");
    setError("");
    setPreview(null);
  };

  const explainPreviewWithAi = async () => {
    if (!preview || aiBusy) return;
    if (!aiWorkerUrl || !aiAccessToken) {
      setAiError("The free AI Worker has not been configured yet. Scheduling works normally without it.");
      return;
    }
    setAiBusy(true);
    setAiError("");
    setAiExplanation("");
    setAiCached(false);
    try {
      const snapshot = buildAiSchedulingSnapshot({
        month,
        locations,
        slots: preview.slots,
        generatedAssignments: preview.result.assignments,
        unfilledPositions: preview.result.unfilledPositions,
        workloads: preview.result.workloads,
        servants,
        availability,
      });
      const result = await requestAiSchedulingExplanation(aiWorkerUrl, aiAccessToken, snapshot);
      setAiExplanation(result.explanation);
      setAiCached(result.cached);
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "The free AI assistant is temporarily unavailable.");
    } finally {
      setAiBusy(false);
    }
  };


  return (
    <section className="monthly-smart-scheduler">
      <details className="monthly-smart-disclosure" open>
        <summary className="monthly-smart-header monthly-smart-disclosure-summary">
          <div className="monthly-smart-title">
            <span className="monthly-smart-icon"><WandSparkles size={18}/></span>
            <div>
              <h2>Monthly Smart Scheduler</h2>
              <p>Generate a balanced proposal from the active weekend templates, availability and serving history.</p>
            </div>
          </div>
          <span className="monthly-smart-admin-only">Admin planning tool</span>
          <ChevronDown className="monthly-smart-collapse-icon" size={19} aria-hidden="true"/>
        </summary>
        <div className="monthly-smart-content">
      {inputErrors.length > 0 && (
        <div className="monthly-smart-alert is-blocking" role="alert">
          <AlertTriangle size={16}/>
          <div>
            <b>Generation is paused because required data did not load.</b>
            <ul>{inputErrors.map((item, index) => <li key={index}>{item}</li>)}</ul>
            <small>Refresh the workspace before generating. Empty fallback arrays are not treated as proof that servants are available.</small>
          </div>
        </div>
      )}

      <div className="monthly-smart-controls">
        <label>
          <span>Planning month</span>
          <input type="month" value={month} onChange={(event) => {
            const nextMonth = event.target.value;
            setMonth(nextMonth);
            setSpecialServiceDate(nextMonth ? nextMonth + "-25" : "");
            setSpecialServices([]);
            setTeamPatternOverrides({});
            setPreview(null);
          }} disabled={Boolean(inputErrors.length)}/>
        </label>
        <div className="monthly-smart-location-control">
          <span className="monthly-smart-field-label">Church locations</span>
          <div className="monthly-smart-location-list">
            {locations.map((location) => (
              <label key={location.id} className="monthly-smart-checkbox">
                <input
                  type="checkbox"
                  checked={selectedLocationIds.includes(location.id)}
                  onChange={(event) => {
                    setSelectedLocationIds((current) =>
                      event.target.checked
                        ? [...current, location.id]
                        : current.filter((id) => id !== location.id)
                    );
                    setPreview(null);
                  }}
                />
                <span>{location.name}</span>
              </label>
            ))}
          </div>
          <small>Other churches are still checked for same-day conflicts, even when they are not selected for generation.</small>
        </div>
        <label className="monthly-smart-checkbox monthly-smart-assistant-option">
          <input
            type="checkbox"
            checked={includeAssistant}
            onChange={(event) => { setIncludeAssistant(event.target.checked); setPreview(null); }}
          />
          <span>Include optional Assistant assignments</span>
        </label>
      </div>

      {teamPatternWeeks.length > 0 && (
        <section className="monthly-smart-team-rotation" aria-labelledby="monthly-smart-team-heading">
          <div className="monthly-smart-team-heading">
            <div>
              <b id="monthly-smart-team-heading">Weekly serving team rotation</b>
              <p>Choose the serving-team pattern for each church and week. Members selected for one team will be reused across that team's services when qualified and available.</p>
            </div>
            <span>{teamPatternWeeks.length} weekly configurations</span>
          </div>
          <div className="monthly-smart-team-week-grid">
            {teamPatternWeeks.map((week) => (
              <label className="monthly-smart-team-week" key={week.key}>
                <span><b>{week.location.name}</b><small>{week.label}</small></span>
                <select
                  value={patternsByWeek[week.key]}
                  onChange={(event) => {
                    setTeamPatternOverrides((current) => ({
                      ...current,
                      [week.key]: event.target.value as MonthlyServingTeamPattern,
                    }));
                    setPreview(null);
                  }}
                >
                  {week.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
            ))}
          </div>
          <small className="monthly-smart-team-note">GMS Alam Sutera AOG Teen and AOG Youth always share one serving team. VSS remains a separate service.</small>
        </section>
      )}

      <div className="monthly-smart-special-service">
        <div className="monthly-smart-special-heading">
          <div>
            <b>Add one-off / special service</b>
            <p>For Christmas, Good Friday, Easter, conferences or other weekday services. These slots are added to this preview only until you apply the draft plan.</p>
          </div>
          <span>Special service</span>
        </div>
        <div className="monthly-smart-special-mode" role="group" aria-label="Special service creation mode">
          <button type="button" className={specialServiceMode === "single" ? "selected" : ""} aria-pressed={specialServiceMode === "single"} onClick={() => setSpecialServiceMode("single")}>Single service</button>
          <button type="button" className={specialServiceMode === "lineup" ? "selected" : ""} aria-pressed={specialServiceMode === "lineup"} onClick={() => setSpecialServiceMode("lineup")}>Generate full church lineup</button>
        </div>
        <div className={"monthly-smart-special-fields" + (specialServiceMode === "lineup" ? " is-lineup" : "")}>
          <label>
            <span>Service date</span>
            <input type="date" value={specialServiceDate} min={month + "-01"} max={specialServiceDateMax} onChange={(event) => setSpecialServiceDate(event.target.value)}/>
          </label>
          <label>
            <span>Church</span>
            <select value={specialServiceLocation} onChange={(event) => setSpecialServiceLocation(event.target.value)}>
              <option value="">Choose church</option>
              {locations.filter((location) => selectedLocationIds.includes(location.id)).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
            </select>
          </label>
          {specialServiceMode === "lineup" ? (
            <>
              <label>
                <span>Copy service lineup</span>
                <select value={specialServiceLineupDay} onChange={(event) => setSpecialServiceLineupDay(Number(event.target.value))}>
                  <option value={0}>Sunday lineup</option>
                  <option value={6}>Saturday lineup</option>
                </select>
              </label>
              <label className="monthly-smart-special-name">
                <span>Special service name prefix</span>
                <input value={specialServiceName} onChange={(event) => setSpecialServiceName(event.target.value)} placeholder="e.g. Christmas Special Service"/>
              </label>
              <div className="monthly-smart-special-lineup-summary">
                <b>{specialServiceLineupTemplates.length} services will be generated</b>
                <small>{specialServiceLineupTemplates.map((template) => template.service_name).join(" · ") || "No active lineup for this church"}</small>
              </div>
              <button type="button" className="btn secondary" disabled={!specialServiceLineupTemplates.length} onClick={addSpecialService}>Add {specialServiceLineupTemplates.length} services</button>
            </>
          ) : (
            <>
              <label className="monthly-smart-special-name">
                <span>Service name</span>
                <input value={specialServiceName} onChange={(event) => setSpecialServiceName(event.target.value)} placeholder="e.g. Christmas Service"/>
              </label>
              <label>
                <span>Starts</span>
                <input type="time" value={specialServiceStart} onChange={(event) => setSpecialServiceStart(event.target.value)}/>
              </label>
              <label>
                <span>Ends</span>
                <input type="time" value={specialServiceEnd} onChange={(event) => setSpecialServiceEnd(event.target.value)}/>
              </label>
              <button type="button" className="btn secondary" onClick={addSpecialService}>Add service</button>
            </>
          )}
        </div>
        {specialServices.length > 0 && (
          <div className="monthly-smart-special-list">
            {specialServices.map((service, index) => (
              <div className="monthly-smart-special-chip" key={service.service_date + "|" + service.location_id + "|" + service.service_name}>
                <span><b>{fmtDate(service.service_date)}</b> · {locationNames.get(service.location_id)} · {service.service_name} · {service.start_time}–{service.end_time}</span>
                <button type="button" aria-label={"Remove " + service.service_name} onClick={() => { setSpecialServices((current) => current.filter((_, i) => i !== index)); setPreview(null); }}>Remove</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="monthly-smart-rule-summary">
        <div><b>Missing availability</b><span>Eligible</span></div>
        <div><b>Workload</b><span>Opportunity-adjusted balance</span></div>
        <div><b>Existing assignments</b><span>Preserved and locked</span></div>
        <div><b>Publication</b><span>Never automatic</span></div>
      </div>

      {error && <div className="monthly-smart-alert is-blocking" role="alert"><AlertTriangle size={16}/><span>{error}</span></div>}

      <div className="monthly-smart-actions">
        <button type="button" className="btn primary" disabled={!canReview} onClick={generatePreview}>
          <WandSparkles size={16}/> Generate monthly preview
        </button>
        {preview && <button type="button" className="btn secondary" onClick={() => { setPreview(null); setAcknowledgedPreferNot(false); }}>Clear preview</button>}
      </div>

      {preview && (
        <div className="monthly-smart-preview">
          <div className="monthly-smart-preview-heading">
            <div>
              <h3>Proposed schedule · {month}</h3>
              <p>Generated assignments are proposals only. Existing assignments remain locked; dropdowns can adjust proposed roles without saving them.</p>
            </div>
            <span className="monthly-smart-preview-status">Preview only</span>
          </div>

          <div className="monthly-smart-metrics">
            <div><strong>{preview.slots.length}</strong><span>Services in scope</span></div>
            <div><strong>{preview.result.filledRequiredPositionCount}/{preview.result.requiredPositionCount}</strong><span>Required positions filled</span></div>
            <div className={preview.result.unfilledRequiredPositionCount ? "has-gap" : ""}><strong>{preview.result.unfilledRequiredPositionCount}</strong><span>Required positions unfilled</span></div>
            <div><strong>{preview.result.generatedAssignmentCount}</strong><span>New proposals</span></div>
          </div>

          <section className="monthly-smart-ai-panel" aria-labelledby="monthly-smart-ai-heading">
            <div className="monthly-smart-ai-inner">
            <div className="monthly-smart-ai-copy">
              <div className="monthly-smart-ai-title">
                <WandSparkles size={17}/>
                <b id="monthly-smart-ai-heading">AI scheduling explanation</b>
                <span className="monthly-smart-ai-free-label">Free pilot · hard capped</span>
              </div>
              <p>Get an explanation of coverage, role qualifications, vacancies and workload balance. Servant names and personal details are removed before the request leaves this browser.</p>
              <small>Limit: 1 model call per GMS per UTC day, 3 requests per administrator and 10 requests across GMS. Identical cached results do not use another model call.</small>
            </div>
            <button type="button" className="btn secondary monthly-smart-ai-button" disabled={aiBusy || !aiWorkerUrl || !aiAccessToken} onClick={() => void explainPreviewWithAi()} title={!aiWorkerUrl || !aiAccessToken ? "The free Cloudflare Worker is not configured yet." : "Use the free daily AI allowance to explain this preview."}>
              <WandSparkles size={16}/>{aiBusy ? "Analyzing preview…" : aiExplanation ? "Refresh AI explanation" : "Explain preview with AI"}
            </button>
            {!aiWorkerUrl && <small className="monthly-smart-ai-muted">Not connected yet. The feature stays disabled until a free-only Cloudflare Worker URL is configured.</small>}
            {aiError && <p className="monthly-smart-ai-error" role="alert">{aiError}</p>}
            {aiExplanation && <div className="monthly-smart-ai-result" role="status"><div><b>AI analysis</b>{aiCached && <span>Cached result · no model call used</span>}</div><pre>{aiExplanation}</pre><small>Advice only. The AI cannot edit assignments or publish schedules; the existing optimizer and database remain authoritative.</small></div>}
            </div>
          </section>
          {preview.teamWarnings.length > 0 && (
            <div className="monthly-smart-team-warnings" role="status">
              <b>Serving-team review</b>
              {preview.teamWarnings.map((warning) => <small key={warning}>{warning}</small>)}
            </div>
          )}
          <div className="monthly-smart-secondary-metrics">
            <span><b>{preview.result.lockedAssignmentCount}</b> preserved assignments</span>
            <span><b>{preview.result.generatedAssistantCount}</b> optional Assistants proposed</span>
            <span><b>{preview.result.skippedServiceCount}</b> services frozen or skipped</span>
            <span><b>{preview.result.declinedAssignmentCount}</b> declined assignments preserved</span>
            <span><b>{preview.slots.reduce((count, slot) => count + slot.assignments.filter((assignment) => assignment.preview_manual).length, 0)}</b> manual preview adjustments</span>
          </div>

          <div className="monthly-smart-section">
            <h4>Service-by-service review</h4>
            {previewChurchGroups.map(({ location, slots }) => (
              <div className="monthly-smart-church-group" key={location.id}>
                <div className="monthly-smart-church-heading">
                  <h5>{location.name}</h5>
                  <span>{slots.length} services · {fmtDate(slots[0].service_date)} to {fmtDate(slots[slots.length - 1].service_date)}</span>
                </div>
                <div className="monthly-smart-table-wrap">
                  <table className="monthly-smart-table">
                    <thead>
                      <tr><th>Date</th><th>Service</th><th>FOH</th><th>Monitor</th><th>Assistant</th></tr>
                    </thead>
                    <tbody>
                      {slots.map((slot) => {
                        const generated = generatedBySlot.get(slot.key);
                        const unfilled = unfilledBySlot.get(slot.key);
                        return (
                          <tr key={slot.key}>
                            <td><b>{fmtDate(slot.service_date)}</b><small>{slot.start_time.slice(0, 5)}–{slot.end_time.slice(0, 5)}</small></td>
                            <td>
                              <b>{slot.service_name}</b>
                              {servingTeamBySlot.has(slot.key) && <small className="monthly-smart-team-chip">{servingTeamBySlot.get(slot.key)}</small>}
                              {slot.status === "new_special" && <small className="monthly-smart-special-label">One-off special service</small>}
                              {slot.template_id === null && slot.status !== "new_special" && <small className="monthly-smart-special-label">Existing custom service</small>}
                              {slot.blocked_reason && <small className="monthly-smart-lock-label">Preserved · {slot.blocked_reason === "published" ? "published" : "pending request"}</small>}
                            </td>
                            {ROLES.map((role) => (
                              <td key={role}>
                                <GeneratedOrExistingRole
                                  slot={slot}
                                  role={role}
                                  generated={generated?.get(role)}
                                  unfilled={unfilled?.get(role)}
                                  includeAssistant={includeAssistant}
                                  candidateOptions={candidateOptionsByRole.get(slot.key + "|" + role) ?? []}
                                  servants={servants}
                                  onManualChange={(servantId) => handleManualChange(slot.key, role, servantId)}
                                />
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>

          <div className="monthly-smart-section">
            <h4>Workload balance</h4>
            {preview.result.workloads.length ? (
              <div className="monthly-smart-table-wrap">
                <table className="monthly-smart-workload-table">
                  <thead>
                    <tr><th>Servant</th><th>Existing</th><th>Generated</th><th>Total</th><th>Days</th><th>Eligible service opportunities</th><th>Utilization</th><th>Last 60 days</th><th>History to Sun, Nov 1, 2026</th></tr>
                  </thead>
                  <tbody>
                    {preview.result.workloads.map((workload) => (
                      <tr key={workload.servant_id}>
                        <td><b>{workload.servant_name}</b><small>FOH {workload.role_counts.FOH} · Monitor {workload.role_counts.Monitor} · Assistant {workload.role_counts.Assistant}</small></td>
                        <td>{workload.existing_assignments}</td>
                        <td>{workload.generated_assignments}</td>
                        <td><b>{workload.total_assignments}</b></td>
                        <td>{workload.serving_days}</td>
                        <td>{workload.eligible_opportunities}</td>
                        <td>{Math.round(workload.utilization * 100)}%</td>
                        <td>{workload.recent_60_day_assignments} assignments · {workload.recent_60_day_days} days</td><td>{workload.historical_assignments} assignments · {workload.historical_serving_days} days</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="monthly-smart-muted">No active servants had an eligible position in this preview.</p>}
          </div>

          {(preview.result.unfilledPositions.length > 0 || preview.result.warnings.length > 0 || preview.result.preferNotWarnings.length > 0 || unmatchedManualOnly.length > 0 || unmatchedHistorical.length > 0 || historicalRoster.ambiguousNames.length > 0 || ambiguousManualOnlyServants.length > 0) && (
            <div className="monthly-smart-section monthly-smart-issues">
              <h4>Review required</h4>
              {preview.result.unfilledPositions.length > 0 && (
                <div className="monthly-smart-issue-group">
                  <b>{preview.result.unfilledRequiredPositionCount} required vacancy/vacancies · {preview.result.unfilledPositions.filter((item) => !item.required).length} optional gap(s)</b>
                  <ul>
                    {preview.result.unfilledPositions.slice(0, 30).map((item, index) => (
                      <li key={item.schedule_key + "|" + item.role + "|" + index}>
                        <b>{fmtDate(item.service_date)} · {locationNames.get(item.location_id) ?? "Unknown church"} · {item.service_name} · {item.role}</b>
                        <span>{reasonLabel(item.reason)}</span>
                      </li>
                    ))}
                    {preview.result.unfilledPositions.length > 30 && <li>And {preview.result.unfilledPositions.length - 30} more unfilled positions.</li>}
                  </ul>
                </div>
              )}
              {preview.result.warnings.length > 0 && (
                <div className="monthly-smart-issue-group">
                  <b>Operational warnings</b>
                  <ul>{preview.result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                </div>
              )}
              {preview.result.preferNotWarnings.length > 0 && (
                <div className="monthly-smart-issue-group">
                  <b>Prefer-not assignments · admin acknowledgement required</b>
                  <ul>{preview.result.preferNotWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                  <label className="monthly-smart-checkbox monthly-smart-acknowledgement">
                    <input type="checkbox" checked={acknowledgedPreferNot} onChange={(event) => setAcknowledgedPreferNot(event.target.checked)}/>
                    <span>I reviewed the prefer-not assignments and understand these servants have a saved preference not to serve on those dates.</span>
                  </label>
                </div>
              )}
              {unmatchedManualOnly.length > 0 && (
                <div className="monthly-smart-alert is-caution">
                  <AlertTriangle size={16}/>
                  <span>Manual-only roster names not matched to the current GMS servant directory: {unmatchedManualOnly.join(", ")}. Reconcile these names before applying a plan.</span>
                </div>
              )}
              {unmatchedHistorical.length > 0 && (
                <div className="monthly-smart-alert is-caution">
                  <AlertTriangle size={16}/>
                  <span>Historical names not matched to the current GMS servant directory: {unmatchedHistorical.slice(0, 20).join(", ")}{unmatchedHistorical.length > 20 ? ` and ${unmatchedHistorical.length - 20} more` : ""}. These names were not fuzzy-matched and their historical preferences were not applied.</span>
                </div>
              )}
              {historicalRoster.ambiguousNames.length > 0 && (
                <div className="monthly-smart-alert is-caution">
                  <AlertTriangle size={16}/>
                  <span>Historical names with multiple current servant matches: {historicalRoster.ambiguousNames.join(", ")}. The historical role profile was not assigned to one person because the current directory has duplicate exact names.</span>
                </div>
              )}
              {ambiguousManualOnlyServants.length > 0 && (
                <div className="monthly-smart-alert is-caution">
                  <AlertTriangle size={16}/>
                  <span>Ambiguous manual-only roster matches are excluded from automatic allocation until the servant directory is reconciled: {ambiguousManualOnlyServants.join(", ")}.</span>
                </div>
              )}
            </div>
          )}

          <div className="monthly-smart-save-notice">
            <Clock3 size={16}/>
            <div>
              <b>Draft application · no publishing</b>
              <p>Applying creates any missing service rows as drafts and inserts assignments only into vacant roles. Existing assignments and confirmation states are checked and preserved. The database revalidates the reviewed snapshot before writing. Publishing remains a separate administrator action.</p>
            </div>
          </div>
          <button
            type="button"
            className="btn primary"
            disabled={
              applying ||
              Boolean(inputErrors.length) ||
              preview.result.generatedAssignmentCount === 0 ||
              !applicableSlotsForApply(preview).length ||
              (preview.result.preferNotWarnings.length > 0 && !acknowledgedPreferNot)
            }
            onClick={() => void applyReviewedPlan()}
            title={
              preview.result.preferNotWarnings.length > 0 && !acknowledgedPreferNot
                ? "Acknowledge the prefer-not assignments before applying."
                : "Apply the reviewed additive-only draft plan."
            }
          >
            {applying ? "Applying monthly draft plan…" : `Apply ${preview.result.generatedAssignmentCount} proposed assignment(s) to drafts`}
          </button>
        </div>
      )}
        </div>
      </details>
    </section>
  );
}
