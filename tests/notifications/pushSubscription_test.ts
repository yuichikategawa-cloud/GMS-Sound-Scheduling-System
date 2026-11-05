/// <reference lib="deno.ns" />
import {
  cleanupServingPushSubscriptionForSignOut, decodeVapidKey, disableServingPushSubscription,
  enableServingPushSubscription, getPushEnableBlockReason, isServingPushSubscriptionEnabled,
  type PushLifecycleClient, type PushLifecycleRuntime, type PushServiceWorkerRegistrationLike,
  type PushSubscriptionLike,
} from "../../src/features/notifications/services/pushSubscription.ts";

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message + "\nExpected: " + JSON.stringify(expected) + "\nActual: " + JSON.stringify(actual));
  }
}
function assertSame(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new Error(message);
}
async function assertThrows(action: () => Promise<unknown>, expectedMessage: string): Promise<void> {
  try { await action(); } catch (error) {
    if (error instanceof Error && error.message === expectedMessage) return;
    throw new Error("Unexpected error: " + String(error));
  }
  throw new Error("Expected the operation to throw.");
}
interface Calls {
  from: string[]; selects: string[]; filters: Array<{ column: string; value: string }>;
  deletes: number; rpc: Array<{ name: string; args: Record<string, string> }>;
  unsubscribes: number; subscriptions: Array<{ userVisibleOnly: true; applicationServerKey: number[] }>;
  warnings: string[];
}
function makeSubscription(
  calls: Calls,
  endpoint = "https://push.example/subscription/1234567890123456789012345678901234567890",
  json: { endpoint?: string; keys?: { p256dh?: string; auth?: string } } = {
    endpoint, keys: { p256dh: "p256dh-key", auth: "auth-key" },
  },
): PushSubscriptionLike {
  return {
    endpoint, toJSON: () => json,
    unsubscribe: async () => { calls.unsubscribes++; return true; },
  };
}
function createHarness(options: {
  subscription?: PushSubscriptionLike | null; permission?: string; requestedPermission?: string;
  queryData?: unknown; queryError?: unknown; deleteError?: unknown; rpcError?: unknown;
} = {}) {
  const calls: Calls = {
    from: [], selects: [], filters: [], deletes: 0, rpc: [], unsubscribes: 0, subscriptions: [], warnings: [],
  };
  let currentSubscription = options.subscription === undefined ? makeSubscription(calls) : options.subscription;
  const registration: PushServiceWorkerRegistrationLike = {
    pushManager: {
      getSubscription: async () => currentSubscription,
      subscribe: async (input) => {
        calls.subscriptions.push({ userVisibleOnly: input.userVisibleOnly, applicationServerKey: Array.from(input.applicationServerKey) });
        currentSubscription = makeSubscription(calls);
        return currentSubscription;
      },
    },
  };
  const client = {
    from(tableName: string) {
      calls.from.push(tableName);
      return {
        select(columns: string) {
          calls.selects.push(columns);
          return { eq(column: string, value: string) {
            calls.filters.push({ column, value });
            return { eq(nextColumn: string, nextValue: string) {
              calls.filters.push({ column: nextColumn, value: nextValue });
              return { maybeSingle: async () => ({
                data: options.queryData === undefined ? { id: "subscription-1" } : options.queryData,
                error: options.queryError ?? null,
              }) };
            } };
          } };
        },
        delete() {
          calls.deletes++;
          return { eq(column: string, value: string) {
            calls.filters.push({ column, value });
            return { eq(nextColumn: string, nextValue: string) {
              calls.filters.push({ column: nextColumn, value: nextValue });
              return Promise.resolve({ error: options.deleteError ?? null });
            } };
          } };
        },
      };
    },
    rpc(name: string, args: Record<string, string>) {
      calls.rpc.push({ name, args });
      return Promise.resolve({ error: options.rpcError ?? null });
    },
  } as unknown as PushLifecycleClient;
  const runtime: PushLifecycleRuntime = {
    serviceWorkerSupported: true, pushManagerSupported: true, notificationSupported: true,
    isIOS: false, isStandalone: true, userAgent: "GMS test browser",
    notificationPermission: () => options.permission ?? "granted",
    requestNotificationPermission: async () => options.requestedPermission ?? "granted",
    serviceWorkerReady: async () => registration,
    getServiceWorkerRegistration: async () => registration,
    delay: async () => {}, warn: (message) => calls.warnings.push(message),
  };
  return { calls, client, runtime };
}

