export interface AuditLogRecord {
  id?: string;
  created_at?: string;
  actor_id?: string | null;
  action?: string;
  table_name?: string;
  record_id?: string | null;
  old_data?: unknown;
  new_data?: unknown;
}

export interface AuditQueryResponse {
  data: AuditLogRecord[] | null;
  error: { message: string } | null;
}

/** Structural boundary keeps Supabase query-builder types out of App. */
export interface AuditDataClient {
  from(tableName: string): any;
}

/**
 * Loads the administrator audit page's recent event window.
 * The caller supplies the existing 14-day cutoff; the 50-row limit and
 * newest-first ordering intentionally match the original App query.
 */
export async function loadRecentAuditLogs(
  client: AuditDataClient,
  cutoff: string,
): Promise<AuditQueryResponse> {
  return client
    .from("audit_logs")
    .select("*")
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(50);
}

/**
 * Loads every audit row older than the caller's cutoff in 1,000-row pages.
 * The administrator authorization check remains in App and database access
 * remains protected by the existing audit_logs RLS policy.
 */
export async function loadHistoricalAuditLogs(
  client: AuditDataClient,
  cutoff: string,
): Promise<AuditQueryResponse> {
  const data: AuditLogRecord[] = [];
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    const { data: page, error } = await client
      .from("audit_logs")
      .select("*")
      .lt("created_at", cutoff)
      .order("created_at", { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) return { data: null, error };

    data.push(...(page ?? []));
    if (!page || page.length < pageSize) break;
  }

  return { data, error: null };
}

/** Builds the existing audit CSV representation without browser side effects. */
export function buildAuditCsv(data: readonly AuditLogRecord[]): string {
  const columns = [
    "created_at",
    "actor_id",
    "action",
    "table_name",
    "record_id",
    "old_data",
    "new_data",
  ] as const satisfies readonly (keyof AuditLogRecord)[];

  const cell = (value: unknown) =>
    '"' + String(
      value === null || value === undefined
        ? ""
        : typeof value === "object"
        ? JSON.stringify(value)
        : value,
    ).replace(/"/g, '""') + '"';

  return [
    columns.join(","),
    ...data.map(row => columns.map(column => cell(row[column])).join(",")),
  ].join("\r\n");
}

export type HistoricalAuditExportPreparation =
  | { kind: "error"; error: { message: string } }
  | { kind: "empty" }
  | { kind: "ready"; csv: string; recordCount: number };

/**
 * Prepares a complete historical export while preserving the existing query,
 * pagination, CSV format, and explicit empty/error outcomes.
 */
export async function prepareHistoricalAuditExport(
  client: AuditDataClient,
  cutoff: string,
): Promise<HistoricalAuditExportPreparation> {
  const { data, error } = await loadHistoricalAuditLogs(client, cutoff);
  if (error) return { kind: "error", error };
  if (!data || data.length === 0) return { kind: "empty" };

  return {
    kind: "ready",
    csv: buildAuditCsv(data),
    recordCount: data.length,
  };
}
