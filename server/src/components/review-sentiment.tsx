'use client'

import React from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'

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

function ConversationalSummary({ conclusions }: { conclusions: ConclusionData[] }) {
  const strengthOrder = { ultra: 0, high: 1, medium: 2, low: 3 }
  const sorted = [...conclusions].sort((a, b) => strengthOrder[a.strength] - strengthOrder[b.strength])

  const loved = sorted.filter(c => c.conclusion === 'positive')
  const debated = sorted.filter(c => c.conclusion === 'divided')
  const concerns = sorted.filter(c => c.conclusion === 'negative')

  if (loved.length === 0 && debated.length === 0 && concerns.length === 0) return null

  return (
    <div className="space-y-2 mb-4">
      {loved.length > 0 && (
        <div className="flex items-start gap-2">
          <span className="text-emerald-500 shrink-0 mt-0.5">&#x2705;</span>
          <p className="text-sm">
            <span className="font-medium text-emerald-700">Loved:</span>{' '}
            <span className="text-foreground/80">{loved.map(c => topicLabel(c.topic)).join(', ')}</span>
          </p>
        </div>
      )}
      {debated.length > 0 && (
        <div className="flex items-start gap-2">
          <span className="text-amber-500 shrink-0 mt-0.5">&#x26A0;&#xFE0F;</span>
          <p className="text-sm">
            <span className="font-medium text-amber-700">Debated:</span>{' '}
            <span className="text-foreground/80">{debated.map(c => topicLabel(c.topic)).join(', ')}</span>
          </p>
        </div>
      )}
      {concerns.length > 0 && (
        <div className="flex items-start gap-2">
          <span className="text-rose-500 shrink-0 mt-0.5">&#x274C;</span>
          <p className="text-sm">
            <span className="font-medium text-rose-700">Concerns:</span>{' '}
            <span className="text-foreground/80">{concerns.map(c => topicLabel(c.topic)).join(', ')}</span>
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Pyramid Chart ───────────────────────────────────────────────────────────

interface PyramidRow {
  label: string
  positive: number // positive + neutral combined (right side)
  negative: number // negative as negative number (left side)
  positiveRaw: number
  negativeRaw: number
  total: number
}

function buildPyramidData(sentiments: SentimentData[]): PyramidRow[] {
  return sentiments
    .map(s => ({
      label: topicLabel(s.topic),
      positive: s.positive + s.neutral,
      negative: -s.negative,
      positiveRaw: s.positive + s.neutral,
      negativeRaw: s.negative,
      total: s.positive + s.neutral + s.negative,
    }))
    .filter(r => r.total > 0)
    .sort((a, b) => b.total - a.total)
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: PyramidRow }> }) {
  if (!active || !payload?.[0]) return null
  const row = payload[0].payload
  const total = row.positiveRaw + row.negativeRaw
  const posPercent = total > 0 ? Math.round((row.positiveRaw / total) * 100) : 0
  return (
    <div className="rounded-lg bg-background border border-border px-3 py-2 shadow-md text-xs">
      <p className="font-medium mb-1">{row.label}</p>
      <p className="text-emerald-600">{row.positiveRaw} positive ({posPercent}%)</p>
      <p className="text-rose-500">{row.negativeRaw} negative ({100 - posPercent}%)</p>
    </div>
  )
}

function SentimentPyramid({ sentiments }: { sentiments: SentimentData[] }) {
  const data = buildPyramidData(sentiments)
  if (data.length === 0) return null

  const chartHeight = data.length * 36 + 20

  return (
    <div className="w-full" style={{ height: chartHeight }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          stackOffset="sign"
          margin={{ top: 0, right: 8, bottom: 0, left: 0 }}
          barSize={20}
        >
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="label"
            width={100}
            tick={{ fontSize: 12, fill: 'var(--color-foreground)' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={false} />
          <Bar dataKey="negative" stackId="stack" radius={[0, 4, 4, 0]}>
            {data.map((_, i) => (
              <Cell key={`neg-${i}`} fill="#f87171" />
            ))}
          </Bar>
          <Bar dataKey="positive" stackId="stack" radius={[0, 4, 4, 0]}>
            {data.map((_, i) => (
              <Cell key={`pos-${i}`} fill="#34d399" />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function ReviewSentiment({ sentiments, conclusions }: ReviewSentimentProps) {
  if (sentiments.length === 0 && conclusions.length === 0) return null

  return (
    <div>
      <ConversationalSummary conclusions={conclusions} />
      <SentimentPyramid sentiments={sentiments} />
    </div>
  )
}
