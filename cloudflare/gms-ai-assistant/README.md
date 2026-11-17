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
- Maximum **10 Worker requests across GMS per UTC day** and **3 requests per administrator per UTC day**, including cache hits.
- Identical requests are cached for 24 hours; a cache hit does not invoke the model.
- Maximum **8 KB streamed request body** and **6 KB normalized scheduling snapshot**.
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


## Isolated staging Worker

For staging diagnostics, use `wrangler.staging.toml` only. It deploys a separate Worker named `gms-ai-assistant-staging` with its own SQLite-backed Durable Object namespace. It does not reuse the production Worker's Durable Object namespace.

The staging config intentionally sets `GMS_AI_ENABLED = "false"`. The authenticated `usage_report` route is still available for diagnostics, while model inference is disabled. Do not change it to `true` until the Cloudflare account's Workers Free plan has been verified.

Set these secrets on the staging Worker only (never copy production secrets):

```sh
npx wrangler secret put SUPABASE_URL --config cloudflare/gms-ai-assistant/wrangler.staging.toml
npx wrangler secret put SUPABASE_ANON_KEY --config cloudflare/gms-ai-assistant/wrangler.staging.toml
npx wrangler secret put GMS_APP_ORIGIN --config cloudflare/gms-ai-assistant/wrangler.staging.toml
```

Use the staging Supabase URL and its matching public anon/publishable key. Set `GMS_APP_ORIGIN` to the exact Vercel Preview origin used for the staging app. Deploy only with:

```sh
npx wrangler deploy --config cloudflare/gms-ai-assistant/wrangler.staging.toml
```

After deployment, configure `VITE_GMS_AI_WORKER_URL` for the exact Vercel Preview branch to the staging Worker's `/v1/explain` endpoint. Never set this value for Production as part of the staging pilot.

### Automated staging-only deployment

The repository's Monthly Smart Scheduler validation workflow can deploy the isolated staging Worker after Deno tests and the frontend build both pass. It runs only for the branch `feature/ai-usage-report-diagnostics`.

Configure these GitHub repository Actions secrets (never put their values in source control):

- `CLOUDFLARE_API_TOKEN`: token scoped to edit Workers and deploy the staging Worker/its Durable Object migration.
- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account ID.
- `STAGING_SUPABASE_URL`: must equal `https://uurgomjrsvzfmcpsnitu.supabase.co`.
- `STAGING_SUPABASE_ANON_KEY`: matching staging publishable key (must begin with `sb_publishable_`).

Configure these GitHub repository Actions variables:

- `STAGING_GMS_APP_ORIGIN`: the exact HTTPS origin of the GMS Preview deployment, under `gms-sound-scheduling-system-*.vercel.app`.
- `CLOUDFLARE_WORKERS_FREE_CONFIRMED`: set to `true` only after confirming the Cloudflare account is on Workers Free.

The workflow checks the staging Supabase project URL and the publishable-key format before deployment. If any required secret or the Workers Free confirmation variable is missing, it skips the deployment and lists only the missing setting names. It never prints secret values. The staging Worker remains configured with `GMS_AI_ENABLED=false`, so this deployment is for authenticated usage-report diagnostics and does not invoke the model.
