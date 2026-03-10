# Typed Event System — Implementation Plan

**STATUS: COMPLETE** — Both Phase 1 (infrastructure) and Phase 2 (migration of all 127 emission sites) are done. The old backward-compat code (`EventOpts`, `isEventOpts`, `{ event: true }` pattern) has been removed. All event emission now uses the typed `jlog.event()` API exclusively.

## Overview

Create a `@anyskin/shared` package in a pnpm workspace with a central event registry that maps ~90 event names to strictly typed data shapes. Add a `jlog.event()` method to the worker logger that enforces these types at the call site. Add a `name` field to the server's Events collection. Migrate all 127 emission sites to the new typed API.

## Step 1: Create pnpm workspace structure

### 1a. `crawler/pnpm-workspace.yaml` (new file)

```yaml
packages:
  - server
  - worker
  - shared
```

### 1b. `crawler/package.json` (new file)

```json
{
  "private": true
}
```

### 1c. `crawler/shared/package.json` (new file)

```json
{
  "name": "@anyskin/shared",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  }
}
```

### 1d. `crawler/shared/tsconfig.json` (new file)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"]
}
```

### 1e. Create directories

```
mkdir -p shared/src
```

---

## Step 2: Add `@anyskin/shared` as dependency

### 2a. `server/package.json` — add to `dependencies`

```json
"@anyskin/shared": "workspace:*"
```

### 2b. `worker/package.json` — add to `dependencies`

```json
"@anyskin/shared": "workspace:*"
```

### 2c. `server/next.config.mjs` — add `transpilePackages`

Find the Next.js config and add:
```js
transpilePackages: ['@anyskin/shared']
```

### 2d. Run `pnpm install` from root

This links the workspace packages.

---

## Step 3: Event Registry — `shared/src/events.ts`

### Design Principles

- Event names use `domain.action` convention (e.g. `crawl.started`, `persist.price_changed`)
- Driver-specific events use **generic names** with `source: SourceSlug` in data — NOT `dm.product_scraped`
- Each event maps to a typed data shape (all values are scalar: `string | number | boolean`)
- `EVENT_META` provides default `type`, `level`, and `labels` for each event
- Shared types (`SourceSlug`, `JobCollection`, `EventType`, `LogLevel`) are defined once in shared

### Types to define

```typescript
// Store slugs — must match server's STORES registry
export type SourceSlug = 'dm' | 'mueller' | 'rossmann' | 'purish'

// Job collections — must match both server collection slugs and worker claim logic
export type JobCollection =
  | 'product-discoveries'
  | 'product-searches'
  | 'product-crawls'
  | 'ingredients-discoveries'
  | 'product-aggregations'
  | 'video-discoveries'
  | 'video-processings'
  | 'ingredient-crawls'

export type EventType = 'start' | 'success' | 'info' | 'warning' | 'error'
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type EventName = keyof EventRegistry

export interface EventMeta {
  type: EventType
  level: LogLevel
  labels?: string[]
}
```

### Event Registry Interface (~58 events)

Organized by domain. Each entry maps an event name to its data shape.

```typescript
export interface EventRegistry {
  // ─── Job Lifecycle ────────────────────────────────────────────
  // Emitted from: claim.ts (start events), submit.ts (completion), job-failure.ts
  'job.claimed': { collection: string; jobId: number; total?: number }
  'job.completed': { collection: string; durationMs: number }
  'job.completed_empty': { collection: string; reason: string }
  'job.failed': { reason: string }
  'job.failed_max_retries': { retryCount: number; maxRetries: number; reason: string }
  'job.retrying': { retryCount: number; maxRetries: number; reason: string }

  // ─── Product Crawl ───────────────────────────────────────────
  // Emitted from: worker.ts (handler), submit.ts (batch/completion), persist.ts
  'crawl.started': { source: string; items: number; crawlVariants: boolean }
  'crawl.driver_missing': { source: string }
  'crawl.batch_done': {
    source: string; crawled: number; errors: number; remaining: number
    batchSize: number; batchSuccesses: number; batchErrors: number
    errorRate: number; batchDurationMs: number
    newVariants: number; existingVariants: number
    withIngredients: number; priceChanges: number
  }
  'crawl.completed': { source: string; crawled: number; errors: number; durationMs: number }

