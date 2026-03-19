# Video Processing — Stage Pipeline

9-stage pipeline that processes YouTube videos into structured product mentions with sentiment scores and detection provenance. Each stage is a self-contained module that reads from the DB (prior stage's persisted output), does its work, and persists results immediately. Progress is tracked on the job's `videoProgress` JSON field — a `Record<string, StageName | null>` mapping video IDs to the last completed stage name.

## Architecture

### Registry (`index.ts`)

Central orchestration file. Exports:

- **`StageName`** — union of all 9 stage names
- **`VideoProgress`** — `Record<string, StageName | null>` progress map type
- **`StageConfig`** — job-level config: `jobId`, `sceneThreshold`, `clusterThreshold`, `transcriptionLanguage`, `transcriptionModel` (text, default 'whisper-1'), `minBoxArea` (fraction, default 0.25), `detectionThreshold` (0-1, default 0.3), `detectionPrompt` (string, default "cosmetics packaging."), `searchThreshold` (0-2, default 0.3), `searchLimit` (int, default 1)
- **`StageContext`** — injected into every stage: `payload` (REST client), `config`, `log` (Logger), `uploadMedia()`, `heartbeat()`
- **`StageResult`** — `{ success, error?, tokens?: { recognition?, transcriptCorrection?, sentiment?, total? } }`
- **`StageDefinition`** — `{ name, index, jobField, execute }` — the `jobField` maps to the checkbox on the VideoProcessings collection (e.g. `stageSceneDetection`, `stageBarcodeScan`)
- **`STAGES`** — ordered array of all 9 stage definitions
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
| Grounding DINO (ONNX) | object_detection, side_detection | Zero-shot object detection + side classification (shared singleton from `@/lib/models/grounding-dino`) |
| DINOv2-small (ONNX) | side_detection, visual_search | Image embedding for crop clustering + cosine similarity search (shared singleton from `@/lib/models/clip`) |
| OpenAI Whisper API | transcription | Speech-to-text (via `audio.transcriptions.create`) |
| OpenAI gpt-4.1-mini | llm_recognition, transcription, sentiment_analysis | LLM classification, correction, sentiment |

**Note**: Video download (`yt-dlp`) has been moved to the **video-crawl** handler — it is no longer part of the processing pipeline.

---

## Stages

### Stage 0: `scene_detection` — Detect Scenes, Extract Screenshots, Dedup

**File**: `scene-detection.ts`
**Checkbox**: `stageSceneDetection`
**LLM**: No
**External**: `ffmpeg` (scene detection + screenshot extraction)
**Event**: `video_processing.scene_detected`

Detects scene changes in the video, extracts screenshots per segment, deduplicates near-identical frames by perceptual hash, and creates video-scene + video-frame records. Frames are pure data records — no clustering or representative selection happens here (that's now done at the crop level by `side_detection` after `object_detection`).

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
   - Create `video-frame` records for each unique screenshot (no `isClusterRepresentative` or `clusterThumbnail` — clustering now happens at the crop level in `side_detection`)
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

Runs zero-shot object detection on ALL deduplicated frames for each scene (not just cluster representatives — clustering now happens at the crop level in the `side_detection` stage). Crops detections, uploads to detection-media, and stores in the scene's `objects[]` array.

**Scope**: All scenes for the video. ALL frames per scene (no `isClusterRepresentative` filter).

**Configurable parameters** (from job's Configuration tab → StageConfig):
- `detectionPrompt` — Grounding DINO text prompt (default: `"cosmetics packaging."`)
- `detectionThreshold` — confidence threshold 0-1 (default: 0.3)
- `minBoxArea` — minimum box area as fraction of screenshot area (default: 0.25 = 25%)

**Flow**:
1. Fetch all scenes for the video
2. For each scene, query ALL `video-frames` (no cluster representative filter)
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

### Stage 3: `side_detection` — Classify Crops, Cluster per Side, Pick Representatives

**File**: `side-detection.ts` (exports `executeSideDetection`)
**Checkbox**: `stageSideDetection`
**LLM**: No (ML inference via ONNX)
**External**: None (local ONNX inference)
**Events**: `video_processing.side_classified` (per crop), `video_processing.side_detection_complete` (aggregate)
**Models**: Grounding DINO (side classification) + DINOv2-small (crop clustering)

Takes detection crops from stage 2 and classifies each as front/back/unknown using Grounding DINO with targeted prompts, clusters crops per side using DINOv2 embedding cosine similarity, and picks the best representative per side-cluster. This ensures downstream stages work with front-of-package crops.

**Side classification prompts**:
- Front signals: `"brand logo."`, `"product name label."` — sums max scores
- Back signal: `"ingredient list. small text."` — max score
- `representativeScore = frontScore - backScore`
- front if frontScore > 0 and score > 0; back if backScore > 0 and score < 0; else unknown

**Clustering**: Greedy nearest-neighbor by DINOv2 cosine distance (threshold: 0.4). Crops within the threshold are grouped. Best representative per cluster = highest original detection score.

**Flow per scene**:
1. Read `objects[]` array from the scene
2. Phase 1 — Side classification: For each crop, run Grounding DINO with front and back prompts, classify as front/back/unknown
3. Phase 2 — Embedding: Compute DINOv2 embeddings for all crops
4. Phase 3 — Clustering: Group crops per side by embedding cosine distance, pick representative per cluster
5. Phase 4 — Update: Write `side`, `clusterGroup`, `isRepresentative` fields back to each object entry

**Writes to**: `video-scenes.objects[].side`, `video-scenes.objects[].clusterGroup`, `video-scenes.objects[].isRepresentative`

---

### Stage 4: `visual_search` — DINOv2 Visual Similarity Search (Representative Crops Only)

**File**: `visual-search.ts` (exports `executeVisualSearch`)
**Checkbox**: `stageVisualSearch`
**LLM**: No (ML inference via ONNX)
**External**: None (local ONNX inference + embeddings API)
**Events**: `video_processing.visual_search_detail` (per detection), `video_processing.visual_search_complete` (aggregate)
**Model**: DINOv2-small (shared singleton from `@/lib/models/clip`)

Computes transient DINOv2 embeddings for **representative** object detection crops and searches against stored product recognition image embeddings to match products. Only processes crops where `isRepresentative === true` (set by stage 3: side_detection). Falls back to processing all crops if side_detection hasn't run (backward compatibility).

**Scope**: All scenes for the video. Only representative objects from stages 2+3.

**Configurable parameters** (from job's Configuration tab → StageConfig):
- `searchThreshold` — maximum cosine distance for matching (0-2, default: 0.3). Try 0.5-0.7 for video screenshots which have different angles/lighting vs product photos.
- `searchLimit` — number of nearest neighbors to use for matching (default: 1). Only the top-1 is used for matching.

**Diagnostic behavior**: Always fetches at least 3 results from pgvector (regardless of `searchLimit`) to log near-misses. The server-side threshold filter is disabled — all top-N results are returned, and threshold filtering is applied client-side. This means even when no match is found, you can see the closest distance in the detail event.

**Flow**:
1. Fetch all scenes for the video
2. Per scene with objects[], per object detection:
   - Download detection crop from detection-media
   - Compute transient DINOv2-small embedding (384-dim, not persisted)
   - Search `recognition-images` embedding namespace (no server-side threshold, fetch top-N for diagnostics)
   - If best result is within `searchThreshold`, resolve product-variant → product
   - Emit `video_processing.visual_search_detail` event with: sceneId, detection index, best distance, best GTIN, match status
3. Store matched results in scene's `recognitions[]` array (product reference, distance, GTIN, detection reference)
4. Emit `video_processing.visual_search_complete` aggregate event with `embeddingsFailed` and `avgBestDistance`

**Writes to**: `video-scenes.recognitions[]`

---

### Stage 5: `llm_recognition` — LLM Classification + Product Matching (Representative Crops)

**File**: `llm-recognition.ts` (exports `executeLlmRecognition`)
**Checkbox**: `stageLlmRecognition`
**LLM**: Yes — `classifyScreenshots()` + `recognizeProduct()` + `matchProduct()`
**External**: OpenAI gpt-4.1-mini (vision)
**Event**: `video_processing.candidates_identified`, `video_processing.product_recognized`

Reads representative detection crops from each scene's `objects[]` array (set by side_detection stage). Runs a two-phase LLM pipeline on the crop images to identify and match products. Falls back to processing all objects if side_detection hasn't run (backward compatibility).

**Flow** per scene:

1. Get representative objects from scene's `objects[]` array (filter `isRepresentative=true`)

**Two phases**:
1. **Phase 1 — Classify**: Download crop images from detection-media → call `classifyScreenshots(inputs)` → LLM determines which contain a cosmetics product
2. **Phase 2 — Recognize**: For each candidate crop identified by classification:
   - Use the crop image (already downloaded in Phase 1)
   - Call `recognizeProduct(imagePaths)` → LLM extracts brand, product name, search terms
   - Call `matchProduct(payload, brand, name, terms, logger)` → finds/creates product in DB
3. Store results in scene's `llmMatches[]` array

**Writes to**: `video-scenes.llmMatches[]`, `products` (may create via `matchProduct`)

---

### Stage 6: `transcription` — Deepgram Full-Audio STT + Single LLM Correction

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
3. Collect product/brand names from scenes' `barcodes[]`, `recognitions[]`, and `llmMatches[]` for keyword boosting
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

### Stage 7: `compile_detections` — Synthesize All Detection Sources

**File**: `compile-detections.ts` (exports `executeCompileDetections`)
**Checkbox**: `stageCompileDetections`
**LLM**: No
**External**: None
**Event**: `video_processing.detections_compiled`

Reads all detection data from prior stages (barcodes[], objects[]+recognitions[], llmMatches[]) and synthesizes them into a unified `detections[]` array on each scene with standardized confidence scores.

**Confidence scoring**:
- Barcode match: confidence = 1.0 (definitive identification)
- Object detection + DINOv2 match: confidence = 1.0 - clipDistance
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

### Stage 8: `sentiment_analysis` — LLM Quote Extraction + Sentiment Scoring

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

- **Shared ML model singletons**: `object_detection`, `side_detection`, and `visual_search` use shared model singletons from `@/lib/models/` (Grounding DINO and DINOv2). These are the same singletons used by the product aggregation pipeline's `object_detection` and `embed_images` stages — models are loaded once and shared across both pipelines.
- **Temp directories**: Stages that need local files (scene_detection, object_detection, visual_search, transcription) create temp dirs via `fs.mkdtempSync()` with `try/finally` cleanup via `fs.rmSync()`
- **Media URL resolution**: Stages that read from media collections (video-media, detection-media) construct full URLs via `payload.serverUrl` + relative path (or use the URL directly if already absolute)
- **Heartbeat**: all stages call `ctx.heartbeat()` after heavy operations (downloads, per-segment loops, LLM calls) to keep the job claim alive
- **Token tracking**: LLM stages return categorized token counts in `StageResult.tokens`; the dispatcher accumulates these
- **Idempotency**: scene_detection and sentiment_analysis delete existing scenes/mentions before re-creating them, making re-runs safe. Other stages overwrite their respective arrays on scenes for idempotent re-runs.
- **Scene ownership**: video-scenes belong to a video (via `video` relationship). video-frames belong to a scene (via `scene` relationship). video-mentions belong to a scene (via `videoScene` relationship). Deleting scenes cascades to deleting their frames and mentions (scene_detection explicitly deletes video-mentions, then video-frames, then video-scenes per scene for idempotent re-runs).
- **Detection data on scenes, not frames**: All detection results (barcodes, objects, recognitions, llmMatches, detections) are stored on video-scenes in tabbed arrays. Video-frames are pure frame records (image only) with no detection or matching data. The `isClusterRepresentative` and `clusterThumbnail` fields on video-frames are legacy (no longer set by scene_detection).

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
object_detection (reads ALL video-frames — no cluster rep filter)
  └─ video-scenes.objects[] (Grounding DINO crops as detection-media, bounding boxes)
       │
side_detection (reads video-scenes.objects[] crops)
  └─ video-scenes.objects[].side (front/back/unknown)
  └─ video-scenes.objects[].clusterGroup (per-side cluster index)
  └─ video-scenes.objects[].isRepresentative (best crop per side-cluster)
       │
visual_search (reads video-scenes.objects[] where isRepresentative=true)
  └─ video-scenes.recognitions[] (DINOv2 matches with distance + product refs)
       │
llm_recognition (reads video-scenes.objects[] where isRepresentative=true)
  └─ video-scenes.llmMatches[] (LLM-identified products)
       │
transcription (reads videos.videoFile + scene barcodes/recognitions/llmMatches for keywords)
  └─ video-scenes.transcript (per-scene: ffmpeg clip extraction → Whisper API → LLM correction)
       │
compile_detections (reads scene barcodes + objects + recognitions + llmMatches)
  └─ video-scenes.detections[] (unified, confidence-scored, deduplicated)
       │
sentiment_analysis (reads video-scenes with detections + transcripts, concatenates scene transcripts on-the-fly for fullTranscript context)
  └─ video-mentions (quotes, sentiment, confidence, sources, barcodeValue, clipDistance)
```
