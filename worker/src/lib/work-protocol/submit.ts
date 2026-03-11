import type { PayloadRestClient } from '@/lib/payload-client'
import type { AuthenticatedWorker } from './types'
import type { SourceSlug } from '@/lib/source-product-queries'

import { getSourceSlugFromUrl, countUncrawled, normalizeProductUrl } from '@/lib/source-product-queries'
import { ALL_SOURCE_SLUGS } from '@/lib/source-discovery/driver'
import { createLogger } from '@/lib/logger'
import {
  persistCrawlResult,
  persistIngredient,
  persistVideoDiscoveryResult,
  persistVideoProcessingResult,
  persistProductAggregationResult,
} from './persist'
import { retryOrFail } from './job-failure'

const log = createLogger('Submit')

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
      availability?: 'available' | 'unavailable' | 'unknown'
      sourceArticleNumber?: string | null
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
  crawlVariants: boolean
  results: Array<{
    sourceVariantId?: number
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

interface SubmitProductSearchBody {
  type: 'product-search'
  jobId: number
  products: Array<{ product: DiscoveredProduct; source: SourceSlug; matchedQuery: string }>
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
  /** True if yt-dlp returned fewer videos than requested (end of channel) */
  reachedEnd: boolean
  /** The offset to resume from on the next batch (currentOffset + videos.length) */
  nextOffset: number
  /** Max videos limit from the job (undefined = unlimited) */
  maxVideos?: number
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

interface TranscriptData {
  transcript: string
  transcriptWords: Array<{ word: string; start: number; end: number; confidence: number }>
}

interface SnippetTranscript {
  preTranscript: string
  transcript: string
  postTranscript: string
}

interface VideoQuoteData {
  productId: number
  quotes: Array<{
    text: string
    summary: string[]
    sentiment: 'positive' | 'neutral' | 'negative' | 'mixed'
    sentimentScore: number
  }>
  overallSentiment: 'positive' | 'neutral' | 'negative' | 'mixed'
  overallSentimentScore: number
}

interface SubmitVideoProcessingBody {
  type: 'video-processing'
  jobId: number
  results: Array<{
    videoId: number
    success: boolean
    error?: string
    tokensUsed?: number
    tokensRecognition?: number
    tokensTranscriptCorrection?: number
    tokensSentiment?: number
    videoMediaId?: number
    segments?: VideoProcessingSegment[]
    transcriptData?: TranscriptData
    snippetTranscripts?: SnippetTranscript[]
    snippetVideoQuotes?: VideoQuoteData[][]
  }>
}

interface SubmitProductAggregationBody {
  type: 'product-aggregation'
  jobId: number
  lastCheckedSourceId: number
  aggregationType: string
  scope: string
  results: Array<{
    gtins: string[]
    sourceProductIds: number[]
    // Per-variant aggregated data (one per GTIN in the product group)
    variantResults: Array<{
      gtin: string
      variantData: {
        variantLabel?: string
        variantDimension?: string
        amount?: number
        amountUnit?: string
        selectedImageUrl?: string
        selectedImageAlt?: string | null
        ingredientsText?: string
        sourceVariantIds: number[]
        description?: string
        labels?: string[]
      }
    }> | null
    // Product-level aggregated data (shared across all variants in the group)
    productData: {
      name?: string
      brandName?: string
    } | null
    // Classification results (full scope only) — shared across all variants
    classification?: {
      productType: string
      warnings: string | null
      skinApplicability: string | null
      phMin: number | null
      phMax: number | null
      usageInstructions: string | null
      usageSchedule: number[][] | null
      productAttributes: Array<{ attribute: string; sourceIndex: number; type: string; snippet?: string; ingredientNames?: string[] }>
      productClaims: Array<{ claim: string; sourceIndex: number; type: string; snippet?: string; ingredientNames?: string[] }>
      tokensUsed: { promptTokens: number; completionTokens: number; totalTokens: number }
    }
    classifySourceProductIds?: number[]
    tokensUsed: number
    error?: string
  }>
}

interface SubmitIngredientCrawlBody {
  type: 'ingredient-crawl'
  jobId: number
  lastCheckedIngredientId: number
  crawlType: string
  results: Array<{
    ingredientId: number
    ingredientName: string
    longDescription?: string
    shortDescription?: string
    imageMediaId?: number
    tokensUsed: number
    sourceUrl?: string
    error?: string
  }>
}

type SubmitBody =
  | SubmitProductCrawlBody
  | SubmitProductDiscoveryBody
  | SubmitProductSearchBody
  | SubmitIngredientsDiscoveryBody
  | SubmitVideoDiscoveryBody
  | SubmitVideoProcessingBody
  | SubmitProductAggregationBody
  | SubmitIngredientCrawlBody

export async function submitWork(
  payload: PayloadRestClient,
  _worker: AuthenticatedWorker,
  body: SubmitBody,
): Promise<Record<string, unknown>> {
  log.info('Submitting work', { type: body.type, jobId: body.jobId })
  switch (body.type) {
    case 'product-crawl':
      return submitProductCrawl(payload, body)
    case 'product-discovery':
      return submitProductDiscovery(payload, body)
    case 'product-search':
      return submitProductSearch(payload, body)
    case 'ingredients-discovery':
      return submitIngredientsDiscovery(payload, body)
    case 'video-discovery':
      return submitVideoDiscovery(payload, body)
    case 'video-processing':
      return submitVideoProcessing(payload, body)
    case 'product-aggregation':
      return submitProductAggregation(payload, body)
    case 'ingredient-crawl':
      return submitIngredientCrawl(payload, body)
    default:
      return { error: 'Unknown job type' }
  }
}

async function submitProductCrawl(payload: PayloadRestClient, body: SubmitProductCrawlBody) {
  const { jobId, results, crawlVariants } = body
  const jlog = log.forJob('product-crawls', jobId)
  const batchStartMs = Date.now()
  log.info('Product crawl batch received', { jobId, results: results.length })

  const job = await payload.findByID({ collection: 'product-crawls', id: jobId }) as Record<string, unknown>
  let crawled = (job.crawled as number) ?? 0
  let errors = (job.errors as number) ?? 0

  // Determine source slug from job or first result
  const source = job.source === 'all' ? (results[0]?.source ?? 'unknown') : (job.source as string)

  // Track batch-level variant & data quality counters
  let batchNewVariants = 0
  let batchExistingVariants = 0
  let batchWithIngredients = 0
  let batchPriceChanges = 0

  for (const result of results) {
    if (result.data) {
      try {
        const persistResult = await persistCrawlResult(payload, {
          crawlId: jobId,
          sourceVariantId: result.sourceVariantId,
          sourceProductId: result.sourceProductId,
          sourceUrl: result.sourceUrl,
          source: result.source,
          data: result.data,
          crawlVariants,
        })
        crawled++
        batchNewVariants += persistResult.newVariants
        batchExistingVariants += persistResult.existingVariants
        if (persistResult.hasIngredients) batchWithIngredients++
        if (persistResult.priceChange && persistResult.priceChange !== 'stable') batchPriceChanges++
        log.info('Product crawl persisted', { jobId, sourceUrl: result.sourceUrl })
      } catch (e) {
        log.error('Product crawl persist error', { jobId, sourceUrl: result.sourceUrl, error: e instanceof Error ? e.message : String(e) })
        errors++
      }
    } else {
      log.info('Product crawl failed', { jobId, sourceUrl: result.sourceUrl, error: result.error ?? 'Failed to scrape' })
      errors++
    }
  }

  // Count remaining — scoped to this job's source-product URLs (or source-product IDs when crawlVariants=true)
  let sourceUrls: string[] | undefined
  if (job.type === 'selected_urls') {
    sourceUrls = ((job.urls as string) ?? '').split('\n').map((u: string) => normalizeProductUrl(u.trim())).filter(Boolean)
  } else if (job.type === 'from_discovery' && job.discovery) {
    const discoveryId = typeof job.discovery === 'number' ? job.discovery : (job.discovery as Record<string, number>).id
    const discovery = await payload.findByID({ collection: 'product-discoveries', id: discoveryId }) as Record<string, unknown>
    sourceUrls = ((discovery.productUrls as string) ?? '').split('\n').filter(Boolean).map(normalizeProductUrl)
  } else if (job.type === 'from_search' && job.search) {
    const searchId = typeof job.search === 'number' ? job.search : (job.search as Record<string, number>).id
    const search = await payload.findByID({ collection: 'product-searches', id: searchId }) as Record<string, unknown>
    sourceUrls = ((search.productUrls as string) ?? '').split('\n').filter(Boolean).map(normalizeProductUrl)
  }

  // When crawlVariants=true and we have scoped URLs, resolve to source-product IDs
  // so sibling variants are also counted as remaining work
  let countOpts: { sourceUrls?: string[]; sourceProductIds?: number[] } | undefined
  if (crawlVariants && sourceUrls && sourceUrls.length > 0) {
    const spResult = await payload.find({
      collection: 'source-products',
      where: { sourceUrl: { in: sourceUrls.join(',') } },
      limit: 100000,
    })
    const spIds = spResult.docs.map((doc) => (doc as Record<string, unknown>).id as number)
    countOpts = { sourceProductIds: spIds }
  } else if (sourceUrls) {
    countOpts = { sourceUrls }
  }

  const sources = job.source === 'all' ? [...ALL_SOURCE_SLUGS] : [job.source as string]
  let totalRemaining = 0
  for (const source of sources) {
    totalRemaining += await countUncrawled(payload, source as SourceSlug, countOpts)
  }

  // Count how many items in this batch were errors
  const batchErrors = results.filter((r) => !r.data || r.error).length

  const batchDurationMs = Date.now() - batchStartMs
  const batchSize = results.length
  const batchSuccesses = batchSize - batchErrors
  const errorRate = batchSize > 0 ? Math.round((batchErrors / batchSize) * 100) : 0

  if (totalRemaining === 0) {
    // If the entire batch was errors, retry instead of completing
    if (batchErrors === results.length && results.length > 0) {
      log.warn('Product crawl batch was 100% errors, retrying or failing', { jobId, batchErrors })
      await retryOrFail(payload, 'product-crawls', jobId, `Batch of ${batchErrors} items all failed`)
      return { crawled, errors, remaining: totalRemaining }
    }

    // Compute job duration from startedAt or claimedAt
    const jobStartedAt = (job.startedAt as string) || (job.claimedAt as string) || (job.createdAt as string)
    const jobDurationMs = jobStartedAt ? Date.now() - new Date(jobStartedAt).getTime() : 0

    log.info('Product crawl completing', { jobId, crawled, errors })
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
    jlog.event('crawl.completed', { source, crawled, errors, durationMs: jobDurationMs })
  } else {
    log.info('Product crawl batch done', { jobId, remaining: totalRemaining, crawled, errors })
    await payload.update({
      collection: 'product-crawls',
      id: jobId,
      data: { crawled, errors, claimedBy: null, claimedAt: null },
    })
    jlog.event('crawl.batch_done', {
      source,
      crawled,
      errors,
      remaining: totalRemaining,
      batchSize,
      batchSuccesses,
      batchErrors,
      errorRate,
      batchDurationMs,
      newVariants: batchNewVariants,
      existingVariants: batchExistingVariants,
      withIngredients: batchWithIngredients,
      priceChanges: batchPriceChanges,
    })
  }

  return { crawled, errors, remaining: totalRemaining }
}

async function submitProductDiscovery(payload: PayloadRestClient, body: SubmitProductDiscoveryBody) {
  const { jobId, products, currentUrlIndex, driverProgress, done } = body
  const jlog = log.forJob('product-discoveries', jobId)
  const batchStartMs = Date.now()
  log.info('Product discovery batch received', { jobId, products: products.length, done })

  const job = await payload.findByID({ collection: 'product-discoveries', id: jobId }) as Record<string, unknown>

  // Determine source from URLs (try each until one matches a known driver)
  const jobSourceUrls = ((job.sourceUrls as string) ?? '').split('\n').map((u: string) => u.trim()).filter(Boolean)
  let source: SourceSlug | null = null
  for (const url of jobSourceUrls) {
    source = getSourceSlugFromUrl(url)
    if (source) break
  }
  if (!source) {
    log.error('Could not determine source from URLs', { jobId })
    return { discovered: 0, error: 'unknown source' }
  }

  // Just accumulate discovered URLs — no source-product creation
  let discovered = (job.discovered as number) ?? 0

  const productUrls: string[] = ((job.productUrls as string) ?? '').split('\n').filter(Boolean)
  const seenProductUrls = new Set<string>(productUrls)

  let batchNew = 0
  for (const product of products) {
    const normalizedUrl = normalizeProductUrl(product.productUrl)
    if (seenProductUrls.has(normalizedUrl)) continue
    seenProductUrls.add(normalizedUrl)
    productUrls.push(normalizedUrl)
    discovered++
    batchNew++
  }

  const batchDurationMs = Date.now() - batchStartMs
  log.info('Product discovery progress', { jobId, discovered, batchNew, done })
  jlog.event('discovery.batch_persisted', {
    source: source ?? 'unknown',
    discovered,
    batchSize: products.length,
    batchPersisted: batchNew,
    batchErrors: 0,
    batchDurationMs,
    pagesUsed: body.pagesUsed,
  })

  if (done) {
    const jobStartedAt = (job.startedAt as string) || (job.claimedAt as string) || (job.createdAt as string)
    const jobDurationMs = jobStartedAt ? Date.now() - new Date(jobStartedAt).getTime() : 0

    await payload.update({
      collection: 'product-discoveries',
      id: jobId,
      data: {
        status: 'completed',
        discovered,
        productUrls: productUrls.join('\n'),
        progress: null,
        completedAt: new Date().toISOString(),
      },
    })
    jlog.event('discovery.completed', { source: source ?? 'unknown', discovered, durationMs: jobDurationMs })
  } else {
    await payload.update({
      collection: 'product-discoveries',
      id: jobId,
      data: {
        status: 'in_progress',
        discovered,
        productUrls: productUrls.join('\n'),
        progress: { currentUrlIndex, driverProgress },
        claimedBy: null,
        claimedAt: null,
        ...(!job.startedAt ? { startedAt: new Date().toISOString() } : {}),
      },
    })
  }

  return { discovered, done }
}

async function submitProductSearch(payload: PayloadRestClient, body: SubmitProductSearchBody) {
  const { jobId, products } = body
  const jlog = log.forJob('product-searches', jobId)
  const batchStartMs = Date.now()
  log.info('Product search batch received', { jobId, products: products.length })

  // Just accumulate discovered URLs — no source-product creation
  const job = await payload.findByID({ collection: 'product-searches', id: jobId }) as Record<string, unknown>
  const productUrls: string[] = ((job.productUrls as string) ?? '').split('\n').filter(Boolean)
  const seenProductUrls = new Set<string>(productUrls)

  let discovered = 0
  for (const { product } of products) {
    const normalizedUrl = normalizeProductUrl(product.productUrl)
    if (seenProductUrls.has(normalizedUrl)) continue
    seenProductUrls.add(normalizedUrl)
    productUrls.push(normalizedUrl)
    discovered++
  }

  const batchDurationMs = Date.now() - batchStartMs
  const sources = [...new Set(products.map(p => p.source))].join(',')
  log.info('Product search progress', { jobId, discovered })
  jlog.event('search.batch_persisted', { sources, discovered, persisted: discovered, batchDurationMs })

  await payload.update({
    collection: 'product-searches',
    id: jobId,
    data: {
      status: 'completed',
      discovered,
      productUrls: productUrls.join('\n'),
      completedAt: new Date().toISOString(),
      claimedBy: null,
      claimedAt: null,
    },
  })
  jlog.event('search.completed', { sources, discovered, durationMs: batchDurationMs })

  return { discovered }
}

async function submitIngredientsDiscovery(payload: PayloadRestClient, body: SubmitIngredientsDiscoveryBody) {
  const { jobId, ingredients, currentTerm, currentPage, totalPagesForTerm, termQueue, done } = body
  const jlog = log.forJob('ingredients-discoveries', jobId)
  const batchStartMs = Date.now()
  log.info('Ingredients discovery batch received', { jobId, ingredients: ingredients.length, done })

  const job = await payload.findByID({ collection: 'ingredients-discoveries', id: jobId }) as Record<string, unknown>
  let created = (job.created as number) ?? 0
  let existing = (job.existing as number) ?? 0
  let discovered = (job.discovered as number) ?? 0
  let errors = (job.errors as number) ?? 0

  let batchPersisted = 0
  for (const ingredient of ingredients) {
    discovered++
    try {
      const result = await persistIngredient(payload, ingredient)
      batchPersisted++
      if (result.isNew) {
        created++
      } else {
        existing++
      }
    } catch (e) {
      log.error('Ingredient persist error', { jobId, ingredient: ingredient.name, error: e instanceof Error ? e.message : String(e) })
      errors++
    }
  }

  const batchDurationMs = Date.now() - batchStartMs
  log.info('Ingredients discovery progress', { jobId, created, existing, errors, done })
  jlog.event('ingredients_discovery.batch_persisted', { discovered, created, existing, errors, batchSize: ingredients.length, batchDurationMs })

  if (done && batchPersisted === 0 && ingredients.length > 0) {
    log.warn('Ingredients discovery batch had zero successful persists, retrying or failing', { jobId, ingredients: ingredients.length })
    await retryOrFail(payload, 'ingredients-discoveries', jobId, `Batch of ${ingredients.length} ingredients all failed to persist`)
    return { discovered, created, existing, errors, done }
  }

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
    const jobStartedAt = (job.startedAt as string) || (job.claimedAt as string) || (job.createdAt as string)
    const jobDurationMs = jobStartedAt ? Date.now() - new Date(jobStartedAt).getTime() : 0
    jlog.event('ingredients_discovery.completed', { discovered, created, existing, errors, durationMs: jobDurationMs })
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
        claimedBy: null,
        claimedAt: null,
        ...(!job.startedAt ? { startedAt: new Date().toISOString() } : {}),
      },
    })
  }

  return { discovered, created, existing, errors, done }
}

