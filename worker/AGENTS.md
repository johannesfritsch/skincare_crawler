# Worker — Architecture & Internals

Standalone Node.js process that claims jobs from the server and processes them. All business logic runs locally — the server is just a data store accessed via Payload's REST API.

## Source Layout

```
worker/src/
├── worker.ts                         # Main loop + 6 job handlers (~1000 lines)
└── lib/
    ├── payload-client.ts             # REST client mirroring Payload's local API
    ├── logger.ts                     # Structured logger with event emission
    ├── browser.ts                    # Playwright browser management
    ├── stealth-fetch.ts              # Fetch with anti-bot headers
    ├── parse-ingredients.ts          # Ingredient string parser
    ├── source-product-queries.ts     # Source-product DB query helpers + normalizeProductUrl()
    │
    ├── work-protocol/
    │   ├── types.ts                  # AuthenticatedWorker interface
    │   ├── claim.ts                  # claimWork() — find & build work units
    │   ├── submit.ts                 # submitWork() — persist results, update job status
    │   └── persist.ts                # persist*() — DB write operations for each job type
    │
    ├── source-discovery/
    │   ├── types.ts                  # SourceDriver, ScrapedProductData, DiscoveredProduct
    │   ├── driver.ts                 # getSourceDriver(url), getSourceDriverBySlug(slug)
    │   └── drivers/
    │       ├── dm.ts                 # DM drugstore driver
    │       ├── mueller.ts            # Mueller driver
    │       └── rossmann.ts           # Rossmann driver
    │
    ├── ingredients-discovery/
    │   ├── types.ts                  # ScrapedIngredientData
    │   ├── driver.ts                 # getDriver(url)
    │   └── drivers/cosing.ts         # EU CosIng database crawler
    │
    ├── video-discovery/
    │   ├── types.ts                  # DiscoveredVideo
    │   ├── driver.ts                 # getVideoDriver(url)
    │   └── drivers/youtube.ts        # YouTube channel video lister
    │
    ├── video-processing/
    │   ├── process-video.ts          # downloadVideo, detectSceneChanges, extractScreenshots,
    │   │                             # scanBarcode, createThumbnailAndHash, hammingDistance
    │   ├── recognize-product.ts      # classifyScreenshots (LLM), recognizeProduct (LLM)
    │   ├── transcribe-audio.ts       # extractAudio (ffmpeg), transcribeAudio (Deepgram API)
    │   ├── correct-transcript.ts     # correctTranscript (LLM) — fix STT errors with skincare context
    │   ├── split-transcript.ts       # splitTranscriptForSnippet — pre/main/post by timestamps
    │   └── analyze-sentiment.ts      # analyzeSentiment (LLM) — extract quotes & sentiment per product
    │
    ├── match-brand.ts                # matchBrand(client, brandName) — LLM-powered
    ├── match-ingredients.ts          # matchIngredients(client, names[]) — LLM-powered
    ├── match-product.ts              # matchProduct(client, brand, name, terms) — LLM-powered
    ├── classify-product.ts           # classifyProduct(client, sources, lang) — LLM-powered
    └── aggregate-product.ts          # aggregateFromSources(sourceProducts) — pure logic
```

## Main Loop (`worker.ts`)

```
1. Authenticate         GET /api/workers/me  →  AuthenticatedWorker
2. claimWork(client)     Query all job collections for pending/in_progress
                         Prioritize "selected target" jobs, else pick random
                         Build work unit with all data needed by handler
3. Run handler           handleProductCrawl / handleProductDiscovery / etc.
4. submitWork(client)    Persist results → update job status/progress
5. Sleep (POLL_INTERVAL) Repeat from step 2
```

### Env vars

```
WORKER_SERVER_URL       Base URL of the server (default: http://localhost:3000)
WORKER_API_KEY          API key from workers collection (required)
WORKER_POLL_INTERVAL    Seconds between polls when idle (default: 10)
LOG_LEVEL               debug|info|warn|error (default: info)
OPENAI_API_KEY          For LLM tasks: matching, classification, video recognition
DEEPGRAM_API_KEY        For Deepgram speech-to-text transcription
```

