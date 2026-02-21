import type { PayloadRestClient, Where } from './payload-client'

type SourceSlug = 'dm' | 'mueller' | 'rossmann'

/**
 * Look up a SourceCategory by its exact URL (used by Mueller).
 */
export async function lookupCategoryByUrl(
  payload: PayloadRestClient,
  url: string,
  source: SourceSlug,
): Promise<number | null> {
  const result = await payload.find({
    collection: 'source-categories',
    where: { and: [{ url: { equals: url } }, { source: { equals: source } }] },
    limit: 1,
  })
  return result.docs.length > 0 ? (result.docs[0] as { id: number }).id : null
}

/**
 * Look up a SourceCategory by walking a name path from root to leaf.
 * For each segment, queries SourceCategories matching { name, source, parent }.
 * Returns the ID of the deepest match, or null if no match at any level.
 */
export async function lookupCategoryByPath(
  payload: PayloadRestClient,
  namePath: string[],
  source: SourceSlug,
): Promise<number | null> {
  if (namePath.length === 0) return null

  let parentId: number | null = null

  for (const segment of namePath) {
    const parentCondition: Where = parentId !== null
      ? { parent: { equals: parentId } }
      : { parent: { exists: false } }

    const result = await payload.find({
      collection: 'source-categories',
      where: {
        and: [
          { name: { equals: segment } },
          { source: { equals: source } },
          parentCondition,
        ],
      },
      limit: 1,
    })

    if (result.docs.length === 0) {
      return parentId
    }

    parentId = (result.docs[0] as { id: number }).id
  }

  return parentId
}
