import { getPayload } from 'payload'
import configPromise from '@payload-config'

export const runtime = 'nodejs'

interface AggregatedData {
  gtin?: string
  name?: string
  description?: string
  brandName?: string
  ingredientNames?: string[]
}

// Aggregate data from all available sources for a product
async function aggregateFromSources(
  payload: Awaited<ReturnType<typeof getPayload>>,
  product: { dmProduct?: number | { id: number } | null },
): Promise<AggregatedData | null> {
  const aggregated: AggregatedData = {}

  // Get DM Product data if linked
  if (product.dmProduct) {
    const dmProductId = typeof product.dmProduct === 'object' ? product.dmProduct.id : product.dmProduct
    const dmProduct = await payload.findByID({
      collection: 'dm-products',
      id: dmProductId,
    })

    if (dmProduct) {
      if (dmProduct.gtin) aggregated.gtin = dmProduct.gtin
      if (dmProduct.name) aggregated.name = dmProduct.name
      if (dmProduct.brandName) aggregated.brandName = dmProduct.brandName

      // Collect ingredient names from DM product
      if (dmProduct.ingredients && Array.isArray(dmProduct.ingredients) && dmProduct.ingredients.length > 0) {
        aggregated.ingredientNames = dmProduct.ingredients
          .map((i: { name?: string }) => i.name)
          .filter((n): n is string => !!n)
      }
    }
  }

  // Add more sources here in the future:
  // if (product.otherSource) { ... }

  // Return null if no data was aggregated
  if (Object.keys(aggregated).length === 0) {
    return null
  }

  return aggregated
}

// Upsert ingredients by name, returning their IDs
async function upsertIngredients(
  payload: Awaited<ReturnType<typeof getPayload>>,
  names: string[],
): Promise<number[]> {
  const ids: number[] = []

  for (const name of names) {
    // Try to find existing ingredient by name
    const existing = await payload.find({
      collection: 'ingredients',
      where: { name: { equals: name } },
      limit: 1,
    })

    if (existing.docs.length > 0) {
      ids.push(existing.docs[0].id)
    } else {
      // Create placeholder ingredient
      const created = await (payload.create as any)({
        collection: 'ingredients',
        data: {
          name,
        },
      })
      ids.push(created.id)
    }
  }

  return ids
}

export const POST = async (request: Request) => {
  try {
    const payload = await getPayload({ config: configPromise })
    const body = await request.json().catch(() => ({}))
    const { productIds } = body as { productIds?: number[] }

    if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
      return Response.json(
        { success: false, error: 'productIds array is required' },
        { status: 400 },
      )
    }

    const results: { productId: number; success: boolean; error?: string; updated?: boolean }[] = []

    for (const productId of productIds) {
      // Find product by ID
      const product = await payload
        .findByID({
          collection: 'products',
          id: productId,
        })
        .catch(() => null)

      if (!product) {
        results.push({ productId, success: false, error: 'Product not found' })
        continue
      }

      // Check if any source is linked
      const hasSource = !!product.dmProduct
      // Add more source checks here: || !!product.otherSource

      if (!hasSource) {
        results.push({ productId, success: false, error: 'No source linked' })
        continue
      }

      // Aggregate data from sources
      const aggregated = await aggregateFromSources(payload, product)

      if (!aggregated) {
        results.push({ productId, success: false, error: 'No data to aggregate' })
        continue
      }

      // Build update data - only update fields that are empty
      const updateData: Record<string, unknown> = {
        lastAggregatedAt: new Date().toISOString(),
      }

      if (aggregated.name && !product.name) {
        updateData.name = aggregated.name
      }

      if (aggregated.gtin && !product.gtin) {
        updateData.gtin = aggregated.gtin
      }

      // Upsert ingredients and link them
      if (aggregated.ingredientNames && aggregated.ingredientNames.length > 0) {
        const ingredientIds = await upsertIngredients(payload, aggregated.ingredientNames)
        updateData.ingredients = ingredientIds
      }

      // Update the product
      await payload.update({
        collection: 'products',
        id: product.id,
        data: updateData,
      })

      results.push({ productId, success: true, updated: true })
    }

    return Response.json({
      success: true,
      processed: results.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    })
  } catch (error) {
    console.error('Aggregate products error:', error)
    return Response.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}

export const GET = async () => {
  return Response.json({
    message: 'Aggregate Products API',
    usage: 'POST /api/products/aggregate',
    body: {
      productIds: 'Required. Array of Product IDs to aggregate.',
    },
    description:
      'Aggregates data from linked sources (DM Products, etc.) into Product fields. Updates name and gtin if empty, upserts ingredients, and sets lastAggregatedAt.',
  })
}
