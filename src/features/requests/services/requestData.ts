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

export interface ServingRequestReadMarker {
  request_id: string;
  user_id: string;
  read_at?: string;
}

export interface ServingRequestQueryResponse<T> {
  data: T[] | null;
  error: { message: string } | null;
}

interface ServingRequestsSelectBuilder {
  order(
    column: "created_at",
    options: { ascending: false },
  ): PromiseLike<ServingRequestQueryResponse<ServingRequestRecord>>;
}

interface ServingRequestsQueryBuilder {
  select(columns: "*"): ServingRequestsSelectBuilder;
}

interface ServingRequestReadsQueryBuilder {
  select(columns: "*"): PromiseLike<ServingRequestQueryResponse<ServingRequestReadMarker>>;
}

export interface ServingRequestDataClient {
  from(tableName: "serving_requests"): ServingRequestsQueryBuilder;
  from(tableName: "serving_request_reads"): ServingRequestReadsQueryBuilder;
}

export interface ServingRequestData {
  requests: ServingRequestQueryResponse<ServingRequestRecord>;
  reads: ServingRequestQueryResponse<ServingRequestReadMarker>;
}

/**
 * Loads serving requests and per-user read markers in parallel.
 * Each result remains independent so App can preserve its optional-data
 * warnings and empty-array fallback when either table is unavailable.
 */
export async function loadServingRequestData(
  client: ServingRequestDataClient,
): Promise<ServingRequestData> {
  const [requests, reads] = await Promise.all([
    client.from("serving_requests").select("*").order("created_at", { ascending: false }),
    client.from("serving_request_reads").select("*"),
  ]);

  return { requests, reads };
}
