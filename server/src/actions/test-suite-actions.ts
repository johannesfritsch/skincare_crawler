'use server'

/**
 * Test suite actions — validation logic + AI schema generation.
 * The worker orchestrates test suite runs; this file provides
 * shared types and the getTestSuiteRunStatus polling helper.
 */

import { headers as getHeaders } from 'next/headers'
import { getPayload } from 'payload'
import config from '@payload-config'

export async function getTestSuiteRunStatus(
  collection: string,
  jobId: number,
): Promise<{ status: string; currentPhase?: string; errors?: number }> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_SERVER_URL || ''}/api/test-suite-runs/${jobId}?depth=0`)
  if (!res.ok) return { status: 'unknown' }
  const doc = await res.json()
  return {
    status: doc.status ?? 'unknown',
    currentPhase: doc.currentPhase,
    errors: doc.failed ?? 0,
  }
}

// ─── Enrich join fields with totalDocs count ──────────────────────────────

type PayloadInstance = Awaited<ReturnType<typeof getPayload>>

/** Walk an object and add totalDocs to any join field ({ docs: [...], hasNextPage }) */
async function enrichJoinCounts(payload: PayloadInstance, record: Record<string, unknown>): Promise<void> {
  for (const [key, val] of Object.entries(record)) {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const join = val as Record<string, unknown>
      if (Array.isArray(join.docs) && typeof join.hasNextPage === 'boolean') {
        // This looks like a join field — try to count via the collection
        const collectionSlug = joinKeyToCollection(key)
        if (collectionSlug) {
          try {
            const { totalDocs } = await payload.count({
              collection: collectionSlug as any,
              where: joinKeyToWhere(key, record),
            })
            join.totalDocs = totalDocs
          } catch {
            // Non-critical — leave without totalDocs
          }
        }
      }
    }
  }
}

/** Map join field names to their source collection */
function joinKeyToCollection(key: string): string | null {
  const map: Record<string, string> = {
    sourceReviews: 'source-reviews',
    sourceVariants: 'source-variants',
    videoScenes: 'video-scenes',
  }
  return map[key] ?? null
}

/** Build a where clause to count join targets for a given parent record */
function joinKeyToWhere(key: string, record: Record<string, unknown>): Record<string, { equals: number } | { exists: boolean }> {
  const id = record.id as number
  // sourceReviews join on source-variants → reviews where sourceVariants contains this variant
  if (key === 'sourceReviews') return { sourceVariants: { equals: id } }
  // sourceVariants join on source-products → variants where sourceProduct equals this product
  if (key === 'sourceVariants') return { sourceProduct: { equals: id } }
  // videoScenes join on videos → scenes where video equals this video
  if (key === 'videoScenes') return { video: { equals: id } }
  return { id: { exists: true } }
}

// ─── Fetch a real example record for a phase ──────────────────────────────

export async function fetchExampleRecord(
  phase: string,
): Promise<{ success: boolean; record?: Record<string, unknown>; error?: string }> {
  const payload = await getPayload({ config })
  const h = await getHeaders()
  const { user } = await payload.auth({ headers: h })
  if (!user) return { success: false, error: 'Unauthorized' }

  try {
    switch (phase) {
      case 'searches': {
        const results = await payload.find({
          collection: 'product-searches',
          where: { status: { equals: 'completed' } },
          sort: '-completedAt',
          limit: 1,
          depth: 0,
        })
        if (!results.docs[0]) return { success: false, error: 'No completed product search found. Run a search first.' }
        const job = results.docs[0] as unknown as Record<string, unknown>
        const productUrls = ((job.productUrls as string) ?? '').split('\n').filter(Boolean)
        return { success: true, record: { ...job, productUrls } }
      }
      case 'discoveries': {
        const results = await payload.find({
          collection: 'product-discoveries',
          where: { status: { equals: 'completed' } },
          sort: '-completedAt',
          limit: 1,
          depth: 0,
        })
        if (!results.docs[0]) return { success: false, error: 'No completed product discovery found. Run a discovery first.' }
        const job = results.docs[0] as unknown as Record<string, unknown>
        const productUrls = ((job.productUrls as string) ?? '').split('\n').filter(Boolean)
        return { success: true, record: { ...job, productUrls } }
      }
      case 'crawls': {
        const results = await payload.find({
          collection: 'source-variants',
          where: { crawledAt: { exists: true } },
          sort: '-crawledAt',
          limit: 1,
          depth: 2,
        })
        if (!results.docs[0]) return { success: false, error: 'No crawled source variant found. Run a product crawl first.' }
        const sv = results.docs[0] as unknown as Record<string, unknown>
        await enrichJoinCounts(payload, sv)
        return { success: true, record: sv }
      }
      case 'aggregations': {
        const results = await payload.find({
          collection: 'product-variants',
          where: { product: { exists: true } },
          sort: '-updatedAt',
          limit: 1,
          depth: 2,
        })
        if (!results.docs[0]) return { success: false, error: 'No aggregated product variant found. Run a product aggregation first.' }
        const pv = results.docs[0] as unknown as Record<string, unknown>
        // Enrich sourceVariants joins if resolved
        if (Array.isArray(pv.sourceVariants)) {
          for (const sv of pv.sourceVariants) {
            if (sv && typeof sv === 'object') await enrichJoinCounts(payload, sv as Record<string, unknown>)
          }
        }
        return { success: true, record: pv }
      }
      default:
        return { success: false, error: `Unknown phase: ${phase}` }
    }
  } catch (e) {
    return { success: false, error: `Failed to fetch example: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ─── Schema shape descriptions per phase (for LLM context) ────────────────

