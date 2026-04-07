import type { Payload, PayloadHandler } from 'payload'
import { sql } from 'drizzle-orm'

// ---------------------------------------------------------------------------
// Job tables for scheduled activation
// ---------------------------------------------------------------------------

const JOB_TABLES = [
  'product_crawls',
  'product_discoveries',
  'product_searches',
  'ingredients_discoveries',
  'product_aggregations',
  'video_crawls',
  'video_discoveries',
  'video_processings',
  'ingredient_crawls',
] as const

// ---------------------------------------------------------------------------
// Stage Pipeline Definitions (server-side mirror of worker stage registries)
// ---------------------------------------------------------------------------

interface StageDef {
  name: string
  jobField: string // checkbox field on the job collection
}

/** Video processing: 8 stages in order */
const VIDEO_PROCESSING_STAGES: StageDef[] = [
  { name: 'scene_detection', jobField: 'stageSceneDetection' },
  { name: 'barcode_scan', jobField: 'stageBarcodeScan' },
  { name: 'object_detection', jobField: 'stageObjectDetection' },
  { name: 'visual_search', jobField: 'stageVisualSearch' },
  { name: 'ocr_extraction', jobField: 'stageOcrExtraction' },
  { name: 'transcription', jobField: 'stageTranscription' },
  { name: 'compile_detections', jobField: 'stageCompileDetections' },
  { name: 'sentiment_analysis', jobField: 'stageSentimentAnalysis' },
]

/** Product crawl: 2 stages — scrape then reviews */
const PRODUCT_CRAWL_STAGES: StageDef[] = [
  { name: 'scrape', jobField: 'stageScrape' },
  { name: 'reviews', jobField: 'stageReviews' },
]

/** Video crawl: 3 stages — metadata, download, audio */
const VIDEO_CRAWL_STAGES: StageDef[] = [
  { name: 'metadata', jobField: 'stageMetadata' },
  { name: 'download', jobField: 'stageDownload' },
  { name: 'audio', jobField: 'stageAudio' },
]

/** Product aggregation: 11 stages */
const PRODUCT_AGGREGATION_STAGES: StageDef[] = [
  { name: 'resolve', jobField: 'stageResolve' },
  { name: 'classify', jobField: 'stageClassify' },
  { name: 'match_brand', jobField: 'stageMatchBrand' },
  { name: 'ingredients', jobField: 'stageIngredients' },
  { name: 'images', jobField: 'stageImages' },
  { name: 'object_detection', jobField: 'stageObjectDetection' },
  { name: 'embed_images', jobField: 'stageEmbedImages' },
  { name: 'descriptions', jobField: 'stageDescriptions' },
  { name: 'score_history', jobField: 'stageScoreHistory' },
  { name: 'review_sentiment', jobField: 'stageReviewSentiment' },
  { name: 'sentiment_conclusion', jobField: 'stageSentimentConclusion' },
]

/** Ingredient crawl: 1 stage (always enabled) */
const INGREDIENT_CRAWL_STAGES: StageDef[] = [
  { name: 'crawl', jobField: '_always' },
]

/** All job types that use work items. Multi-stage pipelines have their stages listed.
 *  Single-stage ("execute") types run the whole job as one work item. */
const JOB_PIPELINES: Record<string, StageDef[]> = {
  // Multi-stage parallel pipelines
  'video-processings': VIDEO_PROCESSING_STAGES,
  'product-crawls': PRODUCT_CRAWL_STAGES,
  'video-crawls': VIDEO_CRAWL_STAGES,
  'product-aggregations': PRODUCT_AGGREGATION_STAGES,
  'ingredient-crawls': INGREDIENT_CRAWL_STAGES,
  // Single-stage (sequential) — one work item per job
  'product-discoveries': [{ name: 'execute', jobField: '_always' }],
  'product-searches': [{ name: 'execute', jobField: '_always' }],
  'ingredients-discoveries': [{ name: 'execute', jobField: '_always' }],
  'video-discoveries': [{ name: 'execute', jobField: '_always' }],
}

/** Get enabled stages for a job document */
function getEnabledStages(stages: StageDef[], job: Record<string, unknown>): string[] {
  return stages.filter(s => job[s.jobField] !== false).map(s => s.name)
}

/** Get the first enabled stage (for initial seeding) */
function getFirstEnabledStage(stages: StageDef[], job: Record<string, unknown>): string | null {
  for (const s of stages) {
    if (job[s.jobField] !== false) return s.name
  }
  return null
}

// ---------------------------------------------------------------------------
// Internal: Seed work items for a pending job
// ---------------------------------------------------------------------------

