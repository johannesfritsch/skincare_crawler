/**
 * Stage 1: Classify
 *
 * Runs classifyProduct() + cleanProductName() for the product group.
 * Writes productType, attributes, claims, warnings, skinApplicability,
 * pH, usageInstructions, usageSchedule to the product and its variants.
 */

import { classifyProduct } from '@/lib/classify-product'
import { cleanProductName } from '@/lib/clean-product-name'
import { deduplicateDescriptions, deduplicateIngredients } from '@/lib/aggregate-product'
import type { StageContext, StageResult, AggregationWorkItem } from './index'

export async function executeClassify(ctx: StageContext, workItem: AggregationWorkItem): Promise<StageResult> {
  const { payload, config, log } = ctx
  const jlog = log.forJob('product-aggregations', config.jobId)
  const productId = workItem.productId

  if (!productId) {
    return { success: false, error: 'No productId — resolve stage must run first' }
  }

  const allSources = workItem.variants.flatMap((v) => v.sources)
  let tokensUsed = 0

  // Build deduplicated source data for classification
  const uniqueDescs = deduplicateDescriptions(allSources)
  const uniqueIngr = deduplicateIngredients(allSources)

  const classifyMap = new Map<number, { id: number; description?: string; ingredientsText?: string }>()
  for (const d of uniqueDescs) {
    if (!classifyMap.has(d.sourceProductId)) classifyMap.set(d.sourceProductId, { id: d.sourceProductId })
    classifyMap.get(d.sourceProductId)!.description = d.description
  }
  for (const i of uniqueIngr) {
    if (!classifyMap.has(i.sourceProductId)) classifyMap.set(i.sourceProductId, { id: i.sourceProductId })
    classifyMap.get(i.sourceProductId)!.ingredientsText = i.ingredientsText
  }
  const classifySources = [...classifyMap.values()]

  if (classifySources.length === 0) {
    log.info('No descriptions/ingredients for classification, skipping', { productId })
    return { success: true, productId, tokensUsed: 0 }
  }

  // Run classification
  const classifyResult = await classifyProduct(
    classifySources.map((s) => ({ description: s.description, ingredientsText: s.ingredientsText })),
    config.language,
  )
  tokensUsed += classifyResult.tokensUsed.totalTokens

  const classifySourceProductIds = classifySources.map((s) => s.id)

  // Clean product name
  const product = await payload.findByID({ collection: 'products', id: productId }) as Record<string, unknown>
  let cleanedName = product.name as string | undefined

  if (cleanedName) {
    // Get all variant labels for context
    const variantsResult = await payload.find({
      collection: 'product-variants',
      where: { product: { equals: productId } },
      limit: 100,
    })
    const allVariantLabels = (variantsResult.docs as Array<Record<string, unknown>>)
      .map((v) => v.label as string)
      .filter(Boolean)

    if (allVariantLabels.length > 0) {
      try {
        const nameResult = await cleanProductName(cleanedName, allVariantLabels)
        if (nameResult.name) cleanedName = nameResult.name
        tokensUsed += nameResult.tokensUsed.totalTokens
        jlog.event('aggregation.name_cleaned', { rawName: product.name as string, variantLabels: allVariantLabels.length, cacheHit: nameResult.cacheHit })
      } catch (e) {
        log.error('Product name cleaning error', { productId, error: e instanceof Error ? e.message : String(e) })
      }
    }
  }

  // Look up productType
  let productTypeId: number | undefined
  if (classifyResult.productType) {
    const ptDoc = await payload.find({
      collection: 'product-types',
      where: { slug: { equals: classifyResult.productType } },
      limit: 1,
    })
    if (ptDoc.docs.length > 0) {
      productTypeId = (ptDoc.docs[0] as { id: number }).id
    }
  }

  // Write product-level classification
  const productUpdateData: Record<string, unknown> = {}
  if (cleanedName) productUpdateData.name = cleanedName
  if (productTypeId) productUpdateData.productType = productTypeId

  if (Object.keys(productUpdateData).length > 0) {
    await payload.update({
      collection: 'products',
      id: productId,
      data: productUpdateData,
    })
  }

  // Write classification fields to all variants
  const mapEvidence = (entry: { sourceIndex: number; type: string; snippet?: string; start?: number; end?: number; ingredientNames?: string[] }) => {
    const sourceProductId = classifySourceProductIds[entry.sourceIndex]
    const result: Record<string, unknown> = {
      sourceProduct: sourceProductId,
      evidenceType: entry.type,
    }
    if (entry.type === 'descriptionSnippet' && entry.snippet) {
      result.snippet = entry.snippet
      if (entry.start != null) result.start = entry.start
      if (entry.end != null) result.end = entry.end
    }
    if (entry.type === 'ingredient' && entry.ingredientNames) {
      result.ingredientNames = entry.ingredientNames.map((name: string) => ({ name }))
    }
    return result
  }

  const variantsResult = await payload.find({
    collection: 'product-variants',
    where: { product: { equals: productId } },
    limit: 100,
  })

  for (const variantDoc of variantsResult.docs) {
    const variantId = (variantDoc as { id: number }).id
    const variantUpdateData: Record<string, unknown> = {}

    if (classifyResult.warnings != null) variantUpdateData.warnings = classifyResult.warnings
    if (classifyResult.skinApplicability != null) variantUpdateData.skinApplicability = classifyResult.skinApplicability
    if (classifyResult.phMin != null) variantUpdateData.phMin = classifyResult.phMin
    if (classifyResult.phMax != null) variantUpdateData.phMax = classifyResult.phMax
    if (classifyResult.usageInstructions != null) variantUpdateData.usageInstructions = classifyResult.usageInstructions
    if (classifyResult.usageSchedule != null) variantUpdateData.usageSchedule = classifyResult.usageSchedule

    variantUpdateData.productAttributes = classifyResult.productAttributes
      .filter((e) => classifySourceProductIds[e.sourceIndex] !== undefined)
      .map((entry) => ({ attribute: entry.attribute, ...mapEvidence(entry) }))

    variantUpdateData.productClaims = classifyResult.productClaims
      .filter((e) => classifySourceProductIds[e.sourceIndex] !== undefined)
      .map((entry) => ({ claim: entry.claim, ...mapEvidence(entry) }))

    await payload.update({
      collection: 'product-variants',
      id: variantId,
      data: variantUpdateData,
    })
  }

  jlog.event('aggregation.classified', { productId, productType: classifyResult.productType, attributes: classifyResult.productAttributes.length, claims: classifyResult.productClaims.length })
  log.info('Classify stage complete', { productId, tokens: tokensUsed })

  return { success: true, productId, tokensUsed }
}