const PHASE_SCHEMA_DESCRIPTIONS: Record<string, string> = {
  searches: `Job record fields: status (string: pending/in_progress/completed/failed), productUrls (string[] — discovered product URLs, split from newline-delimited text), completed (number), errors (number), query (string), sources (string[]), maxResults (number).`,

  discoveries: `Job record fields: status (string: pending/in_progress/completed/failed), productUrls (string[] — discovered product URLs, split from newline-delimited text), completed (number), errors (number), sourceUrls (string).`,

  crawls: `A single source-variant record (depth=2, relations resolved). The root object IS the source-variant — there is NO wrapper object. Fields: id (number), gtin (string), variantLabel (string), variantDimension (string), sourceUrl (string), description (string/textarea), ingredientsText (string/textarea), amount (number), amountUnit (string), labels (array of {label: string}), crawledAt (string/date), sourceArticleNumber (string), priceHistory (array of {amount: number in cents, currency: string, perUnitAmount/perUnitQuantity/perUnitUnit, availability: 'available'|'unavailable'|'unknown', createdAt: string}), images (array of {url: string, alt: string}), sourceProduct (resolved object: {id, name, brandName, source: 'dm'|'rossmann'|'mueller'|'purish', sourceUrl, categoryBreadcrumb, averageRating: number 0-10, ratingCount}).`,

  aggregations: `A single product-variant record (depth=2, relations resolved). The root object IS the product-variant — there is NO wrapper object. Fields: id (number), gtin (string), label (string), images (array of {image: object with url, visibility: 'public'|'recognition_only', source: string}), sourceVariants (array of resolved source-variant objects with gtin, description, ingredientsText, priceHistory, images), product (resolved object: {id, name, brand: {id, name}, productType: {id, nameEn, nameDe}, description (string), ingredients (array of {ingredient: {name, functions, restrictions}}), attributes (array of {name, value, evidence[]}), claims (array of {name, evidence[]}), warnings (string[]), skinApplicability, phMin/phMax (number), usageInstructions, usageSchedule, scoreHistory (array of {storeScore, creatorScore, overallScore, change, createdAt})}).`,
}

// ─── Generate JSON Schema via LLM ─────────────────────────────────────────

export async function generateCheckSchema(
  phase: string,
  prompt: string,
  existingSchema?: Record<string, unknown> | null,
): Promise<{ success: boolean; schema?: Record<string, unknown>; error?: string }> {
  // Auth check — require logged-in admin user
  const payload = await getPayload({ config })
  const h = await getHeaders()
  const { user } = await payload.auth({ headers: h })
  if (!user) {
    return { success: false, error: 'Unauthorized' }
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return { success: false, error: 'OPENAI_API_KEY is not configured on the server. Add it to server/.env.' }
  }

  const schemaDescription = PHASE_SCHEMA_DESCRIPTIONS[phase]
  if (!schemaDescription) {
    return { success: false, error: `Unknown phase: ${phase}` }
  }

  // Fetch a real example record so the LLM sees actual field names and structure
  const exampleResult = await fetchExampleRecord(phase)
  const exampleRecord = exampleResult.success ? exampleResult.record : null

  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You are a JSON Schema (draft-07) generator. You will receive a description of a data object and a user request describing what they want to validate. Generate a valid JSON Schema that validates the described constraints.

The data object you are writing the schema for has this structure:
${schemaDescription}

Rules:
- Output ONLY a valid JSON Schema (draft-07) object. No wrapper — the root IS the schema.
- Use "type", "properties", "required", "minLength", "minimum", "pattern", "items", "minItems", etc. as appropriate.
- Only validate what the user asks for. Do not add extra constraints.
- Use "$schema": "http://json-schema.org/draft-07/schema#" at the root.
- Respond with JSON: the schema object directly.
- CRITICAL: Use ONLY field names that exist in the example object below. Do NOT invent field names.
- NEVER use "additionalProperties": false. Objects must always allow additional properties. Simply omit "additionalProperties" entirely from the schema.
- The root of the schema validates a SINGLE record — the root "type" must be "object" with "properties" matching top-level fields of the example. Do NOT wrap in { variants: [...] } or any other wrapper.
- Use any JSON Schema keywords that fit the user's request: "const", "enum", "minLength", "minimum", "pattern", "minItems", "contains", etc.
- When checking if an array contains at least one item matching a condition, use "contains" (not "items"). "items" validates EVERY element; "contains" validates that AT LEAST ONE element matches.
- Do NOT add constraints the user did not ask for. For example, do not add "maxItems" or "minItems" on arrays unless the user specifically requested a count constraint.${exampleRecord ? `

Here is a REAL example of the object you are writing the schema for:
\`\`\`json
${JSON.stringify(exampleRecord, null, 2).slice(0, 8000)}
\`\`\`
Use EXACTLY these field names and nesting structure in your schema. Do not guess or make up field names.` : ''}${existingSchema ? `
- IMPORTANT: An existing schema is provided below. You MUST keep ALL existing constraints and ADD the new ones from the user's request. Merge them into a single schema. Never remove or weaken existing constraints.` : ''}`,
          },
          ...(existingSchema ? [{
            role: 'user' as const,
            content: `Existing schema (keep all constraints and add new ones):\n\`\`\`json\n${JSON.stringify(existingSchema, null, 2)}\n\`\`\``,
          }] : []),
          {
            role: 'user',
            content: existingSchema
              ? `Add this constraint to the existing schema: ${prompt}`
              : prompt,
          },
        ],
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      return { success: false, error: `OpenAI API error (${res.status}): ${text.slice(0, 200)}` }
    }

    const data = await res.json()
    const content = data.choices?.[0]?.message?.content
    if (!content) {
      return { success: false, error: 'Empty response from LLM' }
    }

    const schema = JSON.parse(content)
    return { success: true, schema }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    return { success: false, error: `Failed to generate schema: ${error}` }
  }
}
