import type { ServingRequestRecord, ServingRequestStatus, ServingRequestType } from "../../../shared/contracts/scheduling.ts";
export type { ServingRequestRecord, ServingRequestStatus, ServingRequestType } from "../../../shared/contracts/scheduling.ts";


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
