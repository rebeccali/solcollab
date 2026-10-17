# Solcollab — Implementation Plan

**Status:** Draft v0.1 · 2026-10-16
**Progress:** Phases 0–3 implemented; automated browser verification complete. Physical iPhone frame-rate checks remain · 2026-10-17
**Companion to:** [DESIGN.md](DESIGN.md). Section references (§) point there.

This plan turns the design into eight phases. Each phase ends with something you can **run and look at**, and every phase after Phase 1 leaves the app working. Effort figures are rough focused-work days for one person, there to help with ordering, not as commitments.

```mermaid
flowchart LR
  P0[0 Skeleton] --> P1[1 Draw → submit → gallery]
  P1 --> P2[2 Gallery depth]
  P1 --> P3[3 Grid fill + look]
  P1 --> P4[4 Ops + safety]
  P2 --> P5[5 Local soft launch]
  P3 --> P5
  P4 --> P5
  P5 --> P6[6 Go online]
  P6 --> P7[7 Public launch]
```

Phases 2, 3, and 4 depend only on Phase 1 and touch mostly separate code (`web/src/gallery` + `server/routes`, `web/src/shatter` + `web/src/ui`, and `server/admin` + `scripts`). They can run in parallel, or in any order.

---

## Phase 0: Skeleton (≈ 1 day)

**Goal:** an empty app that builds, tests, and runs locally, plus the prompt system, which everything else depends on.

**Tasks**
- [x] `git init`, `.gitignore` (`data/`, `node_modules/`, `.env`), MIT or other license, README with the one-liner.
- [x] npm workspaces: `web/` (Vite + TypeScript) and `server/` (Node 22 + Hono + TypeScript, run with `tsx` in dev).
- [x] Shared tooling: ESLint, Prettier, Vitest, a `tsconfig` base. A `shared/` package for types used on both sides (`Stroke`, `Piece`, API response types).
- [x] `npm run dev` starts Vite (5173) and Hono (8787) together. Vite proxies `/api` and `/img` to Hono.
- [x] Config loader: `.env` → typed config (`PORT`, `DATA_DIR`, `PUBLIC_DOMAIN={{DOMAIN}}`, `STORE_STROKES=true`, `TURNSTILE_*` left empty for now).
- [x] **Prompts** (§4):
  - [x] Starter files `prompts/lewitt.txt`, `prompts/whimsical.txt`, `prompts/architectural.txt`, with 10–20 prompts each.
  - [x] Parser: comments, blank lines, `# weight:` front-matter, `{slug: …}` overrides, slug generation with `-2` collision handling.
  - [x] Weighted random selection (file, then prompt) with `exclude`.
  - [x] `npm run lint:prompts`: no duplicates, ≤ 140 characters, no trailing whitespace.
  - [x] Unit tests for all of the above.
- [x] A GitHub Actions CI workflow running lint, typecheck, test, and build (once there is a remote).

**Exit criteria:** `npm run dev` serves a page showing a random prompt from the files, and refreshing shows a different one. `npm test` passes.

**Completed:** 36 original prompts (12 per file), pinned dependencies and lockfile, local-only dev listeners, and a types-only shared package. The prompt preview excludes the previous instruction via `sessionStorage`; exhausted exclusions fall back to the full catalog. `npm start` also serves the built preview for local verification. The `/` redirect and drawing routes remain in Phase 1 as scoped below. No design decisions changed.

**Verification:** clean `npm ci` on Node 22.23.3; lint, typecheck, all 49 tests, and build passed; npm audit reported zero vulnerabilities. Headless Chromium checks passed against both dev and compiled servers: refresh and button selection, API/image routing, mobile width, retry after an API failure, and disabled storage. CI and Dependabot files are ready; no remote is configured, so hosted CI has not run.

**What's next:** Phase 1 — SQLite and prompt sync, local image storage, the drawing canvas, uploads, and the Newest gallery.

---

## Phase 1: Draw → submit → gallery, end to end (≈ 4–5 days)

**Goal:** the core loop works on localhost, unstyled: get a prompt, draw, submit, and see your drawing among the others.

