import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarDays, CheckCircle2, Clock3, WandSparkles } from "lucide-react";
import type { Location, Role, ScheduleView, Servant, ServiceTemplate } from "../../../types";
import type { AvailabilityRecord } from "../../availability/services/recurringAvailability";
import type { ServingPreferenceRecord } from "../../availability/services/availabilityData";
import type { ServingRequestRecord } from "../../requests/services/requestData";
import { buildMonthlyScheduleSlots } from "../services/monthlyScheduleGeneration";
import {
  optimizeMonthlyAssignments,
  type MonthlyAssignmentOptimizerResult,
  type MonthlyGeneratedAssignment,
  type MonthlyScheduleSlot,
  type MonthlyUnfilledPosition,
} from "../services/monthlyAssignmentOptimizer";
import { mapHistoricalRosterProfiles } from "../services/historicalRosterProfiles";
import "./MonthlySmartScheduler.css";

type SuccessfulOptimizerResult = Extract<MonthlyAssignmentOptimizerResult, { ok: true }>;
type PreviewData = {
  slots: MonthlyScheduleSlot[];
  result: SuccessfulOptimizerResult;
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
};

const ROLES: Role[] = ["FOH", "Monitor", "Assistant"];

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
}: {
  slot: MonthlyScheduleSlot;
  role: Role;
  generated: MonthlyGeneratedAssignment | undefined;
  unfilled: MonthlyUnfilledPosition | undefined;
  includeAssistant: boolean;
}) {
  const existing = slot.assignments.find((assignment) => assignment.role === role);
  if (existing) {
    return (
      <div className="monthly-role-value is-locked">
        <b>{existing.servant_name}</b>
        <small><span className="monthly-lock-dot"/> Preserved · locked</small>
      </div>
    );
  }
  if (generated) {
    return (
      <div className="monthly-role-value is-generated">
        <b>{generated.servant_name}</b>
        <small><CheckCircle2 size={12}/> Generated · draft proposal</small>
      </div>
    );
  }
  if (role === "Assistant" && !includeAssistant) {
    return <div className="monthly-role-value is-optional"><b>Not included</b><small>Optional role</small></div>;
  }
  return (
    <div className="monthly-role-value is-unfilled">
      <b>Unfilled</b>
      <small>{unfilled ? reasonLabel(unfilled.reason) : "No candidate selected"}</small>
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
}: MonthlySmartSchedulerProps) {
  const [month, setMonth] = useState(nextMonthKey);
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
  const [includeAssistant, setIncludeAssistant] = useState(true);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [error, setError] = useState("");
  const [acknowledgedPreferNot, setAcknowledgedPreferNot] = useState(false);
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

  const hasPreferNotWarnings = Boolean(preview?.result.warnings.length);
  const unmatchedManualOnly = historicalRoster.unmatchedManualOnlyNames;
  const canReview = !inputErrors.length && selectedLocationIds.length > 0 && Boolean(month);

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

    const optimized = optimizeMonthlyAssignments({
      slots: built.slots,
      servants,
      availability,
      preferences,
      schedules,
      historicalProfiles: historicalRoster.profiles,
      autoAssignmentExcludedServantIds: historicalRoster.autoAssignmentExcludedServantIds,
      includeAssistant,
      dataErrors: inputErrors,
    });
    if (!optimized.ok) {
      setError(
        optimized.reason === "data_unavailable"
          ? "Required scheduling data could not be loaded. Generation stopped safely."
          : optimized.reason === "no_service_slots"
          ? "No service slots were available to optimize."
          : "The final allocation validation failed. No plan was created.",
      );
      return;
    }

    setPreview({ slots: built.slots, result: optimized });
  };

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
              <p>Generated assignments are proposals only. Every existing assignment remains locked.</p>
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
                    <tr><th>Servant</th><th>Existing</th><th>Generated</th><th>Total</th><th>Days</th><th>Eligible service opportunities</th><th>Utilization</th><th>Last 60 days</th></tr>
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
                        <td>{workload.recent_60_day_assignments} assignments · {workload.recent_60_day_days} days</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="monthly-smart-muted">No active servants had an eligible position in this preview.</p>}
          </div>

          {(preview.result.unfilledPositions.length > 0 || preview.result.warnings.length > 0 || unmatchedManualOnly.length > 0 || historicalRoster.ambiguousNames.length > 0) && (
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
                  <b>Soft-preference warnings</b>
                  <ul>{preview.result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
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
              {historicalRoster.ambiguousNames.length > 0 && (
                <div className="monthly-smart-alert is-caution">
                  <AlertTriangle size={16}/>
                  <span>Historical names with multiple current servant matches: {historicalRoster.ambiguousNames.join(", ")}. These role preferences and exclusions were not mapped.</span>
                </div>
              )}
            </div>
          )}

          <div className="monthly-smart-save-notice">
            <Clock3 size={16}/>
            <div>
              <b>Preview-only stage</b>
              <p>The scheduler has not written to Supabase. Applying the proposal will be enabled after the additive-only database transaction is implemented and tested in Staging. Publishing will remain a separate administrator action.</p>
            </div>
          </div>
          <button
            type="button"
            className="btn primary"
            disabled
            title="Database-safe apply is planned for the next implementation phase."
          >
            Apply generated assignments · coming after database safeguards
          </button>
        </div>
      )}
    </section>
  );
}
