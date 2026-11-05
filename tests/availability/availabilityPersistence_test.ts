/// <reference lib="deno.ns" />

import {
  deleteAvailabilityRecordById,
  deleteAvailabilityRuleById,
  deleteServingPreferenceById,
  insertAvailabilityRule,
  insertServingPreference,
  upsertAvailabilityDeadline,
  upsertAvailabilityRecord,
  upsertAvailabilityRecords,
  type AvailabilityPersistenceResponse,
  type AvailabilityRulePayload,
  type AvailabilitySubmissionRow,
  type ServingPreferencePayload,
} from "../../src/features/availability/services/availabilityPersistence.ts";

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
  upsert: Array<{ values: unknown; options: unknown }>;
  insert: unknown[];
  delete: number;
  eq: Array<{ column: string; value: string }>;
}

function createFakeClient(response: AvailabilityPersistenceResponse = { error: null }): {
  client: { from(tableName: string): any };
  calls: RecordedCalls;
} {
  const calls: RecordedCalls = {
    from: [],
    upsert: [],
    insert: [],
    delete: 0,
    eq: [],
  };

  const client = {
    from(tableName: string) {
      calls.from.push(tableName);
      return {
        upsert: async (values: unknown, options: unknown) => {
          calls.upsert.push({ values, options });
          return response;
        },
        insert: async (values: unknown) => {
          calls.insert.push(values);
          return response;
        },
        delete: () => {
          calls.delete += 1;
          return {
            eq: async (column: string, value: string) => {
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

const singleRow: AvailabilitySubmissionRow = {
  servant_id: "servant-1",
  service_date: "2026-11-07",
  status: "unavailable",
  notes: "Family commitment",
};

const bulkRows: AvailabilitySubmissionRow[] = [
  singleRow,
  {
    servant_id: "servant-2",
    service_date: "2026-11-08",
    status: "available",
    notes: "",
  },
];

const recurringRule: AvailabilityRulePayload = {
  servant_id: "servant-1",
  pattern: "weekday",
  status: "unavailable",
  effective_from: "2026-11-01",
  effective_until: null,
  weekday: 6,
  ordinal: 2,
  notes: "Weekly restriction",
};

const servingPreference: ServingPreferencePayload = {
  servant_id: "servant-1",
  rule_type: "allowed_time_window",
  days_of_week: [0, 6],
  start_time: "07:00",
  end_time: "11:00",
  location_id: null,
  service_names: [],
  notes: "Morning services only",
  active: true,
};

Deno.test("availability persistence upserts one row using the existing conflict key", async () => {
  const { client, calls } = createFakeClient();
  await upsertAvailabilityRecord(
    client as unknown as Parameters<typeof upsertAvailabilityRecord>[0],
    singleRow,
  );

  assertEqual(calls.from, ["servant_availability"], "A dated row must target servant_availability.");
  assertEqual(calls.upsert, [{
    values: singleRow,
    options: { onConflict: "servant_id,service_date" },
  }], "Single-row upsert must preserve its payload and conflict key.");
});

Deno.test("availability persistence upserts bulk rows with the same conflict key", async () => {
  const { client, calls } = createFakeClient();
  await upsertAvailabilityRecords(
    client as unknown as Parameters<typeof upsertAvailabilityRecords>[0],
    bulkRows,
  );

  assertEqual(calls.from, ["servant_availability"], "Bulk rows must target servant_availability.");
  assertEqual(calls.upsert, [{
    values: bulkRows,
    options: { onConflict: "servant_id,service_date" },
  }], "Bulk upsert must preserve row ordering, content, and conflict behavior.");
});

Deno.test("availability persistence inserts recurring rules with the creator account", async () => {
  const { client, calls } = createFakeClient();
  await insertAvailabilityRule(
    client as unknown as Parameters<typeof insertAvailabilityRule>[0],
    recurringRule,
    "admin-user",
  );

  assertEqual(calls.from, ["servant_availability_rules"], "Recurring rules must target their existing table.");
  assertEqual(calls.insert, [{
    ...recurringRule,
    created_by: "admin-user",
  }], "The recurring rule payload and created_by attribution must be preserved.");
});

Deno.test("availability persistence deletes recurring rules by ID", async () => {
  const { client, calls } = createFakeClient();
  await deleteAvailabilityRuleById(
    client as unknown as Parameters<typeof deleteAvailabilityRuleById>[0],
    "rule-123",
  );

  assertEqual(calls.from, ["servant_availability_rules"], "Rule deletion must target the rules table.");
  assertEqual(calls.delete, 1, "Rule deletion must execute once.");
  assertEqual(calls.eq, [{ column: "id", value: "rule-123" }], "Rule deletion must filter by ID.");
});

Deno.test("availability persistence inserts serving preferences with creator attribution", async () => {
  const { client, calls } = createFakeClient();
  await insertServingPreference(
    client as unknown as Parameters<typeof insertServingPreference>[0],
    servingPreference,
    "servant-user",
  );

  assertEqual(calls.from, ["servant_serving_preferences"], "Serving preferences must target their existing table.");
  assertEqual(calls.insert, [{
    ...servingPreference,
    created_by: "servant-user",
  }], "The preference payload and created_by attribution must be preserved.");
});

Deno.test("availability persistence deletes serving preferences by ID", async () => {
  const { client, calls } = createFakeClient();
  await deleteServingPreferenceById(
    client as unknown as Parameters<typeof deleteServingPreferenceById>[0],
    "preference-456",
  );

  assertEqual(calls.from, ["servant_serving_preferences"], "Preference deletion must target its existing table.");
  assertEqual(calls.delete, 1, "Preference deletion must execute once.");
  assertEqual(calls.eq, [{ column: "id", value: "preference-456" }], "Preference deletion must filter by ID.");
});

Deno.test("availability persistence deletes dated availability records by ID", async () => {
  const { client, calls } = createFakeClient();
  await deleteAvailabilityRecordById(
    client as unknown as Parameters<typeof deleteAvailabilityRecordById>[0],
    "availability-789",
  );

  assertEqual(calls.from, ["servant_availability"], "Dated availability deletion must target its existing table.");
  assertEqual(calls.delete, 1, "Availability deletion must execute once.");
  assertEqual(calls.eq, [{ column: "id", value: "availability-789" }], "Availability deletion must filter by ID.");
});

Deno.test("availability persistence updates the existing deadline setting key", async () => {
  const { client, calls } = createFakeClient();
  await upsertAvailabilityDeadline(
    client as unknown as Parameters<typeof upsertAvailabilityDeadline>[0],
    "2026-11-20",
    "admin-user",
  );

  assertEqual(calls.from, ["system_settings"], "The deadline must remain in system_settings.");
  assertEqual(calls.upsert, [{
    values: {
      key: "availability_deadline",
      value: "2026-11-20",
      updated_by: "admin-user",
    },
    options: { onConflict: "key" },
  }], "The deadline key, updated_by field, and upsert conflict key must remain unchanged.");
});

Deno.test("availability persistence returns database errors unchanged", async () => {
  const databaseError = { code: "23514", message: "Database rejected the availability change." };
  const response = { error: databaseError };
  const client = createFakeClient(response).client;

  const results = await Promise.all([
    upsertAvailabilityRecord(
      client as unknown as Parameters<typeof upsertAvailabilityRecord>[0],
      singleRow,
    ),
    upsertAvailabilityRecords(
      client as unknown as Parameters<typeof upsertAvailabilityRecords>[0],
      bulkRows,
    ),
    insertAvailabilityRule(
      client as unknown as Parameters<typeof insertAvailabilityRule>[0],
      recurringRule,
      "admin-user",
    ),
    deleteAvailabilityRuleById(
      client as unknown as Parameters<typeof deleteAvailabilityRuleById>[0],
      "rule-123",
    ),
    insertServingPreference(
      client as unknown as Parameters<typeof insertServingPreference>[0],
      servingPreference,
      "servant-user",
    ),
    deleteServingPreferenceById(
      client as unknown as Parameters<typeof deleteServingPreferenceById>[0],
      "preference-456",
    ),
    deleteAvailabilityRecordById(
      client as unknown as Parameters<typeof deleteAvailabilityRecordById>[0],
      "availability-789",
    ),
    upsertAvailabilityDeadline(
      client as unknown as Parameters<typeof upsertAvailabilityDeadline>[0],
      "2026-11-20",
      "admin-user",
    ),
  ]);

  for (const result of results) {
    assertSame(result.error, databaseError, "Database errors should be passed through without transformation.");
  }
});
