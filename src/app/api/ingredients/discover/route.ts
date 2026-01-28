import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { launchBrowser } from '@/lib/browser'

export const runtime = 'nodejs'
export const maxDuration = 300

const SPECIALCHEM_INCI_URL = 'https://www.specialchem.com/cosmetics/all-inci-ingredients'

export const POST = async () => {
  try {
    const payload = await getPayload({ config: configPromise })
    const browser = await launchBrowser()

    let ingredientNames: string[] = []

    try {
      const context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 },
      })
      const page = await context.newPage()

      await page.goto(SPECIALCHEM_INCI_URL, { waitUntil: 'networkidle' })

      // Check for Cloudflare block
      const isBlocked = await page.evaluate(() => {
        const h1 = document.querySelector('h1')?.textContent?.toLowerCase() || ''
        const title = document.title.toLowerCase()
        return h1.includes('blocked') || h1.includes('sorry') || title.includes('cloudflare')
      })

      if (isBlocked) {
        return Response.json(
          { success: false, error: 'Blocked by Cloudflare. Try again later.' },
          { status: 503 },
        )
      }

      // Wait for the page content to load
      await page.waitForSelector('select', { timeout: 10000 }).catch(() => null)

      // Inject a 10000 option into the per-page select and select it
      await page.evaluate(() => {
        // Find the per-page select (usually has options like 10, 20, 30)
        const selects = document.querySelectorAll('select')
        for (const select of selects) {
          const options = Array.from(select.options)
          const hasPageSizeOptions = options.some(
            (o) => o.value === '10' || o.value === '20' || o.value === '30',
          )
          if (hasPageSizeOptions) {
            // Add 10000 option
            const newOption = document.createElement('option')
            newOption.value = '10000'
            newOption.text = '10000'
            select.appendChild(newOption)
            // Select it
            select.value = '10000'
            // Trigger change event
            select.dispatchEvent(new Event('change', { bubbles: true }))
            break
          }
        }
      })

      // Wait for the page to reload/update with all ingredients
      await page.waitForTimeout(3000)
      await page.waitForLoadState('networkidle')

      // Extract all ingredient names from the page
      ingredientNames = await page.evaluate(() => {
        const names: string[] = []
        // Find all links to ingredient pages
        const links = document.querySelectorAll('a[href*="/inci-ingredients/"]')
        links.forEach((link) => {
          const text = link.textContent?.trim()
          if (text && text.length > 0 && !text.includes('/')) {
            // Avoid duplicates and path-like text
            if (!names.includes(text)) {
              names.push(text)
            }
          }
        })
        return names
      })

      if (ingredientNames.length === 0) {
        // Try alternative extraction - maybe ingredients are in a table or list
        ingredientNames = await page.evaluate(() => {
          const names: string[] = []
          // Try table cells
          const cells = document.querySelectorAll('td a, li a')
          cells.forEach((link) => {
            const href = link.getAttribute('href') || ''
            if (href.includes('/inci-ingredients/')) {
              const text = link.textContent?.trim()
              if (text && text.length > 0 && !names.includes(text)) {
                names.push(text)
              }
            }
          })
          return names
        })
      }
    } finally {
      await browser.close()
    }

    if (ingredientNames.length === 0) {
      return Response.json(
        { success: false, error: 'No ingredients found on page' },
        { status: 404 },
      )
    }

    // Upsert ingredients
    let created = 0
    let existing = 0

    for (const name of ingredientNames) {
      const found = await payload.find({
        collection: 'ingredients',
        where: { name: { equals: name } },
        limit: 1,
      })

      if (found.docs.length === 0) {
        await (payload.create as any)({
          collection: 'ingredients',
          data: {
            name,
            status: 'pending',
          },
        })
        created++
      } else {
        existing++
      }
    }

    return Response.json({
      success: true,
      discovered: ingredientNames.length,
      created,
      existing,
    })
  } catch (error) {
    console.error('Ingredient discovery error:', error)
    return Response.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}

export const GET = async () => {
  return Response.json({
    message: 'Ingredient Discovery API',
    usage: 'POST /api/ingredients/discover',
    description:
      'Discovers all INCI ingredient names from SpecialChem and upserts them as pending ingredients. Does not deeply crawl individual ingredient pages.',
  })
}
