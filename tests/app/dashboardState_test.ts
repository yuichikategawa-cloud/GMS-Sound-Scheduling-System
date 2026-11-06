/// <reference lib="deno.ns" />

import {
  createInitialDashboardState,
  dashboardStateReducer,
  defaultNotificationPreferences,
} from "../../src/app/state/dashboardState.ts";
import type { DashboardData } from "../../src/app/services/dashboardData.ts";

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message + "\nExpected: " + JSON.stringify(expected) + "\nActual: " + JSON.stringify(actual));
  }
}

Deno.test("dashboard state starts with empty collections and enabled notification defaults", () => {
  const state = createInitialDashboardState();
  assertEqual(state.schedules, [], "Schedule state should start empty.");
  assertEqual(state.memberProfile, null, "The member profile should start unset.");
  assertEqual(state.notificationPrefs, defaultNotificationPreferences,
    "Missing preferences should preserve the all-enabled default.");
});

Deno.test("dashboard hydration replaces all dashboard-owned state atomically", () => {
  const state = createInitialDashboardState();
  const data: DashboardData = {
    locations: [{ id: "loc-1", name: "North Campus" }],
    servants: [{ id: "servant-1", full_name: "Ada", active: true, auth_user_id: "user-1" }],
    templates: [{ id: "template-1" }],
    schedules: [{
      id: "schedule-1",
      service_date: "2026-11-08",
      location_id: "loc-1",
      service_name: "Sunday",
      start_time: "09:00",
      end_time: "11:00",
      location_name: "North Campus",
      assignments: [],
    }],
    availabilityRules: [{ id: "rule-1" }],
    servingPreferences: [{ id: "preference-1" }],
    availability: [{ id: "availability-1" }],
    availabilityDeadline: "2026-11-07",
    requests: [{ id: "request-1" }],
    requestReads: [{ request_id: "request-1", user_id: "user-1" }],
    notifications: [{ id: "notification-1", is_read: false }],
    auditLogs: [{ id: "audit-1" }],
    memberDirectory: [{ user_id: "user-1", full_name: "Ada" }],
    memberProfile: { user_id: "user-1", full_name: "Ada" },
    accountProfiles: [{ id: "user-1", role: "servant", username: "ada" }],
    notificationPrefs: {
      new_assignments: false,
      schedule_changes: true,
      confirmation_reminders: true,
      availability_deadlines: false,
      request_updates: true,
    },
    optionalErrors: [],
  };

  const next = dashboardStateReducer(state, { type: "hydrate", data });
  assertEqual(next.schedules, data.schedules, "Hydration should install Schedule views.");
  assertEqual(next.locations, data.locations, "Hydration should install church locations.");
  assertEqual(next.requests, data.requests, "Hydration should install serving requests.");
  assertEqual(next.notificationPrefs, data.notificationPrefs, "Hydration should install notification preferences.");
  assertEqual(next.auditLogs, data.auditLogs, "Hydration should install audit history.");
});

Deno.test("targeted collection updates support functional updates against the latest state", () => {
  const initial = createInitialDashboardState();
  const withNotification = dashboardStateReducer(initial, {
    type: "set-notifications",
    update: [{ id: "notification-1", is_read: false }],
  });
  const markedRead = dashboardStateReducer(withNotification, {
    type: "set-notifications",
    update: current => current.map(item => ({ ...item, is_read: true })),
  });
  assertEqual(markedRead.notifications, [{ id: "notification-1", is_read: true }],
    "Functional notification updates should transform the latest state.");

  const withRead = dashboardStateReducer(markedRead, {
    type: "set-request-reads",
    update: current => [...current, { request_id: "request-1", user_id: "user-1" }],
  });
  assertEqual(withRead.requestReads, [{ request_id: "request-1", user_id: "user-1" }],
    "Request-read updates should append to the latest state.");

  const updatedPreferences = dashboardStateReducer(withRead, {
    type: "set-notification-preferences",
    update: current => ({ ...current, request_updates: false }),
  });
  assertEqual(updatedPreferences.notificationPrefs.request_updates, false,
    "Notification preference updates should preserve unmodified fields.");
});

Deno.test("sign-out clears member-specific dashboard data and preserves unrelated dashboard state", () => {
  const hydrated = dashboardStateReducer(createInitialDashboardState(), {
    type: "hydrate",
    data: {
      ...createInitialDashboardState(),
      locations: [{ id: "loc-1", name: "North Campus" }],
      schedules: [{
        id: "schedule-1",
        service_date: "2026-11-08",
        location_id: "loc-1",
        service_name: "Sunday",
        start_time: "09:00",
        end_time: "11:00",
        location_name: "North Campus",
        assignments: [],
      }],
      memberProfile: { user_id: "user-1", full_name: "Ada" },
      memberDirectory: [{ user_id: "user-1", full_name: "Ada" }],
      availability: [{ id: "availability-1" }],
      requests: [{ id: "request-1" }],
      notifications: [{ id: "notification-1" }],
      optionalErrors: [],
    },
  });

  const cleared = dashboardStateReducer(hydrated, { type: "clear-member-data" });
  assertEqual(cleared.memberProfile, null, "Sign-out should clear the selected member profile.");
  assertEqual(cleared.memberDirectory, [], "Sign-out should clear member directory rows.");
  assertEqual(cleared.availability, [], "Sign-out should clear Availability rows.");
  assertEqual(cleared.requests, [], "Sign-out should clear Requests rows.");
  assertEqual(cleared.notifications, [], "Sign-out should clear notifications.");
  assertEqual(cleared.schedules, hydrated.schedules,
    "The refactor should preserve existing behavior for non-member dashboard collections.");
  assertEqual(cleared.locations, hydrated.locations,
    "The refactor should preserve loaded church location data.");
});
