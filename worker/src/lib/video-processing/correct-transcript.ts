import type { TokenUsage } from '../classify-product'
import { createLogger } from '@/lib/logger'
import { getOpenAI } from '@/lib/openai'

const log = createLogger('correctTranscript')

/** Max retries for the LLM correction call (configurable via OPENAI_CORRECTION_RETRIES) */
const MAX_RETRIES = Number(process.env.OPENAI_CORRECTION_RETRIES) || 3

/** Delay between retries in ms (doubles each retry: 5s, 10s, 20s) */
const INITIAL_RETRY_DELAY_MS = 5_000

const SYSTEM_PROMPT = `You are a professional skincare transcription editor. You receive a raw speech-to-text transcript from a German skincare/beauty video.

Your task:
1. Fix likely speech recognition errors, especially for brand names and product names
2. Correct misspellings of technical skincare/cosmetics terms
3. Fix German grammar and punctuation where obviously wrong from recognition errors
4. Do NOT change the meaning, tone, or content of what was said
5. Do NOT add or remove sentences
6. Keep the same structure and word count as close to the original as possible

You will receive:
- The raw transcript
- A list of known brand names in the skincare industry
- A list of product names referenced in this video

Return ONLY a JSON object with this structure:
{ "correctedTranscript": "the full corrected transcript text", "correctedWords": [{ "original": "misspeled", "corrected": "misspelled", "reason": "brand name correction" }] }

The "correctedWords" array should only contain words that were actually changed. No explanation outside the JSON.`

export interface CorrectionResult {
  correctedTranscript: string
  corrections: Array<{ original: string; corrected: string; reason: string }>
  tokensUsed: TokenUsage
}

/**
 * Use the chat model to correct speech recognition errors in a transcript,
 * with domain knowledge of skincare brands and products.
 *
 * Retries up to MAX_RETRIES times on failure (timeout, network error, etc.)
 * with exponential backoff. Throws after all retries are exhausted.
 */
export async function correctTranscript(
  rawTranscript: string,
  brandNames: string[],
  productNames: string[],
): Promise<CorrectionResult> {
  const tokensUsed: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

  if (!rawTranscript.trim()) {
    return { correctedTranscript: '', corrections: [], tokensUsed }
  }

  const openai = getOpenAI()
  const model = process.env.OPENAI_CHAT_MODEL || 'gpt-4.1-mini'

  const userMessage = `Raw transcript:
${rawTranscript}

Known brand names:
${brandNames.join(', ')}

Product names referenced in this video:
${productNames.join(', ')}`

  const promptCharCount = SYSTEM_PROMPT.length + userMessage.length

  let lastError: Error | null = null

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    log.info('Correcting transcript', {
      charCount: rawTranscript.length,
      brandCount: brandNames.length,
      productCount: productNames.length,
      promptChars: promptCharCount,
      model,
      attempt,
      maxRetries: MAX_RETRIES,
    })

    const startMs = Date.now()
    try {
      const response = await openai.chat.completions.create({
        model,
        temperature: 0,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
      })
      const durationMs = Date.now() - startMs

      tokensUsed.promptTokens += response.usage?.prompt_tokens ?? 0
      tokensUsed.completionTokens += response.usage?.completion_tokens ?? 0
      tokensUsed.totalTokens += response.usage?.total_tokens ?? 0

      const content = response.choices[0]?.message?.content?.trim()
      log.info('Correction complete', { durationMs, attempt, promptTokens: tokensUsed.promptTokens, completionTokens: tokensUsed.completionTokens, totalTokens: tokensUsed.totalTokens })

      if (!content) {
        log.info('Empty response from correction LLM, returning original transcript')
        return { correctedTranscript: rawTranscript, corrections: [], tokensUsed }
      }

      const parsed = JSON.parse(content) as {
        correctedTranscript: string
        correctedWords: Array<{ original: string; corrected: string; reason: string }>
      }

      log.info('Corrections applied', { wordsChanged: parsed.correctedWords?.length ?? 0 })

      return {
        correctedTranscript: parsed.correctedTranscript ?? rawTranscript,
        corrections: parsed.correctedWords ?? [],
        tokensUsed,
      }
    } catch (error) {
      const durationMs = Date.now() - startMs
      lastError = error instanceof Error ? error : new Error(String(error))

      if (attempt < MAX_RETRIES) {
        const delayMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1)
        log.warn('Transcript correction failed, retrying', {
          error: lastError.message,
          durationMs,
          attempt,
          maxRetries: MAX_RETRIES,
          retryInMs: delayMs,
        })
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      } else {
        log.error('Transcript correction failed after all retries', {
          error: lastError.message,
          durationMs,
          attempt,
          maxRetries: MAX_RETRIES,
        })
      }
    }
  }

  // All retries exhausted — throw so the stage fails
  throw new Error(`Transcript correction failed after ${MAX_RETRIES} retries: ${lastError?.message ?? 'Unknown error'}`)
}
