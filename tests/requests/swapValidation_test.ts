/// <reference lib="deno.ns" />

import { findCrossLocationAssignmentConflict } from "../../src/features/requests/services/swapValidation.ts";

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(message + "\\nExpected: " + String(expected) + "\\nActual: " + String(actual));
  }
}

const schedules = [
  {
    id: "destination",
    service_date: "2026-11-08",
    location_id: "north",
    assignments: [{ servant_id: "servant-a" }],
  },
  {
    id: "other-church",
    service_date: "2026-11-08",
    location_id: "south",
    assignments: [{ servant_id: "servant-b" }],
  },
  {
    id: "different-date",
    service_date: "2026-11-15",
    location_id: "south",
    assignments: [{ servant_id: "servant-a" }],
  },
  {
    id: "other-servant",
    service_date: "2026-11-08",
    location_id: "west",
    assignments: [{ servant_id: "servant-c" }],
  },
];

Deno.test("swap validation detects another-church assignment on the destination date", () => {
  const conflict = findCrossLocationAssignmentConflict(schedules, "servant-b", "2026-11-08", "north");
  assertEqual(conflict?.id, "other-church", "A same-date assignment at another church must block the swap.");
});

Deno.test("swap validation ignores assignments at the destination church and on other dates", () => {
  const sameLocation = findCrossLocationAssignmentConflict(schedules, "servant-a", "2026-11-08", "north");
  const otherDate = findCrossLocationAssignmentConflict(schedules, "servant-a", "2026-11-15", "south");
  assertEqual(sameLocation, null, "Assignments at the destination church must not be treated as cross-church conflicts.");
  assertEqual(otherDate, null, "Assignments on other dates must not block the destination date.");
});

Deno.test("swap validation ignores assignments belonging to other servants", () => {
  const conflict = findCrossLocationAssignmentConflict(schedules, "servant-a", "2026-11-08", "south");
  assertEqual(conflict?.id, "destination", "Only assignments for the servant being moved may conflict.");
});

Deno.test("swap validation excludes schedules participating in an approved swap", () => {
  const conflict = findCrossLocationAssignmentConflict(
    schedules,
    "servant-b",
    "2026-11-08",
    "north",
    ["other-church"],
  );
  assertEqual(conflict, null, "The destination/participating schedule must be excluded from revalidation.");
});
