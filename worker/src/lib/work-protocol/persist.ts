import type { PayloadRestClient } from '@/lib/payload-client'
import type { SourceSlug } from '@/lib/source-product-queries'
import { getSourceSlugFromUrl, normalizeProductUrl } from '@/lib/source-product-queries'

import { matchProduct } from '@/lib/match-product'
import { matchBrand } from '@/lib/match-brand'
import { matchIngredients } from '@/lib/match-ingredients'
import { createLogger, type JobCollection } from '@/lib/logger'

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
  channelAvatarUrl?: string
}

// ─── Product Crawl ───

export interface PersistCrawlResultInput {
  crawlId: number
  sourceProductId: number
  sourceUrl: string
  source: SourceSlug
  data: ScrapedProductData
}

export async function persistCrawlResult(
  payload: PayloadRestClient,
  input: PersistCrawlResultInput,
): Promise<{ productId: number; warnings: string[] }> {
  const { crawlId, sourceProductId, source, data } = input
  const sourceUrl = normalizeProductUrl(input.sourceUrl)
  const jlog = log.forJob('product-crawls' as JobCollection, crawlId)
  log.info(`persistCrawlResult: crawl #${crawlId}, sourceProduct #${sourceProductId}, source=${source}`)
  const warnings = [...data.warnings]

  // Build category breadcrumb string
  const categoryBreadcrumb = data.categoryBreadcrumbs && data.categoryBreadcrumbs.length > 0
    ? data.categoryBreadcrumbs.join(' -> ')
    : null

  // Find existing product
  const existing = await payload.find({
    collection: 'source-products',
    where: {
      and: [
        { sourceUrl: { equals: sourceUrl } },
        { or: [{ source: { equals: source } }, { source: { exists: false } }] },
      ],
    },
    limit: 1,
  })

  const now = new Date().toISOString()
  const priceEntry = {
    recordedAt: now,
    amount: data.priceCents ?? null,
    currency: data.currency ?? 'EUR',
    perUnitAmount: data.perUnitAmount ?? null,
    perUnitCurrency: data.perUnitAmount ? (data.currency ?? 'EUR') : null,
    perUnitQuantity: data.perUnitQuantity ?? null,
    unit: data.perUnitUnit ?? null,
  }

  const existingHistory = existing.docs.length > 0
    ? ((existing.docs[0] as Record<string, unknown>).priceHistory as unknown[] ?? [])
    : []

  const productPayload = {
    ...(data.gtin ? { gtin: data.gtin } : {}),
    status: 'crawled' as const,
    sourceArticleNumber: data.sourceArticleNumber ?? null,
    brandName: data.brandName ?? null,
    name: data.name,
    ...(categoryBreadcrumb ? { categoryBreadcrumb } : {}),
    description: data.description ?? null,
    amount: data.amount ?? null,
    amountUnit: data.amountUnit ?? null,
    labels: data.labels?.map((l) => ({ label: l })) ?? [],
    images: data.images,
    variants: data.variants,
    priceHistory: [priceEntry, ...existingHistory],
    rating: data.rating ?? null,
    ratingNum: data.ratingNum ?? null,
    ingredients: data.ingredientNames.map((n) => ({ name: n })),
    sourceUrl: data.canonicalUrl ? normalizeProductUrl(data.canonicalUrl) : sourceUrl,
  }

  let productId: number

  if (existing.docs.length > 0) {
    productId = (existing.docs[0] as Record<string, unknown>).id as number
    log.info(`persistCrawlResult: updating existing source-product #${productId}`)
    await payload.update({
      collection: 'source-products',
      id: productId,
      data: { source, ...productPayload },
    })
  } else {
    const newProduct = await payload.create({
      collection: 'source-products',
      data: { source, ...productPayload },
    }) as { id: number }
    productId = newProduct.id
    log.info(`persistCrawlResult: created new source-product #${productId}`)
  }

  // Mark source-product status
  await payload.update({
    collection: 'source-products',
    id: sourceProductId,
    data: { status: 'crawled' },
  })

  // Create CrawlResult join record
  await payload.create({
    collection: 'crawl-results',
    data: { crawl: crawlId, sourceProduct: productId },
  })

  // Log warnings
  if (warnings.length > 0) {
    log.info(`persistCrawlResult: source-product #${productId} has ${warnings.length} warning(s)`)
  }
  for (const warning of warnings) {
    jlog.warn(warning, { event: true })
  }

  return { productId, warnings }
}

