import type { Location, Role } from "../../../types.ts";
import {
  getMonthlyAssignmentCandidates,
  MAX_SERVICES_PER_DAY,
  type MonthlyAssignmentOptimizerInput,
  type MonthlyAssignmentOptimizerResult,
} from "./monthlyAssignmentOptimizer.ts";
import type { MonthlyScheduleSlot } from "./monthlyScheduleGeneration.ts";

export type MonthlyServingTeamPattern =
  | "alam_two"
  | "alam_three"
  | "bsd_two"
  | "karawaci_one"
  | "independent";

export type MonthlyServingTeamWeek = {
  key: string;
  location: Location;
  weekNumber: number;
  label: string;
  defaultPattern: MonthlyServingTeamPattern;
  options: Array<{ value: MonthlyServingTeamPattern; label: string }>;
};

export type MonthlyServingTeamGroup = {
  id: string;
  locationId: string;
  locationName: string;
  serviceDate: string;
  weekNumber: number;
  teamNumber: number;
  label: string;
  slotKeys: string[];
};

export type MonthlyServingTeamAssignmentResult = {
  slots: MonthlyScheduleSlot[];
  warnings: string[];
  assignedGroupCount: number;
};

const ROLE_ORDER: Role[] = ["FOH", "Monitor", "Assistant"];

function normalizedName(value: string): string {
  return value.trim().toLowerCase();
}

export function defaultServingTeamPattern(locationName: string): MonthlyServingTeamPattern {
  const name = normalizedName(locationName);
  if (name.includes("alam sutera")) return "alam_three";
  if (name.includes("bsd")) return "bsd_two";
  if (name.includes("karawaci")) return "karawaci_one";
  return "independent";
}

export function servingTeamPatternOptions(
  locationName: string,
): Array<{ value: MonthlyServingTeamPattern; label: string }> {
  const defaults = defaultServingTeamPattern(locationName);
  if (defaults === "alam_three") {
    return [
      { value: "alam_three", label: "3 teams · (1–2), (3–5), (6–7)" },
      { value: "alam_two", label: "2 teams · (1–3), (4–7)" },
      { value: "independent", label: "Optimize each service independently" },
    ];
  }
  if (defaults === "bsd_two") {
    return [
      { value: "bsd_two", label: "2 teams · (1–2), (3–4)" },
      { value: "independent", label: "Optimize each service independently" },
    ];
  }
  if (defaults === "karawaci_one") {
    return [
      { value: "karawaci_one", label: "1 team · (1–3)" },
      { value: "independent", label: "Optimize each service independently" },
    ];
  }
  return [{ value: "independent", label: "Optimize each service independently" }];
}

function weekNumberFor(date: string): number {
  return Math.ceil(Number(date.slice(8, 10)) / 7);
}

function dateKey(year: number, month: number, day: number): string {
  return year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
}

export function buildMonthlyServingTeamWeeks(input: {
  month: string;
  locations: readonly Location[];
  templates: readonly { location_id: string; day_of_week: number; active?: boolean; service_name: string }[];
  selectedLocationIds: readonly string[];
}): MonthlyServingTeamWeek[] {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(input.month);
  if (!match) return [];
  const year = Number(match[1]);
  const month = Number(match[2]);
  const lastDay = new Date(year, month, 0).getDate();
  const sundayWeeks = new Set<number>();

  for (let day = 1; day <= lastDay; day += 1) {
    if (new Date(year, month - 1, day, 12).getDay() === 0) {
      sundayWeeks.add(Math.ceil(day / 7));
    }
  }

  return input.locations
    .filter((location) =>
      input.selectedLocationIds.includes(location.id) &&
      input.templates.some((template) =>
        template.location_id === location.id &&
        template.active !== false &&
        template.day_of_week === 0 &&
        /(?:^| - )Service [1-9]\d*$/i.test(template.service_name.trim())
      )
    )
    .flatMap((location) => {
      const defaultPattern = defaultServingTeamPattern(location.name);
      const options = servingTeamPatternOptions(location.name);
      return [...sundayWeeks].sort((a, b) => a - b).map((weekNumber) => {
        const firstDay = (weekNumber - 1) * 7 + 1;
        const lastWeekDay = Math.min(weekNumber * 7, lastDay);
        const start = dateKey(year, month, firstDay);
        const end = dateKey(year, month, lastWeekDay);
        const monthLabel = new Date(year, month - 1, firstDay, 12).toLocaleDateString("en-US", { month: "short" });
        return {
          key: location.id + "|" + weekNumber,
          location,
          weekNumber,
          label: "Week " + weekNumber + " · " + start.slice(8, 10) + "–" + end.slice(8, 10) + " " + monthLabel,
          defaultPattern,
          options,
        };
      });
    });
}

