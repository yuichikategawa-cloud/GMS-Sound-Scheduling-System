# GMS Sound Scheduling System

**Version:** 4.1.0 — Reengineering Part 1 (Foundation and Transition Boundary)

A multi-location church sound-team scheduling application. Part 1 establishes an incremental modular-monolith architecture while keeping the existing application workflows behind a compatibility shell.

## Architecture direction

See [`docs/architecture/GMS_V2_ARCHITECTURE_BLUEPRINT.md`](docs/architecture/GMS_V2_ARCHITECTURE_BLUEPRINT.md) for the complete V2 design, module boundaries, dependency rules, role model, transaction strategy, migration plan and phased roadmap.

See [`docs/engineering/PART_1_IMPLEMENTATION_NOTES.md`](docs/engineering/PART_1_IMPLEMENTATION_NOTES.md) for exactly what this ZIP changes and what remains intentionally deferred.

## Prerequisites

- Node.js 24 LTS (Node.js 22.12 or newer is also supported)
- npm 10 or newer recommended

The repository includes a committed `package-lock.json`.
Use `npm ci` for clean, reproducible installations.
When dependencies change, commit both `package.json` and `package-lock.json`.

- A Supabase project for authentication and database functionality

## Local setup

```bash
cp .env.example .env
# Edit .env and provide your own Supabase URL and publishable/anon key.
npm install
npm run typecheck
npm run build
npm run dev
```

Only a Supabase publishable/anon key belongs in browser variables. Never put a service-role key, VAPID private key, or push-dispatch secret in a `VITE_*` variable or frontend source file.

## Database and deployment safety

**Do not run all SQL files blindly against production.** The supplied SQL history uses manually named `supabase/migrations_*.sql` files and the ZIP does not prove which scripts have already been applied in the live project. Reconcile the live database schema and migration history first, then apply only the verified missing changes in order in a disposable test environment before production.

The old `supabase/schema.sql` is a partial core schema, not a complete schema snapshot. The full feature set is built by subsequent migration scripts. Follow the migration ledger and operational plan in the V2 blueprint.

### Push secret rotation

The earlier project archive included a shared dispatcher secret in `supabase/setup_push_dispatch.sql`. Treat that value as compromised. Before the next push deployment:

1. Generate a new secret (example: `openssl rand -hex 32`).
2. Set it as `PUSH_DISPATCH_SECRET` for the `dispatch-push` Edge Function.
3. Update the matching Vault secret used by the scheduled `pg_net` request.
4. Retire the old secret from the Edge Function and Vault.
5. Do not commit the new secret or include it in a ZIP.

`supabase/setup_push_dispatch.sql` now contains placeholders. Replace them only in a local/private execution copy after preparing the new credentials. Do not commit filled-in credentials.

## Current architecture transition

`src/main.tsx` loads the new `src/app/App.tsx` shell. During Part 1 the shell delegates to `src/legacy/LegacyApp.tsx`. Shared types, Supabase client configuration, generic error formatting, display-list formatting and Jakarta business-date logic have been moved behind shared/infrastructure boundaries. Feature folders are documented scaffolds; feature extraction follows in later parts after regression tests are established.

## Operating principles

- One central administrator manages all church locations.
- Coordinators manually prepare assignments within their authorized locations.
- Servant assignment is always manual; the system validates and assists but does not auto-allocate people.
- Only administrators publish or unpublish final schedules.
- Servants manage their own availability, profile information, confirmations and requests.

The current code's database/frontend role model only has `admin` and `servant`; the coordinator role and location scope are part of the V2 target and are not enabled in Part 1.
