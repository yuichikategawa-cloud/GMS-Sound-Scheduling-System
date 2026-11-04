# Part 1 file manifest

## New application boundaries
- `src/app/App.tsx` — new application shell boundary; delegates to legacy application in this part.
- `src/legacy/LegacyApp.tsx` — existing application moved here with only path/import/helper extraction adjustments.
- `src/App.tsx` — backward-compatible re-export.

## New shared/infrastructure ownership
- `src/infrastructure/supabase/client.ts`
- `src/shared/types/core.ts`
- `src/shared/dates/jakartaDate.ts`
- `src/shared/errors/errorText.ts`
- `src/shared/formatters/displayList.ts`
- `src/shared/components/Stat.tsx`
- `src/shared/components/GmsLoader.tsx`
- `src/supabase.ts` and `src/types.ts` remain compatibility facades.

## Module scaffolds
- `src/modules/authentication/`
- `src/modules/organization/`
- `src/modules/people/`
- `src/modules/schedule/`
- `src/modules/assignments/`
- `src/modules/availability/`
- `src/modules/requests/`
- `src/modules/notifications/`
- `src/modules/statistics/`
- `src/modules/administration/`

Each module README states ownership and dependency rules. Feature behavior has not yet been moved into these folders.

## Documentation and configuration
- `docs/architecture/GMS_V2_ARCHITECTURE_BLUEPRINT.md`
- `docs/engineering/PART_1_IMPLEMENTATION_NOTES.md`
- `docs/engineering/PART_1_FILE_MANIFEST.md`
- Root `README.md` rewritten for the new release.
- `.env.example` added; `.env` removed.
- `.gitignore` strengthened to exclude environment-specific files.
- `package.json` renamed/versioned and adds `typecheck`.
- `supabase/setup_push_dispatch.sql` has real project values and the embedded dispatch secret replaced by placeholders.

## Preserved unchanged
- Existing SQL migrations remain in place and in their original order.
- Supabase Edge Function logic remains unchanged.
- PWA manifest, service worker, offline page and icons remain unchanged.
- Main product workflows and CSS remain under the legacy app until later extraction phases.
