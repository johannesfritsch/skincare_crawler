/**
 * POST /api/ingredients/bulk-upsert
 *
 * Bulk upsert ingredients from CosIng discovery. Accepts an array of scraped
 * ingredient data, finds-or-creates each ingredient using the Local API
 * (no HTTP overhead per ingredient), and returns counts.
 *
 * Auth: requires req.user (JWT or API key).
 */

import type { PayloadHandler } from 'payload'

interface ScrapedIngredient {
  name: string
  casNumber?: string
  ecNumber?: string
  cosIngId?: string
  chemicalDescription?: string
  functions: string[]
  itemType?: 'ingredient' | 'substance'
  restrictions?: string
  sourceUrl?: string
}

export const ingredientsBulkUpsertHandler: PayloadHandler = async (req) => {
  if (!req.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json!() as { ingredients: ScrapedIngredient[] }
  if (!Array.isArray(body.ingredients)) {
    return Response.json({ error: 'Missing ingredients array' }, { status: 400 })
  }

  const ingredients = body.ingredients
  if (ingredients.length === 0) {
    return Response.json({ created: 0, existing: 0, errors: 0 })
  }

  const { payload } = req
  let created = 0
  let existing = 0
  let errors = 0

  // Batch lookup: find all existing ingredients by name in one query
  const names = ingredients.map(i => i.name).filter(Boolean)
  const uniqueNames = [...new Set(names)]

  // Fetch existing ingredients in batches of 100 (Payload query limit)
  const existingMap = new Map<string, Record<string, unknown>>()
  for (let i = 0; i < uniqueNames.length; i += 100) {
    const batch = uniqueNames.slice(i, i + 100)
    const found = await payload.find({
      collection: 'ingredients',
      where: { name: { in: batch } },
      limit: batch.length,
      depth: 0,
    })
    for (const doc of found.docs) {
      existingMap.set(doc.name as string, doc as unknown as Record<string, unknown>)
    }
  }

  // Process each ingredient: create or update
  for (const data of ingredients) {
    if (!data.name) { errors++; continue }

    // Build CosIng source entry
    const cosIngFieldsProvided = [
      'name',
      ...(data.casNumber ? ['casNumber'] : []),
      ...(data.ecNumber ? ['ecNumber'] : []),
      ...(data.cosIngId ? ['cosIngId'] : []),
      ...(data.chemicalDescription ? ['chemicalDescription'] : []),
      ...(data.functions.length > 0 ? ['functions'] : []),
      ...(data.itemType ? ['itemType'] : []),
      ...(data.restrictions ? ['restrictions'] : []),
    ]
    const cosIngSource = data.sourceUrl
      ? { source: 'cosing', sourceUrl: data.sourceUrl, fieldsProvided: cosIngFieldsProvided }
      : null

    const doc = existingMap.get(data.name)

    if (!doc) {
      // Create new ingredient
      try {
        const newDoc = await payload.create({
          collection: 'ingredients',
          data: {
            name: data.name,
            casNumber: data.casNumber ?? null,
            ecNumber: data.ecNumber ?? null,
            cosIngId: data.cosIngId ?? null,
            chemicalDescription: data.chemicalDescription ?? null,
            functions: data.functions.map((f) => ({ function: f })),
            itemType: data.itemType,
            restrictions: data.restrictions ?? null,
            sourceUrl: data.sourceUrl ?? null,
            sources: cosIngSource ? [cosIngSource] : [],
            status: 'uncrawled',
          },
        })
        existingMap.set(data.name, newDoc as unknown as Record<string, unknown>)
        created++
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        if (msg.includes('unique') || msg.includes('duplicate')) {
          existing++ // Race condition with another worker
        } else {
          errors++
        }
      }
    } else {
      // Update existing ingredient (backfill missing fields)
      const updates: Record<string, unknown> = {}

      if (!doc.casNumber && data.casNumber) updates.casNumber = data.casNumber
      if (!doc.ecNumber && data.ecNumber) updates.ecNumber = data.ecNumber
      if (!doc.cosIngId && data.cosIngId) updates.cosIngId = data.cosIngId
      if (!doc.chemicalDescription && data.chemicalDescription)
        updates.chemicalDescription = data.chemicalDescription
      if (!doc.sourceUrl && data.sourceUrl) updates.sourceUrl = data.sourceUrl
      if (!doc.itemType && data.itemType) updates.itemType = data.itemType
      if (!doc.restrictions && data.restrictions) updates.restrictions = data.restrictions
      if ((!doc.functions || (doc.functions as unknown[]).length === 0) && data.functions.length > 0) {
        updates.functions = data.functions.map((f) => ({ function: f }))
      }

      // Add CosIng source if not already present, or backfill fieldsProvided
      if (cosIngSource) {
        const existingSources = (doc.sources as Array<{ source: string; fieldsProvided?: string[] }>) ?? []
        const cosIngIdx = existingSources.findIndex((s) => s.source === 'cosing')
        if (cosIngIdx === -1) {
          updates.sources = [...existingSources, cosIngSource]
        } else if (!existingSources[cosIngIdx].fieldsProvided?.length) {
          const updated = [...existingSources]
          updated[cosIngIdx] = { ...updated[cosIngIdx], fieldsProvided: cosIngFieldsProvided }
          updates.sources = updated
        }
      }

      if (Object.keys(updates).length > 0) {
        try {
          await payload.update({
            collection: 'ingredients',
            id: doc.id as number,
            data: updates,
          })
        } catch {
          errors++
        }
      }
      existing++
    }
  }

  return Response.json({ created, existing, errors })
}
