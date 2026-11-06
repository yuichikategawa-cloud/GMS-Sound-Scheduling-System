export interface ScheduleDataQueryResponse<T = any> {
  data: T[] | null;
  error: { message: string } | null;
}

/** Supabase query-builder generics are intentionally kept behind this feature boundary. */
export type ScheduleDataClient = any;

import type { Assignment, Location, Schedule } from "../../../types";

export interface ServiceTemplate {
  id: string;
  location_id: string;
  day_of_week: number;
  service_name: string;
  start_time: string;
  end_time: string;
  active: boolean;
}

export interface ScheduleWorkspaceData {
  locations: ScheduleDataQueryResponse<Location>;
  templates: ScheduleDataQueryResponse<ServiceTemplate>;
  schedules: ScheduleDataQueryResponse<Schedule>;
  assignments: ScheduleDataQueryResponse<Assignment>;
}

/**
 * Loads the four Schedule-owned dashboard datasets in parallel.
 * Responses remain independent so App can retain required-vs-optional handling.
 */
export async function loadScheduleWorkspaceData(
  client: ScheduleDataClient,
): Promise<ScheduleWorkspaceData> {
  const [locations, templates, schedules, assignments] = await Promise.all([
    client.from("locations").select("*").order("name"),
    client.from("service_templates").select("*").eq("active", true),
    client.from("schedules").select("*").order("service_date").order("start_time"),
    client.from("assignments").select("*"),
  ]);

  return {
    locations,
    templates,
    schedules,
    assignments,
  } as ScheduleWorkspaceData;
}

/** Loads historical Schedule rows for the existing administrator CSV export. */
export function loadHistoricalScheduleData(
  client: ScheduleDataClient,
  beforeDate: string,
): PromiseLike<ScheduleDataQueryResponse> {
  return client
    .from("schedules")
    .select("*,locations(name),assignments(role,servants(full_name))")
    .lt("service_date", beforeDate)
    .order("service_date", { ascending: false });
}
