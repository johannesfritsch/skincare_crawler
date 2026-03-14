import { DEFAULT_IMAGE_SOURCE_PRIORITY } from '@/lib/source-discovery/driver'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// An aggregation source combines product-level data (from source-products)
// with variant-level data (from the source-variant matching the GTIN being aggregated).
export interface AggregationSource {
  sourceProductId: number
  sourceVariantId: number
  // Product-level
  name?: string | null
  brandName?: string | null
  source?: string | null
  // Variant-level
  ingredientsText?: string | null
  description?: string | null
  images?: Array<{ url: string; alt?: string | null }> | null
  labels?: Array<{ label: string }> | null
  amount?: number | null
  amountUnit?: string | null
  variantLabel?: string | null
  variantDimension?: string | null
}

export interface AggregateOptions {
  imageSourcePriority?: string[]
}

/** A single source image with provenance metadata */
export interface SourceImage {
  url: string
  alt: string | null
  source: string // store slug (dm, rossmann, mueller, purish)
}

// Result of source-variant → product-variant aggregation (per GTIN)
export interface VariantAggregatedData {
  // Consensus from source-variants
  variantLabel?: string
  variantDimension?: string
  amount?: number
  amountUnit?: string
  // Image selection (best image by priority — for backward compat)
  selectedImageUrl?: string
  selectedImageAlt?: string | null
  // All images from all stores (deduplicated by URL)
  allImages: SourceImage[]
  // Raw data for further LLM processing
  ingredientsText?: string
  // Collected for LLM consensus (pre-dedup)
  descriptions: string[]
  // Collected for LLM label dedup
  allLabels: string[]
  // Source info for classification
  sourceProductIds: number[]
  sourceVariantIds: number[]
}

// Result of product-variant → product aggregation
export interface ProductAggregatedData {
  name?: string
  brandName?: string
}

// ---------------------------------------------------------------------------
// Phase 1: Source-Variants → Product-Variant (per GTIN)
// ---------------------------------------------------------------------------

/**
 * Aggregate source-variant data for a single GTIN into variant-level data.
 * Pure logic — no LLM calls. Collects data for subsequent LLM processing.
 */
