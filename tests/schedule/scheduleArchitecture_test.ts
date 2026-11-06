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
  assert(sources[6].includes("admin_publish_schedules_grouped") && sources[6].includes("admin_bulk_assignments_grouped"),
    "Schedule persistence must keep the existing admin publication and bulk-assignment RPC contracts.");
  assert(sources[1].includes("validateScheduleAssignment") && sources[1].includes("highWorkload"),
    "Schedule actions must retain assignment validation and workload safeguards.");
  assert(!/client\.(?:rpc|from)\(/.test(sources[1]),
    "Schedule action orchestration must delegate persistence to Schedule-owned services.");
  
  const app = await Deno.readTextFile(new URL("../../src/App.tsx", import.meta.url));
  assert(app.includes('from "./features/schedule/services/scheduleData"'),
    "App must compose the Schedule-owned dashboard data service.");
  assert(!app.includes("supabase.from(") && !app.includes("supabase.rpc("),
    "App must not issue direct database reads or RPC calls outside feature-owned services.");
});
