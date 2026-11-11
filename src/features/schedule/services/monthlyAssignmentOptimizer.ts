import type { Role, ScheduleView, Servant } from "../../../types.ts";
import type { AssignmentAvailabilityEntry } from "./assignmentValidation.ts";
import type { ServingPreferenceRule } from "./eligibility.ts";
import type { MonthlyScheduleSlot } from "./monthlyScheduleGeneration.ts";

export type MonthlyHistoricalServantProfile = {
  servant_id: string;
  primary_role?: Role | null;
  role_counts?: Partial<Record<Role, number>>;
  historical_assignments?: number;
  historical_serving_days?: number;
  history_as_of?: string;
};

export type MonthlyGeneratedAssignment = {
  schedule_key: string;
  schedule_id: string | null;
  service_date: string;
  location_id: string;
  service_name: string;
  start_time: string;
  end_time: string;
  role: Role;
  servant_id: string;
  servant_name: string;
};

export type MonthlyUnfilledPositionReason =
  | "published_service"
  | "pending_request"
  | "preexisting_conflict"
  | "no_active_servants"
  | "no_auto_assignable_servants"
  | "unavailable"
  | "serving_preference"
  | "cross_church_conflict"
  | "overlapping_service"
  | "serving_restriction"
  | "no_eligible_candidate";

export type MonthlyUnfilledPosition = {
  schedule_key: string;
  schedule_id: string | null;
  service_date: string;
  location_id: string;
  service_name: string;
  role: Role;
  required: boolean;
  reason: MonthlyUnfilledPositionReason;
  blocked_candidate_count: number;
};

export type MonthlyServantWorkload = {
  servant_id: string;
  servant_name: string;
  existing_assignments: number;
  generated_assignments: number;
  total_assignments: number;
  serving_days: number;
  eligible_opportunities: number;
  utilization: number;
  recent_60_day_assignments: number;
  recent_60_day_days: number;
  historical_assignments: number;
  historical_serving_days: number;
  role_counts: Record<Role, number>;
  prefer_not_assignments: number;
};

export type MonthlyAssignmentOptimizerInput = {
  slots: readonly MonthlyScheduleSlot[];
  servants: readonly Servant[];
  availability: readonly AssignmentAvailabilityEntry[];
  preferences: readonly ServingPreferenceRule[];
  schedules: readonly ScheduleView[];
  historicalProfiles?: readonly MonthlyHistoricalServantProfile[];
  includeAssistant?: boolean;
  dataErrors?: readonly string[];
  autoAssignmentExcludedServantIds?: readonly string[];
};

export type MonthlyAssignmentOptimizerResult =
  | {
      ok: true;
      assignments: MonthlyGeneratedAssignment[];
      unfilledPositions: MonthlyUnfilledPosition[];
      workloads: MonthlyServantWorkload[];
      warnings: string[];
      lockedAssignmentCount: number;
      generatedAssignmentCount: number;
      requiredPositionCount: number;
      filledRequiredPositionCount: number;
      unfilledRequiredPositionCount: number;
      generatedAssistantCount: number;
      unfilledOptionalAssistantCount: number;
      skippedServiceCount: number;
    }
  | {
      ok: false;
      reason: "data_unavailable" | "no_service_slots" | "final_validation_failed";
      errors?: string[];
    };

type AssignmentCommitment = {
  slot_key: string;
  schedule_id: string | null;
  service_date: string;
  location_id: string;
  service_name: string;
  start_time: string;
  end_time: string;
  role: Role;
  servant_id: string;
  source: "existing" | "generated";
};

type RolePosition = {
  slot: MonthlyScheduleSlot;
  role: Role;
  required: boolean;
};

type BlockReason =
  | "inactive"
  | "unavailable"
  | "serving_preference"
  | "already_in_service"
  | "cross_church"
  | "overlap";

