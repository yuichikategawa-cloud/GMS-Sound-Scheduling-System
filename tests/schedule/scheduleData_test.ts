/// <reference lib="deno.ns" />

import {
  loadHistoricalScheduleData,
  loadScheduleWorkspaceData,
  type ScheduleDataClient,
  type ScheduleDataFromBuilder,
  type ScheduleDataQueryResponse,
} from "../../src/features/schedule/services/scheduleData.ts";

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      message + "\\nExpected: " + JSON.stringify(expected) + "\\nActual: " + JSON.stringify(actual),
    );
  }
}

function assertSame(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new Error(message);
}

interface QueryOperation {
  method: string;
  args: unknown[];
}

function createClient(responses: Record<string, ScheduleDataQueryResponse>): {
  client: ScheduleDataClient;
  calls: Array<{ table: string; operations: QueryOperation[] }>;
} {
  const calls: Array<{ table: string; operations: QueryOperation[] }> = [];
  const client = {
    from(table: string) {
      const call = { table, operations: [] as QueryOperation[] };
      calls.push(call);
      const builder = {
        select(columns: string) {
          call.operations.push({ method: "select", args: [columns] });
          return builder;
        },
        order(column: string, options?: { ascending?: boolean }) {
          call.operations.push({ method: "order", args: options === undefined ? [column] : [column, options] });
          return builder;
        },
        eq(column: string, value: unknown) {
          call.operations.push({ method: "eq", args: [column, value] });
          return builder;
        },
        lt(column: string, value: string) {
          call.operations.push({ method: "lt", args: [column, value] });
          return builder;
        },
        then<TResult1 = ScheduleDataQueryResponse, TResult2 = never>(
          onfulfilled?: ((value: ScheduleDataQueryResponse) => TResult1 | PromiseLike<TResult1>) | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
        ): PromiseLike<TResult1 | TResult2> {
          return Promise.resolve(responses[table]).then(onfulfilled, onrejected);
        },
      };
      return builder as unknown as ScheduleDataFromBuilder;
    },
  };
  return { client: client as ScheduleDataClient, calls };
}

Deno.test("Schedule workspace loading preserves each dashboard query and runs independently", async () => {
  const locations = { data: [{ id: "loc-1", name: "Gading Serpong" }], error: null };
  const templates = { data: [{ id: "template-1", active: true }], error: null };
  const schedules = { data: [{ id: "schedule-1" }], error: null };
  const assignments = { data: [{ id: "assignment-1" }], error: null };
  const { client, calls } = createClient({
    locations,
    service_templates: templates,
    schedules,
    assignments,
  });

  const result = await loadScheduleWorkspaceData(client);

  assertSame(result.locations, locations, "Location response must pass through unchanged.");
  assertSame(result.templates, templates, "Template response must pass through unchanged.");
  assertSame(result.schedules, schedules, "Schedule response must pass through unchanged.");
  assertSame(result.assignments, assignments, "Assignment response must pass through unchanged.");
  assertEqual(calls.map(call => ({ table: call.table, operations: call.operations })), [
    { table: "locations", operations: [{ method: "select", args: ["*"] }, { method: "order", args: ["name"] }] },
    { table: "service_templates", operations: [{ method: "select", args: ["*"] }, { method: "eq", args: ["active", true] }] },
    { table: "schedules", operations: [{ method: "select", args: ["*"] }, { method: "order", args: ["service_date"] }, { method: "order", args: ["start_time"] }] },
    { table: "assignments", operations: [{ method: "select", args: ["*"] }] },
  ], "Schedule workspace query contracts must remain unchanged.");
});

Deno.test("Schedule workspace loading preserves independent query errors", async () => {
  const queryError = { message: "Templates unavailable." };
  const locations = { data: [{ id: "loc-1", name: "Gading Serpong" }], error: null };
  const templates = { data: null, error: queryError };
  const schedules = { data: [{ id: "schedule-1" }], error: null };
  const assignments = { data: [], error: null };
  const { client } = createClient({ locations, service_templates: templates, schedules, assignments });

  const result = await loadScheduleWorkspaceData(client);

  assertSame(result.templates.error, queryError, "Optional template query errors must remain visible to the caller.");
  assertSame(result.templates.data, null, "A failed template read must not fabricate data.");
  assertSame(result.locations, locations, "A template failure must not discard successful core reads.");
  assertSame(result.schedules, schedules, "Schedule data must remain independent of the template result.");
});

Deno.test("historical schedule loading preserves relation selection, date filter, and newest-first order", async () => {
  const history = { data: [{ id: "old-schedule" }], error: null };
  const { client, calls } = createClient({ schedules: history });

  const result = await loadHistoricalScheduleData(client, "2026-11-06");

  assertSame(result, history, "Historical query response must pass through unchanged.");
  assertEqual(calls, [{
    table: "schedules",
    operations: [
      { method: "select", args: ["*,locations(name),assignments(role,servants(full_name))"] },
      { method: "lt", args: ["service_date", "2026-11-06"] },
      { method: "order", args: ["service_date", { ascending: false }] },
    ],
  }], "Historical schedule export must preserve its existing query shape.");
});

Deno.test("historical schedule loading preserves database errors", async () => {
  const queryError = { message: "History access denied." };
  const { client } = createClient({ schedules: { data: null, error: queryError } });

  const result = await loadHistoricalScheduleData(client, "2026-11-06");

  assertSame(result.error, queryError, "History query errors must pass through unchanged.");
});
