# Solcollab — Hosting on Cloudflare (Workers + D1 + R2)

**Status:** Draft v0.1 · 2026-10-17 · **Decision:** Cloudflare is the production platform. The Mac mini is now only for local development.
**Companion to:** [DESIGN.md](DESIGN.md) (§3 and §7 summarize this doc) and [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) (Phase 3.5 carries out the migration).

> Prices and limits below were checked on 2026-10-17 against Cloudflare's docs and third-party calculators. Several free-tier figures disagree between sources, so **confirm them in the dashboard** before relying on them. Nothing here is an official Cloudflare quote.

---

## 1. Summary

The whole app runs on Cloudflare's network. There is no server of ours anywhere, so there is nothing at home or on a VPS to patch or expose.

```mermaid
flowchart TB
  U[Browser] --> E
  subgraph Cloudflare
    E[Edge: DNS, cache, WAF, rate-limit rules, Turnstile, Access]
    E --> W[Worker: Hono app + static assets]
    W --> D1[(D1: SQLite database)]
    W --> R2[(R2: images + strokes)]
    W --> RL[Rate-limit binding]
    E -. img.{{DOMAIN}} .-> R2
    C[Cron triggers] --> W
  end
  subgraph Mac mini - dev only
    DEV[vite + workerd local: local D1/R2 state]
  end
  GH[GitHub Actions] -->|wrangler deploy + D1 migrations| W
```

| Piece today (Node on the Mac mini) | On Cloudflare |
|---|---|
| Hono on `@hono/node-server` | **Hono on Workers**. Same framework, different entry point |
| `node:sqlite` file + WAL | **D1** (managed SQLite). Same SQL, async API |
| `LocalDiskStore` (`data/images`) | **R2** bucket via binding. Images later served from `img.{{DOMAIN}}` |
| `sharp` (native) | **jSquash** WebAssembly codecs (`@jsquash/png`, `@jsquash/resize`, `@jsquash/webp`) |
| `WorkQueue` (4 concurrent encodes) | Not needed: each request runs in its own isolate |
| Prompt files read from disk at startup | Prompt files **bundled at build time** and synced to D1 on deploy |
| IP secret in a file | `IP_HASH_SECRET` **Worker secret** |
| `serveStatic` | **Workers Static Assets** with SPA fallback |
| Litestream / rclone | **D1 Time Travel** (30 days on Paid) + weekly D1 export to R2 |
| launchd, tunnel, Mac mini hardening | Nothing. Removed |
| pino + newsyslog | **Workers Logs / Observability** + `wrangler tail` |

## 2. Products, plans, and cost

| Product | Used for | Plan / cost |
|---|---|---|
| **Workers Paid** | The app | **$5/mo**. Includes 10M requests and 30M CPU-ms per month. Overage is $0.30 per million requests and $0.02 per million CPU-ms. Needed because image encoding doesn't fit the free plan's per-request CPU limit. |
| **D1** | Database | Included allowance on Paid is far beyond our needs. Time Travel point-in-time restore: 30 days on Paid. |
| **R2** | Images, strokes, DB exports | Free tier about 10 GB storage plus 1M writes and 10M reads per month. **No egress fees.** Then about $0.015/GB-month. |
| **Workers Static Assets** | JS/CSS/fonts/`index.html` | Static asset requests are free and don't count as Worker invocations. |
| **Rate Limiting binding** | Per-IP/device submit limits | Included (GA). Counts per Cloudflare location, with 10 s or 60 s windows. |
| **Turnstile** | Bot check on submit/report | Free |
| **Access (Zero Trust Free)** | `/admin`, friends-only preview | Free up to 50 users |
| **Domain + DNS + CDN + WAF** | `twolinescrossing.art` (later) | Free plan. Domain about $4 first year, then about $21–33/yr for `.art` (Cloudflare Registrar if it offers `.art`, otherwise Porkbun with nameservers pointed at Cloudflare). |
| *(Optional)* **Images binding** | A fallback encoder if jSquash is ever a problem | 5,000 transformations/mo included, then $0.50 per 1,000. We'd use 2 per submission. |

