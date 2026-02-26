import OpenAI from 'openai'

const SYSTEM_PROMPT = `You are an expert cosmetic chemist who parses INCI (International Nomenclature of Cosmetic Ingredients) ingredient lists.

Your task: Given raw ingredient text from a retailer product page, extract each individual ingredient name and return them as a JSON array of strings.

Rules:
- The raw text may contain footnotes, asterisks (*), superscripts, annotations (e.g. "*from organic farming", "¹ certified organic"), or other non-ingredient content. IGNORE all footnotes and annotations — only extract the actual ingredient names.
- Strip leading/trailing asterisks (*), superscript markers (¹²³), and other footnote symbols from ingredient names. For example "GLYCERIN*" → "GLYCERIN", "ALOE BARBADENSIS LEAF JUICE¹" → "ALOE BARBADENSIS LEAF JUICE".
- Ingredients may be separated by commas, bullets (•), slashes, or other delimiters.
- Some ingredients have alternative names in parentheses or after slashes, e.g. "AQUA / WATER" or "CERA MICROCRISTALLINA / MICROCRYSTALLINE WAX". Keep these as ONE ingredient with the full name including the slash notation.
- Preserve parenthesized content that belongs to an ingredient, e.g. "Mineral Oil (Paraffinum Liquidum, Huile Minérale)" is ONE ingredient.
- "[+/- MAY CONTAIN: ...]" sections list optional colorants. Extract each colorant as a separate ingredient. Include the CI number and name together, e.g. "CI 77891 / TITANIUM DIOXIDE".
- Remove any leading labels like "Ingredients:", "INGREDIENTS:", "INCI:", etc.
- Remove trailing dots or question marks.
- Trim whitespace from each ingredient.
- Preserve the original casing as-is (except for removing footnote markers as described above).
- Do NOT modify, translate, or normalize ingredient names.
- Return ONLY a JSON array of strings. No explanation, no markdown.

Example input:
Ingredients: AQUA / WATER, GLYCERIN*, DIMETHICONE, ALOE BARBADENSIS LEAF JUICE¹, CI 77891 / TITANIUM DIOXIDE. *from organic farming. ¹certified organic ingredient.

Example output:
["AQUA / WATER","GLYCERIN","DIMETHICONE","ALOE BARBADENSIS LEAF JUICE","CI 77891 / TITANIUM DIOXIDE"]`

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
