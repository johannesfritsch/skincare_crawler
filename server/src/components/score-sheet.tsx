'use client'

import React, { useState } from 'react'
import {
  Star,
  ExternalLink,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { StoreLogo } from '@/components/store-logos'

/* ── Types ── */

export interface CreatorChannel {
  channelId: number
  platform: string | null
  externalUrl: string | null
  imageUrl: string | null
}

export interface CreatorScoreItem {
  creatorId: number | null
  creatorName: string | null
  channelImageUrl: string | null
  mentionCount: number
  avgSentimentScore: number | null
  positiveCount: number
  negativeCount: number
  neutralCount: number
  mixedCount: number
  channels: CreatorChannel[]
}

export interface StoreScoreItem {
  id: number
  source: string | null
  name: string | null
  sourceUrl: string | null
  rating: number | null
  ratingNum: number | null
}

/* ── Score tier system (0–10 scale) ── */

type ScoreTier = 'low' | 'mid' | 'good' | 'great' | 'gold'

/** Map a 0–10 score to a color tier */
function scoreTier(score: number): ScoreTier {
  if (score >= 9)   return 'gold'
  if (score >= 7.5) return 'great'
  if (score >= 5)   return 'good'
  if (score >= 3)   return 'mid'
  return 'low'
}

/** Text color class for the score number */
const tierTextColor: Record<ScoreTier, string> = {
  low:   'text-red-500',
  mid:   'text-amber-500',
  good:  'text-emerald-600',
  great: 'text-emerald-600',
  gold:  'score-gold-shimmer', /* animated gradient via CSS */
}

/** Card background + border classes */
const tierCardBg: Record<ScoreTier, string> = {
  low:   'bg-red-50 border-red-200/60',
  mid:   'bg-amber-50 border-amber-200/60',
  good:  'bg-emerald-50 border-emerald-200/60',
  great: 'bg-emerald-50 border-emerald-200/60',
  gold:  'bg-amber-50/60 score-gold-border',
}

/** Divider color inside the card (between score and avatars/logos) */
const tierDivider: Record<ScoreTier, string> = {
  low:   'border-red-300/30',
  mid:   'border-amber-300/30',
  good:  'border-emerald-300/30',
  great: 'border-emerald-300/30',
  gold:  'border-amber-400/40',
}

/* ── Helpers ── */

/** Convert raw sentiment (-1 to +1) to 0–10 display string */
function toScore10(raw: number): string {
  return ((raw + 1) * 5).toFixed(1)
}

/** Convert raw sentiment (-1 to +1) to numeric 0–10 value */
function toScore10Num(raw: number): number {
  return (raw + 1) * 5
}

/** Convert 0–5 star rating to 0–10 scale */
function starsToScore10(stars: number): number {
  return stars * 2
}

function storeLabel(slug: string | null): string {
  switch (slug) {
    case 'dm': return 'dm'
    case 'rossmann': return 'Rossmann'
    case 'mueller': return 'Müller'
    default: return slug ?? 'Unknown'
  }
}

function platformLabel(platform: string | null): string {
  switch (platform) {
    case 'youtube': return 'YouTube'
    case 'instagram': return 'Instagram'
    case 'tiktok': return 'TikTok'
    default: return platform ?? 'Channel'
  }
}

function PlatformIcon({ platform, className }: { platform: string | null; className?: string }) {
  const cls = cn('shrink-0', className)
  switch (platform) {
    case 'youtube':
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="currentColor">
          <path d="M23.5 6.19a3.02 3.02 0 0 0-2.12-2.14C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.38.55A3.02 3.02 0 0 0 .5 6.19 31.6 31.6 0 0 0 0 12a31.6 31.6 0 0 0 .5 5.81 3.02 3.02 0 0 0 2.12 2.14c1.87.55 9.38.55 9.38.55s7.5 0 9.38-.55a3.02 3.02 0 0 0 2.12-2.14A31.6 31.6 0 0 0 24 12a31.6 31.6 0 0 0-.5-5.81zM9.75 15.02V8.98L15.5 12l-5.75 3.02z" />
        </svg>
      )
    case 'instagram':
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="currentColor">
          <path d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.97.24 2.44.41.61.24 1.05.52 1.51.98.46.46.74.9.98 1.51.17.47.36 1.27.41 2.44.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.24 1.97-.41 2.44-.24.61-.52 1.05-.98 1.51-.46.46-.9.74-1.51.98-.47.17-1.27.36-2.44.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.97-.24-2.44-.41a4.07 4.07 0 0 1-1.51-.98 4.07 4.07 0 0 1-.98-1.51c-.17-.47-.36-1.27-.41-2.44C2.17 15.58 2.16 15.2 2.16 12s.01-3.58.07-4.85c.05-1.17.24-1.97.41-2.44.24-.61.52-1.05.98-1.51a4.07 4.07 0 0 1 1.51-.98c.47-.17 1.27-.36 2.44-.41C8.84 2.17 9.22 2.16 12 2.16zM12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63a5.77 5.77 0 0 0-2.09 1.36A5.77 5.77 0 0 0 .69 4.08C.39 4.84.19 5.72.13 6.99.07 8.27.06 8.68.06 11.94s.01 3.67.07 4.95c.06 1.27.26 2.15.56 2.91.31.8.72 1.47 1.36 2.09.62.64 1.29 1.05 2.09 1.36.76.3 1.64.5 2.91.56 1.28.06 1.69.07 4.95.07s3.67-.01 4.95-.07c1.27-.06 2.15-.26 2.91-.56a5.77 5.77 0 0 0 2.09-1.36 5.77 5.77 0 0 0 1.36-2.09c.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91a5.77 5.77 0 0 0-1.36-2.09A5.77 5.77 0 0 0 19.86.69c-.76-.3-1.64-.5-2.91-.56C15.67.07 15.26.06 12 .06V0zm0 5.84a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.41-11.85a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88z" />
        </svg>
      )
    case 'tiktok':
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="currentColor">
          <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.3 0 .59.04.86.12V9.01a6.32 6.32 0 0 0-.86-.06C6.36 8.95 3.6 11.71 3.6 15.13a6.15 6.15 0 0 0 6.15 5.46 6.39 6.39 0 0 0 6.39-6.39V9.13a8.22 8.22 0 0 0 4.84 1.56V7.24c-.86 0-1.7-.2-2.45-.55h-.94z" />
        </svg>
      )
    default:
      return <ExternalLink className={cls} />
  }
}

