import type { SupabaseClient } from "@supabase/supabase-js";

export async function loadMemberAccountProfile(client: SupabaseClient, userId: string) {
  return client.from("profiles").select("*").eq("id", userId).maybeSingle();
}

export async function saveMemberProfile(
  client: SupabaseClient,
  userId: string,
  payload: Record<string, any>,
  currentEmail: string | null | undefined
): Promise<void> {
  const { error } = await client
    .from("member_profiles")
    .upsert({
      user_id: userId,
      ...payload,
      last_verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, { onConflict: "user_id" });
  if (error) throw error;

  await client.from("profiles").update({ display_name: payload.full_name }).eq("id", userId);
  await client.from("servants").update({ full_name: payload.full_name }).eq("auth_user_id", userId);

  if (payload.email !== currentEmail) {
    const { error: emailError } = await client.auth.updateUser({ email: payload.email });
    if (emailError) console.warn("Profile saved, but email change needs attention.", emailError);
  }
}
