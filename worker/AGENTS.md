# Worker — Architecture & Internals

Standalone Node.js process that claims jobs from the server and processes them. All business logic runs locally — the server is just a data store accessed via Payload's REST API.

## Source Layout

```
worker/src/
├── worker.ts                         # Main loop + 8 job handlers (video-processing + product-aggregation are ~80-line stage dispatchers)
└── lib/
    ├── payload-client.ts             # REST client mirroring Payload's local API
    ├── logger.ts                     # Structured logger with event emission
    ├── browser.ts                    # Playwright browser management (stealth-enabled via playwright-extra)
    ├── stealth-fetch.ts              # Fetch with anti-bot headers
    ├── parse-ingredients.ts          # Ingredient text → name[] parser (LLM, handles footnotes/asterisks)
    ├── clean-product-name.ts         # cleanProductName(rawName, variantLabels) — LLM-powered, strips variant-specific info (sizes, colors) from product names
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
    │       ├── dm/
    │       │   ├── index.ts          # DM drugstore driver (API-based)
    │       │   └── AGENTS.md         # DM scraping reference (TODO)
    │       ├── mueller/
    │       │   ├── index.ts          # Mueller driver (Playwright + RSC JSON)
    │       │   └── AGENTS.md         # Mueller scraping reference (TODO)
    │       ├── rossmann/
    │       │   ├── index.ts          # Rossmann driver (Playwright)
    │       │   └── AGENTS.md         # Rossmann scraping reference (TODO)
    │       └── purish/
    │           ├── index.ts          # PURISH driver (Shopify API + page HTML)
    │           └── AGENTS.md         # PURISH scraping reference (detailed)
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
    │   ├── process-video.ts          # CLI wrappers (unchanged)
    │   ├── recognize-product.ts      # LLM visual recognition (unchanged)
    │   ├── transcribe-audio.ts       # Deepgram STT (unchanged)
    │   ├── correct-transcript.ts     # LLM transcript correction (unchanged)
    │   ├── split-transcript.ts       # Pre/main/post by timestamps (unchanged)
    │   ├── analyze-sentiment.ts      # LLM sentiment analysis (unchanged)
    │   └── stages/                   # Stage-based pipeline — see stages/AGENTS.md for detailed docs
    │       ├── AGENTS.md             # Detailed stage pipeline documentation
    │       ├── index.ts              # Stage registry, types, ordering, VideoProgress, getNextStage(), getVideoProgress()
    │       ├── download.ts           # Stage 0: Download video, upload to media
    │       ├── scene-detection.ts    # Stage 1: Scene detection, screenshots, barcodes
    │       ├── product-recognition.ts # Stage 2: LLM classification + GTIN lookup
    │       ├── transcription.ts      # Stage 3: Deepgram STT + LLM correction
    │       └── sentiment-analysis.ts # Stage 4: LLM quote extraction + sentiment
    │
    ├── product-aggregation/
    │   └── stages/                   # Stage-based pipeline — see stages/AGENTS.md for detailed docs
    │       ├── AGENTS.md             # Detailed stage pipeline documentation
    │       ├── index.ts              # Stage registry, types, ordering, AggregationProgress, getNextStage(), getAggregationProgress()
    │       ├── resolve.ts            # Stage 0: Find/create product + variants, merge duplicates
    │       ├── classify.ts           # Stage 1: classifyProduct() + cleanProductName()
    │       ├── match-brand.ts        # Stage 2: matchBrand() → link brand
    │       ├── ingredients.ts        # Stage 3: parseIngredients() + matchIngredients() per variant
    │       ├── images.ts             # Stage 4: Download + upload best image per variant
    │       ├── object-detection.ts   # Stage 5: Grounding DINO detection + crop per variant
    │       ├── descriptions.ts       # Stage 6: consensusDescription() + deduplicateLabels() per variant
    │       └── score-history.ts      # Stage 7: Compute store + creator scores
    │
    ├── match-brand.ts                # matchBrand(client, brandName) — LLM-powered
    ├── match-ingredients.ts          # matchIngredients(client, names[]) — LLM-powered
    ├── match-product.ts              # matchProduct(client, brand, name, terms) — LLM-powered
    ├── classify-product.ts           # classifyProduct(client, sources, lang) — LLM-powered
    └── aggregate-product.ts          # aggregateFromSources(sources) + deduplicateDescriptions/Ingredients — pure logic (no GTIN; GTIN comes from work item)
```

## Main Loop (`worker.ts`)

```
1. Authenticate         GET /api/workers/me  →  AuthenticatedWorker
2. purgeOldEvents()      Periodic maintenance: deletes events older than EVENT_RETENTION_DAYS
                         Requires 'event-purge' capability (skipped silently if not assigned)
                         Runs at most once per hour (tracked via lastPurgeAt timestamp)
                         Emits worker.events_purged event on success
3. claimWork(client)     Query all job collections for pending + stale in_progress
                         Prioritize "selected target" jobs, else random
                         Attempt to claim via PATCH (claimedBy + claimedAt)
                         Server-side hook rejects if already claimed by another worker
                         On rejection, try next candidate
                         Build work unit with all data needed by handler
4. Run handler           handleProductCrawl / handleProductDiscovery / etc.
5. heartbeat()           Refreshes claimedAt + lastSeenAt during long operations
6. submitWork(client)    Persist results → update job status/progress
                         If 100% errors in batch → retryOrFail (increment retryCount, fail if > maxRetries)
7. On handler throw      Main loop catches → retryOrFail (increment retryCount, fail if > maxRetries)
8. Sleep (POLL_INTERVAL) Repeat from step 2
```

### Env vars

