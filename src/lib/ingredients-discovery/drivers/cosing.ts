import type { Payload } from 'payload'
import type { DiscoveryDriver, DiscoveryStats } from '../types'

const COSING_API_URL = 'https://api.tech.ec.europa.eu/search-api/prod/rest/search'
const COSING_API_KEY = '285a77fd-1257-4271-8507-f0c6b2961203'
const PAGE_SIZE = 200
const MAX_PAGES = 50
const BOUNDARY = '----WebKitFormBoundary6Q1PnAkG5xeXfWqu'
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

// Retry configuration
const MAX_RETRIES = 3
const INITIAL_RETRY_DELAY_MS = 2000 // Start with 2 seconds

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    const cause = (error as Error & { cause?: Error })?.cause
    const causeCode = (cause as Error & { code?: string })?.code

    // Network errors that are typically transient
    if (
      message.includes('fetch failed') ||
      message.includes('econnreset') ||
      message.includes('etimedout') ||
      message.includes('econnrefused') ||
      message.includes('socket hang up') ||
      causeCode === 'ECONNRESET' ||
      causeCode === 'ETIMEDOUT' ||
      causeCode === 'ECONNREFUSED'
    ) {
      return true
    }
  }
  return false
}

async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  context: string,
): Promise<T> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      if (attempt < MAX_RETRIES && isRetryableError(error)) {
        const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt) // Exponential backoff: 2s, 4s, 8s
        console.log(
          `[CosIng] ${context}: Network error (${lastError.message}), retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`,
        )
        await sleep(delay)
      } else {
        throw lastError
      }
    }
  }

  throw lastError
}

interface CosIngMetadata {
  inciName?: string[]
  casNo?: string[]
  ecNo?: string[]
  substanceId?: string[]
  chemicalDescription?: string[]
  functionName?: string[]
  itemType?: string[]
  cosmeticRestriction?: string[]
  otherRestrictions?: string[]
  status?: string[]
}

interface CosIngResult {
  reference: string
  metadata: CosIngMetadata
}

interface CosIngResponse {
  totalResults: number
  pageNumber: number
  pageSize: number
  sort: string | null
  results: CosIngResult[]
}

function buildQueryBody(searchTerm: string): string {
  return JSON.stringify({
    bool: {
      must: [
        {
          text: {
            query: searchTerm,
            fields: [
              'inciName.exact',
              'inciUsaName',
              'innName.exact',
              'phEurName',
              'chemicalName',
              'chemicalDescription',
            ],
            defaultOperator: 'AND',
          },
        },
        {
          terms: {
            itemType: ['ingredient', 'substance'],
          },
        },
      ],
    },
  })
}

async function fetchCosIngPage(searchTerm: string, pageNumber: number): Promise<CosIngResponse> {
  const url = `${COSING_API_URL}?apiKey=${COSING_API_KEY}&text=${encodeURIComponent(searchTerm)}&pageSize=${PAGE_SIZE}&pageNumber=${pageNumber}`

  const body = [
    `--${BOUNDARY}`,
    'Content-Disposition: form-data; name="query"; filename="blob"',
    'Content-Type: application/json',
    '',
    buildQueryBody(searchTerm),
    `--${BOUNDARY}--`,
    '',
  ].join('\r\n')

  return fetchWithRetry(async () => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': `multipart/form-data; boundary=${BOUNDARY}`,
        Origin: 'https://ec.europa.eu',
        Referer: 'https://ec.europa.eu/',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
      },
      body,
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`API error response: ${errorText.substring(0, 500)}`)
      throw new Error(`API request failed: ${response.status} ${response.statusText}`)
    }

    return (await response.json()) as CosIngResponse
  }, `term "${searchTerm}" page ${pageNumber}`)
}