async function seedJobWorkItems(
  payload: Payload,
  db: any,
  collection: string,
  jobId: number,
): Promise<number> {
  const stages = JOB_PIPELINES[collection]
  if (!stages) return 0

  const job = await payload.findByID({ collection: collection as any, id: jobId, overrideAccess: true }) as unknown as Record<string, unknown>
  const maxRetries = (job.maxRetries as number) ?? 3
  const items: Array<{ itemKey: string; stageName: string }> = []

  if (collection === 'video-processings') {
    // Multi-stage: one work item per video at its first enabled stage
    const firstStage = getFirstEnabledStage(stages, job)
    if (!firstStage) return 0
    const videoIds = await resolveVideoIds(payload, job)
    for (const vid of videoIds) {
      items.push({ itemKey: String(vid), stageName: firstStage })
    }
  } else if (collection === 'product-crawls') {
    // Multi-stage: one work item per URL at its first enabled stage
    const firstStage = getFirstEnabledStage(stages, job)
    if (!firstStage) return 0
    const urls = await resolveProductCrawlUrls(payload, db, job)
    for (const url of urls) {
      items.push({ itemKey: url, stageName: firstStage })
    }
  } else if (collection === 'video-crawls') {
    // Multi-stage: one work item per video URL at its first enabled stage
    const firstStage = getFirstEnabledStage(stages, job)
    if (!firstStage) return 0
    const urls = await resolveVideoCrawlUrls(payload, db, job)
    for (const url of urls) {
      items.push({ itemKey: url, stageName: firstStage })
    }
  } else if (collection === 'product-aggregations') {
    // Multi-stage: one work item per GTIN group at its first enabled stage
    const firstStage = getFirstEnabledStage(stages, job)
    if (!firstStage) return 0
    const groups = await resolveAggregationGtinGroups(payload, db, job)
    for (const group of groups) {
      items.push({ itemKey: group, stageName: firstStage })
    }
  } else if (collection === 'ingredient-crawls') {
    // Multi-stage: one work item per ingredient at its first enabled stage
    const firstStage = getFirstEnabledStage(stages, job)
    if (!firstStage) return 0
    const ingredientIds = await resolveIngredientIds(db, job)
    for (const id of ingredientIds) {
      items.push({ itemKey: String(id), stageName: firstStage })
    }
  } else {
    // Single-stage: one work item for the entire job
    items.push({ itemKey: 'job', stageName: 'execute' })
  }

  if (items.length === 0) return 0

  // Seed work items (caller already deleted stale items if needed)
  const values = items.map(
    (item) => sql`(${collection}, ${jobId}, ${item.itemKey}, ${item.stageName}, 'pending', ${maxRetries})`,
  )

  let seeded = 0
  for (let i = 0; i < values.length; i += 500) {
    const chunk = values.slice(i, i + 500)
    const result = await db.execute(sql`
      INSERT INTO "work_items" ("job_collection", "job_id", "item_key", "stage_name", "status", "max_retries")
      VALUES ${sql.join(chunk, sql`, `)}
      ON CONFLICT ("job_collection", "job_id", "item_key", "stage_name") DO NOTHING
    `)
    seeded += (result as { rowCount?: number }).rowCount ?? 0
  }

  return seeded
}

/** Resolve video IDs for a video-processing job based on its type */
async function resolveVideoIds(payload: Payload, job: Record<string, unknown>): Promise<number[]> {
  const ids: number[] = []

  if (job.type === 'single_video' && job.video) {
    const videoId = typeof job.video === 'number' ? job.video : (job.video as { id: number }).id
    ids.push(videoId)
  } else if (job.type === 'selected_urls') {
    const urls = ((job.urls as string) ?? '').split('\n').map((u: string) => u.trim()).filter(Boolean)
    for (const url of urls) {
      const found = await payload.find({ collection: 'videos', where: { externalUrl: { equals: url } }, limit: 1, overrideAccess: true })
      if (found.docs.length > 0) ids.push((found.docs[0] as unknown as Record<string, unknown>).id as number)
    }
  } else if (job.type === 'from_crawl' && job.crawl) {
    const crawlId = typeof job.crawl === 'number' ? job.crawl : (job.crawl as Record<string, number>).id
    const crawlJob = await payload.findByID({ collection: 'video-crawls', id: crawlId, overrideAccess: true }) as unknown as Record<string, unknown>
    const crawlUrls = ((crawlJob.crawledVideoUrls as string) ?? '').split('\n').map((u: string) => u.trim()).filter(Boolean)
    for (const url of crawlUrls) {
      const found = await payload.find({ collection: 'videos', where: { externalUrl: { equals: url } }, limit: 1, overrideAccess: true })
      if (found.docs.length > 0) ids.push((found.docs[0] as unknown as Record<string, unknown>).id as number)
    }
  } else {
    // all_unprocessed — fetch all crawled videos
    let hasMore = true
    let page = 1
    while (hasMore) {
      const result = await payload.find({
        collection: 'videos',
        where: { status: { equals: 'crawled' } },
        limit: 100,
        page,
        sort: 'createdAt',
        overrideAccess: true,
      })
      for (const doc of result.docs) {
        ids.push((doc as unknown as Record<string, unknown>).id as number)
      }
      hasMore = result.hasNextPage ?? false
      page++
    }
  }

  return ids
}

