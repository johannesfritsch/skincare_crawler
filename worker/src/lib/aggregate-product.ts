interface AggregatedData {
  gtin?: string
  name?: string
  description?: string
  brandName?: string
  sourceCategoryId?: number
  ingredientNames?: string[]
}

interface SourceProductData {
  id: number
  gtin?: string | null
  name?: string | null
  brandName?: string | null
  sourceCategory?: number | { id: number; name?: string; parent?: unknown } | null
  source?: string | null
  ingredients?: Array<{ name?: string | null }> | null
}

// Aggregate data from multiple source products for the same GTIN
export function aggregateFromSources(sourceProducts: SourceProductData[]): AggregatedData | null {
  if (sourceProducts.length === 0) return null

  const aggregated: AggregatedData = {}

  // GTIN: take from first source (they all share the same GTIN)
  const gtin = sourceProducts.find((sp) => sp.gtin)?.gtin
  if (gtin) aggregated.gtin = gtin

  // Name: pick the longest non-null name (most complete, e.g. includes variant label)
  const names = sourceProducts.map((sp) => sp.name).filter((n): n is string => !!n)
  if (names.length > 0) {
    aggregated.name = names.reduce((a, b) => (b.length > a.length ? b : a))
  }

  // Brand: first non-null (should agree across sources)
  aggregated.brandName = sourceProducts.find((sp) => sp.brandName)?.brandName ?? undefined

  // Category: first non-null sourceCategory ID
  for (const sp of sourceProducts) {
    if (sp.sourceCategory) {
      aggregated.sourceCategoryId = typeof sp.sourceCategory === 'object' ? sp.sourceCategory.id : sp.sourceCategory
      break
    }
  }

  // Ingredients: pick the source with the longest ingredient list (most complete INCI)
  let bestIngredients: string[] = []
  for (const sp of sourceProducts) {
    if (sp.ingredients && Array.isArray(sp.ingredients) && sp.ingredients.length > 0) {
      const ingredientNames = sp.ingredients
        .map((i) => i.name)
        .filter((n): n is string => !!n)
      if (ingredientNames.length > bestIngredients.length) {
        bestIngredients = ingredientNames
      }
    }
  }
  if (bestIngredients.length > 0) {
    aggregated.ingredientNames = bestIngredients
  }

  if (Object.keys(aggregated).length === 0) {
    return null
  }

  return aggregated
}
