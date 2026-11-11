import type { Dispatch, FormEvent, SetStateAction } from "react";
import type { Role, Servant } from "../../../types";
import { errorText } from "../../../shared/formatters";
import {
  createServantRecord,
  linkServantAccountRecord,
  setServantActive,
  setServantQualifiedRoles,
} from "../services/servantManagement";

type ServantModalMode = "schedule" | "person" | null;

type ServantActionsInput = {
  client: typeof import("../../../supabase").supabase;
  isAdmin: boolean;
  loadData: () => Promise<void>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setMessage: Dispatch<SetStateAction<string>>;
  setScheduleError: Dispatch<SetStateAction<string>>;
  setModal: Dispatch<SetStateAction<ServantModalMode>>;
};

/** Owns servant record and account-linking actions; App supplies shared state and refresh. */
export function useServantActions({
  client,
  isAdmin,
  loadData,
  setLoading,
  setMessage,
  setScheduleError,
  setModal,
}: ServantActionsInput) {
  async function linkServantAccount(
    servant: Servant,
    userId: string,
    verifiedNij: string,
  ): Promise<boolean> {
    if (!client || !isAdmin) return false;
    const { error } = await linkServantAccountRecord(client, {
      servantId: servant.id,
      userId,
      verifiedNij,
    });
    if (error) {
      setMessage(errorText(error));
      return false;
    }
    await loadData();
    setMessage(
      `Account successfully linked to ${servant.full_name}. Identity verification was recorded in the audit trail.`,
    );
    return true;
  }

  async function savePerson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client || !isAdmin) return;
    setScheduleError("");
    const formData = new FormData(event.currentTarget);
    const name = String(formData.get("full_name")).trim();
    if (!name) return;

    setLoading(true);
    try {
      const { error } = await createServantRecord(client, name);
      if (error) throw error;
      setModal(null);
      await loadData();
    } catch (error) {
      setScheduleError(errorText(error));
      setLoading(false);
    }
  }

  async function togglePerson(servant: Servant) {
    if (!client || !isAdmin) return;
    const { error } = await setServantActive(client, servant.id, !servant.active);
    if (error) setMessage(errorText(error));
    else await loadData();
  }

  async function saveServantRoles(servant: Servant, roles: Role[]): Promise<boolean> {
    if (!client || !isAdmin) return false;
    const uniqueRoles = [...new Set(roles)];
    const { error } = await setServantQualifiedRoles(client, servant.id, uniqueRoles);
    if (error) {
      setMessage(errorText(error));
      return false;
    }
    await loadData();
    setMessage(`Qualified sound roles updated for ${servant.full_name}.`);
    return true;
  }

  return { linkServantAccount, savePerson, togglePerson, saveServantRoles };
}
