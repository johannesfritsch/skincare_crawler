import OpenAI from 'openai'
import type { TokenUsage } from './match-ingredients'

export interface ClassifyProductResult {
  productAttributes: Record<string, boolean>
  productClaims: Record<string, boolean>
  tokensUsed: TokenUsage
}

const SYSTEM_PROMPT = `You are an expert cosmetic chemist analyzing cosmetics/personal care products.

Given one or more source descriptions (and/or ingredient lists) for the same product, determine the following boolean flags.

**Product Attributes** (ingredient-based — true if the product contains these):
- containsAllergens: contains known allergens (e.g. common fragrance allergens, preservatives like MI/MCI)
- containsSimpleAlcohol: contains simple/drying alcohols (e.g. Alcohol Denat., Ethanol, Isopropyl Alcohol) — NOT fatty alcohols
- containsGluten: contains gluten or gluten-derived ingredients
- containsSilicones: contains silicones (e.g. Dimethicone, Cyclomethicone, any -cone/-siloxane)
- containsSulfates: contains sulfates (e.g. SLS, SLES, Sodium Lauryl Sulfate)
- containsParabens: contains parabens (e.g. Methylparaben, Propylparaben)
- containsPegs: contains PEG compounds (Polyethylene Glycol derivatives)
- containsFragrance: contains fragrance/parfum
- containsMineralOil: contains mineral oil or petroleum-derived oils (e.g. Paraffinum Liquidum, Petrolatum)

**Product Claims** (marketing/safety claims — true if the product makes or supports this claim):
- vegan: product is marketed as vegan or contains no animal-derived ingredients
- crueltyFree: product is marketed as cruelty-free / not tested on animals
- unsafeForPregnancy: product contains ingredients considered unsafe during pregnancy (e.g. retinoids, salicylic acid in high concentration)
- pregnancySafe: product is explicitly marketed as pregnancy-safe
- waterProof: product is marketed as waterproof or water-resistant
- microplasticFree: product is marketed as microplastic-free
- allergenFree: product is marketed as allergen-free or hypoallergenic
- simpleAlcoholFree: product is marketed as alcohol-free (referring to simple alcohols)
- glutenFree: product is marketed as gluten-free
- siliconeFree: product is marketed as silicone-free
- sulfateFree: product is marketed as sulfate-free
- parabenFree: product is marketed as paraben-free
- pegFree: product is marketed as PEG-free
- fragranceFree: product is marketed as fragrance-free
- mineralOilFree: product is marketed as mineral-oil-free

**Rules:**
- If multiple source descriptions are provided, a flag should only be true if a majority of sources support it.
- For attributes (contains*): base your answer on ingredient lists when available, descriptions otherwise.
- For claims: base your answer on explicit marketing claims, labels, or certifications mentioned in the descriptions.
- When uncertain, default to false.

Return ONLY strict JSON with this structure:
{
  "productAttributes": { "containsAllergens": false, ... },
  "productClaims": { "vegan": false, ... }
}

No explanation, no markdown fences.`

function getOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set')
  }
  return new OpenAI({ apiKey })
}

export async function classifyProduct(descriptions: string[]): Promise<ClassifyProductResult> {
  const openai = getOpenAI()

  const userContent = descriptions
    .map((desc, i) => `Source ${i + 1}:\n${desc}`)
    .join('\n\n---\n\n')

  console.log('\n[classifyProduct] ── LLM Call: Product Classification ──')
  console.log('[classifyProduct] Model: gpt-4.1-mini, temperature: 0')
  console.log(`[classifyProduct] Sources: ${descriptions.length}`)

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
  console.log('[classifyProduct] Response:', content ?? '(empty)')
  console.log(`[classifyProduct] Tokens: ${tokensUsed.promptTokens} prompt + ${tokensUsed.completionTokens} completion = ${tokensUsed.totalTokens} total`)

  if (!content) {
    throw new Error('Empty response from OpenAI during product classification')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error(`Failed to parse classification response as JSON: ${content.substring(0, 200)}`)
  }

  const result = parsed as { productAttributes?: Record<string, boolean>; productClaims?: Record<string, boolean> }

  if (!result.productAttributes || !result.productClaims) {
    throw new Error('Classification response missing productAttributes or productClaims')
  }

  return {
    productAttributes: result.productAttributes,
    productClaims: result.productClaims,
    tokensUsed,
  }
}
