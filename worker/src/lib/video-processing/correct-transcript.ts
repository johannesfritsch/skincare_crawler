import OpenAI from 'openai'
import type { TokenUsage } from '../classify-product'
import type { TranscriptWord } from './transcribe-audio'
import { createLogger } from '@/lib/logger'

const log = createLogger('correctTranscript')

function getOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set')
  }
  return new OpenAI({ apiKey })
}

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
 * Use GPT-4.1-mini to correct speech recognition errors in a transcript,
 * with domain knowledge of skincare brands and products.
 */
export async function correctTranscript(
  rawTranscript: string,
  words: TranscriptWord[],
  brandNames: string[],
  productNames: string[],
): Promise<CorrectionResult> {
  const tokensUsed: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

  if (!rawTranscript.trim()) {
    return { correctedTranscript: '', corrections: [], tokensUsed }
  }

  const openai = getOpenAI()

  const userMessage = `Raw transcript:
${rawTranscript}

Known brand names:
${brandNames.join(', ')}

Product names referenced in this video:
${productNames.join(', ')}`

  log.info(`Correcting transcript: ${rawTranscript.length} chars, ${brandNames.length} brands, ${productNames.length} products`)

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
    log.info(`Correction tokens: ${tokensUsed.promptTokens} prompt + ${tokensUsed.completionTokens} completion = ${tokensUsed.totalTokens} total`)

    if (!content) {
      log.info('Empty response from correction LLM, returning original transcript')
      return { correctedTranscript: rawTranscript, corrections: [], tokensUsed }
    }

    const parsed = JSON.parse(content) as {
      correctedTranscript: string
      correctedWords: Array<{ original: string; corrected: string; reason: string }>
    }

    log.info(`Corrections applied: ${parsed.correctedWords?.length ?? 0} words changed`)

    return {
      correctedTranscript: parsed.correctedTranscript ?? rawTranscript,
      corrections: parsed.correctedWords ?? [],
      tokensUsed,
    }
  } catch (error) {
    log.error('Transcript correction failed: ' + String(error))
    return { correctedTranscript: rawTranscript, corrections: [], tokensUsed }
  }
}
