import OpenAI from 'openai'
import type { BasePayload } from 'payload'
import type { TokenUsage } from './match-ingredients'

export interface MatchBrandResult {
  brandId: number
  brandName: string
  created: boolean
  tokensUsed: TokenUsage
}

const BRAND_MATCH_SYSTEM_PROMPT = `You are a cosmetics brand expert. Given a brand name and a list of candidate brand names from a database, select the best match.

Rules:
- Match despite case variations (e.g., "nyx" vs "NYX")
- Match despite accent differences (e.g., "L'Oréal" vs "L'Oreal")
- Match despite abbreviation differences (e.g., "NYX Professional Makeup" vs "NYX Prof. Makeup")
- If none of the candidates represent the same brand, return null

Return ONLY a JSON object with this structure:
{ "selectedName": "matched candidate name or null" }

No explanation, no markdown fences.`

function getOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set')
  }
  return new OpenAI({ apiKey })
}

export async function matchBrand(
  payload: BasePayload,
  brandName: string,
): Promise<MatchBrandResult> {
  const tokensUsed: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

  // Step 1: Exact DB match
  console.log('\n[matchBrand] ── Step 1: Exact DB Match ──')
  const exactResult = await payload.find({
    collection: 'brands',
    where: { name: { equals: brandName } },
    limit: 1,
  })

  if (exactResult.docs.length === 1) {
    console.log(`[matchBrand]   "${brandName}" → EXACT MATCH (id: ${exactResult.docs[0].id})`)
    return {
      brandId: exactResult.docs[0].id,
      brandName: exactResult.docs[0].name,
      created: false,
      tokensUsed,
    }
  }

  // Step 2: Fuzzy search + LLM disambiguation
  console.log('\n[matchBrand] ── Step 2: Fuzzy Search ──')
  const fuzzyResult = await payload.find({
    collection: 'brands',
    where: { name: { like: brandName } },
    limit: 10,
  })

  console.log(`[matchBrand]   "${brandName}" → ${fuzzyResult.docs.length} fuzzy candidates: [${fuzzyResult.docs.map((d) => d.name).join(', ')}]`)

  if (fuzzyResult.docs.length === 1) {
    console.log(`[matchBrand]   AUTO-MATCH → "${fuzzyResult.docs[0].name}" (id: ${fuzzyResult.docs[0].id})`)
    return {
      brandId: fuzzyResult.docs[0].id,
      brandName: fuzzyResult.docs[0].name,
      created: false,
      tokensUsed,
    }
  }

  if (fuzzyResult.docs.length >= 2) {
    // LLM disambiguation
    const openai = getOpenAI()
    const candidates = fuzzyResult.docs.map((d) => d.name)
    const userContent = JSON.stringify({ brandName, candidates })

    console.log('\n[matchBrand] ── LLM Disambiguation ──')
    console.log('[matchBrand] Model: gpt-4.1-mini, temperature: 0')
    console.log('[matchBrand] User prompt:', userContent)

    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      temperature: 0,
      messages: [
        { role: 'system', content: BRAND_MATCH_SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
    })

    tokensUsed.promptTokens += response.usage?.prompt_tokens ?? 0
    tokensUsed.completionTokens += response.usage?.completion_tokens ?? 0
    tokensUsed.totalTokens += response.usage?.total_tokens ?? 0

    const content = response.choices[0]?.message?.content?.trim()
    console.log('[matchBrand] Response:', content ?? '(empty)')
    console.log(`[matchBrand] Tokens: ${tokensUsed.promptTokens} prompt + ${tokensUsed.completionTokens} completion = ${tokensUsed.totalTokens} total`)

    if (content) {
      try {
        const parsed = JSON.parse(content) as { selectedName: string | null }
        if (parsed.selectedName) {
          const match = fuzzyResult.docs.find((d) => d.name === parsed.selectedName)
          if (match) {
            console.log(`[matchBrand]   LLM selected → "${match.name}" (id: ${match.id})`)
            return {
              brandId: match.id,
              brandName: match.name,
              created: false,
              tokensUsed,
            }
          }
        }
      } catch {
        console.error('[matchBrand] Failed to parse LLM response:', content)
      }
    }
  }

  // Step 3: Create — re-check for race conditions, then create
  console.log('\n[matchBrand] ── Step 3: Create ──')
  const recheck = await payload.find({
    collection: 'brands',
    where: { name: { equals: brandName } },
    limit: 1,
  })

  if (recheck.docs.length === 1) {
    console.log(`[matchBrand]   Race condition avoided — found "${recheck.docs[0].name}" (id: ${recheck.docs[0].id})`)
    return {
      brandId: recheck.docs[0].id,
      brandName: recheck.docs[0].name,
      created: false,
      tokensUsed,
    }
  }

  const newBrand = await payload.create({
    collection: 'brands',
    data: { name: brandName },
  })

  console.log(`[matchBrand]   Created brand "${brandName}" (id: ${newBrand.id})`)

  return {
    brandId: newBrand.id,
    brandName: newBrand.name,
    created: true,
    tokensUsed,
  }
}
