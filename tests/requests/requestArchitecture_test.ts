/// <reference lib="deno.ns" />

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function readRepoFile(path: string): Promise<string> {
  return Deno.readTextFile(new URL("../../" + path, import.meta.url));
}

Deno.test("Requests workflow orchestration is owned by its feature hook", async () => {
  const [app, actions, persistence, swapValidation, panel] = await Promise.all([
    readRepoFile("src/App.tsx"),
    readRepoFile("src/features/requests/hooks/useRequestActions.ts"),
    readRepoFile("src/features/requests/services/requestPersistence.ts"),
    readRepoFile("src/features/requests/services/swapValidation.ts"),
    readRepoFile("src/features/requests/components/RequestsPanel.tsx"),
  ]);

  assert(app.includes('import { useRequestActions } from "./features/requests/hooks/useRequestActions";'),
    "App must compose the Requests-owned action hook.");
  assert(app.includes("const requestActions = useRequestActions({"),
    "App must supply shared session, dialog, data, and UI state dependencies.");

  const handlers = ["submitServingRequest", "submitDirectSwap", "markRequestRead", "reviewRequest", "resolveReplacement"];
  for (const handler of handlers) {
    assert(!app.includes("async function " + handler + "("), "App must not retain the Requests workflow handler " + handler + ".");
    assert(actions.includes("async function " + handler + "("), "The Requests action hook must own " + handler + ".");
  }

  assert(!actions.includes("client.from(") && !actions.includes("client.rpc("), "Requests workflow orchestration must delegate database operations to Requests services.");
  for (const operation of ["createServingRequest", "executeServingRequestSwap", "markServingRequestRead", "updateServingRequestReview", "resolveServingRequestReplacement"]) {
    assert(actions.includes(operation), "The Requests hook must delegate " + operation + " to the persistence boundary.");
  }
  assert(swapValidation.includes("findCrossLocationAssignmentConflict"), "Swap revalidation must remain in the Requests validation service.");

  assert(panel.includes("onReview(request, true)") && panel.includes("Approve swap"),
    "Administrators must be able to approve valid swap requests from the Requests panel.");
  assert(panel.includes("target_schedule_id") && panel.includes("target_assignment_id") &&
    panel.includes("target_servant_id") && panel.includes("Proposed swap target"),
    "The Requests panel must show the proposed target service and assignment before approval.");
  assert(panel.includes("disabled={!targetIsReviewable}"),
    "Swap approval must be disabled when the source or target assignment is no longer reviewable.");
  assert(persistence.includes('from("serving_requests")') && persistence.includes("admin_execute_servant_swap") && persistence.includes("admin_resolve_replacement"),
    "Request inserts, review writes, and guarded admin RPCs must remain in the Requests persistence service.");

  const forbiddenFeatureImports = ["features/availability/", "features/notifications/", "features/auth/", "features/statistics/", "features/audit/", "features/servants/", "features/schedule/"];
  for (const [path, source] of [["Requests action hook", actions], ["Requests persistence", persistence], ["Requests swap validation", swapValidation]] as const) {
    for (const forbidden of forbiddenFeatureImports) {
      assert(!source.includes(forbidden), path + " must not import another feature's implementation: " + forbidden);
    }
    assert(!source.includes('/App"') && !source.includes("/App'"), path + " must not depend on the App composition root.");
  }
});

Deno.test("Assignment confirmation coordination is owned by the application boundary", async () => {
  const [app, hook, workflow] = await Promise.all([
    readRepoFile("src/App.tsx"),
    readRepoFile("src/app/hooks/useAssignmentConfirmationActions.ts"),
    readRepoFile("src/app/services/assignmentConfirmation.ts"),
  ]);
  assert(app.includes('import { useAssignmentConfirmationActions } from "./app/hooks/useAssignmentConfirmationActions";'),
    "App must compose the application-owned assignment confirmation hook.");
  assert(app.includes("onConfirmAssignment={assignmentConfirmationActions.confirmAssignment}"),
    "Schedule workspace must receive confirmation actions from the application hook.");
  assert(!app.includes("async function confirmAssignment(") && !app.includes("updateAssignmentConfirmation(") &&
    !app.includes("notifyAdminAssignmentConfirmation(") && !app.includes("createServingRequest(supabase"),
    "App must not orchestrate cross-feature assignment persistence.");
  assert(hook.includes("runAssignmentConfirmationWorkflow") && hook.includes("updateAssignmentConfirmation") &&
    hook.includes("notifyAdminAssignmentConfirmation") && hook.includes("createServingRequest"),
    "The application hook must coordinate the existing Schedule and Requests persistence services.");
  assert(workflow.includes("Decline saved, but replacement request could not be created") &&
    workflow.includes("notification could not be sent"),
    "The workflow must report partial failures accurately.");
});