export function aggregateSourceVariantsToVariant(
  sources: AggregationSource[],
  options?: AggregateOptions,
): VariantAggregatedData | null {
  if (sources.length === 0) return null

  const result: VariantAggregatedData = {
    descriptions: [],
    allLabels: [],
    allImages: [],
    sourceProductIds: sources.map((s) => s.sourceProductId),
    sourceVariantIds: sources.map((s) => s.sourceVariantId),
  }

  // Variant label: most common non-null value (consensus)
  result.variantLabel = mostCommon(sources.map((s) => s.variantLabel).filter(Boolean) as string[])

  // Variant dimension: most common non-null value
  result.variantDimension = mostCommon(sources.map((s) => s.variantDimension).filter(Boolean) as string[])

  // Amount: most common non-null value
  const amounts = sources.map((s) => s.amount).filter((a): a is number => a != null)
  if (amounts.length > 0) {
    result.amount = mostCommon(amounts)
  }

  // Amount unit: most common non-null value
  result.amountUnit = mostCommon(sources.map((s) => s.amountUnit).filter(Boolean) as string[])

  // Ingredients: pick the longest unique raw text (most complete INCI)
  let bestIngredientsText = ''
  for (const s of sources) {
    if (s.ingredientsText && s.ingredientsText.length > bestIngredientsText.length) {
      bestIngredientsText = s.ingredientsText
    }
  }
  if (bestIngredientsText) {
    result.ingredientsText = bestIngredientsText
  }

  // Descriptions: collect all non-null (dedup happens in LLM consensus step)
  for (const s of sources) {
    if (s.description && s.description.trim()) {
      result.descriptions.push(s.description)
    }
  }

  // Labels: collect all from all source-variants, flatten
  for (const s of sources) {
    if (s.labels) {
      for (const l of s.labels) {
        if (l.label && l.label.trim()) {
          result.allLabels.push(l.label)
        }
      }
    }
  }

  // Image: pick the first image from the highest-priority source
  const priority = options?.imageSourcePriority ?? DEFAULT_IMAGE_SOURCE_PRIORITY
  for (const source of priority) {
    const s = sources.find(
      (src) => src.source === source && src.images && src.images.length > 0,
    )
    if (s && s.images && s.images.length > 0) {
      result.selectedImageUrl = s.images[0].url
      result.selectedImageAlt = s.images[0].alt ?? null
      break
    }
  }
  // Fallback: if no source matched priority, pick from any source that has images
  if (!result.selectedImageUrl) {
    const anyWithImages = sources.find(
      (s) => s.images && s.images.length > 0,
    )
    if (anyWithImages && anyWithImages.images && anyWithImages.images.length > 0) {
      result.selectedImageUrl = anyWithImages.images[0].url
      result.selectedImageAlt = anyWithImages.images[0].alt ?? null
    }
  }

  // All images: collect every image from every source, deduplicated by URL
  const seenUrls = new Set<string>()
  for (const s of sources) {
    if (!s.images || !s.source) continue
    for (const img of s.images) {
      if (!img.url || seenUrls.has(img.url)) continue
      seenUrls.add(img.url)
      result.allImages.push({
        url: img.url,
        alt: img.alt ?? null,
        source: s.source,
      })
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Phase 2: Product-Variants → Product
// ---------------------------------------------------------------------------

/**
 * Aggregate variant-level data into product-level data.
 * Currently just picks the best name and brand from all sources.
 */
export function aggregateVariantsToProduct(sources: AggregationSource[]): ProductAggregatedData | null {
  if (sources.length === 0) return null

  const result: ProductAggregatedData = {}

  // Name: pick the longest non-null name (most complete)
  const names = sources.map((s) => s.name).filter((n): n is string => !!n)
  if (names.length > 0) {
    result.name = names.reduce((a, b) => (b.length > a.length ? b : a))
  }

  // Brand: first non-null (should agree across sources)
  result.brandName = sources.find((s) => s.brandName)?.brandName ?? undefined

  return result
}

// ---------------------------------------------------------------------------
// Deduplication helpers (for classification LLM input)
// ---------------------------------------------------------------------------

/** Deduplicate descriptions across sources by content fingerprint. */
export function deduplicateDescriptions(sources: AggregationSource[]): Array<{ sourceProductId: number; description: string }> {
  const seen = new Set<string>()
  const result: Array<{ sourceProductId: number; description: string }> = []
  for (const s of sources) {
    if (!s.description) continue
    const fingerprint = s.description.trim().toLowerCase()
    if (seen.has(fingerprint)) continue
    seen.add(fingerprint)
    result.push({ sourceProductId: s.sourceProductId, description: s.description })
  }
  return result
}

/** Deduplicate ingredients text across sources by content fingerprint. */
export function deduplicateIngredients(sources: AggregationSource[]): Array<{ sourceProductId: number; ingredientsText: string }> {
  const seen = new Set<string>()
  const result: Array<{ sourceProductId: number; ingredientsText: string }> = []
  for (const s of sources) {
    if (!s.ingredientsText) continue
    const fingerprint = s.ingredientsText.trim().toLowerCase()
    if (seen.has(fingerprint)) continue
    seen.add(fingerprint)
    result.push({ sourceProductId: s.sourceProductId, ingredientsText: s.ingredientsText })
  }
  return result
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/** Pick the most common value from an array. Returns undefined if empty. */
function mostCommon<T>(values: T[]): T | undefined {
  if (values.length === 0) return undefined
  const counts = new Map<T, number>()
  for (const v of values) {
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  let best: T = values[0]
  let bestCount = 0
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v
      bestCount = c
    }
  }
  return best
}