/**
 * Resolve source URLs for a product-crawl job based on its type.
 * Returns an array of source URLs to seed as work items.
 */
async function resolveProductCrawlUrls(
  payload: Payload,
  db: any,
  job: Record<string, unknown>,
): Promise<string[]> {
  const urls: string[] = []
  const source = job.source as string
  const crawlVariants = job.crawlVariants !== false

  if (job.type === 'selected_urls') {
    const rawUrls = ((job.urls as string) ?? '').split('\n').map((u: string) => u.trim()).filter(Boolean)
    urls.push(...rawUrls)
  } else if (job.type === 'from_discovery' && job.discovery) {
    const discoveryId = typeof job.discovery === 'number' ? job.discovery : (job.discovery as Record<string, number>).id
    const discoveryJob = await payload.findByID({ collection: 'product-discoveries', id: discoveryId, overrideAccess: true }) as unknown as Record<string, unknown>
    const productUrls = ((discoveryJob.productUrls as string) ?? '').split('\n').map((u: string) => u.trim()).filter(Boolean)
    urls.push(...productUrls)
  } else if (job.type === 'from_search' && job.search) {
    const searchId = typeof job.search === 'number' ? job.search : (job.search as Record<string, number>).id
    const searchJob = await payload.findByID({ collection: 'product-searches', id: searchId, overrideAccess: true }) as unknown as Record<string, unknown>
    const productUrls = ((searchJob.productUrls as string) ?? '').split('\n').map((u: string) => u.trim()).filter(Boolean)
    urls.push(...productUrls)
  } else {
    // type: 'all' — query all source-products for the given source
    const scope = job.scope as string | undefined

    if (scope === 'uncrawled_only' || !scope) {
      // Find source-products that have uncrawled variants (or no variants at all)
      const result = await db.execute(sql`
        SELECT sp."source_url"
        FROM "source_products" sp
        WHERE sp."source" = ${source}
          AND (
            NOT EXISTS (
              SELECT 1 FROM "source_variants" sv
              WHERE sv."source_product_id" = sp."id"
            )
            OR EXISTS (
              SELECT 1 FROM "source_variants" sv
              WHERE sv."source_product_id" = sp."id"
                AND sv."crawled_at" IS NULL
            )
          )
        ORDER BY sp."id"
      `)
      for (const row of (result as { rows: Array<Record<string, unknown>> }).rows) {
        urls.push(row.source_url as string)
      }
    } else {
      // recrawl — all source-products for this source
      const result = await db.execute(sql`
        SELECT sp."source_url"
        FROM "source_products" sp
        WHERE sp."source" = ${source}
        ORDER BY sp."id"
      `)
      for (const row of (result as { rows: Array<Record<string, unknown>> }).rows) {
        urls.push(row.source_url as string)
      }
    }
  }

  // For recrawl or scoped jobs: reset crawledAt on matching source-variants
  const shouldReset = job.type === 'selected_urls' || job.type === 'from_discovery'
    || job.type === 'from_search' || job.scope === 'recrawl'
  if (shouldReset && urls.length > 0) {
    const urlList = urls.map(u => sql`${u}`)
    const minCrawlAge = job.minCrawlAge as number | undefined
    if (minCrawlAge && minCrawlAge > 0) {
      await db.execute(sql`
        UPDATE "source_variants" SET "crawled_at" = NULL
        WHERE "source_product_id" IN (
          SELECT "id" FROM "source_products" WHERE "source_url" IN (${sql.join(urlList, sql`, `)})
        )
        AND "crawled_at" < now() - interval '1 day' * ${minCrawlAge}
      `)
    } else {
      await db.execute(sql`
        UPDATE "source_variants" SET "crawled_at" = NULL
        WHERE "source_product_id" IN (
          SELECT "id" FROM "source_products" WHERE "source_url" IN (${sql.join(urlList, sql`, `)})
        )
      `)
    }
  }

  // If crawlVariants=true, also add known uncrawled variant URLs
  if (crawlVariants && urls.length > 0) {
    const urlList = urls.map(u => sql`${u}`)
    const variantResult = await db.execute(sql`
      SELECT sv."source_url"
      FROM "source_variants" sv
      INNER JOIN "source_products" sp ON sv."source_product_id" = sp."id"
      WHERE sp."source_url" IN (${sql.join(urlList, sql`, `)})
        AND sv."source_url" != sp."source_url"
        AND sv."crawled_at" IS NULL
      ORDER BY sv."id"
    `)
    const variantUrls = (variantResult as { rows: Array<Record<string, unknown>> }).rows
      .map((r: Record<string, unknown>) => r.source_url as string)
    // Deduplicate — variant URLs may overlap with product URLs
    const urlSet = new Set(urls)
    for (const vu of variantUrls) {
      if (!urlSet.has(vu)) {
        urls.push(vu)
        urlSet.add(vu)
      }
    }
  }

  return urls
}

