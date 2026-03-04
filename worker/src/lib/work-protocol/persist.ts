import type { PayloadRestClient } from '@/lib/payload-client'
import type { SourceSlug } from '@/lib/source-product-queries'
import { getSourceSlugFromUrl, normalizeProductUrl, normalizeVariantUrl } from '@/lib/source-product-queries'

import { matchProduct } from '@/lib/match-product'
import { matchBrand } from '@/lib/match-brand'
import { matchIngredients } from '@/lib/match-ingredients'
import { parseIngredients } from '@/lib/parse-ingredients'
import { createLogger } from '@/lib/logger'

const log = createLogger('Persist')

interface ScrapedProductData {
  gtin?: string
  name: string
  brandName?: string
  description?: string
  ingredientsText?: string
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
  availability?: 'available' | 'unavailable' | 'unknown'
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
  /** The source-variant that was crawled (undefined on first crawl — variant will be created) */
  sourceVariantId?: number
  /** The parent source-product */
  sourceProductId: number
  sourceUrl: string
  source: SourceSlug
  data: ScrapedProductData
  /** Whether to also crawl sibling variants (defers parent status if siblings need crawling) */
  crawlVariants: boolean
}

export async function persistCrawlResult(
  payload: PayloadRestClient,
  input: PersistCrawlResultInput,
): Promise<{ productId: number; warnings: string[]; newVariants: number; existingVariants: number; hasIngredients: boolean; priceChange: string | null }> {
  const { crawlId, sourceProductId, source, data, crawlVariants } = input
  let { sourceVariantId } = input
  const variantUrl = normalizeVariantUrl(input.sourceUrl)
  const jlog = log.forJob('product-crawls', crawlId)
  log.info('persistCrawlResult: starting', { crawlId, sourceVariantId: sourceVariantId ?? 'none (first crawl)', sourceProductId, source })
  const warnings = [...data.warnings]

  // Build category breadcrumb string
  const categoryBreadcrumb = data.categoryBreadcrumbs && data.categoryBreadcrumbs.length > 0
    ? data.categoryBreadcrumbs.join(' -> ')
    : null

  const now = new Date().toISOString()

  // Fetch existing source-product for price history
  const existingProduct = await payload.findByID({ collection: 'source-products', id: sourceProductId }) as Record<string, unknown>
  const existingHistory = (existingProduct.priceHistory as Array<{ amount?: number | null; change?: string | null }>) ?? []

  // Compute price change vs previous entry (requires >= 5% move to count as drop/increase)
  const newAmount = data.priceCents ?? null
  let priceChange: string | null = null
  if (newAmount != null && existingHistory.length > 0) {
    const prevAmount = existingHistory[0]?.amount
    if (prevAmount != null && prevAmount > 0) {
      const pctChange = (newAmount - prevAmount) / prevAmount
      if (pctChange <= -0.05) priceChange = 'drop'
      else if (pctChange >= 0.05) priceChange = 'increase'
      else priceChange = 'stable'
    }
  }

  const priceEntry = {
    recordedAt: now,
    amount: newAmount,
    currency: data.currency ?? 'EUR',
    perUnitAmount: data.perUnitAmount ?? null,
    perUnitCurrency: data.perUnitAmount ? (data.currency ?? 'EUR') : null,
    perUnitQuantity: data.perUnitQuantity ?? null,
    unit: data.perUnitUnit ?? null,
    change: priceChange,
  }

  // Update source-product with scraped data
  // Status is set to 'crawled' initially; may be deferred below if crawlVariants is true and siblings need crawling
  const productPayload: Record<string, unknown> = {
    status: 'crawled' as const,
    source,
    sourceArticleNumber: data.sourceArticleNumber ?? null,
    brandName: data.brandName ?? null,
    name: data.name,
    ...(categoryBreadcrumb ? { categoryBreadcrumb } : {}),
    description: data.description ?? null,
    amount: data.amount ?? null,
    amountUnit: data.amountUnit ?? null,
    labels: data.labels?.map((l) => ({ label: l })) ?? [],
    images: data.images,
    priceHistory: [priceEntry, ...existingHistory],
    rating: data.rating || null,
    ratingNum: data.ratingNum || null,
    ingredientsText: data.ingredientsText ?? null,
  }

  log.info('persistCrawlResult: updating source-product', { sourceProductId })
  await payload.update({
    collection: 'source-products',
    id: sourceProductId,
    data: productPayload,
  })

  // Determine the canonical URL for the crawled variant
  const canonicalVariantUrl = data.canonicalUrl ? normalizeVariantUrl(data.canonicalUrl) : variantUrl

  // Find the selected variant's label and dimension from the scraped data
  let crawledVariantLabel: string | undefined
  let crawledVariantDimension: string | undefined
  for (const variantGroup of data.variants) {
    for (const option of variantGroup.options) {
      if (option.isSelected) {
        crawledVariantLabel = option.label || undefined
        crawledVariantDimension = variantGroup.dimension || undefined
        break
      }
    }
    if (crawledVariantLabel) break
  }

  if (sourceVariantId) {
    // Existing variant (re-crawl or variant crawl) — update it
    await payload.update({
      collection: 'source-variants',
      id: sourceVariantId,
      data: {
        ...(data.gtin ? { gtin: data.gtin } : {}),
        availability: data.availability ?? 'available',
        ...(canonicalVariantUrl !== variantUrl ? { sourceUrl: canonicalVariantUrl } : {}),
        ...(crawledVariantLabel ? { variantLabel: crawledVariantLabel } : {}),
        ...(crawledVariantDimension ? { variantDimension: crawledVariantDimension } : {}),
        crawledAt: now,
      },
    })
  } else {
    // First crawl — create a variant for the crawled URL
    try {
      const createdVariant = await payload.create({
        collection: 'source-variants',
        data: {
          sourceProduct: sourceProductId,
          sourceUrl: canonicalVariantUrl,
          gtin: data.gtin || undefined,
          availability: data.availability ?? 'available',
          variantLabel: crawledVariantLabel,
          variantDimension: crawledVariantDimension,
          crawledAt: now,
        },
      }) as { id: number }
      sourceVariantId = createdVariant.id
      log.info('persistCrawlResult: created variant for crawled URL', { sourceVariantId, url: canonicalVariantUrl })
    } catch (e) {
      // Unique constraint race — variant already exists (e.g. from a concurrent crawl)
      const existing = await payload.find({
        collection: 'source-variants',
        where: { sourceUrl: { equals: canonicalVariantUrl } },
        limit: 1,
      })
      if (existing.docs.length > 0) {
        sourceVariantId = (existing.docs[0] as Record<string, unknown>).id as number
        await payload.update({
          collection: 'source-variants',
          id: sourceVariantId,
          data: {
            ...(data.gtin ? { gtin: data.gtin } : {}),
            availability: data.availability ?? 'available',
            ...(crawledVariantLabel ? { variantLabel: crawledVariantLabel } : {}),
            ...(crawledVariantDimension ? { variantDimension: crawledVariantDimension } : {}),
            crawledAt: now,
          },
        })
      } else {
        log.warn('persistCrawlResult: failed to create variant for crawled URL', { error: e instanceof Error ? e.message : String(e) })
      }
    }
  }

  // Create source-variants for sibling variants found in scraped data.
  // Each driver provides the full variant URL as option.value — persist just stores it.
  let newVariants = 0
  let existingVariants = 0
  let totalVariants = 0
  for (const variantGroup of data.variants) {
    for (const option of variantGroup.options) {
      if (option.isSelected) continue // This is the variant we already created/updated above
      if (!option.value) continue // No URL available — can't create a variant without one
      totalVariants++

      const siblingUrl = normalizeVariantUrl(option.value)

      // Check if this variant URL already exists
      const existingVariant = await payload.find({
        collection: 'source-variants',
        where: { sourceUrl: { equals: siblingUrl } },
        limit: 1,
      })

      if (existingVariant.docs.length === 0) {
        try {
          await payload.create({
            collection: 'source-variants',
            data: {
              sourceProduct: sourceProductId,
              sourceUrl: siblingUrl,
              gtin: option.gtin || undefined,
              variantLabel: option.label || undefined,
              variantDimension: variantGroup.dimension || undefined,
              availability: option.availability ?? 'available',
            },
          })
          newVariants++
          log.debug('persistCrawlResult: created sibling variant', { url: siblingUrl, gtin: option.gtin ?? 'none', label: option.label })
        } catch (e) {
          // Unique constraint race — safe to ignore
          existingVariants++
          log.debug('persistCrawlResult: skipped sibling variant', { url: siblingUrl, error: e instanceof Error ? e.message : String(e) })
        }
      } else {
        // Update availability and GTIN on existing sibling — if the driver returned it, it's available
        const sv = existingVariant.docs[0] as Record<string, unknown>
        const updates: Record<string, unknown> = {}
        updates.availability = option.availability ?? 'available'
        if (option.gtin && !sv.gtin) updates.gtin = option.gtin
        if (Object.keys(updates).length > 0) {
          try {
            await payload.update({
              collection: 'source-variants',
              id: sv.id as number,
              data: updates,
            })
          } catch { /* best-effort update */ }
        }
        existingVariants++
      }
    }
  }
  if (totalVariants > 0) {
    jlog.info('Variants processed', { url: variantUrl, newVariants, existingVariants, totalVariants }, { event: true, labels: ['scraping', 'variants'] })
  }

  // Mark disappeared variants as unavailable.
  // If the driver returned variant data, any existing DB variant whose URL is NOT in the
  // scraped set has disappeared from the product page and should be marked unavailable.
  // Guard: only run when the driver actually returned variant options (to avoid false
  // negatives from scraping failures where the page didn't render variants).
  const hasScrapedVariants = data.variants.some((vg) => vg.options.length > 0)
  if (hasScrapedVariants) {
    // Build set of all variant URLs the driver returned (including the crawled variant itself)
    const scrapedUrls = new Set<string>()
    scrapedUrls.add(canonicalVariantUrl)
    for (const variantGroup of data.variants) {
      for (const option of variantGroup.options) {
        if (option.value) {
          scrapedUrls.add(normalizeVariantUrl(option.value))
        }
      }
    }

    // Fetch all existing sibling variants for this source-product
    const allSiblings = await payload.find({
      collection: 'source-variants',
      where: { sourceProduct: { equals: sourceProductId } },
      limit: 1000,
    })

    let markedUnavailable = 0
    for (const doc of allSiblings.docs) {
      const sv = doc as Record<string, unknown>
      const svUrl = sv.sourceUrl as string
      if (!scrapedUrls.has(svUrl) && sv.availability !== 'unavailable') {
        try {
          await payload.update({
            collection: 'source-variants',
            id: sv.id as number,
            data: { availability: 'unavailable' },
          })
          markedUnavailable++
        } catch { /* best-effort update */ }
      }
    }
    if (markedUnavailable > 0) {
      jlog.info('Disappeared variants marked unavailable', { url: variantUrl, markedUnavailable }, { event: true, labels: ['scraping', 'variants'] })
    }
  }

  // If crawlVariants is enabled, check whether any sibling variants still need crawling.
  // If so, keep the parent source-product as 'uncrawled' so findUncrawledVariants picks up the siblings.
  if (crawlVariants) {
    const allVariants = await payload.find({
      collection: 'source-variants',
      where: { sourceProduct: { equals: sourceProductId } },
      limit: 1000,
    })
    const uncrawledSiblings = allVariants.docs.filter((v) => {
      const sv = v as Record<string, unknown>
      return !sv.crawledAt
    })
    if (uncrawledSiblings.length > 0) {
      log.info('persistCrawlResult: uncrawled siblings remain, keeping source-product as uncrawled', { uncrawledCount: uncrawledSiblings.length, sourceProductId })
      await payload.update({
        collection: 'source-products',
        id: sourceProductId,
        data: { status: 'uncrawled' },
      })
    }
  }

  // Create CrawlResult join record
  await payload.create({
    collection: 'crawl-results',
    data: { crawl: crawlId, sourceProduct: sourceProductId },
  })

  // Emit price change event
  if (priceChange && priceChange !== 'stable') {
    const prevAmount = existingHistory[0]?.amount ?? null
    jlog.info('Price change detected', {
      url: variantUrl,
      source,
      change: priceChange,
      previousCents: prevAmount ?? 0,
      currentCents: newAmount ?? 0,
    }, { event: true, labels: ['scraping', 'price'] })
  }

  // Emit ingredient extraction signal
  const hasIngredients = !!data.ingredientsText && data.ingredientsText.trim().length > 0
  if (hasIngredients) {
    jlog.info('Ingredients found', {
      url: variantUrl,
      source,
      chars: data.ingredientsText!.trim().length,
    }, { event: true, labels: ['scraping', 'ingredients'] })
  }

  // Log warnings
  if (warnings.length > 0) {
    log.info('persistCrawlResult: source-product has warnings', { sourceProductId, warningCount: warnings.length })
  }
  for (const warning of warnings) {
    jlog.warn(warning, { event: true })
  }

  return { productId: sourceProductId, warnings, newVariants, existingVariants, hasIngredients, priceChange }
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
  discoveryId: number | null
  searchId?: number | null
  product: DiscoveredProduct
  source: SourceSlug
}

