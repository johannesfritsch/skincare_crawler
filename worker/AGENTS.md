# Worker — Architecture & Internals

Standalone Node.js process that claims jobs from the server and processes them. All business logic runs locally — the server is just a data store accessed via Payload's REST API.

## Source Layout

```
worker/src/
├── worker.ts                         # Main loop + 6 job handlers (~1000 lines)
└── lib/
    ├── payload-client.ts             # REST client mirroring Payload's local API
    ├── logger.ts                     # Structured logger with event emission
    ├── browser.ts                    # Playwright browser management (stealth-enabled via playwright-extra)
    ├── stealth-fetch.ts              # Fetch with anti-bot headers
    ├── parse-ingredients.ts          # Ingredient text → name[] parser (LLM, handles footnotes/asterisks)
    ├── source-product-queries.ts     # Source-product/variant DB query helpers + normalizeProductUrl() + normalizeVariantUrl()
    │
    ├── work-protocol/
    │   ├── types.ts                  # AuthenticatedWorker interface
    │   ├── claim.ts                  # claimWork() — find & build work units (exports JOB_TYPE_TO_COLLECTION, JobType)
    │   ├── submit.ts                 # submitWork() — persist results, update job status, retry/fail on 100% errors
    │   ├── persist.ts                # persist*() — DB write operations for each job type
    │   └── job-failure.ts            # failJob(), retryOrFail() — shared job failure/retry logic
    │
    ├── source-discovery/
    │   ├── types.ts                  # SourceDriver, ScrapedProductData, DiscoveredProduct
    │   ├── driver.ts                 # getSourceDriver(url), getSourceDriverBySlug(slug)
    │   └── drivers/
    │       ├── dm.ts                 # DM drugstore driver
    │       ├── mueller.ts            # Mueller driver
    │       ├── rossmann.ts           # Rossmann driver
    │       └── purish.ts             # PURISH driver (Shopify API-based)
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
    └── aggregate-product.ts          # aggregateFromSources(sourceProducts) — pure logic (no GTIN; GTIN comes from work item)
```

## Main Loop (`worker.ts`)

```
1. Authenticate         GET /api/workers/me  →  AuthenticatedWorker
2. claimWork(client)     Query all job collections for pending + stale in_progress
                         Prioritize "selected target" jobs, else random
                         Attempt to claim via PATCH (claimedBy + claimedAt)
                         Server-side hook rejects if already claimed by another worker
                         On rejection, try next candidate
                         Build work unit with all data needed by handler
3. Run handler           handleProductCrawl / handleProductDiscovery / etc.
4. heartbeat()           Refreshes claimedAt + lastSeenAt during long operations
5. submitWork(client)    Persist results → update job status/progress
                         If 100% errors in batch → retryOrFail (increment retryCount, fail if > maxRetries)
6. On handler throw      Main loop catches → retryOrFail (increment retryCount, fail if > maxRetries)
7. Sleep (POLL_INTERVAL) Repeat from step 2
```

### Env vars

