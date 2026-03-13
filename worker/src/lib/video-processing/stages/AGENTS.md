# Video Processing — Stage Pipeline

5-stage pipeline that processes YouTube videos into structured product mentions with sentiment scores. Each stage is a self-contained module that reads from the DB (prior stage's persisted output), does its work, and persists results immediately. Progress is tracked on the job's `videoProgress` JSON field — a `Record<string, StageName | null>` mapping video IDs to the last completed stage name.

## Architecture

### Registry (`index.ts`)

Central orchestration file. Exports:

- **`StageName`** — union of all 5 stage names
- **`VideoProgress`** — `Record<string, StageName | null>` progress map type
- **`StageConfig`** — job-level config: `jobId`, `sceneThreshold`, `clusterThreshold`, `transcriptionLanguage`, `transcriptionModel`
- **`StageContext`** — injected into every stage: `payload` (REST client), `config`, `log` (Logger), `uploadMedia()`, `heartbeat()`
- **`StageResult`** — `{ success, error?, tokens?: { recognition?, transcriptCorrection?, sentiment?, total? } }`
- **`StageDefinition`** — `{ name, index, jobField, execute }` — the `jobField` maps to the checkbox on the VideoProcessings collection (e.g. `stageDownload`)
- **`STAGES`** — ordered array of all 5 stage definitions
- **`getNextStage(lastCompleted, enabledStages)`** — finds the next enabled stage after `lastCompleted`
- **`getEnabledStages(job)`** — reads checkbox fields from the job document, returns `Set<StageName>`
- **`videoNeedsWork(lastCompleted, enabledStages)`** — true if the video has more stages to run
- **`getVideoProgress(job)`** — parses the JSON progress map from the job document

### Dispatcher (in `worker.ts`)

The handler in `worker.ts` is ~80 lines. It receives `stageItems: Array<{ videoId, title, stageName }>` from `claimWork()`, iterates each item, dispatches to `STAGES.find(s => s.name === stageName).execute(ctx, videoId)`, and reports results to `submitWork()`.

### Progress Tracking

Progress keys are video ID strings (e.g. `"42"`). The progress map is persisted to the job after every stage execution (both on batch release and completion).

### Stage Selection

Each stage has a checkbox field on the job (all default `true`). `getEnabledStages()` checks `job.stageDownload !== false`, etc. Disabled stages are skipped — `getNextStage()` finds the first enabled stage after `lastCompleted`.

### External Dependencies

All stages use CLI tools and external APIs — not bundled Node.js libraries:

| Tool | Used by | Purpose |
|------|---------|---------|
| `yt-dlp` | download | Video download from YouTube |
| `ffmpeg` | scene_detection, transcription | Scene change detection, audio extraction, screenshot extraction |
| `ffprobe` | download, scene_detection | Video duration/metadata |
| `zbarimg` | scene_detection | Barcode scanning in screenshots |
| Deepgram API | transcription | Speech-to-text |
| OpenAI gpt-4.1-mini | product_recognition, transcription, sentiment_analysis | LLM classification, correction, sentiment |

---

## Stages

### Stage 0: `download` — Download Video + Upload to Media

**File**: `download.ts` (~66 lines)
**Checkbox**: `stageDownload`
**LLM**: No
**External**: `yt-dlp`, `ffprobe`
**Event**: `video_processing.downloaded`

Downloads the video from YouTube, uploads the MP4 to the media collection, and links it to the video record.

**Flow**:
1. Fetch video document to get `externalUrl`
2. Create temp directory
3. Download video via `yt-dlp` → `video.mp4`
4. Get duration via `ffprobe`
5. Upload MP4 to media collection via `ctx.uploadMedia()`
6. Update video: `image` (media relationship — stores the video MP4), `duration`
7. Clean up temp directory

**Writes to**: `videos`, `media`

**Note**: The `image` field on `videos` is an upload to `media` that stores the video MP4 file (not a thumbnail). The media collection handles the actual file storage (local or S3).

---

### Stage 1: `scene_detection` — Detect Scenes, Extract Screenshots, Scan Barcodes

**File**: `scene-detection.ts` (~266 lines)
**Checkbox**: `stageSceneDetection`
**LLM**: No
**External**: `ffmpeg` (scene detection + screenshot extraction), `zbarimg` (barcode scanning)
**Event**: `video_processing.scene_detected`, `video_processing.barcode_found`, `video_processing.clustered`

Detects scene changes in the video, extracts screenshots per segment, scans for barcodes, clusters visually similar screenshots, and creates video-snippet records.

**Flow**:
1. Download video media from server to temp directory
2. Detect scene changes via `ffmpeg` with `sceneThreshold` (default 0.4)
3. Build segments from scene change timestamps (minimum 0.5s duration)
4. **Delete existing snippets** + video-mentions for this video (idempotent re-run)
5. For each segment:
   - Extract screenshots at 1fps via `ffmpeg`
   - Scan each screenshot for barcodes via `zbarimg`
   - **Barcode path**: If a barcode is found, upload all screenshots as media, create a `video-snippet` with `matchingType: 'barcode'` and the barcode value on the relevant screenshot entry
   - **Visual path**: If no barcode found:
     - Compute perceptual hashes via `sharp` thumbnail + hash
     - Cluster screenshots by hamming distance (threshold from `clusterThreshold` config)
     - Create recognition thumbnails for cluster representatives
     - Upload all screenshots, thumbnails, and recognition thumbnails as media
     - Create a `video-snippet` with `matchingType: 'visual'`, screenshot entries include `hash`, `screenshotGroup`, `distance`, `recognitionCandidate`, `recognitionThumbnail`
6. Clean up temp directory

**Writes to**: `video-snippets`, `media`

**Screenshot entry fields**: `image` (media), `thumbnail` (media, visual only), `hash` (string, visual only), `screenshotGroup` (number), `distance` (number, distance to cluster representative), `recognitionCandidate` (boolean), `recognitionThumbnail` (media, visual only), `barcode` (string, barcode path only)

---

### Stage 2: `product_recognition` — LLM Classification + Product Matching

**File**: `product-recognition.ts` (~233 lines)
**Checkbox**: `stageProductRecognition`
**LLM**: Yes — `classifyScreenshots()` + `recognizeProduct()` + `matchProduct()`
**External**: OpenAI gpt-4.1-mini (vision)
**Event**: `video_processing.candidates_identified`, `video_processing.product_recognized`

Reads existing video-snippets. For barcode snippets, looks up products by GTIN. For visual snippets, runs a two-phase LLM pipeline to identify and match products.

**Flow** per snippet:

**Barcode path**:
1. Extract barcode from screenshot entries
2. Look up `product-variants` by GTIN
3. If found, set `referencedProducts: [productId]` on the snippet

**Visual path** (two phases):
1. **Phase 1 — Classify**: Download recognition thumbnails for cluster representatives → call `classifyScreenshots(inputs)` → LLM determines which clusters contain a cosmetics product (returns `candidates` set of cluster group IDs)
2. **Phase 2 — Recognize**: For each candidate cluster:
   - Download up to 4 screenshots
   - Call `recognizeProduct(imagePaths)` → LLM extracts brand, product name, search terms
   - Call `matchProduct(payload, brand, name, terms, logger)` → finds/creates product in DB via LLM fuzzy matching
   - Collect matched product IDs
3. Update snippet: `referencedProducts: uniqueProductIds`

**Writes to**: `video-snippets`, `products` (may create via `matchProduct`)

---

### Stage 3: `transcription` — Deepgram STT + LLM Correction + Per-Snippet Splitting

**File**: `transcription.ts` (~163 lines)
**Checkbox**: `stageTranscription`
**LLM**: Yes — `correctTranscript()`
**External**: `ffmpeg` (audio extraction), Deepgram API (STT), OpenAI gpt-4.1-mini (correction)
**Event**: `video_processing.transcribed`, `video_processing.transcript_corrected`

Downloads the video, extracts audio, transcribes via Deepgram, corrects brand/product names via LLM, and splits the transcript per snippet.

**Flow**:
1. Download video media to temp directory
2. Extract audio via `ffmpeg` → WAV
3. Collect product/brand names from snippets' `referencedProducts` for keyword boosting
4. Transcribe via `transcribeAudio(audioPath, { language, model, keywords })` using Deepgram
5. Fetch all brand names for LLM correction context
6. Call `correctTranscript(rawTranscript, words, brandNames, productKeywords)` — LLM fixes misheard brand/product names
7. Save full transcript on video: `transcript`, `transcriptWords`
8. For each snippet: call `splitTranscriptForSnippet(words, start, end, preSeconds=5, postSeconds=3)` — extracts the transcript segment with pre/post context. Update snippet: `preTranscript`, `transcript`, `postTranscript`

**Writes to**: `videos`, `video-snippets`

**Config**: `transcriptionLanguage` (default 'de'), `transcriptionModel` (default 'nova-3')

---

### Stage 4: `sentiment_analysis` — LLM Quote Extraction + Sentiment Scoring

**File**: `sentiment-analysis.ts` (~137 lines)
**Checkbox**: `stageSentimentAnalysis`
**LLM**: Yes — `analyzeSentiment()`
**External**: OpenAI gpt-4.1-mini
**Event**: `video_processing.sentiment_analyzed`

Reads snippets with referenced products and transcript data, runs LLM sentiment analysis per snippet, creates video-mention records.

**Flow**:
1. Fetch video for full transcript context
2. Fetch all snippets, collect all referenced product IDs
3. Build product info map (brand name + product name for each product)
4. **Delete existing video-mentions** for all snippets (idempotent re-run)
5. For each snippet with `referencedProducts` and transcript text:
   - Call `analyzeSentiment(preTranscript, transcript, postTranscript, products, fullTranscript)` — LLM extracts quotes about each product with sentiment scores
   - For each product result: create `video-mention` with `videoSnippet`, `product`, `quotes` array (text, summary, sentiment, sentimentScore), `overallSentiment`, `overallSentimentScore`

**Writes to**: `video-mentions`

**Sentiment scale**: Per-quote `sentimentScore` is -1 to +1. `overallSentiment` is a categorical label (positive/negative/neutral/mixed). `overallSentimentScore` is the average across quotes.

---

## Shared Patterns

- **Temp directories**: Stages that need local files (download, scene_detection, product_recognition, transcription) create temp dirs via `fs.mkdtempSync()` with `try/finally` cleanup via `fs.rmSync()`
- **Media URL resolution**: Stages that read from media construct full URLs via `payload.serverUrl` + relative path (or use the URL directly if already absolute)
- **Heartbeat**: all stages call `ctx.heartbeat()` after heavy operations (downloads, per-segment loops, LLM calls) to keep the job claim alive
- **Token tracking**: LLM stages return categorized token counts in `StageResult.tokens`; the dispatcher accumulates these
- **Idempotency**: scene_detection and sentiment_analysis delete existing snippets/mentions before re-creating them, making re-runs safe
- **Snippet ownership**: video-snippets belong to a video (via `video` relationship). video-mentions belong to a snippet (via `videoSnippet` relationship). Deleting snippets cascades to deleting their mentions.

## Data Flow Between Stages

```
download
  └─ videos.image (media MP4)
       │
scene_detection (reads videos.image)
  └─ video-snippets (timestamps, screenshots, barcodes/hashes/clusters)
       │
product_recognition (reads video-snippets)
  └─ video-snippets.referencedProducts (product IDs)
       │
transcription (reads videos.image + video-snippets.referencedProducts for keywords)
  └─ videos.transcript + videos.transcriptWords
  └─ video-snippets.preTranscript / transcript / postTranscript
       │
sentiment_analysis (reads video-snippets with products + transcripts)
  └─ video-mentions (quotes, sentiment scores per product per snippet)
```
