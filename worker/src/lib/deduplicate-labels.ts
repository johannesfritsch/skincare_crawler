import { createLogger } from '@/lib/logger'
import type { TokenUsage } from '@/lib/classify-product'
import { getOpenAI } from '@/lib/openai'
import crypto from 'crypto'

const log = createLogger('deduplicateLabels')

export interface DeduplicateLabelsResult {
  labels: string[]
  tokensUsed: TokenUsage
  cacheHit: boolean
}

const SYSTEM_PROMPT = `You are a cosmetics product data specialist. You receive a list of product labels/tags collected from multiple German retailers (dm, Rossmann, Müller, PURISH) for the same product variant.

Your task:
1. Normalize all labels to canonical German form (proper capitalization, consistent spelling).
2. Deduplicate labels that mean the same thing (e.g. "Vegan" and "vegan" → "Vegan", "Paraben-free" and "Parabenfrei" → "Parabenfrei").
3. Drop store-specific labels that are not product attributes. Remove labels like:
   - "dm-Marke", "dm-Liebling", "dmBio"
   - "Neu", "NEU", "New"
   - "Limitiert", "Limited Edition"
   - "Bestseller", "Best Seller"
   - "Sale", "Angebot", "Aktion"
   - "Last Chance"
   - "Kostenloser Versand", "Free Shipping"
   - "Online Only", "Nur Online"
   - Any store branding labels (store names, store loyalty program labels)
4. Keep labels that describe actual product properties, certifications, or claims:
   - "Vegan", "Naturkosmetik", "Bio", "Cruelty-free"
   - "Parabenfrei", "Silikonfrei", "Parfümfrei"
   - "Made in Germany", "Made in the USA"
   - Certification labels (COSMOS, Natrue, Ecocert, etc.)

Return ONLY a JSON array of the deduplicated canonical labels. Example:
["Vegan", "Parabenfrei", "Naturkosmetik", "Made in Germany"]

If no labels remain after filtering, return an empty array: []
No explanation, no markdown fences.`

function computeCacheKey(labels: string[]): string {
  const normalized = [...labels].sort().map((l) => l.trim().toLowerCase()).join('|')
  return crypto.createHash('sha256').update(normalized).digest('hex')
}

/**
 * Deduplicate and normalize product labels from multiple source-variants via LLM.
 *
 * Uses an in-memory per-run cache to avoid redundant LLM calls when multiple
 * GTINs have identical label sets.
 *
 * @param labels - Raw label strings from all source-variants for a GTIN
 * @param cache - Per-run LLM cache (Map<contentHash, result>)
 */
export async function deduplicateLabels(
  labels: string[],
  cache?: Map<string, unknown>,
): Promise<DeduplicateLabelsResult> {
  const zeroTokens: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

  // No labels → nothing to do
  if (labels.length === 0) {
    return { labels: [], tokensUsed: zeroTokens, cacheHit: false }
  }

  // Deduplicate trivially identical labels first (case-insensitive)
  const seen = new Set<string>()
  const uniqueLabels: string[] = []
  for (const label of labels) {
    const key = label.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    uniqueLabels.push(label.trim())
  }

  if (uniqueLabels.length === 0) {
    return { labels: [], tokensUsed: zeroTokens, cacheHit: false }
  }

  // If only one unique label, no LLM needed — just return it
  // (still useful to filter store-specific labels, but we skip for single labels
  //  since that would be a waste of an LLM call for marginal benefit)
  // Actually, we should still run through LLM to filter store-specific labels
  // unless the cache already has this result.

  // Check cache
  const cacheKey = `labels:${computeCacheKey(uniqueLabels)}`
  if (cache?.has(cacheKey)) {
    const cached = cache.get(cacheKey) as string[]
    log.debug('Label dedup cache hit', { labels: uniqueLabels.length, cacheKey: cacheKey.substring(0, 16) })
    return { labels: cached, tokensUsed: zeroTokens, cacheHit: true }
  }

  // LLM call
  const openai = getOpenAI()

  const userContent = `Labels to deduplicate:\n${uniqueLabels.map((l) => `- ${l}`).join('\n')}`

  log.info('LLM label deduplication', { model: 'gpt-4.1-mini', temperature: 0, labels: uniqueLabels.length })

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
    throw new Error('Empty response from OpenAI during label deduplication')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error(`Failed to parse label dedup response as JSON: ${content.substring(0, 200)}`)
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`Label dedup response is not an array: ${content.substring(0, 200)}`)
  }

  const result = (parsed as unknown[]).filter((item): item is string => typeof item === 'string' && item.trim().length > 0)

  // Store in cache
  cache?.set(cacheKey, result)

  return { labels: result, tokensUsed, cacheHit: false }
}
