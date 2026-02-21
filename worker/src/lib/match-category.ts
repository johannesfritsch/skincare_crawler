import OpenAI from 'openai'
import type { PayloadRestClient, Where } from './payload-client'
import type { TokenUsage } from './match-ingredients'

export interface MatchCategoryResult {
  categoryId: number | null
  categoryPath: string
  created: boolean
  tokensUsed: TokenUsage
}

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
  payload: PayloadRestClient,
  segment: string,
  parentId: number | null,
  tokensUsed: TokenUsage,
): Promise<{ categoryId: number | null }> {
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
    const doc = exactResult.docs[0] as { id: number }
    console.log(`[matchCategory]   "${segment}" (parent: ${parentId}) → EXACT MATCH (id: ${doc.id})`)
    return { categoryId: doc.id }
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

  const fuzzyDocs = fuzzyResult.docs as Array<{ id: number; name: string }>
  console.log(`[matchCategory]   "${segment}" (parent: ${parentId}) → ${fuzzyDocs.length} fuzzy candidates: [${fuzzyDocs.map((d) => d.name).join(', ')}]`)

  if (fuzzyDocs.length === 1) {
    console.log(`[matchCategory]   AUTO-MATCH → "${fuzzyDocs[0].name}" (id: ${fuzzyDocs[0].id})`)
    return { categoryId: fuzzyDocs[0].id }
  }

  if (fuzzyDocs.length >= 2) {
    // LLM disambiguation
    const openai = getOpenAI()
    const candidates = fuzzyDocs.map((d) => d.name)
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
          const match = fuzzyDocs.find((d) => d.name === parsed.selectedName)
          if (match) {
            console.log(`[matchCategory]   LLM selected → "${match.name}" (id: ${match.id})`)
            return { categoryId: match.id }
          }
        }
      } catch {
        console.error('[matchCategory] Failed to parse LLM response:', content)
      }
    }
  }

  // No match found — return null (don't create new categories)
  console.log(`[matchCategory]   No match for "${segment}" (parent: ${parentId})`)
  return { categoryId: null }
}

export async function matchCategory(
  payload: PayloadRestClient,
  categoryBreadcrumb: string,
): Promise<MatchCategoryResult> {
  const tokensUsed: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

  // Parse breadcrumb
  const segments = categoryBreadcrumb.split(' -> ').map((s) => s.trim()).filter(Boolean)

  if (segments.length === 0) {
    return { categoryId: null, categoryPath: categoryBreadcrumb, created: false, tokensUsed }
  }

  console.log(`\n[matchCategory] ── Resolving category hierarchy ──`)
  console.log(`[matchCategory] Breadcrumb: "${categoryBreadcrumb}" → ${segments.length} segments: [${segments.join(', ')}]`)

  // Walk hierarchy from root to leaf
  let parentId: number | null = null
  let deepestMatchedId: number | null = null

  for (const segment of segments) {
    const result = await resolveSegment(payload, segment, parentId, tokensUsed)
    if (result.categoryId === null) {
      // Stop walking — use deepest matched category
      console.log(`[matchCategory] Stopped at "${segment}" — using deepest match: ${deepestMatchedId}`)
      break
    }
    parentId = result.categoryId
    deepestMatchedId = result.categoryId
  }

  console.log(`[matchCategory] Resolved to category id: ${deepestMatchedId}, path: "${categoryBreadcrumb}"`)

  return {
    categoryId: deepestMatchedId,
    categoryPath: categoryBreadcrumb,
    created: false,
    tokensUsed,
  }
}
