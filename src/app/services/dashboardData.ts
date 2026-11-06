import type { Assignment, Location, Schedule, ScheduleView, Servant } from "../../types";
import type {
  ServantDirectoryAccountProfile,
  ServantDirectoryMember,
} from "../../features/servants/services/servantDirectory";
import { mapSchedules } from "../../features/schedule/services/mapSchedules";
import { loadScheduleWorkspaceData, type ScheduleWorkspaceData } from "../../features/schedule/services/scheduleData";
import { loadAvailabilityWorkspaceData } from "../../features/availability/services/availabilityData";
import { loadServantRecords, type ServantRecordsResponse } from "../../features/servants/services/servantManagement";
import { loadServantDirectoryData, type ServantDirectoryData } from "../../features/servants/services/servantDirectory";
import { loadServingRequestData, type ServingRequestData } from "../../features/requests/services/requestData";
import { loadServingNotificationData, type ServingNotificationData } from "../../features/notifications/services/notificationData";
import { loadRecentAuditLogs, type AuditQueryResponse } from "../../features/audit/services/auditData";

export interface DashboardDataLoaders {
  loadScheduleWorkspaceData: typeof loadScheduleWorkspaceData;
  loadServantRecords: typeof loadServantRecords;
  loadAvailabilityWorkspaceData: typeof loadAvailabilityWorkspaceData;
  loadServingRequestData: typeof loadServingRequestData;
  loadServingNotificationData: typeof loadServingNotificationData;
  loadRecentAuditLogs: typeof loadRecentAuditLogs;
  loadServantDirectoryData: typeof loadServantDirectoryData;
}

export interface NotificationPreferenceState {
  new_assignments: boolean;
  schedule_changes: boolean;
  confirmation_reminders: boolean;
  availability_deadlines: boolean;
  request_updates: boolean;
}

export interface DashboardData {
  locations: Location[];
  servants: Servant[];
  templates: any[];
  schedules: ScheduleView[];
  availabilityRules: any[];
  servingPreferences: any[];
  availability: any[];
  availabilityDeadline: string;
  requests: any[];
  requestReads: any[];
  notifications: any[];
  auditLogs: any[];
  memberDirectory: ServantDirectoryMember[];
  memberProfile: ServantDirectoryMember | null;
  accountProfiles: ServantDirectoryAccountProfile[];
  notificationPrefs: NotificationPreferenceState;
  optionalErrors: string[];
}

const defaultLoaders: DashboardDataLoaders = {
  loadScheduleWorkspaceData,
  loadServantRecords,
  loadAvailabilityWorkspaceData,
  loadServingRequestData,
  loadServingNotificationData,
  loadRecentAuditLogs,
  loadServantDirectoryData,
};

/**
 * Coordinates the cross-feature dashboard reads and preserves required-vs-optional
 * fallback rules. React state and loading feedback remain owned by App.
 */
export async function loadDashboardData(
  client: any,
  userId: string,
  loaders: DashboardDataLoaders = defaultLoaders,
  now: Date = new Date(),
): Promise<DashboardData> {
  const notificationCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const auditCutoff = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const [
    scheduleDataRes,
    servantRes,
    availabilityDataRes,
    requestDataRes,
    notificationDataRes,
    auditRes,
    servantDirectoryRes,
  ] = await Promise.all([
    loaders.loadScheduleWorkspaceData(client),
    loaders.loadServantRecords(client),
    loaders.loadAvailabilityWorkspaceData(client),
    loaders.loadServingRequestData(client),
    loaders.loadServingNotificationData(client, notificationCutoff, userId),
    loaders.loadRecentAuditLogs(client, auditCutoff),
    loaders.loadServantDirectoryData(client),
  ]);

  for (const result of [
    scheduleDataRes.locations,
    servantRes,
    scheduleDataRes.schedules,
    scheduleDataRes.assignments,
  ]) {
    if (result.error) throw result.error;
  }

  const optionalErrors = [
    ...availabilityDataRes.optionalErrors,
    ...[
      scheduleDataRes.templates,
      requestDataRes.requests,
      requestDataRes.reads,
      notificationDataRes.notifications,
      notificationDataRes.preferences,
      auditRes,
      servantDirectoryRes.memberProfiles,
      servantDirectoryRes.accountProfiles,
    ]
      .filter((result: any) => result.error)
      .map((result: any) => result.error.message),
  ];

  const locations = (scheduleDataRes.locations.data ?? []) as Location[];
  const servants = (servantRes.data ?? []) as Servant[];
  const assignments = (scheduleDataRes.assignments.data ?? []) as Assignment[];
  const schedules = mapSchedules(
    (scheduleDataRes.schedules.data ?? []) as Schedule[],
    assignments,
    locations,
    servants,
  );
  const memberDirectory = servantDirectoryRes.memberProfiles.error
    ? []
    : (servantDirectoryRes.memberProfiles.data ?? []);

  return {
    locations,
    servants,
    templates: scheduleDataRes.templates.error ? [] : (scheduleDataRes.templates.data ?? []),
    schedules,
    availabilityRules: availabilityDataRes.rules,
    servingPreferences: availabilityDataRes.preferences,
    availability: availabilityDataRes.availability,
    availabilityDeadline: availabilityDataRes.deadline,
    requests: requestDataRes.requests.error ? [] : (requestDataRes.requests.data ?? []),
    requestReads: requestDataRes.reads.error ? [] : (requestDataRes.reads.data ?? []),
    notifications: notificationDataRes.notifications.error
      ? []
      : (notificationDataRes.notifications.data ?? []),
    auditLogs: auditRes.error ? [] : (auditRes.data ?? []),
    memberDirectory,
    memberProfile: memberDirectory.find((member: any) => member.user_id === userId) ?? null,
    accountProfiles: servantDirectoryRes.accountProfiles.error
      ? []
      : (servantDirectoryRes.accountProfiles.data ?? []),
    notificationPrefs: notificationDataRes.preferences.error || !notificationDataRes.preferences.data
      ? {
        new_assignments: true,
        schedule_changes: true,
        confirmation_reminders: true,
        availability_deadlines: true,
        request_updates: true,
      }
      : notificationDataRes.preferences.data,
    optionalErrors,
  };
}
