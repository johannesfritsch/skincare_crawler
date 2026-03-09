'use client'

import { useDashboardState } from '../dashboard-store'

interface MetricProps {
  label: string
  value: string
  icon: string
}

function Metric({ label, value, icon }: MetricProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '12px',
        backgroundColor: 'var(--theme-elevation-50)',
        border: '1px solid var(--theme-elevation-100)',
      }}
    >
      <span style={{ fontSize: '1.25rem' }}>{icon}</span>
      <div>
        <div
          style={{
            fontSize: '0.6875rem',
            fontWeight: 500,
            color: 'var(--theme-elevation-500)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontSize: '1.125rem',
            fontWeight: 700,
            color: 'var(--theme-text)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {value}
        </div>
      </div>
    </div>
  )
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '–'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatTokens(n: number): string {
  if (n === 0) return '0'
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

export default function EventHighlightsClient() {
  const { data } = useDashboardState()

  if (!data) return null

  const { highlights } = data

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
        gap: '8px',
        padding: '16px',
        border: '1px solid var(--theme-elevation-150)',
        backgroundColor: 'var(--theme-elevation-0)',
      }}
    >
      <Metric
        icon="📦"
        label="Products Crawled"
        value={highlights.productsCrawled.toLocaleString()}
      />
      <Metric
        icon="🔍"
        label="Products Discovered"
        value={highlights.productsDiscovered.toLocaleString()}
      />
      <Metric
        icon="💰"
        label="Price Changes"
        value={highlights.priceChanges.toLocaleString()}
      />
      <Metric
        icon="👻"
        label="Variants Disappeared"
        value={highlights.variantsDisappeared.toLocaleString()}
      />
      <Metric
        icon="🤖"
        label="Tokens Used"
        value={formatTokens(highlights.tokensUsed)}
      />
      <Metric
        icon="⏱️"
        label="Avg Batch Duration"
        value={formatDuration(highlights.avgBatchDurationMs)}
      />
    </div>
  )
}
