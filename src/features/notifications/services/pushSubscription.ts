export interface PushSubscriptionJson {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
}
export interface PushSubscriptionLike {
  endpoint: string;
  toJSON(): PushSubscriptionJson;
  unsubscribe(): Promise<boolean>;
}
export interface PushManagerLike {
  getSubscription(): Promise<PushSubscriptionLike | null>;
  subscribe(options: { userVisibleOnly: true; applicationServerKey: Uint8Array }): Promise<PushSubscriptionLike>;
}
export interface PushServiceWorkerRegistrationLike { pushManager: PushManagerLike }
export interface PushLifecycleRuntime {
  serviceWorkerSupported: boolean;
  pushManagerSupported: boolean;
  notificationSupported: boolean;
  isIOS: boolean;
  isStandalone: boolean;
  userAgent: string;
  notificationPermission(): string;
  requestNotificationPermission(): Promise<string>;
  serviceWorkerReady(): Promise<PushServiceWorkerRegistrationLike>;
  getServiceWorkerRegistration(scope: string): Promise<PushServiceWorkerRegistrationLike | undefined>;
  delay(milliseconds: number): Promise<void>;
  warn(message: string, error?: unknown): void;
}
export interface PushLifecycleClient {
  from(tableName: string): any;
  rpc(functionName: string, args: Record<string, string>): PromiseLike<{ error: unknown | null }>;
}
export type PushEnableResult =
  | "enabled" | "missing-vapid-key" | "unsupported-browser" | "ios-install-required"
  | "permission-blocked" | "permission-not-granted";
export type PushEnableBlockReason = Exclude<
  PushEnableResult, "enabled" | "permission-blocked" | "permission-not-granted"
>;

/** Converts the configured base64url VAPID key to bytes required by PushManager. */
export function decodeVapidKey(value: string, decodeBase64: (value: string) => string = atob): Uint8Array {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = decodeBase64(base64);
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

/** Returns the blocking reason shared by the enable flow and its regression tests. */
export function getPushEnableBlockReason(
  vapidKey: string | undefined,
  runtime: Pick<PushLifecycleRuntime, "serviceWorkerSupported" | "pushManagerSupported" | "notificationSupported" | "isIOS" | "isStandalone">,
): PushEnableBlockReason | null {
  if (!vapidKey?.trim()) return "missing-vapid-key";
  if (!runtime.serviceWorkerSupported || !runtime.pushManagerSupported || !runtime.notificationSupported) {
    return "unsupported-browser";
  }
  if (runtime.isIOS && !runtime.isStandalone) return "ios-install-required";
  return null;
}

/** Confirms that the current browser endpoint is registered to the signed-in user. */
export async function isServingPushSubscriptionEnabled(
  client: PushLifecycleClient,
  userId: string,
  runtime: PushLifecycleRuntime,
): Promise<boolean> {
  if (!userId || !runtime.serviceWorkerSupported || !runtime.pushManagerSupported) return false;
  try {
    const registration = await runtime.serviceWorkerReady();
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return false;
    const { data, error } = await client
      .from("serving_push_subscriptions")
      .select("id")
      .eq("user_id", userId)
      .eq("endpoint", subscription.endpoint)
      .maybeSingle();
    return !error && !!data;
  } catch {
    return false;
  }
}

/** Requests permission, creates/reuses the browser subscription, and calls the existing RPC. */
export async function enableServingPushSubscription(
  client: PushLifecycleClient,
  userId: string,
  vapidKey: string | undefined,
  runtime: PushLifecycleRuntime,
  onStart: () => void = () => {},
): Promise<PushEnableResult> {
  const blocked = getPushEnableBlockReason(vapidKey, runtime);
  if (blocked) return blocked;

  onStart();
  const permission = runtime.notificationPermission() === "granted"
    ? "granted"
    : await runtime.requestNotificationPermission();
  if (permission !== "granted") {
    return permission === "denied" ? "permission-blocked" : "permission-not-granted";
  }

  const registration = await runtime.serviceWorkerReady();
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeVapidKey(vapidKey!.trim()),
  });
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error("The browser did not return a complete push subscription.");
  }
  const { error } = await client.rpc("register_serving_push_subscription", {
    p_endpoint: json.endpoint,
    pp256dh: json.keys.p256dh,
    pauth: json.keys.auth,
    p_user_agent: runtime.userAgent,
  });
  if (error) throw error;
  return "enabled";
}

/**
 * Removes only this user's current endpoint. Do not unsubscribe locally when
 * the server-side delete fails; the caller must not report a false success.
 */
export async function disableServingPushSubscription(
  client: PushLifecycleClient,
  userId: string,
  runtime: PushLifecycleRuntime,
): Promise<void> {
  if (!userId || !runtime.serviceWorkerSupported) return;
  const registration = await runtime.serviceWorkerReady();
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  const { error } = await client
    .from("serving_push_subscriptions")
    .delete()
    .eq("user_id", userId)
    .eq("endpoint", subscription.endpoint);
  if (error) throw error;
  await subscription.unsubscribe();
}

/** Best-effort sign-out cleanup with the existing 500ms/700ms bounds. */
export async function cleanupServingPushSubscriptionForSignOut(
  client: PushLifecycleClient,
  userId: string,
  runtime: PushLifecycleRuntime,
): Promise<void> {
  if (!userId || !runtime.serviceWorkerSupported) return;
  try {
    const registration = await Promise.race([
      runtime.getServiceWorkerRegistration("/"),
      runtime.delay(500).then(() => undefined),
    ]);
    const subscription = await registration?.pushManager?.getSubscription();
    if (!subscription) return;
    const cleanup = (async () => {
      const { error } = await client.from("serving_push_subscriptions")
        .delete().eq("user_id", userId).eq("endpoint", subscription.endpoint);
      if (error) runtime.warn("Could not remove this device push subscription during sign out", error);
      await subscription.unsubscribe();
    })();
    await Promise.race([cleanup, runtime.delay(700)]);
  } catch (error) {
    runtime.warn("Could not remove this device push subscription during sign out", error);
  }
}
