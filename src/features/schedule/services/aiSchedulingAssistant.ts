import type { Location, Role, Servant } from "../../../types.ts";
import type { AvailabilityRecord } from "../../availability/services/recurringAvailability.ts";
import type {
  MonthlyGeneratedAssignment,
  MonthlyServantWorkload,
  MonthlyUnfilledPosition,
} from "./monthlyAssignmentOptimizer.ts";
import type { MonthlyScheduleSlot } from "./monthlyScheduleGeneration.ts";

const ROLES: Role[] = ["FOH", "Monitor", "Assistant"];

export type AiSchedulingSnapshot = {
  month: string;
  summary: {
    serviceCount: number;
    requiredPositions: number;
    filledRequiredPositions: number;
    unfilledRequiredPositions: number;
    proposedAssignments: number;
    frozenServices: number;
  };
  churches: Array<{
    label: string;
    totalServiceCount: number;
    omittedServiceCount: number;
    vacancySummary: Array<{ role: Role; reason: string; count: number }>;
    services: Array<{
      label: string;
      date: string;
      startTime: string;
      endTime: string;
      special: boolean;
      frozen: boolean;
      assignments: Array<{
        servant: string;
        role: Role;
        source: "existing" | "proposed" | "manual_preview";
        qualifiedRoles: Role[];
        availability: "available" | "unavailable" | "prefer_not" | "unknown";
      }>;
      vacancies: Array<{
        role: Role;
        required: boolean;
        reason: string;
        blockedCandidateCount: number;
      }>;
    }>;
  }>;
  workload: Array<{
    servant: string;
    totalAssignments: number;
    servingDays: number;
    utilizationPercent: number;
    roleCounts: Record<Role, number>;
  }>;
};

/**
 * Builds a deliberately anonymized AI context. Names, IDs, emails, contact
 * details, CG data, notes and authentication metadata never leave the browser.
 */