export async function persistCrawlFailure(
  payload: PayloadRestClient,
  crawlId: number,
  sourceProductId: number,
  error: string,
): Promise<void> {
  await payload.create({
    collection: 'crawl-results',
    data: { crawl: crawlId, sourceProduct: sourceProductId, error },
  })
}

// ─── Product Discovery ───

export interface PersistDiscoveredProductInput {
  discoveryId: number
  product: DiscoveredProduct
  source: SourceSlug
}

export async function persistDiscoveredProduct(
  payload: PayloadRestClient,
  input: PersistDiscoveredProductInput,
): Promise<{ sourceProductId: number; isNew: boolean }> {
  const { discoveryId, product, source } = input
  const normalizedUrl = normalizeProductUrl(product.productUrl)
  const effectiveSource = getSourceSlugFromUrl(normalizedUrl) ?? source
  log.info(`persistDiscoveredProduct: discovery #${discoveryId}, url=${normalizedUrl}, source=${effectiveSource}`)

  const existingProduct = await payload.find({
    collection: 'source-products',
    where: {
      and: [
        { sourceUrl: { equals: normalizedUrl } },
        { or: [{ source: { equals: effectiveSource } }, { source: { exists: false } }] },
      ],
    },
    limit: 1,
  })

  const now = new Date().toISOString()
  const priceEntry = product.price != null ? {
    recordedAt: now,
    amount: product.price,
    currency: product.currency ?? 'EUR',
  } : null

  const discoveryData = {
    sourceUrl: normalizedUrl,
    brandName: product.brandName,
    name: product.name,
    categoryBreadcrumb: product.category ?? null,
    rating: product.rating,
    ratingNum: product.ratingCount,
    ...(product.gtin ? { gtin: product.gtin } : {}),
  }

  let sourceProductId: number
  let isNew: boolean

  if (existingProduct.docs.length === 0) {
    const newProduct = await payload.create({
      collection: 'source-products',
      data: {
        source: effectiveSource,
        status: 'uncrawled',
        ...discoveryData,
        priceHistory: priceEntry ? [priceEntry] : [],
      },
    }) as { id: number }
    sourceProductId = newProduct.id
    isNew = true
    log.info(`persistDiscoveredProduct: created new source-product #${sourceProductId}`)
  } else {
    sourceProductId = (existingProduct.docs[0] as Record<string, unknown>).id as number
    const existingHistory = (existingProduct.docs[0] as Record<string, unknown>).priceHistory as unknown[] ?? []
    await payload.update({
      collection: 'source-products',
      id: sourceProductId,
      data: {
        source: effectiveSource,
        ...discoveryData,
        ...(priceEntry ? { priceHistory: [...existingHistory, priceEntry] } : {}),
      },
    })
    isNew = false
    log.info(`persistDiscoveredProduct: updated existing source-product #${sourceProductId}`)
  }

  // Create DiscoveryResult join record
  await payload.create({
    collection: 'discovery-results',
    data: { discovery: discoveryId, sourceProduct: sourceProductId },
  })

  return { sourceProductId, isNew }
}

// ─── Ingredients Discovery ───

