/// <reference lib="deno.ns" />

const app = await Deno.readTextFile("src/App.tsx");
const state = await Deno.readTextFile("src/app/state/dashboardState.ts");
const dashboardData = await Deno.readTextFile("src/app/services/dashboardData.ts");
const dashboardLoaderHook = await Deno.readTextFile("src/app/hooks/useDashboardLoader.ts");
const dashboardLoadController = await Deno.readTextFile("src/app/services/dashboardLoadController.ts");

Deno.test("App hydrates dashboard state through one application boundary", () => {
  if (!app.includes("dashboardStateReducer") || !app.includes("useDashboardLoader({")) {
    throw new Error("App must compose the dashboard reducer and dedicated loading hook.");
  }
  if (app.includes("loadDashboardData(") || app.includes('setLoading(true); setMessage("")')) {
    throw new Error("App must not own dashboard loading orchestration directly.");
  }
  if (!dashboardLoaderHook.includes("createDashboardLoadController") ||
    !dashboardLoaderHook.includes('type: "hydrate"') ||
    !dashboardLoadController.includes("requestSequence") ||
    !dashboardLoadController.includes("invalidate")) {
    throw new Error("The hook must adapt hydration while the controller owns request sequencing and invalidation.");
  }
  if (!app.includes("invalidateDashboardLoad()")) {
    throw new Error("Sign-out must invalidate pending dashboard reads immediately.");
  }
  for (const setter of [
    "setLocations(dashboard.locations)",
    "setServants(dashboard.servants)",
    "setTemplates(dashboard.templates)",
    "setSchedules(dashboard.schedules)",
    "setAvailabilityRules(dashboard.availabilityRules)",
    "setServingPreferences(dashboard.servingPreferences)",
    "setAvailability(dashboard.availability)",
    "setRequests(dashboard.requests)",
    "setAuditLogs(dashboard.auditLogs)",
    "setMemberDirectory(dashboard.memberDirectory)",
    "setAccountProfiles(dashboard.accountProfiles)",
  ]) {
    if (app.includes(setter)) throw new Error(`App must not hydrate dashboard field directly: ${setter}`);
  }
  if (!app.includes('type: "clear-member-data"')) {
    throw new Error("Sign-out should use one dashboard-state cleanup action.");
  }
});

Deno.test("dashboard state contracts include typed member-directory and notification preference models", () => {
  if (!dashboardData.includes("ServantDirectoryMember") || !state.includes("NotificationPreferenceState")) {
    throw new Error("Dashboard state must use shared member-directory and preference contracts.");
  }
  for (const action of [
    "set-notifications",
    "set-notification-preferences",
    "set-request-reads",
    "set-availability-deadline",
  ]) {
    if (!state.includes(`type: "${action}"`)) {
      throw new Error(`Dashboard reducer is missing typed update action: ${action}`);
    }
  }
});
