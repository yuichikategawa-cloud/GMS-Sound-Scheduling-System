import { errorText } from "../../../shared/formatters";
import { saveMemberProfile } from "../services/memberProfile";

type MemberProfileActionsInput = {
  client: typeof import("../../../supabase").supabase;
  userId?: string;
  currentEmail?: string | null;
  loadData: () => Promise<void>;
  setMessage: (message: string) => void;
};

/** Owns member-profile save feedback and refresh orchestration for the Auth feature. */
export function useMemberProfileActions({
  client,
  userId,
  currentEmail,
  loadData,
  setMessage,
}: MemberProfileActionsInput) {
  async function saveProfile(payload: Record<string, any>): Promise<void> {
    if (!client || !userId) return;
    try {
      await saveMemberProfile(client, userId, payload, currentEmail);
      setMessage("Profile updated and verification date refreshed.");
      await loadData();
    } catch (error) {
      setMessage(errorText(error));
    }
  }

  return { saveProfile };
}
