/**
 * stealthFetch mock for snapshot tests.
 *
 * Records or replays HTTP responses based on URL pattern matching.
 * Each driver defines its own URL-to-fixture-file mapping.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = path.resolve(__dirname, '..', 'fixtures')

// Current fixture directory (set per test)
let currentFixtureDir = ''
let currentDriver = ''

// URL pattern -> fixture filename mappings per driver
const URL_PATTERNS: Record<string, Array<{ pattern: RegExp; file: string; contentType: string }>> = {
  dm: [
    { pattern: /products\.dm\.de\/product\/products\/detail/, file: 'product-api.json', contentType: 'application/json' },
    { pattern: /products\.dm\.de\/availability/, file: 'availability.json', contentType: 'application/json' },
    { pattern: /bazaarvoice\.com/, file: 'reviews.json', contentType: 'application/json' },
  ],
  purish: [
    { pattern: /purish\.com\/products\/[^?]+\.json/, file: 'product.json', contentType: 'application/json' },
    { pattern: /purish\.com\/products\//, file: 'product-page.html', contentType: 'text/html' },
  ],
  shopapotheke: [
    { pattern: /shop-apotheke\.com/, file: 'product-page.html', contentType: 'text/html' },
  ],
}

/**
 * Set the fixture directory and driver for the current test.
 * Call this at the start of each test case.
 */
export function setFixture(driver: string, fixtureSlug: string): void {
  currentDriver = driver
  currentFixtureDir = path.join(FIXTURES_DIR, driver, fixtureSlug)
}

/**
 * Mock implementation of stealthFetch that reads from fixture files.
 */
export async function mockStealthFetch(url: string | URL, _init?: RequestInit): Promise<Response> {
  const urlStr = typeof url === 'string' ? url : url.toString()
  const patterns = URL_PATTERNS[currentDriver]
  if (!patterns) {
    throw new Error(`mockStealthFetch: unknown driver "${currentDriver}". Call setFixture() first.`)
  }

  for (const { pattern, file, contentType } of patterns) {
    if (pattern.test(urlStr)) {
      const fixturePath = path.join(currentFixtureDir, file)
      if (!existsSync(fixturePath)) {
        // Return 404-like response for missing optional fixtures (e.g. reviews)
        return new Response('Not found', { status: 404, statusText: 'Not Found' })
      }
      const body = readFileSync(fixturePath, 'utf-8')
      return new Response(body, {
        status: 200,
        statusText: 'OK',
        headers: { 'Content-Type': contentType },
      })
    }
  }

  throw new Error(`mockStealthFetch: no fixture pattern matched URL: ${urlStr}`)
}

// ─── Recording Mode ──────────────────────────────────────────────────────────

interface RecordedResponse {
  url: string
  file: string
  status: number
}

let recording = false
let recordedResponses: RecordedResponse[] = []

/**
 * Start recording mode — intercepts real stealthFetch and saves responses.
 */
export function startRecording(driver: string, fixtureSlug: string): void {
  currentDriver = driver
  currentFixtureDir = path.join(FIXTURES_DIR, driver, fixtureSlug)
  mkdirSync(currentFixtureDir, { recursive: true })
  recording = true
  recordedResponses = []
}

/**
 * Wraps a real stealthFetch to record responses to fixture files.
 */
export function createRecordingFetch(
  realFetch: (url: string | URL, init?: RequestInit) => Promise<Response>,
): (url: string | URL, init?: RequestInit) => Promise<Response> {
  return async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof url === 'string' ? url : url.toString()
    const res = await realFetch(url, init)

    if (!recording) return res

    const patterns = URL_PATTERNS[currentDriver]
    if (!patterns) return res

    for (const { pattern, file } of patterns) {
      if (pattern.test(urlStr)) {
        const body = await res.clone().text()
        const fixturePath = path.join(currentFixtureDir, file)
        writeFileSync(fixturePath, body, 'utf-8')
        recordedResponses.push({ url: urlStr, file, status: res.status })
        break
      }
    }

    return res
  }
}

export function stopRecording(): RecordedResponse[] {
  recording = false
  return recordedResponses
}

export function saveExpectedOutput(data: unknown): void {
  const outputPath = path.join(currentFixtureDir, 'expected.snapshot.json')
  writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8')
}
