import { chromium } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import type { Browser } from 'playwright-core'

// Register stealth plugin once at module level — patches navigator.webdriver,
// chrome runtime, plugins, webgl, permissions, and other fingerprinting vectors.
chromium.use(StealthPlugin())

interface BrowserOptions {
  headless?: boolean
}

export async function launchBrowser(options: BrowserOptions = {}): Promise<Browser> {
  const headless = options.headless ?? true

  return chromium.launch({
    channel: 'chrome',
    headless,
  })
}