```
WORKER_SERVER_URL              Base URL of the server (default: http://localhost:3000)
WORKER_API_KEY                 API key from workers collection (required)
WORKER_POLL_INTERVAL           Seconds between polls when idle (default: 10)
WORKER_JOB_TIMEOUT_MINUTES     Minutes before abandoned job can be reclaimed (default: 30)
EVENT_RETENTION_DAYS           Days before old events are purged (default: 30)
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
3. Priority: "selected target" jobs first (selected_urls, from_discovery, from_search), else random
4. Attempt to claim by PATCHing `claimedBy` + `claimedAt` on the job (sends `X-Job-Timeout-Minutes` header)
   - Server-side `enforceJobClaim` hook rejects if the job is already claimed by a different worker with a fresh `claimedAt`
   - On rejection, try the next candidate
5. Call `build*Work()` for the claimed job type — this:
   - Fetches the full job document
   - Initializes the job if pending (set status=in_progress, count totals)
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

**`parseAmountFromText(text)`** — extracts amount and unit from free-text strings (e.g. "100 ml", "1,5l", "Tagescreme 50 ml"). Supports German (comma) and international (dot) decimals with up to 2 decimal places. Units: `mg`, `g`, `kg`, `ml`, `l` (case-insensitive). The unit must be followed by a word boundary to avoid false positives. Used as a fallback in `persistCrawlResult()` when the driver doesn't provide `amount`/`amountUnit` — tries the selected variant label first, then the product name.

**`computePerUnitPrice(priceCents, amount, amountUnit)`** — centralized per-unit price computation used as a fallback when the driver doesn't provide per-unit pricing. Formula: `ml`/`g` → price per 100 units, `l`/`kg` → price per 1 unit, anything else → price per 1 unit (preserves original unit casing). Drivers that extract per-unit data from their source (DM from API `price.infos`, Mueller from DOM, PURISH from Shopify `unit_price_measurement`) take priority — persist only fills gaps.

| Function | What it writes |
|----------|---------------|
| `persistCrawlResult()` | **Creates source-products if needed** (find-or-create by normalized URL — no stubs are pre-created; crawl is the sole creator of source-products); updates parent `source-products` with **product-level** scraped data (name, brandName, categoryBreadcrumb, rating, ratingNum); writes **variant-level** data (description, images, ingredientsText, amount, amountUnit, labels, priceHistory with availability) to the crawled `source-variant`; on **first crawl** (no `sourceVariantId`), creates a source-variant for the crawled URL (for all stores — DM/Rossmann get a variant matching the product URL, Mueller/PURISH get their query-param variants) — if a variant with that URL already exists (e.g. created as a sibling during another product's crawl), re-links it to the correct source-product; on **re-crawl** (existing `sourceVariantId`), updates the variant's GTIN, canonical URL, `variantLabel`, `variantDimension` (from the `isSelected` option in scraped variants), `crawledAt`, and all variant-level content fields; **availability is tracked per price entry** — each priceHistory entry includes an `availability` field (available/unavailable/unknown, defaults to `available`); creates sibling `source-variants` from variant URLs provided by the driver (all sources) with GTIN but no priceHistory (siblings get their price+availability entry when crawled directly — seeding on creation would cause duplicates) — **sibling ownership**: when a sibling URL matches an existing source-product's `sourceUrl`, the variant is linked to that source-product (not the current one), since color/shade variants on DM are separate products with their own source-products; updates metadata (GTIN, articleNumber, sourceProduct) on existing sibling variants when needed but does NOT append availability entries (to avoid N entries per variant per crawl session — availability is tracked on creation, direct crawl, and disappearance only); **reconciles disappeared variants**: when the driver returned variant data, queries all existing DB variants for the source-product and appends a `availability: 'unavailable'` priceHistory entry to any whose URL is NOT in the scraped set (skips if already marked unavailable in most recent entry; store-agnostic — works for all drivers); defers parent `crawled` status when `crawlVariants=true` and siblings need crawling; creates `crawl-results` join record; emits events for price changes (≥5% move), ingredient extraction, variant processing, and disappeared variant marking. Returns `{ productId, warnings, newVariants, existingVariants, hasIngredients, priceChange }` so submit can aggregate batch-level counters. |
| ~~`persistCrawlFailure()`~~ | **Removed** — no longer writes to join tables |
| ~~`persistDiscoveredProduct()`~~ | **Removed** — discovery/search no longer create source-product stubs; they only accumulate URLs |

| `persistIngredient()` | Creates/updates `ingredients` (fills in missing CAS#, EC#, functions, etc.); adds `{ source: 'cosing', sourceUrl, fieldsProvided }` to the `sources` array on create/update — `fieldsProvided` lists which content fields were actually populated (only non-null fields from the CosIng data, e.g. `['name', 'casNumber', 'functions']`); deduplicates by checking if CosIng source already exists, backfills `fieldsProvided` on existing entries missing it |
| `persistVideoDiscoveryResult()` | Creates/updates `channels`, `creators`, `videos`; downloads thumbnails; always updates channel avatar image |
| ~~`persistVideoProcessingResult()`~~ | **Deprecated** — still exists for backward compatibility but no longer called by stage-based pipeline. Each stage in `video-processing/stages/` persists its own results inline (video-snippets, video-mentions, transcripts, media uploads). |
| ~~`persistProductAggregationResult()`~~ | **Deprecated** — still exists for backward compatibility but no longer called by stage-based pipeline. Each stage in `product-aggregation/stages/` persists its own results inline (product creation/merging, classification, brand matching, ingredients, images, descriptions, score history). |

## 8 Job Types — Detailed

### 1. product-crawl

**Handler**: `handleProductCrawl()`
**Flow**: For each work item (with `sourceProductId`, `sourceUrl`, `source`, and optionally `sourceVariantId`) → `getSourceDriverBySlug(source)` → `driver.scrapeProduct(url)` → collect results → `submitWork()`

Work items come in two forms:
- **First crawl** (no `sourceVariantId`): The URL comes from `source-products.sourceUrl`. On persist, creates a source-variant for the crawled URL (DM/Rossmann: the product URL itself becomes a variant; Mueller/PURISH: only `?itemId=`/`?variant=` URLs become variants).
- **Variant crawl** (with `sourceVariantId`): The URL comes from an existing source-variant. On persist, updates that variant's data.

**Crawl types**:
- `all` — two-phase: first uncrawled source-products (no variants yet, via `findUncrawledProducts()`), then uncrawled source-variants (via `findUncrawledVariants()`) for given source(s)
- `selected_urls` — specific URLs from the job's `urls` field (normalized via `normalizeVariantUrl` which preserves all query params)
- `from_discovery` — crawl URLs from a linked product-discovery job's `productUrls` field
- `from_search` — crawl URLs from a linked product-search job's `productUrls` field

**Scope**: `recrawl` clears `crawledAt` on matching source-variants (optionally filtered by `minCrawlAge`), making them eligible for re-crawling

**`crawlVariants`** (default: true): When enabled, after crawling a variant, any sibling variant URLs discovered on the page are also crawled. All three drivers (DM, Mueller, Rossmann) extract full variant URLs from the page — the driver is the source of truth for URL construction, persist just stores whatever the driver provides. When disabled, only the default variant per product is crawled.

**Variant tracking**: Each source-variant has a `crawledAt` timestamp set when it is individually crawled. `findUncrawledVariants()` skips variants where `crawledAt` is already set. When `crawlVariants=true` for scoped jobs (selected_urls, from_discovery, from_search), the system resolves the original URLs to source-product IDs and finds ALL their uncrawled variants (including sibling variants with different URLs).

**GTIN output**: After each batch, `submitProductCrawl()` collects all GTINs from successfully crawled products (main GTIN + sibling variant GTINs from the scraped variant data) and appends them to the job's hidden `crawledGtins` textarea field (deduplicated). The admin UI has a "Download Crawled GTINs" button on the Output tab that downloads this field as a text file.

**Resumption**: Three-phase work queue via `buildProductCrawlWork()`:
0. **New URLs** (URL-scoped jobs only): URLs from `selected_urls`/`from_discovery`/`from_search` that have no existing `source-products` record. Work items have no `sourceProductId` or `sourceVariantId` — `persistCrawlResult()` will find-or-create the source-product during persist. Source slug is detected from the URL hostname via `getSourceSlugFromUrl()`.
1. **Uncrawled products** (via `findUncrawledProducts()`): source-products with zero source-variants — these need their first crawl. Work items have no `sourceVariantId`; the URL is `source-products.sourceUrl`.
2. **Uncrawled variants** (via `findUncrawledVariants()`): source-variants where `crawledAt` is null — these were created as siblings during a previous crawl and need their own crawl. Work items have a `sourceVariantId`.
Each batch fetches `itemsPerTick` (default 10) uncrawled items.

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

**Persistence**: Accumulates discovered URLs in the job's `productUrls` textarea field (same pattern as discovery). No source-product stubs are created — URLs are stored for later use by `from_search` crawl jobs.

**Driver support**: All three drivers fully implemented. DM uses API-based search (`product-search.services.dmtech.com`). Rossmann and Mueller use Playwright-based browser scraping of their search pages (`/de/search?text=` and `/search/?q=` respectively), with pagination support.

### 4. ingredients-discovery

**Handler**: `handleIngredientsDiscovery()`
**Flow**: `getIngredientsDriver(url)` → crawls CosIng → yields `ScrapedIngredientData[]` → submit

**Initialization**: On first claim (job is `pending`), `buildIngredientsDiscoveryWork()` calls `driver.getInitialTermQueue()` to seed the `termQueue` (e.g. `["*"]` for CosIng). The seeded queue is persisted to the job immediately. The admin only needs to set `sourceUrl` — the driver determines the initial search terms.

**Resumption**: Stores `currentTerm`, `currentPage`, `totalPagesForTerm`, `termQueue` (list of search terms to process). Terms that exceed `MAX_PAGES` (50 pages × 200 results = 10,000 results) are split into sub-terms by appending each letter A–Z (e.g. `*` → `*A`, `*B`, ..., `*Z`).

### 5. video-discovery

**Handler**: `handleVideoDiscovery()`
**Flow**: `getVideoDriver(channelUrl)` → `driver.discoverVideoPage(url, { startIndex, endIndex })` → submit batch → release claim → repeat until end of channel or `maxVideos` reached

**Resumption**: Stores `currentOffset` (0-based video index) in the job's `progress` JSON field. Each batch fetches `itemsPerTick` (default 50) videos via yt-dlp's `--playlist-start`/`--playlist-end` flags (1-based). The batch is done when the driver returns fewer videos than requested (`reachedEnd`) or when the offset reaches `maxVideos`.

**Key params**: `itemsPerTick` (videos per batch, default 50), `maxVideos` (stop after this many, unlimited if empty)

**Persistence**: Creates `creators` → `channels` → `videos` chain. Downloads and uploads video thumbnails. Fetches the channel avatar (from YouTube `og:image` meta tag) and always updates the `channels.image` field — both for new and existing channels.

### 6. video-processing

**Handler**: `handleVideoProcessing()` — stage dispatcher (~80 lines in `worker.ts`)

The video processing pipeline is a **stage-based architecture**. Instead of a monolithic handler, the worker runs one stage per video per tick. Each stage is a self-contained module in `video-processing/stages/` that reads its input from the database (prior stage's output) and persists its data outputs immediately. Videos are pure data records with no processing state — progress is tracked on the job's `videoProgress` JSON field (`Record<string, StageName | null>` mapping video IDs to last completed stage names).

**Stage dispatcher flow**:
1. `claimWork()` calls `buildVideoProcessingWork()` which uses `getVideoProgress(job)` to read the progress map, then `getNextStage()` + `videoNeedsWork()` to find videos needing work for the next enabled stage. For `all_unprocessed`, queries all videos with `externalUrl` and filters by progress map. For `single_video`/`selected_urls`, checks progress map instead of video status.
2. Work unit contains `stageItems: Array<{ videoId, title, stageName }>`
3. Handler iterates `stageItems`, dispatching each to the appropriate stage module
4. Each stage runs independently, persists its own data outputs inline (media links, snippets, transcripts, mentions — no `processingStatus` writes)
5. `submitVideoProcessing()` updates the progress map entry for each video (`progress[videoId] = stageName`) after successful stage execution, persists the updated `videoProgress` to the job on every update (both batch release and completion), and uses the progress map for remaining work checks

**5 stages** (in order) — see `video-processing/stages/AGENTS.md` for detailed per-stage documentation:

| # | Stage name | What it does | Data outputs |
|---|------------|--------------|-------------|
| 0 | `download` | Downloads video via yt-dlp, uploads to media collection | `videos.image` (media upload) |
| 1 | `scene_detection` | Detects scene changes (threshold=0.4), extracts screenshots, uploads as media, scans barcodes | `video-snippets` (timestamps, screenshots as media, barcodes) |
| 2 | `product_recognition` | Clusters screenshots by perceptual hash, classifies via LLM, recognizes products via LLM, looks up GTINs via product-variants | `video-snippets.referencedProducts`, `video-snippets.matchingType` |
| 3 | `transcription` | Extracts audio (ffmpeg), transcribes via Deepgram, corrects transcript via LLM (gpt-4.1-mini), splits into pre/main/post per snippet | `videos.transcript`, `videos.transcriptWords`, `video-snippets.preTranscript`/`transcript`/`postTranscript` |
| 4 | `sentiment_analysis` | Extracts product quotes + sentiment scores via LLM (gpt-4.1-mini) per snippet, creates video-mentions | `video-mentions` (quotes with sentiment scores) |

**Progress tracking**: Progress is tracked on the job's `videoProgress` JSON field — a `Record<string, StageName | null>` mapping video IDs to their last completed stage name (or `null` for videos that haven't started). This replaces the old `processingStatus` field on videos. `stages/index.ts` exports: `VideoProgress` type, `stageIndex()`, `getFinalStage()`, `getVideoProgress()`, `getNextStage(lastCompleted)`, `videoNeedsWork(lastCompleted)`. `StageDefinition` has `index: number` (no `requiredStatus`/`resultStatus`).

**Stage selection**: Each stage has a corresponding checkbox on the job (all default true): `stageDownload`, `stageSceneDetection`, `stageProductRecognition`, `stageTranscription`, `stageSentimentAnalysis`. Disabled stages are skipped — `getNextStage()` finds the first enabled stage after `lastCompleted` (a `StageName | null`).

**Processing types**: `all_unprocessed`, `single_video`, `selected_urls`

**Transcription config** (Stage Config tab on the job):
- `transcriptionLanguage` (default: 'de', options: de/en/fr/es/it)
- `transcriptionModel` (default: 'nova-3', options: nova-3/nova-2/enhanced/base)

Note: The old `transcriptionEnabled` field has been replaced by the `stageTranscription` checkbox.

**Counters**: `completed` and `errors` counters on the job's progress field are incremented per stage execution.

**Persistence**: Each stage file persists its own data outputs inline (creates/updates video-snippets, video-mentions, media, transcript fields directly) — stages do NOT write `processingStatus` on the video. The old monolithic `persistVideoProcessingResult()` in `persist.ts` still exists for backward compatibility but is deprecated — new stage code does not use it. Barcode matches look up `product-variants` by GTIN to find the parent product. For visual matches, calls `matchProduct()` to find/create product records.

### 7. product-aggregation

**Handler**: `handleProductAggregation()` — stage dispatcher (~80 lines in `worker.ts`)

The product aggregation pipeline is a **stage-based architecture** (same pattern as video processing). Instead of a monolithic handler, the worker runs one stage per product group per tick. Each stage is a self-contained module in `product-aggregation/stages/` that reads its input from the database (prior stage's output) and persists its data outputs immediately. Progress is tracked on the job's `aggregationProgress` JSON field (`Record<string, StageName | null>` mapping product group keys to last completed stage names).

**Stage dispatcher flow**:
1. `claimWork()` calls `buildProductAggregationWork()` which keeps existing GTIN expansion/grouping logic (`findSourcesByGtin`, `expandSisterGtins`, `groupGtinsIntoProducts`), then reads `getAggregationProgress(job)` and uses `getNextStage()` + `productNeedsWork()` to find product groups needing their next enabled stage.
2. Work unit contains `stageItems: Array<{ productId, stageName, workItem: AggregationWorkItem }>` where `AggregationWorkItem` carries `productId` (null for resolve), `gtins`, and `variants` (with per-GTIN sources).
3. Handler iterates `stageItems`, dispatching each to the appropriate stage module via `AGGREGATION_STAGES.find(s => s.name === stageName)`.
4. Each stage runs independently, persists its own data outputs inline.
5. `submitProductAggregation()` updates the progress map entry for each product group (`progress[progressKey] = stageName`) after successful stage execution, stores the product ID for quick lookup (`progress[pid:${progressKey}] = productId`), and uses the progress map for remaining work checks.

**8 stages** (in order):

| # | Stage name | Checkbox field | What it does | LLM? |
|---|------------|---------------|--------------|------|
| 0 | `resolve` | `stageResolve` | Find/create product + product-variants from GTINs, merge duplicates, aggregate basic data (name, variantLabel, amount, sourceVariants) | No |
| 1 | `classify` | `stageClassify` | `classifyProduct()` + `cleanProductName()` → productType, attributes, claims, warnings, pH, usage | Yes |
| 2 | `match_brand` | `stageMatchBrand` | `matchBrand()` → link brand to product | Yes |
| 3 | `ingredients` | `stageIngredients` | Per variant: `parseIngredients()` + `matchIngredients()` → linked ingredient IDs | Yes |
| 4 | `images` | `stageImages` | Per variant: download best image, upload to media | No |
| 5 | `object_detection` | `stageObjectDetection` | Per variant: Grounding DINO detection of "cosmetics packaging" + sharp crop + upload crops as `recognitionImages` on product-variants | No (ML) |
| 6 | `descriptions` | `stageDescriptions` | Per variant: `consensusDescription()` + `deduplicateLabels()` | Yes |
| 7 | `score_history` | `stageScoreHistory` | Compute store + creator scores, prepend to scoreHistory[] | No |

**Progress tracking**: Progress is tracked on the job's `aggregationProgress` JSON field — a `Record<string, StageName | null>` mapping product group keys (sorted GTIN list joined by commas) to their last completed stage name. After resolve, the product ID is stored under `pid:<progressKey>` for quick lookup. `stages/index.ts` exports: `AggregationProgress` type, `stageIndex()`, `getFinalStage()`, `getAggregationProgress()`, `getNextStage(lastCompleted)`, `productNeedsWork(lastCompleted)`. `StageDefinition` has `index: number`.

**Stage selection**: Each stage has a corresponding checkbox on the job (all default true): `stageResolve`, `stageClassify`, `stageMatchBrand`, `stageIngredients`, `stageImages`, `stageObjectDetection`, `stageDescriptions`, `stageScoreHistory`. Disabled stages are skipped — `getNextStage()` finds the first enabled stage after `lastCompleted`.

**Sister variant grouping** (`includeSisterVariants` field on job, default: true):
- When enabled, the claim phase discovers all sibling GTINs that share a source-product. For example, if GTIN-A (50ml) and GTIN-B (100ml) both have source-variants under the same source-product, they are grouped into one work item and become variants of the same unified product.
- Uses `expandSisterGtins()` to find all GTINs whose source-variants share any source-product with the input GTINs, then `groupGtinsIntoProducts()` to cluster GTINs via union-find (GTINs that share any source-product end up in the same group, transitively).
- When disabled, each GTIN is treated as its own product group (backward-compatible behavior).
- Works for both `selected_gtins` and `all` aggregation types.

**Persistence**: Each stage file persists its own data outputs inline (creates/updates products, product-variants, media uploads, ingredients, scores) — the old monolithic `persistProductAggregationResult()` in `persist.ts` still exists for backward compatibility but is deprecated.

**Aggregation types**: `all` (cursor-based via `lastCheckedSourceId`), `selected_gtins`

**GTIN resolution**: `buildProductAggregationWork()` resolves GTINs via `source-variants` — it queries variants by GTIN to find parent source-product IDs, then fetches both the crawled source-products (for product-level data: name, brandName) and the matching source-variants (for variant-level data: description, images, ingredientsText). When `includeSisterVariants` is enabled, it expands the GTIN set to include all sibling GTINs sharing any source-product, then groups them via union-find. Each work item carries a `variants` array of `{ gtin, sources: AggregationSource[] }`. The resolve stage creates/finds the product and product-variants, merging existing products if needed.

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

**Persistence**: Inline in submit handler — updates `ingredients` record with `longDescription` and `shortDescription`. Also adds `{ source: 'incidecoder', sourceUrl, fieldsProvided }` to the `sources` array when INCIDecoder had data (longDescription present) — `fieldsProvided` lists which fields were actually set (e.g. `['longDescription', 'shortDescription', 'image']`); backfills `fieldsProvided` on existing entries missing it. Tracks `withInciDecoder` counter in batch and completion events.

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
  variants: Array<{ dimension: string; options: Array<{ label, value (full variant URL), gtin, isSelected, availability?, sourceArticleNumber? }> }>
  labels?: string[]
  rating?: number
  ratingNum?: number
  sourceArticleNumber?: string  // top-level: article number for the crawled variant (used by Rossmann which has one DAN per page; other drivers also set it for the selected variant)
  categoryBreadcrumbs?: string[]
  categoryUrl?: string
  canonicalUrl?: string
  perUnitAmount?: number
  perUnitQuantity?: number
  perUnitUnit?: string
  availability?: 'available' | 'unavailable' | 'unknown'
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
| `matchBrand(client, brandName, logger)` | brand name string | `{ brandId, tokensUsed }` | `product-aggregation/stages/match-brand.ts` |
| `matchIngredients(client, names[], logger)` | raw ingredient names | `{ matched[], unmatched[], tokensUsed }` | `product-aggregation/stages/ingredients.ts` |
| `matchProduct(client, brand, name, terms, logger)` | brand + product name + search terms | `{ productId, productName }` | `video-processing/stages/product-recognition.ts` |
| `classifyProduct(client, sources, lang)` | source-product descriptions + ingredients | `{ description, productType, warnings, skinApplicability, phMin, phMax, usageInstructions, usageSchedule, productAttributes[], productClaims[], tokensUsed }` — detail fields extracted from descriptions by LLM; evidence entries include `sourceIndex`, `type`, `snippet`, `start`/`end` (char offsets), `ingredientNames` | `product-aggregation/stages/classify.ts` |
| `cleanProductName(rawName, variantLabels, cache)` | raw product name + variant labels (e.g. "50ml", "Rose Gold") | `{ name, tokensUsed, cacheHit }` — strips variant-specific info (sizes, colors, shade numbers) to produce a clean generic product name | `product-aggregation/stages/classify.ts` |
| `correctTranscript(rawTranscript, words, brands, products)` | raw STT transcript + brand/product names | `{ correctedTranscript, corrections[], tokensUsed }` | `handleVideoProcessing` |
| `analyzeSentiment(pre, transcript, post, products)` | transcript segments + product info | `{ products[]: { quotes[], overallSentiment, score }, tokensUsed }` | `handleVideoProcessing` |

## Logging (`lib/logger.ts`)

Structured logger with dual output: human-readable console + remote event emission to the server's `events` collection. Types (`JobCollection`, `EventType`, `LogLevel`) and the event registry (`EventRegistry`, `EVENT_META`) are imported from `@anyskin/shared` and re-exported for consumers.

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

### Typed event API

All server event emission uses the `event()` method, which provides type-safe, named events with data shapes enforced by the `EventRegistry` in `@anyskin/shared`. The `debug()`/`info()`/`warn()`/`error()` methods are for console logging only — they do not emit server events.

```typescript
const jlog = log.forJob('product-crawls', 42)

