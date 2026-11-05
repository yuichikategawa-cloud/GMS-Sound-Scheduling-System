# GMS Sound Scheduling System — Modularization Plan

## Objective

Move the current React application from a monolithic implementation toward a modular monolith. Preserve the existing Supabase schema, authentication behavior, role boundaries, scheduling rules, manual assignment model, and admin-only publishing behavior unless a separately reviewed change explicitly alters them.

This is an incremental refactor, not a rewrite and not a microservices conversion.

## Current baseline (2026-11-05)

- `src/App.tsx` is approximately 1,576 lines and contains application state, authentication, data loading, mutations, push registration, scheduling workflows, and screen/component definitions.
- `src/style.css` is approximately 4,500 lines and contains base styles, feature styles, responsive overrides, and accumulated theme-specific fixes.
- The source tree has only a small number of top-level source files; feature boundaries are not yet represented as modules.
- The application remains a monolith at this baseline. Extracting a helper file does not by itself make the architecture modular.

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
- [ ] M2 shared UI and app shell.
- [x] M2 first shared UI extraction: branded `GmsLoader` moved to `src/shared/components/GmsLoader.tsx`; both app call sites use the extracted component, with existing global loader styles unchanged.
- [ ] M3 authentication/profile.
- [ ] M4 schedule.
- [ ] M5 availability/servants.
- [ ] M6 requests/notifications.
- [ ] M7 statistics/audit/CSS.
- [ ] M8 architecture verification.

Status: **still a monolith in transition**. Do not describe the app as modular until M2–M8 have established and verified feature boundaries.
