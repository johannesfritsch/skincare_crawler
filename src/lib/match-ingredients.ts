import OpenAI from 'openai'
import type { BasePayload } from 'payload'

export interface MatchedIngredient {
  originalName: string
  ingredientId: number | null
  matchedName: string | null
}

export interface MatchIngredientsResult {
  matched: MatchedIngredient[]
  unmatched: string[]
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

function getOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set')
  }
  return new OpenAI({ apiKey })
}

async function generateSearchTerms(ingredientNames: string[]): Promise<SearchTermEntry[]> {
  const openai = getOpenAI()

  const userContent = JSON.stringify(ingredientNames)
  console.log('\n[matchIngredients] ── LLM Call 1: Search Term Generation ──')
  console.log('[matchIngredients] Model: gpt-4.1-mini, temperature: 0')
  console.log('[matchIngredients] System prompt:', SEARCH_TERM_SYSTEM_PROMPT)
  console.log('[matchIngredients] User prompt:', userContent)

  const response = await openai.chat.completions.create({
    model: 'gpt-4.1-mini',
    temperature: 0,
    messages: [
      { role: 'system', content: SEARCH_TERM_SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
  })

  const content = response.choices[0]?.message?.content?.trim()
  console.log('[matchIngredients] Response:', content ?? '(empty)')
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

  return ingredientNames.map((name) => ({
    original: name,
    searchTerms: resultMap.get(name) ?? [name], // Fall back to original name if missing
  }))
}

async function searchIngredients(
  payload: BasePayload,
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

  console.log('\n[matchIngredients] ── DB Search ──')
  console.log(`[matchIngredients] Searching ${uniqueTerms.length} unique terms:`, uniqueTerms)

  // Search all terms in parallel: exact match + fuzzy (like) match per term
  const searchResults = await Promise.all(
    uniqueTerms.map(async (term) => {
      const [exactResult, likeResult] = await Promise.all([
        payload.find({
          collection: 'ingredients',
          where: { name: { equals: term } },
          limit: 1,
        }),
        payload.find({
          collection: 'ingredients',
          where: { name: { like: term } },
          limit: 10,
        }),
      ])
      // Merge exact match first, then like results (deduped below)
      const docs = [...exactResult.docs, ...likeResult.docs]
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
      for (const doc of docs) {
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
    console.log(`[matchIngredients]   "${original}" → ${candidates.length} candidates: [${candidates.map((c) => c.name).join(', ')}]`)
  }

  return result
}

async function selectMatches(
  ambiguous: { original: string; candidates: CandidateInfo[] }[],
): Promise<Map<string, string | null>> {
  const openai = getOpenAI()

  const prompt = ambiguous.map(({ original, candidates }) => ({
    original,
    candidates: candidates.map((c) => c.name),
  }))

  const userContent = JSON.stringify(prompt)
  console.log('\n[matchIngredients] ── LLM Call 2: Match Selection ──')
  console.log('[matchIngredients] Model: gpt-4.1-mini, temperature: 0')
  console.log('[matchIngredients] System prompt:', MATCH_SELECTION_SYSTEM_PROMPT)
  console.log('[matchIngredients] User prompt:', userContent)

  const response = await openai.chat.completions.create({
    model: 'gpt-4.1-mini',
    temperature: 0,
    messages: [
      { role: 'system', content: MATCH_SELECTION_SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
  })

  const content = response.choices[0]?.message?.content?.trim()
  console.log('[matchIngredients] Response:', content ?? '(empty)')
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

  const resultMap = new Map<string, string | null>()
  for (const entry of parsed as SelectionEntry[]) {
    if (entry && typeof entry.original === 'string') {
      resultMap.set(entry.original, entry.selectedName ?? null)
    }
  }

  return resultMap
}

export async function matchIngredients(
  payload: BasePayload,
  ingredientNames: string[],
): Promise<MatchIngredientsResult> {
  if (ingredientNames.length === 0) {
    return { matched: [], unmatched: [] }
  }

  // Step 1: Generate search terms via LLM
  const searchTermEntries = await generateSearchTerms(ingredientNames)

  // Step 2: Search DB for candidates
  const candidatesByOriginal = await searchIngredients(payload, searchTermEntries)

  // Step 3: Classify results
  console.log('\n[matchIngredients] ── Classification ──')
  const matched: MatchedIngredient[] = []
  const unmatched: string[] = []
  const ambiguous: { original: string; candidates: CandidateInfo[] }[] = []

  for (const name of ingredientNames) {
    const candidates = candidatesByOriginal.get(name) ?? []

    if (candidates.length === 0) {
      console.log(`[matchIngredients]   "${name}" → UNMATCHED (0 candidates)`)
      unmatched.push(name)
    } else if (candidates.length === 1) {
      console.log(`[matchIngredients]   "${name}" → AUTO-MATCH → "${candidates[0].name}" (id: ${candidates[0].id})`)
      matched.push({
        originalName: name,
        ingredientId: candidates[0].id,
        matchedName: candidates[0].name,
      })
    } else {
      console.log(`[matchIngredients]   "${name}" → AMBIGUOUS (${candidates.length} candidates)`)
      ambiguous.push({ original: name, candidates })
    }
  }

  // Step 4: LLM Call 2 for ambiguous matches (graceful degradation on failure)
  if (ambiguous.length > 0) {
    let selections: Map<string, string | null>

    try {
      selections = await selectMatches(ambiguous)
    } catch (error) {
      console.error('LLM match selection failed, treating ambiguous ingredients as unmatched:', error)
      for (const { original } of ambiguous) {
        unmatched.push(original)
      }
      return { matched, unmatched }
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

  console.log('\n[matchIngredients] ── Result ──')
  console.log(`[matchIngredients] Matched: ${matched.length}, Unmatched: ${unmatched.length}`)
  for (const m of matched) {
    console.log(`[matchIngredients]   ✓ "${m.originalName}" → "${m.matchedName}" (id: ${m.ingredientId})`)
  }
  for (const u of unmatched) {
    console.log(`[matchIngredients]   ✗ "${u}"`)
  }

  return { matched, unmatched }
}
