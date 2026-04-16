/**
 * GET /api/work-items/progress
 *
 * Lightweight endpoint returning aggregate work-item progress across all
 * jobs that still have pending or claimed items. Used by the admin header
 * progress indicator.
 *
 * Auth: requires req.user (JWT or API key).
 */

import type { PayloadHandler } from 'payload'
import { sql } from 'drizzle-orm'

export const workItemsProgressHandler: PayloadHandler = async (req) => {
  if (!req.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = (req.payload.db as any).drizzle

  // Count progress for jobs that still have active (pending/claimed) work items.
  // Once all items for a job are terminal (completed/failed), that job drops out.
  const result = await db.execute(sql`
    WITH active_jobs AS (
      SELECT DISTINCT job_collection, job_id
      FROM work_items
      WHERE status IN ('pending', 'claimed')
    )
    SELECT
      COALESCE(COUNT(*) FILTER (WHERE wi.status IN ('completed', 'failed')), 0)::int AS done,
      COALESCE(COUNT(*) FILTER (WHERE wi.status = 'claimed'), 0)::int AS active,
      COALESCE(COUNT(*), 0)::int AS total
    FROM work_items wi
    INNER JOIN active_jobs aj
      ON wi.job_collection = aj.job_collection AND wi.job_id = aj.job_id
  `)

  const row = result.rows?.[0] ?? { done: 0, active: 0, total: 0 }

  return Response.json({
    done: Number(row.done),
    active: Number(row.active),
    total: Number(row.total),
  })
}
