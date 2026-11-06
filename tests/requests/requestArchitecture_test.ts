/// <reference lib="deno.ns" />

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function readRepoFile(path: string): Promise<string> {
  return Deno.readTextFile(new URL("../../" + path, import.meta.url));
}

Deno.test("Requests workflow orchestration is owned by its feature hook", async () => {
  const [app, actions, persistence, swapValidation] = await Promise.all([
    readRepoFile("src/App.tsx"),
    readRepoFile("src/features/requests/hooks/useRequestActions.ts"),
    readRepoFile("src/features/requests/services/requestPersistence.ts"),
    readRepoFile("src/features/requests/services/swapValidation.ts"),
  ]);

  assert(app.includes('import { useRequestActions } from "./features/requests/hooks/useRequestActions";'),
    "App must compose the Requests-owned action hook.");
  assert(app.includes("const requestActions = useRequestActions({"),
    "App must supply shared session, dialog, data, and UI state dependencies.");
  for (const handler of [
    "submitServingRequest",
    "submitDirectSwap",
    "markRequestRead",
    "reviewRequest",
    "resolveReplacement",
  ]) {
    assert(!new RegExp("async function " + handler + "\\s*\\(").test(app),
      "App must not retain the Requests workflow handler " + handler + ".");
    assert(actions.includes("function " + handler + "("),
      "The Requests action hook must own " + handler + ".");
  }

  assert(!/client\\.(?:rpc|from)\\(/.test(actions),
    "Requests workflow orchestration must delegate database operations to Requests services.");
  assert(actions.includes("executeServingRequestSwap") && actions.includes("updateServingRequestReview") &&
    actions.includes("resolveServingRequestReplacement") && actions.includes("markServingRequestRead") &&
    actions.includes("createServingRequest"),
    "The Requests hook must delegate each operation to the Requests persistence boundary.");
  assert(swapValidation.includes("findCrossLocationAssignmentConflict"),
    "Swap revalidation must remain in the Requests validation service.");
  assert(persistence.includes('from("serving_requests")') && persistence.includes('admin_execute_servant_swap') &&
    persistence.includes('admin_resolve_replacement'),
    "Request inserts, review writes, and guarded admin RPCs must remain in the Requests persistence service.");

  for (const [path, source] of [
    ["Requests action hook", actions],
    ["Requests persistence", persistence],
    ["Requests swap validation", swapValidation],
  ] as const) {
    assert(!/from\\s+["'][^"']*features\\/(availability|notifications|auth|statistics|audit|servants|schedule)\\//.test(source),
      path + " must not import another feature's implementation.");
    assert(!/from\\s+["'][^"']*\\/App["']/.test(source),
      path + " must not depend on the App composition root.");
  }
});

Deno.test("Requests workflow hook leaves assignment confirmation and replacement creation composed by App", async () => {
  const app = await readRepoFile("src/App.tsx");
  assert(app.includes("async function confirmAssignment("),
    "Cross-feature assignment confirmation orchestration must remain in App.");
  assert(app.includes("updateAssignmentConfirmation(supabase,assignment.id,\"declined\")") &&
    app.includes("createServingRequest(supabase,{schedule_id:schedule.id"),
    "Assignment decline must continue to persist confirmation before creating its replacement request.");
});
