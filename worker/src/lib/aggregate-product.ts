interface AggregatedData {
  name?: string
  description?: string
  brandName?: string
  ingredientsText?: string
  selectedImageUrl?: string
  selectedImageAlt?: string | null
}

interface SourceProductData {
  id: number
  name?: string | null
  brandName?: string | null
  source?: string | null
  ingredientsText?: string | null
  images?: Array<{ url: string; alt?: string | null }> | null
}

interface AggregateOptions {
  imageSourcePriority?: string[]
}

const DEFAULT_IMAGE_SOURCE_PRIORITY = ['dm', 'rossmann', 'mueller']

// Aggregate data from multiple source products for the same GTIN
export function aggregateFromSources(sourceProducts: SourceProductData[], options?: AggregateOptions): AggregatedData | null {
  if (sourceProducts.length === 0) return null

  const aggregated: AggregatedData = {}

  // Name: pick the longest non-null name (most complete, e.g. includes variant label)
  const names = sourceProducts.map((sp) => sp.name).filter((n): n is string => !!n)
  if (names.length > 0) {
    aggregated.name = names.reduce((a, b) => (b.length > a.length ? b : a))
  }

  // Brand: first non-null (should agree across sources)
  aggregated.brandName = sourceProducts.find((sp) => sp.brandName)?.brandName ?? undefined

  // Ingredients: pick the source with the longest raw text (most complete INCI)
  let bestIngredientsText = ''
  for (const sp of sourceProducts) {
    if (sp.ingredientsText && sp.ingredientsText.length > bestIngredientsText.length) {
      bestIngredientsText = sp.ingredientsText
    }
  }
  if (bestIngredientsText) {
    aggregated.ingredientsText = bestIngredientsText
  }

  // Image: pick the first image from the highest-priority source
  const priority = options?.imageSourcePriority ?? DEFAULT_IMAGE_SOURCE_PRIORITY
  for (const source of priority) {
    const sp = sourceProducts.find(
      (s) => s.source === source && s.images && s.images.length > 0,
    )
    if (sp && sp.images && sp.images.length > 0) {
      aggregated.selectedImageUrl = sp.images[0].url
      aggregated.selectedImageAlt = sp.images[0].alt ?? null
      break
    }
  }
  // Fallback: if no source matched priority, pick from any source that has images
  if (!aggregated.selectedImageUrl) {
    const anyWithImages = sourceProducts.find(
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
