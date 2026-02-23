import OpenAI from 'openai'
import type { TokenUsage } from '../classify-product'
import { createLogger } from '@/lib/logger'

const log = createLogger('analyzeSentiment')

function getOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set')
  }
  return new OpenAI({ apiKey })
}

const SYSTEM_PROMPT = `You are a skincare video analyst. You analyze transcript segments from skincare/beauty video reviews to extract product-specific quotes and sentiment.

You receive:
- The full video transcript (for overall context and tone)
- A transcript segment from the current scene (with pre and post context)
- A list of products referenced in this video segment (with brand and product name)

Your task:
1. For each referenced product, extract direct quotes where the creator actually speaks ABOUT the product (its properties, effectiveness, texture, scent, results, price, recommendation, etc.)
2. Assign sentiment to each quote (positive, neutral, negative, mixed)
3. Assign a sentiment score from -1.0 (very negative) to 1.0 (very positive)
4. Provide an overall sentiment and score per product

Quote extraction rules:
- CRITICAL: Only extract quotes that are genuinely about the product. Ignore general chit-chat, greetings, life updates, channel announcements, transitions between topics, or any speech that is not specifically discussing or evaluating a product. The product being visible on screen does NOT mean the spoken words are about it.
- Only extract actual spoken text as quotes, do not paraphrase
- A product MUST have zero quotes if the creator does not actually talk about it — e.g. if they only hold it up, show it briefly, or the transcript is unrelated chit-chat. Do NOT create quotes with neutral/0 sentiment as a placeholder.
- Multiple quotes per product are expected when the creator discusses it at length
- If only one product is referenced, you may attribute product-related speech to it — but ONLY if the creator is actually discussing the product. General talking, storytelling, or off-topic speech must still be excluded.

Sentiment scoring rules — READ CAREFULLY:
- The overallSentimentScore must reflect the creator's TRUE opinion of the product as expressed in the segment. Use the full transcript for additional context on the creator's overall stance.
- Think about it like a human would: if someone says "this is the best vitamin C on the market, it has 15% vitamin C acid, the stability is amazing, but it smells a bit weird" — that is overwhelmingly positive with one minor caveat. The overall score should be high (e.g. 0.7-0.9), not dragged down to neutral.
- Weight the quotes by their strength and significance. A superlative recommendation ("the best on the market") carries far more weight than a minor complaint ("smells a bit").
- "Mixed" should ONLY be used when the positive and negative aspects are roughly balanced in significance. One minor drawback alongside strong praise is NOT mixed — it is positive.
- Score guide:
  - 0.8 to 1.0: Strong recommendation, enthusiastic praise, superlatives
  - 0.5 to 0.7: Generally positive, recommends with minor reservations
  - 0.1 to 0.4: Mildly positive, lukewarm
  - 0.0: Truly neutral, no opinion expressed
  - -0.1 to -0.4: Mildly negative, some disappointment
  - -0.5 to -0.7: Generally negative, would not recommend
  - -0.8 to -1.0: Strongly negative, warns against the product

For each quote, also provide a "summary" array: very short, concise key takeaways that stay true to the original wording but strip filler words. Each summary entry should capture one distinct point. Use the creator's own phrasing where possible — do not editorialize.

Example:
  "text": "Das Produkt ist richtig nice für fettige Haut und hat nicht so ein klebriges Gefühl",
  "summary": ["nice für fettige Haut", "kein klebriges Gefühl"]

Return ONLY a JSON object with this structure:
{
  "products": [
    {
      "productId": 123,
      "quotes": [
        { "text": "exact spoken text", "summary": ["key point 1", "key point 2"], "sentiment": "positive", "sentimentScore": 0.8 }
      ],
      "overallSentiment": "positive",
      "overallSentimentScore": 0.7
    }
  ]
}

If no product-related quotes can be extracted, return: { "products": [] }
No explanation outside the JSON.`

const REFINE_SUMMARIES_PROMPT = `You are a skincare content editor preparing quote summaries for a consumer-facing product review database.

You receive an array of short summary bullet points extracted from a skincare video transcript. Each point describes something a creator said about a product.

Your task:
1. Fix grammar, spelling, and awkward phrasing so each point reads cleanly and naturally
2. Keep each point very short (ideally 3-8 words)
3. Stay true to the creator's original meaning — do not editorialize or exaggerate
4. Keep the original language (German, English, etc.) — do not translate
5. Remove any point that does not convey a clear, meaningful skincare-related opinion or observation about the product (e.g. vague filler like "ganz okay" without context, or points that only make sense with the full quote)
6. Capitalize the first letter of each point

You receive a JSON object where each key maps to an array of summary points. Return a JSON object with the same keys, where each value is the refined array (minus any removed entries).

Example input: {"0.0": ["nice für fettige haut", "kein klebriges Gefühl", "ja also"], "0.1": ["trocknet schnell"]}
Example output: {"0.0": ["Nice für fettige Haut", "Kein klebriges Gefühl"], "0.1": ["Trocknet schnell"]}`