export async function persistIngredient(
  payload: PayloadRestClient,
  data: ScrapedIngredientData,
): Promise<{ isNew: boolean }> {
  const existing = await payload.find({
    collection: 'ingredients',
    where: { name: { equals: data.name } },
    limit: 1,
  })

  if (existing.docs.length === 0) {
    try {
      await payload.create({
        collection: 'ingredients',
        data: {
          name: data.name,
          casNumber: data.casNumber ?? null,
          ecNumber: data.ecNumber ?? null,
          cosIngId: data.cosIngId ?? null,
          chemicalDescription: data.chemicalDescription ?? null,
          functions: data.functions.map((f) => ({ function: f })),
          itemType: data.itemType,
          restrictions: data.restrictions ?? null,
          sourceUrl: data.sourceUrl ?? null,
          status: 'pending',
        },
      })
      return { isNew: true }
    } catch (createError: unknown) {
      const errorMessage = createError instanceof Error ? createError.message : String(createError)
      if (
        errorMessage.includes('name') ||
        errorMessage.includes('unique') ||
        errorMessage.includes('duplicate')
      ) {
        return { isNew: false }
      }
      throw createError
    }
  } else {
    const doc = existing.docs[0] as Record<string, unknown>
    const updates: Record<string, unknown> = {}

    if (!doc.casNumber && data.casNumber) updates.casNumber = data.casNumber
    if (!doc.ecNumber && data.ecNumber) updates.ecNumber = data.ecNumber
    if (!doc.cosIngId && data.cosIngId) updates.cosIngId = data.cosIngId
    if (!doc.chemicalDescription && data.chemicalDescription)
      updates.chemicalDescription = data.chemicalDescription
    if (!doc.sourceUrl && data.sourceUrl) updates.sourceUrl = data.sourceUrl
    if (!doc.itemType && data.itemType) updates.itemType = data.itemType
    if (!doc.restrictions && data.restrictions) updates.restrictions = data.restrictions
    if ((!doc.functions || (doc.functions as unknown[]).length === 0) && data.functions.length > 0) {
      updates.functions = data.functions.map((f) => ({ function: f }))
    }

    if (Object.keys(updates).length > 0) {
      await payload.update({
        collection: 'ingredients',
        id: doc.id as number,
        data: updates,
      })
    }
    return { isNew: false }
  }
}

// ─── Video Discovery ───

export async function persistVideoDiscoveryResult(
  payload: PayloadRestClient,
  jobId: number,
  channelUrl: string,
  videos: DiscoveredVideo[],
  offset: number,
  batchSize: number,
): Promise<{ created: number; existing: number }> {
  // Derive canonical URL from yt-dlp's channel_url (e.g. /channel/UC...)
  const canonicalUrl = videos[0]?.channelUrl ?? undefined

  // Find existing channel by any known URL variant
  const urlClauses: Array<Record<string, unknown>> = [
    { externalUrl: { equals: channelUrl } },
  ]
  if (canonicalUrl && canonicalUrl !== channelUrl) {
    urlClauses.push(
      { externalUrl: { equals: canonicalUrl } },
      { canonicalUrl: { equals: channelUrl } },
      { canonicalUrl: { equals: canonicalUrl } },
    )
  }
  const existingChannel = await payload.find({
    collection: 'channels',
    where: urlClauses.length > 1 ? { or: urlClauses } : urlClauses[0],
    limit: 1,
  })

  // Download channel avatar if available (used for both new and existing channels)
  const channelAvatarUrl = videos[0]?.channelAvatarUrl
  let channelImageId: number | undefined
  if (channelAvatarUrl) {
    try {
      const res = await fetch(channelAvatarUrl)
      if (res.ok) {
        const buffer = Buffer.from(await res.arrayBuffer())
        const contentType = res.headers.get('content-type') || 'image/jpeg'
        const ext = contentType.includes('png') ? 'png' : 'jpg'
        // Derive a stable filename from the channel URL
        const channelSlug = channelUrl.replace(/[^a-zA-Z0-9@_-]/g, '_').slice(-60)
        const media = await payload.create({
          collection: 'media',
          data: { alt: videos[0]?.channelName ?? 'Channel avatar' },
          file: {
            data: buffer,
            mimetype: contentType,
            name: `channel-avatar-${channelSlug}.${ext}`,
            size: buffer.length,
          },
        }) as { id: number }
        channelImageId = media.id
      }
    } catch (e) {
      log.warn(`Failed to download channel avatar from ${channelAvatarUrl}: ${String(e)}`)
    }
  }

  let channelId: number
  if (existingChannel.docs.length > 0) {
    channelId = (existingChannel.docs[0] as { id: number }).id

    // Always update channel: set image and backfill canonical URL
    const channelUpdate: Record<string, unknown> = {}
    if (channelImageId) channelUpdate.image = channelImageId
    if (canonicalUrl) channelUpdate.canonicalUrl = canonicalUrl
    if (Object.keys(channelUpdate).length > 0) {
      await payload.update({
        collection: 'channels',
        id: channelId,
        data: channelUpdate,
      })
    }
  } else {
    // Derive creator name from first video
    const creatorName = videos[0]?.channelName ?? 'Unknown'

    // Find or create creator
    const existingCreator = await payload.find({
      collection: 'creators',
      where: { name: { equals: creatorName } },
      limit: 1,
    })

    let creatorId: number
    if (existingCreator.docs.length > 0) {
      creatorId = (existingCreator.docs[0] as { id: number }).id
    } else {
      const newCreator = await payload.create({
        collection: 'creators',
        data: { name: creatorName },
      }) as { id: number }
      creatorId = newCreator.id
    }

    // Determine platform from URL
    let platform: 'youtube' | 'instagram' | 'tiktok' = 'youtube'
    try {
      const host = new URL(channelUrl).hostname.toLowerCase()
      if (host.includes('instagram')) platform = 'instagram'
      else if (host.includes('tiktok')) platform = 'tiktok'
    } catch { /* default youtube */ }

    const newChannel = await payload.create({
      collection: 'channels',
      data: {
        creator: creatorId,
        platform,
        externalUrl: channelUrl,
        ...(canonicalUrl ? { canonicalUrl } : {}),
        ...(channelImageId ? { image: channelImageId } : {}),
      },
    }) as { id: number }
    channelId = newChannel.id
  }

  // Process batch
  const batch = videos.slice(offset, offset + batchSize)
  let created = 0
  let existing = 0

  for (const video of batch) {
    const existingVideo = await payload.find({
      collection: 'videos',
      where: { externalUrl: { equals: video.externalUrl } },
      limit: 1,
    })

    // Download and upload thumbnail
    let imageId: number | undefined
    const existingHasImage = existingVideo.docs.length > 0 && (existingVideo.docs[0] as Record<string, unknown>).image
    if (video.thumbnailUrl && !existingHasImage) {
      try {
        const res = await fetch(video.thumbnailUrl)
        if (res.ok) {
          const buffer = Buffer.from(await res.arrayBuffer())
          const contentType = res.headers.get('content-type') || 'image/jpeg'
          const ext = contentType.includes('png') ? 'png' : 'jpg'
          const media = await payload.create({
            collection: 'media',
            data: { alt: video.title },
            file: {
              data: buffer,
              mimetype: contentType,
              name: `${video.externalId}.${ext}`,
              size: buffer.length,
            },
          }) as { id: number }
          imageId = media.id
        }
      } catch (e) {
        log.warn(`Failed to download thumbnail for ${video.externalUrl}: ${String(e)}`)
      }
    }

    const publishedAt = video.uploadDate
      ? new Date(video.uploadDate).toISOString()
      : (video.timestamp ? new Date(video.timestamp * 1000).toISOString() : undefined)

    const videoData = {
      channel: channelId,
      title: video.title,
      externalUrl: video.externalUrl,
      ...(publishedAt ? { publishedAt } : {}),
      duration: video.duration,
      viewCount: video.viewCount,
      likeCount: video.likeCount,
      ...(imageId ? { image: imageId } : {}),
    }

    if (existingVideo.docs.length === 0) {
      await payload.create({
        collection: 'videos',
        data: videoData,
      })
      created++
    } else {
      await payload.update({
        collection: 'videos',
        id: (existingVideo.docs[0] as { id: number }).id,
        data: videoData,
      })
      existing++
    }
  }

  return { created, existing }
}

