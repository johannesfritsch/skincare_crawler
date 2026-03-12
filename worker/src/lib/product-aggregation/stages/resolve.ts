/**
 * Stage 0: Resolve
 *
 * Find/create the unified product + product-variants from GTINs.
 * Merge duplicate products if multiple GTINs point to different products.
 * Write basic aggregated data (name, variantLabel, amount, sourceVariants).
 */

import { aggregateSourceVariantsToVariant, aggregateVariantsToProduct } from '@/lib/aggregate-product'
import type { StageContext, StageResult, AggregationWorkItem } from './index'

export async function executeResolve(ctx: StageContext, workItem: AggregationWorkItem): Promise<StageResult> {
  const { payload, config, log } = ctx
  const jlog = log.forJob('product-aggregations', config.jobId)

  if (workItem.variants.length === 0) {
    return { success: false, error: 'No variants in work item' }
  }

  const gtinLabels = workItem.variants.map((v) => v.gtin).join(', ')
  log.info('Resolve stage: starting', { gtins: gtinLabels, variantCount: workItem.variants.length })

  // ── Aggregate source data (pure logic, no LLM) ──
  const allSources = workItem.variants.flatMap((v) => v.sources)
  const sourceProductIds = [...new Set(allSources.map((s) => s.sourceProductId))]

  const perVariantData: Array<{
    gtin: string
    variantLabel?: string | null
    variantDimension?: string | null
    amount?: number | null
    amountUnit?: string | null
    sourceVariantIds: number[]
  }> = []

  for (const v of workItem.variants) {
    const vd = aggregateSourceVariantsToVariant(v.sources, {
      imageSourcePriority: ctx.config.imageSourcePriority,
    })
    if (!vd) continue

    perVariantData.push({
      gtin: v.gtin,
      variantLabel: vd.variantLabel,
      variantDimension: vd.variantDimension,
      amount: vd.amount,
      amountUnit: vd.amountUnit,
      sourceVariantIds: vd.sourceVariantIds,
    })
  }

  if (perVariantData.length === 0) {
    return { success: false, error: 'No variant data produced from sources' }
  }

  const productData = aggregateVariantsToProduct(allSources)

  // ── Find existing product-variants for all GTINs ──
  let productId: number | null = null
  const variantMap = new Map<string, number>() // gtin → product-variant ID
  const productsToMerge = new Set<number>()

  for (const vd of perVariantData) {
    const existing = await payload.find({
      collection: 'product-variants',
      where: { gtin: { equals: vd.gtin } },
      limit: 1,
    })
    if (existing.docs.length > 0) {
      const variant = existing.docs[0] as Record<string, unknown>
      variantMap.set(vd.gtin, variant.id as number)
      const productRef = variant.product as number | Record<string, unknown>
      const pid = typeof productRef === 'number' ? productRef : (productRef as { id: number }).id
      productsToMerge.add(pid)
    }
  }

  if (productsToMerge.size > 0) {
    productId = [...productsToMerge][0]

    // Merge duplicate products if GTINs pointed to different products
    if (productsToMerge.size > 1) {
      const otherProductIds = [...productsToMerge].slice(1)
      log.info('Resolve: merging products', { canonical: productId, merging: otherProductIds.join(',') })

      for (const otherId of otherProductIds) {
        // Move product-variants to canonical product
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

        // Merge source products
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

        // Move video-mentions
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
        } catch (e) {
          log.warn('Failed to move video-mentions during merge', { from: otherId, to: productId, error: e instanceof Error ? e.message : String(e) })
        }

        // Delete empty product
        try {
          await payload.delete({
            collection: 'products',
            where: { id: { equals: otherId } },
          })
        } catch (e) {
          log.warn('Failed to delete merged product', { deletedProductId: otherId, error: e instanceof Error ? e.message : String(e) })
        }
      }
    }
  } else {
    // No existing product — create one
    const newProduct = await payload.create({
      collection: 'products',
      data: {
        name: productData?.name || undefined,
      },
    }) as { id: number }
    productId = newProduct.id
    log.info('Resolve: created new product', { productId })
  }

  // Create product-variants for new GTINs
  for (const vd of perVariantData) {
    if (!variantMap.has(vd.gtin)) {
      const newVariant = await payload.create({
        collection: 'product-variants',
        data: {
          product: productId,
          gtin: vd.gtin,
          label: vd.variantLabel || productData?.name || vd.gtin,
          ...(vd.sourceVariantIds.length > 0 ? { sourceVariants: vd.sourceVariantIds } : {}),
        },
      }) as { id: number }
      variantMap.set(vd.gtin, newVariant.id)
    }
  }

  // Write basic variant data + product-level data
  for (const vd of perVariantData) {
    const variantId = variantMap.get(vd.gtin)!
    const updateData: Record<string, unknown> = {
      sourceVariants: vd.sourceVariantIds,
    }
    if (vd.variantLabel) updateData.label = vd.variantLabel
    if (vd.variantDimension) updateData.variantDimension = vd.variantDimension
    if (vd.amount != null) updateData.amount = vd.amount
    if (vd.amountUnit) updateData.amountUnit = vd.amountUnit

    await payload.update({
      collection: 'product-variants',
      id: variantId,
      data: updateData,
    })
  }

  // Update product: name + source products
  const product = await payload.findByID({ collection: 'products', id: productId }) as Record<string, unknown>
  const existingSourceIds = ((product.sourceProducts ?? []) as unknown[]).map((sp: unknown) =>
    Number(typeof sp === 'object' && sp !== null && 'id' in sp ? (sp as { id: number }).id : sp),
  ).filter((id) => !isNaN(id))
  const allIds = [...new Set([...existingSourceIds, ...sourceProductIds.map(Number)])]

  const productUpdateData: Record<string, unknown> = {
    sourceProducts: allIds,
  }
  if (productData?.name) productUpdateData.name = productData.name

  await payload.update({
    collection: 'products',
    id: productId,
    data: productUpdateData,
  })

  jlog.event('aggregation.resolved', { productId, gtins: perVariantData.length, variants: variantMap.size })
  log.info('Resolve stage complete', { productId, gtins: gtinLabels })

  return { success: true, productId }
}
