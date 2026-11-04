// GMS web-push delivery worker.
// Triggered by Supabase Cron through pg_net. The custom shared secret is required
// because verify_jwt is disabled for this server-to-server function.
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { retryDelaySeconds } from "../_shared/retryBackoff.ts";
import { startLeaseKeeper } from "../_shared/leaseKeeper.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-gms-push-secret, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const BATCH_SIZE = 5;
const LEASE_SECONDS = 180;
const LEASE_RENEW_INTERVAL_MS = 45_000;
const MAX_ATTEMPTS = 8;

type ClaimedQueueItem = {
  notification_id: string;
  attempts: number;
  delivered_endpoints: string[];
  claim_token: string;
};

type PushSubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

type QueueDb = ReturnType<typeof createClient<any>>;
type LeaseKeeper = ReturnType<typeof startLeaseKeeper>;
type ProcessOutcome =
  | "processed"
  | "lost_claim"
  | { status: "processed" | "retry"; delivered: number };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const expectedSecret = Deno.env.get("PUSH_DISPATCH_SECRET") ?? "";
  const receivedSecret = req.headers.get("x-gms-push-secret") ?? "";
  if (!expectedSecret || receivedSecret !== expectedSecret) return json({ error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
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
    const db = createClient<any>(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: queue, error: queueError } = await db.rpc("gms_claim_serving_push_queue", {
      p_batch_size: BATCH_SIZE,
      p_lease_seconds: LEASE_SECONDS,
    });
    if (queueError) throw queueError;

    let processed = 0;
    let delivered = 0;
    let retried = 0;
    let lostClaims = 0;

    for (const item of (queue ?? []) as ClaimedQueueItem[]) {
      const lease = startLeaseKeeper(
        () => renewClaim(db, item),
        LEASE_RENEW_INTERVAL_MS,
      );

      try {
        const outcome = await processQueueItem(db, item, lease);
        if (outcome === "processed") processed++;
        else if (outcome === "lost_claim") lostClaims++;
        else if (outcome.status === "processed") {
          processed++;
          delivered += outcome.delivered;
        } else {
          retried++;
          delivered += outcome.delivered;
        }
      } catch (error) {
        try {
          const release = await releaseForRetry(db, item, error);
          if (release === "released") retried++;
          else lostClaims++;
        } catch (releaseError) {
          // The lease will expire and make the row reclaimable. Do not overwrite
          // checkpoint data with the stale snapshot returned by the claim RPC.
          console.error("Could not safely release push queue claim", releaseError);
          lostClaims++;
        }
      } finally {
        await lease.stop();
      }
    }

    return json({
      ok: true,
      queue_count: queue?.length ?? 0,
      processed,
      delivered,
      retried,
      lost_claims: lostClaims,
    });
  } catch (error) {
    console.error("GMS push dispatch failed", error);
    return json({ error: "Push dispatch failed", detail: String((error as any)?.message ?? error) }, 500);
  }
});

