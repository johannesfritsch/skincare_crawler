# Product Aggregation — Stage Pipeline

9-stage pipeline that transforms crawled source data into unified products. Each stage is a self-contained module that reads from the DB, does its work, and persists results immediately. Progress is tracked on the job's `aggregationProgress` JSON field — a `Record<string, StageName | null>` mapping product group keys to the last completed stage name.

## Architecture

### Registry (`index.ts`)

Central orchestration file. Exports:

- **`StageName`** — union of all 9 stage names
- **`AggregationProgress`** — `Record<string, StageName | null>` progress map type
- **`StageConfig`** — job-level config: `jobId`, `language`, `imageSourcePriority`, `detectionThreshold` (0-1, default 0.3), `minBoxArea` (fraction, default 0.05)
- **`StageContext`** — injected into every stage: `payload` (REST client), `config`, `log` (Logger), `uploadMedia()`, `heartbeat()`
- **`StageResult`** — `{ success, error?, productId?, tokensUsed? }`
- **`AggregationWorkItem`** — `{ productId: number | null, gtins: string[], variants: Array<{ gtin, sources }> }`
- **`StageDefinition`** — `{ name, index, jobField, execute }` — the `jobField` maps to the checkbox on the ProductAggregations collection (e.g. `stageResolve`)
- **`STAGES`** — ordered array of all 8 stage definitions
- **`getNextStage(lastCompleted, enabledStages)`** — finds the next enabled stage after `lastCompleted`
- **`getEnabledStages(job)`** — reads checkbox fields from the job document, returns `Set<StageName>`
- **`productNeedsWork(lastCompleted, enabledStages)`** — true if the product has more stages to run
- **`getAggregationProgress(job)`** — parses the JSON progress map from the job document

### Dispatcher (in `worker.ts`)

The handler in `worker.ts` is ~80 lines. It receives `stageItems: Array<{ productId, stageName, workItem }>` from `claimWork()`, iterates each item, dispatches to `STAGES.find(s => s.name === stageName).execute(ctx, workItem)`, and reports results to `submitWork()`.

### Progress Tracking

Progress keys are sorted GTIN lists joined by commas (e.g. `"4012345678901,4012345678902"`). After the resolve stage creates/finds the product, the product ID is stored under `pid:<progressKey>` for quick lookup by subsequent stages. The progress map is persisted to the job after every stage execution.

### Stage Selection

Each stage has a checkbox field on the job (all default `true`). `getEnabledStages()` checks `job.stageResolve !== false`, etc. Disabled stages are skipped — `getNextStage()` finds the first enabled stage after `lastCompleted`.

---

## Stages

### Stage 0: `resolve` — Find/Create Product + Variants

**File**: `resolve.ts` (~217 lines)
**Checkbox**: `stageResolve`
**LLM**: No
**Event**: `aggregation.resolved`

Takes a work item with GTINs and per-GTIN source data. Produces the unified product and product-variant records.

**Flow**:
1. Aggregate source data via `aggregateSourceVariantsToVariant()` and `aggregateVariantsToProduct()` (pure logic, no LLM)
2. Look up existing `product-variants` by GTIN — collect all referenced product IDs
3. If multiple GTINs point to different products, **merge** them: move all product-variants and video-mentions to the canonical product, merge source-product links, delete the empty duplicate product
4. If no existing product found, create a new one
5. Create `product-variants` for any new GTINs
6. Write basic variant data: `label`, `variantDimension`, `amount`, `amountUnit`, `sourceVariants` (linked IDs)
7. Update product: `name`, `sourceProducts` (linked IDs)

**Writes to**: `products`, `product-variants`, `video-mentions` (during merge)

**Key detail**: This is the only stage that can run with `productId: null` on the work item. All subsequent stages require a `productId` and will fail with an error if resolve hasn't run.

---

### Stage 1: `classify` — LLM Classification + Clean Name

**File**: `classify.ts` (~162 lines)
**Checkbox**: `stageClassify`
**LLM**: Yes — `classifyProduct()` + `cleanProductName()`
**Event**: `aggregation.classified`, `aggregation.name_cleaned`

Classifies the product from its source descriptions and ingredients. Also cleans the product name by stripping variant-specific info (sizes, colors).

**Flow**:
1. Deduplicate descriptions and ingredients across sources via `deduplicateDescriptions()` / `deduplicateIngredients()`
2. Call `classifyProduct(sources, language)` — returns productType, attributes, claims, warnings, skinApplicability, pH range, usage instructions/schedule, with evidence entries referencing source-product indices
3. Call `cleanProductName(rawName, variantLabels)` — strips variant-specific text (e.g. "50ml", "Rose Gold") to produce a generic product name
4. Look up `product-types` by slug to get the ID
5. Update product: `name` (cleaned), `productType`
6. Update all product-variants: `warnings`, `skinApplicability`, `phMin`, `phMax`, `usageInstructions`, `usageSchedule`, `productAttributes` (with evidence → source-product link), `productClaims` (with evidence)

