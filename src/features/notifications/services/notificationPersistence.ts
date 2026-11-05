export interface NotificationPersistenceResponse {
  error: { message: string } | null;
}

export interface NotificationPreferencesPayload {
  user_id: string;
  new_assignments: boolean;
  schedule_changes: boolean;
  confirmation_reminders: boolean;
  availability_deadlines: boolean;
  request_updates: boolean;
  updated_at: string;
}

export interface NotificationPreferenceValues {
  new_assignments?: unknown;
  schedule_changes?: unknown;
  confirmation_reminders?: unknown;
  availability_deadlines?: unknown;
  request_updates?: unknown;
}

/** Structural boundary keeps Supabase's generated query-builder generics out of App. */
export interface NotificationPersistenceClient {
  from(tableName: string): any;
}

/** Saves the existing five-field preference row with the current user's key. */
export async function saveServingNotificationPreferences(
  client: NotificationPersistenceClient,
  userId: string,
  values: NotificationPreferenceValues,
  updatedAt = new Date().toISOString(),
): Promise<{ payload: NotificationPreferencesPayload; error: { message: string } | null }> {
  const payload: NotificationPreferencesPayload = {
    user_id: userId,
    new_assignments: !!values?.new_assignments,
    schedule_changes: !!values?.schedule_changes,
    confirmation_reminders: !!values?.confirmation_reminders,
    availability_deadlines: !!values?.availability_deadlines,
    request_updates: !!values?.request_updates,
    updated_at: updatedAt,
  };
  const { error } = await client
    .from("serving_notification_preferences")
    .upsert(payload, { onConflict: "user_id" });

  return { payload, error };
}

/** Marks one existing notification as read using its ID, without changing other fields. */
export function markServingNotificationRead(
  client: NotificationPersistenceClient,
  notificationId: string,
): PromiseLike<NotificationPersistenceResponse> {
  return client
    .from("serving_notifications")
    .update({ is_read: true })
    .eq("id", notificationId);
}
