/**
 * Typed Event Registry — single source of truth for all structured events
 * emitted by the worker and stored in the server's Events collection.
 *
 * Event names follow `domain.action` convention. Driver-specific events use
 * generic names with `source` in the data (not `dm.product_scraped`).
 */

// ─── Shared Types ───────────────────────────────────────────────────────────

/** Store slugs — must match server's STORES registry and worker driver slugs */
export type SourceSlug = 'dm' | 'mueller' | 'rossmann' | 'purish'

// ─── Ingredient Field Tracking ──────────────────────────────────────────────

/**
 * Content fields on the ingredients collection that can be attributed to a
 * data source. Metadata fields (status, crawledAt, sourceUrl, sources) are
 * excluded — only fields that hold ingredient data are listed.
 */
export const INGREDIENT_FIELDS = [
  'name',
  'casNumber',
  'ecNumber',
  'cosIngId',
  'chemicalDescription',
  'functions',
  'itemType',
  'restrictions',
  'longDescription',
  'shortDescription',
  'image',
] as const

export type IngredientField = (typeof INGREDIENT_FIELDS)[number]

/** Fields typically provided by the CosIng data source */
export const COSING_FIELDS: IngredientField[] = [
  'name', 'casNumber', 'ecNumber', 'cosIngId', 'chemicalDescription', 'functions', 'itemType', 'restrictions',
]

/** Fields typically provided by the INCIDecoder data source (shortDescription is excluded — it's LLM-generated, not scraped) */
export const INCIDECODER_FIELDS: IngredientField[] = [
  'longDescription', 'image',
]

/** Job collection slugs — must match both server collection configs and worker claim logic */
export type JobCollection =
  | 'product-discoveries'
  | 'product-searches'
  | 'product-crawls'
  | 'ingredients-discoveries'
  | 'product-aggregations'
  | 'video-discoveries'
  | 'video-crawls'
  | 'video-processings'
  | 'ingredient-crawls'

export type EventType = 'start' | 'success' | 'info' | 'warning' | 'error'
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** Default metadata for each event — type, level, and optional labels */
export interface EventMeta {
  type: EventType
  level: LogLevel
  labels?: string[]
}

/** Union of all valid event names */
export type EventName = keyof EventRegistry

// ─── Event Registry ─────────────────────────────────────────────────────────

/**
 * Maps every named event to its typed data shape. All data values are scalar
 * (string | number | boolean) to match the LogData constraint.
 *
 * The `event()` method on the logger enforces this at the call site:
 *   jlog.event('crawl.started', { source: 'dm', items: 42, crawlVariants: true })
 *                ^-- autocomplete   ^-- type-checked against EventRegistry
 */
export interface EventRegistry {
  // ─── Job Lifecycle ──────────────────────────────────────────────────────
  // claim.ts: job claimed & initialized, early completions
  // job-failure.ts: failures & retries

  'job.claimed': { collection: string; jobId: number; total?: number }
  'job.completed': { collection: string; durationMs?: number }
  'job.completed_empty': { collection: string; reason: string }
  'job.failed': { reason: string }
  'job.failed_max_retries': { retryCount: number; maxRetries: number; reason: string }
  'job.retrying': { retryCount: number; maxRetries: number; reason: string }
  'job.rescheduled': { collection: JobCollection; schedule: string; nextScheduledFor: string }

  // ─── Product Crawl ─────────────────────────────────────────────────────
  // worker.ts: handler start
  // submit.ts: batch done, completed

  'crawl.started': { source: string; items: number; crawlVariants: boolean }
  'crawl.driver_missing': { source: string }
  'crawl.batch_done': {
    source: string
    crawled: number
    errors: number
    remaining: number
    batchSize: number
    batchSuccesses: number
    batchErrors: number
    errorRate: number
    batchDurationMs: number
    newVariants: number
    existingVariants: number
    withIngredients: number
    priceChanges: number
  }
  'crawl.completed': {
    source: string
    crawled: number
    errors: number
    durationMs: number
  }

