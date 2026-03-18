import type { PayloadRestClient } from '@/lib/payload-client'
import type { SourceSlug } from '@/lib/source-product-queries'
import { normalizeProductUrl, normalizeVariantUrl } from '@/lib/source-product-queries'

import { matchProduct } from '@/lib/match-product'
import { matchBrand } from '@/lib/match-brand'
import { matchIngredients } from '@/lib/match-ingredients'
import { parseIngredients } from '@/lib/parse-ingredients'
import { createLogger } from '@/lib/logger'

const log = createLogger('Persist')

/**
 * Extract amount and unit from a free-text string (e.g. "100 ml", "1,5l", "Tagescreme 50 ml").
 * Supports German (comma) and international (dot) decimals with up to 2 decimal places.
 * Units: mg, g, kg, ml, l (case-insensitive). The unit must be followed by a word boundary
 * (whitespace, comma, period, dash, parenthesis, end of string, etc.) to avoid false positives
 * like "global" or "light".
 */
function parseAmountFromText(text: string): { amount: number; amountUnit: string } | null {
  // Match: number (with optional comma/dot decimal up to 2 places) + optional space + unit + word boundary
  const match = text.match(/(\d+(?:[.,]\d{1,2})?)\s*(mg|kg|ml|g|l)(?=[\s,.);\-\/\]!?]|$)/i)
  if (!match) return null
  const amount = parseFloat(match[1].replace(',', '.'))
  if (isNaN(amount) || amount <= 0) return null
  return { amount, amountUnit: match[2].toLowerCase() }
}

/**
 * Compute per-unit price from total price and product amount.
 * Used as a fallback when the driver doesn't provide per-unit pricing.
 *
 * - ml/g → price per 100 units
 * - l/kg → price per 1 unit
 * - anything else → price per 1 unit (preserves original unit casing)
 */
function computePerUnitPrice(
  priceCents: number,
  amount: number,
  amountUnit: string,
): { perUnitAmount: number; perUnitQuantity: number; perUnitUnit: string } {
  const u = amountUnit.toLowerCase()
  if (u === 'ml' || u === 'g') {
    return {
      perUnitAmount: Math.round(priceCents / amount * 100),
      perUnitQuantity: 100,
      perUnitUnit: u,
    }
  } else if (u === 'l' || u === 'kg') {
    return {
      perUnitAmount: Math.round(priceCents / amount),
      perUnitQuantity: 1,
      perUnitUnit: u,
    }
  } else {
    return {
      perUnitAmount: Math.round(priceCents / amount),
      perUnitQuantity: 1,
      perUnitUnit: amountUnit,
    }
  }
}

interface ScrapedProductData {
  gtin?: string
  name: string
  brandName?: string
  brandUrl?: string
  brandImageUrl?: string
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
      sourceArticleNumber?: string | null
    }>
  }>
  labels?: string[]
  rating?: number
  ratingCount?: number
  sourceArticleNumber?: string
  sourceProductArticleNumber?: string
  categoryBreadcrumbs?: string[]
  categoryUrl?: string
  canonicalUrl?: string
  perUnitAmount?: number
  perUnitQuantity?: number
  perUnitUnit?: string
  availability?: 'available' | 'unavailable' | 'unknown'
  warnings: string[]
  reviews?: Array<{
    externalId: string
    rating: number
    title?: string
    reviewText?: string
    userNickname?: string
    submittedAt?: string
    isRecommended?: boolean | null
    positiveFeedbackCount?: number
    negativeFeedbackCount?: number
    reviewerAge?: string
    reviewerGender?: string
  }>
}

