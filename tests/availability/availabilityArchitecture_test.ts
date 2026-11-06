/// <reference lib="deno.ns" />

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function readRepoFile(path: string): Promise<string> {
  return Deno.readTextFile(new URL("../../" + path, import.meta.url));
}

Deno.test("Availability owns its workspace UI, orchestration, and read boundary", async () => {
  const [app, workspace, actions, data, dashboard] = await Promise.all([
    readRepoFile("src/App.tsx"),
    readRepoFile("src/features/availability/components/AvailabilityWorkspace.tsx"),
    readRepoFile("src/features/availability/hooks/useAvailabilityActions.ts"),
    readRepoFile("src/features/availability/services/availabilityData.ts"),
    readRepoFile("src/app/services/dashboardData.ts"),
  ]);
  assert(app.includes('import AvailabilityWorkspace from "./features/availability/components/AvailabilityWorkspace";'),
    "App should compose the Availability-owned workspace component.");
  assert(app.includes("useAvailabilityActions("), "App should compose Availability actions through the feature hook.");
  assert(app.includes("loadDashboardData(supabase"), "App should load shared dashboard data through its app-owned composition service.");
  assert(dashboard.includes("loadAvailabilityWorkspaceData"), "The app dashboard composition should load Availability through its feature service.");
  assert(!app.includes("function AvailabilityPanel("), "Availability presentation should not remain embedded in App.");
  assert(!app.includes("async function saveAvailability("), "Availability mutation orchestration should not remain embedded in App.");
  assert(workspace.includes("export default function AvailabilityWorkspace("), "Availability should own the extracted workspace UI.");
  assert(!/client\.(?:rpc|from)\(/.test(workspace), "Availability presentation must not access Supabase directly.");
  assert(!/client\.(?:rpc|from)\(/.test(actions), "Availability action orchestration must delegate persistence to Availability services.");
  assert(data.includes('from("servant_availability")') && data.includes('from("servant_availability_rules")') &&
    data.includes('from("servant_serving_preferences")') && data.includes('from("system_settings")'),
    "The Availability data service should own its four existing reads.");
  for (const [path, source] of [
    ["Availability workspace", workspace],
    ["Availability actions", actions],
    ["Availability data", data],
  ] as const) {
    assert(!/from\s+["'][^"']*features\/(requests|notifications|auth|statistics|audit|servants|schedule)\//.test(source),
      path + " must not import another feature's implementation.");
    assert(!/from\s+["'][^"']*\/App["']/.test(source),
      path + " must not depend on the app composition root.");
  }
});

Deno.test("Requests and Inbox accept Notifications through app composition, not feature imports", async () => {
  const [app, requests, inbox] = await Promise.all([
    readRepoFile("src/App.tsx"),
    readRepoFile("src/features/requests/components/RequestsPanel.tsx"),
    readRepoFile("src/features/requests/components/ServantInbox.tsx"),
  ]);
  for (const [path, source] of [
    ["RequestsPanel", requests],
    ["ServantInbox", inbox],
  ] as const) {
    assert(!/from\s+["'][^"']*features\/notifications\//.test(source),
      path + " must not import the Notifications feature implementation.");
    assert(source.includes("notificationSettings:ReactNode") && source.includes("{notificationSettings}"),
      path + " must render notification settings through its composition slot.");
  }
  assert(app.includes('import PushNotificationSettings from "./features/notifications/components/PushNotificationSettings";'),
    "App should compose the Notifications presentation component.");
  assert((app.match(/notificationSettings=\{/g) ?? []).length === 2,
    "App should supply settings to admin Requests and member Inbox.");
});
