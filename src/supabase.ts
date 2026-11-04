/** Backward-compatible facade. New code should import from infrastructure/supabase. */
export { supabase, isSupabaseConfigured } from "./infrastructure/supabase/client";
export type { SupabaseClientInstance } from "./infrastructure/supabase/client";
