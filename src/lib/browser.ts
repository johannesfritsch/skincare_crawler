import chromium from '@sparticuz/chromium'
import { chromium as pwChromium, type Browser } from 'playwright-core'

export async function launchBrowser(): Promise<Browser> {
  const isVercel = !!process.env.VERCEL

  if (isVercel) {
    const executablePath = await chromium.executablePath()
    return pwChromium.launch({
      args: chromium.args,
      executablePath,
      headless: true,
    })
  } else {
    return pwChromium.launch({
      channel: 'chrome',
      headless: true,
    })
  }
}
