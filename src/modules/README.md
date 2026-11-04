# Feature module ownership

The module folders are introduced in Part 1 as architecture boundaries. They are intentionally scaffolds: live workflows remain in `src/legacy/LegacyApp.tsx` until each module has been extracted and verified in a later part.

## Extraction contract

Every module should own its screen components, feature hooks, feature-specific data access, validation adapters, domain types that are not shared, and tests. A module may depend on `src/shared` and `src/infrastructure`; it may depend on another module only through an explicitly documented public API or domain event.

Modules must not import another module's internal component, hook, query file, or database helper. Do not duplicate Supabase clients or authorization rules.

The application shell owns routing, shared providers, authenticated session bootstrap, and global error boundaries. The shared layer owns cross-cutting primitives, not feature-specific business rules.