```
WORKER_SERVER_URL              Base URL of the server (default: http://localhost:3000)
WORKER_API_KEY                 API key from workers collection (required)
WORKER_POLL_INTERVAL           Seconds between polls when idle (default: 10)
WORKER_JOB_TIMEOUT_MINUTES     Minutes before abandoned job can be reclaimed (default: 30)
LOG_LEVEL                      debug|info|warn|error (default: info)
LOG_FORMAT                     text|json (default: text; json = newline-delimited JSON for log aggregators)
OPENAI_API_KEY                 For LLM tasks: matching, classification, video recognition
DEEPGRAM_API_KEY               For Deepgram speech-to-text transcription
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

1. For each job type the worker's capabilities include, query three categories of claimable jobs:
   - **Unclaimed in-progress**: `status=in_progress` AND `claimedBy` is null — jobs released between batches, immediately available for any worker
   - **Stale in-progress**: `status=in_progress` AND `claimedBy` exists AND `claimedAt` older than `WORKER_JOB_TIMEOUT_MINUTES` (default 30m) — abandoned by crashed workers
   - **Pending**: `status=pending` — new jobs not yet started
2. Collect all claimable jobs across types (deduplicated by ID)
3. Priority: "selected target" jobs first (selected_urls, selected_gtins, from_discovery), else random
4. Attempt to claim by PATCHing `claimedBy` + `claimedAt` on the job (sends `X-Job-Timeout-Minutes` header)
   - Server-side `enforceJobClaim` hook rejects if the job is already claimed by a different worker with a fresh `claimedAt`
   - On rejection, try the next candidate
5. Call `build*Work()` for the claimed job type — this:
   - Fetches the full job document
   - Initializes the job if pending (set status=in_progress, count totals, create stubs)
   - Builds and returns a typed work unit with all data needed by the handler
   - May complete the job early if no work remains (returns `{ type: 'none' }`)

**Important**: A freshly claimed in-progress job (`claimedBy` set, `claimedAt` recent) will NOT match any of these queries — this prevents double-processing. Workers are stateless; all job progress lives on the server.

### submitWork (`work-protocol/submit.ts`)

Dispatches to per-type submit handlers. Each handler:
1. Calls the appropriate `persist*()` function for each result item
2. Updates job progress counters (crawled, errors, discovered, created, etc.)
3. Checks completion condition:
   - **Done with successes**: marks job `completed` with `completedAt` timestamp
   - **Done with 100% errors**: calls `retryOrFail()` — increments `retryCount`, fails the job if `maxRetries` exceeded, otherwise releases claim for retry
   - **Not done**: releases the claim by setting `claimedBy: null, claimedAt: null` — this makes the job immediately available for any worker to pick up on the next poll cycle
4. Emits events via the logger

### Job Failure (`work-protocol/job-failure.ts`)

Shared utilities for marking jobs as failed and implementing retry logic:

- **`failJob(payload, collection, jobId, reason)`** — immediately marks a job as `failed` with `failedAt` + `failureReason`. Used for permanent errors (e.g. no driver for URL).
- **`retryOrFail(payload, collection, jobId, reason)`** — increments `retryCount`, checks against `maxRetries` (default 3). If exceeded, fails the job. Otherwise releases the claim for retry. Returns `true` if the job was failed. Used for transient errors (100% batch failures, handler exceptions).

Jobs fail in three scenarios:
1. **Handler throws** — the main loop catches it and calls `retryOrFail`. After `maxRetries` attempts, the job is marked `failed`.
2. **100% error batch** — `submitWork` detects that all items in a batch errored and calls `retryOrFail` instead of marking `completed`.
3. **Permanent error** — handler detects an unrecoverable condition (e.g. no driver for URL) and calls `failJob` immediately.

All job collections have `retryCount`, `maxRetries` (default 3), `failedAt`, and `failureReason` fields via `jobClaimFields`.

### persist (`work-protocol/persist.ts`)

| Function | What it writes |
|----------|---------------|
| `persistCrawlResult()` | Updates parent `source-products` with scraped data (name, brand, images, price history, ingredients, rating, etc.); updates the crawled `source-variant`'s GTIN, canonical URL, and `crawledAt`; creates sibling `source-variants` from variant URLs provided by the driver (all sources — DM, Mueller, Rossmann); for Mueller, deletes the base-URL variant (no `?itemId=`) when `?itemId=` variants are discovered (avoids duplicate entries); defers parent `crawled` status when `crawlVariants=true` and siblings need crawling; creates `crawl-results` join record |
| `persistCrawlFailure()` | Creates `crawl-results` with error |
| `persistDiscoveredProduct()` | Dedup by source-variant URL; creates `source-products` + source-variant together when new; updates existing parent source-product when variant URL already exists; creates `discovery-results` join record |

| `persistIngredient()` | Creates/updates `ingredients` (fills in missing CAS#, EC#, functions, etc.) |
| `persistVideoDiscoveryResult()` | Creates/updates `channels`, `creators`, `videos`; downloads thumbnails; always updates channel avatar image |
| `persistVideoProcessingResult()` | Creates `video-snippets` with screenshots, referencedProducts + transcripts; creates `video-mentions` with sentiment; matches products by barcode (GTIN lookup via `product-variants`) or visual (LLM matchProduct); saves transcript on video; marks video as processed |
| `persistProductAggregationResult()` | Finds/creates `products` via `product-variants` GTIN lookup (no longer uses `products.gtin`); creates `product-variants` with GTIN + source-variant links for new products; [full only] runs matchBrand, parses raw ingredientsText via `parseIngredients()` LLM call then matchIngredients, uploads image, applies classification (productType, attributes, claims with evidence); [always] computes and prepends score history (store + creator scores on 0–10 scale, with `change` enum: drop/stable/increase) |

## 8 Job Types — Detailed

### 1. product-crawl

**Handler**: `handleProductCrawl()`
**Flow**: For each work item (with `sourceVariantId`, `sourceProductId`, `sourceUrl`, `source`) → `getSourceDriverBySlug(source)` → `driver.scrapeProduct(url)` → collect results → `submitWork()`

**Crawl types**:
- `all` — all uncrawled source-variants (whose parent source-product has `status=uncrawled`) for given source(s)
- `selected_urls` — specific URLs from the job's `urls` field (normalized via `normalizeVariantUrl` which preserves `?itemId=` for Mueller)
- `selected_gtins` — look up source-variants by GTIN, crawl their URLs
- `from_discovery` — crawl URLs from a linked product-discovery job

**Scope**: `recrawl` resets matching source-products back to `uncrawled` and clears `crawledAt` on their variants (optionally filtered by `minCrawlAge`)

**`crawlVariants`** (default: true): When enabled, after crawling a variant, any sibling variant URLs discovered on the page are also crawled. All three drivers (DM, Mueller, Rossmann) extract full variant URLs from the page — the driver is the source of truth for URL construction, persist just stores whatever the driver provides. The parent source-product stays `uncrawled` until all its variants have been crawled. When disabled, only the default variant per product is crawled and the parent is immediately marked `crawled`.

**Variant tracking**: Each source-variant has a `crawledAt` timestamp set when it is individually crawled. `findUncrawledVariants()` skips variants where `crawledAt` is already set. When `crawlVariants=true` for scoped jobs (selected_urls, selected_gtins, from_discovery), the system resolves the original URLs to source-product IDs and finds ALL their uncrawled variants (including sibling variants with different URLs).

**Resumption**: Source-variants whose parent has `status=uncrawled` and whose own `crawledAt` is null are the implicit work queue (via `findUncrawledVariants()`). Each batch fetches `itemsPerTick` (default 10) uncrawled items.

### 2. product-discovery

**Handler**: `handleProductDiscovery()`
**Flow**: For each source URL → `getSourceDriver(url)` → `driver.discoverProducts()` with callbacks → yields `DiscoveredProduct[]` → submit

**Resumption**: Stores `currentUrlIndex` + `driverProgress` (driver-specific pagination state) in the job's `progress` JSON field. The driver receives `progress` on the next claim to continue where it left off.

**Key params**: `maxPages` (pages per tick), `delay` (ms between requests, default 2000)

### 3. product-search

**Handler**: `handleProductSearch()`
**Flow**: For each selected source → `getSourceDriverBySlug(slug)` → `driver.searchProducts({ query, maxResults })` → collect all results → submit all at once → complete

**One-shot job**: Unlike discovery, search jobs run to completion in a single claim cycle. No pagination state, no resumption needed.

**Key params**: `query` (search text), `sources` (dm/mueller/rossmann, multi-select), `maxResults` (per source, default 50)

**Persistence**: Reuses `persistDiscoveredProduct()` from discovery pipeline. Creates `search-results` join records (not `discovery-results`). Each result tracks which source it came from.

**Driver support**: All three drivers fully implemented. DM uses API-based search (`product-search.services.dmtech.com`). Rossmann and Mueller use Playwright-based browser scraping of their search pages (`/de/search?text=` and `/search/?q=` respectively), with pagination support.

### 4. ingredients-discovery

**Handler**: `handleIngredientsDiscovery()`
**Flow**: `getIngredientsDriver(url)` → crawls CosIng → yields `ScrapedIngredientData[]` → submit

**Resumption**: Stores `currentTerm`, `currentPage`, `totalPagesForTerm`, `termQueue` (list of search terms to process)

### 5. video-discovery

**Handler**: `handleVideoDiscovery()`
**Flow**: `getVideoDriver(channelUrl)` → `driver.discoverVideoPage(url, { startIndex, endIndex })` → submit batch → release claim → repeat until end of channel or `maxVideos` reached

**Resumption**: Stores `currentOffset` (0-based video index) in the job's `progress` JSON field. Each batch fetches `itemsPerTick` (default 50) videos via yt-dlp's `--playlist-start`/`--playlist-end` flags (1-based). The batch is done when the driver returns fewer videos than requested (`reachedEnd`) or when the offset reaches `maxVideos`.

**Key params**: `itemsPerTick` (videos per batch, default 50), `maxVideos` (stop after this many, unlimited if empty)

**Persistence**: Creates `creators` → `channels` → `videos` chain. Downloads and uploads video thumbnails. Fetches the channel avatar (from YouTube `og:image` meta tag) and always updates the `channels.image` field — both for new and existing channels.

### 6. video-processing

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

**Persistence**: Creates `video-snippets` per segment (with referencedProducts + transcript fields). Creates `video-mentions` linking snippets to products with quotes and sentiment (only when transcript data exists). Saves full transcript + word timestamps on the video. Barcode matches look up `product-variants` by GTIN to find the parent product. For visual matches, calls `matchProduct()` to find/create product records.

### 7. product-aggregation

**Handler**: `handleProductAggregation()`
**Flow per GTIN**:

```
1. aggregateFromSources(sourceProducts, { imageSourcePriority })    → merged data (pure logic)
   - Name: longest string
   - Brand: first non-null
   - Ingredients: from source with longest raw text
   - Image: first image from highest-priority source (configurable via imageSourcePriority, default: dm > rossmann > mueller)
   Note: GTIN comes from the work item (resolved via source-variants in claim), not from source products