const REQUIRED_ROLES: Role[] = ["FOH", "Monitor"];
const ALL_ROLES: Role[] = ["FOH", "Monitor", "Assistant"];

function dateMinusDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(year, month - 1, day, 12, 0, 0, 0);
  value.setDate(value.getDate() - days);
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
}

function toMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value ?? "").trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function intervalsOverlap(
  firstStart: string,
  firstEnd: string,
  secondStart: string,
  secondEnd: string,
): boolean {
  const a = toMinutes(firstStart);
  const b = toMinutes(firstEnd);
  const c = toMinutes(secondStart);
  const d = toMinutes(secondEnd);
  return a !== null && b !== null && c !== null && d !== null && a < d && b > c;
}

function dateWeekStart(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(year, month - 1, day, 12, 0, 0, 0);
  const weekday = value.getDay();
  value.setDate(value.getDate() - (weekday === 0 ? 1 : 0));
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
}

function addCommitment(
  target: Map<string, AssignmentCommitment>,
  commitment: AssignmentCommitment,
): void {
  const slotIdentifier = commitment.schedule_id
    ? "schedule:" + commitment.schedule_id
    : "slot:" + commitment.slot_key;
  const key = slotIdentifier + "|" + commitment.servant_id + "|" + commitment.role;
  if (!target.has(key)) target.set(key, commitment);
}

function buildExistingCommitments(
  input: MonthlyAssignmentOptimizerInput,
): AssignmentCommitment[] {
  const commitments = new Map<string, AssignmentCommitment>();

  for (const schedule of input.schedules) {
    for (const assignment of schedule.assignments) {
      if (!assignment.servant_id) continue;
      addCommitment(commitments, {
        slot_key: schedule.service_date + "|" + schedule.location_id + "|" + schedule.service_name,
        schedule_id: schedule.id,
        service_date: schedule.service_date,
        location_id: schedule.location_id,
        service_name: schedule.service_name,
        start_time: schedule.start_time,
        end_time: schedule.end_time,
        role: assignment.role,
        servant_id: assignment.servant_id,
        source: "existing",
      });
    }
  }

  for (const slot of input.slots) {
    for (const assignment of slot.assignments) {
      if (!assignment.servant_id) continue;
      addCommitment(commitments, {
        slot_key: slot.key,
        schedule_id: slot.schedule_id,
        service_date: slot.service_date,
        location_id: slot.location_id,
        service_name: slot.service_name,
        start_time: slot.start_time,
        end_time: slot.end_time,
        role: assignment.role,
        servant_id: assignment.servant_id,
        source: "existing",
      });
    }
  }

  return [...commitments.values()];
}

function activePreferences(
  servantId: string,
  serviceDate: string,
  preferences: readonly ServingPreferenceRule[],
): ServingPreferenceRule[] {
  return preferences.filter((rule) =>
    rule.servant_id === servantId &&
    rule.active !== false &&
    (!rule.effective_from || rule.effective_from <= serviceDate) &&
    (!rule.effective_until || rule.effective_until >= serviceDate)
  );
}

function hasPreferenceRestriction(
  servantId: string,
  slot: MonthlyScheduleSlot,
  preferences: readonly ServingPreferenceRule[],
): boolean {
  const applicable = activePreferences(servantId, slot.service_date, preferences);
  const weekday = new Date(slot.service_date + "T12:00:00").getDay();
  const timeRules = applicable.filter((rule) => rule.rule_type === "allowed_time_window");
  const serviceRules = applicable.filter((rule) => rule.rule_type === "allowed_service_scope");

  const timeAllowed = !timeRules.length || timeRules.some((rule) => {
    const start = rule.start_time ? String(rule.start_time).slice(0, 5) : "";
    const end = rule.end_time ? String(rule.end_time).slice(0, 5) : "";
    return Boolean(start && end) &&
      (!rule.days_of_week?.length || rule.days_of_week.includes(weekday)) &&
      slot.start_time.slice(0, 5) >= start &&
      slot.end_time.slice(0, 5) <= end;
  });

  const serviceAllowed = !serviceRules.length || serviceRules.some((rule) =>
    rule.location_id === slot.location_id &&
    (!rule.service_names?.length || rule.service_names.includes(slot.service_name))
  );

  return !timeAllowed || !serviceAllowed;
}

