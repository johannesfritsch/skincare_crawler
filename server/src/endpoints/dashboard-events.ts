import type { PayloadHandler } from 'payload'
import { sql } from 'drizzle-orm'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const VALID_RANGES = ['1h', '24h', '7d', '30d'] as const
type Range = (typeof VALID_RANGES)[number]

export interface DashboardResponse {
  range: Range
  since: string
  generatedAt: string

  summary: {
    totalEvents: number
    errors: number
    warnings: number
    jobsStarted: number
    jobsCompleted: number
    jobsFailed: number
  }

  timeline: Array<{
    bucket: string
    total: number
    errors: number
    warnings: number
  }>

  byDomain: Array<{
    domain: string
    total: number
    errors: number
    warnings: number
  }>

  bySource: Array<{
    source: string
    total: number
    errors: number
  }>

  byJobCollection: Array<{
    collection: string
    started: number
    completed: number
    failed: number
    retrying: number
  }>

  recentErrors: Array<{
    id: number
    name: string | null
    message: string
    data: Record<string, unknown> | null
    jobCollection: string | null
    jobId: number | null
    createdAt: string
  }>

  highlights: {
    productsCrawled: number
    productsDiscovered: number
    productsAggregated: number
    productsSearched: number
    ingredientsCrawled: number
    ingredientsDiscovered: number
    videosCrawled: number
    videosProcessed: number
    videosDiscovered: number
    priceChanges: number
    priceDrops: number
    priceIncreases: number
    variantsDisappeared: number
    botChecks: number
    tokensUsed: number
    avgBatchDurationMs: number | null
  }