2. [full scope only] classifyProduct(client, sources, lang)  → LLM classification
   - Product type, attributes, claims with evidence
3. Submit results
```

**Scope** (`scope` field on job, passed through claim → handler → submit → persist):
- `full`: Runs all LLM-heavy operations — `classifyProduct()`, `matchBrand()`, `matchIngredients()`, image download/upload, and score history computation.
- `partial`: Skips all LLM calls and image operations. Only updates basic product data (name, GTIN, source product links) and computes score history. Use for cheap periodic score refreshes.

**Persistence** (`persistProductAggregationResult`):
- Finds existing product via `product-variants` GTIN lookup (queries `product-variants` by GTIN, gets parent product ID); creates new product + product-variant together if not found
- Merges source product IDs (always)
- Updates name (always)
- [full only] Calls `matchBrand()` → links brand
- [full only] Parses raw `ingredientsText` via `parseIngredients()` (LLM, handles footnotes/asterisks) → then `matchIngredients()` → links ingredient records
- [full only] Downloads selected image URL → uploads to `media` collection → sets `image` on product (filename uses `productId` instead of GTIN)
- [full only] Applies classification: productType, attributes (with evidence), claims (with evidence)
- Computes score history (always): fetches source-product ratings → store score (0–10), video-mention sentiments → creator score (0–10). Prepends new entry to `products.scoreHistory[]`. Sets `change` to `drop`/`stable`/`increase` based on score direction vs previous entry (compares store score first, then creator score; if both exist and store is `stable`, creator can override).

**Aggregation types**: `all` (cursor-based via `lastCheckedSourceId`), `selected_gtins`

**GTIN resolution**: `buildProductAggregationWork()` resolves GTINs via `source-variants` — it queries variants by GTIN to find parent source-product IDs, then fetches the crawled source-products. The GTIN is passed as a top-level field on each work item; individual source products do not carry GTINs. At persist time, `persistProductAggregationResult()` looks up existing products via `product-variants` (by GTIN), or creates a new product + product-variant pair when no match is found.

### 8. ingredient-crawl

**Handler**: `handleIngredientCrawl()`
**Flow per ingredient**:

```
1. Build URL: https://incidecoder.com/ingredients/<sluggified-name>
2. Fetch page via HTTP (no browser needed)
3. Extract "Geeky Details" section as longDescription (fallback to "Quick Facts")
4. LLM (gpt-4.1-mini, temperature 0.7): generate shortDescription — 1-2 sentences, precise but entertaining
5. Submit results → update ingredient record with longDescription + shortDescription
```

**Crawl types**: `all_uncrawled` (cursor-based, processes ingredients missing longDescription), `selected` (specific ingredient IDs)

**Persistence**: Inline in submit handler — updates `ingredients` record with `longDescription` and `shortDescription`.

## Source Drivers

### Interface (`source-discovery/types.ts`)

```typescript
interface SourceDriver {
  slug: SourceSlug           // 'dm' | 'mueller' | 'rossmann' | 'purish'
  label: string
  logoSvg: string            // inline SVG markup for the store logo (used in frontend UI)
  matches(url: string): boolean
  discoverProducts(options: ProductDiscoveryOptions): Promise<ProductDiscoveryResult>
  searchProducts(options: ProductSearchOptions): Promise<ProductSearchResult>
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
  ingredientsText?: string
  priceCents?: number
  currency?: string
  priceInfos?: string[]
  amount?: number
  amountUnit?: string
  images: Array<{ url: string; alt?: string | null }>
  variants: Array<{ dimension: string; options: Array<{ label, value (full variant URL), gtin, isSelected }> }>
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

Structured logger with dual output: human-readable console + remote event emission to the server's `events` collection.

### Structured log data

Every log call accepts an optional `LogData` object (flat `Record<string, string | number | boolean | null | undefined>`) as the second argument. Dynamic values (counts, URLs, IDs, names, durations) go here instead of being interpolated into the message string.

```typescript
const log = createLogger('DM')

// Basic — static message + structured data
log.info('Page loaded', { url, statusCode: 200 })
log.warn('Rate limited', { retryAfterMs: 5000 })

// Console output (text mode, default):
//   14:32:05 INF DM         Page loaded              url=https://... statusCode=200

// Console output (JSON mode, LOG_FORMAT=json):
//   {"ts":"2026-03-01T14:32:05.123Z","level":"info","tag":"DM","msg":"Page loaded","url":"https://...","statusCode":200}
```

### Event emission

Events are only emitted when `{ event: true }` (or `{ event: 'start' }` etc.) is passed AND the logger is job-scoped via `forJob()`.

```typescript
const jlog = log.forJob('product-crawls', 42)

// Structured data + event emission
jlog.info('Batch crawled', { crawled: 10, errors: 2 }, { event: true, labels: ['scraping'] })
jlog.info('Crawl completed', { total: 100 }, { event: 'success' })

// Backward compat — EventOpts as second arg still works (no data)
jlog.info('Started', { event: 'start' })
```

The `data` object is sent to the server as a JSON field on the `events` collection record, making it queryable/filterable in the admin UI.

### Logger tags

Each module creates a logger with a PascalCase tag. Tags are distinct per module:

| Tag | Module |
|-----|--------|
| `Worker` | `worker.ts` (main loop, handlers) |
| `Claim` | `work-protocol/claim.ts` |
| `Submit` | `work-protocol/submit.ts` |
| `Persist` | `work-protocol/persist.ts` |
| `JobFailure` | `work-protocol/job-failure.ts` |
| `DM`, `Mueller`, `Rossmann`, `PurishDriver` | Source drivers |
| `YouTube` | Video discovery driver |
| `CosIng` | Ingredients discovery driver |
| `matchBrand`, `matchIngredients`, `matchProduct`, `classifyProduct` | Matching/classification functions |
| `processVideo`, `recognizeProduct`, `transcribeAudio`, `correctTranscript`, `analyzeSentiment` | Video processing functions |

### Driver logger passthrough

Source drivers accept an optional `logger` in their options (`scrapeProduct`, `discoverProducts`, `searchProducts`). The handler passes the job-scoped `jlog` so driver-level events (network failures, parse errors, anti-bot detection) appear in the admin UI's event log for the job.

### Job collections

The `JobCollection` type covers all 8 job collections: `product-discoveries`, `product-searches`, `product-crawls`, `ingredients-discoveries`, `product-aggregations`, `video-discoveries`, `video-processings`, `ingredient-crawls`.

### Configuration

- **`LOG_LEVEL`**: `debug` | `info` | `warn` | `error` (default: `info`)
- **`LOG_FORMAT`**: `text` | `json` (default: `text`). Use `json` for log aggregators (ELK, Datadog, CloudWatch).

**Levels**: `debug` < `info` < `warn` < `error`.

**Event types**: `start`, `success`, `info`, `warning`, `error`. Auto-derived from log level, or set explicitly.

## Key Patterns

- **Batch processing**: All jobs process `itemsPerTick` items per claim cycle (default 10, video processing default 1)
- **Job claim locking**: Each job has `claimedBy` (worker relationship) and `claimedAt` (date) fields. A job is in one of four states:
  1. **Pending** (`status=pending`) — new, claimable by any worker
  2. **Claimed** (`status=in_progress`, `claimedBy` set, `claimedAt` fresh) — actively being worked on, NOT claimable
  3. **Released** (`status=in_progress`, `claimedBy` null) — between batches, claimable by any worker
  4. **Stale** (`status=in_progress`, `claimedBy` set, `claimedAt` older than timeout) — worker crashed, claimable
  
