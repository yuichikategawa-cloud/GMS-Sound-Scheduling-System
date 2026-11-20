# Legacy branch reconciliation archive

**Archived:** 2026-11-20  
**Target branch:** `develop`  
**Purpose:** preserve the unique historical evidence from two obsolete development branches without reintroducing their old implementation or migration SQL into active application paths.

## Source snapshots

- `chore/staging-push-security-hardening` at `1af08680852b575e6e325be795b53fe151f300a2`
- `chore/supabase-migration-ledger-crosswalk` at `276d3f6028834112f34142cf4a6860d2693e2a53`

Files under `push-hardening/` are preserved from the first source branch. The former workflow file is placed in `workflows/` here as documentation only; it is not an active GitHub Actions workflow. The old `dispatch-push/index.ts` is retained under `superseded-source/` to document the implementation that predates the current modular worker.

The November 9 migration crosswalk is preserved unchanged under `migration-ledger-crosswalk/`. It is a dated historical snapshot, not a current status report.

## Critical execution boundary

**Everything in this archive is inert historical evidence. Do not execute or replay its SQL.**

- SQL files are intentionally outside the repository's active `supabase/migrations/` directory.
- Do not copy these files back into that directory to make migration version numbers line up.
- Do not edit `supabase_migrations.schema_migrations` directly.
- Do not run the staging bootstrap against a populated project. Its source notes specify an empty disposable staging database.
- Any future database change must be authored as a new, separately reviewed migration and validated against both live catalogs first.

Several early migration files on the old push-hardening branch were reconstructed from observed database state. They are not guaranteed to be the exact SQL originally applied to Production. In particular, the archived atomic-claim migration matches the Staging ledger body but not the Production ledger body. The archived claim-renewal migration matches Staging exactly and Production after comment/whitespace normalization. Treat the files as provenance evidence, not as a canonical replica of the live ledger.

The archived notification/push hardening, availability search-path and Apple endpoint allowlist migrations document staging-specific history. They must not be replayed into either connected environment.

## Reconciliation snapshot on 2026-11-20

- Production and Staging both report zero `TRUNCATE` privileges for the `authenticated` role on public tables.
- The live production migration ledger includes the later `revoke_authenticated_public_truncate` entry; the older November 9 crosswalk predates that state.
- Production `dispatch-push` was active at version 7; Staging was active at version 4. Both deployed packages included the modular failure-classification and delivery-target helpers used by current `develop`.
- The archived push-hardening branch's monolithic dispatcher is superseded. Do not restore it over the current worker.
- PR #32 (production custom availability / retention migration source) remains a separate open draft review item. This archive does not approve or merge it.

This is a source-control preservation commit only. It does not apply migrations, alter database objects or data, deploy Edge Functions, change secrets or cron jobs, or modify Vercel configuration.
