import type { PayloadHandler } from 'payload'
import { sql } from 'drizzle-orm'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SnapshotResponse {
  generatedAt: string

  /** Entity counts — current state of the database */
  entities: {
    products: number
    productVariants: number
    sourceProducts: number
    sourceVariants: number
    uniqueGtins: number
    brands: number
    ingredients: number
    videos: number
    creators: number
    channels: number
    mediaFiles: number
  }

  /** Product data quality — completeness of unified product records */
  productQuality: {
    total: number
    withImage: number
    withBrand: number
    withProductType: number
    withIngredients: number
    withDescription: number
    withScoreHistory: number
  }

  /** Source coverage per store — crawl matrix */
  sourceCoverage: Array<{
    source: string
    total: number
    withVariants: number
    withGtin: number
    variants: number
    avgRating: number | null
    avgRatingCount: number | null
  }>

  /** Video pipeline stats */
  videoPipeline: {
    total: number
    crawled: number
    processed: number
    unprocessed: number
    withTranscript: number
    totalScenes: number
    totalMentions: number
    mentionsByPositive: number
    mentionsByNeutral: number
    mentionsByNegative: number
    mentionsByMixed: number
    productsWithMentions: number
    channelsByPlatform: Array<{ platform: string; count: number }>
  }

  /** Job queue status — live snapshot of all job collections */
  jobQueue: Array<{
    collection: string
    pending: number
    inProgress: number
    completed: number
    failed: number
    active: number
    stale: number
  }>

  /** Active workers */
  workers: Array<{
    id: number
    name: string
    status: string
    lastSeenAt: string | null
    capabilities: string[]
  }>
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const dashboardSnapshotHandler: PayloadHandler = async (req) => {
  if (!req.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = req.payload.db.drizzle
  const staleThreshold = new Date(Date.now() - 30 * 60 * 1000).toISOString() // 30 minutes

  // Run all queries in parallel
  const [
    entityRows,
    productQualityRows,
    sourceCoverageRows,
    sourceGtinRows,
    sourceVariantCountRows,
    videoPipelineRows,
    sceneRows,
    mentionRows,
    channelPlatformRows,
    jobQueueRows,
    workerRows,
  ] = await Promise.all([
    // 1. Entity counts
    db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM products) AS products,
        (SELECT count(*)::int FROM product_variants) AS "productVariants",
        (SELECT count(*)::int FROM source_products) AS "sourceProducts",
        (SELECT count(*)::int FROM source_variants) AS "sourceVariants",
        (SELECT count(DISTINCT gtin)::int FROM source_variants WHERE gtin IS NOT NULL) AS "uniqueGtins",
        (SELECT count(*)::int FROM brands) AS brands,
        (SELECT count(*)::int FROM ingredients) AS ingredients,
        (SELECT count(*)::int FROM videos) AS videos,
        (SELECT count(*)::int FROM creators) AS creators,
        (SELECT count(*)::int FROM channels) AS channels,
        (
          (SELECT count(*) FROM product_media) +
          (SELECT count(*) FROM video_media) +
          (SELECT count(*) FROM profile_media) +
          (SELECT count(*) FROM detection_media)
        )::int AS "mediaFiles"
    `),

    // 2. Product data quality
    // Note: products has no `image` column — images live in the `products_images` sub-table
    db.execute(sql`
      SELECT
        count(*)::int AS total,
        (SELECT count(DISTINCT _parent_id)::int FROM products_images) AS "withImage",
        count(*) FILTER (WHERE brand_id IS NOT NULL)::int AS "withBrand",
        count(*) FILTER (WHERE product_type_id IS NOT NULL)::int AS "withProductType",
        (SELECT count(DISTINCT _parent_id)::int FROM products_ingredients) AS "withIngredients",
        count(*) FILTER (WHERE description IS NOT NULL AND description != '')::int AS "withDescription",
        (SELECT count(DISTINCT _parent_id)::int FROM products_score_history) AS "withScoreHistory"
      FROM products
    `),

    // 3. Source coverage per store (source-products level)
    // "withVariants" = source-products that have at least one source-variant (i.e. have been crawled)
    db.execute(sql`
      SELECT
        sp.source,
        count(*)::int AS total,
        count(*) FILTER (WHERE sv.id IS NOT NULL)::int AS "withVariants",
        round(avg(sp.rating)::numeric, 2) AS "avgRating",
        round(avg(sp.rating_num)::numeric, 0) AS "avgRatingCount"
      FROM source_products sp
      LEFT JOIN LATERAL (
        SELECT id FROM source_variants WHERE source_product_id = sp.id LIMIT 1
      ) sv ON true
      GROUP BY sp.source
      ORDER BY total DESC
    `),

    // 4. Source GTIN coverage (source-variants with GTIN, grouped by parent's store)
    db.execute(sql`
      SELECT
        sp.source,
        count(*) FILTER (WHERE sv.gtin IS NOT NULL)::int AS "withGtin"
      FROM source_variants sv
      INNER JOIN source_products sp ON sv.source_product_id = sp.id
      GROUP BY sp.source
    `),

    // 5. Source variant counts
    db.execute(sql`
      SELECT
        sp.source,
        count(*)::int AS variants
      FROM source_variants sv
      INNER JOIN source_products sp ON sv.source_product_id = sp.id
      GROUP BY sp.source
    `),

    // 6. Video pipeline stats (uses status field: discovered → crawled → processed)
    db.execute(sql`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE status = 'crawled')::int AS crawled,
        count(*) FILTER (WHERE status = 'processed')::int AS processed,
        count(*) FILTER (WHERE status != 'processed')::int AS unprocessed,
        (SELECT count(DISTINCT vs.video_id)::int FROM video_scenes vs WHERE vs.transcript IS NOT NULL AND vs.transcript != '') AS "withTranscript"
      FROM videos
    `),

    // 7. Video scenes count
    db.execute(sql`
      SELECT count(*)::int AS total
      FROM video_scenes
    `),

    // 8. Video mentions by sentiment
    db.execute(sql`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE overall_sentiment = 'positive')::int AS positive,
        count(*) FILTER (WHERE overall_sentiment = 'neutral')::int AS neutral,
        count(*) FILTER (WHERE overall_sentiment = 'negative')::int AS negative,
        count(*) FILTER (WHERE overall_sentiment = 'mixed')::int AS mixed,
        count(DISTINCT product_id)::int AS "productsWithMentions"
      FROM video_mentions
    `),

    // 9. Channels by platform
    db.execute(sql`
      SELECT platform, count(*)::int AS count
      FROM channels
      GROUP BY platform
      ORDER BY count DESC
    `),

    // 10. Job queue status — union across all 8 job collections
    db.execute(sql`
      SELECT collection, status, count(*)::int AS cnt,
        count(*) FILTER (
          WHERE status = 'in_progress'
            AND claimed_by_id IS NOT NULL
            AND claimed_at IS NOT NULL
            AND claimed_at::timestamptz >= ${staleThreshold}::timestamptz
        )::int AS active,
        count(*) FILTER (
          WHERE status = 'in_progress'
            AND claimed_at IS NOT NULL
            AND claimed_at::timestamptz < ${staleThreshold}::timestamptz
        )::int AS stale
      FROM (
        SELECT 'product-crawls' AS collection, status::text, claimed_by_id, claimed_at FROM product_crawls
        UNION ALL
        SELECT 'product-discoveries', status::text, claimed_by_id, claimed_at FROM product_discoveries
        UNION ALL
        SELECT 'product-searches', status::text, claimed_by_id, claimed_at FROM product_searches
        UNION ALL
        SELECT 'product-aggregations', status::text, claimed_by_id, claimed_at FROM product_aggregations
        UNION ALL
        SELECT 'ingredients-discoveries', status::text, claimed_by_id, claimed_at FROM ingredients_discoveries
        UNION ALL
        SELECT 'ingredient-crawls', status::text, claimed_by_id, claimed_at FROM ingredient_crawls
        UNION ALL
        SELECT 'video-crawls', status::text, claimed_by_id, claimed_at FROM video_crawls
        UNION ALL
        SELECT 'video-discoveries', status::text, claimed_by_id, claimed_at FROM video_discoveries
        UNION ALL
        SELECT 'video-processings', status::text, claimed_by_id, claimed_at FROM video_processings
      ) jobs
      GROUP BY collection, status
      ORDER BY collection
    `),

    // 11. Workers
    db.execute(sql`
      SELECT id, name, status, last_seen_at AS "lastSeenAt"
      FROM workers
      ORDER BY last_seen_at DESC NULLS LAST
    `),
  ])

  // ---------------------------------------------------------------------------
  // Shape the response
  // ---------------------------------------------------------------------------

  const entities = entityRows.rows[0] as Record<string, number>
  const quality = productQualityRows.rows[0] as Record<string, number>
  const videoStats = videoPipelineRows.rows[0] as Record<string, number>
  const sceneStats = sceneRows.rows[0] as Record<string, number>
  const mentionStats = mentionRows.rows[0] as Record<string, number>

  // Merge source coverage data from 3 queries
  const gtinBySource = new Map<string, number>()
  for (const row of sourceGtinRows.rows as Array<Record<string, unknown>>) {
    gtinBySource.set(String(row.source), Number(row.withGtin ?? 0))
  }
  const variantsBySource = new Map<string, number>()
  for (const row of sourceVariantCountRows.rows as Array<Record<string, unknown>>) {
    variantsBySource.set(String(row.source), Number(row.variants ?? 0))
  }

  // Merge job queue rows into per-collection objects
  const jobMap = new Map<string, { pending: number; inProgress: number; completed: number; failed: number; active: number; stale: number }>()
  for (const row of jobQueueRows.rows as Array<Record<string, unknown>>) {
    const collection = String(row.collection)
    const status = String(row.status)
    const cnt = Number(row.cnt ?? 0)
    const active = Number(row.active ?? 0)
    const stale = Number(row.stale ?? 0)

    if (!jobMap.has(collection)) {
      jobMap.set(collection, { pending: 0, inProgress: 0, completed: 0, failed: 0, active: 0, stale: 0 })
    }
    const entry = jobMap.get(collection)!
    if (status === 'pending') entry.pending = cnt
    else if (status === 'in_progress') entry.inProgress = cnt
    else if (status === 'completed') entry.completed = cnt
    else if (status === 'failed') entry.failed = cnt
    entry.active += active
    entry.stale += stale
  }

  // Fetch worker capabilities from the DB — the workers table stores capabilities
  // as a hasMany select, which Payload stores in a separate workers_capabilities table.
  // We'll query it separately and merge.
  const capRows = await db.execute(sql`
    SELECT parent_id, value AS capability
    FROM workers_capabilities
  `)
  const capsByWorker = new Map<number, string[]>()
  for (const row of capRows.rows as Array<Record<string, unknown>>) {
    const parentId = Number(row.parent_id)
    if (!capsByWorker.has(parentId)) capsByWorker.set(parentId, [])
    capsByWorker.get(parentId)!.push(String(row.capability))
  }

  const response: SnapshotResponse = {
    generatedAt: new Date().toISOString(),

    entities: {
      products: Number(entities.products ?? 0),
      productVariants: Number(entities.productVariants ?? 0),
      sourceProducts: Number(entities.sourceProducts ?? 0),
      sourceVariants: Number(entities.sourceVariants ?? 0),
      uniqueGtins: Number(entities.uniqueGtins ?? 0),
      brands: Number(entities.brands ?? 0),
      ingredients: Number(entities.ingredients ?? 0),
      videos: Number(entities.videos ?? 0),
      creators: Number(entities.creators ?? 0),
      channels: Number(entities.channels ?? 0),
      mediaFiles: Number(entities.mediaFiles ?? 0),
    },

    productQuality: {
      total: Number(quality.total ?? 0),
      withImage: Number(quality.withImage ?? 0),
      withBrand: Number(quality.withBrand ?? 0),
      withProductType: Number(quality.withProductType ?? 0),
      withIngredients: Number(quality.withIngredients ?? 0),
      withDescription: Number(quality.withDescription ?? 0),
      withScoreHistory: Number(quality.withScoreHistory ?? 0),
    },

    sourceCoverage: (sourceCoverageRows.rows as Array<Record<string, unknown>>).map((row) => ({
      source: String(row.source),
      total: Number(row.total ?? 0),
      withVariants: Number(row.withVariants ?? 0),
      withGtin: gtinBySource.get(String(row.source)) ?? 0,
      variants: variantsBySource.get(String(row.source)) ?? 0,
      avgRating: row.avgRating != null ? Number(row.avgRating) : null,
      avgRatingCount: row.avgRatingCount != null ? Number(row.avgRatingCount) : null,
    })),

    videoPipeline: {
      total: Number(videoStats.total ?? 0),
      crawled: Number(videoStats.crawled ?? 0),
      processed: Number(videoStats.processed ?? 0),
      unprocessed: Number(videoStats.unprocessed ?? 0),
      withTranscript: Number(videoStats.withTranscript ?? 0),
      totalScenes: Number(sceneStats.total ?? 0),
      totalMentions: Number(mentionStats.total ?? 0),
      mentionsByPositive: Number(mentionStats.positive ?? 0),
      mentionsByNeutral: Number(mentionStats.neutral ?? 0),
      mentionsByNegative: Number(mentionStats.negative ?? 0),
      mentionsByMixed: Number(mentionStats.mixed ?? 0),
      productsWithMentions: Number(mentionStats.productsWithMentions ?? 0),
      channelsByPlatform: (channelPlatformRows.rows as Array<Record<string, unknown>>).map((row) => ({
        platform: String(row.platform),
        count: Number(row.count ?? 0),
      })),
    },

    jobQueue: Array.from(jobMap.entries()).map(([collection, counts]) => ({
      collection,
      ...counts,
    })),

    workers: (workerRows.rows as Array<Record<string, unknown>>).map((row) => ({
      id: Number(row.id),
      name: String(row.name ?? ''),
      status: String(row.status ?? ''),
      lastSeenAt: row.lastSeenAt ? String(row.lastSeenAt) : null,
      capabilities: capsByWorker.get(Number(row.id)) ?? [],
    })),
  }

  return Response.json(response)
}
