import type { Dispatch, SetStateAction } from "react";
import type { ScheduleView, Servant } from "../../types";
import type { ServingRequestRecord } from "../../features/requests/services/requestData";
import { createServingRequest } from "../../features/requests/services/requestPersistence";
import {
  notifyAdminAssignmentConfirmation,
  updateAssignmentConfirmation,
} from "../../features/schedule/services/schedulePersistence";
import { runAssignmentConfirmationWorkflow } from "../services/assignmentConfirmation";

type AskText = (
  title: string,
  message: string,
  inputLabel: string,
  requiredText?: string,
  defaultValue?: string,
) => Promise<string | null>;

/** Composes the cross-feature assignment response workflow for the App shell. */
export function useAssignmentConfirmationActions({
  client,
  sessionUserId,
  myServant,
  requests,
  askText,
  loadData,
  setMessage,
}: {
  client: typeof import("../../supabase").supabase;
  sessionUserId?: string;
  myServant?: Servant;
  requests: ServingRequestRecord[];
  askText: AskText;
  loadData: () => Promise<void>;
  setMessage: Dispatch<SetStateAction<string>>;
}) {
  async function confirmAssignment(schedule: ScheduleView, status: "confirmed" | "declined") {
    if (!client || !myServant || !sessionUserId) return;
    const assignment = schedule.assignments.find(item => item.servant_id === myServant.id);
    if (!assignment?.id) return;

    let reason: string | undefined;
    if (status === "declined") {
      const response = await askText(
        "Decline assignment",
        "Please provide a reason for declining (optional).",
        "Reason (optional)",
      );
      if (response === null) return;
      reason = response;
    }

    const hasPendingReplacement = requests.some(request =>
      request.assignment_id === assignment.id &&
      request.request_type === "replacement" &&
      request.status === "pending"
    );

    await runAssignmentConfirmationWorkflow(
      {
        scheduleId: schedule.id,
        assignmentId: assignment.id,
        servantId: myServant.id,
        status,
        reason,
        hasPendingReplacement,
      },
      {
        updateConfirmation: (assignmentId, nextStatus) =>
          updateAssignmentConfirmation(client, assignmentId, nextStatus),
        notifyAdministrator: assignmentId =>
          notifyAdminAssignmentConfirmation(client, assignmentId),
        createReplacementRequest: payload => createServingRequest(client, payload),
        refresh: loadData,
        setMessage: message => setMessage(message),
      },
    );
  }

  return { confirmAssignment };
}
