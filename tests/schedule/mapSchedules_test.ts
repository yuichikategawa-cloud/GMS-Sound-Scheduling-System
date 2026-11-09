/// <reference lib="deno.ns" />

import { mapSchedules } from "../../src/features/schedule/services/mapSchedules.ts";
import type { Assignment, Location, Schedule, Servant } from "../../src/types.ts";

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message + "\nExpected: " + JSON.stringify(expected) + "\nActual: " + JSON.stringify(actual));
  }
}

const schedules: Schedule[] = [
  { id: "schedule-1", service_date: "2026-12-06", location_id: "loc-1", service_name: "Sunday Service", start_time: "09:00", end_time: "11:00", status: "draft" },
  { id: "schedule-2", service_date: "2026-12-06", location_id: "missing-location", service_name: "Youth Service", start_time: "17:00", end_time: "19:00", status: "published" }
];
const assignments: Assignment[] = [
  { id: "assignment-1", schedule_id: "schedule-1", servant_id: "servant-1", role: "FOH", confirmation_status: "confirmed" },
  { id: "assignment-2", schedule_id: "schedule-1", servant_id: "missing-servant", role: "Monitor" },
  { id: "assignment-3", schedule_id: "schedule-2", servant_id: "servant-1", role: "Assistant", confirmation_status: "declined" }
];
const locations: Location[] = [{ id: "loc-1", name: "Alam Sutera" }];
const servants: Servant[] = [{ id: "servant-1", full_name: "Sound Member", active: true, auth_user_id: null }];

Deno.test("mapSchedules enriches locations and assignment names while preserving schedule and assignment order", () => {
  const result = mapSchedules(schedules, assignments, locations, servants);
  assertEqual(result.map(item => item.id), ["schedule-1", "schedule-2"], "Schedule order should be preserved.");
  assertEqual(result[0].location_name, "Alam Sutera", "Known locations should be resolved.");
  assertEqual(result[0].assignments, [
    { id: "assignment-1", role: "FOH", servant_id: "servant-1", servant_name: "Sound Member", confirmation_status: "confirmed" },
    { id: "assignment-2", role: "Monitor", servant_id: "missing-servant", servant_name: "Unknown servant", confirmation_status: "pending" }
  ], "Assignment details and fallback values should be preserved.");
  assertEqual(result[1].location_name, "Unknown location", "Unknown locations should retain the existing fallback label.");
  assertEqual(result[1].assignments[0].confirmation_status, "declined", "Existing confirmation states should be retained.");
});

Deno.test("mapSchedules returns empty assignment lists and does not mutate source arrays", () => {
  const sourceSchedules = schedules.map(item => ({ ...item }));
  const sourceAssignments = assignments.map(item => ({ ...item }));
  const result = mapSchedules(schedules, [], locations, servants);
  assertEqual(result.map(item => item.assignments), [[], []], "Schedules without assignments should have empty lists.");
  assertEqual(schedules, sourceSchedules, "Schedule input should not be mutated.");
  assertEqual(assignments, sourceAssignments, "Assignment input should not be mutated.");
});
