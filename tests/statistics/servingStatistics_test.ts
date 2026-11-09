/// <reference lib="deno.ns" />

import {
  calculateServingStatistics,
  type ServingStatistics,
} from "../../src/features/statistics/services/servingStatistics.ts";
import type { ScheduleView, Servant } from "../../src/types.ts";

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      message + "\nExpected: " + JSON.stringify(expected) + "\nActual: " + JSON.stringify(actual),
    );
  }
}

function assertSame(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new Error(message);
}

function servant(id: string, full_name: string, active = true): Servant {
  return { id, full_name, active, auth_user_id: null };
}

function schedule(
  id: string,
  location_name: string,
  assignments: ScheduleView["assignments"],
): ScheduleView {
  return {
    id,
    service_date: "2026-11-07",
    location_id: "location-" + location_name,
    service_name: "Weekend Service",
    start_time: "09:00",
    end_time: "11:00",
    location_name,
    assignments,
  };
}

function expectStats(
  schedules: ScheduleView[],
  servants: Servant[],
  expected: Partial<ServingStatistics>,
): ServingStatistics {
  const result = calculateServingStatistics(schedules, servants);
  for (const [key, value] of Object.entries(expected)) {
    assertEqual(
      result[key as keyof ServingStatistics],
      value,
      "Unexpected statistics field: " + key,
    );
  }
  return result;
}

Deno.test("statistics count assignments by role for active servants only", () => {
  const schedules = [schedule("s1", "GMS Alam Sutera", [
    { id: "a1", role: "FOH", servant_id: "active-1", servant_name: "Alex", confirmation_status: "confirmed" },
    { id: "a2", role: "Monitor", servant_id: "active-1", servant_name: "Alex", confirmation_status: "pending" },
    { id: "a3", role: "Assistant", servant_id: "inactive-1", servant_name: "Inactive" },
  ])];
  const result = expectStats(schedules, [
    servant("active-1", "Alex"),
    servant("inactive-1", "Inactive", false),
    servant("active-2", "Jordan"),
  ], {
    rows: [
      { id: "active-1", name: "Alex", total: 2, FOH: 1, Monitor: 1, Assistant: 0 },
    ],
    totalAssignments: 2,
    notScheduled: 1,
  });
  assertEqual(result.filledRequired, 2, "Required role totals still include every schedule assignment row except Assistant.");
});

Deno.test("statistics calculate required gaps from two required roles per schedule", () => {
  const result = expectStats([
    schedule("s1", "GMS Alam Sutera", [
      { role: "FOH", servant_id: "a", servant_name: "Alex" },
      { role: "Assistant", servant_id: "b", servant_name: "Blair" },
    ]),
    schedule("s2", "GMS Puri", [
      { role: "Monitor", servant_id: "a", servant_name: "Alex" },
    ]),
  ], [servant("a", "Alex"), servant("b", "Blair")], {
    filledRequired: 2,
    requiredSlots: 4,
    requiredRoleGaps: 2,
  });
  assertEqual(result.totalAssignments, 3, "Active-servant total assignments include Assistant assignments.");
});

Deno.test("confirmation rate and declined count include assistant and inactive assignments", () => {
  const result = expectStats([schedule("s1", "GMS Puri", [
    { role: "FOH", servant_id: "active", servant_name: "Alex", confirmation_status: "confirmed" },
    { role: "Monitor", servant_id: "inactive", servant_name: "Inactive", confirmation_status: "confirmed" },
    { role: "Assistant", servant_id: "active", servant_name: "Alex", confirmation_status: "declined" },
  ])], [servant("active", "Alex"), servant("inactive", "Inactive", false)], {
    confirmed: 2,
    declined: 1,
    confirmationRate: 67,
    totalAssignments: 2,
  });
  assertEqual(result.confirmationRate, Math.round((2 / 3) * 100), "Confirmation rate must be rounded across every assignment.");
});