// ─── Video Processing ───

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

export async function persistVideoProcessingResult(
  payload: PayloadRestClient,
  jobId: number,
  videoId: number,
  videoMediaId: number | undefined,
  segments: VideoProcessingSegment[],
  transcriptData?: TranscriptData,
  snippetTranscripts?: SnippetTranscript[],
  snippetVideoQuotes?: VideoQuoteData[][],
): Promise<void> {
  const jlog = log.forJob('video-processings' as JobCollection, jobId)
  log.info(`persistVideoProcessingResult: video #${videoId}, ${segments.length} segments`)

  // Delete existing snippets and their video-mentions for this video
  const existingSnippets = await payload.find({
    collection: 'video-snippets',
    where: { video: { equals: videoId } },
    limit: 1000,
  })
  if (existingSnippets.docs.length > 0) {
    // Delete video-mentions for existing snippets
    for (const snippet of existingSnippets.docs) {
      const snippetId = (snippet as { id: number }).id
      await payload.delete({
        collection: 'video-mentions',
        where: { videoSnippet: { equals: snippetId } },
      })
    }
    await payload.delete({
      collection: 'video-snippets',
      where: { video: { equals: videoId } },
    })
    log.info(`Deleted ${existingSnippets.docs.length} existing snippets (and their video-mentions) for video #${videoId}`)
  }

  for (let segIdx = 0; segIdx < segments.length; segIdx++) {
    const segment = segments[segIdx]
    let referencedProductIds: number[] = []

    if (segment.matchingType === 'barcode' && segment.barcode) {
      // Look up product by GTIN
      const products = await payload.find({
        collection: 'products',
        where: { gtin: { equals: segment.barcode } },
        limit: 1,
      })
      if (products.docs.length > 0) {
        referencedProductIds = [(products.docs[0] as { id: number }).id]
        log.info(`GTIN ${segment.barcode} → product #${(products.docs[0] as { id: number }).id}`)
      } else {
        log.info(`No product found for GTIN ${segment.barcode}`)
      }
    } else if (segment.matchingType === 'visual' && segment.recognitionResults) {
      // Match each recognition result via DB + LLM
      for (const recog of segment.recognitionResults) {
        if (recog.brand || recog.productName || recog.searchTerms.length > 0) {
          const matchResult = await matchProduct(payload, recog.brand, recog.productName, recog.searchTerms, jlog)
          if (matchResult) {
            referencedProductIds.push(matchResult.productId)
            log.info(`Cluster ${recog.clusterGroup} → product #${matchResult.productId} ("${matchResult.productName}")`)
          }
        }
      }
      // Deduplicate
      referencedProductIds = [...new Set(referencedProductIds)]
    }

    // Build screenshot entries for Payload
    const screenshotEntries = segment.screenshots.map((s) => ({
      image: s.imageMediaId,
      ...(s.barcode ? { barcode: s.barcode } : {}),
      ...(s.thumbnailMediaId ? { thumbnail: s.thumbnailMediaId } : {}),
      ...(s.hash ? { hash: s.hash } : {}),
      ...(s.distance !== undefined && s.distance !== null ? { distance: s.distance } : {}),
      ...(s.screenshotGroup !== undefined ? { screenshotGroup: s.screenshotGroup } : {}),
      ...(s.recognitionCandidate ? { recognitionCandidate: true } : {}),
      ...(s.recognitionThumbnailMediaId ? { recognitionThumbnail: s.recognitionThumbnailMediaId } : {}),
    }))

    const firstScreenshot = screenshotEntries[0]?.image ?? null

    // Get transcript data for this snippet
    const snippetTx = snippetTranscripts?.[segIdx]

    const snippetDoc = await payload.create({
      collection: 'video-snippets',
      data: {
        video: videoId,
        image: firstScreenshot as number,
        matchingType: segment.matchingType,
        timestampStart: segment.timestampStart,
        timestampEnd: segment.timestampEnd,
        screenshots: screenshotEntries,
        ...(referencedProductIds.length > 0 ? { referencedProducts: referencedProductIds } : {}),
        ...(snippetTx ? {
          preTranscript: snippetTx.preTranscript,
          transcript: snippetTx.transcript,
          postTranscript: snippetTx.postTranscript,
        } : {}),
      },
    })

    const snippetId = (snippetDoc as { id: number }).id

    // Create video-mention records for this snippet (only when sentiment data exists)
    const videoMentions = snippetVideoQuotes?.[segIdx]
    if (videoMentions && videoMentions.length > 0) {
      for (const vq of videoMentions) {
        await payload.create({
          collection: 'video-mentions',
          data: {
            videoSnippet: snippetId,
            product: vq.productId,
            quotes: vq.quotes.map((q) => ({
              text: q.text,
              summary: q.summary ?? [],
              sentiment: q.sentiment,
              sentimentScore: q.sentimentScore,
            })),
            overallSentiment: vq.overallSentiment,
            overallSentimentScore: vq.overallSentimentScore,
          },
        })
        log.info(`Created video-mention for snippet #${snippetId} → product #${vq.productId} (${vq.quotes.length} quotes, ${vq.overallSentiment})`)
      }
    }

    // Emit event with segment log
    jlog.info(segment.eventLog, { event: true })
  }

  // Save transcript on the video and mark as processed
  await payload.update({
    collection: 'videos',
    id: videoId,
    data: {
      processingStatus: 'processed',
      ...(transcriptData ? {
        transcript: transcriptData.transcript,
        transcriptWords: transcriptData.transcriptWords,
      } : {}),
    },
  })

  log.info(`Video #${videoId}: ${segments.length} segments persisted, marked as processed`)
}