## REST Client (`PayloadRestClient`)

`lib/payload-client.ts` mirrors Payload's local API for use over HTTP. The worker never imports Payload directly.

```typescript
const client = new PayloadRestClient(serverUrl, apiKey)

client.find({ collection, where?, limit?, sort? })    → { docs, totalDocs }
client.findByID({ collection, id })                   → document
client.create({ collection, data, file? })            → document  // file = multipart upload
client.update({ collection, id, data })               → document  // by ID
client.update({ collection, where, data })             → document  // bulk by where clause
client.delete({ collection, where })                   → result
client.count({ collection, where? })                   → { totalDocs }
client.me()                                            → AuthenticatedWorker
```

All requests use `Authorization: workers API-Key <key>` header.

## Work Protocol

### claimWork (`work-protocol/claim.ts`)

1. For each job type the worker's capabilities include:
   - Query `in_progress` and `pending` jobs (limit 10 each)
2. Collect all active jobs across types
3. Priority: "selected target" jobs first (selected_urls, selected_gtins, from_discovery), else random
4. Call `build*Work()` for the selected job type — this:
   - Fetches the full job document
   - Initializes the job if pending (set status=in_progress, count totals, create stubs)
   - Builds and returns a typed work unit with all data needed by the handler
   - May complete the job early if no work remains (returns `{ type: 'none' }`)

### submitWork (`work-protocol/submit.ts`)

Dispatches to per-type submit handlers. Each handler:
1. Calls the appropriate `persist*()` function for each result item
2. Updates job progress counters (crawled, errors, discovered, created, etc.)
3. Checks completion condition and marks job `completed` if done
4. Emits events via the logger

### persist (`work-protocol/persist.ts`)

| Function | What it writes |
|----------|---------------|
| `persistCrawlResult()` | Updates/creates `source-products` with scraped data, price history, source category lookup; creates `crawl-results` join record |
| `persistCrawlFailure()` | Creates `crawl-results` with error |
| `persistDiscoveredProduct()` | Creates/updates `source-products` (status=uncrawled); creates `discovery-results` join record |