async function processResult(
  result: CosIngResult,
  payload: Payload,
  stats: DiscoveryStats,
): Promise<void> {
  const meta = result.metadata
  const name = meta.inciName?.[0]

  if (!name) return

  stats.discovered++

  const casNumber = meta.casNo?.[0] && meta.casNo[0] !== '-' ? meta.casNo[0] : null
  const ecNumber = meta.ecNo?.[0] && meta.ecNo[0] !== '-' ? meta.ecNo[0] : null
  const cosIngId = meta.substanceId?.[0] || null
  const chemicalDescription = meta.chemicalDescription?.[0] || null
  const functions = meta.functionName?.filter(Boolean) || []
  const itemType = meta.itemType?.[0] as 'ingredient' | 'substance' | undefined
  const restrictions =
    [...(meta.cosmeticRestriction || []), ...(meta.otherRestrictions || [])]
      .filter(Boolean)
      .join('; ') || null

  const sourceUrl = cosIngId
    ? `https://ec.europa.eu/growth/tools-databases/cosing/details/${cosIngId}`
    : null

  const existing = await payload.find({
    collection: 'ingredients',
    where: { name: { equals: name } },
    limit: 1,
  })

  if (existing.docs.length === 0) {
    try {
      await payload.create({
        collection: 'ingredients',
        data: {
          name,
          casNumber,
          ecNumber,
          cosIngId,
          chemicalDescription,
          functions: functions.map((f) => ({ function: f })),
          itemType,
          restrictions,
          sourceUrl,
          status: 'pending',
        },
      })
      stats.created++
    } catch (createError: unknown) {
      // Handle race condition: parallel creates for same name
      const errorMessage = createError instanceof Error ? createError.message : String(createError)
      if (
        errorMessage.includes('name') ||
        errorMessage.includes('unique') ||
        errorMessage.includes('duplicate')
      ) {
        // Treat as existing (race condition with parallel processing)
        stats.existing++
      } else {
        console.error(`Failed to create ingredient "${name}":`, createError)
        stats.errors++
      }
    }
  } else {
    // Update if missing data
    const doc = existing.docs[0]
    const updates: Record<string, unknown> = {}

    if (!doc.casNumber && casNumber) updates.casNumber = casNumber
    if (!doc.ecNumber && ecNumber) updates.ecNumber = ecNumber
    if (!doc.cosIngId && cosIngId) updates.cosIngId = cosIngId
    if (!doc.chemicalDescription && chemicalDescription)
      updates.chemicalDescription = chemicalDescription
    if (!doc.sourceUrl && sourceUrl) updates.sourceUrl = sourceUrl
    if (!doc.itemType && itemType) updates.itemType = itemType
    if (!doc.restrictions && restrictions) updates.restrictions = restrictions
    if ((!doc.functions || doc.functions.length === 0) && functions.length > 0) {
      updates.functions = functions.map((f) => ({ function: f }))
    }

    if (Object.keys(updates).length > 0) {
      await payload.update({
        collection: 'ingredients',
        id: doc.id,
        data: updates,
      })
    }
    stats.existing++
  }
}

export const cosIngDriver: DiscoveryDriver = {
  matches(url: string): boolean {
    return url.includes('ec.europa.eu') && url.includes('cosing')
  },

  getInitialTermQueue(): string[] {
    return ['*']
  },

  async checkTerm(term: string): Promise<{ split: true; subTerms: string[] } | { split: false; totalPages: number }> {
    console.log(`[CosIng] Checking term "${term}"`)

    const firstPage = await fetchCosIngPage(term, 1)
    const totalResults = firstPage.totalResults
    const totalPages = Math.ceil(totalResults / PAGE_SIZE)

    console.log(`[CosIng] Term "${term}": ${totalResults} results, ${totalPages} pages`)

    if (totalResults === 0) {
      return { split: false, totalPages: 0 }
    }

    if (totalPages > MAX_PAGES) {
      console.log(`[CosIng] Term "${term}" exceeds ${MAX_PAGES} pages, splitting into sub-terms`)
      const subTerms = ALPHABET.map((letter) => term + letter)
      return { split: true, subTerms }
    }

    return { split: false, totalPages }
  },

  async processPage(term: string, page: number, payload: Payload): Promise<DiscoveryStats> {
    const stats: DiscoveryStats = { discovered: 0, created: 0, existing: 0, errors: 0 }

    console.log(`[CosIng] Processing term "${term}" page ${page}`)

    const pageData = await fetchCosIngPage(term, page)

    if (!pageData.results || pageData.results.length === 0) {
      console.log(`[CosIng] Term "${term}" page ${page}: empty results`)
      return stats
    }

    const firstResult = pageData.results[0]?.metadata?.inciName?.[0]
    const lastResult = pageData.results[pageData.results.length - 1]?.metadata?.inciName?.[0]
    console.log(
      `[CosIng] Term "${term}" page ${page}: ${pageData.results.length} results ("${firstResult}" ... "${lastResult}")`,
    )

    // Process results in parallel
    await Promise.all(pageData.results.map((result) => processResult(result, payload, stats)))

    console.log(
      `[CosIng] Term "${term}" page ${page}: created=${stats.created}, existing=${stats.existing}, errors=${stats.errors}`,
    )

    return stats
  },
}