  // ─── Scraper (per-product, driver-emitted) ───────────────────
  // Emitted from: dm/mueller/rossmann/purish drivers
  'scraper.started': { url: string; source: string }
  'scraper.product_scraped': {
    url: string; source: string; name: string; variants: number
    durationMs: number; images: number; hasIngredients: boolean
  }
  'scraper.failed': { url: string; source: string; error: string; reason?: string }
  'scraper.warning': { url: string; source: string; detail: string }
  'scraper.bot_check_detected': { url: string; source: string; timeoutMs: number }
  'scraper.bot_check_cleared': { url: string; source: string; elapsedMs: number }
  'scraper.bot_check_timeout': { url: string; source: string; elapsedMs?: number }

  // ─── Persist (crawl results) ─────────────────────────────────
  // Emitted from: persist.ts
  'persist.variants_processed': { url: string; newVariants: number; existingVariants: number; totalVariants: number }
  'persist.variants_disappeared': { url: string; markedUnavailable: number }
  'persist.price_changed': { url: string; source: string; change: string; previousCents: number; currentCents: number }
  'persist.ingredients_found': { url: string; source: string; chars: number }
  'persist.crawl_warning': { warning: string }

  // ─── Product Discovery ───────────────────────────────────────
  // Emitted from: worker.ts (handler), drivers (page scraping), submit.ts (batch/completion)
  'discovery.started': { urlCount: number; currentUrlIndex: number; maxPages: number }
  'discovery.page_scraped': { source: string; page: number; products: number }
  'discovery.batch_persisted': {
    source: string; discovered: number; created: number; existing: number
    batchSize: number; batchPersisted: number; batchErrors: number
    batchDurationMs: number; pagesUsed: number
  }
  'discovery.completed': { source: string; discovered: number; created: number; existing: number; durationMs: number }

  // ─── Product Search ──────────────────────────────────────────
  // Emitted from: worker.ts (handler), drivers, submit.ts
  'search.started': { query: string; sources: string; maxResults: number }
  'search.source_complete': { source: string; query: string; results: number }
  'search.batch_persisted': {
    sources: string; discovered: number; created: number; existing: number
    persisted: number; batchDurationMs: number
  }
  'search.completed': { sources: string; discovered: number; created: number; existing: number; durationMs: number }

  // ─── Ingredients Discovery ───────────────────────────────────
  // Emitted from: worker.ts (handler), submit.ts
  'ingredients_discovery.started': { currentTerm: string; queueLength: number }
  'ingredients_discovery.batch_persisted': {
    discovered: number; created: number; existing: number; errors: number
    batchSize: number; batchDurationMs: number
  }
  'ingredients_discovery.completed': { discovered: number; created: number; existing: number; errors: number; durationMs: number }

  // ─── Ingredient Crawl ────────────────────────────────────────
  // Emitted from: worker.ts (handler), submit.ts
  'ingredient_crawl.started': { items: number; type: string }
  'ingredient_crawl.not_found': { ingredient: string }
  'ingredient_crawl.no_description': { ingredient: string }
  'ingredient_crawl.error': { ingredientId: number; ingredient: string; error: string }
  'ingredient_crawl.persist_failed': { ingredientId: number; ingredient: string; error: string }
  'ingredient_crawl.batch_done': { crawled: number; errors: number; batchSize: number; batchDurationMs: number }
  'ingredient_crawl.completed': { crawled: number; errors: number; tokensUsed: number; durationMs: number }

  // ─── Video Discovery ─────────────────────────────────────────
  // Emitted from: worker.ts (handler), submit.ts
  'video_discovery.started': { currentOffset: number; batchSize: number; maxVideos: number }
  'video_discovery.batch_persisted': { discovered: number; created: number; existing: number; batchSize: number; batchDurationMs: number }
  'video_discovery.completed': { discovered: number; created: number; existing: number; durationMs: number }

