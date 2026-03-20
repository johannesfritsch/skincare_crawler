# Video Processing — Stage Pipeline

8-stage pipeline that processes YouTube videos into structured product mentions with sentiment scores and detection provenance. Each stage is a self-contained module that reads from the DB (prior stage's persisted output), does its work, and persists results immediately. Progress is tracked on the job's `videoProgress` JSON field — a `Record<string, StageName | null>` mapping video IDs to the last completed stage name.

Stages: `scene_detection` → `barcode_scan` → `object_detection` → `visual_search` → `ocr_extraction` → `transcription` → `compile_detections` → `sentiment_analysis`

## Architecture

### Registry (`index.ts`)

Central orchestration file. Exports:

- **`StageName`** — union of all 8 stage names: `scene_detection | barcode_scan | object_detection | visual_search | ocr_extraction | transcription | compile_detections | sentiment_analysis`
- **`VideoProgress`** — `Record<string, StageName | null>` progress map type
- **`StageConfig`** — job-level config: `jobId`, `sceneThreshold`, `clusterThreshold`, `transcriptionLanguage`, `transcriptionModel` (text, default 'whisper-1'), `minBoxArea` (fraction, default 0.25), `detectionThreshold` (0-1, default 0.3), `detectionPrompt` (string, default "cosmetics packaging."), `searchThreshold` (0-2, default 0.8), `searchLimit` (int, default 3)
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

Each stage has a checkbox field on the job (all default `true`): `stageSceneDetection`, `stageBarcodeScan`, `stageObjectDetection`, `stageVisualSearch`, `stageOcrExtraction`, `stageTranscription`, `stageCompileDetections`, `stageSentimentAnalysis`. `getEnabledStages()` checks `job.stageSceneDetection !== false`, etc. Disabled stages are skipped — `getNextStage()` finds the first enabled stage after `lastCompleted`.

### External Dependencies

All stages use CLI tools and external APIs — not bundled Node.js libraries:

| Tool | Used by | Purpose |
|------|---------|---------|
| `ffmpeg` | scene_detection, transcription | Scene change detection, audio extraction, screenshot extraction |
| `ffprobe` | scene_detection | Video duration/metadata |
| `zbarimg` | barcode_scan | Barcode scanning in screenshots |
| Grounding DINO (ONNX) | object_detection | Zero-shot object detection (shared singleton from `@/lib/models/grounding-dino`) |
| DINOv2-base (ONNX) | visual_search | Image embedding + cosine similarity search (shared singleton from `@/lib/models/clip`) |
| OpenAI Whisper API | transcription | Speech-to-text (via `audio.transcriptions.create`) |
| OpenAI gpt-4.1-mini | ocr_extraction, transcription, compile_detections, sentiment_analysis | OCR via vision, LLM correction, consolidation, sentiment |

**Note**: Video download (`yt-dlp`) has been moved to the **video-crawl** handler — it is no longer part of the processing pipeline.

---

## Stages

### Stage 0: `scene_detection` — Detect Scenes, Extract Screenshots, Dedup

**File**: `scene-detection.ts`
**Checkbox**: `stageSceneDetection`
**LLM**: No
**External**: `ffmpeg` (scene detection + screenshot extraction)
**Event**: `video_processing.scene_detected`

Detects scene changes in the video, extracts screenshots per segment, deduplicates near-identical frames by perceptual hash, and creates video-scene + video-frame records. Frames are pure data records — no clustering or representative selection happens here.

**Flow**:
1. Download video media from server to temp directory (reads `videos.videoFile`)
2. Detect scene changes via `ffmpeg` with `sceneThreshold` (default 0.4)
3. Build segments from scene change timestamps (minimum 0.5s duration)
4. **Delete existing scenes** + video-frames + video-mentions for this video (idempotent re-run)
5. For each segment:
   - Extract screenshots at 1fps via `ffmpeg`
   - Compute perceptual hashes via `sharp` (64x64 grayscale) — transient, used for dedup only
   - **Dedup**: eliminate near-identical frames by hamming distance (threshold = 5). First frame kept, duplicates discarded.
   - Upload all unique screenshots to video-media
   - Create a `video-scene` record
   - Create `video-frame` records for each unique screenshot
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

### Stage 2: `object_detection` — Grounding DINO Detection on ALL Frames

**File**: `object-detection.ts` (exports `executeObjectDetection`)
**Checkbox**: `stageObjectDetection`
**LLM**: No (ML inference via ONNX)
**External**: None (local ONNX inference)
**Events**: `video_processing.object_detection_detail` (per frame), `video_processing.objects_detected` (aggregate)
**Model**: Grounding DINO (shared singleton from `@/lib/models/grounding-dino`)

Runs zero-shot object detection on ALL deduplicated frames for each scene. Crops detections, uploads to detection-media, and stores in the scene's `objects[]` array.

**Scope**: All scenes for the video. ALL frames per scene.

**Configurable parameters** (from job's Configuration tab → StageConfig):
- `detectionPrompt` — Grounding DINO text prompt (default: `"cosmetics packaging."`)
- `detectionThreshold` — confidence threshold 0-1 (default: 0.3)
- `minBoxArea` — minimum box area as fraction of screenshot area (default: 0.25 = 25%)

**Flow**:
1. Fetch all scenes for the video
2. For each scene, query ALL `video-frames`
3. Per frame:
   - Download frame image from video-media
   - Run Grounding DINO detector with configurable prompt and threshold
   - For each detection above confidence threshold AND minimum box area:
     - Crop the detected region via `sharp`
     - Upload crop to detection-media collection
     - Add to scene's `objects[]` array: `{ frame, crop (detection-media), boxXMin, boxYMin, boxXMax, boxYMax, score }`
   - Emit `video_processing.object_detection_detail` event with frameId, raw detection count, kept/skipped counts
4. Update scene with `objects[]` array (overwrite for idempotency)
5. Emit `video_processing.objects_detected` aggregate event

**Writes to**: `video-scenes.objects[]`, `detection-media`

---

### Stage 3: `visual_search` — DINOv2 Visual Similarity Search (All Crops)

**File**: `visual-search.ts` (exports `executeVisualSearch`)
**Checkbox**: `stageVisualSearch`
**LLM**: No (ML inference via ONNX)
**External**: None (local ONNX inference + embeddings API)
**Events**: `video_processing.visual_search_detail` (per detection), `video_processing.visual_search_complete` (aggregate)
**Model**: DINOv2-base (shared singleton from `@/lib/models/clip`)

Computes transient DINOv2 embeddings for **all** object detection crops and searches against stored product recognition image embeddings, returning top-N candidates per crop.

**Scope**: All scenes for the video. ALL objects from stage 2.

**Configurable parameters** (from job's Configuration tab → StageConfig):
- `searchThreshold` — maximum cosine distance for a candidate to be included (0-2, default: 0.8).
- `searchLimit` — number of nearest neighbors to return per crop (default: 3). All are stored in `recognitions[]`.

**Diagnostic behavior**: The server-side threshold filter is disabled — all top-N results are returned, and threshold filtering is applied client-side. Even when no match passes the threshold, the closest distance is visible in the detail event.

**Flow**:
1. Fetch all scenes for the video
2. Per scene with objects[], per object detection:
   - Download detection crop from detection-media
   - Compute transient DINOv2-base embedding (768-dim, not persisted)
   - Search `recognition-images` embedding namespace (no server-side threshold, fetch top-N)
   - For each result within `searchThreshold`, resolve product-variant → product
   - Emit `video_processing.visual_search_detail` event with: sceneId, detection index, best distance, best GTIN, match status
3. Store all candidates in scene's `recognitions[]` array (product reference, distance, GTIN, detection reference)
4. Emit `video_processing.visual_search_complete` aggregate event with `embeddingsFailed` and `avgBestDistance`

**Writes to**: `video-scenes.recognitions[]`

---

### Stage 4: `ocr_extraction` — Read Text from Detection Crops via Vision LLM

**File**: `ocr-extraction.ts` (exports `executeOcrExtraction`)
**Checkbox**: `stageOcrExtraction`
**LLM**: Yes — gpt-4.1-mini vision
**External**: OpenAI gpt-4.1-mini
**Events**: `video_processing.ocr_extraction_complete` (aggregate)

Reads visible text from ALL detection crops using gpt-4.1-mini vision. Extracted text (brand name, product name, other label text) is stored back into each object entry's `ocrText` field and is used downstream by `compile_detections`.

**Scope**: All scenes for the video. ALL objects from stage 2.

**Flow per scene**:
1. Read `objects[]` array from the scene
2. For each crop: download from detection-media, call gpt-4.1-mini with the crop image, extract visible text
3. Write extracted text back to each object entry's `ocrText` field

**Writes to**: `video-scenes.objects[].ocrText`

---

### Stage 5: `transcription` — Deepgram Full-Audio STT + Single LLM Correction

**File**: `transcription.ts`
**Checkbox**: `stageTranscription`
**LLM**: Yes — `correctTranscript()` (1 call for full transcript)
**External**: `ffmpeg` (audio extraction), Deepgram REST API (STT with word timestamps), OpenAI gpt-4.1-mini (correction)
**Event**: `video_processing.transcribed`

Downloads the video, extracts full audio, transcribes the entire audio in a **single Deepgram API call** with word-level timestamps, splits the transcript into per-scene segments by timestamp, then runs **one LLM correction pass** on the full transcript and distributes corrected text back to each scene.

This replaced the previous per-scene Whisper approach (N Whisper calls + N LLM correction calls → 1 Deepgram call + 1 LLM correction call).

**Flow**:
1. Download video from video-media to temp directory (reads `videos.videoFile`)
2. Extract full audio via `ffmpeg` → WAV
3. Collect product/brand names from scenes' `barcodes[]` and `recognitions[]` for keyword boosting
4. Transcribe full audio via `transcribeWithDeepgram()` — single API call, returns transcript + word-level timestamps
5. Split transcript into per-scene segments via `splitTranscriptByScenes()` — maps words to scenes by comparing word start times against scene timestamp ranges
6. Fetch all brand names, run one `correctTranscript()` call on the full transcript
7. Map corrected text back to per-scene segments via proportional character-offset mapping
8. Update each scene with its transcript

**Writes to**: `video-scenes.transcript`

**Config**: `transcriptionLanguage` (default 'de'). Deepgram model is hardcoded to `nova-3`.

**Env**: `DEEPGRAM_API_KEY` (required), `DEEPGRAM_TIMEOUT_MS` (optional, default 300000)

**Key functions**:
- `transcribeWithDeepgram(audioPath, options)` → `{ transcript, words: TranscriptWord[] }` — single Deepgram REST API call with word timestamps
- `splitTranscriptByScenes(words, scenes)` → `string[]` — maps words to scenes by timestamp
- `correctTranscript(rawTranscript, brandNames, productNames)` → `{ correctedTranscript, corrections[], tokensUsed }` — LLM correction (1 call for full transcript)

---

### Stage 6: `compile_detections` — Product Matching + LLM Consolidation

**File**: `compile-detections.ts` (exports `executeCompileDetections`)
**Checkbox**: `stageCompileDetections`
**LLM**: Yes — gpt-4.1-mini + `matchProduct()`
**External**: OpenAI gpt-4.1-mini
**Event**: `video_processing.detections_compiled`

Consolidates all evidence from prior stages (barcodes[], objects[]+recognitions[], objects[].ocrText) into a unified `detections[]` array. First calls `matchProduct()` on OCR text (brand + product name from `ocrBrand`/`ocrProductName`) to find/create products in the DB, then uses an LLM (gpt-4.1-mini) to reason over all combined signals and produce a final ranked list. Each detection entry includes a `reasoning` field explaining the LLM's decision. Barcode matches bypass the LLM entirely (confidence 1.0 assigned directly). Falls back to formula-based scoring if the LLM call fails.

**Formula fallback scoring** (used when LLM fails):
- Barcode match: confidence = 1.0 (definitive identification)
- Object detection + DINOv2 match: confidence = 1.0 - clipDistance
- LLM recognition: confidence = 0.6
- Multi-source bonus: +0.1 per additional source that identified the same product (capped at 1.0)

**Flow**:
1. Fetch all scenes for the video
2. Per scene: read barcodes[], objects[] (with ocrText), recognitions[]
3. For barcode matches: assign confidence 1.0 directly, skip LLM
4. For OCR text matches: call `matchProduct(payload, ocrBrand, ocrProductName, terms, logger)` to find/create products in DB, add as candidates
5. For remaining evidence: call gpt-4.1-mini with all signals (barcode, DINOv2 matches, OCR matches), receive consolidated product list with confidence + reasoning per entry
6. On LLM failure: fall back to formula scoring
7. Store compiled results in scene's `detections[]` array (product reference, confidence, sources list, barcodeValue, clipDistance, reasoning)

**Writes to**: `video-scenes.detections[]`, `products` (may create via `matchProduct`)

---

### Stage 7: `sentiment_analysis` — LLM Quote Extraction + Sentiment Scoring

**File**: `sentiment-analysis.ts`
**Checkbox**: `stageSentimentAnalysis`
**LLM**: Yes — `analyzeSentiment()`
**External**: OpenAI gpt-4.1-mini
**Event**: `video_processing.sentiment_analyzed`

Reads scenes with compiled detections and transcript data, runs LLM sentiment analysis per scene, creates video-mention records with full detection provenance.

**Flow**:
1. Fetch all scenes, concatenate scene transcripts on-the-fly to derive `fullTranscript` context
2. Collect products from compiled `detections[]` array
3. Build product info map (brand name + product name for each product)
4. **Delete existing video-mentions** for all scenes (idempotent re-run)
5. For each scene with `detections[]` and transcript text:
   - Call `analyzeSentiment(transcript, products, fullTranscript)` — LLM extracts quotes about each product with sentiment scores (no pre/post context params — the LLM prompt uses only the scene transcript and optional full transcript)
   - For each product result: create `video-mention` with `videoScene`, `product`, `quotes` array (text, summary, sentiment, sentimentScore), `overallSentiment`, `overallSentimentScore`, plus detection provenance from the compiled detections: `confidence`, `sources` (barcode/object_detection/vision_llm), `barcodeValue`, `clipDistance`

**Writes to**: `video-mentions`

**Sentiment scale**: Per-quote `sentimentScore` is -1 to +1. `overallSentiment` is a categorical label (positive/negative/neutral/mixed). `overallSentimentScore` is the average across quotes.

---

## Shared Patterns

- **Shared ML model singletons**: `object_detection` and `visual_search` use shared model singletons from `@/lib/models/` (Grounding DINO and DINOv2-base). These are the same singletons used by the product aggregation pipeline's `object_detection` and `embed_images` stages — models are loaded once and shared across both pipelines.
- **Temp directories**: Stages that need local files (scene_detection, object_detection, visual_search, ocr_extraction, transcription) create temp dirs via `fs.mkdtempSync()` with `try/finally` cleanup via `fs.rmSync()`
- **Media URL resolution**: Stages that read from media collections (video-media, detection-media) construct full URLs via `payload.serverUrl` + relative path (or use the URL directly if already absolute)
- **Heartbeat**: all stages call `ctx.heartbeat()` after heavy operations (downloads, per-segment loops, LLM calls) to keep the job claim alive
- **Token tracking**: LLM stages return categorized token counts in `StageResult.tokens`; the dispatcher accumulates these
- **Idempotency**: scene_detection and sentiment_analysis delete existing scenes/mentions before re-creating them, making re-runs safe. Other stages overwrite their respective arrays on scenes for idempotent re-runs.
- **Scene ownership**: video-scenes belong to a video (via `video` relationship). video-frames belong to a scene (via `scene` relationship). video-mentions belong to a scene (via `videoScene` relationship). Deleting scenes cascades to deleting their frames and mentions (scene_detection explicitly deletes video-mentions, then video-frames, then video-scenes per scene for idempotent re-runs).
- **Detection data on scenes, not frames**: All detection results (barcodes, objects, recognitions, detections) are stored on video-scenes in tabbed arrays. `llmMatches[]` also exists on video-scenes for backward compatibility with data written by the old `llm_recognition` stage (no longer part of the pipeline). Video-frames are pure frame records (image only) with no detection or matching data.

## Data Flow Between Stages

```
[video-crawl handler sets videos.videoFile + videos.thumbnail + status='crawled']
       |
scene_detection (reads videos.videoFile)
  └─ video-scenes (timestamps)
  └─ video-frames (image — per scene, hash-deduped)
       │
barcode_scan (reads ALL video-frames images)
  └─ video-scenes.barcodes[] (barcode values, product refs)
       │
object_detection (reads ALL video-frames)
  └─ video-scenes.objects[] (Grounding DINO crops as detection-media, bounding boxes)
       │
visual_search (reads ALL video-scenes.objects[] crops)
  └─ video-scenes.recognitions[] (DINOv2-base top-N candidates per crop, distance + product refs)
       │
ocr_extraction (reads ALL video-scenes.objects[] crops)
  └─ video-scenes.objects[].ocrText (visible text extracted via gpt-4.1-mini vision)
       │
transcription (reads videos.videoFile + scene barcodes/recognitions for keywords)
  └─ video-scenes.transcript (full audio → Deepgram STT → LLM correction, split into per-scene segments)
       │
compile_detections (reads scene barcodes + objects[with ocrText] + recognitions → matchProduct() for OCR + LLM consolidation)
  └─ video-scenes.detections[] (unified, with confidence + reasoning per entry)
       │
sentiment_analysis (reads video-scenes with detections + transcripts, concatenates scene transcripts on-the-fly for fullTranscript context)
  └─ video-mentions (quotes, sentiment, confidence, sources, barcodeValue, clipDistance)
```
