/// <reference lib="deno.ns" />

import {
  loadDashboardData,
  type DashboardDataLoaders,
} from "../../src/app/services/dashboardData.ts";

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message + "\nExpected: " + JSON.stringify(expected) + "\nActual: " + JSON.stringify(actual));
  }
}

function assertSame(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new Error(message);
}

const now = new Date("2026-11-06T12:00:00.000Z");
const locations = [
  { id: "location-1", name: "North Campus" },
  { id: "location-2", name: "South Campus" },
];
const servants = [{ id: "servant-1", full_name: "Ada", active: true, auth_user_id: "user-1" }];
const scheduleData = {
  locations: { data: locations, error: null },
  templates: { data: [{ id: "template-1" }], error: null },
  schedules: { data: [{
    id: "schedule-1",
    service_date: "2026-11-08",
    location_id: "location-1",
    service_name: "Sunday Service",
    start_time: "09:00",
    end_time: "11:00",
  }], error: null },
  assignments: { data: [{
    id: "assignment-1",
    schedule_id: "schedule-1",
    servant_id: "servant-1",
    role: "FOH",
    confirmation_status: "pending",
  }], error: null },
};
const servantDirectory = {
  memberProfiles: { data: [{ user_id: "user-1", full_name: "Ada" }], error: null },
  accountProfiles: { data: [{ id: "user-1", role: "servant", username: "ada" }], error: null },
};

function createLoaders(overrides: Record<string, unknown> = {}) {
  const calls: Array<{ loader: string; args: unknown[] }> = [];
  const defaults = {
    loadScheduleWorkspaceData: async (...args: unknown[]) => {
      calls.push({ loader: "schedule", args });
      return scheduleData;
    },
    loadServantRecords: async (...args: unknown[]) => {
      calls.push({ loader: "servants", args });
      return { data: servants, error: null };
    },
    loadServantLocationRoleRecords: async (...args: unknown[]) => {
      calls.push({ loader: "servant-location-roles", args });
      return {
        data: [
          { servant_id: "servant-1", location_id: "location-1", role: "FOH" as const },
          { servant_id: "servant-1", location_id: "location-2", role: "Monitor" as const },
        ],
        error: null,
      };
    },
    loadAvailabilityWorkspaceData: async (...args: unknown[]) => {
      calls.push({ loader: "availability", args });
      return {
        availability: [{ id: "availability-1" }],
        rules: [{ id: "rule-1" }],
        preferences: [{ id: "preference-1" }],
        deadline: "2026-11-07",
        optionalErrors: [],
        generationErrors: [],
      };
    },
    loadServingRequestData: async (...args: unknown[]) => {
      calls.push({ loader: "requests", args });
      return {
        requests: { data: [{ id: "request-1" }], error: null },
        reads: { data: [], error: null },
      };
    },
    loadServingNotificationData: async (...args: unknown[]) => {
      calls.push({ loader: "notifications", args });
      return {
        notifications: { data: [{ id: "notification-1" }], error: null },
        preferences: { data: { new_assignments: false }, error: null },
      };
    },
    loadRecentAuditLogs: async (...args: unknown[]) => {
      calls.push({ loader: "audit", args });
      return { data: [{ id: "audit-1" }], error: null };
    },
    loadServantDirectoryData: async (...args: unknown[]) => {
      calls.push({ loader: "directory", args });
      return servantDirectory;
    },
  };
  return {
    calls,
    loaders: { ...defaults, ...overrides } as unknown as DashboardDataLoaders,
  };
}

Deno.test("dashboard loading composes feature data and maps shared Schedule views", async () => {
  const { loaders, calls } = createLoaders();
  const result = await loadDashboardData({ client: "test" }, "user-1", loaders, now);

  assertEqual(calls.map(call => call.loader).sort(), [
    "audit",
    "availability",
    "directory",
    "notifications",
    "requests",
    "schedule",
    "servants",
    "servant-location-roles",
  ], "Dashboard loading must call each feature data boundary.");
  assertEqual(calls.find(call => call.loader === "notifications")?.args.slice(1), [
    "2026-10-07T12:00:00.000Z",
    "user-1",
  ], "Notification data must retain its 30-day cutoff and active user ID.");
  assertEqual(calls.find(call => call.loader === "audit")?.args[1],
    "2026-10-23T12:00:00.000Z",
    "Audit data must retain its 14-day cutoff.");
  assertEqual(result.locations, locations, "Dashboard must return required location data.");
  assertEqual(result.servants[0].qualified_roles_by_location, {
    "location-1": ["FOH"],
    "location-2": ["Monitor"],
  }, "The servant role map must hydrate church-specific qualification rows.");
  assertEqual(result.schedules[0], {
    ...scheduleData.schedules.data[0],
    location_name: "North Campus",
    assignments: [{
      id: "assignment-1",
      role: "FOH",
      servant_id: "servant-1",
      servant_name: "Ada",
      confirmation_status: "pending",
    }],
  }, "Dashboard loading must map Schedule rows to the same display model.");
  assertEqual(result.memberProfile, { user_id: "user-1", full_name: "Ada" },
    "The active user's member profile must be selected from the optional directory.");
  assertEqual(result.notificationPrefs, { new_assignments: false },
    "A successful preference row must pass through unchanged.");
  assertEqual(result.scheduleGenerationErrors, [], "Successful required scheduler input reads should leave generation ready.");
});

