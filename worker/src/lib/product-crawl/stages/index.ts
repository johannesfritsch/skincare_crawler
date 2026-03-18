/**
 * Stage-based product crawl pipeline.
 *
 * Two stages:
 *   0. scrape   — Existing three-phase crawl (new URLs → uncrawled products → uncrawled variants).
 *                 Calls driver.scrapeProduct() with skipReviews when reviews stage is enabled.
 *   1. reviews  — Fetch reviews from store review APIs (BazaarVoice/Yotpo) for each
 *                 source-product scraped in this job.
 *
 * Progress is tracked on the job's `crawlProgress` JSON field — a map of
 * `{ [sourceProductId]: lastCompletedStageName }`.
 *
 * The scrape stage uses the existing three-phase work queue (phases 0/1/2).
 * The reviews stage reads the crawlProgress map to find products at stage 'scrape'.
 */

// ─── Types ───

/** The 2 crawl stage names */
export type CrawlStageName = 'scrape' | 'reviews'

/**
 * Per-source-product progress map stored on the job's `crawlProgress` JSON field.
 * Keys are source-product ID strings, values are the last completed stage name
 * (or null / absent if no stage has completed for that product).
 * Error counts stored as `err:{sourceProductId}` → count string.
 */
export type CrawlProgress = Record<string, CrawlStageName | null>

/** Stage definition */
export interface CrawlStageDefinition {
  name: CrawlStageName
  /** Index in the pipeline (0-based) — determines ordering */
  index: number
  /** The checkbox field name on the ProductCrawls job */
  jobField: string
}

// ─── Stage Registry ───

/** All stages in pipeline order */
export const CRAWL_STAGES: CrawlStageDefinition[] = [
  {
    name: 'scrape',
    index: 0,
    jobField: 'stageScrape',
  },
  {
    name: 'reviews',
    index: 1,
    jobField: 'stageReviews',
  },
]

/** Map from stage name to its index for quick lookup */
const STAGE_INDEX: Record<CrawlStageName, number> = Object.fromEntries(
  CRAWL_STAGES.map((s) => [s.name, s.index]),
) as Record<CrawlStageName, number>

/**
 * Get the numeric index of a stage name. Returns -1 for null/undefined
 * (meaning no stage completed yet — before the first stage).
 */
export function stageIndex(name: CrawlStageName | null | undefined): number {
  if (name == null) return -1
  return STAGE_INDEX[name] ?? -1
}

// ─── Stage Dispatch Functions ───

/**
 * Determine which stage a source-product needs next, given the job's enabled stages
 * and the product's last completed stage (from the crawlProgress map).
 */
export function getNextCrawlStage(
  lastCompleted: CrawlStageName | null | undefined,
  enabledStages: Set<CrawlStageName>,
): CrawlStageDefinition | null {
  const currentIdx = stageIndex(lastCompleted)

  for (const stage of CRAWL_STAGES) {
    if (stage.index <= currentIdx) continue
    if (!enabledStages.has(stage.name)) continue
    return stage
  }

  return null
}

/**
 * Get the last enabled stage name for a job.
 */
export function getFinalCrawlStage(enabledStages: Set<CrawlStageName>): CrawlStageName | null {
  let last: CrawlStageName | null = null
  for (const stage of CRAWL_STAGES) {
    if (enabledStages.has(stage.name)) {
      last = stage.name
    }
  }
  return last
}

/**
 * Build the set of enabled stages from a job document.
 */
export function getEnabledCrawlStages(job: Record<string, unknown>): Set<CrawlStageName> {
  const stages = new Set<CrawlStageName>()
  if (job.stageScrape !== false) stages.add('scrape')
  if (job.stageReviews !== false) stages.add('reviews')
  return stages
}

/**
 * Check if a source-product needs any more work for this job's enabled stages.
 * Returns false if the product has been marked as permanently failed.
 */
export function productNeedsCrawlWork(
  lastCompleted: CrawlStageName | null | undefined,
  enabledStages: Set<CrawlStageName>,
): boolean {
  if (lastCompleted === '!failed' as CrawlStageName) return false
  return getNextCrawlStage(lastCompleted, enabledStages) !== null
}

/** Sentinel value stored in progress when a product has permanently failed */
export const PRODUCT_FAILED_SENTINEL = '!failed'

/**
 * Get the per-product error count from the progress map.
 */
export function getProductErrorCount(progress: CrawlProgress, sourceProductId: number): number {
  const key = `err:${sourceProductId}`
  const val = progress[key]
  return typeof val === 'string' ? parseInt(val, 10) || 0 : 0
}

/**
 * Increment the per-product error count in the progress map.
 */
export function incrementProductErrorCount(progress: CrawlProgress, sourceProductId: number): number {
  const key = `err:${sourceProductId}`
  const current = getProductErrorCount(progress, sourceProductId)
  const next = current + 1
  progress[key] = String(next) as CrawlStageName
  return next
}

/**
 * Mark a product as permanently failed in the progress map.
 */
export function markProductFailed(progress: CrawlProgress, sourceProductId: number): void {
  progress[String(sourceProductId)] = PRODUCT_FAILED_SENTINEL as CrawlStageName
}

/**
 * Read the crawlProgress map from a job document.
 * Handles both parsed objects (from local API) and JSON strings (from REST API).
 */
export function getCrawlProgress(job: Record<string, unknown>): CrawlProgress {
  let raw = job.crawlProgress
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    } catch {
      return {}
    }
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as CrawlProgress
  }
  return {}
}
