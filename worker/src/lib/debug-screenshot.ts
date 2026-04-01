import type { Page } from 'playwright-core'
import type { PayloadRestClient } from '@/lib/payload-client'
import { createLogger } from '@/lib/logger'

const log = createLogger('DebugScreenshot')

type JobCollection = 'product-crawls' | 'product-discoveries' | 'product-searches'

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
 * Only call this when debug mode is enabled — the caller is responsible for checking.
 */
export async function captureDebugScreenshot(opts: DebugScreenshotOptions): Promise<void> {
  const { page, client, jobCollection, jobId, step, label } = opts
  const pageUrl = page.url()

  try {
    const buffer = await page.screenshot({ fullPage: true, type: 'png' })
    const alt = label ?? `${step} — ${pageUrl}`

    await client.create({
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

    log.debug('Screenshot captured', { jobCollection, jobId, step, url: pageUrl })
  } catch (e) {
    log.warn('Failed to capture debug screenshot', { step, error: e instanceof Error ? e.message : String(e) })
  }
}
