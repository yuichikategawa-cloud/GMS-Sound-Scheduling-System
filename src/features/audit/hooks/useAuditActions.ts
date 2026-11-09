import type { Dispatch, SetStateAction } from "react";
import { today } from "../../../shared/formatters";
import { prepareHistoricalAuditExport } from "../services/auditData";

type AuditActionsInput = {
  client: typeof import("../../../supabase").supabase;
  isAdmin: boolean;
  setMessage: Dispatch<SetStateAction<string>>;
};

/** Owns the administrator's historical audit export workflow and browser download. */
export function useAuditActions({ client, isAdmin, setMessage }: AuditActionsInput) {
  async function exportAuditHistory() {
    if (!client || !isAdmin) return;

    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const result = await prepareHistoricalAuditExport(client, cutoff);
    if (result.kind === "error") {
      setMessage(result.error.message);
      return;
    }
    if (result.kind === "empty") {
      setMessage("No audit records older than 14 days are available to export.");
      return;
    }

    const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "gms-audit-older-than-14-days-" + today() + ".csv";
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage("Downloaded " + result.recordCount + " audit record(s) older than 14 days.");
  }

  return { exportAuditHistory };
}