function serviceNumber(serviceName: string): number | null {
  const match = /(?:^| - )Service ([1-9]\d*)$/i.exec(serviceName.trim());
  return match ? Number(match[1]) : null;
}

function serviceNumberGroups(pattern: MonthlyServingTeamPattern): number[][] {
  switch (pattern) {
    case "alam_two": return [[1, 2, 3], [4, 5, 6, 7]];
    case "alam_three": return [[1, 2], [3, 4, 5], [6, 7]];
    case "bsd_two": return [[1, 2], [3, 4]];
    case "karawaci_one": return [[1, 2, 3]];
    case "independent": return [];
  }
}

export function buildMonthlyServingTeamGroups(input: {
  slots: readonly MonthlyScheduleSlot[];
  locations: readonly Location[];
  patternsByWeek: Readonly<Record<string, MonthlyServingTeamPattern>>;
}): MonthlyServingTeamGroup[] {
  const locationNames = new Map(input.locations.map((location) => [location.id, location.name]));
  const buckets = new Map<string, MonthlyScheduleSlot[]>();

  for (const slot of input.slots) {
    const key = slot.location_id + "|" + slot.service_date;
    const items = buckets.get(key) ?? [];
    items.push(slot);
    buckets.set(key, items);
  }

  const groups: MonthlyServingTeamGroup[] = [];
  for (const bucket of buckets.values()) {
    const sorted = bucket.slice().sort((a, b) =>
      a.start_time.localeCompare(b.start_time) ||
      a.service_name.localeCompare(b.service_name)
    );
    const first = sorted[0];
    const locationName = locationNames.get(first.location_id) ?? "";
    const weekNumber = weekNumberFor(first.service_date);
    const numberedServiceSlots = sorted;
    const saturdaySlots = sorted.filter((slot) => new Date(slot.service_date + "T12:00:00").getDay() === 6);

    if (normalizedName(locationName).includes("alam sutera") && saturdaySlots.length) {
      const teen = saturdaySlots.filter((slot) => /(?:^| - )AOG Teen$/i.test(slot.service_name.trim()));
      const youth = saturdaySlots.filter((slot) => /(?:^| - )AOG Youth$/i.test(slot.service_name.trim()));
      const paired = [...teen, ...youth].sort((a, b) =>
        a.start_time.localeCompare(b.start_time) || a.service_name.localeCompare(b.service_name)
      );
      if (paired.length === 2) {
        groups.push({
          id: first.location_id + "|" + first.service_date + "|aog",
          locationId: first.location_id,
          locationName,
          serviceDate: first.service_date,
          weekNumber,
          teamNumber: 1,
          label: "AOG shared team · Teen + Youth",
          slotKeys: paired.map((slot) => slot.key),
        });
      }
    }

    const patternKey = first.location_id + "|" + weekNumber;
    const pattern = input.patternsByWeek[patternKey] ?? defaultServingTeamPattern(locationName);
    const definitions = serviceNumberGroups(pattern);
    if (!definitions.length) continue;

    const numberedSlots = numberedServiceSlots
      .map((slot) => ({ slot, number: serviceNumber(slot.service_name) }))
      .filter((item): item is { slot: MonthlyScheduleSlot; number: number } => item.number !== null);
    for (let index = 0; index < definitions.length; index += 1) {
      const numbers = new Set(definitions[index]);
      const members = numberedSlots
        .filter((item) => numbers.has(item.number))
        .map((item) => item.slot)
        .sort((a, b) => a.start_time.localeCompare(b.start_time) || a.service_name.localeCompare(b.service_name));
      if (members.length < 2) continue;
      const numberLabel = definitions[index].length === 1
        ? String(definitions[index][0])
        : String(definitions[index][0]) + "–" + String(definitions[index][definitions[index].length - 1]);
      groups.push({
        id: first.location_id + "|" + first.service_date + "|team-" + (index + 1),
        locationId: first.location_id,
        locationName,
        serviceDate: first.service_date,
        weekNumber,
        teamNumber: index + 1,
        label: "Team " + (index + 1) + " · Services " + numberLabel,
        slotKeys: members.map((slot) => slot.key),
      });
    }
  }

  return groups.sort((a, b) =>
    a.serviceDate.localeCompare(b.serviceDate) ||
    a.locationName.localeCompare(b.locationName) ||
    a.teamNumber - b.teamNumber ||
    a.id.localeCompare(b.id)
  );
}

