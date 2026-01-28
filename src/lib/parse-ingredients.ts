import OpenAI from 'openai'

const SYSTEM_PROMPT = `You are an expert cosmetic chemist who parses INCI (International Nomenclature of Cosmetic Ingredients) ingredient lists.

Your task: Given a raw ingredient string from a product page, extract each individual ingredient name and return them as a JSON array of strings.

Rules:
- Ingredients may be separated by commas, bullets (•), slashes, or other delimiters.
- Some ingredients have alternative names in parentheses or after slashes, e.g. "AQUA / WATER" or "CERA MICROCRISTALLINA / MICROCRYSTALLINE WAX". Keep these as ONE ingredient with the full name including the slash notation.
- Preserve parenthesized content that belongs to an ingredient, e.g. "Mineral Oil (Paraffinum Liquidum, Huile Minérale)" is ONE ingredient.
- "[+/- MAY CONTAIN: ...]" sections list optional colorants. Extract each colorant as a separate ingredient. Include the CI number and name together, e.g. "CI 77891 / TITANIUM DIOXIDE".
- Remove any leading labels like "Ingredients:", "INGREDIENTS:", "INCI:", etc.
- Remove trailing dots or question marks.
- Trim whitespace from each ingredient.
- Preserve the original casing as-is.
- Do NOT modify, translate, or normalize ingredient names.
- Return ONLY a JSON array of strings. No explanation, no markdown.

Example input:
AQUA / WATER • DIMETHICONE • CI 77891 / TITANIUM DIOXIDE ? [+/- MAY CONTAIN: CI 77491, CI 77492, CI 77499 / IRON OXIDES].

Example output:
["AQUA / WATER","DIMETHICONE","CI 77891 / TITANIUM DIOXIDE","CI 77491","CI 77492","CI 77499 / IRON OXIDES"]`

export async function parseIngredients(rawText: string): Promise<string[]> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set')
  }

  const openai = new OpenAI({ apiKey })

  const response = await openai.chat.completions.create({
    model: 'gpt-4.1-mini',
    temperature: 0,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: rawText },
    ],
  })

  const content = response.choices[0]?.message?.content?.trim()
  if (!content) {
    throw new Error('Empty response from OpenAI')
  }

  try {
    const parsed = JSON.parse(content)
    if (!Array.isArray(parsed)) {
      throw new Error('Response is not an array')
    }
    return parsed.filter((s): s is string => typeof s === 'string' && s.length > 0)
  } catch {
    throw new Error(`Failed to parse OpenAI response as JSON: ${content.substring(0, 200)}`)
  }
}