Deno.test("dashboard loading keeps optional-data warnings and empty fallbacks independent", async () => {
  const optionalError = { message: "Optional table unavailable." };
  const { loaders } = createLoaders({
    loadScheduleWorkspaceData: async () => ({
      ...scheduleData,
      templates: { data: null, error: optionalError },
    }),
    loadAvailabilityWorkspaceData: async () => ({
      availability: [],
      rules: [],
      preferences: [],
      deadline: "",
      optionalErrors: ["Recurring availability unavailable."],
      generationErrors: ["Recurring availability unavailable."],
    }),
    loadServingRequestData: async () => ({
      requests: { data: null, error: optionalError },
      reads: { data: [], error: null },
    }),
    loadServingNotificationData: async () => ({
      notifications: { data: null, error: optionalError },
      preferences: { data: null, error: optionalError },
    }),
    loadRecentAuditLogs: async () => ({ data: null, error: optionalError }),
    loadServantDirectoryData: async () => ({
      memberProfiles: { data: null, error: optionalError },
      accountProfiles: { data: null, error: optionalError },
    }),
  });

  const result = await loadDashboardData({}, "user-1", loaders, now);

  assertEqual(result.templates, [], "Optional template failure must not blank the dashboard.");
  assertEqual(result.requests, [], "Optional request failure must retain the empty fallback.");
  assertEqual(result.notifications, [], "Optional notification failure must retain the empty fallback.");
  assertEqual(result.auditLogs, [], "Optional audit failure must retain the empty fallback.");
  assertEqual(result.memberDirectory, [], "Optional member profile failure must retain the empty fallback.");
  assertEqual(result.accountProfiles, [], "Optional account profile failure must retain the empty fallback.");
  assertEqual(result.notificationPrefs, {
    new_assignments: true,
    schedule_changes: true,
    confirmation_reminders: true,
    availability_deadlines: true,
    request_updates: true,
  }, "Missing or failed preferences must retain all-enabled defaults.");
  assertEqual(result.optionalErrors.length, 8,
    "Dashboard must report every optional data failure, including Availability summaries.");
  assertEqual(result.scheduleGenerationErrors, ["Recurring availability unavailable.", optionalError.message, optionalError.message],
    "Monthly generation readiness must fail closed on critical Availability, template and pending-request reads.");
});

Deno.test("dashboard loading fails when a required Schedule or Servants query fails", async () => {
  const requiredError = { message: "Schedule rows are required." };
  const { loaders } = createLoaders({
    loadScheduleWorkspaceData: async () => ({
      ...scheduleData,
      schedules: { data: null, error: requiredError },
    }),
  });

  let caught: unknown = null;
  try {
    await loadDashboardData({}, "user-1", loaders, now);
  } catch (error) {
    caught = error;
  }
  assertSame(caught, requiredError, "Required dashboard query errors must propagate unchanged.");
});


Deno.test("dashboard blocks Smart Scheduling when church-specific qualification data cannot be verified", async () => {
  const { loaders } = createLoaders({
    loadServantLocationRoleRecords: async () => ({
      data: null,
      error: { message: "Permission matrix unavailable" },
    }),
  });
  const result = await loadDashboardData({ client: "test" }, "user-1", loaders, now);

  assertEqual(
    result.scheduleGenerationErrors.some(error => error.includes("Permission matrix unavailable")),
    true,
    "A missing church-role dataset must block automatic scheduling rather than fall back to a broad global role list.",
  );
  assertEqual(
    result.servants[0].qualified_roles_by_location,
    { "location-1": [], "location-2": [] },
    "A failed permission lookup must never grant default roles to a church.",
  );
});
