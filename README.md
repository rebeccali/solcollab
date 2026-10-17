# Solcollab

You get a short instruction, you draw it, and your drawing joins everyone else's version of the same instruction.

Phases 0–3 implement the drawing → animated submit → gallery flow, prompt exploration, archived walls, and five-second replays. The server runs as a **Cloudflare Worker** (Hono + D1 + R2 + Workers Static Assets). Locally it runs in workerd through `wrangler dev`, with simulated D1 and R2. Operations and moderation remain in phase 4. See [the design](docs/DESIGN.md), [hosting on Cloudflare](docs/HOSTING_CLOUDFLARE.md), and [implementation progress](docs/IMPLEMENTATION_PLAN.md).

## Run locally

Use **Node 22.13 or newer** (Node 22 is the tested baseline) and npm. With nvm, run `nvm install` and `nvm use`.

```sh
npm ci
npm run dev
```

Open <http://127.0.0.1:5173>. Each visit to `/` redirects to a random instruction. Draw with a mouse, touch, or pen; change ink, opacity, size, and paper color; undo/redo; then **Submit**. Drafts stay in this tab across reloads and failed uploads. The toolbar and canvas work with the keyboard: arrows move the pen, Space starts/ends a stroke, Shift+arrows moves farther, `[`/`]` changes brush size, and Ctrl/Cmd+Z undoes.

Vite serves port 5173 and proxies the API and images to the Worker (`wrangler dev`) on port 8787. Both bind to loopback. `npm run dev` applies pending D1 migrations to the local database first. Local D1 and R2 data live in the ignored `server/.wrangler/state/` folder. To use a different Worker port, set `SOLCOLLAB_API_PORT` for Vite and pass `--port` to Wrangler.

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm start
```

`npm start` builds the web app and runs the Worker serving it at <http://127.0.0.1:8787>, the same way Cloudflare does, including server-rendered gallery deep links. `npm run build` also dry-run bundles the production Worker. Migrations (`server/migrations/`, including the first wall) are applied with `wrangler d1 migrations apply`. Prompt files are bundled into the Worker and synced into D1 automatically when their content changes.

## Browse

| Route                                                    | Purpose                                            |
| -------------------------------------------------------- | -------------------------------------------------- |
| `/draw/:slug`                                            | Drawing editor                                     |
| `/p/:slug?sort=new` or `?sort=random`                    | Infinite gallery; click a tile for lightbox/replay |
| `/p/:slug?mine=:id`                                      | Your drawing pinned once, before normal pages      |
| `/p/:slug#:id`                                           | Share a drawing                                    |
| `/p/:slug/:id`                                           | One drawing large, then its prompt's gallery       |
| `/prompts`                                               | Gallery wall of every drawing, tessellated sizes   |
| `/walls`                                                 | Current and archived walls                         |
| `/w/:wall`, `/w/:wall/p/:slug`                           | Archived browsing                                  |
| `/about`                                                 | LeWitt reference and privacy                       |
| `/dev/shatter?pattern=grid&order=row-major&seed=42&n=10` | Animation harness, development only                |

The centered **create** SVG in the bottom bar avoids the last 50 completed instructions when possible. Solcollab sits at the left; the hamburger at the right contains Explore prompts, Past walls, and About & privacy. Gallery Random uses 64 start buckets and wrap-around keyset pagination; IDs break ties between identical shuffle keys. The Report control explains that moderation tools arrive in phase 4.

## Development fixtures and browser checks

Diagnostic fixtures are labeled **Development fixture** and are not public artwork. The seed script writes into the same local D1/R2 state that `npm run dev` uses. Delete `server/.wrangler/state/` to start over.

```sh
npm run seed -- --per-prompt 50
npm run dev
```

The seed CLI also accepts `--only <slug>` and `--archived`. The latter fills a wall, closes it, creates another, and fills that one too; use it only with disposable fixture data.

```sh
npx playwright install chromium firefox webkit
npm run test:browser
SOLCOLLAB_BROWSER=firefox npm run test:browser
SOLCOLLAB_BROWSER=webkit npm run test:browser
npm run test:animation
```

Browser checks use a running local dev server. Set `SOLCOLLAB_BASE_URL` for another local port, `SOLCOLLAB_SCREENSHOTS` for screenshots, or `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` for an existing Chromium binary. They submit test marks, so use disposable data. Animation checks need the dev-only harness. Unit tests cover parsing, validation, transaction rollback, storage, pagination, replay timing and shape partitioning. Server tests run in Node against a fresh in-memory local D1 and R2 from Wrangler's `getPlatformProxy`, so no Cloudflare account is needed. Browser tests compare the replay's final frame with the stored WebP using a small compression allowance.

