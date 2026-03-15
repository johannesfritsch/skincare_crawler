import { createLogger } from '@/lib/logger'
import type { TokenUsage } from '@/lib/classify-product'
import { getOpenAI } from '@/lib/openai'
import crypto from 'crypto'

const log = createLogger('cleanProductName')

export interface CleanProductNameResult {
  name: string
  tokensUsed: TokenUsage
  cacheHit: boolean
}

const SYSTEM_PROMPT = `You are a product data specialist. You receive a raw product name from a retailer and a list of variant labels (e.g. size, color, shade).

Your task: Remove variant-specific information from the product name to produce a clean, generic product name that applies to ALL variants.

Rules:
1. Remove size/amount mentions that match variant labels (e.g. "50 ml", "100ml", "250g").
2. Remove color/shade names that match variant labels (e.g. "Rose Gold", "010 Charming Champagne").
3. Remove variant numbers or codes that appear in variant labels.
4. Keep the brand name, product line name, and product type.
5. Keep descriptive words that apply to ALL variants (e.g. "Anti-Aging", "Sensitive", "SPF 30" if it applies to all variants).
6. Clean up leftover punctuation artifacts (trailing commas, double spaces, trailing dashes).
7. If the name doesn't contain any variant-specific information, return it unchanged.
8. Do NOT translate or rephrase — only remove variant-specific parts.

Return ONLY the cleaned product name. No quotes, no explanation.`

function computeContentHash(name: string, variantLabels: string[]): string {
  const normalized = [name.trim().toLowerCase(), ...variantLabels.map((l) => l.trim().toLowerCase()).sort()].join('|||')
  return crypto.createHash('sha256').update(normalized).digest('hex')
}

/**
 * Clean a product name by removing variant-specific information using an LLM.
 *
 * Given a raw product name (e.g. "NIVEA Creme Soft Pflegedusche 250 ml") and
 * variant labels (e.g. ["250 ml", "500 ml"]), returns the cleaned name
 * (e.g. "NIVEA Creme Soft Pflegedusche").
 *
 * If there are no variant labels, returns the name unchanged (no LLM call).
 *
 * @param rawName - The raw product name (typically the longest name from source-products)
 * @param variantLabels - Labels from all variants in the product group
 * @param cache - Per-run LLM cache (Map<contentHash, result>)
 */
export async function cleanProductName(
  rawName: string,
  variantLabels: string[],
  cache?: Map<string, unknown>,
): Promise<CleanProductNameResult> {
  const zeroTokens: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

  const name = rawName.trim()
  if (!name) {
    return { name: '', tokensUsed: zeroTokens, cacheHit: false }
  }

  // Filter out empty labels and deduplicate
  const uniqueLabels = [...new Set(variantLabels.filter((l) => l && l.trim()).map((l) => l.trim()))]

  // If no variant labels, nothing to clean
  if (uniqueLabels.length === 0) {
    log.debug('No variant labels, returning name as-is', { name })
    return { name, tokensUsed: zeroTokens, cacheHit: false }
  }

  // Check cache
  const cacheKey = `name:${computeContentHash(name, uniqueLabels)}`
  if (cache?.has(cacheKey)) {
    const cached = cache.get(cacheKey) as string
    log.debug('Name cleaning cache hit', { name, cacheKey: cacheKey.substring(0, 16) })
    return { name: cached, tokensUsed: zeroTokens, cacheHit: true }
  }

  // LLM call
  const openai = getOpenAI()

  const userContent = `Product name: "${name}"

Variant labels:
${uniqueLabels.map((l) => `- ${l}`).join('\n')}`

  log.info('LLM name cleaning', { model: 'gpt-4.1-mini', name, variantLabels: uniqueLabels.length })

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
  log.debug('LLM response', { input: name, output: content ?? '(empty)' })
  log.info('LLM tokens used', { promptTokens: tokensUsed.promptTokens, completionTokens: tokensUsed.completionTokens, totalTokens: tokensUsed.totalTokens })

  if (!content) {
    log.warn('Empty response from OpenAI during name cleaning, using raw name')
    return { name, tokensUsed, cacheHit: false }
  }

  // Store in cache
  cache?.set(cacheKey, content)

  return { name: content, tokensUsed, cacheHit: false }
}
