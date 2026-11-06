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
    { component: "src/features/availability/components/AvailabilityWorkspace.tsx", stylesheet: "src/features/availability/components/AvailabilityWorkspace.css", importLine: 'import "./AvailabilityWorkspace.css";', marker: ".availability-form-panel" },
    { component: "src/features/schedule/components/ScheduleWorkspace.tsx", stylesheet: "src/features/schedule/components/ScheduleWorkspace.css", importLine: 'import "./ScheduleWorkspace.css";', marker: ".schedule-grid" },
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
  assert(!globalCss.includes(".schedule-grid{"), "Schedule workspace base presentation must be owned by its colocated stylesheet.");
  assert(!globalCss.includes(".availability-form-panel{"), "Availability workspace base presentation must be owned by its colocated stylesheet.");
});


Deno.test("semantic theme tokens cover both schemes and retain legacy aliases", async () => {
  const tokensCss = await readRepoFile("src/styles/tokens.css");
  const light = tokensCss.match(/:root\s*\{([^}]*)\}/)?.[1] ?? "";
  const dark = tokensCss.match(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/)?.[1] ?? "";
  assert(light.length > 0, "Light semantic theme tokens must be defined on :root.");
  assert(dark.length > 0, "Dark semantic theme tokens must be defined on the data-theme root.");

  const semanticTokens = [
    "page-bg", "surface", "surface-muted", "surface-raised", "surface-contrast",
    "text-primary", "text-secondary", "text-subtle",
    "border-subtle", "border-strong",
    "accent-primary", "accent-hover", "accent-soft",
    "focus-border", "focus-ring",
    "status-success-text", "status-success-bg",
    "status-warning-text", "status-warning-bg",
    "status-danger-text", "status-danger-bg",
    "status-info-text", "status-info-bg",
    "overlay-scrim",
  ];
  for (const token of semanticTokens) {
    assert(new RegExp("--" + token + "\\s*:").test(light), "Light theme is missing --" + token + ".");
    assert(new RegExp("--" + token + "\\s*:").test(dark), "Dark theme is missing --" + token + ".");
  }

  const aliases = [
    ["ink", "text-primary"],
    ["muted", "text-secondary"],
    ["line", "border-subtle"],
    ["brand", "accent-primary"],
    ["navy", "surface-contrast"],
    ["card", "surface"],
  ] as const;
  for (const [alias, semantic] of aliases) {
    const expected = new RegExp("--" + alias + "\\s*:\\s*var\\(--" + semantic + "\\)");
    assert(expected.test(light), "Light theme must retain --" + alias + " as an alias for --" + semantic + ".");
    assert(expected.test(dark), "Dark theme must retain --" + alias + " as an alias for --" + semantic + ".");
  }
});