  // ─── Scraper (per-product, driver-emitted) ─────────────────────────────
  // All 4 drivers: dm, mueller, rossmann, purish

  'scraper.started': { url: string; source: string }
  'scraper.product_scraped': {
    url: string
    source: string
    name: string
    variants: number
    durationMs: number
    images: number
    hasIngredients: boolean
    reviews?: number
    rating?: number
  }
  'scraper.failed': {
    url: string
    source: string
    error: string
    reason?: string
    status?: number
  }
  'scraper.warning': { url: string; source: string; detail: string }
  'scraper.bot_check_detected': {
    url: string
    source: string
    timeoutMs: number
  }
  'scraper.bot_check_cleared': {
    url: string
    source: string
    elapsedMs: number
  }
  'scraper.bot_check_timeout': {
    url: string
    source: string
    elapsedMs?: number
  }

  // ─── Persist (crawl results) ───────────────────────────────────────────
  // persist.ts: variant processing, price changes, ingredients

  'persist.variants_processed': {
    url: string
    newVariants: number
    existingVariants: number
    totalVariants: number
  }
  'persist.variants_disappeared': { url: string; markedUnavailable: number }
  'persist.price_changed': {
    url: string
    source: string
    change: string
    previousCents: number
    currentCents: number
  }
  'persist.ingredients_found': {
    url: string
    source: string
    chars: number
  }
  'persist.crawl_warning': { warning: string }
  'persist.source_brand_created': {
    source: string
    brandName: string
    brandUrl: string
  }
  'persist.source_brand_exists': {
    source: string
    brandUrl: string
  }
  'persist.reviews_created': { url: string; source: string; count: number }

  // ─── Product Discovery ─────────────────────────────────────────────────
  // worker.ts: handler start
  // drivers: page scraped
  // submit.ts: batch persisted, completed

  'discovery.started': {
    urlCount: number
    currentUrlIndex: number
    maxPages: number
  }
  'discovery.page_scraped': {
    source: string
    page: number
    products: number
  }
  'discovery.batch_persisted': {
    source: string
    discovered: number
    batchSize: number
    batchPersisted: number
    batchErrors: number
    batchDurationMs: number
    pagesUsed: number
  }
  'discovery.completed': {
    source: string
    discovered: number
    durationMs: number
  }

  // ─── Product Search ────────────────────────────────────────────────────
  // worker.ts: handler start
  // drivers: search complete
  // submit.ts: batch persisted, completed

  'search.started': {
    query: string
    sources: string
    maxResults: number
  }
  'search.source_complete': {
    source: string
    query: string
    results: number
  }
  'search.batch_persisted': {
    sources: string
    discovered: number
    persisted: number
    batchDurationMs: number
  }
  'search.completed': {
    sources: string
    discovered: number
    durationMs: number
  }

  // ─── Ingredients Discovery ─────────────────────────────────────────────
  // worker.ts: handler start
  // submit.ts: batch persisted, completed

  'ingredients_discovery.started': {
    currentTerm: string
    queueLength: number
  }
  'ingredients_discovery.batch_persisted': {
    discovered: number
    created: number
    existing: number
    errors: number
    batchSize: number
    batchDurationMs: number
  }
  'ingredients_discovery.completed': {
    discovered: number
    created: number
    existing: number
    errors: number
    durationMs: number
  }

  // ─── Ingredient Crawl ──────────────────────────────────────────────────
  // worker.ts: handler start, not found, no description
  // submit.ts: error, persist failed, batch done, completed

  'ingredient_crawl.started': { items: number; type: string }
  'ingredient_crawl.not_found': { ingredient: string }
  'ingredient_crawl.no_description': { ingredient: string }
  'ingredient_crawl.error': {
    ingredientId: number
    ingredient: string
    error: string
  }
  'ingredient_crawl.persist_failed': {
    ingredientId: number
    ingredient: string
    error: string
  }
  'ingredient_crawl.batch_done': {
    crawled: number
    errors: number
    batchSize: number
    batchDurationMs: number
    withInciDecoder: number
  }
  'ingredient_crawl.completed': {
    crawled: number
    errors: number
    tokensUsed: number
    durationMs: number
    withInciDecoder: number
  }

