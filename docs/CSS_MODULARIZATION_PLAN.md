# GMS Sound Scheduling System — CSS Modularization Plan

## Objective

Complete the move from a cascade-heavy global stylesheet to explicit, feature-owned styling without changing the visual design or causing desktop/mobile regressions. This is a staged extraction, not a redesign.

## Current baseline

Inspected on branch `security/push-endpoint-hardening`:

- `src/style.css`: approximately 89.7 KB and 1,600 lines.
- The global stylesheet still contains shared primitives, many feature-specific selectors, cross-cutting dark-mode overrides, and a large number of `!important` declarations.
- Nine feature-owned stylesheets exist under `src/features`, plus `src/app/components/AppShell.css`.
- `ScheduleWorkspace.css` is the largest extracted feature stylesheet at approximately 52.4 KB / 1,409 lines.
- `AvailabilityWorkspace.css` is approximately 15.5 KB / 439 lines.
- Schedule and Availability light/responsive rules have been extracted more fully than their dark-mode ownership. Several dark rules remain global intentionally because cascade order previously determined their effective appearance.

The current arrangement is a valid intermediate state. Moving dark rules mechanically would risk bringing back the exact kind of overflow and contrast regressions already observed.

## Target ownership

### Global foundation — keep small and stable

`src/styles/tokens.css` owns semantic design tokens only: surface, text, border, accent, focus, status, navigation and spacing values.

`src/styles/base.css` owns document resets, body defaults, heading defaults, native-control defaults, and global accessibility preferences such as reduced motion.

`src/style.css` becomes the import manifest plus genuinely shared primitives: buttons, generic cards, form controls, tables, banners, utility text and common empty states. It must not encode the internal layout of Schedule, Availability, Requests, Servants, Auth, Audit or Statistics.

### App shell

`src/app/components/AppShell.css` owns sidebar, header, page frame, mobile bottom navigation, More menu, and their light/dark/responsive states.

### Feature stylesheets

Each feature owns its component layout, responsive behavior, and dark-mode styling:

- Auth: login, registration, recovery and profile forms.
- Schedule: overview, daily calendar, assignment matrix, bulk assignment, generation and schedule dialogs.
- Availability: single entry, bulk entry, recurring rules, serving preferences and availability records.
- Servants: KPI/dashboard, servant directory, account-link dialog and record details.
- Requests: admin requests, servant Inbox, notification history and request dialogs.
- Notifications: push settings and notification-specific affordances.
- Statistics: metrics, location summaries, tables and servant statistics.
- Audit: audit rows, pagination and filters.

Feature stylesheets must not rely on accidental import order or broad global selectors to obtain their final appearance.

## Phased execution

### C0 — Establish visual baselines and ownership inventory

- Capture desktop and mobile screenshots for each feature in light and dark themes.
- Record the final computed appearance of shared primitives and feature-specific components.
- Inventory global selectors by owner and classify them as shared, shell, or feature-specific.
- Add/extend a browser screenshot harness before moving complex layout or dark-mode rules.
- Freeze visual changes while establishing parity.

Exit criteria: every moved selector has an identified owner and a baseline screenshot.

### C1 — Stabilize the shared foundation

- Consolidate semantic tokens and compatibility aliases.
- Identify the true shared control/card/table/button primitives.
- Replace feature-specific values that can use semantic tokens without changing contrast.
- Keep the global reset and shared primitives in the global foundation.
- Avoid introducing CSS cascade layers during the first extraction pass; the existing `!important` precedence must be understood before changing cascade semantics.

Exit criteria: no feature layout is moved in this phase; shared controls remain visually identical.

### C2 — Finish Schedule ownership

- Split the large Schedule stylesheet by actual component ownership: workspace/calendar, daily summary, assignment overview/matrix, bulk actions, generation panel and dialogs.
- Move each component's light rules and matching dark overrides together.
- Keep responsive rules beside the component they affect.
- Replace broad generic selectors with scoped `.schedule-*` owners where practical.
- Remove duplicate declarations only after screenshot parity and computed-style review.

Exit criteria: Schedule UI has no internal layout rules left in `src/style.css`; week/month calendar, assignment matrix and generation flows match their baselines.

### C3 — Finish Availability ownership

- Move remaining bulk-form, recurring-rule, serving-preference and availability-row selectors to Availability-owned files.
- Co-locate dark and narrow-viewport overrides with their component.
- Explicitly test fieldsets, checkbox grids, date/time inputs, native select controls and long validation messages.
- Preserve the existing form order and behavior.

Exit criteria: no Availability-specific layout rules remain global; the registration CG-day fix is not affected.

### C4 — Auth, profile and people/request features

- Consolidate Auth and Member Profile control rules under their own owners.
- Move remaining Servants, Requests/Inbox, Notifications, Statistics and Audit selectors.
- Keep shared tables and controls global only when they are truly shared.
- Check account-link dialogs, request actions, notification settings and long user names at mobile widths.

Exit criteria: each feature owns its own light, dark and responsive presentation.

### C5 — Dark-mode and cascade cleanup

- Remove superseded dark-mode rules one feature at a time.
- Replace duplicated literal colors with semantic tokens where parity can be demonstrated.
- Reduce `!important` only when the normal cascade produces the same computed style.
- Do not use broad specificity increases to compensate for ownership mistakes.
- Introduce cascade layers only as a separately reviewed change after all feature imports are explicit and precedence tests exist.

Exit criteria: no duplicate dark-mode declarations for the same component state; theme toggling does not alter layout or interaction geometry.

### C6 — Final QA and acceptance

Use a browser automation and screenshot matrix:

| Viewport | Required checks |
|---|---|
| 320 × 740 | No horizontal overflow; controls and actions remain reachable |
| 360 × 800 | Registration, Availability and bottom navigation |
| 375 × 812 | Forms, dialogs, date/time controls and keyboard behavior |
| 390 × 844 | Schedule calendar, Inbox and More menu |
| 430 × 932 | Full-width forms, cards and matrix overflow |
| 768 × 1024 | Navigation transition and tablet workspace |
| 1024 × 768 | Dense desktop/table layouts |
| 1440 × 900 | Sidebar, content bounds, calendar and admin matrix |

Run every viewport in light and dark themes. Include keyboard navigation, focus visibility, Escape behavior, reduced-motion preference, long names, empty states, loading states, validation errors, and the iOS software keyboard.

Acceptance requirements:

1. No horizontal page overflow.
2. No overlapping controls, legends, labels, or cards.
3. Every action remains reachable above the fixed mobile navigation and safe-area inset.
4. Focus rings stay visible and inside the viewport.
5. Color contrast and status semantics remain consistent.
6. No feature stylesheet imports another feature's stylesheet.
7. Feature-specific selectors are absent from the global stylesheet.
8. All Deno, frontend build, SQL staging, and browser visual tests pass.
9. No production deployment or database change is bundled into CSS extraction.

## Execution guardrails

- Work only on the approved working branch; never merge to `main` as part of modularization.
- One feature/ownership boundary per commit.
- No broad CSS rewrite or automated selector move without a visual baseline.
- Keep database schema, migrations, secrets, Supabase Edge Functions, and production configuration out of CSS work.
- Do not trigger Vercel previews without explicit approval.
- Report moved selector groups, remaining global ownership, visual test coverage, and CI result after each phase.
