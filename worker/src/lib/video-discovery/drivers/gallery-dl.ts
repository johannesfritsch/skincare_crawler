/**
 * Shared gallery-dl runner for Instagram and TikTok discovery.
 *
 * Runs `gallery-dl --no-download --dump-json` with cookie and proxy support.
 * Parses the JSON array output into typed entries.
 */

import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import type { PayloadRestClient } from '@/lib/payload-client'
import { createLogger } from '@/lib/logger'

const log = createLogger('GalleryDl')

export interface GalleryDlEntry {
  index: number
  /** Present in [index, url, data] tuples (media file entries) */
  url?: string
  data: Record<string, unknown>
}

interface GalleryDlOptions {
  url: string
  /** Cookie content in Netscape format (written to a temp file for gallery-dl) */
  cookies?: string
  /** Number of items to fetch. Instagram: --range 1-N. TikTok: --chapter-range 1-N (best-effort). */
  range?: number
  /** Only discover videos newer than this (e.g. "5 days", "2 weeks", "1 month") */
  dateLimit?: string
  platform: 'instagram' | 'tiktok'
  logger?: import('@/lib/logger').Logger
}

/** Cached crawler-settings to avoid repeated API calls within one process lifecycle */
let cachedSettings: Record<string, unknown> | null = null

/** Fetch the cookie content for a platform from crawler-settings */
export async function getCookies(
  payload: PayloadRestClient | undefined,
  platform: 'instagram' | 'tiktok',
): Promise<string | undefined> {
  if (!payload) return undefined
  if (!cachedSettings) {
    try {
      cachedSettings = await payload.findGlobal('crawler-settings')
    } catch (e) {
      log.warn('Failed to fetch crawler-settings', { error: String(e) })
      return undefined
    }
  }
  const field = platform === 'instagram' ? 'instagramCookies' : 'tiktokCookies'
  return (cachedSettings?.[field] as string) || undefined
}

/** Reset the cached settings (e.g. between jobs) */
export function resetSettingsCache(): void {
  cachedSettings = null
}

/** Write cookie content to a temp file, returning the path. Caller must clean up. */
function writeCookieTempFile(cookies: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-dl-cookies-'))
  const cookiePath = path.join(tmpDir, 'cookies.txt')
  fs.writeFileSync(cookiePath, cookies, 'utf-8')
  return cookiePath
}

/**
 * Parse a human-readable date limit like "5 days", "2 weeks", "1 month" into total days.
 * Returns 0 if the string can't be parsed.
 */
export function parseDateLimitToDays(dateLimit: string): number {
  const match = dateLimit.trim().match(/^(\d+)\s*(days?|weeks?|months?|years?)$/i)
  if (!match) return 0
  const amount = parseInt(match[1], 10)
  const unit = match[2].toLowerCase().replace(/s$/, '')
  switch (unit) {
    case 'day': return amount
    case 'week': return amount * 7
    case 'month': return amount * 30
    case 'year': return amount * 365
    default: return 0
  }
}

/**
 * Convert a dateLimit string to yt-dlp's --dateafter format.
 * E.g. "5 days" → "today-5days", "2 weeks" → "today-2weeks"
 * Returns undefined if the string can't be parsed.
 */
export function dateLimitToYtDlp(dateLimit: string): string | undefined {
  const match = dateLimit.trim().match(/^(\d+)\s*(days?|weeks?|months?|years?)$/i)
  if (!match) return undefined
  const amount = match[1]
  const unit = match[2].toLowerCase().replace(/s$/, '')
  return `today-${amount}${unit}s`
}

/**
 * Run gallery-dl and return parsed entries.
 *
 * gallery-dl --dump-json outputs a JSON array of tuples:
 * - [index, data]           — metadata-only entries (index=2 for post metadata)
 * - [index, url, data]      — media file entries (index=3 for media with download URL)
 * - [-1, {"error": ...}]    — error entries (e.g. redirect to login page)
 */
