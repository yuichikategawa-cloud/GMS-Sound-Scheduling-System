export interface NotificationQueryResponse {
  data: any[] | null;
  error: { message: string } | null;
}

export interface NotificationPreferenceQueryResponse {
  data: any | null;
  error: { message: string } | null;
}

/** Structural boundary keeps Supabase's generated query-builder generics out of App. */
export interface ServingNotificationDataClient {
  from(tableName: string): any;
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
