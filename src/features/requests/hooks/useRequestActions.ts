import type { Dispatch, SetStateAction } from "react";
import type { ScheduleView, Servant } from "../../../types";
import { fmtDate } from "../../../shared/formatters";
import type { ServingRequestRecord, ServingRequestReadMarker } from "../services/requestData";
import {
  createServingRequest,
  executeServingRequestSwap,
  markServingRequestRead,
  resolveServingRequestReplacement,
  updateServingRequestReview,
} from "../services/requestPersistence";
import { findCrossLocationAssignmentConflict, isCrossDateSwap } from "../services/swapValidation";

type AskText = (
  title: string,
  message: string,
  inputLabel: string,
  requiredText?: string,
  defaultValue?: string,
) => Promise<string | null>;

type RequestActionsInput = {
  client: typeof import("../../../supabase").supabase;
  isAdmin: boolean;
  schedules: ScheduleView[];
  requests: ServingRequestRecord[];
  myServant?: Servant;
  sessionUserId?: string;
  swapDraft: ScheduleView | null;
  setSwapDraft: Dispatch<SetStateAction<ScheduleView | null>>;
  setRequestReads: Dispatch<SetStateAction<ServingRequestReadMarker[]>>;
  askText: AskText;
  loadData: () => Promise<void>;
  setMessage: Dispatch<SetStateAction<string>>;
};

/**
 * Owns Requests workflows while App supplies shared session, dialog, and
 * refresh boundaries. Persistence remains behind Requests-owned services.
 */
