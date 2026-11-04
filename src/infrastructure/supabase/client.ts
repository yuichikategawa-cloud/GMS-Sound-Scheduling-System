import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

const isValidSupabaseUrl = (value: string | undefined): value is string => {
  if (!value || value.includes("YOUR_PROJECT")) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ||
      (parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname));
  } catch {
    return false;
  }
};

const validUrl = isValidSupabaseUrl(url);

/** True only when the browser has a plausible Supabase project URL and public key. */
export const isSupabaseConfigured = validUrl && Boolean(key);

/**
 * Browser client singleton. Only a publishable/anon key belongs in VITE_* config.
 * Never place a service-role key, VAPID private key, or dispatch secret here.
 */
export const supabase = validUrl && key
  ? createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export type SupabaseClientInstance = NonNullable<typeof supabase>;
