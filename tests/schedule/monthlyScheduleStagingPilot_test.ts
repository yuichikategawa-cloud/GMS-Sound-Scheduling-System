/// <reference lib="deno.ns" />

import {
  buildVirtualAvailability,
} from "../../src/features/availability/services/recurringAvailability.ts";
import {
  mapHistoricalRosterProfiles,
} from "../../src/features/schedule/services/historicalRosterProfiles.ts";
import {
  optimizeMonthlyAssignments,
} from "../../src/features/schedule/services/monthlyAssignmentOptimizer.ts";
import {
  buildMonthlyScheduleSlots,
} from "../../src/features/schedule/services/monthlyScheduleGeneration.ts";
import type { Location, ScheduleView, Servant, ServiceTemplate } from "../../src/types.ts";

// Read-only snapshot of the Staging baseline inspected on 2026-11-11.
// This test intentionally does not call Supabase or persist any schedule rows.
const locations: Location[] = [
  { id: "108c8406-394f-44e0-85f7-837046b58844", name: "GMS Alam Sutera" },
  { id: "f92a877c-1248-4732-b5cb-ab8a71f3070c", name: "GMS BSD" },
  { id: "2c1b1e94-ea77-4d14-9fbf-160c513b4138", name: "GMS Karawaci" },
];

const servants: Servant[] = [
  { id: "15eea1ed-7675-4a7a-897e-1bd588b31a36", full_name: "Aristo Abe Santoso", active: true, auth_user_id: null },
  { id: "2ebb48f6-eafe-485f-92b6-11cd4b978285", full_name: "Hannah", active: true, auth_user_id: null },
  { id: "692267a7-4621-4b8e-a4f1-06dfe02d44f7", full_name: "Michael Hansel", active: true, auth_user_id: null },
  { id: "bed1388c-2e0f-4fe3-a6f8-e1dabdbd583a", full_name: "Yutaka", active: true, auth_user_id: null },
];

const templates: ServiceTemplate[] = [
  { id: "5a5874ff-2da7-4bc1-9bca-ca5e313b7a6e", location_id: locations[0].id, day_of_week: 0, service_name: "Service 1", start_time: "07:00", end_time: "09:00", active: true },
  { id: "df8aa8da-17f6-44cc-9ee3-b1d8727c976f", location_id: locations[0].id, day_of_week: 0, service_name: "Service 2", start_time: "09:00", end_time: "11:00", active: true },
  { id: "462a3f29-67a6-425a-8b6c-533d5ecba273", location_id: locations[0].id, day_of_week: 0, service_name: "Service 3", start_time: "11:00", end_time: "13:00", active: true },
  { id: "57f61025-fd92-47f3-b367-18ea0ab8c66b", location_id: locations[0].id, day_of_week: 0, service_name: "Service 4", start_time: "13:00", end_time: "15:00", active: true },
  { id: "3a63f8db-03dd-4fb0-8980-b289199b3ab8", location_id: locations[0].id, day_of_week: 0, service_name: "Service 5", start_time: "15:00", end_time: "17:00", active: true },
  { id: "42bad25d-1c12-4ccc-8628-95b250ac6d7f", location_id: locations[0].id, day_of_week: 0, service_name: "Service 6", start_time: "17:00", end_time: "19:00", active: true },
  { id: "b367faa5-b4c7-4ccf-b2ee-fc934cc4f1d6", location_id: locations[0].id, day_of_week: 0, service_name: "Service 7", start_time: "19:00", end_time: "21:00", active: true },
  { id: "46ea7d97-778f-468b-9f10-14523bb8c2ef", location_id: locations[0].id, day_of_week: 6, service_name: "VSS", start_time: "10:00", end_time: "15:00", active: true },
  { id: "1ea72846-c5ef-458b-81f4-1ff76bd94a7e", location_id: locations[0].id, day_of_week: 6, service_name: "AOG Teen", start_time: "16:00", end_time: "18:00", active: true },
  { id: "76e3d92d-79aa-46dd-8278-c13cd1e1e4d2", location_id: locations[0].id, day_of_week: 6, service_name: "AOG Youth", start_time: "18:00", end_time: "20:00", active: true },
  { id: "838c74bb-bdf5-40d3-9143-d0f159f81db8", location_id: locations[1].id, day_of_week: 0, service_name: "Service 1", start_time: "09:00", end_time: "11:00", active: true },
  { id: "2dbccff7-f9a2-434b-9c1e-3a3b5f1b24b8", location_id: locations[1].id, day_of_week: 0, service_name: "Service 2", start_time: "11:00", end_time: "13:00", active: true },
  { id: "3840b383-15fb-42ee-86d2-a10692f13f80", location_id: locations[1].id, day_of_week: 0, service_name: "Service 3", start_time: "13:00", end_time: "15:00", active: true },
  { id: "597373d6-5165-4c00-99b9-3ecb910f4ea3", location_id: locations[1].id, day_of_week: 0, service_name: "Service 4", start_time: "15:00", end_time: "17:00", active: true },
  { id: "043d1d6a-03f0-47eb-93de-3774fa510946", location_id: locations[1].id, day_of_week: 6, service_name: "VSS", start_time: "10:00", end_time: "15:00", active: true },
  { id: "28375e72-622d-49b7-a737-7121eedd3456", location_id: locations[1].id, day_of_week: 6, service_name: "AOG", start_time: "16:00", end_time: "18:00", active: true },
  { id: "01b7b080-ded6-4fad-a3c2-2d59270a7f87", location_id: locations[2].id, day_of_week: 0, service_name: "Service 1", start_time: "09:00", end_time: "11:00", active: true },
  { id: "0150b3c6-4236-4404-9942-4b5049909b3d", location_id: locations[2].id, day_of_week: 0, service_name: "Service 2", start_time: "11:00", end_time: "13:00", active: true },
  { id: "71284670-079f-47e3-9d94-4f32d1ddc4e1", location_id: locations[2].id, day_of_week: 0, service_name: "Service 3", start_time: "13:00", end_time: "15:00", active: true },
  { id: "16284b1d-e19e-4bec-b706-7574aebfb72a", location_id: locations[2].id, day_of_week: 6, service_name: "AOG", start_time: "16:00", end_time: "18:00", active: true },
];

