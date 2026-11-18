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

## GMS safety thresholds and enforcement

The Worker is designed for a Workers Free account only. The source currently sets these account-level safety thresholds:

- **7,500 Workers AI Neurons per UTC day** (75% of the 10,000-Neuron Free allocation).
- **75,000 Workers requests per UTC day** (75% of the 100,000-request Workers Free allocation).

The explain route checks Cloudflare account analytics before serving a cached explanation or starting a model inference. If the analytics query is unavailable, the route fails closed. If either threshold has been reached, it refuses further work. The provider's Free-plan limits remain the final platform-level boundary.

**Important enforcement limitation:** Cloudflare account analytics are not an atomic quota-reservation API. The checks are based on the usage visible when each request queries analytics; concurrent requests or analytics reporting delay can allow the observed usage to cross the GMS safety threshold before every request sees the updated total. These thresholds must therefore not be described as a mathematically strict atomic cap. Do not use a Workers Paid account, enable paid AI Gateway credits, or assume this code can prevent charges on a paid account.

The SQLite-backed Durable Object serializes GMS usage accounting, records pending model requests and successful calls, stores cached explanations, and rate-limits manual usage refreshes. Its counters support diagnostics; they do not atomically reserve Cloudflare account Neurons or total account Worker requests.

Other request limits in the Worker:

- **8 KB** maximum streamed request body.
- **7.5 KB** maximum normalized scheduling snapshot.
- At most **3 sampled services per church** and **8 workload rows** are sent to AI.
- **768 completion tokens** maximum per model response.
- Identical explanations are cached for **24 hours**. Cache hits do not invoke the model but still consume a Worker request.
- No paid-model fallback, no AI Gateway, no browser-side model key, and no automatic inference retry.

When a quota is reached or the service is unavailable, the request fails closed. The normal deterministic scheduler remains available and authoritative.

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

The Production Worker is configured with `GMS_AI_ENABLED = "true"` following explicit approval and confirmation that the Cloudflare account is on Workers Free. The configuration declares all five runtime secrets as required, so Wrangler will refuse a deploy if any are missing.

Before deployment, open **Workers & Pages → gms-ai-assistant → Settings → Variables and Secrets** and create all of the following as Secret values. Add them together before deploying; do not deploy a partially configured Worker.

- `SUPABASE_URL`: `https://zqpmzvhudxprzdfijrtu.supabase.co`.
- `SUPABASE_ANON_KEY`: the production Supabase publishable/anon key only. Never use a service-role key.
- `GMS_APP_ORIGIN`: `https://gms-sound-scheduling-system.vercel.app`.
- `CLOUDFLARE_ACCOUNT_ID`: the account identifier used for daily Workers AI analytics.
- `CLOUDFLARE_API_TOKEN`: a token with **Account Analytics: Read** only, used by the Worker to query daily Neuron and request usage. This runtime token is separate from the Wrangler login used to deploy.

Use the Cloudflare dashboard to add the five secrets together, then click Deploy once. Wrangler's `secret put` command creates and deploys a new Worker version immediately, so adding required secrets one at a time through that command can attempt intermediate deployments. Secret values must never be committed to Git or pasted into chat.

After verifying that all five names are present, authenticate Wrangler with device login if localhost callbacks are unavailable, then deploy the production config only:

```sh
npx wrangler login --device --browser=false
npx wrangler whoami
npx wrangler deploy --config cloudflare/gms-ai-assistant/wrangler.toml
```

Do not use `wrangler.staging.toml` for production. The deploy command validates the five required secret names before uploading. After deployment, confirm the Worker version is active and run the authentication, origin, and fail-closed usage checks documented in the release checklist.

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

The isolated staging config currently sets `GMS_AI_ENABLED = "true"` for the approved staging-only AI pilot. Keep this configuration isolated from Production and verify that the Cloudflare account is on Workers Free before deploying or invoking inference. The Production config remains `false`.

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

Deployment configuration is validated by the branch-specific CI workflow before any staging Worker changes.

The repository's Monthly Smart Scheduler validation workflow can deploy the isolated staging Worker after Deno tests and the frontend build both pass. It runs only for the branch `feature/ai-usage-report-diagnostics`.

Configure these GitHub repository Actions secrets (never put their values in source control):

- `CLOUDFLARE_API_TOKEN`: token scoped to edit Workers and deploy the staging Worker/its Durable Object migration.
- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account ID.
- `STAGING_SUPABASE_URL`: must equal `https://uurgomjrsvzfmcpsnitu.supabase.co`.
- `STAGING_SUPABASE_ANON_KEY`: matching staging publishable key (must begin with `sb_publishable_`).

Configure these GitHub repository Actions variables:

- `STAGING_GMS_APP_ORIGIN`: the exact HTTPS origin of the GMS Preview deployment, under `gms-sound-scheduling-system-*.vercel.app`.
- `CLOUDFLARE_WORKERS_FREE_CONFIRMED`: set to `true` only after confirming the Cloudflare account is on Workers Free.

The workflow checks the staging Supabase project URL, publishable-key format and explicit Workers Free confirmation before deployment. If any required secret or confirmation is missing, it skips deployment and lists only missing setting names. It never prints secret values. The isolated staging Worker configuration is enabled for the staging pilot; do not copy that setting into Production.
