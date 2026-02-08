import { getPayload } from 'payload'
import { matchIngredients } from '@/lib/match-ingredients'

type Payload = Awaited<ReturnType<typeof getPayload>>

interface AggregatedData {
  gtin?: string
  name?: string
  description?: string
  brandName?: string
  ingredientNames?: string[]
}

interface DmProductSource {
  id: number
  gtin?: string | null
  name?: string | null
  brandName?: string | null
  ingredients?: Array<{ name?: string | null }> | null
}

// Aggregate data from a DmProduct source
export function aggregateFromSources(dmProduct: DmProductSource): AggregatedData | null {
  const aggregated: AggregatedData = {}

  if (dmProduct.gtin) aggregated.gtin = dmProduct.gtin
  if (dmProduct.name) aggregated.name = dmProduct.name
  if (dmProduct.brandName) aggregated.brandName = dmProduct.brandName

  if (dmProduct.ingredients && Array.isArray(dmProduct.ingredients) && dmProduct.ingredients.length > 0) {
    aggregated.ingredientNames = dmProduct.ingredients
      .map((i) => i.name)
      .filter((n): n is string => !!n)
  }

  if (Object.keys(aggregated).length === 0) {
    return null
  }

  return aggregated
}

// Aggregate a product: fill attributes, match ingredients, set status
export async function aggregateProduct(
  payload: Payload,
  productId: number,
  dmProduct: DmProductSource,
): Promise<{ success: boolean; error?: string; tokensUsed?: number }> {
  const aggregated = aggregateFromSources(dmProduct)

  if (!aggregated) {
    return { success: false, error: 'No data to aggregate from source' }
  }

  const product = await payload.findByID({
    collection: 'products',
    id: productId,
  })

  const updateData: Record<string, unknown> = {
    lastAggregatedAt: new Date().toISOString(),
    dmProduct: dmProduct.id,
  }

  if (aggregated.name && !product.name) {
    updateData.name = aggregated.name
  }

  if (aggregated.gtin && !product.gtin) {
    updateData.gtin = aggregated.gtin
  }

  // Match ingredients via LLM
  let tokensUsed = 0
  if (aggregated.ingredientNames && aggregated.ingredientNames.length > 0) {
    try {
      const matchResult = await matchIngredients(payload, aggregated.ingredientNames)
      tokensUsed = matchResult.tokensUsed.totalTokens

      if (matchResult.matched.length > 0) {
        updateData.ingredients = matchResult.matched
          .map((m) => m.ingredientId)
          .filter((id): id is number => id !== null)
      }

      if (matchResult.unmatched.length > 0) {
        updateData.aggregationStatus = 'ingredient_matching_error'
        updateData.aggregationErrors = `Unmatched ingredients:\n${matchResult.unmatched.join('\n')}`
      } else {
        updateData.aggregationStatus = 'success'
        updateData.aggregationErrors = null
      }
    } catch (error) {
      updateData.aggregationStatus = 'failed'
      updateData.aggregationErrors = error instanceof Error ? error.message : 'Unknown matching error'
    }
  } else {
    updateData.aggregationStatus = 'success'
  }

  await payload.update({
    collection: 'products',
    id: productId,
    data: updateData,
  })

  return {
    success: updateData.aggregationStatus !== 'failed',
    error: updateData.aggregationErrors as string | undefined,
    tokensUsed,
  }
}