type Availability = 'available' | 'unavailable' | 'unknown'

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
  /** The parent source-product (undefined for new URLs — will be find-or-created during persist) */
  sourceProductId?: number
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
  const { crawlId, source, data, crawlVariants } = input
  let { sourceVariantId, sourceProductId } = input
  const variantUrl = normalizeVariantUrl(input.sourceUrl)
  const jlog = log.forJob('product-crawls', crawlId)
  log.info('persistCrawlResult: starting', { crawlId, sourceVariantId: sourceVariantId ?? 'none (first crawl)', sourceProductId: sourceProductId ?? 'none (will create)', source })

  // If no sourceProductId, create the source-product now (crawl is the sole creator)
  if (!sourceProductId) {
    const productUrl = normalizeProductUrl(input.sourceUrl)
    const existingProduct = await payload.find({
      collection: 'source-products',
      where: { sourceUrl: { equals: productUrl } },
      limit: 1,
    })
    if (existingProduct.docs.length > 0) {
      sourceProductId = (existingProduct.docs[0] as Record<string, unknown>).id as number
    } else {
      const newProduct = await payload.create({
        collection: 'source-products',
        data: { source, sourceUrl: productUrl },
      }) as { id: number }
      sourceProductId = newProduct.id
      log.info('persistCrawlResult: created source-product', { sourceProductId, url: productUrl })
    }
  }
  const warnings = [...data.warnings]

  // Build category breadcrumb string
  const categoryBreadcrumb = data.categoryBreadcrumbs && data.categoryBreadcrumbs.length > 0
    ? data.categoryBreadcrumbs.join(' -> ')
    : null

  const now = new Date().toISOString()

  // Find the selected variant's label (needed early for amount fallback extraction)
  let crawledVariantLabel: string | undefined
  let crawledVariantDimension: string | undefined
  let crawledVariantArticleNumber: string | undefined
  for (const variantGroup of data.variants) {
    for (const option of variantGroup.options) {
      if (option.isSelected) {
        crawledVariantLabel = option.label || undefined
        crawledVariantDimension = variantGroup.dimension || undefined
        crawledVariantArticleNumber = option.sourceArticleNumber || undefined
        break
      }
    }
    if (crawledVariantLabel) break
  }

  // Amount/unit: use driver-provided values, fall back to parsing from variant label or product name
  let effectiveAmount = data.amount ?? null
  let effectiveAmountUnit = data.amountUnit ?? null
  if (effectiveAmount == null || effectiveAmountUnit == null) {
    const parsed = (crawledVariantLabel ? parseAmountFromText(crawledVariantLabel) : null)
      ?? parseAmountFromText(data.name)
    if (parsed) {
      effectiveAmount = parsed.amount
      effectiveAmountUnit = parsed.amountUnit
    }
  }

  // Build price entry for the crawled variant (written to source-variant, not source-product)
  // A price entry is always created when we have either price OR availability info.
  const newAmount = data.priceCents ?? null
  const effectiveAvailability: Availability = data.availability ?? 'available'

  // Per-unit price: use driver-provided values, fall back to computation from price + amount
  let perUnitAmount = data.perUnitAmount ?? null
  let perUnitQuantity = data.perUnitQuantity ?? null
  let perUnitUnit = data.perUnitUnit ?? null
  if (perUnitAmount == null && data.priceCents && effectiveAmount && effectiveAmountUnit) {
    const computed = computePerUnitPrice(data.priceCents, effectiveAmount, effectiveAmountUnit)
    perUnitAmount = computed.perUnitAmount
    perUnitQuantity = computed.perUnitQuantity
    perUnitUnit = computed.perUnitUnit
  }

  const priceEntry = (newAmount != null || effectiveAvailability) ? {
    recordedAt: now,
    amount: newAmount,
    currency: newAmount != null ? (data.currency ?? 'EUR') : null,
    perUnitAmount,
    perUnitCurrency: perUnitAmount ? (data.currency ?? 'EUR') : null,
    perUnitQuantity,
    unit: perUnitUnit,
    availability: effectiveAvailability,
    change: null as string | null, // computed below after fetching variant's existing history
  } : null

  // If the variant already exists, fetch its price history for change computation
  let existingVariantHistory: Array<{ amount?: number | null; availability?: Availability | null }> = []
  if (sourceVariantId && priceEntry) {
    const existingVariant = await payload.findByID({ collection: 'source-variants', id: sourceVariantId }) as Record<string, unknown>
    existingVariantHistory = (existingVariant.priceHistory as Array<{ amount?: number | null; availability?: Availability | null }>) ?? []
  }

  // Compute price change vs previous entry on this variant (requires >= 5% move)
  let priceChange: string | null = null
  if (priceEntry && existingVariantHistory.length > 0) {
    const prevAmount = existingVariantHistory[0]?.amount
    if (prevAmount != null && prevAmount > 0) {
      const pctChange = (newAmount! - prevAmount) / prevAmount
      if (pctChange <= -0.05) priceChange = 'drop'
      else if (pctChange >= 0.05) priceChange = 'increase'
      else priceChange = 'stable'
    }
  }
  if (priceEntry) priceEntry.change = priceChange

  // Upsert source-brand first so we can link it to the source-product
  let sourceBrandId: number | null = null
  if (data.brandName && data.brandUrl) {
    const existingBrand = await payload.find({
      collection: 'source-brands',
      where: { sourceUrl: { equals: data.brandUrl } },
      limit: 1,
    })
    if (existingBrand.docs.length === 0) {
      const created = await payload.create({
        collection: 'source-brands',
        data: {
          name: data.brandName,
          source,
          sourceUrl: data.brandUrl,
          ...(data.brandImageUrl ? { imageUrl: data.brandImageUrl } : {}),
        },
      }) as { id: number }
      sourceBrandId = created.id
      jlog.event('persist.source_brand_created', { source, brandName: data.brandName, brandUrl: data.brandUrl })
    } else {
      sourceBrandId = (existingBrand.docs[0] as { id: number }).id
      jlog.event('persist.source_brand_exists', { source, brandUrl: data.brandUrl })
    }
  }

  // Update source-product with product-level data only.
  // Variant-specific data (description, images, ingredientsText, amount, amountUnit) goes on source-variants.
  const productPayload: Record<string, unknown> = {
    source,
    sourceBrand: sourceBrandId,
    name: data.name,
    ...(categoryBreadcrumb ? { categoryBreadcrumb } : {}),
    averageRating: data.rating || null,
    ratingCount: data.ratingCount || null,
    ...(data.sourceProductArticleNumber ? { sourceArticleNumber: data.sourceProductArticleNumber } : {}),
  }

  log.info('persistCrawlResult: updating source-product', { sourceProductId })
  await payload.update({
    collection: 'source-products',
    id: sourceProductId,
    data: productPayload,
  })

  // Determine the canonical URL for the crawled variant
  const canonicalVariantUrl = data.canonicalUrl ? normalizeVariantUrl(data.canonicalUrl) : variantUrl

  // Use the selected variant option's article number if available, otherwise fall back to top-level
  // (top-level is set by Rossmann which only has one DAN per page, and by all drivers as a convenience)
  const effectiveArticleNumber = crawledVariantArticleNumber ?? data.sourceArticleNumber ?? undefined

  // Variant-specific data payload (description, images, ingredientsText, amount, amountUnit, labels)
  // Uses effectiveAmount/effectiveAmountUnit which may have been parsed from variant label or product name
  const variantContentPayload: Record<string, unknown> = {
    description: data.description ?? null,
    images: data.images,
    ingredientsText: data.ingredientsText ?? null,
    amount: effectiveAmount ?? null,
    amountUnit: effectiveAmountUnit ?? null,
    labels: data.labels?.map((l) => ({ label: l })) ?? [],
  }

  if (sourceVariantId) {
    // Existing variant (re-crawl or variant crawl) — update it
    await payload.update({
      collection: 'source-variants',
      id: sourceVariantId,
      data: {
        ...(data.gtin ? { gtin: data.gtin } : {}),
        ...(canonicalVariantUrl !== variantUrl ? { sourceUrl: canonicalVariantUrl } : {}),
        ...(crawledVariantLabel ? { variantLabel: crawledVariantLabel } : {}),
        ...(crawledVariantDimension ? { variantDimension: crawledVariantDimension } : {}),
        ...(effectiveArticleNumber ? { sourceArticleNumber: effectiveArticleNumber } : {}),
        ...(priceEntry ? { priceHistory: [priceEntry, ...existingVariantHistory] } : {}),
        ...variantContentPayload,
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
          variantLabel: crawledVariantLabel,
          variantDimension: crawledVariantDimension,
          sourceArticleNumber: effectiveArticleNumber,
          priceHistory: priceEntry ? [priceEntry] : [],
          ...variantContentPayload,
          crawledAt: now,
        },
      }) as { id: number }
      sourceVariantId = createdVariant.id
      log.info('persistCrawlResult: created variant for crawled URL', { sourceVariantId, url: canonicalVariantUrl })
    } catch (e) {
      // Unique constraint — variant already exists (e.g. created as a sibling during another product's crawl)
      const existing = await payload.find({
        collection: 'source-variants',
        where: { sourceUrl: { equals: canonicalVariantUrl } },
        limit: 1,
      })
      if (existing.docs.length > 0) {
        sourceVariantId = (existing.docs[0] as Record<string, unknown>).id as number
        const existingSpId = (() => {
          const ref = (existing.docs[0] as Record<string, unknown>).sourceProduct
          return typeof ref === 'number' ? ref : (ref as Record<string, unknown>)?.id as number | undefined
        })()
        if (existingSpId !== sourceProductId) {
          log.info('persistCrawlResult: re-linking variant to correct source-product', { sourceVariantId, oldSourceProduct: existingSpId, newSourceProduct: sourceProductId, url: canonicalVariantUrl })
        }
        await payload.update({
          collection: 'source-variants',
          id: sourceVariantId,
          data: {
            sourceProduct: sourceProductId, // Always re-link to the source-product being crawled
            ...(data.gtin ? { gtin: data.gtin } : {}),
            ...(crawledVariantLabel ? { variantLabel: crawledVariantLabel } : {}),
            ...(crawledVariantDimension ? { variantDimension: crawledVariantDimension } : {}),
            ...(effectiveArticleNumber ? { sourceArticleNumber: effectiveArticleNumber } : {}),
            ...(priceEntry ? { priceHistory: [priceEntry] } : {}),
            ...variantContentPayload,
            crawledAt: now,
          },
        })
      } else {
        log.warn('persistCrawlResult: failed to create variant for crawled URL', { error: e instanceof Error ? e.message : String(e) })
      }
    }
  }

  // Persist reviews if provided (linked to source-product + optionally the crawled variant)
  if (data.reviews && data.reviews.length > 0 && sourceProductId) {
    let reviewsCreated = 0
    let reviewsLinked = 0
    for (const review of data.reviews) {
      const existing = await payload.find({
        collection: 'source-reviews',
        where: { externalId: { equals: review.externalId } },
        limit: 1,
      })
      if (existing.totalDocs === 0) {
        await payload.create({
          collection: 'source-reviews',
          data: {
            sourceProduct: sourceProductId,
            ...(sourceVariantId ? { sourceVariants: [sourceVariantId] } : {}),
            externalId: review.externalId,
            rating: review.rating,
            title: review.title ?? null,
            reviewText: review.reviewText ?? null,
            userNickname: review.userNickname ?? null,
            submittedAt: review.submittedAt ?? null,
            isRecommended: review.isRecommended ?? false,
            positiveFeedbackCount: review.positiveFeedbackCount ?? 0,
            negativeFeedbackCount: review.negativeFeedbackCount ?? 0,
            reviewerAge: review.reviewerAge ?? null,
            reviewerGender: review.reviewerGender ?? null,
          },
        })
        reviewsCreated++
      } else if (sourceVariantId) {
        // Review already exists — append this variant if not already linked
        const existingReview = existing.docs[0]
        const existingVariantIds: number[] = Array.isArray(existingReview.sourceVariants)
          ? existingReview.sourceVariants.map((v: any) => (typeof v === 'object' ? v.id : v))
          : []
        if (!existingVariantIds.includes(sourceVariantId)) {
          await payload.update({
            collection: 'source-reviews',
            id: existingReview.id as number,
            data: {
              sourceVariants: [...existingVariantIds, sourceVariantId],
            },
          })
          reviewsLinked++
        }
      }
    }
    if (reviewsCreated > 0 || reviewsLinked > 0) {
      jlog.event('persist.reviews_created', { url: variantUrl, source, count: reviewsCreated + reviewsLinked })
    }
  }

  // Create source-variants for sibling variants found in scraped data.
  // Each driver provides the full variant URL as option.value — persist just stores it.
  // Siblings may belong to the current source-product OR to a different source-product
  // (e.g. DM color variants are separate products with different GTINs/pages).
  // We check if a source-product exists for the sibling's URL and link to it if so.
  let newVariants = 0
  let existingVariants = 0
  let totalVariants = 0
  for (const variantGroup of data.variants) {
    for (const option of variantGroup.options) {
      if (option.isSelected) continue // This is the variant we already created/updated above
      if (!option.value) continue // No URL available — can't create a variant without one
      totalVariants++

      const siblingUrl = normalizeVariantUrl(option.value)

      // Determine which source-product this sibling variant should belong to.
      // If a source-product exists whose sourceUrl matches the sibling's normalized product URL,
      // link the variant to that source-product (it's a separate product, e.g. a different color).
      // Otherwise link to the current source-product.
      const siblingProductUrl = normalizeProductUrl(option.value)
      let siblingSourceProductId = sourceProductId
      if (siblingProductUrl !== normalizeProductUrl(input.sourceUrl)) {
        const siblingProduct = await payload.find({
          collection: 'source-products',
          where: { sourceUrl: { equals: siblingProductUrl } },
          limit: 1,
        })
        if (siblingProduct.docs.length > 0) {
          siblingSourceProductId = (siblingProduct.docs[0] as Record<string, unknown>).id as number
        }
      }

      // Check if this variant URL already exists
      const existingVariant = await payload.find({
        collection: 'source-variants',
        where: { sourceUrl: { equals: siblingUrl } },
        limit: 1,
      })

      if (existingVariant.docs.length === 0) {
        // Create new sibling variant — no price history entry here. The variant will get
        // its real price+availability entry when it is crawled directly. Seeding with an
        // availability-only entry would cause a duplicate when the variant is later crawled
        // (the direct crawl prepends to existing history, resulting in 2 entries).
        try {
          await payload.create({
            collection: 'source-variants',
            data: {
              sourceProduct: siblingSourceProductId,
              sourceUrl: siblingUrl,
              gtin: option.gtin || undefined,
              variantLabel: option.label || undefined,
              variantDimension: variantGroup.dimension || undefined,
              sourceArticleNumber: option.sourceArticleNumber || undefined,
            },
          })
          newVariants++
          log.debug('persistCrawlResult: created sibling variant', { url: siblingUrl, gtin: option.gtin ?? 'none', label: option.label, sourceProduct: siblingSourceProductId })
        } catch (e) {
          // Unique constraint race — safe to ignore
          existingVariants++
          log.debug('persistCrawlResult: skipped sibling variant', { url: siblingUrl, error: e instanceof Error ? e.message : String(e) })
        }
      } else {
        // Update metadata on existing sibling (GTIN, article number, sourceProduct re-linking).
        // Do NOT append availability-only price entries here — that would create N entries per
        // variant per crawl session (one from each sibling's crawl). Availability is tracked:
        // (1) on creation (above), (2) on direct crawl (self-variant logic), (3) on disappearance
        // (disappeared-variant logic below).
        const sv = existingVariant.docs[0] as Record<string, unknown>
        const updates: Record<string, unknown> = {}
        if (option.gtin && !sv.gtin) updates.gtin = option.gtin
        if (option.sourceArticleNumber && !sv.sourceArticleNumber) updates.sourceArticleNumber = option.sourceArticleNumber
        // Re-link to correct source-product if needed
        const existingSpId = (() => {
          const ref = sv.sourceProduct
          return typeof ref === 'number' ? ref : (ref as Record<string, unknown>)?.id as number | undefined
        })()
        if (existingSpId !== siblingSourceProductId) {
          updates.sourceProduct = siblingSourceProductId
          log.debug('persistCrawlResult: re-linking sibling variant', { url: siblingUrl, oldSourceProduct: existingSpId, newSourceProduct: siblingSourceProductId })
        }

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
    jlog.event('persist.variants_processed', { url: variantUrl, newVariants, existingVariants, totalVariants })
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
      if (!scrapedUrls.has(svUrl)) {
        // Check if the most recent price entry already marks it unavailable — skip if so
        const svHistory = (sv.priceHistory as Array<{ availability?: Availability | null }>) ?? []
        const latestAvailability = svHistory[0]?.availability
        if (latestAvailability === 'unavailable') continue

        // Append an unavailable price entry (no price data — just availability status)
        try {
          await payload.update({
            collection: 'source-variants',
            id: sv.id as number,
            data: {
              priceHistory: [
                {
                  recordedAt: now,
                  amount: null,
                  currency: null,
                  perUnitAmount: null,
                  perUnitCurrency: null,
                  perUnitQuantity: null,
                  unit: null,
                  availability: 'unavailable' as const,
                  change: null,
                },
                ...svHistory,
              ],
            },
          })
          markedUnavailable++
        } catch { /* best-effort update */ }
      }
    }
    if (markedUnavailable > 0) {
      jlog.event('persist.variants_disappeared', { url: variantUrl, markedUnavailable })
    }
  }



  // Emit price change event
  if (priceChange && priceChange !== 'stable') {
    const prevAmount = existingVariantHistory[0]?.amount ?? null
    jlog.event('persist.price_changed', {
      url: variantUrl,
      source,
      change: priceChange,
      previousCents: prevAmount ?? 0,
      currentCents: newAmount ?? 0,
    })
  }

  // Emit ingredient extraction signal
  const hasIngredients = !!data.ingredientsText && data.ingredientsText.trim().length > 0
  if (hasIngredients) {
    jlog.event('persist.ingredients_found', {
      url: variantUrl,
      source,
      chars: data.ingredientsText!.trim().length,
    })
  }

  // Log warnings
  if (warnings.length > 0) {
    log.info('persistCrawlResult: source-product has warnings', { sourceProductId, warningCount: warnings.length })
  }
  for (const warning of warnings) {
    jlog.event('persist.crawl_warning', { warning })
  }

  return { productId: sourceProductId, warnings, newVariants, existingVariants, hasIngredients, priceChange }
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

  // Build CosIng source entry if we have a sourceUrl
  // fieldsProvided tracks exactly which content fields this source populated
  const cosIngFieldsProvided = [
    'name', // always provided by CosIng
    ...(data.casNumber ? ['casNumber'] : []),
    ...(data.ecNumber ? ['ecNumber'] : []),
    ...(data.cosIngId ? ['cosIngId'] : []),
    ...(data.chemicalDescription ? ['chemicalDescription'] : []),
    ...(data.functions.length > 0 ? ['functions'] : []),
    ...(data.itemType ? ['itemType'] : []),
    ...(data.restrictions ? ['restrictions'] : []),
  ]
  const cosIngSource = data.sourceUrl
    ? { source: 'cosing', sourceUrl: data.sourceUrl, fieldsProvided: cosIngFieldsProvided }
    : null

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
          sources: cosIngSource ? [cosIngSource] : [],
          status: 'uncrawled',
        },
      })
      return { isNew: true }
    } catch (createError: unknown) {
      const errorMessage = createError instanceof Error ? createError.message : String(createError)
      // Only swallow unique constraint violations (race condition with another worker)
      if (errorMessage.includes('unique') || errorMessage.includes('duplicate')) {
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

    // Add CosIng source if not already present, or update fieldsProvided if it exists
    if (cosIngSource) {
      const existingSources = (doc.sources as Array<{ source: string; fieldsProvided?: string[] }>) ?? []
      const cosIngIdx = existingSources.findIndex((s) => s.source === 'cosing')
      if (cosIngIdx === -1) {
        updates.sources = [...existingSources, cosIngSource]
      } else if (!existingSources[cosIngIdx].fieldsProvided?.length) {
        // Backfill fieldsProvided on existing CosIng source entry
        const updated = [...existingSources]
        updated[cosIngIdx] = { ...updated[cosIngIdx], fieldsProvided: cosIngFieldsProvided }
        updates.sources = updated
      }
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
          collection: 'profile-media',
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
            collection: 'video-media',
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

interface SceneTranscript {
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

/**
 * @deprecated Stage-based video processing persists results directly within each stage.
 * This function is retained for backward compatibility but is no longer called.
 * See worker/src/lib/video-processing/stages/ for per-stage persistence.
 *
 * WARNING: This function still references the old `screenshots` array field on
 * video-scenes which has been replaced by the `video-frames` collection.
 * Do NOT call this function — it will fail at runtime.
 */
export async function persistVideoProcessingResult(
  payload: PayloadRestClient,
  jobId: number,
  videoId: number,
  videoMediaId: number | undefined,
  segments: VideoProcessingSegment[],
  transcriptData?: TranscriptData,
  sceneTranscripts?: SceneTranscript[],
  sceneVideoQuotes?: VideoQuoteData[][],
): Promise<void> {
  const jlog = log.forJob('video-processings', jobId)
  log.info('persistVideoProcessingResult: starting', { videoId, segmentCount: segments.length })

  // Delete existing scenes and their video-mentions for this video
  const existingScenes = await payload.find({
    collection: 'video-scenes',
    where: { video: { equals: videoId } },
    limit: 1000,
  })
  if (existingScenes.docs.length > 0) {
    // Delete video-mentions for existing scenes
    for (const scene of existingScenes.docs) {
      const sceneId = (scene as { id: number }).id
      await payload.delete({
        collection: 'video-mentions',
        where: { videoScene: { equals: sceneId } },
      })
    }
    await payload.delete({
      collection: 'video-scenes',
      where: { video: { equals: videoId } },
    })
    log.info('Deleted existing scenes and video-mentions', { sceneCount: existingScenes.docs.length, videoId })
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

    // Get transcript data for this scene
    const sceneTx = sceneTranscripts?.[segIdx]

    const sceneDoc = await payload.create({
      collection: 'video-scenes',
      data: {
        video: videoId,
        image: firstScreenshot as number,
        matchingType: segment.matchingType,
        timestampStart: segment.timestampStart,
        timestampEnd: segment.timestampEnd,
        screenshots: screenshotEntries,
        ...(referencedProductIds.length > 0 ? { referencedProducts: referencedProductIds } : {}),
        ...(sceneTx ? {
          preTranscript: sceneTx.preTranscript,
          transcript: sceneTx.transcript,
          postTranscript: sceneTx.postTranscript,
        } : {}),
      },
    })

    const sceneId = (sceneDoc as { id: number }).id

    // Create video-mention records for this scene (only when sentiment data exists)
    const videoMentions = sceneVideoQuotes?.[segIdx]
    if (videoMentions && videoMentions.length > 0) {
      for (const vq of videoMentions) {
        await payload.create({
          collection: 'video-mentions',
          data: {
            videoScene: sceneId,
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
        log.info('Created video-mention', { sceneId, productId: vq.productId, quoteCount: vq.quotes.length, sentiment: vq.overallSentiment })
      }
    }

    // Emit event with segment log
    jlog.event('video_processing.segment_persisted', { message: segment.eventLog })
  }

  // Save transcript on the video
  if (transcriptData) {
    await payload.update({
      collection: 'videos',
      id: videoId,
      data: {
        transcript: transcriptData.transcript,
        transcriptWords: transcriptData.transcriptWords,
      },
    })
  }

  log.info('Video persisted', { videoId, segmentCount: segments.length })
}

// ─── Product Aggregation ───
// @deprecated — The monolithic persistProductAggregationResult() function is deprecated.
// Logic has been split into 7 stage files in worker/src/lib/product-aggregation/stages/.
// Each stage persists its own results inline. This function is kept for backward
// compatibility but is no longer called by the stage-based pipeline.

export interface PersistVariantInput {
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
}

export interface PersistProductAggregationInput {
  /** All GTINs in this product group */
  variantResults: PersistVariantInput[]
  sourceProductIds: number[]
  // Product-level aggregated data
  productData: {
    name?: string
    brandName?: string
  } | null
  // Classification results (full scope only) — written to each product-variant
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
  /** full = LLM classification + brand/ingredient matching + image. partial = score history + basic data only. */
  scope: 'full' | 'partial'
}

/**
 * @deprecated Use the stage-based pipeline in `worker/src/lib/product-aggregation/stages/` instead.
 * This monolithic function is no longer called by the stage-based pipeline — each stage
 * (resolve, classify, match_brand, ingredients, images, descriptions, score_history)
 * persists its own results inline. Kept for backward compatibility only.
 */
export async function persistProductAggregationResult(
  payload: PayloadRestClient,
  jobId: number,
  input: PersistProductAggregationInput,
): Promise<{ productId: number; tokensUsed: number; error?: string; warning?: string }> {
  const { variantResults, sourceProductIds, productData, classification, classifySourceProductIds, scope } = input
  const jlog = log.forJob('product-aggregations', jobId)
  const gtinLabels = variantResults.map((v) => v.gtin).join(', ')
  log.info('persistProductAggregationResult: starting', { gtins: gtinLabels, variantCount: variantResults.length, sourceProductCount: sourceProductIds.length })
  let tokensUsed = 0
  const errorMessages: string[] = []
  const warningMessages: string[] = []

  if (variantResults.length === 0) {
    log.info('persistProductAggregationResult: no variant data to aggregate', { gtins: gtinLabels })
    return { productId: 0, tokensUsed: 0, error: 'No variant data to aggregate from sources' }
  }

  // ══════════════════════════════════════════════════════════════════════
  // Phase 1: Resolve or create the unified product + product-variants
  //
  // Look up existing product-variants for each GTIN.
  // If some GTINs already have product-variants pointing to different products,
  // merge them: keep the first product, move all variants to it, delete the empty ones.
  // ══════════════════════════════════════════════════════════════════════

  let productId: number | null = null
  const variantMap = new Map<string, number>() // gtin → product-variant ID
  const productsToMerge = new Set<number>() // existing product IDs that need merging

  // Find existing product-variants for all GTINs in the group
  for (const vr of variantResults) {
    const existing = await payload.find({
      collection: 'product-variants',
      where: { gtin: { equals: vr.gtin } },
      limit: 1,
    })

    if (existing.docs.length > 0) {
      const variant = existing.docs[0] as Record<string, unknown>
      variantMap.set(vr.gtin, variant.id as number)
      const productRef = variant.product as number | Record<string, unknown>
      const pid = typeof productRef === 'number' ? productRef : (productRef as { id: number }).id
      productsToMerge.add(pid)
    }
  }

  if (productsToMerge.size > 0) {
    // Use the first existing product as the canonical one
    productId = [...productsToMerge][0]

    // Merge: move all product-variants from other products to the canonical product
    if (productsToMerge.size > 1) {
      const otherProductIds = [...productsToMerge].slice(1)
      log.info('persistProductAggregationResult: merging products', { canonical: productId, merging: otherProductIds.join(',') })

      for (const otherId of otherProductIds) {
        // Move all product-variants from the other product to the canonical product
        const otherVariants = await payload.find({
          collection: 'product-variants',
          where: { product: { equals: otherId } },
          limit: 1000,
        })

        for (const ov of otherVariants.docs) {
          await payload.update({
            collection: 'product-variants',
            id: (ov as { id: number }).id,
            data: { product: productId },
          })
        }

        // Merge source products from the other product into the canonical one
        const otherProduct = await payload.findByID({ collection: 'products', id: otherId }) as Record<string, unknown>
        const otherSourceIds = ((otherProduct.sourceProducts ?? []) as unknown[]).map((sp: unknown) =>
          Number(typeof sp === 'object' && sp !== null && 'id' in sp ? (sp as { id: number }).id : sp),
        ).filter((id) => !isNaN(id))

        if (otherSourceIds.length > 0) {
          const canonicalProduct = await payload.findByID({ collection: 'products', id: productId }) as Record<string, unknown>
          const existingIds = ((canonicalProduct.sourceProducts ?? []) as unknown[]).map((sp: unknown) =>
            Number(typeof sp === 'object' && sp !== null && 'id' in sp ? (sp as { id: number }).id : sp),
          ).filter((id) => !isNaN(id))
          const mergedIds = [...new Set([...existingIds, ...otherSourceIds])]
          await payload.update({
            collection: 'products',
            id: productId,
            data: { sourceProducts: mergedIds },
          })
        }

        // Move video-mentions from the other product to the canonical one
        try {
          const otherMentions = await payload.find({
            collection: 'video-mentions',
            where: { product: { equals: otherId } },
            limit: 1000,
          })
          for (const mention of otherMentions.docs) {
            await payload.update({
              collection: 'video-mentions',
              id: (mention as { id: number }).id,
              data: { product: productId },
            })
          }
          if (otherMentions.docs.length > 0) {
            log.info('persistProductAggregationResult: moved video-mentions', { from: otherId, to: productId, count: otherMentions.docs.length })
          }
        } catch (e) {
          warningMessages.push(`Failed to move video-mentions from product ${otherId}: ${e instanceof Error ? e.message : String(e)}`)
        }

        // Delete the now-empty other product
        try {
          await payload.delete({
            collection: 'products',
            where: { id: { equals: otherId } },
          })
          log.info('persistProductAggregationResult: deleted merged product', { deletedProductId: otherId })
        } catch (e) {
          warningMessages.push(`Failed to delete merged product ${otherId}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    }

    log.info('persistProductAggregationResult: using existing product', { productId, existingVariants: variantMap.size })
  } else {
    // No existing product-variants found — create a new product
    const newProduct = await payload.create({
      collection: 'products',
      data: {
        name: productData?.name || undefined,
      },
    }) as { id: number }
    productId = newProduct.id
    log.info('persistProductAggregationResult: created new product', { productId })
  }

  // Create product-variants for GTINs that don't have one yet
  for (const vr of variantResults) {
    if (!variantMap.has(vr.gtin)) {
      const newVariant = await payload.create({
        collection: 'product-variants',
        data: {
          product: productId,
          gtin: vr.gtin,
          label: vr.variantData.variantLabel || productData?.name || vr.gtin,
          ...(vr.variantData.sourceVariantIds.length > 0 ? { sourceVariants: vr.variantData.sourceVariantIds } : {}),
        },
      }) as { id: number }
      variantMap.set(vr.gtin, newVariant.id)
      log.info('persistProductAggregationResult: created product-variant', { gtin: vr.gtin, variantId: newVariant.id, productId })
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // Phase 2: Persist variant-level data to each product-variant
  // ══════════════════════════════════════════════════════════════════════

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
      result.ingredientNames = entry.ingredientNames.map((name: string) => ({ name }))
    }
    return result
  }

  for (const vr of variantResults) {
    const variantId = variantMap.get(vr.gtin)!
    const vd = vr.variantData

    const variantUpdateData: Record<string, unknown> = {
      sourceVariants: vd.sourceVariantIds,
    }

    // Basic variant fields
    if (vd.variantLabel) variantUpdateData.label = vd.variantLabel
    if (vd.variantDimension) variantUpdateData.variantDimension = vd.variantDimension
    if (vd.amount != null) variantUpdateData.amount = vd.amount
    if (vd.amountUnit) variantUpdateData.amountUnit = vd.amountUnit

    // Description (from consensus LLM or single source)
    if (vd.description) {
      variantUpdateData.description = vd.description
    }

    // Labels (from LLM deduplication)
    if (vd.labels && vd.labels.length > 0) {
      variantUpdateData.labels = vd.labels.map((label) => ({ label }))
    }

    // ── Full scope only: ingredient matching, image upload ──
    if (scope === 'full') {
      // Parse and match ingredients from raw text → write to variant
      if (vd.ingredientsText) {
        try {
          const ingredientNames = await parseIngredients(vd.ingredientsText)
          log.info('persistProductAggregationResult: parsed ingredients from raw text', { gtin: vr.gtin, ingredientCount: ingredientNames.length })

          if (ingredientNames.length > 0) {
            const matchResult = await matchIngredients(payload, ingredientNames, jlog)
            tokensUsed += matchResult.tokensUsed.totalTokens

            const matchedMap = new Map(
              matchResult.matched.map((m) => [m.originalName, m.ingredientId]),
            )
            variantUpdateData.ingredients = ingredientNames.map((name) => ({
              name,
              ingredient: matchedMap.get(name) ?? null,
            }))

            log.info('persistProductAggregationResult: ingredients matched', { gtin: vr.gtin, matched: matchResult.matched.length, unmatched: matchResult.unmatched.length, total: ingredientNames.length })
            jlog.event('aggregation.ingredients_matched', { matched: matchResult.matched.length, unmatched: matchResult.unmatched.length, total: ingredientNames.length })

            if (matchResult.unmatched.length > 0) {
              warningMessages.push(`[${vr.gtin}] Unmatched ingredients:\n${matchResult.unmatched.join('\n')}`)
            }
          }
        } catch (error) {
          errorMessages.push(`[${vr.gtin}] Ingredient parsing/matching failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
        }
      }

      // Upload image → write to variant
      if (vd.selectedImageUrl) {
        try {
          log.info('persistProductAggregationResult: downloading image', { gtin: vr.gtin, url: vd.selectedImageUrl })
          const imageRes = await fetch(vd.selectedImageUrl)
          if (!imageRes.ok) {
            warningMessages.push(`[${vr.gtin}] Image download failed (${imageRes.status}): ${vd.selectedImageUrl}`)
          } else {
            const contentType = imageRes.headers.get('content-type') || 'image/jpeg'
            const buffer = Buffer.from(await imageRes.arrayBuffer())

            const urlPath = new URL(vd.selectedImageUrl).pathname
            const filename = urlPath.split('/').pop() || `variant-${variantId}.jpg`

            const mediaDoc = await payload.create({
              collection: 'product-media',
              data: { alt: vd.selectedImageAlt || productData?.name || `Variant ${vr.gtin}` },
              file: { data: buffer, mimetype: contentType, name: filename, size: buffer.length },
            })
            const mediaId = (mediaDoc as { id: number }).id
            variantUpdateData.images = [{ image: mediaId }]
            log.info('persistProductAggregationResult: uploaded image to variant', { gtin: vr.gtin, mediaId, variantId })
            jlog.event('aggregation.image_uploaded', { gtin: vr.gtin, total: 1, public: 1, recognitionOnly: 0, failed: 0 })
          }
        } catch (error) {
          warningMessages.push(`[${vr.gtin}] Image upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
        }
      }

      // Apply classification fields to variant (attributes, claims, details)
      // Classification is shared across all variants (computed once per product group)
      if (classification) {
        log.info('persistProductAggregationResult: applying classification to variant', { gtin: vr.gtin, productType: classification.productType, attributeCount: classification.productAttributes.length, claimCount: classification.productClaims.length })
        jlog.event('aggregation.classification_applied', { productType: classification.productType, attributeCount: classification.productAttributes.length, claimCount: classification.productClaims.length })

        if (classification.warnings != null) variantUpdateData.warnings = classification.warnings
        if (classification.skinApplicability != null) variantUpdateData.skinApplicability = classification.skinApplicability
        if (classification.phMin != null) variantUpdateData.phMin = classification.phMin
        if (classification.phMax != null) variantUpdateData.phMax = classification.phMax
        if (classification.usageInstructions != null) variantUpdateData.usageInstructions = classification.usageInstructions
        if (classification.usageSchedule != null) variantUpdateData.usageSchedule = classification.usageSchedule

        variantUpdateData.productAttributes = classification.productAttributes
          .filter((e) => classifySourceProductIds?.[e.sourceIndex] !== undefined)
          .map((entry) => ({ attribute: entry.attribute, ...mapEvidence(entry) }))

        variantUpdateData.productClaims = classification.productClaims
          .filter((e) => classifySourceProductIds?.[e.sourceIndex] !== undefined)
          .map((entry) => ({ claim: entry.claim, ...mapEvidence(entry) }))
      }
    } else {
      log.info('persistProductAggregationResult: scope=partial, skipping variant LLM ops', { gtin: vr.gtin })
    }

    // Write variant data
    await payload.update({
      collection: 'product-variants',
      id: variantId,
      data: variantUpdateData,
    })
  }

  // ══════════════════════════════════════════════════════════════════════
  // Phase 3: Persist product-level data to product
  // ══════════════════════════════════════════════════════════════════════

  const product = await payload.findByID({ collection: 'products', id: productId }) as Record<string, unknown>

  // Merge source product IDs (normalize to numbers for reliable dedup)
  const existingSourceIds = ((product.sourceProducts ?? []) as unknown[]).map((sp: unknown) =>
    Number(typeof sp === 'object' && sp !== null && 'id' in sp ? (sp as { id: number }).id : sp),
  ).filter((id) => !isNaN(id))
  const allIds = [...new Set([...existingSourceIds, ...sourceProductIds.map(Number)])]

  const productUpdateData: Record<string, unknown> = {
    sourceProducts: allIds,
  }

  if (productData?.name) {
    productUpdateData.name = productData.name
  }

  if (scope === 'full') {
    // Match brand → product-level
    if (productData?.brandName) {
      try {
        const brandResult = await matchBrand(payload, productData.brandName, jlog)
        tokensUsed += brandResult.tokensUsed.totalTokens
        productUpdateData.brand = brandResult.brandId
        log.info('persistProductAggregationResult: brand matched', { brandName: productData.brandName, brandId: brandResult.brandId })
        jlog.event('aggregation.brand_matched', { brandName: productData.brandName, brandId: brandResult.brandId })
      } catch (error) {
        errorMessages.push(`Brand matching error: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }

    // Product type from classification → product-level
    if (classification?.productType) {
      const ptDoc = await payload.find({
        collection: 'product-types',
        where: { slug: { equals: classification.productType } },
        limit: 1,
      })
      if (ptDoc.docs.length > 0) {
        productUpdateData.productType = (ptDoc.docs[0] as { id: number }).id
      }
    }
  }

  // ── Score history (always computed) ──
  try {
    let storeScore: number | null = null
    if (sourceProductIds.length > 0) {
      const sourceProducts = await payload.find({
        collection: 'source-products',
        where: { id: { in: sourceProductIds } },
        limit: sourceProductIds.length,
      })
      const rated = (sourceProducts.docs as Array<{ averageRating?: number | null; ratingCount?: number | null }>)
        .filter(sp => sp.averageRating != null && sp.ratingCount != null && Number(sp.ratingCount) > 0)
      if (rated.length > 0) {
        const avgRating = rated.reduce((sum, sp) => sum + Number(sp.averageRating), 0) / rated.length
        storeScore = Math.round(avgRating * 2 * 10) / 10
      }
    }

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
      creatorScore = Math.round(((avgSentiment + 1) * 5) * 10) / 10
    }

    if (storeScore != null || creatorScore != null) {
      const existingHistory = ((product.scoreHistory ?? []) as Array<{
        recordedAt: string
        storeScore?: number | null
        creatorScore?: number | null
        change?: string | null
      }>)

      let change: string | null = null
      if (existingHistory.length > 0) {
        const prev = existingHistory[0]
        const scoreChange = (current: number, previous: number): 'drop' | 'increase' | 'stable' => {
          if (previous === 0) return current > 0 ? 'increase' : 'stable'
          const pct = (current - previous) / previous
          if (pct <= -0.05) return 'drop'
          if (pct >= 0.05) return 'increase'
          return 'stable'
        }
        if (storeScore != null && prev.storeScore != null) {
          change = scoreChange(storeScore, Number(prev.storeScore))
        } else if (creatorScore != null && prev.creatorScore != null) {
          change = scoreChange(creatorScore, Number(prev.creatorScore))
        }
        if (change === 'stable' && creatorScore != null && prev.creatorScore != null && storeScore != null && prev.storeScore != null) {
          const creatorChange = scoreChange(creatorScore, Number(prev.creatorScore))
          if (creatorChange !== 'stable') change = creatorChange
        }
      }

      productUpdateData.scoreHistory = [{
        recordedAt: new Date().toISOString(),
        storeScore,
        creatorScore,
        change,
      }, ...existingHistory]
      log.info('persistProductAggregationResult: score history computed', { storeScore, creatorScore, change })
    }
  } catch (error) {
    warningMessages.push(`Score history computation failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }

  // Write product data
  await payload.update({
    collection: 'products',
    id: productId,
    data: productUpdateData,
  })

  return {
    productId,
    tokensUsed,
    error: errorMessages.length > 0 ? errorMessages.join('\n\n') : undefined,
    warning: warningMessages.length > 0 ? warningMessages.join('\n\n') : undefined,
  }
}
