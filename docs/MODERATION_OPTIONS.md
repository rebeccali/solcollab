# AI image moderation: options

Status: **options for review**. Nothing here is decided or built yet.

## What we're checking, and the constraints

- **What comes in:** every submission reaches `POST /api/submissions` as a 1000 × 1000 PNG plus optional stroke data. `processImage` in `server/src/upload.ts` flattens it onto the background and writes `full.webp` / `thumb.webp`. The in-app canvas is not the only way to send a PNG: anyone can POST any 1000 × 1000 PNG straight to the API, including a photo. So "drawn" and "uploaded" images have to be treated the same way, and moderation should run on the **server's flattened image** (`flat` in `processImage`), never on anything the client says about itself.
- **What counts as inappropriate:** sexual content and nudity, CSAM (the one category with legal reporting duties), graphic violence and gore, self-harm, hate symbols (swastikas and the like), and **written words**. Drawings often contain text, and slurs or doxxing written in the image get past image classifiers that only look for nudity.
- **Design rules this has to respect** (`docs/DESIGN.md`):
  - §1: no AI judging, scoring, or ranking of drawings. An automated check may only produce **safety labels**. It never produces quality scores, and nothing it outputs feeds ordering or display.
  - §8.3: drawings go live immediately, and an automated classifier "may flag drawings into the human review queue, and must never block". Options in the policy section below that auto-hide or hold drawings would **change §8.3**. That is your call.
- **Drawings are not photos.** Most off-the-shelf NSFW models are trained on photographs. On line art and flat color they miss crude drawings and flag harmless ones (skin-tone fills, curvy shapes). A LeWitt-style grid of lines could also look like a hate symbol to a weak model. Accuracy on *drawings* is the main thing to test.

## Option A: Local open-source classifier (the §8.3 "future option")

Run a small model inside the server process with `onnxruntime-node`, on the `flat` buffer from `processImage`. Candidates: an NSFW ViT classifier exported to ONNX (several on Hugging Face), OpenNSFW2, or NSFWJS-style models. Some are trained on drawn or anime content as well as photos.

- **Pros:** free per image; no data leaves the Mac mini; tens of milliseconds on CPU; no outside service to go down; fits the design doc as written.
- **Cons:** covers sexual content only (and sometimes "gore"). It misses hate symbols, written slurs, and most context. Accuracy on drawings is uneven, so the threshold needs tuning on our own test set. It adds a model file (~10–350 MB) and a native dependency to the deploy.
- **Good for:** a cheap first pass on every submission.

## Option B: Hosted moderation API

Send the flattened image (downscaled, e.g. to 512 px) to a moderation endpoint and store the category scores it returns.

| Service | Image categories (roughly) | Notes |
|---|---|---|
| OpenAI `omni-moderation` | sexual, violence, self-harm | Free to use at the time of writing. Image support covers fewer categories than text. |
| Google Cloud Vision SafeSearch | adult, racy, violence, medical, spoof | Likelihood buckets, not scores. Pay per image after a free tier. |
| AWS Rekognition `DetectModerationLabels` | explicit, suggestive, violence, hate symbols, and others | Has labels specifically for *illustrated* content. Pay per image. |
| Azure AI Content Safety | hate, sexual, violence, self-harm, with severity levels | Pay per image. |
| Hive Moderation | broad, including drawn/anime content, hate symbols, and text in images | Commercial. Strong on illustration. Priced by quote/volume. |

- **Pros:** little to build; vendors maintain the models; several cover hate symbols; scores are easy to threshold.
- **Cons:** user drawings go to a third party, so the privacy notice needs updating. Each submission costs a network call that can fail. Accuracy on drawings varies by vendor and needs testing. Pricing and free tiers change, so check them before choosing.

## Option C: Vision LLM with a written policy (e.g. Claude Haiku 5.5)

Send the downscaled image plus the prompt text to a vision model. A short policy prompt asks for **structured output only**, for example:

```json
{ "flag": true, "categories": ["sexual", "text_slur"], "severity": "high", "note": "explicit drawing, lower left" }
```

