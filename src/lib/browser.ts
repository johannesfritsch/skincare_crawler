import chromium from '@sparticuz/chromium'
import { chromium as pwChromium, type Browser } from 'playwright-core'

interface BrowserOptions {
  headless?: boolean
}

export async function launchBrowser(options: BrowserOptions = {}): Promise<Browser> {
  const isVercel = !!process.env.VERCEL
  const headless = options.headless ?? true

  if (isVercel) {
    const executablePath = await chromium.executablePath()
    return pwChromium.launch({
      args: chromium.args,
      executablePath,
      headless: true, // Always headless on Vercel
    })
  } else {
    return pwChromium.launch({
      channel: 'chrome',
      headless,
    })
  }
}
