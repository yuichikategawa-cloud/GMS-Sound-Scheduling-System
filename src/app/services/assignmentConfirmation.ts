import type { AssignmentConfirmationStatus } from "../../features/schedule/services/schedulePersistence";
import type { ServingRequestInsertPayload } from "../../features/requests/services/requestPersistence";

export interface AssignmentConfirmationResult {
  error: { message: string } | null;
}

export interface AssignmentConfirmationWorkflowDependencies {
  updateConfirmation(assignmentId: string, status: AssignmentConfirmationStatus): PromiseLike<AssignmentConfirmationResult>;
  notifyAdministrator(assignmentId: string): PromiseLike<AssignmentConfirmationResult>;
  createReplacementRequest(payload: ServingRequestInsertPayload): PromiseLike<AssignmentConfirmationResult>;
  refresh(): Promise<void>;
  setMessage(message: string): void;
}

/**
 * Coordinates Schedule and Requests persistence for a servant's response.
 * A saved decline remains successful even if its follow-up request fails.
 */
export async function runAssignmentConfirmationWorkflow(
  input: {
    scheduleId: string;
    assignmentId: string;
    servantId: string;
    status: AssignmentConfirmationStatus;
    reason?: string;
    hasPendingReplacement: boolean;
  },
  dependencies: AssignmentConfirmationWorkflowDependencies,
): Promise<void> {
  const { error: updateError } = await dependencies.updateConfirmation(input.assignmentId, input.status);
  if (updateError) {
    dependencies.setMessage(updateError.message);
    return;
  }

  if (input.status === "declined") {
    if (!input.hasPendingReplacement) {
      const { error: requestError } = await dependencies.createReplacementRequest({
        schedule_id: input.scheduleId,
        assignment_id: input.assignmentId,
        requester_servant_id: input.servantId,
        request_type: "replacement",
        details: input.reason?.trim() || "Servant declined the assignment and requests a replacement.",
        status: "pending",
      });
      if (requestError) {
        dependencies.setMessage("Decline saved, but replacement request could not be created: " + requestError.message);
        await dependencies.refresh();
        return;
      }
      dependencies.setMessage("Assignment declined. A replacement request has been sent to the administrator.");
    } else {
      dependencies.setMessage("Assignment declined. An existing replacement request is already pending with the administrator.");
    }
    await dependencies.refresh();
    return;
  }

  const { error: notificationError } = await dependencies.notifyAdministrator(input.assignmentId);
  dependencies.setMessage(
    notificationError
      ? "Serving assignment confirmed, but the administrator notification could not be sent: " + notificationError.message
      : "Serving assignment confirmed. The administrator has been notified.",
  );
  await dependencies.refresh();
}
