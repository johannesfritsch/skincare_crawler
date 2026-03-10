import OpenAI from 'openai'
import { createLogger } from '@/lib/logger'
import type { TokenUsage } from '@/lib/classify-product'
import crypto from 'crypto'

const log = createLogger('consensusDescription')

export interface ConsensusDescriptionResult {
  description: string
  tokensUsed: TokenUsage
  cacheHit: boolean
}

const SYSTEM_PROMPT = `You are a cosmetics product data specialist. You receive multiple product descriptions from different German retailers for the same product variant.

Your task: Synthesize a single, comprehensive product description in German that combines the best information from all sources.

Rules:
1. Write in neutral, factual tone — no advertising language, no superlatives, no promotional phrases.
2. Include all unique factual information from all descriptions (ingredients highlights, usage instructions, product benefits, target skin type, etc.).
3. Do not repeat information. Merge overlapping content.
4. Write 2-5 sentences. Be comprehensive but concise.
5. Keep the language in German.
6. If descriptions conflict on facts, prefer the more detailed/specific version.

Return ONLY the synthesized description text. No JSON, no markdown fences, no explanation.`

function getOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set')
  }
  return new OpenAI({ apiKey })
}

function computeContentHash(descriptions: string[]): string {
  const normalized = descriptions.map((d) => d.trim().toLowerCase()).sort().join('|||')
  return crypto.createHash('sha256').update(normalized).digest('hex')
}

/**
 * Generate a consensus product description from multiple source-variant descriptions.
 *
 * Optimization: If all descriptions are identical (after trim/lowercase), returns
 * the single text with 0 tokens used (no LLM call). Uses the per-run cache to
 * avoid redundant calls.
 *
 * @param descriptions - Description strings from source-variants for a GTIN
 * @param cache - Per-run LLM cache (Map<contentHash, result>)
 */
export async function consensusDescription(
  descriptions: string[],
  cache?: Map<string, unknown>,
): Promise<ConsensusDescriptionResult> {
  const zeroTokens: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

  // Filter out empty descriptions
  const nonEmpty = descriptions.filter((d) => d && d.trim().length > 0)

  if (nonEmpty.length === 0) {
    return { description: '', tokensUsed: zeroTokens, cacheHit: false }
  }

  // Deduplicate by normalized content
  const uniqueMap = new Map<string, string>()
  for (const desc of nonEmpty) {
    const key = desc.trim().toLowerCase()
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, desc.trim())
    }
  }

  const uniqueDescriptions = [...uniqueMap.values()]

  // If all descriptions are the same, return the single text (no LLM needed)
  if (uniqueDescriptions.length === 1) {
    log.debug('All descriptions identical, skipping LLM', { count: nonEmpty.length })
    return { description: uniqueDescriptions[0], tokensUsed: zeroTokens, cacheHit: false }
  }

  // Check cache
  const cacheKey = `desc:${computeContentHash(uniqueDescriptions)}`
  if (cache?.has(cacheKey)) {
    const cached = cache.get(cacheKey) as string
    log.debug('Description consensus cache hit', { descriptions: uniqueDescriptions.length, cacheKey: cacheKey.substring(0, 16) })
    return { description: cached, tokensUsed: zeroTokens, cacheHit: true }
  }

  // LLM call
  const openai = getOpenAI()

  const userContent = uniqueDescriptions
    .map((desc, i) => `Source ${i + 1}:\n"""\n${desc}\n"""`)
    .join('\n\n---\n\n')

  log.info('LLM description consensus', { model: 'gpt-4.1-mini', temperature: 0, descriptions: uniqueDescriptions.length })

  const response = await openai.chat.completions.create({
    model: 'gpt-4.1-mini',
    temperature: 0,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
  })

  const tokensUsed: TokenUsage = {
    promptTokens: response.usage?.prompt_tokens ?? 0,
    completionTokens: response.usage?.completion_tokens ?? 0,
    totalTokens: response.usage?.total_tokens ?? 0,
  }

  const content = response.choices[0]?.message?.content?.trim()
  log.debug('LLM response', { response: content ?? '(empty)' })
  log.info('LLM tokens used', { promptTokens: tokensUsed.promptTokens, completionTokens: tokensUsed.completionTokens, totalTokens: tokensUsed.totalTokens })

  if (!content) {
    throw new Error('Empty response from OpenAI during description consensus')
  }

  const description = content

  // Store in cache
  cache?.set(cacheKey, description)

  return { description, tokensUsed, cacheHit: false }
}
