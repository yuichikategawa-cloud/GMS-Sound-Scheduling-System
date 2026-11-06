/// <reference lib="deno.ns" />

import { loadAvailabilityWorkspaceData } from "../../src/features/availability/services/availabilityData.ts";

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message + "\nExpected: " + JSON.stringify(expected) + "\nActual: " + JSON.stringify(actual));
  }
}

function createQueryClient(results: Record<string, any>) {
  const calls: Array<{ table: string; operation: string; args: unknown[] }> = [];
  return {
    calls,
    client: {
      from(table: string) {
        calls.push({ table, operation: "from", args: [] });
        const query: any = {
          select(columns: string) {
            calls.push({ table, operation: "select", args: [columns] });
            return query;
          },
          order(column: string, options?: unknown) {
            calls.push({ table, operation: "order", args: [column, options] });
            return query;
          },
          eq(column: string, value: unknown) {
            calls.push({ table, operation: "eq", args: [column, value] });
            return query;
          },
          maybeSingle() {
            calls.push({ table, operation: "maybeSingle", args: [] });
            return Promise.resolve(results[table]);
          },
          then(resolve: (value: any) => unknown, reject?: (reason: unknown) => unknown) {
            return Promise.resolve(results[table]).then(resolve, reject);
          },
        };
        return query;
      },
    },
  };
}

Deno.test("Availability data loading preserves table filters, ordering, and the two-year virtual horizon", async () => {
  const fake = createQueryClient({
    servant_availability: { data: [{ id: "dated-1", servant_id: "servant-1", service_date: "2026-11-07", status: "available" }], error: null },
    servant_availability_rules: { data: [{ id: "rule-1", servant_id: "servant-2", effective_from: "2026-11-07", effective_until: "2026-11-07", pattern: "saturday", status: "unavailable" }], error: null },
    servant_serving_preferences: { data: [{ id: "preference-1", active: true }], error: null },
    system_settings: { data: { key: "availability_deadline", value: "2026-11-20" }, error: null },
  });

  const result = await loadAvailabilityWorkspaceData(
    fake.client as unknown as Parameters<typeof loadAvailabilityWorkspaceData>[0],
    new Date("2026-11-06T12:00:00"),
  );

  assertEqual(result.rules.length, 1, "The loaded recurring rules should be exposed to the workspace.");
  assertEqual(result.preferences, [{ id: "preference-1", active: true }], "Serving preferences should retain the existing active-only read.");
  assertEqual(result.deadline, "2026-11-20", "The existing deadline setting value should be returned.");
  assertEqual(result.availability.map((row: any) => row.id), ["dated-1", "rule-rule-1-2026-11-07"], "Explicit and virtual availability rows should be combined in their existing order.");
  assertEqual(fake.calls.filter(call => call.operation === "from").map(call => call.table), [
    "servant_availability",
    "servant_availability_rules",
    "servant_serving_preferences",
    "system_settings",
  ], "All Availability reads should execute through the Availability data service.");
  assertEqual(fake.calls.filter(call => call.table === "servant_availability").map(call => [call.operation, ...call.args]), [
    ["select", "*"],
    ["order", "service_date", { ascending: true }],
  ], "Dated availability ordering should remain ascending by service date.");
  assertEqual(fake.calls.filter(call => call.table === "servant_availability_rules").map(call => [call.operation, ...call.args]), [
    ["select", "*"],
    ["order", "created_at", { ascending: false }],
  ], "Recurring rules should remain ordered newest first.");
  assertEqual(fake.calls.filter(call => call.table === "servant_serving_preferences").map(call => [call.operation, ...call.args]), [
    ["select", "*"],
    ["eq", "active", true],
    ["order", "created_at", { ascending: false }],
  ], "Only active serving preferences should be loaded, newest first.");
  assertEqual(fake.calls.filter(call => call.table === "system_settings").map(call => [call.operation, ...call.args]), [
    ["select", "*"],
    ["eq", "key", "availability_deadline"],
    ["maybeSingle"],
  ], "The same availability_deadline setting must be read with maybeSingle.");
  assertEqual(result.optionalErrors, [], "Successful optional reads should not create warnings.");
});

Deno.test("Availability data loading retains empty fallbacks for optional table errors", async () => {
  const fake = createQueryClient({
    servant_availability: { data: null, error: { message: "availability denied" } },
    servant_availability_rules: { data: null, error: { message: "rules unavailable" } },
    servant_serving_preferences: { data: null, error: { message: "preferences unavailable" } },
    system_settings: { data: null, error: { message: "settings unavailable" } },
  });
  const result = await loadAvailabilityWorkspaceData(
    fake.client as unknown as Parameters<typeof loadAvailabilityWorkspaceData>[0],
    new Date("2026-11-06T12:00:00"),
  );
  assertEqual(result.availability, [], "Failed dated availability and recurring-rule reads should produce an empty availability view.");
  assertEqual(result.rules, [], "A failed recurring-rule read should use an empty rule list.");
  assertEqual(result.preferences, [], "A failed serving-preference read should use an empty preference list.");
  assertEqual(result.deadline, "", "A failed deadline read should preserve the empty-string fallback.");
  assertEqual(result.optionalErrors, ["availability denied", "rules unavailable", "preferences unavailable", "settings unavailable"],
    "Each optional data error should remain independently visible to App diagnostics.");
});
