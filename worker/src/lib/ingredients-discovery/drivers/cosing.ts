import type { DiscoveryDriver, ScrapedIngredientData } from '../types'

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

/** Parse a CosIng API result into pure data (no DB) */
function parseResult(result: CosIngResult): ScrapedIngredientData | null {
  const meta = result.metadata
  const name = meta.inciName?.[0]
  if (!name) return null

  const casNumber = meta.casNo?.[0] && meta.casNo[0] !== '-' ? meta.casNo[0] : undefined
  const ecNumber = meta.ecNo?.[0] && meta.ecNo[0] !== '-' ? meta.ecNo[0] : undefined
  const cosIngId = meta.substanceId?.[0] || undefined
  const chemicalDescription = meta.chemicalDescription?.[0] || undefined
  const functions = meta.functionName?.filter(Boolean) || []
  const itemType = meta.itemType?.[0] as 'ingredient' | 'substance' | undefined
  const restrictions =
    [...(meta.cosmeticRestriction || []), ...(meta.otherRestrictions || [])]
      .filter(Boolean)
      .join('; ') || undefined

  const sourceUrl = cosIngId
    ? `https://ec.europa.eu/growth/tools-databases/cosing/details/${cosIngId}`
    : undefined

  return { name, casNumber, ecNumber, cosIngId, chemicalDescription, functions, itemType, restrictions, sourceUrl }
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

  async fetchPage(term: string, page: number): Promise<ScrapedIngredientData[]> {
    console.log(`[CosIng] Fetching term "${term}" page ${page}`)

    const pageData = await fetchCosIngPage(term, page)

    if (!pageData.results || pageData.results.length === 0) {
      console.log(`[CosIng] Term "${term}" page ${page}: empty results`)
      return []
    }

    const ingredients: ScrapedIngredientData[] = []
    for (const result of pageData.results) {
      const parsed = parseResult(result)
      if (parsed) ingredients.push(parsed)
    }

    console.log(`[CosIng] Term "${term}" page ${page}: ${ingredients.length} ingredients parsed from ${pageData.results.length} results`)
    return ingredients
  },
}