// Type-safe — autocomplete on event names, type-checked data shape
jlog.event('crawl.started', { source: 'dm', items: 42, crawlVariants: true })
jlog.event('scraper.product_scraped', { url, source: 'dm', name, variants: 3, durationMs: 1200, images: 5, hasIngredients: true })
jlog.event('persist.price_changed', { url, source: 'dm', change: 'drop', previousCents: 999, currentCents: 799 })

// Override default metadata from EVENT_META
jlog.event('crawl.started', data, { level: 'debug' })
```

The `event()` method:
1. Looks up `EVENT_META[name]` for default type/level/labels
2. Allows overriding any metadata field via the optional `opts` parameter
3. Logs to console using the event name as the message
4. Emits to the server with both `message` (prefixed with `[tag]`) and `name` fields
5. Only emits server events when the logger is job-scoped (via `forJob()`)

Event names follow `domain.action` convention (e.g. `crawl.started`, `scraper.product_scraped`, `persist.price_changed`). ~90 events are defined covering all emission sites. See `shared/src/events.ts` for the complete registry.

### Banner logging (stage markers)

The `banner(title, data?)` and `bannerEnd(title, success, data?)` methods print prominent ASCII-boxed output to the console, making stage boundaries easy to spot when scrolling through logs. They are console-only — no server event is emitted (use `event()` separately for that).

```typescript
log.banner('STAGE: download — "My Video"', { videoId: 42 })
// Console output (text mode):
// ┌──────────────────────────────────────────────────────────────────────┐
// │ ▶ STAGE: download — "My Video"  videoId=42                          │
// └──────────────────────────────────────────────────────────────────────┘

