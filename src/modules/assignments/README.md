# Assignments module

**Status:** scaffolded in Part 1; workflow extraction is pending.

## Ownership

This module will own the assignments feature's UI, feature hooks, data access, validation adapters, domain-facing types, and automated tests.

## Rules

- Keep the module independent of other modules' internal files.
- Import shared primitives only from `src/shared/` and infrastructure adapters only from `src/infrastructure/`.
- Enforce authorization in the database as well as the UI for privileged operations.
- Keep database mutations transactional where a business operation changes multiple related records.
- Expose a small public API before another module is allowed to depend on this module.
- Document queries, mutations, events, invariants, and tests before extracting existing behavior.

## Initial dependencies

See [the V2 architecture blueprint](../../../docs/architecture/GMS_V2_ARCHITECTURE_BLUEPRINT.md) for the dependency graph and allowed integration points.
