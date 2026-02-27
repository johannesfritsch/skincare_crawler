import { execFile } from 'child_process'
import type { VideoDiscoveryDriver, DiscoveredVideo, VideoDiscoveryPageOptions, VideoDiscoveryPageResult } from '../types'
import { createLogger } from '@/lib/logger'

const log = createLogger('YouTube')

interface YtDlpEntry {
  id?: string
  title?: string
  description?: string
  thumbnail?: string
  upload_date?: string
  timestamp?: number
  duration?: number
  view_count?: number
  like_count?: number
  channel?: string
  channel_url?: string
  webpage_url?: string
}

async function fetchChannelAvatarUrl(channelUrl: string): Promise<string | undefined> {
  try {
    const res = await fetch(channelUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
    })
    if (!res.ok) return undefined
    const html = await res.text()
    // YouTube channel pages have og:image meta with the avatar URL
    const match = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/)
      ?? html.match(/<meta\s+content="([^"]+)"\s+property="og:image"/)
    return match?.[1] ?? undefined
  } catch (e) {
    log.warn(`Failed to fetch channel avatar from ${channelUrl}: ${String(e)}`)
    return undefined
  }
}

/**
 * Run yt-dlp with --playlist-start / --playlist-end to fetch a specific range
 * of videos from a channel. These are 1-based indices into the channel's
 * video list (newest first by default).
 */
function runYtDlp(channelUrl: string, startIndex: number, endIndex: number): Promise<string> {
  const args = [
    '--skip-download',
    '--dump-json',
    '--playlist-start', String(startIndex),
    '--playlist-end', String(endIndex),
    channelUrl,
  ]
  return new Promise((resolve, reject) => {
    const proc = execFile(
      'yt-dlp',
      args,
      { maxBuffer: 100 * 1024 * 1024, timeout: 300_000 },
      (error, stdout, stderr) => {
        if (error) {
          // yt-dlp exits with error when range is beyond the playlist — treat as empty
          if (stderr?.includes('Requested range') || stdout === '') {
            resolve('')
            return
          }
          reject(new Error(`yt-dlp failed: ${stderr || error.message}`))
          return
        }
        resolve(stdout)
      },
    )
    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn yt-dlp: ${err.message}`))
    })
  })
}

function parseYtDlpOutput(stdout: string, channelAvatarUrl?: string): DiscoveredVideo[] {
  if (!stdout.trim()) return []

  const lines = stdout.trim().split('\n').filter(Boolean)
  const videos: DiscoveredVideo[] = []
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as YtDlpEntry
      if (!entry.id || !entry.title) continue

      videos.push({
        externalId: entry.id,
        title: entry.title,
        description: entry.description || undefined,
        thumbnailUrl: entry.thumbnail || undefined,
        externalUrl: entry.webpage_url || `https://www.youtube.com/watch?v=${entry.id}`,
        uploadDate: entry.upload_date
          ? `${entry.upload_date.slice(0, 4)}-${entry.upload_date.slice(4, 6)}-${entry.upload_date.slice(6, 8)}`
          : undefined,
        timestamp: entry.timestamp ?? undefined,
        duration: entry.duration || undefined,
        viewCount: entry.view_count ?? undefined,
        likeCount: entry.like_count ?? undefined,
        channelName: entry.channel || undefined,
        channelUrl: entry.channel_url || undefined,
        channelAvatarUrl,
      })
    } catch {
      log.warn(`Failed to parse yt-dlp line: ${line.substring(0, 100)}`)
    }
  }
  return videos
}

export const youtubeDriver: VideoDiscoveryDriver = {
  slug: 'youtube',
  label: 'YouTube',

  matches(url: string): boolean {
    try {
      const hostname = new URL(url).hostname.toLowerCase()
      return hostname === 'www.youtube.com' || hostname === 'youtube.com'
    } catch {
      return false
    }
  },

  async discoverVideoPage(channelUrl: string, options: VideoDiscoveryPageOptions): Promise<VideoDiscoveryPageResult> {
    const { startIndex, endIndex } = options
    const requestedCount = endIndex - startIndex + 1

    log.info(`Running yt-dlp for ${channelUrl} [${startIndex}–${endIndex}]`)
    const [stdout, channelAvatarUrl] = await Promise.all([
      runYtDlp(channelUrl, startIndex, endIndex),
      fetchChannelAvatarUrl(channelUrl),
    ])

    if (channelAvatarUrl) {
      log.info(`Found channel avatar: ${channelAvatarUrl}`)
    }

    const videos = parseYtDlpOutput(stdout, channelAvatarUrl)
    log.info(`yt-dlp returned ${videos.length} entries (requested ${requestedCount})`)

    return {
      videos,
      reachedEnd: videos.length < requestedCount,
    }
  },
}
