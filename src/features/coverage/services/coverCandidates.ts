import type { ScheduleView, Servant } from "../../../types";
import type { AvailabilityRecord, ServingPreferenceRecord, ServingRequestRecord } from "../../../shared/contracts/scheduling.ts";

export type CoverCandidate = {
  servant: Servant;
  availability: AvailabilityRecord["status"] | null;
  recentServingDays: number;
  notes: string[];
};

function minutes(time: string): number {
  const [hours = "0", mins = "0"] = String(time).slice(0, 5).split(":");
  return Number(hours) * 60 + Number(mins);
}

function eligibleForPreference(
  candidateId: string,
  schedule: ScheduleView,
  preferences: readonly ServingPreferenceRecord[],
): boolean {
  const rules = preferences.filter(rule =>
    rule.servant_id === candidateId && rule.active !== false &&
    (!rule.effective_from || rule.effective_from <= schedule.service_date) &&
    (!rule.effective_until || rule.effective_until >= schedule.service_date),
  );
  const weekday = new Date(`${schedule.service_date}T12:00:00`).getDay();
  const timeRules = rules.filter(rule => rule.rule_type === "allowed_time_window");
  const scopeRules = rules.filter(rule => rule.rule_type === "allowed_service_scope");
  const timeAllowed = !timeRules.length || timeRules.some(rule =>
    (!rule.days_of_week?.length || rule.days_of_week.includes(weekday)) &&
    schedule.start_time.slice(0, 5) >= String(rule.start_time).slice(0, 5) &&
    schedule.end_time.slice(0, 5) <= String(rule.end_time).slice(0, 5),
  );
  const serviceAllowed = !scopeRules.length || scopeRules.some(rule =>
    rule.location_id === schedule.location_id &&
    (!rule.service_names?.length || rule.service_names.includes(schedule.service_name)),
  );
  return timeAllowed && serviceAllowed;
}

function recentServingDays(
  servantId: string,
  schedule: ScheduleView,
  schedules: readonly ScheduleView[],
): number {
  const from = new Date(`${schedule.service_date}T12:00:00`);
  from.setDate(from.getDate() - 30);
  const fromDate = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, "0")}-${String(from.getDate()).padStart(2, "0")}`;
  return new Set(schedules
    .filter(item => item.service_date >= fromDate && item.service_date < schedule.service_date)
    .filter(item => item.assignments.some(assignment => assignment.servant_id === servantId))
    .map(item => item.service_date)).size;
}

/** Finds qualified servants who can cover a replacement request without a known schedule conflict. */
export function findCoverCandidates(
  request: ServingRequestRecord,
  schedule: ScheduleView | undefined,
  schedules: readonly ScheduleView[],
  servants: readonly Servant[],
  availability: readonly AvailabilityRecord[],
  preferences: readonly ServingPreferenceRecord[],
): CoverCandidate[] {
  if (!schedule || !request.assignment_id) return [];
  const assignment = schedule.assignments.find(item => item.id === request.assignment_id);
  if (!assignment || assignment.servant_id !== request.requester_servant_id) return [];

  const candidates: CoverCandidate[] = [];
  for (const servant of servants) {
    if (!servant.active || servant.id === assignment.servant_id) continue;
    const qualifiedRoles = servant.qualified_roles_by_location;
    const qualified = qualifiedRoles
      ? Array.isArray(qualifiedRoles[schedule.location_id]) && qualifiedRoles[schedule.location_id].includes(assignment.role)
      : !Array.isArray(servant.qualified_roles) || servant.qualified_roles.includes(assignment.role);
    if (!qualified || !eligibleForPreference(servant.id, schedule, preferences)) continue;

    const availabilityStatus = availability.find(record =>
      record.servant_id === servant.id && record.service_date === schedule.service_date,
    )?.status ?? null;
    if (availabilityStatus === "unavailable") continue;

    const hasSameServiceRole = schedule.assignments.some(item =>
      item.id !== assignment.id && item.servant_id === servant.id,
    );
    if (hasSameServiceRole) continue;

    const sameDateAssignments = schedules.flatMap(item =>
      item.service_date === schedule.service_date && item.id !== schedule.id
        ? item.assignments.filter(existing => existing.servant_id === servant.id).map(() => item)
        : [],
    );
    if (sameDateAssignments.some(item => item.location_id !== schedule.location_id)) continue;
    if (sameDateAssignments.some(item =>
      item.location_id === schedule.location_id &&
      minutes(schedule.start_time) < minutes(item.end_time) &&
      minutes(schedule.end_time) > minutes(item.start_time),
    )) continue;

    const workload = recentServingDays(servant.id, schedule, schedules);
    const notes = [
      availabilityStatus === "available" ? "Marked available" : "No availability response",
      workload === 0 ? "No recent serving days" : `${workload} serving day${workload === 1 ? "" : "s"} in the previous 30 days`,
    ];
    if (availabilityStatus === "prefer_not") notes.push("Prefers not to serve on this date");
    candidates.push({ servant, availability: availabilityStatus, recentServingDays: workload, notes });
  }

  return candidates.sort((left, right) => {
    const statusRank = (status: CoverCandidate["availability"]) =>
      status === "available" ? 0 : status === "prefer_not" ? 2 : 1;
    return statusRank(left.availability) - statusRank(right.availability) ||
      left.recentServingDays - right.recentServingDays ||
      left.servant.full_name.localeCompare(right.servant.full_name);
  });
}