  // ─── Video Discovery ──────────────────────────────────────────────────
  // worker.ts: handler start
  // submit.ts: batch persisted, completed

  'video_discovery.started': {
    currentOffset: number
    batchSize: number
    maxVideos: number
  }
  'video_discovery.batch_persisted': {
    discovered: number
    batchSize: number
    batchDurationMs: number
  }
  'video_discovery.completed': {
    discovered: number
    durationMs: number
  }

  // ─── Video Crawl ───────────────────────────────────────────────────────
  // worker.ts: handler start
  // submit.ts: batch done, completed

  'video_crawl.started': {
    items: number
  }
  'video_crawl.video_crawled': {
    videoId: number
    title: string
    durationMs: number
  }
  'video_crawl.error': { url: string; error: string }
  'video_crawl.batch_done': {
    crawled: number
    errors: number
    remaining: number
    batchSize: number
    batchSuccesses: number
    batchErrors: number
    batchDurationMs: number
  }
  'video_crawl.completed': {
    crawled: number
    errors: number
    durationMs: number
  }

  // ─── Stage Lifecycle (shared by video-processing & product-aggregation) ──
  // worker.ts: emitted by stage dispatchers around each stage execution

  'stage.started': {
    pipeline: string  // 'video-processing' | 'product-aggregation'
    stage: string     // e.g. 'download', 'resolve', 'classify'
    item: string      // human-readable identifier (video title or GTINs)
  }
  'stage.completed': {
    pipeline: string
    stage: string
    item: string
    durationMs: number
    tokens: number
  }
  'stage.failed': {
    pipeline: string
    stage: string
    item: string
    durationMs: number
    error: string
  }

  // ─── Video Processing ─────────────────────────────────────────────────
  // worker.ts: handler start, per-video pipeline steps
  // submit.ts: persist failed, error, batch done, completed
  // persist.ts: segment persisted

  'video_processing.started': {
    videos: number
    stages: string
  }
  'video_processing.downloaded': { title: string; sizeMB: number }
  'video_processing.scene_detected': {
    title: string
    sceneChanges: number
    segments: number
  }
  'video_processing.barcode_found': {
    title: string
    segment: number
    barcode: string
  }
  'video_processing.clustered': {
    title: string
    segment: number
    clusters: number
  }
  'video_processing.object_detection_detail': {
    title: string
    sceneId: number
    frameId: number
    imageWidth: number
    imageHeight: number
    rawDetections: number
    keptDetections: number
    skippedSmall: number
    skippedInvalid: number
    topScore: number
    scores: string
  }
  'video_processing.objects_detected': {
    title: string
    scenes: number
    detections: number
    candidatesProcessed: number
    candidatesWithDetections: number
  }
  'video_processing.ocr_extracted': {
    title: string
    scenes: number
    cropsProcessed: number
    cropsWithText: number
    tokens: number
  }
  'video_processing.visual_search_detail': {
    title: string
    sceneId: number
    frameId: number
    detectionIndex: number
    embeddingComputed: boolean
    resultsReturned: number
    bestDistance: number
    bestGtin: string
    matched: boolean
    matchedProductId: number
    topDistances: string
  }
  'video_processing.visual_search_complete': {
    title: string
    searched: number
    matched: number
    productsFound: number
    embeddingsFailed: number
    avgBestDistance: number
  }
  'video_processing.warning': { title: string; warning: string }
  'video_processing.transcribed': { title: string; scenes: number; charCount: number }
  'video_processing.transcript_corrected': {
    title: string
    fixes: number
    tokens: number
  }
  'video_processing.sentiment_analyzed': { title: string; tokens: number }
  'video_processing.transcription_failed': { title: string; error: string }
  'video_processing.complete': {
    title: string
    stage: string
    tokens: number
  }
  'video_processing.failed': { title: string; stage?: string; error: string }
  'video_processing.persist_failed': { videoId: string; error: string }
  'video_processing.error': { videoId: string; stage?: string; error: string }
  'video_processing.segment_persisted': { message: string }
  'video_processing.batch_done': {
    completed: number
    errors: number
    batchSize: number
    batchDurationMs: number
  }
  'video_processing.completed': {
    completed: number
    errors: number
    tokensUsed: number
    durationMs: number
    failedVideos: number
  }

