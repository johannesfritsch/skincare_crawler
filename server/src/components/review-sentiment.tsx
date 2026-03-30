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

// ─── Left-aligned Volume Bars (pure CSS) ─────────────────────────────────────

/** Minimum percentage of max topic volume to be shown (filters noise) */
const MIN_VOLUME_PERCENT = 0.1

interface BarRow {
  label: string
  total: number
  positiveRaw: number
  negativeRaw: number
}

function buildBarData(sentiments: SentimentData[]): { rows: BarRow[]; maxVolume: number } {
  const rows = sentiments
    .map(s => {
      const pos = s.positive + s.neutral
      const neg = s.negative
      return {
        label: topicLabel(s.topic),
        total: pos + neg,
        positiveRaw: pos,
        negativeRaw: neg,
      }
    })
    .filter(r => r.total > 0)
    .sort((a, b) => b.total - a.total)

  if (rows.length === 0) return { rows: [], maxVolume: 0 }

  const maxVolume = rows[0].total
  return { rows: rows.filter(r => r.total >= maxVolume * MIN_VOLUME_PERCENT), maxVolume }
}

/** Threshold for high-volume tier (% of max topic volume) */
const HIGH_VOLUME_THRESHOLD = 0.3

function SentimentBar({ row }: { row: BarRow }) {
  const greenPercent = (row.positiveRaw / row.total) * 100
  const redPercent = (row.negativeRaw / row.total) * 100
  const redDominant = row.negativeRaw > row.positiveRaw

  return (
    <div>
      <div
        className="h-6 rounded-md overflow-hidden flex"
        title={`${row.positiveRaw} positive, ${row.negativeRaw} negative`}
      >
        {redDominant ? (
          <>
            {row.negativeRaw > 0 && (
              <div className="h-full bg-rose-400" style={{ width: `${redPercent}%` }} />
            )}
            {row.positiveRaw > 0 && (
              <div className="h-full bg-emerald-400" style={{ width: `${greenPercent}%` }} />
            )}
          </>
        ) : (
          <>
            {row.positiveRaw > 0 && (
              <div className="h-full bg-emerald-400" style={{ width: `${greenPercent}%` }} />
            )}
            {row.negativeRaw > 0 && (
              <div className="h-full bg-rose-400" style={{ width: `${redPercent}%` }} />
            )}
          </>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground mt-0.5 mb-1">{row.label}</p>
    </div>
  )
}

function SentimentBars({ sentiments }: { sentiments: SentimentData[] }) {
  const { rows, maxVolume } = buildBarData(sentiments)
  if (rows.length === 0) return null

  const threshold = maxVolume * HIGH_VOLUME_THRESHOLD
  const highVolume = rows.filter(r => r.total >= threshold)
  const lowVolume = rows.filter(r => r.total < threshold)

  return (
    <Card>
      {/* High-volume topics: full-width rows */}
      {highVolume.length > 0 && (
        <div className="space-y-1">
          {highVolume.map(row => <SentimentBar key={row.label} row={row} />)}
        </div>
      )}
      {/* Low-volume topics: 2-column grid */}
      {lowVolume.length > 0 && (
        <div className={cn('grid grid-cols-2 gap-x-2.5 gap-y-1', highVolume.length > 0 && 'mt-2')}>
          {lowVolume.map(row => <SentimentBar key={row.label} row={row} />)}
          {lowVolume.length % 2 !== 0 && (
            <div>
              <div className="h-6 rounded-md bg-muted/25" />
            </div>
          )}
        </div>
      )}
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