function timeToMinutes(value: string): number {
  const [hour, minute] = value.slice(0, 5).split(":").map(Number);
  return hour * 60 + minute;
}

function groupHasOverlappingServices(slots: readonly MonthlyScheduleSlot[]): boolean {
  const ordered = slots.slice().sort((a, b) => a.start_time.localeCompare(b.start_time));
  for (let index = 1; index < ordered.length; index += 1) {
    if (timeToMinutes(ordered[index].start_time) < timeToMinutes(ordered[index - 1].end_time)) {
      return true;
    }
  }
  return false;
}

function canCoverTeamWithinDailyServiceLimit(input: {
  schedules: MonthlyAssignmentOptimizerInput["schedules"];
  currentSlots: readonly MonthlyScheduleSlot[];
  proposedSlots: readonly MonthlyScheduleSlot[];
  servantId: string;
  serviceDate: string;
}): boolean {
  const serviceKeys = new Set<string>();

  for (const schedule of input.schedules) {
    if (
      schedule.service_date !== input.serviceDate ||
      !schedule.assignments.some((assignment) =>
        assignment.servant_id === input.servantId &&
        assignment.confirmation_status !== "declined"
      )
    ) continue;
    serviceKeys.add("schedule:" + schedule.id);
  }

  for (const slot of input.currentSlots) {
    if (
      slot.service_date !== input.serviceDate ||
      !slot.assignments.some((assignment) =>
        assignment.servant_id === input.servantId &&
        assignment.confirmation_status !== "declined"
      )
    ) continue;
    serviceKeys.add(slot.schedule_id ? "schedule:" + slot.schedule_id : "slot:" + slot.key);
  }

  for (const slot of input.proposedSlots) {
    serviceKeys.add(slot.schedule_id ? "schedule:" + slot.schedule_id : "slot:" + slot.key);
  }

  return serviceKeys.size <= MAX_SERVICES_PER_DAY;
}

/**
 * Seeds one shared, eligibility-checked servant per role into every service
 * belonging to a configured serving team. These are generated preview
 * assignments, not manual edits or persisted commitments.
 */