  // ─── Product Aggregation ───────────────────────────────────────────────
  // worker.ts: handler start
  // submit.ts: error, persist error/failed, warning, batch done, completed
  // persist.ts: brand matched, ingredients matched, image uploaded, classification

  'aggregation.started': {
    items: number
    type: string
    language: string
  }
  'aggregation.resolved': {
    productId: number
    gtins: number
    variants: number
  }
  'aggregation.classified': {
    productId: number
    productType: string
    attributes: number
    claims: number
  }
  'aggregation.error': { error: string }
  'aggregation.persist_error': { gtin: string; error: string }
  'aggregation.persist_failed': { gtin: string; error: string }
  'aggregation.warning': { gtin: string; warning: string }
  'aggregation.brand_matched': { brandName: string; brandId: number; method?: string }
  'aggregation.ingredients_matched': {
    matched: number
    unmatched: number
    total: number
  }
  'aggregation.image_uploaded': {
    gtin: string
    total: number
    public: number
    recognitionOnly: number
    failed: number
  }
  'aggregation.name_cleaned': {
    rawName: string
    variantLabels: number
    cacheHit: boolean
  }
  'aggregation.classification_applied': {
    productType: string
    attributeCount: number
    claimCount: number
  }
  'aggregation.objects_detected': {
    gtin: string
    images: number
    detections: number
    scores: string
  }
  'aggregation.images_embedded': {
    gtin: string
    embedded: number
    skipped: number
  }
  'aggregation.batch_done': {
    aggregated: number
    errors: number
    batchSize: number
    batchDurationMs: number
  }
  'aggregation.completed': {
    aggregated: number
    errors: number
    tokensUsed: number
    durationMs: number
    failedProducts: number
  }

  // ─── Brand Matching ────────────────────────────────────────────────────
  // match-brand.ts

  'brand.exact_match': { brand: string; brandId: number }
  'brand.auto_match': { brand: string; matched: string; brandId: number }
  'brand.llm_selected': { brand: string; matched: string; brandId: number }
  'brand.llm_parse_failed': { brand: string }
  'brand.recheck_found': { brand: string; brandId: number }
  'brand.created': { brand: string; brandId: number }

  // ─── Ingredient Matching ───────────────────────────────────────────────
  // match-ingredients.ts

  'ingredients.exact_match_summary': { exactMatches: number; total: number }
  'ingredients.all_exact_matched': { matched: number }
  'ingredients.llm_selection_failed': { ambiguousCount: number }
  'ingredients.matched': { matched: number; unmatched: number }

  // ─── Product Matching ──────────────────────────────────────────────────
  // match-product.ts

  'product_match.brand_matched': {
    brand: string
    matched: string
    brandId: number
  }
  'product_match.candidates_found': { count: number; product: string }
  'product_match.no_match': { product: string }
  'product_match.auto_match': {
    product: string
    matched: string
    productId: number
  }
  'product_match.llm_selected': {
    product: string
    matched: string
    productId: number
  }
  'product_match.no_match_after_llm': { product: string }

  // ─── Label Deduplication ─────────────────────────────────────────────
  // deduplicate-labels.ts

  'labels.deduplicated': {
    inputCount: number
    outputCount: number
    cacheHit: boolean
  }

  // ─── Description Consensus ────────────────────────────────────────────
  // consensus-description.ts

