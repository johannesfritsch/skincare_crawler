'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, ChevronRight as ChevronRightIcon, Quote } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'

export interface ProductQuoteItem {
  text: string
  sentiment: string | null
  creatorName: string | null
  channelImageUrl: string | null
  publishedAt: string | null
  videoId: number
  sceneId: number | null
}

function quoteBorder(s: string | null): string {
  switch (s) {
    case 'positive': return 'border-l-emerald-400'
    case 'negative': return 'border-l-rose-400'
    case 'mixed': return 'border-l-amber-400'
    default: return 'border-l-border'
  }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return ''
  try {
    const d = new Date(dateStr)
    return d.toLocaleDateString('de-DE', { month: 'short', year: 'numeric' })
  } catch {
    return ''
  }
}

const PAGE_SIZE = 5

export function ProductQuoteList({ quotes }: { quotes: ProductQuoteItem[] }) {
  const [page, setPage] = useState(0)
  const totalPages = Math.ceil(quotes.length / PAGE_SIZE)
  const pageQuotes = quotes.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  if (quotes.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      {pageQuotes.map((q, i) => {
        const href = q.sceneId
          ? `/videos/${q.videoId}?sceneId=${q.sceneId}`
          : `/videos/${q.videoId}`

        return (
          <Link
            key={`${q.videoId}-${q.sceneId ?? ''}-${i}`}
            href={href}
            className={cn(
              'rounded-xl border bg-card px-4 py-3 border-l-[3px] transition-colors active:bg-muted/60 flex items-start gap-3',
              quoteBorder(q.sentiment),
            )}
          >
            <Quote className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground/40 rotate-180" />
            <div className="flex-1 min-w-0">
              <p className="text-sm leading-relaxed italic text-foreground/80 line-clamp-3">
                &ldquo;{q.text}&rdquo;
              </p>
              <div className="flex items-center gap-2 mt-2">
                <Avatar className="size-4">
                  {q.channelImageUrl && (
                    <AvatarImage src={q.channelImageUrl} alt={q.creatorName ?? ''} />
                  )}
                  <AvatarFallback className="text-[7px]">
                    {(q.creatorName ?? '?').slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="text-xs text-muted-foreground truncate">{q.creatorName ?? 'Unknown'}</span>
                {q.publishedAt && (
                  <>
                    <span className="text-muted-foreground/30">&middot;</span>
                    <span className="text-xs text-muted-foreground">{formatDate(q.publishedAt)}</span>
                  </>
                )}
              </div>
            </div>
            <ChevronRightIcon className="h-4 w-4 shrink-0 text-muted-foreground/40 mt-1" />
          </Link>
        )
      })}

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-1">
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