Deno.test("VAPID decoding converts base64url input into expected bytes", () => {
  assertEqual(Array.from(decodeVapidKey("AQID")), [1, 2, 3], "Decoded VAPID bytes must match the encoded key.");
});
Deno.test("push enable guards missing VAPID, unsupported APIs, and non-standalone iOS", () => {
  const { runtime } = createHarness();
  assertSame(getPushEnableBlockReason(undefined, runtime), "missing-vapid-key", "Missing VAPID must block enable.");
  assertSame(getPushEnableBlockReason("  ", runtime), "missing-vapid-key", "Blank VAPID must block enable.");
  assertSame(getPushEnableBlockReason("AQID", { ...runtime, notificationSupported: false }), "unsupported-browser", "Required APIs must exist.");
  assertSame(getPushEnableBlockReason("AQID", { ...runtime, isIOS: true, isStandalone: false }), "ios-install-required", "iOS requires standalone mode.");
});
Deno.test("push status confirms the endpoint belongs to the signed-in user", async () => {
  const { client, runtime, calls } = createHarness();
  assertSame(await isServingPushSubscriptionEnabled(client, "user-1", runtime), true, "Matching endpoint must report enabled.");
  assertEqual(calls.from, ["serving_push_subscriptions"], "Status must query the existing table.");
  assertEqual(calls.selects, ["id"], "Status must select only ID.");
  assertEqual(calls.filters, [
    { column: "user_id", value: "user-1" },
    { column: "endpoint", value: "https://push.example/subscription/1234567890123456789012345678901234567890" },
  ], "Status must retain user and endpoint filters.");
});
Deno.test("push status preserves false fallback for missing subscriptions and read errors", async () => {
  const empty = createHarness({ subscription: null });
  assertSame(await isServingPushSubscriptionEnabled(empty.client, "user-1", empty.runtime), false, "Missing browser subscription must be disabled.");
  const failed = createHarness({ queryError: { message: "read denied" } });
  assertSame(await isServingPushSubscriptionEnabled(failed.client, "user-1", failed.runtime), false, "Read errors must preserve false fallback.");
});
Deno.test("push enable reuses an existing subscription and preserves RPC arguments", async () => {
  const { client, runtime, calls } = createHarness();
  assertSame(await enableServingPushSubscription(client, "user-1", "AQID", runtime), "enabled", "Registration must succeed.");
  assertEqual(calls.subscriptions, [], "Existing browser subscription must be reused.");
  assertEqual(calls.rpc, [{
    name: "register_serving_push_subscription",
    args: {
      p_endpoint: "https://push.example/subscription/1234567890123456789012345678901234567890",
      pp256dh: "p256dh-key", pauth: "auth-key", p_user_agent: "GMS test browser",
    },
  }], "Existing RPC contract must remain exact.");
});
Deno.test("push enable creates a subscription using the decoded VAPID key", async () => {
  const { client, runtime, calls } = createHarness({ subscription: null });
  assertSame(await enableServingPushSubscription(client, "user-1", "AQID", runtime), "enabled", "New subscription must register.");
  assertEqual(calls.subscriptions, [{ userVisibleOnly: true, applicationServerKey: [1, 2, 3] }], "Subscribe must receive decoded VAPID bytes.");
  assertSame(calls.rpc.length, 1, "New subscription must be registered once.");
});
Deno.test("push enable preserves denied and not-granted permission outcomes", async () => {
  const denied = createHarness({ permission: "default", requestedPermission: "denied" });
  assertSame(await enableServingPushSubscription(denied.client, "user-1", "AQID", denied.runtime), "permission-blocked", "Denied permission must be blocked.");
  assertSame(denied.calls.rpc.length, 0, "Denied permission must not register.");
  const dismissed = createHarness({ permission: "default", requestedPermission: "default" });
  assertSame(await enableServingPushSubscription(dismissed.client, "user-1", "AQID", dismissed.runtime), "permission-not-granted", "Dismissed permission must be not-granted.");
  assertSame(dismissed.calls.rpc.length, 0, "Un-granted permission must not register.");
});
Deno.test("push enable rejects incomplete subscription data before the RPC", async () => {
  const calls: Calls = { from: [], selects: [], filters: [], deletes: 0, rpc: [], unsubscribes: 0, subscriptions: [], warnings: [] };
  const incomplete = makeSubscription(calls, "https://push.example/incomplete", { endpoint: undefined, keys: {} });
  const harness = createHarness({ subscription: incomplete });
  await assertThrows(() => enableServingPushSubscription(harness.client, "user-1", "AQID", harness.runtime),
    "The browser did not return a complete push subscription.");
  assertSame(harness.calls.rpc.length, 0, "Incomplete browser data must not reach RPC.");
});
Deno.test("push enable passes registration RPC errors through", async () => {
  const { client, runtime } = createHarness({ rpcError: new Error("Push registration rejected.") });
  await assertThrows(() => enableServingPushSubscription(client, "user-1", "AQID", runtime), "Push registration rejected.");
});
Deno.test("push disable deletes the endpoint and unsubscribes locally", async () => {
  const { client, runtime, calls } = createHarness();
  await disableServingPushSubscription(client, runtime);
  assertEqual(calls.from, ["serving_push_subscriptions"], "Disable must target the existing table.");
  assertSame(calls.deletes, 1, "Disable must issue one deletion.");
  assertEqual(calls.filters, [{
    column: "endpoint",
    value: "https://push.example/subscription/1234567890123456789012345678901234567890",
  }], "Disable must retain endpoint-only filter.");
  assertSame(calls.unsubscribes, 1, "Disable must unsubscribe locally.");
});
Deno.test("sign-out cleanup retains ownership filters and unsubscribes", async () => {
  const { client, runtime, calls } = createHarness();
  await cleanupServingPushSubscriptionForSignOut(client, "user-1", runtime);
  assertEqual(calls.filters, [
    { column: "user_id", value: "user-1" },
    { column: "endpoint", value: "https://push.example/subscription/1234567890123456789012345678901234567890" },
  ], "Sign-out cleanup must preserve user and endpoint filters.");
  assertSame(calls.unsubscribes, 1, "Sign-out cleanup must unsubscribe the current browser subscription.");
});
