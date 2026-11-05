/// <reference lib="deno.ns" />

import {
  loadServingNotificationData,
  type NotificationPreferenceQueryResponse,
  type NotificationQueryResponse,
  type ServingNotificationDataClient,
} from "../../src/features/notifications/services/notificationData.ts";

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
  table: "serving_notifications" | "serving_notification_preferences";
  columns: "*";
  gte?: { column: "created_at"; value: string };
  order?: { column: "created_at"; ascending: false };
  limit?: 100;
  eq?: { column: "user_id"; value: string };
  maybeSingle?: true;
}

function createClient(
  notificationResponse: NotificationQueryResponse,
  preferenceResponse: NotificationPreferenceQueryResponse,
): { client: ServingNotificationDataClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const client = {
    from(table: "serving_notifications" | "serving_notification_preferences") {
      return {
        select(columns: "*") {
          calls.push({ table, columns });
          if (table === "serving_notifications") {
            return {
              gte(column: "created_at", value: string) {
                calls[calls.length - 1].gte = { column, value };
                return {
                  order(column: "created_at", options: { ascending: false }) {
                    calls[calls.length - 1].order = { column, ascending: options.ascending };
                    return {
                      limit(count: 100) {
                        calls[calls.length - 1].limit = count;
                        return Promise.resolve(notificationResponse);
                      },
                    };
                  },
                };
              },
            };
          }
          return {
            eq(column: "user_id", value: string) {
              calls[calls.length - 1].eq = { column, value };
              return {
                maybeSingle() {
                  calls[calls.length - 1].maybeSingle = true;
                  return Promise.resolve(preferenceResponse);
                },
              };
            },
          };
        },
      };
    },
  } as ServingNotificationDataClient;
  return { client, calls };
}

Deno.test("notification data preserves the history and current-user preference query contracts", async () => {
  const notifications = { data: [{ id: "notification-1" }], error: null };
  const preferences = { data: { user_id: "user-1", new_assignments: false }, error: null };
  const { client, calls } = createClient(notifications, preferences);

  const result = await loadServingNotificationData(
    client,
    "2026-10-06T12:00:00.000Z",
    "user-1",
  );

  assertEqual(calls, [
    {
      table: "serving_notifications",
      columns: "*",
      gte: { column: "created_at", value: "2026-10-06T12:00:00.000Z" },
      order: { column: "created_at", ascending: false },
      limit: 100,
    },
    {
      table: "serving_notification_preferences",
      columns: "*",
      eq: { column: "user_id", value: "user-1" },
      maybeSingle: true,
    },
  ], "Notification history and preference queries must retain their existing filters, ordering, and limit.");
  assertSame(result.notifications, notifications, "Notification history response must pass through unchanged.");
  assertSame(result.preferences, preferences, "Preference response must pass through unchanged.");
});

Deno.test("notification data keeps history errors independent from preference rows", async () => {
  const notificationError = { code: "42501", message: "Notification history is unavailable." };
  const notifications = { data: null, error: notificationError };
  const preferences = { data: { user_id: "user-1" }, error: null };
  const { client } = createClient(notifications, preferences);

  const result = await loadServingNotificationData(client, "cutoff", "user-1");

  assertSame(result.notifications.error, notificationError, "Notification history error must be preserved.");
  assertSame(result.preferences, preferences, "Preferences must remain available when history fails.");
});

Deno.test("notification data keeps preference errors independent from history", async () => {
  const notifications = { data: [{ id: "notification-1" }], error: null };
  const preferenceError = { code: "42P01", message: "Notification preferences are unavailable." };
  const preferences = { data: null, error: preferenceError };
  const { client } = createClient(notifications, preferences);

  const result = await loadServingNotificationData(client, "cutoff", "user-1");

  assertSame(result.notifications, notifications, "Notification history must remain available when preferences fail.");
  assertSame(result.preferences.error, preferenceError, "The preference error must pass through unchanged.");
});

Deno.test("notification data preserves empty successful history and missing preference rows", async () => {
  const notifications = { data: [], error: null };
  const preferences = { data: null, error: null };
  const { client } = createClient(notifications, preferences);

  const result = await loadServingNotificationData(client, "cutoff", "user-1");

  assertEqual(result.notifications.data, [], "An empty notification history must remain a successful empty result.");
  assertSame(result.preferences.data, null, "A missing preference row must remain null for App's existing defaults.");
  assertSame(result.notifications.error, null, "Empty notification history must retain a null error.");
  assertSame(result.preferences.error, null, "Missing preferences must retain a null error.");
}
