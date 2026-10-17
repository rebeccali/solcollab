# Solcollab

You get a short instruction, you draw it, and your drawing joins everyone else's version of the same instruction.

Phase 0 provides a local prompt preview, the curated prompt system, and the workspace tooling. The drawing canvas and galleries come in phase 1. See [the design](docs/DESIGN.md) and [implementation plan](docs/IMPLEMENTATION_PLAN.md).

## Run locally

Use **Node 22.13 or newer** (Node 22 is the project baseline) and npm. With nvm, `nvm install` and `nvm use` select the version in `.nvmrc`.

```sh
npm ci
cp .env.example .env
npm run dev
```

Open <http://127.0.0.1:5173>. Refresh or click **New prompt** to get a different instruction. The browser excludes its previous preview when storage is available; exclusions fall back to the full catalog when all prompts are excluded.

Vite runs on port 5173 and proxies `/api` and `/img` to Hono on port 8787. Both listeners bind to loopback. If you change `PORT` in `.env`, restart dev; Vite reads the same config for its proxy. Image routes return 404 until phase 1.

```sh
npm run lint       # ESLint, formatting, and prompt lint
npm run typecheck
npm test
npm run build
npm start          # serves the built preview and API at 127.0.0.1:8787
```

Use `npm run format` to apply formatting, or `npm run test:watch` while editing the parser. GitHub Actions runs the checks once this repository is pushed; Dependabot tracks npm and Actions updates. No remote is configured yet.

## Workspace

| Directory  | Purpose                                                             |
| ---------- | ------------------------------------------------------------------- |
| `web/`     | Vanilla TypeScript and Vite prompt preview                          |
| `server/`  | Hono API; `tsx watch` in development; compiled JavaScript for start |
| `shared/`  | Types-only package for strokes, pieces, and API contracts           |
| `prompts/` | Curated instructions, one per line                                  |
| `scripts/` | Prompt lint CLI                                                     |

## Configuration

The loader reads the repository's `.env`; process environment variables take precedence. Relative data paths resolve from the repository root, including when running a workspace command.

| Variable               | Default      | Meaning                                                 |
| ---------------------- | ------------ | ------------------------------------------------------- |
| `PORT`                 | `8787`       | API port, integer 1–65535                               |
| `DATA_DIR`             | `./data`     | Future database and image location (gitignored)         |
| `PUBLIC_DOMAIN`        | `{{DOMAIN}}` | Placeholder until a public launch                       |
| `STORE_STROKES`        | `true`       | Future replay storage policy; exactly `true` or `false` |
| `TURNSTILE_SITE_KEY`   | empty        | Reserved for the public launch                          |
| `TURNSTILE_SECRET_KEY` | empty        | Server-only secret, reserved for the public launch      |

## Add prompts

Edit a `.txt` file under `prompts/`. Empty lines and lines beginning with `#` are ignored. A single optional `# weight: 2` comment **before the instructions** gives that file twice the selection weight of a default-weight file. Weights must be finite and positive. Selection first chooses a weighted file, then a uniform prompt within it, so longer files do not dominate.

```text
# weight: 1
A room whose only furniture is sunlight.
A cat surprised by the rain. {slug: surprised-cat}
```

Slugs come from the instruction text. Accents are folded to ASCII; punctuation becomes hyphens. A collision gets `-2`, then `-3`, etc. Files are sorted by filename for deterministic identities. Explicit overrides are reserved first and must be unique, lowercase hyphenated slugs. Keep an override when correcting a typo to preserve a gallery URL. Once galleries exist, avoid adding new text that collides with an existing generated slug.

Run `npm run lint:prompts` before submitting changes. It rejects duplicate instructions (case/whitespace insensitive, across files and regardless of overrides), instructions longer than 140 Unicode characters, trailing whitespace, invalid weights, and malformed overrides. The override suffix does not count toward the text limit. Starter instructions are original text inspired by LeWitt's approach.

`GET /api/prompt/random?exclude=slug-a,slug-b` returns `{slug, text}` with `Cache-Control: no-store`. It considers at most 50 excluded slugs and 8 KiB of query content. Excluding a whole file removes it from that draw's weighted choice. Excluding every prompt resets selection to the full set.

MIT licensed. No AI judging, scoring, or generation of drawings; no user-submitted prompts.
