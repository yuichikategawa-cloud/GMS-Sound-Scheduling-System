/**
 * Stable cross-feature contracts shared by scheduling, availability and request
 * workflows. Feature implementations may depend on these types without importing
 * one another.
 */

export type AvailabilityStatus = "available" | "unavailable" | "prefer_not";

export interface AvailabilityRecord {
  id?: string;
  servant_id: string;
  service_date: string;
  status: AvailabilityStatus;
  notes?: string | null;
  is_recurring?: boolean;
  rule_id?: string;
}

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

export type ServingRequestType = "replacement" | "swap";
export type ServingRequestStatus = "pending" | "approved" | "declined" | "rejected";

export interface ServingRequestRecord {
  id: string;
  schedule_id: string;
  assignment_id?: string | null;
  requester_servant_id: string;
  request_type: ServingRequestType;
  details?: string | null;
  status: ServingRequestStatus;
  created_at: string;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  target_schedule_id?: string | null;
  target_assignment_id?: string | null;
  target_servant_id?: string | null;
}
