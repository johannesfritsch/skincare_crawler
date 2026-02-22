import OpenAI from 'openai'
import fs from 'fs'
import type { TokenUsage } from '../classify-product'
import { createLogger } from '@/lib/logger'
const log = createLogger('recognizeProduct')

function getOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set')
  }
  return new OpenAI({ apiKey })
}

const CLASSIFY_SYSTEM_PROMPT = `You are a cosmetics product classifier. Given numbered images, determine whether each image shows a cosmetics/beauty product package (e.g. bottle, tube, box, jar with visible branding).

Rules:
- Answer "yes" only if a distinct cosmetics product package is clearly visible
- Answer "no" for faces, skin closeups, swatches, text overlays, lifestyle shots, backgrounds
- Each image has a cluster number label

Return ONLY a JSON object with this structure:
{ "results": [{ "cluster": 0, "isProduct": true }, ...] }

No explanation, no markdown fences.`

const RECOGNIZE_SYSTEM_PROMPT = `You are a cosmetics product expert. Given images of a cosmetics product, identify the brand and product name by reading text visible on the packaging.

Rules:
- Read the brand name and product name from the packaging
- If you cannot read the text clearly, return null values
- Generate 2-3 search terms that could be used to find this product in a database (e.g. the full product name, abbreviated name, key product line name)
- Search terms should be in the language visible on the packaging

Return ONLY a JSON object with this structure:
{ "brand": "Brand Name or null", "productName": "Product Name or null", "searchTerms": ["term1", "term2"] }

No explanation, no markdown fences.`

export interface ClassifyResult {
  candidates: number[]
  tokensUsed: TokenUsage
}

export interface RecognizeResult {
  brand: string | null
  productName: string | null
  searchTerms: string[]
  tokensUsed: TokenUsage
}

export async function classifyScreenshots(
  images: { clusterGroup: number; imagePath: string }[],
): Promise<ClassifyResult> {
  const tokensUsed: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

  if (images.length === 0) {
    return { candidates: [], tokensUsed }
  }

  const openai = getOpenAI()

  const imageContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = []
  for (const img of images) {
    imageContent.push({ type: 'text', text: `Cluster ${img.clusterGroup}:` })
    const buffer = fs.readFileSync(img.imagePath)
    const base64 = buffer.toString('base64')
    imageContent.push({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${base64}`, detail: 'low' },
    })
  }

  log.info(`── Phase 1: Classify ${images.length} cluster thumbnails ──`)
  log.info('Model: gpt-4.1-mini, temperature: 0, detail: low')

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      temperature: 0,
      messages: [
        { role: 'system', content: CLASSIFY_SYSTEM_PROMPT },
        { role: 'user', content: imageContent },
      ],
    })

    tokensUsed.promptTokens += response.usage?.prompt_tokens ?? 0
    tokensUsed.completionTokens += response.usage?.completion_tokens ?? 0
    tokensUsed.totalTokens += response.usage?.total_tokens ?? 0

    const content = response.choices[0]?.message?.content?.trim()
    log.info('Response: ' + (content ?? '(empty)'))
    log.info(`Tokens: ${tokensUsed.promptTokens} prompt + ${tokensUsed.completionTokens} completion = ${tokensUsed.totalTokens} total`)

    if (!content) {
      log.error('Empty response from classification')
      return { candidates: [], tokensUsed }
    }

    const parsed = JSON.parse(content) as { results: { cluster: number; isProduct: boolean }[] }
    const candidates = parsed.results
      .filter((r) => r.isProduct)
      .map((r) => r.cluster)

    log.info(`Product candidates: clusters [${candidates.join(', ')}]`)
    return { candidates, tokensUsed }
  } catch (error) {
    log.error('Classification failed: ' + String(error))
    return { candidates: [], tokensUsed }
  }
}

export async function recognizeProduct(
  imagePaths: string[],
): Promise<RecognizeResult | null> {
  const tokensUsed: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

  if (imagePaths.length === 0) {
    return null
  }

  const openai = getOpenAI()

  const imageContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = []
  for (const imgPath of imagePaths) {
    const buffer = fs.readFileSync(imgPath)
    const ext = imgPath.endsWith('.png') ? 'png' : 'jpeg'
    const base64 = buffer.toString('base64')
    imageContent.push({
      type: 'image_url',
      image_url: { url: `data:image/${ext};base64,${base64}`, detail: 'auto' },
    })
  }

  log.info(`── Phase 2: Recognize product from ${imagePaths.length} screenshots ──`)
  log.info('Model: gpt-4.1-mini, temperature: 0, detail: auto')

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      temperature: 0,
      messages: [
        { role: 'system', content: RECOGNIZE_SYSTEM_PROMPT },
        { role: 'user', content: imageContent },
      ],
    })

    tokensUsed.promptTokens += response.usage?.prompt_tokens ?? 0
    tokensUsed.completionTokens += response.usage?.completion_tokens ?? 0
    tokensUsed.totalTokens += response.usage?.total_tokens ?? 0

    const content = response.choices[0]?.message?.content?.trim()
    log.info('Response: ' + (content ?? '(empty)'))
    log.info(`Tokens: ${tokensUsed.promptTokens} prompt + ${tokensUsed.completionTokens} completion = ${tokensUsed.totalTokens} total`)

    if (!content) {
      log.error('Empty response from recognition')
      return null
    }

    const parsed = JSON.parse(content) as { brand: string | null; productName: string | null; searchTerms: string[] }
    log.info(`Brand: ${parsed.brand ?? 'unknown'}, Product: ${parsed.productName ?? 'unknown'}, Terms: [${parsed.searchTerms.join(', ')}]`)

    return {
      brand: parsed.brand,
      productName: parsed.productName,
      searchTerms: parsed.searchTerms ?? [],
      tokensUsed,
    }
  } catch (error) {
    log.error('Recognition failed: ' + String(error))
    return null
  }
}
