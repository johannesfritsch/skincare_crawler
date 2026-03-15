import type { PayloadRestClient } from './payload-client'
import { createLogger, type Logger } from '@/lib/logger'
import { getOpenAI } from '@/lib/openai'
const log = createLogger('matchIngredients')

export interface MatchedIngredient {
  originalName: string
  ingredientId: number | null
  matchedName: string | null
}

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface MatchIngredientsResult {
  matched: MatchedIngredient[]
  unmatched: string[]
  tokensUsed: TokenUsage
}

interface SearchTermEntry {
  original: string
  searchTerms: string[]
}

interface SelectionEntry {
  original: string
  selectedName: string | null
}

interface CandidateInfo {
  id: number
  name: string
}

const SEARCH_TERM_SYSTEM_PROMPT = `You are an expert cosmetic chemist who normalizes INCI (International Nomenclature of Cosmetic Ingredients) names for database lookup.

Your task: Given a JSON array of ingredient name strings, generate search terms for each one that can be used to find the ingredient in a database.

Rules:
- Split slash-separated names into individual search terms: "AQUA / WATER" → ["AQUA", "WATER"]
- Extract chemical names from CI numbers: "CI 77891 / TITANIUM DIOXIDE" → ["TITANIUM DIOXIDE", "CI 77891"]
- Split parenthesized synonyms into separate terms: "CERA ALBA (BEESWAX)" → ["CERA ALBA", "BEESWAX"]
- For simple ingredient names with no separators, return the name itself as the only search term
- Preserve original casing

Return ONLY a JSON array of objects with this structure:
[{ "original": "exact input string", "searchTerms": ["term1", "term2"] }]

No explanation, no markdown fences.`

const MATCH_SELECTION_SYSTEM_PROMPT = `You are an expert cosmetic chemist who matches ingredient names to their correct CosIng database entries.

Your task: Given a JSON array of objects, each containing an original ingredient name and a list of candidate database matches, select the best match for each ingredient based on chemical identity.

Rules:
- Select the candidate that represents the same chemical substance as the original ingredient name
- Prefer exact INCI name matches over synonyms or trade names
- If none of the candidates are a valid match, set selectedName to null
- Consider that slash-separated names (e.g. "AQUA / WATER") should match either part
- CI numbers and their corresponding pigment names refer to the same substance

Return ONLY a JSON array of objects with this structure:
[{ "original": "exact input string", "selectedName": "matched candidate name or null" }]

No explanation, no markdown fences.`