/**
 * Resolve video external URLs for a video-crawl job based on its type.
 */
async function resolveVideoCrawlUrls(
  payload: Payload,
  db: any,
  job: Record<string, unknown>,
): Promise<string[]> {
  const urls: string[] = []

  if (job.type === 'selected_urls') {
    const rawUrls = ((job.urls as string) ?? '').split('\n').map((u: string) => u.trim()).filter(Boolean)
    urls.push(...rawUrls)
  } else if (job.type === 'from_discovery' && job.discovery) {
    const discoveryId = typeof job.discovery === 'number' ? job.discovery : (job.discovery as Record<string, number>).id
    const discoveryJob = await payload.findByID({ collection: 'video-discoveries', id: discoveryId, overrideAccess: true }) as unknown as Record<string, unknown>
    const videoUrls = ((discoveryJob.videoUrls as string) ?? '').split('\n').map((u: string) => u.trim()).filter(Boolean)
    urls.push(...videoUrls)
  } else {
    // type: 'all' — query videos
    const scope = job.scope as string | undefined
    const statusFilter = (scope === 'recrawl') ? sql`1=1` : sql`v."status" = 'discovered'`
    const result = await db.execute(sql`
      SELECT v."external_url"
      FROM "videos" v
      WHERE ${statusFilter}
        AND v."external_url" IS NOT NULL
      ORDER BY v."id"
    `)
    for (const row of (result as { rows: Array<Record<string, unknown>> }).rows) {
      urls.push(row.external_url as string)
    }
  }

  return urls
}

/**
 * Resolve GTIN groups for a product-aggregation job.
 * Returns an array of progress keys (sorted comma-separated GTIN lists).
 */
async function resolveAggregationGtinGroups(
  payload: Payload,
  db: any,
  job: Record<string, unknown>,
): Promise<string[]> {
  let rawGtins: string[] = []

  if (job.type === 'selected_gtins') {
    rawGtins = ((job.gtins as string) ?? '').split('\n').map((g: string) => g.trim()).filter(Boolean)
  } else {
    // type: 'all' — get all distinct GTINs from source-variants
    const result = await db.execute(sql`
      SELECT DISTINCT sv."gtin"
      FROM "source_variants" sv
      WHERE sv."gtin" IS NOT NULL AND sv."gtin" != ''
      ORDER BY sv."gtin"
    `)
    rawGtins = (result as { rows: Array<Record<string, unknown>> }).rows
      .map((r: Record<string, unknown>) => r.gtin as string)
  }

  if (rawGtins.length === 0) return []

  const includeSisterVariants = job.includeSisterVariants !== false

  if (!includeSisterVariants) {
    // Each GTIN is its own group
    return rawGtins.map(g => g)
  }

  // Sister variant expansion + union-find grouping (server-side)
  // 1. Expand: find all GTINs that share a source-product with any input GTIN
  const gtinList = rawGtins.map(g => sql`${g}`)
  const expandResult = await db.execute(sql`
    WITH input_gtins AS (
      SELECT unnest AS gtin FROM unnest(ARRAY[${sql.join(gtinList, sql`, `)}]::text[])
    ),
    shared_products AS (
      SELECT DISTINCT sv2."gtin"
      FROM "source_variants" sv1
      INNER JOIN "source_variants" sv2 ON sv1."source_product_id" = sv2."source_product_id"
      WHERE sv1."gtin" IN (SELECT gtin FROM input_gtins)
        AND sv2."gtin" IS NOT NULL AND sv2."gtin" != ''
    )
    SELECT gtin FROM shared_products
  `)
  const expandedGtins = (expandResult as { rows: Array<Record<string, unknown>> }).rows
    .map((r: Record<string, unknown>) => r.gtin as string)

  if (expandedGtins.length === 0) return rawGtins

  // 2. Get all (gtin, source_product_id) pairs for grouping
  const allGtinList = expandedGtins.map(g => sql`${g}`)
  const pairsResult = await db.execute(sql`
    SELECT sv."gtin", sv."source_product_id"
    FROM "source_variants" sv
    WHERE sv."gtin" IN (${sql.join(allGtinList, sql`, `)})
      AND sv."gtin" IS NOT NULL AND sv."gtin" != ''
  `)
  const pairs = (pairsResult as { rows: Array<Record<string, unknown>> }).rows

  // 3. Union-find grouping: GTINs sharing any source_product_id end up in the same group
  const parent = new Map<string, string>()
  function find(x: string): string {
    if (!parent.has(x)) parent.set(x, x)
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!))
    return parent.get(x)!
  }
  function union(a: string, b: string): void {
    const ra = find(a), rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }

  // Group by source_product_id — union all GTINs that share a source product
  const spToGtins = new Map<number, string[]>()
  for (const row of pairs) {
    const gtin = row.gtin as string
    const spId = row.source_product_id as number
    if (!spToGtins.has(spId)) spToGtins.set(spId, [])
    spToGtins.get(spId)!.push(gtin)
  }
  for (const gtins of spToGtins.values()) {
    for (let i = 1; i < gtins.length; i++) {
      union(gtins[0], gtins[i])
    }
  }

  // Collect groups
  const groups = new Map<string, Set<string>>()
  for (const gtin of expandedGtins) {
    const root = find(gtin)
    if (!groups.has(root)) groups.set(root, new Set())
    groups.get(root)!.add(gtin)
  }

  // Return sorted progress keys
  return [...groups.values()].map(group => [...group].sort().join(','))
}

