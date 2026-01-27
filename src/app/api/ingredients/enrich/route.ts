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
    const results: { ingredientId: number; success: boolean; error?: string; name?: string }[] = []

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

          await page.goto(sourceUrl, { waitUntil: 'networkidle' })
          await page.waitForSelector('h1', { timeout: 10000 }).catch(() => null)

          const pageData = await page.evaluate(() => {
            const h1 = document.querySelector('h1')
            const canonicalName = h1?.textContent?.trim() || null

            // Look for description in the page content
            const descriptionEl =
              document.querySelector('.ingredient-description') ||
              document.querySelector('[class*="description"]') ||
              document.querySelector('.content-section p')
            const description = descriptionEl?.textContent?.trim() || null

            return { canonicalName, description }
          })

          if (!pageData.canonicalName) {
            results.push({
              ingredientId,
              success: false,
              error: `Could not extract name from ${sourceUrl}`,
            })
            continue
          }

          await payload.update({
            collection: 'ingredients',
            id: ingredientId,
            data: {
              name: pageData.canonicalName,
              description: pageData.description,
              sourceUrl,
              crawledAt: new Date().toISOString(),
            },
          })

          results.push({ ingredientId, success: true, name: pageData.canonicalName })
        } catch (err) {
          results.push({
            ingredientId,
            success: false,
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
      'Crawls SpecialChem INCI pages to get canonical ingredient names and descriptions. Updates ingredient name, description, sourceUrl, and crawledAt.',
  })
}