  'description.consensus': {
    inputCount: number
    uniqueCount: number
    cacheHit: boolean
  }

  // ─── Classification ────────────────────────────────────────────────────
  // classify-product.ts

  'classification.invalid_product_type': { productType: string }
  'classification.complete': {
    productType: string
    attributes: number
    claims: number
  }

  // ─── Worker Maintenance ────────────────────────────────────────────────
  // worker.ts: periodic event purge

  'worker.events_purged': { deleted: number; retentionDays: number; durationMs: number }
}

// ─── EVENT_META ──────────────────────────────────────────────────────────────

/**
 * Default metadata for each event name — type (start/success/info/warning/error),
 * level (info/warn/error), and optional labels for filtering.
 *
 * The logger uses this as defaults; callers can override via the `opts` parameter.
 */
export const EVENT_META: Record<EventName, EventMeta> = {
  // Job lifecycle
  'job.claimed': { type: 'start', level: 'info' },
  'job.completed': { type: 'success', level: 'info' },
  'job.completed_empty': { type: 'success', level: 'info' },
  'job.failed': { type: 'error', level: 'error', labels: ['job-failure'] },
  'job.failed_max_retries': {
    type: 'error',
    level: 'error',
    labels: ['job-failure', 'max-retries'],
  },
  'job.retrying': {
    type: 'warning',
    level: 'warn',
    labels: ['job-retry'],
  },
  'job.rescheduled': {
    type: 'info',
    level: 'info',
    labels: ['scheduling'],
  },

  // Crawl
  'crawl.started': { type: 'start', level: 'info', labels: ['scraping'] },
  'crawl.driver_missing': {
    type: 'error',
    level: 'error',
    labels: ['scraping'],
  },
  'crawl.batch_done': { type: 'info', level: 'info', labels: ['scraping'] },
  'crawl.completed': {
    type: 'success',
    level: 'info',
    labels: ['scraping'],
  },

  // Scraper
  'scraper.started': { type: 'info', level: 'info', labels: ['scraping'] },
  'scraper.product_scraped': {
    type: 'info',
    level: 'info',
    labels: ['scraping'],
  },
  'scraper.failed': { type: 'error', level: 'error', labels: ['scraping'] },
  'scraper.warning': {
    type: 'warning',
    level: 'warn',
    labels: ['scraping'],
  },
  'scraper.bot_check_detected': {
    type: 'warning',
    level: 'warn',
    labels: ['scraping', 'bot-check'],
  },
  'scraper.bot_check_cleared': {
    type: 'info',
    level: 'info',
    labels: ['scraping', 'bot-check'],
  },
  'scraper.bot_check_timeout': {
    type: 'error',
    level: 'error',
    labels: ['scraping', 'bot-check'],
  },

  // Persist
  'persist.variants_processed': {
    type: 'info',
    level: 'info',
    labels: ['scraping', 'variants'],
  },
  'persist.variants_disappeared': {
    type: 'info',
    level: 'info',
    labels: ['scraping', 'variants'],
  },
  'persist.price_changed': {
    type: 'info',
    level: 'info',
    labels: ['scraping', 'price'],
  },
  'persist.ingredients_found': {
    type: 'info',
    level: 'info',
    labels: ['scraping', 'ingredients'],
  },
  'persist.crawl_warning': { type: 'warning', level: 'warn' },
  'persist.source_brand_created': {
    type: 'info',
    level: 'info',
    labels: ['scraping', 'source-brand'],
  },
  'persist.source_brand_exists': {
    type: 'info',
    level: 'debug',
    labels: ['scraping', 'source-brand'],
  },
  'persist.reviews_created': {
    type: 'info',
    level: 'info',
    labels: ['scraping', 'reviews'],
  },

  // Discovery
  'discovery.started': {
    type: 'start',
    level: 'info',
    labels: ['discovery'],
  },
  'discovery.page_scraped': {
    type: 'info',
    level: 'info',
    labels: ['discovery'],
  },
  'discovery.batch_persisted': {
    type: 'info',
    level: 'info',
    labels: ['discovery'],
  },
  'discovery.completed': {
    type: 'success',
    level: 'info',
    labels: ['discovery'],
  },

  // Search
  'search.started': { type: 'start', level: 'info', labels: ['search'] },
  'search.source_complete': {
    type: 'info',
    level: 'info',
    labels: ['search'],
  },
  'search.batch_persisted': {
    type: 'info',
    level: 'info',
    labels: ['search'],
  },
  'search.completed': {
    type: 'success',
    level: 'info',
    labels: ['search'],
  },

  // Ingredients discovery
  'ingredients_discovery.started': {
    type: 'start',
    level: 'info',
    labels: ['discovery'],
  },
  'ingredients_discovery.batch_persisted': {
    type: 'info',
    level: 'info',
    labels: ['discovery'],
  },
  'ingredients_discovery.completed': {
    type: 'success',
    level: 'info',
    labels: ['discovery'],
  },

  // Ingredient crawl
  'ingredient_crawl.started': {
    type: 'start',
    level: 'info',
    labels: ['ingredients'],
  },
  'ingredient_crawl.not_found': {
    type: 'info',
    level: 'info',
    labels: ['ingredients'],
  },
  'ingredient_crawl.no_description': {
    type: 'info',
    level: 'info',
    labels: ['ingredients'],
  },
  'ingredient_crawl.error': {
    type: 'error',
    level: 'error',
    labels: ['ingredients'],
  },
  'ingredient_crawl.persist_failed': {
    type: 'error',
    level: 'error',
    labels: ['ingredients'],
  },
  'ingredient_crawl.batch_done': {
    type: 'info',
    level: 'info',
    labels: ['ingredients'],
  },
  'ingredient_crawl.completed': {
    type: 'success',
    level: 'info',
    labels: ['ingredients'],
  },

  // Video discovery
  'video_discovery.started': {
    type: 'start',
    level: 'info',
    labels: ['discovery'],
  },
  'video_discovery.batch_persisted': {
    type: 'info',
    level: 'info',
    labels: ['discovery'],
  },
  'video_discovery.completed': {
    type: 'success',
    level: 'info',
    labels: ['discovery'],
  },

  // Video crawl
  'video_crawl.started': {
    type: 'start',
    level: 'info',
    labels: ['video-crawl'],
  },
  'video_crawl.video_crawled': {
    type: 'info',
    level: 'info',
    labels: ['video-crawl'],
  },
  'video_crawl.error': {
    type: 'error',
    level: 'error',
    labels: ['video-crawl'],
  },
  'video_crawl.batch_done': {
    type: 'info',
    level: 'info',
    labels: ['video-crawl'],
  },
  'video_crawl.completed': {
    type: 'success',
    level: 'info',
    labels: ['video-crawl'],
  },

  // Stage lifecycle (shared by video-processing & product-aggregation)
  'stage.started': {
    type: 'start',
    level: 'info',
    labels: ['stage'],
  },
  'stage.completed': {
    type: 'success',
    level: 'info',
    labels: ['stage'],
  },
  'stage.failed': {
    type: 'error',
    level: 'error',
    labels: ['stage'],
  },

  // Video processing
  'video_processing.started': {
    type: 'start',
    level: 'info',
    labels: ['video'],
  },
  'video_processing.downloaded': {
    type: 'info',
    level: 'info',
    labels: ['video-processing'],
  },
  'video_processing.scene_detected': {
    type: 'info',
    level: 'info',
    labels: ['video-processing', 'scene-detection'],
  },
  'video_processing.barcode_found': {
    type: 'info',
    level: 'info',
    labels: ['video-processing', 'barcode'],
  },
  'video_processing.clustered': {
    type: 'info',
    level: 'info',
    labels: ['video-processing'],
  },
  'video_processing.object_detection_detail': {
    type: 'info',
    level: 'debug',
    labels: ['video-processing', 'object-detection'],
  },
  'video_processing.objects_detected': {
    type: 'info',
    level: 'info',
    labels: ['video-processing', 'object-detection'],
  },
  'video_processing.ocr_extracted': {
    type: 'info',
    level: 'info',
    labels: ['video-processing', 'ocr'],
  },
  'video_processing.visual_search_detail': {
    type: 'info',
    level: 'debug',
    labels: ['video-processing', 'embedding'],
  },
  'video_processing.visual_search_complete': {
    type: 'info',
    level: 'info',
    labels: ['video-processing', 'embedding'],
  },
  'video_processing.warning': {
    type: 'warning',
    level: 'warn',
    labels: ['video-processing'],
  },
  'video_processing.transcribed': {
    type: 'info',
    level: 'info',
    labels: ['video-processing', 'transcription'],
  },
  'video_processing.transcript_corrected': {
    type: 'info',
    level: 'info',
    labels: ['video-processing', 'transcription'],
  },
  'video_processing.sentiment_analyzed': {
    type: 'info',
    level: 'info',
    labels: ['video-processing', 'sentiment'],
  },
  'video_processing.transcription_failed': {
    type: 'error',
    level: 'error',
    labels: ['video-processing', 'transcription'],
  },
  'video_processing.complete': {
    type: 'info',
    level: 'info',
    labels: ['video-processing'],
  },
  'video_processing.failed': {
    type: 'error',
    level: 'error',
    labels: ['video-processing'],
  },
  'video_processing.persist_failed': {
    type: 'error',
    level: 'error',
    labels: ['video-processing'],
  },
  'video_processing.error': {
    type: 'error',
    level: 'error',
    labels: ['video-processing'],
  },
  'video_processing.segment_persisted': {
    type: 'info',
    level: 'info',
    labels: ['video-processing'],
  },
  'video_processing.batch_done': {
    type: 'info',
    level: 'info',
    labels: ['video'],
  },
  'video_processing.completed': {
    type: 'success',
    level: 'info',
    labels: ['video'],
  },

  // Aggregation
  'aggregation.started': {
    type: 'start',
    level: 'info',
    labels: ['aggregation'],
  },
  'aggregation.resolved': {
    type: 'info',
    level: 'info',
    labels: ['aggregation', 'persistence'],
  },
  'aggregation.classified': {
    type: 'info',
    level: 'info',
    labels: ['aggregation', 'classification'],
  },
  'aggregation.error': { type: 'error', level: 'error' },
  'aggregation.persist_error': { type: 'error', level: 'error' },
  'aggregation.persist_failed': { type: 'error', level: 'error' },
  'aggregation.warning': { type: 'warning', level: 'warn' },
  'aggregation.brand_matched': {
    type: 'info',
    level: 'info',
    labels: ['brand-matching', 'persistence'],
  },
  'aggregation.ingredients_matched': {
    type: 'info',
    level: 'info',
    labels: ['ingredient-matching', 'persistence'],
  },
  'aggregation.image_uploaded': {
    type: 'info',
    level: 'info',
    labels: ['image', 'persistence'],
  },
  'aggregation.name_cleaned': {
    type: 'info',
    level: 'info',
    labels: ['aggregation', 'llm'],
  },
  'aggregation.classification_applied': {
    type: 'info',
    level: 'info',
    labels: ['classification', 'persistence'],
  },
  'aggregation.objects_detected': {
    type: 'info',
    level: 'info',
    labels: ['aggregation', 'object-detection'],
  },
  'aggregation.images_embedded': {
    type: 'info',
    level: 'info',
    labels: ['aggregation', 'embedding'],
  },
  'aggregation.batch_done': {
    type: 'info',
    level: 'info',
    labels: ['aggregation'],
  },
  'aggregation.completed': {
    type: 'success',
    level: 'info',
    labels: ['aggregation'],
  },

  // Brand matching
  'brand.exact_match': {
    type: 'info',
    level: 'info',
    labels: ['brand-matching'],
  },
  'brand.auto_match': {
    type: 'info',
    level: 'info',
    labels: ['brand-matching'],
  },
  'brand.llm_selected': {
    type: 'info',
    level: 'info',
    labels: ['brand-matching', 'llm'],
  },
  'brand.llm_parse_failed': {
    type: 'warning',
    level: 'warn',
    labels: ['brand-matching', 'llm'],
  },
  'brand.recheck_found': {
    type: 'info',
    level: 'info',
    labels: ['brand-matching'],
  },
  'brand.created': {
    type: 'info',
    level: 'info',
    labels: ['brand-matching'],
  },

  // Ingredient matching
  'ingredients.exact_match_summary': {
    type: 'info',
    level: 'info',
    labels: ['ingredient-matching'],
  },
  'ingredients.all_exact_matched': {
    type: 'info',
    level: 'info',
    labels: ['ingredient-matching'],
  },
  'ingredients.llm_selection_failed': {
    type: 'warning',
    level: 'warn',
    labels: ['ingredient-matching', 'llm'],
  },
  'ingredients.matched': {
    type: 'info',
    level: 'info',
    labels: ['ingredient-matching'],
  },

  // Product matching
  'product_match.brand_matched': {
    type: 'info',
    level: 'info',
    labels: ['product-matching', 'brand-matching'],
  },
  'product_match.candidates_found': {
    type: 'info',
    level: 'info',
    labels: ['product-matching'],
  },
  'product_match.no_match': {
    type: 'warning',
    level: 'warn',
    labels: ['product-matching'],
  },
  'product_match.auto_match': {
    type: 'info',
    level: 'info',
    labels: ['product-matching'],
  },
  'product_match.llm_selected': {
    type: 'info',
    level: 'info',
    labels: ['product-matching', 'llm'],
  },
  'product_match.no_match_after_llm': {
    type: 'warning',
    level: 'warn',
    labels: ['product-matching', 'llm'],
  },

  // Label deduplication
  'labels.deduplicated': {
    type: 'info',
    level: 'info',
    labels: ['aggregation', 'llm'],
  },

  // Description consensus
  'description.consensus': {
    type: 'info',
    level: 'info',
    labels: ['aggregation', 'llm'],
  },

  // Classification
  'classification.invalid_product_type': {
    type: 'warning',
    level: 'warn',
    labels: ['classification', 'llm'],
  },
  'classification.complete': {
    type: 'info',
    level: 'info',
    labels: ['classification'],
  },

  // Worker maintenance
  'worker.events_purged': {
    type: 'info',
    level: 'info',
    labels: ['maintenance'],
  },
}

