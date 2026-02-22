import OpenAI from 'openai'
import type { PayloadRestClient } from './payload-client'
import { matchBrand } from './match-brand'
import type { TokenUsage } from './match-ingredients'
import { createLogger, type Logger } from '@/lib/logger'
const log = createLogger('matchProduct')

export interface MatchProductResult {
  productId: number
  productName: string
  tokensUsed: TokenUsage
}

const PRODUCT_MATCH_SYSTEM_PROMPT = `You are a cosmetics product expert. Given a brand name, product name, and a list of candidate product names from a database, select the best match.

Rules:
- Match despite minor wording differences (e.g. "Hydrating Face Cream" vs "Hydrating Facial Cream")
- Match despite abbreviation differences
- Consider the brand context when selecting
- If none of the candidates represent the same product, return null

Return ONLY a JSON object with this structure:
{ "selectedId": matched_product_id_or_null }

No explanation, no markdown fences.`

function getOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set')
  }
  return new OpenAI({ apiKey })
}

interface ProductCandidate {
  id: number
  name: string
}

export async function matchProduct(
  payload: PayloadRestClient,
  brand: string | null,
  productName: string | null,
  searchTerms: string[],
  jlog?: Logger,
): Promise<MatchProductResult | null> {
  const tokensUsed: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

  if (!productName && searchTerms.length === 0) {
    return null
  }

  // Step 1: Match brand if provided
  let brandId: number | undefined
  if (brand) {
    log.info(`── Step 1: Match Brand "${brand}" ──`)
    const brandResult = await matchBrand(payload, brand, jlog)
    brandId = brandResult.brandId
    tokensUsed.promptTokens += brandResult.tokensUsed.promptTokens
    tokensUsed.completionTokens += brandResult.tokensUsed.completionTokens
    tokensUsed.totalTokens += brandResult.tokensUsed.totalTokens
    log.info(`Brand matched: "${brandResult.brandName}" (id: ${brandId}, created: ${brandResult.created})`)
    jlog?.info(`Product brand "${brand}" — matched "${brandResult.brandName}" #${brandId}`, { event: true, labels: ['product-matching', 'brand-matching'] })
  }

  // Step 2: Search products — cast a wide net with many cheap DB queries
  log.info(`── Step 2: Search Products ──`)
  const allTerms = [...searchTerms]
  if (productName && !allTerms.includes(productName)) {
    allTerms.unshift(productName)
  }

  // Build search keywords: full terms + individual words (≥3 chars) + consecutive word pairs
  const searchKeywords = new Set<string>()
  for (const term of allTerms) {
    searchKeywords.add(term)
    const words = term.split(/\s+/).filter((w) => w.length >= 3)
    for (const word of words) {
      searchKeywords.add(word)
    }
    // Consecutive word pairs for better specificity
    for (let k = 0; k < words.length - 1; k++) {
      searchKeywords.add(`${words[k]} ${words[k + 1]}`)
    }
  }

  const keywords = Array.from(searchKeywords)
  log.info(`Search keywords (${keywords.length}): [${keywords.join(', ')}]`)

  const candidateMap = new Map<number, ProductCandidate>()

  // Run all searches in parallel — DB queries are cheap
  const searchPromises = keywords.flatMap((keyword) => {
    const queries = [
      payload.find({
        collection: 'products',
        where: { name: { like: keyword } },
        limit: 10,
      }),
    ]

    if (brandId) {
      queries.push(
        payload.find({
          collection: 'products',
          where: {
            and: [
              { brand: { equals: brandId } },
              { name: { like: keyword } },
            ],
          },
          limit: 10,
        }),
      )
    }

    return queries
  })

  const results = await Promise.all(searchPromises)

  for (const result of results) {
    for (const doc of result.docs as Array<{ id: number; name: string }>) {
      if (!candidateMap.has(doc.id)) {
        candidateMap.set(doc.id, { id: doc.id, name: doc.name ?? `Product #${doc.id}` })
      }
    }
  }

  const candidates = Array.from(candidateMap.values())
  log.info(`Found ${candidates.length} unique candidates: [${candidates.map((c) => `${c.name} (#${c.id})`).join(', ')}]`)
  jlog?.info(`Product: ${candidates.length} candidates for "${productName}"`, { event: true, labels: ['product-matching'] })

  // Step 3: Select match
  if (candidates.length === 0) {
    log.info('No candidates found, returning null')
    jlog?.warn(`Product "${productName}" — no match`, { event: true, labels: ['product-matching'] })
    return null
  }

  if (candidates.length === 1) {
    log.info(`Single candidate, auto-matching: "${candidates[0].name}" (#${candidates[0].id})`)
    jlog?.info(`Product "${productName}" — auto-match "${candidates[0].name}" #${candidates[0].id}`, { event: true, labels: ['product-matching'] })
    return {
      productId: candidates[0].id,
      productName: candidates[0].name,
      tokensUsed,
    }
  }

  // Step 4: LLM disambiguation
  log.info(`── Step 3: LLM Disambiguation (${candidates.length} candidates) ──`)
  const openai = getOpenAI()

  const userContent = JSON.stringify({
    brand: brand ?? 'unknown',
    productName: productName ?? 'unknown',
    candidates: candidates.map((c) => ({ id: c.id, name: c.name })),
  })

  log.info('Model: gpt-4.1-mini, temperature: 0')
  log.info('User prompt: ' + userContent)

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      temperature: 0,
      messages: [
        { role: 'system', content: PRODUCT_MATCH_SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
    })

    tokensUsed.promptTokens += response.usage?.prompt_tokens ?? 0
    tokensUsed.completionTokens += response.usage?.completion_tokens ?? 0
    tokensUsed.totalTokens += response.usage?.total_tokens ?? 0

    const content = response.choices[0]?.message?.content?.trim()
    log.info('Response: ' + (content ?? '(empty)'))
    log.info(`Tokens: ${tokensUsed.promptTokens} prompt + ${tokensUsed.completionTokens} completion = ${tokensUsed.totalTokens} total`)

    if (content) {
      const parsed = JSON.parse(content) as { selectedId: number | null }
      if (parsed.selectedId !== null) {
        const match = candidates.find((c) => c.id === parsed.selectedId)
        if (match) {
          log.info(`LLM selected: "${match.name}" (#${match.id})`)
          jlog?.info(`Product "${productName}" — LLM selected "${match.name}" #${match.id}`, { event: true, labels: ['product-matching', 'llm'] })
          return {
            productId: match.id,
            productName: match.name,
            tokensUsed,
          }
        }
      }
    }
  } catch (error) {
    log.error('LLM disambiguation failed: ' + String(error))
  }

  log.info('No match selected, returning null')
  jlog?.warn(`Product "${productName}" — no match after LLM`, { event: true, labels: ['product-matching', 'llm'] })
  return null
}
