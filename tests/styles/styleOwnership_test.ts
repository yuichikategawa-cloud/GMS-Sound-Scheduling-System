/// <reference lib="deno.ns" />

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function readRepoFile(path: string): Promise<string> {
  return await Deno.readTextFile(new URL("../../" + path, import.meta.url));
}

function assertBalancedCss(source: string, path: string): void {
  const opens = (source.match(/{/g) ?? []).length;
  const closes = (source.match(/}/g) ?? []).length;
  assert(opens === closes, path + " has unbalanced CSS blocks: " + opens + " opening vs " + closes + " closing braces.");
}

Deno.test("global entry stylesheet delegates tokens and document defaults", async () => {
  const [globalCss, tokensCss, baseCss] = await Promise.all([
    readRepoFile("src/style.css"),
    readRepoFile("src/styles/tokens.css"),
    readRepoFile("src/styles/base.css"),
  ]);

  assert(globalCss.includes('@import "./styles/tokens.css";'), "Global CSS must import design tokens.");
  assert(globalCss.includes('@import "./styles/base.css";'), "Global CSS must import document defaults.");
  assert(tokensCss.includes("--brand:"), "Design token stylesheet must own the shared brand token.");
  assert(baseCss.includes("box-sizing:border-box"), "Base stylesheet must own the global box-sizing reset.");
  assert(baseCss.includes("min-width:320px"), "Base stylesheet must own the document minimum-width rule.");
  assertBalancedCss(globalCss, "src/style.css");
  assertBalancedCss(tokensCss, "src/styles/tokens.css");
  assertBalancedCss(baseCss, "src/styles/base.css");
});

Deno.test("extracted presentation stylesheets are imported by their owning components", async () => {
  const ownership = [
    { component: "src/shared/components/GmsLoader.tsx", stylesheet: "src/shared/components/GmsLoader.css", importLine: 'import "./GmsLoader.css";', marker: ".gms-loader-screen" },
    { component: "src/features/audit/components/AuditPanel.tsx", stylesheet: "src/features/audit/components/AuditPanel.css", importLine: 'import "./AuditPanel.css";', marker: ".audit-row" },
    { component: "src/features/notifications/components/PushNotificationSettings.tsx", stylesheet: "src/features/notifications/components/PushNotificationSettings.css", importLine: 'import "./PushNotificationSettings.css";', marker: ".push-settings-card" },
    { component: "src/features/statistics/components/StatisticsPanel.tsx", stylesheet: "src/features/statistics/components/StatisticsPanel.css", importLine: 'import "./StatisticsPanel.css";', marker: ".stats-grid" },
    { component: "src/features/servants/components/ServantInformationPanel.tsx", stylesheet: "src/features/servants/components/ServantInformationPanel.css", importLine: 'import "./ServantInformationPanel.css";', marker: ".servant-info-page" },
    { component: "src/features/auth/components/AuthScreen.tsx", stylesheet: "src/features/auth/components/AuthScreens.css", importLine: 'import "./AuthScreens.css";', marker: ".auth-page" },
    { component: "src/features/auth/components/MemberProfilePanel.tsx", stylesheet: "src/features/auth/components/MemberProfilePanel.css", importLine: 'import "./MemberProfilePanel.css";', marker: ".profile-edit-grid" },
    { component: "src/app/components/AppLayout.tsx", stylesheet: "src/app/components/AppShell.css", importLine: 'import "./AppShell.css";', marker: ".app-shell" },
    { component: "src/features/requests/components/RequestsPanel.tsx", stylesheet: "src/features/requests/components/RequestsInbox.css", importLine: 'import "./RequestsInbox.css";', marker: ".requests-content-card" },
    { component: "src/features/requests/components/ServantInbox.tsx", stylesheet: "src/features/requests/components/RequestsInbox.css", importLine: 'import "./RequestsInbox.css";', marker: ".servant-inbox" },
  ] as const;

  for (const item of ownership) {
    const [component, stylesheet] = await Promise.all([
      readRepoFile(item.component),
      readRepoFile(item.stylesheet),
    ]);
    assert(component.includes(item.importLine), item.component + " must import " + item.stylesheet + ".");
    assert(stylesheet.includes(item.marker), item.stylesheet + " must contain its owned selector " + item.marker + ".");
    assertBalancedCss(stylesheet, item.stylesheet);
  }
});

Deno.test("app-shell and requests presentation no longer live as light-mode global rules", async () => {
  const globalCss = await readRepoFile("src/style.css");
  const movedSelectors = [
    ".app-shell",
    ".sidebar",
    ".main-area",
    ".topbar",
    ".mobile-bottom-nav",
    ".servant-inbox",
    ".requests-panel",
    ".request-row",
    ".inbox-item",
  ];

  for (const selector of movedSelectors) {
    const escaped = selector.split(".").join("\\.");
    const pattern = new RegExp("(^|[\\n}])\\s*" + escaped + "\\s*\\{");
    assert(!pattern.test(globalCss), selector + " must be owned by its colocated stylesheet, not a bare global rule.");
  }

  assert(globalCss.includes(':root[data-theme="dark"] .topbar'), "Cross-cutting app-shell dark-mode overrides must remain global and late in the cascade.");
  assert(globalCss.includes(':root[data-theme="dark"] .inbox-item'), "Cross-cutting Inbox dark-mode overrides must remain global and late in the cascade.");
  assert(globalCss.includes(".inbox-count{"), "The Inbox badge shared with app navigation must remain a global primitive.");
  assert(globalCss.includes(".schedule-grid{"), "App-composed Schedule workspace styles remain global pending the Schedule UI extraction.");
  assert(globalCss.includes(".availability-form-panel{"), "Availability workspace styles remain global pending a cascade-preserving feature stylesheet migration.");
});