function availabilityStatus(
  servantId: string,
  serviceDate: string,
  availability: readonly AssignmentAvailabilityEntry[],
): "unavailable" | "prefer_not" | "available" | "unknown" {
  const statuses = availability
    .filter((item) => item.servant_id === servantId && item.service_date === serviceDate)
    .map((item) => item.status);

  if (statuses.includes("unavailable")) return "unavailable";
  if (statuses.includes("prefer_not")) return "prefer_not";
  if (statuses.includes("available")) return "available";
  return "unknown";
}

function getBlockReasons(
  servant: Servant,
  slot: MonthlyScheduleSlot,
  commitments: readonly AssignmentCommitment[],
  availability: readonly AssignmentAvailabilityEntry[],
  preferences: readonly ServingPreferenceRule[],
): BlockReason[] {
  const reasons: BlockReason[] = [];
  if (servant.active !== true) reasons.push("inactive");

  if (availabilityStatus(servant.id, slot.service_date, availability) === "unavailable") {
    reasons.push("unavailable");
  }

  if (hasPreferenceRestriction(servant.id, slot, preferences)) {
    reasons.push("serving_preference");
  }

  for (const commitment of commitments) {
    if (commitment.servant_id !== servant.id) continue;

    const sameSlot = (slot.schedule_id && commitment.schedule_id === slot.schedule_id) ||
      commitment.slot_key === slot.key;
    if (sameSlot) {
      reasons.push("already_in_service");
      continue;
    }

    if (commitment.service_date !== slot.service_date) continue;

    if (commitment.location_id !== slot.location_id) {
      reasons.push("cross_church");
      continue;
    }

    if (intervalsOverlap(
      slot.start_time,
      slot.end_time,
      commitment.start_time,
      commitment.end_time,
    )) {
      reasons.push("overlap");
    }
  }

  return [...new Set(reasons)];
}

function roleProfileFor(
  servantId: string,
  inputProfiles: ReadonlyMap<string, MonthlyHistoricalServantProfile>,
  derivedRoleCounts: ReadonlyMap<string, Record<Role, number>>,
): MonthlyHistoricalServantProfile {
  const supplied = inputProfiles.get(servantId);
  const roleCounts = supplied?.role_counts ??
    derivedRoleCounts.get(servantId) ??
    { FOH: 0, Monitor: 0, Assistant: 0 };
  const primaryRole = supplied?.primary_role ??
    ALL_ROLES
      .filter((role) => (roleCounts[role] ?? 0) > 0)
      .sort((first, second) =>
        (roleCounts[second] ?? 0) - (roleCounts[first] ?? 0) ||
        ALL_ROLES.indexOf(first) - ALL_ROLES.indexOf(second)
      )[0] ??
    null;

  return {
    servant_id: servantId,
    primary_role: primaryRole,
    role_counts: roleCounts,
  };
}

function deriveRecentRoleCounts(
  schedules: readonly ScheduleView[],
  monthStart: string,
): Map<string, Record<Role, number>> {
  const cutoff = dateMinusDays(monthStart, 180);
  const result = new Map<string, Record<Role, number>>();

  for (const schedule of schedules) {
    if (schedule.service_date < cutoff || schedule.service_date >= monthStart) continue;
    for (const assignment of schedule.assignments) {
      if (!assignment.servant_id) continue;
      const counts = result.get(assignment.servant_id) ?? { FOH: 0, Monitor: 0, Assistant: 0 };
      counts[assignment.role] += 1;
      result.set(assignment.servant_id, counts);
    }
  }

  return result;
}

