import { ProxyAgent } from 'undici'
import { getProxyConfig } from '@/lib/proxy'
import { createLogger } from '@/lib/logger'

const log = createLogger('stealthFetch')

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
]

// Pick once per process so all requests in a session look consistent
const sessionUserAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]

// Extract Chrome major version from session UA for sec-ch-ua header
const chromeVersion = sessionUserAgent.match(/Chrome\/([\d]+)/)?.[1] ?? '131'
const secChUa = `"Not(A:Brand";v="8", "Chromium";v="${chromeVersion}", "Google Chrome";v="${chromeVersion}"`

// Create a reusable ProxyAgent when proxy is configured
const proxyConfig = getProxyConfig()
const dispatcher = proxyConfig
  ? new ProxyAgent({
      uri: `http://${proxyConfig.username}:${proxyConfig.password}@${new URL(proxyConfig.url).host}`,
    })
  : undefined

/**
 * Fetch with browser-like headers to avoid trivial bot detection.
 *
 * Sets Chrome-like User-Agent, sec-ch-ua, Accept-Language, and sec-fetch headers.
 * Caller-provided headers (via init.headers) take precedence over defaults.
 * When PROXY_URL is configured, routes traffic through the proxy.
 */
export async function stealthFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)

  if (!headers.has('User-Agent'))       headers.set('User-Agent', sessionUserAgent)
  if (!headers.has('Accept'))           headers.set('Accept', 'application/json, text/plain, */*')
  if (!headers.has('Accept-Language'))   headers.set('Accept-Language', 'en,de-DE;q=0.9,de;q=0.8,en-US;q=0.7')
  if (!headers.has('sec-ch-ua'))        headers.set('sec-ch-ua', secChUa)
  if (!headers.has('sec-ch-ua-mobile')) headers.set('sec-ch-ua-mobile', '?0')
  if (!headers.has('sec-ch-ua-platform')) headers.set('sec-ch-ua-platform', '"macOS"')
  if (!headers.has('Sec-Fetch-Dest'))   headers.set('Sec-Fetch-Dest', 'empty')
  if (!headers.has('Sec-Fetch-Mode'))   headers.set('Sec-Fetch-Mode', 'cors')
  if (!headers.has('priority'))         headers.set('priority', 'u=1, i')

  // Sec-Fetch-Site and Referer are context-dependent — only set if caller didn't
  if (!headers.has('Sec-Fetch-Site'))   headers.set('Sec-Fetch-Site', 'cross-site')
  if (!headers.has('Referer'))          headers.set('Referer', new URL(url).origin + '/')

  const startMs = Date.now()
  try {
    const res = await fetch(url, { ...init, headers, ...(dispatcher && { dispatcher }) })
    log.debug('fetch', { url: String(url), status: res.status, durationMs: Date.now() - startMs, proxy: !!dispatcher })
    return res
  } catch (e) {
    const cause = e instanceof Error && e.cause instanceof Error ? e.cause.message : undefined
    log.error('fetch failed', { url: String(url), error: e instanceof Error ? e.message : String(e), cause, durationMs: Date.now() - startMs, proxy: !!dispatcher })
    throw e
  }
}
