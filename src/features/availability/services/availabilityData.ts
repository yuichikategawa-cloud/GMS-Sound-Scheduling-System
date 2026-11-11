import { buildVirtualAvailability } from "./recurringAvailability.ts";
import type {
  AvailabilityRecord,
  RecurringAvailabilityRule,
} from "./recurringAvailability.ts";

export type ServingPreferenceRuleType = "allowed_time_window" | "allowed_service_scope";

export interface ServingPreferenceRecord {
  id: string;
  servant_id: string;
  rule_type: ServingPreferenceRuleType;
  days_of_week?: number[] | null;
  start_time?: string | null;
  end_time?: string | null;
  location_id?: string | null;
  service_names?: string[] | null;
  notes?: string | null;
  active: boolean;
  effective_from?: string | null;
  effective_until?: string | null;
}

interface AvailabilityQueryResult<T> {
  data: T | null;
  error: { message?: string } | null;
}

export interface AvailabilityWorkspaceData {
  availability: AvailabilityRecord[];
  rules: RecurringAvailabilityRule[];
  preferences: ServingPreferenceRecord[];
  deadline: string;
  optionalErrors: string[];
  generationErrors: string[];
}

/** Loads Availability-owned reads and materializes the two-year recurring-rule view. */
export async function loadAvailabilityWorkspaceData(
  client: any,
  now: Date = new Date(),
): Promise<AvailabilityWorkspaceData> {
  const [
    availabilityResult,
    rulesResult,
    preferencesResult,
    deadlineResult,
  ] = await Promise.all([
    client.from("servant_availability").select("*").order("service_date", { ascending: true }),
    client.from("servant_availability_rules").select("*").order("created_at", { ascending: false }),
    client.from("servant_serving_preferences").select("*").eq("active", true).order("created_at", { ascending: false }),
    client.from("system_settings").select("*").eq("key", "availability_deadline").maybeSingle(),
  ]) as [
    AvailabilityQueryResult<AvailabilityRecord[]>,
    AvailabilityQueryResult<RecurringAvailabilityRule[]>,
    AvailabilityQueryResult<ServingPreferenceRecord[]>,
    AvailabilityQueryResult<{ value?: string | null }>,
  ];

  const rules = rulesResult.error ? [] : (rulesResult.data ?? []);
  const horizon = new Date(now);
  horizon.setFullYear(horizon.getFullYear() + 2);
  const explicitAvailability = availabilityResult.error ? [] : (availabilityResult.data ?? []);
  const preferences = preferencesResult.error ? [] : (preferencesResult.data ?? []);
  const deadline = deadlineResult.error ? "" : (deadlineResult.data?.value ?? "");
  const generationErrors = [availabilityResult, rulesResult, preferencesResult]
    .filter(result => result.error)
    .map(result => result.error?.message ?? "Availability data required for schedule generation could not be loaded.");
  const optionalErrors = [availabilityResult, rulesResult, preferencesResult, deadlineResult]
    .filter(result => result.error)
    .map(result => result.error?.message ?? "Availability data could not be loaded.");

  return {
    availability: [...explicitAvailability, ...buildVirtualAvailability(rules, horizon)],
    rules,
    preferences,
    deadline,
    optionalErrors,
    generationErrors,
  };
}
