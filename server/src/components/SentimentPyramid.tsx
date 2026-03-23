'use client'

import React from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'

export interface SentimentRecord {
  topic: string
  sentiment: 'positive' | 'neutral' | 'negative'
  amount: number
  reviewOrigin?: { id: number; name: string; incentivized?: boolean | null } | number | null
}

interface PyramidRow {
  label: string
  positive: number
  negative: number
}

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

function buildPyramidData(records: SentimentRecord[]): PyramidRow[] {
  const byTopic = new Map<string, { positive: number; negative: number; neutral: number }>()

  for (const r of records) {
    if (!byTopic.has(r.topic)) {
      byTopic.set(r.topic, { positive: 0, negative: 0, neutral: 0 })
    }
    const entry = byTopic.get(r.topic)!
    entry[r.sentiment] += r.amount
  }

  return Array.from(byTopic.entries())
    .map(([topic, counts]) => ({
      label: TOPIC_LABELS[topic] || topic,
      positive: counts.positive + counts.neutral,
      negative: -counts.negative, // negative for left side
    }))
    .filter((row) => row.positive > 0 || row.negative < 0)
    .sort((a, b) => (a.positive - a.negative) - (b.positive - b.negative))
}

const formatAbs = (v: unknown) => String(Math.abs(Number(v) || 0))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null

  const pos = payload.find((p: { dataKey: string }) => p.dataKey === 'positive')?.value ?? 0
  const neg = payload.find((p: { dataKey: string }) => p.dataKey === 'negative')?.value ?? 0

  return (
    <div
      style={{
        background: 'var(--theme-elevation-50)',
        border: '1px solid var(--theme-elevation-150)',
        borderRadius: 'var(--style-radius-s)',
        padding: '8px 12px',
        fontSize: 13,
        color: 'var(--theme-text)',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ color: '#22c55e' }}>Positive: {pos}</div>
      <div style={{ color: '#ef4444' }}>Negative: {Math.abs(neg)}</div>
    </div>
  )
}

export interface SentimentPyramidProps {
  records: SentimentRecord[]
  emptyMessage?: string
}

export default function SentimentPyramid({ records, emptyMessage }: SentimentPyramidProps) {
  const data = buildPyramidData(records)
  const totalMentions = records.reduce((sum, d) => sum + d.amount, 0)

  if (data.length === 0) {
    return (
      <div
        style={{
          padding: '32px 0',
          textAlign: 'center',
          color: 'var(--theme-elevation-500)',
          fontSize: 13,
        }}
      >
        {emptyMessage ?? 'No sentiment data yet. Run aggregation with Review Sentiment stage enabled.'}
      </div>
    )
  }

  const totalPositive = records.filter((r) => r.sentiment === 'positive' || r.sentiment === 'neutral').reduce((s, r) => s + r.amount, 0)
  const totalNegative = records.filter((r) => r.sentiment === 'negative').reduce((s, r) => s + r.amount, 0)
  const pctPositive = totalMentions > 0 ? Math.round((totalPositive / totalMentions) * 100) : 0
  const pctNegative = totalMentions > 0 ? Math.round((totalNegative / totalMentions) * 100) : 0

  const maxVal = Math.max(...data.map((d) => Math.max(d.positive, Math.abs(d.negative))), 1)
  const domainMax = Math.ceil(maxVal * 1.1)

  return (
    <div style={{ width: '100%', maxWidth: 700 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 13,
          color: 'var(--theme-elevation-500)',
          marginBottom: 8,
          padding: '0 4px',
        }}
      >
        <span>{totalMentions} topic mentions across {data.length} topics</span>
        <span style={{ display: 'flex', gap: 12 }}>
          <span style={{ color: '#22c55e', fontWeight: 500 }}>Positive {pctPositive}%</span>
          <span style={{ color: '#ef4444', fontWeight: 500 }}>Negative {pctNegative}%</span>
        </span>
      </div>
      <ResponsiveContainer width="100%" height={Math.max(data.length * 36 + 50, 150)}>
        <BarChart
          data={data}
          layout="vertical"
          stackOffset="sign"
          barCategoryGap={1}
          margin={{ top: 0, right: 30, bottom: 0, left: 10 }}
        >
          <XAxis
            type="number"
            domain={[-domainMax, domainMax]}
            tickFormatter={formatAbs}
            tick={{ fontSize: 11, fill: 'var(--theme-elevation-500)' }}
            axisLine={{ stroke: 'var(--theme-elevation-150)' }}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={110}
            tick={{ fontSize: 12, fill: 'var(--theme-text)' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--theme-elevation-100)' }} />
          <ReferenceLine x={0} stroke="var(--theme-elevation-250)" />
          <Bar
            stackId="sentiment"
            name="Positive"
            dataKey="positive"
            fill="#22c55e"
            radius={[0, 5, 5, 0]}
            label={{
              position: 'right',
              formatter: formatAbs,
              fontSize: 11,
              fill: 'var(--theme-elevation-500)',
            }}
          />
          <Bar
            stackId="sentiment"
            name="Negative"
            dataKey="negative"
            fill="#ef4444"
            radius={[0, 5, 5, 0]}
            label={{
              position: 'right',
              formatter: formatAbs,
              fontSize: 11,
              fill: 'var(--theme-elevation-500)',
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
