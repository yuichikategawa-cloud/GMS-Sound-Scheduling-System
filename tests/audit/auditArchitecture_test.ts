/// <reference lib="deno.ns" />

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function readRepoFile(path: string): Promise<string> {
  return Deno.readTextFile(new URL("../../" + path, import.meta.url));
}

Deno.test("Audit export workflow is owned by the Audit feature hook", async () => {
  const [app, actions, service, panel] = await Promise.all([
    readRepoFile("src/App.tsx"),
    readRepoFile("src/features/audit/hooks/useAuditActions.ts"),
    readRepoFile("src/features/audit/services/auditData.ts"),
    readRepoFile("src/features/audit/components/AuditPanel.tsx"),
  ]);

  assert(app.includes('import { useAuditActions } from "./features/audit/hooks/useAuditActions";'),
    "App must compose the Audit-owned action hook.");
  assert(app.includes("const auditActions = useAuditActions({"),
    "App must supply authorization and shared feedback state to Audit.");
  assert(!app.includes("async function exportAuditHistory("),
    "Historical audit export orchestration must not remain in App.");
  assert(app.includes("onDownload={auditActions.exportAuditHistory}"),
    "AuditPanel must receive its download callback through app composition.");

  assert(actions.includes("prepareHistoricalAuditExport") &&
    actions.includes("isAdmin") &&
    actions.includes("createObjectURL") &&
    actions.includes("revokeObjectURL"),
    "Audit hook must own guarded export preparation and browser download lifecycle.");
  assert(!actions.includes("client.from(") && !actions.includes("client.rpc("),
    "Audit workflow orchestration must delegate data access to Audit services.");
  assert(service.includes("loadRecentAuditLogs") &&
    service.includes("loadHistoricalAuditLogs") &&
    service.includes("buildAuditCsv") &&
    service.includes("prepareHistoricalAuditExport"),
    "Audit data service must retain recent reads, paged history, and CSV preparation.");
  assert(panel.includes("onDownload") && !panel.includes("client.from("),
    "Audit panel must remain a presentation component with an injected download action.");

  for (const [path, source] of [
    ["Audit action hook", actions],
    ["Audit data service", service],
    ["Audit panel", panel],
  ] as const) {
    for (const forbidden of [
      "features/availability/",
      "features/requests/",
      "features/notifications/",
      "features/auth/",
      "features/statistics/",
      "features/servants/",
      "features/schedule/",
    ]) {
      assert(!source.includes(forbidden),
        path + " must not import another feature implementation: " + forbidden);
    }
    assert(!source.includes('/App"') && !source.includes("/App'"),
      path + " must not depend on the App composition root.");
  }
});
