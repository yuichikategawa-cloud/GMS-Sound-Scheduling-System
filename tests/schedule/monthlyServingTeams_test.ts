import {
  applyMonthlyServingTeamAssignments,
  buildMonthlyServingTeamGroups,
  buildMonthlyServingTeamWeeks,
} from "../../src/features/schedule/services/monthlyServingTeams.ts";
import {
  optimizeMonthlyAssignments,
  type MonthlyAssignmentOptimizerInput,
} from "../../src/features/schedule/services/monthlyAssignmentOptimizer.ts";
import type { MonthlyScheduleSlot } from "../../src/features/schedule/services/monthlyScheduleGeneration.ts";
import type { Location, Servant } from "../../src/types.ts";

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message + "\nExpected: " + JSON.stringify(expected) + "\nActual: " + JSON.stringify(actual));
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const alam: Location = { id: "alam", name: "GMS Alam Sutera" };
const bsd: Location = { id: "bsd", name: "GMS BSD" };
const karawaci: Location = { id: "karawaci", name: "GMS Karawaci" };
const locations = [alam, bsd, karawaci];

function createSlot(locationId: string, date: string, service: string, start: string): MonthlyScheduleSlot {
  const serviceNumber = Number(/Service (\d+)$/.exec(service)?.[1] ?? 0);
  return {
    key: date + "|" + locationId + "|" + service,
    template_id: "template-" + locationId + "-" + serviceNumber,
    schedule_id: null,
    service_date: date,
    location_id: locationId,
    service_name: service,
    start_time: start,
    end_time: String(Number(start.slice(0, 2)) + 2).padStart(2, "0") + ":00",
    status: "new",
    assignments: [],
    blocked_reason: null,
  };
}

function createServant(id: string): Servant {
  return {
    id,
    full_name: id,
    active: true,
    auth_user_id: null,
    qualified_roles: ["FOH", "Monitor", "Assistant"],
  };
}

const templates = locations.map((location) => ({
  location_id: location.id,
  day_of_week: 0,
  service_name: "Service 1",
  active: true,
}));

Deno.test("weekly rotation controls expose one configuration per church and Sunday week", () => {
  const weeks = buildMonthlyServingTeamWeeks({
    month: "2026-12",
    locations,
    templates,
    selectedLocationIds: locations.map((location) => location.id),
  });
  assertEqual(weeks.length, 12, "December 2026 should expose four Sunday weeks for each of three churches.");
  assertEqual(weeks.filter((week) => week.location.id === alam.id).map((week) => week.defaultPattern), [
    "alam_three", "alam_three", "alam_three", "alam_three",
  ], "Alam Sutera should default to its normal three-team pattern.");
  assertEqual(weeks.filter((week) => week.location.id === bsd.id).map((week) => week.defaultPattern), [
    "bsd_two", "bsd_two", "bsd_two", "bsd_two",
  ], "BSD should default to its two-team pattern.");
  assertEqual(weeks.filter((week) => week.location.id === karawaci.id).map((week) => week.defaultPattern), [
    "karawaci_one", "karawaci_one", "karawaci_one", "karawaci_one",
  ], "Karawaci should default to one team.");
});

Deno.test("Alam Sutera weekly pattern groups services into the requested two-team and three-team rotations", () => {
  const slots = Array.from({ length: 7 }, (_, index) =>
    createSlot(alam.id, "2026-12-06", "Service " + (index + 1), String(7 + index * 2).padStart(2, "0") + ":00")
  );
  const twoGroups = buildMonthlyServingTeamGroups({
    slots,
    locations,
    patternsByWeek: { "alam|1": "alam_two" },
  });
  assertEqual(twoGroups.map((group) => group.slotKeys.length), [3, 4], "The two-team pattern must be Services 1–3 and 4–7.");

  const threeGroups = buildMonthlyServingTeamGroups({
    slots,
    locations,
    patternsByWeek: { "alam|1": "alam_three" },
  });
  assertEqual(threeGroups.map((group) => group.slotKeys.length), [2, 3, 2], "The normal three-team pattern must be Services 1–2, 3–5 and 6–7.");
});