const schedules: ScheduleView[] = [
  {
    id: "211977d4-04f1-4c98-b139-ef7a983c2013",
    service_date: "2026-11-20",
    location_id: locations[0].id,
    service_name: "Prayer & Worship",
    start_time: "19:00",
    end_time: "21:00",
    status: "published",
    location_name: "GMS Alam Sutera",
    assignments: [
      { id: "40279c12-e8cb-402d-9b12-260035de92fc", role: "FOH", servant_id: servants[0].id, servant_name: servants[0].full_name, confirmation_status: "pending" },
      { id: "3e2f86dd-3d72-4477-8265-c11340372e22", role: "Monitor", servant_id: servants[3].id, servant_name: servants[3].full_name, confirmation_status: "pending" },
    ],
  },
  {
    id: "3d6e68d0-7ab5-4175-bea5-b9f38f75d7d8",
    service_date: "2026-11-27",
    location_id: locations[1].id,
    service_name: "Prayer & Worship",
    start_time: "19:00",
    end_time: "21:00",
    status: "published",
    location_name: "GMS BSD",
    assignments: [
      { id: "7daeff75-7cda-435f-a8b4-de5f60bc584e", role: "FOH", servant_id: servants[1].id, servant_name: servants[1].full_name, confirmation_status: "pending" },
      { id: "59432f1d-c9f6-427b-884b-9ded57461b48", role: "Monitor", servant_id: servants[2].id, servant_name: servants[2].full_name, confirmation_status: "pending" },
    ],
  },
];

const recurringRules = [
  {
    id: "staging-hannah-weekday-nov14",
    servant_id: servants[1].id,
    pattern: "weekday" as const,
    status: "unavailable" as const,
    effective_from: "2026-11-10",
    effective_until: "2026-11-14",
    weekday: 6,
    ordinal: 2,
  },
  {
    id: "staging-hannah-weekday-open-ended",
    servant_id: servants[1].id,
    pattern: "weekday" as const,
    status: "unavailable" as const,
    effective_from: "2026-11-28",
    effective_until: null,
    weekday: 6,
    ordinal: 2,
  },
];

const preferences = [{
  servant_id: servants[1].id,
  active: true,
  rule_type: "allowed_time_window",
  days_of_week: [6, 5, 0],
  start_time: "19:00",
  end_time: "21:00",
}];

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message + "\nExpected: " + JSON.stringify(expected) + "\nActual: " + JSON.stringify(actual));
  }
}