  ingredientStats: {
    total: number
    crawled: number
    uncrawled: number
    sourceGroups: Array<{
      sourceCount: number
      ingredients: number
    }>
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCutoff(range: Range): Date {
  const now = Date.now()
  switch (range) {
    case '1h':
      return new Date(now - 60 * 60 * 1000)
    case '24h':
      return new Date(now - 24 * 60 * 60 * 1000)
    case '7d':
      return new Date(now - 7 * 24 * 60 * 60 * 1000)
    case '30d':
      return new Date(now - 30 * 24 * 60 * 60 * 1000)
  }
}

/**
 * Returns a raw SQL expression for bucketing timestamps.
 * date_trunc only accepts standard units (minute, hour, day) and the unit must be
 * a SQL literal (not a parameterized value). For 5-minute buckets we truncate to
 * the epoch, round down to 300s intervals, and convert back.
 */
function getBucketExpr(range: Range): string {
  switch (range) {
    case '1h':
      // 5-minute buckets: floor epoch to nearest 300s
      return `to_timestamp(floor(extract(epoch from created_at) / 300) * 300)::text`
    case '24h':
      return `date_trunc('hour', created_at)::text`
    case '7d':
    case '30d':
      return `date_trunc('day', created_at)::text`
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const dashboardEventsHandler: PayloadHandler = async (req) => {
  // Auth: require an authenticated admin user
  if (!req.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Parse range parameter
  const url = new URL(req.url || '', 'http://localhost')
  const rangeParam = url.searchParams.get('range') ?? '1h'
  const range: Range = VALID_RANGES.includes(rangeParam as Range)
    ? (rangeParam as Range)
    : '1h'

  const cutoff = getCutoff(range)
  const cutoffISO = cutoff.toISOString()
  const bucketExpr = getBucketExpr(range)

  const db = req.payload.db.drizzle

  // Run all queries in parallel
  const [summaryRows, timelineRows, domainRows, sourceRows, jobCollectionRows, errorRows, highlightRows, ingredientStatsRows, ingredientSourceGroupRows] =
    await Promise.all([
      // 1. Summary
      // Note: job completion events are domain-specific (crawl.completed, search.completed, etc.)
      // not job.completed. job.completed_empty is emitted for jobs that finish with no work.
      // job.claimed is the universal "started" event. job.failed/job.failed_max_retries are universal failures.
      db.execute(sql`
        SELECT
          count(*)::int AS "totalEvents",
          count(*) FILTER (WHERE type = 'error')::int AS errors,
          count(*) FILTER (WHERE type = 'warning')::int AS warnings,
          count(*) FILTER (WHERE name = 'job.claimed')::int AS "jobsStarted",
          count(*) FILTER (WHERE name LIKE '%.completed' OR name = 'job.completed_empty')::int AS "jobsCompleted",
          count(*) FILTER (WHERE name IN ('job.failed', 'job.failed_max_retries'))::int AS "jobsFailed"
        FROM events
        WHERE created_at >= ${cutoffISO}::timestamptz
      `),

      // 2. Timeline (bucket expression is inlined via sql.raw since date_trunc needs a literal unit)
      db.execute(sql`
        SELECT
          ${sql.raw(bucketExpr)} AS bucket,
          count(*)::int AS total,
          count(*) FILTER (WHERE type = 'error')::int AS errors,
          count(*) FILTER (WHERE type = 'warning')::int AS warnings
        FROM events
        WHERE created_at >= ${cutoffISO}::timestamptz
        GROUP BY 1
        ORDER BY 1
      `),

      // 3. By domain (split event name on '.')
      db.execute(sql`
        SELECT
          split_part(name, '.', 1) AS domain,
          count(*)::int AS total,
          count(*) FILTER (WHERE type = 'error')::int AS errors,
          count(*) FILTER (WHERE type = 'warning')::int AS warnings
        FROM events
        WHERE name IS NOT NULL AND created_at >= ${cutoffISO}::timestamptz
        GROUP BY 1
        ORDER BY total DESC
      `),

      // 4. By source (from JSON data field)
      db.execute(sql`
        SELECT
          data->>'source' AS source,
          count(*)::int AS total,
          count(*) FILTER (WHERE type = 'error')::int AS errors
        FROM events
        WHERE data->>'source' IS NOT NULL AND created_at >= ${cutoffISO}::timestamptz
        GROUP BY 1
        ORDER BY total DESC
      `),

      // 5. By job collection (from polymorphic job relationship via events_rels join table)
      // Payload stores polymorphic relationships in events_rels with path='job' and one FK column per target collection.
      // Legacy events may have rels rows with unknown FK patterns — filter those out via WHERE collection IS NOT NULL.
      db.execute(sql`
        SELECT
          collection,
          count(*) FILTER (WHERE e.name = 'job.claimed')::int AS started,
          count(*) FILTER (WHERE e.name LIKE '%.completed' OR e.name = 'job.completed_empty')::int AS completed,
          count(*) FILTER (WHERE e.name IN ('job.failed', 'job.failed_max_retries'))::int AS failed,
          count(*) FILTER (WHERE e.name = 'job.retrying')::int AS retrying
        FROM events e
        INNER JOIN (
          SELECT parent_id,
            CASE
              WHEN product_crawls_id IS NOT NULL THEN 'product-crawls'
              WHEN product_discoveries_id IS NOT NULL THEN 'product-discoveries'
              WHEN product_searches_id IS NOT NULL THEN 'product-searches'
              WHEN ingredients_discoveries_id IS NOT NULL THEN 'ingredients-discoveries'
              WHEN product_aggregations_id IS NOT NULL THEN 'product-aggregations'
              WHEN video_crawls_id IS NOT NULL THEN 'video-crawls'
              WHEN video_discoveries_id IS NOT NULL THEN 'video-discoveries'
              WHEN video_processings_id IS NOT NULL THEN 'video-processings'
              WHEN ingredient_crawls_id IS NOT NULL THEN 'ingredient-crawls'
            END AS collection,
            coalesce(product_crawls_id, product_discoveries_id, product_searches_id,
              ingredients_discoveries_id, product_aggregations_id, video_crawls_id,
              video_discoveries_id, video_processings_id, ingredient_crawls_id) AS job_id
          FROM events_rels
          WHERE path = 'job'
        ) r ON r.parent_id = e.id
        WHERE r.collection IS NOT NULL
          AND e.created_at >= ${cutoffISO}::timestamptz
          AND (e.name = 'job.claimed' OR e.name LIKE '%.completed' OR e.name = 'job.completed_empty'
               OR e.name IN ('job.failed', 'job.failed_max_retries', 'job.retrying'))
        GROUP BY collection
        ORDER BY started DESC
      `),

      // 6. Recent errors (last 10, with optional job info from events_rels)
      db.execute(sql`
        SELECT
          e.id,
          e.name,
          e.message,
          e.data,
          r.collection AS "jobCollection",
          r.job_id AS "jobId",
          e.created_at AS "createdAt"
        FROM events e
        LEFT JOIN (
          SELECT parent_id,
            CASE
              WHEN product_crawls_id IS NOT NULL THEN 'product-crawls'
              WHEN product_discoveries_id IS NOT NULL THEN 'product-discoveries'
              WHEN product_searches_id IS NOT NULL THEN 'product-searches'
              WHEN ingredients_discoveries_id IS NOT NULL THEN 'ingredients-discoveries'
              WHEN product_aggregations_id IS NOT NULL THEN 'product-aggregations'
              WHEN video_crawls_id IS NOT NULL THEN 'video-crawls'
              WHEN video_discoveries_id IS NOT NULL THEN 'video-discoveries'
              WHEN video_processings_id IS NOT NULL THEN 'video-processings'
              WHEN ingredient_crawls_id IS NOT NULL THEN 'ingredient-crawls'
            END AS collection,
            coalesce(product_crawls_id, product_discoveries_id, product_searches_id,
              ingredients_discoveries_id, product_aggregations_id, video_crawls_id,
              video_discoveries_id, video_processings_id, ingredient_crawls_id) AS job_id
          FROM events_rels
          WHERE path = 'job'
        ) r ON r.parent_id = e.id
        WHERE e.type = 'error' AND e.created_at >= ${cutoffISO}::timestamptz
        ORDER BY e.created_at DESC
        LIMIT 10
      `),

      // 7. Highlights (aggregated from specific event data)
      db.execute(sql`
        SELECT
          coalesce(sum((data->>'batchSuccesses')::int) FILTER (WHERE name = 'crawl.batch_done'), 0)::int AS "productsCrawled",
          coalesce(sum((data->>'batchPersisted')::int) FILTER (WHERE name = 'discovery.batch_persisted'), 0)::int AS "productsDiscovered",
          coalesce(sum((data->>'aggregated')::int) FILTER (WHERE name = 'aggregation.batch_done'), 0)::int AS "productsAggregated",
          coalesce(sum((data->>'persisted')::int) FILTER (WHERE name = 'search.batch_persisted'), 0)::int AS "productsSearched",
          coalesce(sum((data->>'crawled')::int) FILTER (WHERE name = 'ingredient_crawl.batch_done'), 0)::int AS "ingredientsCrawled",
          coalesce(sum((data->>'batchSize')::int) FILTER (WHERE name = 'ingredients_discovery.batch_persisted'), 0)::int AS "ingredientsDiscovered",
          coalesce(sum((data->>'batchSuccesses')::int) FILTER (WHERE name = 'video_crawl.batch_done'), 0)::int AS "videosCrawled",
          coalesce(sum((data->>'completed')::int) FILTER (WHERE name = 'video_processing.batch_done'), 0)::int AS "videosProcessed",
          coalesce(sum((data->>'batchSize')::int) FILTER (WHERE name = 'video_discovery.batch_persisted'), 0)::int AS "videosDiscovered",
          count(*) FILTER (WHERE name = 'persist.price_changed')::int AS "priceChanges",
          count(*) FILTER (WHERE name = 'persist.price_changed' AND data->>'change' = 'drop')::int AS "priceDrops",
          count(*) FILTER (WHERE name = 'persist.price_changed' AND data->>'change' = 'increase')::int AS "priceIncreases",
          coalesce(sum((data->>'markedUnavailable')::int) FILTER (WHERE name = 'persist.variants_disappeared'), 0)::int AS "variantsDisappeared",
          count(*) FILTER (WHERE name = 'scraper.bot_check_detected')::int AS "botChecks",
          coalesce(sum((data->>'tokensUsed')::int) FILTER (WHERE name IN (
            'crawl.completed', 'aggregation.completed', 'video_processing.completed', 'ingredient_crawl.completed'
          )), 0)::int AS "tokensUsed",
          round(avg((data->>'batchDurationMs')::numeric) FILTER (WHERE name LIKE '%.batch_done'), 0)::int AS "avgBatchDurationMs"
        FROM events
        WHERE created_at >= ${cutoffISO}::timestamptz
      `),

      // 8. Ingredient stats (snapshot, not time-scoped)
      // Total/crawled/uncrawled counts + source count distribution
      db.execute(sql`
        SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE status = 'crawled')::int AS crawled,
          count(*) FILTER (WHERE status = 'uncrawled')::int AS uncrawled
        FROM ingredients
      `),

      // 9. Ingredient source count groups
      db.execute(sql`
        SELECT source_count::int AS "sourceCount", count(*)::int AS ingredients
        FROM (
          SELECT i.id, coalesce(s.cnt, 0) AS source_count
          FROM ingredients i
          LEFT JOIN (
            SELECT _parent_id, count(*) AS cnt
            FROM ingredients_sources
            GROUP BY _parent_id
          ) s ON s._parent_id = i.id
        ) sub
        GROUP BY source_count
        ORDER BY source_count
      `),
    ])

  // ---------------------------------------------------------------------------
  // Shape the response
  // ---------------------------------------------------------------------------

  const summary = summaryRows.rows[0] as Record<string, number>
  const highlights = highlightRows.rows[0] as Record<string, number | null>
  const ingredientSummary = ingredientStatsRows.rows[0] as Record<string, number>

  const response: DashboardResponse = {
    range,
    since: cutoffISO,
    generatedAt: new Date().toISOString(),

    summary: {
      totalEvents: summary.totalEvents ?? 0,
      errors: summary.errors ?? 0,
      warnings: summary.warnings ?? 0,
      jobsStarted: summary.jobsStarted ?? 0,
      jobsCompleted: summary.jobsCompleted ?? 0,
      jobsFailed: summary.jobsFailed ?? 0,
    },

    timeline: (timelineRows.rows as Array<Record<string, unknown>>).map((row) => ({
      bucket: String(row.bucket),
      total: Number(row.total ?? 0),
      errors: Number(row.errors ?? 0),
      warnings: Number(row.warnings ?? 0),
    })),

    byDomain: (domainRows.rows as Array<Record<string, unknown>>).map((row) => ({
      domain: String(row.domain),
      total: Number(row.total ?? 0),
      errors: Number(row.errors ?? 0),
      warnings: Number(row.warnings ?? 0),
    })),

    bySource: (sourceRows.rows as Array<Record<string, unknown>>).map((row) => ({
      source: String(row.source),
      total: Number(row.total ?? 0),
      errors: Number(row.errors ?? 0),
    })),

    byJobCollection: (jobCollectionRows.rows as Array<Record<string, unknown>>).map((row) => ({
      collection: String(row.collection),
      started: Number(row.started ?? 0),
      completed: Number(row.completed ?? 0),
      failed: Number(row.failed ?? 0),
      retrying: Number(row.retrying ?? 0),
    })),

    recentErrors: (errorRows.rows as Array<Record<string, unknown>>).map((row) => ({
      id: Number(row.id),
      name: row.name ? String(row.name) : null,
      message: String(row.message ?? ''),
      data: (row.data as Record<string, unknown>) ?? null,
      jobCollection: row.jobCollection ? String(row.jobCollection) : null,
      jobId: row.jobId ? Number(row.jobId) : null,
      createdAt: String(row.createdAt ?? ''),
    })),

    highlights: {
      productsCrawled: Number(highlights.productsCrawled ?? 0),
      productsDiscovered: Number(highlights.productsDiscovered ?? 0),
      productsAggregated: Number(highlights.productsAggregated ?? 0),
      productsSearched: Number(highlights.productsSearched ?? 0),
      ingredientsCrawled: Number(highlights.ingredientsCrawled ?? 0),
      ingredientsDiscovered: Number(highlights.ingredientsDiscovered ?? 0),
      videosCrawled: Number(highlights.videosCrawled ?? 0),
      videosProcessed: Number(highlights.videosProcessed ?? 0),
      videosDiscovered: Number(highlights.videosDiscovered ?? 0),
      priceChanges: Number(highlights.priceChanges ?? 0),
      priceDrops: Number(highlights.priceDrops ?? 0),
      priceIncreases: Number(highlights.priceIncreases ?? 0),
      variantsDisappeared: Number(highlights.variantsDisappeared ?? 0),
      botChecks: Number(highlights.botChecks ?? 0),
      tokensUsed: Number(highlights.tokensUsed ?? 0),
      avgBatchDurationMs: highlights.avgBatchDurationMs != null ? Number(highlights.avgBatchDurationMs) : null,
    },

    ingredientStats: {
      total: Number(ingredientSummary.total ?? 0),
      crawled: Number(ingredientSummary.crawled ?? 0),
      uncrawled: Number(ingredientSummary.uncrawled ?? 0),
      sourceGroups: (ingredientSourceGroupRows.rows as Array<Record<string, unknown>>).map((row) => ({
        sourceCount: Number(row.sourceCount ?? 0),
        ingredients: Number(row.ingredients ?? 0),
      })),
    },
  }

  return Response.json(response)
}
