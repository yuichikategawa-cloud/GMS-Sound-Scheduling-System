/// <reference lib="deno.ns" />

import {
  markServingNotificationRead,
  saveServingNotificationPreferences,
  type NotificationPersistenceClient,
  type NotificationPersistenceResponse,
  type NotificationPreferencesPayload,
} from "../../src/features/notifications/services/notificationPersistence.ts";

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
  upserts: Array<{ payload: NotificationPreferencesPayload; options: { onConflict: string } }>;
  updates: Array<{ payload: { is_read: true }; column: string; value: string }>;
}

function createClient(response: NotificationPersistenceResponse = { error: null }): {
  client: NotificationPersistenceClient;
  calls: RecordedCalls;
} {
  const calls: RecordedCalls = { from: [], upserts: [], updates: [] };
  const client = {
    from(tableName: "serving_notification_preferences" | "serving_notifications") {
      calls.from.push(tableName);
      return {
        upsert(payload: NotificationPreferencesPayload, options: { onConflict: "user_id" }) {
          calls.upserts.push({ payload, options });
          return Promise.resolve(response);
        },
        update(payload: { is_read: true }) {
          return {
            eq(column: "id", value: string) {
              calls.updates.push({ payload, column, value });
              return Promise.resolve(response);
            },
          };
        },
      };
    },
  } as unknown as NotificationPersistenceClient;
  return { client, calls };
}

Deno.test("notification preference persistence saves the exact five boolean fields and user conflict key", async () => {
  const { client, calls } = createClient();
  const result = await saveServingNotificationPreferences(client, "user-1", {
    new_assignments: true,
    schedule_changes: false,
    confirmation_reminders: true,
    availability_deadlines: false,
    request_updates: true,
  }, "2026-11-05T13:00:00.000Z");

  const expectedPayload = {
    user_id: "user-1",
    new_assignments: true,
    schedule_changes: false,
    confirmation_reminders: true,
    availability_deadlines: false,
    request_updates: true,
    updated_at: "2026-11-05T13:00:00.000Z",
  };
  assertEqual(calls.from, ["serving_notification_preferences"], "Preferences must target the existing preference table.");
  assertEqual(calls.upserts, [{ payload: expectedPayload, options: { onConflict: "user_id" } }], "Preference values, timestamp, and conflict key must be unchanged.");
  assertEqual(result.payload, expectedPayload, "The saved payload must be returned to App for its local state update.");
  assertSame(result.error, null, "A successful preference upsert must retain a null error.");
});

Deno.test("notification preference persistence retains boolean coercion for partial values", async () => {
  const { client } = createClient();
  const result = await saveServingNotificationPreferences(client, "user-2", {
    new_assignments: 1,
    schedule_changes: 0,
    confirmation_reminders: undefined,
  }, "2026-11-05T13:01:00.000Z");

  assertEqual(result.payload, {
    user_id: "user-2",
    new_assignments: true,
    schedule_changes: false,
    confirmation_reminders: false,
    availability_deadlines: false,
    request_updates: false,
    updated_at: "2026-11-05T13:01:00.000Z",
  }, "Partial preference values must continue to coerce each supported setting to a boolean.");
});

Deno.test("notification preference persistence passes database errors through unchanged", async () => {
  const databaseError = { code: "42501", message: "Notification preference update denied." };
  const { client } = createClient({ error: databaseError });

  const result = await saveServingNotificationPreferences(client, "user-1", {}, "2026-11-05T13:02:00.000Z");

  assertSame(result.error, databaseError, "Database errors must pass through unchanged.");
});

Deno.test("notification read persistence updates is_read by notification ID only", async () => {
  const { client, calls } = createClient();

  const result = await markServingNotificationRead(client, "notification-1");

  assertEqual(calls.from, ["serving_notifications"], "Read updates must target the existing notification table.");
  assertEqual(calls.updates, [{ payload: { is_read: true }, column: "id", value: "notification-1" }], "Only is_read may change, filtered by the existing notification ID.");
  assertSame(result.error, null, "A successful read update must retain a null error.");
});
