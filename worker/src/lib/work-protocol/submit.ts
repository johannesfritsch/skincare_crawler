import type { PayloadRestClient } from '@/lib/payload-client'
import type { AuthenticatedWorker } from './types'
import type { SourceSlug } from '@/lib/source-product-queries'
import type { JobCollection } from '@/lib/logger'
import { getSourceSlugFromUrl, countUncrawled } from '@/lib/source-product-queries'
import { createLogger } from '@/lib/logger'
import {
  persistCrawlResult,
  persistCrawlFailure,
  persistDiscoveredProduct,
  persistDiscoveredCategory,
  persistIngredient,
  persistVideoDiscoveryResult,
  persistVideoProcessingResult,
  persistProductAggregationResult,
} from './persist'

const log = createLogger('WorkProtocol')

interface ScrapedProductData {
  gtin?: string
  name: string
  brandName?: string
  description?: string
  ingredientNames: string[]
  priceCents?: number
  currency?: string
  priceInfos?: string[]
  amount?: number
  amountUnit?: string
  images: Array<{ url: string; alt?: string | null }>
  variants: Array<{
    dimension: string
    options: Array<{
      label: string
      value: string | null
      gtin: string | null
      isSelected: boolean
    }>
  }>
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

interface DiscoveredProduct {
  gtin?: string
  productUrl: string
  brandName?: string
  name?: string
  price?: number
  currency?: string
  rating?: number
  ratingCount?: number
  category?: string
  categoryUrl?: string
}

interface ScrapedIngredientData {
  name: string
  casNumber?: string
  ecNumber?: string
  cosIngId?: string
  chemicalDescription?: string
  functions: string[]
  itemType?: 'ingredient' | 'substance'
  restrictions?: string
  sourceUrl?: string
}

interface DiscoveredCategory {
  url: string
  name: string
  path: string[]
}

interface DiscoveredVideo {
  externalId: string
  title: string
  description?: string
  thumbnailUrl?: string
  externalUrl: string
  uploadDate?: string
  timestamp?: number
  duration?: number
  viewCount?: number
  likeCount?: number
  channelName?: string
  channelUrl?: string
}

interface SubmitProductCrawlBody {
  type: 'product-crawl'
  jobId: number
  results: Array<{
    sourceProductId: number
    sourceUrl: string
    source: SourceSlug
    data: ScrapedProductData | null
    error?: string
  }>
}

interface SubmitProductDiscoveryBody {
  type: 'product-discovery'
  jobId: number
  products: DiscoveredProduct[]
  currentUrlIndex: number
  driverProgress: unknown | null
  done: boolean
  pagesUsed: number
}

interface SubmitCategoryDiscoveryBody {
  type: 'category-discovery'
  jobId: number
  categories: DiscoveredCategory[]
  currentUrlIndex: number
  driverProgress: unknown | null
  pathToId: Record<string, number>
  done: boolean
}

interface SubmitIngredientsDiscoveryBody {
  type: 'ingredients-discovery'
  jobId: number
  ingredients: ScrapedIngredientData[]
  currentTerm: string | null
  currentPage: number
  totalPagesForTerm: number
  termQueue: string[]
  done: boolean
}

interface SubmitVideoDiscoveryBody {
  type: 'video-discovery'
  jobId: number
  channelUrl: string
  videos: DiscoveredVideo[]
  totalVideos: number
  offset: number
  batchSize: number
}

interface VideoProcessingScreenshot {
  imageMediaId: number
  barcode?: string
  thumbnailMediaId?: number
  hash?: string
  distance?: number | null
  screenshotGroup?: number
  recognitionCandidate?: boolean
  recognitionThumbnailMediaId?: number
}

interface VideoProcessingSegment {
  timestampStart: number
  timestampEnd: number
  matchingType: 'barcode' | 'visual'
  barcode?: string
  screenshots: VideoProcessingScreenshot[]
  recognitionResults?: Array<{
    clusterGroup: number
    brand: string | null
    productName: string | null
    searchTerms: string[]
  }>
  eventLog: string
}

interface SubmitVideoProcessingBody {
  type: 'video-processing'
  jobId: number
  results: Array<{
    videoId: number
    success: boolean
    error?: string
    tokensUsed?: number
    videoMediaId?: number
    segments?: VideoProcessingSegment[]
  }>
}

interface SubmitProductAggregationBody {
  type: 'product-aggregation'
  jobId: number
  lastCheckedSourceId: number
  aggregationType: string
  results: Array<{
    gtin: string
    sourceProductIds: number[]
    aggregated: {
      gtin?: string
      name?: string
      brandName?: string
      sourceCategoryId?: number
      ingredientNames?: string[]
    } | null
    classification?: {
      description: string
      productType: string
      productAttributes: Array<{ attribute: string; sourceIndex: number; type: string; snippet?: string; ingredientNames?: string[] }>
      productClaims: Array<{ claim: string; sourceIndex: number; type: string; snippet?: string; ingredientNames?: string[] }>
      tokensUsed: { promptTokens: number; completionTokens: number; totalTokens: number }
    }
    classifySourceProductIds?: number[]
    tokensUsed: number
    error?: string
  }>
}

type SubmitBody =
  | SubmitProductCrawlBody
  | SubmitProductDiscoveryBody
  | SubmitCategoryDiscoveryBody
  | SubmitIngredientsDiscoveryBody
  | SubmitVideoDiscoveryBody
  | SubmitVideoProcessingBody
  | SubmitProductAggregationBody

export async function submitWork(
  payload: PayloadRestClient,
  _worker: AuthenticatedWorker,
  body: SubmitBody,
): Promise<Record<string, unknown>> {
  log.info(`submit: type=${body.type}, job=#${body.jobId}`)
  switch (body.type) {
    case 'product-crawl':
      return submitProductCrawl(payload, body)
    case 'product-discovery':
      return submitProductDiscovery(payload, body)
    case 'category-discovery':
      return submitCategoryDiscovery(payload, body)
    case 'ingredients-discovery':
      return submitIngredientsDiscovery(payload, body)
    case 'video-discovery':
      return submitVideoDiscovery(payload, body)
    case 'video-processing':
      return submitVideoProcessing(payload, body)
    case 'product-aggregation':
      return submitProductAggregation(payload, body)
    default:
      return { error: 'Unknown job type' }
  }
}

async function submitProductCrawl(payload: PayloadRestClient, body: SubmitProductCrawlBody) {
  const { jobId, results } = body
  const jlog = log.forJob('product-crawls' as JobCollection, jobId)
  log.info(`submitProductCrawl #${jobId}: ${results.length} results`)

  const job = await payload.findByID({ collection: 'product-crawls', id: jobId }) as Record<string, unknown>
  let crawled = (job.crawled as number) ?? 0
  let errors = (job.errors as number) ?? 0

  for (const result of results) {
    if (result.data) {
      try {
        await persistCrawlResult(payload, {
          crawlId: jobId,
          sourceProductId: result.sourceProductId,
          sourceUrl: result.sourceUrl,
          source: result.source,
          data: result.data,
        })
        crawled++
        log.info(`submitProductCrawl #${jobId}: ok ${result.sourceUrl}`)
      } catch (e) {
        log.error(`submitProductCrawl #${jobId}: persist error for ${result.sourceUrl}: ${e instanceof Error ? e.message : e}`)
        await persistCrawlFailure(payload, jobId, result.sourceProductId, `Persist error: ${e instanceof Error ? e.message : String(e)}`)
        errors++
      }
    } else {
      log.info(`submitProductCrawl #${jobId}: failed ${result.sourceUrl} — ${result.error}`)
      await persistCrawlFailure(payload, jobId, result.sourceProductId, result.error ?? 'Failed to scrape')
      errors++
    }
  }

  // Count remaining — scoped to this job's sourceUrls if applicable
  let sourceUrls: string[] | undefined
  if (job.type === 'selected_urls') {
    sourceUrls = ((job.urls as string) ?? '').split('\n').map((u: string) => u.trim()).filter(Boolean)
  } else if (job.type === 'from_discovery' && job.discovery) {
    const discoveryId = typeof job.discovery === 'number' ? job.discovery : (job.discovery as Record<string, number>).id
    const discovery = await payload.findByID({ collection: 'product-discoveries', id: discoveryId }) as Record<string, unknown>
    sourceUrls = ((discovery.productUrls as string) ?? '').split('\n').filter(Boolean)
  } else if (job.type === 'selected_gtins') {
    const gtins = ((job.gtins as string) ?? '').split('\n').map((g: string) => g.trim()).filter(Boolean)
    const products = await payload.find({
      collection: 'source-products',
      where: { gtin: { in: gtins.join(',') } },
      limit: 10000,
    })
    sourceUrls = products.docs.map((p) => (p as Record<string, unknown>).sourceUrl).filter(Boolean) as string[]
  }

  const sources = job.source === 'all' ? ['dm', 'mueller', 'rossmann'] : [job.source as string]
  let totalRemaining = 0
  for (const source of sources) {
    totalRemaining += await countUncrawled(payload, source as SourceSlug, sourceUrls ? { sourceUrls } : undefined)
  }

  if (totalRemaining === 0) {
    log.info(`submitProductCrawl #${jobId}: completing (${crawled} crawled, ${errors} errors)`)
    await payload.update({
      collection: 'product-crawls',
      id: jobId,
      data: {
        status: 'completed',
        crawled,
        errors,
        completedAt: new Date().toISOString(),
      },
    })
    jlog.info(`Completed: ${crawled} crawled, ${errors} errors`, { event: 'success' })
  } else {
    log.info(`submitProductCrawl #${jobId}: ${totalRemaining} remaining (${crawled} crawled, ${errors} errors)`)
    await payload.update({
      collection: 'product-crawls',
      id: jobId,
      data: { crawled, errors },
    })
    jlog.info(`Batch done: ${crawled} crawled, ${errors} errors, ${totalRemaining} remaining`, { event: true })
  }

  return { crawled, errors, remaining: totalRemaining }
}

async function submitProductDiscovery(payload: PayloadRestClient, body: SubmitProductDiscoveryBody) {
  const { jobId, products, currentUrlIndex, driverProgress, done } = body
  const jlog = log.forJob('product-discoveries' as JobCollection, jobId)
  log.info(`submitProductDiscovery #${jobId}: ${products.length} products, done=${done}`)

  const job = await payload.findByID({ collection: 'product-discoveries', id: jobId }) as Record<string, unknown>

  // Determine source from first URL
  const sourceUrls = ((job.sourceUrls as string) ?? '').split('\n').map((u: string) => u.trim()).filter(Boolean)
  const source = (sourceUrls.length > 0 ? getSourceSlugFromUrl(sourceUrls[0]) : null) ?? 'dm'

  // Persist each product
  let created = (job.created as number) ?? 0
  let existing = (job.existing as number) ?? 0
  let discovered = (job.discovered as number) ?? 0

  const productUrls: string[] = ((job.productUrls as string) ?? '').split('\n').filter(Boolean)
  const seenProductUrls = new Set<string>(productUrls)

  for (const product of products) {
    if (seenProductUrls.has(product.productUrl)) continue
    seenProductUrls.add(product.productUrl)
    productUrls.push(product.productUrl)
    discovered++

    try {
      const result = await persistDiscoveredProduct(payload, {
        discoveryId: jobId,
        product,
        source: source as SourceSlug,
      })
      if (result.isNew) {
        created++
      } else {
        existing++
      }
    } catch (e) {
      log.error(`submitProductDiscovery #${jobId}: persist error for ${product.productUrl}: ${e instanceof Error ? e.message : e}`)
    }
  }

  log.info(`submitProductDiscovery #${jobId}: ${discovered} discovered, ${created} created, ${existing} existing, done=${done}`)

  if (done) {
    await payload.update({
      collection: 'product-discoveries',
      id: jobId,
      data: {
        status: 'completed',
        discovered,
        created,
        existing,
        productUrls: productUrls.join('\n'),
        progress: null,
        completedAt: new Date().toISOString(),
      },
    })
    jlog.info(`Completed: ${discovered} discovered, ${created} created, ${existing} existing`, { event: 'success' })
  } else {
    await payload.update({
      collection: 'product-discoveries',
      id: jobId,
      data: {
        status: 'in_progress',
        discovered,
        created,
        existing,
        productUrls: productUrls.join('\n'),
        progress: { currentUrlIndex, driverProgress },
        ...(!job.startedAt ? { startedAt: new Date().toISOString() } : {}),
      },
    })
  }

  return { discovered, created, existing, done }
}

async function submitCategoryDiscovery(payload: PayloadRestClient, body: SubmitCategoryDiscoveryBody) {
  const { jobId, categories, currentUrlIndex, driverProgress, pathToId, done } = body
  const jlog = log.forJob('category-discoveries' as JobCollection, jobId)
  log.info(`submitCategoryDiscovery #${jobId}: ${categories.length} categories, done=${done}`)

  const job = await payload.findByID({ collection: 'category-discoveries', id: jobId }) as Record<string, unknown>

  // Determine source from first URL
  const storeUrls = ((job.storeUrls as string) ?? '').split('\n').filter(Boolean)
  const source = ((storeUrls.length > 0 ? getSourceSlugFromUrl(storeUrls[0]) : null) ?? 'dm') as SourceSlug

  let created = (job.created as number) ?? 0
  let existing = (job.existing as number) ?? 0
  let discovered = (job.discovered as number) ?? 0

  const pathToIdMap = new Map<string, number>(Object.entries(pathToId).map(([k, v]) => [k, v]))

  for (const cat of categories) {
    discovered++
    try {
      const result = await persistDiscoveredCategory(payload, cat, source, pathToIdMap)
      if (result.isNew) {
        created++
      } else {
        existing++
      }
    } catch (e) {
      log.error(`submitCategoryDiscovery #${jobId}: persist error for ${cat.name}: ${e instanceof Error ? e.message : e}`)
    }
  }

  log.info(`submitCategoryDiscovery #${jobId}: ${discovered} discovered, ${created} created, ${existing} existing, done=${done}`)

  if (done) {
    await payload.update({
      collection: 'category-discoveries',
      id: jobId,
      data: {
        status: 'completed',
        discovered,
        created,
        existing,
        progress: null,
        completedAt: new Date().toISOString(),
      },
    })
    jlog.info(`Completed: ${discovered} discovered, ${created} created, ${existing} existing`, { event: 'success' })
  } else {
    const updatedPathToId = Object.fromEntries(pathToIdMap)
    await payload.update({
      collection: 'category-discoveries',
      id: jobId,
      data: {
        status: 'in_progress',
        discovered,
        created,
        existing,
        progress: { currentUrlIndex, driverProgress, pathToId: updatedPathToId },
        ...(!job.startedAt ? { startedAt: new Date().toISOString() } : {}),
      },
    })
  }

  return { discovered, created, existing, done }
}

async function submitIngredientsDiscovery(payload: PayloadRestClient, body: SubmitIngredientsDiscoveryBody) {
  const { jobId, ingredients, currentTerm, currentPage, totalPagesForTerm, termQueue, done } = body
  const jlog = log.forJob('ingredients-discoveries' as JobCollection, jobId)
  log.info(`submitIngredientsDiscovery #${jobId}: ${ingredients.length} ingredients, done=${done}`)

  const job = await payload.findByID({ collection: 'ingredients-discoveries', id: jobId }) as Record<string, unknown>
  let created = (job.created as number) ?? 0
  let existing = (job.existing as number) ?? 0
  let discovered = (job.discovered as number) ?? 0
  let errors = (job.errors as number) ?? 0

  for (const ingredient of ingredients) {
    discovered++
    try {
      const result = await persistIngredient(payload, ingredient)
      if (result.isNew) {
        created++
      } else {
        existing++
      }
    } catch (e) {
      log.error(`submitIngredientsDiscovery #${jobId}: persist error for ${ingredient.name}: ${e instanceof Error ? e.message : e}`)
      errors++
    }
  }

  log.info(`submitIngredientsDiscovery #${jobId}: ${created} created, ${existing} existing, ${errors} errors, done=${done}`)

  if (done) {
    await payload.update({
      collection: 'ingredients-discoveries',
      id: jobId,
      data: {
        status: 'completed',
        discovered,
        created,
        existing,
        errors,
        termQueue: [],
        currentTerm: null,
        currentPage: null,
        totalPagesForTerm: null,
        completedAt: new Date().toISOString(),
      },
    })
    jlog.info(`Completed: ${discovered} discovered, ${created} created, ${existing} existing, ${errors} errors`, { event: 'success' })
  } else {
    await payload.update({
      collection: 'ingredients-discoveries',
      id: jobId,
      data: {
        status: 'in_progress',
        discovered,
        created,
        existing,
        errors,
        currentTerm,
        currentPage,
        totalPagesForTerm,
        termQueue,
        ...(!job.startedAt ? { startedAt: new Date().toISOString() } : {}),
      },
    })
  }

  return { discovered, created, existing, errors, done }
}

async function submitVideoDiscovery(payload: PayloadRestClient, body: SubmitVideoDiscoveryBody) {
  const { jobId, channelUrl, videos, totalVideos, offset, batchSize } = body
  const jlog = log.forJob('video-discoveries' as JobCollection, jobId)
  log.info(`submitVideoDiscovery #${jobId}: ${videos.length} videos total, offset=${offset}, batchSize=${batchSize}`)

  const job = await payload.findByID({ collection: 'video-discoveries', id: jobId }) as Record<string, unknown>

  // Mark as in_progress if pending
  if (job.status === 'pending') {
    await payload.update({
      collection: 'video-discoveries',
      id: jobId,
      data: {
        status: 'in_progress',
        startedAt: new Date().toISOString(),
        discovered: totalVideos,
      },
    })
    jlog.info(`Started video discovery: ${totalVideos} videos found`, { event: 'start' })
  }

  const result = await persistVideoDiscoveryResult(payload, jobId, channelUrl, videos, offset, batchSize)

  const totalCreated = ((job.created as number) ?? 0) + result.created
  const totalExisting = ((job.existing as number) ?? 0) + result.existing
  const allDone = totalCreated + totalExisting >= totalVideos

  log.info(`submitVideoDiscovery #${jobId}: batch ${result.created} created, ${result.existing} existing; total ${totalCreated}+${totalExisting}/${totalVideos}, done=${allDone}`)

  if (allDone) {
    await payload.update({
      collection: 'video-discoveries',
      id: jobId,
      data: {
        status: 'completed',
        created: totalCreated,
        existing: totalExisting,
        completedAt: new Date().toISOString(),
      },
    })
    jlog.info(`Completed: ${totalCreated} created, ${totalExisting} existing`, { event: 'success' })
  } else {
    await payload.update({
      collection: 'video-discoveries',
      id: jobId,
      data: {
        created: totalCreated,
        existing: totalExisting,
      },
    })
  }

  return { created: result.created, existing: result.existing, done: allDone }
}

async function submitVideoProcessing(payload: PayloadRestClient, body: SubmitVideoProcessingBody) {
  const { jobId, results } = body
  const jlog = log.forJob('video-processings' as JobCollection, jobId)
  log.info(`submitVideoProcessing #${jobId}: ${results.length} videos`)

  const job = await payload.findByID({ collection: 'video-processings', id: jobId }) as Record<string, unknown>
  let processed = (job.processed as number) ?? 0
  let errors = (job.errors as number) ?? 0
  let tokensUsed = (job.tokensUsed as number) ?? 0

  for (const result of results) {
    if (result.success && result.segments) {
      try {
        await persistVideoProcessingResult(payload, jobId, result.videoId, result.videoMediaId, result.segments)
        processed++
        tokensUsed += result.tokensUsed ?? 0
        log.info(`submitVideoProcessing #${jobId}: video #${result.videoId} ok (${result.segments.length} segments, ${result.tokensUsed ?? 0} tokens)`)
      } catch (e) {
        errors++
        const msg = e instanceof Error ? e.message : String(e)
        log.error(`submitVideoProcessing #${jobId}: video #${result.videoId} persist failed: ${msg}`)
        jlog.error(`Video #${result.videoId}: persist failed: ${msg}`, { event: true })
      }
    } else {
      errors++
      log.info(`submitVideoProcessing #${jobId}: video #${result.videoId} failed: ${result.error}`)
      jlog.error(`Video #${result.videoId}: ${result.error}`, { event: true })
    }
  }

  // Check if all done
  const total = (job.total as number) ?? 0
  const allDone = processed + errors >= total
  log.info(`submitVideoProcessing #${jobId}: ${processed} processed, ${errors} errors, ${tokensUsed} tokens, done=${allDone} (${processed + errors}/${total})`)

  if (allDone) {
    await payload.update({
      collection: 'video-processings',
      id: jobId,
      data: {
        status: 'completed',
        processed,
        errors,
        tokensUsed,
        completedAt: new Date().toISOString(),
      },
    })
    jlog.info(`Completed: ${processed} processed, ${errors} errors, ${tokensUsed} tokens`, { event: 'success' })
  } else {
    await payload.update({
      collection: 'video-processings',
      id: jobId,
      data: { processed, errors, tokensUsed },
    })
  }

  return { processed, errors, tokensUsed, done: allDone }
}

async function submitProductAggregation(payload: PayloadRestClient, body: SubmitProductAggregationBody) {
  const { jobId, lastCheckedSourceId, aggregationType, results } = body
  const jlog = log.forJob('product-aggregations' as JobCollection, jobId)
  log.info(`submitProductAggregation #${jobId}: ${results.length} results (type=${aggregationType})`)

  const job = await payload.findByID({ collection: 'product-aggregations', id: jobId }) as Record<string, unknown>
  let aggregated = (job.aggregated as number) ?? 0
  let errors = (job.errors as number) ?? 0
  let tokensUsed = (job.tokensUsed as number) ?? 0

  for (const result of results) {
    if (result.error || !result.aggregated) {
      errors++
      log.info(`submitProductAggregation #${jobId}: GTIN ${result.gtin} error: ${result.error ?? 'no data'}`)
      if (result.error) {
        jlog.error(`GTIN ${result.gtin}: ${result.error}`, { event: true })
      }
      continue
    }

    try {
      const persistResult = await persistProductAggregationResult(payload, jobId, {
        gtin: result.gtin,
        sourceProductIds: result.sourceProductIds,
        aggregated: result.aggregated,
        classification: result.classification,
        classifySourceProductIds: result.classifySourceProductIds,
      })

      tokensUsed += persistResult.tokensUsed
      tokensUsed += result.tokensUsed // classification tokens from worker

      if (persistResult.error) {
        errors++
        log.info(`submitProductAggregation #${jobId}: GTIN ${result.gtin} → product #${persistResult.productId} (error: ${persistResult.error.slice(0, 100)})`)
        jlog.error(`GTIN ${result.gtin}: ${persistResult.error}`, { event: true })
      } else {
        aggregated++
        log.info(`submitProductAggregation #${jobId}: GTIN ${result.gtin} → product #${persistResult.productId} ok (${persistResult.tokensUsed} tokens${persistResult.warning ? ', with warnings' : ''})`)
        if (persistResult.warning) {
          jlog.warn(`GTIN ${result.gtin}: ${persistResult.warning}`, { event: true })
        }
      }

      // Update progress with latest product
      await payload.update({
        collection: 'product-aggregations',
        id: jobId,
        data: {
          aggregated,
          errors,
          tokensUsed,
          product: persistResult.productId || undefined,
          ...(aggregationType === 'all' ? { lastCheckedSourceId } : {}),
        },
      })
    } catch (e) {
      errors++
      const msg = e instanceof Error ? e.message : String(e)
      jlog.error(`GTIN ${result.gtin}: persist failed: ${msg}`, { event: true })
    }
  }

  // Completion check
  const shouldComplete =
    aggregationType === 'selected_gtins' ||
    (aggregationType === 'all' && results.length === 0)

  log.info(`submitProductAggregation #${jobId}: ${aggregated} aggregated, ${errors} errors, ${tokensUsed} tokens, done=${shouldComplete}`)

  if (shouldComplete) {
    await payload.update({
      collection: 'product-aggregations',
      id: jobId,
      data: {
        status: 'completed',
        aggregated,
        errors,
        tokensUsed,
        completedAt: new Date().toISOString(),
      },
    })
    jlog.info(`Completed: ${aggregated} aggregated, ${errors} errors, ${tokensUsed} tokens`, { event: 'success' })
  } else {
    await payload.update({
      collection: 'product-aggregations',
      id: jobId,
      data: {
        aggregated,
        errors,
        tokensUsed,
        ...(aggregationType === 'all' ? { lastCheckedSourceId } : {}),
      },
    })
    jlog.info(`Batch done: ${aggregated} aggregated, ${errors} errors`, { event: true })
  }

  return { aggregated, errors, tokensUsed, done: shouldComplete }
}