async function submitVideoDiscovery(payload: PayloadRestClient, body: SubmitVideoDiscoveryBody) {
  const { jobId, channelUrl, videos, reachedEnd, nextOffset, maxVideos } = body
  const jlog = log.forJob('video-discoveries', jobId)
  const batchStartMs = Date.now()
  log.info('Video discovery batch received', { jobId, videos: videos.length, reachedEnd, nextOffset })

  const job = await payload.findByID({ collection: 'video-discoveries', id: jobId }) as Record<string, unknown>

  const result = await persistVideoDiscoveryResult(payload, jobId, channelUrl, videos)

  const batchPersisted = result.created + result.existing
  const totalDiscovered = ((job.discovered as number) ?? 0) + videos.length
  const totalCreated = ((job.created as number) ?? 0) + result.created
  const totalExisting = ((job.existing as number) ?? 0) + result.existing

  // Done if: yt-dlp returned fewer videos than requested (end of channel),
  // or we've hit the maxVideos limit
  const hitMaxVideos = maxVideos !== undefined && nextOffset >= maxVideos
  const allDone = reachedEnd || hitMaxVideos

  const batchDurationMs = Date.now() - batchStartMs
  log.info('Video discovery progress', { jobId, batchCreated: result.created, batchExisting: result.existing, totalCreated, totalExisting, totalDiscovered, done: allDone })
  jlog.event('video_discovery.batch_persisted', { discovered: totalDiscovered, created: totalCreated, existing: totalExisting, batchSize: videos.length, batchDurationMs })

  if (allDone && batchPersisted === 0 && videos.length > 0) {
    log.warn('Video discovery batch had zero successful persists, retrying or failing', { jobId, videos: videos.length })
    await retryOrFail(payload, 'video-discoveries', jobId, `Batch of ${videos.length} videos all failed to persist`)
    return { created: result.created, existing: result.existing, done: allDone }
  }

  if (allDone) {
    await payload.update({
      collection: 'video-discoveries',
      id: jobId,
      data: {
        status: 'completed',
        discovered: totalDiscovered,
        created: totalCreated,
        existing: totalExisting,
        progress: null,
        completedAt: new Date().toISOString(),
      },
    })
    const jobStartedAt = (job.startedAt as string) || (job.claimedAt as string) || (job.createdAt as string)
    const jobDurationMs = jobStartedAt ? Date.now() - new Date(jobStartedAt).getTime() : 0
    jlog.event('video_discovery.completed', { discovered: totalDiscovered, created: totalCreated, existing: totalExisting, durationMs: jobDurationMs })
  } else {
    await payload.update({
      collection: 'video-discoveries',
      id: jobId,
      data: {
        discovered: totalDiscovered,
        created: totalCreated,
        existing: totalExisting,
        progress: { currentOffset: nextOffset },
        claimedBy: null,
        claimedAt: null,
      },
    })
  }

  return { created: result.created, existing: result.existing, done: allDone }
}

