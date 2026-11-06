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


// Schedule's administrator mutations stay behind feature-owned persistence
// operations; hooks orchestrate validation, authorization and user messaging.

export type SchedulePublicationStatus = "published" | "draft";

export type ScheduleAdminPublishClient = {
  rpc(
    functionName: "admin_publish_schedules_grouped",
    args: {
      p_location_id: string | null;
      p_schedule_ids: string[] | null;
      p_status: SchedulePublicationStatus;
    },
  ): PromiseLike<SchedulePersistenceResponse>;
};

export function updateSchedulePublication(
  client: ScheduleAdminPublishClient,
  input: {
    locationId: string | null;
    scheduleIds: string[] | null;
    status: SchedulePublicationStatus;
  },
): PromiseLike<SchedulePersistenceResponse> {
  return client.rpc("admin_publish_schedules_grouped", {
    p_location_id: input.locationId,
    p_schedule_ids: input.scheduleIds,
    p_status: input.status,
  });
}

export type ScheduleBulkAssignmentClient = {
  rpc(
    functionName: "admin_bulk_assignments_grouped",
    args: {
      p_assignments: any[];
      p_batch_label: string;
    },
  ): PromiseLike<{ data: unknown; error: unknown | null }>;
};

export function saveBulkScheduleAssignments(
  client: ScheduleBulkAssignmentClient,
  rows: any[],
  batchLabel = "Bulk schedule assignment",
): PromiseLike<{ data: unknown; error: unknown | null }> {
  return client.rpc("admin_bulk_assignments_grouped", {
    p_assignments: rows,
    p_batch_label: batchLabel,
  });
}

export type ScheduleLocationDeleteClient = {
  from(tableName: "schedules"): {
    delete(): {
      in(column: "location_id", values: string[]): PromiseLike<SchedulePersistenceResponse>;
      eq(column: "location_id", value: string): PromiseLike<SchedulePersistenceResponse>;
    };
  };
};

export function deleteLocationSchedules(
  client: ScheduleLocationDeleteClient,
  locationIds: string[],
  allChurches: boolean,
): PromiseLike<SchedulePersistenceResponse> {
  return allChurches
    ? client.from("schedules").delete().in("location_id", locationIds)
    : client.from("schedules").delete().eq("location_id", locationIds[0]);
}

export type ScheduleLocationCreateClient = {
  from(tableName: "locations"): {
    insert(values: { name: string }): PromiseLike<SchedulePersistenceResponse>;
  };
};

export function createScheduleLocation(
  client: ScheduleLocationCreateClient,
  name: string,
): PromiseLike<SchedulePersistenceResponse> {
  return client.from("locations").insert({ name });
}

export interface ServiceTemplatePayload {
  location_id: string;
  day_of_week: number;
  service_name: string;
  start_time: string;
  end_time: string;
  active: boolean;
}

export type ServiceTemplateUpsertClient = {
  from(tableName: "service_templates"): {
    upsert(
      values: ServiceTemplatePayload,
      options: { onConflict: "location_id,day_of_week,service_name" },
    ): PromiseLike<SchedulePersistenceResponse>;
  };
};

export function upsertScheduleServiceTemplate(
  client: ServiceTemplateUpsertClient,
  payload: ServiceTemplatePayload,
): PromiseLike<SchedulePersistenceResponse> {
  return client.from("service_templates").upsert(payload, {
    onConflict: "location_id,day_of_week,service_name",
  });
}

export type ServiceTemplateArchiveClient = {
  from(tableName: "service_templates"): {
    update(values: { active: false }): {
      eq(column: "id", value: string | number): PromiseLike<SchedulePersistenceResponse>;
    };
  };
};

export function archiveScheduleServiceTemplate(
  client: ServiceTemplateArchiveClient,
  templateId: string | number,
): PromiseLike<SchedulePersistenceResponse> {
  return client.from("service_templates").update({ active: false }).eq("id", templateId);
}


export type AssignmentConfirmationStatus = "confirmed" | "declined";

export type AssignmentConfirmationResponse = { error: { message: string } | null };

export type AssignmentConfirmationClient = {
  from(tableName: "assignments"): {
    update(values: { confirmation_status: AssignmentConfirmationStatus }): {
      eq(column: "id", value: string): PromiseLike<AssignmentConfirmationResponse>;
    };
  };
  rpc(
    functionName: "notify_admin_assignment_confirmation",
    args: { p_assignment_id: string },
  ): PromiseLike<AssignmentConfirmationResponse>;
};

/** Updates one servant's confirmation state without changing the existing row contract. */
export function updateAssignmentConfirmation(
  client: AssignmentConfirmationClient,
  assignmentId: string,
  status: AssignmentConfirmationStatus,
): PromiseLike<AssignmentConfirmationResponse> {
  return client.from("assignments").update({ confirmation_status: status }).eq("id", assignmentId);
}

/** Sends the existing administrator notification after a confirmation is saved. */
export function notifyAdminAssignmentConfirmation(
  client: AssignmentConfirmationClient,
  assignmentId: string,
): PromiseLike<AssignmentConfirmationResponse> {
  return client.rpc("notify_admin_assignment_confirmation", { p_assignment_id: assignmentId });
}
