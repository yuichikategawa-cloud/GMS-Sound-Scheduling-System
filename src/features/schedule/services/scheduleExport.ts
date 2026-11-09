import { loadHistoricalScheduleData, type ScheduleDataClient } from "./scheduleData";
import { buildScheduleCsv, type ScheduleCsvRecord } from "./scheduleCsv";

/** Prepares the existing administrator historical export without browser side effects. */
export async function prepareHistoricalScheduleCsv(
  client: ScheduleDataClient,
  beforeDate: string,
  roles: readonly string[],
  formatTime: (time: string) => string,
): Promise<{ csv: string | null; recordCount: number; error: { message: string } | null }> {
  const { data, error } = await loadHistoricalScheduleData(client, beforeDate);
  if (error) return { csv: null, recordCount: 0, error };

  const records = (data ?? []) as ScheduleCsvRecord[];
  return {
    csv: buildScheduleCsv(records, roles, formatTime),
    recordCount: records.length,
    error: null,
  };
}
