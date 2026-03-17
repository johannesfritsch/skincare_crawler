import { createLogger } from '@/lib/logger'
import type { TokenUsage } from '@/lib/classify-product'
import { getOpenAI } from '@/lib/openai'

const log = createLogger('stripBrandFromName')

export interface StripBrandResult {
  name: string
  tokensUsed: TokenUsage
}

const SYSTEM_PROMPT = `You are a product data specialist. You receive a raw product name from a retailer and the brand name.

Your task: Remove the brand name from the product name and clean up variant-specific details (colors, weights, volumes) to produce a clean generic product name.

Rules:
1. Remove the brand name from the beginning of the product name. The match does NOT have to be exact — partial or fuzzy matches count (e.g. "essence" matches "essence cosmetics", "G&G" matches "Geek & Gorgeous").
2. Remove weights and volumes (e.g. "10g", "50 ml", "250ml", "15%").
3. Remove color names and shade numbers when they are variant-specific (e.g. "010 Charming Champagne", "Rose Gold").
4. Keep product line names, product type descriptors, and identifying information.
5. Clean up leftover punctuation artifacts (trailing commas, double spaces, leading/trailing dashes or hyphens).
6. Do NOT translate or rephrase — only remove parts.
7. If the brand name is not found in the product name, just clean variant-specific details.

Examples:
- brandName: "essence cosmetics", nameCandidate: "essence Hydro Lipstick, 10g" → "Hydro Lipstick"
- brandName: "Geek & Gorgeous", nameCandidate: "Geek & Gorgeous 101 C-Glow 15% Vitamin C Serum" → "101 C-Glow 15% Vitamin C Serum"
- brandName: "NIVEA", nameCandidate: "NIVEA Creme Soft Pflegedusche 250 ml" → "Creme Soft Pflegedusche"
- brandName: "L'Oréal Paris", nameCandidate: "L'Oreal Elvital Dream Length Shampoo 300ml" → "Elvital Dream Length Shampoo"

Return ONLY the cleaned product name. No quotes, no explanation.`

/**
 * Strip the brand name and variant-specific details (colors, weights) from a product name using an LLM.
 *
 * Called during the resolve stage to produce a clean product name before it's written to the product record.
 */
export async function stripBrandFromName(
  nameCandidate: string,
  brandName: string,
): Promise<StripBrandResult> {
  const zeroTokens: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

  const name = nameCandidate.trim()
  if (!name) {
    return { name: '', tokensUsed: zeroTokens }
  }

  if (!brandName.trim()) {
    return { name, tokensUsed: zeroTokens }
  }

  const openai = getOpenAI()

  const userContent = `brandName: "${brandName}"
nameCandidate: "${name}"`

  log.info('LLM strip brand from name', { model: 'gpt-4.1-mini', name, brandName })

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
    log.warn('Empty response from LLM, using raw name')
    return { name, tokensUsed }
  }

  return { name: content, tokensUsed }
}