// ─── Event Grouping ─────────────────────────────────────────────────────────

/** Human-readable group labels for event name prefixes. Many-to-one: aggregation sub-domains collapse into 'Aggregation'. */
export const EVENT_GROUP_LABELS: Record<string, string> = {
  job: 'Job Lifecycle',
  crawl: 'Crawl',
  scraper: 'Scraper',
  persist: 'Persist',
  discovery: 'Discovery',
  search: 'Search',
  ingredients_discovery: 'Ingredients Discovery',
  ingredient_crawl: 'Ingredient Crawl',
  video_discovery: 'Video Discovery',
  video_crawl: 'Video Crawl',
  video_processing: 'Video Processing',
  aggregation: 'Aggregation',
  worker: 'Worker',
  // Sub-domains collapsed into Aggregation
  brand: 'Aggregation',
  ingredients: 'Aggregation',
  product_match: 'Aggregation',
  classification: 'Aggregation',
  labels: 'Aggregation',
  description: 'Aggregation',
  stage: 'Aggregation',
}

/** Derive a human-readable group label from an event name (prefix before the first dot). */
export function eventGroup(name?: string | null): string {
  if (!name) return 'Other'
  const prefix = name.split('.')[0]
  return EVENT_GROUP_LABELS[prefix] ?? 'Other'
}
