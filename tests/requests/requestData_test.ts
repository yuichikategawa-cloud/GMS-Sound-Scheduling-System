/// <reference lib="deno.ns" />

import {
  loadServingRequestData,
  type ServingRequestDataClient,
  type ServingRequestQueryResponse,
  type ServingRequestRecord,
  type ServingRequestReadMarker,
} from "../../src/features/requests/services/requestData.ts";

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
  table: "serving_requests" | "serving_request_reads";
  columns: "*";
  order?: { column: "created_at"; ascending: false };
}

function createClient(
  requestsResponse: ServingRequestQueryResponse<ServingRequestRecord>,
  readsResponse: ServingRequestQueryResponse<ServingRequestReadMarker>,
): { client: ServingRequestDataClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const client = {
    from(table: "serving_requests" | "serving_request_reads") {
      return {
        select(columns: "*") {
          if (table === "serving_requests") {
            calls.push({ table, columns });
            return {
              order: async (column: "created_at", options: { ascending: false }) => {
                calls[calls.length - 1].order = { column, ascending: options.ascending };
                return requestsResponse;
              },
            };
          }
          calls.push({ table, columns });
          return Promise.resolve(readsResponse);
        },
      };
    },
  } as ServingRequestDataClient;
  return { client, calls };
}

Deno.test("serving request data preserves both query contracts and their parallel result order", async () => {
  const requestRows = [{
    id: "request-1",
    schedule_id: "schedule-1",
    assignment_id: "assignment-1",
    requester_servant_id: "servant-1",
    request_type: "replacement" as const,
    details: "Family commitment",
    status: "pending" as const,
    created_at: "2026-11-01T10:00:00Z",
  }];
  const readRows = [{ request_id: "request-1", user_id: "servant-1" }];
  const requestsResponse = { data: requestRows, error: null };
  const readsResponse = { data: readRows, error: null };
  const { client, calls } = createClient(requestsResponse, readsResponse);

  const result = await loadServingRequestData(client);

  assertEqual(calls, [
    { table: "serving_requests", columns: "*", order: { column: "created_at", ascending: false } },
    { table: "serving_request_reads", columns: "*" },
  ], "The helper must preserve table names, selected columns, request ordering, and reads query shape.");
  assertSame(result.requests, requestsResponse, "Serving-request response must pass through unchanged.");
  assertSame(result.reads, readsResponse, "Request-read response must pass through unchanged.");
});

Deno.test("serving request data keeps request-table errors independent from read markers", async () => {
  const requestError = { code: "42501", message: "Serving requests are unavailable." };
  const requestsResponse = { data: null, error: requestError };
  const readsResponse = { data: [{ request_id: "request-1", user_id: "servant-1" }], error: null };
  const { client } = createClient(requestsResponse, readsResponse);

  const result = await loadServingRequestData(client);

  assertSame(result.requests.error, requestError, "The original request-table error must be preserved.");
  assertSame(result.reads, readsResponse, "Read markers must remain available when request loading fails.");
});

Deno.test("serving request data keeps read-marker errors independent from requests", async () => {
  const requestsResponse = { data: [{
    id: "request-1",
    schedule_id: "schedule-1",
    assignment_id: "assignment-1",
    requester_servant_id: "servant-1",
    request_type: "replacement" as const,
    details: "Family commitment",
    status: "pending" as const,
    created_at: "2026-11-01T10:00:00Z",
  }], error: null };
  const readsError = { code: "42P01", message: "Request read markers are unavailable." };
  const readsResponse = { data: null, error: readsError };
  const { client } = createClient(requestsResponse, readsResponse);

  const result = await loadServingRequestData(client);

  assertSame(result.requests, requestsResponse, "Serving requests must remain available when read-marker loading fails.");
  assertSame(result.reads.error, readsError, "The original read-marker error must be preserved.");
});

Deno.test("serving request data preserves empty successful results separately from errors", async () => {
  const requestsResponse = { data: [], error: null };
  const readsResponse = { data: [], error: null };
  const { client } = createClient(requestsResponse, readsResponse);

  const result = await loadServingRequestData(client);

  assertEqual(result.requests.data, [], "An empty request list must remain a successful empty result.");
  assertEqual(result.reads.data, [], "An empty read-marker list must remain a successful empty result.");
  assertSame(result.requests.error, null, "An empty successful request list must retain a null error.");
  assertSame(result.reads.error, null, "An empty successful read-marker list must retain a null error.");
});
