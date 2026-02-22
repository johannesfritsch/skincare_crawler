import OpenAI from 'openai'
import type { PayloadRestClient, Where } from './payload-client'
import type { TokenUsage } from './match-ingredients'
import { createLogger, type Logger } from '@/lib/logger'
const log = createLogger('matchCategory')

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
  jlog?: Logger,
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
    log.info(`  "${segment}" (parent: ${parentId}) → EXACT MATCH (id: ${doc.id})`)
    jlog?.info(`Category "${segment}" — exact match #${doc.id}`, { event: true, labels: ['category-matching'] })
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
  log.info(`  "${segment}" (parent: ${parentId}) → ${fuzzyDocs.length} fuzzy candidates: [${fuzzyDocs.map((d) => d.name).join(', ')}]`)

  if (fuzzyDocs.length === 1) {
    log.info(`  AUTO-MATCH → "${fuzzyDocs[0].name}" (id: ${fuzzyDocs[0].id})`)
    return { categoryId: fuzzyDocs[0].id }
  }

  if (fuzzyDocs.length >= 2) {
    // LLM disambiguation
    const openai = getOpenAI()
    const candidates = fuzzyDocs.map((d) => d.name)
    const userContent = JSON.stringify({ categoryName: segment, candidates })

    log.info('── LLM Disambiguation ──')
    log.info('Model: gpt-4.1-mini, temperature: 0')
    log.info('User prompt: ' + userContent)

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
    log.info('Response: ' + (content ?? '(empty)'))
    log.info(`Tokens: ${tokensUsed.totalTokens} total`)

    if (content) {
      try {
        const parsed = JSON.parse(content) as { selectedName: string | null }
        if (parsed.selectedName) {
          const match = fuzzyDocs.find((d) => d.name === parsed.selectedName)
          if (match) {
            log.info(`  LLM selected → "${match.name}" (id: ${match.id})`)
            jlog?.info(`Category "${segment}" — LLM selected "${match.name}" #${match.id}`, { event: true, labels: ['category-matching', 'llm'] })
            return { categoryId: match.id }
          }
        }
      } catch {
        log.error('Failed to parse LLM response: ' + content)
        jlog?.warn(`Category "${segment}" — LLM parse failure`, { event: true, labels: ['category-matching', 'llm'] })
      }
    }
  }

  // No match found — return null (don't create new categories)
  log.info(`  No match for "${segment}" (parent: ${parentId})`)
  jlog?.warn(`Category "${segment}" — no match`, { event: true, labels: ['category-matching'] })
  return { categoryId: null }
}

export async function matchCategory(
  payload: PayloadRestClient,
  categoryBreadcrumb: string,
  jlog?: Logger,
): Promise<MatchCategoryResult> {
  const tokensUsed: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

  // Parse breadcrumb
  const segments = categoryBreadcrumb.split(' -> ').map((s) => s.trim()).filter(Boolean)

  if (segments.length === 0) {
    return { categoryId: null, categoryPath: categoryBreadcrumb, created: false, tokensUsed }
  }

  log.info(`── Resolving category hierarchy ──`)
  log.info(`Breadcrumb: "${categoryBreadcrumb}" → ${segments.length} segments: [${segments.join(', ')}]`)

  // Walk hierarchy from root to leaf
  let parentId: number | null = null
  let deepestMatchedId: number | null = null

  for (const segment of segments) {
    const result = await resolveSegment(payload, segment, parentId, tokensUsed, jlog)
    if (result.categoryId === null) {
      // Stop walking — use deepest matched category
      log.info(`Stopped at "${segment}" — using deepest match: ${deepestMatchedId}`)
      break
    }
    parentId = result.categoryId
    deepestMatchedId = result.categoryId
  }

  log.info(`Resolved to category id: ${deepestMatchedId}, path: "${categoryBreadcrumb}"`)
  jlog?.info(`Category "${categoryBreadcrumb}" — resolved to #${deepestMatchedId}`, { event: true, labels: ['category-matching'] })

  return {
    categoryId: deepestMatchedId,
    categoryPath: categoryBreadcrumb,
    created: false,
    tokensUsed,
  }
}
