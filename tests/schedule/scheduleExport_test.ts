/// <reference lib="deno.ns" />

import { prepareHistoricalScheduleCsv } from "../../src/features/schedule/services/scheduleExport.ts";

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message + "\\nExpected: " + JSON.stringify(expected) + "\\nActual: " + JSON.stringify(actual));
  }
}

function createClient(response: { data: any[] | null; error: { message: string } | null }) {
  const calls: Array<{ table: string; operations: Array<{ method: string; args: unknown[] }> }> = [];
  const client = {
    from(table: string) {
      const call = { table, operations: [] as Array<{ method: string; args: unknown[] }> };
      calls.push(call);
      const builder = {
        select(columns: string) { call.operations.push({ method: "select", args: [columns] }); return builder; },
        lt(column: string, value: string) { call.operations.push({ method: "lt", args: [column, value] }); return builder; },
        order(column: string, options: { ascending: boolean }) { call.operations.push({ method: "order", args: [column, options] }); return builder; },
        then<TResult1 = typeof response, TResult2 = never>(
          onfulfilled?: ((value: typeof response) => TResult1 | PromiseLike<TResult1>) | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
        ): PromiseLike<TResult1 | TResult2> {
          return Promise.resolve(response).then(onfulfilled, onrejected);
        },
      };
      return builder;
    },
  };
  return { client, calls };
}

Deno.test("historical schedule export preparation preserves query and CSV contract", async () => {
  const rows = [{
    service_date: "2026-11-01",
    locations: { name: "North Campus" },
    service_name: "Sunday Service",
    start_time: "09:00:00",
    end_time: "11:00:00",
    assignments: [{ role: "FOH", servants: { full_name: "Ada" } }],
  }];
  const { client, calls } = createClient({ data: rows, error: null });
  const result = await prepareHistoricalScheduleCsv(client, "2026-11-06", ["FOH", "Monitor"], time => time.slice(0, 5));

  assertEqual(calls, [{
    table: "schedules",
    operations: [
      { method: "select", args: ["*,locations(name),assignments(role,servants(full_name))"] },
      { method: "lt", args: ["service_date", "2026-11-06"] },
      { method: "order", args: ["service_date", { ascending: false }] },
    ],
  }], "Historical export must retain the existing Schedule query.");
  assertEqual(result, {
    csv: "date,location,service,start,end,FOH,Monitor\r\n" +
      "\"2026-11-01\",\"North Campus\",\"Sunday Service\",\"09:00\",\"11:00\",\"Ada\",\"\"",
    recordCount: 1,
    error: null,
  }, "Historical export must return the role-aware CSV and exact row count.");
});

Deno.test("historical schedule export preparation preserves empty history as a header-only CSV", async () => {
  const { client } = createClient({ data: [], error: null });
  const result = await prepareHistoricalScheduleCsv(client, "2026-11-06", ["FOH"], time => time.slice(0, 5));
  assertEqual(result, {
    csv: "date,location,service,start,end,FOH",
    recordCount: 0,
    error: null,
  }, "An empty history must retain the previous header-only CSV download behavior.");
});

Deno.test("historical schedule export preparation preserves query errors", async () => {
  const error = { message: "Schedule history unavailable." };
  const { client } = createClient({ data: null, error });
  const result = await prepareHistoricalScheduleCsv(client, "2026-11-06", ["FOH"], time => time.slice(0, 5));
  assertEqual(result, { csv: null, recordCount: 0, error },
    "Historical export must propagate database errors without producing a CSV.");
});
