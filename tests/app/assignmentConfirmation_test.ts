/// <reference lib="deno.ns" />

import {
  runAssignmentConfirmationWorkflow,
  type AssignmentConfirmationResult,
  type AssignmentConfirmationWorkflowDependencies,
} from "../../src/app/services/assignmentConfirmation.ts";
import type { ServingRequestInsertPayload } from "../../src/features/requests/services/requestPersistence.ts";

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message + "\nExpected: " + JSON.stringify(expected) + "\nActual: " + JSON.stringify(actual));
  }
}

function createHarness(responses: {
  update?: AssignmentConfirmationResult;
  notification?: AssignmentConfirmationResult;
  request?: AssignmentConfirmationResult;
} = {}) {
  const calls: unknown[] = [];
  const messages: string[] = [];
  const success: AssignmentConfirmationResult = { error: null };
  const dependencies: AssignmentConfirmationWorkflowDependencies = {
    updateConfirmation: async (id, status) => {
      calls.push(["update", id, status]);
      return responses.update ?? success;
    },
    notifyAdministrator: async id => {
      calls.push(["notify", id]);
      return responses.notification ?? success;
    },
    createReplacementRequest: async payload => {
      calls.push(["request", payload]);
      return responses.request ?? success;
    },
    refresh: async () => { calls.push(["refresh"]); },
    setMessage: message => messages.push(message),
  };
  return { calls, messages, dependencies };
}

const baseInput = { scheduleId: "schedule-1", assignmentId: "assignment-1", servantId: "servant-1" };

Deno.test("confirmation saves before notifying and refreshes the schedule", async () => {
  const h = createHarness();
  await runAssignmentConfirmationWorkflow({ ...baseInput, status: "confirmed", hasPendingReplacement: false }, h.dependencies);
  assertEqual(h.calls, [["update", "assignment-1", "confirmed"], ["notify", "assignment-1"], ["refresh"]], "Confirmation must be saved before notification and refresh.");
  assertEqual(h.messages, ["Serving assignment confirmed. The administrator has been notified."], "Successful notification should be reported accurately.");
});

Deno.test("notification failure reports partial success and still refreshes", async () => {
  const h = createHarness({ notification: { error: { message: "Notification RPC unavailable." } } });
  await runAssignmentConfirmationWorkflow({ ...baseInput, status: "confirmed", hasPendingReplacement: false }, h.dependencies);
  assertEqual(h.calls, [["update", "assignment-1", "confirmed"], ["notify", "assignment-1"], ["refresh"]], "A notification failure must not undo confirmation or skip refresh.");
  assertEqual(h.messages, ["Serving assignment confirmed, but the administrator notification could not be sent: Notification RPC unavailable."], "Partial success must not claim the administrator was notified.");
});

Deno.test("confirmation update failure stops notification and refresh", async () => {
  const h = createHarness({ update: { error: { message: "Confirmation update rejected." } } });
  await runAssignmentConfirmationWorkflow({ ...baseInput, status: "confirmed", hasPendingReplacement: false }, h.dependencies);
  assertEqual(h.calls, [["update", "assignment-1", "confirmed"]], "No follow-up work should run when confirmation persistence fails.");
  assertEqual(h.messages, ["Confirmation update rejected."], "The original persistence error should be shown.");
});

Deno.test("decline saves before creating a replacement request and refreshes", async () => {
  const h = createHarness();
  await runAssignmentConfirmationWorkflow({ ...baseInput, status: "declined", reason: "Family commitment", hasPendingReplacement: false }, h.dependencies);
  assertEqual(h.calls, [
    ["update", "assignment-1", "declined"],
    ["request", { schedule_id: "schedule-1", assignment_id: "assignment-1", requester_servant_id: "servant-1", request_type: "replacement", details: "Family commitment", status: "pending" }],
    ["refresh"],
  ], "The decline must be saved before its replacement request is created.");
  assertEqual(h.messages, ["Assignment declined. A replacement request has been sent to the administrator."], "Successful replacement creation should be reported.");
});

Deno.test("blank decline reason uses the established default request details", async () => {
  const h = createHarness();
  await runAssignmentConfirmationWorkflow({ ...baseInput, status: "declined", reason: "  ", hasPendingReplacement: false }, h.dependencies);
  const requestCall = h.calls.find(call => Array.isArray(call) && call[0] === "request") as [string, ServingRequestInsertPayload] | undefined;
  assertEqual(requestCall?.[1]?.details, "Servant declined the assignment and requests a replacement.", "Blank reasons must retain the established default details.");
});

Deno.test("replacement request failure preserves saved decline and refreshes", async () => {
  const h = createHarness({ request: { error: { message: "Request insert denied." } } });
  await runAssignmentConfirmationWorkflow({ ...baseInput, status: "declined", reason: "Travel", hasPendingReplacement: false }, h.dependencies);
  assertEqual(h.calls.map(call => Array.isArray(call) ? call[0] : call), ["update", "request", "refresh"], "A failed follow-up request must not hide or reverse the saved decline.");
  assertEqual(h.messages, ["Decline saved, but replacement request could not be created: Request insert denied."], "The partial failure should be explicit.");
});

Deno.test("existing pending replacement is not duplicated", async () => {
  const h = createHarness();
  await runAssignmentConfirmationWorkflow({ ...baseInput, status: "declined", hasPendingReplacement: true }, h.dependencies);
  assertEqual(h.calls, [["update", "assignment-1", "declined"], ["refresh"]], "An existing pending replacement request must not be duplicated.");
  assertEqual(h.messages, ["Assignment declined. An existing replacement request is already pending with the administrator."], "The existing request state should be communicated accurately.");
});
