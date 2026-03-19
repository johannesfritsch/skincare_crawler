import type { PayloadHandler } from 'payload'
import { sql } from 'drizzle-orm'

// ---------------------------------------------------------------------------
// Namespace Registry
// ---------------------------------------------------------------------------

/**
 * Each namespace maps a logical embedding target to a specific database table
 * and column configuration. Adding a new embedding use case (e.g. video
 * screenshots, ingredient images) only requires adding a new entry here +
 * a migration for the vector column on the target table.
 */
interface EmbeddingNamespace {
  /** PostgreSQL table that has the embedding column */
  table: string
  /** Column name for the vector (must be type vector(N)) */
  embeddingColumn: string
  /** Vector dimensions (768 for DINOv2-base) */
  dimensions: number
  /** Primary key column name */
  idColumn: string
  /** Additional columns to return in search results */
  returnColumns: string[]
  /**
   * When set, write uses INSERT ... ON CONFLICT (cols) DO UPDATE
   * instead of UPDATE ... WHERE id = ?. Items must provide these
   * columns instead of `id`.
   */
  upsertColumns?: string[]
  /** Optional join for enriching search results */
  join?: {
    table: string
    /** [sourceColumn, targetColumn] — e.g. ['product_variant_id', 'id'] */
    on: [string, string]
    /** Columns to select from the joined table */
    columns: string[]
  }
}

const NAMESPACES: Record<string, EmbeddingNamespace> = {
  'recognition-images': {
    table: 'recognition_embeddings',
    embeddingColumn: 'embedding',
    dimensions: 768,
    idColumn: 'id',
    returnColumns: ['product_variant_id'],
    upsertColumns: ['product_variant_id', 'detection_media_id', 'augmentation_type'],
    join: {
      table: 'product_variants',
      on: ['product_variant_id', 'id'],
      columns: ['gtin'],
    },
  },
  // Future namespaces:
  // 'video-screenshots': { ... }
  // 'ingredient-images': { ... }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getNamespace(req: { routeParams?: Record<string, unknown> }): EmbeddingNamespace | null {
  const namespace = req.routeParams?.namespace as string | undefined
  if (!namespace || !NAMESPACES[namespace]) return null
  return NAMESPACES[namespace]
}

function vectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`
}

// ---------------------------------------------------------------------------
// POST /api/embeddings/:namespace/write
//
// Body (upsert namespaces): { items: Array<{ [upsertCol]: number, embedding: number[] }> }
// Body (legacy namespaces): { items: Array<{ id: string, embedding: number[] }> }
//
// For upsert namespaces: INSERT ... ON CONFLICT (upsertColumns) DO UPDATE SET embedding = EXCLUDED.embedding
// For legacy namespaces: UPDATE ... WHERE id = ?
// ---------------------------------------------------------------------------

export const embeddingsWriteHandler: PayloadHandler = async (req) => {
  if (!req.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const ns = getNamespace(req)
  if (!ns) {
    return Response.json({ error: 'Unknown namespace' }, { status: 404 })
  }

  let body: { items?: Array<Record<string, unknown>> }
  try {
    body = await req.json!()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const items = body?.items
  if (!Array.isArray(items) || items.length === 0) {
    return Response.json({ error: 'items array is required and must be non-empty' }, { status: 400 })
  }

  const isUpsert = ns.upsertColumns && ns.upsertColumns.length > 0

  // Validate items
  for (const item of items) {
    const embedding = item.embedding as number[] | undefined
    if (!Array.isArray(embedding)) {
      return Response.json({ error: 'Each item must have an embedding array' }, { status: 400 })
    }
    if (embedding.length !== ns.dimensions) {
      return Response.json(
        { error: `Expected ${ns.dimensions}-dim embedding, got ${embedding.length}` },
        { status: 400 },
      )
    }
    if (isUpsert) {
      for (const col of ns.upsertColumns!) {
        if (item[col] === undefined || item[col] === null) {
          return Response.json({ error: `Each item must have ${col}` }, { status: 400 })
        }
      }
    } else {
      if (!item.id) {
        return Response.json({ error: 'Each item must have id' }, { status: 400 })
      }
    }
  }

  const db = req.payload.db.drizzle

  let written = 0
  for (const item of items) {
    const vec = vectorLiteral(item.embedding as number[])

    if (isUpsert) {
      const cols = ns.upsertColumns!
      const colNames = [...cols, ns.embeddingColumn].map((c) => `"${c}"`).join(', ')
      const colValues = [...cols.map((c) => `'${item[c]}'`), `'${vec}'::vector`].join(', ')
      const conflictCols = cols.map((c) => `"${c}"`).join(', ')
      await db.execute(
        sql.raw(
          `INSERT INTO "${ns.table}" (${colNames})
           VALUES (${colValues})
           ON CONFLICT (${conflictCols})
           DO UPDATE SET "${ns.embeddingColumn}" = EXCLUDED."${ns.embeddingColumn}",
                        "updated_at" = now()`,
        ),
      )
    } else {
      await db.execute(
        sql.raw(
          `UPDATE "${ns.table}"
           SET "${ns.embeddingColumn}" = '${vec}'::vector
           WHERE "${ns.idColumn}" = '${item.id}'`,
        ),
      )
    }
    written++
  }

  return Response.json({ written })
}

// ---------------------------------------------------------------------------
// GET /api/embeddings/:namespace/search
//
// Query params:
//   vector    — JSON array of floats (required)
//   limit     — max results (default 10, max 100)
//   threshold — max cosine distance (optional, 0-2 range)
// ---------------------------------------------------------------------------

export const embeddingsSearchHandler: PayloadHandler = async (req) => {
  if (!req.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const ns = getNamespace(req)
  if (!ns) {
    return Response.json({ error: 'Unknown namespace' }, { status: 404 })
  }

  const url = new URL(req.url!)
  const vectorParam = url.searchParams.get('vector')
  const limitParam = url.searchParams.get('limit')
  const thresholdParam = url.searchParams.get('threshold')

  if (!vectorParam) {
    return Response.json({ error: 'vector query param is required (JSON array)' }, { status: 400 })
  }

  let vector: number[]
  try {
    vector = JSON.parse(vectorParam)
  } catch {
    return Response.json({ error: 'vector must be a valid JSON array' }, { status: 400 })
  }

  if (!Array.isArray(vector) || vector.length !== ns.dimensions) {
    return Response.json(
      { error: `Expected ${ns.dimensions}-dim vector, got ${Array.isArray(vector) ? vector.length : 'non-array'}` },
      { status: 400 },
    )
  }

  const limit = Math.min(Math.max(parseInt(limitParam || '10', 10) || 10, 1), 100)
  const threshold = thresholdParam ? parseFloat(thresholdParam) : null

  const db = req.payload.db.drizzle
  const vec = vectorLiteral(vector)

  // Build SELECT columns
  const mainCols = [
    `t."${ns.idColumn}" AS id`,
    `t."${ns.embeddingColumn}" <=> '${vec}'::vector AS distance`,
    ...ns.returnColumns.map((col) => `t."${col}"`),
  ]

  // Optional join columns
  const joinCols = ns.join ? ns.join.columns.map((col) => `j."${col}"`) : []

  const selectClause = [...mainCols, ...joinCols].join(', ')

  // Build FROM + JOIN
  let fromClause = `"${ns.table}" t`
  if (ns.join) {
    fromClause += ` INNER JOIN "${ns.join.table}" j ON t."${ns.join.on[0]}" = j."${ns.join.on[1]}"`
  }

  // Build WHERE
  const whereParts = [`t."${ns.embeddingColumn}" IS NOT NULL`]
  if (threshold !== null) {
    whereParts.push(`t."${ns.embeddingColumn}" <=> '${vec}'::vector < ${threshold}`)
  }
  const whereClause = whereParts.join(' AND ')

  const query = `SELECT ${selectClause} FROM ${fromClause} WHERE ${whereClause} ORDER BY distance LIMIT ${limit}`

  const result = await db.execute(sql.raw(query))
  const rows = result.rows || result

  return Response.json({ results: rows })
}

// ---------------------------------------------------------------------------
// DELETE /api/embeddings/:namespace/delete
//
// Body: { where: Record<string, number | string> }
// Deletes rows matching the where clause. Only columns listed in
// upsertColumns or returnColumns are allowed as filter keys.
// ---------------------------------------------------------------------------

export const embeddingsDeleteHandler: PayloadHandler = async (req) => {
  if (!req.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const ns = getNamespace(req)
  if (!ns) {
    return Response.json({ error: 'Unknown namespace' }, { status: 404 })
  }

  let body: { where?: Record<string, unknown> }
  try {
    body = await req.json!()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const where = body?.where
  if (!where || typeof where !== 'object' || Object.keys(where).length === 0) {
    return Response.json({ error: 'where object is required and must be non-empty' }, { status: 400 })
  }

  // Only allow filtering by known columns (upsert columns + return columns)
  const allowedColumns = new Set([...(ns.upsertColumns || []), ...ns.returnColumns, ns.idColumn])
  for (const key of Object.keys(where)) {
    if (!allowedColumns.has(key)) {
      return Response.json({ error: `Column "${key}" is not allowed as a filter` }, { status: 400 })
    }
  }

  const db = req.payload.db.drizzle
  const conditions = Object.entries(where).map(([col, val]) => `"${col}" = '${val}'`).join(' AND ')
  const result = await db.execute(sql.raw(`DELETE FROM "${ns.table}" WHERE ${conditions}`))
  const deleted = (result as unknown as { rowCount?: number }).rowCount ?? 0

  return Response.json({ deleted })
}