Deno.test("empty schedules return zero metrics and mark active servants as not scheduled", () => {
  const result = expectStats([], [servant("a", "Alex"), servant("b", "Blair", false)], {
    rows: [],
    totalAssignments: 0,
    filledRequired: 0,
    requiredSlots: 0,
    requiredRoleGaps: 0,
    confirmationRate: 0,
    declined: 0,
    notScheduled: 1,
    averageAssignments: 0,
    highestWorkload: 0,
    lowestWorkload: 0,
    fairnessDifference: 0,
    showFairnessAlert: false,
  });
  assertSame(result.rows.length, 0, "The filtered servant breakdown must be empty when no assignments match.");
});

Deno.test("location totals are sorted alphabetically and retain zero-assignment schedules", () => {
  expectStats([
    schedule("s1", "GMS Puri", [{ role: "FOH", servant_id: "a", servant_name: "Alex" }]),
    schedule("s2", "GMS Alam Sutera", []),
    schedule("s3", "GMS BSD", [
      { role: "FOH", servant_id: "a", servant_name: "Alex" },
      { role: "Monitor", servant_id: "b", servant_name: "Blair" },
    ]),
  ], [servant("a", "Alex"), servant("b", "Blair")], {
    locationCounts: [
      { name: "GMS Alam Sutera", count: 0 },
      { name: "GMS BSD", count: 2 },
      { name: "GMS Puri", count: 1 },
    ],
  });
});

Deno.test("fairness alert appears at a workload difference of three or more", () => {
  const servants = [
    servant("a", "Alex"),
    servant("b", "Blair"),
    servant("c", "Casey"),
  ];
  const schedules = [
    schedule("s1", "GMS Puri", [
      { role: "FOH", servant_id: "a", servant_name: "Alex" },
      { role: "Monitor", servant_id: "a", servant_name: "Alex" },
      { role: "Assistant", servant_id: "a", servant_name: "Alex" },
    ]),
    schedule("s2", "GMS Puri", [
      { role: "FOH", servant_id: "a", servant_name: "Alex" },
      { role: "Monitor", servant_id: "b", servant_name: "Blair" },
    ]),
  ];
  const result = expectStats(schedules, servants, {
    highestWorkload: 4,
    lowestWorkload: 1,
    fairnessDifference: 3,
    showFairnessAlert: true,
  });
  assertEqual(result.averageAssignments, 5 / 2, "Average workload must compare servants assigned within the filtered schedules.");
});

Deno.test("fairness alert is hidden below the threshold and with only one active servant", () => {
  const thresholdSchedules = [schedule("s1", "GMS Puri", [
    { role: "FOH", servant_id: "a", servant_name: "Alex" },
    { role: "Monitor", servant_id: "a", servant_name: "Alex" },
    { role: "Assistant", servant_id: "b", servant_name: "Blair" },
  ])];
  expectStats(thresholdSchedules, [servant("a", "Alex"), servant("b", "Blair")], {
    fairnessDifference: 1,
    showFairnessAlert: false,
  });
  expectStats(thresholdSchedules, [servant("a", "Alex")], {
    fairnessDifference: 0,
    showFairnessAlert: false,
  });
});

Deno.test("statistics sorting does not mutate source servant or schedule arrays", () => {
  const servants = [servant("b", "Blair"), servant("a", "Alex")];
  const schedules = [schedule("s1", "GMS Puri", [
    { role: "FOH", servant_id: "b", servant_name: "Blair" },
    { role: "Monitor", servant_id: "a", servant_name: "Alex" },
  ])];
  const servantOrder = servants.map(item => item.id);
  const scheduleOrder = schedules.map(item => item.id);
  const assignmentOrder = schedules[0].assignments.map(item => item.servant_id);

  calculateServingStatistics(schedules, servants);

  assertEqual(servants.map(item => item.id), servantOrder, "Servant input order must not be changed.");
  assertEqual(schedules.map(item => item.id), scheduleOrder, "Schedule input order must not be changed.");
  assertEqual(schedules[0].assignments.map(item => item.servant_id), assignmentOrder, "Assignment order must not be changed.");
});