Deno.test("BSD, Karawaci and Alam Sutera AOG use their specified default team patterns", () => {
  const slots = [
    ...Array.from({ length: 4 }, (_, index) => createSlot(bsd.id, "2026-12-06", "Service " + (index + 1), String(9 + index * 2).padStart(2, "0") + ":00")),
    ...Array.from({ length: 3 }, (_, index) => createSlot(karawaci.id, "2026-12-06", "Service " + (index + 1), String(9 + index * 2).padStart(2, "0") + ":00")),
    createSlot(alam.id, "2026-12-05", "AOG Teen", "16:00"),
    createSlot(alam.id, "2026-12-05", "AOG Youth", "18:00"),
    createSlot(alam.id, "2026-12-05", "VSS", "10:00"),
  ];
  const groups = buildMonthlyServingTeamGroups({
    slots,
    locations,
    patternsByWeek: {},
  });
  assertEqual(groups.filter((group) => group.locationId === bsd.id).map((group) => group.slotKeys.length), [2, 2], "BSD should have teams for Services 1–2 and 3–4.");
  assertEqual(groups.filter((group) => group.locationId === karawaci.id).map((group) => group.slotKeys.length), [3], "Karawaci should have one team for Services 1–3.");
  const aog = groups.find((group) => group.id.endsWith("|aog"));
  assertEqual(aog?.slotKeys.length, 2, "AOG Teen and AOG Youth must share one team.");
  assertEqual(aog?.label, "AOG shared team · Teen + Youth", "The preview should identify the shared AOG team.");
});

Deno.test("special-service lineup names retain their numbered service suffix for team grouping", () => {
  const slots = Array.from({ length: 7 }, (_, index) =>
    createSlot(alam.id, "2026-12-25", "Christmas Special Service - Service " + (index + 1), String(7 + index * 2).padStart(2, "0") + ":00")
  );
  const groups = buildMonthlyServingTeamGroups({
    slots,
    locations,
    patternsByWeek: { "alam|4": "alam_two" },
  });
  assertEqual(groups.map((group) => group.slotKeys.length), [3, 4], "A bulk-generated special lineup should use the selected weekly serving-team pattern.");
});

Deno.test("one eligible servant is shared across every sequential service in a serving team", () => {
  const slots = [
    createSlot(alam.id, "2026-12-06", "Service 1", "07:00"),
    createSlot(alam.id, "2026-12-06", "Service 2", "09:00"),
  ];
  const servants = [createServant("servant-a"), createServant("servant-b"), createServant("servant-c")];
  const optimizerInput: Omit<MonthlyAssignmentOptimizerInput, "slots"> = {
    servants,
    availability: [],
    preferences: [],
    schedules: [],
    includeAssistant: false,
  };
  const baseline = optimizeMonthlyAssignments({ ...optimizerInput, slots });
  if (!baseline.ok) throw new Error("Expected baseline optimizer to produce a preview.");
  const groups = buildMonthlyServingTeamGroups({
    slots,
    locations,
    patternsByWeek: { "alam|1": "alam_three" },
  });
  const teamPlan = applyMonthlyServingTeamAssignments({ optimizerInput, slots, baseline, groups });
  const fohIds = teamPlan.slots.map((slot) => slot.assignments.find((item) => item.role === "FOH")?.servant_id);
  const monitorIds = teamPlan.slots.map((slot) => slot.assignments.find((item) => item.role === "Monitor")?.servant_id);

  assertEqual(fohIds[0], fohIds[1], "FOH must be the same servant for both services in one team.");
  assertEqual(monitorIds[0], monitorIds[1], "Monitor must be the same servant for both services in one team.");
  assertEqual(teamPlan.slots.every((slot) => slot.assignments.filter((item) => item.preview_team).length === 2), true, "Both shared role proposals must be marked as team-generated preview assignments.");

  const finalResult = optimizeMonthlyAssignments({ ...optimizerInput, slots: teamPlan.slots });
  assertEqual(finalResult.ok, true, "The normal optimizer's hard-constraint validation must accept the shared team assignments.");
});

Deno.test("team grouping falls back to independent optimization when a shared servant is unavailable for one service", () => {
  const slots = [
    createSlot(alam.id, "2026-12-06", "Service 1", "07:00"),
    createSlot(alam.id, "2026-12-06", "Service 2", "09:00"),
  ];
  const servants = [createServant("only-first"), createServant("only-second")];
  const availability = [
    { servant_id: "only-first", service_date: "2026-12-06", status: "unavailable" as const },
    { servant_id: "only-second", service_date: "2026-12-06", status: "unavailable" as const },
  ];
  const optimizerInput: Omit<MonthlyAssignmentOptimizerInput, "slots"> = {
    servants,
    availability,
    preferences: [],
    schedules: [],
    includeAssistant: false,
  };
  const baseline = optimizeMonthlyAssignments({ ...optimizerInput, slots });
  if (!baseline.ok) throw new Error("Expected a reviewable baseline preview.");
  const groups = buildMonthlyServingTeamGroups({
    slots,
    locations,
    patternsByWeek: { "alam|1": "alam_three" },
  });
  const teamPlan = applyMonthlyServingTeamAssignments({ optimizerInput, slots, baseline, groups });
  assertEqual(teamPlan.slots.every((slot) => slot.assignments.every((assignment) => !assignment.preview_team)), true, "No shared assignment should be invented when the role is not eligible across every service.");
  assert(teamPlan.warnings.some((warning) => warning.includes("no single qualified and available servant")), "The preview should explain why team grouping could not be applied.");
});
