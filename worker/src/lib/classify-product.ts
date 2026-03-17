import { createLogger, type Logger } from '@/lib/logger'
import { getOpenAI } from '@/lib/openai'
const log = createLogger('classifyProduct')

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface SourceInput {
  description?: string
  ingredientsText?: string
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

Classify the product into exactly one product type from this list:
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

CRITICAL — READ CAREFULLY: "contains" attributes mean the substance IS PRESENT in the product. Negation language means the OPPOSITE:
- "Free from X" / "Frei von X" / "ohne X" / "X-frei" / "without X" → the product does NOT contain X. This is a CLAIM (e.g. fragranceFree), NEVER a "contains" attribute.
- You MUST check the ingredient list (INCI) to confirm a "contains" attribute. Description text alone is not enough for "contains" — the substance must actually appear in the ingredients.

Examples of WRONG vs CORRECT classification:
- Description says "Ohne Parfüm" → WRONG: containsFragrance. CORRECT: fragranceFree claim.
- Description says "Frei von PEGs" → WRONG: containsPegs. CORRECT: pegFree claim.
- Description says "Ohne Silikone" → WRONG: containsSilicones. CORRECT: siliconeFree claim.
- Description says "Alkoholfrei" → WRONG: containsSimpleAlcohol. CORRECT: simpleAlcoholFree claim.
- Description says "Ohne Mineralöle" → WRONG: containsMineralOil. CORRECT: mineralOilFree claim.
- Ingredient list contains "Parfum" or "Fragrance" → CORRECT: containsFragrance attribute (evidence type: ingredient).

Think step by step for each attribute: (1) Is the substance actually listed in the INCI ingredients? If yes → containsX attribute. (2) Does the description say the product is FREE FROM this substance? If yes → XFree claim. Never confuse the two.

**Product Claims** (true if the product makes or supports this claim):
- vegan: explicitly marketed as vegan (label, description, or brand claim) — do NOT infer from ingredient analysis alone
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

export async function classifyProduct(sources: SourceInput[], language: string = 'de', jlog?: Logger): Promise<ClassifyProductResult> {
  const openai = getOpenAI()

  const userContent = sources
    .map((source, i) => {
      const parts: string[] = [`Source ${i}:`]
      if (source.description) parts.push(`Description:\n"""\n${source.description}\n"""`)
      if (source.ingredientsText) {
        parts.push(`Ingredients (raw text from retailer, may include footnotes/annotations):\n"""\n${source.ingredientsText}\n"""`)
      }
      return parts.join('\n')
    })
    .join('\n\n---\n\n')

  log.info('LLM product classification', { model: 'gpt-4.1-mini', temperature: 0, sources: sources.length })

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
    throw new Error('Empty response from OpenAI during product classification')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error(`Failed to parse classification response as JSON: ${content.substring(0, 200)}`)
  }

  const result = parsed as {
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
    log.info('Invalid productType, falling back to other', { productType })
    jlog?.event('classification.invalid_product_type', { productType })
    productType = 'other'
  }

  const rawAttributes = (result.productAttributes ?? []).filter((entry) => {
    if (!VALID_ATTRIBUTES.has(entry.attribute)) {
      log.info('Dropping invalid attribute', { attribute: entry.attribute })
      return false
    }
    return true
  })

  const rawClaims = (result.productClaims ?? []).filter((entry) => {
    if (!VALID_CLAIMS.has(entry.claim)) {
      log.info('Dropping invalid claim', { claim: entry.claim })
      return false
    }
    return true
  })

  // Validate new detail fields
  const warnings = typeof result.warnings === 'string' && result.warnings.trim() ? result.warnings.trim() : null

  let skinApplicability = result.skinApplicability ?? null
  if (skinApplicability && !VALID_SKIN_APPLICABILITY.has(skinApplicability)) {
    log.info('Invalid skinApplicability, dropping', { skinApplicability })
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

  jlog?.event('classification.complete', { productType, attributes: rawAttributes.length, claims: rawClaims.length })

  return {
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
