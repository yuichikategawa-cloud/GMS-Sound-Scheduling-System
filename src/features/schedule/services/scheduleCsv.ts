export interface ScheduleCsvAssignment {
  role: string;
  servant_name?: string | null;
  servants?: { full_name?: string | null } | null;
}

export interface ScheduleCsvRecord {
  service_date: string;
  location_name?: string | null;
  locations?: { name?: string | null } | null;
  service_name: string;
  start_time: string;
  end_time: string;
  assignments?: readonly ScheduleCsvAssignment[] | null;
}

/**
 * Builds the common administrator and workspace schedule CSV representation.
 * Time formatting and role order are injected so this module stays independent
 * of App, browser APIs, and shared UI utilities.
 */
export function buildScheduleCsv(
  records: readonly ScheduleCsvRecord[],
  roles: readonly string[],
  formatTime: (time: string) => string,
): string {
  const header = ["date", "location", "service", "start", "end", ...roles].join(",");
  const rows = records.map(record => {
    const values = [
      record.service_date,
      record.location_name ?? record.locations?.name ?? "",
      record.service_name,
      formatTime(record.start_time),
      formatTime(record.end_time),
      ...roles.map(role => {
        const assignment = record.assignments?.find(item => item.role === role);
        return assignment?.servant_name ?? assignment?.servants?.full_name ?? "";
      }),
    ];
    return values.map(value => `"${String(value).replace(/"/g, '""')}"`).join(",");
  });

  return [header, ...rows].join("\r\n");
}
