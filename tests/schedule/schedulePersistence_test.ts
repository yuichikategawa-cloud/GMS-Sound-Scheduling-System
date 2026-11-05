/// <reference lib="deno.ns" />

import {
  deleteScheduleById,
  saveScheduleWithAssignments,
  upsertGeneratedSchedules,
  type SchedulePersistenceClient,
  type SchedulePersistenceResponse,
  type SchedulePersistenceRow,
} from "../../src/features/schedule/services/schedulePersistence.ts";

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

const service = {
  service_date: "2026-11-07",
  location_id: "loc-as",
  service_name: "Saturday Service",
  start_time: "17:00",
  end_time: "19:00",
};

const assignments = [
  { role: "FOH" as const, servant_id: "servant-foh" },
  { role: "Monitor" as const, servant_id: "servant-monitor" },
];

const generatedRows: SchedulePersistenceRow[] = [
  { ...service },
  {
    service_date: "2026-11-08",
    location_id: "loc-as",
    service_name: "Sunday Service",
    start_time: "09:00",
    end_time: "11:00",
  },
];

interface RecordedCalls {
  rpc: Array<{ functionName: string; args: unknown }>;
  from: string[];
  upsert: Array<{ rows: SchedulePersistenceRow[]; options: unknown }>;
  delete: number;
  eq: Array<{ column: string; value: string }>;
}

function createFakeClient(response: SchedulePersistenceResponse = { error: null }): {
  client: SchedulePersistenceClient;
  calls: RecordedCalls;
} {
  const calls: RecordedCalls = {
    rpc: [],
    from: [],
    upsert: [],
    delete: 0,
    eq: [],
  };

  const client: SchedulePersistenceClient = {
    rpc: async (functionName, args) => {
      calls.rpc.push({ functionName, args });
      return response;
    },
    from: tableName => {
      calls.from.push(tableName);
      return {
        upsert: async (rows, options) => {
          calls.upsert.push({ rows, options });
          return response;
        },
        delete: () => {
          calls.delete += 1;
          return {
            eq: async (column, value) => {
              calls.eq.push({ column, value });
              return response;
            },
          };
        },
      };
    },
  };

  return { client, calls };
}

Deno.test("schedule persistence saves a new schedule through the existing atomic RPC", async () => {
  const { client, calls } = createFakeClient();
  await saveScheduleWithAssignments(client, {
    scheduleId: null,
    service,
    assignments,
  });

  assertEqual(calls.rpc, [{
    functionName: "admin_save_schedule_with_assignments",
    args: {
      p_schedule_id: null,
      p_service: service,
      p_assignments: assignments,
    },
  }], "A new schedule must pass a null ID and preserve the RPC payload.");
  assertEqual(calls.from, [], "The atomic save path must not write schedules directly.");
});

Deno.test("schedule persistence forwards the existing schedule ID when editing", async () => {
  const { client, calls } = createFakeClient();
  await saveScheduleWithAssignments(client, {
    scheduleId: "schedule-123",
    service,
    assignments,
  });

  assertEqual(calls.rpc[0], {
    functionName: "admin_save_schedule_with_assignments",
    args: {
      p_schedule_id: "schedule-123",
      p_service: service,
      p_assignments: assignments,
    },
  }, "Editing must use the existing ID and unchanged assignment payload.");
});

Deno.test("schedule generation add mode ignores rows that match the conflict key", async () => {
  const { client, calls } = createFakeClient();
  await upsertGeneratedSchedules(client, generatedRows, "add");

  assertEqual(calls.from, ["schedules"], "Generated rows must be written to schedules.");
  assertEqual(calls.upsert, [{
    rows: generatedRows,
    options: {
      onConflict: "service_date,location_id,service_name",
      ignoreDuplicates: true,
    },
  }], "Add mode must preserve the original conflict key and ignore-duplicates behavior.");
});

Deno.test("schedule generation replace mode updates matching rows", async () => {
  const { client, calls } = createFakeClient();
  await upsertGeneratedSchedules(client, generatedRows, "replace");

  assertEqual(calls.upsert[0].options, {
    onConflict: "service_date,location_id,service_name",
    ignoreDuplicates: false,
  }, "Replace mode must preserve the original upsert behavior.");
});

Deno.test("schedule deletion filters by the requested schedule ID", async () => {
  const { client, calls } = createFakeClient();
  await deleteScheduleById(client, "schedule-456");

  assertEqual(calls.from, ["schedules"], "Deletion must target the schedules table.");
  assertEqual(calls.delete, 1, "Deletion must execute once.");
  assertEqual(calls.eq, [{ column: "id", value: "schedule-456" }], "Deletion must filter by ID.");
});

Deno.test("schedule persistence returns database errors unchanged for RPC, upsert, and delete", async () => {
  const databaseError = { code: "P0001", message: "Database rejected the operation." };
  const response = { error: databaseError };
  const rpcClient = createFakeClient(response);
  const upsertClient = createFakeClient(response);
  const deleteClient = createFakeClient(response);

  const rpcResult = await saveScheduleWithAssignments(rpcClient.client, {
    scheduleId: null,
    service,
    assignments,
  });
  const upsertResult = await upsertGeneratedSchedules(upsertClient.client, generatedRows, "add");
  const deleteResult = await deleteScheduleById(deleteClient.client, "schedule-789");

  assertSame(rpcResult.error, databaseError, "RPC database errors must be returned unchanged.");
  assertSame(upsertResult.error, databaseError, "Upsert database errors must be returned unchanged.");
  assertSame(deleteResult.error, databaseError, "Delete database errors must be returned unchanged.");
});
