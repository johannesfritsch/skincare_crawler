import { execFile } from 'child_process'
import type { VideoDiscoveryDriver, DiscoveredVideo } from '../types'

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

function runYtDlp(channelUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = execFile(
      'yt-dlp',
      ['--skip-download', '--dump-json', channelUrl],
      { maxBuffer: 100 * 1024 * 1024, timeout: 300_000 },
      (error, stdout, stderr) => {
        if (error) {
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

  async discoverVideos(channelUrl: string): Promise<DiscoveredVideo[]> {
    console.log(`[youtube] Running yt-dlp for ${channelUrl}`)
    const stdout = await runYtDlp(channelUrl)

    // yt-dlp outputs one JSON object per line
    const lines = stdout.trim().split('\n').filter(Boolean)
    console.log(`[youtube] yt-dlp returned ${lines.length} entries`)

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
        })
      } catch {
        console.warn(`[youtube] Failed to parse yt-dlp line: ${line.substring(0, 100)}`)
      }
    }

    return videos
  },
}
