import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { launchBrowser } from '@/lib/browser'

export const runtime = 'nodejs'
export const maxDuration = 300

const SPECIALCHEM_INCI_URL = 'https://www.specialchem.com/cosmetics/all-inci-ingredients'

export const POST = async () => {
  try {
    const payload = await getPayload({ config: configPromise })
    const browser = await launchBrowser({ headless: false })

    let ingredientNames: string[] = []

    try {
      const context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 },
      })
      const page = await context.newPage()

      // First request: load the page
      console.log('Loading SpecialChem INCI page...')
      await page.goto(SPECIALCHEM_INCI_URL, { waitUntil: 'networkidle' })
      await page.waitForTimeout(2000) // Pause to see the page

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

      // Wait for the select to be available
      await page.waitForSelector('select', { timeout: 10000 })

      // Find the per-page select and get its selector
      const selectSelector = await page.evaluate(() => {
        const selects = document.querySelectorAll('select')
        for (let i = 0; i < selects.length; i++) {
          const select = selects[i]
          const options = Array.from(select.options)
          const hasPageSizeOptions = options.some(
            (o) => o.value === '10' || o.value === '20' || o.value === '30',
          )
          if (hasPageSizeOptions) {
            // Add an ID if it doesn't have one so we can select it
            if (!select.id) {
              select.id = '__perPageSelect'
            }
            return `#${select.id}`
          }
        }
        return null
      })

      if (!selectSelector) {
        return Response.json(
          { success: false, error: 'Could not find per-page select on page' },
          { status: 404 },
        )
      }

      // Inject 10000 option into the select
      console.log('Injecting 10000 option into select...')
      await page.evaluate((selector) => {
        const select = document.querySelector(selector) as HTMLSelectElement
        if (select) {
          const newOption = document.createElement('option')
          newOption.value = '10000'
          newOption.text = '10000'
          select.appendChild(newOption)
        }
      }, selectSelector)
      await page.waitForTimeout(1000) // Pause to see the injected option

      // Second request: select the 10000 value and wait for navigation
      console.log('Selecting 10000 items per page and waiting for reload...')
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle', timeout: 60000 }),
        page.selectOption(selectSelector, '10000'),
      ])

      // Wait a bit more for any dynamic content
      await page.waitForTimeout(2000)

      // Extract all ingredient names from the page
      console.log('Extracting ingredient names...')
      ingredientNames = await page.evaluate(() => {
        const names: string[] = []
        // Find all links to ingredient pages
        const links = document.querySelectorAll('a[href*="/inci-ingredients/"]')
        links.forEach((link) => {
          const href = link.getAttribute('href') || ''
          // Skip the main directory link itself
          if (href === '/cosmetics/all-inci-ingredients' || href.endsWith('/all-inci-ingredients')) {
            return
          }
          const text = link.textContent?.trim()
          if (text && text.length > 0 && !text.includes('/') && !names.includes(text)) {
            names.push(text)
          }
        })
        return names
      })

      console.log(`Found ${ingredientNames.length} ingredients`)
      await page.waitForTimeout(3000) // Pause to see the results before closing
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

    console.log('Upserting ingredients...')
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

    console.log(`Created ${created}, ${existing} already existed`)

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
