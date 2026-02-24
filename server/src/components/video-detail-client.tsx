'use client'

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import {
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

function sentimentBg(s: string | null) {
  switch (s) {
    case 'positive':
      return 'bg-emerald-50 border-emerald-200 hover:bg-emerald-100/80'
    case 'negative':
      return 'bg-red-50 border-red-200 hover:bg-red-100/80'
    case 'mixed':
      return 'bg-amber-50 border-amber-200 hover:bg-amber-100/80'
    default:
      return 'bg-muted/30 border-border hover:bg-muted/50'
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

/** 16:9 YouTube player container — uses a ref so only one DOM node exists */
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
    <div className="relative w-full bg-black md:rounded-xl md:overflow-hidden" style={{ paddingBottom: '56.25%' }}>
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

/** A single snippet block with its mentions & quotes */
function SnippetBlock({
  snippet,
  seekTo,
}: {
  snippet: {
    timestampStart: number | null
    timestampEnd: number | null
    transcript: string | null
    mentions: VideoMentionItem[]
  }
  seekTo: (seconds: number) => void
}) {
  return (
    <div className="flex flex-col gap-2.5">
      {/* Timestamp pill */}
      <button
        onClick={() => snippet.timestampStart != null && seekTo(snippet.timestampStart)}
        className="flex items-center gap-1.5 text-xs font-mono font-medium text-primary bg-primary/5 hover:bg-primary/10 px-2.5 py-1 rounded-full self-start transition-colors"
      >
        <Clock className="h-3 w-3" />
        {formatTimestamp(snippet.timestampStart)}
        {snippet.timestampEnd != null && (
          <span className="text-muted-foreground font-sans">
            &ndash; {formatTimestamp(snippet.timestampEnd)}
          </span>
        )}
      </button>

      {/* Snippet transcript */}
      {snippet.transcript && (
        <button
          onClick={() => snippet.timestampStart != null && seekTo(snippet.timestampStart)}
          className="text-left text-[13px] text-muted-foreground leading-relaxed bg-muted/40 rounded-xl px-4 py-3 italic hover:bg-muted/60 transition-colors border border-transparent hover:border-border/50"
        >
          <MessageCircle className="h-3.5 w-3.5 inline mr-2 -mt-0.5 text-muted-foreground/50" />
          &ldquo;{snippet.transcript}&rdquo;
        </button>
      )}

      {/* Mentions within this snippet */}
      {snippet.mentions.map((mention) => (
        <div key={mention.id} className="flex flex-col gap-2 pl-3 border-l-2 border-primary/15">
          {/* Product card */}
          <Link
            href={mention.productGtin ? `/products/${mention.productGtin}` : '#'}
            className="flex gap-3 rounded-xl border bg-card p-3 transition-all hover:shadow-sm active:bg-muted/60 hover:border-primary/20"
          >
            <div className="h-11 w-11 shrink-0 rounded-lg bg-muted/50 flex items-center justify-center overflow-hidden p-1">
              {mention.productImageUrl ? (
                <Image
                  src={mention.productImageUrl}
                  alt={mention.productName ?? 'Product'}
                  width={96}
                  height={96}
                  className="h-full w-full object-contain"
                  sizes="44px"
                />
              ) : (
                <span className="text-sm font-semibold text-muted-foreground/30">
                  {(mention.productName ?? '?')[0]?.toUpperCase()}
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {mention.productName ?? 'Unknown product'}
              </p>
              <div className="flex items-center gap-2 mt-0.5">
                {mention.brandName && (
                  <span className="text-xs text-muted-foreground truncate">
                    {mention.brandName}
                  </span>
                )}
                {mention.overallSentiment && (
                  <Badge variant="secondary" className="text-[10px] h-4 px-1.5 gap-1">
                    <SentimentIcon sentiment={mention.overallSentiment} className="h-3 w-3" />
                    <span className={sentimentColor(mention.overallSentiment)}>
                      {mention.overallSentiment}
                    </span>
                  </Badge>
                )}
              </div>
            </div>
          </Link>

          {/* Quotes */}
          {mention.quotes.map((quote, qi) => (
            <button
              key={qi}
              onClick={() => snippet.timestampStart != null && seekTo(snippet.timestampStart)}
              className={`text-left rounded-xl border px-3.5 py-2.5 text-[13px] leading-relaxed transition-colors ${sentimentBg(quote.sentiment)}`}
            >
              <div className="flex items-start gap-2">
                <SentimentIcon sentiment={quote.sentiment} className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <p>&ldquo;{quote.text}&rdquo;</p>
              </div>
            </button>
          ))}
        </div>
      ))}
    </div>
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
}: VideoDetailClientProps) {
  const playerRef = useRef<YTPlayer | null>(null)
  const playerElRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [playerReady, setPlayerReady] = useState(false)
  const [isDesktop, setIsDesktop] = useState(false)

  const ytVideoId = externalUrl ? extractYouTubeId(externalUrl) : null

  /* Track viewport size to render player in the correct layout branch */
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    setIsDesktop(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

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
    // Re-mount the player when layout changes (mobile ↔ desktop)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ytVideoId, isDesktop])

  const seekTo = useCallback(
    (seconds: number) => {
      if (playerRef.current && playerReady) {
        playerRef.current.seekTo(seconds, true)
        playerRef.current.playVideo()
      }
    },
    [playerReady],
  )

  /* Group mentions by snippet */
  const snippetMap = new Map<
    number,
    { timestampStart: number | null; timestampEnd: number | null; transcript: string | null; mentions: VideoMentionItem[] }
  >()
  for (const m of mentions) {
    let entry = snippetMap.get(m.snippetId)
    if (!entry) {
      entry = { timestampStart: m.timestampStart, timestampEnd: m.timestampEnd, transcript: m.snippetTranscript, mentions: [] }
      snippetMap.set(m.snippetId, entry)
    }
    entry.mentions.push(m)
  }
  const snippets = Array.from(snippetMap.values()).sort(
    (a, b) => (a.timestampStart ?? 0) - (b.timestampStart ?? 0),
  )

  // Unique product count
  const uniqueProducts = new Set(mentions.map((m) => m.productId)).size

  const formattedDate = publishedAt
    ? new Date(publishedAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : null

  /* Mentions list content (shared between mobile & desktop) */
  const mentionsContent = (
    <>
      {snippets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Package className="h-8 w-8 text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">No product mentions found in this video.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {snippets.map((snippet, idx) => (
            <SnippetBlock key={idx} snippet={snippet} seekTo={seekTo} />
          ))}
        </div>
      )}
    </>
  )

  return (
    <>
      {/* ============================================================ */}
      {/*  MOBILE layout: player on top, scrollable content below      */}
      {/* ============================================================ */}
      <div className="md:hidden -mx-4 -mt-4 flex flex-col h-[calc(100dvh-3rem-5.5rem-env(safe-area-inset-bottom,0px)-env(safe-area-inset-top,0px))]">
        <div className="shrink-0 w-full bg-black">
          {!isDesktop && <PlayerEmbed ytVideoId={ytVideoId} playerElRef={playerElRef} />}
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="px-4 pt-3 pb-2">
            <VideoInfo
              title={title}
              creatorName={creatorName}
              channelPlatform={channelPlatform}
              formattedDate={formattedDate}
              viewCount={viewCount}
              likeCount={likeCount}
              externalUrl={externalUrl}
              mentionCount={uniqueProducts}
            />
          </div>
          <div className="h-px bg-border mx-4 my-2" />
          <div className="px-4 py-3">{mentionsContent}</div>
        </div>
      </div>

      {/* ============================================================ */}
      {/*  DESKTOP layout: mentions left, player+info right (sticky)    */}
      {/* ============================================================ */}
      <div className="hidden md:flex -mx-4 -mt-4 gap-6 px-6 pt-5 pb-6 h-[calc(100dvh-3rem-5.5rem-env(safe-area-inset-bottom,0px)-env(safe-area-inset-top,0px))]">
        {/* Left column — scrollable mentions */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 mb-3 shrink-0">
            <h2 className="text-sm font-semibold">Product Mentions</h2>
            {uniqueProducts > 0 && (
              <Badge variant="secondary" className="text-[11px]">
                {uniqueProducts} product{uniqueProducts !== 1 ? 's' : ''}
              </Badge>
            )}
          </div>

          <div className="flex-1 overflow-y-auto pr-1 -mr-1">
            {mentionsContent}
          </div>
        </div>

        {/* Right column — player + info, sticky */}
        <div className="w-[42%] shrink-0 flex flex-col gap-4">
          {isDesktop && <PlayerEmbed ytVideoId={ytVideoId} playerElRef={playerElRef} />}

          <div className="px-1">
            <VideoInfo
              title={title}
              creatorName={creatorName}
              channelPlatform={channelPlatform}
              formattedDate={formattedDate}
              viewCount={viewCount}
              likeCount={likeCount}
              externalUrl={externalUrl}
              mentionCount={uniqueProducts}
            />
          </div>
        </div>
      </div>
    </>
  )
}
