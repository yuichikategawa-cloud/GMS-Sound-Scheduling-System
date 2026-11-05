export interface RequestPersistenceResponse {
  error: { message: string } | null;
}

export interface ServingRequestInsertPayload {
  schedule_id: string;
  assignment_id: string | undefined;
  requester_servant_id: string;
  request_type: "replacement" | "swap";
  details: string;
  status: "pending";
  target_schedule_id?: string;
  target_assignment_id?: string;
  target_servant_id?: string;
}

export interface ServingRequestReadPayload {
  request_id: string;
  user_id: string;
  read_at: string;
}

export interface ServingRequestReviewPayload {
  status: "approved" | "declined";
  reviewed_by: string;
  reviewed_at: string;
}

/** Minimal structural contract for the existing Supabase client methods. */
export interface ServingRequestPersistenceClient {
  from(tableName: string): any;
  rpc(functionName: string, args: Record<string, string>): PromiseLike<RequestPersistenceResponse>;
}

/** Inserts a pending replacement or swap request using the existing row contract. */
export function createServingRequest(
  client: ServingRequestPersistenceClient,
  payload: ServingRequestInsertPayload,
): PromiseLike<RequestPersistenceResponse> {
  return client.from("serving_requests").insert(payload);
}

/** Upserts the per-user read marker using the existing composite conflict key. */
export function markServingRequestRead(
  client: ServingRequestPersistenceClient,
  payload: ServingRequestReadPayload,
): PromiseLike<RequestPersistenceResponse> {
  return client.from("serving_request_reads").upsert(payload, {
    onConflict: "request_id,user_id",
  });
}

/** Writes the existing admin review fields for one request ID. */
export function updateServingRequestReview(
  client: ServingRequestPersistenceClient,
  requestId: string,
  payload: ServingRequestReviewPayload,
): PromiseLike<RequestPersistenceResponse> {
  return client.from("serving_requests").update(payload).eq("id", requestId);
}

/** Executes an approved cross-date swap through the existing atomic admin RPC. */
export function executeServingRequestSwap(
  client: ServingRequestPersistenceClient,
  requestId: string,
): PromiseLike<RequestPersistenceResponse> {
  return client.rpc("admin_execute_servant_swap", {
    p_request_id: requestId,
  });
}

/** Resolves a replacement through the existing guarded admin RPC. */
export function resolveServingRequestReplacement(
  client: ServingRequestPersistenceClient,
  requestId: string,
  replacementServantId: string,
): PromiseLike<RequestPersistenceResponse> {
  return client.rpc("admin_resolve_replacement", {
    p_request_id: requestId,
    p_replacement_servant_id: replacementServantId,
  });
}
