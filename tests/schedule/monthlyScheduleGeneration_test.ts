/// <reference lib="deno.ns" />

import {
  buildMonthlyScheduleSlots,
} from "../../src/features/schedule/services/monthlyScheduleGeneration.ts";
import type { ScheduleView, ServiceTemplate } from "../../src/types.ts";

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      message + "\nExpected: " + JSON.stringify(expected) + "\nActual: " + JSON.stringify(actual),
    );
  }
}

const templates: ServiceTemplate[] = [
  { id: "sat-as", location_id: "loc-as", day_of_week: 6, service_name: "Saturday Service", start_time: "16:00", end_time: "18:00", active: true },
  { id: "sun-as", location_id: "loc-as", day_of_week: 0, service_name: "Sunday Service", start_time: "09:00", end_time: "11:00", active: true },
  { id: "inactive", location_id: "loc-as", day_of_week: 0, service_name: "Archived Service", start_time: "11:00", end_time: "13:00", active: false },
  { id: "weekday", location_id: "loc-as", day_of_week: 1, service_name: "Monday Service", start_time: "19:00", end_time: "20:00", active: true },
  { id: "other-location", location_id: "loc-bsd", day_of_week: 0, service_name: "BSD Service", start_time: "09:00", end_time: "11:00", active: true },
];

function createSchedule(
  id: string,
  date: string,
  service: string,
  status: "draft" | "published",
  servants: string[] = [],
): ScheduleView {
  return {
    id,
    service_date: date,
    location_id: "loc-as",
    service_name: service,
    start_time: service === "Saturday Service" ? "16:00" : "09:00",
    end_time: service === "Saturday Service" ? "18:00" : "11:00",
    status,
    location_name: "Alam Sutera",
    assignments: servants.map((servant_id, index) => ({
      role: index === 0 ? "FOH" : "Monitor",
      servant_id,
      servant_name: servant_id,
      confirmation_status: "pending",
    })),
  };
}

Deno.test("monthly generation expands active Saturday and Sunday templates for the selected month", () => {
  const result = buildMonthlyScheduleSlots({
    month: "2026-11",
    locationIds: ["loc-as"],
    templates,
    existingSchedules: [],
  });

  assertEqual(result.ok, true, "A valid month and active weekend templates should generate slots.");
  if (!result.ok) return;
  assertEqual(result.slots.length, 9, "November 2026 should contain five Sundays and four Saturdays.");
  assertEqual(result.selectedTemplateCount, 2, "Only active selected weekend templates should be counted.");
  assertEqual(result.weekendCount, 5, "The month should contain five represented weekends.");
  assertEqual(result.slots[0].service_date, "2026-11-01", "Slots should be ordered by service date.");
  assertEqual(result.slots[0].service_name, "Sunday Service", "Sunday templates should map to Sundays.");
  assertEqual(result.slots[0].template_id, "sun-as", "Every service slot should retain the template ID for database revalidation.");
  assertEqual(result.slots[1].service_date, "2026-11-07", "The first Saturday should be included.");
});

Deno.test("monthly generation preserves existing draft assignments and marks published and pending services blocked", () => {
  const existing = [
    createSchedule("draft-id", "2026-11-01", "Sunday Service", "draft", ["servant-a"]),
    createSchedule("published-id", "2026-11-07", "Saturday Service", "published", ["servant-b"]),
    createSchedule("pending-id", "2026-11-08", "Sunday Service", "draft", ["servant-c"]),
  ];

  const result = buildMonthlyScheduleSlots({
    month: "2026-11",
    locationIds: ["loc-as"],
    templates,
    existingSchedules: existing,
    pendingRequestScheduleIds: ["pending-id"],
  });

  if (!result.ok) throw new Error("Expected monthly generation to succeed.");
  const draft = result.slots.find((slot) => slot.schedule_id === "draft-id");
  const published = result.slots.find((slot) => slot.schedule_id === "published-id");
  const pending = result.slots.find((slot) => slot.schedule_id === "pending-id");

  assertEqual(draft?.assignments.map((assignment) => assignment.servant_id), ["servant-a"], "Existing draft assignments must remain present.");
  assertEqual(draft?.blocked_reason, null, "An ordinary draft service remains eligible for filling.");
  assertEqual(published?.blocked_reason, "published", "Published services must be protected.");
  assertEqual(pending?.blocked_reason, "pending_request", "Services with pending requests must be protected.");
});