function calculateConsecutiveWeekends(
  servantId: string,
  currentDate: string,
  commitments: readonly AssignmentCommitment[],
): number {
  const servedWeekends = new Set(
    commitments
      .filter((item) => item.servant_id === servantId && item.service_date < currentDate)
      .map((item) => dateWeekStart(item.service_date)),
  );

  let streak = 0;
  let cursor = dateWeekStart(currentDate);
  for (let index = 0; index < 12; index += 1) {
    cursor = dateMinusDays(cursor, 7);
    if (!servedWeekends.has(cursor)) break;
    streak += 1;
  }
  return streak;
}

function scoreCandidate(
  servant: Servant,
  position: RolePosition,
  commitments: readonly AssignmentCommitment[],
  opportunities: ReadonlyMap<string, Set<string>>,
  profiles: ReadonlyMap<string, MonthlyHistoricalServantProfile>,
  derivedRoleCounts: ReadonlyMap<string, Record<Role, number>>,
  availability: readonly AssignmentAvailabilityEntry[],
  month: string,
): number {
  const monthAssignments = commitments.filter((item) =>
    item.servant_id === servant.id && item.service_date.startsWith(month)
  ).length;
  const opportunityCount = Math.max(1, opportunities.get(servant.id)?.size ?? 0);
  const utilization = monthAssignments / opportunityCount;

  const recentStart = dateMinusDays(position.slot.service_date, 60);
  const recent = commitments.filter((item) =>
    item.servant_id === servant.id &&
    item.service_date >= recentStart &&
    item.service_date < position.slot.service_date
  );
  const recentDays = new Set(recent.map((item) => item.service_date)).size;
  const sameDayAssignments = commitments.filter((item) =>
    item.servant_id === servant.id && item.service_date === position.slot.service_date
  ).length;
  const consecutiveWeekends = calculateConsecutiveWeekends(
    servant.id,
    position.slot.service_date,
    commitments,
  );

  const profile = roleProfileFor(servant.id, profiles, derivedRoleCounts);
  const roleHistoryCount = profile.role_counts?.[position.role] ?? 0;
  const roleExperiencePenalty = roleHistoryCount > 0 ? 0 : 2.5;
  const primaryRolePenalty = profile.primary_role && profile.primary_role !== position.role
    ? 2
    : 0;
  // Historical spreadsheet workload is a low-weight long-term balancing prior.
  // The live 60-day schedule history above remains the stronger, current signal.
  const longTermHistoryPenalty = Math.min(
    3,
    (profile.historical_assignments ?? 0) / 80 +
      (profile.historical_serving_days ?? 0) / 80,
  );
  const preferNotPenalty = availabilityStatus(
    servant.id,
    position.slot.service_date,
    availability,
  ) === "prefer_not" ? 30 : 0;

  return utilization * 100 +
    recent.length * 0.65 +
    recentDays * 1.4 +
    sameDayAssignments * 9 +
    consecutiveWeekends * 4 +
    roleExperiencePenalty +
    primaryRolePenalty +
    longTermHistoryPenalty +
    preferNotPenalty;
}