// ─── Product Aggregation ───

export interface PersistProductAggregationInput {
  gtin: string
  sourceProductIds: number[]
  aggregated: {
    gtin?: string
    name?: string
    brandName?: string
    ingredientNames?: string[]
    selectedImageUrl?: string
    selectedImageAlt?: string | null
  } | null
  classification?: {
    description: string
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
}

export async function persistProductAggregationResult(
  payload: PayloadRestClient,
  jobId: number,
  input: PersistProductAggregationInput,
): Promise<{ productId: number; tokensUsed: number; error?: string; warning?: string }> {
  const { gtin, sourceProductIds, aggregated, classification, classifySourceProductIds } = input
  const jlog = log.forJob('product-aggregations' as JobCollection, jobId)
  log.info(`persistProductAggregationResult: GTIN=${gtin}, ${sourceProductIds.length} source products`)
  let tokensUsed = 0
  const errorMessages: string[] = []
  const warningMessages: string[] = []

  if (!aggregated) {
    log.info(`persistProductAggregationResult: GTIN=${gtin} — no data to aggregate`)
    return { productId: 0, tokensUsed: 0, error: 'No data to aggregate from sources' }
  }

  // Find or create Product by GTIN
  const existingProducts = await payload.find({
    collection: 'products',
    where: { gtin: { equals: gtin } },
    limit: 1,
  })

  let productId: number
  if (existingProducts.docs.length > 0) {
    productId = (existingProducts.docs[0] as { id: number }).id
    log.info(`persistProductAggregationResult: GTIN=${gtin} → existing product #${productId}`)
  } else {
    const newProduct = await payload.create({
      collection: 'products',
      data: {
        gtin,
        name: aggregated.name || undefined,
      },
    }) as { id: number }
    productId = newProduct.id
    log.info(`persistProductAggregationResult: GTIN=${gtin} → new product #${productId}`)
  }

  const product = await payload.findByID({ collection: 'products', id: productId }) as Record<string, unknown>

  // Merge source product IDs (normalize to numbers for reliable dedup)
  const existingSourceIds = ((product.sourceProducts ?? []) as unknown[]).map((sp: unknown) =>
    Number(typeof sp === 'object' && sp !== null && 'id' in sp ? (sp as { id: number }).id : sp),
  ).filter((id) => !isNaN(id))
  const allIds = [...new Set([...existingSourceIds, ...sourceProductIds.map(Number)])]

  const updateData: Record<string, unknown> = {
    lastAggregatedAt: new Date().toISOString(),
    sourceProducts: allIds,
  }

  if (aggregated.name) {
    updateData.name = aggregated.name
  }

  if (aggregated.gtin && !product.gtin) {
    updateData.gtin = aggregated.gtin
  }

  // Match brand
  if (aggregated.brandName) {
    try {
      const brandResult = await matchBrand(payload, aggregated.brandName, jlog)
      tokensUsed += brandResult.tokensUsed.totalTokens
      updateData.brand = brandResult.brandId
      log.info(`persistProductAggregationResult: brand "${aggregated.brandName}" → brand #${brandResult.brandId}`)
      jlog.info(`Brand "${aggregated.brandName}" → #${brandResult.brandId}`, { event: true, labels: ['brand-matching', 'persistence'] })
    } catch (error) {
      errorMessages.push(`Brand matching error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  // Match ingredients
  if (aggregated.ingredientNames && aggregated.ingredientNames.length > 0) {
    try {
      const matchResult = await matchIngredients(payload, aggregated.ingredientNames, jlog)
      tokensUsed += matchResult.tokensUsed.totalTokens

      const matchedMap = new Map(
        matchResult.matched.map((m) => [m.originalName, m.ingredientId]),
      )
      updateData.ingredients = aggregated.ingredientNames.map((name) => ({
        name,
        ingredient: matchedMap.get(name) ?? null,
      }))

      log.info(`persistProductAggregationResult: ingredients ${matchResult.matched.length} matched, ${matchResult.unmatched.length} unmatched out of ${aggregated.ingredientNames.length}`)
      jlog.info(`Ingredients: ${matchResult.matched.length} matched, ${matchResult.unmatched.length} unmatched out of ${aggregated.ingredientNames.length}`, { event: true, labels: ['ingredient-matching', 'persistence'] })

      if (matchResult.unmatched.length > 0) {
        warningMessages.push(`Unmatched ingredients:\n${matchResult.unmatched.join('\n')}`)
      }
    } catch (error) {
      errorMessages.push(`Ingredient matching failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  // Upload product image
  if (aggregated.selectedImageUrl) {
    try {
      log.info(`persistProductAggregationResult: downloading image from ${aggregated.selectedImageUrl}`)
      const imageRes = await fetch(aggregated.selectedImageUrl)
      if (!imageRes.ok) {
        warningMessages.push(`Image download failed (${imageRes.status}): ${aggregated.selectedImageUrl}`)
      } else {
        const contentType = imageRes.headers.get('content-type') || 'image/jpeg'
        const buffer = Buffer.from(await imageRes.arrayBuffer())

        // Derive filename from URL
        const urlPath = new URL(aggregated.selectedImageUrl).pathname
        const filename = urlPath.split('/').pop() || `product-${gtin}.jpg`

        const mediaDoc = await payload.create({
          collection: 'media',
          data: { alt: aggregated.selectedImageAlt || aggregated.name || gtin },
          file: { data: buffer, mimetype: contentType, name: filename, size: buffer.length },
        })
        const mediaId = (mediaDoc as { id: number }).id
        updateData.image = mediaId
        log.info(`persistProductAggregationResult: uploaded image → media #${mediaId}`)
        jlog.info(`Image uploaded → media #${mediaId}`, { event: true, labels: ['image', 'persistence'] })
      }
    } catch (error) {
      warningMessages.push(`Image upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  // Apply classification
  if (classification) {
    log.info(`persistProductAggregationResult: applying classification (type=${classification.productType}, ${classification.productAttributes.length} attributes, ${classification.productClaims.length} claims)`)
    jlog.info(`Classification: type=${classification.productType}, ${classification.productAttributes.length} attrs, ${classification.productClaims.length} claims`, { event: true, labels: ['classification', 'persistence'] })
    if (classification.description) {
      updateData.description = classification.description
    }
    if (classification.warnings != null) updateData.warnings = classification.warnings
    if (classification.skinApplicability != null) updateData.skinApplicability = classification.skinApplicability
    if (classification.phMin != null) updateData.phMin = classification.phMin
    if (classification.phMax != null) updateData.phMax = classification.phMax
    if (classification.usageInstructions != null) updateData.usageInstructions = classification.usageInstructions
    if (classification.usageSchedule != null) updateData.usageSchedule = classification.usageSchedule

    if (classification.productType) {
      const ptDoc = await payload.find({
        collection: 'product-types',
        where: { slug: { equals: classification.productType } },
        limit: 1,
      })
      if (ptDoc.docs.length > 0) {
        updateData.productType = (ptDoc.docs[0] as { id: number }).id
      }
    }

    const mapEvidence = (entry: { sourceIndex: number; type: string; snippet?: string; start?: number; end?: number; ingredientNames?: string[] }) => {
      const sourceProductId = classifySourceProductIds?.[entry.sourceIndex]
      const result: Record<string, unknown> = {
        sourceProduct: sourceProductId,
        evidenceType: entry.type,
      }
      if (entry.type === 'descriptionSnippet' && entry.snippet) {
        result.snippet = entry.snippet
        if (entry.start != null) result.start = entry.start
        if (entry.end != null) result.end = entry.end
      }
      if (entry.type === 'ingredient' && entry.ingredientNames) {
        result.ingredientNames = entry.ingredientNames.map((name) => ({ name }))
      }
      return result
    }

    updateData.productAttributes = classification.productAttributes
      .filter((e) => classifySourceProductIds?.[e.sourceIndex] !== undefined)
      .map((entry) => ({ attribute: entry.attribute, ...mapEvidence(entry) }))

    updateData.productClaims = classification.productClaims
      .filter((e) => classifySourceProductIds?.[e.sourceIndex] !== undefined)
      .map((entry) => ({ claim: entry.claim, ...mapEvidence(entry) }))
  }

  await payload.update({
    collection: 'products',
    id: productId,
    data: updateData,
  })

  return {
    productId,
    tokensUsed,
    error: errorMessages.length > 0 ? errorMessages.join('\n\n') : undefined,
    warning: warningMessages.length > 0 ? warningMessages.join('\n\n') : undefined,
  }
}
