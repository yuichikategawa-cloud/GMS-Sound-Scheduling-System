// Secure username sign-in proxy. Deploy with Supabase CLI.
// Required secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: cors });
  try {
    const { username, password } = await req.json();
    if (typeof username !== "string" || typeof password !== "string" || username.length < 3 || username.length > 40 || password.length < 8 || password.length > 128) {
      return new Response(JSON.stringify({ error: "Invalid username or password." }), { status: 400, headers: cors });
    }
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: userProfile } = await admin.from("profiles").select("id").eq("username", username.trim().toLowerCase()).maybeSingle();
    if (!userProfile) return new Response(JSON.stringify({ error: "Invalid username or password." }), { status: 401, headers: cors });
    const { data: authUser, error: lookupError } = await admin.auth.admin.getUserById(userProfile.id);
    if (lookupError || !authUser.user?.email) return new Response(JSON.stringify({ error: "Invalid username or password." }), { status: 401, headers: cors });
    const publicClient = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await publicClient.auth.signInWithPassword({ email: authUser.user.email, password });
    if (error || !data.session) return new Response(JSON.stringify({ error: "Invalid username or password." }), { status: 401, headers: cors });
    return new Response(JSON.stringify({ access_token: data.session.access_token, refresh_token: data.session.refresh_token, expires_in: data.session.expires_in, token_type: data.session.token_type, user: data.user }), { status: 200, headers: cors });
  } catch {
    return new Response(JSON.stringify({ error: "Unable to sign in. Please try again." }), { status: 400, headers: cors });
  }
});