function unfilledReason(
  assignableServants: readonly Servant[],
  allActiveServants: readonly Servant[],
  slot: MonthlyScheduleSlot,
  role: Role,
  baseCommitments: readonly AssignmentCommitment[],
  availability: readonly AssignmentAvailabilityEntry[],
  preferences: readonly ServingPreferenceRule[],
): MonthlyUnfilledPositionReason {
  if (slot.blocked_reason === "published") return "published_service";
  if (slot.blocked_reason === "pending_request") return "pending_request";
  if (slot.blocked_reason === "preexisting_conflict") return "preexisting_conflict";
  if (!allActiveServants.length) return "no_active_servants";
  if (!assignableServants.length) return "no_auto_assignable_servants";

  const reasonCounts: Record<BlockReason, number> = {
    inactive: 0,
    unavailable: 0,
    serving_preference: 0,
    already_in_service: 0,
    cross_church: 0,
    overlap: 0,
  };

  for (const servant of assignableServants) {
    for (const reason of getBlockReasons(
      servant,
      slot,
      baseCommitments,
      availability,
      preferences,
    )) {
      reasonCounts[reason] += 1;
    }
  }

  if (reasonCounts.unavailable === assignableServants.length) return "unavailable";
  if (reasonCounts.serving_preference === assignableServants.length) return "serving_preference";
  if (reasonCounts.cross_church === assignableServants.length) return "cross_church_conflict";
  if (reasonCounts.overlap === assignableServants.length) return "overlapping_service";
  if (
    reasonCounts.serving_preference + reasonCounts.unavailable === assignableServants.length &&
    reasonCounts.serving_preference > 0
  ) return "serving_restriction";

  return "no_eligible_candidate";
}

function countBlockedCandidates(
  activeServants: readonly Servant[],
  slot: MonthlyScheduleSlot,
  commitments: readonly AssignmentCommitment[],
  availability: readonly AssignmentAvailabilityEntry[],
  preferences: readonly ServingPreferenceRule[],
): number {
  return activeServants.filter((servant) =>
    getBlockReasons(servant, slot, commitments, availability, preferences).length > 0
  ).length;
}

/**
 * Allocates vacant FOH and Monitor positions first, then optional Assistant
 * positions. Existing assignments are never removed or replaced.
 *
 * Missing availability is eligible. Unavailability and saved serving
 * restrictions are hard constraints; prefer_not is a strong soft penalty.
 * All conflict checks run against every supplied schedule, including
 * non-selected churches, so same-day cross-church conflicts remain blocked.
 */