/**
 * Resolve ingredient IDs for an ingredient-crawl job.
 */
async function resolveIngredientIds(
  db: any,
  job: Record<string, unknown>,
): Promise<number[]> {
  const ids: number[] = []

  if (job.type === 'selected') {
    // Selected ingredients — parse from job config
    // The job stores ingredient IDs; fetch them
    const result = await db.execute(sql`
      SELECT ic_rels."ingredients_id" as "id"
      FROM "ingredient_crawls_rels" ic_rels
      WHERE ic_rels."parent_id" = ${job.id as number}
        AND ic_rels."ingredients_id" IS NOT NULL
    `)
    for (const row of (result as { rows: Array<Record<string, unknown>> }).rows) {
      ids.push(row.id as number)
    }
  } else {
    // type: 'all_uncrawled' — ingredients without longDescription
    const result = await db.execute(sql`
      SELECT i."id"
      FROM "ingredients" i
      WHERE i."long_description" IS NULL OR i."long_description" = ''
      ORDER BY i."id"
    `)
    for (const row of (result as { rows: Array<Record<string, unknown>> }).rows) {
      ids.push(row.id as number)
    }
  }

  return ids
}

// ---------------------------------------------------------------------------
// Internal: Try to claim pending work items (shared SQL logic)
// ---------------------------------------------------------------------------

async function claimItems(
  db: any,
  workerId: number,
  limit: number,
  filter: { jobCollection?: string; jobId?: number; allowedCollections?: string[] },
): Promise<Array<Record<string, unknown>>> {
  let result
  if (filter.jobCollection && filter.jobId) {
    result = await db.execute(sql`
      WITH claimable AS (
        SELECT "id" FROM "work_items"
        WHERE "job_collection" = ${filter.jobCollection}
          AND "job_id" = ${filter.jobId}
          AND "status" = 'pending'
        ORDER BY "id"
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "work_items" SET
        "status" = 'claimed',
        "claimed_by" = ${workerId},
        "claimed_at" = now()
      WHERE "id" IN (SELECT "id" FROM claimable)
      RETURNING "id", "job_collection", "job_id", "item_key", "stage_name", "retry_count"
    `)
  } else if (filter.allowedCollections && filter.allowedCollections.length > 0) {
    const collectionList = filter.allowedCollections.map(c => sql`${c}`)
    result = await db.execute(sql`
      WITH claimable AS (
        SELECT "id" FROM "work_items"
        WHERE "job_collection" IN (${sql.join(collectionList, sql`, `)})
          AND "status" = 'pending'
        ORDER BY "id"
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "work_items" SET
        "status" = 'claimed',
        "claimed_by" = ${workerId},
        "claimed_at" = now()
      WHERE "id" IN (SELECT "id" FROM claimable)
      RETURNING "id", "job_collection", "job_id", "item_key", "stage_name", "retry_count"
    `)
  } else {
    result = await db.execute(sql`
      WITH claimable AS (
        SELECT "id" FROM "work_items"
        WHERE "status" = 'pending'
        ORDER BY "id"
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "work_items" SET
        "status" = 'claimed',
        "claimed_by" = ${workerId},
        "claimed_at" = now()
      WHERE "id" IN (SELECT "id" FROM claimable)
      RETURNING "id", "job_collection", "job_id", "item_key", "stage_name", "retry_count"
    `)
  }

  return (result as { rows?: Array<Record<string, unknown>> }).rows ?? []
}