export function applyMonthlyServingTeamAssignments(input: {
  optimizerInput: Omit<MonthlyAssignmentOptimizerInput, "slots">;
  slots: readonly MonthlyScheduleSlot[];
  baseline: Extract<MonthlyAssignmentOptimizerResult, { ok: true }>;
  groups: readonly MonthlyServingTeamGroup[];
}): MonthlyServingTeamAssignmentResult {
  let workingSlots = input.slots.map((slot) => ({ ...slot, assignments: slot.assignments.slice() }));
  const warnings: string[] = [];
  let assignedGroupCount = 0;
  const workloadById = new Map(input.baseline.workloads.map((item) => [item.servant_id, item]));
  const servantById = new Map(input.optimizerInput.servants.map((servant) => [servant.id, servant]));

  for (const group of input.groups) {
    const groupSlots = group.slotKeys
      .map((key) => workingSlots.find((slot) => slot.key === key))
      .filter((slot): slot is MonthlyScheduleSlot => Boolean(slot));
    if (groupSlots.length < 2 || groupHasOverlappingServices(groupSlots)) {
      warnings.push(group.label + ": services overlap, so one shared team cannot safely cover every service. Individual assignment was used.");
      continue;
    }

    for (const role of ROLE_ORDER.filter((item) => item !== "Assistant" || input.optimizerInput.includeAssistant !== false)) {
      const currentAssignments = groupSlots.flatMap((slot) =>
        slot.assignments
          .filter((assignment) => assignment.role === role)
          .map((assignment) => ({ slot, assignment }))
      );
      const fixedIds = [...new Set(currentAssignments.map((item) => item.assignment.servant_id))];
      if (currentAssignments.some((item) => item.assignment.confirmation_status === "declined")) {
        warnings.push(group.label + " · " + role + ": a servant declined this role in the team. Existing assignments were preserved and the role was not shared automatically.");
        continue;
      }
      if (fixedIds.length > 1) {
        warnings.push(group.label + " · " + role + ": existing or manually selected servants differ. Those assignments were preserved; the role remains individually assigned for this team.");
        continue;
      }

      const missingSlots = groupSlots.filter((slot) =>
        !slot.assignments.some((assignment) => assignment.role === role)
      );
      if (!missingSlots.length) {
        if (fixedIds.length === 1) assignedGroupCount += 1;
        continue;
      }

      const candidateInput = {
        ...input.optimizerInput,
        slots: workingSlots,
      };
      let candidateIds: Set<string>;
      if (fixedIds.length === 1) {
        candidateIds = new Set([fixedIds[0]]);
      } else {
        const perSlot = groupSlots.map((slot) =>
          new Set(getMonthlyAssignmentCandidates(candidateInput, slot, role).map((servant) => servant.id))
        );
        candidateIds = perSlot.length ? new Set([...perSlot[0]].filter((id) =>
          perSlot.every((set) => set.has(id))
        )) : new Set<string>();
      }

      const individuallyEligibleCandidates = [...candidateIds]
        .map((id) => servantById.get(id))
        .filter((servant): servant is NonNullable<typeof servant> => Boolean(servant) && servant!.active === true)
        .filter((servant) => missingSlots.every((slot) =>
          getMonthlyAssignmentCandidates(candidateInput, slot, role).some((candidate) => candidate.id === servant.id)
        ));
      const eligibleCandidates = individuallyEligibleCandidates.filter((servant) =>
        canCoverTeamWithinDailyServiceLimit({
          schedules: input.optimizerInput.schedules,
          currentSlots: workingSlots,
          proposedSlots: missingSlots,
          servantId: servant.id,
          serviceDate: group.serviceDate,
        })
      );

      if (!eligibleCandidates.length) {
        const reason = individuallyEligibleCandidates.length
          ? "the shared team would exceed the four-service daily limit for every candidate. Individual assignment was used."
          : "no single qualified and available servant can cover every service in this team. Individual assignment was used.";
        warnings.push(group.label + " · " + role + ": " + reason);
        continue;
      }

      const baselineChoice = input.baseline.assignments.find((assignment) =>
        assignment.schedule_key === groupSlots[0].key && assignment.role === role
      )?.servant_id;
      const selected = eligibleCandidates.find((servant) => servant.id === baselineChoice) ??
        eligibleCandidates.slice().sort((a, b) => {
          const aw = workloadById.get(a.id);
          const bw = workloadById.get(b.id);
          return (aw?.utilization ?? 0) - (bw?.utilization ?? 0) ||
            (aw?.total_assignments ?? 0) - (bw?.total_assignments ?? 0) ||
            (aw?.recent_60_day_assignments ?? 0) - (bw?.recent_60_day_assignments ?? 0) ||
            a.full_name.localeCompare(b.full_name) ||
            a.id.localeCompare(b.id);
        })[0];

      workingSlots = workingSlots.map((slot) => {
        if (!missingSlots.some((missing) => missing.key === slot.key)) return slot;
        return {
          ...slot,
          assignments: [
            ...slot.assignments,
            {
              role,
              servant_id: selected.id,
              servant_name: selected.full_name,
              confirmation_status: "pending",
              preview_team: true,
            },
          ],
        };
      });
      assignedGroupCount += 1;
    }
  }

  return { slots: workingSlots, warnings, assignedGroupCount };
}