Chromium, Firefox, and WebKit have been exercised locally. Only physical iPhone frame rates remain unverified. Pen input uses the same constant width as regular touch, without a pressure control or separate device testing requirement. The contact section is commented out while the email is blank. CI runs lint, typecheck, unit tests, build, and dependency audit when pushed; no remote is configured here.

## Configuration

Worker vars live in `server/wrangler.jsonc`: the top level for local development, and `env.staging` / `env.production` for deploys. Secrets come from `server/.dev.vars` locally (see `server/.dev.vars.example`) and from `npx wrangler secret put <NAME> --env <name>` on Cloudflare.

| Name                 | Kind   | Default      | Meaning                                                                                                                               |
| -------------------- | ------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `ENVIRONMENT`        | var    | `local`      | `local`, `staging`, or `production`                                                                                                   |
| `STORE_STROKES`      | var    | `true`       | Store replay data and expose replay controls                                                                                          |
| `PUBLIC_DOMAIN`      | var    | `{{DOMAIN}}` | Reserved for the public launch                                                                                                        |
| `IP_HASH_SECRET`     | secret | —            | Daily-rotating IP hash key. Local dev falls back to a fixed development-only value; staging and production refuse uploads without it. |
| `TURNSTILE_SITE_KEY` | var    | empty        | Reserved for the public launch                                                                                                        |
| `TURNSTILE_SECRET`   | secret | empty        | Reserved for the public launch                                                                                                        |

The image limit is 1.5 MiB for one 1000 × 1000 PNG. Multipart bodies are capped at 2 MiB to leave room for optional stroke gzip (200 KiB); decompression is capped at 2 MiB. Invalid stroke data is discarded without rejecting a valid image. Images are re-encoded as WebP with jSquash (WebAssembly) and stored in R2 with immutable caching. With `STORE_STROKES=false`, new strokes are discarded and existing replays are not exposed; existing files stay in R2.

## Visual direction

Decorative taglines and subheadings have been removed. Editorial paragraphs are TODO placeholders for Rebecca to write in `web/src/main.ts`; the site-description TODO is in `web/index.html`. The contact section remains commented out.

Instruction Card typography, a subtle Graph Paper background, and primary colors for ink and confetti. Compare the [Instruction Card](docs/mockups/instruction-card.html), [Graph Paper](docs/mockups/graph-paper.html), and [Primary Structures](docs/mockups/primary-structures.html) studies. Inter and IBM Plex Mono are self-hosted Latin subsets; their licenses ship with the built assets.

## Add prompts

Edit a `.txt` file under `prompts/`. A new file must also be imported in `server/src/prompt-files.ts` (the lint check enforces this). Empty lines and lines beginning with `#` are ignored. An optional `# weight: 2` comment **before the instructions** gives that file twice the selection weight of a default-weight file. Weights must be finite and positive. Selection first chooses a weighted file, then a uniform prompt within it, so longer files do not dominate.

```text
# weight: 1
A room whose only furniture is sunlight.
A cat surprised by the rain. {slug: surprised-cat}
```

Slugs come from the instruction text. Accents fold to ASCII; punctuation becomes hyphens. A collision gets `-2`, then `-3`, etc. Files are sorted for deterministic identities. Explicit overrides are reserved first and must be unique, lowercase hyphenated slugs. Keep an override when correcting a typo to preserve a gallery URL. Removing a line deactivates it without removing its gallery.

Run `npm run lint:prompts`. It rejects duplicate instructions (case/whitespace insensitive, across files and regardless of overrides), text longer than 1000 Unicode characters, trailing whitespace, invalid weights, and malformed overrides. Override suffixes do not count toward the text limit. Instructions are Sol LeWitt's wall drawing texts from the MASS MoCA retrospective (`prompts/massmoca.txt`), with slugs fixed to each drawing number.

`GET /api/prompt/random?exclude=slug-a,slug-b` returns `{slug, text}` with `Cache-Control: no-store`. It considers at most 50 excluded slugs and 8 KiB of query content. Excluding all prompts resets selection to the full set.

MIT licensed. No AI judging, scoring, or generation of drawings; no user-submitted prompts.
