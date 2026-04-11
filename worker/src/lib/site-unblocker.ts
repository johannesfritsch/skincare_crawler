/**
 * Decodo Site Unblocker — fetches URLs through a proxy that handles
 * Akamai/Cloudflare/DataDome bot detection on their end.
 *
 * Returns fully rendered HTML (JS-executed) when X-SU-Render: html is set.
 *
 * Env vars:
 *   SITE_UNBLOCKER_USERNAME — Decodo credentials (e.g. U0000389504)
 *   SITE_UNBLOCKER_PASSWORD — Decodo credentials (e.g. PW_...)
 */

import { ProxyAgent } from 'undici'
import { createLogger } from '@/lib/logger'

const log = createLogger('SiteUnblocker')

const PROXY_URL = 'https://unblock.decodo.com:60000'

interface SiteUnblockerConfig {
  username: string
  password: string
}

let cachedConfig: SiteUnblockerConfig | null | undefined

function getConfig(): SiteUnblockerConfig | null {
  if (cachedConfig !== undefined) return cachedConfig

  const username = process.env.SITE_UNBLOCKER_USERNAME
  const password = process.env.SITE_UNBLOCKER_PASSWORD
  if (!username || !password) {
    cachedConfig = null
    log.info('Site Unblocker disabled (SITE_UNBLOCKER_USERNAME/PASSWORD not set)')
    return null
  }

  cachedConfig = { username, password }
  log.info('Site Unblocker enabled')
  return cachedConfig
}

/** Check if the Site Unblocker is configured. */
export function isSiteUnblockerAvailable(): boolean {
  return getConfig() !== null
}

/**
 * Fetch a URL through the Decodo Site Unblocker.
 * Returns the response body as a string.
 * Throws on failure (non-2xx or unblocker error).
 */
export async function siteUnblockerFetch(
  url: string,
  options?: {
    render?: boolean  // Request JS-rendered HTML (default: true)
    geo?: string      // Geo target (default: 'Germany')
    locale?: string   // Locale (default: 'de-de')
    retries?: number  // Number of retries on 613 errors (default: 3)
  },
): Promise<{ body: string; status: number }> {
  const config = getConfig()
  if (!config) {
    throw new Error('Site Unblocker not configured — set SITE_UNBLOCKER_USERNAME and SITE_UNBLOCKER_PASSWORD')
  }

  const render = options?.render ?? true
  const geo = options?.geo ?? 'Germany'
  const locale = options?.locale ?? 'de-de'
  const maxRetries = options?.retries ?? 3

  const dispatcher = new ProxyAgent({
    uri: PROXY_URL,
    token: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`,
    requestTls: { rejectUnauthorized: false }, // Decodo uses self-signed cert for the proxy
  })

  const headers: Record<string, string> = {
    'X-SU-Geo': geo,
    'X-SU-Locale': locale,
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  }
  if (render) {
    headers['X-SU-Render'] = 'html'
  }

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const startMs = Date.now()
    try {
      const res = await fetch(url, { headers, dispatcher } as any)
      const body = await res.text()
      const durationMs = Date.now() - startMs

      // Check for unblocker error responses (JSON with status: "failed")
      if (body.startsWith('{"status":"failed"')) {
        const err = JSON.parse(body) as { status_code: number; message: string }
        if (attempt <= maxRetries) {
          log.warn('Site Unblocker failed, retrying', { url: url.slice(0, 100), statusCode: err.status_code, attempt, maxRetries, durationMs })
          await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000))
          continue
        }
        log.warn('Site Unblocker failed, no more retries', { url: url.slice(0, 100), statusCode: err.status_code, message: err.message, durationMs })
        throw new Error(`Site Unblocker error ${err.status_code}: ${err.message}`)
      }

      log.debug('Site Unblocker fetch', { url: url.slice(0, 100), status: res.status, durationMs, bodyLength: body.length, attempt })
      return { body, status: res.status }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('Site Unblocker error')) throw e
      const durationMs = Date.now() - startMs
      if (attempt <= maxRetries) {
        log.warn('Site Unblocker request failed, retrying', { url: url.slice(0, 100), error: e instanceof Error ? e.message : String(e), attempt, durationMs })
        await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000))
        continue
      }
      log.error('Site Unblocker fetch failed', { url: url.slice(0, 100), error: e instanceof Error ? e.message : String(e), durationMs })
      throw e
    }
  }
  throw new Error('Site Unblocker: unreachable')
}