async function generateSearchTerms(ingredientNames: string[]): Promise<{ entries: SearchTermEntry[]; usage: TokenUsage }> {
  const openai = getOpenAI()

  const userContent = JSON.stringify(ingredientNames)
  log.info('LLM search term generation', { model: 'gpt-4.1-mini', temperature: 0 })
  log.debug('LLM prompt', { prompt: userContent })

  const response = await openai.chat.completions.create({
    model: 'gpt-4.1-mini',
    temperature: 0,
    messages: [
      { role: 'system', content: SEARCH_TERM_SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
  })

  const usage: TokenUsage = {
    promptTokens: response.usage?.prompt_tokens ?? 0,
    completionTokens: response.usage?.completion_tokens ?? 0,
    totalTokens: response.usage?.total_tokens ?? 0,
  }

  const content = response.choices[0]?.message?.content?.trim()
  log.debug('LLM response', { response: content ?? '(empty)' })
  log.info('LLM tokens used', { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, totalTokens: usage.totalTokens })
  if (!content) {
    throw new Error('Empty response from OpenAI during search term generation')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error(`Failed to parse search term response as JSON: ${content.substring(0, 200)}`)
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Search term response is not an array')
  }

  // Match by original field rather than relying on array index order
  const resultMap = new Map<string, string[]>()
  for (const entry of parsed) {
    if (entry && typeof entry.original === 'string' && Array.isArray(entry.searchTerms)) {
      resultMap.set(entry.original, entry.searchTerms.filter((t: unknown) => typeof t === 'string' && t.length > 0))
    }
  }

  const entries = ingredientNames.map((name) => ({
    original: name,
    searchTerms: resultMap.get(name) ?? [name], // Fall back to original name if missing
  }))

  return { entries, usage }
}

async function searchIngredients(
  payload: PayloadRestClient,
  searchTermEntries: SearchTermEntry[],
): Promise<Map<string, CandidateInfo[]>> {
  // Collect all unique search terms and track which originals they belong to
  const termToOriginals = new Map<string, Set<string>>()
  for (const entry of searchTermEntries) {
    for (const term of entry.searchTerms) {
      const existing = termToOriginals.get(term)
      if (existing) {
        existing.add(entry.original)
      } else {
        termToOriginals.set(term, new Set([entry.original]))
      }
    }
  }

  const uniqueTerms = Array.from(termToOriginals.keys())

  log.info('DB search', { termCount: uniqueTerms.length })

  // Search all terms in parallel: case-insensitive exact match + fuzzy (like) match per term.
  // The uppercase exact search ensures the precise entry is always included even when
  // `like` results are crowded out by compounds (e.g. "Glycerin" → "POLYGLYCERIN-40").
  const searchResults = await Promise.all(
    uniqueTerms.map(async (term) => {
      const [exactResult, uppercaseResult, likeResult] = await Promise.all([
        payload.find({
          collection: 'ingredients',
          where: { name: { equals: term } },
          limit: 1,
        }),
        payload.find({
          collection: 'ingredients',
          where: { name: { equals: term.toUpperCase() } },
          limit: 1,
        }),
        payload.find({
          collection: 'ingredients',
          where: { name: { like: term } },
          limit: 10,
        }),
      ])
      // Merge exact matches first, then like results (deduped below)
      const docs = [...exactResult.docs, ...uppercaseResult.docs, ...likeResult.docs]
      return { term, docs }
    }),
  )

  // Map results back to originating ingredients, dedup by ingredient ID
  const candidatesByOriginal = new Map<string, Map<number, CandidateInfo>>()

  for (const { term, docs } of searchResults) {
    const originals = termToOriginals.get(term)
    if (!originals) continue

    for (const original of originals) {
      let candidateMap = candidatesByOriginal.get(original)
      if (!candidateMap) {
        candidateMap = new Map()
        candidatesByOriginal.set(original, candidateMap)
      }
      for (const doc of docs as Array<{ id: number; name: string }>) {
        if (!candidateMap.has(doc.id)) {
          candidateMap.set(doc.id, { id: doc.id, name: doc.name })
        }
      }
    }
  }

  // Convert to arrays
  const result = new Map<string, CandidateInfo[]>()
  for (const [original, candidateMap] of candidatesByOriginal) {
    const candidates = Array.from(candidateMap.values())
    result.set(original, candidates)
    log.debug('Candidates for ingredient', { ingredient: original, count: candidates.length })
  }

  return result
}

async function selectMatches(
  ambiguous: { original: string; candidates: CandidateInfo[] }[],
): Promise<{ selections: Map<string, string | null>; usage: TokenUsage }> {
  const openai = getOpenAI()

  const prompt = ambiguous.map(({ original, candidates }) => ({
    original,
    candidates: candidates.map((c) => c.name),
  }))

  const userContent = JSON.stringify(prompt)
  log.info('LLM match selection', { model: 'gpt-4.1-mini', temperature: 0 })
  log.debug('LLM prompt', { prompt: userContent })

  const response = await openai.chat.completions.create({
    model: 'gpt-4.1-mini',
    temperature: 0,
    messages: [
      { role: 'system', content: MATCH_SELECTION_SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
  })

  const usage: TokenUsage = {
    promptTokens: response.usage?.prompt_tokens ?? 0,
    completionTokens: response.usage?.completion_tokens ?? 0,
    totalTokens: response.usage?.total_tokens ?? 0,
  }

  const content = response.choices[0]?.message?.content?.trim()
  log.debug('LLM response', { response: content ?? '(empty)' })
  log.info('LLM tokens used', { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, totalTokens: usage.totalTokens })
  if (!content) {
    throw new Error('Empty response from OpenAI during match selection')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error(`Failed to parse match selection response as JSON: ${content.substring(0, 200)}`)
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Match selection response is not an array')
  }

  const selections = new Map<string, string | null>()
  for (const entry of parsed as SelectionEntry[]) {
    if (entry && typeof entry.original === 'string') {
      selections.set(entry.original, entry.selectedName ?? null)
    }
  }

  return { selections, usage }
}

export async function matchIngredients(
  payload: PayloadRestClient,
  ingredientNames: string[],
  jlog?: Logger,
): Promise<MatchIngredientsResult> {
  const tokensUsed: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

  if (ingredientNames.length === 0) {
    return { matched: [], unmatched: [], tokensUsed }
  }

  // Strip footnote markers (*, ¹, ², ³, etc.) from ingredient names for cleaner DB lookups
  const stripFootnoteMarkers = (name: string) => name.replace(/^[*¹²³⁴⁵⁶⁷⁸⁹⁰†‡§]+|[*¹²³⁴⁵⁶⁷⁸⁹⁰†‡§]+$/g, '').trim()

  // Step 0: Exact DB match (case-insensitive) — resolve names that match exactly, skip LLM for those
  // DB stores names in UPPERCASE, so we search both original case and uppercased.
  // We avoid `like` here because it does substring matching and the exact entry
  // can be crowded out by compounds (e.g. "Glycerin" returns "POLYGLYCERIN-40" but not "GLYCERIN").
  log.info('Exact DB match (case-insensitive)')
  const exactResults = await Promise.all(
    ingredientNames.map(async (name) => {
      const cleaned = stripFootnoteMarkers(name)
      const result = await payload.find({
        collection: 'ingredients',
        where: {
          or: [
            { name: { equals: cleaned } },
            { name: { equals: cleaned.toUpperCase() } },
          ],
        },
        limit: 2,
      })
      return { name, docs: result.docs as Array<{ id: number; name: string }> }
    }),
  )

  const matched: MatchedIngredient[] = []
  const remainingNames: string[] = []

  for (const { name, docs } of exactResults) {
    if (docs.length === 1) {
      log.debug('Ingredient exact match', { ingredient: name, matched: docs[0].name, ingredientId: docs[0].id })
      matched.push({
        originalName: name,
        ingredientId: docs[0].id,
        matchedName: docs[0].name,
      })
    } else {
      remainingNames.push(name)
    }
  }

  log.info('Exact match results', { exactMatches: matched.length, remaining: remainingNames.length })
  jlog?.event('ingredients.exact_match_summary', { exactMatches: matched.length, total: ingredientNames.length })

  // If all resolved via exact match, skip LLM calls entirely
  if (remainingNames.length === 0) {
    log.info('All ingredients matched exactly, no LLM needed', { matched: matched.length })
    jlog?.event('ingredients.all_exact_matched', { matched: matched.length })
    for (const m of matched) {
      log.debug('Ingredient matched', { original: m.originalName, matched: m.matchedName, ingredientId: m.ingredientId })
    }
    return { matched, unmatched: [], tokensUsed }
  }

  // Step 1: Generate search terms via LLM (only for remaining names)
  const { entries: searchTermEntries, usage: searchTermUsage } = await generateSearchTerms(remainingNames)
  tokensUsed.promptTokens += searchTermUsage.promptTokens
  tokensUsed.completionTokens += searchTermUsage.completionTokens
  tokensUsed.totalTokens += searchTermUsage.totalTokens

  // Step 2: Search DB for candidates
  const candidatesByOriginal = await searchIngredients(payload, searchTermEntries)

  // Step 3: Classify results
  log.info('Classification')
  const unmatched: string[] = []
  const ambiguous: { original: string; candidates: CandidateInfo[] }[] = []

  for (const name of remainingNames) {
    const candidates = candidatesByOriginal.get(name) ?? []

    if (candidates.length === 0) {
      log.debug('Ingredient unmatched', { ingredient: name, candidates: 0 })
      unmatched.push(name)
    } else if (candidates.length === 1) {
      log.debug('Ingredient auto-match', { ingredient: name, matched: candidates[0].name, ingredientId: candidates[0].id })
      matched.push({
        originalName: name,
        ingredientId: candidates[0].id,
        matchedName: candidates[0].name,
      })
    } else {
      log.debug('Ingredient ambiguous', { ingredient: name, candidates: candidates.length })
      ambiguous.push({ original: name, candidates })
    }
  }

  // Step 4: LLM Call 2 for ambiguous matches (graceful degradation on failure)
  if (ambiguous.length > 0) {
    let selections: Map<string, string | null>

    try {
      const selectResult = await selectMatches(ambiguous)
      selections = selectResult.selections
      tokensUsed.promptTokens += selectResult.usage.promptTokens
      tokensUsed.completionTokens += selectResult.usage.completionTokens
      tokensUsed.totalTokens += selectResult.usage.totalTokens
    } catch (error) {
      log.error('LLM match selection failed, treating ambiguous as unmatched', { ambiguousCount: ambiguous.length })
      jlog?.event('ingredients.llm_selection_failed', { ambiguousCount: ambiguous.length })
      for (const { original } of ambiguous) {
        unmatched.push(original)
      }
      return { matched, unmatched, tokensUsed }
    }

    for (const { original, candidates } of ambiguous) {
      const selectedName = selections.get(original)

      if (selectedName) {
        const candidate = candidates.find((c) => c.name === selectedName)
        if (candidate) {
          matched.push({
            originalName: original,
            ingredientId: candidate.id,
            matchedName: candidate.name,
          })
        } else {
          unmatched.push(original)
        }
      } else {
        unmatched.push(original)
      }
    }
  }

  log.info('Ingredient matching result', { matched: matched.length, unmatched: unmatched.length, totalTokens: tokensUsed.totalTokens })
  jlog?.event('ingredients.matched', { matched: matched.length, unmatched: unmatched.length })
  for (const m of matched) {
    log.debug('Ingredient matched', { original: m.originalName, matched: m.matchedName, ingredientId: m.ingredientId })
  }
  for (const u of unmatched) {
    log.debug('Ingredient unmatched', { ingredient: u })
  }

  return { matched, unmatched, tokensUsed }
}
