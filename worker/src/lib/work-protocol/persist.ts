import type { PayloadRestClient } from '@/lib/payload-client'
import type { SourceSlug } from '@/lib/source-product-queries'
import { getSourceSlugFromUrl } from '@/lib/source-product-queries'
import { lookupCategoryByPath, lookupCategoryByUrl } from '@/lib/lookup-source-category'
import { matchProduct } from '@/lib/match-product'
import { matchBrand } from '@/lib/match-brand'
import { matchCategory } from '@/lib/match-category'
import { matchIngredients } from '@/lib/match-ingredients'

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

type JobCollection = 'product-discoveries' | 'product-crawls' | 'ingredients-discoveries' | 'product-aggregations' | 'video-discoveries' | 'video-processings' | 'category-discoveries'

export async function createEvent(
  payload: PayloadRestClient,
  type: 'start' | 'success' | 'info' | 'warning' | 'error',
  jobCollection: JobCollection,
  jobId: number,
  message: string,
) {
  try {
    await payload.create({
      collection: 'events',
      data: { type, message, job: { relationTo: jobCollection, value: jobId } },
    })
  } catch (e) {
    console.error('Failed to create event:', e)
  }
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
  const { crawlId, sourceProductId, sourceUrl, source, data } = input
  console.log(`[WorkProtocol] persistCrawlResult: crawl #${crawlId}, sourceProduct #${sourceProductId}, source=${source}`)
  const warnings = [...data.warnings]

  // Look up SourceCategory
  let sourceCategoryId: number | null = null
  if (source === 'mueller' && data.categoryUrl) {
    sourceCategoryId = await lookupCategoryByUrl(payload, data.categoryUrl, source)
    if (!sourceCategoryId) {
      warnings.push(`No SourceCategory found for URL: ${data.categoryUrl}`)
    }
  } else if (data.categoryBreadcrumbs && data.categoryBreadcrumbs.length > 0) {
    sourceCategoryId = await lookupCategoryByPath(payload, data.categoryBreadcrumbs, source)
    if (!sourceCategoryId) {
      warnings.push(`No SourceCategory found for path: ${data.categoryBreadcrumbs.join(' > ')}`)
    }
  }

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
    ...(sourceCategoryId ? { sourceCategory: sourceCategoryId } : {}),
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
    sourceUrl: data.canonicalUrl ?? sourceUrl,
  }

  let productId: number

  if (existing.docs.length > 0) {
    productId = (existing.docs[0] as Record<string, unknown>).id as number
    console.log(`[WorkProtocol] persistCrawlResult: updating existing source-product #${productId}`)
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
    console.log(`[WorkProtocol] persistCrawlResult: created new source-product #${productId}`)
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
    console.log(`[WorkProtocol] persistCrawlResult: source-product #${productId} has ${warnings.length} warning(s)`)
  }
  for (const warning of warnings) {
    await createEvent(payload, 'warning', 'product-crawls', crawlId, warning)
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
  const effectiveSource = getSourceSlugFromUrl(product.productUrl) ?? source
  console.log(`[WorkProtocol] persistDiscoveredProduct: discovery #${discoveryId}, url=${product.productUrl}, source=${effectiveSource}`)

  const existingProduct = await payload.find({
    collection: 'source-products',
    where: {
      and: [
        { sourceUrl: { equals: product.productUrl } },
        { or: [{ source: { equals: effectiveSource } }, { source: { exists: false } }] },
      ],
    },
    limit: 1,
  })

  // Look up SourceCategory by URL
  let sourceCategoryId: number | null = null
  if (product.categoryUrl) {
    const catMatch = await payload.find({
      collection: 'source-categories',
      where: { and: [{ url: { equals: product.categoryUrl } }, { source: { equals: effectiveSource } }] },
      limit: 1,
    })
    if (catMatch.docs.length > 0) sourceCategoryId = (catMatch.docs[0] as { id: number }).id
  }

  const now = new Date().toISOString()
  const priceEntry = product.price != null ? {
    recordedAt: now,
    amount: product.price,
    currency: product.currency ?? 'EUR',
  } : null

  const discoveryData = {
    sourceUrl: product.productUrl,
    brandName: product.brandName,
    name: product.name,
    sourceCategory: sourceCategoryId,
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
    console.log(`[WorkProtocol] persistDiscoveredProduct: created new source-product #${sourceProductId}`)
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
    console.log(`[WorkProtocol] persistDiscoveredProduct: updated existing source-product #${sourceProductId}`)
  }

  // Create DiscoveryResult join record
  await payload.create({
    collection: 'discovery-results',
    data: { discovery: discoveryId, sourceProduct: sourceProductId },
  })

  return { sourceProductId, isNew }
}

// ─── Category Discovery ───

