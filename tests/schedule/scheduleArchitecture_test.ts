/// <reference lib="deno.ns" />

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("Schedule feature owns its workspace, actions, and presentation modules", async () => {
  const paths = [
    "src/features/schedule/hooks/useScheduleWorkspace.ts",
    "src/features/schedule/hooks/useScheduleActions.ts",
    "src/features/schedule/components/ScheduleWorkspace.tsx",
    "src/features/schedule/components/ScheduleManagementPanels.tsx",
    "src/features/schedule/components/ScheduleDisplayComponents.tsx",
    "src/features/schedule/components/ScheduleDialogs.tsx",
    "src/features/schedule/services/schedulePersistence.ts",
    "src/features/schedule/services/scheduleData.ts",
    "src/features/schedule/services/scheduleCsv.ts",
    "src/features/schedule/services/scheduleExport.ts",
    "src/features/schedule/hooks/useScheduleExportActions.ts",
  ];
  const sources = await Promise.all(paths.map(path =>
    Deno.readTextFile(new URL("../../" + path, import.meta.url))
  ));
  for (let index = 0; index < paths.length; index++) {
    assert(!/from\s+["'][^"']*features\/(availability|requests|notifications|auth|statistics|audit|servants)\//.test(sources[index]),
      paths[index] + " must not import implementation details from another feature.");
    assert(!/from\s+["'][^"']*\/App["']/.test(sources[index]),
      paths[index] + " must not depend on the App composition root.");
  }

  assert(sources[3].includes("const listedUpcoming = upcoming.slice(0, visibleLimit);") &&
    sources[3].includes("setSelected(listedUpcoming.map(s=>s.id))") &&
    sources[3].includes("const services=listedUpcoming.filter(s=>s.location_id===group.id)") &&
    sources[3].includes("current+60") &&
    sources[3].includes("Showing {listedUpcoming.length} of {upcoming.length} upcoming services."),
    "Bulk Assignment Center must expose incremental pagination and keep row selection aligned with the visible service set.");
  assert(sources[6].includes("admin_publish_schedules_grouped") && sources[6].includes("admin_bulk_assignments_grouped"),
    "Schedule persistence must keep the existing admin publication and bulk-assignment RPC contracts.");
  assert(sources[1].includes("validateScheduleAssignment") && sources[1].includes("highWorkload"),
    "Schedule actions must retain assignment validation and workload safeguards.");
  assert(!/client\.(?:rpc|from)\(/.test(sources[1]),
    "Schedule action orchestration must delegate persistence to Schedule-owned services.");
  
  const [app, dashboard, dashboardLoader] = await Promise.all([
    Deno.readTextFile(new URL("../../src/App.tsx", import.meta.url)),
    Deno.readTextFile(new URL("../../src/app/services/dashboardData.ts", import.meta.url)),
    Deno.readTextFile(new URL("../../src/app/hooks/useDashboardLoader.ts", import.meta.url)),
  ]);
  assert(app.includes('from "./app/hooks/useDashboardLoader"') &&
    dashboardLoader.includes('from "../services/dashboardData"'),
    "App must compose dashboard data through its application-owned loading boundary.");
  assert(dashboard.includes("loadScheduleWorkspaceData"),
    "The app-owned dashboard service must compose the Schedule-owned dashboard data service.");
  assert(!app.includes("supabase.from(") && !app.includes("supabase.rpc("),
    "App must not issue direct database reads or RPC calls outside feature-owned services.");

  const exportHook = await Deno.readTextFile(new URL("../../src/features/schedule/hooks/useScheduleExportActions.ts", import.meta.url));
  const exportService = await Deno.readTextFile(new URL("../../src/features/schedule/services/scheduleExport.ts", import.meta.url));
  assert(app.includes('from "./features/schedule/hooks/useScheduleExportActions"'),
    "App must compose Schedule downloads through the Schedule feature hook.");
  assert(!app.includes("async function exportScheduleHistory(") && !app.includes("function exportCsv("),
    "Schedule CSV download orchestration must not remain in App.");
  assert(app.includes("onExportCsv={scheduleExportActions.exportCsv}") &&
    app.includes("onExportScheduleHistory={scheduleExportActions.exportScheduleHistory}"),
    "ScheduleWorkspace must receive both exports through the feature hook.");
  assert(!/client\.(?:rpc|from)\(/.test(exportHook),
    "Schedule export orchestration must delegate historical data access to Schedule services.");
  assert(exportHook.includes("isAdmin") && exportHook.includes("prepareHistoricalScheduleCsv") &&
    exportHook.includes("downloadCsv") && exportHook.includes("setMessage(error.message)"),
    "Schedule export hook must retain admin protection, own browser downloads, and surface query errors through App feedback.");
  assert(exportService.includes("loadHistoricalScheduleData") && exportService.includes("buildScheduleCsv"),
    "Schedule export service must use the existing historical query and CSV builder.");
});

Deno.test("weekend-template Replace remains gated until its production rollout is approved", async () => {
  const [actions, persistence, panels] = await Promise.all([
    Deno.readTextFile(new URL("../../src/features/schedule/hooks/useScheduleActions.ts", import.meta.url)),
    Deno.readTextFile(new URL("../../src/features/schedule/services/schedulePersistence.ts", import.meta.url)),
    Deno.readTextFile(new URL("../../src/features/schedule/components/ScheduleManagementPanels.tsx", import.meta.url)),
  ]);

  assert(actions.includes('if(mode==="replace"){') &&
    actions.includes("temporarily disabled") &&
    actions.includes("servant reconfirmation"),
    "Schedule actions must refuse Replace until the database migration is approved for production.");
  assert(persistence.includes('if (mode === "replace")') &&
    persistence.includes("temporarily disabled") &&
    persistence.includes("replaceGeneratedSchedulesAtomically") &&
    persistence.includes("admin_replace_generated_weekend_schedules"),
    "Persistence must block direct-upsert Replace callers while retaining the dedicated atomic RPC adapter.");
  assert(panels.includes('<option value="replace" disabled>'),
    "The Replace option must remain disabled in the Schedule generation UI before rollout approval.");
});

Deno.test("Published calendar excludes drafts and explains empty published results", async () => {
  const [workspaceHook, workspaceUi] = await Promise.all([
    Deno.readTextFile(new URL("../../src/features/schedule/hooks/useScheduleWorkspace.ts", import.meta.url)),
    Deno.readTextFile(new URL("../../src/features/schedule/components/ScheduleWorkspace.tsx", import.meta.url)),
  ]);
  assert(workspaceHook.includes("schedule.status === \"published\""),
    "The schedule calendar must contain published services only, including for administrators.");
  assert(!workspaceHook.includes("(isAdmin || schedule.status === \"published\")"),
    "Administrator calendar access must not reintroduce unpublished drafts.");
  assert(workspaceUi.includes("No published schedules match these filters.") &&
    workspaceUi.includes("Draft and unpublished schedules remain available in Assignment management."),
    "An empty published calendar must explain where draft schedules remain available.");
});

Deno.test("Bulk assignment review explains empty selection and church-wide deletion instructions apply to every scope", async () => {
  const [panels, actions] = await Promise.all([
    Deno.readTextFile(new URL("../../src/features/schedule/components/ScheduleManagementPanels.tsx", import.meta.url)),
    Deno.readTextFile(new URL("../../src/features/schedule/hooks/useScheduleActions.ts", import.meta.url)),
  ]);
  assert(panels.includes('const [selectionError,setSelectionError]=useState("");') &&
    panels.includes("Select at least one service before reviewing assignments.") &&
    panels.includes('disabled={disabled} onClick={()=>{if(!selected.length)'),
    "Review assignments must remain actionable when empty and show an explicit selection message.");
  assert(panels.includes("Permanent deletion for one church or all churches requires typing") &&
    !panels.includes("{allChurches&&<small className=\"church-bulk-safety-note\""),
    "The deletion safety instruction must be visible for both single-church and all-church deletion.");
  assert(actions.includes("To change a service's publication status, use its Publish/Unpublish action."),
    "A no-op bulk assignment save must clarify that publication status is managed separately.");
});
