/// <reference lib="deno.ns" />

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function readRepoFile(path: string): Promise<string> {
  return Deno.readTextFile(new URL("../../" + path, import.meta.url));
}

Deno.test("Statistics feature owns presentation and pure calculation", async () => {
  const [app, panel, service, stylesheet] = await Promise.all([
    readRepoFile("src/App.tsx"),
    readRepoFile("src/features/statistics/components/StatisticsPanel.tsx"),
    readRepoFile("src/features/statistics/services/servingStatistics.ts"),
    readRepoFile("src/features/statistics/components/StatisticsPanel.css"),
  ]);

  assert(app.includes('import StatisticsPanel from "./features/statistics/components/StatisticsPanel";'),
    "App must compose Statistics through its feature-owned panel.");
  assert(app.includes("const statisticsSchedules = useMemo(") &&
    app.includes('schedule.status === "published" && schedule.service_date >= today()') &&
    app.includes('<StatisticsPanel schedules={statisticsSchedules} servants={servants}/>') &&
    !app.includes('<StatisticsPanel schedules={scheduleWorkspace.filtered}'),
    "Statistics must receive all upcoming published schedules independently of Schedule-page filters.");
  assert(panel.includes("Schedule-page filters do not affect these figures.") &&
    panel.includes("Workload comparison across upcoming published schedules."),
    "Statistics must clearly explain its independent upcoming-published dataset.");
  assert(!app.includes("calculateServingStatistics"),
    "Statistics calculations must not be duplicated in the App composition root.");

  assert(panel.includes('import "./StatisticsPanel.css";'),
    "Statistics presentation must import its feature-owned stylesheet.");
  assert(panel.includes("calculateServingStatistics(schedules, servants)"),
    "Statistics presentation must delegate calculations to its feature-owned service.");
  assert(!/\b(?:client|supabase)\.(?:from|rpc)\(/.test(panel),
    "Statistics presentation must not issue database queries or RPC calls.");
  assert(!/\b(?:client|supabase)\.(?:from|rpc)\(/.test(service),
    "Statistics calculations must remain a pure data transformation.");

  assert(service.includes('from "../../../types"'),
    "Statistics must consume shared application types rather than duplicate domain models.");
  assert(!/from\s+["'][^"']*features\//.test(service),
    "Statistics calculations must not depend on another feature's implementation.");
  for (const [path, source] of [
    ["Statistics panel", panel],
    ["Statistics calculation service", service],
  ] as const) {
    assert(!/from\s+["'][^"']*\/App["']/.test(source),
      path + " must not depend on the App composition root.");
    assert(!/from\s+["'][^"']*features\/(availability|requests|notifications|auth|audit|servants|schedule)\//.test(source),
      path + " must not import another feature's implementation.");
  }

  assert(stylesheet.includes(".stats-grid"),
    "StatisticsPanel.css must contain the feature-owned statistics presentation.");
});

Deno.test("Statistics servant breakdown and fairness are scoped to servants assigned in the Statistics dataset", async () => {
  const service = await readRepoFile("src/features/statistics/services/servingStatistics.ts");
  const panel = await readRepoFile("src/features/statistics/components/StatisticsPanel.tsx");
  assert(service.includes('servant.active && (counts.get(servant.id)?.total ?? 0) > 0'),
    "Servant rows must exclude active servants who have no assignments in the Statistics dataset.");
  assert(service.includes('activeServants - rows.filter(row => row.total > 0).length'),
    "The not-scheduled metric must still compare the Statistics dataset with the full active servant directory.");
  assert(service.includes('const highestWorkload = rows[0]?.total ?? 0') &&
    service.includes('Math.min(...rows.map(row => row.total))'),
    "Fairness metrics must compare only the assigned servants in the Statistics dataset.");
  assert(panel.includes("No servants are assigned to upcoming published schedules.") &&
    panel.includes("No assignments are present in upcoming published schedules."),
    "Statistics must explain when the selected filters return no assignment data.");
});