export async function persistDiscoveredCategory(
  payload: PayloadRestClient,
  category: DiscoveredCategory,
  source: SourceSlug,
  pathToId: Map<string, number>,
): Promise<{ categoryId: number; isNew: boolean }> {
  // Build parent relationship
  const parentPathParts = category.path.slice(0, -1)
  const parentKey = parentPathParts.join(' > ')
  const parentId = parentKey ? (pathToId.get(parentKey) ?? null) : null

  // Derive slug from URL path
  const slug = deriveSlug(category.url, source)
  const currentKey = category.path.join(' > ')

  const existingCat = await payload.find({
    collection: 'source-categories',
    where: {
      and: [
        { slug: { equals: slug } },
        { source: { equals: source } },
        parentId ? { parent: { equals: parentId } } : { parent: { exists: false } },
      ],
    },
    limit: 1,
  })

  if (existingCat.docs.length > 0) {
    const doc = existingCat.docs[0] as { id: number; url: string }
    if (doc.url !== category.url) {
      await payload.update({
        collection: 'source-categories',
        id: doc.id,
        data: { url: category.url, name: category.name },
      })
    }
    pathToId.set(currentKey, doc.id)
    return { categoryId: doc.id, isNew: false }
  } else {
    const newCat = await payload.create({
      collection: 'source-categories',
      data: {
        name: category.name,
        slug,
        source,
        url: category.url,
        ...(parentId ? { parent: parentId } : {}),
      },
    }) as { id: number }
    pathToId.set(currentKey, newCat.id)
    return { categoryId: newCat.id, isNew: true }
  }
}

