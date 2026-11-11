import {
  buildAiSchedulingSnapshot,
  requestAiSchedulingExplanation,
} from "../../src/features/schedule/services/aiSchedulingAssistant.ts";
import type { AvailabilityRecord } from "../../src/features/availability/services/recurringAvailability.ts";
import type { MonthlyScheduleSlot } from "../../src/features/schedule/services/monthlyScheduleGeneration.ts";
import type {
  MonthlyGeneratedAssignment,
  MonthlyServantWorkload,
  MonthlyUnfilledPosition,
} from "../../src/features/schedule/services/monthlyAssignmentOptimizer.ts";
import type { Location, Servant } from "../../src/types.ts";

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message + "\nExpected: " + JSON.stringify(expected) + "\nActual: " + JSON.stringify(actual));
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const locations: Location[] = [{ id: "private-church-id", name: "GMS Private Church Name" }];
const servant: Servant = {
  id: "private-servant-id",
  full_name: "Private Person Name",
  active: true,
  auth_user_id: "private-auth-user-id",
  qualified_roles: ["FOH", "Monitor"],
};
const slots: MonthlyScheduleSlot[] = Array.from({ length: 7 }, (_, index) => ({
  key: "private-slot-" + index,
  template_id: null,
  schedule_id: null,
  service_date: "2026-12-" + String(index + 1).padStart(2, "0"),
  location_id: "private-church-id",
  service_name: "Private Custom Service " + index,
  start_time: "10:00",
  end_time: "12:00",
  status: "new_special",
  assignments: [],
  blocked_reason: null,
}));
const generated: MonthlyGeneratedAssignment[] = [{
  schedule_key: slots[0].key,
  schedule_id: null,
  service_date: slots[0].service_date,
  location_id: slots[0].location_id,
  service_name: slots[0].service_name,
  start_time: slots[0].start_time,
  end_time: slots[0].end_time,
  role: "FOH",
  servant_id: servant.id,
  servant_name: servant.full_name,
}];
const vacancies: MonthlyUnfilledPosition[] = [{
  schedule_key: slots[0].key,
  schedule_id: null,
  service_date: slots[0].service_date,
  location_id: slots[0].location_id,
  service_name: slots[0].service_name,
  role: "Monitor",
  required: true,
  reason: "role_not_qualified",
  blocked_candidate_count: 1,
}];
const workloads: MonthlyServantWorkload[] = [{
  servant_id: servant.id,
  servant_name: servant.full_name,
  existing_assignments: 2,
  generated_assignments: 1,
  total_assignments: 3,
  serving_days: 3,
  eligible_opportunities: 8,
  utilization: 0.375,
  recent_60_day_assignments: 2,
  recent_60_day_days: 2,
  historical_assignments: 5,
  historical_serving_days: 4,
  role_counts: { FOH: 3, Monitor: 2, Assistant: 0 },
  prefer_not_assignments: 0,
}];
const availability = [{
  id: "private-availability-id",
  servant_id: servant.id,
  service_date: slots[0].service_date,
  status: "available",
  notes: "Private availability note",
}] as unknown as AvailabilityRecord[];

Deno.test("AI scheduling snapshot anonymizes identities and free-text fields", () => {
  const snapshot = buildAiSchedulingSnapshot({
    month: "2026-12",
    locations,
    slots,
    generatedAssignments: generated,
    unfilledPositions: vacancies,
    workloads,
    servants: [servant],
    availability,
  });
  const serialized = JSON.stringify(snapshot);

  assert(!serialized.includes("private-servant-id"), "Servant IDs must not be included.");
  assert(!serialized.includes("private-auth-user-id"), "Authentication IDs must not be included.");
  assert(!serialized.includes("Private Person Name"), "Servant names must not be included.");
  assert(!serialized.includes("private-church-id"), "Church IDs must not be included.");
  assert(!serialized.includes("GMS Private Church Name"), "Church names must be anonymized.");
  assert(!serialized.includes("Private Custom Service"), "User-entered service names must not be sent.");
  assert(!serialized.includes("Private availability note"), "Availability notes must not be sent.");
  assert(serialized.includes("Servant 1"), "Servants should receive stable anonymous labels.");
  assert(serialized.includes("Church 1"), "Church locations should receive anonymous labels.");
  assert(serialized.includes("Service 1"), "Services should receive anonymous labels.");
});

Deno.test("AI context samples at most three services per church and reports omissions", () => {
  const snapshot = buildAiSchedulingSnapshot({
    month: "2026-12",
    locations,
    slots,
    generatedAssignments: generated,
    unfilledPositions: vacancies,
    workloads,
    servants: [servant],
    availability,
  });
  assertEqual(snapshot.churches[0].services.length, 3, "Only three detailed service samples should be sent per church.");
  assertEqual(snapshot.churches[0].totalServiceCount, 7, "The full service count should remain available.");
  assertEqual(snapshot.churches[0].omittedServiceCount, 4, "The assistant must know when service details are omitted.");
  assertEqual(snapshot.churches[0].vacancySummary[0].reason, "role_not_qualified", "Vacancy reasons should be retained.");
  assertEqual(snapshot.summary.requiredPositions, 14, "Summary metrics should include all required positions.");
  assertEqual(snapshot.summary.unfilledRequiredPositions, 1, "Required vacancies should be counted.");
});

Deno.test("AI explanation client sends an authenticated, anonymized preview request", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const result = await requestAiSchedulingExplanation(
    "https://gms-ai.example.workers.dev/v1/explain",
    "test-access-token",
    buildAiSchedulingSnapshot({
      month: "2026-12",
      locations,
      slots: slots.slice(0, 1),
      generatedAssignments: generated,
      unfilledPositions: vacancies,
      workloads,
      servants: [servant],
      availability,
    }),
    async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(JSON.stringify({ explanation: "Coverage is strong; review the Monitor vacancy.", cached: true }), { status: 200 });
    },
  );

  assertEqual(capturedUrl, "https://gms-ai.example.workers.dev/v1/explain", "The configured Worker endpoint should be used.");
  assertEqual((capturedInit?.headers as Record<string, string>).Authorization, "Bearer test-access-token", "The current Supabase access token must be sent.");
  const body = JSON.parse(String(capturedInit?.body));
  assertEqual(body.kind, "preview_explanation", "Only the supported analysis action should be sent.");
  assert(!JSON.stringify(body).includes("Private Person Name"), "The outgoing request must remain anonymized.");
  assertEqual(result.cached, true, "Cached responses should be identified.");
});

Deno.test("AI explanation client fails closed when the free quota has been reached", async () => {
  let message = "";
  try {
    await requestAiSchedulingExplanation(
      "https://gms-ai.example.workers.dev/v1/explain",
      "test-access-token",
      buildAiSchedulingSnapshot({
        month: "2026-12",
        locations,
        slots: slots.slice(0, 1),
        generatedAssignments: generated,
        unfilledPositions: vacancies,
        workloads,
        servants: [servant],
        availability,
      }),
      async () => new Response(JSON.stringify({ error: "daily_free_limit_reached" }), { status: 429 }),
    );
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert(message.includes("free GMS AI daily limit"), "Quota exhaustion should give a clear no-cost limit message.");
});