async function submitVideoProcessing(payload: PayloadRestClient, body: SubmitVideoProcessingBody) {
  const { jobId, results } = body
  const jlog = log.forJob('video-processings', jobId)
  const batchStartMs = Date.now()
  log.info('Video processing batch received', { jobId, videos: results.length })

  const job = await payload.findByID({ collection: 'video-processings', id: jobId }) as Record<string, unknown>
  let processed = (job.processed as number) ?? 0
  let errors = (job.errors as number) ?? 0
  let tokensUsed = (job.tokensUsed as number) ?? 0
  let tokensRecognition = (job.tokensRecognition as number) ?? 0
  let tokensTranscriptCorrection = (job.tokensTranscriptCorrection as number) ?? 0
  let tokensSentiment = (job.tokensSentiment as number) ?? 0

  for (const result of results) {
    // Always accumulate tokens, regardless of success/failure
    tokensUsed += result.tokensUsed ?? 0
    tokensRecognition += result.tokensRecognition ?? 0
    tokensTranscriptCorrection += result.tokensTranscriptCorrection ?? 0
    tokensSentiment += result.tokensSentiment ?? 0

    if (result.success && result.segments) {
      try {
        await persistVideoProcessingResult(
          payload,
          jobId,
          result.videoId,
          result.videoMediaId,
          result.segments,
          result.transcriptData,
          result.snippetTranscripts,
          result.snippetVideoQuotes,
        )
        processed++
        log.info('Video processing persisted', { jobId, videoId: result.videoId, segments: result.segments.length, tokens: result.tokensUsed ?? 0 })
      } catch (e) {
        errors++
        const msg = e instanceof Error ? e.message : String(e)
        log.error('Video processing persist failed', { jobId, videoId: result.videoId, error: msg })
        jlog.event('video_processing.persist_failed', { videoId: String(result.videoId), error: msg })
      }
    } else {
      errors++
      log.info('Video processing failed', { jobId, videoId: result.videoId, error: result.error })
      jlog.event('video_processing.error', { videoId: String(result.videoId), error: result.error ?? 'Unknown error' })
    }
  }

  // Check if all done
  const total = (job.total as number) ?? 0
  const allDone = processed + errors >= total
  const batchDurationMs = Date.now() - batchStartMs
  log.info('Video processing progress', { jobId, processed, errors, tokensUsed, done: allDone, completed: processed + errors, total })

  if (allDone && processed === 0) {
    log.warn('Video processing completed with zero successes, retrying or failing', { jobId, errors, total })
    await retryOrFail(payload, 'video-processings', jobId, `All ${errors} videos failed to process`)
    return { processed, errors, tokensUsed, done: allDone }
  }

  if (allDone) {
    await payload.update({
      collection: 'video-processings',
      id: jobId,
      data: {
        status: 'completed',
        processed,
        errors,
        tokensUsed,
        tokensRecognition,
        tokensTranscriptCorrection,
        tokensSentiment,
        completedAt: new Date().toISOString(),
      },
    })
    const jobStartedAt = (job.startedAt as string) || (job.claimedAt as string) || (job.createdAt as string)
    const jobDurationMs = jobStartedAt ? Date.now() - new Date(jobStartedAt).getTime() : 0
    jlog.event('video_processing.completed', { processed, errors, tokensUsed, durationMs: jobDurationMs })
  } else {
    await payload.update({
      collection: 'video-processings',
      id: jobId,
      data: { processed, errors, tokensUsed, tokensRecognition, tokensTranscriptCorrection, tokensSentiment, claimedBy: null, claimedAt: null },
    })
    jlog.event('video_processing.batch_done', { processed, errors, batchSize: results.length, batchDurationMs })
  }

  return { processed, errors, tokensUsed, done: allDone }
}