export function buildAiSchedulingSnapshot(input: {
  month: string;
  locations: readonly Location[];
  slots: readonly MonthlyScheduleSlot[];
  generatedAssignments: readonly MonthlyGeneratedAssignment[];
  unfilledPositions: readonly MonthlyUnfilledPosition[];
  workloads: readonly MonthlyServantWorkload[];
  servants: readonly Servant[];
  availability: readonly AvailabilityRecord[];
}): AiSchedulingSnapshot {
  const servantIds = new Set<string>();
  for (const slot of input.slots) {
    for (const assignment of slot.assignments) {
      if (assignment.servant_id) servantIds.add(assignment.servant_id);
    }
  }
  for (const assignment of input.generatedAssignments) servantIds.add(assignment.servant_id);
  for (const workload of input.workloads) servantIds.add(workload.servant_id);

  const orderedServantIds = [...servantIds].sort();
  const servantLabels = new Map(orderedServantIds.map((id, index) => [id, "Servant " + (index + 1)]));
  const servantsById = new Map(input.servants.map((servant) => [servant.id, servant]));
  const generatedBySlot = new Map<string, MonthlyGeneratedAssignment[]>();
  for (const assignment of input.generatedAssignments) {
    const items = generatedBySlot.get(assignment.schedule_key) ?? [];
    items.push(assignment);
    generatedBySlot.set(assignment.schedule_key, items);
  }
  const vacanciesBySlot = new Map<string, MonthlyUnfilledPosition[]>();
  for (const vacancy of input.unfilledPositions) {
    const items = vacanciesBySlot.get(vacancy.schedule_key) ?? [];
    items.push(vacancy);
    vacanciesBySlot.set(vacancy.schedule_key, items);
  }

  const includedChurchIds = new Set(input.slots.map((slot) => slot.location_id));
  const churchIds = [
    ...input.locations.filter((location) => includedChurchIds.has(location.id)).map((location) => location.id),
    ...[...includedChurchIds].filter((id) => !input.locations.some((location) => location.id === id)),
  ];
  const churchLabels = new Map(churchIds.map((id, index) => [id, "Church " + (index + 1)]));
  const serviceLabels = new Map<string, string>();
  for (const locationId of churchIds) {
    const services = input.slots
      .filter((slot) => slot.location_id === locationId)
      .slice()
      .sort((a, b) =>
        a.service_date.localeCompare(b.service_date) ||
        a.start_time.localeCompare(b.start_time) ||
        a.service_name.localeCompare(b.service_name)
      );
    services.forEach((slot, index) => serviceLabels.set(slot.key, "Service " + (index + 1)));
  }

  const getAvailability = (servantId: string, date: string) => {
    const statuses = input.availability
      .filter((item) => item.servant_id === servantId && item.service_date === date)
      .map((item) => item.status);
    if (statuses.includes("unavailable")) return "unavailable" as const;
    if (statuses.includes("prefer_not")) return "prefer_not" as const;
    if (statuses.includes("available")) return "available" as const;
    return "unknown" as const;
  };

  const churches = churchIds.map((locationId) => {
    const churchSlots = input.slots
      .filter((slot) => slot.location_id === locationId)
      .slice()
      .sort((a, b) =>
        a.service_date.localeCompare(b.service_date) ||
        a.start_time.localeCompare(b.start_time) ||
        a.service_name.localeCompare(b.service_name)
      );

    const allServices = churchSlots.map((slot) => {
        const assignments: AiSchedulingSnapshot["churches"][number]["services"][number]["assignments"] = slot.assignments.map((assignment) => {
          const servant = servantsById.get(assignment.servant_id);
          const isManual = Boolean(assignment.preview_manual);
          const isTeamProposal = Boolean(assignment.preview_team);
          return {
            servant: servantLabels.get(assignment.servant_id) ?? "Unlisted servant",
            role: assignment.role,
            source: isManual ? "manual_preview" as const : isTeamProposal ? "proposed" as const : "existing" as const,
            qualifiedRoles: servant?.qualified_roles ?? ROLES,
            availability: getAvailability(assignment.servant_id, slot.service_date),
          };
        });

        for (const assignment of generatedBySlot.get(slot.key) ?? []) {
          if (assignments.some((item) => item.role === assignment.role)) continue;
          const servant = servantsById.get(assignment.servant_id);
          assignments.push({
            servant: servantLabels.get(assignment.servant_id) ?? "Unlisted servant",
            role: assignment.role,
            source: assignment.preview_manual ? "manual_preview" : "proposed",
            qualifiedRoles: servant?.qualified_roles ?? ROLES,
            availability: getAvailability(assignment.servant_id, slot.service_date),
          });
        }

        return {
          label: serviceLabels.get(slot.key) ?? "Service",
          date: slot.service_date,
          startTime: slot.start_time.slice(0, 5),
          endTime: slot.end_time.slice(0, 5),
          special: slot.status === "new_special" || slot.template_id === null,
          frozen: slot.blocked_reason !== null,
          assignments,
          vacancies: (vacanciesBySlot.get(slot.key) ?? []).map((vacancy) => ({
            role: vacancy.role,
            required: vacancy.required,
            reason: vacancy.reason,
            blockedCandidateCount: vacancy.blocked_candidate_count,
          })),
        };
      });
    const priorityServices = allServices.slice().sort((a, b) =>
      (b.vacancies.length - a.vacancies.length) ||
      (Number(b.special) - Number(a.special)) ||
      (Number(a.frozen) - Number(b.frozen)) ||
      a.date.localeCompare(b.date) ||
      a.startTime.localeCompare(b.startTime)
    );
    const sampledServices = priorityServices.slice(0, 3).sort((a, b) =>
      a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)
    );
    const vacancyCounts = new Map<string, { role: Role; reason: string; count: number }>();
    for (const vacancy of input.unfilledPositions.filter((item) => item.location_id === locationId)) {
      const key = vacancy.role + "|" + vacancy.reason;
      const current = vacancyCounts.get(key) ?? { role: vacancy.role, reason: vacancy.reason, count: 0 };
      current.count += 1;
      vacancyCounts.set(key, current);
    }

    return {
      label: churchLabels.get(locationId) ?? "Church",
      totalServiceCount: churchSlots.length,
      omittedServiceCount: Math.max(0, churchSlots.length - sampledServices.length),
      vacancySummary: [...vacancyCounts.values()].slice(0, 12),
      services: sampledServices,
    };
  });

  const filledRequiredPositions = input.slots.reduce((count, slot) => {
    const filledRoles = new Set<Role>();
    for (const assignment of slot.assignments) {
      if (assignment.role === "FOH" || assignment.role === "Monitor") filledRoles.add(assignment.role);
    }
    for (const assignment of generatedBySlot.get(slot.key) ?? []) {
      if (assignment.role === "FOH" || assignment.role === "Monitor") filledRoles.add(assignment.role);
    }
    return count + filledRoles.size;
  }, 0);

  return {
    month: input.month,
    summary: {
      serviceCount: input.slots.length,
      requiredPositions: input.slots.length * 2,
      filledRequiredPositions,
      unfilledRequiredPositions: input.unfilledPositions.filter((item) => item.required).length,
      proposedAssignments: input.generatedAssignments.length,
      frozenServices: input.slots.filter((slot) => slot.blocked_reason !== null).length,
    },
    churches,
    workload: input.workloads.slice().sort((a, b) => b.utilization - a.utilization).slice(0, 8).map((workload) => ({
      servant: servantLabels.get(workload.servant_id) ?? "Unlisted servant",
      totalAssignments: workload.total_assignments,
      servingDays: workload.serving_days,
      utilizationPercent: Math.round(workload.utilization * 100),
      roleCounts: workload.role_counts,
    })),
  };
}

