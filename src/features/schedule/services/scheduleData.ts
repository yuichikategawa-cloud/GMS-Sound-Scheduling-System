import type { Assignment, Location, Schedule } from "../../../types";

export interface ScheduleDataQueryResponse {
  data: any[] | null;
  error: { message: string } | null;
}

export interface ScheduleDataQueryBuilder extends PromiseLike<ScheduleDataQueryResponse> {
  select(columns: string): ScheduleDataQueryBuilder;
  order(column: string, options?: { ascending?: boolean }): ScheduleDataQueryBuilder;
  eq(column: string, value: unknown): ScheduleDataQueryBuilder;
  lt(column: string, value: string): ScheduleDataQueryBuilder;
}

/** Minimal query boundary for Schedule-owned dashboard reads. */
export interface ScheduleDataClient {
  from(tableName: "locations" | "service_templates" | "schedules" | "assignments"): ScheduleDataQueryBuilder;
}

export interface ScheduleWorkspaceData {
  locations: ScheduleDataQueryResponse;
  templates: ScheduleDataQueryResponse;
  schedules: ScheduleDataQueryResponse;
  assignments: ScheduleDataQueryResponse;
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

  return { locations, templates, schedules, assignments };
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