export async function persistDiscoveredProduct(
  payload: PayloadRestClient,
  input: PersistDiscoveredProductInput,
): Promise<{ sourceProductId: number; isNew: boolean }> {
  const { discoveryId, product, source } = input
  const productUrl = normalizeProductUrl(product.productUrl)
  const effectiveSource = getSourceSlugFromUrl(productUrl) ?? source
  log.info('persistDiscoveredProduct: starting', { discoveryId, url: productUrl, source: effectiveSource })

  // Dedup by source-products.sourceUrl (the product-level URL is the unique key)
  const existingProduct = await payload.find({
    collection: 'source-products',
    where: { sourceUrl: { equals: productUrl } },
    limit: 1,
  })

  const now = new Date().toISOString()

  const discoveryData: Record<string, unknown> = {
    brandName: product.brandName,
    name: product.name,
    categoryBreadcrumb: product.category ?? null,
    rating: product.rating || null,
    ratingNum: product.ratingCount || null,
  }

  let sourceProductId: number
  let isNew: boolean

  if (existingProduct.docs.length === 0) {
    // New: no source-product with this URL exists → create source-product (no variant yet)

    const priceEntry = product.price != null ? {
      recordedAt: now,
      amount: product.price,
      currency: product.currency ?? 'EUR',
      change: null,
    } : null

    const newProduct = await payload.create({
      collection: 'source-products',
      data: {
        source: effectiveSource,
        sourceUrl: productUrl,
        status: 'uncrawled',
        ...discoveryData,
        priceHistory: priceEntry ? [priceEntry] : [],
      },
    }) as { id: number }
    sourceProductId = newProduct.id

    isNew = true
    log.info('persistDiscoveredProduct: created new source-product', { sourceProductId, url: productUrl })
  } else {
    // Existing source-product → update it
    const sp = existingProduct.docs[0] as Record<string, unknown>
    sourceProductId = sp.id as number

    const existingHistory = (sp.priceHistory as Array<{ amount?: number | null }>) ?? []

    let priceEntry: { recordedAt: string; amount: number; currency: string; change: string | null } | null = null
    if (product.price != null) {
      let change: string | null = null
      if (existingHistory.length > 0) {
        const prevAmount = existingHistory[existingHistory.length - 1]?.amount
        if (prevAmount != null && prevAmount > 0) {
          const pctChange = (product.price - prevAmount) / prevAmount
          if (pctChange <= -0.05) change = 'drop'
          else if (pctChange >= 0.05) change = 'increase'
          else change = 'stable'
        }
      }
      priceEntry = { recordedAt: now, amount: product.price, currency: product.currency ?? 'EUR', change }
    }

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
    log.info('persistDiscoveredProduct: updated existing source-product', { sourceProductId, url: productUrl })
  }

  // Create DiscoveryResult join record (only for discovery jobs, not search jobs)
  if (discoveryId != null) {
    await payload.create({
      collection: 'discovery-results',
      data: { discovery: discoveryId, sourceProduct: sourceProductId },
    })
  }

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
      log.warn('Failed to download channel avatar', { url: channelAvatarUrl, error: String(e) })
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

  // Process all videos in this batch
  let created = 0
  let existing = 0

  for (const video of videos) {
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
        log.warn('Failed to download thumbnail', { url: video.externalUrl, error: String(e) })
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
  const jlog = log.forJob('video-processings', jobId)
  log.info('persistVideoProcessingResult: starting', { videoId, segmentCount: segments.length })

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
    log.info('Deleted existing snippets and video-mentions', { snippetCount: existingSnippets.docs.length, videoId })
  }

  for (let segIdx = 0; segIdx < segments.length; segIdx++) {
    const segment = segments[segIdx]
    let referencedProductIds: number[] = []

    if (segment.matchingType === 'barcode' && segment.barcode) {
      // Look up product by GTIN via product-variants
      const variants = await payload.find({
        collection: 'product-variants',
        where: { gtin: { equals: segment.barcode } },
        limit: 1,
      })
      if (variants.docs.length > 0) {
        const variant = variants.docs[0] as Record<string, unknown>
        const productRef = variant.product as number | Record<string, unknown>
        const pid = typeof productRef === 'number' ? productRef : (productRef as { id: number }).id
        referencedProductIds = [pid]
        log.info('GTIN matched to product via product-variant', { gtin: segment.barcode, productId: pid })
      } else {
        log.info('No product-variant found for GTIN', { gtin: segment.barcode })
      }
    } else if (segment.matchingType === 'visual' && segment.recognitionResults) {
      // Match each recognition result via DB + LLM
      for (const recog of segment.recognitionResults) {
        if (recog.brand || recog.productName || recog.searchTerms.length > 0) {
          const matchResult = await matchProduct(payload, recog.brand, recog.productName, recog.searchTerms, jlog)
          if (matchResult) {
            referencedProductIds.push(matchResult.productId)
            log.info('Visual recognition matched to product', { clusterGroup: recog.clusterGroup, productId: matchResult.productId, productName: matchResult.productName })
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
        log.info('Created video-mention', { snippetId, productId: vq.productId, quoteCount: vq.quotes.length, sentiment: vq.overallSentiment })
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

  log.info('Video persisted and marked as processed', { videoId, segmentCount: segments.length })
}

// ─── Product Aggregation ───

export interface PersistProductAggregationInput {
  gtin: string
  sourceProductIds: number[]
  aggregated: {
    gtin?: string
    name?: string
    brandName?: string
    ingredientsText?: string
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
  /** full = LLM classification + brand/ingredient matching + image. partial = score history + basic data only. */
  scope: 'full' | 'partial'
}

export async function persistProductAggregationResult(
  payload: PayloadRestClient,
  jobId: number,
  input: PersistProductAggregationInput,
): Promise<{ productId: number; tokensUsed: number; error?: string; warning?: string }> {
  const { gtin, sourceProductIds, aggregated, classification, classifySourceProductIds, scope } = input
  const jlog = log.forJob('product-aggregations', jobId)
  log.info('persistProductAggregationResult: starting', { gtin, sourceProductCount: sourceProductIds.length })
  let tokensUsed = 0
  const errorMessages: string[] = []
  const warningMessages: string[] = []

  if (!aggregated) {
    log.info('persistProductAggregationResult: no data to aggregate', { gtin })
    return { productId: 0, tokensUsed: 0, error: 'No data to aggregate from sources' }
  }

  // Find or create Product by looking up product-variants by GTIN
  let productId: number
  const existingVariants = await payload.find({
    collection: 'product-variants',
    where: { gtin: { equals: gtin } },
    limit: 1,
  })

  if (existingVariants.docs.length > 0) {
    const variant = existingVariants.docs[0] as Record<string, unknown>
    const productRef = variant.product as number | Record<string, unknown>
    productId = typeof productRef === 'number' ? productRef : (productRef as { id: number }).id
    log.info('persistProductAggregationResult: found existing product via variant', { gtin, productId })
  } else {
    // Create a new product and a default product-variant for this GTIN
    const newProduct = await payload.create({
      collection: 'products',
      data: {
        name: aggregated.name || undefined,
      },
    }) as { id: number }
    productId = newProduct.id

    // Find source-variants with this GTIN to link to the product-variant
    const matchingSourceVariants = await payload.find({
      collection: 'source-variants',
      where: { gtin: { equals: gtin } },
      limit: 100,
    })
    const sourceVariantIds = matchingSourceVariants.docs.map((sv) => (sv as { id: number }).id)

    await payload.create({
      collection: 'product-variants',
      data: {
        product: productId,
        gtin,
        label: aggregated.name || gtin,
        ...(sourceVariantIds.length > 0 ? { sourceVariants: sourceVariantIds } : {}),
      },
    })
    log.info('persistProductAggregationResult: created new product + product-variant', { gtin, productId })
  }

  const product = await payload.findByID({ collection: 'products', id: productId }) as Record<string, unknown>

  // Merge source product IDs (normalize to numbers for reliable dedup)
  const existingSourceIds = ((product.sourceProducts ?? []) as unknown[]).map((sp: unknown) =>
    Number(typeof sp === 'object' && sp !== null && 'id' in sp ? (sp as { id: number }).id : sp),
  ).filter((id) => !isNaN(id))
  const allIds = [...new Set([...existingSourceIds, ...sourceProductIds.map(Number)])]

  const updateData: Record<string, unknown> = {
    sourceProducts: allIds,
  }

  if (aggregated.name) {
    updateData.name = aggregated.name
  }

  // ── Full scope only: brand matching, ingredient matching, image upload, classification ──
  if (scope === 'full') {
    // Match brand
    if (aggregated.brandName) {
      try {
        const brandResult = await matchBrand(payload, aggregated.brandName, jlog)
        tokensUsed += brandResult.tokensUsed.totalTokens
        updateData.brand = brandResult.brandId
        log.info('persistProductAggregationResult: brand matched', { brandName: aggregated.brandName, brandId: brandResult.brandId })
        jlog.info('Brand matched', { brandName: aggregated.brandName, brandId: brandResult.brandId }, { event: true, labels: ['brand-matching', 'persistence'] })
      } catch (error) {
        errorMessages.push(`Brand matching error: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }

    // Parse and match ingredients from raw text
    if (aggregated.ingredientsText) {
      try {
        // Step 1: Parse raw text into individual ingredient names (LLM)
        const ingredientNames = await parseIngredients(aggregated.ingredientsText)
        log.info('persistProductAggregationResult: parsed ingredients from raw text', { ingredientCount: ingredientNames.length })

        if (ingredientNames.length > 0) {
          // Step 2: Match parsed names against ingredient database
          const matchResult = await matchIngredients(payload, ingredientNames, jlog)
          tokensUsed += matchResult.tokensUsed.totalTokens

          const matchedMap = new Map(
            matchResult.matched.map((m) => [m.originalName, m.ingredientId]),
          )
          updateData.ingredients = ingredientNames.map((name) => ({
            name,
            ingredient: matchedMap.get(name) ?? null,
          }))

          log.info('persistProductAggregationResult: ingredients matched', { matched: matchResult.matched.length, unmatched: matchResult.unmatched.length, total: ingredientNames.length })
          jlog.info('Ingredients matched', { matched: matchResult.matched.length, unmatched: matchResult.unmatched.length, total: ingredientNames.length }, { event: true, labels: ['ingredient-matching', 'persistence'] })

          if (matchResult.unmatched.length > 0) {
            warningMessages.push(`Unmatched ingredients:\n${matchResult.unmatched.join('\n')}`)
          }
        }
      } catch (error) {
        errorMessages.push(`Ingredient parsing/matching failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }

    // Upload product image
    if (aggregated.selectedImageUrl) {
      try {
        log.info('persistProductAggregationResult: downloading image', { url: aggregated.selectedImageUrl })
        const imageRes = await fetch(aggregated.selectedImageUrl)
        if (!imageRes.ok) {
          warningMessages.push(`Image download failed (${imageRes.status}): ${aggregated.selectedImageUrl}`)
        } else {
          const contentType = imageRes.headers.get('content-type') || 'image/jpeg'
          const buffer = Buffer.from(await imageRes.arrayBuffer())

          // Derive filename from URL
          const urlPath = new URL(aggregated.selectedImageUrl).pathname
          const filename = urlPath.split('/').pop() || `product-${productId}.jpg`

          const mediaDoc = await payload.create({
            collection: 'media',
            data: { alt: aggregated.selectedImageAlt || aggregated.name || `Product ${productId}` },
            file: { data: buffer, mimetype: contentType, name: filename, size: buffer.length },
          })
          const mediaId = (mediaDoc as { id: number }).id
          updateData.images = [{ image: mediaId }]
          log.info('persistProductAggregationResult: uploaded image', { mediaId })
          jlog.info('Image uploaded', { mediaId }, { event: true, labels: ['image', 'persistence'] })
        }
      } catch (error) {
        warningMessages.push(`Image upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }
  } else {
    log.info('persistProductAggregationResult: scope=partial, skipping brand/ingredient matching, image upload')
  }

  // Apply classification (only present for full scope)
  if (classification) {
    log.info('persistProductAggregationResult: applying classification', { productType: classification.productType, attributeCount: classification.productAttributes.length, claimCount: classification.productClaims.length })
    jlog.info('Classification applied', { productType: classification.productType, attributeCount: classification.productAttributes.length, claimCount: classification.productClaims.length }, { event: true, labels: ['classification', 'persistence'] })
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

  // ── Score history ──
  // Compute current store + creator scores and append to history
  try {
    // Store score: avg rating across source products (0–5 stars → 0–10)
    let storeScore: number | null = null
    if (sourceProductIds.length > 0) {
      const sourceProducts = await payload.find({
        collection: 'source-products',
        where: { id: { in: sourceProductIds } },
        limit: sourceProductIds.length,
      })
      const rated = (sourceProducts.docs as Array<{ rating?: number | null; ratingNum?: number | null }>)
        .filter(sp => sp.rating != null && sp.ratingNum != null && Number(sp.ratingNum) > 0)
      if (rated.length > 0) {
        const avgRating = rated.reduce((sum, sp) => sum + Number(sp.rating), 0) / rated.length
        storeScore = Math.round(avgRating * 2 * 10) / 10 // stars→0-10, 1 decimal
      }
    }

    // Creator score: avg sentiment from video-mentions (-1…+1 → 0–10)
    let creatorScore: number | null = null
    const mentions = await payload.find({
      collection: 'video-mentions',
      where: { product: { equals: productId } },
      limit: 500,
    })
    const scoredMentions = (mentions.docs as Array<{ overallSentimentScore?: number | null }>)
      .filter(m => m.overallSentimentScore != null)
    if (scoredMentions.length > 0) {
      const avgSentiment = scoredMentions.reduce((sum, m) => sum + Number(m.overallSentimentScore), 0) / scoredMentions.length
      creatorScore = Math.round(((avgSentiment + 1) * 5) * 10) / 10 // -1…+1 → 0–10, 1 decimal
    }

    // Only record if at least one score exists
    if (storeScore != null || creatorScore != null) {
      const existingHistory = ((product.scoreHistory ?? []) as Array<{
        recordedAt: string
        storeScore?: number | null
        creatorScore?: number | null
        change?: string | null
      }>)

      // Determine change direction vs previous record (requires >= 5% relative move)
      let change: string | null = null
      if (existingHistory.length > 0) {
        const prev = existingHistory[0] // newest first (prepended)
        const scoreChange = (current: number, previous: number): 'drop' | 'increase' | 'stable' => {
          if (previous === 0) return current > 0 ? 'increase' : 'stable'
          const pct = (current - previous) / previous
          if (pct <= -0.05) return 'drop'
          if (pct >= 0.05) return 'increase'
          return 'stable'
        }
        // Compare whichever scores are available; use store score first
        if (storeScore != null && prev.storeScore != null) {
          change = scoreChange(storeScore, Number(prev.storeScore))
        } else if (creatorScore != null && prev.creatorScore != null) {
          change = scoreChange(creatorScore, Number(prev.creatorScore))
        }
        // If a second score also exists, let it override to 'drop'/'increase' if store was stable
        if (change === 'stable' && creatorScore != null && prev.creatorScore != null && storeScore != null && prev.storeScore != null) {
          const creatorChange = scoreChange(creatorScore, Number(prev.creatorScore))
          if (creatorChange !== 'stable') change = creatorChange
        }
      }

      const scoreEntry = {
        recordedAt: new Date().toISOString(),
        storeScore,
        creatorScore,
        change,
      }

      updateData.scoreHistory = [scoreEntry, ...existingHistory]
      log.info('persistProductAggregationResult: score history computed', { storeScore, creatorScore, change })
    }
  } catch (error) {
    warningMessages.push(`Score history computation failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
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