export function runGalleryDl(options: GalleryDlOptions): Promise<GalleryDlEntry[]> {
  const { url, cookies, range, dateLimit, platform, logger } = options

  const args = ['--no-download', '--dump-json']

  // Write cookie content to temp file if provided
  let cookieTempPath: string | undefined
  if (cookies) {
    cookieTempPath = writeCookieTempFile(cookies)
    args.push('--cookies', cookieTempPath)
  }

  // Range limiting: Instagram uses --post-range, TikTok uses --chapter-range
  // TikTok's API ignores the range and always returns all posts — slicing is done in code
  if (range && range > 0) {
    if (platform === 'instagram') {
      args.push('--post-range', `1-${range}`)
    } else {
      args.push('--chapter-range', `1-${range}`)
    }
  }

  // Proxy
  const proxyUrl = process.env.PROXY_URL
  if (proxyUrl) {
    const username = process.env.PROXY_USERNAME || ''
    const password = process.env.PROXY_PASSWORD || ''
    const parsed = new URL(proxyUrl)
    args.push('--proxy', `http://${username}:${password}@${parsed.host}`)
  }

  args.push(url)

  // Log with proxy password redacted
  const safeArgs = args.map(a =>
    process.env.PROXY_PASSWORD && a.includes(process.env.PROXY_PASSWORD)
      ? a.replace(process.env.PROXY_PASSWORD, '***')
      : a,
  )
  const effectiveLog = logger ?? log
  effectiveLog.info('Running gallery-dl', { url, platform, proxy: !!proxyUrl, cookies: !!cookies, range: range ?? 0, args: safeArgs.join(' ') })

  /** Clean up the temp cookie file */
  const cleanupCookies = () => {
    if (cookieTempPath) {
      try { fs.rmSync(path.dirname(cookieTempPath), { recursive: true, force: true }) } catch {}
    }
  }
  const startMs = Date.now()

  return new Promise((resolve, reject) => {
    const proc = execFile(
      'gallery-dl',
      args,
      { maxBuffer: 100 * 1024 * 1024, timeout: 600_000 },
      (error, stdout, stderr) => {
        const durationMs = Date.now() - startMs
        const exitCode = error?.code ?? (error ? 'unknown' : 0)

        effectiveLog.debug('gallery-dl raw output', {
          exitCode,
          durationMs,
          stdoutLen: stdout?.length ?? 0,
          stdoutPreview: stdout?.substring(0, 500) || '(empty)',
          stderrPreview: stderr?.substring(0, 500) || '(empty)',
        })

        // Dump full stdout/stderr to temp files for debugging
        const dumpDir = `/tmp/gallery-dl-${platform}-${Date.now()}`
        fs.mkdirSync(dumpDir, { recursive: true })
        const stdoutFile = path.join(dumpDir, 'stdout.json')
        const stderrFile = path.join(dumpDir, 'stderr.txt')
        if (stdout) fs.writeFileSync(stdoutFile, stdout, 'utf-8')
        if (stderr) fs.writeFileSync(stderrFile, stderr, 'utf-8')

        // Emit output event with file paths and preview (visible in admin UI)
        logger?.event('video_discovery.gallery_dl_output', {
          platform,
          stdoutPreview: (stdout || '').substring(0, 500),
          stderrPreview: (stderr || '').substring(0, 500),
          stdoutLen: stdout?.length ?? 0,
          stdoutFile,
          stderrFile,
          exitCode: String(exitCode),
          durationMs,
        })
        effectiveLog.info('gallery-dl output dumped', { stdoutFile, stderrFile, stdoutLen: stdout?.length ?? 0, stderrLen: stderr?.length ?? 0 })

        // Log stderr as a warning event (visible in admin UI)
        if (stderr) {
          effectiveLog.warn('gallery-dl stderr', { stderr: stderr.substring(0, 1000) })
          logger?.event('video_discovery.gallery_dl_stderr', {
            platform,
            stderr: stderr.substring(0, 500),
          })
        }

        if (error) {
          cleanupCookies()
          const errMsg = `gallery-dl failed (exit ${exitCode}): ${stderr || error.message}`
          effectiveLog.error('gallery-dl failed', { url, exitCode, stderr: stderr?.substring(0, 500), durationMs })
          logger?.event('video_discovery.gallery_dl_failed', {
            channelUrl: url,
            platform,
            error: errMsg.substring(0, 500),
            durationMs,
          })
          reject(new Error(errMsg))
          return
        }

        // Parse JSON array output
        try {
          const raw = JSON.parse(stdout) as unknown[]
          const entries: GalleryDlEntry[] = []
          const errors: string[] = []

          for (const item of raw) {
            if (!Array.isArray(item) || item.length < 2) continue

            const index = item[0] as number

            // Detect error entries: [-1, {"error": "...", "message": "..."}]
            if (index === -1) {
              const errorData = (item.length === 2 ? item[1] : item[2]) as Record<string, unknown>
              const errorMsg = (errorData?.message as string) || (errorData?.error as string) || 'Unknown error'
              errors.push(errorMsg)
              continue
            }

            if (item.length === 2) {
              // [index, data]
              entries.push({ index, data: item[1] as Record<string, unknown> })
            } else if (item.length >= 3) {
              // [index, url, data]
              entries.push({
                index,
                url: item[1] as string,
                data: item[2] as Record<string, unknown>,
              })
            }
          }

          cleanupCookies()

          // If gallery-dl returned only errors and no real entries, throw
          if (entries.length === 0 && errors.length > 0) {
            const errMsg = `gallery-dl returned errors: ${errors.join('; ')}`
            effectiveLog.error('gallery-dl returned errors', { url, errors: errors.join('; '), durationMs })
            logger?.event('video_discovery.gallery_dl_failed', {
              channelUrl: url,
              platform,
              error: errMsg.substring(0, 500),
              durationMs,
            })
            reject(new Error(errMsg))
            return
          }

          // Log warnings for any errors alongside valid entries
          if (errors.length > 0) {
            effectiveLog.warn('gallery-dl partial errors', { url, errorCount: errors.length, errors: errors.join('; ').substring(0, 500) })
          }

          effectiveLog.info('gallery-dl complete', { url, durationMs, entries: entries.length, errors: errors.length })
          resolve(entries)
        } catch (parseErr) {
          cleanupCookies()
          const errMsg = `gallery-dl output parse failed: ${parseErr}`
          effectiveLog.error('gallery-dl JSON parse failed', {
            url,
            durationMs,
            error: String(parseErr),
            stdoutPreview: stdout.substring(0, 500),
          })
          logger?.event('video_discovery.gallery_dl_failed', {
            channelUrl: url,
            platform,
            error: errMsg.substring(0, 500),
            durationMs,
          })
          reject(new Error(errMsg))
        }
      },
    )
    proc.on('error', (err) => {
      cleanupCookies()
      effectiveLog.error('Failed to spawn gallery-dl', { error: err.message })
      logger?.event('video_discovery.gallery_dl_failed', {
        channelUrl: url,
        platform,
        error: `Failed to spawn: ${err.message}`,
        durationMs: Date.now() - startMs,
      })
      reject(new Error(`Failed to spawn gallery-dl: ${err.message}`))
    })

    // Stream output to console in real-time
    proc.stdout?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim()) process.stdout.write(`[gallery-dl] ${line}\n`)
      }
    })
    proc.stderr?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim()) process.stderr.write(`[gallery-dl] ${line}\n`)
      }
    })
  })
}