const platformColor: Record<string, string> = {
  youtube: 'text-red-600 hover:bg-red-50',
  instagram: 'text-pink-600 hover:bg-pink-50',
  tiktok: 'text-foreground hover:bg-muted/60',
}

/* ── Creator Score Card + Sheet ── */

export function CreatorScoreCard({
  avgSentiment,
  totalMentions,
  creators,
}: {
  avgSentiment: number
  totalMentions: number
  creators: CreatorScoreItem[]
}) {
  const [open, setOpen] = useState(false)

  const sorted = [...creators].sort((a, b) => b.mentionCount - a.mentionCount)
  const score = toScore10Num(avgSentiment)
  const tier = scoreTier(score)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'inline-flex items-center gap-2.5 rounded-xl border px-3.5 py-2 text-left transition-colors active:scale-[0.98] touch-manipulation',
          tierCardBg[tier],
        )}
      >
        <div className="flex flex-col">
          <span className={cn('text-xl font-bold leading-tight', tierTextColor[tier])}>
            {score.toFixed(1)}
          </span>
          <span className="text-[10px] text-muted-foreground leading-tight">
            Creator Score
          </span>
        </div>
        {sorted.length > 0 && (
          <div className={cn('flex items-center -space-x-1.5 ml-1 pl-2.5 border-l', tierDivider[tier])}>
            {sorted.slice(0, 5).map((cs) => (
              <Avatar key={cs.creatorId ?? 'unknown'} size="sm" className="size-6 ring-2 ring-background">
                {cs.channelImageUrl && <AvatarImage src={cs.channelImageUrl} alt={cs.creatorName ?? ''} />}
                <AvatarFallback className="text-[7px]">
                  {(cs.creatorName ?? '?').slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            ))}
            {sorted.length > 5 && (
              <span className="flex items-center justify-center size-6 rounded-full bg-muted text-[9px] font-medium text-muted-foreground ring-2 ring-background">
                +{sorted.length - 5}
              </span>
            )}
          </div>
        )}
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" showCloseButton={false} className="rounded-t-2xl max-h-[85dvh] overflow-hidden flex flex-col">
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-0">
            <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
          </div>
          <SheetHeader className="pb-0 pt-2">
            <SheetTitle className="text-base">Creator Scores</SheetTitle>
            <SheetDescription className="text-xs">
              Sentiment scores from {totalMentions} video mention{totalMentions !== 1 ? 's' : ''} by {creators.length} creator{creators.length !== 1 ? 's' : ''}
            </SheetDescription>
          </SheetHeader>
          <div className="overflow-y-auto flex-1 -mx-4 px-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
            <div className="space-y-2 pt-1">
              {sorted.map((cs) => {
                const rowScore = cs.avgSentimentScore != null ? toScore10Num(Number(cs.avgSentimentScore)) : null
                const rowTier = scoreTier(rowScore ?? 5)
                return (
                  <div
                    key={cs.creatorId ?? 'unknown'}
                    className={cn(
                      'rounded-xl border overflow-hidden',
                      tierCardBg[rowTier],
                    )}
                  >
                    {/* Creator header */}
                    <div className="flex items-center gap-3 px-3.5 py-3">
                      <Avatar>
                        {cs.channelImageUrl && <AvatarImage src={cs.channelImageUrl} alt={cs.creatorName ?? ''} />}
                        <AvatarFallback className="text-xs">
                          {(cs.creatorName ?? '?').slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{cs.creatorName ?? 'Unknown'}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {cs.mentionCount} mention{cs.mentionCount !== 1 ? 's' : ''}
                        </p>
                      </div>
                      <span className={cn('text-lg font-bold shrink-0', tierTextColor[rowTier])}>
                        {rowScore != null ? rowScore.toFixed(1) : '—'}
                      </span>
                    </div>

                    {/* Channel links */}
                    {cs.channels.length > 0 && (
                      <div className="flex items-center gap-1.5 px-3.5 pb-3 pt-0">
                        {cs.channels.map((ch) => {
                          const color = platformColor[ch.platform ?? ''] ?? 'text-muted-foreground hover:bg-muted/60'
                          return ch.externalUrl ? (
                            <a
                              key={ch.channelId}
                              href={ch.externalUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={cn(
                                'inline-flex items-center gap-1.5 rounded-lg border border-current/10 bg-white/60 px-2.5 py-1.5 text-[11px] font-medium transition-colors active:scale-[0.97] touch-manipulation',
                                color,
                              )}
                            >
                              <PlatformIcon platform={ch.platform} className="h-3.5 w-3.5" />
                              {platformLabel(ch.platform)}
                              <ExternalLink className="h-3 w-3 opacity-40" />
                            </a>
                          ) : (
                            <span
                              key={ch.channelId}
                              className={cn(
                                'inline-flex items-center gap-1.5 rounded-lg border border-current/10 bg-white/60 px-2.5 py-1.5 text-[11px] font-medium',
                                color,
                              )}
                            >
                              <PlatformIcon platform={ch.platform} className="h-3.5 w-3.5" />
                              {platformLabel(ch.platform)}
                            </span>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

/* ── Store Score Card + Sheet ── */

export function StoreScoreCard({
  avgStoreRating,
  stores,
}: {
  avgStoreRating: number
  stores: StoreScoreItem[]
}) {
  const [open, setOpen] = useState(false)

  const ratedStores = stores.filter(s => s.rating != null && s.ratingNum != null && (s.ratingNum as number) > 0)
  const score = starsToScore10(avgStoreRating)
  const tier = scoreTier(score)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'inline-flex items-center gap-2.5 rounded-xl border px-3.5 py-2 text-left transition-colors active:scale-[0.98] touch-manipulation',
          tierCardBg[tier],
        )}
      >
        <div className="flex flex-col">
          <span className={cn('text-xl font-bold leading-tight', tierTextColor[tier])}>
            {score.toFixed(1)}
          </span>
          <span className="text-[10px] text-muted-foreground leading-tight">
            Store Score
          </span>
        </div>
        <div className={cn('flex items-center gap-1.5 ml-1 pl-2.5 border-l', tierDivider[tier])}>
          {ratedStores.map((sp) => (
            <div key={sp.id} className="shrink-0 flex items-center">
              <StoreLogo source={sp.source ?? ''} className="!h-5" />
            </div>
          ))}
        </div>
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" showCloseButton={false} className="rounded-t-2xl max-h-[85dvh] overflow-hidden flex flex-col">
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-0">
            <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
          </div>
          <SheetHeader className="pb-0 pt-2">
            <SheetTitle className="text-base">Store Ratings</SheetTitle>
            <SheetDescription className="text-xs">
              Customer ratings from {ratedStores.length} store{ratedStores.length !== 1 ? 's' : ''}
            </SheetDescription>
          </SheetHeader>
          <div className="overflow-y-auto flex-1 -mx-4 px-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
            <div className="space-y-2 pt-1">
              {ratedStores
                .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
                .map((sp) => {
                  const rowScore = starsToScore10(Number(sp.rating))
                  const rowTier = scoreTier(rowScore)
                  const Row = sp.sourceUrl ? 'a' : 'div'
                  const linkProps = sp.sourceUrl
                    ? { href: sp.sourceUrl, target: '_blank' as const, rel: 'noopener noreferrer' }
                    : {}
                  return (
                    <Row
                      key={sp.id}
                      {...linkProps}
                      className={cn(
                        'flex items-center gap-3 rounded-xl border px-3.5 py-3',
                        tierCardBg[rowTier],
                        sp.sourceUrl && 'active:opacity-80 touch-manipulation transition-colors',
                      )}
                    >
                      <div className="shrink-0 flex items-center justify-center rounded-lg bg-white border border-border/60 size-10 p-1.5">
                        <StoreLogo source={sp.source ?? ''} className="!h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{storeLabel(sp.source)}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {sp.ratingNum?.toLocaleString()} review{sp.ratingNum !== 1 ? 's' : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                        <span className={cn('text-lg font-bold', tierTextColor[rowTier])}>
                          {rowScore.toFixed(1)}
                        </span>
                      </div>
                      {sp.sourceUrl && (
                        <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                    </Row>
                  )
                })}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
