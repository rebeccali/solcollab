# Spike 3.5a: jSquash image pipeline in workerd

**Date:** 2026-10-17 · **Machine:** the Mac mini (Apple Silicon), Node 22.23.3, Wrangler 4.147.0 (local workerd)
**Packages:** `@jsquash/png` 3.1.1, `@jsquash/webp` 1.5.0 (SIMD build), `@jsquash/resize` 2.1.1

**Verdict: ✅ jSquash passes. We use it as the encoder for Phase 3.5. The Cloudflare Images binding stays a fallback only.**

## What was measured

`src/pipeline.js` rebuilds `server/src/upload.ts → processImage` on jSquash: PNG signature check → decode → 1000×1000 check → flatten alpha onto the background, with per-channel standard deviation (blank check) → WebP q90 (full) → Lanczos resize to 320×320 → WebP q80 (thumb).

Test images (`python3 make_images.py`, all 1000×1000 RGBA):

| Image | PNG in | What it represents |
|---|---|---|
| `sparse` | 11 KB | A few strokes on a transparent background |
| `typical` | 92 KB | 40 strokes on white, the shape the canvas actually sends |
| `noise_cap` | 1.5 MB | Worst case the size cap allows (29% random pixels) |
| `noise_full` | 3.9 MB | Pure noise, beyond the cap (codec stress only) |

## Results

**In workerd (`wrangler dev`, `node bench.mjs`, 15 runs per image after warm-up):**

| Image | Median | p95 | decode | flatten+stats | WebP full | resize | WebP thumb | Output full / thumb |
|---|---|---|---|---|---|---|---|---|
| sparse | 63 ms | 120 ms | 3 | 4 | 35 | 16 | 4 | 17 KB / 4 KB |
| typical | 94 ms | 96 ms | 5 | 4 | 58 | 19 | 8 | 137 KB / 24 KB |
| noise_cap | 164 ms | 166 ms | 13 | 5 | 118 | 20 | 8 | 673 KB / 19 KB |
| noise_full | 164 ms | 168 ms | 4 | 5 | 125 | 20 | 10 | 767 KB / 30 KB |

- **WASM init:** 3 ms, once per isolate.
- **Bundle:** 715 KiB total, **255 KiB gzipped** (`wrangler deploy --dry-run`), well under the Workers size limit.
- **Concurrency** (`node concurrency.mjs`, worst-case image): 1 / 10 / 25 parallel uploads all succeeded. Locally, one isolate runs them one after another (25 in 4.2 s). In production Cloudflare spreads requests across isolates, so this is a local-only queueing effect. The whole workerd process stayed at ~305 MB RSS.

**Cross-check in Node 22 (same V8 and WASM; `node node_bench.mjs`, 10 runs):**

| Image | CPU median (max) | Peak WASM + ArrayBuffer memory | Peak JS heap |
|---|---|---|---|
| sparse | 69 ms (83) | 34 MB | 9 MB |
| typical | 101 ms (140) | 36 MB | 6 MB |
| noise_cap | 169 ms (185) | 39 MB | 8 MB |
| noise_full | 167 ms (167) | 38 MB | 6 MB |

CPU time ≈ wall time (the pipeline is single-threaded and doesn't wait on anything), so the workerd timings are effectively CPU time.

**On Cloudflare (deployed to `workers.dev`, 6 runs per image, CPU time from `wrangler tail`, 2026-10-17):**

| Image | CPU median | CPU max | Outcome |
|---|---|---|---|
| sparse | 270 ms | 502 ms | 6/6 ok (the max includes a cold isolate) |
| typical | 205 ms | 274 ms | 6/6 ok |
| noise_cap | 501 ms | 533 ms | 6/6 ok |
| noise_full | 422 ms | 547 ms | 6/6 ok |

Cloudflare's servers came out at **~2–3× the Mac mini's CPU time**. The worst case is still about half the 1 s target. The spike Worker was deleted right after the measurement.

## Against the targets

| Target (HOSTING_CLOUDFLARE §5) | Result |
|---|---|
| CPU < 1 s per upload, worst case | **~170–185 ms** on the Mac mini. **~500–550 ms on Cloudflare** (typical drawing ~205 ms). ✅ |
| Memory < 128 MB per isolate | **~40–50 MB** peak (WASM memory + buffers + heap). About 2.5× headroom. WASM memory grows once and is reused, not per request. ✅ |
| Cost | ~0.2–0.5 s of CPU per upload on Cloudflare → 10k uploads ≈ 2–5M CPU-ms, against 30M included in Workers Paid. Effectively free. ✅ |

## Caveats and follow-ups
- Measured on Cloudflare too (table above). Set `limits.cpu_ms` to about 2,000 in the real Worker's config, so a pathological input can't burn the 30 s default.
- **WebP sizes are larger than the design's estimate:** typical full images are ~137 KB (DESIGN §5 said 30–120 KB), and adversarial noise reaches ~670 KB. That's fine for R2 costs (100k drawings × 150 KB ≈ 15 GB ≈ $0.08/mo beyond the free 10 GB). Consider q85 for the full image in Phase 3.5 if we want ~25% smaller files; it's a one-line change.
- The SIMD WebP build must be passed to `init()` (jSquash picks its SIMD glue code when SIMD is available, which it is in workerd).
- The flatten loop mirrors `sharp.flatten()` closely but not bit-for-bit. The replay pixel-diff test (Phase 2) needs its threshold re-checked after the port.

## Reproduce
```bash
cd spikes/jsquash
npm install
npm run images          # writes images/*.png (gitignored)
npm run dev             # wrangler dev on 127.0.0.1:8790
node bench.mjs          # in a second terminal
C=10 node concurrency.mjs
node node_bench.mjs
```