  `claimWork()` PATCHes `claimedBy` + `claimedAt` to claim a job. A server-side `enforceJobClaim` hook rejects the PATCH if the job is already claimed by a different worker with a fresh `claimedAt`. Workers pass `X-Job-Timeout-Minutes` header so the server knows the timeout (default 30m). When a batch finishes but the job is not done, `submitWork()` releases the claim (`claimedBy: null, claimedAt: null`), making it immediately available for any worker. Workers are fully stateless — all progress lives on the server.
- **Heartbeat**: Long-running operations call `heartbeat(jobId, type, progress?)` to update `workers.lastSeenAt` and refresh `claimedAt` on the job (keeping the claim alive during long batches)
- **Resumable jobs**: Progress state stored in job's JSON fields, allowing pause/resume across worker restarts
- **Media uploads**: Worker uploads files to `/api/media` via multipart `FormData` with API key auth
- **URL normalization**: Two normalization functions exist in `source-product-queries.ts`:
  - `normalizeProductUrl()` — strips all query parameters, trailing slashes, hash fragments, and lowercases. Used for base product URLs on source-products (applied in source drivers, persist.ts, claim.ts).
  - `normalizeVariantUrl()` — same as above but preserves `?itemId=` for Mueller URLs. Used for source-variant URLs where Mueller variants need the itemId param to distinguish variants sharing the same base URL. Applied to all variant URLs from all drivers in persist.ts.
- **Variant URLs**: Drivers are the source of truth for variant URL construction. Each driver extracts the full variant URL from the page (DM: from API `href` field; Mueller: from tile link `href`; Rossmann: from variant list link `href`). `persistCrawlResult` stores whatever the driver provides — no URL inference or construction outside the driver.
- **Category breadcrumbs**: Source-products store category as a `categoryBreadcrumb` text string (e.g. `"Pflege -> Körperpflege -> Handcreme"`), written by crawl/discovery persist functions. This is raw metadata from retailers; it is not mapped to any collection during aggregation.
- **Deduplication**: Source-variants are matched by `sourceUrl` (unique constraint on `source-variants`) to prevent duplicates. Source-products no longer have a `sourceUrl` field — dedup happens at the variant level.
- **Price history**: Each crawl/discovery appends to the `priceHistory` array on source-products
- **Join records**: `crawl-results` and `discovery-results` link jobs to the source-products they produced
- **Browser stealth**: `browser.ts` uses `playwright-extra` with `puppeteer-extra-plugin-stealth` to evade bot detection. The stealth plugin patches `navigator.webdriver`, Chrome runtime, plugins, WebGL, permissions, and other fingerprinting vectors. Applied globally to all Playwright-based drivers (Mueller, Rossmann).
- **External CLIs**: `yt-dlp`, `ffmpeg`, `ffprobe`, `zbarimg` (video processing)
- **External APIs**: Deepgram (speech-to-text), OpenAI gpt-4.1-mini (LLM correction, sentiment analysis, recognition, matching)

## Keeping This File Up to Date

Whenever you make changes to the worker codebase, **update this file** to reflect those changes. This includes additions or modifications to job handlers, the work protocol, source drivers, matching/classification functions, the REST client, logging, or any worker-side patterns documented here. Documentation must stay in sync with the code.

For changes that affect the overall repository layout or cross both server and worker, also update the root `AGENTS.md`. See the root file for the full policy.