// ---------------------------------------------------------------------------
// POST /api/work-items/seed  (kept for manual/explicit seeding)
// ---------------------------------------------------------------------------

export const workItemsSeedHandler: PayloadHandler = async (req) => {
  if (!req.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json!() as {
    jobCollection: string
    jobId: number
    items: Array<{ itemKey: string; stageName: string }>
    maxRetries?: number
  }

  const { jobCollection, jobId, items, maxRetries = 3 } = body
  if (!jobCollection || !jobId || !items?.length) {
    return Response.json({ error: 'Missing jobCollection, jobId, or items' }, { status: 400 })
  }

  const db = req.payload.db.drizzle

  const values = items.map(
    (item) => sql`(${jobCollection}, ${jobId}, ${item.itemKey}, ${item.stageName}, 'pending', ${maxRetries})`,
  )

  let seeded = 0
  for (let i = 0; i < values.length; i += 500) {
    const chunk = values.slice(i, i + 500)
    const result = await db.execute(sql`
      INSERT INTO "work_items" ("job_collection", "job_id", "item_key", "stage_name", "status", "max_retries")
      VALUES ${sql.join(chunk, sql`, `)}
      ON CONFLICT ("job_collection", "job_id", "item_key", "stage_name") DO NOTHING
    `)
    seeded += (result as { rowCount?: number }).rowCount ?? 0
  }

  return Response.json({ seeded })
}

// ---------------------------------------------------------------------------
// POST /api/work-items/claim
//
// Body: {
//   workerId: number,
//   allowedCollections?: string[],  // filter by worker capabilities
//   limit?: number,
//   timeoutMinutes?: number
// }
//
// 1. Reclaim stale items
// 2. Try to claim pending items
// 3. If none found: auto-seed pending jobs → try claim again
// 4. Return claimed items (or empty array)
//
// Workers just call this in a loop — seeding is fully transparent.
// ---------------------------------------------------------------------------

export const workItemsClaimHandler: PayloadHandler = async (req) => {
  if (!req.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json!() as {
    workerId: number
    allowedCollections?: string[]
    limit?: number
    timeoutMinutes?: number
  }

  const { workerId, allowedCollections, limit = 1, timeoutMinutes = 30 } = body
  if (!workerId) {
    return Response.json({ error: 'Missing workerId' }, { status: 400 })
  }

  const db = req.payload.db.drizzle

  // 0. Update worker lastSeenAt (replaces the separate PATCH /api/workers/:id call)
  await db.execute(sql`
    UPDATE "workers" SET "last_seen_at" = now() WHERE "id" = ${workerId}
  `)

  // 1. Activate scheduled jobs whose scheduledFor has passed → pending
  for (const table of JOB_TABLES) {
    await db.execute(sql`
      UPDATE "${sql.raw(table)}"
      SET "status" = 'pending', "scheduled_for" = NULL
      WHERE "status" = 'scheduled'
        AND "scheduled_for" IS NOT NULL
        AND "scheduled_for" <= now()
    `)
  }

  // 2. Reclaim stale items (worker crashed mid-processing)
  await db.execute(sql`
    UPDATE "work_items" SET
      "status" = 'pending',
      "claimed_by" = NULL,
      "claimed_at" = NULL
    WHERE "status" = 'claimed'
      AND "claimed_at" < now() - interval '1 minute' * ${timeoutMinutes}
  `)

  // 3. Try to claim pending items
  const filter = { allowedCollections }
  let items = await claimItems(db, workerId, limit, filter)

  if (items.length > 0) {
    return Response.json({ items })
  }

  // 4. No pending items — check for pending jobs to auto-seed
  const collectionsToCheck = allowedCollections ?? Object.keys(JOB_PIPELINES)
  const parallelCollections = collectionsToCheck.filter(c => JOB_PIPELINES[c])

  for (const collection of parallelCollections) {
    const pendingJobs = await req.payload.find({
      collection: collection as any,
      where: { status: { equals: 'pending' } },
      limit: 5,
      sort: 'createdAt',
      overrideAccess: true,
    })

    for (const doc of pendingJobs.docs) {
      const job = doc as unknown as Record<string, unknown>
      const jobId = job.id as number

      // Job is pending — delete stale work items from any previous run
      await db.execute(sql`
        DELETE FROM "work_items"
        WHERE "job_collection" = ${collection} AND "job_id" = ${jobId}
      `)

      const stages = JOB_PIPELINES[collection]
      const isMultiStage = stages && stages.length > 1

      if (isMultiStage) {
        // Multi-stage jobs: server handles initialization
        try {
          const initData: Record<string, unknown> = {
            status: 'in_progress',
            startedAt: new Date().toISOString(),
            errors: 0,
          }
          // Per-collection counter fields
          if (collection === 'product-crawls') {
            initData.crawled = 0
            initData.crawledGtins = ''
          } else if (collection === 'video-crawls') {
            initData.crawled = 0
            initData.crawledVideoUrls = ''
          } else if (collection === 'product-aggregations') {
            initData.aggregated = 0
            initData.tokensUsed = 0
          } else if (collection === 'ingredient-crawls') {
            initData.crawled = 0
            initData.tokensUsed = 0
          } else {
            initData.completed = 0
            initData.tokensUsed = 0
          }
          await req.payload.update({
            collection: collection as any,
            id: jobId,
            data: initData,
            overrideAccess: true,
          })
        } catch {
          continue // another worker/request already initialized it
        }
      }
      // Single-stage ("execute") jobs: leave status as pending so the worker's
      // buildXxxWork() can run its full initialization (e.g. resetProducts,
      // clear crawlProgress, count totals). The worker sets in_progress itself.

      // Seed work items
      const seeded = await seedJobWorkItems(req.payload, db, collection, jobId)

      // Set total from seeded count for multi-stage jobs
      if (isMultiStage && seeded > 0) {
        const tableName = collection.replace(/-/g, '_')
        await db.execute(sql`
          UPDATE "${sql.raw(tableName)}" SET "total" = ${seeded}
          WHERE "id" = ${jobId}
        `)
      }
    }
  }

  // 4. Try claiming again after seeding
  items = await claimItems(db, workerId, limit, filter)

  return Response.json({ items })
}

// ---------------------------------------------------------------------------
// POST /api/work-items/complete
//
// Body: {
//   workItemId: number,
//   success: boolean,
//   error?: string,
//   resultData?: Record<string, unknown>,
//   nextStageName?: string | null,
//   counterUpdates?: Record<string, number>
// }
// ---------------------------------------------------------------------------

export const workItemsCompleteHandler: PayloadHandler = async (req) => {
  if (!req.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json!() as {
    workItemId: number
    success: boolean
    error?: string
    resultData?: Record<string, unknown>
    nextStageName?: string | null
    counterUpdates?: Record<string, number>
    spawnItems?: Array<{ itemKey: string; stageName: string }>
    totalDelta?: number
  }

  const { workItemId, success, error, resultData, nextStageName, counterUpdates, spawnItems, totalDelta } = body
  if (!workItemId) {
    return Response.json({ error: 'Missing workItemId' }, { status: 400 })
  }

  const db = req.payload.db.drizzle

  // 1. Fetch the work item
  const itemResult = await db.execute(sql`
    SELECT "id", "job_collection", "job_id", "item_key", "stage_name", "retry_count", "max_retries"
    FROM "work_items"
    WHERE "id" = ${workItemId}
  `)
  const item = ((itemResult as { rows?: Array<Record<string, unknown>> }).rows ?? [])[0]
  if (!item) {
    return Response.json({ error: 'Work item not found' }, { status: 404 })
  }

  const jobCollection = item.job_collection as string
  const jobId = item.job_id as number
  const itemKey = item.item_key as string

  if (success) {
    // Mark completed
    await db.execute(sql`
      UPDATE "work_items" SET
        "status" = 'completed',
        "completed_at" = now(),
        "result_data" = ${resultData ? JSON.stringify(resultData) : null}::jsonb
      WHERE "id" = ${workItemId}
    `)

    // Insert next stage if provided
    if (nextStageName) {
      await db.execute(sql`
        INSERT INTO "work_items" ("job_collection", "job_id", "item_key", "stage_name", "status", "max_retries")
        VALUES (${jobCollection}, ${jobId}, ${itemKey}, ${nextStageName}, 'pending', ${item.max_retries})
        ON CONFLICT ("job_collection", "job_id", "item_key", "stage_name") DO NOTHING
      `)
    }

    // Spawn additional work items (e.g. variant URLs discovered during scraping)
    if (spawnItems && spawnItems.length > 0) {
      const spawnValues = spawnItems.map(
        (si) => sql`(${jobCollection}, ${jobId}, ${si.itemKey}, ${si.stageName}, 'pending', ${item.max_retries})`,
      )
      for (let i = 0; i < spawnValues.length; i += 500) {
        const chunk = spawnValues.slice(i, i + 500)
        await db.execute(sql`
          INSERT INTO "work_items" ("job_collection", "job_id", "item_key", "stage_name", "status", "max_retries")
          VALUES ${sql.join(chunk, sql`, `)}
          ON CONFLICT ("job_collection", "job_id", "item_key", "stage_name") DO NOTHING
        `)
      }
    }
  } else {
    // Handle failure
    const retryCount = (item.retry_count as number) + 1
    const maxRetries = item.max_retries as number

    if (retryCount >= maxRetries) {
      await db.execute(sql`
        UPDATE "work_items" SET
          "status" = 'failed',
          "error" = ${error ?? 'Unknown error'},
          "retry_count" = ${retryCount}
        WHERE "id" = ${workItemId}
      `)
    } else {
      await db.execute(sql`
        UPDATE "work_items" SET
          "status" = 'pending',
          "claimed_by" = NULL,
          "claimed_at" = NULL,
          "error" = ${error ?? 'Unknown error'},
          "retry_count" = ${retryCount}
        WHERE "id" = ${workItemId}
      `)
    }
  }

  // Update job counters atomically
  const allCounterUpdates = { ...counterUpdates }
  if (totalDelta && totalDelta > 0) {
    allCounterUpdates.total = (allCounterUpdates.total ?? 0) + totalDelta
  }

  if (Object.keys(allCounterUpdates).length > 0) {
    const setClauses = Object.entries(allCounterUpdates).map(([col, inc]) => {
      const snakeCol = col.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)
      return sql`"${sql.raw(snakeCol)}" = COALESCE("${sql.raw(snakeCol)}", 0) + ${inc}`
    })

    if (setClauses.length > 0) {
      const tableName = jobCollection.replace(/-/g, '_')
      await db.execute(sql`
        UPDATE "${sql.raw(tableName)}" SET ${sql.join(setClauses, sql`, `)}
        WHERE "id" = ${jobId}
      `)
    }
  }

  // Check if all items for this job are terminal
  const remainingResult = await db.execute(sql`
    SELECT COUNT(*) as "remaining"
    FROM "work_items"
    WHERE "job_collection" = ${jobCollection}
      AND "job_id" = ${jobId}
      AND "status" NOT IN ('completed', 'failed')
  `)
  const remaining = Number(((remainingResult as { rows?: Array<Record<string, unknown>> }).rows ?? [])[0]?.remaining ?? 1)

  let jobDone = false
  if (remaining === 0) {
    const failedResult = await db.execute(sql`
      SELECT COUNT(*) as "cnt" FROM "work_items"
      WHERE "job_collection" = ${jobCollection} AND "job_id" = ${jobId} AND "status" = 'failed'
    `)
    const failedCount = Number(((failedResult as { rows?: Array<Record<string, unknown>> }).rows ?? [])[0]?.cnt ?? 0)

    const completedResult = await db.execute(sql`
      SELECT COUNT(*) as "cnt" FROM "work_items"
      WHERE "job_collection" = ${jobCollection} AND "job_id" = ${jobId} AND "status" = 'completed'
    `)
    const completedCount = Number(((completedResult as { rows?: Array<Record<string, unknown>> }).rows ?? [])[0]?.cnt ?? 0)

    const tableName = jobCollection.replace(/-/g, '_')

    if (completedCount === 0 && failedCount > 0) {
      await db.execute(sql`
        UPDATE "${sql.raw(tableName)}" SET
          "status" = 'failed',
          "claimed_by_id" = NULL, "claimed_at" = NULL
        WHERE "id" = ${jobId} AND "status" = 'in_progress'
      `)
    } else {
      await db.execute(sql`
        UPDATE "${sql.raw(tableName)}" SET
          "status" = 'completed', "completed_at" = now(),
          "claimed_by_id" = NULL, "claimed_at" = NULL
        WHERE "id" = ${jobId} AND "status" = 'in_progress'
      `)
    }
    jobDone = true
  }

  return Response.json({ done: jobDone, remaining })
}

// ---------------------------------------------------------------------------
// POST /api/work-items/heartbeat
// ---------------------------------------------------------------------------

export const workItemsHeartbeatHandler: PayloadHandler = async (req) => {
  if (!req.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json!() as { workItemIds: number[] }
  const { workItemIds } = body

  if (!workItemIds?.length) {
    return Response.json({ updated: 0 })
  }

  const db = req.payload.db.drizzle
  const workerId = (req.user as { id: number }).id

  const pgArray = `{${workItemIds.filter(Number.isFinite).join(',')}}`
  const result = await db.execute(sql`
    UPDATE "work_items" SET "claimed_at" = now()
    WHERE "id" = ANY(${pgArray}::int[])
      AND "claimed_by" = ${workerId}
      AND "status" = 'claimed'
  `)

  return Response.json({ updated: (result as { rowCount?: number }).rowCount ?? 0 })
}
