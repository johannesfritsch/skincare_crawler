import type { Page } from 'playwright-core'
import type { PayloadRestClient } from '@/lib/payload-client'
import { createLogger } from '@/lib/logger'

const log = createLogger('DebugScreenshot')

type JobCollection = 'product-crawls' | 'product-discoveries' | 'product-searches' | 'bot-checks'

interface DebugScreenshotOptions {
  page: Page
  client: PayloadRestClient
  jobCollection: JobCollection
  jobId: number
  step: string
  label?: string
}

/**
 * Capture a full-page screenshot and upload it to the debug-screenshots collection.
 * Returns the screenshot URL on success, or null on failure.
 */
export async function captureDebugScreenshot(opts: DebugScreenshotOptions): Promise<string | null> {
  const { page, client, jobCollection, jobId, step, label } = opts
  const pageUrl = page.url()

  try {
    const buffer = await page.screenshot({ fullPage: true, type: 'png' })
    const alt = label ?? `${step} — ${pageUrl}`

    const doc = await client.create({
      collection: 'debug-screenshots',
      data: {
        alt,
        job: { relationTo: jobCollection, value: jobId },
        step,
        url: pageUrl,
      },
      file: {
        data: Buffer.from(buffer),
        mimetype: 'image/png',
        name: `debug-${jobId}-${step}-${Date.now()}.png`,
        size: buffer.byteLength,
      },
    })

    const screenshotUrl = (doc as Record<string, unknown>).url as string | undefined
    log.debug('Screenshot captured', { jobCollection, jobId, step, url: pageUrl, screenshotUrl })
    return screenshotUrl ?? null
  } catch (e) {
    log.warn('Failed to capture debug screenshot', { step, error: e instanceof Error ? e.message : String(e) })
    return null
  }
}
