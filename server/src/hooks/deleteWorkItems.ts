import type { CollectionAfterDeleteHook } from 'payload'
import { sql } from 'drizzle-orm'

/**
 * Factory: returns an afterDelete hook that cascade-deletes work items
 * for the deleted job from the work_items table.
 */
export function deleteWorkItems(collectionSlug: string): CollectionAfterDeleteHook {
  return async ({ id, req }) => {
    const db = (req.payload.db as any).drizzle
    await db.execute(
      sql`DELETE FROM work_items WHERE job_collection = ${collectionSlug} AND job_id = ${id}`,
    )
  }
}
