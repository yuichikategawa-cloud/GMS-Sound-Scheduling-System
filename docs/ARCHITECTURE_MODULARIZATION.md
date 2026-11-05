# GMS Sound Scheduling System — Modularization Plan

## Objective

Move the current React application from a monolithic implementation toward a modular monolith. Preserve the existing Supabase schema, authentication behavior, role boundaries, scheduling rules, manual assignment model, and admin-only publishing behavior unless a separately reviewed change explicitly alters them.

This is an incremental refactor, not a rewrite and not a microservices conversion.

## Current baseline (2026-11-05)

- `src/App.tsx` is 1325 lines and still owns application-level state, authorization gates, data-loading orchestration, refresh flows, and several feature workflows.
- `src/style.css` remains the large global stylesheet (approximately 195.2 KB) containing shared styles, other feature styles, responsive overrides, and accumulated theme-specific fixes; `GmsLoader`, the audit panel, and push notification settings own their presentation in colocated stylesheets.
- Feature boundaries now exist under `src/features`, alongside `src/app` and `src/shared`; App remains the composition/orchestration root.
- The application is still a monolith in transition. Extracting services and screens has reduced coupling, but further boundary and dependency verification is required.

## Target structure

Use feature-oriented modules with explicit boundaries. Avoid creating one giant generic `components` or `utils` folder that merely relocates the monolith.

```
src/
  app/
    App.tsx
    providers/
    routing/
  features/
    auth/
      components/
      hooks/
      services/
    schedule/
      components/
      hooks/
      services/
    availability/
      components/
      hooks/
      services/
    servants/
      components/
      hooks/
      services/
    requests/
      components/
      hooks/
      services/
    notifications/
      components/
      hooks/
      services/
    statistics/
      components/
      hooks/
      services/
    audit/
      components/
      services/
  shared/
    components/
    hooks/
    lib/
    formatters.ts
  integrations/
    supabase/
      client.ts
      types.ts
  styles/
    tokens.css
    base.css
    layout.css
    features/
      auth.css
      schedule.css
      availability.css
      requests.css
      notifications.css
```

The exact names can be adjusted to fit the existing code, but feature ownership and dependency direction should remain clear.

## Dependency rules

1. Feature modules own their UI, feature-specific hooks, and feature-specific operations.
2. Shared modules contain genuinely cross-feature primitives and pure helpers only.
3. Supabase access is isolated behind integration/service modules; UI components should not issue scattered table queries.
4. Features may depend on shared modules and integration contracts, but shared modules must not import feature modules.
5. The app shell composes feature screens; it must not become a second location for feature business logic.
6. Avoid circular imports and avoid exporting broad mutable global state.
7. Preserve the current single-deployment modular-monolith architecture.

## Phased execution

### Phase M0 — Baseline and guardrails
- Record the current behavior and architecture baseline.
- Keep existing workflows and database contracts unchanged.
- Require a successful frontend build and existing SQL/Deno regression suite after each extraction.
- Add targeted tests before moving business logic that currently has no direct regression coverage.

### Phase M1 — Pure shared utilities
- Extract date/time formatting, display formatting, and other side-effect-free helpers.
- Keep signatures and output behavior unchanged.
- Do not mix utility extraction with business-rule changes.

### Phase M2 — Shared UI primitives and app shell
- Extract reusable dialogs, loaders, buttons/panels, and layout primitives.
- Move the shell/navigation composition out of the large App component.
- Keep role-based visibility and navigation behavior unchanged.

### Phase M3 — Authentication and profile
- Isolate login, registration, password recovery, session lifecycle, profile loading, and account linking.
- Preserve existing password recovery and username login behavior.
- Verify admin/servant access boundaries.

### Phase M4 — Schedule feature
- Isolate schedule queries, schedule editing, generation, publishing, bulk assignments, and schedule display.
- Preserve central administration, fully manual servant assignment, conflict validation, and admin-only publishing.
- Do not change SQL contracts or auto-assign servants during this phase.

