# Reengineering Part 1 — Foundation and Transition Boundary

## Purpose

Create a safe seam for incremental modernization without replacing active scheduling behavior or assuming the live Supabase schema is identical to the ZIP.

## Included changes

1. `src/legacy/LegacyApp.tsx` contains the existing app implementation, with imports adjusted for its new location.
2. `src/app/App.tsx` is the new application composition boundary and currently renders `LegacyApp` unchanged.
3. `src/App.tsx` remains as a backward-compatible re-export.
4. `src/infrastructure/supabase/client.ts` owns the single browser Supabase client. `src/supabase.ts` is a backward-compatible facade.
5. Core domain types are now owned by `src/shared/types/core.ts`. `src/types.ts` is a compatibility facade.
6. Generic error/display-list formatters and the shared `Stat`/`GmsLoader` UI components are extracted to `src/shared/` and imported by the legacy app.
7. `getJakartaDate()` centralizes business-date calculation for `Asia/Jakarta`; the existing `today()` helper now delegates to it.
8. `src/modules/*/README.md` establishes boundaries for future extraction. The modules are scaffolds, not yet migrated feature implementations.
9. `.env` was removed; `.env.example` contains placeholders only.
10. `setup_push_dispatch.sql` has had the embedded dispatcher secret and project-specific values replaced with placeholders. A new secret must be generated and configured out-of-band.
11. `package.json` is renamed to `gms-sound-scheduling-system` version `4.1.0` and adds a separate `typecheck` command.

## Deliberately not changed

- No database migration was added or modified for live application behavior.
- No role or RLS policy was changed. Coordinator role/scope is designed in the blueprint but must be implemented with a separately tested additive migration.
- No schedule or assignment workflow was rewritten in this part. The existing standard schedule save is non-atomic and is explicitly a Part 2 priority.
- No push dispatcher queue logic was changed. Atomic claim/lease needs a DB function plus concurrency tests.
- No UI component redesign, CSS deletion, or workflow removal was performed.
- No old migration files were deleted, renamed or reordered.

## Security action still required outside this ZIP

The source bundle contained a shared push-dispatch secret in `supabase/setup_push_dispatch.sql`. Part 1 removes the literal from the package, but it cannot rotate a live Supabase Edge Function secret or Supabase Vault entry. Before the next push deployment, generate a new secret (e.g. `openssl rand -hex 32`), set the same new value in the `dispatch-push` Edge Function's `PUSH_DISPATCH_SECRET` and the corresponding Vault secret, and retire the old value. Do not commit the generated value.

## Validation status

This package must be installed and built in the target environment with `npm install`, `npm run typecheck`, and `npm run build`. Static syntax validation parsed all 13 TypeScript/TSX source files with zero syntax diagnostics. A separate relative-import scan checked 14 TS/TSX files (including the Vite declaration file) and found no unresolved local imports. Jakarta date smoke checks passed for the UTC-to-Jakarta day boundary, date round-trip, and invalid-date rejection. A full TypeScript typecheck/build could not be completed: dependencies are not installed, and npm registry access timed out (offline retry had no cached metadata). No lockfile was generated. Run `npm install`, commit the generated lockfile, then run `npm run typecheck` and `npm run build` in CI before deployment. Live Supabase RLS, RPC, cron, Vault and push behavior remain unverified.
