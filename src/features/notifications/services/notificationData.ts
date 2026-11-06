import type { ServingNotificationRecord } from "../../../types";
export type { ServingNotificationRecord } from "../../../types";

export interface NotificationPreferenceState {
  new_assignments: boolean;
  schedule_changes: boolean;
  confirmation_reminders: boolean;
  availability_deadlines: boolean;
  request_updates: boolean;
}

export interface NotificationPreferencesRow extends NotificationPreferenceState {
  user_id?: string;
  updated_at?: string;
}

export interface NotificationQueryResponse {
  data: ServingNotificationRecord[] | null;
  error: { message: string } | null;
}

export interface NotificationPreferenceQueryResponse {
  data: NotificationPreferencesRow | null;
  error: { message: string } | null;
}

interface NotificationHistorySelectBuilder {
  gte(column: "created_at", value: string): {
    order(
      column: "created_at",
      options: { ascending: false },
    ): {
      limit(count: number): PromiseLike<NotificationQueryResponse>;
    };
  };
}

interface NotificationPreferencesSelectBuilder {
  eq(column: "user_id", value: string): {
    maybeSingle(): PromiseLike<NotificationPreferenceQueryResponse>;
  };
}

/** Structural boundary keeps Supabase's generated query-builder generics out of App. */
export interface ServingNotificationDataClient {
  from(tableName: "serving_notifications"): {
    select(columns: "*"): NotificationHistorySelectBuilder;
  };
  from(tableName: "serving_notification_preferences"): {
    select(columns: "*"): NotificationPreferencesSelectBuilder;
  };
}

export interface ServingNotificationData {
  notifications: NotificationQueryResponse;
  preferences: NotificationPreferenceQueryResponse;
}

/**
 * Loads notification history and the signed-in user's preferences in parallel.
 * Both datasets remain optional and independent so App can preserve its
 * existing warning and empty/default fallback behavior.
 */
export async function loadServingNotificationData(
  client: ServingNotificationDataClient,
  cutoff: string,
  userId: string,
): Promise<ServingNotificationData> {
  const [notifications, preferences] = await Promise.all([
    client
      .from("serving_notifications")
      .select("*")
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(100),
    client
      .from("serving_notification_preferences")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  return { notifications, preferences };
}
