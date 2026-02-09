import { getPayload } from 'payload'
import { matchIngredients } from '@/lib/match-ingredients'
import { matchBrand } from '@/lib/match-brand'
import { matchCategory } from '@/lib/match-category'

type Payload = Awaited<ReturnType<typeof getPayload>>

interface AggregatedData {
  gtin?: string
  name?: string
  description?: string
  brandName?: string
  categoryBreadcrumb?: string
  ingredientNames?: string[]
}

interface DmProductSource {
  id: number
  gtin?: string | null
  name?: string | null
  brandName?: string | null
  type?: string | null
  ingredients?: Array<{ name?: string | null }> | null
}

// Aggregate data from a DmProduct source
export function aggregateFromSources(dmProduct: DmProductSource): AggregatedData | null {
  const aggregated: AggregatedData = {}

  if (dmProduct.gtin) aggregated.gtin = dmProduct.gtin
  if (dmProduct.name) aggregated.name = dmProduct.name
  if (dmProduct.brandName) aggregated.brandName = dmProduct.brandName
  if (dmProduct.type) aggregated.categoryBreadcrumb = dmProduct.type

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

// Error status priority: failed > ingredient_matching_error > brand_matching_error > category_matching_error > success
const STATUS_PRIORITY: Record<string, number> = {
  success: 0,
  category_matching_error: 1,
  brand_matching_error: 2,
  ingredient_matching_error: 3,
  failed: 4,
}

function worstStatus(current: string, candidate: string): string {
  return (STATUS_PRIORITY[candidate] ?? 0) > (STATUS_PRIORITY[current] ?? 0) ? candidate : current
}

// Aggregate a product: fill attributes, match brand, category, ingredients, set status
export async function aggregateProduct(
  payload: Payload,
  productId: number,
  dmProduct: DmProductSource,
  sourceSlug: string,
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

  let tokensUsed = 0
  let status = 'success'
  const errorMessages: string[] = []

  // Match brand
  if (aggregated.brandName) {
    try {
      const brandResult = await matchBrand(payload, aggregated.brandName)
      tokensUsed += brandResult.tokensUsed.totalTokens
      updateData.brand = brandResult.brandId
    } catch (error) {
      status = worstStatus(status, 'brand_matching_error')
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
      status = worstStatus(status, 'category_matching_error')
      errorMessages.push(`Category matching error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  // Match ingredients
  if (aggregated.ingredientNames && aggregated.ingredientNames.length > 0) {
    try {
      const matchResult = await matchIngredients(payload, aggregated.ingredientNames)
      tokensUsed += matchResult.tokensUsed.totalTokens

      if (matchResult.matched.length > 0) {
        updateData.ingredients = matchResult.matched
          .map((m) => m.ingredientId)
          .filter((id): id is number => id !== null)
      }

      if (matchResult.unmatched.length > 0) {
        status = worstStatus(status, 'ingredient_matching_error')
        errorMessages.push(`Unmatched ingredients:\n${matchResult.unmatched.join('\n')}`)
      }
    } catch (error) {
      status = worstStatus(status, 'failed')
      errorMessages.push(`Ingredient matching failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  updateData.aggregationStatus = status
  updateData.aggregationErrors = errorMessages.length > 0 ? errorMessages.join('\n\n') : null

  await payload.update({
    collection: 'products',
    id: productId,
    data: updateData,
  })

  return {
    success: status !== 'failed',
    error: errorMessages.length > 0 ? errorMessages.join('\n\n') : undefined,
    tokensUsed,
  }
}
