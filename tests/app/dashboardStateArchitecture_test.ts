/// <reference lib="deno.ns" />

const app = await Deno.readTextFile("src/App.tsx");
const state = await Deno.readTextFile("src/app/state/dashboardState.ts");

Deno.test("App hydrates dashboard state through one application boundary", () => {
  if (!app.includes("dashboardStateReducer") || !app.includes('type: "hydrate", data: dashboard')) {
    throw new Error("App must use the dashboard state reducer for dashboard hydration.");
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
  if (!state.includes("ServantDirectoryMember") || !state.includes("NotificationPreferenceState")) {
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