**Expected bills:**

| Scenario | Rough monthly cost |
|---|---|
| Friends phase (hundreds of drawings) | **$5** (the Workers Paid minimum) |
| Steady hobby use (10k drawings/mo, ~2 GB new storage) | **$5–6** |
| Hacker News spike (~50k visitors, ~10k drawings in a day) | **~$5–8** that month. Gallery reads are mostly cached, and the CPU for 10k encodes at ~0.5 s each is ~5M CPU-ms, within the included allowance. |

**Billing safety:** Cloudflare has no hard spending cap. Set **billing notifications** (e.g. at $10 and $25) on day one. Also keep the app's own `global_daily_cap` (§8 of DESIGN) on. There are public reports of four-figure D1 bills caused by bugs that wrote in a loop, so every write path must be bounded by request count, never by a loop over unbounded data.

---

## 2a. Resources created (2026-10-17)

| What | Value |
|---|---|
| Account | `greenriver` · ID `633582c38425081e03160b12ab8c161d` |
| `workers.dev` subdomain | `aftermath` (so the preview will be `solcollab.aftermath.workers.dev`) |
| D1 `solcollab-staging` | `eca9f8cb-849b-4935-9ada-83c919c8c5b1` (region ENAM) |
| D1 `solcollab-prod` | `ea5ab2ab-8fd5-49b4-b3be-dc8287c90ba6` (region ENAM) |
| R2 buckets | `solcollab-staging`, `solcollab-prod`, `solcollab-backups` |

These IDs aren't secrets. They go into `server/wrangler.jsonc` in Phase 3.5c.

---

## 3. One-time account setup

Do these once, in this order. Steps marked 🔑 involve credentials, so do them yourself in the dashboard or terminal.

1. 🔑 **Create a Cloudflare account** (or use an existing one) and **enable 2FA**.
2. 🔑 **Subscribe to Workers Paid** ($5/mo) under *Workers & Pages → Plans*.
3. **Billing notifications** at $10 and $25 (*Manage Account → Billing → Notifications*).
4. 🔑 **Log in Wrangler** on the Mac mini: `npx wrangler login`.
5. **Create resources** (dev and prod are separate, so local testing never touches real data):
   ```bash
   npx wrangler d1 create solcollab-prod
   npx wrangler d1 create solcollab-staging
   npx wrangler r2 bucket create solcollab-prod
   npx wrangler r2 bucket create solcollab-staging
   npx wrangler r2 bucket create solcollab-backups
   ```
   Paste the returned database IDs into `wrangler.jsonc` (§4).
6. 🔑 **Secrets** (per environment):
   ```bash
   npx wrangler secret put IP_HASH_SECRET --env production      # 32+ random bytes, e.g. `openssl rand -base64 32`
   npx wrangler secret put TURNSTILE_SECRET --env production
   npx wrangler secret put CF_PURGE_TOKEN --env production       # only once the custom domain exists (§7)
   ```
7. **Turnstile widget:** create one in the dashboard, with hostnames `*.workers.dev` for now and `twolinescrossing.art` later. Put the *site key* in `wrangler.jsonc` vars and the *secret* in the secret above.
8. 🔑 **Deploy token for GitHub Actions:** a custom API token with only *Workers Scripts: Edit*, *D1: Edit*, *Workers R2 Storage: Edit*, and *Account Settings: Read*, scoped to this one account. Save it as the `CLOUDFLARE_API_TOKEN` repo secret, plus `CLOUDFLARE_ACCOUNT_ID`.

---

## 4. Wrangler configuration

`server/wrangler.jsonc` (sketch; exact keys to be checked against the current Wrangler docs while implementing):