log.bannerEnd('STAGE: download — "My Video"', true, { duration: '4.2s', tokens: 0 })
// ┌──────────────────────────────────────────────────────────────────────┐
// │ ✓ STAGE: download — "My Video"  duration=4.2s tokens=0              │
// └──────────────────────────────────────────────────────────────────────┘

log.bannerEnd('STAGE: download — "My Video"', false, { duration: '1.3s', error: 'timeout' })
// ┌──────────────────────────────────────────────────────────────────────┐
// │ ✗ STAGE: download — "My Video"  duration=1.3s error=timeout         │
// └──────────────────────────────────────────────────────────────────────┘
```

In JSON mode, banners emit a single JSON line with `"banner": true` for filtering.

### Stage lifecycle events

Both stage-based pipelines (video processing and product aggregation) emit generic `stage.started`, `stage.completed`, and `stage.failed` events via the job-scoped logger. These are server events visible in the admin UI.

```typescript
jlog.event('stage.started', { pipeline: 'video-processing', stage: 'download', item: 'My Video Title' })
jlog.event('stage.completed', { pipeline: 'product-aggregation', stage: 'classify', item: '4012345678901', durationMs: 3200, tokens: 450 })
jlog.event('stage.failed', { pipeline: 'video-processing', stage: 'transcription', item: 'My Video', durationMs: 1300, error: 'timeout' })
```

Each stage execution produces exactly one `stage.started` + one `stage.completed` or `stage.failed` pair.

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
| `matchBrand`, `matchIngredients`, `matchProduct`, `classifyProduct`, `cleanProductName` | Matching/classification functions |
| `processVideo`, `recognizeProduct`, `transcribeAudio`, `correctTranscript`, `analyzeSentiment` | Video processing functions |

### Driver logger passthrough

Source drivers accept an optional `logger` in their options (`scrapeProduct`, `discoverProducts`, `searchProducts`). The handler passes the job-scoped `jlog` so driver-level events (network failures, parse errors, anti-bot detection) appear in the admin UI's event log for the job.

### Job collections

The `JobCollection` type (imported from `@anyskin/shared`) covers all 8 job collections: `product-discoveries`, `product-searches`, `product-crawls`, `ingredients-discoveries`, `product-aggregations`, `video-discoveries`, `video-processings`, `ingredient-crawls`.

### Configuration

- **`LOG_LEVEL`**: `debug` | `info` | `warn` | `error` (default: `info`)
- **`LOG_FORMAT`**: `text` | `json` (default: `text`). Use `json` for log aggregators (ELK, Datadog, CloudWatch).

**Levels**: `debug` < `info` < `warn` < `error`.

**Event types**: `start`, `success`, `info`, `warning`, `error`. Auto-derived from log level, or set explicitly.

### Event coverage — product crawl/discovery/search

All events below are emitted to the server's `events` collection (visible in admin UI).

**Job lifecycle events** (from `worker.ts` handlers):

| Event | When | Key data fields | Labels |
|-------|------|----------------|--------|
| `Job started` | Handler begins processing | `source`, `items`, `crawlVariants` (crawl); `urlCount`, `currentUrlIndex`, `maxPages` (discovery); `query`, `sources`, `maxResults` (search) | `scraping` / `discovery` / `search` |

**Per-product driver events** (from source drivers):

| Event | When | Key data fields | Labels |
|-------|------|----------------|--------|
| `Scraping product` | Before each scrape | `url`, `source` | `scraping` |
| `Product scraped` | Successful scrape | `url`, `source`, `name`, `variants`, `durationMs`, `images`, `hasIngredients` | `scraping` |
| `Scrape failed: *` | Various failures | `url`, `source`, `status`/`error` | `scraping` |
| `Discovery page scraped` | Per pagination page | `source`, `page`, `products` | `discovery` |
| `Search complete` | After search finishes | `source`, `query`, `results` | `search` |
| `Bot check detected/cleared/timed out` | Mueller anti-bot | `url`, `source`, `elapsedMs`/`timeoutMs` | `scraping`, `bot-check` |

**Persist-level events** (from `persist.ts`):

| Event | When | Key data fields | Labels |
|-------|------|----------------|--------|
| `Variants processed` | Product has sibling variants | `url`, `newVariants`, `existingVariants`, `totalVariants` | `scraping`, `variants` |
| `Price change detected` | Price drop or increase (≥5%) | `url`, `source`, `change` (drop/increase), `previousCents`, `currentCents` | `scraping`, `price` |
| `Ingredients found` | Product has ingredients text | `url`, `source`, `chars` | `scraping`, `ingredients` |
| Product warnings | Per warning from scraped data | warning text (no structured data) | — |

**Batch/completion events** (from `submit.ts`):

| Event | When | Key data fields | Labels |
|-------|------|----------------|--------|
| `Batch done` (crawl) | After each crawl batch | `source`, `crawled`, `errors`, `remaining`, `batchSize`, `batchSuccesses`, `batchErrors`, `errorRate`, `batchDurationMs`, `newVariants`, `existingVariants`, `withIngredients`, `priceChanges` | `scraping` |
| `Completed` (crawl) | Crawl job done | `source`, `crawled`, `errors`, `durationMs` | `scraping` |
| `Batch persisted` (discovery) | After each discovery batch | `source`, `discovered`, `batchSize`, `batchPersisted`, `batchErrors`, `batchDurationMs`, `pagesUsed` | `discovery` |
| `Completed` (discovery) | Discovery job done | `source`, `discovered`, `durationMs` | `discovery` |
| `Search results persisted` | After search batch | `sources`, `discovered`, `persisted`, `batchDurationMs` | `search` |
| `Completed` (search) | Search job done | `sources`, `discovered`, `durationMs` | `search` |

**Job failure/retry events** (from `job-failure.ts`):

| Event | When | Key data fields | Labels |
|-------|------|----------------|--------|
| `Job error, will retry` | Transient failure, retrying | `retryCount`, `maxRetries`, `reason` | `job-retry` |
| `Job failed` | Permanent failure | `reason` | `job-failure` |
| `Job failed: max retries exceeded` | Retries exhausted | `retryCount`, `maxRetries`, `reason` | `job-failure`, `max-retries` |

## Key Patterns

- **Batch processing**: All jobs process `itemsPerTick` items per claim cycle (default 10, video processing default 1 stage-item per tick)
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
  - `normalizeVariantUrl()` — strips hash fragments and trailing slashes but preserves ALL query parameters. Drivers are the source of truth for which query params to include when constructing variant URLs (Mueller: `?itemId=`, PURISH: `?variant=`, DM/Rossmann: path-based, no params). Applied to all variant URLs from all drivers in persist.ts.
- **Variant URLs**: Drivers are the source of truth for variant URL construction. Each driver extracts the full variant URL from the page (DM: from API `href` field; Mueller: from RSC JSON `siblings[].path`; Rossmann: from variant list link `href`; PURISH: `?variant={id}` from Shopify variant ID). `persistCrawlResult` stores whatever the driver provides — no URL inference or construction outside the driver. `normalizeVariantUrl()` preserves all query params — drivers produce clean URLs with only meaningful params. Mueller's driver uses a hybrid RSC JSON + DOM scraping approach: structured data (GTIN, price, brand, images, variants with availability) comes from the Next.js RSC payload embedded in `self.__next_f.push()` script tags, while ingredients, rating, and accordion description are scraped from the rendered DOM. PURISH's driver uses a hybrid approach: the Shopify `.json` API for product data (name, brand, images, options) and the product page HTML for per-variant availability (via embedded `productJson`), the complete variant list (API may omit unavailable variants), tab-structured description, labels, and ingredients. When crawling a specific variant URL (`?variant=ID`), the driver selects the matching variant for GTIN/price/canonicalUrl.
- **PURISH variant images**: Shopify's `.json` API returns ALL product images with `variant_ids` arrays. However, only one "hero" image per variant is tagged (has the variant's ID in `variant_ids`); the remaining variant-specific images are untagged (`variant_ids: []`). The PURISH driver uses **position-based block grouping** (`getVariantImages()`) to assign images to variants: images are sorted by `position`, each tagged image starts a new variant's contiguous block, and untagged images after the last variant block are shared/product-level images appended to every variant's gallery. Example: 6 variants × 6 images each + 2 shared = 38 total images; each variant gets 6 own + 2 shared = 8 images (matches what the storefront displays).
- **Variant availability**: All four drivers provide per-variant availability. DM uses its availability API (keyed by DAN). Mueller uses RSC JSON `stockLevel`. Rossmann only shows available variants on the page (persist layer marks disappeared ones as unavailable). PURISH uses the `productJson` variable embedded in the product page HTML as the **primary variant source** — it includes ALL variants (available + unavailable) with `available` booleans, while the Shopify `.json` API may omit unavailable variants. Availability is stored **per priceHistory entry** (not as a top-level field), giving full availability history over time. The persist layer defaults to `available` if the driver doesn't explicitly set availability. Disappeared variants get an `unavailable` priceHistory entry appended (no price data, just availability status + timestamp).
- **PURISH labels**: Labels are scraped directly from the product page HTML (not from Shopify tags). Two sources are extracted by `fetchProductPageData()` and merged (deduplicated): (1) `<span class="product-tag">` elements inside `.porduct-tags-wrap` — "free-from" claims like "Paraben-free", "Cruelty-free", "Made in the USA"; (2) `<span>` text inside `.product-badge-custom` divs — store badges like "Bestseller", "Last Chance", "Kostenloser Versand". Labels are taken as-is with no filtering or normalization. DM extracts labels from `data.pills`; Mueller and Rossmann currently don't extract labels.
- **PURISH description**: Descriptions are extracted from the `<tabs-desktop>` tab structure in the product page HTML, not from `body_html` in the Shopify JSON API. Tab titles (from `<button class="tab-navigate">`) become `## Headlines` and tab content is converted to markdown text beneath each. All tabs are included (Beschreibung, Inhaltsstoffe, Anwendung, Warnhinweise, etc.) so nothing is lost. Falls back to `body_html` from the JSON API if no tab structure is found on the page.
- **Category breadcrumbs**: Source-products store category as a `categoryBreadcrumb` text string (e.g. `"Pflege -> Körperpflege -> Handcreme"`), written by crawl/discovery persist functions. This is raw metadata from retailers; it is not mapped to any collection during aggregation.
- **Deduplication**: Source-products are matched by `sourceUrl` (unique, indexed field on `source-products`) to prevent duplicates during crawl (persist finds-or-creates by normalized URL). Discovery and search deduplicate URLs in-memory before appending to the job's `productUrls` field. Source-variants are matched by `sourceUrl` (unique constraint on `source-variants`) to prevent duplicate variants during crawl.
- **Price history**: Each crawl appends to the `priceHistory` array on the crawled source-variant (not on source-products). Each entry includes `availability` (available/unavailable/unknown) alongside price data, giving full availability history. Entries may have price data only, availability only (for sibling/disappeared variants), or both. Discovery/search do not collect price data — prices and availability are only recorded during crawl.
- **No join tables**: The `crawl-results`, `discovery-results`, and `search-results` collections have been removed. Discovery/search jobs accumulate URLs in their `productUrls` field. Crawl jobs create source-products directly during persist (find-or-create by normalized URL).
- **Browser stealth**: `browser.ts` uses `playwright-extra` with `puppeteer-extra-plugin-stealth` to evade bot detection. The stealth plugin patches `navigator.webdriver`, Chrome runtime, plugins, WebGL, permissions, and other fingerprinting vectors. Applied globally to all Playwright-based drivers (Mueller, Rossmann).
- **External CLIs**: `yt-dlp`, `ffmpeg`, `ffprobe`, `zbarimg` (video processing)
- **External APIs**: Deepgram (speech-to-text), OpenAI gpt-4.1-mini (LLM correction, sentiment analysis, recognition, matching)
- **ML models**: `@huggingface/transformers` + `onnxruntime-node` for local Grounding DINO inference (`onnx-community/grounding-dino-tiny-ONNX`). Model is lazy-loaded once per worker process on first object detection call (~700MB download cached in `.cache/huggingface`). `sharp` (already installed for video processing) handles image cropping.

