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
  /** Payload-managed boolean flag column (has_embedding) */
  flagColumn: string
  /** Vector dimensions (e.g. 512 for CLIP ViT-B/32) */
  dimensions: number
  /** Primary key column name */
  idColumn: string
  /** Additional columns to return in search results */
  returnColumns: string[]
  /** Optional join for enriching search results */
  join?: {
    table: string
    /** [sourceColumn, targetColumn] — e.g. ['_parent_id', 'id'] */
    on: [string, string]
    /** Columns to select from the joined table */
    columns: string[]
  }
}

const NAMESPACES: Record<string, EmbeddingNamespace> = {
  'recognition-images': {
    table: 'product_variants_recognition_images',
    embeddingColumn: 'embedding',
    flagColumn: 'has_embedding',
    dimensions: 512,
    idColumn: 'id',
    returnColumns: ['_parent_id', 'score'],
    join: {
      table: 'product_variants',
      on: ['_parent_id', 'id'],
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
// Body: { items: Array<{ id: string, embedding: number[] }> }
// Writes embedding vectors and sets the flag column to true.
// ---------------------------------------------------------------------------

export const embeddingsWriteHandler: PayloadHandler = async (req) => {
  if (!req.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const ns = getNamespace(req)
  if (!ns) {
    return Response.json({ error: 'Unknown namespace' }, { status: 404 })
  }

  let body: { items?: Array<{ id: string; embedding: number[] }> }
  try {
    body = await req.json!()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const items = body?.items
  if (!Array.isArray(items) || items.length === 0) {
    return Response.json({ error: 'items array is required and must be non-empty' }, { status: 400 })
  }

  // Validate dimensions
  for (const item of items) {
    if (!item.id || !Array.isArray(item.embedding)) {
      return Response.json({ error: 'Each item must have id and embedding array' }, { status: 400 })
    }
    if (item.embedding.length !== ns.dimensions) {
      return Response.json(
        { error: `Expected ${ns.dimensions}-dim embedding, got ${item.embedding.length}` },
        { status: 400 },
      )
    }
  }

  const db = req.payload.db.drizzle

  // Batch update — one UPDATE per item (pgvector doesn't support batch vector inserts well)
  let written = 0
  for (const item of items) {
    const vec = vectorLiteral(item.embedding)
    await db.execute(
      sql.raw(
        `UPDATE "${ns.table}"
         SET "${ns.embeddingColumn}" = '${vec}'::vector,
             "${ns.flagColumn}" = true
         WHERE "${ns.idColumn}" = '${item.id}'`,
      ),
    )
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
  const whereParts = [`t."${ns.flagColumn}" = true`]
  if (threshold !== null) {
    whereParts.push(`t."${ns.embeddingColumn}" <=> '${vec}'::vector < ${threshold}`)
  }
  const whereClause = whereParts.join(' AND ')

  const query = `SELECT ${selectClause} FROM ${fromClause} WHERE ${whereClause} ORDER BY distance LIMIT ${limit}`

  const result = await db.execute(sql.raw(query))
  const rows = result.rows || result

  return Response.json({ results: rows })
}
