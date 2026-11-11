import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, WandSparkles } from "lucide-react";
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
import type { MonthlyScheduleSlot } from "../services/monthlyScheduleGeneration";
import { mapHistoricalRosterProfiles } from "../services/historicalRosterProfiles";
import type { MonthlyPlanApplyInput, MonthlyPlanAssignment, MonthlyPlanExpectedSlot } from "../services/schedulePersistence";
import "./MonthlySmartScheduler.css";

type SuccessfulOptimizerResult = Extract<MonthlyAssignmentOptimizerResult, { ok: true }>;
type ManualOverrides = Record<string, Partial<Record<Role, string>>>;

type PreviewData = {
  baseSlots: MonthlyScheduleSlot[];
  slots: MonthlyScheduleSlot[];
  result: SuccessfulOptimizerResult;
  manualOverrides: ManualOverrides;
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

function displayDate(value: string): string {
  const [year, month, day] = value.split("-");
  return [day, month, year].join("-");
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
    overlapping_service: "Candidates have overlapping services",
    serving_restriction: "Availability and serving restrictions exclude candidates",
    no_eligible_candidate: "No eligible candidate remains",
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
  if (selected && !selected.preview_manual) {
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
      <small className={selected?.preview_manual ? "is-manual" : generated ? "is-generated" : "is-unfilled"}>
        {selected?.preview_manual
          ? "Manual selection · preview only"
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
}: MonthlySmartSchedulerProps) {
  const [month, setMonth] = useState(nextMonthKey);
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
  const [includeAssistant, setIncludeAssistant] = useState(true);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [error, setError] = useState("");
  const [acknowledgedPreferNot, setAcknowledgedPreferNot] = useState(false);
  const [applying, setApplying] = useState(false);
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
    const result = optimizeMonthlyAssignments({
      slots,
      servants,
      availability,
      preferences,
      schedules,
      historicalProfiles: historicalRoster.profiles,
      autoAssignmentExcludedServantIds: historicalRoster.autoAssignmentExcludedServantIds,
      includeAssistant,
      dataErrors: inputErrors,
    });
    return { slots, result };
  };

  const generatePreview = () => {
    setError("");
    setPreview(null);
    setAcknowledgedPreferNot(false);

    const built = buildMonthlyScheduleSlots({
      month,
      locationIds: selectedLocationIds,
      templates,
      existingSchedules: schedules,
      pendingRequestScheduleIds,
      dataErrors: inputErrors,
    });
    if (!built.ok) {
      const reasonMessages: Record<typeof built.reason, string> = {
        invalid_month: "Choose a valid month.",
        select_location: "Select at least one church location.",
        data_unavailable: "Required scheduling data could not be loaded. Refresh the GMS workspace and retry.",
        no_weekend_templates: "No active Saturday or Sunday service templates exist for this month and selection.",
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

    setPreview({
      baseSlots: built.slots,
      slots: optimized.slots,
      result: optimized.result,
      manualOverrides,
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
        expected_status: slot.schedule_id ? "draft" : "new",
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
    setAcknowledgedPreferNot(false);
    setPreview({
      baseSlots: preview.baseSlots,
      slots: recalculated.slots,
      result: recalculated.result,
      manualOverrides: nextOverrides,
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
        if (slot.assignments.some((assignment) => assignment.role === role && !assignment.preview_manual)) {
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

  return (
    <section className="monthly-smart-scheduler">
      <div className="monthly-smart-header">
        <div className="monthly-smart-title">
          <span className="monthly-smart-icon"><WandSparkles size={18}/></span>
          <div>
            <h2>Monthly Smart Scheduler</h2>
            <p>Generate a balanced proposal from the active weekend templates, availability and serving history.</p>
          </div>
        </div>
        <span className="monthly-smart-admin-only">Admin planning tool</span>
      </div>

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
          <input type="month" value={month} onChange={(event) => { setMonth(event.target.value); setPreview(null); }} disabled={Boolean(inputErrors.length)}/>
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

          <div className="monthly-smart-secondary-metrics">
            <span><b>{preview.result.lockedAssignmentCount}</b> preserved assignments</span>
            <span><b>{preview.result.generatedAssistantCount}</b> optional Assistants proposed</span>
            <span><b>{preview.result.skippedServiceCount}</b> services frozen or skipped</span>
            <span><b>{preview.result.declinedAssignmentCount}</b> declined assignments preserved</span>
            <span><b>{preview.slots.reduce((count, slot) => count + slot.assignments.filter((assignment) => assignment.preview_manual).length, 0)}</b> manual preview adjustments</span>
          </div>

          <div className="monthly-smart-section">
            <h4>Service-by-service review</h4>
            <div className="monthly-smart-table-wrap">
              <table className="monthly-smart-table">
                <thead>
                  <tr><th>Date</th><th>Church / service</th><th>FOH</th><th>Monitor</th><th>Assistant</th></tr>
                </thead>
                <tbody>
                  {preview.slots.map((slot) => {
                    const generated = generatedBySlot.get(slot.key);
                    const unfilled = unfilledBySlot.get(slot.key);
                    return (
                      <tr key={slot.key}>
                        <td><b>{displayDate(slot.service_date)}</b><small>{slot.start_time.slice(0, 5)}–{slot.end_time.slice(0, 5)}</small></td>
                        <td><b>{locationNames.get(slot.location_id) ?? "Unknown church"}</b><small>{slot.service_name}</small></td>
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

          <div className="monthly-smart-section">
            <h4>Workload balance</h4>
            {preview.result.workloads.length ? (
              <div className="monthly-smart-table-wrap">
                <table className="monthly-smart-workload-table">
                  <thead>
                    <tr><th>Servant</th><th>Existing</th><th>Generated</th><th>Total</th><th>Days</th><th>Eligible service opportunities</th><th>Utilization</th><th>Last 60 days</th><th>History to 01-11-2026</th></tr>
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
                        <b>{displayDate(item.service_date)} · {locationNames.get(item.location_id) ?? "Unknown church"} · {item.service_name} · {item.role}</b>
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
    </section>
  );
}