```jsonc
{
  "name": "solcollab",
  "main": "src/worker.ts",
  "compatibility_date": "2026-10-01",
  "compatibility_flags": ["nodejs_compat"],
  "limits": { "cpu_ms": 2000 },                     // spike: worst case ~550 ms on Cloudflare
  "assets": {
    "directory": "../web/dist",
    "binding": "ASSETS",
    "not_found_handling": "none",         // as built: unmatched paths reach the Worker, which 404s unknown ones
    "run_worker_first": ["/"]              // "/" redirects to a random prompt
  },
  "observability": { "enabled": true },
  "triggers": { "crons": ["17 3 * * *"] },            // nightly: gc, export, cap reset checks
  "rules": [{ "type": "Text", "globs": ["**/*.txt"] }], // bundle prompts/*.txt as strings

  "env": {
    "staging": {
      "vars": { "PUBLIC_DOMAIN": "", "STORE_STROKES": "true", "TURNSTILE_SITE_KEY": "…" },
      "d1_databases": [{ "binding": "DB", "database_name": "solcollab-staging", "database_id": "…", "migrations_dir": "migrations" }],
      "r2_buckets":   [{ "binding": "MEDIA", "bucket_name": "solcollab-staging" }],
      "ratelimits":   [{ "name": "SUBMIT_RL", "namespace_id": "1001", "simple": { "limit": 1, "period": 10 } }]
    },
    "production": {
      "vars": { "PUBLIC_DOMAIN": "{{DOMAIN}}", "STORE_STROKES": "true", "TURNSTILE_SITE_KEY": "…" },
      "d1_databases": [{ "binding": "DB", "database_name": "solcollab-prod", "database_id": "…", "migrations_dir": "migrations" }],
      "r2_buckets":   [{ "binding": "MEDIA", "bucket_name": "solcollab-prod" },
                       { "binding": "BACKUPS", "bucket_name": "solcollab-backups" }],
      "ratelimits":   [{ "name": "SUBMIT_RL", "namespace_id": "1002", "simple": { "limit": 1, "period": 10 } }]
    }
  }
}
```

*As built* (`server/wrangler.jsonc`): with `not_found_handling: "none"`, any request that matches no static file goes to the Worker. The Worker serves the API, images, server-rendered galleries, and `index.html` for app routes, and returns 404 for anything else (so a missing `/assets/x.js` is a real 404, not `index.html`). Only `/` needs `run_worker_first`, because otherwise it would be answered by `index.html` instead of the random-prompt redirect.

---

## 5. Code migration (Node → Workers)

The front end (`web/`) doesn't change, apart from its build output being deployed as static assets. The server changes are contained:

