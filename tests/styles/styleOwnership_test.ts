/// <reference lib="deno.ns" />

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function readRepoFile(path: string): Promise<string> {
  return await Deno.readTextFile(new URL("../../" + path, import.meta.url));
}

async function readGlobalStyles(): Promise<string> {
  const [entry, shared, dark] = await Promise.all([
    readRepoFile("src/style.css"),
    readRepoFile("src/styles/shared-components.css"),
    readRepoFile("src/styles/dark-theme.css"),
  ]);
  return [entry, shared, dark].join("\n");
}

function assertBalancedCss(source: string, path: string): void {
  const opens = (source.match(/{/g) ?? []).length;
  const closes = (source.match(/}/g) ?? []).length;
  assert(opens === closes, path + " has unbalanced CSS blocks: " + opens + " opening vs " + closes + " closing braces.");
}

Deno.test("global entry stylesheet delegates tokens and document defaults", async () => {
  const [globalCss, tokensCss, baseCss] = await Promise.all([
    readGlobalStyles(),
    readRepoFile("src/styles/tokens.css"),
    readRepoFile("src/styles/base.css"),
  ]);

  assert(globalCss.includes('@import "./styles/tokens.css";'), "Global CSS must import design tokens.");
  assert(globalCss.includes('@import "./styles/base.css";'), "Global CSS must import document defaults.");
  assert(globalCss.includes('@import "./styles/shared-components.css";'), "Global CSS must import the shared component module.");
  assert(globalCss.includes('@import "./styles/dark-theme.css";'), "Global CSS must import the dark-theme module.");
  assert(tokensCss.includes("--brand:"), "Design token stylesheet must own the shared brand token.");
  assert(baseCss.includes("box-sizing:border-box"), "Base stylesheet must own the global box-sizing reset.");
  assert(baseCss.includes("min-width:320px"), "Base stylesheet must own the document minimum-width rule.");
  assertBalancedCss(globalCss, "src/style.css");
  assertBalancedCss(tokensCss, "src/styles/tokens.css");
  assertBalancedCss(baseCss, "src/styles/base.css");
});


Deno.test("global style entry composes shared and dark-theme modules in order", async () => {
  const [entryCss, sharedCss, darkCss] = await Promise.all([
    readRepoFile("src/style.css"),
    readRepoFile("src/styles/shared-components.css"),
    readRepoFile("src/styles/dark-theme.css"),
  ]);

  const imports = [
    '@import "./styles/tokens.css";',
    '@import "./styles/base.css";',
    '@import "./styles/shared-components.css";',
    '@import "./styles/dark-theme.css";',
  ];
  let previous = -1;
  for (const item of imports) {
    const index = entryCss.indexOf(item);
    assert(index > previous, "Global stylesheet imports must retain their dependency and cascade order.");
    previous = index;
  }

  assert(sharedCss.length > 20_000, "Shared presentation rules must be retained in their dedicated module.");
  assert(darkCss.startsWith("/* Dark mode — a persistent, selectable GMS appearance. */"), "Dark-theme overrides must begin at the extracted theme boundary.");
  assert(!sharedCss.includes(':root[data-theme="dark"]'), "Dark-theme overrides must not leak into the shared light/base module.");
  assertBalancedCss(entryCss, "src/style.css");
  assertBalancedCss(sharedCss, "src/styles/shared-components.css");
  assertBalancedCss(darkCss, "src/styles/dark-theme.css");
});


