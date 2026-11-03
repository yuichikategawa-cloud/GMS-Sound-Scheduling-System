// GMS web-push delivery worker.
// Triggered by Supabase Cron through pg_net. The custom shared secret is required
// because verify_jwt is disabled for this server-to-server function.
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-gms-push-secret, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const expectedSecret = Deno.env.get("PUSH_DISPATCH_SECRET") ?? "";
  const receivedSecret = req.headers.get("x-gms-push-secret") ?? "";
  if (!expectedSecret || receivedSecret !== expectedSecret) return json({ error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  // Support both legacy service_role env and Supabase's newer named secret-key dictionary.
  let serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!serviceRoleKey) {
    try {
      const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
      serviceRoleKey = String(secretKeys.default ?? "");
    } catch {
      serviceRoleKey = "";
    }
  }
  const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
  const vapidSubject = Deno.env.get("VAPID_SUBJECT") ?? "";
  if (!supabaseUrl || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    return json({ error: "Push dispatcher secrets are incomplete." }, 500);
  }

  try {
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: queue, error: queueError } = await db
      .from("serving_push_queue")
      .select("notification_id, attempts, delivered_endpoints")
      .is("processed_at", null)
      .order("created_at", { ascending: true })
      .limit(40);
    if (queueError) throw queueError;

    let processed = 0;
    let delivered = 0;
    let retried = 0;
    for (const item of queue ?? []) {
      const { data: notification, error: notificationError } = await db
        .from("serving_notifications")
        .select("id,recipient_user_id,title,body,notification_type,event_key")
        .eq("id", item.notification_id)
        .maybeSingle();
      if (notificationError) throw notificationError;
      if (!notification) {
        await db.from("serving_push_queue").update({ processed_at: new Date().toISOString() }).eq("notification_id", item.notification_id);
        processed++;
        continue;
      }

      const { data: preferences, error: preferencesError } = await db
        .from("serving_notification_preferences")
        .select("new_assignments,schedule_changes,confirmation_reminders,availability_deadlines,request_updates")
        .eq("user_id", notification.recipient_user_id)
        .maybeSingle();
      if (preferencesError) throw preferencesError;
      const prefs = preferences ?? {};
      const notificationType = String(notification.notification_type ?? "");
      const preferenceKey =
        notificationType === "new_assignment" || notificationType === "replacement_assigned" ? "new_assignments" :
        notificationType === "schedule_changed" || notificationType === "schedule_unpublished" || notificationType === "assignment_changed" ? "schedule_changes" :
        notificationType.includes("confirm") || notificationType.includes("reminder") ? "confirmation_reminders" :
        notificationType.includes("availability") || notificationType.includes("profile") ? "availability_deadlines" :
        notificationType.includes("request") || notificationType.includes("replacement") || notificationType.includes("swap") ? "request_updates" : null;
      if (preferenceKey && prefs[preferenceKey] === false) {
        await db.from("serving_push_queue").update({
          processed_at: new Date().toISOString(),
          last_error: "Push disabled by recipient preference; Inbox notification retained.",
        }).eq("notification_id", item.notification_id);
        processed++;
        continue;
      }

      const { data: subscriptions, error: subscriptionsError } = await db
        .from("serving_push_subscriptions")
        .select("id,endpoint,p256dh,auth")
        .eq("user_id", notification.recipient_user_id);
      if (subscriptionsError) throw subscriptionsError;

      const sentEndpoints = new Set<string>((item.delivered_endpoints ?? []) as string[]);
      const pending = (subscriptions ?? []).filter((sub: any) => !sentEndpoints.has(sub.endpoint));
      if (pending.length === 0) {
        await db.from("serving_push_queue").update({ processed_at: new Date().toISOString(), last_error: null }).eq("notification_id", item.notification_id);
        processed++;
        continue;
      }

      const payload = JSON.stringify({
        title: notification.title,
        body: notification.body,
        url: "/?tab=notifications",
        tag: notification.event_key || notification.id,
      });
      let hadTransientFailure = false;
      let lastError = "";

      for (const sub of pending) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
            { TTL: 86400, urgency: "normal" },
          );
          sentEndpoints.add(sub.endpoint);
          delivered++;
          await db.from("serving_push_subscriptions").update({ last_used_at: new Date().toISOString() }).eq("id", sub.id);
        } catch (error) {
          const statusCode = Number((error as any)?.statusCode ?? 0);
          if (statusCode === 404 || statusCode === 410) {
            // Expired browser subscription: remove it rather than retry forever.
            await db.from("serving_push_subscriptions").delete().eq("id", sub.id);
            sentEndpoints.add(sub.endpoint);
          } else {
            hadTransientFailure = true;
            lastError = String((error as any)?.body ?? (error as any)?.message ?? error).slice(0, 1000);
          }
        }
      }

      const allDone = pending.every((sub: any) => sentEndpoints.has(sub.endpoint));
      const attempts = Number(item.attempts ?? 0) + (hadTransientFailure ? 1 : 0);
      if (allDone) {
        await db.from("serving_push_queue").update({
          delivered_endpoints: [...sentEndpoints],
          attempts,
          processed_at: new Date().toISOString(),
          last_error: null,
        }).eq("notification_id", item.notification_id);
        processed++;
      } else if (attempts >= 8) {
        await db.from("serving_push_queue").update({
          delivered_endpoints: [...sentEndpoints],
          attempts,
          processed_at: new Date().toISOString(),
          last_error: `Stopped after 8 attempts: ${lastError || "Push delivery incomplete"}`,
        }).eq("notification_id", item.notification_id);
        processed++;
      } else {
        await db.from("serving_push_queue").update({
          delivered_endpoints: [...sentEndpoints],
          attempts,
          last_error: lastError || "Push delivery will retry.",
        }).eq("notification_id", item.notification_id);
        retried++;
      }
    }

    return json({ ok: true, queue_count: queue?.length ?? 0, processed, delivered, retried });
  } catch (error) {
    console.error("GMS push dispatch failed", error);
    return json({ error: "Push dispatch failed", detail: String((error as any)?.message ?? error) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}
