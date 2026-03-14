# Video Processing — Stage Pipeline

8-stage pipeline that processes YouTube videos into structured product mentions with sentiment scores and detection provenance. Each stage is a self-contained module that reads from the DB (prior stage's persisted output), does its work, and persists results immediately. Progress is tracked on the job's `videoProgress` JSON field — a `Record<string, StageName | null>` mapping video IDs to the last completed stage name.

## Architecture

### Registry (`index.ts`)

Central orchestration file. Exports:

- **`StageName`** — union of all 8 stage names
- **`VideoProgress`** — `Record<string, StageName | null>` progress map type
- **`StageConfig`** — job-level config: `jobId`, `sceneThreshold`, `clusterThreshold`, `transcriptionLanguage`, `transcriptionModel`, `minBoxArea` (fraction, default 0.25), `detectionThreshold` (0-1, default 0.3), `detectionPrompt` (string, default "cosmetics packaging."), `searchThreshold` (0-2, default 0.3), `searchLimit` (int, default 1)
- **`StageContext`** — injected into every stage: `payload` (REST client), `config`, `log` (Logger), `uploadMedia()`, `heartbeat()`
- **`StageResult`** — `{ success, error?, tokens?: { recognition?, transcriptCorrection?, sentiment?, total? } }`
- **`StageDefinition`** — `{ name, index, jobField, execute }` — the `jobField` maps to the checkbox on the VideoProcessings collection (e.g. `stageSceneDetection`, `stageBarcodeScan`)
- **`STAGES`** — ordered array of all 8 stage definitions
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
| `zbarimg` | barcode_scan | Barcode scanning in screenshots |
| Grounding DINO (ONNX) | object_detection | Zero-shot object detection on screenshots (shared singleton from `@/lib/models/grounding-dino`) |
| CLIP ViT-B/32 (ONNX) | visual_search | Image embedding + cosine similarity search (shared singleton from `@/lib/models/clip`) |
| Deepgram API | transcription | Speech-to-text |
| OpenAI gpt-4.1-mini | llm_recognition, transcription, sentiment_analysis | LLM classification, correction, sentiment |

**Note**: Video download (`yt-dlp`) has been moved to the **video-crawl** handler — it is no longer part of the processing pipeline.

---

## Stages

### Stage 0: `scene_detection` — Detect Scenes, Extract Screenshots, Cluster

**File**: `scene-detection.ts`
**Checkbox**: `stageSceneDetection`
**LLM**: No
**External**: `ffmpeg` (scene detection + screenshot extraction)
**Event**: `video_processing.scene_detected`, `video_processing.clustered`

Detects scene changes in the video, extracts screenshots per segment, clusters visually similar screenshots, and creates video-scene + video-frame records. No barcode scanning or matchingType — frames are pure data records.

**Flow**:
1. Download video media from server to temp directory (reads `videos.videoFile`)
2. Detect scene changes via `ffmpeg` with `sceneThreshold` (default 0.4)
3. Build segments from scene change timestamps (minimum 0.5s duration)
4. **Delete existing scenes** + video-frames + video-mentions for this video (idempotent re-run — deletes video-mentions first, then video-frames, then video-scenes per scene)
5. For each segment:
   - Extract screenshots at 1fps via `ffmpeg`
   - Compute perceptual hashes via `sharp` thumbnail + hash (transient — used for clustering only, NOT persisted on frames)
   - Cluster screenshots by hamming distance (threshold from `clusterThreshold` config)
   - Create cluster thumbnails for cluster representatives
   - Upload all screenshots and cluster thumbnails to video-media
   - Create a `video-scene` (no matchingType field)
   - Create `video-frame` records for each screenshot — cluster representative frames get `isClusterRepresentative: true` and `clusterThumbnail` (video-media)
6. Clean up temp directory

**Writes to**: `video-scenes`, `video-frames`, `video-media`

---

### Stage 1: `barcode_scan` — Scan Frame Images for Barcodes

**File**: `barcode-scan.ts` (exports `executeBarcodeScan`)
**Checkbox**: `stageBarcodeScan`
**LLM**: No
**External**: `zbarimg` (barcode scanning)
**Event**: `video_processing.barcode_found`

Scans all frame images for barcodes, looks up product-variants by GTIN, and stores results in the scene's `barcodes[]` array.

**Flow**:
1. Fetch all scenes for the video
2. For each scene, fetch all `video-frames`
3. Per frame: download frame image, scan via `zbarimg`
4. If barcode found: look up `product-variants` by GTIN → resolve parent product
5. Store results in scene's `barcodes[]` array (barcode value, product reference, frame reference)

**Writes to**: `video-scenes.barcodes[]`

---

### Stage 2: `object_detection` — Grounding DINO Detection on Cluster Representatives

**File**: `object-detection.ts` (exports `executeObjectDetection`)
**Checkbox**: `stageObjectDetection`
**LLM**: No (ML inference via ONNX)
**External**: None (local ONNX inference)
**Events**: `video_processing.object_detection_detail` (per candidate), `video_processing.objects_detected` (aggregate)
**Model**: Grounding DINO (shared singleton from `@/lib/models/grounding-dino`)

Runs zero-shot object detection on cluster representative frames. Crops detections, uploads to detection-media, and stores in the scene's `objects[]` array.

**Scope**: All scenes for the video. Within those, only `video-frames` with `isClusterRepresentative: true`.

**Configurable parameters** (from job's Configuration tab → StageConfig):
- `detectionPrompt` — Grounding DINO text prompt (default: `"cosmetics packaging."`)
- `detectionThreshold` — confidence threshold 0-1 (default: 0.3)
- `minBoxArea` — minimum box area as fraction of screenshot area (default: 0.25 = 25%)

**Flow**:
1. Fetch all scenes for the video
2. For each scene, query `video-frames` where `scene=sceneId` AND `isClusterRepresentative=true`
3. Per cluster representative frame:
   - Download frame image from video-media
   - Run Grounding DINO detector with configurable prompt and threshold
   - For each detection above confidence threshold AND minimum box area:
     - Crop the detected region via `sharp`
     - Upload crop to detection-media collection
     - Add to scene's `objects[]` array: `{ image (detection-media), boxXMin, boxYMin, boxXMax, boxYMax, score, frameId }`
   - Emit `video_processing.object_detection_detail` event with frameId, raw detection count, kept/skipped counts
4. Update scene with `objects[]` array (overwrite for idempotency)
5. Emit `video_processing.objects_detected` aggregate event

**Writes to**: `video-scenes.objects[]`, `detection-media`

---

### Stage 3: `visual_search` — CLIP Visual Similarity Search

**File**: `visual-search.ts` (exports `executeVisualSearch`)
**Checkbox**: `stageVisualSearch`
**LLM**: No (ML inference via ONNX)
**External**: None (local ONNX inference + embeddings API)
**Events**: `video_processing.visual_search_detail` (per detection), `video_processing.visual_search_complete` (aggregate)
**Model**: CLIP ViT-B/32 (shared singleton from `@/lib/models/clip`)

Computes transient CLIP embeddings for object detection crops stored on scenes and searches against stored product recognition image embeddings to match products.

**Scope**: All scenes for the video. Processes scenes with objects from Stage 2.

**Configurable parameters** (from job's Configuration tab → StageConfig):
- `searchThreshold` — maximum cosine distance for matching (0-2, default: 0.3). Try 0.5-0.7 for video screenshots which have different angles/lighting vs product photos.
- `searchLimit` — number of nearest neighbors to use for matching (default: 1). Only the top-1 is used for matching.

**Diagnostic behavior**: Always fetches at least 3 results from pgvector (regardless of `searchLimit`) to log near-misses. The server-side threshold filter is disabled — all top-N results are returned, and threshold filtering is applied client-side. This means even when no match is found, you can see the closest distance in the detail event.

**Flow**:
1. Fetch all scenes for the video
2. Per scene with objects[], per object detection:
   - Download detection crop from detection-media
   - Compute transient CLIP ViT-B/32 embedding (512-dim, not persisted)
   - Search `recognition-images` embedding namespace (no server-side threshold, fetch top-N for diagnostics)
   - If best result is within `searchThreshold`, resolve product-variant → product
   - Emit `video_processing.visual_search_detail` event with: sceneId, detection index, best distance, best GTIN, match status
3. Store matched results in scene's `recognitions[]` array (product reference, distance, GTIN, detection reference)
4. Emit `video_processing.visual_search_complete` aggregate event with `embeddingsFailed` and `avgBestDistance`

**Writes to**: `video-scenes.recognitions[]`

---

### Stage 4: `llm_recognition` — LLM Classification + Product Matching

**File**: `llm-recognition.ts` (exports `executeLlmRecognition`)
**Checkbox**: `stageLlmRecognition`
**LLM**: Yes — `classifyScreenshots()` + `recognizeProduct()` + `matchProduct()`
**External**: OpenAI gpt-4.1-mini (vision)
**Event**: `video_processing.candidates_identified`, `video_processing.product_recognized`

Reads existing video-scenes and their cluster representative `video-frames` from the DB. Runs a two-phase LLM pipeline on cluster representative frames to identify and match products.

**Flow** per scene:

1. Fetch all `video-frames` for the scene where `isClusterRepresentative=true`

**Two phases**:
1. **Phase 1 — Classify**: Download cluster thumbnails from representative frames → call `classifyScreenshots(inputs)` → LLM determines which candidates contain a cosmetics product (returns `candidates` set of candidate indices)
2. **Phase 2 — Recognize**: For each candidate frame identified by classification:
   - Download the candidate's full-size image
   - Call `recognizeProduct(imagePaths)` → LLM extracts brand, product name, search terms
   - Call `matchProduct(payload, brand, name, terms, logger)` → finds/creates product in DB via LLM fuzzy matching
   - Collect matched product IDs
3. Store results in scene's `llmMatches[]` array (product reference, brand, name, confidence)

**Writes to**: `video-scenes.llmMatches[]`, `products` (may create via `matchProduct`)

---

### Stage 5: `transcription` — Deepgram STT + LLM Correction + Per-Snippet Splitting

**File**: `transcription.ts`
**Checkbox**: `stageTranscription`
**LLM**: Yes — `correctTranscript()`
**External**: `ffmpeg` (audio extraction), Deepgram API (STT), OpenAI gpt-4.1-mini (correction)
**Event**: `video_processing.transcribed`, `video_processing.transcript_corrected`

Downloads the video, extracts audio, transcribes via Deepgram, corrects brand/product names via LLM, and splits the transcript per scene.

**Flow**:
1. Download video from video-media to temp directory (reads `videos.videoFile`)
2. Extract audio via `ffmpeg` → WAV
3. Collect product/brand names from scenes' `barcodes[]`, `recognitions[]`, and `llmMatches[]` for keyword boosting
4. Transcribe via `transcribeAudio(audioPath, { language, model, keywords })` using Deepgram
5. Fetch all brand names for LLM correction context
6. Call `correctTranscript(rawTranscript, words, brandNames, productKeywords)` — LLM fixes misheard brand/product names
7. Save full transcript on video: `transcript`, `transcriptWords`
8. For each scene: call `splitTranscriptForScene(words, start, end, preSeconds=5, postSeconds=3)` — extracts the transcript segment with pre/post context. Update scene: `preTranscript`, `transcript`, `postTranscript`

**Writes to**: `videos`, `video-scenes`

**Config**: `transcriptionLanguage` (default 'de'), `transcriptionModel` (default 'nova-3')

---

### Stage 6: `compile_detections` — Synthesize All Detection Sources

**File**: `compile-detections.ts` (exports `executeCompileDetections`)
**Checkbox**: `stageCompileDetections`
**LLM**: No
**External**: None
**Event**: `video_processing.detections_compiled`

Reads all detection data from prior stages (barcodes[], objects[]+recognitions[], llmMatches[]) and synthesizes them into a unified `detections[]` array on each scene with standardized confidence scores.

**Confidence scoring**:
- Barcode match: confidence = 1.0 (definitive identification)
- Object detection + CLIP match: confidence = 1.0 - clipDistance
- LLM recognition: confidence = 0.6
- Multi-source bonus: +0.1 per additional source that identified the same product (capped at 1.0)

**Flow**:
1. Fetch all scenes for the video
2. Per scene: read barcodes[], objects[]+recognitions[], llmMatches[]
3. Deduplicate by product ID, merge confidence from multiple sources
4. Apply multi-source bonus
5. Store compiled results in scene's `detections[]` array (product reference, confidence, sources list, barcodeValue, clipDistance)

**Writes to**: `video-scenes.detections[]`

---

### Stage 7: `sentiment_analysis` — LLM Quote Extraction + Sentiment Scoring

**File**: `sentiment-analysis.ts`
**Checkbox**: `stageSentimentAnalysis`
**LLM**: Yes — `analyzeSentiment()`
**External**: OpenAI gpt-4.1-mini
**Event**: `video_processing.sentiment_analyzed`

Reads scenes with compiled detections and transcript data, runs LLM sentiment analysis per scene, creates video-mention records with full detection provenance.

**Flow**:
1. Fetch video for full transcript context
2. Fetch all scenes, collect products from compiled `detections[]` array
3. Build product info map (brand name + product name for each product)
4. **Delete existing video-mentions** for all scenes (idempotent re-run)
5. For each scene with `detections[]` and transcript text:
   - Call `analyzeSentiment(preTranscript, transcript, postTranscript, products, fullTranscript)` — LLM extracts quotes about each product with sentiment scores
   - For each product result: create `video-mention` with `videoScene`, `product`, `quotes` array (text, summary, sentiment, sentimentScore), `overallSentiment`, `overallSentimentScore`, plus detection provenance from the compiled detections: `confidence`, `sources` (barcode/object_detection/vision_llm), `barcodeValue`, `clipDistance`

**Writes to**: `video-mentions`

**Sentiment scale**: Per-quote `sentimentScore` is -1 to +1. `overallSentiment` is a categorical label (positive/negative/neutral/mixed). `overallSentimentScore` is the average across quotes.

---

## Shared Patterns

- **Shared ML model singletons**: `object_detection` and `visual_search` use shared model singletons from `@/lib/models/` (Grounding DINO and CLIP respectively). These are the same singletons used by the product aggregation pipeline's `object_detection` and `embed_images` stages — models are loaded once and shared across both pipelines.
- **Temp directories**: Stages that need local files (scene_detection, object_detection, visual_search, transcription) create temp dirs via `fs.mkdtempSync()` with `try/finally` cleanup via `fs.rmSync()`
- **Media URL resolution**: Stages that read from media collections (video-media, detection-media) construct full URLs via `payload.serverUrl` + relative path (or use the URL directly if already absolute)
- **Heartbeat**: all stages call `ctx.heartbeat()` after heavy operations (downloads, per-segment loops, LLM calls) to keep the job claim alive
- **Token tracking**: LLM stages return categorized token counts in `StageResult.tokens`; the dispatcher accumulates these
- **Idempotency**: scene_detection and sentiment_analysis delete existing scenes/mentions before re-creating them, making re-runs safe. Other stages overwrite their respective arrays on scenes for idempotent re-runs.
- **Scene ownership**: video-scenes belong to a video (via `video` relationship). video-frames belong to a scene (via `scene` relationship). video-mentions belong to a scene (via `videoScene` relationship). Deleting scenes cascades to deleting their frames and mentions (scene_detection explicitly deletes video-mentions, then video-frames, then video-scenes per scene for idempotent re-runs).
- **Detection data on scenes, not frames**: All detection results (barcodes, objects, recognitions, llmMatches, detections) are stored on video-scenes in tabbed arrays. Video-frames are pure frame records (image, isClusterRepresentative, clusterThumbnail) with no detection or matching data.

## Data Flow Between Stages

```
[video-crawl handler sets videos.videoFile + videos.thumbnail + status='crawled']
       |
scene_detection (reads videos.videoFile)
  └─ video-scenes (timestamps)
  └─ video-frames (image, isClusterRepresentative, clusterThumbnail — per scene)
       │
barcode_scan (reads video-frames images)
  └─ video-scenes.barcodes[] (barcode values, product refs)
       │
object_detection (reads video-frames where isClusterRepresentative=true)
  └─ video-scenes.objects[] (Grounding DINO crops as detection-media, bounding boxes)
       │
visual_search (reads video-scenes.objects[])
  └─ video-scenes.recognitions[] (CLIP matches with distance + product refs)
       │
llm_recognition (reads video-frames where isClusterRepresentative=true)
  └─ video-scenes.llmMatches[] (LLM-identified products)
       │
transcription (reads videos.videoFile + scene barcodes/recognitions/llmMatches for keywords)
  └─ videos.transcript + videos.transcriptWords
  └─ video-scenes.preTranscript / transcript / postTranscript
       │
compile_detections (reads scene barcodes + objects + recognitions + llmMatches)
  └─ video-scenes.detections[] (unified, confidence-scored, deduplicated)
       │
sentiment_analysis (reads video-scenes with detections + transcripts)
  └─ video-mentions (quotes, sentiment, confidence, sources, barcodeValue, clipDistance)
```
