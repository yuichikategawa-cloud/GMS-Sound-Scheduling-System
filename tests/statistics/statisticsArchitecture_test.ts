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
  assert(app.includes('<StatisticsPanel schedules={scheduleWorkspace.filtered} servants={servants}/>'),
    "App must pass the currently filtered schedules and shared servant records into Statistics.");
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
