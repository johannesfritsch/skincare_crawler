'use client'

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import {
  ChevronDown,
  Clock,
  ExternalLink,
  Eye,
  Heart,
  MessageCircle,
  Package,
  ThumbsDown,
  ThumbsUp,
  Minus,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface VideoQuote {
  text: string
  sentiment: 'positive' | 'neutral' | 'negative' | 'mixed'
  sentimentScore: number | null
}

export interface VideoMentionItem {
  id: number
  productId: number
  productName: string | null
  productGtin: string | null
  productImageUrl: string | null
  brandName: string | null
  overallSentiment: string | null
  quotes: VideoQuote[]
  snippetId: number
  timestampStart: number | null
  timestampEnd: number | null
  snippetTranscript: string | null
}

export interface VideoDetailClientProps {
  videoId: string
  title: string
  creatorName: string | null
  channelPlatform: string | null
  publishedAt: string | null
  viewCount: number | null
  likeCount: number | null
  externalUrl: string | null
  mentions: VideoMentionItem[]
  /** When set, the snippet with this ID will be auto-opened and its timestamp seeked on load */
  initialSnippetId?: number | null
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/.*[?&]v=([a-zA-Z0-9_-]{11})/,
  ]
  for (const p of patterns) {
    const m = url.match(p)
    if (m) return m[1]
  }
  return null
}

function formatTimestamp(seconds: number | null): string {
  if (seconds == null) return ''
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function sentimentColor(s: string | null) {
  switch (s) {
    case 'positive':
      return 'text-emerald-600'
    case 'negative':
      return 'text-red-500'
    case 'mixed':
      return 'text-amber-500'
    default:
      return 'text-muted-foreground'
  }
}

function sentimentDot(s: string | null) {
  switch (s) {
    case 'positive':
      return 'bg-emerald-500'
    case 'negative':
      return 'bg-red-500'
    case 'mixed':
      return 'bg-amber-400'
    default:
      return 'bg-muted-foreground/40'
  }
}

function sentimentBg(s: string | null) {
  switch (s) {
    case 'positive':
      return 'bg-emerald-50 border-emerald-200/60'
    case 'negative':
      return 'bg-red-50 border-red-200/60'
    case 'mixed':
      return 'bg-amber-50 border-amber-200/60'
    default:
      return 'bg-muted/30 border-border'
  }
}

function SentimentIcon({ sentiment, className }: { sentiment: string | null; className?: string }) {
  const cls = `${className ?? 'h-3.5 w-3.5'} ${sentimentColor(sentiment)}`
  switch (sentiment) {
    case 'positive':
      return <ThumbsUp className={cls} />
    case 'negative':
      return <ThumbsDown className={cls} />
    case 'mixed':
      return <Minus className={cls} />
    default:
      return <Minus className={cls} />
  }
}

/* ------------------------------------------------------------------ */
/*  YouTube IFrame API types                                           */
/* ------------------------------------------------------------------ */

interface YTPlayer {
  seekTo: (seconds: number, allowSeekAhead: boolean) => void
  playVideo: () => void
  destroy: () => void
}

interface YTPlayerEvent {
  target: YTPlayer
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        el: string | HTMLElement,
        opts: {
          videoId: string
          playerVars?: Record<string, unknown>
          events?: {
            onReady?: (e: YTPlayerEvent) => void
          }
        },
      ) => YTPlayer
    }
    onYouTubeIframeAPIReady?: () => void
  }
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

/** 16:9 YouTube player container */
function PlayerEmbed({
  ytVideoId,
  playerElRef,
}: {
  ytVideoId: string | null
  playerElRef: RefObject<HTMLDivElement | null>
}) {
  if (!ytVideoId) {
    return (
      <div className="flex items-center justify-center aspect-video bg-black/5 rounded-xl text-muted-foreground text-sm">
        No video available
      </div>
    )
  }
  return (
    <div className="relative w-full aspect-video">
      <div ref={playerElRef} className="absolute inset-0 w-full h-full" />
    </div>
  )
}

