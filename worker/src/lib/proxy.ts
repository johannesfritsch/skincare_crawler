import { createLogger } from '@/lib/logger'

const log = createLogger('Proxy')

export interface ProxyConfig {
  url: string
  username: string
  password: string
}

let cachedConfig: ProxyConfig | null | undefined

/** Returns proxy config if PROXY_URL is set, null otherwise. */
export function getProxyConfig(): ProxyConfig | null {
  if (cachedConfig !== undefined) return cachedConfig

  const url = process.env.PROXY_URL
  if (!url) {
    cachedConfig = null
    log.info('Proxy disabled (PROXY_URL not set)')
    return null
  }

  const username = process.env.PROXY_USERNAME
  const password = process.env.PROXY_PASSWORD
  if (!username || !password) {
    throw new Error('PROXY_URL is set but PROXY_USERNAME and/or PROXY_PASSWORD are missing')
  }

  cachedConfig = { url, username, password }
  log.info(`Proxy enabled (${new URL(url).host})`)
  return cachedConfig
}

/** Returns Playwright-compatible proxy object, or undefined when proxy is disabled. */
export function getPlaywrightProxy():
  | { server: string; username: string; password: string }
  | undefined {
  const config = getProxyConfig()
  if (!config) return undefined
  return { server: config.url, username: config.username, password: config.password }
}
