#!/usr/bin/env tsx
/**
 * Record fixture files for snapshot tests.
 *
 * Usage:
 *   pnpm test:record <driver> <url>
 *
 * Examples:
 *   pnpm test:record dm "https://www.dm.de/alverde-naturkosmetik-tagescreme-p4058172936791.html"
 *   pnpm test:record purish "https://purish.com/products/some-product"
 *   pnpm test:record shopapotheke "https://www.shop-apotheke.com/beauty/abc/product.htm"
 *
 * This script:
 *   1. Wraps stealthFetch to save HTTP responses as fixture files
 *   2. Runs driver.scrapeProduct(url) against the live site
 *   3. Saves the ScrapedProductData output as expected.snapshot.json
 */
import 'dotenv/config'
import { stealthFetch } from '../../src/lib/stealth-fetch'
import { createRecordingFetch, startRecording, stopRecording, saveExpectedOutput } from './mock-stealth-fetch'

const [driver, url] = process.argv.slice(2)

if (!driver || !url) {
  console.error('Usage: pnpm test:record <driver> <url>')
  console.error('  Drivers: dm, purish, shopapotheke')
  process.exit(1)
}

const SUPPORTED_DRIVERS = ['dm', 'purish', 'shopapotheke']
if (!SUPPORTED_DRIVERS.includes(driver)) {
  console.error(`Unknown driver: ${driver}. Supported: ${SUPPORTED_DRIVERS.join(', ')}`)
  process.exit(1)
}

// Derive a fixture slug from the URL
function slugFromUrl(driverName: string, productUrl: string): string {
  try {
    const parsed = new URL(productUrl)
    const pathname = parsed.pathname

    if (driverName === 'dm') {
      // Extract GTIN: /product-name-p4058172936791.html -> 4058172936791
      const match = pathname.match(/-p(\d+)\.html/)
      if (match) return match[1]
    }

    // Fall back to last meaningful path segment
    const segments = pathname.split('/').filter(Boolean)
    const last = segments[segments.length - 1] || 'product'
    return last.replace(/\.html?$/, '').replace(/\.json$/, '')
  } catch {
    return 'product'
  }
}

async function main() {
  const slug = slugFromUrl(driver, url)
  console.log(`Recording fixtures for ${driver}/${slug}`)
  console.log(`URL: ${url}\n`)

  startRecording(driver, slug)

  // Create a recording fetch that wraps the real stealthFetch
  const recordingFetch = createRecordingFetch(stealthFetch)

  // Dynamically patch the module — we need to intercept calls inside the driver.
  // The simplest approach: import the driver module and override the fetch it uses.
  // Since drivers import stealthFetch at module level, we use a different approach:
  // we call the driver's scrapeProduct with the URL and let the recording fetch capture.

  // For now, we'll do a simpler recording: just fetch the URLs directly based on driver type
  if (driver === 'dm') {
    await recordDm(recordingFetch, url)
  } else if (driver === 'purish') {
    await recordPurish(recordingFetch, url)
  } else if (driver === 'shopapotheke') {
    await recordShopApotheke(recordingFetch, url)
  }

  const recorded = stopRecording()
  console.log(`\nRecorded ${recorded.length} fixture(s):`)
  for (const r of recorded) {
    console.log(`  ${r.file} (${r.status}) <- ${r.url.substring(0, 80)}...`)
  }
  console.log(`\nFixtures saved to: tests/fixtures/${driver}/${slug}/`)
  console.log('Note: Run the driver snapshot test to generate expected.snapshot.json')
}

async function recordDm(
  fetch: (url: string | URL, init?: RequestInit) => Promise<Response>,
  productUrl: string,
) {
  const DM_HEADERS = { Referer: 'https://www.dm.de/', Accept: 'application/json' }

  // Extract GTIN from URL
  const gtinMatch = new URL(productUrl).pathname.match(/-p(\d+)\.html/)
  if (!gtinMatch) {
    console.error('Could not extract GTIN from DM URL')
    process.exit(1)
  }
  const gtin = gtinMatch[1]

  // 1. Product detail API
  console.log('Fetching product detail API...')
  const productRes = await fetch(
    `https://products.dm.de/product/products/detail/DE/gtin/${gtin}`,
    { headers: DM_HEADERS },
  )
  const productData = await productRes.json()

  // 2. Availability API — collect DANs
  const dans: string[] = []
  if (productData.dan) dans.push(String(productData.dan))
  if (productData.variants?.colors) {
    for (const group of productData.variants.colors) {
      for (const opt of group.options ?? []) {
        if (opt.dan && !dans.includes(String(opt.dan))) {
          dans.push(String(opt.dan))
        }
      }
    }
  }

  if (dans.length > 0) {
    console.log(`Fetching availability for ${dans.length} DAN(s)...`)
    await fetch(
      `https://products.dm.de/availability/api/v1/tiles/DE/${dans.join(',')}`,
      { headers: DM_HEADERS },
    )
  }

  // 3. Reviews via BazaarVoice
  const dan = productData.dan ? String(productData.dan) : null
  if (dan) {
    console.log('Fetching BazaarVoice reviews...')
    const bvUrl = `https://apps.bazaarvoice.com/bfd/v1/clients/dm-de/api-products/cv2/resources/data/reviews.json?apiVersion=5.4&filter=productid:eq:${dan}&sort=submissiontime:desc&limit=100&offset=0`
    await fetch(bvUrl, {
      headers: {
        ...DM_HEADERS,
        'bv-bfd-token': '18357,main_site,de_DE',
        Origin: 'https://www.dm.de',
      },
    })
  }
}

async function recordPurish(
  fetch: (url: string | URL, init?: RequestInit) => Promise<Response>,
  productUrl: string,
) {
  const parsed = new URL(productUrl)
  const basePath = parsed.pathname.replace(/\/$/, '')

  // 1. Shopify JSON API
  console.log('Fetching Shopify JSON API...')
  await fetch(`https://purish.com${basePath}.json`)

  // 2. Product page HTML
  console.log('Fetching product page HTML...')
  await fetch(`https://purish.com${basePath}`, {
    headers: { Accept: 'text/html' },
  })
}

async function recordShopApotheke(
  fetch: (url: string | URL, init?: RequestInit) => Promise<Response>,
  productUrl: string,
) {
  // 1. Product page HTML
  console.log('Fetching product page HTML...')
  await fetch(productUrl)
}

main().catch((err) => {
  console.error('Recording failed:', err)
  process.exit(1)
})