/** Video meta info block */
function VideoInfo({
  title,
  creatorName,
  channelPlatform,
  formattedDate,
  viewCount,
  likeCount,
  externalUrl,
  mentionCount,
}: {
  title: string
  creatorName: string | null
  channelPlatform: string | null
  formattedDate: string | null
  viewCount: number | null
  likeCount: number | null
  externalUrl: string | null
  mentionCount: number
}) {
  return (
    <div>
      <h1 className="text-base md:text-lg font-semibold leading-tight">{title}</h1>
      <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
        {creatorName && <span className="font-medium text-foreground/80">{creatorName}</span>}
        {channelPlatform && <span className="capitalize">&middot; {channelPlatform}</span>}
        {formattedDate && <span>&middot; {formattedDate}</span>}
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-4 mt-3 flex-wrap">
        {viewCount != null && viewCount > 0 && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Eye className="h-3.5 w-3.5" />
            {viewCount.toLocaleString('de-DE')}
          </span>
        )}
        {likeCount != null && likeCount > 0 && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Heart className="h-3.5 w-3.5" />
            {likeCount.toLocaleString('de-DE')}
          </span>
        )}
        {mentionCount > 0 && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Package className="h-3.5 w-3.5" />
            {mentionCount} product{mentionCount !== 1 ? 's' : ''}
          </span>
        )}
        {externalUrl && (
          <a
            href={externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-primary hover:underline ml-auto"
          >
            YouTube <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  )
}

/** Compact product tile inside a snippet header */
function ProductTile({
  mention,
}: {
  mention: VideoMentionItem
}) {
  return (
    <Link
      href={mention.productGtin ? `/products/${mention.productGtin}` : '#'}
      className="flex items-center gap-2.5 min-w-0"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="h-9 w-9 shrink-0 rounded-lg bg-muted/50 flex items-center justify-center overflow-hidden p-0.5">
        {mention.productImageUrl ? (
          <Image
            src={mention.productImageUrl}
            alt={mention.productName ?? 'Product'}
            width={72}
            height={72}
            className="h-full w-full object-contain"
            sizes="36px"
          />
        ) : (
          <span className="text-xs font-semibold text-muted-foreground/30">
            {(mention.productName ?? '?')[0]?.toUpperCase()}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate leading-tight">
          {mention.productName ?? 'Unknown product'}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          {mention.brandName && (
            <span className="text-[11px] text-muted-foreground truncate">
              {mention.brandName}
            </span>
          )}
          {mention.overallSentiment && (
            <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', sentimentDot(mention.overallSentiment))} />
          )}
        </div>
      </div>
    </Link>
  )
}

/** A single snippet block — collapsible, blocky, minimal */
function SnippetBlock({
  snippet,
  seekTo,
  defaultOpen,
  snippetBlockRef,
}: {
  snippet: {
    snippetId: number
    timestampStart: number | null
    timestampEnd: number | null
    transcript: string | null
    mentions: VideoMentionItem[]
  }
  seekTo: (seconds: number) => void
  defaultOpen?: boolean
  snippetBlockRef?: RefObject<HTMLDivElement | null>
}) {
  const [open, setOpen] = useState(defaultOpen ?? false)
  const totalQuotes = snippet.mentions.reduce((sum, m) => sum + m.quotes.length, 0)

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div ref={snippetBlockRef} className="rounded-xl border bg-card overflow-hidden transition-colors">
        {/* ── Header: always visible ── */}
        <CollapsibleTrigger asChild>
          <button className="w-full text-left px-3.5 py-3 flex items-center gap-3 hover:bg-muted/40 transition-colors">
            {/* Timestamp */}
            <span
              className="shrink-0 flex items-center gap-1 text-[11px] font-mono font-medium text-primary bg-primary/8 px-2 py-0.5 rounded-md"
              onClick={(e) => {
                e.stopPropagation()
                if (snippet.timestampStart != null) seekTo(snippet.timestampStart)
              }}
            >
              <Clock className="h-3 w-3" />
              {formatTimestamp(snippet.timestampStart)}
            </span>

            {/* Product avatars stack */}
            <div className="flex items-center -space-x-1.5 shrink-0">
              {snippet.mentions.slice(0, 4).map((mention) => (
                <div
                  key={mention.id}
                  className="h-7 w-7 rounded-md border-2 border-card bg-muted/50 flex items-center justify-center overflow-hidden p-0.5"
                >
                  {mention.productImageUrl ? (
                    <Image
                      src={mention.productImageUrl}
                      alt={mention.productName ?? ''}
                      width={48}
                      height={48}
                      className="h-full w-full object-contain"
                      sizes="28px"
                    />
                  ) : (
                    <span className="text-[9px] font-bold text-muted-foreground/40">
                      {(mention.productName ?? '?')[0]?.toUpperCase()}
                    </span>
                  )}
                </div>
              ))}
              {snippet.mentions.length > 4 && (
                <div className="h-7 w-7 rounded-md border-2 border-card bg-muted flex items-center justify-center">
                  <span className="text-[9px] font-medium text-muted-foreground">
                    +{snippet.mentions.length - 4}
                  </span>
                </div>
              )}
            </div>

            {/* Product name(s) summary */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {snippet.mentions.map((m) => m.productName ?? 'Unknown').join(', ')}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {snippet.mentions.length} product{snippet.mentions.length !== 1 ? 's' : ''}
                {totalQuotes > 0 && <> &middot; {totalQuotes} quote{totalQuotes !== 1 ? 's' : ''}</>}
              </p>
            </div>

            {/* Sentiment dots */}
            <div className="flex items-center gap-1 shrink-0">
              {snippet.mentions.map((m) => (
                <span
                  key={m.id}
                  className={cn('h-2 w-2 rounded-full', sentimentDot(m.overallSentiment))}
                  title={m.overallSentiment ?? undefined}
                />
              ))}
            </div>

            {/* Chevron */}
            <ChevronDown
              className={cn(
                'h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform duration-200',
                open && 'rotate-180',
              )}
            />
          </button>
        </CollapsibleTrigger>

        {/* ── Expanded content ── */}
        <CollapsibleContent>
          <div className="border-t px-3.5 pb-3.5">
            {/* Transcript */}
            {snippet.transcript && (
              <button
                onClick={() => snippet.timestampStart != null && seekTo(snippet.timestampStart)}
                className="w-full text-left mt-3 text-[13px] text-muted-foreground leading-relaxed bg-muted/30 rounded-lg px-3 py-2.5 hover:bg-muted/50 transition-colors"
              >
                <MessageCircle className="h-3 w-3 inline mr-1.5 -mt-0.5 text-muted-foreground/40" />
                <span className="italic">&ldquo;{snippet.transcript}&rdquo;</span>
              </button>
            )}

            {/* Product mentions */}
            <div className="mt-3 flex flex-col gap-2.5">
              {snippet.mentions.map((mention) => (
                <div key={mention.id} className="flex flex-col gap-2">
                  {/* Product row */}
                  <div className="flex items-center gap-3 rounded-lg border bg-background px-3 py-2.5 hover:border-primary/20 transition-colors">
                    <ProductTile mention={mention} />
                    {mention.overallSentiment && (
                      <SentimentIcon
                        sentiment={mention.overallSentiment}
                        className="h-4 w-4 shrink-0"
                      />
                    )}
                  </div>

                  {/* Quotes */}
                  {mention.quotes.length > 0 && (
                    <div className="flex flex-col gap-1.5 pl-3">
                      {mention.quotes.map((quote, qi) => (
                        <button
                          key={qi}
                          onClick={() =>
                            snippet.timestampStart != null && seekTo(snippet.timestampStart)
                          }
                          className={cn(
                            'text-left rounded-lg border px-3 py-2 text-[12px] leading-relaxed transition-colors hover:opacity-80',
                            sentimentBg(quote.sentiment),
                          )}
                        >
                          <div className="flex items-start gap-2">
                            <SentimentIcon
                              sentiment={quote.sentiment}
                              className="h-3 w-3 mt-0.5 shrink-0"
                            />
                            <p className="line-clamp-3">&ldquo;{quote.text}&rdquo;</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function VideoDetailClient({
  title,
  creatorName,
  channelPlatform,
  publishedAt,
  viewCount,
  likeCount,
  externalUrl,
  mentions,
  initialSnippetId,
}: VideoDetailClientProps) {
  const playerRef = useRef<YTPlayer | null>(null)
  const playerElRef = useRef<HTMLDivElement | null>(null)
  const [playerReady, setPlayerReady] = useState(false)
  const initialSeekDone = useRef(false)
  const targetSnippetRef = useRef<HTMLDivElement | null>(null)

  const ytVideoId = externalUrl ? extractYouTubeId(externalUrl) : null

  /* Init YouTube player once the target div is mounted */
  useEffect(() => {
    if (!ytVideoId || !playerElRef.current) return

    const initPlayer = () => {
      if (!window.YT || !playerElRef.current) return
      playerRef.current = new window.YT.Player(playerElRef.current, {
        videoId: ytVideoId,
        playerVars: { autoplay: 0, rel: 0, modestbranding: 1, playsinline: 1 },
        events: { onReady: () => setPlayerReady(true) },
      })
    }

    if (window.YT) {
      initPlayer()
    } else {
      const tag = document.createElement('script')
      tag.src = 'https://www.youtube.com/iframe_api'
      document.head.appendChild(tag)
      window.onYouTubeIframeAPIReady = initPlayer
    }

    return () => {
      playerRef.current?.destroy()
      playerRef.current = null
      setPlayerReady(false)
    }
  }, [ytVideoId])

  const seekTo = useCallback(
    (seconds: number) => {
      if (playerRef.current && playerReady) {
        playerRef.current.seekTo(seconds, true)
        playerRef.current.playVideo()
      }
      // On desktop the page body can scroll; ensure the player is visible
      window.scrollTo({ top: 0, behavior: 'smooth' })
    },
    [playerReady],
  )

  /* Auto-seek to the target snippet when arriving from a product page */
  useEffect(() => {
    if (!initialSnippetId || !playerReady || initialSeekDone.current) return
    initialSeekDone.current = true

    // Find the timestamp for this snippet from mentions data
    const targetMention = mentions.find(m => m.snippetId === initialSnippetId)
    if (targetMention?.timestampStart != null) {
      playerRef.current?.seekTo(targetMention.timestampStart, true)
      playerRef.current?.playVideo()
    }

    // Scroll the snippet block into view on mobile (after a short delay for DOM)
    setTimeout(() => {
      targetSnippetRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 300)
  }, [initialSnippetId, playerReady, mentions])

  /* Group mentions by snippet */
  const snippetMap = new Map<
    number,
    { snippetId: number; timestampStart: number | null; timestampEnd: number | null; transcript: string | null; mentions: VideoMentionItem[] }
  >()
  for (const m of mentions) {
    let entry = snippetMap.get(m.snippetId)
    if (!entry) {
      entry = { snippetId: m.snippetId, timestampStart: m.timestampStart, timestampEnd: m.timestampEnd, transcript: m.snippetTranscript, mentions: [] }
      snippetMap.set(m.snippetId, entry)
    }
    entry.mentions.push(m)
  }
  const snippets = Array.from(snippetMap.values()).sort(
    (a, b) => (a.timestampStart ?? 0) - (b.timestampStart ?? 0),
  )

  const uniqueProducts = new Set(mentions.map((m) => m.productId)).size

  const formattedDate = publishedAt
    ? new Date(publishedAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : null

  const mentionsContent = (
    <>
      {snippets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Package className="h-8 w-8 text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">No product mentions found in this video.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {snippets.map((snippet, idx) => {
            const isTarget = initialSnippetId != null && snippet.snippetId === initialSnippetId
            return (
              <SnippetBlock
                key={snippet.snippetId}
                snippet={snippet}
                seekTo={seekTo}
                defaultOpen={isTarget || (initialSnippetId == null && idx === 0)}
                snippetBlockRef={isTarget ? targetSnippetRef : undefined}
              />
            )
          })}
        </div>
      )}
    </>
  )

  /*
   * Layout strategy:
   *
   * MOBILE (< md):
   *   The component uses `fixed inset-0` to escape the normal document flow
   *   and create its own viewport-filling container. This is necessary because
   *   all ancestor elements use `min-h-[100dvh]` (not a fixed height) to allow
   *   body scroll on other pages — meaning the flex-1/min-h-0 chain cannot
   *   constrain height. A top offset accounts for the sticky header
   *   (h-12 + safe-area-inset-top).
   *
   *   Inside this fixed container, a flex column places the player at the top
   *   (shrink-0) and the scrollable content fills the rest (flex-1 overflow-y-auto).
   *
   * DESKTOP (>= md):
   *   Normal flow. Two-column CSS grid inside the parent layout.
   *   Left column: scrollable mentions. Right column: player + video info.
   */

  const videoInfoProps = {
    title,
    creatorName,
    channelPlatform,
    formattedDate,
    viewCount,
    likeCount,
    externalUrl,
    mentionCount: uniqueProducts,
  } as const

  /*
   * The outer wrapper uses `fixed` on mobile to create a viewport-filling
   * container that is independent of the ancestor scroll chain. On desktop
   * it switches to normal-flow grid via `md:relative md:inset-auto`.
   *
   * The header is 3rem (h-12) + env(safe-area-inset-top). On mobile the
   * fixed container starts just below it. On desktop the offsets are reset
   * and the grid sits inside the normal layout.
   */
  return (
    <div
      className={[
        /* Mobile: fixed container filling the viewport below the header */
        'max-md:fixed max-md:inset-0 max-md:top-[calc(env(safe-area-inset-top,0px)+3rem)] max-md:z-30',
        'max-md:flex max-md:flex-col bg-background',
        /* Desktop: normal-flow two-column grid */
        'md:-mx-4 md:-mt-4 md:-mb-4 md:flex-1 md:min-h-0',
        'md:grid md:grid-cols-[1fr_42%] md:grid-rows-[1fr] md:gap-6 md:px-6 md:pt-5 md:pb-6',
      ].join(' ')}
    >
      {/* -- Player + info column -- */}
      {/* Mobile: shrink-0 at the top of the flex column.   */}
      {/* Desktop: right grid column (order-2).             */}
      <div className="shrink-0 md:order-2 md:flex md:flex-col md:gap-4">
        <div className="bg-black md:rounded-xl md:overflow-hidden">
          <PlayerEmbed ytVideoId={ytVideoId} playerElRef={playerElRef} />
        </div>

        {/* Desktop-only: video info below the player */}
        <div className="hidden md:block px-1">
          <VideoInfo {...videoInfoProps} />
        </div>
      </div>

      {/* -- Scrollable content -- */}
      {/* Mobile: flex-1 fills remaining height, scrolls independently.    */}
      {/* Desktop: left grid column (order-1), independently scrollable.   */}
      <div className="flex-1 min-h-0 overflow-y-auto md:order-1">
        {/* Mobile-only: video info + divider */}
        <div className="md:hidden px-4 pt-3 pb-2">
          <VideoInfo {...videoInfoProps} />
          <div className="h-px bg-border mt-3" />
        </div>

        {/* Desktop-only: section header */}
        <div className="hidden md:flex items-center gap-2 mb-3">
          <h2 className="text-sm font-semibold">Product Mentions</h2>
          {uniqueProducts > 0 && (
            <Badge variant="secondary" className="text-[11px]">
              {uniqueProducts} product{uniqueProducts !== 1 ? 's' : ''}
            </Badge>
          )}
        </div>

        <div className="px-4 py-3 md:px-0 md:py-0 md:pr-4">
          {mentionsContent}
        </div>
      </div>
    </div>
  )
}
