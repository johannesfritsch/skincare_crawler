import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { launchBrowser } from '@/lib/browser'

export const runtime = 'nodejs'
export const maxDuration = 300

function slugifyIngredient(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\s,/]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export const POST = async (request: Request) => {
  try {
    const payload = await getPayload({ config: configPromise })
    const body = await request.json().catch(() => ({}))
    const { ingredientIds } = body as { ingredientIds?: number[] }

    if (!ingredientIds || !Array.isArray(ingredientIds) || ingredientIds.length === 0) {
      return Response.json(
        { success: false, error: 'ingredientIds array is required' },
        { status: 400 },
      )
    }

    const browser = await launchBrowser()
    const results: {
      ingredientId: number
      success: boolean
      status?: string
      error?: string
      name?: string
    }[] = []

    try {
      const context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 },
      })
      const page = await context.newPage()

      for (let i = 0; i < ingredientIds.length; i++) {
        if (i > 0) await page.waitForTimeout(1000)
        const ingredientId = ingredientIds[i]
        try {
          const ingredient = await payload
            .findByID({
              collection: 'ingredients',
              id: ingredientId,
            })
            .catch(() => null)

          if (!ingredient) {
            results.push({ ingredientId, success: false, error: 'Ingredient not found' })
            continue
          }

          const slug = slugifyIngredient(ingredient.name)
          const sourceUrl = `https://www.specialchem.com/cosmetics/inci-ingredients/${slug}`

          const response = await page.goto(sourceUrl, { waitUntil: 'networkidle' })
          await page.waitForSelector('h1', { timeout: 10000 }).catch(() => null)

          const pageData = await page.evaluate(() => {
            const h1 = document.querySelector('h1')
            const h1Text = h1?.textContent?.trim() || ''
            const title = document.title
            const bodyText = document.body.innerText || ''

            // Detect blocked by Cloudflare
            const isBlocked =
              h1Text.toLowerCase().includes('sorry') ||
              h1Text.toLowerCase().includes('blocked') ||
              title.toLowerCase().includes('cloudflare') ||
              title.toLowerCase().includes('attention required')

            // Detect not found
            const isNotFound =
              title.toLowerCase().includes('404') ||
              h1Text.toLowerCase().includes('not found') ||
              h1Text.toLowerCase().includes('page not found') ||
              bodyText.toLowerCase().includes('the page you are looking for') ||
              bodyText.toLowerCase().includes('ingredient not found')

            if (isBlocked || isNotFound) {
              return { isBlocked, isNotFound, canonicalName: null, description: null }
            }

            // Extract description from the page
            const descriptionEl =
              document.querySelector('.ingredient-description') ||
              document.querySelector('[class*="description"]') ||
              document.querySelector('.content-section p')
            const description = descriptionEl?.textContent?.trim() || null

            return { isBlocked: false, isNotFound: false, canonicalName: h1Text || null, description }
          })

          const httpStatus = response?.status() ?? 0

          // Handle blocked
          if (pageData.isBlocked) {
            await payload.update({
              collection: 'ingredients',
              id: ingredientId,
              data: {
                status: 'crawl_failed',
                sourceUrl,
                crawledAt: new Date().toISOString(),
              },
            })
            results.push({
              ingredientId,
              success: false,
              status: 'crawl_failed',
              error: 'Blocked by Cloudflare',
            })
            continue
          }

          // Handle not found (including HTTP 404)
          if (pageData.isNotFound || httpStatus === 404) {
            await payload.update({
              collection: 'ingredients',
              id: ingredientId,
              data: {
                status: 'crawl_not_found',
                sourceUrl,
                crawledAt: new Date().toISOString(),
              },
            })
            results.push({
              ingredientId,
              success: false,
              status: 'crawl_not_found',
              error: 'Ingredient not found on SpecialChem',
            })
            continue
          }

          // Handle missing name
          if (!pageData.canonicalName) {
            await payload.update({
              collection: 'ingredients',
              id: ingredientId,
              data: {
                status: 'crawl_failed',
                sourceUrl,
                crawledAt: new Date().toISOString(),
              },
            })
            results.push({
              ingredientId,
              success: false,
              status: 'crawl_failed',
              error: `Could not extract name from ${sourceUrl}`,
            })
            continue
          }

          // Success
          await payload.update({
            collection: 'ingredients',
            id: ingredientId,
            data: {
              name: pageData.canonicalName,
              description: pageData.description,
              sourceUrl,
              status: 'crawled',
              crawledAt: new Date().toISOString(),
            },
          })

          results.push({
            ingredientId,
            success: true,
            status: 'crawled',
            name: pageData.canonicalName,
          })
        } catch (err) {
          // Update status on unexpected errors
          await payload
            .update({
              collection: 'ingredients',
              id: ingredientId,
              data: {
                status: 'crawl_failed',
                crawledAt: new Date().toISOString(),
              },
            })
            .catch(() => null)

          results.push({
            ingredientId,
            success: false,
            status: 'crawl_failed',
            error: err instanceof Error ? err.message : 'Unknown error',
          })
        }
      }
    } finally {
      await browser.close()
    }

    return Response.json({
      success: true,
      processed: results.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    })
  } catch (error) {
    console.error('Ingredient enrichment error:', error)
    return Response.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}

export const GET = async () => {
  return Response.json({
    message: 'Ingredient Enrichment API',
    usage: 'POST /api/ingredients/enrich',
    body: {
      ingredientIds: 'Required. Array of Ingredient IDs to enrich from SpecialChem.',
    },
    description:
      'Crawls SpecialChem INCI pages to get canonical ingredient names and descriptions. Sets status to crawled, crawl_failed, or crawl_not_found.',
  })
}