### Phase M5 — Availability and servant management
- Isolate availability submission, bulk availability, recurring rules, serving preferences, servant directory, and account linking.
- Preserve all existing eligibility and cross-location conflict rules.

### Phase M6 — Requests and notifications
- Isolate swaps, replacements, Inbox, notification preferences, push subscription lifecycle, and service-worker integration.
- Preserve atomic approval behavior, ownership checks, push security, and read-state persistence.

### Phase M7 — Statistics, audit, and stylesheet decomposition
- Separate statistics and audit features.
- Split CSS by tokens, base/layout, and feature ownership.
- Remove obsolete duplicate/overridden rules only when visual regression checks establish that they are unused.
- Keep responsive and dark-mode behavior intact.

### Phase M8 — Architecture verification
- Review imports and dependency direction.
- Check for circular dependencies and feature leakage.
- Run full build, unit/regression tests, SQL authorization checks, and the consolidated staging acceptance suite.
- Update architecture documentation and mark the app modular only when the boundaries are real and verified.

## Required safeguards

- One coherent extraction per commit where practical; avoid large all-at-once rewrites.
- No database schema changes as a side effect of frontend modularization.
- No automatic assignment; assignments remain manual.
- Only administrators can publish final schedules.
- Preserve all three church locations under central administration.
- Keep production data and secrets untouched during refactoring.
- Do not merge to `main`, open a PR, or deploy production without explicit user approval.
- Preview deployments are batched and used only when visual/integration validation needs them; CI and static review come first.
- Tell the user before any test that requires them to interact with the iPhone/app.

## Progress

