/// <reference lib="deno.ns" />

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function readRepoFile(path: string): Promise<string> {
  return Deno.readTextFile(new URL("../../" + path, import.meta.url));
}

Deno.test("Servant management workflows are owned by the Servants feature hook", async () => {
  const [app, actions, persistence, panel, addDialog] = await Promise.all([
    readRepoFile("src/App.tsx"),
    readRepoFile("src/features/servants/hooks/useServantActions.ts"),
    readRepoFile("src/features/servants/services/servantManagement.ts"),
    readRepoFile("src/features/servants/components/ServantInformationPanel.tsx"),
    readRepoFile("src/features/servants/components/AddServantDialog.tsx"),
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
  assert(app.includes('import AddServantDialog from "./features/servants/components/AddServantDialog";') &&
    app.includes("<AddServantDialog onClose={()=>setModal(null)} onSave={servantActions.savePerson}/>"),
    "App must compose the Add Servant dialog from the Servants feature.");
  assert(!app.includes("function PersonModal(") && !app.includes("function PeoplePanel("),
    "Servants presentation components must not remain embedded in App.");
  assert(addDialog.includes("onSave") && addDialog.includes("onClose") &&
    addDialog.includes("name=\"full_name\""),
    "The Servants-owned dialog must retain its existing form and callbacks.");


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
  const [app, dashboard, dashboardLoader] = await Promise.all([
    readRepoFile("src/App.tsx"),
    readRepoFile("src/app/services/dashboardData.ts"),
    readRepoFile("src/app/hooks/useDashboardLoader.ts"),
  ]);
  assert(app.includes('from "./app/hooks/useDashboardLoader"') &&
    dashboardLoader.includes('from "../services/dashboardData"'),
    "App must compose servant records through the shared dashboard loading boundary.");
  assert(dashboard.includes("loadServantRecords") && dashboard.includes("loadServantDirectoryData"),
    "Required servant rows and optional account directory reads must remain composed in app dashboard loading.");
  assert(app.includes('from "./app/hooks/useAssignmentConfirmationActions"') &&
    app.includes("const assignmentConfirmationActions = useAssignmentConfirmationActions({"),
    "Cross-feature assignment confirmation must remain composed through the application-owned workflow.");
});
