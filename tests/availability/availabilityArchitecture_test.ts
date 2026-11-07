/// <reference lib="deno.ns" />

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function readRepoFile(path: string): Promise<string> {
  return Deno.readTextFile(new URL("../../" + path, import.meta.url));
}

Deno.test("Availability owns its workspace UI, orchestration, and read boundary", async () => {
  const [app, workspace, actions, data, dashboard, dashboardLoader] = await Promise.all([
    readRepoFile("src/App.tsx"),
    readRepoFile("src/features/availability/components/AvailabilityWorkspace.tsx"),
    readRepoFile("src/features/availability/hooks/useAvailabilityActions.ts"),
    readRepoFile("src/features/availability/services/availabilityData.ts"),
    readRepoFile("src/app/services/dashboardData.ts"),
    readRepoFile("src/app/hooks/useDashboardLoader.ts"),
  ]);
  assert(app.includes('import AvailabilityWorkspace from "./features/availability/components/AvailabilityWorkspace";'),
    "App should compose the Availability-owned workspace component.");
  assert(app.includes("useAvailabilityActions("), "App should compose Availability actions through the feature hook.");
  assert(app.includes('from "./app/hooks/useDashboardLoader"') &&
    dashboardLoader.includes('from "../services/dashboardData"'),
    "App should load shared dashboard data through its app-owned loading boundary.");
  assert(dashboard.includes("loadAvailabilityWorkspaceData"), "The app dashboard composition should load Availability through its feature service.");
  assert(!app.includes("function AvailabilityPanel("), "Availability presentation should not remain embedded in App.");
  assert(!app.includes("async function saveAvailability("), "Availability mutation orchestration should not remain embedded in App.");
  assert(workspace.includes("export default function AvailabilityWorkspace("), "Availability should own the extracted workspace UI.");
  assert(workspace.includes('import type { Location, ScheduleView, Servant, ServiceTemplate } from "../../../types";'),
    "Availability must consume shared domain types rather than importing Schedule implementation details.");
  assert(!workspace.includes('from "../../schedule/'),
    "Availability must not depend on relative imports from the Schedule feature.");
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

Deno.test("Availability overview presents date records, recurring restrictions, and serving preferences separately", async () => {
  const workspace = await readRepoFile("src/features/availability/components/AvailabilityWorkspace.tsx");
  const styles = await readRepoFile("src/features/availability/components/AvailabilityWorkspace.css");
  assert(workspace.includes('aria-labelledby="availability-overview-title"'),
    "The consolidated overview should have an accessible heading.");
  assert(workspace.includes("<h3>Date-specific records</h3>") &&
    workspace.includes('dateFilter?"Recurring restrictions on "+fmtDate(dateFilter):"Recurring restrictions"') &&
    workspace.includes("<h3>Serving preferences & eligibility</h3>"),
    "The overview must show all three availability data categories separately.");
  assert(workspace.includes("{rows.length}") && workspace.includes("{visibleRules.length}") &&
    workspace.includes("{visiblePreferences.length}"),
    "The overview must show independent counts for all three categories.");
  assert(workspace.includes("No date-specific submissions yet.") &&
    workspace.includes("No recurring restrictions saved.") &&
    workspace.includes("No serving preferences saved."),
    "Each category must have its own accurate empty state.");
  assert(workspace.includes("visibleRules.map(rule=>") && workspace.includes("visiblePreferences.map(rule=>"),
    "Saved recurring restrictions and preferences must be rendered from their existing loaded data.");
  assert(styles.includes(".availability-overview-counts") &&
    styles.includes("@media (max-width: 600px)"),
    "The consolidated overview must have responsive count and mobile layouts.");
});

Deno.test("Availability date filter scopes date submissions and recurring rules while showing deadline errors below the form controls", async () => {
  const [workspace, styles] = await Promise.all([
    readRepoFile("src/features/availability/components/AvailabilityWorkspace.tsx"),
    readRepoFile("src/features/availability/components/AvailabilityWorkspace.css"),
  ]);
  assert(workspace.includes('a.is_recurring&&a.service_date===dateFilter') &&
    workspace.includes('const visibleRules=ownRules.filter(rule=>!dateFilter'),
    "A selected date must filter recurring restrictions to rules that apply on that date.");
  assert(workspace.includes('dateFilter?a.service_date===dateFilter:a.service_date>=today()'),
    "A selected date must show exact-date submissions, including past dates.");
  assert(workspace.includes("Serving preferences remain visible as general eligibility rules."),
    "The date filter must explain why general serving preferences remain visible.");
  assert(workspace.includes("availability-deadline-error") &&
    styles.includes(".availability-form .availability-deadline-error") &&
    styles.includes("grid-column: 1 / -1"),
    "Deadline validation must occupy a full-width row below the form controls.");
});
