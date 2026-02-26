import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'

/* ── Score tier system (0–10 scale) ── */

export type ScoreTier = 'low' | 'mid' | 'good' | 'great' | 'gold'

/** Map a 0–10 score to a color tier. Pass `gold: true` to enable the gold shimmer for scores >= 9 (default: caps at 'great'). */
export function scoreTier(score: number, opts?: { gold?: boolean }): ScoreTier {
  if (score >= 9 && opts?.gold) return 'gold'
  if (score >= 7.5) return 'great'
  if (score >= 5)   return 'good'
  if (score >= 3)   return 'mid'
  return 'low'
}

/** Text color class for the score number */
export const tierTextColor: Record<ScoreTier, string> = {
  low:   'text-red-500',
  mid:   'text-amber-500',
  good:  'text-emerald-600',
  great: 'text-emerald-600',
  gold:  'score-gold-shimmer', /* animated gradient via CSS */
}

/** Card background + border classes */
export const tierCardBg: Record<ScoreTier, string> = {
  low:   'bg-red-50 border-red-200/60',
  mid:   'bg-amber-50 border-amber-200/60',
  good:  'bg-emerald-50 border-emerald-200/60',
  great: 'bg-emerald-50 border-emerald-200/60',
  gold:  'bg-amber-50/60 score-gold-border',
}

/** Compact badge background + border (for score indicators on neutral cards) */
export const tierBadgeBg: Record<ScoreTier, string> = {
  low:   'bg-red-50 border-red-200/60',
  mid:   'bg-amber-50 border-amber-200/60',
  good:  'bg-emerald-50 border-emerald-200/60',
  great: 'bg-emerald-50 border-emerald-200/60',
  gold:  'bg-amber-50/60 score-gold-border',
}

/** Divider color inside the card (between score and avatars/logos) */
export const tierDivider: Record<ScoreTier, string> = {
  low:   'border-red-300/30',
  mid:   'border-amber-300/30',
  good:  'border-emerald-300/30',
  great: 'border-emerald-300/30',
  gold:  'border-amber-400/40',
}

/* ── Helpers ── */

/** Convert 0–5 star rating to 0–10 scale */
export function starsToScore10(stars: number): number {
  return stars * 2
}

/** Map source slug to display name */
export function storeLabel(slug: string | null): string {
  switch (slug) {
    case 'dm': return 'dm'
    case 'rossmann': return 'Rossmann'
    case 'mueller': return 'Müller'
    default: return slug ?? 'Unknown'
  }
}

/** Small score indicator badge with star + number, colored by tier */
export function ScoreBadge({ score, className }: { score: number; className?: string }) {
  const n = Number(score)
  const tier = scoreTier(n)
  return (
    <div className={cn('inline-flex items-center gap-1 rounded-lg border px-2 py-1', tierBadgeBg[tier], className)}>
      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
      <span className={cn('text-sm font-bold leading-tight', tierTextColor[tier])}>
        {n.toFixed(1)}
      </span>
    </div>
  )
}
