# GMS Free AI Scheduling Assistant

This Worker provides optional, administrator-only explanations of the Monthly Smart Scheduler preview. It does not create, edit, save, or publish assignments.

## Zero-cost deployment requirements

**Deploy only on Cloudflare's Workers Free plan. Do not upgrade the Cloudflare account to Workers Paid, add AI Gateway credits, or select a paid-only model.**

Cloudflare currently documents:
- Workers AI: 10,000 Neurons per account per day at no charge on Workers Free. Further inference operations on Workers Free fail with an account-limit error instead of continuing as paid usage.
- Workers Free: 100,000 Worker requests per day.
- SQLite-backed Durable Objects on Workers Free: included daily request, compute and storage allowances.

Cloudflare's pricing changes over time. Re-check the official pages before enabling:
- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/

**Important billing boundary:** code cannot change or inspect the billing plan of the Cloudflare account. If the account is on Workers Paid, Cloudflare may bill usage beyond its included AI allocation. To keep this at $0, verify that the account is actually on Workers Free before deploying or enabling this Worker. Do not enable it on a paid account.

## Built-in hard limits

The Worker intentionally imposes much lower limits than Cloudflare's free allowance:

- Maximum **1 model inference across all GMS administrators per UTC day**.
- Maximum **1 model inference per administrator per UTC day**.
- Identical requests are cached for 24 hours; a cache hit does not invoke the model.
- Maximum 12 KB request body and **6 KB normalized scheduling snapshot**.
- At most **3 sampled services per church** and 8 workload rows are sent to AI.
- Maximum **200 completion tokens** per model response.
- No retries, no automatic fallback, no paid-model selection, no AI Gateway, and no browser-side model key.
- When a quota is reached or the service is unavailable, the request fails closed. Scheduling and the normal deterministic optimizer continue to work.

The global and per-administrator counters are serialized by one SQLite-backed Durable Object. A reservation is consumed before inference; failed model calls are not refunded, preventing retry loops from bypassing the cap.

## Privacy and authorization

- The Worker verifies the current Supabase access token with Supabase Auth.
- It reads the caller's own `profiles.role` using the same user token and accepts only `admin`.
- It never uses a Supabase service-role key.
- The browser converts servant IDs into labels such as `Servant 1`, church names into `Church 1`, and service names into `Service 1`.
- Servant names, UUIDs, auth IDs, email, phone, NIJ, CG information, personal notes and availability notes are not sent to the model.
- The Worker validates all model-bound fields against a strict allowlist. Arbitrary free-text fields are not accepted.
- The only model is fixed in code to `@cf/zai-org/glm-4.7-flash`. It is not read from a request or environment variable.

The AI response is advisory text only. Existing eligibility rules, the deterministic optimizer and database revalidation remain authoritative.

## Configuration

The Worker is **disabled by default** in `wrangler.toml`: `GMS_AI_ENABLED = "false"`.

Before deploying, confirm the Cloudflare account is Workers Free and create these Worker secrets:

```sh
npx wrangler secret put SUPABASE_URL --config cloudflare/gms-ai-assistant/wrangler.toml
npx wrangler secret put SUPABASE_ANON_KEY --config cloudflare/gms-ai-assistant/wrangler.toml
npx wrangler secret put GMS_APP_ORIGIN --config cloudflare/gms-ai-assistant/wrangler.toml
```

- `SUPABASE_URL`: the existing GMS Supabase project URL.
- `SUPABASE_ANON_KEY`: the existing public or anon key only. Never use a service-role key.
- `GMS_APP_ORIGIN`: one exact origin, including scheme, for example `https://your-preview-domain.example`. Wildcards are rejected.

Only after those values and the Workers Free plan are reviewed should an administrator manually change `GMS_AI_ENABLED` to `"true"` in the Worker configuration and deploy it:

```sh
npx wrangler deploy --config cloudflare/gms-ai-assistant/wrangler.toml
```

This repository change does not deploy the Worker or change any Cloudflare account setting.

## Connect a non-production GMS Preview

After the Worker is deployed and tested on the free account, set this Vercel environment variable for the **Preview environment only**:

```
VITE_GMS_AI_WORKER_URL=https://gms-ai-assistant.<your-workers-subdomain>.workers.dev/v1/explain
```

Do not set a Production environment value as part of this pilot. The browser also supplies the current Supabase access token; the Worker requires both an allowed exact origin and an administrator profile.

## Local checks

From the repository root:

```sh
deno test --no-lock tests/schedule/aiSchedulingAssistant_test.ts
deno test --no-lock cloudflare/gms-ai-assistant/tests/worker_test.ts
deno check cloudflare/gms-ai-assistant/src/index.ts
```
