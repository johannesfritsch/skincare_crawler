/**
 * Integration test for the per-URL work-items system for product-crawls.
 *
 * Tests the full lifecycle:
 *   1. Seeding: pending job → work items created per URL
 *   2. Claiming: SELECT FOR UPDATE SKIP LOCKED distributes items
 *   3. Completing: stage advancement via nextStageName
 *   4. Spawning: variant URLs added as new work items via spawnItems
 *   5. Job completion: all items terminal → job marked completed
 *
 * Uses real Payload instance + PostgreSQL. Cleans up test data after each test.
 */

import { getPayload, type Payload } from 'payload'
import config from '@/payload.config'
import { sql } from 'drizzle-orm'
import { describe, it, beforeAll, afterEach, expect } from 'vitest'

let payload: Payload
let db: any

// Track IDs for cleanup
const createdJobIds: number[] = []
const createdSourceProductIds: number[] = []
const createdWorkerIds: number[] = []

describe('Work Items — Product Crawl Lifecycle', () => {
  beforeAll(async () => {
    const payloadConfig = await config
    payload = await getPayload({ config: payloadConfig })
    db = payload.db.drizzle
  })

  afterEach(async () => {
    // Clean up work items for test jobs
    for (const jobId of createdJobIds) {
      await db.execute(sql`
        DELETE FROM "work_items"
        WHERE "job_collection" = 'product-crawls' AND "job_id" = ${jobId}
      `)
    }

    // Clean up test jobs
    for (const jobId of createdJobIds) {
      await payload.delete({ collection: 'product-crawls' as any, id: jobId, overrideAccess: true }).catch(() => {})
    }

    // Clean up test source products and their variants
    for (const spId of createdSourceProductIds) {
      await payload.delete({
        collection: 'source-variants' as any,
        where: { sourceProduct: { equals: spId } },
        overrideAccess: true,
      }).catch(() => {})
      await payload.delete({ collection: 'source-products' as any, id: spId, overrideAccess: true }).catch(() => {})
    }

    // Clean up test workers
    for (const wId of createdWorkerIds) {
      await payload.delete({ collection: 'workers' as any, id: wId, overrideAccess: true }).catch(() => {})
    }

    createdJobIds.length = 0
    createdSourceProductIds.length = 0
    createdWorkerIds.length = 0
  })

  // ─── Helpers ───

  async function createTestWorker(name: string): Promise<number> {
    const w = await payload.create({
      collection: 'workers',
      data: { name, status: 'active', enableAPIKey: true, capabilities: ['product-crawl'] } as any,
      overrideAccess: true,
    })
    createdWorkerIds.push(w.id as number)
    return w.id as number
  }

  async function createTestSourceProduct(sourceUrl: string, source = 'dm'): Promise<number> {
    const sp = await payload.create({
      collection: 'source-products',
      data: { sourceUrl, source, name: 'Test Product' } as any,
      overrideAccess: true,
    })
    createdSourceProductIds.push(sp.id as number)
    return sp.id as number
  }

  async function createTestJob(urls: string[], opts: Record<string, unknown> = {}): Promise<number> {
    const job = await payload.create({
      collection: 'product-crawls',
      data: {
        type: 'selected_urls',
        source: 'dm',
        urls: urls.join('\n'),
        stageScrape: true,
        stageReviews: true,
        crawlVariants: true,
        status: 'pending',
        ...opts,
      } as any,
      overrideAccess: true,
    })
    createdJobIds.push(job.id as number)
    return job.id as number
  }

  async function getWorkItems(jobId: number): Promise<Array<Record<string, unknown>>> {
    const result = await db.execute(sql`
      SELECT "id", "item_key", "stage_name", "status", "claimed_by", "retry_count"
      FROM "work_items"
      WHERE "job_collection" = 'product-crawls' AND "job_id" = ${jobId}
      ORDER BY "id"
    `)
    return (result as { rows: Array<Record<string, unknown>> }).rows
  }


  async function insertWorkItems(
    jobId: number,
    items: Array<{ itemKey: string; stageName: string }>,
    maxRetries = 3,
  ): Promise<void> {
    if (items.length === 0) return
    const values = items.map(
      (item) => sql`('product-crawls', ${jobId}, ${item.itemKey}, ${item.stageName}, 'pending', ${maxRetries})`,
    )
    await db.execute(sql`
      INSERT INTO "work_items" ("job_collection", "job_id", "item_key", "stage_name", "status", "max_retries")
      VALUES ${sql.join(values, sql`, `)}
      ON CONFLICT ("job_collection", "job_id", "item_key", "stage_name") DO NOTHING
    `)
  }

  async function claimWorkItems(workerId: number, limit = 1, jobId?: number): Promise<Array<Record<string, unknown>>> {
    const jobFilter = jobId != null ? sql`AND "job_id" = ${jobId}` : sql``
    const result = await db.execute(sql`
      WITH claimable AS (
        SELECT "id" FROM "work_items"
        WHERE "job_collection" = 'product-crawls'
          AND "status" = 'pending'
          ${jobFilter}
        ORDER BY "id"
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "work_items" SET
        "status" = 'claimed',
        "claimed_by" = ${workerId},
        "claimed_at" = now()
      WHERE "id" IN (SELECT "id" FROM claimable)
      RETURNING "id", "item_key", "stage_name", "status", "claimed_by"
    `)
    return (result as { rows: Array<Record<string, unknown>> }).rows
  }

  async function completeWorkItem(
    workItemId: number,
    opts: {
      success: boolean
      nextStageName?: string | null
      spawnItems?: Array<{ itemKey: string; stageName: string }>
      totalDelta?: number
      error?: string
    },
  ): Promise<{ done: boolean; remaining: number }> {
    const maxRetriesResult = await db.execute(sql`
      SELECT "max_retries", "retry_count", "job_id" FROM "work_items" WHERE "id" = ${workItemId}
    `)
    const itemRow = ((maxRetriesResult as { rows: Array<Record<string, unknown>> }).rows)[0]
    const maxRetries = itemRow.max_retries as number
    const jobId = itemRow.job_id as number

    if (opts.success) {
      await db.execute(sql`
        UPDATE "work_items" SET "status" = 'completed', "completed_at" = now()
        WHERE "id" = ${workItemId}
      `)

      if (opts.nextStageName) {
        await db.execute(sql`
          INSERT INTO "work_items" ("job_collection", "job_id", "item_key", "stage_name", "status", "max_retries")
          VALUES ('product-crawls', ${jobId},
            (SELECT "item_key" FROM "work_items" WHERE "id" = ${workItemId}),
            ${opts.nextStageName}, 'pending', ${maxRetries})
          ON CONFLICT ("job_collection", "job_id", "item_key", "stage_name") DO NOTHING
        `)
      }

      if (opts.spawnItems && opts.spawnItems.length > 0) {
        const spawnValues = opts.spawnItems.map(
          (si) => sql`('product-crawls', ${jobId}, ${si.itemKey}, ${si.stageName}, 'pending', ${maxRetries})`,
        )
        await db.execute(sql`
          INSERT INTO "work_items" ("job_collection", "job_id", "item_key", "stage_name", "status", "max_retries")
          VALUES ${sql.join(spawnValues, sql`, `)}
          ON CONFLICT ("job_collection", "job_id", "item_key", "stage_name") DO NOTHING
        `)
      }
    } else {
      const retryCount = (itemRow.retry_count as number) + 1
      if (retryCount >= maxRetries) {
        await db.execute(sql`
          UPDATE "work_items" SET "status" = 'failed', "error" = ${opts.error ?? 'test error'}, "retry_count" = ${retryCount}
          WHERE "id" = ${workItemId}
        `)
      } else {
        await db.execute(sql`
          UPDATE "work_items" SET "status" = 'pending', "claimed_by" = NULL, "claimed_at" = NULL,
            "error" = ${opts.error ?? 'test error'}, "retry_count" = ${retryCount}
          WHERE "id" = ${workItemId}
        `)
      }
    }

    // Check remaining
    const remainingResult = await db.execute(sql`
      SELECT COUNT(*) as "remaining" FROM "work_items"
      WHERE "job_collection" = 'product-crawls' AND "job_id" = ${jobId}
        AND "status" NOT IN ('completed', 'failed')
    `)
    const remaining = Number(((remainingResult as { rows: Array<Record<string, unknown>> }).rows)[0]?.remaining ?? 0)

    let done = false
    if (remaining === 0) {
      await db.execute(sql`
        UPDATE "product_crawls" SET "status" = 'completed', "completed_at" = now(),
          "claimed_by_id" = NULL, "claimed_at" = NULL
        WHERE "id" = ${jobId} AND "status" = 'in_progress'
      `)
      done = true
    }

    return { done, remaining }
  }

  // ─── Tests ───

  it('seeds one work item per URL at first enabled stage', async () => {
    const url1 = 'https://www.dm.de/test-product-1'
    const url2 = 'https://www.dm.de/test-product-2'

    // Create source products so the resolver finds them
    await createTestSourceProduct(url1)
    await createTestSourceProduct(url2)

    const jobId = await createTestJob([url1, url2])

    // Seed work items (simulating what the claim handler does)
    await insertWorkItems(jobId, [
      { itemKey: url1, stageName: 'scrape' },
      { itemKey: url2, stageName: 'scrape' },
    ])

    // Update job to in_progress
    await payload.update({
      collection: 'product-crawls' as any,
      id: jobId,
      data: { status: 'in_progress', total: 2, crawled: 0, errors: 0 },
      overrideAccess: true,
    })

    const items = await getWorkItems(jobId)
    expect(items).toHaveLength(2)
    expect(items[0].item_key).toBe(url1)
    expect(items[0].stage_name).toBe('scrape')
    expect(items[0].status).toBe('pending')
    expect(items[1].item_key).toBe(url2)
    expect(items[1].stage_name).toBe('scrape')
  })

  it('distributes work items to different workers via SKIP LOCKED', async () => {
    const url1 = 'https://www.dm.de/test-dist-1'
    const url2 = 'https://www.dm.de/test-dist-2'

    const worker1 = await createTestWorker('test-worker-1')
    const worker2 = await createTestWorker('test-worker-2')

    const jobId = await createTestJob([url1, url2])
    await insertWorkItems(jobId, [
      { itemKey: url1, stageName: 'scrape' },
      { itemKey: url2, stageName: 'scrape' },
    ])

    // Worker 1 claims
    const claimed1 = await claimWorkItems(worker1, 1, jobId)
    expect(claimed1).toHaveLength(1)
    expect(claimed1[0].status).toBe('claimed')
    expect(claimed1[0].claimed_by).toBe(worker1)

    // Worker 2 claims — should get the OTHER item (SKIP LOCKED)
    const claimed2 = await claimWorkItems(worker2, 1, jobId)
    expect(claimed2).toHaveLength(1)
    expect(claimed2[0].status).toBe('claimed')
    expect(claimed2[0].claimed_by).toBe(worker2)

    // They should have different URLs
    expect(claimed1[0].item_key).not.toBe(claimed2[0].item_key)

    // No more items to claim
    const claimed3 = await claimWorkItems(worker1, 1, jobId)
    expect(claimed3).toHaveLength(0)
  })

  it('advances to next stage via nextStageName on completion', async () => {
    const url1 = 'https://www.dm.de/test-advance-1'
    const worker1 = await createTestWorker('test-worker-advance')

    const jobId = await createTestJob([url1])
    await insertWorkItems(jobId, [{ itemKey: url1, stageName: 'scrape' }])
    await payload.update({
      collection: 'product-crawls' as any,
      id: jobId,
      data: { status: 'in_progress', total: 1, crawled: 0, errors: 0 },
      overrideAccess: true,
    })

    // Claim and complete scrape stage with nextStageName='reviews'
    const claimed = await claimWorkItems(worker1, 1, jobId)
    expect(claimed).toHaveLength(1)

    await completeWorkItem(claimed[0].id as number, {
      success: true,
      nextStageName: 'reviews',
    })

    // Verify: scrape item is completed, reviews item is pending
    const items = await getWorkItems(jobId)
    expect(items).toHaveLength(2)

    const scrapeItem = items.find((i) => i.stage_name === 'scrape')
    const reviewsItem = items.find((i) => i.stage_name === 'reviews')
    expect(scrapeItem?.status).toBe('completed')
    expect(reviewsItem?.status).toBe('pending')
    expect(reviewsItem?.item_key).toBe(url1)
  })

  it('spawns variant work items via spawnItems on completion', async () => {
    const productUrl = 'https://www.dm.de/test-spawn-product'
    const variantUrl1 = 'https://www.dm.de/test-spawn-variant-1'
    const variantUrl2 = 'https://www.dm.de/test-spawn-variant-2'
    const worker1 = await createTestWorker('test-worker-spawn')

    const jobId = await createTestJob([productUrl])
    await insertWorkItems(jobId, [{ itemKey: productUrl, stageName: 'scrape' }])
    await payload.update({
      collection: 'product-crawls' as any,
      id: jobId,
      data: { status: 'in_progress', total: 1, crawled: 0, errors: 0 },
      overrideAccess: true,
    })

    // Verify items were seeded correctly
    const seededItems = await getWorkItems(jobId)
    expect(seededItems).toHaveLength(1)
    expect(seededItems[0].status).toBe('pending')

    // Claim and complete with spawnItems (discovered variant URLs)
    const claimed = await claimWorkItems(worker1, 1, jobId)
    expect(claimed).toHaveLength(1)
    await completeWorkItem(claimed[0].id as number, {
      success: true,
      nextStageName: 'reviews',
      spawnItems: [
        { itemKey: variantUrl1, stageName: 'scrape' },
        { itemKey: variantUrl2, stageName: 'scrape' },
      ],
    })

    const items = await getWorkItems(jobId)
    // 1 completed scrape + 1 pending reviews + 2 pending variant scrapes = 4
    expect(items).toHaveLength(4)

    const pendingItems = items.filter((i) => i.status === 'pending')
    expect(pendingItems).toHaveLength(3) // reviews + 2 variants

    const variantItems = pendingItems.filter((i) => i.stage_name === 'scrape')
    expect(variantItems).toHaveLength(2)
    expect(variantItems.map((i) => i.item_key).sort()).toEqual([variantUrl1, variantUrl2].sort())
  })

  it('marks job completed when all work items are terminal', async () => {
    const url1 = 'https://www.dm.de/test-complete-1'
    const worker1 = await createTestWorker('test-worker-complete')

    const jobId = await createTestJob([url1], { stageReviews: false })
    await insertWorkItems(jobId, [{ itemKey: url1, stageName: 'scrape' }])
    await payload.update({
      collection: 'product-crawls' as any,
      id: jobId,
      data: { status: 'in_progress', total: 1, crawled: 0, errors: 0 },
      overrideAccess: true,
    })

    // Claim and complete
    const claimed = await claimWorkItems(worker1, 1, jobId)
    const { done, remaining } = await completeWorkItem(claimed[0].id as number, {
      success: true,
    })

    expect(done).toBe(true)
    expect(remaining).toBe(0)

    // Verify job is completed
    const job = await payload.findByID({ collection: 'product-crawls' as any, id: jobId, overrideAccess: true }) as unknown as Record<string, unknown>
    expect(job.status).toBe('completed')
  })

  it('retries failed work items up to maxRetries', async () => {
    const url1 = 'https://www.dm.de/test-retry-1'
    const worker1 = await createTestWorker('test-worker-retry')

    const jobId = await createTestJob([url1], { stageReviews: false, maxRetries: 2 })
    await insertWorkItems(jobId, [{ itemKey: url1, stageName: 'scrape' }], 2)
    await payload.update({
      collection: 'product-crawls' as any,
      id: jobId,
      data: { status: 'in_progress', total: 1, crawled: 0, errors: 0 },
      overrideAccess: true,
    })

    // First failure: should go back to pending
    const claimed1 = await claimWorkItems(worker1, 1, jobId)
    await completeWorkItem(claimed1[0].id as number, {
      success: false,
      error: 'Network timeout',
    })

    let items = await getWorkItems(jobId)
    expect(items[0].status).toBe('pending')
    expect(items[0].retry_count).toBe(1)

    // Second failure: should be marked failed (retry_count >= maxRetries)
    const claimed2 = await claimWorkItems(worker1, 1, jobId)
    const { done } = await completeWorkItem(claimed2[0].id as number, {
      success: false,
      error: 'Network timeout again',
    })

    items = await getWorkItems(jobId)
    expect(items[0].status).toBe('failed')
    expect(items[0].retry_count).toBe(2)
    expect(done).toBe(true)
  })

  it('does not create duplicate work items (ON CONFLICT DO NOTHING)', async () => {
    const url1 = 'https://www.dm.de/test-dedup-1'
    const variantUrl = 'https://www.dm.de/test-dedup-variant'
    const worker1 = await createTestWorker('test-worker-dedup')

    const jobId = await createTestJob([url1])
    // Seed both the product URL and the variant URL upfront
    await insertWorkItems(jobId, [
      { itemKey: url1, stageName: 'scrape' },
      { itemKey: variantUrl, stageName: 'scrape' },
    ])
    await payload.update({
      collection: 'product-crawls' as any,
      id: jobId,
      data: { status: 'in_progress', total: 2, crawled: 0, errors: 0 },
      overrideAccess: true,
    })

    // Complete url1 and try to spawn variantUrl (which already exists)
    const claimed = await claimWorkItems(worker1, 1, jobId)
    await completeWorkItem(claimed[0].id as number, {
      success: true,
      nextStageName: 'reviews',
      spawnItems: [{ itemKey: variantUrl, stageName: 'scrape' }],
    })

    // Verify: no duplicate — still only one scrape item for variantUrl
    const items = await getWorkItems(jobId)
    const variantScrapes = items.filter((i) => i.item_key === variantUrl && i.stage_name === 'scrape')
    expect(variantScrapes).toHaveLength(1)
  })
})