async function submitProductAggregation(payload: PayloadRestClient, body: SubmitProductAggregationBody) {
  const { jobId, lastCheckedSourceId, aggregationType, scope, results } = body
  const jlog = log.forJob('product-aggregations', jobId)
  const batchStartMs = Date.now()
  log.info('Product aggregation batch received', { jobId, results: results.length, aggregationType, scope })

  const job = await payload.findByID({ collection: 'product-aggregations', id: jobId }) as Record<string, unknown>
  let aggregated = (job.aggregated as number) ?? 0
  let errors = (job.errors as number) ?? 0
  let tokensUsed = (job.tokensUsed as number) ?? 0

  // Accumulate product IDs from previous batches
  const existingProductIds = ((job.products ?? []) as unknown[]).map((p: unknown) =>
    typeof p === 'object' && p !== null && 'id' in p ? (p as { id: number }).id : p as number,
  )
  const productIds = new Set<number>(existingProductIds)

  let batchSuccesses = 0
  for (const result of results) {
    const gtinLabels = (result.gtins as string[])?.join(', ') || 'unknown'

    if (result.error || !result.variantResults) {
      errors++
      log.info('Product aggregation error', { jobId, gtins: gtinLabels, error: result.error ?? 'no data' })
      if (result.error) {
        jlog.event('aggregation.error', { gtin: gtinLabels, error: result.error! })
      }
      continue
    }

    try {
      const persistResult = await persistProductAggregationResult(payload, jobId, {
        variantResults: result.variantResults,
        sourceProductIds: result.sourceProductIds,
        productData: result.productData,
        classification: result.classification,
        classifySourceProductIds: result.classifySourceProductIds,
        scope: scope as 'full' | 'partial',
      })

      tokensUsed += persistResult.tokensUsed
      tokensUsed += result.tokensUsed // classification tokens from worker

      if (persistResult.error) {
        errors++
        log.info('Product aggregation persist error', { jobId, gtins: gtinLabels, productId: persistResult.productId, error: persistResult.error.slice(0, 100) })
        jlog.event('aggregation.persist_error', { gtin: gtinLabels, error: persistResult.error })
      } else {
        aggregated++
        batchSuccesses++
        log.info('Product aggregation persisted', { jobId, gtins: gtinLabels, productId: persistResult.productId, variants: (result.variantResults as unknown[]).length, tokens: persistResult.tokensUsed, hasWarning: !!persistResult.warning })
        if (persistResult.warning) {
          jlog.event('aggregation.warning', { gtin: gtinLabels, warning: persistResult.warning! })
        }
      }

      if (persistResult.productId) {
        productIds.add(persistResult.productId)
      }

      // Update progress with accumulated products
      await payload.update({
        collection: 'product-aggregations',
        id: jobId,
        data: {
          aggregated,
          errors,
          tokensUsed,
          products: [...productIds],
          ...(aggregationType === 'all' ? { lastCheckedSourceId } : {}),
        },
      })
    } catch (e) {
      errors++
      const msg = e instanceof Error ? e.message : String(e)
      jlog.event('aggregation.persist_failed', { gtin: gtinLabels, error: msg })
    }
  }

  // Completion check
  const shouldComplete =
    aggregationType === 'selected_gtins' ||
    (aggregationType === 'all' && results.length === 0)

  const batchDurationMs = Date.now() - batchStartMs
  log.info('Product aggregation progress', { jobId, aggregated, errors, tokensUsed, done: shouldComplete })

  if (shouldComplete && batchSuccesses === 0 && results.length > 0) {
    log.warn('Product aggregation batch was 100% errors, retrying or failing', { jobId, batchErrors: results.length })
    await retryOrFail(payload, 'product-aggregations', jobId, `Batch of ${results.length} aggregations all failed`)
    return { aggregated, errors, tokensUsed, done: shouldComplete }
  }

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
    const jobStartedAt = (job.startedAt as string) || (job.claimedAt as string) || (job.createdAt as string)
    const jobDurationMs = jobStartedAt ? Date.now() - new Date(jobStartedAt).getTime() : 0
    jlog.event('aggregation.completed', { aggregated, errors, tokensUsed, durationMs: jobDurationMs })
  } else {
    await payload.update({
      collection: 'product-aggregations',
      id: jobId,
      data: {
        aggregated,
        errors,
        tokensUsed,
        claimedBy: null,
        claimedAt: null,
        ...(aggregationType === 'all' ? { lastCheckedSourceId } : {}),
      },
    })
    jlog.event('aggregation.batch_done', { aggregated, errors, batchSize: results.length, batchDurationMs })
  }

  return { aggregated, errors, tokensUsed, done: shouldComplete }
}

