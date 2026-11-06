import type { Dispatch, SetStateAction } from "react";
import type { NotificationPreferenceValues } from "../services/notificationPersistence";
import {
  markServingNotificationRead,
  saveServingNotificationPreferences,
} from "../services/notificationPersistence";

type NotificationActionsInput = {
  client: typeof import("../../../supabase").supabase;
  sessionUserId?: string;
  setNotificationPrefs: Dispatch<SetStateAction<any>>;
  setNotifications: Dispatch<SetStateAction<any[]>>;
  setMessage: Dispatch<SetStateAction<string>>;
};

/** Owns notification preference and read-state workflows; App supplies session and state. */
export function useNotificationActions({
  client,
  sessionUserId,
  setNotificationPrefs,
  setNotifications,
  setMessage,
}: NotificationActionsInput) {
  async function saveNotificationPreferences(next: NotificationPreferenceValues) {
    if (!client || !sessionUserId) return;
    const { payload, error } = await saveServingNotificationPreferences(
      client,
      sessionUserId,
      next,
    );
    if (error) {
      setMessage(error.message);
      return;
    }
    setNotificationPrefs(payload);
    setMessage("Notification preferences saved. In-app Inbox history remains enabled.");
  }

  async function markNotificationRead(id: string) {
    if (!client) return;
    const { error } = await markServingNotificationRead(client, id);
    if (!error) {
      setNotifications(current => current.map(notification =>
        notification.id === id
          ? { ...notification, is_read: true }
          : notification
      ));
    }
  }

  return { saveNotificationPreferences, markNotificationRead };
}
