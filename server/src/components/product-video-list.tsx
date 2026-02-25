'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Play, ThumbsUp, ThumbsDown, Minus, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

export interface ProductVideoItem {
  videoId: number
  videoTitle: string
  videoThumbnailUrl: string | null
  videoDuration: number | null
  creatorName: string | null
  channelImageUrl: string | null
  channelPlatform: string | null
  overallSentiment: string | null
  overallSentimentScore: number | null
  quoteCount: number
  timestampStart: number | null
}

function SentimentIcon({ sentiment, className }: { sentiment: string | null; className?: string }) {
  switch (sentiment) {
    case 'positive':
      return <ThumbsUp className={cn('text-emerald-600', className)} />
    case 'negative':
      return <ThumbsDown className={cn('text-red-500', className)} />
    case 'mixed':
      return <Minus className={cn('text-amber-500', className)} />
    default:
      return <Minus className={cn('text-muted-foreground', className)} />
  }
}

function sentimentBadgeVariant(s: string | null): string {
  switch (s) {
    case 'positive': return 'bg-emerald-50 text-emerald-700 border-emerald-200/60'
    case 'negative': return 'bg-red-50 text-red-700 border-red-200/60'
    case 'mixed': return 'bg-amber-50 text-amber-700 border-amber-200/60'
    default: return 'bg-muted/50 text-muted-foreground border-border'
  }
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return ''
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatTimestamp(seconds: number | null): string {
  if (seconds == null) return ''
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

const PAGE_SIZE = 5

export function ProductVideoList({ videos }: { videos: ProductVideoItem[] }) {
  const [page, setPage] = useState(0)
  const totalPages = Math.ceil(videos.length / PAGE_SIZE)
  const pageVideos = videos.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  if (videos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Play className="h-8 w-8 text-muted-foreground/30 mb-3" />
        <p className="text-sm text-muted-foreground">No video mentions yet.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {pageVideos.map((v, i) => (
        <Link
          key={`${v.videoId}-${i}`}
          href={`/videos/${v.videoId}`}
          className="flex gap-3 rounded-xl border bg-card p-3 transition-colors active:bg-muted/60"
        >
          {/* Thumbnail */}
          <div className="relative shrink-0 w-24 h-16 sm:w-32 sm:h-20 rounded-lg bg-muted/50 overflow-hidden">
            {v.videoThumbnailUrl ? (
              <img
                src={v.videoThumbnailUrl}
                alt=""
                className="w-full h-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Play className="h-5 w-5 text-muted-foreground/40" />
              </div>
            )}
            {v.videoDuration != null && v.videoDuration > 0 && (
              <span className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] font-medium px-1.5 py-0.5 rounded">
                {formatDuration(v.videoDuration)}
              </span>
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
            <div>
              <p className="text-sm font-medium leading-tight line-clamp-2">{v.videoTitle}</p>
              <div className="flex items-center gap-1.5 mt-1">
                <Avatar size="sm" className="size-4">
                  {v.channelImageUrl && (
                    <AvatarImage src={v.channelImageUrl} alt={v.creatorName ?? ''} />
                  )}
                  <AvatarFallback className="text-[7px]">
                    {(v.creatorName ?? '?').slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="text-xs text-muted-foreground truncate">
                  {v.creatorName ?? 'Unknown'}
                  {v.channelPlatform && <span className="capitalize"> &middot; {v.channelPlatform}</span>}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 mt-1.5">
              {v.overallSentiment && (
                <span className={cn('inline-flex items-center gap-1 text-[11px] font-medium rounded-full border px-2 py-0.5', sentimentBadgeVariant(v.overallSentiment))}>
                  <SentimentIcon sentiment={v.overallSentiment} className="h-3 w-3" />
                  {v.overallSentiment}
                </span>
              )}
              {v.timestampStart != null && (
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {formatTimestamp(v.timestampStart)}
                </span>
              )}
              {v.quoteCount > 0 && (
                <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
                  {v.quoteCount} quote{v.quoteCount !== 1 ? 's' : ''}
                </Badge>
              )}
            </div>
          </div>
        </Link>
      ))}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Prev
          </Button>
          <span className="text-xs text-muted-foreground">
            {page + 1} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
          >
            Next
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}
    </div>
  )
}
