/// <reference lib="deno.ns" />

import {
  deleteScheduleById,
  saveScheduleWithAssignments,
  upsertGeneratedSchedules,
  updateSchedulePublication,
  saveBulkScheduleAssignments,
  deleteLocationSchedules,
  createScheduleLocation,
  upsertScheduleServiceTemplate,
  archiveScheduleServiceTemplate,
  updateAssignmentConfirmation,
  notifyAdminAssignmentConfirmation,
  replaceGeneratedSchedulesAtomically,
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


Deno.test("atomic weekend replacement uses one database RPC for the complete batch", async () => {
  const calls: unknown[] = [];
  const databaseResponse = { data: 3, error: null };
  const client = {
    rpc: async (name: string, args: unknown) => {
      calls.push({ name, args });
      return databaseResponse;
    },
  };
  const rows = [
    { ...service },
    { ...service, service_date: "2026-11-14", service_name: "Next Saturday" },
  ];
  const result = await replaceGeneratedSchedulesAtomically(client, rows);
  assertEqual(calls, [{
    name: "admin_replace_weekend_schedules_atomic",
    args: { p_rows: rows },
  }], "All template rows must be sent together in one atomic database call.");
  assertSame(result, databaseResponse, "The replacement RPC response must pass through unchanged.");
});

Deno.test("schedule generation replace mode is blocked from bypassing the atomic admin save", async () => {
  const { client, calls } = createFakeClient();
  const result = await upsertGeneratedSchedules(client, generatedRows, "replace");

  assertEqual(calls.upsert, [], "Replace mode must not issue a direct schedules upsert.");
  assertEqual(calls.rpc, [], "Replace mode must not silently fall back to a partial sequence of per-slot RPCs.");
  if (!result.error || !(result.error instanceof Error) ||
      !result.error.message.includes("temporarily disabled")) {
    throw new Error("Replace mode must return a clear safety error.");
  }
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


Deno.test("schedule publication preserves the grouped admin RPC arguments", async () => {
  const calls: Array<{ name: string; args: unknown }> = [];
  const client = {
    rpc: async (name: string, args: unknown) => {
      calls.push({ name, args });
      return { error: null };
    },
  };
  await updateSchedulePublication(client as any, {
    locationId: null, scheduleIds: ["schedule-1"], status: "published",
  });
  await updateSchedulePublication(client as any, {
    locationId: "location-2", scheduleIds: null, status: "draft",
  });
  assertEqual(calls, [
    { name: "admin_publish_schedules_grouped", args: { p_location_id: null, p_schedule_ids: ["schedule-1"], p_status: "published" } },
    { name: "admin_publish_schedules_grouped", args: { p_location_id: "location-2", p_schedule_ids: null, p_status: "draft" } },
  ], "Schedule publication must preserve the existing admin RPC argument shape.");
});

Deno.test("bulk schedule assignment preserves its grouped admin RPC payload and response", async () => {
  const response = { data: 2, error: null };
  let call: unknown;
  const client = { rpc: async (name: string, args: unknown) => { call = { name, args }; return response; } };
  const rows = [{ schedule_id: "s1", role: "FOH", servant_id: "p1" }];
  const result = await saveBulkScheduleAssignments(client as any, rows);
  assertEqual(call, {
    name: "admin_bulk_assignments_grouped",
    args: { p_assignments: rows, p_batch_label: "Bulk schedule assignment" },
  }, "Bulk assignment must retain its RPC name and exact payload.");
  assertSame(result, response, "The bulk RPC response must pass through unchanged.");
});

Deno.test("schedule location deletion preserves all-church and single-location filters", async () => {
  const calls: unknown[] = [];
  const client = {
    from: (table: string) => ({
      delete: () => ({
        in: (column: string, ids: string[]) => { calls.push({ table, method: "in", column, ids }); return Promise.resolve({ error: null }); },
        eq: (column: string, id: string) => { calls.push({ table, method: "eq", column, id }); return Promise.resolve({ error: null }); },
      }),
    }),
  };
  await deleteLocationSchedules(client as any, ["a", "b", "c"], true);
  await deleteLocationSchedules(client as any, ["b"], false);
  assertEqual(calls, [
    { table: "schedules", method: "in", column: "location_id", ids: ["a", "b", "c"] },
    { table: "schedules", method: "eq", column: "location_id", id: "b" },
  ], "Deleting location schedules must keep the original single/all-location filters.");
});

Deno.test("schedule location and service-template writes preserve existing table contracts", async () => {
  const calls: unknown[] = [];
  const client = {
    from: (table: string) => ({
      insert: (values: unknown) => { calls.push({ table, method: "insert", values }); return Promise.resolve({ error: null }); },
      upsert: (values: unknown, options: unknown) => { calls.push({ table, method: "upsert", values, options }); return Promise.resolve({ error: null }); },
      update: (values: unknown) => ({
        eq: (column: string, value: string | number) => { calls.push({ table, method: "update", values, column, value }); return Promise.resolve({ error: null }); },
      }),
    }),
  };
  await createScheduleLocation(client as any, "West Campus");
  const template = { location_id: "loc-1", day_of_week: 6, service_name: "Saturday", start_time: "09:00", end_time: "11:00", active: true };
  await upsertScheduleServiceTemplate(client as any, template);
  await archiveScheduleServiceTemplate(client as any, "template-3");
  assertEqual(calls, [
    { table: "locations", method: "insert", values: { name: "West Campus" } },
    { table: "service_templates", method: "upsert", values: template, options: { onConflict: "location_id,day_of_week,service_name" } },
    { table: "service_templates", method: "update", values: { active: false }, column: "id", value: "template-3" },
  ], "Location and template operations must preserve existing table payloads and filters.");
});


Deno.test("assignment confirmation persistence updates only the selected assignment status", async () => {
  const calls: unknown[] = [];
  const client = {
    from(tableName: string) {
      calls.push({ from: tableName });
      return {
        update(values: unknown) {
          calls.push({ update: values });
          return {
            eq(column: string, value: string) {
              calls.push({ eq: { column, value } });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
    rpc() {
      throw new Error("Confirmation update must not send the notification RPC.");
    },
  };
  await updateAssignmentConfirmation(client as any, "assignment-42", "declined");
  assertEqual(calls, [
    { from: "assignments" },
    { update: { confirmation_status: "declined" } },
    { eq: { column: "id", value: "assignment-42" } },
  ], "Confirmation persistence must preserve the existing table, status field, and ID filter.");
});

Deno.test("assignment confirmation notification preserves the existing admin RPC contract", async () => {
  const calls: unknown[] = [];
  const client = {
    from() {
      throw new Error("Notification must not update assignments.");
    },
    rpc(name: string, args: unknown) {
      calls.push({ name, args });
      return Promise.resolve({ error: null });
    },
  };
  await notifyAdminAssignmentConfirmation(client as any, "assignment-43");
  assertEqual(calls, [{
    name: "notify_admin_assignment_confirmation",
    args: { p_assignment_id: "assignment-43" },
  }], "The notification must use the existing RPC and assignment ID argument.");
});

Deno.test("assignment confirmation persistence returns database errors unchanged", async () => {
  const databaseError = { code: "42501", message: "Confirmation update rejected." };
  const client = {
    from() {
      return {
        update() {
          return {
            eq() {
              return Promise.resolve({ error: databaseError });
            },
          };
        },
      };
    },
    rpc() {
      return Promise.resolve({ error: databaseError });
    },
  };
  const update = await updateAssignmentConfirmation(client as any, "assignment-44", "confirmed");
  const notification = await notifyAdminAssignmentConfirmation(client as any, "assignment-44");
  assertSame(update.error, databaseError, "Assignment update errors must pass through unchanged.");
  assertSame(notification.error, databaseError, "Notification RPC errors must pass through unchanged.");
});