async function processQueueItem(
  db: QueueDb,
  item: ClaimedQueueItem,
  lease: LeaseKeeper,
): Promise<ProcessOutcome> {
  if (!await lease.renewNow()) return "lost_claim";

  const { data: notification, error: notificationError } = await db
    .from("serving_notifications")
    .select("id,recipient_user_id,title,body,notification_type,event_key")
    .eq("id", item.notification_id)
    .maybeSingle();
  if (notificationError) throw notificationError;

  if (!notification) {
    return await completeClaim(db, item, "Notification no longer exists.")
      ? "processed"
      : "lost_claim";
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
    return await completeClaim(
      db,
      item,
      "Push disabled by recipient preference; Inbox notification retained.",
    ) ? "processed" : "lost_claim";
  }

  const { data: subscriptions, error: subscriptionsError } = await db
    .from("serving_push_subscriptions")
    .select("id,endpoint,p256dh,auth")
    .eq("user_id", notification.recipient_user_id);
  if (subscriptionsError) throw subscriptionsError;

  const sentEndpoints = new Set<string>(item.delivered_endpoints ?? []);
  const pending = ((subscriptions ?? []) as PushSubscriptionRow[])
    .filter((sub) => !sentEndpoints.has(sub.endpoint));

  if (pending.length === 0) {
    return await completeClaim(db, item, null) ? "processed" : "lost_claim";
  }

  const payload = JSON.stringify({
    title: notification.title,
    body: notification.body,
    url: "/?tab=notifications",
    tag: notification.event_key || notification.id,
  });

  let hadTransientFailure = false;
  let lastError = "";
  let deliveredCount = 0;

  for (const sub of pending) {
    // Renew immediately before each external side effect. The heartbeat also
    // renews during slow provider calls, preventing a healthy worker's lease
    // from expiring merely because one endpoint is slow.
    if (!await lease.renewNow()) return "lost_claim";

    let sendError: unknown = null;
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        { TTL: 86400, urgency: "normal" },
      );
    } catch (error) {
      sendError = error;
    }

    if (!lease.ownsLease()) return "lost_claim";

    if (!sendError) {
      if (!await checkpointEndpoint(db, item, sub.endpoint)) return "lost_claim";
      sentEndpoints.add(sub.endpoint);
      deliveredCount++;

      const { error: lastUsedError } = await db
        .from("serving_push_subscriptions")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", sub.id);
      if (lastUsedError) console.error("Could not update push subscription last_used_at", lastUsedError);
      continue;
    }

    const statusCode = Number((sendError as any)?.statusCode ?? 0);
    if (statusCode === 404 || statusCode === 410) {
      if (!await lease.renewNow()) return "lost_claim";

      const { error: deleteError } = await db
        .from("serving_push_subscriptions")
        .delete()
        .eq("id", sub.id);
      if (deleteError) {
        hadTransientFailure = true;
        lastError = deleteError.message;
        continue;
      }

      if (!await checkpointEndpoint(db, item, sub.endpoint)) return "lost_claim";
      sentEndpoints.add(sub.endpoint);
    } else {
      hadTransientFailure = true;
      lastError = String((sendError as any)?.body ?? (sendError as any)?.message ?? sendError).slice(0, 1000);
    }
  }

  const allDone = pending.every((sub) => sentEndpoints.has(sub.endpoint));
  if (allDone) {
    return await completeClaim(db, item, null)
      ? { status: "processed", delivered: deliveredCount }
      : "lost_claim";
  }

  const attempts = Number(item.attempts ?? 0) + (hadTransientFailure ? 1 : 0);
  if (attempts >= MAX_ATTEMPTS) {
    return await releaseClaim(
      db,
      item,
      attempts,
      null,
      `Stopped after ${MAX_ATTEMPTS} attempts: ${lastError || "Push delivery incomplete"}`,
      true,
    ) ? { status: "processed", delivered: deliveredCount } : "lost_claim";
  }

  const released = await scheduleRetry(
    db,
    item,
    attempts,
    lastError || "Push delivery will retry.",
  );
  return released ? { status: "retry", delivered: deliveredCount } : "lost_claim";
}

async function renewClaim(db: QueueDb, item: ClaimedQueueItem): Promise<boolean> {
  const { data, error } = await db.rpc("gms_renew_serving_push_queue_claim", {
    p_notification_id: item.notification_id,
    p_claim_token: item.claim_token,
    p_lease_seconds: LEASE_SECONDS,
  });
  if (error) {
    console.error("Push queue lease renewal failed", error);
    throw error;
  }
  return data === true;
}

async function checkpointEndpoint(
  db: QueueDb,
  item: ClaimedQueueItem,
  endpoint: string,
): Promise<boolean> {
  const { data, error } = await db.rpc("gms_checkpoint_serving_push_queue_endpoint", {
    p_notification_id: item.notification_id,
    p_claim_token: item.claim_token,
    p_endpoint: endpoint,
  });
  if (error) throw error;
  return data === true;
}

async function completeClaim(
  db: QueueDb,
  item: ClaimedQueueItem,
  lastError: string | null,
): Promise<boolean> {
  return await releaseClaim(db, item, Number(item.attempts ?? 0), null, lastError, true);
}

async function scheduleRetry(
  db: QueueDb,
  item: ClaimedQueueItem,
  attempts: number,
  lastError: string,
): Promise<boolean> {
  return await releaseClaim(
    db,
    item,
    attempts,
    retryDelaySeconds(attempts),
    lastError,
    false,
  );
}

async function releaseClaim(
  db: QueueDb,
  item: ClaimedQueueItem,
  attempts: number,
  retryDelay: number | null,
  lastError: string | null,
  processed: boolean,
): Promise<boolean> {
  const { data, error } = await db.rpc("gms_release_serving_push_queue_claim", {
    p_notification_id: item.notification_id,
    p_claim_token: item.claim_token,
    p_attempts: attempts,
    p_retry_delay_seconds: retryDelay,
    p_last_error: lastError,
    p_processed: processed,
  });
  if (error) throw error;
  return data === true;
}

async function releaseForRetry(
  db: QueueDb,
  item: ClaimedQueueItem,
  error: unknown,
): Promise<"released" | "lost_claim"> {
  const attempts = Number(item.attempts ?? 0) + 1;
  const message = String((error as any)?.message ?? error).slice(0, 1000);

  if (attempts >= MAX_ATTEMPTS) {
    const completed = await releaseClaim(db, item, attempts, null, `Stopped after ${MAX_ATTEMPTS} attempts: ${message}`, true);
    return completed ? "released" : "lost_claim";
  }

  const released = await releaseClaim(
    db,
    item,
    attempts,
    retryDelaySeconds(attempts),
    message,
    false,
  );
  return released ? "released" : "lost_claim";
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}
