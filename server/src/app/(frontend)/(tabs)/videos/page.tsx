import { getPayload } from 'payload'
import config from '@payload-config'
import { desc, eq, sql, type SQL } from 'drizzle-orm'
import Link from 'next/link'
import { Suspense } from 'react'
import { Eye, ThumbsUp, Calendar, Clock, Play } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { ChannelFilter, type ChannelOption } from '@/components/channel-filter'

export const metadata = {
  title: 'Videos — AnySkin',
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return ''
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatCount(n: number | null): string {
  if (!n) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}

interface VideosPageProps {
  searchParams: Promise<{ channel?: string }>
}

export default async function VideosPage({ searchParams }: VideosPageProps) {
  const { channel: channelFilter } = await searchParams
  const payload = await getPayload({ config: await config })
  const db = payload.db.drizzle
  const t = payload.db.tables

  // Fetch all channels with video counts for the filter bar
  const channelsRaw = await db
    .select({
      id: t.channels.id,
      creatorName: t.creators.name,
      platform: t.channels.platform,
      imageUrl: sql<string | null>`coalesce(${t.media}.sizes_thumbnail_url, ${t.media}.url)`,
      videoCount: sql<number>`count(${t.videos.id})::int`,
    })
    .from(t.channels)
    .leftJoin(t.creators, eq(t.channels.creator, t.creators.id))
    .leftJoin(t.media, eq(t.channels.image, t.media.id))
    .leftJoin(t.videos, eq(t.videos.channel, t.channels.id))
    .groupBy(t.channels.id, t.creators.name, t.channels.platform, t.media.id)
    .having(sql`count(${t.videos.id}) > 0`)
    .orderBy(sql`count(${t.videos.id}) desc`)

  const channelOptions: ChannelOption[] = channelsRaw.map((ch) => ({
    id: ch.id as number,
    creatorName: (ch.creatorName as string) ?? 'Unknown',
    platform: (ch.platform as string) ?? '',
    imageUrl: ch.imageUrl,
    videoCount: ch.videoCount,
  }))

  // Build video query with optional channel filter
  const whereClause: SQL | undefined = channelFilter
    ? (() => {
        const channelId = parseInt(channelFilter, 10)
        return !isNaN(channelId) ? eq(t.videos.channel, channelId) : undefined
      })()
    : undefined

  // Channel image URL via correlated subquery to avoid double-joining media
  const channelImageSql = sql<string | null>`(
    SELECT coalesce(m.sizes_thumbnail_url, m.url)
    FROM media m
    WHERE m.id = ${t.channels.image}
    LIMIT 1
  )`

  const videos = await db
    .select({
      id: t.videos.id,
      title: t.videos.title,
      publishedAt: t.videos.publishedAt,
      duration: t.videos.duration,
      viewCount: t.videos.viewCount,
      likeCount: t.videos.likeCount,
      externalUrl: t.videos.externalUrl,
      thumbnailUrl: t.media.url,
      thumbnailFilename: t.media.filename,
      channelId: t.channels.id,
      channelPlatform: t.channels.platform,
      channelImageUrl: channelImageSql,
      creatorName: t.creators.name,
      mentionCount: sql<number>`(
        SELECT count(DISTINCT vm.product_id)
        FROM video_snippets vs
        JOIN video_mentions vm ON vm.video_snippet_id = vs.id
        WHERE vs.video_id = ${t.videos.id}
      )::int`,
    })
    .from(t.videos)
    .leftJoin(t.media, eq(t.videos.image, t.media.id))
    .leftJoin(t.channels, eq(t.videos.channel, t.channels.id))
    .leftJoin(t.creators, eq(t.channels.creator, t.creators.id))
    .where(whereClause)
    .orderBy(desc(t.videos.publishedAt))
    .limit(30)

  return (
    <div className="space-y-4">
      {/* Channel filter bar */}
      <Suspense>
        <ChannelFilter channels={channelOptions} />
      </Suspense>

      {/* Video list */}
      <div className="flex flex-col gap-3">
        {videos.map((v) => {
          const thumbnailSrc =
            v.thumbnailUrl || (v.thumbnailFilename ? `/media/${v.thumbnailFilename}` : null)

          const formattedDate = v.publishedAt
            ? new Date(v.publishedAt).toLocaleDateString('de-DE', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
              })
            : null
          const formattedTime = v.publishedAt
            ? new Date(v.publishedAt).toLocaleTimeString('de-DE', {
                hour: '2-digit',
                minute: '2-digit',
              })
            : null

          return (
            <Link
              key={v.id}
              href={`/videos/${v.id}`}
              className="flex gap-3 rounded-xl border bg-card p-3 transition-colors active:bg-muted/60"
            >
              {/* Thumbnail */}
              <div className="relative shrink-0 w-28 h-20 sm:w-36 sm:h-24 rounded-lg bg-muted/50 overflow-hidden">
                {thumbnailSrc ? (
                  <img
                    src={thumbnailSrc}
                    alt=""
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Play className="h-6 w-6 text-muted-foreground/40" />
                  </div>
                )}
                {v.duration != null && v.duration > 0 && (
                  <span className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] font-medium px-1.5 py-0.5 rounded">
                    {formatDuration(v.duration)}
                  </span>
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                <div>
                  <p className="text-sm font-medium leading-tight line-clamp-2">{v.title}</p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <Avatar size="sm" className="size-4">
                      {v.channelImageUrl && (
                        <AvatarImage src={v.channelImageUrl} alt={v.creatorName ?? ''} />
                      )}
                      <AvatarFallback className="text-[7px]">
                        {(v.creatorName ?? '?').slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <p className="text-xs text-muted-foreground truncate">
                      {v.creatorName ?? 'Unknown creator'}
                      {v.channelPlatform && (
                        <span className="capitalize"> &middot; {v.channelPlatform}</span>
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-x-3 gap-y-1 mt-1.5 flex-wrap">
                  {formattedDate && (
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      {formattedDate}
                    </span>
                  )}
                  {formattedTime && (
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {formattedTime}
                    </span>
                  )}
                  {v.viewCount != null && v.viewCount > 0 && (
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Eye className="h-3 w-3" />
                      {formatCount(v.viewCount)}
                    </span>
                  )}
                  {v.likeCount != null && v.likeCount > 0 && (
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <ThumbsUp className="h-3 w-3" />
                      {formatCount(v.likeCount)}
                    </span>
                  )}
                  {v.mentionCount != null && v.mentionCount > 0 && (
                    <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
                      {v.mentionCount} product{v.mentionCount !== 1 ? 's' : ''}
                    </Badge>
                  )}
                </div>
              </div>
            </Link>
          )
        })}
      </div>

      {videos.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-muted-foreground text-sm">
            {channelFilter ? 'No videos for this channel.' : 'No videos yet.'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {channelFilter
              ? 'Try selecting a different channel or view all.'
              : "Videos will appear here once they're processed."}
          </p>
        </div>
      )}
    </div>
  )
}
