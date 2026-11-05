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
  if (error) throw new Error("Username login is not configured yet. Deploy the username-login Edge Function and try again.");
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