- **Pros:** the best fit for *drawings*. It reads written text in the image, recognizes hate symbols in context, and can tell a grid of lines from a swastika. The policy is plain English in the repo, so changing it is a text edit. The `note` field gives the admin queue a reason to show next to each flag.
- **Cons:** costs more per image than A or B, but a 512 px image is a few hundred input tokens, so it is likely cents per hundred drawings. Check current pricing. Latency is 1–3 s. Drawings go to a third party (same privacy-notice change as B). Output can vary slightly between runs, so use temperature 0 and a fixed schema, and keep the decision rule (what gets flagged or hidden) in our code, not in the model.
- **§1 guardrail:** the prompt and schema allow safety categories only. The model is never asked whether a drawing is good, on-prompt, or anything else.

## Option D: OCR plus the text blocklist

Run OCR (e.g. Tesseract via `tesseract.js`, locally) on the flattened image. Pass any text it finds through the same profanity/slur list planned for display names (`obscenity`, §8.2).

- **Pros:** free, local, deterministic. Covers the "slur written on the canvas" case that A and most of B miss.
- **Cons:** OCR is poor on hand-drawn lettering. Treat this as an add-on to A, not a stand-alone check. Option C already covers it.

## Option E: CSAM hash matching (do this whatever else we pick)

The images are served through Cloudflare, so turn on the **Cloudflare CSAM Scanning Tool**. It is free and matches cached images against known-CSAM hash lists. It's not an AI model, and it won't catch new drawn material, but it covers photos POSTed straight to the API, and it is the standard, legally recognized baseline. Write down the reporting procedure (NCMEC) in the admin runbook alongside it.

## Combinations

| Setup | Cost | Privacy | Covers |
|---|---|---|---|
| **A + D + E** | Free | All local | Nudity (uneven on drawings), some text, known CSAM |
| **C + E** | Low, per image | Third party | Nearly everything, best on drawings |
| **Cascade: A on everything, C only when A is uncertain or a drawing is reported** | Lowest paid option | Mostly local | Close to C, at a fraction of the calls |
| **B (Rekognition or Hive) + E** | Per image | Third party | Broad, including hate symbols, without writing a policy prompt |

## When the check runs

1. **Async after insert (recommended):** accept the drawing as now, return the submission number, then run moderation from the existing `WorkQueue`. Upload latency doesn't change, and a moderation outage never blocks submissions. If the check fails, retry later and record the error.
2. **Inline before responding:** the hang animation hides about 2 s and the client waits up to 10 s (§2.5.8), so a fast check fits. But every moderation slowdown or outage turns into failed submissions. Only worth it with the "hold" policy below.

## What happens to a flagged drawing (policy, your call)

1. **Flag only:** the drawing stays visible and shows up in the `/admin` queue with labels and a reason. This matches §8.3 as written.
2. **Flag + auto-hide on high severity:** the same mechanism as report auto-hide (`status = hidden`, restorable with one click, Cloudflare cache purge). Lower-severity flags are flag-only. **Requires amending §8.3.**
3. **Hold until checked:** submissions start as `status = pending` and go live once they pass. This is the safest, but it changes "drawings go live immediately" and makes the hang animation lie unless it waits. **Requires amending §8.3 and §2.5.**

A flag can also lower the report threshold for that drawing (e.g. flagged plus 1 report means hidden).

## Data model sketch

```sql
CREATE TABLE moderation_checks (
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  provider TEXT NOT NULL,          -- 'local-nsfw', 'claude-haiku-5-5', 'rekognition', ...
  flagged INTEGER NOT NULL,
  categories TEXT NOT NULL,        -- JSON array of safety labels only
  severity TEXT,                   -- 'low' | 'medium' | 'high'
  note TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (submission_id, provider)
);
```

The admin queue then sorts on "reported or flagged". Under §1, these columns are never read by gallery, ordering, or public API code.

## Before choosing: build a test set

Collect around 100 drawings made with our own canvas: ordinary LeWitt-style work (grids, arcs, dense lines, skin-tone fills), plus deliberately bad ones (crude nudity, swastikas, written slurs). Run each candidate over the set and compare false positives and misses. Accuracy on drawings is where these options differ most, and published benchmarks are mostly on photos.

## Recommendation

- **Now:** E (Cloudflare CSAM scanning). It is free and only needs a setting turned on.
- **First build:** C, run **async**, with policy **2** (flag everything; auto-hide only `severity = high`). It handles drawings, text, and symbols best, and the cost is small at this site's volume.
- **If cost or privacy matters more:** the A → C cascade, or A + D on their own with policy 1, which needs no design change.
