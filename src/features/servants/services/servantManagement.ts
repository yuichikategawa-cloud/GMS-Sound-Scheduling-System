import type { Servant } from "../../../types";

export interface ServantManagementResponse {
  error: unknown | null;
}

export interface ServantRecordsResponse {
  data: Servant[] | null;
  error: unknown | null;
}

export interface ServantManagementClient {
  from(tableName: "servants"): {
    insert(values: {
      full_name: string;
      active: true;
    }): PromiseLike<ServantManagementResponse>;
    update(values: {
      active: boolean;
    }): {
      eq(
        column: "id",
        value: string,
      ): PromiseLike<ServantManagementResponse>;
    };
    select(columns: "*"): {
      order(column: "full_name"): PromiseLike<ServantRecordsResponse>;
    };
  };
  rpc(
    functionName: "admin_link_servant_account",
    args: {
      p_servant_id: string;
      p_user_id: string;
      p_verified_nij: string;
    },
  ): PromiseLike<ServantManagementResponse>;
}

/** Loads required servant records using the existing full-row, name-ordered query. */
export function loadServantRecords(
  client: ServantManagementClient,
): PromiseLike<ServantRecordsResponse> {
  return client.from("servants").select("*").order("full_name");
}

/** Creates an active servant record; authorization remains with the caller and database. */
export function createServantRecord(
  client: ServantManagementClient,
  fullName: string,
): PromiseLike<ServantManagementResponse> {
  return client.from("servants").insert({
    full_name: fullName,
    active: true,
  });
}

/** Changes only the existing servant row's active flag, filtered by its ID. */
export function setServantActive(
  client: ServantManagementClient,
  servantId: string,
  active: boolean,
): PromiseLike<ServantManagementResponse> {
  return client.from("servants").update({ active }).eq("id", servantId);
}

/**
 * Links an existing member account through the existing guarded admin RPC.
 * The RPC owns all identity checks, duplicate consolidation, history conflict
 * checks, audit logging, and transactional behavior.
 */
export function linkServantAccountRecord(
  client: ServantManagementClient,
  input: {
    servantId: string;
    userId: string;
    verifiedNij: string;
  },
): PromiseLike<ServantManagementResponse> {
  return client.rpc("admin_link_servant_account", {
    p_servant_id: input.servantId,
    p_user_id: input.userId,
    p_verified_nij: input.verifiedNij.trim(),
  });
}
