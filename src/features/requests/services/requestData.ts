export interface ServingRequestQueryResponse {
  data: any[] | null;
  error: { message: string } | null;
}

interface ServingRequestsSelectBuilder {
  order(
    column: "created_at",
    options: { ascending: false },
  ): PromiseLike<ServingRequestQueryResponse>;
}

interface ServingRequestsQueryBuilder {
  select(columns: "*"): ServingRequestsSelectBuilder;
}

interface ServingRequestReadsQueryBuilder {
  select(columns: "*"): PromiseLike<ServingRequestQueryResponse>;
}

export interface ServingRequestDataClient {
  from(tableName: "serving_requests"): ServingRequestsQueryBuilder;
  from(tableName: "serving_request_reads"): ServingRequestReadsQueryBuilder;
}

export interface ServingRequestData {
  requests: ServingRequestQueryResponse;
  reads: ServingRequestQueryResponse;
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
