import type { Servant } from "../../../types";

export interface ServantDirectoryMember {
  user_id: string;
  full_name: string;
  email?: string | null;
}

export interface ServantDirectoryAccountProfile {
  id: string;
  role: string;
  username?: string | null;
}

export interface ServantAccountCandidate {
  user_id: string;
  full_name: string;
  email?: string | null;
  username: string;
  linked_servant: Servant | null;
}

/**
 * Builds the same eligible account list used by the servant information panel.
 * Only member profiles with a matching servant-role account are included.
 * Database authorization remains enforced by the existing admin-link RPC.
 */
export function buildServantAccountCandidates(
  memberDirectory: readonly ServantDirectoryMember[],
  accountProfiles: readonly ServantDirectoryAccountProfile[],
  servants: readonly Servant[],
): ServantAccountCandidate[] {
  return memberDirectory
    .filter(member =>
      accountProfiles.some(profile => profile.id === member.user_id && profile.role === "servant")
    )
    .map(member => ({
      user_id: member.user_id,
      full_name: member.full_name,
      email: member.email,
      username: accountProfiles.find(profile => profile.id === member.user_id)?.username ?? "",
      linked_servant: servants.find(servant => servant.auth_user_id === member.user_id) ?? null,
    }));
}
