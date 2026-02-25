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
  warnings: string | null
  skinApplicability: string | null
  phMin: number | null
  phMax: number | null
  usageInstructions: string | null
  usageSchedule: number[][] | null
  productAttributes: Array<{ attribute: string } & EvidenceEntry>
  productClaims: Array<{ claim: string } & EvidenceEntry>
  tokensUsed: TokenUsage
}

const VALID_SKIN_APPLICABILITY = new Set(['normal', 'sensitive', 'mixed', 'oily', 'dry'])

const SYSTEM_PROMPT = `You are an expert cosmetic chemist analyzing cosmetics/personal care products.

You will receive one or more sources for the same product, each with a description and/or ingredient list.

First, write a short neutral product description (2-4 sentences) in {{LANGUAGE}}. State what the product is, what it does, and any notable claims. No advertising language, no superlatives, no promotional tone. Just factual information.

Then classify the product into exactly one product type from this list:
cleanser, toner, moisturizer, sunCream, peeling, treatment, mask, eyeCream, lipcare, serum, eyelashSerum, other

Pick the single most appropriate type. Use "other" only if none of the specific types fit.

Then identify which product attributes and claims apply, providing evidence for each.

**Product Attributes** (true ONLY if the product actually CONTAINS these substances):
- containsAllergens: known allergens (common fragrance allergens, MI/MCI, etc.)
- containsSimpleAlcohol: simple/drying alcohols (Alcohol Denat., Ethanol, Isopropyl Alcohol) — NOT fatty alcohols
- containsGluten: gluten or gluten-derived ingredients
- containsSilicones: silicones (Dimethicone, Cyclomethicone, -cone/-siloxane compounds)
- containsSulfates: sulfates (SLS, SLES, Sodium Lauryl Sulfate)
- containsParabens: parabens (Methylparaben, Propylparaben, etc.)
- containsPegs: PEG compounds (Polyethylene Glycol derivatives)
- containsFragrance: fragrance/parfum
- containsMineralOil: mineral oil / petroleum-derived oils (Paraffinum Liquidum, Petrolatum)

CRITICAL: "Free from X" / "Frei von X" / "ohne X" / "X-frei" means the product does NOT contain X. That is the OPPOSITE — it is a CLAIM (e.g. pegFree, mineralOilFree), NOT an attribute. Never set a "contains" attribute based on "free from" language. For example, "Frei von PEGs" → pegFree claim, NOT containsPegs attribute.

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

**Additional product details** — extract from descriptions when mentioned. Use null if not stated or unclear.

- **warnings**: All product warnings, safety notices, or precautions combined into one text block (e.g. "Avoid contact with eyes. Not suitable for children under 3."). null if none found.

- **skinApplicability**: Target skin type. Exactly one of: "normal", "sensitive", "mixed", "oily", "dry". Only set when the description explicitly mentions a target skin type. null if not stated or for all skin types.

- **phMin** and **phMax**: pH value or range. Single pH (e.g. "pH 5.5") → both phMin and phMax = 5.5. Range (e.g. "pH 4.5–5.5") → phMin = 4.5, phMax = 5.5. Must be numbers between 0 and 14. null for both if no pH info found.

- **usageInstructions**: Application instructions from the description, written as a clean readable paragraph. null if none found.

- **usageSchedule**: A 2D array encoding when to use the product.

  Structure: The OUTER array is a repeating cycle of days. Each INNER array is one day with exactly 3 slots representing [morning, midday, evening]. Each slot is the integer 1 (use) or the integer 0 (skip). An EMPTY inner array [] means skip that entire day.

  The cycle repeats: after the last day, it starts again from the first day.

  Examples:
  - Use daily in the morning only → [[1, 0, 0]]
    (one day in the cycle: morning=yes, midday=no, evening=no; repeats every day)
  - Use daily morning and evening → [[1, 0, 1]]
  - Use daily, any time / whenever needed → [[1, 1, 1]]
  - Use every second day, morning only → [[1, 0, 0], []]
    (day 1: morning=yes; day 2: skip entirely; then repeat)
  - Use every second day, morning and evening → [[1, 0, 1], []]
  - Use every third day, evening only → [[0, 0, 1], [], []]
  - Use twice a week, evening → [[0, 0, 1], [], [], [0, 0, 1], [], [], []]

  Rules for usageSchedule:
  - Outer array: at least 1 element.
  - Each inner array: exactly 0 elements (skip day) or exactly 3 elements.
  - Values: only integer 0 or integer 1 — never booleans, never 2, never other numbers.
  - null if the description does not mention frequency or schedule.
  - "Use daily" without time-of-day → [[1, 1, 1]].
  - "Use morning and evening" → [[1, 0, 1]].

**Rules for attributes and claims:**
- Only include attributes/claims that are actually supported by evidence.
- For each, provide the 0-based sourceIndex and evidence type.
- type "ingredient": list the specific ingredient names from the ingredient list that triggered it.
- type "descriptionSnippet": provide the exact verbatim snippet from the description text. Copy it character-for-character. Also provide "start" and "end" as 0-based character offsets into the source's description text (start is inclusive, end is exclusive), so the snippet equals description.substring(start, end).
- One entry per (attribute/claim, source) combination.

Return ONLY JSON:
{
  "description": "A neutral 2-4 sentence product description.",
  "productType": "moisturizer",
  "warnings": "Avoid contact with eyes. If irritation occurs, discontinue use.",
  "skinApplicability": "sensitive",
  "phMin": 5.0,
  "phMax": 5.5,
  "usageInstructions": "Apply a small amount to cleansed face and neck morning and evening.",
  "usageSchedule": [[1, 0, 1]],
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
    warnings?: string | null
    skinApplicability?: string | null
    phMin?: number | null
    phMax?: number | null
    usageInstructions?: string | null
    usageSchedule?: unknown
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

  // Validate new detail fields
  const warnings = typeof result.warnings === 'string' && result.warnings.trim() ? result.warnings.trim() : null

  let skinApplicability = result.skinApplicability ?? null
  if (skinApplicability && !VALID_SKIN_APPLICABILITY.has(skinApplicability)) {
    log.info(`Invalid skinApplicability "${skinApplicability}", dropping`)
    skinApplicability = null
  }

  const phMin = typeof result.phMin === 'number' && result.phMin >= 0 && result.phMin <= 14 ? result.phMin : null
  const phMax = typeof result.phMax === 'number' && result.phMax >= 0 && result.phMax <= 14 ? result.phMax : null

  const usageInstructions = typeof result.usageInstructions === 'string' && result.usageInstructions.trim() ? result.usageInstructions.trim() : null

  let usageSchedule: number[][] | null = null
  if (Array.isArray(result.usageSchedule) && result.usageSchedule.length > 0) {
    const valid = (result.usageSchedule as unknown[][]).every(
      (day) => Array.isArray(day) && (day.length === 0 || (day.length === 3 && day.every((v) => v === 0 || v === 1))),
    )
    if (valid) {
      usageSchedule = result.usageSchedule as number[][]
    } else {
      log.info('Invalid usageSchedule from LLM, dropping')
    }
  }

  jlog?.info(`Classification: type=${productType}, ${rawAttributes.length} attrs, ${rawClaims.length} claims`, { event: true, labels: ['classification'] })

  return {
    description: result.description ?? '',
    productType,
    warnings,
    skinApplicability,
    phMin,
    phMax,
    usageInstructions,
    usageSchedule,
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