export interface ProductQuoteResult {
  productId: number
  quotes: Array<{
    text: string
    summary: string[]
    sentiment: 'positive' | 'neutral' | 'negative' | 'mixed'
    sentimentScore: number
  }>
  overallSentiment: 'positive' | 'neutral' | 'negative' | 'mixed'
  overallSentimentScore: number
}

export interface SentimentAnalysisResult {
  products: ProductQuoteResult[]
  tokensUsed: TokenUsage
}

/**
 * Refine summary bullet points for all quotes in one snippet.
 * Sends a keyed object so the LLM can return results mapped by key.
 * Single LLM call for the entire snippet.
 */
async function refineSummaries(
  products: ProductQuoteResult[],
  tokensUsed: TokenUsage,
): Promise<void> {
  // Build a keyed map: "0.0" → ["summary1", "summary2"], "0.1" → [...]
  const input: Record<string, string[]> = {}
  let totalCount = 0

  for (let pi = 0; pi < products.length; pi++) {
    for (let qi = 0; qi < products[pi].quotes.length; qi++) {
      const s = products[pi].quotes[qi].summary ?? []
      if (s.length > 0) {
        input[`${pi}.${qi}`] = s
        totalCount += s.length
      }
    }
  }

  if (totalCount === 0) return

  const openai = getOpenAI()

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      temperature: 0,
      messages: [
        { role: 'system', content: REFINE_SUMMARIES_PROMPT },
        { role: 'user', content: JSON.stringify(input) },
      ],
    })

    tokensUsed.promptTokens += response.usage?.prompt_tokens ?? 0
    tokensUsed.completionTokens += response.usage?.completion_tokens ?? 0
    tokensUsed.totalTokens += response.usage?.total_tokens ?? 0

    const content = response.choices[0]?.message?.content?.trim()
    if (!content) return

    const refined = JSON.parse(content) as Record<string, string[]>
    let refinedCount = 0

    for (const [key, values] of Object.entries(refined)) {
      const [pi, qi] = key.split('.').map(Number)
      if (products[pi]?.quotes[qi]) {
        products[pi].quotes[qi].summary = values
        refinedCount += values.length
      }
    }

    log.info(`Refined summaries: ${totalCount} → ${refinedCount}`)
  } catch (error) {
    log.error('Summary refinement failed: ' + String(error))
    // Keep original summaries on failure
  }
}

/**
 * Analyze transcript segments to extract product-specific quotes and sentiment.
 */
export async function analyzeSentiment(
  preTranscript: string,
  transcript: string,
  postTranscript: string,
  referencedProducts: Array<{ productId: number; brandName: string; productName: string }>,
  fullTranscript?: string,
): Promise<SentimentAnalysisResult> {
  const tokensUsed: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

  if (!transcript.trim() || referencedProducts.length === 0) {
    return { products: [], tokensUsed }
  }

  const openai = getOpenAI()

  const productList = referencedProducts
    .map((p) => `- ID ${p.productId}: ${p.brandName} ${p.productName}`)
    .join('\n')

  const singleProductHint = referencedProducts.length === 1
    ? `\n\nNote: Only one product is referenced in this segment. If the creator is discussing product-related topics, attribute those quotes to this product. But do NOT attribute general chit-chat or off-topic speech.`
    : ''

  const fullTranscriptSection = fullTranscript?.trim()
    ? `[Full video transcript — for context only, extract quotes only from the main transcript below]
${fullTranscript}

---

`
    : ''

  const userMessage = `${fullTranscriptSection}[Pre-context]
${preTranscript || '(none)'}

[Main transcript]
${transcript}

[Post-context]
${postTranscript || '(none)'}

Referenced products:
${productList}${singleProductHint}`

  log.info(`Analyzing sentiment: ${transcript.length} chars, ${referencedProducts.length} products`)

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      temperature: 0,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
    })

    tokensUsed.promptTokens += response.usage?.prompt_tokens ?? 0
    tokensUsed.completionTokens += response.usage?.completion_tokens ?? 0
    tokensUsed.totalTokens += response.usage?.total_tokens ?? 0

    const content = response.choices[0]?.message?.content?.trim()
    log.info(`Sentiment tokens: ${tokensUsed.promptTokens} prompt + ${tokensUsed.completionTokens} completion = ${tokensUsed.totalTokens} total`)

    if (!content) {
      log.info('Empty response from sentiment LLM')
      return { products: [], tokensUsed }
    }

    const parsed = JSON.parse(content) as { products: ProductQuoteResult[] }
    const products = parsed.products ?? []

    log.info(`Sentiment results: ${products.length} products with quotes`)

    // Refine summaries: fix grammar, remove meaningless entries
    await refineSummaries(products, tokensUsed)

    // Drop quotes that ended up with empty summaries after refinement
    for (const product of products) {
      product.quotes = product.quotes.filter((q) => q.summary && q.summary.length > 0)
    }

    return {
      products: products.filter((p) => p.quotes.length > 0),
      tokensUsed,
    }
  } catch (error) {
    log.error('Sentiment analysis failed: ' + String(error))
    return { products: [], tokensUsed }
  }
}
