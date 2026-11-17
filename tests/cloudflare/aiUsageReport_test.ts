import { AiBudgetGuard, default as aiWorker } from "../../cloudflare/gms-ai-assistant/src/index.ts";
import { requestAiSchedulingExplanation } from "../../src/features/schedule/services/aiSchedulingAssistant.ts";

type Row = Record<string, string | number | null | undefined>;

class FakeSql {
  userUsage: Array<{ day_key: string; user_key: string; calls: number }> = [];
  globalUsage: Array<{ day_key: string; calls: number }> = [];
  userRequests: Array<{ day_key: string; user_key: string; requests: number }> = [];
  globalRequests: Array<{ day_key: string; requests: number }> = [];
  userCacheHits: Array<{ day_key: string; user_key: string; hits: number }> = [];
  globalCacheHits: Array<{ day_key: string; hits: number }> = [];
  pending: Array<{ day_key: string; user_key: string }> = [];
  cooldown = new Map<string, number>();

  exec<T extends Row = Row>(query: string, ...bindings: Array<string | number>) {
    let rows: T[] = [];
    const month = String(bindings.find((v) => typeof v === "string" && /^\d{4}-\d{2}$/.test(v)) ?? "");
    const table = /FROM (gms_ai_[a-z_]+)/.exec(query)?.[1];
    const column = /SUM\(([a-z_]+)\)/.exec(query)?.[1];
    if (query.includes("SELECT refreshed_at")) {
      const value = this.cooldown.get(String(bindings[0]));
      rows = (value === undefined ? [] : [{ refreshed_at: value }]) as unknown as T[];
    } else if (query.includes("GROUP BY user_key") && table && column) {
      const totals = new Map<string, number>();
      for (const row of this.table(table)) {
        if (String(row.day_key).startsWith(month)) totals.set(String(row.user_key), (totals.get(String(row.user_key)) ?? 0) + Number(row[column] ?? 0));
      }
      rows = [...totals].map(([user_key, total]) => ({ user_key, total })) as unknown as T[];
    } else if (query.includes("SELECT COALESCE(SUM(") && table && column) {
      const source = this.table(table);
      const total = source.filter((r) => String(r.day_key).startsWith(month)).reduce((sum, r) => sum + Number(r[column] ?? 0), 0);
      rows = [{ total }] as unknown as T[];
    } else if (query.includes("SELECT COUNT(*) AS total FROM gms_ai_pending")) {
      rows = [{ total: this.pending.filter((r) => r.day_key.startsWith(month)).length }] as unknown as T[];
    } else if (query.includes("INSERT INTO gms_ai_usage_refresh_cooldown")) {
      this.cooldown.set(String(bindings[0]), Number(bindings[1]));
    }
    return { toArray: () => rows };
  }

