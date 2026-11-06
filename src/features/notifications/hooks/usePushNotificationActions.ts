import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { errorText } from "../../../shared/formatters";
import {
  cleanupServingPushSubscriptionForSignOut,
  disableServingPushSubscription,
  enableServingPushSubscription,
  isServingPushSubscriptionEnabled,
  type PushLifecycleRuntime,
} from "../services/pushSubscription";

type PushActionsInput = {
  client: typeof import("../../../supabase").supabase;
  userId?: string;
  setMessage: Dispatch<SetStateAction<string>>;
};

function getPushLifecycleRuntime(): PushLifecycleRuntime {
  const isIOS = /iphone|ipad|ipod/.test(navigator.userAgent.toLowerCase()) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isStandalone = window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as any).standalone === true;
  return {
    serviceWorkerSupported: "serviceWorker" in navigator,
    pushManagerSupported: "PushManager" in window,
    notificationSupported: "Notification" in window,
    isIOS,
    isStandalone,
    userAgent: navigator.userAgent,
    notificationPermission: () => Notification.permission,
    requestNotificationPermission: () => Notification.requestPermission(),
    serviceWorkerReady: () =>
      navigator.serviceWorker.ready as unknown as ReturnType<PushLifecycleRuntime["serviceWorkerReady"]>,
    getServiceWorkerRegistration: scope =>
      navigator.serviceWorker.getRegistration(scope) as unknown as ReturnType<PushLifecycleRuntime["getServiceWorkerRegistration"]>,
    delay: milliseconds => new Promise<void>(resolve => window.setTimeout(resolve, milliseconds)),
    warn: (message, error) => console.warn(message, error),
  };
}

/** Owns browser push state and lifecycle; App coordinates it with authentication sign-out. */
export function usePushNotificationActions({
  client,
  userId,
  setMessage,
}: PushActionsInput) {
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function checkPush() {
      if (!client || !userId) {
        if (!cancelled) setPushEnabled(false);
        return;
      }
      const enabled = await isServingPushSubscriptionEnabled(
        client,
        userId,
        getPushLifecycleRuntime(),
      );
      if (!cancelled) setPushEnabled(enabled);
    }
    void checkPush();
    return () => {
      cancelled = true;
    };
  }, [client, userId]);

  async function enablePushNotifications() {
    if (!client || !userId) return;
    let started = false;
    try {
      const vapidKey = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined)?.trim();
      const result = await enableServingPushSubscription(
        client,
        userId,
        vapidKey,
        getPushLifecycleRuntime(),
        () => {
          started = true;
          setPushBusy(true);
          setMessage("");
        },
      );
      if (result === "missing-vapid-key") {
        setMessage("Push delivery is not configured yet. Set VITE_VAPID_PUBLIC_KEY in Vercel and your local environment, then redeploy.");
      } else if (result === "unsupported-browser") {
        setMessage("This browser does not support web push notifications. You can still use the in-app Inbox.");
      } else if (result === "ios-install-required") {
        setMessage("On iPhone or iPad, install GMS first: open this page in Safari → Share → Add to Home Screen, turn on Open as Web App, then tap Add. Open GMS from the new Home Screen icon and enable push notifications there.");
      } else if (result === "permission-blocked") {
        setMessage("Notifications are blocked for this device. Open iPhone Settings, find the installed Sound Scheduling web app, and allow notifications. In-app Inbox notifications will continue to work.");
      } else if (result === "permission-not-granted") {
        setMessage("Notification permission was not granted. In-app Inbox notifications will continue to work.");
      } else {
        setPushEnabled(true);
        setMessage("Push notifications enabled on this device. Your in-app Inbox remains the primary notification history.");
      }
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      if (started) setPushBusy(false);
    }
  }

  async function disablePushNotifications() {
    if (!client || !userId || !("serviceWorker" in navigator)) return;
    setPushBusy(true);
    try {
      await disableServingPushSubscription(client, getPushLifecycleRuntime());
      setPushEnabled(false);
      setMessage("Push notifications disabled on this device. Your in-app Inbox is unchanged.");
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setPushBusy(false);
    }
  }

  async function cleanupForSignOut(signingOutUserId?: string) {
    setPushEnabled(false);
    // Best-effort cleanup must not wait on serviceWorker.ready: a missing or
    // failed /sw.js installation must never trap the user during sign-out.
    if (client && signingOutUserId && "serviceWorker" in navigator) {
      await cleanupServingPushSubscriptionForSignOut(
        client,
        signingOutUserId,
        getPushLifecycleRuntime(),
      );
    }
  }

  return {
    pushEnabled,
    pushBusy,
    enablePushNotifications,
    disablePushNotifications,
    cleanupForSignOut,
  };
}