- [x] M0 baseline inspected and documented.
- [x] M1 first extraction: pure formatting/display helpers moved to `src/shared/formatters.ts`; `App.tsx` imports them.
- [ ] M1 remaining pure helpers and regression coverage.
- [x] M2 shared UI and app shell.
- [x] M2 page-frame composition: `AppLayout` now owns the themed app root, sidebar/header/content frame, mobile navigation slot, and modal overlay host; App supplies stateful feature components through typed React nodes.
- [x] M2 first shared UI extraction: branded `GmsLoader` moved to `src/shared/components/GmsLoader.tsx`; both app call sites use the extracted component, with existing global loader styles unchanged.
- [x] M2 second shared UI extraction: the action-confirmation dialog is now `src/shared/components/ActionDialog.tsx`; the app retains the confirmation resolver/state and passes controlled props into the component.
- [x] M2 app-shell extraction: sidebar/navigation moved to `src/app/components/Sidebar.tsx`; App retains navigation state and computes the two role-specific badge counts.
- [x] M2 mobile navigation extraction: bottom navigation and More menu moved to `src/app/components/MobileNavigation.tsx`; role-specific visibility, badge state, theme/install/sign-out actions remain controlled through App callbacks.
- [x] M2 header extraction: the title, role badge, install, theme, refresh, and mobile-menu controls moved to `src/app/components/AppHeader.tsx`; App retains all underlying state and handlers.
- [ ] M3 authentication/profile.
- [x] M3 first UI extraction: login, registration, reset-link, and recovered-password screens moved to `src/features/auth/components`.
- [x] M3 member-profile form UI extraction: the member profile editor and admin-only directory presentation moved into `MemberProfilePanel.tsx`.
- [x] M3 member-profile persistence extraction: account profile loading and member profile upsert/name synchronization/email update orchestration moved into `src/features/auth/services/memberProfile.ts`; App retains user-facing state and refresh orchestration.
- [x] M3 setup-screen extraction: the unconfigured-Supabase setup instructions moved into `SupabaseSetupScreen.tsx` under the auth feature; configuration detection remains in App.
- [x] M3 registration-validation extraction: metadata normalization and CG/domicile/leader-phone validation moved to `src/features/auth/services/registration.ts` with five Deno regression tests.
- [x] M3 authentication service extraction: sign-up, username login/session establishment, password-reset requests, and password updates moved to `src/features/auth/services/authentication.ts`; App retains UI state, messaging, and form orchestration.
- [x] M3 session-lifecycle extraction: auth subscription, initial session restoration, local invalid-refresh cleanup, recovery events, and unmount cancellation moved to `src/features/auth/services/sessionLifecycle.ts` with five Deno tests.
- [ ] M4 schedule.
- [x] M4 first pure schedule-service extraction: schedule/location/servant/assignment view mapping moved to `src/features/schedule/services/mapSchedules.ts`, with regression tests for ordering, fallback labels, confirmation defaults, empty assignments, and input immutability.
- [x] M4 schedule display-token extraction: church color selection, VSS/AOG categorization, and servant tint selection moved to `src/features/schedule/services/dailyDisplay.ts` with deterministic behavior tests.
- [x] M4.2 manual-assignment validation extraction: duplicate selection, serving eligibility, cross-church conflicts, same-church overlap, availability, and workload checks moved to `src/features/schedule/services/assignmentValidation.ts` with 12 Deno regression tests; App retains messaging, warning confirmations, and RPC orchestration.
- [x] M4.3 weekend-generation extraction: Saturday/Sunday date expansion and selected-template row construction moved to `src/features/schedule/services/weekendGeneration.ts` with eight Deno regression tests covering multi-week expansion, year boundaries, selection, invalid inputs, and input immutability; App retains admin gating, Supabase upsert mode, refresh, and user messaging.
- [x] M4.4 schedule-persistence extraction: schedule create/edit now delegates to the existing atomic `admin_save_schedule_with_assignments` RPC, weekend-generation persistence preserves its original conflict key and add/replace behavior, and schedule deletion delegates by ID through `src/features/schedule/services/schedulePersistence.ts`; six Deno regression tests cover RPC argument forwarding, insert/edit IDs, upsert modes, deletion, and database-error preservation. App retains admin authorization, assignment validation, confirmation dialogs, publishing, refresh, and user messaging.
- [x] M5 availability/servants.
- [x] M5.1 recurring-availability rules extraction: recurring date expansion, inclusive effective-date handling, supported weekday/month patterns, virtual availability row construction, overlapping-rule checks, and explicit-entry conflict checks moved to `src/features/availability/services/recurringAvailability.ts`; 14 Deno regression tests cover rule patterns, horizon boundaries, conflict behavior, the existing 740-date validation limit, and input immutability. The App retains authorization, persistence, refresh, and user messaging.
- [x] M5.2 availability and serving-preference persistence extraction: single/bulk dated availability upserts, recurring-rule create/delete, serving-preference create/delete, dated availability deletion, and availability-deadline settings upsert moved to `src/features/availability/services/availabilityPersistence.ts`; nine Deno regression tests cover table targets, exact row payloads, creator/updater attribution, `servant_id,service_date` and `key` conflict contracts, ID filters, and database-error pass-through. App retains authorization, ownership/deadline checks, recurrence and serving-preference validation, refresh, confirmation dialogs, and user messaging. No database schema or migration changed.
- [x] M5.3 servant-management persistence extraction: servant creation, active-status updates, and existing-account linking moved to `src/features/servants/services/servantManagement.ts`; four Deno regression tests cover the existing table payload, ID filter, admin RPC name/arguments, NIJ trimming, and database-error pass-through. App retains admin gates, modal/loading/message orchestration, and data refresh. The admin servant directory now exposes a visible per-row `Link account` action for active unlinked servants, opening the existing verified-link form. The existing `admin_link_servant_account` RPC remains the authority for identity checks, history/recurrence conflicts, duplicate consolidation, and audit logging. No database schema or migration changed. GitHub Actions run #77 passed the full validation workflow for final commit `4feb5ec`.
- [x] M5.4 servant-information UI extraction: servant KPIs, community-group summaries, profile-health metrics, filters, record details, the admin-only `Link account` action, verified account-link form, and servant activation controls moved into `src/features/servants/components/ServantInformationPanel.tsx`. App retains account-candidate derivation and callback orchestration. Existing CSS classes, account-link RPC, admin gates, and servant data contracts remain unchanged; full Deno, SQL staging, and frontend validation passed in GitHub Actions run #42016684239; the repository integration also created a READY preview deployment with no production target.
- [x] M5.5 servant account-candidate derivation extraction: the servant-role account filter and member/account/linked-servant mapping moved to `src/features/servants/services/servantDirectory.ts`; four Deno regression tests cover role filtering, exact field mapping, username and linked-servant fallbacks, and input immutability. App memoizes the derived list and passes it into the servant information panel. Existing role predicate and account-link RPC remain unchanged; GitHub Actions run #42018965914 passed the full Deno, SQL staging, and frontend workflow.
- [x] M5.6 servant directory data-loading extraction: the `member_profiles` and `profiles` reads moved into `loadServantDirectoryData` in `src/features/servants/services/servantDirectory.ts`, retaining the exact selected columns and parallel query behavior. App still treats both results as optional ancillary data, logs each query error, uses empty-list fallbacks independently, and selects the current member profile by `user_id`. Four Deno regression tests cover the query contracts, unchanged error pass-through, independent result availability, and empty successful results; GitHub Actions run #42022662153 passed all Deno, SQL staging, and frontend jobs. No schema, migration, RLS, or authorization changes.
- [x] M5.7 required servant-list query extraction: the existing `servants.select("*").order("full_name")` read moved into `loadServantRecords` in `src/features/servants/services/servantManagement.ts`. App retains the required-data failure gate, mapping, and dashboard state updates. Three new Deno tests cover exact query shape/order, raw error propagation, and empty successful results; GitHub Actions run #42023980269 passed all Deno, SQL staging, and frontend jobs. No schema, migration, RLS, authorization, or ordering changes.
- [x] M6 requests/notifications.
- [x] M6.1 serving-request data-loading extraction: the `serving_requests` and `serving_request_reads` reads moved into `loadServingRequestData` in `src/features/requests/services/requestData.ts`, retaining parallel execution, full-row selection, descending request creation ordering, and independent optional-data fallbacks/warnings. Four Deno tests cover both query contracts, independent errors, and empty successful results; GitHub Actions run #42027649147 passed all Deno, SQL staging, and frontend jobs; its automatic Vercel preview reached READY with no production target. No schema, migration, RLS, or authorization changes.
- [x] M6.2 serving-request persistence extraction: request creation (replacement and cross-date swap), per-user request-read upsert, admin review updates, swap execution, and replacement resolution moved into `src/features/requests/services/requestPersistence.ts`. App retains authorization, eligibility/conflict checks, duplicate-request handling, confirmation dialogs, assignment status changes, messaging, and refresh orchestration. Seven Deno tests cover payloads, conflict keys, review filters, existing admin RPC contracts, and error pass-through; Deno, SQL staging, and frontend CI passed on corrective commit `bfc0dade1d2bf71730ff5b5163fb916453eedc0d` (GitHub Actions run #42030270118). No schema, migration, RLS, or authorization changes.
- [x] M6.3 request UI extraction: `ServantInbox`, `RequestsPanel`, and shared `PushNotificationSettings` presentation components extracted into feature-owned component files; `App.tsx` retains data loading, authorization, mutations, read-state persistence, and callback orchestration. Existing markup, CSS class names, props, and behavior are preserved. The first frontend run found three missing default exports; corrective commit `ca27948915a2aac6f034e524d81d2f308bd7cc1c` fixed the imports/exports, and GitHub Actions run #42035106401 passed Deno, SQL staging, and frontend validation. No schema, migration, RLS, or authorization changes.
- [x] M6.4 notification data/preferences extraction (prepared for review): notification history and current-user preference reads moved behind `src/features/notifications/services/notificationData.ts`; preference upsert and notification read-state update moved behind `notificationPersistence.ts`. Existing 30-day cutoff, descending order, 100-row limit, `user_id` lookup/upsert conflict key, five boolean preference fields/defaults, notification-ID read filter, and optional-data fallback behavior are preserved. Eight Deno regression tests cover query contracts, independent read errors, empty/missing results, preference payload/coercion, upsert conflict key, error pass-through, and read-state updates. CI workflow updated to execute both notification test files. No schema, migration, RLS, or authorization changes. CI run #42038625179 passed Deno, SQL staging, and frontend validation.
- [x] M6.5 push-subscription lifecycle: browser capability and iOS standalone checks, VAPID decoding, current-user subscription status, enable/register, disable/unsubscribe, and bounded best-effort sign-out cleanup moved to `src/features/notifications/services/pushSubscription.ts`. App retains UI state and user-facing messages. Existing RPC arguments, database filters, service worker, dispatcher, and SQL contracts remain unchanged; 11 Deno regression tests cover capability guards, decoding, ownership, reuse/creation, permission outcomes, incomplete payloads, RPC errors, disable behavior, and sign-out cleanup. GitHub Actions run #42047486473 passed Deno, SQL staging, and frontend validation. No schema, migration, RLS, or authorization changes.
- [ ] M7 statistics/audit/CSS.
- [x] M7.1 statistics extraction: pure serving-statistics calculations and the Statistics panel are moved into feature-owned modules with eight Deno regression tests; workflow integration is added. GitHub Actions run [#42055970811](https://github.com/yuichikategawa-cloud/GMS-Sound-Scheduling-System/actions/runs/42055970811) passed the full Deno regression suite, SQL staging checks, and frontend TypeScript/Vite build. The extraction does not change database schema, migrations, RLS, or authorization behavior.
- [x] M7.2 audit extraction: recent audit loading, historical 1,000-row pagination, and CSV serialization moved into `src/features/audit/services/auditData.ts`; the existing audit panel moved into `src/features/audit/components/AuditPanel.tsx`. Six Deno tests cover query filters/order/limit, pagination boundaries, empty results, error pass-through, CSV escaping, and stable headers. GitHub Actions run [#42060503709](https://github.com/yuichikategawa-cloud/GMS-Sound-Scheduling-System/actions/runs/42060503709) passed the Deno regression suite (including the audit tests), SQL staging authorization/rollback checks, and frontend TypeScript/Vite build. App retains administrator authorization, date cutoffs, browser download behavior, and user-facing messaging. Existing audit RLS, triggers, and 30-day cleanup policy are unchanged; no schema or migration changes. Final parity review restored the original `Download` icon on the export action; the `ClipboardCheck` empty-state icon is retained.
- [x] M7.3.1 loader stylesheet extraction: component-owned presentation moved into `src/shared/components/GmsLoader.css`, including the wrapper override, equalizer animation, caption refinement, responsive adjustments, and reduced-motion handling. `GmsLoader.tsx` imports its stylesheet. Equivalent declarations are removed from `src/style.css`; the shared spinner animation, generic `.loader` class, and unrelated legacy selectors are retained. Existing markup, dimensions, colors, timing, and CSS declaration order are preserved. CI validation is attached to the resulting commit checks.
- [x] M7.3.2 audit stylesheet extraction: audit row, toolbar, pagination, mobile, and audit-specific dark-theme selectors moved into `src/features/audit/components/AuditPanel.css`; `AuditPanel.tsx` imports the colocated stylesheet. Shared `.toolbar`, `.btn`, `.people-list`, and `.empty-state` primitives remain global. Audit selectors were removed from broad dark-mode selector lists while preserving existing light/dark declaration order, including the legacy light-mode row-border override. No component markup, behavior, data access, or database files changed. CI validation is recorded against the extraction commit.
- [x] M7.3.3 push notification settings stylesheet extraction: base card/icon/copy styles, five notification preference controls, both responsive breakpoints, and push-specific dark-mode overrides moved into `src/features/notifications/components/PushNotificationSettings.css`; the component imports its colocated stylesheet. The three original dark-mode card overrides remain in their original precedence order. Shared serving-preference checkbox rules, inbox styles, generic controls, buttons, and design tokens remain global. No notification logic, RPC, service-worker, database, or authorization behavior changed. CI validation is recorded against the extraction commit.
- [ ] M8 architecture verification.

Status: **still a monolith in transition**. Do not describe the app as modular until M2–M8 have established and verified feature boundaries.
