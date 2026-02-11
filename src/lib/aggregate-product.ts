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
  categoryBreadcrumb?: string
  ingredientNames?: string[]
}

interface SourceProductData {
  id: number
  gtin?: string | null
  name?: string | null
  brandName?: string | null
  type?: string | null
  ingredients?: Array<{ name?: string | null }> | null
}

// Aggregate data from a source product
export function aggregateFromSources(sourceProduct: SourceProductData): AggregatedData | null {
  const aggregated: AggregatedData = {}

  if (sourceProduct.gtin) aggregated.gtin = sourceProduct.gtin
  if (sourceProduct.name) aggregated.name = sourceProduct.name
  if (sourceProduct.brandName) aggregated.brandName = sourceProduct.brandName
  if (sourceProduct.type) aggregated.categoryBreadcrumb = sourceProduct.type

  if (sourceProduct.ingredients && Array.isArray(sourceProduct.ingredients) && sourceProduct.ingredients.length > 0) {
    aggregated.ingredientNames = sourceProduct.ingredients
      .map((i) => i.name)
      .filter((n): n is string => !!n)
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
  sourceProduct: SourceProductData,
  sourceSlug: string,
  language: string = 'de',
): Promise<{ success: boolean; error?: string; warning?: string; tokensUsed?: number }> {
  const aggregated = aggregateFromSources(sourceProduct)

  if (!aggregated) {
    return { success: false, error: 'No data to aggregate from source' }
  }

  const product = await payload.findByID({
    collection: 'products',
    id: productId,
  })

  // Build sourceProducts array, appending new source if not already present
  const existingSourceIds = (product.sourceProducts ?? []).map((sp: unknown) =>
    typeof sp === 'object' && sp !== null && 'id' in sp ? (sp as { id: number }).id : sp,
  ) as number[]
  const sourceProducts = existingSourceIds.includes(sourceProduct.id)
    ? existingSourceIds
    : [...existingSourceIds, sourceProduct.id]

  const updateData: Record<string, unknown> = {
    lastAggregatedAt: new Date().toISOString(),
    sourceProducts,
  }

  if (aggregated.name && !product.name) {
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

  // Match category
  if (aggregated.categoryBreadcrumb) {
    try {
      const categoryResult = await matchCategory(payload, aggregated.categoryBreadcrumb, sourceSlug)
      tokensUsed += categoryResult.tokensUsed.totalTokens
      updateData.category = categoryResult.categoryId
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
    const allSourceProducts = await payload.find({
      collection: 'source-products',
      where: { id: { in: sourceProducts } },
      limit: sourceProducts.length,
    })

    const classifySources: { id: number; description?: string; ingredientNames?: string[] }[] = []
    for (const sp of allSourceProducts.docs) {
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