  // ─── Video Processing ────────────────────────────────────────
  // Emitted from: worker.ts (handler), submit.ts
  'video_processing.started': { videos: number; transcriptionEnabled: boolean; transcriptionLanguage: string; transcriptionModel: string }
  'video_processing.downloaded': { title: string; sizeMB: number }
  'video_processing.scene_detected': { title: string; sceneChanges: number; segments: number }
  'video_processing.barcode_found': { title: string; segment: number; barcode: string }
  'video_processing.clustered': { title: string; segment: number; clusters: number }
  'video_processing.candidates_identified': { title: string; segment: number; candidates: number }
  'video_processing.product_recognized': { title: string; segment: number; brand: string; product: string }
  'video_processing.transcribed': { title: string; words: number }
  'video_processing.transcript_corrected': { title: string; fixes: number; tokens: number }
  'video_processing.sentiment_analyzed': { title: string; tokens: number }
  'video_processing.transcription_failed': { title: string; error: string }
  'video_processing.complete': { title: string; segments: number; tokens: number }
  'video_processing.failed': { title: string; error: string }
  'video_processing.persist_failed': { videoId: string; error: string }
  'video_processing.error': { videoId: string; error: string }
  'video_processing.segment_persisted': { message: string }
  'video_processing.batch_done': { processed: number; errors: number; batchSize: number; batchDurationMs: number }
  'video_processing.completed': { processed: number; errors: number; tokensUsed: number; durationMs: number }

  // ─── Product Aggregation ─────────────────────────────────────
  // Emitted from: worker.ts (handler), submit.ts, persist.ts
  'aggregation.started': { items: number; type: string; scope: string; language: string }
  'aggregation.error': { gtin: string; error: string }
  'aggregation.persist_error': { gtin: string; error: string }
  'aggregation.persist_failed': { gtin: string; error: string }
  'aggregation.warning': { gtin: string; warning: string }
  'aggregation.brand_matched': { brandName: string; brandId: number }
  'aggregation.ingredients_matched': { matched: number; unmatched: number; total: number }
  'aggregation.image_uploaded': { mediaId: number }
  'aggregation.classification_applied': { productType: string; attributeCount: number; claimCount: number }
  'aggregation.batch_done': { aggregated: number; errors: number; batchSize: number; batchDurationMs: number }
  'aggregation.completed': { aggregated: number; errors: number; tokensUsed: number; durationMs: number }

  // ─── Brand Matching ──────────────────────────────────────────
  // Emitted from: match-brand.ts
  'brand.exact_match': { brand: string; brandId: number }
  'brand.auto_match': { brand: string; matched: string; brandId: number }
  'brand.llm_selected': { brand: string; matched: string; brandId: number }
  'brand.llm_parse_failed': { brand: string }
  'brand.recheck_found': { brand: string; brandId: number }
  'brand.created': { brand: string; brandId: number }

  // ─── Ingredient Matching ─────────────────────────────────────
  // Emitted from: match-ingredients.ts
  'ingredients.exact_match_summary': { exactMatches: number; total: number }
  'ingredients.all_exact_matched': { matched: number }
  'ingredients.llm_selection_failed': { ambiguousCount: number }
  'ingredients.matched': { matched: number; unmatched: number }

  // ─── Product Matching ────────────────────────────────────────
  // Emitted from: match-product.ts
  'product_match.brand_matched': { brand: string; matched: string; brandId: number }
  'product_match.candidates_found': { count: number; product: string }
  'product_match.no_match': { product: string }
  'product_match.auto_match': { product: string; matched: string; productId: number }
  'product_match.llm_selected': { product: string; matched: string; productId: number }
  'product_match.no_match_after_llm': { product: string }

