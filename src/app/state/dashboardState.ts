import type { DashboardData, NotificationPreferenceState } from "../services/dashboardData";

export type DashboardState = Omit<DashboardData, "optionalErrors">;

export type DashboardStateUpdater<Value> =
  | Value
  | ((current: Value) => Value);

export const defaultNotificationPreferences: NotificationPreferenceState = {
  new_assignments: true,
  schedule_changes: true,
  confirmation_reminders: true,
  availability_deadlines: true,
  request_updates: true,
};

export function createInitialDashboardState(): DashboardState {
  return {
    locations: [],
    servants: [],
    templates: [],
    schedules: [],
    availabilityRules: [],
    servingPreferences: [],
    availability: [],
    availabilityDeadline: "",
    requests: [],
    requestReads: [],
    notifications: [],
    auditLogs: [],
    memberDirectory: [],
    memberProfile: null,
    accountProfiles: [],
    notificationPrefs: { ...defaultNotificationPreferences },
  };
}

export type DashboardStateAction =
  | { type: "hydrate"; data: DashboardData }
  | { type: "clear-member-data" }
  | {
    type: "set-notifications";
    update: DashboardStateUpdater<DashboardState["notifications"]>;
  }
  | {
    type: "set-notification-preferences";
    update: DashboardStateUpdater<DashboardState["notificationPrefs"]>;
  }
  | {
    type: "set-request-reads";
    update: DashboardStateUpdater<DashboardState["requestReads"]>;
  }
  | { type: "set-availability-deadline"; value: string };

function resolveUpdate<Value>(
  current: Value,
  update: DashboardStateUpdater<Value>,
): Value {
  return typeof update === "function"
    ? (update as (previous: Value) => Value)(current)
    : update;
}

/** Applies one atomic dashboard hydration or a targeted, typed state update. */
export function dashboardStateReducer(
  state: DashboardState,
  action: DashboardStateAction,
): DashboardState {
  switch (action.type) {
    case "hydrate": {
      const data = action.data;
      return {
        locations: data.locations,
        servants: data.servants,
        templates: data.templates,
        schedules: data.schedules,
        availabilityRules: data.availabilityRules,
        servingPreferences: data.servingPreferences,
        availability: data.availability,
        availabilityDeadline: data.availabilityDeadline,
        requests: data.requests,
        requestReads: data.requestReads,
        notifications: data.notifications,
        auditLogs: data.auditLogs,
        memberDirectory: data.memberDirectory,
        memberProfile: data.memberProfile,
        accountProfiles: data.accountProfiles,
        notificationPrefs: data.notificationPrefs,
      };
    }
    case "clear-member-data":
      return {
        ...state,
        memberProfile: null,
        memberDirectory: [],
        notifications: [],
        requests: [],
        requestReads: [],
        availability: [],
        availabilityRules: [],
        servingPreferences: [],
      };
    case "set-notifications":
      return {
        ...state,
        notifications: resolveUpdate(state.notifications, action.update),
      };
    case "set-notification-preferences":
      return {
        ...state,
        notificationPrefs: resolveUpdate(state.notificationPrefs, action.update),
      };
    case "set-request-reads":
      return {
        ...state,
        requestReads: resolveUpdate(state.requestReads, action.update),
      };
    case "set-availability-deadline":
      return { ...state, availabilityDeadline: action.value };
    default:
      return state;
  }
}