  private table(name: string): Array<Record<string, string | number>> {
    const tables: Record<string, Array<Record<string, string | number>>> = {
      gms_ai_user_usage: this.userUsage,
      gms_ai_global_usage: this.globalUsage,
      gms_ai_user_requests: this.userRequests,
      gms_ai_global_requests: this.globalRequests,
      gms_ai_user_cache_hits: this.userCacheHits,
      gms_ai_global_cache_hits: this.globalCacheHits,
      gms_ai_pending: this.pending,
    };
    return tables[name] ?? [];
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

Deno.test("AI usage Durable Object aggregates month totals and per-admin counters", async () => {
  const sql = new FakeSql();
  sql.userUsage = [
    { day_key: "2026-11-01", user_key: "admin-a", calls: 4 },
    { day_key: "2026-11-02", user_key: "admin-b", calls: 2 },
    { day_key: "2026-10-31", user_key: "admin-a", calls: 99 },
  ];
  sql.globalUsage = [
    { day_key: "2026-11-01", calls: 4 },
    { day_key: "2026-11-02", calls: 2 },
    { day_key: "2026-10-31", calls: 99 },
  ];
  sql.userRequests = [{ day_key: "2026-11-01", user_key: "admin-a", requests: 7 }];
  sql.globalRequests = [{ day_key: "2026-11-01", requests: 7 }];
  sql.userCacheHits = [{ day_key: "2026-11-01", user_key: "admin-a", hits: 3 }];
  sql.globalCacheHits = [{ day_key: "2026-11-01", hits: 3 }];
  sql.pending = [{ day_key: "2026-11-02", user_key: "admin-b" }];

  const guard = new AiBudgetGuard({ storage: { sql } });
  const response = await guard.fetch(new Request("https://internal/usage", {
    method: "POST",
    body: JSON.stringify({ action: "usage", monthKey: "2026-11" }),
  }));
  const data = await response.json();

  assert(response.status === 200, "A valid month must return usage data.");
  assert(data.month === "2026-11", "The selected month must be echoed.");
  assert(data.global.modelCalls === 6, "Global model calls must exclude other months.");
  assert(data.global.requests === 7, "Global request totals must be returned.");
  assert(data.global.cacheHits === 3, "Global cache-hit totals must be returned.");
  assert(data.global.pendingCalls === 1, "Pending calls must be counted for the selected month.");
  assert(data.admins.length === 2, "Per-admin usage rows must be aggregated.");
  assert(data.limits.modelCalls === 120 && data.limits.perAdminModelCalls === 60, "Monthly limits must be included.");
});

Deno.test("AI usage Durable Object rejects malformed months and enforces refresh cooldown", async () => {
  const sql = new FakeSql();
  const guard = new AiBudgetGuard({ storage: { sql } });
  const invalid = await guard.fetch(new Request("https://internal/usage", {
    method: "POST",
    body: JSON.stringify({ action: "usage", monthKey: "2026-13" }),
  }));
  assert(invalid.status === 400, "Invalid month values must be rejected.");

  const userKey = "a".repeat(64);
  const reserve = () => guard.fetch(new Request("https://internal/usage-refresh", {
    method: "POST",
    body: JSON.stringify({ action: "reserve_usage_refresh", userKey, now: 1_000 }),
  }));
  const first = await reserve();
  const second = await reserve();
  assert(first.status === 200, "The first refresh should be allowed.");
  assert(second.status === 429, "A second refresh inside the cooldown must be rate limited.");
  const limited = await second.json();
  assert(limited.retryAfterSeconds === 60, "The cooldown response must include retry timing.");
});

Deno.test("AI usage Worker route returns the usage contract and provider status", async () => {
  const originalFetch = globalThis.fetch;
  const usage = {
    month: "2026-11",
    global: { modelCalls: 6, requests: 7, cacheHits: 3, pendingCalls: 1 },
    admins: [{ admin: "Admin 1", modelCalls: 6, requests: 7, cacheHits: 3 }],
    limits: { modelCalls: 120, perAdminModelCalls: 60, requests: 600, perAdminRequests: 200 },
  };
  const guard = {
    fetch: async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/usage-refresh")) return Response.json({ allowed: true });
      if (url.endsWith("/usage")) return Response.json(usage);
      return Response.json({ error: "unexpected_internal_route" }, { status: 404 });
    },
  };
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/auth/v1/user")) return Response.json({ id: "123e4567-e89b-12d3-a456-426614174000" });
    if (url.includes("/rest/v1/profiles")) return Response.json([{ role: "admin" }]);
    return Response.json({ error: "unexpected_fetch" }, { status: 500 });
  };

  try {
    const response = await aiWorker.fetch(new Request("https://worker.example/v1/explain", {
      method: "POST",
      headers: {
        Origin: "https://gms-sound-scheduling-system-test123.vercel.app",
        Authorization: "Bearer test-session-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ kind: "usage_report", month: "2026-11" }),
    }), {
      AI_GUARD: { idFromName: () => "global", get: () => guard },
      SUPABASE_URL: "https://supabase.example",
      SUPABASE_ANON_KEY: "public-anon-key",
      GMS_APP_ORIGIN: "https://gms.example",
      GMS_AI_ENABLED: "false",
    } as never);

    const data = await response.json();
    assert(response.status === 200, "An authenticated admin should receive usage data.");
    assert(data.month === "2026-11", "The Worker must preserve the requested month.");
    assert(data.global.modelCalls === 6 && data.global.requests === 7, "The Worker must preserve global usage counters.");
    assert(data.limits.perAdminModelCalls === 60, "The Worker must preserve the limits contract.");
    assert(data.providerUsageStatus === "not_configured", "Missing provider credentials must be reported without failing usage.");
    assert(typeof data.refreshedAt === "string", "The response must include a refresh timestamp.");
  } finally {
    globalThis.fetch = originalFetch;
  }
});



Deno.test("AI usage Worker reports Durable Object usage failures without exposing internals", async () => {
  const originalFetch = globalThis.fetch;
  const guard = {
    fetch: async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/usage-refresh")) return Response.json({ allowed: true });
      if (url.endsWith("/usage")) return Response.json({ error: "sqlite_unavailable" }, { status: 500 });
      return Response.json({ error: "unexpected_internal_route" }, { status: 404 });
    },
  };
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/auth/v1/user")) return Response.json({ id: "123e4567-e89b-12d3-a456-426614174000" });
    if (url.includes("/rest/v1/profiles")) return Response.json([{ role: "admin" }]);
    return Response.json({ error: "unexpected_fetch" }, { status: 500 });
  };
  try {
    const response = await aiWorker.fetch(new Request("https://worker.example/v1/explain", {
      method: "POST",
      headers: {
        Origin: "https://gms-sound-scheduling-system-test123.vercel.app",
        Authorization: "Bearer test-session-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ kind: "usage_report", month: "2026-11" }),
    }), {
      AI_GUARD: { idFromName: () => "global", get: () => guard },
      SUPABASE_URL: "https://supabase.example",
      SUPABASE_ANON_KEY: "public-anon-key",
      GMS_APP_ORIGIN: "https://gms.example",
      GMS_AI_ENABLED: "false",
    } as never);
    const data = await response.json();
    assert(response.status === 503, "A failed Durable Object usage query must return 503.");
    assert(data.error === "usage_report_unavailable", "The public error contract must remain stable.");
    assert(!JSON.stringify(data).includes("sqlite_unavailable"), "Internal guard errors must not leak to clients.");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("AI usage Worker queries the current billing period and selects today's Workers AI neurons", async () => {
  const originalFetch = globalThis.fetch;
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const requestedProviderRequest: { search?: string } = {};
  const usage = {
    month: today.slice(0, 7),
    global: { modelCalls: 2, requests: 3, cacheHits: 1, pendingCalls: 0 },
    admins: [],
    limits: { modelCalls: 120, perAdminModelCalls: 60, requests: 600, perAdminRequests: 200 },
  };
  const guard = {
    fetch: async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/usage-refresh")) return Response.json({ allowed: true });
      if (url.endsWith("/usage")) return Response.json(usage);
      return Response.json({ error: "unexpected_internal_route" }, { status: 404 });
    },
  };
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/auth/v1/user")) return Response.json({ id: "123e4567-e89b-12d3-a456-426614174000" });
    if (url.includes("/rest/v1/profiles")) return Response.json([{ role: "admin" }]);
    if (url.includes("/billable-usage")) {
      requestedProviderRequest.search = new URL(url).search;
      return Response.json({
        success: true,
        result: [
          {
            ServiceName: "Workers AI",
            ServiceFamilyName: "Workers AI",
            ConsumedUnit: "Neurons",
            ConsumedQuantity: 123,
            ChargePeriodStart: today + "T00:00:00Z",
          },
          {
            ServiceName: "Workers AI",
            ServiceFamilyName: "Workers AI",
            ConsumedUnit: "Neurons",
            ConsumedQuantity: 999,
            ChargePeriodStart: yesterday + "T00:00:00Z",
          },
        ],
      });
    }
    return Response.json({ error: "unexpected_fetch" }, { status: 500 });
  };

  try {
    const response = await aiWorker.fetch(new Request("https://worker.example/v1/explain", {
      method: "POST",
      headers: {
        Origin: "https://gms-sound-scheduling-system-test123.vercel.app",
        Authorization: "Bearer test-session-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ kind: "usage_report", month: today.slice(0, 7) }),
    }), {
      AI_GUARD: { idFromName: () => "global", get: () => guard },
      SUPABASE_URL: "https://supabase.example",
      SUPABASE_ANON_KEY: "public-anon-key",
      GMS_APP_ORIGIN: "https://gms.example",
      GMS_AI_ENABLED: "false",
      CLOUDFLARE_ACCOUNT_ID: "account-id",
      CLOUDFLARE_API_TOKEN: "test-token",
    } as never);

    const data = await response.json();
    assert(response.status === 200, "Usage reporting must succeed with the current billing-period endpoint.");
    assert(requestedProviderRequest.search !== undefined, "The Cloudflare billable-usage endpoint must be requested.");
    assert(requestedProviderRequest.search === "", "The request must omit from/to bounds that can exclude the billing-cycle anchor day.");
    assert(data.providerUsageStatus === "available", "A matching Workers AI neuron metric must be reported as available.");
    assert(data.providerDailyNeurons === 123, "Only the current day's Workers AI neuron quantity must be included.");
    assert(data.providerUsageDate === today, "The provider usage date must be today's UTC date.");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("AI usage Worker keeps usage report available when optional billing metrics throw", async () => {
  const originalFetch = globalThis.fetch;
  const usage = {
    month: "2026-11",
    global: { modelCalls: 2, requests: 3, cacheHits: 1, pendingCalls: 0 },
    admins: [],
    limits: { modelCalls: 120, perAdminModelCalls: 60, requests: 600, perAdminRequests: 200 },
  };
  const guard = {
    fetch: async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/usage-refresh")) return Response.json({ allowed: true });
      if (url.endsWith("/usage")) return Response.json(usage);
      return Response.json({ error: "unexpected_internal_route" }, { status: 404 });
    },
  };
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/auth/v1/user")) return Response.json({ id: "123e4567-e89b-12d3-a456-426614174000" });
    if (url.includes("/rest/v1/profiles")) return Response.json([{ role: "admin" }]);
    if (url.includes("/billable-usage")) throw new Error("billing endpoint unavailable");
    return Response.json({ error: "unexpected_fetch" }, { status: 500 });
  };
  try {
    const response = await aiWorker.fetch(new Request("https://worker.example/v1/explain", {
      method: "POST",
      headers: {
        Origin: "https://gms-sound-scheduling-system-test123.vercel.app",
        Authorization: "Bearer test-session-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ kind: "usage_report", month: "2026-11" }),
    }), {
      AI_GUARD: { idFromName: () => "global", get: () => guard },
      SUPABASE_URL: "https://supabase.example",
      SUPABASE_ANON_KEY: "public-anon-key",
      GMS_APP_ORIGIN: "https://gms.example",
      GMS_AI_ENABLED: "false",
      CLOUDFLARE_ACCOUNT_ID: "account-id",
      CLOUDFLARE_API_TOKEN: "test-token",
    } as never);
    const data = await response.json();
    assert(response.status === 200, "Optional billing failures must not fail usage reporting.");
    assert(data.global.modelCalls === 2, "Usage counters must still be returned.");
    assert(data.providerUsageStatus === "provider_unavailable", "Billing failure must be reported as optional provider data.");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("AI explanation restores exact service names after sending anonymous service labels", async () => {
  const sentBody: { value: Record<string, unknown> | null } = { value: null };
  const snapshot = {
    month: "2026-12",
    summary: {
      serviceCount: 1, requiredPositions: 2, filledRequiredPositions: 1,
      unfilledRequiredPositions: 1, proposedAssignments: 0, frozenServices: 0,
    },
    churches: [{
      label: "GMS Alam Sutera",
      totalServiceCount: 1,
      omittedServiceCount: 0,
      vacancySummary: [{ role: "Monitor", reason: "role_not_qualified", count: 1 }],
      services: [{
        label: "Christmas Celebration Service",
        date: "2026-12-25",
        startTime: "09:00",
        endTime: "11:00",
        special: true,
        frozen: false,
        assignments: [{ servant: "Servant Name", role: "FOH", source: "proposed", qualifiedRoles: ["FOH"], availability: "available" }],
        vacancies: [{ role: "Monitor", required: true, reason: "role_not_qualified", blockedCandidateCount: 1 }],
      }],
    }],
    workload: [],
  };

  const result = await requestAiSchedulingExplanation(
    "https://gms-ai-assistant.example.workers.dev",
    "session-token",
    snapshot as never,
    async (_input, init) => {
      sentBody.value = JSON.parse(String(init?.body));
      return Response.json({
        explanation: "2026-12-25 — Service 1 — Monitor: no eligible candidate was found.",
        cached: false,
      });
    },
  );

  const sentSnapshot = sentBody.value?.snapshot as { churches: Array<{ services: Array<{ label: string; date: string }> }> };
  assert(sentSnapshot.churches[0].services[0].label === "Service 1", "Private service names must be aliased before sending to the Worker.");
  assert(sentSnapshot.churches[0].services[0].date === "2026-12-25", "The service date must be sent to the Worker.");
  assert(result.explanation.includes("2026-12-25 — Christmas Celebration Service — Monitor"), "The displayed explanation must restore the exact original service name.");
});
