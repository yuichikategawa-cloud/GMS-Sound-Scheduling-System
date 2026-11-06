/// <reference lib="deno.ns" />

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function readRepoFile(path: string): Promise<string> {
  return Deno.readTextFile(new URL("../../" + path, import.meta.url));
}

Deno.test("Servant management workflows are owned by the Servants feature hook", async () => {
  const [app, actions, persistence, panel] = await Promise.all([
    readRepoFile("src/App.tsx"),
    readRepoFile("src/features/servants/hooks/useServantActions.ts"),
    readRepoFile("src/features/servants/services/servantManagement.ts"),
    readRepoFile("src/features/servants/components/ServantInformationPanel.tsx"),
  ]);

  assert(app.includes('import { useServantActions } from "./features/servants/hooks/useServantActions";'),
    "App must compose Servants actions through its feature hook.");
  assert(app.includes("const servantActions = useServantActions({"),
    "App must supply shared loading, feedback, modal, and refresh dependencies.");

  for (const handler of ["linkServantAccount", "savePerson", "togglePerson"]) {
    assert(!app.includes("async function " + handler + "("),
      "App must not retain Servants workflow handler " + handler + ".");
    assert(actions.includes("async function " + handler + "("),
      "Servants hook must own " + handler + ".");
  }

  assert(!actions.includes("client.from(") && !actions.includes("client.rpc("),
    "Servants orchestration must delegate database work to Servants services.");
  for (const operation of [
    "linkServantAccountRecord",
    "createServantRecord",
    "setServantActive",
  ]) {
    assert(actions.includes(operation) && persistence.includes("function " + operation + "("),
      "Servants action hook must delegate " + operation + " to the persistence service.");
  }
  assert(actions.includes("if (!client || !isAdmin)"),
    "Every administrative Servants action must retain the existing client and admin guard.");
  assert(panel.includes("onToggle") && panel.includes("onLink") && panel.includes("onAdd"),
    "Servant information presentation must continue to receive its actions through callbacks.");

  for (const [path, source] of [
    ["Servants action hook", actions],
    ["Servants persistence", persistence],
    ["Servant information panel", panel],
  ] as const) {
    for (const forbidden of [
      "features/availability/",
      "features/requests/",
      "features/notifications/",
      "features/auth/",
      "features/statistics/",
      "features/audit/",
      "features/schedule/",
    ]) {
      assert(!source.includes(forbidden),
        path + " must not import another feature implementation: " + forbidden);
    }
    assert(!source.includes('/App"') && !source.includes("/App'"),
      path + " must not depend on the App composition root.");
  }
});

Deno.test("App retains shared Servants and cross-feature data loading", async () => {
  const app = await readRepoFile("src/App.tsx");
  assert(app.includes("loadServantRecords(supabase)"),
    "Required servant directory rows must remain part of App's shared dashboard load.");
  assert(app.includes("loadServantDirectoryData(supabase)"),
    "Optional account directory reads must remain composed with shared dashboard data.");
  assert(app.includes("async function confirmAssignment("),
    "Cross-feature assignment confirmation must remain in App.");
});
