import type { ScheduleView } from "../../../types";
import { today, shortTime } from "../../../shared/formatters";
import type { Dispatch, SetStateAction } from "react";
import { ROLES } from "../constants";
import { prepareHistoricalScheduleCsv } from "../services/scheduleExport";
import { buildScheduleCsv } from "../services/scheduleCsv";

type ScheduleExportActionsInput = {
  client: typeof import("../../../supabase").supabase;
  isAdmin: boolean;
  filteredSchedules: ScheduleView[];
  setMessage: Dispatch<SetStateAction<string>>;
};

function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Owns Schedule CSV preparation and browser downloads for the workspace. */
export function useScheduleExportActions({
  client,
  isAdmin,
  filteredSchedules,
  setMessage,
}: ScheduleExportActionsInput) {
  async function exportScheduleHistory() {
    if (!client || !isAdmin) return;
    const { csv, error } = await prepareHistoricalScheduleCsv(
      client,
      today(),
      ROLES,
      shortTime,
    );
    if (error) {
      setMessage(error.message);
      return;
    }
    if (csv === null) return;
    downloadCsv(csv, "gms-schedule-history.csv");
  }

  function exportCsv() {
    const csv = buildScheduleCsv(filteredSchedules, ROLES, shortTime);
    downloadCsv(csv, "gms-serving-schedule.csv");
  }

  return { exportCsv, exportScheduleHistory };
}