**1a. Database and storage**
- [x] SQLite via Node 22’s built-in `node:sqlite` (allowed by DESIGN §3.2), WAL pragmas, a tiny migration runner (`server/migrations/001_init.sql`).
- [x] Tables from §5: `walls`, `prompts`, `wall_prompt_counts`, `submissions`, `reports`, `settings`. Seed Wall 1 on first run.
- [x] Sync prompts into the DB at startup (upsert, mark missing ones `active = 0`) and on `SIGHUP`.
- [x] A `Store` interface with `LocalDiskStore` (`data/images/<ulid>/…`, atomic temp-file + rename). `R2Store` comes in Phase 6.

**1b. Canvas** (§2.3)
- [x] 1000×1000 logical canvas with DPR scaling, and two layers (background + ink).
- [x] Pointer Events with coalesced events, `touch-action: none`, pointer capture.
- [x] Stroke model `{color, alpha, size, tool, points: [x, y, pressure, t][]}`. Rendering with perfect-freehand.
- [x] Toolbar: palette + RGBA picker, brush size slider with cursor preview, eraser, undo/redo (keyboard shortcuts too), clear, **background color picker (default white)**, pen input treated like touch (constant width; no pressure toggle).
- [x] Guardrails: Submit disabled until the first stroke, 5,000-point cap, `beforeunload` warning, strokes saved in `sessionStorage`.
- [x] Track the dominant `input_type` (pen/touch/mouse).

**1c. Submit API and pipeline** (§6)
- [x] `POST /api/submissions`: multipart parsing, size limits, `sharp` decode, a 1000×1000 PNG check, flattening onto the background, a blank (uniform color) check, WebP full + thumb.
- [x] Stroke validation with `zod` and a gzip size/decompression cap. Invalid strokes are dropped, not fatal. Skipped entirely when `STORE_STROKES=false`.
- [x] A transaction for the count increment, `number`, `shuffle_key`, and the insert.
- [x] `sharp` concurrency queue (4).
- [x] Anonymous `device_id` cookie, plus `ip_hash` from a daily-rotating salt (use the socket IP locally, and `CF-Connecting-IP` later).
- [x] `GET /img/:key` with immutable cache headers.

**1d. Routes and gallery (Newest only)**
- [x] Client router (History API) for `/draw/:slug`, `/p/:slug`, `/prompts`. `/` redirects to a random prompt on the server.
- [x] `GET /api/prompts/:slug/submissions?sort=new` with keyset pagination.
- [x] Gallery grid with `IntersectionObserver` infinite scroll, lazy thumbnails with explicit sizes.
- [x] `?mine=<id>` pinning (the post-submit page). A **placeholder slot rendered before data arrives** (Grid fill needs this in Phase 3).
- [x] Bottom navigation on all screen sizes: Solcollab at the left, centered outlined **create** SVG (with the `localStorage` exclude list), and a hamburger with Explore prompts / Past walls / About & privacy.
- [x] Submit → plain navigation to the gallery for now (no animation yet).