  // ─── Classification ──────────────────────────────────────────
  // Emitted from: classify-product.ts
  'classification.invalid_product_type': { productType: string }
  'classification.complete': { productType: string; attributes: number; claims: number }
}
```

### EVENT_META constant

Maps each event name to its default type, level, and labels. Example:

```typescript
export const EVENT_META: Record<EventName, EventMeta> = {
  // Job lifecycle
  'job.claimed': { type: 'start', level: 'info' },
  'job.completed': { type: 'success', level: 'info' },
  'job.completed_empty': { type: 'success', level: 'info' },
  'job.failed': { type: 'error', level: 'error', labels: ['job-failure'] },
  'job.failed_max_retries': { type: 'error', level: 'error', labels: ['job-failure', 'max-retries'] },
  'job.retrying': { type: 'warning', level: 'warn', labels: ['job-retry'] },

  // Crawl
  'crawl.started': { type: 'start', level: 'info', labels: ['scraping'] },
  'crawl.driver_missing': { type: 'error', level: 'error', labels: ['scraping'] },
  'crawl.batch_done': { type: 'info', level: 'info', labels: ['scraping'] },
  'crawl.completed': { type: 'success', level: 'info', labels: ['scraping'] },

  // Scraper
  'scraper.started': { type: 'info', level: 'info', labels: ['scraping'] },
  'scraper.product_scraped': { type: 'info', level: 'info', labels: ['scraping'] },
  'scraper.failed': { type: 'error', level: 'error', labels: ['scraping'] },
  'scraper.warning': { type: 'warning', level: 'warn', labels: ['scraping'] },
  'scraper.bot_check_detected': { type: 'warning', level: 'warn', labels: ['scraping', 'bot-check'] },
  'scraper.bot_check_cleared': { type: 'info', level: 'info', labels: ['scraping', 'bot-check'] },
  'scraper.bot_check_timeout': { type: 'error', level: 'error', labels: ['scraping', 'bot-check'] },

  // Persist
  'persist.variants_processed': { type: 'info', level: 'info', labels: ['scraping', 'variants'] },
  'persist.variants_disappeared': { type: 'info', level: 'info', labels: ['scraping', 'variants'] },
  'persist.price_changed': { type: 'info', level: 'info', labels: ['scraping', 'price'] },
  'persist.ingredients_found': { type: 'info', level: 'info', labels: ['scraping', 'ingredients'] },
  'persist.crawl_warning': { type: 'warning', level: 'warn' },

  // ... (complete for all ~90 events)
  // (Full mapping follows the same pattern — each event gets type/level/labels from the catalog)
}
```

### Barrel export — `shared/src/index.ts`

```typescript
export type {
  EventRegistry,
  EventName,
  EventMeta,
  EventType,
  LogLevel,
  SourceSlug,
  JobCollection,
} from './events.js'

