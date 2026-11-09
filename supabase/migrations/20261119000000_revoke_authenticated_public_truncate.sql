-- Remove the one table privilege that bypasses row-level security.
-- Keep existing SELECT/INSERT/UPDATE/DELETE grants intact; RLS remains the
-- authorization boundary for authenticated servant and administrator writes.
BEGIN;

REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM authenticated;

-- Repository migrations are applied as postgres. Prevent future postgres-owned
-- public tables from inheriting TRUNCATE for authenticated API sessions.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE ON TABLES FROM authenticated;

COMMIT;
