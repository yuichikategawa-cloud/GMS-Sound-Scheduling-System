/// <reference lib="deno.ns" />

import {
  buildAuditCsv,
  loadHistoricalAuditLogs,
  loadRecentAuditLogs,
  type AuditDataClient,
  type AuditQueryResponse,
} from "../../src/features/audit/services/auditData.ts";

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

interface RecordedCall {
  table: string;
  columns: string;
  gte?: { column: string; value: string };
  lt?: { column: string; value: string };
  order?: { column: string; ascending: boolean };
  limit?: number;
  range?: { from: number; to: number };
}

function createRecentClient(
  response: AuditQueryResponse,
): { client: AuditDataClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const client = {
    from(table: string) {
      return {
        select(columns: string) {
          calls.push({ table, columns });
          return {
            gte(column: string, value: string) {
              calls[calls.length - 1].gte = { column, value };
              return {
                order(column: string, options: { ascending: boolean }) {
                  calls[calls.length - 1].order = { column, ascending: options.ascending };
                  return {
                    limit(count: number) {
                      calls[calls.length - 1].limit = count;
                      return Promise.resolve(response);
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  } as AuditDataClient;
  return { client, calls };
}

function createHistoricalClient(
  responses: AuditQueryResponse[],
): { client: AuditDataClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  let responseIndex = 0;
  const client = {
    from(table: string) {
      return {
        select(columns: string) {
          calls.push({ table, columns });
          return {
            lt(column: string, value: string) {
              calls[calls.length - 1].lt = { column, value };
              return {
                order(orderColumn: string, options: { ascending: boolean }) {
                  calls[calls.length - 1].order = { column: orderColumn, ascending: options.ascending };
                  return {
                    range(from: number, to: number) {
                      calls[calls.length - 1].range = { from, to };
                      const response = responses[responseIndex++];
                      return Promise.resolve(response);
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  } as AuditDataClient;
  return { client, calls };
}

Deno.test("recent audit loading preserves the 14-day cutoff, newest-first order, and 50-row limit", async () => {
  const response = { data: [{ id: "audit-1" }], error: null };
  const cutoff = "2026-10-22T12:00:00.000Z";
  const { client, calls } = createRecentClient(response);

  const result = await loadRecentAuditLogs(client, cutoff);

  assertEqual(calls, [{
    table: "audit_logs",
    columns: "*",
    gte: { column: "created_at", value: cutoff },
    order: { column: "created_at", ascending: false },
    limit: 50,
  }], "Recent audit query must keep its existing filters, order, and limit.");
  assertSame(result, response, "Recent audit query response must pass through unchanged.");
});

Deno.test("historical audit export paginates in 1,000-row pages and combines all rows", async () => {
  const firstPage = Array.from({ length: 1000 }, (_, index) => ({ id: "audit-" + index }));
  const secondPage = [{ id: "audit-1000" }];
  const cutoff = "2026-10-22T12:00:00.000Z";
  const { client, calls } = createHistoricalClient([
    { data: firstPage, error: null },
    { data: secondPage, error: null },
  ]);

  const result = await loadHistoricalAuditLogs(client, cutoff);

  assertEqual(calls, [
    {
      table: "audit_logs",
      columns: "*",
      lt: { column: "created_at", value: cutoff },
      order: { column: "created_at", ascending: false },
      range: { from: 0, to: 999 },
    },
    {
      table: "audit_logs",
      columns: "*",
      lt: { column: "created_at", value: cutoff },
      order: { column: "created_at", ascending: false },
      range: { from: 1000, to: 1999 },
    },
  ], "Historical audit export must request contiguous descending 1,000-row pages.");
  assertEqual(result.data?.length, 1001, "All historical pages must be combined.");
  assertSame(result.data?.[1000], secondPage[0], "The final row from the next page must be retained.");
  assertSame(result.error, null, "Successful historical pages must return no error.");
});

Deno.test("historical audit export stops after a short page and preserves empty history", async () => {
  const { client, calls } = createHistoricalClient([{ data: [], error: null }]);

  const result = await loadHistoricalAuditLogs(client, "cutoff");

  assertEqual(calls.length, 1, "An empty first page must stop pagination immediately.");
  assertEqual(result.data, [], "Empty historical audit history must remain a successful empty result.");
  assertSame(result.error, null, "An empty successful page must not become an error.");
});

Deno.test("historical audit export returns query errors and stops without requesting later pages", async () => {
  const error = { code: "42501", message: "Audit history is unavailable." };
  const { client, calls } = createHistoricalClient([{ data: null, error }]);

  const result = await loadHistoricalAuditLogs(client, "cutoff");

  assertEqual(calls.length, 1, "Pagination must stop immediately after a query error.");
  assertSame(result.data, null, "Failed historical export must not expose partial data as a successful result.");
  assertSame(result.error, error, "The original database error must pass through unchanged.");
});

Deno.test("audit CSV preserves the column order, quotes, JSON values, and empty null cells", () => {
  const csv = buildAuditCsv([{
    created_at: "2026-11-01T10:00:00.000Z",
    actor_id: null,
    action: "UPDATE \"title\"",
    table_name: "schedules",
    record_id: "schedule,1",
    old_data: { title: "Old" },
    new_data: null,
  }]);

  assertEqual(
    csv,
    "created_at,actor_id,action,table_name,record_id,old_data,new_data\r\n" +
      "\"2026-11-01T10:00:00.000Z\",\"\",\"UPDATE \"\"title\"\"\",\"schedules\",\"schedule,1\",\"{\"\"title\"\":\"\"Old\"\"}\",\"\"",
    "CSV output must preserve the existing columns and RFC-style quoted-cell escaping.",
  );
});

Deno.test("audit CSV emits only its header when the supplied export is empty", () => {
  assertEqual(
    buildAuditCsv([]),
    "created_at,actor_id,action,table_name,record_id,old_data,new_data",
    "Empty CSV output must retain the stable header row.",
  );
});
