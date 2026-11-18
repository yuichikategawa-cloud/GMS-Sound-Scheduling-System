import type { AvailabilityStatus, RecurringAvailabilityPattern } from "./recurringAvailability.ts";
import type { ServingPreferenceRuleType } from "./availabilityData.ts";

export interface AvailabilityPersistenceResponse {
  error: unknown | null;
}

export interface AvailabilitySubmissionRow {
  servant_id: string;
  service_date: string;
  status: AvailabilityStatus;
  notes: string;
}

export interface AvailabilityRulePayload {
  servant_id: string;
  pattern: RecurringAvailabilityPattern;
  status: AvailabilityStatus;
  effective_from: string;
  effective_until: string | null;
  weekday: number;
  ordinal: number;
  weekdays: number[];
  interval_weeks: number;
  notes: string;
}

export interface ServingPreferencePayload {
  servant_id: string;
  rule_type: ServingPreferenceRuleType;
  days_of_week: number[];
  start_time: string | null;
  end_time: string | null;
  location_id: string | null;
  service_names: string[];
  notes: string;
  active: boolean;
}

interface AvailabilityUpsertClient {
  from(tableName: "servant_availability"): {
    upsert(
      values: AvailabilitySubmissionRow | AvailabilitySubmissionRow[],
      options: { onConflict: "servant_id,service_date" },
    ): PromiseLike<AvailabilityPersistenceResponse>;
  };
}

interface AvailabilityDeleteClient {
  from(tableName: "servant_availability"): {
    delete(): {
      eq(column: "id", value: string): PromiseLike<AvailabilityPersistenceResponse>;
    };
  };
}

interface AvailabilityRuleInsertClient {
  from(tableName: "servant_availability_rules"): {
    insert(values: AvailabilityRulePayload & { created_by: string | undefined }): PromiseLike<AvailabilityPersistenceResponse>;
  };
}

interface AvailabilityRuleDeleteClient {
  from(tableName: "servant_availability_rules"): {
    delete(): {
      eq(column: "id", value: string): PromiseLike<AvailabilityPersistenceResponse>;
    };
  };
}

interface ServingPreferenceInsertClient {
  from(tableName: "servant_serving_preferences"): {
    insert(values: ServingPreferencePayload & { created_by: string | undefined }): PromiseLike<AvailabilityPersistenceResponse>;
  };
}

interface ServingPreferenceDeleteClient {
  from(tableName: "servant_serving_preferences"): {
    delete(): {
      eq(column: "id", value: string): PromiseLike<AvailabilityPersistenceResponse>;
    };
  };
}

interface AvailabilityDeadlineClient {
  from(tableName: "system_settings"): {
    upsert(
      values: {
        key: "availability_deadline";
        value: string;
        updated_by: string;
      },
      options: { onConflict: "key" },
    ): PromiseLike<AvailabilityPersistenceResponse>;
  };
}

/** Upserts one dated availability row using the existing servant/date conflict key. */
export function upsertAvailabilityRecord(
  client: AvailabilityUpsertClient,
  row: AvailabilitySubmissionRow,
): PromiseLike<AvailabilityPersistenceResponse> {
  return client.from("servant_availability").upsert(row, {
    onConflict: "servant_id,service_date",
  });
}

/** Upserts a batch of dated availability rows using the same existing conflict key. */
export function upsertAvailabilityRecords(
  client: AvailabilityUpsertClient,
  rows: AvailabilitySubmissionRow[],
): PromiseLike<AvailabilityPersistenceResponse> {
  return client.from("servant_availability").upsert(rows, {
    onConflict: "servant_id,service_date",
  });
}

/** Inserts a recurring rule and attributes it to the existing creator account. */
export function insertAvailabilityRule(
  client: AvailabilityRuleInsertClient,
  rule: AvailabilityRulePayload,
  createdBy: string | undefined,
): PromiseLike<AvailabilityPersistenceResponse> {
  return client.from("servant_availability_rules").insert({
    ...rule,
    created_by: createdBy,
  });
}

/** Deletes one recurring availability rule by its existing row ID. */
export function deleteAvailabilityRuleById(
  client: AvailabilityRuleDeleteClient,
  ruleId: string,
): PromiseLike<AvailabilityPersistenceResponse> {
  return client.from("servant_availability_rules").delete().eq("id", ruleId);
}

/** Inserts a serving preference and attributes it to the existing creator account. */
export function insertServingPreference(
  client: ServingPreferenceInsertClient,
  preference: ServingPreferencePayload,
  createdBy: string | undefined,
): PromiseLike<AvailabilityPersistenceResponse> {
  return client.from("servant_serving_preferences").insert({
    ...preference,
    created_by: createdBy,
  });
}

/** Deletes one serving preference by its existing row ID. */
export function deleteServingPreferenceById(
  client: ServingPreferenceDeleteClient,
  preferenceId: string,
): PromiseLike<AvailabilityPersistenceResponse> {
  return client.from("servant_serving_preferences").delete().eq("id", preferenceId);
}

/** Deletes one dated availability row by its existing row ID. */
export function deleteAvailabilityRecordById(
  client: AvailabilityDeleteClient,
  availabilityId: string,
): PromiseLike<AvailabilityPersistenceResponse> {
  return client.from("servant_availability").delete().eq("id", availabilityId);
}

/** Updates the availability submission deadline through the existing settings key. */
export function upsertAvailabilityDeadline(
  client: AvailabilityDeadlineClient,
  value: string,
  updatedBy: string,
): PromiseLike<AvailabilityPersistenceResponse> {
  return client.from("system_settings").upsert({
    key: "availability_deadline",
    value,
    updated_by: updatedBy,
  }, {
    onConflict: "key",
  });
}