Deno.test("monthly generation scopes templates to selected locations", () => {
  const result = buildMonthlyScheduleSlots({
    month: "2026-11",
    locationIds: ["loc-as", "loc-bsd"],
    templates,
    existingSchedules: [],
  });

  if (!result.ok) throw new Error("Expected monthly generation to succeed.");
  assertEqual(result.slots.some((slot) => slot.location_id === "loc-bsd"), true, "Selected BSD templates should be included.");
  assertEqual(result.slots.some((slot) => slot.location_id === "loc-as"), true, "Selected Alam Sutera templates should be included.");
  assertEqual(result.slots.some((slot) => slot.service_name === "Monday Service"), false, "Weekday templates should remain outside the first version.");
});

Deno.test("monthly generation fails closed when required input reads failed", () => {
  assertEqual(
    buildMonthlyScheduleSlots({
      month: "2026-11",
      locationIds: ["loc-as"],
      templates,
      existingSchedules: [],
      dataErrors: ["Serving preferences could not be loaded."],
    }),
    { ok: false, reason: "data_unavailable", errors: ["Serving preferences could not be loaded."] },
    "Missing availability data must not be silently treated as eligible.",
  );
});

Deno.test("monthly generation rejects invalid month, empty locations and absent weekend templates", () => {
  assertEqual(
    buildMonthlyScheduleSlots({ month: "2026-13", locationIds: ["loc-as"], templates, existingSchedules: [] }),
    { ok: false, reason: "invalid_month" },
    "Invalid month values must fail.",
  );
  assertEqual(
    buildMonthlyScheduleSlots({ month: "2026-11", locationIds: [], templates, existingSchedules: [] }),
    { ok: false, reason: "select_location" },
    "At least one location must be selected.",
  );
  assertEqual(
    buildMonthlyScheduleSlots({ month: "2026-11", locationIds: ["loc-unknown"], templates, existingSchedules: [] }),
    { ok: false, reason: "no_weekend_templates" },
    "A location without an active weekend template must fail clearly.",
  );
});

Deno.test("monthly generation rejects duplicate existing natural service keys", () => {
  const existing = [
    createSchedule("duplicate-a", "2026-11-01", "Sunday Service", "draft"),
    createSchedule("duplicate-b", "2026-11-01", "Sunday Service", "draft"),
  ];
  const result = buildMonthlyScheduleSlots({
    month: "2026-11",
    locationIds: ["loc-as"],
    templates,
    existingSchedules: existing,
  });

  assertEqual(result.ok, false, "Duplicate natural service keys must not be resolved arbitrarily.");
  if (!result.ok) assertEqual(result.reason, "duplicate_existing_slot", "Duplicate natural keys need a clear error.");
});

Deno.test("monthly generation does not mutate templates, schedules or request IDs", () => {
  const existing = [createSchedule("draft-id", "2026-11-01", "Sunday Service", "draft", ["servant-a"])];
  const input = {
    month: "2026-11",
    locationIds: ["loc-as"],
    templates: templates.map((template) => ({ ...template })),
    existingSchedules: existing.map((schedule) => ({ ...schedule, assignments: schedule.assignments.map((assignment) => ({ ...assignment })) })),
    pendingRequestScheduleIds: ["draft-id"],
  };
  const before = JSON.stringify(input);
  buildMonthlyScheduleSlots(input);
  assertEqual(JSON.stringify(input), before, "The builder must not mutate its source collections.");
});