function deriveSlug(url: string, source: SourceSlug): string {
  try {
    const pathname = new URL(url).pathname
    const segments = pathname.split('/').filter(Boolean)
    // For DM/Rossmann/Mueller, take the last path segment
    const lastSegment = segments[segments.length - 1] ?? ''
    // Remove category ID suffixes like /c/123
    return lastSegment.replace(/^c$/, segments[segments.length - 2] ?? lastSegment)
  } catch {
    return url
  }
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
  // Find or create channel
  const existingChannel = await payload.find({
    collection: 'channels',
    where: { externalUrl: { equals: channelUrl } },
    limit: 1,
  })

  let channelId: number
  if (existingChannel.docs.length > 0) {
    channelId = (existingChannel.docs[0] as { id: number }).id
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
        console.warn(`[VideoDiscovery] Failed to download thumbnail for ${video.externalUrl}:`, e)
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

export async function persistVideoProcessingResult(
  payload: PayloadRestClient,
  jobId: number,
  videoId: number,
  videoMediaId: number | undefined,
  segments: VideoProcessingSegment[],
): Promise<void> {
  console.log(`[WorkProtocol] persistVideoProcessingResult: video #${videoId}, ${segments.length} segments`)
  // Delete existing snippets for this video
  const existingSnippets = await payload.find({
    collection: 'video-snippets',
    where: { video: { equals: videoId } },
    limit: 1000,
  })
  if (existingSnippets.docs.length > 0) {
    await payload.delete({
      collection: 'video-snippets',
      where: { video: { equals: videoId } },
    })
    console.log(`[Persist] Deleted ${existingSnippets.docs.length} existing snippets for video #${videoId}`)
  }

  for (const segment of segments) {
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
        console.log(`[Persist] GTIN ${segment.barcode} → product #${(products.docs[0] as { id: number }).id}`)
      } else {
        console.log(`[Persist] No product found for GTIN ${segment.barcode}`)
      }
    } else if (segment.matchingType === 'visual' && segment.recognitionResults) {
      // Match each recognition result via DB + LLM
      for (const recog of segment.recognitionResults) {
        if (recog.brand || recog.productName || recog.searchTerms.length > 0) {
          const matchResult = await matchProduct(payload, recog.brand, recog.productName, recog.searchTerms)
          if (matchResult) {
            referencedProductIds.push(matchResult.productId)
            console.log(`[Persist] Cluster ${recog.clusterGroup} → product #${matchResult.productId} ("${matchResult.productName}")`)
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

    await payload.create({
      collection: 'video-snippets',
      data: {
        video: videoId,
        image: firstScreenshot as number,
        matchingType: segment.matchingType,
        timestampStart: segment.timestampStart,
        timestampEnd: segment.timestampEnd,
        screenshots: screenshotEntries,
        ...(referencedProductIds.length > 0 ? { referencedProducts: referencedProductIds } : {}),
      },
    })

    // Emit event with segment log
    await createEvent(payload, 'info', 'video-processings', jobId, segment.eventLog)
  }

  // Mark video as processed
  await payload.update({
    collection: 'videos',
    id: videoId,
    data: { processingStatus: 'processed' },
  })

  console.log(`[Persist] Video #${videoId}: ${segments.length} segments persisted, marked as processed`)
}

// ─── Product Aggregation ───

export interface PersistProductAggregationInput {
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
}

export async function persistProductAggregationResult(
  payload: PayloadRestClient,
  _jobId: number,
  input: PersistProductAggregationInput,
): Promise<{ productId: number; tokensUsed: number; error?: string; warning?: string }> {
  const { gtin, sourceProductIds, aggregated, classification, classifySourceProductIds } = input
  console.log(`[WorkProtocol] persistProductAggregationResult: GTIN=${gtin}, ${sourceProductIds.length} source products`)
  let tokensUsed = 0
  const errorMessages: string[] = []
  const warningMessages: string[] = []

  if (!aggregated) {
    console.log(`[WorkProtocol] persistProductAggregationResult: GTIN=${gtin} — no data to aggregate`)
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
    console.log(`[WorkProtocol] persistProductAggregationResult: GTIN=${gtin} → existing product #${productId}`)
  } else {
    const newProduct = await payload.create({
      collection: 'products',
      data: {
        gtin,
        name: aggregated.name || undefined,
      },
    }) as { id: number }
    productId = newProduct.id
    console.log(`[WorkProtocol] persistProductAggregationResult: GTIN=${gtin} → new product #${productId}`)
  }

  const product = await payload.findByID({ collection: 'products', id: productId }) as Record<string, unknown>

  // Merge source product IDs
  const existingSourceIds = ((product.sourceProducts ?? []) as unknown[]).map((sp: unknown) =>
    typeof sp === 'object' && sp !== null && 'id' in sp ? (sp as { id: number }).id : sp,
  ) as number[]
  const allIds = [...new Set([...existingSourceIds, ...sourceProductIds])]

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
      const brandResult = await matchBrand(payload, aggregated.brandName)
      tokensUsed += brandResult.tokensUsed.totalTokens
      updateData.brand = brandResult.brandId
      console.log(`[WorkProtocol] persistProductAggregationResult: brand "${aggregated.brandName}" → brand #${brandResult.brandId}`)
    } catch (error) {
      errorMessages.push(`Brand matching error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  // Match category — walk SourceCategory parent chain to build breadcrumb
  if (aggregated.sourceCategoryId) {
    try {
      const breadcrumbParts: string[] = []
      let currentCatId: number | null = aggregated.sourceCategoryId
      while (currentCatId) {
        const cat = await payload.findByID({
          collection: 'source-categories',
          id: currentCatId,
        }) as { name: string; parent?: number | { id: number } | null }
        breadcrumbParts.unshift(cat.name)
        currentCatId = cat.parent
          ? (typeof cat.parent === 'object' ? cat.parent.id : cat.parent)
          : null
      }
      const categoryBreadcrumb = breadcrumbParts.join(' -> ')
      const categoryResult = await matchCategory(payload, categoryBreadcrumb)
      tokensUsed += categoryResult.tokensUsed.totalTokens
      if (categoryResult.categoryId) {
        updateData.category = categoryResult.categoryId
        console.log(`[WorkProtocol] persistProductAggregationResult: category "${categoryBreadcrumb}" → category #${categoryResult.categoryId}`)
      } else {
        console.log(`[WorkProtocol] persistProductAggregationResult: category "${categoryBreadcrumb}" → no match`)
      }
    } catch (error) {
      errorMessages.push(`Category matching error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  // Match ingredients
  if (aggregated.ingredientNames && aggregated.ingredientNames.length > 0) {
    try {
      const matchResult = await matchIngredients(payload, aggregated.ingredientNames)
      tokensUsed += matchResult.tokensUsed.totalTokens

      const matchedMap = new Map(
        matchResult.matched.map((m) => [m.originalName, m.ingredientId]),
      )
      updateData.ingredients = aggregated.ingredientNames.map((name) => ({
        name,
        ingredient: matchedMap.get(name) ?? null,
      }))

      console.log(`[WorkProtocol] persistProductAggregationResult: ingredients ${matchResult.matched.length} matched, ${matchResult.unmatched.length} unmatched out of ${aggregated.ingredientNames.length}`)

      if (matchResult.unmatched.length > 0) {
        warningMessages.push(`Unmatched ingredients:\n${matchResult.unmatched.join('\n')}`)
      }
    } catch (error) {
      errorMessages.push(`Ingredient matching failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  // Apply classification
  if (classification) {
    console.log(`[WorkProtocol] persistProductAggregationResult: applying classification (type=${classification.productType}, ${classification.productAttributes.length} attributes, ${classification.productClaims.length} claims)`)
    if (classification.description) {
      updateData.description = classification.description
    }

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

    const mapEvidence = (entry: { sourceIndex: number; type: string; snippet?: string; ingredientNames?: string[] }) => {
      const sourceProductId = classifySourceProductIds?.[entry.sourceIndex]
      const result: Record<string, unknown> = {
        sourceProduct: sourceProductId,
        evidenceType: entry.type,
      }
      if (entry.type === 'descriptionSnippet' && entry.snippet) {
        result.snippet = entry.snippet
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
