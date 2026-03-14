# Video Processing — Stage Pipeline

6-stage pipeline that processes YouTube videos into structured product mentions with sentiment scores. Each stage is a self-contained module that reads from the DB (prior stage's persisted output), does its work, and persists results immediately. Progress is tracked on the job's `videoProgress` JSON field — a `Record<string, StageName | null>` mapping video IDs to the last completed stage name.

## Architecture

### Registry (`index.ts`)

Central orchestration file. Exports:

- **`StageName`** — union of all 6 stage names
- **`VideoProgress`** — `Record<string, StageName | null>` progress map type
- **`StageConfig`** — job-level config: `jobId`, `sceneThreshold`, `clusterThreshold`, `transcriptionLanguage`, `transcriptionModel`, `minBoxArea` (fraction, default 0.25), `detectionThreshold` (0-1, default 0.3), `detectionPrompt` (string, default "cosmetics packaging."), `searchThreshold` (0-2, default 0.3), `searchLimit` (int, default 1)
- **`StageContext`** — injected into every stage: `payload` (REST client), `config`, `log` (Logger), `uploadMedia()`, `heartbeat()`
- **`StageResult`** — `{ success, error?, tokens?: { recognition?, transcriptCorrection?, sentiment?, total? } }`
- **`StageDefinition`** — `{ name, index, jobField, execute }` — the `jobField` maps to the checkbox on the VideoProcessings collection (e.g. `stageSceneDetection`)
- **`STAGES`** — ordered array of all 6 stage definitions
- **`getNextStage(lastCompleted, enabledStages)`** — finds the next enabled stage after `lastCompleted`
- **`getEnabledStages(job)`** — reads checkbox fields from the job document, returns `Set<StageName>`
- **`videoNeedsWork(lastCompleted, enabledStages)`** — true if the video has more stages to run
- **`getVideoProgress(job)`** — parses the JSON progress map from the job document

### Dispatcher (in `worker.ts`)

The handler in `worker.ts` is ~80 lines. It receives `stageItems: Array<{ videoId, title, stageName }>` from `claimWork()`, iterates each item, dispatches to `STAGES.find(s => s.name === stageName).execute(ctx, videoId)`, and reports results to `submitWork()`.

### Progress Tracking

Progress keys are video ID strings (e.g. `"42"`). The progress map is persisted to the job after every stage execution (both on batch release and completion).

### Stage Selection

Each stage has a checkbox field on the job (all default `true`). `getEnabledStages()` checks `job.stageSceneDetection !== false`, etc. Disabled stages are skipped — `getNextStage()` finds the first enabled stage after `lastCompleted`.

### External Dependencies

All stages use CLI tools and external APIs — not bundled Node.js libraries:

| Tool | Used by | Purpose |
|------|---------|---------|
| `ffmpeg` | scene_detection, transcription | Scene change detection, audio extraction, screenshot extraction |
| `ffprobe` | scene_detection | Video duration/metadata |
| `zbarimg` | scene_detection | Barcode scanning in screenshots |
| Grounding DINO (ONNX) | screenshot_detection | Zero-shot object detection on screenshots (shared singleton from `@/lib/models/grounding-dino`) |
| CLIP ViT-B/32 (ONNX) | screenshot_search | Image embedding + cosine similarity search (shared singleton from `@/lib/models/clip`) |
| Deepgram API | transcription | Speech-to-text |
| OpenAI gpt-4.1-mini | product_recognition, transcription, sentiment_analysis | LLM classification, correction, sentiment |

**Note**: Video download (`yt-dlp`) has been moved to the **video-crawl** handler — it is no longer part of the processing pipeline.

---

## Stages

### Stage 0: `scene_detection` — Detect Scenes, Extract Screenshots, Scan Barcodes

**File**: `scene-detection.ts` (~266 lines)
**Checkbox**: `stageSceneDetection`
**LLM**: No
**External**: `ffmpeg` (scene detection + screenshot extraction), `zbarimg` (barcode scanning)
**Event**: `video_processing.scene_detected`, `video_processing.barcode_found`, `video_processing.clustered`

Detects scene changes in the video, extracts screenshots per segment, scans for barcodes, clusters visually similar screenshots, and creates video-scene + video-frame records.

**Flow**:
1. Download video media from server to temp directory (reads `videos.videoFile`)
2. Detect scene changes via `ffmpeg` with `sceneThreshold` (default 0.4)
3. Build segments from scene change timestamps (minimum 0.5s duration)
4. **Delete existing scenes** + video-frames + video-mentions for this video (idempotent re-run — deletes video-mentions first, then video-frames, then video-scenes per scene)
5. For each segment:
   - Extract screenshots at 1fps via `ffmpeg`
   - Scan each screenshot for barcodes via `zbarimg`
   - **Barcode path**: If a barcode is found, upload first screenshot to video-media, create a `video-scene` with `matchingType: 'barcode'`, then create `video-frame` records for each screenshot (the frame with the barcode gets `barcode` set)
   - **Visual path**: If no barcode found:
     - Compute perceptual hashes via `sharp` thumbnail + hash (transient — used for clustering only, NOT persisted on frames)
     - Cluster screenshots by hamming distance (threshold from `clusterThreshold` config)
     - Create recognition thumbnails for cluster representatives
     - Upload all screenshots and recognition thumbnails to video-media
     - Create a `video-scene` with `matchingType: 'visual'`
     - Create `video-frame` records for each screenshot — cluster representative frames get `recognitionCandidate: true` and `recognitionThumbnail` (video-media)
6. Clean up temp directory

**Writes to**: `video-scenes`, `video-frames`, `video-media`

---

### Stage 1: `product_recognition` — LLM Classification + Product Matching

**File**: `product-recognition.ts` (~233 lines)
**Checkbox**: `stageProductRecognition`
**LLM**: Yes — `classifyScreenshots()` + `recognizeProduct()` + `matchProduct()`
**External**: OpenAI gpt-4.1-mini (vision)
**Event**: `video_processing.candidates_identified`, `video_processing.product_recognized`

Reads existing video-scenes and their `video-frames` from the DB. For barcode scenes, reads `frame.barcode` to look up products by GTIN. For visual scenes, runs a two-phase LLM pipeline on recognition candidate frames to identify and match products.

**Flow** per scene:

1. Fetch all `video-frames` for the scene from the `video-frames` collection

**Barcode path**:
1. Scan frames for one with a `barcode` field set
2. Look up `product-variants` by GTIN
3. If found, set `referencedProducts: [productId]` on the scene

**Visual path** (two phases):
1. Gather recognition candidate frames (`recognitionCandidate: true`) — each candidate is treated independently (no `screenshotGroup` grouping)
2. **Phase 1 — Classify**: Download recognition thumbnails from candidate frames → call `classifyScreenshots(inputs)` → LLM determines which candidates contain a cosmetics product (returns `candidates` set of candidate indices)
3. **Phase 2 — Recognize**: For each candidate frame identified by classification:
   - Download the candidate's full-size image
   - Call `recognizeProduct(imagePaths)` → LLM extracts brand, product name, search terms
   - Call `matchProduct(payload, brand, name, terms, logger)` → finds/creates product in DB via LLM fuzzy matching
   - Collect matched product IDs
4. Update scene: `referencedProducts: uniqueProductIds`

**Writes to**: `video-scenes`, `products` (may create via `matchProduct`)

---

### Stage 2: `screenshot_detection` — Grounding DINO Detection on Screenshot Crops

**File**: `screenshot-detection.ts`
**Checkbox**: `stageScreenshotDetection`
**LLM**: No (ML inference via ONNX)
**External**: None (local ONNX inference)
**Events**: `video_processing.screenshot_detection_detail` (per candidate), `video_processing.screenshots_detected` (aggregate)
**Model**: Grounding DINO (shared singleton from `@/lib/models/grounding-dino`)

Runs zero-shot object detection on recognition candidate frames from visual scenes. Queries `video-frames` where `recognitionCandidate=true`. Crops detections, uploads to detection-media, and stores in the `video-frame`'s `detections` array.

**Scope**: Only `matchingType: 'visual'` scenes. Within those, only `video-frames` with `recognitionCandidate: true`.

**Configurable parameters** (from job's Configuration tab → StageConfig):
- `detectionPrompt` — Grounding DINO text prompt (default: `"cosmetics packaging."`)
- `detectionThreshold` — confidence threshold 0-1 (default: 0.3)
- `minBoxArea` — minimum box area as fraction of screenshot area (default: 0.25 = 25%)

**Flow**:
1. Fetch all scenes for the video, filter to visual scenes
2. For each visual scene, query `video-frames` where `scene=sceneId` AND `recognitionCandidate=true`
3. Per recognition candidate frame:
   - Download frame image from video-media
   - Run Grounding DINO detector with configurable prompt and threshold
   - For each detection above confidence threshold AND minimum box area:
     - Crop the detected region via `sharp`
     - Upload crop to detection-media collection
     - Store in frame's `detections` array: `{ image (detection-media), boxXMin, boxYMin, boxXMax, boxYMax, score }`
   - Emit `video_processing.screenshot_detection_detail` event with `frameId`, raw detection count, kept/skipped counts, all scores, image dimensions
4. Update frame with `detections` array (overwrite for idempotency)
5. Emit `video_processing.screenshots_detected` aggregate event with `candidatesProcessed` and `candidatesWithDetections`

**Observability**: Every recognition candidate frame emits a detail event regardless of outcome. Per-candidate events include `frameId` (not screenshot index). This makes it easy to debug why detections are missing — you can see whether Grounding DINO returned zero detections (model didn't recognize anything) or returned detections that were filtered out (too small, invalid boxes).

**Writes to**: `video-frames` (detections array), `detection-media`

---

### Stage 3: `screenshot_search` — CLIP Visual Similarity Search

**File**: `screenshot-search.ts`
**Checkbox**: `stageScreenshotSearch`
**LLM**: No (ML inference via ONNX)
**External**: None (local ONNX inference + embeddings API)
**Events**: `video_processing.screenshot_search_detail` (per detection), `video_processing.screenshots_searched` (aggregate)
**Model**: CLIP ViT-B/32 (shared singleton from `@/lib/models/clip`)

Computes transient CLIP embeddings for detection crops stored on `video-frames` and searches against stored product recognition image embeddings to match products.

**Scope**: All scenes for the video. For each scene, fetches all `video-frames` and processes those with detections from Stage 2.

**Configurable parameters** (from job's Configuration tab → StageConfig):
- `searchThreshold` — maximum cosine distance for matching (0-2, default: 0.3). Try 0.5-0.7 for video screenshots which have different angles/lighting vs product photos.
- `searchLimit` — number of nearest neighbors to use for matching (default: 1). Only the top-1 is used for matching.

**Diagnostic behavior**: Always fetches at least 3 results from pgvector (regardless of `searchLimit`) to log near-misses. The server-side threshold filter is disabled — all top-N results are returned, and threshold filtering is applied client-side. This means even when no match is found, you can see the closest distance in the detail event.

**Flow**:
1. Fetch all scenes for the video
2. Per scene, fetch all `video-frames` for that scene
3. Per frame with detections, per detection:
   - Download detection crop from detection-media
   - Compute transient CLIP ViT-B/32 embedding (512-dim, not persisted)
   - Search `recognition-images` embedding namespace (no server-side threshold, fetch top-N for diagnostics)
   - If best result is within `searchThreshold`, resolve product-variant → product
   - Emit `video_processing.screenshot_search_detail` event with: `sceneId`, `frameId`, detection index, embedding status, results count, best distance, best GTIN, match status, top-N distances
4. Update frame's detection entries with match info (`hasEmbedding`, `matchedProduct`, `matchDistance`, `matchedGtin`)
5. Merge matched product IDs into scene's `referencedProducts` (alongside any existing barcode/LLM matches)
6. Emit `video_processing.screenshots_searched` aggregate event with `embeddingsFailed` and `avgBestDistance`

**Observability**: Every detection crop emits a detail event regardless of outcome, including `frameId` for traceability. This shows whether CLIP embeddings computed successfully, what the nearest neighbor distances were (even if above threshold), and which GTIN was closest. The `avgBestDistance` in the aggregate event helps calibrate the `searchThreshold` setting.

**Writes to**: `video-frames` (detections with match info), `video-scenes` (referencedProducts)

---

### Stage 4: `transcription` — Deepgram STT + LLM Correction + Per-Snippet Splitting

**File**: `transcription.ts` (~163 lines)
**Checkbox**: `stageTranscription`
**LLM**: Yes — `correctTranscript()`
**External**: `ffmpeg` (audio extraction), Deepgram API (STT), OpenAI gpt-4.1-mini (correction)
**Event**: `video_processing.transcribed`, `video_processing.transcript_corrected`

Downloads the video, extracts audio, transcribes via Deepgram, corrects brand/product names via LLM, and splits the transcript per scene.

**Flow**:
1. Download video from video-media to temp directory (reads `videos.videoFile`)
2. Extract audio via `ffmpeg` → WAV
3. Collect product/brand names from scenes' `referencedProducts` for keyword boosting
4. Transcribe via `transcribeAudio(audioPath, { language, model, keywords })` using Deepgram
5. Fetch all brand names for LLM correction context
6. Call `correctTranscript(rawTranscript, words, brandNames, productKeywords)` — LLM fixes misheard brand/product names
7. Save full transcript on video: `transcript`, `transcriptWords`
8. For each scene: call `splitTranscriptForScene(words, start, end, preSeconds=5, postSeconds=3)` — extracts the transcript segment with pre/post context. Update scene: `preTranscript`, `transcript`, `postTranscript`

**Writes to**: `videos`, `video-scenes`

**Config**: `transcriptionLanguage` (default 'de'), `transcriptionModel` (default 'nova-3')

---

### Stage 5: `sentiment_analysis` — LLM Quote Extraction + Sentiment Scoring

**File**: `sentiment-analysis.ts` (~137 lines)
**Checkbox**: `stageSentimentAnalysis`
**LLM**: Yes — `analyzeSentiment()`
**External**: OpenAI gpt-4.1-mini
**Event**: `video_processing.sentiment_analyzed`

Reads scenes with referenced products and transcript data, runs LLM sentiment analysis per scene, creates video-mention records.

**Flow**:
1. Fetch video for full transcript context
2. Fetch all scenes, collect all referenced product IDs
3. Build product info map (brand name + product name for each product)
4. **Delete existing video-mentions** for all scenes (idempotent re-run)
5. For each scene with `referencedProducts` and transcript text:
   - Call `analyzeSentiment(preTranscript, transcript, postTranscript, products, fullTranscript)` — LLM extracts quotes about each product with sentiment scores
   - For each product result: create `video-mention` with `videoScene`, `product`, `quotes` array (text, summary, sentiment, sentimentScore), `overallSentiment`, `overallSentimentScore`

**Writes to**: `video-mentions`

**Sentiment scale**: Per-quote `sentimentScore` is -1 to +1. `overallSentiment` is a categorical label (positive/negative/neutral/mixed). `overallSentimentScore` is the average across quotes.

---

## Shared Patterns

- **Shared ML model singletons**: `screenshot_detection` and `screenshot_search` use shared model singletons from `@/lib/models/` (Grounding DINO and CLIP respectively). These are the same singletons used by the product aggregation pipeline's `object_detection` and `embed_images` stages — models are loaded once and shared across both pipelines.
- **Temp directories**: Stages that need local files (scene_detection, product_recognition, screenshot_detection, screenshot_search, transcription) create temp dirs via `fs.mkdtempSync()` with `try/finally` cleanup via `fs.rmSync()`
- **Media URL resolution**: Stages that read from media collections (video-media, detection-media) construct full URLs via `payload.serverUrl` + relative path (or use the URL directly if already absolute)
- **Heartbeat**: all stages call `ctx.heartbeat()` after heavy operations (downloads, per-segment loops, LLM calls) to keep the job claim alive
- **Token tracking**: LLM stages return categorized token counts in `StageResult.tokens`; the dispatcher accumulates these
- **Idempotency**: scene_detection and sentiment_analysis delete existing scenes/mentions before re-creating them, making re-runs safe
- **Scene ownership**: video-scenes belong to a video (via `video` relationship). video-frames belong to a scene (via `scene` relationship). video-mentions belong to a scene (via `videoScene` relationship). Deleting scenes cascades to deleting their frames and mentions (scene_detection explicitly deletes video-mentions, then video-frames, then video-scenes per scene for idempotent re-runs).

## Data Flow Between Stages

```
[video-crawl handler sets videos.videoFile + videos.thumbnail + status='crawled']
       |
scene_detection (reads videos.videoFile)
  └─ video-scenes (timestamps, matchingType)
  └─ video-frames (image, barcode, recognitionCandidate, recognitionThumbnail — per scene)
       │
product_recognition (reads video-scenes + video-frames)
  └─ video-scenes.referencedProducts (product IDs from barcode/LLM)
       │
screenshot_detection (reads video-frames where recognitionCandidate=true, visual scenes only)
  └─ video-frames.detections (Grounding DINO crops as detection-media, bounding boxes)
       │
screenshot_search (reads video-frames.detections)
  └─ video-frames.detections (match info) + video-scenes.referencedProducts (merged)
       │
transcription (reads videos.videoFile + video-scenes.referencedProducts for keywords)
  └─ videos.transcript + videos.transcriptWords
  └─ video-scenes.preTranscript / transcript / postTranscript
       │
sentiment_analysis (reads video-scenes with products + transcripts)
  └─ video-mentions (quotes, sentiment scores per product per scene)
```