**Tests:** pagination (keyset edges, the pinned item isn't shown twice), upload pipeline (bad magic bytes, wrong size, a blank image, an oversized file, a malformed strokes file), prompt sync.

**Verification (2026-10-17):** uploads, prompt sync, transaction rollback, atomic writes, validation limits, and pagination are covered by tests. Chromium exercised the full flow and scrolled a 500-fixture gallery. Checkpoint commit: `c2dc21b`.

**What’s next:** deepen gallery browsing and replay (Phase 2), then finish the submit animation (Phase 3).

**Exit criteria:** on localhost you can draw with color, opacity, and a background color, submit, land on the gallery with your drawing pinned first, scroll through 500 seeded drawings smoothly, and hit New prompt / Explore. A seed script (`npm run seed -- --per-prompt 50`) generates random scribbles to test with.

---

## Phase 2: Gallery depth (≈ 3 days)

**Goal:** everything about *looking at* drawings: random order, explore, lightbox, replay, past walls.

- [x] **Random order** (§2.7): bucketed wrap-around cursor `r.<b>.<key>~<id>.<wrapped>` (ID breaks key collisions), a Newest/Random toggle, 🔀 Shuffle again. Tests that a full random pass visits every drawing exactly once.
- [x] **Explore** `/prompts`: counts, a 4-thumb mosaic, sort by active or new, infinite scroll.
- [x] **Lightbox:** full image, name, relative time, "Wall N · Drawing #M", a shareable URL (`/p/:slug#<id>` or `/d/:id`), keyboard navigation (← → Esc), and a **Report** button (wired up in Phase 4).
- [x] **5-second replay** (§2.6): `strokes.json.gz` fetch, the time-compression scheduler (stroke durations proportional, a fixed gap budget, a 16 ms floor, renormalized to exactly 5,000 ms), a rAF renderer that shares the brush code with the editor, play/pause/restart, no autoplay with reduced motion. Hidden when `store_strokes` is off or `strokes_url` is null.
  - [x] Unit test: the schedule always totals 5,000 ms ± 1 frame, for 1 stroke, 1,000 strokes, and a single dot.
  - [x] Visual test: the last replay frame matches `full.webp` (pixel diff under a small threshold).
- [x] **Walls UI:** `/walls` list, `/w/:wall/p/:slug` read-only galleries (no draw button, a "This wall is closed" note), and `GET /api/walls`.
- [x] `GET /api/config`, read by the client at boot (`store_strokes`, `submissions_open`, `current_wall`, `banner_message`).

**Verification (2026-10-17):** fixtures across two walls; random pagination visits all 500 items exactly once including shuffle-key collisions; archived controls are read-only. Chromium, Firefox, and WebKit passed the draw → gallery → lightbox → replay flow. Replay’s final pixels were compared with the stored lossy WebP.

**What’s next:** Grid fill and visual polish (Phase 3).

**Exit criteria:** with seeded data across two walls, you can browse both orders, open any drawing, watch it replay in 5 s, and browse the closed wall read-only.

---

## Phase 3: Grid fill and the look (≈ 5–6 days)

**Goal:** the site looks finished, and the submit moment is delightful.

**3a. UI direction** (§10), ≈ 1.5 days
- [x] Three throwaway HTML mockups of the draw page and gallery: Instruction Card, Graph Paper, Primary Structures.
- [x] **Decision checkpoint:** pick one, or the recommended blend. Record the choice in DESIGN.md §10.
- [x] Design tokens (CSS custom properties: paper, ink, LeWitt primaries, hairline, spacing on an 8 px grid), self-hosted subset fonts, the chosen layout applied to every page.

**3b. Grid fill animation** (§2.5), ≈ 3 days
- [x] `web/src/shatter/`: `types.ts`, `geometry.ts` (Bézier, easing, centroid, shoelace area), `patterns/grid.ts`, `orders.ts` (row-major for v1, plus random and by-ink because they're cheap), `caption.ts`.
- [x] Pattern tests: areas sum to 1, points in bounds, raster no-overlap, same seed → same pieces.
- [x] `engine.ts`: fixed overlay canvas, ImageBitmap snapshot, the Rule → Cut → Lift → Carry → Hang timeline, per-frame destination re-measure, skip on click/tap/key.
- [x] Upload interplay: hold-and-bob while pending (10 s timeout), fall-off-the-wall on failure, return to `/draw` with strokes restored.
- [x] Hang: swap in the real thumbnail, placard ("Wall 1 · Drawing #412 — by you"), geometric confetti.
- [x] Performance fallbacks: 6×6 on low-end devices or narrow screens, skip to Hang when frames drop.
- [x] Reduced motion: rule lines, then a crossfade. `aria-live` announcement.
- [x] Dev harness `/dev/shatter?pattern=&order=&seed=&n=`, with slow motion, scrub, and piece outlines. Built only into dev builds.

**3c. Polish**, ≈ 1 day
- [x] Mobile: bottom bar, a canvas that fits the viewport without page scroll, safe-area insets.
- [x] Accessibility pass: focus order, labels, contrast, keyboard-only drawing tools.
- [x] About page (the LeWitt explanation and privacy; contact section commented out per Rebecca’s instruction).

**Implementation notes (2026-10-17):** selected Instruction Card + subtle Graph Paper, as recommended in DESIGN §10. Three clickable layout studies are saved under `docs/mockups/`. Fonts are served locally with their OFL notices. The shatter engine is shape-independent; the dev-only harness supports seed, density, order, speed, scrub, and outlines. Upload hold/skip/resize, failure restoration, and retry passed browser checks. Reduced motion uses rule lines and a crossfade. Small viewport fitting is measured from the actual instruction and controls.

**Validation remaining:** real iPhone Safari frame-rate measurement. Automated WebKit does not certify iPhone 60 fps. Pen tablets are treated like regular touch, so dedicated tablet validation and pressure tuning are no longer required. The contact email stays blank and its section is commented out until Rebecca provides one.

**Copy follow-up:** decorative taglines and subheadings have been removed. Editorial paragraphs on About, prompt exploration, archived-wall exploration, and the walls index are visible TODOs for Rebecca to write. Drawing instructions, metadata, controls, and operational messages remain functional.

**Final automated verification:** 75 unit/integration tests (two obsolete pressure-curve tests removed after pen input was simplified); lint, typecheck, build, and dependency audit passed (zero reported vulnerabilities). The compiled app passed Chromium, Firefox, and WebKit browser flows, including draft restore, opacity/background rendering, replay image comparison, pinning, sorting, explore, and mobile sizing. Chromium additionally exercised touch input and simulated pen input at different reported pressures, verifying that all new pen points retain constant width. The browser check also confirmed the contact heading and email links are absent; normal-motion checks covered slow uploads, skip, resize, failed uploads, retry, Browser Back, and the 12-second timeout. Production checks confirmed escaped gallery HTML, immutable assets, font license delivery, missing-asset 404s, and absence of the dev harness. Initial JavaScript is approximately 16.2 kB gzipped. Checkpoints: `c2dc21b` (working app) and `ec5aade` (animation and polish), followed by browser lifecycle fixes.

**What’s next:** Phase 4 operations and moderation; do not expose this preview publicly before those controls are implemented.

**Exit criteria:** on iPhone Safari, touch devices, and desktop Chrome/Safari/Firefox, the full loop looks finished and Grid fill runs at 60 fps on the iPhone. The reduced-motion path works.

---

## Phase 4: Ops and safety (≈ 3–4 days)

**Goal:** every control in §8 exists and has been exercised, *before* anyone outside sees the site.

- [ ] **Settings switches** (§8.1): `submissions_open`, `read_only`, `global_daily_cap`, `banner_message`, per-prompt `accepting`, optional `open_from/open_until`. The UI reacts (closed-wall message, banner).
- [ ] **App rate limits** (§8.2): token buckets per `ip_hash` and per `device_id` (1/20 s, 20/h, 100/day), a per-prompt flood guard, and a 429 response with `Retry-After`, which the client shows politely.
- [ ] **Display-name filtering:** Unicode NFKC, strip zero-width and bidi-override characters, ≤ 32 characters, the `obscenity` matcher.
- [ ] **Turnstile:** client widget plus server `siteverify`, behind a flag (off locally and in tests, on in Phase 6).
- [ ] **Reports and moderation** (§8.3): report endpoint (one per device), auto-hide at the threshold, and a "report submitted" confirmation.
- [ ] **Admin UI** `/admin`: review queue (restore/hide/delete/ban), switches, stats (submissions per minute, top prompts, 429 counts), "reload prompts". It listens on a **separate port bound to localhost/Tailscale only** for now; Cloudflare Access is added in Phase 6.
- [ ] **Ops CLI** `scripts/ops.ts`: `close-submissions`, `open-submissions`, `close-prompt`, `purge --prompt/--since/--ip-hash/--device`, `new-wall [--title] [--prompts]`, `export-wall`, `purge-strokes`, `gc`.
- [ ] **Cache-purge hook:** an interface called on hide, delete, and new-wall. A no-op locally; the Cloudflare implementation comes in Phase 6.
- [ ] **Backups:** Litestream to a local folder for now, plus a nightly image `rclone`/`rsync` to an external disk. **Practice a restore once.**
- [ ] **Observability:** pino JSON logs, `/healthz`, a log rotation config.
- [ ] Security headers: CSP, `nosniff`, `frame-ancestors 'none'`, `Referrer-Policy`.

**Exit criteria:** a written "ops drill" passes. Close submissions → the UI shows closed. Spam 50 submissions from one device → rate limited. Report a drawing 3× → hidden. Restore it from admin. Run `new-wall` → Wall 2 is empty and Wall 1 is read-only in `/walls`. Delete the DB → restore from the Litestream copy.

---

## Phase 5: Local soft launch on the Mac mini (≈ 1–2 days)

**Goal:** it runs as a real service on the Mac mini, and a few trusted people use it. Still not public.

- [ ] Production build: Hono serves `web/dist`, the API binds to `127.0.0.1:8787`, and admin is on a separate localhost/Tailscale port.
- [ ] Dedicated non-admin macOS user `_solcollab`. `data/` is owned by that user. A `launchd` plist with `KeepAlive` and logs. (Alternative: an OrbStack container.)
- [ ] Mac mini hardening (§7.1): no sleep, auto-restart after power loss, FileVault, firewall with stealth mode, automatic security updates.
- [ ] Friends-only access: Tailscale (invite to the tailnet, or Tailscale Funnel briefly). **No router port forwarding.**
- [ ] Watch the logs and admin stats for a week. Fix rough edges, and tune the rate limits and the Grid fill timing from real use.
- [x] Pen-input decision: use regular touch behavior; no pressure tuning or dedicated tablet testing (2026-10-17).

**Exit criteria:** a week of friends-only use with no data loss, survives a Mac mini reboot unattended, and no unresolved bugs marked "must fix".

---

## Phase 6: Go online at `twolinescrossing.art` (≈ 2 days, when we decide to)

**Goal:** public on the planned domain, with the home network unexposed and the site ready for an HN-sized spike. **This phase starts only when we decide to go public. Until then the domain stays a placeholder.**

- [ ] Register `twolinescrossing.art`, add it to Cloudflare, and set `PUBLIC_DOMAIN`.
- [ ] **Cloudflare Tunnel** (§7.2 A): `cloudflared` as its own launchd service, an ingress config with a catch-all 404.
- [ ] **Images → R2** (§7.2 E): `R2Store` behind the Store interface, `img.twolinescrossing.art` custom domain, a migration script that copies existing images up, and the CSP updated.
- [ ] **Cloudflare config:** a Cache Rule for `/api/*` JSON (respecting origin `s-maxage`), WAF managed rules, Bot Fight Mode, a rate-limiting rule on `POST /api/submissions`, and a **pre-made, disabled "block all POST" kill-switch rule**. Write down how to flip it.
- [ ] Turnstile turned on (site key + secret).
- [ ] Admin behind **Cloudflare Access**, with JWT verification in the app (or keep admin Tailscale-only).
- [ ] A Cloudflare cache-purge implementation for hide, delete, and new-wall.
- [ ] Litestream → R2. The image sync is no longer needed.
- [ ] An uptime monitor on `/healthz` through the public hostname. An ntfy/email alert on a submission spike.
- [ ] **Load test** with k6 through the tunnel: 200 rps of gallery reads (both orders) + 10 rps of uploads for 10 minutes.

**Exit criteria:** the load test shows < 1% errors, a > 90% cache hit rate, and a p95 upload under 1 s. A port scan of the home IP shows nothing open. The kill switch has been tested.

---

## Phase 7: Public launch (≈ 1 day + watching)

- [ ] Seed each prompt on Wall 1 with a few real drawings (from friends), so no gallery is empty.
- [ ] Final copy for the About page, the privacy note, and a takedown contact address.
- [ ] Open Graph images per prompt (a mosaic) so shared links look good.
- [ ] Launch-day runbook: who watches the admin queue, rate-limit values to tighten under load, when to flip the kill switch, a banner message ready to go.
- [ ] Post it, and watch the stats.

---

## Cross-cutting rules for every phase

- **No AI judging, scoring, or generation** of drawings, ever (DESIGN §1). An optional safety flagger may only queue drawings for human review.
- **No user-submitted prompts.** Prompts come only from `prompts/*.txt`.
- Each phase ends with tests passing, DESIGN.md updated if a decision changed, and a short "what's next" note in this file.

## Deferred / later
- More shatter patterns (bands, triangles, four directions, arcs, hexagons, shards, jigsaw), chosen at random per submission with a stored seed (§2.5.5).
- No pen-pressure tuning or calibration is planned; styluses use the regular touch behavior.
- Rendering images on the server from strokes instead of accepting PNG uploads (§2.6.4).
- Migration to a VPS or to Cloudflare Workers + D1 + R2 (§7.2 D), if the Mac mini becomes the bottleneck.