| `persistIngredient()` | Creates/updates `ingredients` (fills in missing CAS#, EC#, functions, etc.) |
| `persistVideoDiscoveryResult()` | Creates/updates `channels`, `creators`, `videos`; downloads thumbnails; always updates channel avatar image |
| `persistVideoProcessingResult()` | Creates `video-snippets` with screenshots, referencedProducts + transcripts; creates `video-mentions` with sentiment; matches products by barcode (GTIN lookup) or visual (LLM matchProduct); saves transcript on video; marks video as processed |
| `persistProductAggregationResult()` | Creates/updates `products`; runs matchBrand, matchIngredients, applies classification (productType, attributes, claims with evidence including sourceProduct ref and start/end offsets for description snippets); computes and prepends score history (store + creator scores on 0–10 scale, with `change` enum: drop/stable/increase) |

## 6 Job Types — Detailed

### 1. product-crawl

**Handler**: `handleProductCrawl()`
**Flow**: For each work item → `getSourceDriverBySlug(source)` → `driver.scrapeProduct(url)` → collect results → `submitWork()`

**Crawl types**:
- `all` — all uncrawled source-products for given source(s)
- `selected_urls` — specific URLs from the job's `urls` field
- `selected_gtins` — look up source-products by GTIN, crawl their URLs
- `from_discovery` — crawl URLs from a linked product-discovery job

**Scope**: `recrawl` resets matching products back to `uncrawled` (optionally filtered by `minCrawlAge`)

**Resumption**: Source-products with `status=uncrawled` are the implicit work queue. Each batch fetches `itemsPerTick` (default 10) uncrawled items.

### 2. product-discovery

**Handler**: `handleProductDiscovery()`
**Flow**: For each source URL → `getSourceDriver(url)` → `driver.discoverProducts()` with callbacks → yields `DiscoveredProduct[]` → submit

**Resumption**: Stores `currentUrlIndex` + `driverProgress` (driver-specific pagination state) in the job's `progress` JSON field. The driver receives `progress` on the next claim to continue where it left off.

**Key params**: `maxPages` (pages per tick), `delay` (ms between requests, default 2000)

### 3. ingredients-discovery

**Handler**: `handleIngredientsDiscovery()`
**Flow**: `getIngredientsDriver(url)` → crawls CosIng → yields `ScrapedIngredientData[]` → submit

**Resumption**: Stores `currentTerm`, `currentPage`, `totalPagesForTerm`, `termQueue` (list of search terms to process)

### 4. video-discovery

**Handler**: `handleVideoDiscovery()`
**Flow**: `getVideoDriver(channelUrl)` → lists all videos → submit in batches

**Persistence**: Creates `creators` → `channels` → `videos` chain. Downloads and uploads video thumbnails. Fetches the channel avatar (from YouTube `og:image` meta tag) and always updates the `channels.image` field — both for new and existing channels.

### 5. video-processing

**Handler**: `handleVideoProcessing()` (~700 lines, most complex handler)
**Flow per video**:

```
1. downloadVideo(url)              → local file path
2. uploadMedia(path)               → media record ID
3. detectSceneChanges(path, threshold=0.4)  → scene boundaries
4. For each segment:
   a. extractScreenshots(path, start, end, fps=1)
   b. Upload each screenshot as media
   c. scanBarcode(screenshotPath)
      → If barcode found: matchingType='barcode', done
      → If no barcode:
        d. createThumbnailAndHash(path) → 64x64 grayscale perceptual hash
        e. Cluster screenshots by hammingDistance (threshold=25)
        f. classifyScreenshots(clusters) → LLM: "is this a product?"
        g. recognizeProduct(candidates) → LLM: brand, product name, search terms
        h. createRecognitionThumbnail(path) → 128x128 for matched clusters
5. Transcription pipeline (if enabled):
   a. extractAudio(videoPath) → WAV file (ffmpeg, mono 16kHz)
   b. transcribeAudio(audioPath, { language, model, keywords })
      → Deepgram API with product/brand names as boosted keywords
      → Returns transcript text + word-level timestamps
   c. correctTranscript(rawTranscript, words, allBrandNames, productNames)
      → LLM pass (gpt-4.1-mini) to fix STT errors with skincare domain context
   d. splitTranscriptForSnippet(words, start, end, pre=5s, post=3s)
      → For each segment: preTranscript, transcript, postTranscript
   e. analyzeSentiment(pre, transcript, post, products)
      → LLM pass (gpt-4.1-mini) per segment: extract product quotes + sentiment scores
6. Submit results with segments, screenshots, referencedProducts, transcripts, video-mentions
```

**Processing types**: `all_unprocessed`, `single_video`, `selected_urls`

**Transcription config** (from VideoProcessings job):
- `transcriptionEnabled` (default: true)
- `transcriptionLanguage` (default: 'de', options: de/en/fr/es/it)
- `transcriptionModel` (default: 'nova-3', options: nova-3/nova-2/enhanced/base)

**Persistence**: Creates `video-snippets` per segment (with referencedProducts + transcript fields). Creates `video-mentions` linking snippets to products with quotes and sentiment (only when transcript data exists). Saves full transcript + word timestamps on the video. For visual matches, calls `matchProduct()` to find/create product records.

### 6. product-aggregation

**Handler**: `handleProductAggregation()`
**Flow per GTIN**:

```
1. aggregateFromSources(sourceProducts, { imageSourcePriority })    → merged data (pure logic)
   - GTIN: first non-null
   - Name: longest string
   - Brand: first non-null
   - Ingredients: from source with longest list
   - Image: first image from highest-priority source (configurable via imageSourcePriority, default: dm > rossmann > mueller)
2. [full scope only] classifyProduct(client, sources, lang)  → LLM classification
   - Product type, attributes, claims with evidence
3. Submit results
```

**Scope** (`scope` field on job, passed through claim → handler → submit → persist):
- `full`: Runs all LLM-heavy operations — `classifyProduct()`, `matchBrand()`, `matchIngredients()`, image download/upload, and score history computation.
- `partial`: Skips all LLM calls and image operations. Only updates basic product data (name, GTIN, source product links) and computes score history. Use for cheap periodic score refreshes.

**Persistence** (`persistProductAggregationResult`):
- Creates/updates `products` record (always)
- Merges source product IDs (always)
- Updates name/GTIN (always)
- [full only] Calls `matchBrand()` → links brand
- [full only] Calls `matchIngredients()` → links ingredient records
- [full only] Downloads selected image URL → uploads to `media` collection → sets `image` on product
- [full only] Applies classification: productType, attributes (with evidence), claims (with evidence)
- Computes score history (always): fetches source-product ratings → store score (0–10), video-mention sentiments → creator score (0–10). Prepends new entry to `products.scoreHistory[]`. Sets `change` to `drop`/`stable`/`increase` based on score direction vs previous entry (compares store score first, then creator score; if both exist and store is `stable`, creator can override).

**Aggregation types**: `all` (cursor-based via `lastCheckedSourceId`), `selected_gtins`

## Source Drivers

### Interface (`source-discovery/types.ts`)

```typescript
interface SourceDriver {
  slug: SourceSlug           // 'dm' | 'mueller' | 'rossmann'
  label: string
  logoSvg: string            // inline SVG markup for the store logo (used in frontend UI)
  matches(url: string): boolean
  discoverProducts(options: ProductDiscoveryOptions): Promise<ProductDiscoveryResult>
  scrapeProduct(url: string, options?: { debug?: boolean }): Promise<ScrapedProductData | null>
}
```

**Resolution**:
- `getSourceDriver(url)` — matches URL against all drivers
- `getSourceDriverBySlug(slug)` — direct lookup

### ScrapedProductData

Returned by `driver.scrapeProduct()`:

```typescript
interface ScrapedProductData {
  gtin?: string
  name: string
  brandName?: string
  description?: string
  ingredientNames: string[]
  priceCents?: number
  currency?: string
  priceInfos?: string[]
  amount?: number
  amountUnit?: string
  images: Array<{ url: string; alt?: string | null }>
  variants: Array<{ dimension: string; options: Array<{ label, value, gtin, isSelected }> }>
  labels?: string[]
  rating?: number
  ratingNum?: number
  sourceArticleNumber?: string
  categoryBreadcrumbs?: string[]
  categoryUrl?: string
  canonicalUrl?: string
  perUnitAmount?: number
  perUnitQuantity?: number
  perUnitUnit?: string
  warnings: string[]
}
```

### DiscoveredProduct

Returned by `driver.discoverProducts()`:

```typescript
interface DiscoveredProduct {
  gtin?: string
  productUrl: string
  brandName?: string
  name?: string
  price?: number          // cents
  currency?: string
  rating?: number
  ratingCount?: number
  category?: string       // "Make-up -> Augen -> Lidschatten"
  categoryUrl?: string
}
```

## Matching Functions (LLM-powered)

All use OpenAI via `OPENAI_API_KEY`. Each returns a `tokensUsed` object.

| Function | Input | Output | Called by |
|----------|-------|--------|-----------|
| `matchBrand(client, brandName, logger)` | brand name string | `{ brandId, tokensUsed }` | `persistProductAggregationResult` |
| `matchIngredients(client, names[], logger)` | raw ingredient names | `{ matched[], unmatched[], tokensUsed }` | `persistProductAggregationResult` |
| `matchProduct(client, brand, name, terms, logger)` | brand + product name + search terms | `{ productId, productName }` | `persistVideoProcessingResult` |
| `classifyProduct(client, sources, lang)` | source-product descriptions + ingredients | `{ description, productType, warnings, skinApplicability, phMin, phMax, usageInstructions, usageSchedule, productAttributes[], productClaims[], tokensUsed }` — detail fields extracted from descriptions by LLM; evidence entries include `sourceIndex`, `type`, `snippet`, `start`/`end` (char offsets), `ingredientNames` | `handleProductAggregation` |
| `correctTranscript(rawTranscript, words, brands, products)` | raw STT transcript + brand/product names | `{ correctedTranscript, corrections[], tokensUsed }` | `handleVideoProcessing` |
| `analyzeSentiment(pre, transcript, post, products)` | transcript segments + product info | `{ products[]: { quotes[], overallSentiment, score }, tokensUsed }` | `handleVideoProcessing` |

## Logging (`lib/logger.ts`)

```typescript
const log = createLogger('ComponentName')

log.debug('message')                              // console only (if LOG_LEVEL allows)
log.info('message')                               // console only
log.info('message', { event: true })              // console + creates Events record in DB
log.info('message', { event: 'start' })           // console + Events with explicit type
log.info('message', { labels: ['scraping'] })     // add labels for filtering

const jlog = log.forJob('product-crawls', 42)     // scoped to a job (required for event emission)
jlog.info('scraped product', { event: true })      // creates Events linked to job #42
```

**Levels**: `debug` < `info` < `warn` < `error`. Set via `LOG_LEVEL` env var.

**Event types**: `start`, `success`, `info`, `warning`, `error`. Auto-derived from log level, or set explicitly.

## Key Patterns

- **Batch processing**: All jobs process `itemsPerTick` items per claim cycle (default 10, video processing default 1)
- **Heartbeat**: Long-running operations call `heartbeat(jobId, type, progress?)` to update `workers.lastSeenAt` and job progress
- **Resumable jobs**: Progress state stored in job's JSON fields, allowing pause/resume across worker restarts
- **Media uploads**: Worker uploads files to `/api/media` via multipart `FormData` with API key auth
- **URL normalization**: All product URLs are passed through `normalizeProductUrl()` (in `source-product-queries.ts`) before storage or lookup. This strips query parameters, trailing slashes, hash fragments, and lowercases the URL. Applied in all 3 source drivers at URL construction time, in `persist.ts` (crawl results + discovered products + canonicalUrl), in `claim.ts` (URL parsing from job fields), and in query helpers (`findUncrawled`, `countUncrawled`, `resetProducts`). The `sourceUrl` field on `source-products` has a `unique: true` constraint to enforce deduplication at the DB level.
- **Category breadcrumbs**: Source-products store category as a `categoryBreadcrumb` text string (e.g. `"Pflege -> Körperpflege -> Handcreme"`), written by crawl/discovery persist functions. This is raw metadata from retailers; it is not mapped to any collection during aggregation.
- **Deduplication**: Source-products are matched by `sourceUrl` (unique constraint) to prevent duplicates
- **Price history**: Each crawl/discovery appends to the `priceHistory` array on source-products
- **Join records**: `crawl-results` and `discovery-results` link jobs to the source-products they produced
- **External CLIs**: `yt-dlp`, `ffmpeg`, `ffprobe`, `zbarimg` (video processing)
- **External APIs**: Deepgram (speech-to-text), OpenAI gpt-4.1-mini (LLM correction, sentiment analysis, recognition, matching)

## Keeping This File Up to Date

Whenever you make changes to the worker codebase, **update this file** to reflect those changes. This includes additions or modifications to job handlers, the work protocol, source drivers, matching/classification functions, the REST client, logging, or any worker-side patterns documented here. Documentation must stay in sync with the code.

For changes that affect the overall repository layout or cross both server and worker, also update the root `AGENTS.md`. See the root file for the full policy.