**Evidence mapping**: Each attribute/claim carries `sourceProduct` (relationship), `evidenceType` (ingredient or descriptionSnippet), and type-specific fields (`snippet`/`start`/`end` for description snippets, `ingredientNames` array for ingredient evidence).

**Writes to**: `products`, `product-variants`

---

### Stage 2: `match_brand` — LLM Brand Matching

**File**: `match-brand.ts` (~43 lines)
**Checkbox**: `stageMatchBrand`
**LLM**: Yes — `matchBrand()`
**Event**: `aggregation.brand_matched`

Matches the brand name from source data to the `brands` collection (find or create via LLM fuzzy matching).

**Flow**:
1. Aggregate source data to get `brandName` via `aggregateVariantsToProduct()`
2. Call `matchBrand(payload, brandName, logger)` — finds existing brand or creates new one
3. Update product: `brand` (relationship to brands collection)

**Writes to**: `products`, `brands` (may create)

---

### Stage 3: `ingredients` — LLM Ingredient Parsing + Matching

**File**: `ingredients.ts` (~77 lines)
**Checkbox**: `stageIngredients`
**LLM**: Yes — `parseIngredients()` + `matchIngredients()`
**Event**: `aggregation.ingredients_matched`

Per variant: parses raw INCI text into individual ingredient names, then matches each to the `ingredients` collection.

**Flow** (per variant):
1. Aggregate source variant data to get `ingredientsText`
2. Find the `product-variant` by GTIN
3. Call `parseIngredients(ingredientsText)` — extracts ordered name list from raw INCI text (handles footnotes, asterisks, nested brackets)
4. Call `matchIngredients(payload, names, logger)` — matches each name to the `ingredients` collection via LLM fuzzy matching
5. Update product-variant: `ingredients` array of `{ name, ingredient: ingredientId | null }`

**Writes to**: `product-variants`

---

### Stage 4: `images` — Download + Upload ALL Store Images

**File**: `images.ts`
**Checkbox**: `stageImages`
**LLM**: No
**Event**: `aggregation.image_uploaded`

Per variant: collects **all** images from all source-variants (across all stores), downloads each, uploads to product-media, and sets them on the product-variant with visibility and source metadata.

**Image visibility**: The "best" image (selected by `imageSourcePriority`) is marked `visibility: 'public'` and placed first in the array — this is the frontend display image. All other images are marked `visibility: 'recognition_only'` — they are not shown in the frontend but are used by the object detection and CLIP embedding stages, giving the video search pipeline a much richer reference database to match against.

**Flow** (per variant):
1. Aggregate source variant data — `aggregateSourceVariantsToVariant()` collects `allImages` (deduplicated by URL across all stores) and picks `selectedImageUrl` by priority
2. Find the `product-variant` by GTIN
3. Download each image via `fetch()`
4. Upload each to `product-media` collection
5. Set `visibility: 'public'` on the best image, `'recognition_only'` on all others
6. Set `source` on each entry (dm/rossmann/mueller/purish)
7. Update product-variant: `images` array (public first, then recognition-only)

**Writes to**: `product-variants`, `product-media`

---

### Stage 5: `object_detection` — Grounding DINO Detection + Crop

**File**: `object-detection.ts`
**Checkbox**: `stageObjectDetection`
**LLM**: No (ML inference via ONNX)
**Event**: `aggregation.objects_detected`

Per variant: takes **ALL** uploaded product images (public + recognition_only from stage 4), runs Grounding DINO zero-shot object detection on each with the prompt `"cosmetics packaging."`, crops each detected region using sharp, uploads the crops to detection-media, and accumulates them all in `recognitionImages`.

This gives detection crops from every store's image of the product — not just a single "best" image — providing a much richer set of recognition embeddings for the video search pipeline to match against.

**Model**: `onnx-community/grounding-dino-tiny-ONNX` via `@huggingface/transformers` pipeline API. Lazy-loaded singleton — first call downloads ~700MB model to `.cache/huggingface`, subsequent calls reuse the loaded model. Uses dynamic `import()` because `@huggingface/transformers` is ESM-only.

**Thresholds**: `detectionThreshold` from job config (default 0.3 — Grounding DINO box confidence threshold), `minBoxArea` from job config (default 5% of image area — detections occupying less than this fraction of the source image are discarded as background noise)

**Flow** (per variant):
1. Find the `product-variant` by GTIN
2. Iterate **all** entries in the `images` array (both public and recognition_only)
3. For each image:
   - Resolve product-media URL, download the image buffer via `fetch()`
   - Get image dimensions via `sharp(buffer).metadata()`
   - Run detection: `detector(imageUrl, ["cosmetics packaging."], { threshold })`
   - For each detection: clamp box coordinates, crop via `sharp().extract().png().toBuffer()`, upload crop to `detection-media`