| Area | File(s) | Change |
|---|---|---|
| Entry point | `server/src/index.ts` → new `server/src/worker.ts` | `export default { fetch: app.fetch, scheduled }`. `createApp(env)` receives bindings instead of a config file. |
| Database | `server/src/db/index.ts` | Make the `Database` wrapper **async** with `get/all/run` on `env.DB.prepare(...).bind(...)`. Every caller in `app.ts` and `gallery.ts` gains an `await`. |
| Transactions | `insertSubmission`, `syncPrompts` | D1 has no `BEGIN/COMMIT`. Use **`env.DB.batch([...])`**, which runs as one transaction and rolls back as a unit. `insertSubmission` becomes two statements in one batch: the count upsert, then `INSERT INTO submissions … SELECT count FROM wall_prompt_counts WHERE …` (the number comes from a subquery, since a batch can't pass results between statements). Return the row with `RETURNING number`. |
| Migrations | `server/migrations/*.sql` | Same files, applied by `wrangler d1 migrations apply` (local, staging, prod) instead of the custom runner. Drop the WAL pragmas (D1 manages them). |
| Storage | `server/src/store.ts` | Add `R2Store implements Store` (`MEDIA.put/get/delete`, with `httpMetadata.contentType` and `cacheControl: immutable`). Keep the key-format check. `LocalDiskStore` goes away. |
| Images | `server/src/upload.ts` `processImage` | Replace `sharp` with jSquash: `decode` PNG (check 1000×1000 and the PNG signature first) → flatten alpha onto the background in a loop over the RGBA buffer → blank check (per-channel standard deviation on the same buffer) → `encode` WebP q90 → `resize` to 320×320 → `encode` WebP q80. Initialize the WASM modules once per isolate. Delete `WorkQueue`. |
| Gzip | `validateStrokes` | Replace `node:zlib` with `DecompressionStream('gzip')`, reading with a running byte counter that aborts past 2 MB, and `CompressionStream` to re-gzip. (`nodejs_compat` may also provide `zlib`, but the web streams avoid relying on it.) |
| Prompts | `server/src/prompts.ts` | Keep the parser. Prompt files are imported as text in `server/src/prompt-files.ts` (`lint:prompts` checks that every file is listed). **Sync to D1 (as built):** the Worker compares the bundled catalog's hash with `settings.prompts_hash` the first time an isolate sees the database, and upserts when they differ. There is no separate deploy step. |
| IP hashing | `server/src/privacy.ts` | `IP_HASH_SECRET` from `env`. Daily salt = `HMAC(secret, "YYYY-MM-DD")` via Web Crypto (`crypto.subtle`), so there is no stored salt to rotate. Client IP from the `CF-Connecting-IP` header, which is always set on Workers. |
| Static files | `app.ts` `serveStatic` | Removed. Static Assets handles `/assets/*`. Server-rendered routes (`/`, `/p/:slug`, …) fetch `index.html` with `env.ASSETS.fetch()` and inject the escaped metadata as today. |
| Images route | `GET /img/:id/:file` | Reads from R2 with immutable headers. Kept for `workers.dev`. Once `img.{{DOMAIN}}` exists, image URLs point there and this route becomes a fallback. |
| Config | `server/src/config.ts` | `.env` file → `env` vars and secrets. `.dev.vars` for local secrets (gitignored). |
| Tests | `*.test.ts` | *Done differently:* server tests stay on Vitest in Node and get real local D1/R2 from Wrangler's **`getPlatformProxy`** (`server/src/node/testing.ts`). `@cloudflare/vitest-pool-workers` needs Vitest 4, and the repo uses Vitest 5. |
| Scripts | `scripts/seed.ts`, `browser-check.ts`, `animation-check.ts` | Seed through the local D1/R2 (call the app's own upload endpoint, or write SQL plus `wrangler r2 object put`). Browser checks point at the local `wrangler dev` URL. |

**Keep the seams:** the `Store` interface and an async `Database` interface stay as thin abstractions. If we ever leave Cloudflare, a Node adapter (`node:sqlite` + disk + `sharp`) can be added behind them, but we don't maintain one now.

**CPU and memory check: done (2026-10-17), and jSquash passes.** In local workerd, the full pipeline takes a median of **~94 ms** for a typical drawing and **~165 ms** for the worst input the size cap allows. Peak memory is **~40–50 MB**, against the 128 MB limit. The bundle is 255 KiB gzipped. **Decision: jSquash is the encoder.** The Images binding stays an untested fallback. **Confirmed on Cloudflare** (2026-10-17): **~205 ms** of CPU for a typical drawing and **~500–550 ms** worst case, all requests successful. Set `limits.cpu_ms ≈ 2000` as a guard. Full numbers and how to reproduce them are in [`spikes/jsquash/RESULTS.md`](../spikes/jsquash/RESULTS.md).

---

## 6. Local development (Mac mini)

- `npm run dev` runs Vite plus the Worker locally in **workerd**, either with `@cloudflare/vite-plugin` (one process, with hot module reload for the Worker too) or with `wrangler dev` alongside Vite as today. D1 and R2 are simulated locally and persisted in `.wrangler/state/` (gitignored). No internet or Cloudflare account is needed to develop.
- `npm run db:migrate:local` → `wrangler d1 migrations apply solcollab-staging --local`.
- `npm run seed` fills the local D1/R2 with fixture drawings.
- `npm run dev:remote` *(occasionally)*: runs against the **staging** D1/R2 to catch differences from the real services.
- Everything stays bound to localhost. The Mac mini is never exposed.

---

## 7. Environments and deploys

| Environment | URL | Data | Deployed by |
|---|---|---|---|
| local | `localhost:5173` | `.wrangler/state` | `npm run dev` |
| staging | `solcollab-staging.<account>.workers.dev` | `solcollab-staging` D1/R2 | push to `main` |
| production | `solcollab.<account>.workers.dev` now, `twolinescrossing.art` later | `solcollab-prod` D1/R2 | manual "Deploy production" workflow (button) |

**Deploy pipeline (GitHub Actions):**
1. lint → typecheck → unit tests (including Workers pool tests) → build `web/dist`.
2. `wrangler d1 migrations apply <db> --remote`. Migrations must be **additive and backward-compatible** (add columns or tables; never rename or drop in the same deploy), so the old Worker version keeps working during the switchover.
3. `npm run prompts:sync -- --env <env>`.
4. `wrangler deploy --env <env>`.
5. A smoke test: `GET /healthz`, `GET /api/config`, one gallery page.

**Rollback:** `wrangler rollback` returns to the previous Worker version within seconds. For data mistakes, use **D1 Time Travel**: `wrangler d1 time-travel restore solcollab-prod --timestamp <ISO time>`, which rewinds up to 30 days. R2 objects are never overwritten (keys are per-ULID) and are only deleted by `gc` after 30 days, so images survive a database rewind.

---

## 8. Phase A: friends preview on `workers.dev` (no domain)

This replaces "local soft launch on the Mac mini" (Phase 5 of the implementation plan).

**What works on `workers.dev`:** the whole app, D1, R2, Turnstile, the rate-limiting binding, in-app switches and caps, cron, logs, and **Cloudflare Access with one click** (*Worker → Settings → Domains & Routes → Enable Cloudflare Access*). That last one makes the preview **invite-only**: friends sign in with an emailed one-time code, and nobody else can reach the site at all.

**What does *not* work on `workers.dev`** (all of these need a custom domain):
- The **Cache API** has no effect there, so gallery JSON isn't edge-cached. Fine for friends, not for an HN spike.
- No zone-level **WAF / rate-limiting rules / Bot Fight Mode / the edge kill-switch rule**. The in-app controls (DESIGN §8.1–8.2) cover the friends phase.
- No `img.` subdomain. Images are served through the Worker's `/img/` route.

**Checklist:**
- [ ] Deploy production to `solcollab.<account>.workers.dev`.
- [ ] Enable Access on the `workers.dev` hostname, with an allow-list of friends' emails.
- [ ] Turnstile on, rate limits on, `global_daily_cap` set to e.g. 500.
- [ ] Share the link and watch Workers Logs and the admin stats for a week.

---

## 9. Phase B: public at `twolinescrossing.art`

When we decide to go public:

1. 🔑 **Register the domain** with Cloudflare Registrar if it offers `.art` (search for it in the dashboard), otherwise at Porkbun with the nameservers pointed at Cloudflare. The zone stays on the **Free** plan.
2. **Attach the Worker** as a *Custom Domain* for `twolinescrossing.art` (and `www` → redirect). Set `PUBLIC_DOMAIN`.
3. **R2 custom domain** `img.twolinescrossing.art` on the `solcollab-prod` bucket. Switch image URLs to it, and add a Cache Rule for `img.*` to cache everything with the origin's headers (immutable, 1 year). Update the CSP `img-src`.
4. **Edge caching of gallery JSON:** in the Worker, wrap the cacheable GET handlers with the Cache API (`caches.default.match/put`), using the existing `s-maxage` values. Note that the cache is **per data center**, so each region warms up separately. That's fine.
5. **Security rules on the zone:**
   - WAF managed rules on, Bot Fight Mode on.
   - Rate-limiting rule on `POST /api/submissions` per IP (the Free plan allows one simple rule; check the window limits in the dashboard).
   - The **kill-switch rule**: a custom rule `http.request.method eq "POST" and http.host eq "twolinescrossing.art"` → *Block*, **created disabled**. Write in the runbook where it lives and how to toggle it.
6. **Access:** turn off the friends-only policy on the main hostname. Keep an Access application on `twolinescrossing.art/admin*` and `/api/admin/*`, and verify the `Cf-Access-Jwt-Assertion` JWT in the Worker as well.
7. **Turnstile:** add `twolinescrossing.art` to the widget's hostnames.
8. **Cache purge token:** an API token with only *Zone → Cache Purge* on this zone, stored as `CF_PURGE_TOKEN`. The Worker calls the purge API by URL on hide, delete, and new-wall.
9. **Load test** (k6 from the Mac mini against production, during a quiet hour): 200 rps of gallery reads in both orders + 10 rps of uploads for 10 minutes. The targets: < 1% errors, a > 90% cache hit rate on gallery JSON and images, and a p95 upload under 1.5 s. Afterwards, purge the test drawings with `ops purge --since`.

---

## 10. Operations on Cloudflare

How DESIGN §8 maps onto the new platform:

| Control | Implementation |
|---|---|
| **Switches** (`submissions_open`, `read_only`, `global_daily_cap`, `banner_message`, per-prompt `accepting`) | Same `settings` table in D1. The Worker caches settings in memory per isolate for **≤ 5 s**, so a switch takes effect within seconds without a D1 read on every request. |
| **Edge kill switch** | The disabled WAF rule (Phase B). Instant, and doesn't depend on the Worker. Before the domain exists: `wrangler deploy` with `SUBMISSIONS_HARD_OFF=true`, or the in-app switch. |
| **Rate limits** | The binding (`SUBMIT_RL.limit({ key: ipHash })`) for the short windows (1 per 10 s per IP and per device). The **hourly and daily caps** are a D1 count over `idx_sub_ip` (`created_at > now − 1h`). One indexed query per submission is cheap. Plus the zone rule in Phase B. *The binding counts per location, so a determined attacker spread across regions gets more. The D1 caps are global and are the real backstop.* |
| **Turnstile** | Unchanged (`siteverify` is a subrequest from the Worker). |
| **Moderation and cache purge** | Unchanged logic. Hide or delete also calls the purge API (Phase B) for the image URLs and the first gallery pages. |
| **Admin** | `/admin` and `/api/admin/*` routes in the same Worker, behind Access, with JWT verification. |
| **Ops CLI** | `scripts/ops.ts` calls the **admin API** with an Access *service token* (headers `CF-Access-Client-Id/Secret`), so it works from the Mac mini against any environment: `npm run ops -- --env production close-submissions`. For one-off SQL: `wrangler d1 execute solcollab-prod --remote --command "…"`. |
| **Walls** | `new-wall` = an admin API call. It runs a D1 batch (close the current wall, insert the next) and purges the cache. The "fresh backup" step becomes "note a Time Travel bookmark" (`wrangler d1 time-travel info`) and trigger an export. |
| **Backups** | (1) **D1 Time Travel** gives 30 days of point-in-time restore automatically. (2) A **weekly export**: a scheduled GitHub Action runs `wrangler d1 export solcollab-prod --remote --output` and uploads it to the `solcollab-backups` R2 bucket, keeping 12 weeks. (3) *Optional:* a monthly `rclone sync` of R2 to an external disk on the Mac mini, as an off-Cloudflare copy. **Practice a restore** into `solcollab-staging` once. |
| **Cron** (nightly `scheduled` handler) | `gc` of soft-deleted rows and their R2 objects after 30 days, cleanup of orphaned R2 objects (uploaded, but the D1 insert failed), scheduled wall windows. |
| **Observability** | Workers Logs (structured `console.log` JSON), `wrangler tail` for live debugging, Workers analytics (requests, errors, CPU), D1 and R2 metrics in the dashboard. An external uptime monitor on `/healthz`. An alert on a submission spike: the cron (or a 1-minute cron) checks submissions per minute and posts to ntfy/email. |

---

## 11. Security checklist (Cloudflare edition)

- [ ] Account 2FA. Deploy and purge tokens scoped to the minimum (§3, §9). No global API key anywhere.
- [ ] Secrets only via `wrangler secret` and `.dev.vars` (gitignored). Never in `wrangler.jsonc` or the repo.
- [ ] Uploads always re-encoded (jSquash). User bytes are never served. Strict signature, size, and dimension checks. Bounded gzip decompression.
- [ ] Every D1 write path bounded (one submission = a fixed number of statements). Batch sizes capped. Billing alerts set.
- [ ] Access on admin with JWT verification in code. The ops CLI uses a service token that can be revoked.
- [ ] CSP, `nosniff`, `frame-ancestors 'none'`, `Referrer-Policy` set by the Worker (and on R2 responses via a Transform Rule in Phase B).
- [ ] Staging and production fully separate (DBs, buckets, secrets).
- [ ] The home network isn't involved at all. The Mac mini only runs local dev bound to localhost.

---

## 12. Risks and limits

| Risk | Mitigation |
|---|---|
| jSquash encode too slow or CPU-heavy | Spike done: ~0.17 s worst case locally (§5). Confirm on staging. Fallback: the Images binding. |
| D1 write throughput under a spike | D1 is a single-writer SQLite per database. A submission is 2 small statements, so even 10/s is far below its limits. The app caps protect it. Watch D1 metrics during the load test. |
| Runaway bill from a bug | Billing alerts, bounded writes, `global_daily_cap`, and a staging environment to test against. |
| Per-location rate limiting | Global D1-based hourly/daily caps + Turnstile + the zone rule. |
| Lock-in to Cloudflare | The `Store` and `Database` interfaces + plain SQL migrations + Hono make a move to Node/VPS a bounded port (see "Keep the seams" in §5). The weekly D1 export plus R2 are portable formats. |
| Cache API is per data center | Accept it. Images are the bulk of the traffic and go through the R2 custom domain + CDN cache. |

---

## 13. Step-by-step runbook (summary)

1. ~~**Spike:** jSquash pipeline CPU/memory in `wrangler dev`~~ ✅ done 2026-10-17, jSquash chosen.
2. **Account setup** (§3).
3. **Migrate the code** (§5), with tests on the Workers pool. All existing browser checks pass against local workerd.
4. **Deploy staging**, smoke test, practice a D1 restore.
5. **Deploy production** to `workers.dev` behind Access → **friends preview** (§8).
6. Build Phase 4 ops/safety directly on Workers (if not already done in step 3).
7. When ready: **domain + Phase B** (§9) → load test → public launch.

## Sources
- [Workers pricing calculator](https://makerkit.dev/pricing-calculator/cloudflare) · [Cloudflare free limits 2026](https://eastondev.com/blog/en/posts/dev/20260526-cloudflare-free-limits/) · [Cloudflare cost 2026](https://projectcostestimator.com/blog/cloudflare-cost-2026) · [Cloudflare hidden costs](https://costbench.com/software/cloud-infrastructure/cloudflare-pages-workers/hidden-costs/)
- [Workers Rate Limiting binding](https://docs.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) · [Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/) · [One-click Access for Workers](https://developers.cloudflare.com/changelog/2025-10-03-one-click-access-for-workers) · [Workers protected by Access (blog)](https://blog.cloudflare.com/workers-protected-by-access/)
- [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) · [D1 transactions and trade-offs](https://event-driven.io/en/cloudflare_d1_transactions_and_tradeoffs/) · [Drizzle batch API (D1)](https://orm.drizzle.team/docs/sqlite/batch-api)
- [Images binding](https://developers.cloudflare.com/images/optimization/binding/index.md) · [Images pricing](https://developers.cloudflare.com/images/pricing)
- [jSquash](https://github.com/jamsinclair/jSquash) · [jSquash Cloudflare Worker example](https://github.com/jamsinclair/jSquash/blob/main/examples/cloudflare-worker)
- [Static assets + SPA config (community)](https://smithery.ai/skills/ovachiever/cloudflare-worker-base) · [Cloudflare TLD support](https://developers.cloudflare.com/registrar/domain-registration/tld-support) · [.ART price comparison](https://domainoffer.net/price-compare-art)
