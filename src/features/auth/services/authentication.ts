import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSignupMetadata } from "./registration";

export async function registerAccount(client: SupabaseClient, formData: FormData): Promise<void> {
  const metadata = buildSignupMetadata(formData);
  const { error } = await client.auth.signUp({
    email: metadata.email,
    password: String(formData.get("password")),
    options: { data: metadata }
  });
  if (error) throw error;
}

export async function signInWithUsername(client: SupabaseClient, username: string, password: string): Promise<void> {
  const { data, error } = await client.functions.invoke("username-login", {
    body: { username: username.trim(), password }
  });
  if (error) {
    // Supabase returns a FunctionsHttpError for HTTP 4xx/5xx responses.
    // Wrong credentials (401/403) must not be mistaken for a missing function.
    const response = "context" in error && error.context instanceof Response ? error.context : null;
    if (response?.status === 401 || response?.status === 403) {
      throw new Error("Invalid username or password.");
    }
    if (response?.status === 404) {
      throw new Error("Username login is unavailable. Please contact the administrator.");
    }
    throw new Error("Unable to sign in right now. Please try again or contact the administrator.");
  }
  if (!data?.access_token || !data?.refresh_token) throw new Error(data?.error || "Invalid username or password.");
  const { error: sessionError } = await client.auth.setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token
  });
  if (sessionError) throw sessionError;
}

export async function sendPasswordResetLink(client: SupabaseClient, email: string, redirectTo: string): Promise<void> {
  const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo });
  if (error) throw error;
}

export async function updateAccountPassword(client: SupabaseClient, password: string): Promise<void> {
  if (password.length < 8) throw new Error("Password must be at least 8 characters.");
  const { error } = await client.auth.updateUser({ password });
  if (error) throw error;
}