4. Accumulate all detection crops across all images into one `recognitionImages` array
5. Update product-variant: `recognitionImages` array of `{ image, score, boxXMin, boxYMin, boxXMax, boxYMax }`
6. If no images or no detections found across any image, clear `recognitionImages: []`

**Writes to**: `product-variants`, `detection-media`

**Note**: Field names use `boxXMin`/`boxYMin`/`boxXMax`/`boxYMax` (not `xmin`/`xmax`) because PostgreSQL reserves `xmin`/`xmax` as system column names.

---

### Stage 6: `embed_images` — CLIP Embedding Vectors

**File**: `embed-images.ts` (~170 lines)
**Checkbox**: `stageEmbedImages`
**LLM**: No (ML inference via ONNX)
**Event**: `aggregation.images_embedded`

Per variant: takes the recognition image crops (from stage 5 object detection), computes CLIP ViT-B/32 embedding vectors (512-dim), and writes them to pgvector via the server's generic embeddings API.

**Model**: `Xenova/clip-vit-base-patch32` (ONNX version of OpenAI's CLIP ViT-B/32). Lazy-loaded singleton — first call downloads ~350MB model to `.cache/huggingface`, subsequent calls reuse the loaded model. Uses dynamic `import()` because `@huggingface/transformers` is ESM-only. Same pattern as the Grounding DINO singleton.

**Flow** (per variant):
1. Find the `product-variant` by GTIN
2. Get `recognitionImages` array — filter to items where `hasEmbedding` is false
3. For each pending recognition image:
   a. Resolve the detection-media URL
   b. Run CLIP feature extraction: `extractor(imageUrl, { pooling: 'mean', normalize: true })`
   c. Extract the 512-dim embedding vector
4. Batch write embeddings via `POST /api/embeddings/recognition-images/write`
5. Update product-variant `recognitionImages` array with `hasEmbedding: true` for processed items

**Writes to**: `product_variants_recognition_images.embedding` (raw pgvector column via embeddings API), `product-variants` (hasEmbedding flag via Payload REST)

**Note**: The `embedding vector(512)` column is NOT managed by Payload — it was added via a manual migration. Only the `hasEmbedding` boolean is a Payload field. The embeddings API (`/api/embeddings/:namespace/write`) handles writing both the vector and the flag in a single transaction.

---

### Stage 7: `descriptions` — LLM Consensus Description + Label Dedup

**File**: `descriptions.ts` (~93 lines)
**Checkbox**: `stageDescriptions`
**LLM**: Yes — `consensusDescription()` + `deduplicateLabels()`
**Event**: `description.consensus`, `labels.deduplicated`

Per variant: synthesizes a single description from multiple source descriptions, and normalizes/deduplicates retailer labels.

**Flow** (per variant):
1. Aggregate source variant data — collects `descriptions[]` and `allLabels[]`
2. Find the `product-variant` by GTIN
3. Call `consensusDescription(descriptions)` — LLM synthesizes one description from multiple sources. Falls back to longest description on error.
4. Call `deduplicateLabels(allLabels)` — LLM normalizes to canonical German labels, removes store-specific ones (e.g. "dm-Marke", "Neu"). Falls back to unique raw labels on error.
5. Update product-variant: `description`, `labels` array of `{ label }`

**Writes to**: `product-variants`

---

### Stage 8: `score_history` — Compute Store + Creator Scores

**File**: `score-history.ts` (~103 lines)
**Checkbox**: `stageScoreHistory`
**LLM**: No
**Event**: None (logs only)

Computes store scores (from retailer ratings) and creator scores (from video mention sentiments), prepends a new entry to the product's `scoreHistory` array.

**Flow**:
1. Fetch all `source-products` for this product group — compute weighted average of `rating` fields (0–5 stars → 0–10 score via `avgRating * 2`)
2. Fetch all `video-mentions` for this product — compute average `overallSentimentScore` (-1 to +1 → 0–10 score via `(avg + 1) * 5`)
3. If neither score is available, skip
4. Read existing `scoreHistory` from the product
5. Compute `change` direction by comparing with the previous entry: `drop` (≥5% decrease), `increase` (≥5% increase), or `stable`
6. Prepend new entry: `{ recordedAt, storeScore, creatorScore, change }`

**Writes to**: `products`

---

## Shared Patterns

- **Every stage except resolve** checks `productId` at entry and returns `{ success: false }` if null
- **Per-variant stages** (ingredients, images, object_detection, embed_images, descriptions) look up `product-variant` by GTIN, skip if not found
- **Heartbeat**: long-running per-variant loops call `ctx.heartbeat()` after each variant to keep the job claim alive
- **Token tracking**: LLM stages return `tokensUsed` in `StageResult`; the dispatcher accumulates these
- **Events**: each stage emits typed events via `jlog.event()` for visibility in the admin dashboard
- **Idempotency**: stages overwrite previous results (e.g. `images: [{ image: newId }]` replaces old images). Object detection clears `recognitionImages` when no detections are found.