export async function requestAiSchedulingExplanation(
  endpoint: string,
  accessToken: string,
  snapshot: AiSchedulingSnapshot,
  fetcher: typeof fetch = fetch,
): Promise<{ explanation: string; cached: boolean }> {
  const snapshotJson = JSON.stringify(snapshot);
  const snapshotBytes = new TextEncoder().encode(snapshotJson).byteLength;
  if (snapshotBytes > 5_600) {
    throw new Error("The AI analysis summary is too large to send safely. Reduce the monthly preview details and try again. No schedule changes were made.");
  }
  const requestBody = JSON.stringify({ kind: "preview_explanation", snapshot });
  const requestBytes = new TextEncoder().encode(requestBody).byteLength;
  if (requestBytes > 7_500) {
    throw new Error("The AI analysis summary is too large to send safely. Reduce the monthly preview details and try again. No schedule changes were made.");
  }
  const response = await fetcher(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + accessToken,
    },
    body: requestBody,
  });

  const payload = await response.json().catch(() => ({})) as {
    explanation?: unknown;
    cached?: unknown;
    error?: unknown;
    reason?: unknown;
    limits?: {
      gmsInferencesPerUtcDay?: number;
      perAdminInferencesPerUtcDay?: number;
      gmsRequestsPerUtcDay?: number;
      perAdminRequestsPerUtcDay?: number;
    };
  };

  if (!response.ok) {
    if (response.status === 429 && payload.error === "monthly_free_limit_reached") {
      const reasons: Record<string, string> = {
        gms_request_limit: "The GMS monthly AI request allowance has been reached. Please try again after the next monthly reset.",
        admin_request_limit: "Your monthly AI request allowance has been reached. Please try again after the next monthly reset.",
        gms_monthly_limit: "The GMS monthly free AI inference allowance has been reached. Please try again after the next monthly reset.",
        admin_monthly_limit: "Your monthly free AI inference allowance has been reached. Please try again after the next monthly reset.",
      };
      throw new Error((typeof payload.reason === "string" && reasons[payload.reason]) ||
        "The free GMS AI monthly limit has been reached. Try again after the next monthly reset.");
    }
    const messages: Record<number, string> = {
      401: "Your sign-in session is no longer valid. Sign in again before using the AI assistant.",
      403: "The AI assistant is not enabled for this account or application origin.",
      413: "The AI analysis payload is too large. The preview was not changed; reduce the monthly preview details and try again.",
      429: "The free GMS AI monthly limit has been reached. Try again after the next monthly reset.",
      503: "The free AI service is disabled or temporarily unavailable.",
    };
    throw new Error(messages[response.status] ?? "The AI assistant could not complete this request. No schedule changes were made.");
  }

  if (typeof payload.explanation !== "string" || !payload.explanation.trim()) {
    throw new Error("The AI service returned an empty explanation.");
  }

  return {
    explanation: payload.explanation.slice(0, 4000),
    cached: payload.cached === true,
  };
}
