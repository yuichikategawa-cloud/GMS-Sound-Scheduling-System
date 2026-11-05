/// <reference lib="deno.ns" />

import {
  createServingRequest,
  executeServingRequestSwap,
  markServingRequestRead,
  resolveServingRequestReplacement,
  updateServingRequestReview,
  type RequestPersistenceResponse,
  type ServingRequestInsertPayload,
  type ServingRequestPersistenceClient,
  type ServingRequestReadPayload,
  type ServingRequestReviewPayload,
} from "../../src/features/requests/services/requestPersistence.ts";

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

interface RecordedCalls {
  from: string[];
  insert: ServingRequestInsertPayload[];
  update: ServingRequestReviewPayload[];
  eq: Array<{ column: string; value: string }>;
  upsert: Array<{ values: ServingRequestReadPayload; options: { onConflict: string } }>;
  rpc: Array<{ functionName: string; args: unknown }>;
}

function createClient(response: RequestPersistenceResponse = { error: null }): {
  client: ServingRequestPersistenceClient;
  calls: RecordedCalls;
} {
  const calls: RecordedCalls = {
    from: [],
    insert: [],
    update: [],
    eq: [],
    upsert: [],
    rpc: [],
  };
  const client = {
    from(tableName: "serving_requests" | "serving_request_reads") {
      calls.from.push(tableName);
      return {
        insert(values: ServingRequestInsertPayload) {
          calls.insert.push(values);
          return Promise.resolve(response);
        },
        update(values: ServingRequestReviewPayload) {
          calls.update.push(values);
          return {
            eq(column: "id", value: string) {
              calls.eq.push({ column, value });
              return Promise.resolve(response);
            },
          };
        },
        upsert(values: ServingRequestReadPayload, options: { onConflict: "request_id,user_id" }) {
          calls.upsert.push({ values, options });
          return Promise.resolve(response);
        },
      };
    },
    rpc(functionName: "admin_execute_servant_swap" | "admin_resolve_replacement", args: unknown) {
      calls.rpc.push({ functionName, args });
      return Promise.resolve(response);
    },
  } as unknown as ServingRequestPersistenceClient;
  return { client, calls };
}

Deno.test("serving request persistence inserts replacement requests without altering their payload", async () => {
  const { client, calls } = createClient();
  const payload: ServingRequestInsertPayload = {
    schedule_id: "schedule-1",
    assignment_id: "assignment-1",
    requester_servant_id: "servant-1",
    request_type: "replacement",
    details: "Medical appointment",
    status: "pending",
  };

  const result = await createServingRequest(client, payload);

  assertEqual(calls.from, ["serving_requests"], "Replacement requests must target the existing requests table.");
  assertEqual(calls.insert, [payload], "Replacement request payload must pass through unchanged.");
  assertSame(result.error, null, "Successful request inserts must retain a null error.");
});

Deno.test("serving request persistence preserves all cross-date swap target fields", async () => {
  const { client, calls } = createClient();
  const payload: ServingRequestInsertPayload = {
    schedule_id: "source-schedule",
    assignment_id: "source-assignment",
    requester_servant_id: "requester-servant",
    request_type: "swap",
    details: "Family commitment",
    status: "pending",
    target_schedule_id: "target-schedule",
    target_assignment_id: "target-assignment",
    target_servant_id: "target-servant",
  };

  await createServingRequest(client, payload);

  assertEqual(calls.insert, [payload], "Swap request target IDs must be persisted exactly as supplied.");
});

Deno.test("serving request persistence upserts read markers with the existing conflict key", async () => {
  const { client, calls } = createClient();
  const payload = {
    request_id: "request-1",
    user_id: "user-1",
    read_at: "2026-11-05T12:00:00.000Z",
  };

  await markServingRequestRead(client, payload);

  assertEqual(calls.from, ["serving_request_reads"], "Read markers must target their existing table.");
  assertEqual(calls.upsert, [{ values: payload, options: { onConflict: "request_id,user_id" } }], "Read marker upsert must preserve its exact payload and conflict key.");
});

Deno.test("serving request persistence updates review fields by request ID", async () => {
  const { client, calls } = createClient();
  const payload = {
    status: "approved" as const,
    reviewed_by: "admin-user",
    reviewed_at: "2026-11-05T12:01:00.000Z",
  };

  await updateServingRequestReview(client, "request-1", payload);

  assertEqual(calls.from, ["serving_requests"], "Review updates must target the existing requests table.");
  assertEqual(calls.update, [payload], "Only the existing review payload must be written.");
  assertEqual(calls.eq, [{ column: "id", value: "request-1" }], "Review update must filter by request ID.");
});

Deno.test("serving request persistence executes swap approval through the existing admin RPC", async () => {
  const { client, calls } = createClient();

  await executeServingRequestSwap(client, "request-swap-1");

  assertEqual(calls.rpc, [{ functionName: "admin_execute_servant_swap", args: { p_request_id: "request-swap-1" } }], "Swap execution must preserve the existing RPC name and arguments.");
  assertEqual(calls.from, [], "Swap execution must not write assignments directly.");
});

Deno.test("serving request persistence resolves replacements through the existing admin RPC", async () => {
  const { client, calls } = createClient();

  await resolveServingRequestReplacement(client, "request-replacement-1", "replacement-servant-1");

  assertEqual(calls.rpc, [{ functionName: "admin_resolve_replacement", args: { p_request_id: "request-replacement-1", p_replacement_servant_id: "replacement-servant-1" } }], "Replacement resolution must preserve the existing admin RPC contract.");
  assertEqual(calls.from, [], "Replacement resolution must not update assignment rows directly.");
});

Deno.test("serving request persistence passes database errors through unchanged", async () => {
  const databaseError = { code: "42501", message: "Request update denied." };
  const { client } = createClient({ error: databaseError });

  const result = await updateServingRequestReview(client, "request-1", {
    status: "declined",
    reviewed_by: "admin-user",
    reviewed_at: "2026-11-05T12:02:00.000Z",
  });

  assertSame(result.error, databaseError, "Database errors must pass through without translation or replacement.");
});
