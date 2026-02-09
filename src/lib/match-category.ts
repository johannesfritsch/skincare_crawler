import OpenAI from 'openai'
import type { BasePayload, Where } from 'payload'
import type { TokenUsage } from './match-ingredients'

export interface MatchCategoryResult {
  categoryId: number
  categoryPath: string
  created: boolean
  tokensUsed: TokenUsage
}

const LEADING_SOURCE_SLUG = process.env.LEADING_SOURCE_SLUG || 'dm'

const CATEGORY_MATCH_SYSTEM_PROMPT = `You are a cosmetics product category expert. Given a category name and a list of candidate category names from a database (all at the same hierarchy level), select the best match.

Rules:
- Match despite case variations
- Match despite minor wording differences (e.g., "Lidschatten" vs "Lidschatten & Eye Shadow")
- If none of the candidates represent the same category, return null

Return ONLY a JSON object with this structure:
{ "selectedName": "matched candidate name or null" }

No explanation, no markdown fences.`

function getOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set')
  }
  return new OpenAI({ apiKey })
}

async function resolveSegment(
  payload: BasePayload,
  segment: string,
  parentId: number | null,
  tokensUsed: TokenUsage,
): Promise<{ categoryId: number; created: boolean }> {
  // Exact match at this hierarchy level
  const parentFilter = parentId === null
    ? { parent: { equals: null } }
    : { parent: { equals: parentId } }

  const whereClause: Where = {
    name: { equals: segment },
    ...parentFilter,
  }

  const exactResult = await payload.find({
    collection: 'categories',
    where: whereClause,
    limit: 1,
  })

  if (exactResult.docs.length === 1) {
    console.log(`[matchCategory]   "${segment}" (parent: ${parentId}) → EXACT MATCH (id: ${exactResult.docs[0].id})`)
    return { categoryId: exactResult.docs[0].id, created: false }
  }

  // Fuzzy search at same hierarchy level
  const fuzzyWhere: Where = {
    name: { like: segment },
    ...parentFilter,
  }

  const fuzzyResult = await payload.find({
    collection: 'categories',
    where: fuzzyWhere,
    limit: 10,
  })

  console.log(`[matchCategory]   "${segment}" (parent: ${parentId}) → ${fuzzyResult.docs.length} fuzzy candidates: [${fuzzyResult.docs.map((d) => d.name).join(', ')}]`)

  if (fuzzyResult.docs.length === 1) {
    console.log(`[matchCategory]   AUTO-MATCH → "${fuzzyResult.docs[0].name}" (id: ${fuzzyResult.docs[0].id})`)
    return { categoryId: fuzzyResult.docs[0].id, created: false }
  }

  if (fuzzyResult.docs.length >= 2) {
    // LLM disambiguation
    const openai = getOpenAI()
    const candidates = fuzzyResult.docs.map((d) => d.name)
    const userContent = JSON.stringify({ categoryName: segment, candidates })

    console.log('\n[matchCategory] ── LLM Disambiguation ──')
    console.log('[matchCategory] Model: gpt-4.1-mini, temperature: 0')
    console.log('[matchCategory] User prompt:', userContent)

    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      temperature: 0,
      messages: [
        { role: 'system', content: CATEGORY_MATCH_SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
    })

    tokensUsed.promptTokens += response.usage?.prompt_tokens ?? 0
    tokensUsed.completionTokens += response.usage?.completion_tokens ?? 0
    tokensUsed.totalTokens += response.usage?.total_tokens ?? 0

    const content = response.choices[0]?.message?.content?.trim()
    console.log('[matchCategory] Response:', content ?? '(empty)')
    console.log(`[matchCategory] Tokens: ${tokensUsed.totalTokens} total`)

    if (content) {
      try {
        const parsed = JSON.parse(content) as { selectedName: string | null }
        if (parsed.selectedName) {
          const match = fuzzyResult.docs.find((d) => d.name === parsed.selectedName)
          if (match) {
            console.log(`[matchCategory]   LLM selected → "${match.name}" (id: ${match.id})`)
            return { categoryId: match.id, created: false }
          }
        }
      } catch {
        console.error('[matchCategory] Failed to parse LLM response:', content)
      }
    }
  }

  // Create — re-check for race conditions
  const recheck = await payload.find({
    collection: 'categories',
    where: whereClause,
    limit: 1,
  })

  if (recheck.docs.length === 1) {
    console.log(`[matchCategory]   Race condition avoided — found "${recheck.docs[0].name}" (id: ${recheck.docs[0].id})`)
    return { categoryId: recheck.docs[0].id, created: false }
  }

  const newCategory = await payload.create({
    collection: 'categories',
    data: {
      name: segment,
      parent: parentId ?? undefined,
    },
  })

  console.log(`[matchCategory]   Created category "${segment}" (id: ${newCategory.id}, parent: ${parentId})`)
  return { categoryId: newCategory.id, created: true }
}

export async function matchCategory(
  payload: BasePayload,
  categoryBreadcrumb: string,
  sourceSlug: string,
): Promise<MatchCategoryResult> {
  const tokensUsed: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

  if (sourceSlug !== LEADING_SOURCE_SLUG) {
    // TODO: non-leading source category mapping
    throw new Error(`Category mapping for non-leading source "${sourceSlug}" is not yet implemented. Only "${LEADING_SOURCE_SLUG}" is supported.`)
  }

  // Parse breadcrumb
  const segments = categoryBreadcrumb.split(' -> ').map((s) => s.trim()).filter(Boolean)

  if (segments.length === 0) {
    throw new Error(`Empty category breadcrumb: "${categoryBreadcrumb}"`)
  }

  console.log(`\n[matchCategory] ── Resolving category hierarchy ──`)
  console.log(`[matchCategory] Breadcrumb: "${categoryBreadcrumb}" → ${segments.length} segments: [${segments.join(', ')}]`)

  // Walk hierarchy from root to leaf
  let parentId: number | null = null
  let anyCreated = false

  for (const segment of segments) {
    const result = await resolveSegment(payload, segment, parentId, tokensUsed)
    parentId = result.categoryId
    if (result.created) anyCreated = true
  }

  console.log(`[matchCategory] Resolved to leaf category id: ${parentId}, path: "${categoryBreadcrumb}", created: ${anyCreated}`)

  return {
    categoryId: parentId!,
    categoryPath: categoryBreadcrumb,
    created: anyCreated,
    tokensUsed,
  }
}
