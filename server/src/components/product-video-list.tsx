'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Play, ThumbsUp, ThumbsDown, Minus, Clock, Quote } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ProductVideoQuote {
  text: string
  sentiment: string | null
  sentimentScore: number | null
}

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
  timestampStart: number | null
  snippetId: number | null
  quotes: ProductVideoQuote[]
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

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

function quoteBg(s: string | null): string {
  switch (s) {
    case 'positive': return 'bg-emerald-50/60 border-emerald-200/40'
    case 'negative': return 'bg-red-50/60 border-red-200/40'
    case 'mixed': return 'bg-amber-50/60 border-amber-200/40'
    default: return 'bg-muted/20 border-border/40'
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

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

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
    <div className="flex flex-col gap-2.5">
      {pageVideos.map((v, i) => {
        const href = v.snippetId
          ? `/videos/${v.videoId}?snippetId=${v.snippetId}`
          : `/videos/${v.videoId}`

        return (
          <Link
            key={`${v.videoId}-${v.snippetId ?? i}`}
            href={href}
            className="rounded-xl border bg-card overflow-hidden transition-colors active:bg-muted/60"
          >
            {/* Top row: thumbnail + info */}
            <div className="flex gap-3 p-3">
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
                {v.overallSentiment && (
                  <span className={cn(
                    'absolute top-1 left-1 inline-flex items-center gap-0.5 text-[10px] font-semibold rounded-full px-1.5 py-0.5 border backdrop-blur-sm',
                    v.overallSentiment === 'positive' ? 'bg-emerald-50/90 text-emerald-700 border-emerald-200/60' :
                    v.overallSentiment === 'negative' ? 'bg-red-50/90 text-red-700 border-red-200/60' :
                    v.overallSentiment === 'mixed' ? 'bg-amber-50/90 text-amber-700 border-amber-200/60' :
                    'bg-muted/90 text-muted-foreground border-border',
                  )}>
                    <SentimentIcon sentiment={v.overallSentiment} className="h-2.5 w-2.5" />
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
                    </span>
                  </div>
                </div>

                {v.timestampStart != null && (
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground mt-1">
                    <Clock className="h-3 w-3" />
                    {formatTimestamp(v.timestampStart)}
                  </span>
                )}
              </div>
            </div>

            {/* Quote strips — all quotes for this mention */}
            {v.quotes.length > 0 && (
              <div className="flex flex-col gap-1.5 mx-3 mb-3">
                {v.quotes.map((q, qi) => (
                  <div
                    key={qi}
                    className={cn(
                      'rounded-lg border px-3 py-2 flex items-start gap-2',
                      quoteBg(q.sentiment),
                    )}
                  >
                    <Quote className={cn('h-3 w-3 mt-0.5 shrink-0 rotate-180', q.sentiment === 'positive' ? 'text-emerald-500' : q.sentiment === 'negative' ? 'text-red-400' : q.sentiment === 'mixed' ? 'text-amber-400' : 'text-muted-foreground/40')} />
                    <p className="text-[12px] leading-relaxed line-clamp-2 italic text-foreground/80">
                      &ldquo;{q.text}&rdquo;
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Link>
        )
      })}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => { e.preventDefault(); setPage((p) => Math.max(0, p - 1)) }}
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
            onClick={(e) => { e.preventDefault(); setPage((p) => Math.min(totalPages - 1, p + 1)) }}
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