Deno.test("extracted presentation stylesheets are imported by their owning components", async () => {
  const ownership = [
    { component: "src/shared/components/GmsLoader.tsx", stylesheet: "src/shared/components/GmsLoader.css", importLine: 'import "./GmsLoader.css";', marker: ".gms-loader-screen" },
    { component: "src/shared/components/ActionDialog.tsx", stylesheet: "src/shared/components/ActionDialog.css", importLine: 'import "./ActionDialog.css";', marker: ".action-dialog" },
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


Deno.test("ActionDialog owns its base, responsive and dark-mode presentation", async () => {
  const [component, dialogCss, sharedCss, darkCss] = await Promise.all([
    readRepoFile("src/shared/components/ActionDialog.tsx"),
    readRepoFile("src/shared/components/ActionDialog.css"),
    readRepoFile("src/styles/shared-components.css"),
    readRepoFile("src/styles/dark-theme.css"),
  ]);

  assert(component.includes('import "./ActionDialog.css";'), "ActionDialog must import its colocated stylesheet.");
  assert(dialogCss.includes(".action-dialog-backdrop"), "ActionDialog must own its dialog backdrop layer.");
  assert(dialogCss.includes(".action-dialog-input input"), "ActionDialog must own its confirmation input.");
  assert(dialogCss.includes(':root[data-theme="dark"] .action-dialog'), "ActionDialog must own its dark surface styling.");
  assert(dialogCss.includes("@media(max-width:600px)") || dialogCss.includes("@media (max-width: 600px)"), "ActionDialog must retain its compact-screen layout.");
  assert(!sharedCss.includes(".action-dialog"), "Shared component CSS must not retain ActionDialog-specific selectors.");
  assert(!darkCss.includes(".action-dialog"), "Global dark-theme CSS must not retain ActionDialog-specific selectors.");
  assertBalancedCss(dialogCss, "ActionDialog.css");
});

Deno.test("app-shell and requests presentation no longer live as light-mode global rules", async () => {
  const globalCss = await readGlobalStyles();
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


  assert(!globalCss.includes(':root[data-theme="dark"] .inbox-item'), "Inbox feature dark-mode presentation must remain with RequestsInbox.css.");
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

Deno.test("Availability owns its component and dark-mode rules", async () => {
  const [globalCss, availabilityCss] = await Promise.all([
    readGlobalStyles(),
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
  assert(availabilityCss.includes(':root[data-theme="dark"] .availability-status.available'), "Availability must own its dark success status.");
  assert(availabilityCss.includes(':root[data-theme="dark"] .availability-filter .clear-btn'), "Availability must own its dark filter action.");
  assert(availabilityCss.includes(':root[data-theme="dark"] .availability-form input'), "Availability must own its dark form-control styling.");
  assert(availabilityCss.includes(':root[data-theme="dark"] .serving-preference-form'), "Availability must own its dark preference form styling.");
  const globalAvailabilityThemeRule = /:root\[data-theme="dark"\][^{]*\.(?:availability[\w-]*|recurring-rule-form|rule-inline|saved-rule-row|bulk-form-grid|bulk-servant-picker|bulk-availability-form|serving-preference-form|preference-weekday-picker|preference-service-picker)[^{]*\{/s;
  assert(!globalAvailabilityThemeRule.test(globalCss), "Global styles must not retain Availability-specific dark-theme selectors.");


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
    readGlobalStyles(),
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
  assert(scheduleCss.includes(':root[data-theme="dark"] .calendar-switch'), "Schedule must own its calendar grouping switch dark-mode surface.");
  assert(scheduleCss.includes(':root[data-theme="dark"] .calendar-switch button.selected'), "Schedule must own its selected calendar switch dark-mode state.");
  assert(scheduleCss.includes(':root[data-theme="dark"] .calendar-switch span'), "Schedule must own its calendar switch label contrast.");
  assert(!globalCss.includes(".calendar-switch"), "Global styles must not retain Schedule calendar switch selectors.");

  assert(scheduleCss.includes(':root[data-theme="dark"] .schedule-workspace-tabs'), "Schedule tabs must own their dark-mode presentation.");
  assert(scheduleCss.includes(".church-schedule-heading{"), "Church schedule heading base styling must live with the Schedule feature.");
  assert(scheduleCss.includes(".church-schedule-group{"), "Church schedule group base styling must live with the Schedule feature.");
  assert(!globalCss.includes(".church-schedule-heading{"), "Global styles must not retain the Schedule church heading base selector.");
  assert(!globalCss.includes(".church-schedule-group{"), "Global styles must not retain the Schedule church group base selector.");
  assert(scheduleCss.includes(':root[data-theme="dark"] .daily-location-name'), "Schedule daily location labels must use feature-owned dark styling.");
  assert(scheduleCss.includes(':root[data-theme="dark"] .daily-assignee-cell'), "Schedule daily assignment cells must use feature-owned dark styling.");
  assert(scheduleCss.includes(':root[data-theme="dark"] .role-box'), "Schedule role boxes must use feature-owned dark styling.");
  const hasGlobalScheduleDailyThemeRule = globalCss.split("{").some(rule => {
    const selector = rule.slice(rule.lastIndexOf("}") + 1);
    return selector.includes(':root[data-theme="dark"]') && [
      ".daily-", ".schedule-card", ".schedule-location-group", ".church-schedule-",
      ".role-box", ".role-missing", ".coverage-pill", ".service-title",
    ].some(target => selector.includes(target));
  });
  assert(!hasGlobalScheduleDailyThemeRule, "Global styles must not retain Schedule daily-overview dark selectors.");
  assert(scheduleCss.includes(':root[data-theme="dark"] .bulk-assignment-center'), "Schedule bulk assignment must own its dark-mode presentation.");
  assert(scheduleCss.includes(':root[data-theme="dark"] .assignment-overview-card'), "Schedule assignment overview cards must own their dark-mode presentation.");
  assert(scheduleCss.includes(':root[data-theme="dark"] .my-upcoming-item'), "Personal upcoming schedule cards must own their dark-mode presentation.");
  const scheduleAssignmentTargets = [
    ".schedule-workspace-tabs", ".church-bulk-actions", ".assignment-overview",
    ".assignment-workload-detail", ".bulk-assignment", ".bulk-church-group",
    ".bulk-copy", ".bulk-preview", ".bulk-matrix", ".workload-", ".generate-",
    ".template-", ".swap-source", ".my-upcoming", ".my-days-card", ".my-next-",
    ".my-schedule-summary", ".calendar-workspace-heading",
  ];
  const hasGlobalScheduleAssignmentThemeRule = globalCss.split("{").some(rule => {
    const selector = rule.slice(rule.lastIndexOf("}") + 1);
    const themed = selector.includes(':root[data-theme="dark"]') || selector.includes('.app-shell[data-theme="dark"]');
    return themed && scheduleAssignmentTargets.some(target => selector.includes(target));
  });
  assert(!hasGlobalScheduleAssignmentThemeRule, "Global styles must not retain Schedule assignment-management dark selectors.");
});


Deno.test("Schedule recurring-generation guidance retains readable semantic contrast", async () => {
  const scheduleCss = await readRepoFile("src/features/schedule/components/ScheduleWorkspace.css");
  assert(scheduleCss.includes(':root[data-theme="dark"] .generate-panel .generate-note-title'), "Schedule must explicitly style the generation guidance title in dark mode.");
  assert(scheduleCss.includes("color: var(--text-primary) !important;"), "The generation guidance title must use the dark theme's primary text token.");
  assert(scheduleCss.includes(':root[data-theme="dark"] .generate-panel .generate-note p span'), "Generation guidance descriptions must use a dark-theme secondary text rule.");
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
    readGlobalStyles(),
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


Deno.test("signup CG-day choices stay legible and contained on mobile", async () => {
  const [authCss, authComponent] = await Promise.all([
    readRepoFile("src/features/auth/components/AuthScreens.css"),
    readRepoFile("src/features/auth/components/AuthScreen.tsx"),
  ]);
  assert(authComponent.includes('className="signup-days-field"'), "Signup CG days must use an isolated fieldset class rather than the shared member-profile selector.");
  assert(authComponent.includes('className="signup-days-options"'), "Signup weekday choices must use their isolated options grid.");
  assert(authCss.includes(".auth-registration .signup-days-field{") && authCss.includes("display:block !important;") && authCss.includes("flex:0 0 auto;"), "The signup fieldset must remain a non-shrinking block in the vertical form flow.");
  assert(authCss.includes(".auth-registration .signup-days-options{") && authCss.includes("grid-template-columns:repeat(2,minmax(0,1fr));"), "CG-day choices must use a bounded two-column grid inside the fieldset.");
  assert(authCss.includes(".auth-registration .signup-days-field legend{") && authCss.includes("display:inline-block;"), "The CG-day legend must remain in the fieldset's normal flow.");
  assert(authCss.includes("min-height:max-content;") && authCss.includes("overflow:visible !important;"), "The signup fieldset must expand to contain every weekday row.");
  assert(authCss.includes("color:var(--text-subtle);"), "The CG-day legend must use the shared subtle-text token.");
  assert(authCss.includes("color:var(--text-subtle) !important;"), "Weekday labels must use the same semantic text color as the legend.");
  assert(authCss.includes("accent-color:var(--accent-primary);"), "Native checkboxes must use the theme accent.");
  assert(authCss.includes("@media(max-width:360px)") && authCss.includes(".signup-days-options{grid-template-columns:minmax(0,1fr)}"), "Very narrow devices must fall back to a single-column CG-day layout.");
  assert(!authCss.includes("flex-basis: 100%"), "CG-day options must not use the overflowing single-column flex layout.");
});

Deno.test("authentication dark card styling has one consolidated rule and registration owns scrolling", async () => {
  const authCss = await readRepoFile("src/features/auth/components/AuthScreens.css");
  const darkCardMarker = ':root[data-theme="dark"] .auth-card{';
  assert(authCss.split(darkCardMarker).length - 1 === 1, "AuthScreens.css must keep one consolidated dark auth-card rule.");
  const darkCard = authCss.slice(authCss.indexOf(darkCardMarker), authCss.indexOf("}", authCss.indexOf(darkCardMarker)));
  assert(darkCard.includes("box-shadow:0 4px 18px rgba(0,0,0,.16);"), "Consolidating the dark card rules must retain the existing shadow.");
  assert(authCss.includes(".auth-card form.auth-registration{"), "The registration form must remain the single owner of its bounded scroll region.");
  assert(!authCss.includes(".auth-registration{max-height:72vh;overflow:auto"), "The superseded generic registration overflow rule must be removed.");
  assert(!authCss.includes(".auth-registration{max-height:68vh}"), "The superseded mobile registration height rule must be removed.");
});


Deno.test("servant account linking opens in a portal dialog instead of inside each record", async () => {
  const [component, styles] = await Promise.all([
    readRepoFile("src/features/servants/components/ServantInformationPanel.tsx"),
    readRepoFile("src/features/servants/components/ServantInformationPanel.css"),
  ]);
  assert(component.includes('import { createPortal } from "react-dom";'), "The account-link dialog must render outside record layout through a portal.");
  assert(component.includes('role="dialog"'), "The account-link dialog must expose dialog semantics.");
  assert(component.includes('aria-modal="true"'), "The account-link dialog must be modal to assistive technology.");
  assert(component.includes('aria-haspopup="dialog"'), "The Link account action must announce that it opens a dialog.");
  assert(component.includes('event.key === "Escape"'), "The account-link dialog must close with Escape.");
  assert(!component.includes("servant-link-panel"), "The account-link form must not remain nested inside every expanded servant record.");
  assert(styles.includes(".servant-link-backdrop{"), "The account-link dialog must have a viewport-level backdrop.");
  assert(styles.includes("z-index:1200;"), "The dialog must appear above app navigation and content.");
});

Deno.test("servant directory controls and record surfaces use active dark theme tokens", async () => {
  const styles = await readRepoFile("src/features/servants/components/ServantInformationPanel.css");
  assert(styles.includes(":root[data-theme=\"dark\"] .servant-record-heading .servant-link-trigger"), "The Link account button must have an explicit dark theme.");
  assert(styles.includes("background:var(--surface-muted) !important;"), "The dark Link account button must use a semantic muted surface.");
  assert(styles.includes(":root[data-theme=\"dark\"] .servant-record-heading .servant-record-summary"), "The servant summary row must have an explicit dark theme.");
  assert(styles.includes("color:var(--status-warning-text) !important;"), "The unlinked chip must use semantic warning text.");
});

Deno.test("signup card and every registration control stay within the mobile viewport", async () => {
  const [authCss, tokensCss] = await Promise.all([
    readRepoFile("src/features/auth/components/AuthScreens.css"),
    readRepoFile("src/styles/tokens.css"),
  ]);
  assert(authCss.includes("box-sizing:border-box;width:min(420px,100%)"), "The authentication card width must include its padding.");
  assert(authCss.includes("overflow-x:clip"), "The auth page must prevent horizontal viewport spill.");
  assert(authCss.includes("padding:7px 9px 12px"), "The registration form must reserve an inner gutter for focus rings.");
  assert(authCss.includes("max-width:100%;min-width:0"), "Registration controls must be bounded by the card width.");
  assert(tokensCss.includes("--surface-control: #ffffff;"), "The light theme must define a control surface token.");
  assert(tokensCss.includes("--surface-control: #111c2e;"), "The dark theme must define a control surface token.");
  assert(authCss.includes("background:var(--surface-control) !important;"), "Dark signup selects and textareas must use the dark control surface.");
  assert(authCss.includes("font-size:16px!important;"), "Mobile auth controls must avoid iOS automatic page zoom.");
  assert(authCss.includes("box-shadow:inset 0 0 0 2px var(--focus-border)!important;"), "Auth focus rings must remain inside their fields.");
  assert(!authCss.includes("outline-offset: 3px !important;"), "The superseded outer focus ring must be removed.");
});


Deno.test("global dark controls use one shared theme surface across generic and content forms", async () => {
  const globalCss = await readGlobalStyles();
  assert(!globalCss.includes("background:#111a2b!important;"), "The superseded dark control surface must be removed.");
  assert(!globalCss.includes("background:#111c2e!important;"), "The final dark control surface must use semantic tokens.");
  assert(globalCss.includes("background:var(--surface-control)!important;"), "Generic dark controls must use the active control-surface token.");
  assert(globalCss.includes("color:var(--text-primary)!important;"), "Dark content controls must use the active primary text token.");
  assert(globalCss.includes("border-color:var(--border-strong)!important;"), "Dark controls must use the shared border token.");
  assertBalancedCss(globalCss, "src/style.css");
});

Deno.test("Servant Information owns its account chips and status action theme", async () => {
  const [component, servantCss, sharedCss, darkCss] = await Promise.all([
    readRepoFile("src/features/servants/components/ServantInformationPanel.tsx"),
    readRepoFile("src/features/servants/components/ServantInformationPanel.css"),
    readRepoFile("src/styles/shared-components.css"),
    readRepoFile("src/styles/dark-theme.css"),
  ]);
  assert(component.includes("servant-account-chip"), "Servant Information must continue to render its account-link status chip.");
  assert(component.includes("servant-status-toggle"), "Servant Information must continue to render its record state action.");
  assert(servantCss.includes(".servant-account-chip{"), "Servant Information must own the status chip base styling.");
  assert(servantCss.includes("@media(max-width:600px)"), "Servant Information must retain the compact chip size on mobile.");
  assert(servantCss.includes(":root[data-theme=\\"dark\\"] .servant-account-chip.linked"), "Servant Information must own its linked dark status.");
  assert(servantCss.includes(":root[data-theme=\\"dark\\"] .servant-account-chip.unlinked"), "Servant Information must own its unlinked dark status.");
  assert(servantCss.includes(".servant-status-toggle.danger"), "Servant Information must own its destructive status action styling.");
  assert(servantCss.includes(":root[data-theme=\\"dark\\"] .servant-status-toggle.danger"), "Servant Information must own its destructive dark status action.");
  assert(!sharedCss.includes(".servant-account-chip"), "Shared CSS must not retain Servant Information status chip rules.");
  assert(!darkCss.includes(".servant-account-chip"), "Global dark CSS must not retain Servant Information status chip rules.");
  assert(!darkCss.includes(".servant-status-toggle"), "Global dark CSS must not retain Servant Information status action rules.");
  assertBalancedCss(servantCss, "ServantInformationPanel.css");
});

Deno.test("Servant Information has no dead inline link panel or competing dark record overrides", async () => {
  const styles = await readRepoFile("src/features/servants/components/ServantInformationPanel.css");
  assert(!styles.includes(".servant-link-panel"), "The old inline account-link panel styles must be removed.");
  assert(!styles.includes("#1b2437"), "The superseded Servant Information card color must be removed.");
  assert(styles.includes("background:var(--accent-soft);color:var(--accent-hover)"), "The avatar must use the shared accent palette in both themes.");
  assert(styles.split(':root[data-theme="dark"] .servant-record-detail{').length - 1 === 1, "Dark servant detail styling must be consolidated.");
  assertBalancedCss(styles, "ServantInformationPanel.css");
});


Deno.test("Audit dark row surfaces and muted labels have one final declaration", async () => {
  const css = await readRepoFile("src/features/audit/components/AuditPanel.css");
  assert(css.split(':root[data-theme="dark"] .audit-row{').length - 1 === 1, "Audit rows must have one dark surface rule.");
  assert(css.includes("background:#1b2437!important;"), "The effective Audit row background must be preserved.");
  assert(css.includes("border-color:#3b4b65!important;"), "The effective Audit row border must be preserved.");
  assert(css.includes("color:#b9c6da!important;"), "The final Audit muted text color must be preserved.");
  assert(css.includes("box-shadow:0 4px 18px rgba(0,0,0,.16);"), "The Audit row shadow must be preserved.");
  assertBalancedCss(css, "AuditPanel.css");
});

Deno.test("Push notification card dark styling has one consolidated final rule", async () => {
  const css = await readRepoFile("src/features/notifications/components/PushNotificationSettings.css");
  assert(css.split(':root[data-theme="dark"] .push-settings-card{').length - 1 === 1, "Push settings must have one dark card rule.");
  assert(css.includes("background:#1b263a!important;"), "The final push card background must be preserved.");
  assert(css.includes("border-color:#3a4963!important;"), "The final push card border must be preserved.");
  assert(css.includes("color:#edf2fa!important;"), "The final push card text color must be preserved.");
  assert(css.includes("box-shadow:0 5px 18px rgba(0,0,0,.16);"), "The final push card shadow must be preserved.");
  assertBalancedCss(css, "PushNotificationSettings.css");
});

Deno.test("Statistics dark cards retain final metric surfaces without duplicate root overrides", async () => {
  const css = await readRepoFile("src/features/statistics/components/StatisticsPanel.css");
  assert(css.split(':root[data-theme="dark"] .stat-card{').length - 1 === 1, "Stat cards must have one root dark rule.");
  assert(css.split(':root[data-theme="dark"] .stats-servant-card{').length - 1 === 1, "Servant statistic cards must have one root fallback rule.");
  assert(css.split(':root[data-theme="dark"] .location-stat{').length - 1 === 1, "Location statistic cards must have one dark rule.");
  assert(css.includes("background:#222f46!important;"), "The effective standard statistic card surface must be preserved.");
  assert(css.includes("background: #26364f !important;"), "The final location metric surface must be preserved.");
  assert(css.includes("background: #1d2a40 !important;"), "The app-shell-specific servant metric surface must be preserved.");
  assertBalancedCss(css, "StatisticsPanel.css");
});

Deno.test("Member profile dark theme does not retain superseded form and fieldset color rules", async () => {
  const css = await readRepoFile("src/features/auth/components/MemberProfilePanel.css");
  assert(!css.includes("background:#1b2437!important;"), "The fully overridden member form surface must be removed.");
  assert(css.includes("background: #202f46 !important;"), "The current member CG-day fieldset background must be preserved.");
  assert(css.includes("color:#edf3fb!important;"), "Member CG-day legend and labels must retain the final contrast color.");
  assert(!css.includes("color: #dbe5f2 !important;"), "The superseded member weekday label color must be removed.");
  assertBalancedCss(css, "MemberProfilePanel.css");
});


Deno.test("application shell owns its sidebar and mobile-navigation dark theme", async () => {
  const [layout, globalCss, shellCss] = await Promise.all([
    readRepoFile("src/app/components/AppLayout.tsx"),
    readGlobalStyles(),
    readRepoFile("src/app/components/AppShell.css"),
  ]);
  assert(layout.includes('import "./AppShell.css";'), "AppLayout must own and import its shell presentation.");
  for (const selector of [
    ':root[data-theme="dark"] .app-shell{',
    ':root[data-theme="dark"] .main-area{',
    ':root[data-theme="dark"] .content{',
    ':root[data-theme="dark"] .topbar{',
  ]) {
    assert(shellCss.includes(selector), "AppShell.css must own " + selector);
    assert(!globalCss.includes(selector), "Global dark-theme CSS must not retain " + selector);
  }
  for (const selector of [
    ':root[data-theme="dark"] .nav-item{',
    ':root[data-theme="dark"] .nav-item.active,',
    ':root[data-theme="dark"] .role-tag{',
    ':root[data-theme="dark"] .mobile-bottom-nav{',
    ':root[data-theme="dark"] .mobile-nav-item{',
    ':root[data-theme="dark"] .mobile-nav-item.active{',
    ':root[data-theme="dark"] .mobile-more-menu{',
    ':root[data-theme="dark"] .mobile-more-menu button{',
    ':root[data-theme="dark"] .mobile-more-menu button:hover{',
    ':root[data-theme="dark"] .mobile-more-menu .mobile-more-signout{',
    ':root[data-theme="dark"] .mobile-more-backdrop{',
  ]) {
    assert(shellCss.includes(selector), "AppShell.css must own " + selector);
    assert(!globalCss.includes(selector), "Global style.css must not retain " + selector);
  }
  assert(shellCss.includes("background:rgba(24,35,55,.98)!important;"), "The effective mobile navigation surface must be retained.");
  assert(shellCss.includes("background:#1b263a!important;"), "The effective mobile More menu surface must be retained.");
  assert(shellCss.includes("color:#ffb8c0!important;"), "The effective dark sign-out color must be retained.");
  assertBalancedCss(shellCss, "AppShell.css");
  assertBalancedCss(globalCss, "src/style.css");
});


Deno.test("shared dark secondary buttons and action controls have one effective rule", async () => {
  const [css, scheduleCss] = await Promise.all([
    readGlobalStyles(),
    readRepoFile("src/features/schedule/components/ScheduleWorkspace.css"),
  ]);
  assert(css.split(':root[data-theme="dark"] .btn.secondary,:root[data-theme="dark"] .icon-btn,:root[data-theme="dark"] .bulk-row-action{').length - 1 === 1,
    "The base shared button/action group should occur once.");
  assert(css.split(':root[data-theme="dark"] .btn.secondary:hover,:root[data-theme="dark"] .icon-btn:hover,:root[data-theme="dark"] .bulk-row-action:hover{').length - 1 === 1,
    "The shared button/action hover group should occur once.");
  assert(css.includes("background:#283750!important;color:#e5ebf6!important;border-color:#465670!important;"),
    "The final shared button palette must be retained.");
  assert(css.includes("background:#364764!important;color:#fff!important"),
    "The final shared hover palette must be retained.");
  assert(!css.includes("background:#26324a;border-color:#3c4963;color:#dbe4f5"),
    "The superseded bulk-row action palette must be removed.");
  assert(css.split(':root[data-theme="dark"] .bulk-row-action.danger{').length - 1 === 1,
    "The explicit dangerous action treatment must remain unique.");
  assert(scheduleCss.includes(":root[data-theme=\"dark\"] .generate-toggle-hint{"),
    "Schedule must keep the generation hint's separate dark-mode treatment.");
  assert(!css.includes(".action-dialog .btn.secondary{"),
    "The superseded action-dialog secondary button override must be removed.");
  assert(!css.includes(".schedule-overview-shortcuts .btn.secondary{"),
    "The superseded schedule shortcut secondary button override must be removed.");
  assertBalancedCss(css, "src/style.css");
});


Deno.test("Requests and Inbox own their dark card and heading presentation", async () => {
  const [requestsPanel, inbox, globalCss, requestsCss] = await Promise.all([
    readRepoFile("src/features/requests/components/RequestsPanel.tsx"),
    readRepoFile("src/features/requests/components/ServantInbox.tsx"),
    readGlobalStyles(),
    readRepoFile("src/features/requests/components/RequestsInbox.css"),
  ]);
  assert(requestsPanel.includes('import "./RequestsInbox.css";'), "RequestsPanel must import the shared Requests feature stylesheet.");
  assert(inbox.includes('import "./RequestsInbox.css";'), "ServantInbox must import the shared Requests feature stylesheet.");
  for (const selector of [
    ':root[data-theme="dark"] .requests-content-card{',
    ':root[data-theme="dark"] .requests-content-heading{',
    ':root[data-theme="dark"] .requests-content-heading h2{',
    ':root[data-theme="dark"] .requests-content-heading span,',
    ':root[data-theme="dark"] .requests-content-card .people-list{',
    ':root[data-theme="dark"] .requests-content-card .person-row{',
  ]) {
    assert(requestsCss.includes(selector), "RequestsInbox.css must own " + selector);
    assert(!globalCss.includes(selector), "Global style.css must not retain " + selector);
  }
  assert(requestsCss.includes("background:#1b263a!important;"), "The final request card background must be preserved.");
  assert(requestsCss.includes("border-bottom:1px solid #3b4b65!important;"), "The final request heading divider must be preserved.");
  assert(requestsCss.includes("color:#f3f6fc!important;"), "The final request heading contrast must be preserved.");
  assert(requestsCss.includes("color:#bdcbe0!important;"), "The final muted request text color must be preserved.");
  const hasGlobalRequestsDarkRule = globalCss.split("{").some(rule => {
    const selector = rule.slice(rule.lastIndexOf("}") + 1);
    return selector.includes(':root[data-theme="dark"]') && [
      ".inbox-item", ".inbox-intro", ".inbox-status", ".servant-inbox",
      ".requests-panel", ".requests-content", ".requests-section-heading",
      ".request-main", ".request-row", ".servant-requests-section",
    ].some(target => selector.includes(target));
  });
  assert(!hasGlobalRequestsDarkRule, "Global styles must not retain Requests/Inbox feature dark selectors.");

  for (const selector of [
    ':root[data-theme="dark"] .requests-section-heading{',
    ':root[data-theme="dark"] .request-main b{',
    ':root[data-theme="dark"] .servant-requests-section .request-row{',
  ]) {
    assert(requestsCss.includes(selector), "RequestsInbox.css must own " + selector);
    assert(!globalCss.includes(selector), "Global style.css must not retain " + selector);
  }
  assert(requestsCss.includes("border-top-color:#394862!important;"), "Request section heading top border must be preserved.");
  assert(requestsCss.includes("color:#f1f5fb!important"), "Request main heading contrast must be preserved.");
  assert(requestsCss.includes("background:transparent!important;border-bottom-color:#3b4b65!important"), "Request rows must retain their transparent dark surface.");

  assertBalancedCss(requestsCss, "RequestsInbox.css");
  assertBalancedCss(globalCss, "src/style.css");
});


Deno.test("Requests feature owns its servant inbox dark layout and card treatment", async () => {
  const [inbox, globalCss, requestsCss] = await Promise.all([
    readRepoFile("src/features/requests/components/ServantInbox.tsx"),
    readGlobalStyles(),
    readRepoFile("src/features/requests/components/RequestsInbox.css"),
  ]);
  assert(inbox.includes('import "./RequestsInbox.css";'), "ServantInbox must import RequestsInbox.css.");
  for (const selector of [
    ':root[data-theme="dark"] .servant-inbox{',
    ':root[data-theme="dark"] .inbox-intro{',
    ':root[data-theme="dark"] .inbox-intro h2{',
    ':root[data-theme="dark"] .inbox-intro p{',
    ':root[data-theme="dark"] .inbox-intro > .inbox-unread-count{',
    ':root[data-theme="dark"] .inbox-item{',
    ':root[data-theme="dark"] .inbox-item.unread{',
    ':root[data-theme="dark"] .inbox-item + .inbox-item{',
  ]) {
    assert(requestsCss.includes(selector), "RequestsInbox.css must own " + selector);
  }
  assert(requestsCss.includes("background: #202f46 !important;"), "Inbox card surface must be retained.");
  assert(!globalCss.includes(':root[data-theme="dark"] .inbox-item{\\n  background: #202f46 !important;'),
    "The final servant inbox card surface must not remain global.");
  assert(requestsCss.includes("background: #292744 !important;"), "Unread inbox surface must be retained.");
  assert(!globalCss.includes(':root[data-theme="dark"] .inbox-item.unread{\\n  background: #292744 !important;'),
    "The final unread servant inbox surface must not remain global.");
  assert(requestsCss.includes("@media (max-width: 760px)"), "Mobile inbox layout overrides must be retained.");
  assert(!globalCss.includes(":root[data-theme=\"dark\"] .inbox-intro > .inbox-unread-count{\n    flex: 0 0 auto;"),
    "Mobile inbox count alignment must not remain global.");
  assertBalancedCss(requestsCss, "RequestsInbox.css");
  assertBalancedCss(globalCss, "src/style.css");
});


Deno.test("Statistics owns its table layout and light/dark presentation", async () => {
  const [component, globalCss, statisticsCss] = await Promise.all([
    readRepoFile("src/features/statistics/components/StatisticsPanel.tsx"),
    readGlobalStyles(),
    readRepoFile("src/features/statistics/components/StatisticsPanel.css"),
  ]);

  assert(component.includes('import "./StatisticsPanel.css";'),
    "StatisticsPanel must import its feature-owned table stylesheet.");
  assert(!globalCss.includes(".stats-table"),
    "Global CSS must not retain Statistics table layout or theme overrides.");

  for (const selector of [
    ".stats-table-wrap{",
    ".stats-table{",
    ".stats-table th,.stats-table td{",
    ".stats-table th{",
    ".stats-table td:not(:first-child),.stats-table th:not(:first-child){",
    ".stats-table tbody tr:last-child td{",
    ".stats-table td{",
    ':root[data-theme="dark"] .stats-table-wrap{',
    ':root[data-theme="dark"] .stats-table th{',
    ':root[data-theme="dark"] .stats-table td{',
  ]) {
    assert(statisticsCss.includes(selector),
      "StatisticsPanel.css must own " + selector + ".");
  }

  assert(statisticsCss.includes("min-width:520px"),
    "The desktop table minimum width and horizontal scroll behavior must be preserved.");
  assert(statisticsCss.includes("background:#202f46!important;"),
    "The final dark Statistics table surface must be retained.");
  assert(statisticsCss.includes("background:#293951!important;"),
    "The final dark Statistics table header surface must be retained.");
  assert(statisticsCss.includes("color:#e2e9f4!important;"),
    "Dark table body text contrast must be retained.");
  assertBalancedCss(statisticsCss, "StatisticsPanel.css");
  assertBalancedCss(globalCss, "src/style.css");
});