function runPilot(includeAssistant: boolean) {
  const built = buildMonthlyScheduleSlots({
    month: "2026-12",
    locationIds: locations.map((location) => location.id),
    templates,
    existingSchedules: schedules,
    pendingRequestScheduleIds: [],
  });
  if (!built.ok) throw new Error("December 2026 Staging slots failed to build: " + built.reason);

  const availability = buildVirtualAvailability(
    recurringRules,
    new Date("2026-12-31T12:00:00"),
  );
  const historical = mapHistoricalRosterProfiles(servants);
  const result = optimizeMonthlyAssignments({
    slots: built.slots,
    servants,
    availability,
    preferences,
    schedules,
    historicalProfiles: historical.profiles,
    autoAssignmentExcludedServantIds: historical.autoAssignmentExcludedServantIds,
    includeAssistant,
  });

  if (!result.ok) throw new Error("December 2026 Staging optimizer failed: " + result.reason);

  const workloadSummary = result.workloads.map((row) => ({
    name: row.servant_name,
    generated: row.generated_assignments,
    recent60d: row.recent_60_day_assignments,
    historical: row.historical_assignments,
    roleCounts: row.role_counts,
    eligibleOpportunities: row.eligible_opportunities,
    utilization: row.utilization,
  }));

  console.log("MONTHLY_STAGING_PILOT " + JSON.stringify({
    month: "2026-12",
    selectedLocations: locations.map((location) => location.name),
    templateCount: built.selectedTemplateCount,
    weekendCount: built.weekendCount,
    serviceSlots: built.slots.length,
    activeServants: servants.filter((servant) => servant.active).length,
    explicitAvailabilityRows: 0,
    recurringRules: recurringRules.length,
    preferenceRules: preferences.length,
    includeAssistant,
    lockedAssignments: result.lockedAssignmentCount,
    generatedAssignments: result.generatedAssignmentCount,
    requiredPositions: result.requiredPositionCount,
    filledRequired: result.filledRequiredPositionCount,
    unfilledRequired: result.unfilledRequiredPositionCount,
    optionalAssistantGenerated: result.generatedAssistantCount,
    optionalAssistantUnfilled: result.unfilledOptionalAssistantCount,
    frozenServices: result.skippedServiceCount,
    declinedExistingAssignments: result.declinedAssignmentCount,
    warnings: result.warnings,
    preferNotWarnings: result.preferNotWarnings,
    unfilledByReason: result.unfilledPositions.reduce((acc, position) => {
      acc[position.reason] = (acc[position.reason] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    workloads: workloadSummary,
  }));

  const assignments = result.assignments;
  for (let i = 0; i < assignments.length; i += 1) {
    for (let j = i + 1; j < assignments.length; j += 1) {
      const a = assignments[i];
      const b = assignments[j];
      if (a.servant_id !== b.servant_id || a.service_date !== b.service_date || a.schedule_key === b.schedule_key) continue;
      if (a.location_id !== b.location_id) {
        throw new Error("Pilot generated a same-day cross-location conflict for " + a.servant_name);
      }
      const overlaps = a.start_time < b.end_time && b.start_time < a.end_time;
      if (overlaps) throw new Error("Pilot generated an overlapping same-location assignment for " + a.servant_name);
    }
  }

  assertEqual(built.selectedTemplateCount, 20, "The pilot snapshot must include all 20 active weekend templates.");
  assertEqual(built.slots.length, 80, "December 2026 should expand to 80 service slots across three locations.");
  assertEqual(result.unfilledRequiredPositionCount + result.filledRequiredPositionCount, result.requiredPositionCount, "All required positions must be accounted for.");
  return result;
}

Deno.test("Staging snapshot pilot balances December required FOH and Monitor positions safely", () => {
  const result = runPilot(false);
  assertEqual(result.requiredPositionCount, 160, "Twenty active templates across eight weekend days produce 160 required roles.");
});

Deno.test("Staging snapshot pilot measures optional Assistant demand separately", () => {
  const result = runPilot(true);
  assertEqual(result.requiredPositionCount, 160, "Assistant positions must remain optional.");
  assertEqual(result.unfilledOptionalAssistantCount + result.generatedAssistantCount, 80, "Optional Assistant positions must be reported separately.");
});