// ─── Ingredient Crawl ───

async function submitIngredientCrawl(payload: PayloadRestClient, body: SubmitIngredientCrawlBody) {
  const { jobId, lastCheckedIngredientId, crawlType, results } = body
  const jlog = log.forJob('ingredient-crawls', jobId)
  const batchStartMs = Date.now()
  log.info('Ingredient crawl batch received', { jobId, results: results.length, crawlType })

  const job = await payload.findByID({ collection: 'ingredient-crawls', id: jobId }) as Record<string, unknown>
  let crawled = (job.crawled as number) ?? 0
  let errors = (job.errors as number) ?? 0
  let tokensUsed = (job.tokensUsed as number) ?? 0

  // Accumulate ingredient IDs from previous batches
  const existingIngredientIds = ((job.ingredients ?? []) as unknown[]).map((i: unknown) =>
    typeof i === 'object' && i !== null && 'id' in i ? (i as { id: number }).id : i as number,
  )
  const ingredientIds = new Set<number>(existingIngredientIds)

  let batchSuccesses = 0
  let batchWithInciDecoder = 0
  for (const result of results) {
    if (result.error) {
      errors++
      jlog.event('ingredient_crawl.error', { ingredientId: result.ingredientId, ingredient: result.ingredientName, error: result.error! })
      continue
    }

    try {
      const updateData: Record<string, unknown> = {
        status: 'crawled',
        crawledAt: new Date().toISOString(),
      }
      if (result.longDescription) updateData.longDescription = result.longDescription
      if (result.shortDescription) updateData.shortDescription = result.shortDescription
      if (result.imageMediaId) updateData.image = result.imageMediaId

      // Add INCIDecoder source if we found data (longDescription present means INCIDecoder had content)
      if (result.longDescription && result.sourceUrl) {
        const inciDecoderFieldsProvided = [
          ...(result.longDescription ? ['longDescription'] : []),
          // shortDescription is LLM-generated from longDescription, not scraped — excluded from fieldsProvided
          ...(result.imageMediaId ? ['image'] : []),
        ]
        const ingredientDoc = await payload.findByID({ collection: 'ingredients', id: result.ingredientId }) as Record<string, unknown>
        const existingSources = (ingredientDoc.sources as Array<{ source: string; fieldsProvided?: string[] }>) ?? []
        const inciIdx = existingSources.findIndex((s) => s.source === 'incidecoder')
        if (inciIdx === -1) {
          updateData.sources = [...existingSources, { source: 'incidecoder', sourceUrl: result.sourceUrl, fieldsProvided: inciDecoderFieldsProvided }]
        } else if (!existingSources[inciIdx].fieldsProvided?.length) {
          // Backfill fieldsProvided on existing INCIDecoder source entry
          const updated = [...existingSources]
          updated[inciIdx] = { ...updated[inciIdx], fieldsProvided: inciDecoderFieldsProvided }
          updateData.sources = updated
        }
      }

      await payload.update({
        collection: 'ingredients',
        id: result.ingredientId,
        data: updateData,
      })

      tokensUsed += result.tokensUsed
      crawled++
      batchSuccesses++
      if (result.longDescription) batchWithInciDecoder++
      ingredientIds.add(result.ingredientId)
      log.info('Ingredient crawl persisted', { jobId, ingredientId: result.ingredientId, ingredient: result.ingredientName, hasInciDecoder: !!result.longDescription })
    } catch (e) {
      errors++
      const msg = e instanceof Error ? e.message : String(e)
      jlog.event('ingredient_crawl.persist_failed', { ingredientId: result.ingredientId, ingredient: result.ingredientName, error: msg })
    }
  }

  // Completion check
  const shouldComplete =
    crawlType === 'selected' ||
    (crawlType === 'all_uncrawled' && results.length === 0)

  if (shouldComplete && batchSuccesses === 0 && results.length > 0) {
    log.warn('Ingredient crawl batch was 100% errors, retrying or failing', { jobId, batchErrors: results.length })
    await retryOrFail(payload, 'ingredient-crawls', jobId, `Batch of ${results.length} ingredients all failed`)
    return { crawled, errors, tokensUsed, done: shouldComplete }
  }

  if (shouldComplete) {
    await payload.update({
      collection: 'ingredient-crawls',
      id: jobId,
      data: {
        status: 'completed',
        crawled,
        errors,
        tokensUsed,
        ingredients: [...ingredientIds],
        completedAt: new Date().toISOString(),
      },
    })
    const jobStartedAt = (job.startedAt as string) || (job.claimedAt as string) || (job.createdAt as string)
    const jobDurationMs = jobStartedAt ? Date.now() - new Date(jobStartedAt).getTime() : 0
    jlog.event('ingredient_crawl.completed', { crawled, errors, tokensUsed, durationMs: jobDurationMs, withInciDecoder: batchWithInciDecoder })
  } else {
    const batchDurationMs = Date.now() - batchStartMs
    await payload.update({
      collection: 'ingredient-crawls',
      id: jobId,
      data: {
        crawled,
        errors,
        tokensUsed,
        ingredients: [...ingredientIds],
        claimedBy: null,
        claimedAt: null,
        ...(crawlType === 'all_uncrawled' ? { lastCheckedIngredientId } : {}),
      },
    })
    jlog.event('ingredient_crawl.batch_done', { crawled, errors, batchSize: results.length, batchDurationMs, withInciDecoder: batchWithInciDecoder })
  }

  return { crawled, errors, tokensUsed, done: shouldComplete }
}
