import type { Browser } from 'playwright-core'
import { Camoufox } from 'camoufox-js'
import { getPlaywrightProxy } from '@/lib/proxy'
import { createLogger } from '@/lib/logger'

const log = createLogger('Browser')

export async function launchBrowser(): Promise<Browser> {
  const proxy = getPlaywrightProxy()
  log.debug('launching camoufox', { proxy: !!proxy })

  const browser = await Camoufox({
    proxy: proxy ? { server: proxy.server, username: proxy.username, password: proxy.password } : undefined,
    locale: ['de-DE'],
    headless: 'virtual',
  })

  log.debug('camoufox launched')
  return browser as unknown as Browser
}
