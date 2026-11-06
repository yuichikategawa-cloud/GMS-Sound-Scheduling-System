/// <reference lib="deno.ns" />

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function readRepoFile(path: string): Promise<string> {
  return Deno.readTextFile(new URL("../../" + path, import.meta.url));
}

Deno.test("Notifications owns its preference and read-state action workflows", async () => {
  const [app, actions, persistence, settings] = await Promise.all([
    readRepoFile("src/App.tsx"),
    readRepoFile("src/features/notifications/hooks/useNotificationActions.ts"),
    readRepoFile("src/features/notifications/services/notificationPersistence.ts"),
    readRepoFile("src/features/notifications/components/PushNotificationSettings.tsx"),
  ]);

  assert(app.includes('import { useNotificationActions } from "./features/notifications/hooks/useNotificationActions";'),
    "App must compose the Notifications-owned action hook.");
  assert(app.includes("const notificationActions = useNotificationActions({"),
    "App must provide shared session and state dependencies.");
  for (const handler of ["saveNotificationPreferences", "markNotificationRead"]) {
    assert(!app.includes("async function " + handler + "("),
      "App must not retain Notifications handler " + handler + ".");
    assert(actions.includes("async function " + handler + "("),
      "Notifications action hook must own " + handler + ".");
  }

  assert(!actions.includes("client.from(") && !actions.includes("client.rpc("),
    "Notifications orchestration must delegate persistence to Notifications services.");
  assert(actions.includes("saveServingNotificationPreferences") &&
    actions.includes("markServingNotificationRead"),
    "Notifications hook must delegate both mutations to its persistence service.");
  assert(persistence.includes('from("serving_notification_preferences")') &&
    persistence.includes('from("serving_notifications")'),
    "Notification persistence service must retain both existing table boundaries.");
  assert(settings.includes("onSavePreferences") && settings.includes("onNotificationRead") === false,
    "Push settings should remain a presentation component with an injected save callback.");
  assert(app.includes("onSavePreferences={notificationActions.saveNotificationPreferences}") &&
    app.includes("onNotificationRead={notificationActions.markNotificationRead}"),
    "App must pass Notifications-owned actions to both Inbox and Requests notification surfaces.");
  assert((app.match(/notificationActions\.markNotificationRead/g) ?? []).length === 2,
    "App must use the same read action for both member Inbox and admin Requests.");

  for (const forbidden of [
    "features/availability/",
    "features/requests/",
    "features/auth/",
    "features/statistics/",
    "features/audit/",
    "features/servants/",
    "features/schedule/",
  ]) {
    assert(!actions.includes(forbidden),
      "Notifications action hook must not import another feature implementation: " + forbidden);
  }
  assert(!actions.includes('/App"') && !actions.includes("/App'"),
    "Notifications action hook must not depend on App.");
});


Deno.test("Notifications owns push browser state while App coordinates sign-out ordering", async () => {
  const [app, pushActions, pushService] = await Promise.all([
    readRepoFile("src/App.tsx"),
    readRepoFile("src/features/notifications/hooks/usePushNotificationActions.ts"),
    readRepoFile("src/features/notifications/services/pushSubscription.ts"),
  ]);

  assert(app.includes('import { usePushNotificationActions } from "./features/notifications/hooks/usePushNotificationActions";'),
    "App must compose the push lifecycle through the Notifications feature.");
  assert(app.includes("const pushActions = usePushNotificationActions({"),
    "App must provide the current client, user, and shared feedback callback.");
  for (const handler of [
    "getPushLifecycleRuntime",
    "enablePushNotifications",
    "disablePushNotifications",
  ]) {
    assert(!app.includes("function " + handler + "(") &&
      !app.includes("async function " + handler + "("),
      "App must not implement Notifications push lifecycle handler " + handler + ".");
    assert(pushActions.includes("function " + handler + "(") ||
      pushActions.includes("async function " + handler + "("),
      "Notifications push hook must own " + handler + ".");
  }
  assert(!app.includes("isServingPushSubscriptionEnabled") &&
    !app.includes("cleanupServingPushSubscriptionForSignOut"),
    "App must not call push lifecycle services directly.");
  assert(app.includes("pushActions.cleanupForSignOut(userId)") &&
    app.indexOf("pushActions.cleanupForSignOut(userId)") < app.indexOf("supabase.auth.signOut"),
    "App must await Notifications cleanup before authentication sign-out.");
  for (const operation of [
    "isServingPushSubscriptionEnabled",
    "enableServingPushSubscription",
    "disableServingPushSubscription",
    "cleanupServingPushSubscriptionForSignOut",
  ]) {
    assert(pushActions.includes(operation) && pushService.includes("function " + operation + "("),
      "Push hook must delegate " + operation + " to the Notifications service.");
  }
  assert(app.includes("enabled={pushActions.pushEnabled}") &&
    app.includes("busy={pushActions.pushBusy}") &&
    app.includes("onEnable={pushActions.enablePushNotifications}") &&
    app.includes("onDisable={pushActions.disablePushNotifications}"),
    "Notification settings UI must use the push hook's state and callbacks.");
});