export function useRequestActions({
  client,
  isAdmin,
  schedules,
  requests,
  myServant,
  sessionUserId,
  swapDraft,
  setSwapDraft,
  setRequestReads,
  askText,
  loadData,
  setMessage,
}: RequestActionsInput) {
  async function submitServingRequest(
    schedule: ScheduleView,
    kind: "replacement" | "swap",
  ) {
    if (kind === "swap") {
      setSwapDraft(schedule);
      return;
    }
    if (!client || !myServant) return;
    const own = schedule.assignments.find(assignment =>
      assignment.servant_id === myServant.id
    );
    if (!own) return;
    const note = await askText(
      "Request a replacement",
      "Tell the administrator why you need a replacement.",
      "Reason (optional)",
    );
    if (note === null) return;
    const { error } = await createServingRequest(client, {
      schedule_id: schedule.id,
      assignment_id: own.id,
      requester_servant_id: myServant.id,
      request_type: "replacement",
      details: note.trim(),
      status: "pending",
    });
    if (error) {
      setMessage(error.message);
    } else {
      setMessage("Your replacement request has been sent to the administrator.");
      await loadData();
    }
  }

  async function submitDirectSwap(
    targetScheduleId: string,
    targetAssignmentId: string,
    details: string,
  ) {
    if (!client || !myServant || !swapDraft) return;
    const source = swapDraft;
    const own = source.assignments.find(assignment =>
      assignment.servant_id === myServant.id
    );
    const targetSchedule = schedules.find(schedule => schedule.id === targetScheduleId);
    const target = targetSchedule?.assignments.find(assignment =>
      assignment.id === targetAssignmentId
    );
    if (!own || !targetSchedule || !target) {
      setMessage("Please select a valid servant assignment to swap with.");
      return;
    }
    if (target.servant_id === myServant.id) {
      setMessage("You cannot swap with yourself.");
      return;
    }
    if (source.id === targetSchedule.id || !isCrossDateSwap(source.service_date, targetSchedule.service_date)) {
      setMessage("Choose an assignment on a different service date.");
      return;
    }

    // Each servant must be free of another church assignment on the day they would receive.
    const targetConflict = findCrossLocationAssignmentConflict(
      schedules,
      target.servant_id,
      source.service_date,
      source.location_id,
    );
    const requesterConflict = findCrossLocationAssignmentConflict(
      schedules,
      myServant.id,
      targetSchedule.service_date,
      targetSchedule.location_id,
    );
    if (targetConflict || requesterConflict) {
      setMessage(
        targetConflict
          ? `${target.servant_name} already has an assignment at another church on ${fmtDate(source.service_date)}.`
          : `You already have an assignment at another church on ${fmtDate(targetSchedule.service_date)}.`,
      );
      return;
    }

    const { error } = await createServingRequest(client, {
      schedule_id: source.id,
      assignment_id: own.id,
      requester_servant_id: myServant.id,
      request_type: "swap",
      details: details.trim(),
      status: "pending",
      target_schedule_id: targetSchedule.id,
      target_assignment_id: target.id,
      target_servant_id: target.servant_id,
    });
    if (error) {
      setMessage(error.message);
    } else {
      setSwapDraft(null);
      setMessage("Your cross-date swap request has been sent for admin approval.");
      await loadData();
    }
  }

  async function markRequestRead(requestId: string) {
    if (!client || !sessionUserId) return;
    const readAt = new Date().toISOString();
    const { error } = await markServingRequestRead(client, {
      request_id: requestId,
      user_id: sessionUserId,
      read_at: readAt,
    });
    if (error) {
      console.warn("Could not mark request notification as read:", error.message);
    } else {
      setRequestReads(current => [
        ...current.filter(item => item.request_id !== requestId),
        { request_id: requestId, user_id: sessionUserId, read_at: readAt },
      ]);
    }
  }

  async function reviewRequest(request: ServingRequestRecord, approve: boolean) {
    if (!client || !isAdmin || !sessionUserId) return;
    if (approve && request.request_type === "swap") {
      if (!request.target_schedule_id || !request.target_assignment_id || !request.target_servant_id) {
        setMessage("Swap cannot be approved because its target details are incomplete. Decline or review the request.");
        return;
      }
      const source = schedules.find(schedule => schedule.id === request.schedule_id);
      const targetSchedule = schedules.find(schedule => schedule.id === request.target_schedule_id);
      const sourceAssignment = source?.assignments.find(assignment =>
        assignment.id === request.assignment_id
      );
      const targetAssignment = targetSchedule?.assignments.find(assignment =>
        assignment.id === request.target_assignment_id
      );
      if (!source || !targetSchedule || !sourceAssignment || !targetAssignment) {
        setMessage("Swap cannot be approved because one of the assignments no longer exists.");
        return;
      }
      if (
        !isCrossDateSwap(source.service_date, targetSchedule.service_date) ||
        sourceAssignment.servant_id !== request.requester_servant_id ||
        targetAssignment.servant_id !== request.target_servant_id ||
        targetAssignment.servant_id === request.requester_servant_id
      ) {
        setMessage("Swap cannot be approved because its source or target assignment no longer matches the request.");
        return;
      }

      const excludedScheduleIds = [source.id, targetSchedule.id];
      const targetConflict = findCrossLocationAssignmentConflict(
        schedules,
        targetAssignment.servant_id,
        source.service_date,
        source.location_id,
        excludedScheduleIds,
      );
      const requesterConflict = findCrossLocationAssignmentConflict(
        schedules,
        sourceAssignment.servant_id,
        targetSchedule.service_date,
        targetSchedule.location_id,
        excludedScheduleIds,
      );
      if (targetConflict || requesterConflict) {
        setMessage("Swap approval blocked: one servant now has another assignment on the destination date. Review the schedule first.");
        return;
      }

      const { error: swapError } = await executeServingRequestSwap(client, request.id);
      if (swapError) {
        setMessage(swapError.message);
        return;
      }
      setMessage("Swap approved and assignments exchanged.");
      await loadData();
      return;
    }

    const { error } = await updateServingRequestReview(client, request.id, {
      status: approve ? "approved" : "declined",
      reviewed_by: sessionUserId,
      reviewed_at: new Date().toISOString(),
    });
    if (error) {
      setMessage(error.message);
    } else {
      setMessage(
        approve
          ? request.request_type === "swap"
            ? "Swap approved and assignments exchanged."
            : "Request approved. Please update the assignment if a replacement is needed."
          : "Request declined.",
      );
      await loadData();
    }
  }

  async function resolveReplacement(request: ServingRequestRecord, replacementServantId: string) {
    if (!client || !isAdmin) return;
    const { error } = await resolveServingRequestReplacement(
      client,
      request.id,
      replacementServantId,
    );
    if (error) {
      setMessage(error.message);
      return;
    }
    setMessage("Replacement assigned. Both servants have been notified.");
    await loadData();
  }

  return {
    submitServingRequest,
    submitDirectSwap,
    markRequestRead,
    reviewRequest,
    resolveReplacement,
  };
}
