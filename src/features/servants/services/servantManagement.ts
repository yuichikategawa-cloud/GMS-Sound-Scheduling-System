import type { Role, Servant } from "../../../types";

export interface ServantManagementResponse {
  error: unknown | null;
}

export interface ServantRecordsResponse {
  data: Servant[] | null;
  error: unknown | null;
}

export interface ServantLocationRoleRecord {
  servant_id: string;
  location_id: string;
  role: Role;
}

export interface ServantLocationRoleRecordsResponse {
  data: ServantLocationRoleRecord[] | null;
  error: unknown | null;
}

export interface ServantManagementClient {
  from(tableName: "servants" | "servant_location_roles"): any;
  rpc(
    functionName: "admin_link_servant_account",
    args: {
      p_servant_id: string;
      p_user_id: string;
      p_verified_nij: string;
    },
  ): PromiseLike<ServantManagementResponse>;
  rpc(
    functionName: "admin_set_servant_location_roles",
    args: {
      p_servant_id: string;
      p_roles_by_location: Record<string, Role[]>;
    },
  ): PromiseLike<ServantManagementResponse>;
}

/** Loads required servant records using the existing full-row, name-ordered query. */
export function loadServantRecords(
  client: ServantManagementClient,
): PromiseLike<ServantRecordsResponse> {
  return client.from("servants").select("*").order("full_name");
}

/** Loads the per-church role permissions used by the admin directory and scheduler. */
export function loadServantLocationRoleRecords(
  client: ServantManagementClient,
): PromiseLike<ServantLocationRoleRecordsResponse> {
  return client.from("servant_location_roles").select("*");
}

/** Replaces a servant's complete church-specific role matrix in one guarded transaction. */
export function setServantLocationRoles(
  client: ServantManagementClient,
  servantId: string,
  rolesByLocation: Record<string, Role[]>,
): PromiseLike<ServantManagementResponse> {
  const normalized = Object.fromEntries(
    Object.entries(rolesByLocation).map(([locationId, roles]) => [
      locationId,
      [...new Set(roles)],
    ]),
  );
  return client.rpc("admin_set_servant_location_roles", {
    p_servant_id: servantId,
    p_roles_by_location: normalized,
  });
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

/** Updates only the roles a servant is approved to fill; database policies enforce admin access. */
export function setServantQualifiedRoles(
  client: ServantManagementClient,
  servantId: string,
  roles: Role[],
): PromiseLike<ServantManagementResponse> {
  const uniqueRoles = [...new Set(roles)];
  return client.from("servants").update({ qualified_roles: uniqueRoles }).eq("id", servantId);
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
