import fs from 'fs'
import { chromium } from 'playwright-extra'
import { chromium as playwrightChromium } from 'playwright-core'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import type { Browser } from 'playwright-core'
import { getPlaywrightProxy } from '@/lib/proxy'
import { createLogger } from '@/lib/logger'

const log = createLogger('Browser')

// Register stealth plugin once at module level — patches navigator.webdriver,
// chrome runtime, plugins, webgl, permissions, and other fingerprinting vectors.
chromium.use(StealthPlugin())

interface BrowserOptions {
  headless?: boolean
}

export async function launchBrowser(options: BrowserOptions = {}): Promise<Browser> {
  const headless = options.headless ?? true
  const proxy = getPlaywrightProxy()

  // Use Playwright's bundled Chromium (installed via `npx playwright install chromium`).
  // Falls back to system Chrome/Chromium if the bundled browser isn't available.
  const bundledPath = (() => {
    try { return playwrightChromium.executablePath() } catch { return null }
  })()

  const executablePath = [
    bundledPath,                                                              // Playwright's bundled Chromium
    '/opt/google/chrome/chrome',                                              // Linux Chrome
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',           // macOS Chrome
    '/usr/bin/chromium',                                                      // Arch/Fedora Chromium
  ].filter(Boolean).find((p) => {
    try { return fs.existsSync(p!) } catch { return false }
  })

  log.debug('launching browser', { headless, proxy: !!proxy, executablePath })
  const browser = await chromium.launch({
    ...(executablePath ? { executablePath } : { channel: 'chrome' }),
    headless,
    ...(proxy && { proxy }),
  })
  log.debug('browser launched')
  return browser
}