Deno.test("Availability owns its component rules while mixed dark-mode overrides stay global", async () => {
  const [globalCss, availabilityCss] = await Promise.all([
    readRepoFile("src/style.css"),
    readRepoFile("src/features/availability/components/AvailabilityWorkspace.css"),
  ]);

  for (const selector of [
    ".availability-form-panel",
    ".availability-form",
    ".availability-filter",
    ".availability-row",
    ".availability-status",
    ".availability-mode-switch",
    ".availability-self-name",
  ]) {
    const escaped = selector.split(".").join("\\.");
    const pattern = new RegExp("(^|[\\n}])\\s*" + escaped + "\\s*\\{");
    assert(!pattern.test(globalCss), selector + " must no longer have a bare global rule.");
  }

  assert(availabilityCss.includes(".availability-form-panel{"), "Availability's workspace card styles must live with the component.");
  assert(availabilityCss.includes("@media(max-width:1050px)"), "The existing tablet form breakpoint must be preserved.");
  assert(availabilityCss.includes("@media(max-width:760px)"), "The existing mobile form breakpoint must be preserved.");
  assert(availabilityCss.includes("@media(max-width:600px)"), "The existing filter breakpoint must be preserved.");
  assert(!availabilityCss.includes(':root[data-theme="dark"]'), "Dark-mode overrides remain global until the shared cascade is decomposed.");

  assert(globalCss.includes(':root[data-theme="dark"] .availability-status.available'), "Availability status dark-mode overrides must remain global.");
  assert(globalCss.includes(':root[data-theme="dark"] .availability-filter .clear-btn'), "Availability filter dark-mode overrides must remain global.");
  assert(/:root\[data-theme="dark"\][^{]*\.availability-form input[^{]*\{/.test(globalCss), "Mixed dark-mode form-control overrides must remain global.");
});

Deno.test("app theme persistence and document theme-color behavior remain in the app shell", async () => {
  const app = await readRepoFile("src/App.tsx");
  assert(app.includes('window.localStorage.getItem("gms-sound-theme")'), "The saved theme preference must still be restored from localStorage.");
  assert(app.includes('window.localStorage.setItem("gms-sound-theme",theme)'), "The selected theme must still persist to localStorage.");
  assert(app.includes("document.documentElement.dataset.theme=theme"), "The document root must still receive the active data-theme value.");
  assert(app.includes('themeColor?.setAttribute("content",theme==="dark"?"#101727":"#171d35")'), "The browser theme color must still track the selected theme.");
  assert(app.includes("theme={theme}"), "The active theme must still be passed into the app shell.");
});


Deno.test("global stylesheet loads before feature-owned stylesheets", async () => {
  const entry = await readRepoFile("src/main.tsx");
  const globalCssImport = entry.indexOf('import "./style.css";');
  const appImport = entry.indexOf('import App from "./App";');
  assert(globalCssImport >= 0, "The application entry must import the global stylesheet.");
  assert(appImport >= 0, "The application entry must import App.");
  assert(globalCssImport < appImport, "Global CSS must load before App and its feature-owned stylesheets.");
});

Deno.test("Schedule owns its layout and responsive presentation while dark-mode overrides stay global", async () => {
  const [globalCss, scheduleCss] = await Promise.all([
    readRepoFile("src/style.css"),
    readRepoFile("src/features/schedule/components/ScheduleWorkspace.css"),
  ]);

  for (const selector of [
    ".schedule-grid",
    ".schedule-card",
    ".daily-overview",
    ".daily-card",
    ".assignment-overview-card",
    ".bulk-assignment-center",
    ".generate-panel",
    ".template-picker",
    ".my-upcoming-panel",
    ".swap-modal",
  ]) {
    const escaped = selector.split(".").join("\\.");
    const pattern = new RegExp("(^|[\\n}])\\s*" + escaped + "\\s*\\{");
    assert(!pattern.test(globalCss), selector + " base presentation must be owned by ScheduleWorkspace.css.");
  }

  assert(scheduleCss.includes(".schedule-grid{"), "Schedule grid styles must live with the Schedule feature.");
  assert(scheduleCss.includes(".assignment-overview-card{"), "Assignment overview styles must live with the Schedule feature.");
  assert(scheduleCss.includes(".bulk-assignment-center{"), "Bulk assignment styles must live with the Schedule feature.");
  assert(scheduleCss.includes("@media(max-width:1100px)"), "The existing desktop/tablet Schedule breakpoint must be preserved.");
  assert(scheduleCss.includes("@media(max-width:760px)"), "The existing mobile Schedule breakpoint must be preserved.");
  assert(scheduleCss.includes("@media(max-width:430px)"), "The existing compact-phone Schedule breakpoint must be preserved.");
  assert(!scheduleCss.includes(':root[data-theme="dark"]'), "Shared and feature-specific dark-mode overrides remain global in this batch.");

  assert(globalCss.includes(':root[data-theme="dark"] .schedule-workspace-tabs'), "Schedule tab dark-mode overrides must remain global.");
  assert(globalCss.includes(':root[data-theme="dark"] .daily-location-name'), "Schedule summary dark-mode overrides must remain global.");
  assert(globalCss.includes(':root[data-theme="dark"] .bulk-assignment-center'), "Bulk assignment dark-mode overrides must remain global.");
});


Deno.test("dark recurring-generation guidance has readable semantic contrast", async () => {
  const globalCss = await readRepoFile("src/style.css");
  assert(globalCss.includes(':root[data-theme="dark"] .generate-panel .generate-note-title'), "The document dark theme must explicitly style the generation guidance title.");
  assert(globalCss.includes("color: var(--text-primary) !important;"), "The generation guidance title must use the dark theme's primary text token.");
  assert(globalCss.includes(':root[data-theme="dark"] .generate-panel .generate-note p span'), "Generation guidance descriptions must use a dark-theme secondary text rule.");
});

Deno.test("signup form remains scroll-contained in dark mode and authentication screens omit church marks", async () => {
  const authCss = await readRepoFile("src/features/auth/components/AuthScreens.css");
  assert(/\.auth-card form\.auth-registration\s*\{[^}]*overflow-y:\s*auto\s*!important/s.test(authCss), "The registration form must own a vertical scroll region.");
  assert(/:root\[data-theme="dark"\] \.auth-card form\.auth-registration\s*\{[^}]*overflow-y:\s*auto\s*!important/s.test(authCss), "Dark mode must not override registration scrolling with overflow: visible.");
  assert(authCss.includes("max-height:min(64dvh, 560px)"), "Small-screen registration scrolling must use the dynamic viewport height.");

  for (const path of [
    "src/features/auth/components/AuthScreen.tsx",
    "src/features/auth/components/PasswordRecoveryScreen.tsx",
    "src/features/auth/components/SupabaseSetupScreen.tsx",
  ]) {
    const source = await readRepoFile(path);
    assert(!source.includes("brand-mark"), path + " must not render the church brand mark.");
    assert(!source.includes("Church"), path + " must not import or render the church icon.");
  }
});


Deno.test("C3 status, focus, border and muted-surface colors use semantic tokens", async () => {
  const [globalCss, availabilityCss, scheduleCss, tokensCss] = await Promise.all([
    readRepoFile("src/style.css"),
    readRepoFile("src/features/availability/components/AvailabilityWorkspace.css"),
    readRepoFile("src/features/schedule/components/ScheduleWorkspace.css"),
    readRepoFile("src/styles/tokens.css"),
  ]);

  for (const token of [
    "text-subtle", "border-strong", "surface-muted", "focus-border", "focus-ring",
    "status-success-text", "status-success-bg",
    "status-warning-text", "status-warning-bg",
    "status-danger-text", "status-danger-bg",
  ]) {
    assert(tokensCss.includes("--" + token + ":"), "The semantic token --" + token + " must remain defined.");
  }

  assert(globalCss.includes("color:var(--text-subtle)"), "Shared form labels and secondary headings must use the subtle-text token.");
  assert(globalCss.includes("border:1px solid var(--border-strong)"), "Shared form controls must use the strong-border token.");
  assert(globalCss.includes("border-color:var(--focus-border)"), "Shared form focus states must use the focus-border token.");
  assert(globalCss.includes("box-shadow:0 0 0 3px var(--focus-ring)"), "Shared form focus states must use the focus-ring token.");
  assert(globalCss.includes("background:var(--status-success-bg);color:var(--status-success-text)"), "Positive status chips must use semantic success tokens.");
  assert(globalCss.includes("background:var(--status-danger-bg);color:var(--status-danger-text)"), "Declined status chips must use semantic danger tokens.");
  assert(globalCss.includes("background:var(--status-warning-bg);color:var(--status-warning-text)"), "Dark warning states must use semantic warning tokens.");

  assert(availabilityCss.includes(".availability-status.available{color:var(--status-success-text);background:var(--status-success-bg)}"), "Availability success state must use semantic success tokens.");
  assert(availabilityCss.includes(".availability-status.unavailable{color:var(--status-danger-text);background:var(--status-danger-bg)}"), "Availability unavailable state must use semantic danger tokens.");
  assert(availabilityCss.includes("background:var(--surface-muted)"), "Availability muted controls must use the muted-surface token.");

  assert(scheduleCss.includes(".coverage-pill.complete{color:var(--status-success-text);background:var(--status-success-bg)}"), "Schedule coverage success state must use semantic success tokens.");
  assert(scheduleCss.includes("color: var(--status-success-text);"), "Clear assignment feedback must use the semantic success-text token.");
  assert(scheduleCss.includes("border-color:var(--focus-border)"), "Schedule focus states must use the focus-border token.");
  assert(scheduleCss.includes("background:var(--surface-muted)"), "Schedule muted panels must use the muted-surface token.");

  assertBalancedCss(globalCss, "src/style.css");
  assertBalancedCss(availabilityCss, "AvailabilityWorkspace.css");
  assertBalancedCss(scheduleCss, "ScheduleWorkspace.css");
});
