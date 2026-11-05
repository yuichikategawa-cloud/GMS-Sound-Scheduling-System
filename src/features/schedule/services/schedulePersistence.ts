export interface SchedulePersistenceServicePayload {
  service_date: string;
  location_id: string;
  service_name: string;
  start_time: string;
  end_time: string;
}

export interface SchedulePersistenceAssignment {
  role: "FOH" | "Monitor" | "Assistant";
  servant_id: string;
}

export interface SchedulePersistenceRow extends SchedulePersistenceServicePayload {}

export type ScheduleGenerationMode = "add" | "replace";

export interface SchedulePersistenceResponse {
  error: unknown | null;
}

export interface SchedulePersistenceClient {
  rpc(
    functionName: "admin_save_schedule_with_assignments",
    args: {
      p_schedule_id: string | null;
      p_service: SchedulePersistenceServicePayload;
      p_assignments: SchedulePersistenceAssignment[];
    },
  ): PromiseLike<SchedulePersistenceResponse>;
  from(tableName: "schedules"): {
    upsert(
      rows: SchedulePersistenceRow[],
      options: {
        onConflict: "service_date,location_id,service_name";
        ignoreDuplicates: boolean;
      },
    ): PromiseLike<SchedulePersistenceResponse>;
    delete(): {
      eq(
        column: "id",
        value: string,
      ): PromiseLike<SchedulePersistenceResponse>;
    };
  };
}

/**
 * Persists one schedule and its role assignments through the existing atomic
 * admin RPC. Authorization and assignment validation remain in the caller.
 */
export function saveScheduleWithAssignments(
  client: SchedulePersistenceClient,
  input: {
    scheduleId: string | null;
    service: SchedulePersistenceServicePayload;
    assignments: SchedulePersistenceAssignment[];
  },
): PromiseLike<SchedulePersistenceResponse> {
  return client.rpc("admin_save_schedule_with_assignments", {
    p_schedule_id: input.scheduleId,
    p_service: input.service,
    p_assignments: input.assignments,
  });
}

/**
 * Upserts generated draft rows with the existing conflict key. Add mode
 * ignores matching rows; replace mode updates matching rows as before.
 */
export function upsertGeneratedSchedules(
  client: SchedulePersistenceClient,
  rows: SchedulePersistenceRow[],
  mode: ScheduleGenerationMode,
): PromiseLike<SchedulePersistenceResponse> {
  return client.from("schedules").upsert(rows, {
    onConflict: "service_date,location_id,service_name",
    ignoreDuplicates: mode === "add",
  });
}

/** Deletes one schedule by ID; the database retains assignment cascade behavior. */
export function deleteScheduleById(
  client: SchedulePersistenceClient,
  scheduleId: string,
): PromiseLike<SchedulePersistenceResponse> {
  return client.from("schedules").delete().eq("id", scheduleId);
}
