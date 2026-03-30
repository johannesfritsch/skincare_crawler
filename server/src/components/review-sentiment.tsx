'use client'

import React from 'react'
import { cn } from '@/lib/utils'

// ─── Topic Labels ────────────────────────────────────────────────────────────

const TOPIC_LABELS: Record<string, string> = {
  smell: 'Smell',
  texture: 'Texture',
  color: 'Color',
  consistency: 'Consistency',
  absorption: 'Absorption',
  stickiness: 'Stickiness',
  lather: 'Lather',
  efficacy: 'Efficacy',
  longevity: 'Longevity',
  finish: 'Finish',
  afterFeel: 'After Feel',
  skinTolerance: 'Skin Tolerance',
  allergenPotential: 'Allergen Risk',
  dispensing: 'Dispensing',
  travelSafety: 'Travel Safety',
  animalTesting: 'Animal Testing',
}

function topicLabel(topic: string): string {
  return TOPIC_LABELS[topic] ?? topic
}

// ─── Shared Card ─────────────────────────────────────────────────────────────

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-xl border bg-card px-4 py-3.5', className)}>
      {children}
    </div>
  )
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SentimentData {
  topic: string
  positive: number
  neutral: number
  negative: number
}

export interface ConclusionData {
  topic: string
  conclusion: 'positive' | 'negative' | 'divided'
  strength: 'low' | 'medium' | 'high' | 'ultra'
  volume: number | null
}

interface ReviewSentimentProps {
  sentiments: SentimentData[]
  conclusions: ConclusionData[]
}

// ─── Conversational Summary ──────────────────────────────────────────────────

function TopicChips({ topics }: { topics: string[] }) {
  return (
    <span className="text-foreground/70">
      {topics.map((t, i) => (
        <React.Fragment key={t}>
          {i > 0 && <span className="text-muted-foreground/40">, </span>}
          {t}
        </React.Fragment>
      ))}
    </span>
  )
}

function ConversationalSummary({ conclusions }: { conclusions: ConclusionData[] }) {
  const strengthOrder = { ultra: 0, high: 1, medium: 2, low: 3 }
  const sorted = [...conclusions].sort((a, b) => strengthOrder[a.strength] - strengthOrder[b.strength])

  const loved = sorted.filter(c => c.conclusion === 'positive')
  const debated = sorted.filter(c => c.conclusion === 'divided')
  const concerns = sorted.filter(c => c.conclusion === 'negative')

  if (loved.length === 0 && debated.length === 0 && concerns.length === 0) return null

  return (
    <Card>
      <div className="space-y-2">
        {loved.length > 0 && (
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 text-emerald-600 text-[10px] font-bold shrink-0">+</span>
            <p className="text-sm leading-relaxed">
              <span className="font-semibold text-emerald-700">Loved: </span>
              <TopicChips topics={loved.map(c => topicLabel(c.topic))} />
            </p>
          </div>
        )}
        {debated.length > 0 && (
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 text-amber-600 text-[10px] font-bold shrink-0">~</span>
            <p className="text-sm leading-relaxed">
              <span className="font-semibold text-amber-700">Debated: </span>
              <TopicChips topics={debated.map(c => topicLabel(c.topic))} />
            </p>
          </div>
        )}
        {concerns.length > 0 && (
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-rose-100 text-rose-600 text-[10px] font-bold shrink-0">&minus;</span>
            <p className="text-sm leading-relaxed">
              <span className="font-semibold text-rose-700">Concerns: </span>
              <TopicChips topics={concerns.map(c => topicLabel(c.topic))} />
            </p>
          </div>
        )}
      </div>
    </Card>
  )
}

// ─── Percentage Bar Chart (pure CSS) ─────────────────────────────────────────

/** Minimum percentage of max topic volume to be shown (filters noise) */
const MIN_VOLUME_PERCENT = 0.1 // 10% of the highest-volume topic

interface BarRow {
  label: string
  positivePercent: number
  negativePercent: number
  total: number
  positiveRaw: number
  negativeRaw: number
}

function buildBarData(sentiments: SentimentData[]): BarRow[] {
  const rows = sentiments
    .map(s => {
      const pos = s.positive + s.neutral
      const neg = s.negative
      const total = pos + neg
      return {
        label: topicLabel(s.topic),
        positivePercent: total > 0 ? Math.round((pos / total) * 100) : 0,
        negativePercent: total > 0 ? Math.round((neg / total) * 100) : 0,
        total,
        positiveRaw: pos,
        negativeRaw: neg,
      }
    })
    .filter(r => r.total > 0)
    .sort((a, b) => b.total - a.total)

  if (rows.length === 0) return []

  const maxVolume = rows[0].total
  return rows.filter(r => r.total >= maxVolume * MIN_VOLUME_PERCENT)
}

function SentimentBars({ sentiments }: { sentiments: SentimentData[] }) {
  const data = buildBarData(sentiments)
  if (data.length === 0) return null

  return (
    <Card>
      <div className="space-y-2">
        {data.map(row => (
          <div key={row.label} className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground w-24 text-right shrink-0 leading-tight">{row.label}</span>
            <div className="flex-1 flex items-center h-5 rounded-full bg-muted/30 overflow-hidden">
              {row.negativePercent > 0 && (
                <div
                  className="h-full bg-rose-400 rounded-l-full"
                  style={{ width: `${row.negativePercent}%` }}
                  title={`${row.negativeRaw} negative (${row.negativePercent}%)`}
                />
              )}
              {row.positivePercent > 0 && (
                <div
                  className={cn(
                    'h-full bg-emerald-400 rounded-r-full',
                    row.negativePercent === 0 && 'rounded-l-full',
                  )}
                  style={{ width: `${row.positivePercent}%` }}
                  title={`${row.positiveRaw} positive (${row.positivePercent}%)`}
                />
              )}
            </div>
            <span className="text-[10px] text-muted-foreground w-8 shrink-0 tabular-nums">{row.positivePercent}%</span>
          </div>
        ))}
      </div>
    </Card>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function ReviewSentiment({ sentiments, conclusions }: ReviewSentimentProps) {
  if (sentiments.length === 0 && conclusions.length === 0) return null

  return (
    <div className="flex flex-col gap-2.5">
      <ConversationalSummary conclusions={conclusions} />
      <SentimentBars sentiments={sentiments} />
    </div>
  )
}
