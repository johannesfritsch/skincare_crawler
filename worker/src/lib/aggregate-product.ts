interface AggregatedData {
  name?: string
  description?: string
  brandName?: string
  ingredientsText?: string
  selectedImageUrl?: string
  selectedImageAlt?: string | null
}

// An aggregation source combines product-level data (from source-products)
// with variant-level data (from the source-variant matching the GTIN being aggregated).
interface AggregationSource {
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
}

interface AggregateOptions {
  imageSourcePriority?: string[]
}

import { DEFAULT_IMAGE_SOURCE_PRIORITY } from '@/lib/source-discovery/driver'

// Aggregate data from multiple sources (source-product + source-variant pairs) for the same GTIN.
// Deduplicates descriptions and ingredients across variants to avoid passing identical content
// to LLMs multiple times during classification.
export function aggregateFromSources(sources: AggregationSource[], options?: AggregateOptions): AggregatedData | null {
  if (sources.length === 0) return null

  const aggregated: AggregatedData = {}

  // Name: pick the longest non-null name (most complete, e.g. includes variant label)
  const names = sources.map((s) => s.name).filter((n): n is string => !!n)
  if (names.length > 0) {
    aggregated.name = names.reduce((a, b) => (b.length > a.length ? b : a))
  }

  // Brand: first non-null (should agree across sources)
  aggregated.brandName = sources.find((s) => s.brandName)?.brandName ?? undefined

  // Ingredients: pick the longest unique raw text (most complete INCI).
  // Often identical across variants of the same product — deduplicate by content.
  let bestIngredientsText = ''
  for (const s of sources) {
    if (s.ingredientsText && s.ingredientsText.length > bestIngredientsText.length) {
      bestIngredientsText = s.ingredientsText
    }
  }
  if (bestIngredientsText) {
    aggregated.ingredientsText = bestIngredientsText
  }

  // Image: pick the first image from the highest-priority source
  const priority = options?.imageSourcePriority ?? DEFAULT_IMAGE_SOURCE_PRIORITY
  for (const source of priority) {
    const s = sources.find(
      (src) => src.source === source && src.images && src.images.length > 0,
    )
    if (s && s.images && s.images.length > 0) {
      aggregated.selectedImageUrl = s.images[0].url
      aggregated.selectedImageAlt = s.images[0].alt ?? null
      break
    }
  }
  // Fallback: if no source matched priority, pick from any source that has images
  if (!aggregated.selectedImageUrl) {
    const anyWithImages = sources.find(
      (s) => s.images && s.images.length > 0,
    )
    if (anyWithImages && anyWithImages.images && anyWithImages.images.length > 0) {
      aggregated.selectedImageUrl = anyWithImages.images[0].url
      aggregated.selectedImageAlt = anyWithImages.images[0].alt ?? null
    }
  }

  if (Object.keys(aggregated).length === 0) {
    return null
  }

  return aggregated
}

// Deduplicate descriptions across sources by content fingerprint.
// Returns only unique descriptions to avoid sending identical text to LLMs.
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

// Deduplicate ingredients text across sources by content fingerprint.
// Returns only unique ingredients to avoid sending identical text to LLMs.
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