## Per-Driver Documentation

Each source driver has its own `AGENTS.md` file documenting store-specific scraping details:

- **`drivers/dm/AGENTS.md`** — DM: API-based, product detail + availability APIs, DAN system, search headers
- **`drivers/mueller/AGENTS.md`** — Mueller: Playwright, hybrid RSC JSON + DOM, bot check handling, GTIN from image URLs
- **`drivers/rossmann/AGENTS.md`** — Rossmann: Playwright, pure DOM scraping, BazaarVoice ratings, dataLayer categories
- **`drivers/purish/AGENTS.md`** — PURISH: Shopify JSON API + page HTML, tab-structured descriptions, position-based image grouping, productJson variants

These files document: data sources, scrape flow, field extraction details (with CSS selectors / API paths / regex patterns), discovery and search flows, URL patterns, and implementation details.

**When you learn something new about how a store's website works** — a new HTML structure, a changed API response, a different selector, a new label source, an anti-bot behavior, or any other scraping detail — **update that driver's `AGENTS.md` immediately**. This is critical for maintaining accurate documentation that future sessions can rely on. Each driver's page structure and APIs are different and change over time; the AGENTS.md is the single source of truth for how we scrape each store.

## Keeping This File Up to Date

Whenever you make changes to the worker codebase, **update this file** to reflect those changes. This includes additions or modifications to job handlers, the work protocol, source drivers, matching/classification functions, the REST client, logging, or any worker-side patterns documented here. Documentation must stay in sync with the code.

When modifying a source driver, also **update the driver's own `AGENTS.md`** (in the driver's folder) to reflect the changes. The per-driver AGENTS.md files contain store-specific scraping details that are too granular for this file — see the "Per-Driver Documentation" section above.

For changes that affect the overall repository layout or cross both server and worker, also update the root `AGENTS.md`. See the root file for the full policy.