export { EVENT_META } from './events.js'
```

---

## Step 4: Update Worker Logger

### Changes to `worker/src/lib/logger.ts`

1. **Import shared types** — replace local `EventType` and `JobCollection` with imports from `@anyskin/shared`:
   ```typescript
   import type { EventRegistry, EventName, EventMeta, EventType, LogLevel, JobCollection } from '@anyskin/shared'
   export { EVENT_META } from '@anyskin/shared'
   // Re-export for backward compat:
   export type { EventType, JobCollection } from '@anyskin/shared'
   ```

2. **Update `Logger` interface** — add `event()` method:
   ```typescript
   export interface Logger {
     // ... existing methods unchanged ...
     event<N extends EventName>(name: N, data: EventRegistry[N], opts?: Partial<EventMeta>): void
     forJob(collection: JobCollection, id: number): Logger
   }
   ```

3. **Update `emitEvent()` signature** — add optional `name` parameter:
   ```typescript
   function emitEvent(
     eventType: EventType,
     level: LogLevel,
     collection: JobCollection,
     jobId: number,
     message: string,
     labels?: string[],
     data?: LogData,
     name?: string,  // NEW
   ): void
   ```
   When `name` is provided, include it in the REST POST body: `name`.

4. **Implement `event()` in `makeLogger()`**:
   ```typescript
   event<N extends EventName>(name: N, data: EventRegistry[N], opts?: Partial<EventMeta>): void {
     const meta = EVENT_META[name]
     const resolvedType = opts?.type ?? meta.type
     const resolvedLevel = opts?.level ?? meta.level
     const resolvedLabels = opts?.labels ?? meta.labels

     // Console output (reuse existing formatting)
     const logFn = resolvedLevel === 'error' ? 'error'
       : resolvedLevel === 'warn' ? 'warn'
       : 'info'
     // Call the existing internal log function for console output
     logToConsole(resolvedLevel, tag, name, data as LogData)

     // Emit server event if job-scoped
     if (job) {
       emitEvent(resolvedType, resolvedLevel, job.collection, job.id, name, resolvedLabels, data as LogData, name)
     }
   }
   ```

5. **Keep backward compatibility** — existing `info()`/`warn()`/`error()` + `{ event: true }` pattern continues to work unchanged. The `event()` method is the new preferred API, but migration is Phase 2.

---

## Step 5: Add `name` field to server Events collection

### Changes to `server/src/collections/Events.ts`

Add a `name` text field (indexed, not required) after the existing `type` field:

```typescript
{
  name: 'name',
  type: 'text',
  index: true,
  admin: {
    description: 'Typed event name (e.g. crawl.started, persist.price_changed)',
  },
},
```

Then run:
```bash
cd server && pnpm generate:types
```

---

## Step 6: Validate TypeScript

Run in each package:
```bash
cd shared && npx tsc --noEmit
cd server && npx tsc --noEmit
cd worker && npx tsc --noEmit
```

Fix any errors.

---

## Step 7: Update AGENTS.md files

### Root `AGENTS.md`

Add to Repository Layout:
```
├── shared/             # @anyskin/shared — types shared between server and worker
│   ├── src/
│   │   ├── index.ts            # Barrel export
│   │   └── events.ts           # EventRegistry, EVENT_META, shared types
│   ├── package.json
│   └── tsconfig.json
```

Add workspace info to Development Notes:
- pnpm workspace (root `pnpm-workspace.yaml` lists server, worker, shared)
- `@anyskin/shared` is consumed as raw TS (no build step) — server uses `transpilePackages`, worker uses tsx

Update Database Schema for Events collection — add `name` field.

### `worker/AGENTS.md`

Document:
- New `jlog.event()` API with type safety
- Import path: `import { EVENT_META } from '@anyskin/shared'`
- Types now come from `@anyskin/shared` instead of local definitions
- Backward compat: old `{ event: true }` pattern still works

### `server/AGENTS.md`

Document:
- New `name` field on Events collection
- `@anyskin/shared` dependency with `transpilePackages` config

---

## Mapping: 127 Emission Sites → Event Names

This table shows how each of the 127 current emission sites maps to a typed event name. This is the reference for Phase 2 migration.

| # | File | Line | Current Message | → Event Name |
|---|------|------|----------------|-------------|
| 1 | worker.ts | 148 | 'Job started' (crawl) | `crawl.started` |
| 2 | worker.ts | 168 | 'No driver for source' | `crawl.driver_missing` |
| 3 | worker.ts | 206 | 'Job started' (discovery) | `discovery.started` |
| 4 | worker.ts | 282 | 'Job started' (search) | `search.started` |
| 5 | worker.ts | 327 | 'Job started' (ingredients disc.) | `ingredients_discovery.started` |
| 6 | worker.ts | 404 | 'Job started' (video disc.) | `video_discovery.started` |
| 7 | worker.ts | 469 | 'Job started' (video proc.) | `video_processing.started` |
| 8 | worker.ts | 489 | 'Video downloaded' | `video_processing.downloaded` |
| 9 | worker.ts | 515 | 'Scene detection complete' | `video_processing.scene_detected` |
| 10 | worker.ts | 555 | 'Barcode found in segment' | `video_processing.barcode_found` |
| 11 | worker.ts | 620 | 'Visual clustering complete' | `video_processing.clustered` |
| 12 | worker.ts | 642 | 'Product candidates identified' | `video_processing.candidates_identified` |
| 13 | worker.ts | 679 | 'Product recognized' | `video_processing.product_recognized` |
| 14 | worker.ts | 791 | 'Transcription complete' | `video_processing.transcribed` |
| 15 | worker.ts | 809 | 'Transcript corrected' | `video_processing.transcript_corrected` |
| 16 | worker.ts | 953 | 'Sentiment analysis complete' | `video_processing.sentiment_analyzed` |
| 17 | worker.ts | 957 | 'Transcription failed' | `video_processing.transcription_failed` |
| 18 | worker.ts | 964 | 'Video processing complete' | `video_processing.complete` |
| 19 | worker.ts | 982 | 'Video processing failed' | `video_processing.failed` |
| 20 | worker.ts | 1029 | 'Job started' (aggregation) | `aggregation.started` |
| 21 | worker.ts | 1171 | 'Job started' (ingredient crawl) | `ingredient_crawl.started` |
| 22 | worker.ts | 1205 | 'Not found on INCIDecoder' | `ingredient_crawl.not_found` |
| 23 | worker.ts | 1277 | 'No description found on page' | `ingredient_crawl.no_description` |
| 24 | claim.ts | 313 | 'Started product crawl' | `job.claimed` |
| 25 | claim.ts | 367 | 'Product crawl completed' | `job.completed` |
| 26 | claim.ts | 416 | 'Started product discovery' | `job.claimed` |
| 27 | claim.ts | 458 | 'Started product search' | `job.claimed` |
| 28 | claim.ts | 496 | 'Started ingredients discovery' | `job.claimed` |
| 29 | claim.ts | 549 | 'Started video discovery' | `job.claimed` |
| 30 | claim.ts | 607 | 'Started video processing' | `job.claimed` |
| 31 | claim.ts | 712 | 'Started product aggregation' | `job.claimed` |
| 32 | claim.ts | 799 | 'Completed: no GTINs specified' | `job.completed_empty` |
| 33 | claim.ts | 832 | 'Product aggregation completed' | `job.completed` |
| 34 | claim.ts | 948 | 'Started ingredient crawl' | `job.claimed` |
| 35 | claim.ts | 970 | 'Completed: no ingredients specified' | `job.completed_empty` |
| 36 | claim.ts | 1006 | 'Ingredient crawl completed' | `job.completed` |
| 37 | submit.ts | 441 | 'Completed' (crawl) | `crawl.completed` |
| 38 | submit.ts | 449 | 'Batch done' (crawl) | `crawl.batch_done` |
| 39 | submit.ts | 524 | 'Batch persisted' (discovery) | `discovery.batch_persisted` |
| 40 | submit.ts | 559 | 'Completed' (discovery) | `discovery.completed` |
| 41 | submit.ts | 626 | 'Search results persisted' | `search.batch_persisted` |
| 42 | submit.ts | 648 | 'Completed' (search) | `search.completed` |
| 43 | submit.ts | 684 | 'Batch persisted' (ingredients disc.) | `ingredients_discovery.batch_persisted` |
| 44 | submit.ts | 711 | 'Completed' (ingredients disc.) | `ingredients_discovery.completed` |
| 45 | submit.ts | 758 | 'Batch persisted' (video disc.) | `video_discovery.batch_persisted` |
| 46 | submit.ts | 781 | 'Completed' (video disc.) | `video_discovery.completed` |
| 47 | submit.ts | 839 | 'Video persist failed' | `video_processing.persist_failed` |
| 48 | submit.ts | 844 | 'Video processing error' | `video_processing.error` |
| 49 | submit.ts | 877 | 'Completed' (video proc.) | `video_processing.completed` |
| 50 | submit.ts | 884 | 'Batch done' (video proc.) | `video_processing.batch_done` |
| 51 | submit.ts | 913 | 'Aggregation error' | `aggregation.error` |
| 52 | submit.ts | 934 | 'Aggregation persist error' | `aggregation.persist_error` |
| 53 | submit.ts | 940 | 'Aggregation warning' | `aggregation.warning` |
| 54 | submit.ts | 963 | 'Aggregation persist failed' | `aggregation.persist_failed` |
| 55 | submit.ts | 995 | 'Completed' (aggregation) | `aggregation.completed` |
| 56 | submit.ts | 1009 | 'Batch done' (aggregation) | `aggregation.batch_done` |
| 57 | submit.ts | 1038 | 'Ingredient crawl error' | `ingredient_crawl.error` |
| 58 | submit.ts | 1065 | 'Ingredient persist failed' | `ingredient_crawl.persist_failed` |
| 59 | submit.ts | 1095 | 'Completed' (ingredient crawl) | `ingredient_crawl.completed` |
| 60 | submit.ts | 1111 | 'Batch done' (ingredient crawl) | `ingredient_crawl.batch_done` |
| 61 | persist.ts | 458 | 'Variants processed' | `persist.variants_processed` |
| 62 | persist.ts | 523 | 'Disappeared variants marked unavailable' | `persist.variants_disappeared` |
| 63 | persist.ts | 558 | 'Price change detected' | `persist.price_changed` |
| 64 | persist.ts | 570 | 'Ingredients found' | `persist.ingredients_found` |
| 65 | persist.ts | 582 | (dynamic warning) | `persist.crawl_warning` |
| 66 | persist.ts | 1115 | (dynamic segment log) | `video_processing.segment_persisted` |
| 67 | persist.ts | 1250 | 'Brand matched' | `aggregation.brand_matched` |
| 68 | persist.ts | 1277 | 'Ingredients matched' | `aggregation.ingredients_matched` |
| 69 | persist.ts | 1311 | 'Image uploaded' | `aggregation.image_uploaded` |
| 70 | persist.ts | 1324 | 'Classification applied' | `aggregation.classification_applied` |
| 71 | job-failure.ts | 33 | 'Job failed' | `job.failed` |
| 72 | job-failure.ts | 72 | 'Job failed: max retries exceeded' | `job.failed_max_retries` |
| 73 | job-failure.ts | 86 | 'Job error, will retry' | `job.retrying` |
| 74-81 | dm/index.ts | various | DM driver events | `scraper.*` + `discovery.page_scraped` + `search.source_complete` |
| 82-94 | mueller/index.ts | various | Mueller driver events | `scraper.*` + `discovery.page_scraped` + `search.source_complete` |
| 95-102 | rossmann/index.ts | various | Rossmann driver events | `scraper.*` + `discovery.page_scraped` + `search.source_complete` |
| 103-109 | purish/index.ts | various | PURISH driver events | `scraper.*` + `discovery.page_scraped` + `search.source_complete` |
| 110-115 | match-brand.ts | various | Brand matching events | `brand.*` |
| 116-119 | match-ingredients.ts | various | Ingredient matching events | `ingredients.*` |
| 120-125 | match-product.ts | various | Product matching events | `product_match.*` |
| 126-127 | classify-product.ts | various | Classification events | `classification.*` |

---

## Notes

- **No database migration needed** — adding a nullable text field is safe, and we're pre-launch
- **No build step for shared** — both consumers import raw TS (server via `transpilePackages`, worker via `tsx`)
- **The `LogData` type constraint** (`Record<string, string | number | boolean | null | undefined>`) matches the event data shapes — all values are scalar. The `EventRegistry` data shapes provide stricter typing on top.
- **Phase 2 complete** — all 127 emission sites migrated to `jlog.event()`. Old backward-compat code (`EventOpts`, `isEventOpts`, `LEVEL_TO_EVENT`, `EVENT_OPTS_KEYS`) removed from `logger.ts`. The `debug()`/`info()`/`warn()`/`error()` methods are now console-only (no server event emission).
