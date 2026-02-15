import { getPayload } from 'payload'
import { matchIngredients } from '@/lib/match-ingredients'
import { matchBrand } from '@/lib/match-brand'
import { matchCategory } from '@/lib/match-category'
import { classifyProduct } from '@/lib/classify-product'

type Payload = Awaited<ReturnType<typeof getPayload>>

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

// Aggregate a product: fill attributes, match brand, category, ingredients
export async function aggregateProduct(
  payload: Payload,
  productId: number,
  allSourceProducts: SourceProductData[],
  language: string = 'de',
): Promise<{ success: boolean; error?: string; warning?: string; tokensUsed?: number }> {
  const aggregated = aggregateFromSources(allSourceProducts)

  if (!aggregated) {
    return { success: false, error: 'No data to aggregate from source' }
  }

  const product = await payload.findByID({
    collection: 'products',
    id: productId,
  })

  // Build sourceProducts array, merging all source IDs with any already linked
  const existingSourceIds = (product.sourceProducts ?? []).map((sp: unknown) =>
    typeof sp === 'object' && sp !== null && 'id' in sp ? (sp as { id: number }).id : sp,
  ) as number[]
  const allIds = new Set([...existingSourceIds, ...allSourceProducts.map((sp) => sp.id)])
  const sourceProducts = [...allIds]

  const updateData: Record<string, unknown> = {
    lastAggregatedAt: new Date().toISOString(),
    sourceProducts,
  }

  // Always update name to best (longest) from sources
  if (aggregated.name) {
    updateData.name = aggregated.name
  }

  if (aggregated.gtin && !product.gtin) {
    updateData.gtin = aggregated.gtin
  }

  let tokensUsed = 0
  const errorMessages: string[] = []
  const warningMessages: string[] = []

  // Match brand
  if (aggregated.brandName) {
    try {
      const brandResult = await matchBrand(payload, aggregated.brandName)
      tokensUsed += brandResult.tokensUsed.totalTokens
      updateData.brand = brandResult.brandId
    } catch (error) {
      errorMessages.push(`Brand matching error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  // Match category — walk SourceCategory parent chain to build breadcrumb
  if (aggregated.sourceCategoryId) {
    try {
      // Build breadcrumb by walking up the SourceCategory parent chain
      const breadcrumbParts: string[] = []
      let currentCatId: number | null = aggregated.sourceCategoryId
      while (currentCatId) {
        const cat: { name: string; parent?: number | { id: number } | null } = await payload.findByID({
          collection: 'source-categories',
          id: currentCatId,
        })
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
      updateData.ingredients = aggregated.ingredientNames!.map((name) => ({
        name,
        ingredient: matchedMap.get(name) ?? null,
      }))

      if (matchResult.unmatched.length > 0) {
        warningMessages.push(`Unmatched ingredients:\n${matchResult.unmatched.join('\n')}`)
      }
    } catch (error) {
      errorMessages.push(`Ingredient matching failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  // Classify product attributes & claims
  try {
    const fetchedSourceProducts = await payload.find({
      collection: 'source-products',
      where: { id: { in: sourceProducts } },
      limit: sourceProducts.length,
    })

    const classifySources: { id: number; description?: string; ingredientNames?: string[] }[] = []
    for (const sp of fetchedSourceProducts.docs) {
      const ingredientNames = (sp.ingredients ?? [])
        .map((i: { name?: string | null }) => i.name)
        .filter((n): n is string => !!n)
      if (sp.description || ingredientNames.length > 0) {
        classifySources.push({
          id: sp.id,
          description: sp.description || undefined,
          ingredientNames: ingredientNames.length > 0 ? ingredientNames : undefined,
        })
      }
    }

    if (classifySources.length > 0) {
      const classifyResult = await classifyProduct(
        classifySources.map((s) => ({ description: s.description, ingredientNames: s.ingredientNames })),
        language,
      )
      tokensUsed += classifyResult.tokensUsed.totalTokens

      if (classifyResult.description) {
        updateData.description = classifyResult.description
      }

      const mapEvidence = (entry: { sourceIndex: number; type: 'ingredient' | 'descriptionSnippet'; snippet?: string; ingredientNames?: string[] }) => {
        const source = classifySources[entry.sourceIndex]
        const result: Record<string, unknown> = {
          sourceProduct: source?.id,
          evidenceType: entry.type,
        }
        if (entry.type === 'descriptionSnippet' && entry.snippet) {
          result.snippet = entry.snippet
          if (source?.description) {
            const start = source.description.indexOf(entry.snippet)
            if (start !== -1) {
              result.start = start
              result.end = start + entry.snippet.length
            }
          }
        }
        if (entry.type === 'ingredient' && entry.ingredientNames) {
          result.ingredientNames = entry.ingredientNames.map((name) => ({ name }))
        }
        return result
      }

      updateData.productAttributes = classifyResult.productAttributes
        .filter((e) => classifySources[e.sourceIndex])
        .map((entry) => ({ attribute: entry.attribute, ...mapEvidence(entry) }))

      updateData.productClaims = classifyResult.productClaims
        .filter((e) => classifySources[e.sourceIndex])
        .map((entry) => ({ claim: entry.claim, ...mapEvidence(entry) }))
    }
  } catch (error) {
    errorMessages.push(`Product classification error: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }

  await payload.update({
    collection: 'products',
    id: productId,
    data: updateData,
  })

  return {
    success: errorMessages.length === 0,
    error: errorMessages.length > 0 ? errorMessages.join('\n\n') : undefined,
    warning: warningMessages.length > 0 ? warningMessages.join('\n\n') : undefined,
    tokensUsed,
  }
}
