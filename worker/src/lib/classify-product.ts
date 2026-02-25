import OpenAI from 'openai'
import { createLogger, type Logger } from '@/lib/logger'
const log = createLogger('classifyProduct')

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface SourceInput {
  description?: string
  ingredientNames?: string[]
}

interface EvidenceEntry {
  sourceIndex: number
  type: 'ingredient' | 'descriptionSnippet'
  snippet?: string
  start?: number
  end?: number
  ingredientNames?: string[]
}

export interface ClassifyProductResult {
  description: string
  productType: string
  productAttributes: Array<{ attribute: string } & EvidenceEntry>
  productClaims: Array<{ claim: string } & EvidenceEntry>
  tokensUsed: TokenUsage
}

const SYSTEM_PROMPT = `You are an expert cosmetic chemist analyzing cosmetics/personal care products.

You will receive one or more sources for the same product, each with a description and/or ingredient list.

First, write a short neutral product description (2-4 sentences) in {{LANGUAGE}}. State what the product is, what it does, and any notable claims. No advertising language, no superlatives, no promotional tone. Just factual information.

Then classify the product into exactly one product type from this list:
cleanser, toner, moisturizer, sunCream, peeling, treatment, mask, eyeCream, lipcare, serum, eyelashSerum, other

Pick the single most appropriate type. Use "other" only if none of the specific types fit.

Then identify which product attributes and claims apply, providing evidence for each.

**Product Attributes** (true if the product contains these):
- containsAllergens: known allergens (common fragrance allergens, MI/MCI, etc.)
- containsSimpleAlcohol: simple/drying alcohols (Alcohol Denat., Ethanol, Isopropyl Alcohol) — NOT fatty alcohols
- containsGluten: gluten or gluten-derived ingredients
- containsSilicones: silicones (Dimethicone, Cyclomethicone, -cone/-siloxane compounds)
- containsSulfates: sulfates (SLS, SLES, Sodium Lauryl Sulfate)
- containsParabens: parabens (Methylparaben, Propylparaben, etc.)
- containsPegs: PEG compounds (Polyethylene Glycol derivatives)
- containsFragrance: fragrance/parfum
- containsMineralOil: mineral oil / petroleum-derived oils (Paraffinum Liquidum, Petrolatum)

**Product Claims** (true if the product makes or supports this claim):
- vegan: marketed as vegan or no animal-derived ingredients
- crueltyFree: marketed as cruelty-free / not tested on animals
- unsafeForPregnancy: contains ingredients unsafe during pregnancy (retinoids, high-concentration salicylic acid)
- pregnancySafe: explicitly marketed as pregnancy-safe
- waterProof: marketed as waterproof or water-resistant
- microplasticFree: marketed as microplastic-free
- allergenFree: marketed as allergen-free or hypoallergenic
- simpleAlcoholFree: marketed as alcohol-free (simple alcohols)
- glutenFree: marketed as gluten-free
- siliconeFree: marketed as silicone-free
- sulfateFree: marketed as sulfate-free
- parabenFree: marketed as paraben-free
- pegFree: marketed as PEG-free
- fragranceFree: marketed as fragrance-free
- mineralOilFree: marketed as mineral-oil-free

**Rules:**
- Only include attributes/claims that are actually supported by evidence.
- For each, provide the 0-based sourceIndex and evidence type.
- type "ingredient": list the specific ingredient names from the ingredient list that triggered it.
- type "descriptionSnippet": provide the exact verbatim snippet from the description text. Copy it character-for-character. Also provide "start" and "end" as 0-based character offsets into the source's description text (start is inclusive, end is exclusive), so the snippet equals description.substring(start, end).
- One entry per (attribute/claim, source) combination.

Return ONLY JSON:
{
  "description": "A neutral 2-4 sentence product description.",
  "productType": "moisturizer",
  "productAttributes": [
    { "attribute": "containsParabens", "sourceIndex": 0, "type": "ingredient", "ingredientNames": ["Methylparaben", "Propylparaben"] }
  ],
  "productClaims": [
    { "claim": "vegan", "sourceIndex": 0, "type": "descriptionSnippet", "snippet": "100% vegan", "start": 42, "end": 52 }
  ]
}

No explanation, no markdown fences.`

const VALID_PRODUCT_TYPES = new Set([
  'cleanser', 'toner', 'moisturizer', 'sunCream', 'peeling', 'treatment',
  'mask', 'eyeCream', 'lipcare', 'serum', 'eyelashSerum', 'other',
])

