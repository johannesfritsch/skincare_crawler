/**
 * Fetch Instagram comments for a post using Instagram's internal REST API.
 *
 * Uses the same session cookies as gallery-dl (from crawler-settings).
 * Gracefully returns [] on any failure — missing comments must never block a crawl.
 */

import { stealthFetch } from '@/lib/stealth-fetch'
import type { Logger } from '@/lib/logger'

export interface InstagramComment {
  externalId: string
  username: string
  text: string
  createdAt?: string
  likeCount?: number
}

/** Parse Netscape cookie file content into a Cookie header string for a given domain. */
function netscapeCookiesToHeader(cookieContent: string, domain: string): string {
  return cookieContent
    .split('\n')
    .filter(line => !line.startsWith('#') && line.trim().length > 0)
    .map(line => line.split('\t'))
    .filter(parts => parts.length >= 7 && parts[0].includes(domain))
    .map(parts => `${parts[5]}=${parts[6]}`)
    .join('; ')
}

/** Extract a specific cookie value from Netscape cookie content. */
function extractCookieValue(cookieContent: string, domain: string, name: string): string | undefined {
  const lines = cookieContent.split('\n')
  for (const line of lines) {
    if (line.startsWith('#') || !line.trim()) continue
    const parts = line.split('\t')
    if (parts.length >= 7 && parts[0].includes(domain) && parts[5] === name) {
      return parts[6]
    }
  }
  return undefined
}

const DELAY_MS = 500
const MAX_PAGES = 3
const REQUEST_TIMEOUT_MS = 10_000

export async function fetchInstagramComments(
  mediaId: string,
  cookieContent: string,
  options?: { limit?: number; logger?: Logger },
): Promise<InstagramComment[]> {
  const limit = options?.limit ?? 50
  const log = options?.logger

  const cookieHeader = netscapeCookiesToHeader(cookieContent, 'instagram.com')
  if (!cookieHeader) {
    log?.debug('No Instagram cookies found for comment fetch')
    return []
  }

  const csrfToken = extractCookieValue(cookieContent, 'instagram.com', 'csrftoken') ?? ''

  const comments: InstagramComment[] = []
  let minId: string | undefined

  for (let page = 0; page < MAX_PAGES; page++) {
    if (comments.length >= limit) break

    let url = `https://www.instagram.com/api/v1/media/${mediaId}/comments/?can_support_threading=true`
    if (minId) url += `&min_id=${minId}`

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

      const res = await stealthFetch(url, {
        signal: controller.signal,
        headers: {
          Cookie: cookieHeader,
          'X-CSRFToken': csrfToken,
          'X-IG-App-ID': '936619743392459',
          'X-Requested-With': 'XMLHttpRequest',
          Referer: 'https://www.instagram.com/',
          'Sec-Fetch-Site': 'same-origin',
        },
      })

      clearTimeout(timeout)

      if (res.status === 401 || res.status === 403) {
        log?.warn('Instagram comment fetch auth failed', { status: res.status, mediaId })
        return comments
      }

      if (res.status === 429) {
        log?.warn('Instagram comment fetch rate limited', { mediaId, collected: comments.length })
        return comments
      }

      if (!res.ok) {
        log?.warn('Instagram comment fetch failed', { status: res.status, mediaId })
        return comments
      }

      const data = await res.json() as {
        comments?: Array<{
          pk?: string | number
          user?: { username?: string }
          text?: string
          created_at?: number
          comment_like_count?: number
        }>
        next_min_id?: string
      }

      for (const c of data.comments ?? []) {
        const username = c.user?.username ?? ''
        const text = c.text ?? ''
        if (text) {
          const comment: InstagramComment = { externalId: String(c.pk ?? ''), username, text }
          if (c.created_at) {
            comment.createdAt = new Date(c.created_at * 1000).toISOString()
          }
          if (c.comment_like_count != null) {
            comment.likeCount = c.comment_like_count
          }
          comments.push(comment)
          if (comments.length >= limit) break
        }
      }

      if (!data.next_min_id || (data.comments?.length ?? 0) === 0) break
      minId = data.next_min_id

      // Delay between pages
      if (page < MAX_PAGES - 1 && comments.length < limit) {
        await new Promise(resolve => setTimeout(resolve, DELAY_MS))
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('abort')) {
        log?.warn('Instagram comment fetch timed out', { mediaId, page })
      } else {
        log?.warn('Instagram comment fetch error', { mediaId, page, error: msg })
      }
      return comments
    }
  }

  return comments
}
