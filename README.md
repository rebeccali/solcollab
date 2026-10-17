# Solcollab

You get a short instruction, you draw it, and your drawing joins everyone else's version of the same instruction.

Phases 0–3 implement the local drawing → animated submit → gallery flow, prompt exploration, archived walls, and five-second replays. Operations and moderation remain in phase 4. See [the design](docs/DESIGN.md) and [implementation progress](docs/IMPLEMENTATION_PLAN.md).

## Run locally

Use **Node 22.13 or newer** (Node 22 is the tested baseline) and npm. With nvm, run `nvm install` and `nvm use`.

```sh
npm ci
cp .env.example .env
npm run dev
```

Open <http://127.0.0.1:5173>. Each visit to `/` redirects to a random instruction. Draw with a mouse, touch, or pen; change ink, opacity, size, and paper color; undo/redo; then **Hang on the wall**. Drafts stay in this tab across reloads and failed uploads. The toolbar and canvas work with the keyboard: arrows move the pen, Space starts/ends a stroke, Shift+arrows moves farther, `[`/`]` changes brush size, and Ctrl/Cmd+Z undoes.

Vite serves port 5173 and proxies the API and images to Hono on port 8787. Both bind to loopback. Restart dev after changing `PORT`; the proxy reads the same configuration.

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm start
```

The compiled app runs at <http://127.0.0.1:8787>, including server-rendered gallery deep links. SQLite, images, and the private IP-hashing secret live under the ignored `data/` folder. Migrations and the first wall are created on startup. Prompt files sync at startup; send SIGHUP to reload them. Invalid replacement files leave the existing catalog intact. Node 22 prints an experimental API warning for its built-in SQLite binding.

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

Use an isolated data directory for diagnostic fixtures. They are labeled **Development fixture** and are not public artwork.

```sh
DATA_DIR=/tmp/solcollab-fixtures npm run seed -- --per-prompt 50
DATA_DIR=/tmp/solcollab-fixtures npm run dev
```

The seed CLI also accepts `--only <slug>` and `--archived`. The latter fills a wall, closes it, creates another, and fills that one too; use it only with disposable fixture data.

```sh
npx playwright install chromium firefox webkit
npm run test:browser
SOLCOLLAB_BROWSER=firefox npm run test:browser
SOLCOLLAB_BROWSER=webkit npm run test:browser
npm run test:animation
```

Browser checks use a running local dev server. Set `SOLCOLLAB_BASE_URL` for another local port, `SOLCOLLAB_SCREENSHOTS` for screenshots, or `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` for an existing Chromium binary. They submit test marks, so use disposable data. Animation checks need the dev-only harness. Unit tests cover parsing, validation, transaction rollback, storage, pagination, replay timing and shape partitioning. Browser tests compare the replay's final frame with the stored WebP using a small compression allowance.

Chromium, Firefox, and WebKit have been exercised locally. Only physical iPhone frame rates remain unverified. Pen input uses the same constant width as regular touch, without a pressure control or separate device testing requirement. The contact section is commented out while the email is blank. CI runs lint, typecheck, unit tests, build, and dependency audit when pushed; no remote is configured here.

## Configuration

The loader reads the repository's `.env`; process environment variables win. Relative data paths resolve from the repository root.

| Variable               | Default      | Meaning                                      |
| ---------------------- | ------------ | -------------------------------------------- |
| `PORT`                 | `8787`       | API port, integer 1–65535                    |
| `DATA_DIR`             | `./data`     | SQLite, images, and private local secret     |
| `PUBLIC_DOMAIN`        | `{{DOMAIN}}` | Reserved for a public launch                 |
| `STORE_STROKES`        | `true`       | Store replay data and expose replay controls |
| `TURNSTILE_SITE_KEY`   | empty        | Reserved for the public launch               |
| `TURNSTILE_SECRET_KEY` | empty        | Reserved server-only secret                  |

The image limit is 1.5 MiB for one 1000 × 1000 PNG. Multipart bodies are capped at 2 MiB to leave room for optional stroke gzip (200 KiB); decompression is capped at 2 MiB. Invalid stroke data is discarded without rejecting a valid image. Images are re-encoded as WebP with immutable caching. With `STORE_STROKES=false`, new strokes are discarded and existing replays are not exposed; existing files stay on disk.

## Visual direction

Decorative taglines and subheadings have been removed. Editorial paragraphs are TODO placeholders for Rebecca to write in `web/src/main.ts`; the site-description TODO is in `web/index.html`. The contact section remains commented out.

Instruction Card typography, a subtle Graph Paper background, and primary colors for ink and confetti. Compare the [Instruction Card](docs/mockups/instruction-card.html), [Graph Paper](docs/mockups/graph-paper.html), and [Primary Structures](docs/mockups/primary-structures.html) studies. Inter and IBM Plex Mono are self-hosted Latin subsets; their licenses ship with the built assets.

## Add prompts

Edit a `.txt` file under `prompts/`. Empty lines and lines beginning with `#` are ignored. An optional `# weight: 2` comment **before the instructions** gives that file twice the selection weight of a default-weight file. Weights must be finite and positive. Selection first chooses a weighted file, then a uniform prompt within it, so longer files do not dominate.

```text
# weight: 1
A room whose only furniture is sunlight.
A cat surprised by the rain. {slug: surprised-cat}
```

Slugs come from the instruction text. Accents fold to ASCII; punctuation becomes hyphens. A collision gets `-2`, then `-3`, etc. Files are sorted for deterministic identities. Explicit overrides are reserved first and must be unique, lowercase hyphenated slugs. Keep an override when correcting a typo to preserve a gallery URL. Removing a line deactivates it without removing its gallery.

Run `npm run lint:prompts`. It rejects duplicate instructions (case/whitespace insensitive, across files and regardless of overrides), text longer than 140 Unicode characters, trailing whitespace, invalid weights, and malformed overrides. Override suffixes do not count toward the text limit. Starter instructions are original text inspired by LeWitt's approach.

`GET /api/prompt/random?exclude=slug-a,slug-b` returns `{slug, text}` with `Cache-Control: no-store`. It considers at most 50 excluded slugs and 8 KiB of query content. Excluding all prompts resets selection to the full set.

MIT licensed. No AI judging, scoring, or generation of drawings; no user-submitted prompts.