const VALID_ATTRIBUTES = new Set([
  'containsAllergens', 'containsSimpleAlcohol', 'containsGluten', 'containsSilicones',
  'containsSulfates', 'containsParabens', 'containsPegs', 'containsFragrance', 'containsMineralOil',
])

const VALID_CLAIMS = new Set([
  'vegan', 'crueltyFree', 'unsafeForPregnancy', 'pregnancySafe', 'waterProof',
  'microplasticFree', 'allergenFree', 'simpleAlcoholFree', 'glutenFree', 'siliconeFree',
  'sulfateFree', 'parabenFree', 'pegFree', 'fragranceFree', 'mineralOilFree',
])

function getOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set')
  }
  return new OpenAI({ apiKey })
}

export async function classifyProduct(sources: SourceInput[], language: string = 'de', jlog?: Logger): Promise<ClassifyProductResult> {
  const openai = getOpenAI()

  const userContent = sources
    .map((source, i) => {
      const parts: string[] = [`Source ${i}:`]
      if (source.description) parts.push(`Description:\n"""\n${source.description}\n"""`)
      if (source.ingredientNames && source.ingredientNames.length > 0) {
        parts.push(`Ingredients: ${source.ingredientNames.join(', ')}`)
      }
      return parts.join('\n')
    })
    .join('\n\n---\n\n')

  const languageLabel = language === 'de' ? 'German' : 'English'
  const systemPrompt = SYSTEM_PROMPT.replace('{{LANGUAGE}}', languageLabel)

  log.info('── LLM Call: Product Classification ──')
  log.info('Model: gpt-4.1-mini, temperature: 0')
  log.info(`Sources: ${sources.length}, language: ${languageLabel}`)

  const response = await openai.chat.completions.create({
    model: 'gpt-4.1-mini',
    temperature: 0,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
  })

  const tokensUsed: TokenUsage = {
    promptTokens: response.usage?.prompt_tokens ?? 0,
    completionTokens: response.usage?.completion_tokens ?? 0,
    totalTokens: response.usage?.total_tokens ?? 0,
  }

  const content = response.choices[0]?.message?.content?.trim()
  log.info('Response: ' + (content ?? '(empty)'))
  log.info(`Tokens: ${tokensUsed.promptTokens} prompt + ${tokensUsed.completionTokens} completion = ${tokensUsed.totalTokens} total`)

  if (!content) {
    throw new Error('Empty response from OpenAI during product classification')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error(`Failed to parse classification response as JSON: ${content.substring(0, 200)}`)
  }

  const result = parsed as {
    description?: string
    productType?: string
    productAttributes?: Array<{ attribute: string; sourceIndex: number; type: string; snippet?: string; start?: number; end?: number; ingredientNames?: string[] }>
    productClaims?: Array<{ claim: string; sourceIndex: number; type: string; snippet?: string; start?: number; end?: number; ingredientNames?: string[] }>
  }

  let productType = result.productType ?? 'other'
  if (!VALID_PRODUCT_TYPES.has(productType)) {
    log.info(`Invalid productType "${productType}", falling back to "other"`)
    jlog?.warn(`Classification: invalid productType "${productType}", falling back to "other"`, { event: true, labels: ['classification', 'llm'] })
    productType = 'other'
  }

  const rawAttributes = (result.productAttributes ?? []).filter((entry) => {
    if (!VALID_ATTRIBUTES.has(entry.attribute)) {
      log.info(`Dropping invalid attribute: "${entry.attribute}"`)
      return false
    }
    return true
  })

  const rawClaims = (result.productClaims ?? []).filter((entry) => {
    if (!VALID_CLAIMS.has(entry.claim)) {
      log.info(`Dropping invalid claim: "${entry.claim}"`)
      return false
    }
    return true
  })

  jlog?.info(`Classification: type=${productType}, ${rawAttributes.length} attrs, ${rawClaims.length} claims`, { event: true, labels: ['classification'] })

  return {
    description: result.description ?? '',
    productType,
    productAttributes: rawAttributes.map((entry) => ({
      attribute: entry.attribute,
      sourceIndex: entry.sourceIndex,
      type: entry.type as 'ingredient' | 'descriptionSnippet',
      snippet: entry.snippet,
      start: entry.start,
      end: entry.end,
      ingredientNames: entry.ingredientNames,
    })),
    productClaims: rawClaims.map((entry) => ({
      claim: entry.claim,
      sourceIndex: entry.sourceIndex,
      type: entry.type as 'ingredient' | 'descriptionSnippet',
      snippet: entry.snippet,
      start: entry.start,
      end: entry.end,
      ingredientNames: entry.ingredientNames,
    })),
    tokensUsed,
  }
}