export function optimizeMonthlyAssignments(
  input: MonthlyAssignmentOptimizerInput,
): MonthlyAssignmentOptimizerResult {
  const errors = (input.dataErrors ?? []).filter(Boolean);
  if (errors.length) return { ok: false, reason: "data_unavailable", errors };
  if (!input.slots.length) return { ok: false, reason: "no_service_slots" };

  const excludedServantIds = new Set(input.autoAssignmentExcludedServantIds ?? []);
  const allActiveServants = input.servants.filter((servant) => servant.active === true);
  const activeServants = allActiveServants.filter((servant) =>
    !excludedServantIds.has(servant.id)
  );
  const month = input.slots[0].service_date.slice(0, 7);
  const baseCommitments = buildExistingCommitments(input);
  const generatedCommitments: AssignmentCommitment[] = [];
  const generatedAssignments: MonthlyGeneratedAssignment[] = [];
  const preexistingConflictSlots = new Map<string, string[]>();
  const unfilledPositions: MonthlyUnfilledPosition[] = [];
  const warnings: string[] = [];
  const positionList: RolePosition[] = [];
  const lockedAssignmentCount = input.slots.reduce(
    (count, slot) => count + slot.assignments.length,
    0,
  );
  const includeAssistant = input.includeAssistant !== false;
  const servantDirectory = new Map(input.servants.map((servant) => [servant.id, servant]));

  for (const slot of input.slots) {
    if (slot.blocked_reason) continue;
    const conflicts: string[] = [];
    for (const assignment of slot.assignments) {
      const servant = servantDirectory.get(assignment.servant_id);
      if (!servant || servant.active !== true) {
        conflicts.push(assignment.servant_name + " is inactive or missing from the active servant directory.");
        continue;
      }
      const selfCommitment = baseCommitments.find((item) =>
        item.servant_id === assignment.servant_id &&
        item.role === assignment.role &&
        (slot.schedule_id
          ? item.schedule_id === slot.schedule_id
          : item.slot_key === slot.key)
      );
      const otherCommitments = baseCommitments.filter((item) => item !== selfCommitment);
      const reasons = getBlockReasons(
        servant,
        slot,
        otherCommitments,
        input.availability,
        input.preferences,
      );
      if (reasons.length) {
        conflicts.push(
          assignment.servant_name + " has an existing " + reasons.join(", ") + " conflict."
        );
      }
    }
    if (conflicts.length) preexistingConflictSlots.set(slot.key, conflicts);
  }

  for (const slot of input.slots) {
    const roles = includeAssistant ? ALL_ROLES : REQUIRED_ROLES;
    for (const role of roles) {
      const filled = slot.assignments.some((assignment) => assignment.role === role);
      if (filled) continue;

      const effectiveBlockReason = slot.blocked_reason ??
        (preexistingConflictSlots.has(slot.key) ? "preexisting_conflict" : null);
      if (effectiveBlockReason) {
        unfilledPositions.push({
          schedule_key: slot.key,
          schedule_id: slot.schedule_id,
          service_date: slot.service_date,
          location_id: slot.location_id,
          service_name: slot.service_name,
          role,
          required: role !== "Assistant",
          reason: effectiveBlockReason === "published"
            ? "published_service"
            : effectiveBlockReason === "pending_request"
            ? "pending_request"
            : "preexisting_conflict",
          blocked_candidate_count: 0,
        });
        continue;
      }

      positionList.push({ slot, role, required: role !== "Assistant" });
    }
  }

  if (preexistingConflictSlots.size) {
    warnings.push(preexistingConflictSlots.size + " service(s) were frozen because an existing assignment has a hard conflict.");
  }

  const opportunities = new Map<string, Set<string>>();
  for (const position of positionList) {
    for (const servant of activeServants) {
      if (getBlockReasons(
        servant,
        position.slot,
        baseCommitments,
        input.availability,
        input.preferences,
      ).length) continue;

      const set = opportunities.get(servant.id) ?? new Set<string>();
      set.add(position.slot.key);
      opportunities.set(servant.id, set);
    }
  }

  const historicalProfiles = new Map(
    (input.historicalProfiles ?? []).map((profile) => [profile.servant_id, profile]),
  );
  const derivedRoleCounts = deriveRecentRoleCounts(input.schedules, month);
  const pendingPositions = [...positionList];

  while (pendingPositions.length) {
    const rankedPositions = pendingPositions.map((position) => {
      const currentCommitments = [...baseCommitments, ...generatedCommitments];
      const candidates = activeServants.filter((servant) =>
        getBlockReasons(
          servant,
          position.slot,
          currentCommitments,
          input.availability,
          input.preferences,
        ).length === 0
      );
      return { position, candidates };
    }).sort((first, second) => {
      if (first.position.required !== second.position.required) {
        return first.position.required ? -1 : 1;
      }
      if (first.candidates.length !== second.candidates.length) {
        return first.candidates.length - second.candidates.length;
      }
      const dateCompare = first.position.slot.service_date.localeCompare(second.position.slot.service_date);
      if (dateCompare) return dateCompare;
      const locationCompare = first.position.slot.location_id.localeCompare(second.position.slot.location_id);
      if (locationCompare) return locationCompare;
      const serviceCompare = first.position.slot.service_name.localeCompare(second.position.slot.service_name);
      if (serviceCompare) return serviceCompare;
      return ALL_ROLES.indexOf(first.position.role) - ALL_ROLES.indexOf(second.position.role);
    });

    const chosen = rankedPositions[0];
    const positionIndex = pendingPositions.indexOf(chosen.position);
    pendingPositions.splice(positionIndex, 1);

    if (!chosen.candidates.length) {
      const currentCommitments = [...baseCommitments, ...generatedCommitments];
      unfilledPositions.push({
        schedule_key: chosen.position.slot.key,
        schedule_id: chosen.position.slot.schedule_id,
        service_date: chosen.position.slot.service_date,
        location_id: chosen.position.slot.location_id,
        service_name: chosen.position.slot.service_name,
        role: chosen.position.role,
        required: chosen.position.required,
        reason: unfilledReason(
          activeServants,
          allActiveServants,
          chosen.position.slot,
          chosen.position.role,
          currentCommitments,
          input.availability,
          input.preferences,
        ),
        blocked_candidate_count: countBlockedCandidates(
          activeServants,
          chosen.position.slot,
          currentCommitments,
          input.availability,
          input.preferences,
        ),
      });
      continue;
    }

    const currentCommitments = [...baseCommitments, ...generatedCommitments];
    const selectedServant = [...chosen.candidates].sort((first, second) => {
      const firstScore = scoreCandidate(
        first,
        chosen.position,
        currentCommitments,
        opportunities,
        historicalProfiles,
        derivedRoleCounts,
        input.availability,
        month,
      );
      const secondScore = scoreCandidate(
        second,
        chosen.position,
        currentCommitments,
        opportunities,
        historicalProfiles,
        derivedRoleCounts,
        input.availability,
        month,
      );
      if (firstScore !== secondScore) return firstScore - secondScore;
      return first.id.localeCompare(second.id);
    })[0];

    const commitment: AssignmentCommitment = {
      slot_key: chosen.position.slot.key,
      schedule_id: chosen.position.slot.schedule_id,
      service_date: chosen.position.slot.service_date,
      location_id: chosen.position.slot.location_id,
      service_name: chosen.position.slot.service_name,
      start_time: chosen.position.slot.start_time,
      end_time: chosen.position.slot.end_time,
      role: chosen.position.role,
      servant_id: selectedServant.id,
      source: "generated",
    };
    generatedCommitments.push(commitment);
    generatedAssignments.push({
      schedule_key: chosen.position.slot.key,
      schedule_id: chosen.position.slot.schedule_id,
      service_date: chosen.position.slot.service_date,
      location_id: chosen.position.slot.location_id,
      service_name: chosen.position.slot.service_name,
      start_time: chosen.position.slot.start_time,
      end_time: chosen.position.slot.end_time,
      role: chosen.position.role,
      servant_id: selectedServant.id,
      servant_name: selectedServant.full_name,
    });

    if (availabilityStatus(
      selectedServant.id,
      chosen.position.slot.service_date,
      input.availability,
    ) === "prefer_not") {
      warnings.push(
        selectedServant.full_name + " prefers not to serve on " +
        chosen.position.slot.service_date + " (" + chosen.position.slot.service_name + ").",
      );
    }
  }

  const finalCommitments = [...baseCommitments, ...generatedCommitments];
  const validationErrors: string[] = [];

  for (const generated of generatedCommitments) {
    const servant = activeServants.find((item) => item.id === generated.servant_id);
    const slot = input.slots.find((item) => item.key === generated.slot_key);
    if (!servant || !slot) {
      validationErrors.push("A generated assignment no longer references a valid servant or service slot.");
      continue;
    }

    const otherCommitments = finalCommitments.filter((item) => item !== generated);
    const blocks = getBlockReasons(
      servant,
      slot,
      otherCommitments,
      input.availability,
      input.preferences,
    ).filter((reason) => reason !== "already_in_service" || !otherCommitments.some((item) =>
      item.servant_id === servant.id &&
      (item.schedule_id && item.schedule_id === slot.schedule_id || item.slot_key === slot.key)
    ));

    if (blocks.length) {
      validationErrors.push(
        servant.full_name + " has an invalid generated " + generated.role +
        " assignment on " + generated.service_date + ": " + blocks.join(", "),
      );
    }
  }

  if (validationErrors.length) {
    return {
      ok: false,
      reason: "final_validation_failed",
      errors: validationErrors,
    };
  }

  const generatedByServant = new Map<string, number>();
  const preferNotByServant = new Map<string, number>();
  for (const assignment of generatedAssignments) {
    generatedByServant.set(
      assignment.servant_id,
      (generatedByServant.get(assignment.servant_id) ?? 0) + 1,
    );
    if (availabilityStatus(
      assignment.servant_id,
      assignment.service_date,
      input.availability,
    ) === "prefer_not") {
      preferNotByServant.set(
        assignment.servant_id,
        (preferNotByServant.get(assignment.servant_id) ?? 0) + 1,
      );
    }
  }

  const monthCommitments = finalCommitments.filter((item) => item.service_date.startsWith(month));
  const workloads: MonthlyServantWorkload[] = activeServants
    .map((servant) => {
      const servantMonth = monthCommitments.filter((item) => item.servant_id === servant.id);
      const existingAssignments = servantMonth.filter((item) => item.source === "existing").length;
      const generatedCount = generatedByServant.get(servant.id) ?? 0;
      const days = new Set(servantMonth.map((item) => item.service_date));
      const recentStart = dateMinusDays(month + "-01", 60);
      const recent = finalCommitments.filter((item) =>
        item.servant_id === servant.id &&
        item.service_date >= recentStart &&
        item.service_date < month + "-01"
      );
      const roleCounts: Record<Role, number> = { FOH: 0, Monitor: 0, Assistant: 0 };
      for (const item of servantMonth) roleCounts[item.role] += 1;
      const opportunityCount = opportunities.get(servant.id)?.size ?? 0;
      const totalAssignments = existingAssignments + generatedCount;

      return {
        servant_id: servant.id,
        servant_name: servant.full_name,
        existing_assignments: existingAssignments,
        generated_assignments: generatedCount,
        total_assignments: totalAssignments,
        serving_days: days.size,
        eligible_opportunities: opportunityCount,
        utilization: opportunityCount ? totalAssignments / opportunityCount : 0,
        recent_60_day_assignments: recent.length,
        recent_60_day_days: new Set(recent.map((item) => item.service_date)).size,
        role_counts: roleCounts,
        prefer_not_assignments: preferNotByServant.get(servant.id) ?? 0,
      };
    })
    .filter((workload) =>
      workload.total_assignments > 0 || workload.eligible_opportunities > 0
    )
    .sort((first, second) =>
      second.total_assignments - first.total_assignments ||
      first.servant_name.localeCompare(second.servant_name)
    );

  const requiredPositionCount = input.slots.length * REQUIRED_ROLES.length;
  const existingRequiredCount = input.slots.reduce(
    (count, slot) => count + slot.assignments.filter((assignment) =>
      REQUIRED_ROLES.includes(assignment.role)
    ).length,
    0,
  );
  const generatedRequiredCount = generatedAssignments.filter((assignment) =>
    REQUIRED_ROLES.includes(assignment.role)
  ).length;
  const filledRequiredPositionCount = existingRequiredCount + generatedRequiredCount;
  const unfilledRequiredPositionCount = unfilledPositions.filter((position) => position.required).length;
  const generatedAssistantCount = generatedAssignments.filter((assignment) =>
    assignment.role === "Assistant"
  ).length;
  const unfilledOptionalAssistantCount = unfilledPositions.filter((position) =>
    position.role === "Assistant"
  ).length;
  const skippedServiceCount = input.slots.filter((slot) =>
    slot.blocked_reason !== null || preexistingConflictSlots.has(slot.key)
  ).length;

  return {
    ok: true,
    assignments: generatedAssignments,
    unfilledPositions,
    workloads,
    warnings: [...new Set(warnings)],
    lockedAssignmentCount,
    generatedAssignmentCount: generatedAssignments.length,
    requiredPositionCount,
    filledRequiredPositionCount,
    unfilledRequiredPositionCount,
    generatedAssistantCount,
    unfilledOptionalAssistantCount,
    skippedServiceCount,
  };
}
